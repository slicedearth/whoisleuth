// Shared HTTP response and request-boundary contracts. Netlify Functions use
// json() directly, while the Express runtime reuses the bounded JSON body
// limit and sanitized request-error vocabulary below.

import { HTTP_BASELINE_CONTENT_SECURITY_POLICY } from './security-headers.mts';

const MAX_API_JSON_BODY_BYTES = 1024 * 1024;
const MAX_API_REQUEST_BODY_READ_MS = 10_000;

const API_REQUEST_ERROR_CODES = Object.freeze({
  INVALID_REQUEST_BODY: 'INVALID_REQUEST_BODY',
  REQUEST_TOO_LARGE: 'REQUEST_TOO_LARGE',
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
});

type ApiRequestErrorCode = typeof API_REQUEST_ERROR_CODES[keyof typeof API_REQUEST_ERROR_CODES];

type ApiRequestErrorResponse = {
  statusCode: number;
  body: {
    error: string;
    errorCode: string;
  };
};

type NetlifyResponseHeaders = Readonly<Record<string, string>>;

type NetlifyJsonResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string | undefined;
};

type BoundedRequestText = {
  status: 'ok';
  body: string;
} | {
  status: 'invalid_encoding';
} | {
  status: 'too_large';
} | {
  status: 'timed_out';
} | {
  status: 'aborted';
};

function apiRequestErrorResponse(errorCode: ApiRequestErrorCode): ApiRequestErrorResponse {
  if (errorCode === API_REQUEST_ERROR_CODES.INVALID_REQUEST_BODY) {
    return {
      statusCode: 400,
      body: { error: 'Invalid request body', errorCode },
    };
  }
  if (errorCode === API_REQUEST_ERROR_CODES.REQUEST_TOO_LARGE) {
    return {
      statusCode: 413,
      body: { error: 'Request bodies are limited to 1 MiB.', errorCode },
    };
  }
  if (errorCode === API_REQUEST_ERROR_CODES.REQUEST_TIMEOUT) {
    return {
      statusCode: 408,
      body: { error: 'Request body read timed out', errorCode },
    };
  }
  return {
    statusCode: 500,
    body: { error: 'Internal server error', errorCode: API_REQUEST_ERROR_CODES.INTERNAL_ERROR },
  };
}

function apiUnexpectedErrorResponse(errorCode: unknown = API_REQUEST_ERROR_CODES.INTERNAL_ERROR): ApiRequestErrorResponse {
  const boundedCode = typeof errorCode === 'string'
    && /^[A-Z][A-Z0-9_]{0,63}$/u.test(errorCode)
    ? errorCode
    : API_REQUEST_ERROR_CODES.INTERNAL_ERROR;
  return {
    statusCode: 500,
    body: { error: 'Internal server error', errorCode: boundedCode },
  };
}

function apiErrorResponseFor(error: unknown): ApiRequestErrorResponse {
  const type = error && typeof error === 'object' && !Array.isArray(error)
    ? (error as { type?: unknown }).type
    : null;
  if (type === 'entity.parse.failed') {
    return apiRequestErrorResponse(API_REQUEST_ERROR_CODES.INVALID_REQUEST_BODY);
  }
  if (type === 'entity.too.large') {
    return apiRequestErrorResponse(API_REQUEST_ERROR_CODES.REQUEST_TOO_LARGE);
  }
  return apiUnexpectedErrorResponse();
}

