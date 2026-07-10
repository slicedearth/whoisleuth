const { buildClearCookie, isTrustedOrigin } = require('../../lib/auth');
const { json } = require('../../lib/http');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }
  if (!isTrustedOrigin(event.headers)) {
    return json(403, { error: 'Cross-site request blocked' });
  }

  return json(200, { ok: true }, { 'Set-Cookie': buildClearCookie({ secure: true }) });
};
