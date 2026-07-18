// Public authentication boundary. The modern Fetch handler lets Netlify
// apply one edge rule to the function itself. Its custom /api/login path also
// replaces the provider's default direct function endpoint, removing the
// redirect bypass entirely. The existing in-memory limiter remains as a
// defense-in-depth fallback for local tests and any request that reaches the
// handler.

import { checkPassword, createSessionToken, buildSessionCookie, isTrustedLoginOrigin } from '../../lib/auth.mts';
import { checkRateLimit, getClientIp, LOGIN_RATE_LIMIT } from '../../lib/rate-limit.mts';
import {
  API_REQUEST_ERROR_CODES,
  MAX_API_JSON_BODY_BYTES,
  apiRequestErrorResponse,
  json,
  netlifyJsonToResponse,
  readRequestTextCapped,
} from '../../lib/http.mts';
import type { BoundedRequestText, NetlifyJsonResponse } from '../../lib/http.mts';
import type { NetlifyFunctionEvent, NetlifyFunctionHeaders } from '../../lib/netlify-function-types.mts';

type LoginFunctionConfig = {
  path: string;
  rateLimit: {
    windowLimit: number;
    windowSize: number;
    aggregateBy: ['ip', 'domain'];
  };
};

type LoginBodyReader = () => Promise<BoundedRequestText>;

// Netlify statically analyses this named export during post-processing. Keep
// every configuration value literal rather than routing it through constants.
export const config: LoginFunctionConfig = {
  path: '/api/login',
  rateLimit: {
    windowLimit: 10,
    windowSize: 180,
    aggregateBy: ['ip', 'domain'],
  },
};

function requestError(errorCode: typeof API_REQUEST_ERROR_CODES[keyof typeof API_REQUEST_ERROR_CODES]) {
  const response = apiRequestErrorResponse(errorCode);
  return json(response.statusCode, response.body);
}

async function handleLoginRequest(
  httpMethod: string | undefined,
  headers: NetlifyFunctionHeaders | null | undefined,
  readBody: LoginBodyReader,
): Promise<NetlifyJsonResponse> {
  if (httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' }, { Allow: 'POST' });
  }
  if (!isTrustedLoginOrigin(headers)) {
    return json(403, { error: 'Cross-site request blocked' });
  }

  const ip = getClientIp(headers);
  const { allowed, retryAfterSeconds } = checkRateLimit(`login:${ip}`, LOGIN_RATE_LIMIT);
  if (!allowed) {
    return json(429, { error: 'Too many requests. Please try again later.' }, { 'Retry-After': String(retryAfterSeconds) });
  }

  const bodyResult = await readBody();
  if (bodyResult.status === 'too_large') {
    return requestError(API_REQUEST_ERROR_CODES.REQUEST_TOO_LARGE);
  }
  if (bodyResult.status === 'invalid_encoding') {
    return requestError(API_REQUEST_ERROR_CODES.INVALID_REQUEST_BODY);
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyResult.body || '{}');
  } catch {
    return requestError(API_REQUEST_ERROR_CODES.INVALID_REQUEST_BODY);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return requestError(API_REQUEST_ERROR_CODES.INVALID_REQUEST_BODY);
  }

  if (!checkPassword((body as { password?: unknown }).password)) {
    return json(401, { error: 'Incorrect password' });
  }

  return json(200, { ok: true }, { 'Set-Cookie': buildSessionCookie(createSessionToken(), { secure: true }) });
}

async function runLoginFunction(event: NetlifyFunctionEvent): Promise<NetlifyJsonResponse> {
  return handleLoginRequest(event.httpMethod, event.headers, async () => {
    const body = event.body || '{}';
    return Buffer.byteLength(body, 'utf8') > MAX_API_JSON_BODY_BYTES
      ? { status: 'too_large' }
      : { status: 'ok', body };
  });
}

async function runLoginRequest(request: Request): Promise<Response> {
  const response = await handleLoginRequest(
    request.method,
    Object.fromEntries(request.headers.entries()),
    () => readRequestTextCapped(request),
  );
  return netlifyJsonToResponse(response);
}

export default async function loginHandler(request: Request): Promise<Response> {
  return runLoginRequest(request);
}

export {
  runLoginFunction,
  runLoginRequest,
};
export type { LoginFunctionConfig };
