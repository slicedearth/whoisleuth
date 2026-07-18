// Shared HTTP response and request-boundary contracts. Netlify Functions use
// json() directly, while the Express runtime reuses the bounded JSON body
// limit and sanitized request-error vocabulary below.

const MAX_API_JSON_BODY_BYTES = 1024 * 1024;

const API_REQUEST_ERROR_CODES = Object.freeze({
  INVALID_REQUEST_BODY: 'INVALID_REQUEST_BODY',
  REQUEST_TOO_LARGE: 'REQUEST_TOO_LARGE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
});

type ApiRequestErrorCode = typeof API_REQUEST_ERROR_CODES[keyof typeof API_REQUEST_ERROR_CODES];

type ApiRequestErrorResponse = {
  statusCode: number;
  body: {
    error: string;
    errorCode: ApiRequestErrorCode;
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
  return {
    statusCode: 500,
    body: { error: 'Internal server error', errorCode: API_REQUEST_ERROR_CODES.INTERNAL_ERROR },
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
  return apiRequestErrorResponse(API_REQUEST_ERROR_CODES.INTERNAL_ERROR);
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
      'Strict-Transport-Security': 'max-age=31536000',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
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
): Promise<BoundedRequestText> {
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
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => {});
      return { status: 'too_large' };
    }
    chunks.push(value);
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
  apiErrorResponseFor,
  apiRequestErrorResponse,
  json,
  netlifyJsonToResponse,
  readRequestTextCapped,
};
export type {
  ApiRequestErrorCode,
  ApiRequestErrorResponse,
  BoundedRequestText,
  NetlifyJsonResponse,
  NetlifyResponseHeaders,
};
