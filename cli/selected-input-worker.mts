import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { reviewSelectedInput } from '../packages/investigation/selected-input-review.mts';
import { assertMessageBytes } from '../packages/investigation/intake-report.mts';
import { DOCUMENT_REVIEW_DEADLINE_MS } from '../packages/contracts/document-intake.mts';
import { MESSAGE_INTAKE_SCHEMA, MESSAGE_INTAKE_VERSION, type MessageIntakeKind, type MessageIntakeResult } from '../packages/contracts/message-intake.mts';

type Request = Readonly<{ bytes: Uint8Array; kind: MessageIntakeKind; reviewedAt: string }>;
type Response = Readonly<{ result: MessageIntakeResult }> | Readonly<{ error: true }>;

if (!isMainThread && parentPort) {
  const port = parentPort, request = workerData as Request;
  try { port.postMessage({ result: await reviewSelectedInput(request.bytes, request.kind, request.reviewedAt) } satisfies Response); }
  catch { port.postMessage({ error: true } satisfies Response); }
  finally { if (request.bytes instanceof Uint8Array) request.bytes.fill(0); port.close(); }
}

/** A disposable worker makes synchronous parser work cancellable, not a sandbox. */
export async function reviewSelectedInputInWorker(bytes: Uint8Array, kind: MessageIntakeKind, reviewedAt: string, signal?: AbortSignal): Promise<MessageIntakeResult> {
  assertMessageBytes(bytes); signal?.throwIfAborted();
  // Buffer.slice() can retain a pooled, non-transferable backing store.
  const copy = Uint8Array.from(bytes);
  const worker = new Worker(new URL(import.meta.url), { workerData: { bytes: copy, kind, reviewedAt } satisfies Request,
    transferList: [copy.buffer], env: {}, execArgv: [], stdout: true, stderr: true,
    resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 } });
  worker.stdout.resume(); worker.stderr.resume();
  try {
    return await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (value?: MessageIntakeResult, cause?: Error) => {
        if (settled) return; settled = true;
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        if (value) resolve(value); else reject(cause ?? new TypeError('The selected input could not be reviewed within its format and processing bounds.'));
      };
      const abort = () => finish(undefined, new Error('Selected input review was cancelled. Nothing was saved.'));
      const timer = setTimeout(() => finish(undefined, new Error('Selected input review exceeded its processing deadline. Nothing was saved.')), DOCUMENT_REVIEW_DEADLINE_MS);
      worker.once('message', (reply: Response) => {
        if (reply && typeof reply === 'object' && 'result' in reply && reply.result?.report.schema === MESSAGE_INTAKE_SCHEMA && reply.result.report.schemaVersion === MESSAGE_INTAKE_VERSION) finish(reply.result);
        else finish();
      });
      worker.once('error', () => finish()); worker.once('exit', () => finish());
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  } finally { await worker.terminate(); }
}
