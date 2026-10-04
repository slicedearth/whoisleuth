import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import express from 'express';
import type { Server } from 'node:http';
import { DOMAIN_FEED_BODY_BYTES } from '../lib/server/domain-feed-config.mts';
import { executeDomainFeedOperation } from '../lib/server/domain-feed-client.mts';
import { API_RATE_LIMIT } from '../lib/rate-limit.mts';
import type { NetworkRouteServices } from '../server.mts';

const previous = { password: process.env.SITE_PASSWORD, secret: process.env.SESSION_SECRET,
  disabled: process.env.WHOISLEUTH_DISABLE_CERTIFICATE_TRANSPARENCY };
process.env.SITE_PASSWORD = 'test-only-secret';
process.env.SESSION_SECRET = 'test-only-session-signing-secret';
const { registerNetworkApiRoutes, apiErrorHandler } = await import('../server.mts');
const { buildSessionCookie, createSessionToken } = await import('../lib/auth.mts');
const { createDomainFeedHandler } = await import('../netlify/functions/domain-feed.mts');
const cookie = buildSessionCookie(createSessionToken(), { secure: false }).split(';')[0]!;
let server: Server;
let origin: string;
let calls = 0;
let aborted = false;
let waitStarted: (() => void) | null = null;
const execute: typeof executeDomainFeedOperation = async (operation, options) => {
  calls++;
  if (operation.operation === 'query' && operation.selection.terms.includes('wait')) {
    waitStarted?.();
    await new Promise<void>(resolve => { options?.signal?.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true }); });
  }
  return { status: 200, body: { enabled: false, feeds: [] } };
};
const handler = createDomainFeedHandler(execute);
before(async () => {
  const app = express();
  registerNetworkApiRoutes(app, { executeDomainFeedOperation: execute } as NetworkRouteServices);
  app.use('/api', apiErrorHandler);
  server = await new Promise<Server>((resolve, reject) => { const running = app.listen(0, '127.0.0.1', () => resolve(running)); running.once('error', reject); });
  const address = server.address(); assert.ok(address && typeof address !== 'string'); origin = `http://127.0.0.1:${address.port}`;
});
after(async () => {
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  for (const [key, value] of [['SITE_PASSWORD', previous.password], ['SESSION_SECRET', previous.secret],
    ['WHOISLEUTH_DISABLE_CERTIFICATE_TRANSPARENCY', previous.disabled]] as const) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
const netlifyRequest = (body: string, headers: Record<string, string> = {}, method = 'POST', signal?: AbortSignal) => new Request('https://console.example/api/domain-feed', {
  method, headers: { host: 'console.example', cookie, origin: 'https://console.example', 'content-type': 'application/json', ...headers },
  ...(method === 'POST' ? { body } : {}), ...(signal ? { signal } : {}),
});
const localRequest = (body: string, headers: Record<string, string> = {}, method = 'POST', signal?: AbortSignal) => fetch(`${origin}/api/domain-feed`, {
  method, headers: { cookie, origin, 'content-type': 'application/json', ...headers }, ...(method === 'POST' ? { body } : {}), ...(signal ? { signal } : {}),
});

test('both backend adapters require login and same-origin admission before calling service', async () => {
  const before = calls;
  assert.equal((await localRequest('{"operation":"status"}', { cookie: '' })).status, 401);
  assert.equal((await handler(netlifyRequest('{"operation":"status"}', { cookie: '' }))).status, 401);
  assert.equal((await localRequest('{"operation":"status"}', { origin: 'https://other.example' })).status, 403);
  assert.equal((await handler(netlifyRequest('{"operation":"status"}', { origin: 'https://other.example' }))).status, 403);
  assert.equal(calls, before);
});

test('both backend adapters share strict body, method, encoding and size rejection', async () => {
  const before = calls;
  for (const body of ['{', '{"operation":"refresh"}', '{"operation":"query","feedIds":["tif-mini"],"selection":{"brandProfileId":"private-profile"}}']) {
    assert.equal((await localRequest(body)).status, 400);
    assert.equal((await handler(netlifyRequest(body))).status, 400);
  }
  assert.equal((await localRequest('', {}, 'GET')).status, 405);
  assert.equal((await handler(netlifyRequest('', {}, 'GET'))).status, 405);
  const large = JSON.stringify({ operation: 'status', extra: 'x'.repeat(DOMAIN_FEED_BODY_BYTES) });
  assert.equal((await localRequest(large)).status, 413);
  assert.equal((await handler(netlifyRequest(large))).status, 413);
  assert.equal((await localRequest('{}', { 'content-encoding': 'gzip' })).status, 415);
  assert.equal((await handler(netlifyRequest('{}', { 'content-encoding': 'gzip' }))).status, 415);
  assert.equal(calls, before);
});

test('explicit feed admission is independent of the unrelated certificate-search feature switch', async () => {
  process.env.WHOISLEUTH_DISABLE_CERTIFICATE_TRANSPARENCY = '1';
  const body = '{"operation":"query","feedIds":["tif-mini"],"selection":{"terms":["brand"]}}';
  assert.equal((await localRequest(body)).status, 200);
  assert.equal((await handler(netlifyRequest(body))).status, 200);
});

test('shared request bound admits the supported maximum canonical host and term selection', async () => {
  const hosts = Array.from({ length: 200 }, (_, index) => `${String(index).padStart(3, '0')}${'a'.repeat(60)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(60)}`);
  const terms = Array.from({ length: 20 }, (_, index) => `${String(index).padStart(2, '0')}${'t'.repeat(78)}`);
  const body = JSON.stringify({ operation: 'query', feedIds: ['tif-mini'], selection: { hosts, terms } });
  assert.ok(Buffer.byteLength(body) > 50 * 1024); assert.ok(Buffer.byteLength(body) < DOMAIN_FEED_BODY_BYTES);
  assert.equal((await localRequest(body)).status, 200);
  assert.equal((await handler(netlifyRequest(body))).status, 200);
});

test('default connection reports disconnected without contacting any source through both adapters', async () => {
  const disconnected = createDomainFeedHandler((operation, options) => executeDomainFeedOperation(operation, { ...options, env: {},
    transport: async () => { throw new Error('Transport must not be reached.'); } }));
  const status = await disconnected(netlifyRequest('{"operation":"status"}'));
  assert.equal(status.status, 200); assert.deepEqual(await status.json(), { enabled: false, feeds: [] });
  assert.equal((await disconnected(netlifyRequest('{"operation":"query","feedIds":["tif-mini"],"selection":{"terms":["brand"]}}'))).status, 503);
});

test('native hosted adapter propagates request abort into its admitted service operation', async () => {
  const controller = new AbortController();
  const started = new Promise<void>(resolve => { waitStarted = resolve; });
  const running = handler(netlifyRequest('{"operation":"query","feedIds":["tif-mini"],"selection":{"terms":["wait"]}}', {}, 'POST', controller.signal));
  await started; controller.abort();
  await running; assert.equal(aborted, true);
});

test('Express feed routes reject a saturated client before authentication, parsing or service work', async t => {
  const previousProxy = process.env.TRUST_PROXY;
  process.env.TRUST_PROXY = '1';
  t.after(() => { if (previousProxy === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = previousProxy; });
  // A dedicated proxy identity keeps this saturated bucket out of other tests.
  const request = (body: string, headers: Record<string, string> = {}, method = 'POST') =>
    localRequest(body, { 'x-forwarded-for': '192.0.2.71', ...headers }, method);
  const admitted = await request('{"operation":"status"}');
  assert.equal(admitted.status, 200);
  await admitted.arrayBuffer();
  const method = await request('', {}, 'GET');
  assert.equal(method.status, 405);
  assert.equal(method.headers.get('allow'), 'POST');
  await method.arrayBuffer();
  const before = calls;

  let saturated = false;
  for (let attempt = 0; attempt <= API_RATE_LIMIT.limit; attempt++) {
    const response = await request('{}', { cookie: '' });
    await response.arrayBuffer();
    if (response.status === 429) { saturated = true; break; }
    assert.equal(response.status, 401);
  }
  assert.ok(saturated, 'The shared API request limit must reject the client.');

  for (const response of [
    await request('{"operation":"status"}'),
    await request('{', { cookie: '', origin: 'https://other.example', 'content-encoding': 'gzip' }),
    await request('', { cookie: '', origin: 'https://other.example' }, 'GET'),
  ]) {
    assert.equal(response.status, 429);
    const retryAfter = Number(response.headers.get('retry-after'));
    assert.ok(Number.isInteger(retryAfter) && retryAfter > 0 && retryAfter <= API_RATE_LIMIT.windowMs / 1000);
    assert.equal((await response.json() as { errorCode: string }).errorCode, 'RATE_LIMITED');
  }
  assert.equal(calls, before);
  const independent = await localRequest('{"operation":"status"}', { 'x-forwarded-for': '192.0.2.72' });
  assert.equal(independent.status, 200);
  await independent.arrayBuffer();
  assert.equal(calls, before + 1);
});
