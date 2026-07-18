import { checkPassword, createSessionToken, buildSessionCookie, isTrustedLoginOrigin } from '../../lib/auth.mts';
import { checkRateLimit, getClientIp, LOGIN_RATE_LIMIT } from '../../lib/rate-limit.mts';
import {
  API_REQUEST_ERROR_CODES,
  MAX_API_JSON_BODY_BYTES,
  apiRequestErrorResponse,
  json,
} from '../../lib/http.mts';
import type { NetlifyFunctionHandler } from '../../lib/netlify-function-types.mts';

const handler: NetlifyFunctionHandler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }
  if (!isTrustedLoginOrigin(event.headers)) {
    return json(403, { error: 'Cross-site request blocked' });
  }

  const ip = getClientIp(event.headers);
  const { allowed, retryAfterSeconds } = checkRateLimit(`login:${ip}`, LOGIN_RATE_LIMIT);
  if (!allowed) {
    return json(429, { error: 'Too many requests. Please try again later.' }, { 'Retry-After': String(retryAfterSeconds) });
  }

  const bodyText = event.body || '{}';
  if (Buffer.byteLength(bodyText, 'utf8') > MAX_API_JSON_BODY_BYTES) {
    const response = apiRequestErrorResponse(API_REQUEST_ERROR_CODES.REQUEST_TOO_LARGE);
    return json(response.statusCode, response.body);
  }

  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    const response = apiRequestErrorResponse(API_REQUEST_ERROR_CODES.INVALID_REQUEST_BODY);
    return json(response.statusCode, response.body);
  }

  if (!checkPassword(body.password)) {
    return json(401, { error: 'Incorrect password' });
  }

  return json(200, { ok: true }, { 'Set-Cookie': buildSessionCookie(createSessionToken(), { secure: true }) });
};

export { handler };
