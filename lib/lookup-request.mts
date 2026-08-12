import {
  lookupHttpErrorMessage,
  MAX_LOOKUP_RESPONSE_CONTAINER_ITEMS,
  parseLookupHttpResponse,
  type LookupHttpResponse,
} from './lookup-response-contract.mts';
import {
  BoundedJsonResponseError,
  LARGE_JSON_RESPONSE_BYTES,
  readJsonResponseCapped,
} from './bounded-json-response.mts';
import { scanBoundedJson } from './bounded-json.mts';

const LOOKUP_CLIENT_TIMEOUT_MS = 40_000;

type LookupRequestFailureKind =
  | 'cancelled'
  | 'http'
  | 'invalid_response'
  | 'network'
  | 'timeout';

type LookupRequestOutcome =
  | { readonly ok: true; readonly value: LookupHttpResponse }
  | {
      readonly ok: false;
      readonly kind: LookupRequestFailureKind;
      readonly message: string;
    };

type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type LookupRequestOptions = Readonly<{
  fetchImpl?: FetchImplementation;
  signal?: AbortSignal;
  timeoutMs?: number;
}>;

const TIMEOUT_REASON = Object.freeze({ type: 'lookup-timeout' });
const CANCELLED_MESSAGE = 'Lookup cancelled. No partial response was retained.';
const INVALID_RESPONSE_MESSAGE = 'Lookup returned an invalid response.';
const NETWORK_MESSAGE = 'Lookup request could not be completed.';

function timeoutMessage(timeoutMs: number): string {
  const seconds = Math.max(1, Math.round(timeoutMs / 1_000));
  return `Lookup timed out after ${seconds} ${seconds === 1 ? 'second' : 'seconds'}. No partial response was retained.`;
}

async function requestLookup(
  url: string,
  options: LookupRequestOptions = {},
): Promise<LookupRequestOutcome> {
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.min(LOOKUP_CLIENT_TIMEOUT_MS, Math.max(1, Math.round(Number(options.timeoutMs))))
    : LOOKUP_CLIENT_TIMEOUT_MS;
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) forwardAbort();
  else options.signal?.addEventListener('abort', forwardAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(TIMEOUT_REASON), timeoutMs);

  try {
    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const response = await fetchImpl(url, { signal: controller.signal });
    if (controller.signal.aborted) {
      await response.body?.cancel(controller.signal.reason).catch(() => {});
      throw new DOMException('Aborted', 'AbortError');
    }
    let body: unknown;
    try {
      body = await readJsonResponseCapped(
        response,
        LARGE_JSON_RESPONSE_BYTES,
        controller.signal,
        (raw) => scanBoundedJson(raw, {
          maximumContainerItems: MAX_LOOKUP_RESPONSE_CONTAINER_ITEMS,
        }),
      );
    } catch (cause) {
      // Preserve the HTTP status when an adapter supplies a malformed bounded
      // error page. Successful malformed or over-bound responses remain typed
      // response-contract failures in the outer catch.
      if (!response.ok) body = null;
      else throw cause;
    }
    if (!response.ok) {
      return {
        ok: false,
        kind: 'http',
        message: lookupHttpErrorMessage(body, response.status),
      };
    }
    const parsed = parseLookupHttpResponse(body);
    if (!parsed.ok) {
      return {
        ok: false,
        kind: 'invalid_response',
        message: parsed.error,
      };
    }
    return { ok: true, value: parsed.value };
  } catch (cause) {
    if (controller.signal.aborted) {
      if (controller.signal.reason === TIMEOUT_REASON) {
        return {
          ok: false,
          kind: 'timeout',
          message: timeoutMessage(timeoutMs),
        };
      }
      return {
        ok: false,
        kind: 'cancelled',
        message: CANCELLED_MESSAGE,
      };
    }
    if (cause instanceof BoundedJsonResponseError
      && (cause.code === 'invalid_json' || cause.code === 'response_too_large')) {
      return {
        ok: false,
        kind: 'invalid_response',
        message: INVALID_RESPONSE_MESSAGE,
      };
    }
    return {
      ok: false,
      kind: 'network',
      message: NETWORK_MESSAGE,
    };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', forwardAbort);
  }
}

export {
  LOOKUP_CLIENT_TIMEOUT_MS,
  requestLookup,
};
export type {
  LookupRequestFailureKind,
  LookupRequestOptions,
  LookupRequestOutcome,
};
