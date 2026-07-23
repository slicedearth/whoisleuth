import { isAuthenticatedFromCookieHeader } from '../../lib/auth.mts';
import { json, withNetlifyApiErrorBoundary } from '../../lib/http.mts';
import type { NetlifyFunctionHandler } from '../../lib/netlify-function-types.mts';

const handleSession: NetlifyFunctionHandler = async (event) =>
  json(200, { authenticated: isAuthenticatedFromCookieHeader(event.headers && event.headers.cookie) });

const handler = withNetlifyApiErrorBoundary(handleSession);

export { handler };