function json(
  statusCode: number,
  body: unknown,
  extraHeaders: NetlifyResponseHeaders = {},
): NetlifyJsonResponse {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': HTTP_BASELINE_CONTENT_SECURITY_POLICY,
      'Strict-Transport-Security': 'max-age=31536000',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

function withNetlifyApiErrorBoundary<TEvent>(
  handler: (event: TEvent) => Promise<NetlifyJsonResponse>,
  errorCode: unknown = API_REQUEST_ERROR_CODES.INTERNAL_ERROR,
): (event: TEvent) => Promise<NetlifyJsonResponse> {
  return async (event) => {
    try {
      return await handler(event);
    } catch {
      const response = apiUnexpectedErrorResponse(errorCode);
      return json(response.statusCode, response.body);
    }
  };
}

function withNetlifyFetchApiErrorBoundary<TArguments extends unknown[]>(
  handler: (...args: TArguments) => Promise<Response>,
  errorCode: unknown = API_REQUEST_ERROR_CODES.INTERNAL_ERROR,
): (...args: TArguments) => Promise<Response> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch {
      const response = apiUnexpectedErrorResponse(errorCode);
      return netlifyJsonToResponse(json(response.statusCode, response.body));
    }
  };
}

// Modern Netlify Fetch handlers receive a streaming Request rather than the
// already-buffered Lambda event used by the older entry points. Enforce the
// same byte boundary before retaining the complete body, reject malformed
// UTF-8 deterministically, and share the implementation across every modern
// request boundary that accepts JSON.
async function readRequestTextCapped(
  request: Request,
  maxBytes = MAX_API_JSON_BODY_BYTES,
  timeoutMs = MAX_API_REQUEST_BODY_READ_MS,
): Promise<BoundedRequestText> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_API_REQUEST_BODY_READ_MS) {
    throw new TypeError('Request body read deadline is outside the supported boundary.');
  }
  const declaredLength = request.headers.get('content-length');
  if (declaredLength && /^\d+$/u.test(declaredLength)) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength > maxBytes) {
      return { status: 'too_large' };
    }
  }
  if (!request.body) return { status: 'ok', body: '' };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let abortListener: (() => void) | null = null;
  const timeout = new Promise<{ kind: 'timed_out' }>((resolve) => {
    timeoutHandle = setTimeout(() => resolve({ kind: 'timed_out' }), timeoutMs);
  });
  const aborted = new Promise<{ kind: 'aborted' }>((resolve) => {
    if (request.signal.aborted) {
      resolve({ kind: 'aborted' });
      return;
    }
    abortListener = () => resolve({ kind: 'aborted' });
    request.signal.addEventListener('abort', abortListener, { once: true });
  });
  try {
    while (true) {
      const read = reader.read().then(
        (value) => ({ kind: 'read' as const, value }),
        (error: unknown) => ({ kind: 'error' as const, error }),
      );
      const outcome = await Promise.race([read, timeout, aborted]);
      if (outcome.kind === 'timed_out' || outcome.kind === 'aborted') {
        void reader.cancel(outcome.kind).catch(() => {});
        return { status: outcome.kind };
      }
      if (outcome.kind === 'error') {
        if (request.signal.aborted) {
          void reader.cancel('aborted').catch(() => {});
          return { status: 'aborted' };
        }
        throw outcome.error;
      }
      const { done, value } = outcome.value;
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        void reader.cancel('too_large').catch(() => {});
        return { status: 'too_large' };
      }
      chunks.push(value);
    }
  } finally {
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    if (abortListener) request.signal.removeEventListener('abort', abortListener);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { status: 'ok', body: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    return { status: 'invalid_encoding' };
  }
}

function netlifyJsonToResponse(response: NetlifyJsonResponse): Response {
  return new Response(response.body, {
    status: response.statusCode,
    headers: response.headers,
  });
}

export {
  API_REQUEST_ERROR_CODES,
  MAX_API_JSON_BODY_BYTES,
  MAX_API_REQUEST_BODY_READ_MS,
  apiErrorResponseFor,
  apiRequestErrorResponse,
  apiUnexpectedErrorResponse,
  json,
  netlifyJsonToResponse,
  readRequestTextCapped,
  withNetlifyApiErrorBoundary,
  withNetlifyFetchApiErrorBoundary,
};
export type {
  ApiRequestErrorCode,
  ApiRequestErrorResponse,
  BoundedRequestText,
  NetlifyJsonResponse,
  NetlifyResponseHeaders,
};
