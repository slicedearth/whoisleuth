import { isAuthenticatedFromCookieHeader } from '../../lib/auth.js';
import { capabilityReport } from '../../lib/capabilities.js';
import { json } from '../../lib/http.mts';
import type { NetlifyFunctionHandler } from '../../lib/netlify-function-types.mts';

const handler: NetlifyFunctionHandler = async (event) => {
  if (!isAuthenticatedFromCookieHeader(event.headers && event.headers.cookie)) {
    return json(401, { error: 'Authentication required' });
  }
  return json(200, capabilityReport('netlify'));
};

export { handler };
