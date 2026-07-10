const { classifyQuery } = require('../../lib/classify');
const { checkDomainPosture, normalizeAuditDomain, normalizeDkimSelectors } = require('../../lib/domain-posture');
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
  try {
    const { type, value } = classifyQuery(q);
    if (type !== 'domain') return json(400, { error: 'Domain posture audits only support domain names.' });
    const domain = normalizeAuditDomain(value);
    if (!domain) return json(400, { error: 'Invalid domain name for posture audit.' });
    const selectors = normalizeDkimSelectors(String(params.selectors || '').split(','));
    return json(200, await checkDomainPosture(domain, { dkimSelectors: selectors }));
  } catch (err) {
    return json(500, { error: err.message });
  }
};
