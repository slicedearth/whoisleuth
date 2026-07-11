const { classifyQuery } = require('../../lib/classify');
const { fetchRdapRecord } = require('../../lib/rdap');
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

  const q = ((event.queryStringParameters && event.queryStringParameters.q) || '').trim();
  if (!q) return json(400, { error: 'Missing query parameter "q"' });

  let classified;
  try {
    classified = classifyQuery(q);
  } catch (err) {
    return json(400, { error: err.message });
  }

  try {
    const record = await fetchRdapRecord(classified.type, classified.value);
    if (!record) {
      return json(404, { error: `No RDAP registry found for "${q}" via IANA bootstrap` });
    }

    return json(200, {
      query: q,
      type: classified.type,
      inputHostname: classified.inputHostname,
      registrableDomain: classified.registrableDomain,
      ...record,
    });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
