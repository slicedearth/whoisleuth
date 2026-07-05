const { classifyQuery } = require('../../lib/classify');
const { buildWhoisChain, parseWhoisChain } = require('../../lib/whois');
const { isAuthenticatedFromCookieHeader } = require('../../lib/auth');

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (!isAuthenticatedFromCookieHeader(event.headers && event.headers.cookie)) {
    return json(401, { error: 'Authentication required' });
  }

  const q = ((event.queryStringParameters && event.queryStringParameters.q) || '').trim();
  if (!q) return json(400, { error: 'Missing query parameter "q"' });

  try {
    const { type, value } = classifyQuery(q);
    const chain = await buildWhoisChain(value);
    return json(200, { query: q, type, chain, parsed: parseWhoisChain(chain) });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
