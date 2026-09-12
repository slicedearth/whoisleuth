import { abortable } from './abort.mts';
import { BoundedJsonResponseError, DEFAULT_JSON_RESPONSE_TIMEOUT_MS } from './bounded-json-response.mts';
import { parseLookupHttpResponse } from './lookup-response-contract.mts';
import {
  createLookupProgressStart, createLookupProgressSource, createLookupProgressFinal,
  createLookupProgressReducer, createLookupProgressNdjsonDecoder, encodeLookupProgressEvent,
  MAX_LOOKUP_PROGRESS_STREAM_BYTES, type LookupProgressEvent, type LookupProgressSource,
  type LookupProgressSnapshot,
} from './lookup-progress.mts';
import type { LookupSourceSettlement } from './lookup-source-progress.mts';

export const LOOKUP_PROGRESS_CONTENT_TYPE = 'application/x-ndjson';
export type LookupProgressUpdate = Readonly<{
  transport: 'streaming' | 'buffered';
  snapshot: LookupProgressSnapshot | null;
}>;

/** The caller keeps its operation lease until completion, not merely until headers exist. */
export function createLookupProgressBody(options: Readonly<{
  sources: readonly LookupProgressSource[];
  signal?: AbortSignal;
  run: (settled: (source: LookupSourceSettlement) => void, signal: AbortSignal) => Promise<unknown>;
}>) {
  const abort = new AbortController();
  const forwardAbort = () => abort.abort(options.signal?.reason);
  if (options.signal?.aborted) forwardAbort();
  else options.signal?.addEventListener('abort', forwardAbort, { once: true });
  let target: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  let sequence = 0;
  let bytes = 0;
  const reducer = createLookupProgressReducer({ validateFinalResult: result => parseLookupHttpResponse(result).ok });
  const body = new ReadableStream<Uint8Array>({
    start(controller) { target = controller; },
    cancel() { closed = true; abort.abort(); },
  });
  const endAbortedBody = () => {
    if (!closed) { closed = true; target.error(new Error('Lookup ended without a complete validated response.')); }
  };
  abort.signal.addEventListener('abort', endAbortedBody, { once: true });
  function emit(event: LookupProgressEvent) {
    if (closed || abort.signal.aborted) return;
    reducer.apply(event);
    const encoded = new TextEncoder().encode(encodeLookupProgressEvent(event));
    bytes += encoded.byteLength;
    if (bytes > MAX_LOOKUP_PROGRESS_STREAM_BYTES) throw new Error('Lookup progress exceeded its response bound.');
    target.enqueue(encoded);
  }
  const deadline = setTimeout(() => abort.abort(), DEFAULT_JSON_RESPONSE_TIMEOUT_MS);
  const completion = Promise.resolve().then(async () => {
    abort.signal.throwIfAborted();
    emit(createLookupProgressStart('deep', options.sources));
    const result = await options.run(source => {
      if (closed || abort.signal.aborted) return;
      try {
        emit(createLookupProgressSource(++sequence, source.source, source.state, source.fragment, source));
      } catch { abort.abort(); }
    }, abort.signal);
    abort.signal.throwIfAborted();
    emit(createLookupProgressFinal(++sequence, options.sources, result));
    if (!closed) { closed = true; target.close(); }
  }).catch(() => {
    if (!closed) { closed = true; target.error(new Error('Lookup ended without a complete validated response.')); }
  }).finally(() => {
    clearTimeout(deadline);
    abort.signal.removeEventListener('abort', endAbortedBody);
    options.signal?.removeEventListener('abort', forwardAbort);
  });
  return { body, completion };
}

export async function readLookupProgressResponse(
  response: Response, signal: AbortSignal, onProgress?: (update: LookupProgressUpdate) => void,
): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (declared && /^\d+$/u.test(declared)
    && (!Number.isSafeInteger(Number(declared)) || Number(declared) > MAX_LOOKUP_PROGRESS_STREAM_BYTES)) {
    await response.body?.cancel().catch(() => {});
    throw new BoundedJsonResponseError('response_too_large', 'Lookup progress exceeded its response bound.');
  }
  if (!response.body) throw new BoundedJsonResponseError('invalid_json', 'Lookup progress has no response body.');
  const reducer = createLookupProgressReducer({ validateFinalResult: result => parseLookupHttpResponse(result).ok });
  const decoder = createLookupProgressNdjsonDecoder(event => {
    const snapshot = reducer.apply(event);
    // Presentation failure must not alter the independently validated result.
    try { onProgress?.({ transport: 'streaming', snapshot }); } catch { /* No evidence mutation. */ }
  });
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      const next = await abortable(() => reader.read(), signal);
      signal.throwIfAborted();
      if (next.done) break;
      decoder.push(next.value);
    }
    decoder.finish();
    return reducer.finish();
  } catch {
    await reader.cancel().catch(() => {});
    throw new BoundedJsonResponseError('invalid_json', 'Lookup progress ended without a valid final response.');
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}
