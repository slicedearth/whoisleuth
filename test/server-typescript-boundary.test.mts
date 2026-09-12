import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as runtime from '../server.mts';
import { API_RATE_LIMIT } from '../lib/rate-limit.mts';

test('the self-hosted TypeScript runtime can load without opening a listener', () => {
  assert.equal(typeof runtime.app, 'function');
  assert.equal(typeof runtime.startServer, 'function');
  assert.equal(typeof runtime.requireAuth, 'function');
  assert.equal(typeof runtime.requireFeature, 'function');
  assert.equal(typeof runtime.requireNetworkRequestAdmission, 'function');
});

test('the self-hosted network admission blocks cross-site and metadata-free requests', () => {
  let status = 0;
  let payload: unknown;
  let nextCalls = 0;
  const response = {
    status(value: number) { status = value; return this; },
    json(value: unknown) { payload = value; return this; },
    setHeader() { return this; },
    redirect() { return this; },
  };
  runtime.requireNetworkRequestAdmission(
    { headers: { host: 'example.com', 'sec-fetch-site': 'cross-site' }, protocol: 'https', query: {}, path: '/api/lookup' },
    response,
    () => { nextCalls += 1; },
  );
  assert.equal(status, 403);
  assert.deepEqual(payload, {
    error: 'Cross-site network request blocked',
    errorCode: 'CROSS_SITE_REQUEST_BLOCKED',
  });
  runtime.requireNetworkRequestAdmission(
    { headers: { host: 'app.example.test', 'sec-fetch-site': 'same-site' }, protocol: 'https', query: {}, path: '/api/lookup' },
    response,
    () => { nextCalls += 1; },
  );
  assert.equal(status, 403);
  assert.equal(nextCalls, 0);
  runtime.requireNetworkRequestAdmission(
    { headers: { host: 'example.com' }, protocol: 'https', query: {}, path: '/api/lookup' },
    response,
    () => { nextCalls += 1; },
  );
  assert.equal(status, 403);
  assert.equal(nextCalls, 0);
  runtime.requireNetworkRequestAdmission(
    { headers: { host: 'example.com', 'sec-fetch-site': 'same-origin' }, protocol: 'https', query: {}, path: '/api/lookup' },
    response,
    () => { nextCalls += 1; },
  );
  assert.equal(nextCalls, 1);
});

test('every authenticated network route rate-limits requests before rejecting missing authentication', async () => {
  type Request = Parameters<typeof runtime.requireAuth>[0];
  type Response = Parameters<typeof runtime.requireAuth>[1];
  type Handler = (request: Request, response: Response, next: () => void) => unknown;
  const registered = new Map<string, Handler[]>();
  runtime.registerNetworkApiRoutes({
    get(path: string, ...handlers: Handler[]) { registered.set(`GET ${path}`, handlers); },
    post(path: string, ...handlers: Handler[]) { registered.set(`POST ${path}`, handlers); },
  } as unknown as Parameters<typeof runtime.registerNetworkApiRoutes>[0]);
  const routes = ['GET /api/lookup', 'POST /api/lookup', 'GET /api/rdap', 'GET /api/rdap-nameserver-search',
    'GET /api/whois', 'GET /api/availability', 'GET /api/ct-search', 'GET /api/domain-posture'];
  for (const [routeIndex, route] of routes.entries()) {
    const handlers = registered.get(route); assert.ok(handlers, route);
    const request: Request = { headers: { host: 'console.example', 'sec-fetch-site': 'cross-site' },
      socket: { remoteAddress: `192.0.2.${routeIndex + 1}` }, protocol: 'https', path: route.split(' ')[1]!,
      // Invalid input is an additional safeguard against accidental collection if a guard regresses.
      query: { q: 'fixture invalid query' }, method: route.split(' ')[0]!,
    };
    for (let index = 0; index <= API_RATE_LIMIT.limit; index++) {
      let status = 0; let body: unknown; let retryAfter: unknown;
      const response: Response = { status(value) { status = value; return this; }, json(value) { body = value; },
        setHeader(key, value) { if (key.toLowerCase() === 'retry-after') retryAfter = value; }, redirect() {},
      };
      async function dispatch(at: number): Promise<void> {
        const handler = handlers![at]; assert.ok(handler, `${route} must answer through its guards`);
        let next: Promise<void> | undefined;
        await handler(request, response, () => { next = dispatch(at + 1); });
        await next;
      }
      await dispatch(0);
      assert.equal(status, index < API_RATE_LIMIT.limit ? 401 : 429, route);
      assert.equal((body as { errorCode?: unknown }).errorCode, index < API_RATE_LIMIT.limit ? 'AUTH_REQUIRED' : 'RATE_LIMITED');
      if (index === API_RATE_LIMIT.limit) assert.ok(Number(retryAfter) > 0);
    }
  }
});

test('public HTML and contact routes retain their separate bounded guards', () => {
  const source = readFileSync(fileURLToPath(new URL('../server.mts', import.meta.url)), 'utf8');
  assert.match(source, /app\.get\(routePath, prerenderedHtmlRateLimit,/u);
  assert.match(source, /app\.post\('\/api\/contact-route', contactRouteRateLimit,/u);
});
