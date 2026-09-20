import { runBrowserWorkerOperation } from './browser-worker-operation.ts';
import {
  BrowserLocalDataError, prepareLocalDataContent, plaintextJsonCodec, assertPreparedLocalDataContent,
  type AnyLocalDataCollectionDefinition, type BrowserLocalDataCodec, type PreparedLocalDataContent,
} from './browser-local-data.ts';
import type { BrandProfileFileMerge, LocalDataWorkerRequest, LocalDataWorkerResponse } from './browser-local-data-worker-model.ts';
import type { BrandProfile } from './analysis/brand-profile-model.ts';
import { MAX_PROFILE_IMPORT_BYTES } from '../../../packages/contracts/workspace-portability.mts';

type LocalWorkerOptions = Readonly<{ createWorker?: () => Worker; signal?: AbortSignal }>;

function preparationFailure(cause: unknown): never {
  if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
  throw new BrowserLocalDataError('LOCAL_DATA_PREPARATION_FAILED', cause instanceof Error ? cause.message : 'Browser-local preparation failed. No changes were saved.', { cause });
}

async function runPreparation<Result>(
  request: LocalDataWorkerRequest,
  readResult: (reply: LocalDataWorkerResponse | null) => Result,
  options: LocalWorkerOptions,
): Promise<Result> {
  function readResponse(value: unknown): Result {
    const reply = value as LocalDataWorkerResponse | null;
    if (reply?.kind === 'error' && typeof reply.code === 'string' && typeof reply.detail === 'string') {
      throw new BrowserLocalDataError(reply.code, reply.detail);
    }
    return readResult(reply);
  }
  try {
    if (options.signal?.aborted) throw new DOMException('Browser-local preparation was cancelled.', 'AbortError');
    if (!options.createWorker && typeof Worker === 'undefined') {
      const { runLocalDataWorkerRequest } = await import('./browser-local-data-worker-model.ts');
      if (options.signal?.aborted) throw new DOMException('Browser-local preparation was cancelled.', 'AbortError');
      const response = await runLocalDataWorkerRequest(request);
      if (options.signal?.aborted) throw new DOMException('Browser-local preparation was cancelled.', 'AbortError');
      return readResponse(response);
    }
    return await runBrowserWorkerOperation(request, {
      ...options, readResponse,
      createWorker: options.createWorker ?? (() => new Worker(new URL('./workers/browser-local-data.worker.ts', import.meta.url), { type: 'module', name: 'browser-local-data-preparation' })),
      messages: {
        cancelled: 'Browser-local preparation was cancelled.',
        unavailable: 'The browser-local preparation worker is unavailable. No changes were saved.',
        timeout: 'Browser-local preparation did not finish. No changes were saved.',
        unreadable: 'Browser-local preparation returned unreadable data. No changes were saved.',
        send: 'The selected data could not be sent for local preparation. No changes were saved.',
      },
    });
  } catch (cause) {
    preparationFailure(cause);
  }
}

/** Only explicit bulk/import operations request background preparation. */
export async function prepareBrowserLocalDataContent(
  definition: AnyLocalDataCollectionDefinition, input: unknown, codec: BrowserLocalDataCodec,
  options: LocalWorkerOptions = {},
): Promise<PreparedLocalDataContent> {
  if (options.signal?.aborted) throw new DOMException('Browser-local preparation was cancelled.', 'AbortError');
  if (codec !== plaintextJsonCodec || (!options.createWorker && typeof Worker === 'undefined')) {
    return prepareLocalDataContent(definition, input, codec, options).catch(preparationFailure);
  }
  const { BROWSER_LOCAL_COLLECTIONS } = await import('./browser-local-data-definitions.ts');
  if (!BROWSER_LOCAL_COLLECTIONS.some((canonical: object) => canonical === definition)) {
    return prepareLocalDataContent(definition, input, codec, options).catch(preparationFailure);
  }
  return runPreparation({ kind: 'prepare', collection: definition.id, input }, (reply) => {
    if (reply?.kind !== 'prepared' || reply.collection !== definition.id) {
      throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', 'Browser-local preparation returned an incomplete or unexpected collection.');
    }
    assertPreparedLocalDataContent(definition, reply.content, codec.id);
    return reply.content;
  }, options);
}

export async function mergeBrowserBrandProfileFile(
  current: readonly BrandProfile[], file: Blob, options: LocalWorkerOptions = {},
): Promise<BrandProfileFileMerge> {
  if (file.size > MAX_PROFILE_IMPORT_BYTES) throw new Error(`Profile imports are limited to ${MAX_PROFILE_IMPORT_BYTES / 1024 / 1024} MiB.`);
  return runPreparation({ kind: 'import-profiles', current, file, nowIso: new Date().toISOString() }, (reply) => {
    if (reply?.kind !== 'profiles-merged' || !reply.result || !Array.isArray(reply.result.profiles)
      || ![reply.result.added, reply.result.updated, reply.result.skipped].every((count) => Number.isSafeInteger(count) && count >= 0)) {
      throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', 'Profile import returned an incomplete or unexpected collection.');
    }
    return reply.result;
  }, options);
}
