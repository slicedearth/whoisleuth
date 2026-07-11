const { classifyQuery } = require('../../lib/classify');
const { runUnifiedLookup } = require('../../lib/lookup');
const { isAuthenticatedFromCookieHeader } = require('../../lib/auth');
const { checkRateLimit, getClientIp, API_RATE_LIMIT } = require('../../lib/rate-limit');
const { json } = require('../../lib/http');

exports.handler = async (event) => {
  const ip = getClientIp(event.headers);
  const { allowed, retryAfterSeconds } = checkRateLimit(`api:${ip}`, API_RATE_LIMIT);
  if (!allowed) {
    return json(429, { error: 'Too many requests. Please try again later.' }, { 'Retry-After': String(retryAfterSeconds) });
  }

  if (!isAuthenticatedFromCookieHeader(event.headers && event.headers.cookie)) {
    return json(401, { error: 'Authentication required' });
  }

  const params = event.queryStringParameters || {};
  const q = (params.q || '').trim();
  if (!q) return json(400, { error: 'Missing query parameter "q"' });

  let classified;
  try {
    classified = classifyQuery(q);
  } catch (err) {
    return json(400, { error: err.message });
  }

  try {
    const fast = params.fast === '1' || params.fast === 'true';
    const result = await runUnifiedLookup(classified, { fast });
    return json(200, {
      query: q,
      type: classified.type,
      inputHostname: classified.inputHostname,
      registrableDomain: classified.registrableDomain,
      isSubdomain: classified.isSubdomain,
      ...result,
    });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
