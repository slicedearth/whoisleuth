import { isAuthenticatedFromCookieHeader } from '../../lib/auth.js';
import { json } from '../../lib/http.mts';
import type { NetlifyFunctionHandler } from '../../lib/netlify-function-types.mts';

const handler: NetlifyFunctionHandler = async (event) =>
  json(200, { authenticated: isAuthenticatedFromCookieHeader(event.headers && event.headers.cookie) });

export { handler };
