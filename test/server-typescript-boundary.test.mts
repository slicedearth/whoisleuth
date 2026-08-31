import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as runtime from '../server.mts';

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

test('every authenticated network GET is rate-limited before authentication and admission', () => {
  const source = readFileSync(fileURLToPath(new URL('../server.mts', import.meta.url)), 'utf8');
  for (const route of [
    '/api/lookup',
    '/api/rdap',
    '/api/rdap-nameserver-search',
    '/api/whois',
    '/api/availability',
    '/api/ct-search',
    '/api/domain-posture',
  ]) {
    assert.match(
      source,
      new RegExp(`target\\.get\\('${route}', apiRateLimit, requireAuth, requireNetworkRequestAdmission, requireFeature\\(`, 'u'),
      `${route} must retain rate limiting before authenticated network admission`,
    );
  }
  assert.match(source, /app\.get\(routePath, prerenderedHtmlRateLimit,/u);
  assert.match(source, /app\.post\('\/api\/contact-route', contactRouteRateLimit,/u);
});
