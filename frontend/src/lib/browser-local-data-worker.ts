import { runBrowserWorkerOperation } from './browser-worker-operation.ts';
import {
  BrowserLocalDataError,
  decodeLocalDataSnapshots,
  plaintextJsonCodec,
  type BrowserLocalDataCodec,
  type CapturedLocalDataCollection,
  type LocalDataCollectionDefinition,
} from './browser-local-data.ts';
import type { LocalDataDecodeRequest, LocalDataDecodeResponse } from './browser-local-data-worker-model.ts';

// Scheduling hint, not an admission or timing bound. Smaller payloads avoid
// worker startup; both paths run the same complete integrity checks.
const WORKER_MINIMUM_PAYLOAD_BYTES = 256 * 1024;

export async function decodeBrowserLocalDataSnapshots<T>(
  definitions: readonly LocalDataCollectionDefinition<T>[],
  captured: readonly CapturedLocalDataCollection[],
  codec: BrowserLocalDataCodec,
  options: Readonly<{ createWorker?: () => Worker; signal?: AbortSignal }> = {},
): Promise<T[]> {
  if (options.signal?.aborted) throw new DOMException('Browser-local verification was cancelled.', 'AbortError');
  // Small collections and custom codecs/definitions use the same local decoder.
  if ((!options.createWorker && typeof Worker === 'undefined') || codec !== plaintextJsonCodec
    || captured.reduce((bytes, entry) => bytes + entry.records.reduce((total, record) => total + record.payloadBytes, 0), 0) < WORKER_MINIMUM_PAYLOAD_BYTES) {
    return decodeLocalDataSnapshots(definitions, captured, codec);
  }
  const { BROWSER_LOCAL_COLLECTIONS } = await import('./browser-local-data-definitions.ts');
  if (definitions.some((definition) => !BROWSER_LOCAL_COLLECTIONS.some((canonical: object) => canonical === definition))) {
    return decodeLocalDataSnapshots(definitions, captured, codec);
  }
  try {
    return await runBrowserWorkerOperation<LocalDataDecodeRequest, T[]>({ captured }, {
      ...options,
      createWorker: options.createWorker ?? (() => new Worker(new URL('./workers/browser-local-data.worker.ts', import.meta.url), { type: 'module', name: 'browser-local-data-verification' })),
      messages: {
        cancelled: 'Browser-local verification was cancelled.',
        unavailable: 'The browser-local verification worker is unavailable. Retry to load the saved records.',
        timeout: 'Browser-local verification did not finish. Saved records were not changed.',
        unreadable: 'Browser-local verification returned unreadable data. Saved records were not changed.',
        send: 'The saved records could not be sent for local verification. Saved records were not changed.',
      },
      readResponse(value) {
        const reply = value as LocalDataDecodeResponse | null;
        if (reply?.kind === 'error' && typeof reply.code === 'string' && typeof reply.detail === 'string') {
          throw new BrowserLocalDataError(reply.code, reply.detail);
        }
        if (reply?.kind !== 'decoded' || !Array.isArray(reply.documents) || reply.documents.length !== definitions.length
          || reply.documents.some((entry, index) => !entry || entry.collection !== definitions[index]!.id
            || !entry.document || typeof entry.document !== 'object')) {
          throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', 'Browser-local verification returned an incomplete or unexpected snapshot.');
        }
        // Each document has passed its owning definition in the worker.
        return reply.documents.map((entry) => entry.document) as T[];
      },
    });
  } catch (cause) {
    if (cause instanceof BrowserLocalDataError || (cause instanceof DOMException && cause.name === 'AbortError')) throw cause;
    throw new BrowserLocalDataError('LOCAL_DATA_READ_FAILED', cause instanceof Error ? cause.message : 'Browser-local verification failed. Saved records were not changed.');
  }
}
