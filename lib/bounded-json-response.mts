// Environment-neutral browser/server JSON response boundary. It enforces a
// declared and streamed byte ceiling before parsing and can apply one deadline
// across both the fetch and body-read phases.

export const SMALL_JSON_RESPONSE_BYTES = 64 * 1024;
export const STANDARD_JSON_RESPONSE_BYTES = 2 * 1024 * 1024;
export const LARGE_JSON_RESPONSE_BYTES = 8 * 1024 * 1024;
export const DEFAULT_JSON_RESPONSE_TIMEOUT_MS = 40_000;
const MAX_JSON_RESPONSE_TIMEOUT_MS = 120_000;

export type BoundedJsonResponseErrorCode =
  | 'aborted'
  | 'invalid_json'
  | 'response_too_large'
  | 'timeout';

export class BoundedJsonResponseError extends Error {
  readonly code: BoundedJsonResponseErrorCode;

  constructor(code: BoundedJsonResponseErrorCode, message: string) {
    super(message);
    this.name = 'BoundedJsonResponseError';
    this.code = code;
  }
}

async function raceWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  onLateResolution?: (value: T) => void | Promise<void>,
): Promise<T> {
  if (signal.aborted) throw signal.reason ?? new Error('Request aborted.');
  return new Promise<T>((resolve, reject) => {
    let aborted = false;
    const onAbort = () => {
      aborted = true;
      reject(signal.reason ?? new Error('Request aborted.'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        if (aborted) {
          void Promise.resolve(onLateResolution?.(value)).catch(() => {});
          return;
        }
        resolve(value);
      },
      (cause) => {
        signal.removeEventListener('abort', onAbort);
        reject(cause);
      },
    );
  });
}

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function boundedPositiveInteger(value: unknown, fallback: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.min(maximum, Math.round(value)))
    : fallback;
}

export async function readJsonResponseCapped(
  response: Response,
  maximumBytes = STANDARD_JSON_RESPONSE_BYTES,
  signal?: AbortSignal,
  validateRawJson?: (raw: string) => void,
): Promise<unknown> {
  const maxBytes = boundedPositiveInteger(maximumBytes, STANDARD_JSON_RESPONSE_BYTES, LARGE_JSON_RESPONSE_BYTES);
  const declared = response.headers.get('content-length');
  if (declared && /^\d+$/u.test(declared)) {
    const bytes = Number(declared);
    if (!Number.isSafeInteger(bytes) || bytes > maxBytes) {
      await response.body?.cancel().catch(() => {});
      throw new BoundedJsonResponseError('response_too_large', `JSON response exceeded ${maxBytes} bytes.`);
    }
  }
  if (!response.body) return null;

  const reader = response.body.getReader();
  const cancelOnAbort = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener('abort', cancelOnAbort, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const read = reader.read();
      const { done, value } = signal ? await raceWithAbort(read, signal) : await read;
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new BoundedJsonResponseError('response_too_large', `JSON response exceeded ${maxBytes} bytes.`);
      }
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener('abort', cancelOnAbort);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let raw: string;
  try {
    raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new BoundedJsonResponseError('invalid_json', 'Response body was not valid UTF-8.');
  }
  try {
    validateRawJson?.(raw);
  } catch {
    throw new BoundedJsonResponseError(
      'invalid_json',
      'Response body did not satisfy the bounded JSON structure contract.',
    );
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new BoundedJsonResponseError('invalid_json', 'Response body was not valid JSON.');
  }
}

export async function requestJsonCapped(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: Readonly<{
    fetchImpl?: FetchImplementation;
    maximumBytes?: number;
    timeoutMs?: number;
    allowNonJsonErrorResponse?: boolean;
    validateRawJson?: (raw: string) => void;
  }> = {},
): Promise<Readonly<{ response: Response; body: unknown }>> {
  const timeoutMs = boundedPositiveInteger(
    options.timeoutMs,
    DEFAULT_JSON_RESPONSE_TIMEOUT_MS,
    MAX_JSON_RESPONSE_TIMEOUT_MS,
  );
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  const forwardAbort = () => controller.abort(upstreamSignal?.reason);
  if (upstreamSignal?.aborted) forwardAbort();
  else upstreamSignal?.addEventListener('abort', forwardAbort, { once: true });
  const timeoutReason = Object.freeze({ type: 'bounded-json-timeout' });
  const timeout = setTimeout(() => controller.abort(timeoutReason), timeoutMs);

  try {
    if (controller.signal.aborted) {
      throw new BoundedJsonResponseError('aborted', 'Request was cancelled.');
    }
    const fetchRequest = (options.fetchImpl ?? fetch)(input, {
      ...init,
      signal: controller.signal,
    });
    const response = await raceWithAbort(
      fetchRequest,
      controller.signal,
      async (lateResponse) => lateResponse.body?.cancel().catch(() => {}),
    );
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    const plausibleJson = !contentType
      || contentType.includes('application/json')
      || contentType.includes('+json');
    if (options.allowNonJsonErrorResponse !== false && !response.ok && !plausibleJson) {
      await response.body?.cancel().catch(() => {});
      return { response, body: null };
    }
    let body: unknown;
    try {
      body = await readJsonResponseCapped(
        response,
        options.maximumBytes,
        controller.signal,
        options.validateRawJson,
      );
    } catch (cause) {
      // Reverse proxies and hosting adapters can replace an upstream JSON
      // error with a bounded HTML or plain-text response. Preserve the HTTP
      // status so callers can apply retry and generic error handling, while
      // continuing to require valid JSON for successful responses.
      if (
        options.allowNonJsonErrorResponse !== false
        && !response.ok
        && cause instanceof BoundedJsonResponseError
        && cause.code === 'invalid_json'
      ) {
        body = null;
      } else {
        throw cause;
      }
    }
    return { response, body };
  } catch (cause) {
    if (controller.signal.aborted) {
      const timedOut = controller.signal.reason === timeoutReason;
      throw new BoundedJsonResponseError(
        timedOut ? 'timeout' : 'aborted',
        timedOut ? `Request timed out after ${timeoutMs} ms.` : 'Request was cancelled.',
      );
    }
    if (cause instanceof BoundedJsonResponseError) throw cause;
    throw cause;
  } finally {
    clearTimeout(timeout);
    upstreamSignal?.removeEventListener('abort', forwardAbort);
  }
}
