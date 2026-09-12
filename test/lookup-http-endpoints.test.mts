import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import express from 'express';
import type { Server } from 'node:http';
import { deferred } from './deferred.mts';
import { createLookupHandler, type LookupHandlerDependencies } from '../netlify/functions/lookup.mts';
import { registerNetworkApiRoutes, apiErrorHandler, type NetworkRouteServices } from '../server.mts';
import { buildSessionCookie, createSessionToken } from '../lib/auth.mts';
import { defaultOperationBudget, operationBudgetTargetFor } from '../lib/operation-budget.mts';
import { requestLookup } from '../lib/lookup-request.mts';
import { LOOKUP_PROGRESS_CONTENT_TYPE } from '../lib/lookup-progress-http.mts';
import { plannedLookupProgressSources } from '../lib/lookup-source-progress.mts';
import { MAX_LOOKUP_SELECTION_BODY_BYTES } from '../lib/lookup-selected-request.mts';

process.env.SITE_PASSWORD ||= 'fixture-stream-password';
process.env.SESSION_SECRET ||= 'fixture-stream-session-key-long-enough';
const RESULT = { query: 'example.test', type: 'domain', registrableDomain: 'example.test', rdap: {}, whois: {},
  availability: { applicable: true, state: 'unknown' }, diagnostics: { version: 8, rdap: { status: 'unsupported' }, whois: { status: 'partial' }, availability: { status: 'complete' } } };

async function fixture(kind: 'express' | 'native', run: LookupHandlerDependencies['runUnifiedLookup']) {
  const cookie = buildSessionCookie(createSessionToken(), { secure: true }).split(';')[0]!;
  const dependencies: LookupHandlerDependencies = { runUnifiedLookup: run,
    createLookupHttpResponse: (() => RESULT) as LookupHandlerDependencies['createLookupHttpResponse'] };
  const pending: Promise<unknown>[] = [];
  const releases: Promise<void>[] = [];
  const acquire = defaultOperationBudget.acquire;
  const observedAcquire = mock.method(defaultOperationBudget, 'acquire', async (...args: Parameters<typeof acquire>) => {
    const lease = await acquire(...args);
    if (!lease.allowed) return lease;
    const released = deferred<void>(); releases.push(released.promise);
    return { ...lease, async release() { try { await lease.release(); } finally { released.resolve(); } } };
  });
  const handler = createLookupHandler(dependencies);
  let server: Server | undefined;
  let origin = 'https://console.example';
  if (kind === 'express') {
    const app = express();
    registerNetworkApiRoutes(app, dependencies as NetworkRouteServices);
    app.use('/api', apiErrorHandler);
    server = await new Promise<Server>((resolve, reject) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); listening.once('error', reject);
    });
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    origin = `http://127.0.0.1:${address.port}`;
  }
  return {
    async response(search = '', init: RequestInit = {}, lifecycle = true) {
      const headers = new Headers({ cookie, host: new URL(origin).host, 'sec-fetch-site': 'same-origin', Accept: LOOKUP_PROGRESS_CONTENT_TYPE });
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
      const url = `${origin}/api/lookup?q=example.test${search}`;
      return kind === 'express' ? fetch(url, { ...init, headers })
        : handler(new Request(url, { ...init, headers }), lifecycle ? { waitUntil: promise => { pending.push(promise); } } : undefined);
    },
    async close() {
      await Promise.all(pending);
      await Promise.all(releases);
      observedAcquire.mock.restore();
      if (server) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); }
    },
  };
}
async function active() {
  const target = operationBudgetTargetFor('lookup');
  assert.ok(target);
  return (await defaultOperationBudget.status()).find(row => row.id === target.operationClass)?.active;
}

