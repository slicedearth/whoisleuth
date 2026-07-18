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

export {
  API_REQUEST_ERROR_CODES,
  MAX_API_JSON_BODY_BYTES,
  apiErrorResponseFor,
  apiRequestErrorResponse,
  json,
};
export type {
  ApiRequestErrorCode,
  ApiRequestErrorResponse,
  NetlifyJsonResponse,
  NetlifyResponseHeaders,
};
