import { buildClearCookie, isTrustedOrigin, isAuthenticatedFromCookieHeader } from '../../lib/auth.js';
import { json } from '../../lib/http.mts';
import type { NetlifyFunctionHandler } from '../../lib/netlify-function-types.mts';

const handler: NetlifyFunctionHandler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }
  if (!isAuthenticatedFromCookieHeader(event.headers && event.headers.cookie)) {
    return json(401, { error: 'Authentication required' });
  }
  if (!isTrustedOrigin(event.headers)) {
    return json(403, { error: 'Cross-site request blocked' });
  }

  return json(200, { ok: true }, { 'Set-Cookie': buildClearCookie({ secure: true }) });
};

export { handler };
