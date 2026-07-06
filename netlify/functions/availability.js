const { classifyQuery } = require('../../lib/classify');
const { checkDomainAvailability } = require('../../lib/availability');
const { isAuthenticatedFromCookieHeader } = require('../../lib/auth');
const { checkRateLimit, getClientIp, API_RATE_LIMIT } = require('../../lib/rate-limit');

function json(statusCode, body, extraHeaders) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  const ip = getClientIp(event.headers);
  const { allowed, retryAfterSeconds } = checkRateLimit(`api:${ip}`, API_RATE_LIMIT);
  if (!allowed) {
    return json(429, { error: 'Too many requests. Please try again later.' }, { 'Retry-After': String(retryAfterSeconds) });
  }

  if (!isAuthenticatedFromCookieHeader(event.headers && event.headers.cookie)) {
    return json(401, { error: 'Authentication required' });
  }

  const q = ((event.queryStringParameters && event.queryStringParameters.q) || '').trim();
  if (!q) return json(400, { error: 'Missing query parameter "q"' });

  try {
    const { type, value } = classifyQuery(q);
    if (type !== 'domain') {
      return json(200, { applicable: false, type });
    }

    const params = event.queryStringParameters || {};
    const fast = params.fast === '1' || params.fast === 'true';
    const result = await checkDomainAvailability(value, { fast });
    return json(200, { applicable: true, domain: value, ...result });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
