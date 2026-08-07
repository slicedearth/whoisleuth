import {
  lookupHttpErrorMessage,
  parseCompactLookupHttpResponse,
  type CompactLookupHttpResponse,
} from './lookup-response.ts';
import {
  requestJsonCapped,
  STANDARD_JSON_RESPONSE_BYTES,
} from '../bounded-json-response.ts';

export type BulkLookupMode = 'deep' | 'fast';

type BulkLookupFetch = (
  input: string,
  init: Readonly<{ signal: AbortSignal }>,
) => Promise<Response>;

type BulkLookupWait = (delayMs: number, signal: AbortSignal) => Promise<void>;

export const BULK_LOOKUP_RETRY_ATTEMPTS = 3;
export const BULK_LOOKUP_DEFAULT_RETRY_DELAY_MS = 2_000;
export const BULK_LOOKUP_MAX_RETRY_DELAY_MS = 30_000;
export const BULK_LOOKUP_REQUEST_TIMEOUT_MS = 40_000;

export function bulkLookupRetryDelayMs(
  value: string | null,
  nowMs = Date.now(),
): number {
  const seconds = value !== null && /^\d+(?:\.\d+)?$/u.test(value.trim())
    ? Number(value)
    : Number.NaN;
  const dateDelay = value !== null && !Number.isFinite(seconds)
    ? Date.parse(value) - nowMs
    : Number.NaN;
  const requested = Number.isFinite(seconds)
    ? seconds * 1_000
    : Number.isFinite(dateDelay)
      ? dateDelay
      : BULK_LOOKUP_DEFAULT_RETRY_DELAY_MS;
  return Math.min(
    BULK_LOOKUP_MAX_RETRY_DELAY_MS,
    Math.max(0, Math.round(requested)),
  );
}

async function waitForBulkLookupRetry(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function fetchCompactBulkLookup(
  domain: string,
  mode: BulkLookupMode,
  signal: AbortSignal,
  options: Readonly<{
    fetch?: BulkLookupFetch;
    wait?: BulkLookupWait;
    now?: () => number;
  }> = {},
): Promise<CompactLookupHttpResponse> {
  const fetcher = options.fetch ?? fetch;
  const wait = options.wait ?? waitForBulkLookupRetry;
  const now = options.now ?? Date.now;
  const url = `/api/lookup?q=${encodeURIComponent(domain)}&fast=${mode === 'fast' ? '1' : '0'}&compact=1`;
  const request = () => requestJsonCapped(url, { signal }, {
    maximumBytes: STANDARD_JSON_RESPONSE_BYTES,
    timeoutMs: BULK_LOOKUP_REQUEST_TIMEOUT_MS,
    fetchImpl: (input, init) => fetcher(String(input), { signal: init?.signal ?? signal }),
  });
  let result = await request();
  for (
    let attempt = 0;
    result.response.status === 429 && attempt < BULK_LOOKUP_RETRY_ATTEMPTS;
    attempt += 1
  ) {
    const delayMs = bulkLookupRetryDelayMs(result.response.headers.get('Retry-After'), now());
    await wait(delayMs, signal);
    result = await request();
  }
  const { response, body } = result;
  if (!response.ok) throw new Error(lookupHttpErrorMessage(body, response.status));
  const parsed = parseCompactLookupHttpResponse(body, domain);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}