for (const kind of ['express', 'native'] as const) {
  test(`${kind} delivers a real source frame before the held final response and retains its lease`, async () => {
    const release = deferred<void>(); const seen = deferred<void>(); let calls = 0;
    const server = await fixture(kind, async (classified, options) => {
      calls++;
      const sources = plannedLookupProgressSources(classified, options);
      options?.onSourceSettled?.({ source: sources[0]!, state: 'partial', complete: false, truncated: false, fragment: { status: 'partial' } });
      await release.promise;
      for (const source of sources.slice(1)) options?.onSourceSettled?.({ source, state: 'unsupported', complete: false, truncated: false, fragment: { status: 'unsupported' } });
      return {} as Awaited<ReturnType<LookupHandlerDependencies['runUnifiedLookup']>>;
    });
    try {
      let finished = false;
      const response = await server.response();
      assert.match(response.headers.get('content-type') ?? '', /application\/x-ndjson/u);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const result = requestLookup('/api/lookup', { fetchImpl: async () => response, onProgress: update => {
        if (update.snapshot?.settledSources.length === 1) seen.resolve();
      } }).then(value => { finished = true; return value; });
      await seen.promise; assert.equal(finished, false); assert.equal(await active(), 1);
      release.resolve();
      assert.deepEqual(await result, { ok: true, value: RESULT });
      assert.equal(calls, 1);
    } finally { release.resolve(); await server.close(); }
    assert.equal(await active(), 0);
  });

  test(`${kind} cancellation discards the response but does not release an unfinished collector`, async () => {
    const release = deferred<void>(); const signalled = deferred<void>(); const seen = deferred<void>();
    const server = await fixture(kind, async (_classified, options) => {
      options?.signal?.addEventListener('abort', () => signalled.resolve(), { once: true });
      options?.onSourceSettled?.({ source: 'rdap', state: 'partial', complete: false, truncated: false, fragment: { status: 'partial' } });
      await release.promise;
      return {} as Awaited<ReturnType<LookupHandlerDependencies['runUnifiedLookup']>>;
    });
    try {
      const controller = new AbortController();
      const result = requestLookup('/api/lookup', { signal: controller.signal, fetchImpl: () => server.response(),
        onProgress: update => { if (update.snapshot?.settledSources.length) seen.resolve(); } });
      await seen.promise; controller.abort();
      const cancelled = await result;
      assert.equal(cancelled.ok, false); if (!cancelled.ok) assert.equal(cancelled.kind, 'cancelled');
      await signalled.promise; assert.equal(await active(), 1);
    } finally { release.resolve(); await server.close(); }
    assert.equal(await active(), 0);
  });

  test(`${kind} preserves buffered modes and rejects unauthorised, cross-site and over-bound requests before collection`, async () => {
    let calls = 0;
    const server = await fixture(kind, async () => { calls++; return {} as Awaited<ReturnType<LookupHandlerDependencies['runUnifiedLookup']>>; });
    try {
      for (const mode of ['&fast=1', '&compact=true']) {
        const response = await server.response(mode);
        assert.match(response.headers.get('content-type') ?? '', /application\/json/u);
        assert.deepEqual(await response.json(), RESULT);
      }
      for (const accept of ['application/json', 'application/x-ndjson;q=0']) {
        const response = await server.response('', { headers: { Accept: accept } });
        assert.match(response.headers.get('content-type') ?? '', /application\/json/u); await response.arrayBuffer();
      }
      assert.equal(calls, 4);
      const cases: readonly [RequestInit, number][] = [
        [{ headers: { cookie: '' } }, 401],
        [{ headers: { 'sec-fetch-site': 'cross-site' } }, 403],
        [{ method: 'POST', headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' }, body: '{}' }, 415],
        [{ method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(MAX_LOOKUP_SELECTION_BODY_BYTES + 1) }, 413],
        [{ method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"url":"https://other.test/"}' }, 400],
      ];
      for (const [init, status] of cases) { const response = await server.response('', init); assert.equal(response.status, status); await response.arrayBuffer(); }
      assert.equal(calls, 4);
      if (kind === 'native') {
        const response = await server.response('', {}, false);
        assert.match(response.headers.get('content-type') ?? '', /application\/json/u); await response.arrayBuffer();
      }
    } finally { await server.close(); }
  });
}
