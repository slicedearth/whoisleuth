import { isAuthenticatedFromCookieHeader } from '../../lib/auth.mts';
import { capabilityReport } from '../../lib/capabilities.mts';
import { json, withNetlifyApiErrorBoundary } from '../../lib/http.mts';
import type { NetlifyFunctionHandler } from '../../lib/netlify-function-types.mts';

const handleCapabilities: NetlifyFunctionHandler = async (event) => {
  if (!isAuthenticatedFromCookieHeader(event.headers && event.headers.cookie)) {
    return json(401, { error: 'Authentication required' });
  }
  return json(200, capabilityReport('netlify'));
};

const handler = withNetlifyApiErrorBoundary(handleCapabilities);

export { handler };
