// Public contact-route handoff. The function reveals one configured role
// address only after same-origin submission and successful challenge
// verification. It never accepts a subject or message body.

import { isTrustedOrigin } from '../../lib/auth.mts';
import {
  MAX_CONTACT_ROUTE_BODY_BYTES,
  contactRoutePublicConfig,
  parseContactRouteBody,
  verifyContactRoute,
} from '../../lib/contact-route.mts';
import {
  json,
  netlifyJsonToResponse,
  readRequestTextCapped,
  withNetlifyFetchApiErrorBoundary,
} from '../../lib/http.mts';
import { checkContactRouteRateLimit, getClientIp } from '../../lib/rate-limit.mts';

type ContactRouteFunctionConfig = {
  path: string;
  rateLimit: {
    windowLimit: number;
    windowSize: number;
    aggregateBy: ['ip', 'domain'];
  };
};

// Keep literals here for Netlify's static configuration analysis.
export const config: ContactRouteFunctionConfig = {
  path: '/api/contact-route',
  rateLimit: {
    windowLimit: 60,
    windowSize: 600,
    aggregateBy: ['ip', 'domain'],
  },
};

async function runContactRouteRequest(request: Request): Promise<Response> {
  if (request.method === 'GET') {
    return netlifyJsonToResponse(json(200, contactRoutePublicConfig()));
  }
  if (request.method !== 'POST') {
    return netlifyJsonToResponse(json(405, { error: 'Method not allowed' }, { Allow: 'GET, POST' }));
  }

  const headers = Object.fromEntries(request.headers.entries());
  if (!isTrustedOrigin(headers, { protocol: new URL(request.url).protocol })) {
    return netlifyJsonToResponse(json(403, { error: 'Cross-site request blocked' }));
  }
  const rate = checkContactRouteRateLimit(getClientIp(headers));
  if (!rate.allowed) {
    return netlifyJsonToResponse(json(
      429,
      { error: 'Too many requests. Please try again later.' },
      { 'Retry-After': String(rate.retryAfterSeconds) },
    ));
  }

  const bodyResult = await readRequestTextCapped(request, MAX_CONTACT_ROUTE_BODY_BYTES);
  if (bodyResult.status === 'too_large') {
    return netlifyJsonToResponse(json(413, { error: 'Request body is too large' }));
  }
  if (bodyResult.status === 'invalid_encoding') {
    return netlifyJsonToResponse(json(400, { error: 'Invalid request body' }));
  }
  if (bodyResult.status === 'timed_out' || bodyResult.status === 'aborted') {
    return netlifyJsonToResponse(json(408, { error: 'Request body read timed out' }));
  }
  let body: unknown;
  try {
    body = JSON.parse(bodyResult.body || '{}');
  } catch {
    return netlifyJsonToResponse(json(400, { error: 'Invalid request body' }));
  }
  const parsed = parseContactRouteBody(body);
  if (!parsed) {
    return netlifyJsonToResponse(json(400, { error: 'Invalid request body' }));
  }

  const result = await verifyContactRoute(parsed.category, parsed.token);
  if (result.status === 'ok') {
    return netlifyJsonToResponse(json(200, { category: result.category, route: result.route }));
  }
  if (result.status === 'unavailable') {
    return netlifyJsonToResponse(json(503, { error: 'Contact route is not configured' }));
  }
  return netlifyJsonToResponse(json(
    result.status === 'invalid_request' ? 400 : 403,
    { error: result.status === 'invalid_request' ? 'Invalid request body' : 'Contact verification failed' },
  ));
}

const handleContactRouteRequest = withNetlifyFetchApiErrorBoundary(runContactRouteRequest);

export default async function contactRouteHandler(request: Request): Promise<Response> {
  return handleContactRouteRequest(request);
}

export { runContactRouteRequest };
export type { ContactRouteFunctionConfig };
