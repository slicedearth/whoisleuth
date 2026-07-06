const { searchCertificateTransparency } = require('../../lib/ct-search');
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
    const result = await searchCertificateTransparency(q);
    return json(200, { keyword: q, ...result });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
