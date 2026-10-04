import { runBrowserWorkerOperation } from './browser-worker-operation.ts';
import type { MessageIntakeRequest, MessageIntakeResponse } from './message-intake-worker-model.ts';
import { MESSAGE_INTAKE_SCHEMA, MESSAGE_INTAKE_VERSION, MAX_INTAKE_LINKS } from '../../../packages/contracts/message-intake.mts';
import { validateIntakeExtensions } from '../../../packages/investigation/intake-context.mts';

export function runMessageIntakeWorker(request: MessageIntakeRequest, signal?: AbortSignal) {
  return runBrowserWorkerOperation(request, {
    ...(signal ? { signal } : {}),
    createWorker: () => new Worker(new URL('./workers/message-intake.worker.ts', import.meta.url), { type: 'module', name: 'message-intake' }),
    messages: { cancelled: 'Input review cancelled. Nothing was saved.', unavailable: 'Local input review is unavailable. Nothing was saved.',
      timeout: 'Input review did not finish. Nothing was saved.', unreadable: 'Input review returned unreadable data.', send: 'The selected input could not be sent for local review.' },
    readResponse(value) {
      const reply = value as MessageIntakeResponse | null;
      if (reply?.kind !== 'review' || reply.result?.report.schema !== MESSAGE_INTAKE_SCHEMA || reply.result.report.schemaVersion !== MESSAGE_INTAKE_VERSION
        || !Array.isArray(reply.result.report.links) || reply.result.report.links.length > MAX_INTAKE_LINKS || !Array.isArray(reply.result.targets)
        || reply.result.targets.length !== reply.result.report.links.length) throw new Error('This input could not be reviewed. Check its format, size and nesting; PNGs must be still images. Nothing was saved.');
      validateIntakeExtensions(reply.result.report);
      return reply.result;
    },
  });
}
