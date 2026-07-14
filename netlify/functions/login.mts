import { checkPassword, createSessionToken, buildSessionCookie, isTrustedLoginOrigin } from '../../lib/auth.mts';
import { checkRateLimit, getClientIp, LOGIN_RATE_LIMIT } from '../../lib/rate-limit.mts';
import { json } from '../../lib/http.mts';
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

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid request body' });
  }

  if (!checkPassword(body.password)) {
    return json(401, { error: 'Incorrect password' });
  }

  return json(200, { ok: true }, { 'Set-Cookie': buildSessionCookie(createSessionToken(), { secure: true }) });
};

export { handler };
