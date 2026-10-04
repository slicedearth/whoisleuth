import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, open, readdir, rm, stat, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { normalizeDomainFeedSelection, normalizeDomainFeedReview, buildDomainFeedReview } from '../packages/monitoring/domain-feed.mts';
import { domainFeedConnection, domainFeedServiceConfiguration, acceptsDomainFeedBearer, DOMAIN_FEED_RESPONSE_BYTES, DOMAIN_FEED_BODY_BYTES,
  DOMAIN_FEED_SERVICE_LIMITATIONS, domainFeedResultAllocation } from '../lib/server/domain-feed-config.mts';
import { refreshDomainFeedCache, queryDomainFeedCache, domainFeedCacheStatus, prepareDomainFeedCache } from '../lib/server/domain-feed-cache.mts';
import { startDomainFeedService, executeDomainFeedWorker } from '../lib/server/domain-feed-service.mts';
import { parseDomainFeedOperation, executeDomainFeedOperation, validateDomainFeedReply } from '../lib/server/domain-feed-client.mts';

const TOKEN = 'fixture'.repeat(8);
const NOW = Date.parse('2026-10-04T00:00:00.000Z');
const FEED = 'tif-mini';
const selection = normalizeDomainFeedSelection({ hosts: ['exact.example'], terms: ['brand'] });
const encode = (value: string) => new TextEncoder().encode(value);
const feedResponse = (text: string, headers: Record<string, string> = {}) => new Response(text, { headers: { 'content-type': 'text/plain', ...headers } });
const staging = (directory: string) => path.join(directory, `${FEED}.${randomUUID()}.pending.sqlite`);
async function temporary(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'domain-feed-fixture-'));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}
async function retain(directory: string, text = 'exact.example\nmybrand.example\nother.example\n') {
  return refreshDomainFeedCache({ directory, feedId: FEED, stagingFilename: staging(directory), now: () => NOW,
    fetch: async () => feedResponse(text, { etag: '"fixture-revision"', 'last-modified': 'Sun, 04 Oct 2026 00:00:00 GMT' }) });
}

test('website connection defaults off and requires explicit enable, safe fixed origin and strong token', () => {
  assert.equal(domainFeedConnection({}), null);
  const valid = { WHOISLEUTH_DOMAIN_FEED_ENABLED: '1', WHOISLEUTH_DOMAIN_FEED_URL: 'https://feed-service.example', WHOISLEUTH_DOMAIN_FEED_TOKEN: TOKEN };
  assert.equal(domainFeedConnection(valid)?.url, 'https://feed-service.example');
  assert.equal(domainFeedConnection({ ...valid, WHOISLEUTH_DOMAIN_FEED_URL: 'http://127.0.0.1:8787' })?.url, 'http://127.0.0.1:8787');
  for (const url of ['http://feed-service.example', 'http://localhost:8787', 'http://10.0.0.1:8787', 'https://feed-service.example:8443', 'https://user:pass@feed-service.example', 'https://feed-service.example/path', 'https://feed-service.example/?secret=value'])
    assert.equal(domainFeedConnection({ ...valid, WHOISLEUTH_DOMAIN_FEED_URL: url }), null);
  assert.equal(domainFeedConnection({ ...valid, WHOISLEUTH_DOMAIN_FEED_TOKEN: 'weak' }), null);
  assert.equal(domainFeedConnection({ ...valid, WHOISLEUTH_DOMAIN_FEED_ACCESS_CLIENT_ID: 'fixture' }), null);
  assert.equal(domainFeedConnection({ ...valid, WHOISLEUTH_DOMAIN_FEED_ENABLED: true }), null);
  assert.throws(() => domainFeedServiceConfiguration({}), /configuration/u);
  assert.equal(acceptsDomainFeedBearer(`Bearer ${TOKEN}`, TOKEN), true);
  assert.equal(acceptsDomainFeedBearer(`Bearer ${TOKEN.slice(0, -1)}x`, TOKEN), false);
  assert.equal(acceptsDomainFeedBearer('Bearer weak', TOKEN), false);
});

test('backend disconnected status/query never invoke transport and request parser rejects arbitrary URLs and context', async () => {
  let requests = 0;
  const transport = async () => { requests++; throw new Error('No request expected.'); };
  assert.deepEqual(await executeDomainFeedOperation({ operation: 'status' }, { env: {}, transport }), { status: 200, body: { enabled: false, feeds: [] } });
  assert.equal((await executeDomainFeedOperation(parseDomainFeedOperation({ operation: 'query', feedIds: [FEED], selection: { terms: ['brand'] } }), { env: {}, transport })).status, 503);
  assert.equal(requests, 0);
  for (const value of [{ operation: 'refresh' }, { operation: 'query', feedIds: ['https://feed.example'], selection: {} },
    { operation: 'query', feedIds: [FEED], selection: { terms: ['brand'], brandProfileId: 'private-profile' } },
    { operation: 'query', feedIds: [FEED], selection: { terms: ['ab'] } }, { operation: 'query', feedIds: [FEED], selection: {} },
    { operation: 'status', url: 'https://feed.example' }]) assert.throws(() => parseDomainFeedOperation(value));
});

test('real SQLite ingestion atomically publishes full-file digest and bounded literal candidate projection', async () => temporary(async directory => {
  const text = '# Version: 2026.1004\n# Last modified: 04 Oct 2026 00:00 UTC\nexact.example\nmybrand.example\nother.example\n';
  await retain(directory, text);
  assert.deepEqual(await readdir(directory), [`${FEED}.sqlite`]);
  assert.equal((await stat(path.join(directory, `${FEED}.sqlite`))).mode & 0o077, 0);
  const status = await domainFeedCacheStatus(directory, FEED, NOW);
  assert.equal(status.cached, true); assert.equal(status.stale, false);
  assert.equal(status.metadata?.rows, 3); assert.equal(status.metadata?.acquiredAt, new Date(NOW).toISOString());
  const result = await queryDomainFeedCache(directory, FEED, selection, NOW);
  assert.equal(result.review?.revision, `sha256:${createHash('sha256').update(text).digest('hex')}`);
  assert.deepEqual(result.review?.matches.map(match => match.domain), ['exact.example', 'mybrand.example']);
  assert.equal(result.review?.matched, null); assert.equal(result.review?.omitted, null);
  assert.equal(result.review?.matches[0]?.candidate.sources[0]?.completeness, 'unknown');
  assert.ok(normalizeDomainFeedReview(result.review));
  const literal = await queryDomainFeedCache(directory, FEED, normalizeDomainFeedSelection({ terms: ['%._'] }), NOW);
  assert.equal(literal.review?.matches.length, 0);
}));

test('malformed refresh, redirect and aborted stream preserve last-good snapshot and remove owned staging', async () => temporary(async directory => {
  await retain(directory);
  const before = (await domainFeedCacheStatus(directory, FEED, NOW)).metadata?.revision;
  for (const response of [feedResponse(`${Array.from({ length: 256 }, (_, index) => `candidate-${index}.example`).join('\n')}\nhttps://bad.example/path`),
    new Response(null, { status: 302, headers: { location: 'https://other.example' } }), feedResponse('exact.example', { 'content-encoding': 'gzip' })]) {
    await assert.rejects(refreshDomainFeedCache({ directory, feedId: FEED, stagingFilename: staging(directory), fetch: async () => response }));
    assert.equal((await domainFeedCacheStatus(directory, FEED, NOW)).metadata?.revision, before);
  }
  const controller = new AbortController(); let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(encode('provisional.example\n')); }, cancel() { cancelled = true; } });
  const running = refreshDomainFeedCache({ directory, feedId: FEED, stagingFilename: staging(directory), signal: controller.signal,
    fetch: async () => { queueMicrotask(() => controller.abort()); return new Response(stream); } });
  await assert.rejects(running);
  assert.equal(cancelled, true);
  assert.equal((await domainFeedCacheStatus(directory, FEED, NOW)).metadata?.revision, before);
  assert.deepEqual(await readdir(directory), [`${FEED}.sqlite`]);
}));

test('conditional 304 updates source check time without replacing acquisition or publisher clocks', async () => temporary(async directory => {
  await retain(directory, '# Last modified: 01 Oct 2026 00:00 UTC\nexact.example\n');
  const before = await domainFeedCacheStatus(directory, FEED, NOW);
  let checked = false;
  await refreshDomainFeedCache({ directory, feedId: FEED, stagingFilename: staging(directory), now: () => NOW + 6000,
    fetch: async (_url, init) => { const headers = new Headers(init.headers); assert.equal(headers.get('if-none-match'), '"fixture-revision"');
      assert.ok(headers.get('if-modified-since')); checked = true; return new Response(null, { status: 304 }); } });
  const after = await domainFeedCacheStatus(directory, FEED, NOW + 6000);
  assert.equal(checked, true); assert.deepEqual(after.metadata, before.metadata);
  assert.equal(after.checkedAt, new Date(NOW + 6000).toISOString()); assert.equal(after.stale, true);
  assert.equal((await domainFeedCacheStatus(directory, FEED, NOW + 40 * 60 * 60 * 1000)).stale, true);
}));

test('completed acquisition clock follows a held scan and both acquisition/import clocks survive 304', async () => temporary(async directory => {
  let clock = NOW;
  let entered: (() => void) | null = null;
  let release: (() => void) | null = null;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  let first = true;
  const stream = new ReadableStream<Uint8Array>({ async pull(controller) {
    if (first) { first = false; controller.enqueue(encode('exact.example\n')); return; }
    entered!(); await held; controller.close();
  } });
  const refreshing = refreshDomainFeedCache({ directory, feedId: FEED, stagingFilename: staging(directory), now: () => clock,
    fetch: async () => new Response(stream, { headers: { etag: '"held-revision"' } }) });
  await started;
  // The reader has requested its held tail, so the scan-start clock is fixed.
  clock += 60_000; release!(); await refreshing;
  const before = await domainFeedCacheStatus(directory, FEED, clock);
  assert.equal(before.metadata?.importedAt, new Date(NOW).toISOString());
  assert.equal(before.metadata?.acquiredAt, new Date(NOW + 60_000).toISOString());
  clock += 60_000;
  await refreshDomainFeedCache({ directory, feedId: FEED, stagingFilename: staging(directory), now: () => clock,
    fetch: async () => new Response(null, { status: 304 }) });
  const after = await domainFeedCacheStatus(directory, FEED, clock);
  assert.deepEqual(after.metadata, before.metadata);
  assert.equal(after.checkedAt, new Date(NOW + 120_000).toISOString());
}));

test('cache rejects symlink roots and oversized existing disk budget without following them', async () => temporary(async directory => {
  const link = `${directory}-link`;
  await symlink(directory, link);
  try { await assert.rejects(prepareDomainFeedCache(link), /private real directory/u); }
  finally { await rm(link); }
  const oversized = await open(path.join(directory, `${FEED}.sqlite`), 'wx', 0o600);
  try { await oversized.truncate(5 * 1024 * 1024 * 1024 + 1); }
  finally { await oversized.close(); }
  await assert.rejects(prepareDomainFeedCache(directory), /disk budget/u);
}));

test('real worker query retains bounded matches while startup deadline and pre-start abort terminate its owner', async () => temporary(async directory => {
  let produced = 0;
  const stream = new ReadableStream<Uint8Array>({ pull(controller) {
    if (produced >= 100_000) { controller.close(); return; }
    let text = '';
    for (let index = 0; index < 256; index++) text += `brand-${String(produced++).padStart(6, '0')}.example\n`;
    controller.enqueue(encode(text));
  } });
  await refreshDomainFeedCache({ directory, feedId: FEED, stagingFilename: staging(directory), now: () => NOW, fetch: async () => new Response(stream) });
  const result = await executeDomainFeedWorker({ directory, operation: 'query', feedIds: [FEED], selection }, new AbortController().signal, 5000) as { feeds: Array<{ review: { matches: unknown[]; truncated: boolean } }> };
  assert.equal(result.feeds[0]?.review.matches.length, 200); assert.equal(result.feeds[0]?.review.truncated, true);
  await assert.rejects(executeDomainFeedWorker({ directory, operation: 'query', feedIds: [FEED], selection }, new AbortController().signal, 1), /worker unavailable/u);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(executeDomainFeedWorker({ directory, operation: 'status', feedIds: [FEED] }, abort.signal, 5000));
}));

test('real loopback service authenticates, confines origins and exposes only status/query through own-backend client', async () => temporary(async directory => {
  await retain(directory);
  const service = await startDomainFeedService({ directory, token: TOKEN, feedIds: [FEED], automaticRefresh: false });
  try {
    const request = (route: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${service.origin}/${route}`, { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...headers }, body: JSON.stringify(body) });
    assert.equal((await request('status', {}, { authorization: 'Bearer wrong' })).status, 401);
    assert.equal((await request('status', {}, { origin: 'https://other.example' })).status, 403);
    const wrongHost = await new Promise<number>(resolve => {
      const outgoing = httpRequest(`${service.origin}/status`, { method: 'POST', headers: { host: 'other.example', authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' } }, response => { response.resume(); resolve(response.statusCode!); });
      outgoing.end('{}');
    });
    assert.equal(wrongHost, 403);
    assert.equal((await request('refresh', {})).status, 404);
    assert.equal((await request('query', { feedIds: ['nrd7'], selection: { terms: ['brand'] } })).status, 400);
    assert.equal((await request('query', { feedIds: [FEED], selection: { terms: ['brand'.repeat(4000)] } })).status, 400);
    assert.equal((await request('status', { extra: 'x'.repeat(DOMAIN_FEED_BODY_BYTES) })).status, 413);
    const env = { WHOISLEUTH_DOMAIN_FEED_ENABLED: '1', WHOISLEUTH_DOMAIN_FEED_URL: service.origin, WHOISLEUTH_DOMAIN_FEED_TOKEN: TOKEN };
    const status = await executeDomainFeedOperation({ operation: 'status' }, { env });
    assert.equal(status.status, 200); assert.equal((status.body as { feeds: Array<{ cached: boolean }> }).feeds[0]?.cached, true);
    const query = await executeDomainFeedOperation(parseDomainFeedOperation({ operation: 'query', feedIds: [FEED], selection: { hosts: ['exact.example'] } }), { env });
    assert.equal(query.status, 200); assert.ok((query.body as { feeds: Array<{ review: unknown }> }).feeds[0]?.review);
    assert.doesNotMatch(JSON.stringify(query.body), new RegExp(TOKEN, 'u'));
  } finally { await service.close(); }
}));

test('backend bounds replies, refuses redirect credential forwarding and propagates interruption', async () => {
  const env = { WHOISLEUTH_DOMAIN_FEED_ENABLED: '1', WHOISLEUTH_DOMAIN_FEED_URL: 'https://feed-service.example', WHOISLEUTH_DOMAIN_FEED_TOKEN: TOKEN,
    WHOISLEUTH_DOMAIN_FEED_ACCESS_CLIENT_ID: 'fixture-access-id', WHOISLEUTH_DOMAIN_FEED_ACCESS_CLIENT_SECRET: 'test-only-secret' };
  let calls = 0;
  const redirect = await executeDomainFeedOperation({ operation: 'status' }, { env, transport: async (_url, init) => {
    calls++; assert.equal(init.redirect, 'manual'); assert.equal(new Headers(init.headers).get('authorization'), `Bearer ${TOKEN}`);
    assert.equal(new Headers(init.headers).get('CF-Access-Client-Secret'), 'test-only-secret');
    return new Response(null, { status: 302, headers: { location: 'https://other.example/' } });
  } });
  assert.equal(calls, 1); assert.equal(redirect.status, 503);
  assert.equal((await executeDomainFeedOperation({ operation: 'status' }, { env, transport: async () => new Response(' '.repeat(DOMAIN_FEED_RESPONSE_BYTES + 1), { headers: { 'content-type': 'application/json' } }) })).status, 503);
  const controller = new AbortController(); let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/json' } });
  const running = executeDomainFeedOperation({ operation: 'status' }, { env, signal: controller.signal, transport: async (_url, init) => {
    assert.ok(init.signal); queueMicrotask(() => controller.abort()); return response;
  } });
  assert.equal((await running).status, 408); assert.equal(cancelled, true);
  assert.throws(() => validateDomainFeedReply({ enabled: true, feeds: [], secret: TOKEN }, { operation: 'status' }));
});

test('backend rejects Unicode-escaped bearer and gateway secret echoes in decoded status and query metadata', async () => {
  const accessSecret = 'test-only-secret';
  const env = { WHOISLEUTH_DOMAIN_FEED_ENABLED: '1', WHOISLEUTH_DOMAIN_FEED_URL: 'https://feed-service.example', WHOISLEUTH_DOMAIN_FEED_TOKEN: TOKEN,
    WHOISLEUTH_DOMAIN_FEED_ACCESS_CLIENT_ID: 'fixture-access-id', WHOISLEUTH_DOMAIN_FEED_ACCESS_CLIENT_SECRET: accessSecret };
  for (const secret of [TOKEN, accessSecret]) for (const kind of ['status', 'query'] as const) {
    const metadata = { feedId: FEED, revision: `sha256:${'a'.repeat(64)}`, importedAt: new Date(NOW).toISOString(), acquiredAt: new Date(NOW).toISOString(),
      declaredPublishedAt: null, declaredVersion: secret, bytes: 100, rows: 1 };
    const operation = kind === 'status' ? parseDomainFeedOperation({ operation: 'status' })
      : parseDomainFeedOperation({ operation: 'query', feedIds: [FEED], selection: { terms: ['brand'] } });
    const review = buildDomainFeedReview(metadata, normalizeDomainFeedSelection({ terms: ['brand'] }), ['brand.example'], { matched: null, omitted: null, truncated: false });
    const reply = kind === 'status'
      ? { enabled: true, feeds: [{ feedId: FEED, cached: true, stale: false, error: null, metadata, checkedAt: new Date(NOW).toISOString() }] }
      : { enabled: true, feeds: [{ feedId: FEED, stale: false, error: null, review }], limitations: DOMAIN_FEED_SERVICE_LIMITATIONS };
    // This remains an otherwise canonical reply; only JSON string spelling changes.
    assert.doesNotThrow(() => validateDomainFeedReply(reply, operation));
    const escaped = [...secret].map(character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
    const wire = JSON.stringify(reply).replace(secret, escaped);
    assert.equal(wire.includes(secret), false);
    const result = await executeDomainFeedOperation(operation, { env, transport: async () => new Response(wire, { headers: { 'content-type': 'application/json' } }) });
    assert.equal(result.status, 503);
    assert.deepEqual(result.body, { error: 'Optional domain feed service is unavailable.', errorCode: 'DOMAIN_FEED_UNAVAILABLE' });
    assert.equal(JSON.stringify(result.body).includes(secret), false);
  }
});

test('backend enforces shared per-feed allocation and aggregate result ceilings for canonical reviews', () => {
  const operation = parseDomainFeedOperation({ operation: 'query', feedIds: [FEED, 'nrd7'], selection: { terms: ['brand'] } });
  assert.equal(domainFeedResultAllocation(2), 100);
  const reply = (count: number) => ({ enabled: true, limitations: DOMAIN_FEED_SERVICE_LIMITATIONS,
    feeds: [FEED, 'nrd7'].map(feedId => ({ feedId, stale: false, error: null, review: buildDomainFeedReview({ feedId,
      revision: `sha256:${'b'.repeat(64)}`, importedAt: new Date(NOW).toISOString(), acquiredAt: new Date(NOW).toISOString(),
      declaredPublishedAt: null, declaredVersion: null, bytes: 4096, rows: 200 }, normalizeDomainFeedSelection({ terms: ['brand'] }),
    Array.from({ length: count }, (_, index) => `brand-${index}.example`), { matched: null, omitted: null, truncated: true }) })) });
  assert.throws(() => validateDomainFeedReply(reply(101), operation), /allocation/u);
  assert.doesNotThrow(() => validateDomainFeedReply(reply(100), operation));
});

test('loopback service enforces a shared rate and two-query concurrency ceiling', async () => temporary(async directory => {
  let entered = 0; let firstEntered: (() => void) | null = null; let release: (() => void) | null = null;
  const started = new Promise<void>(resolve => { firstEntered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const service = await startDomainFeedService({ directory, token: TOKEN, feedIds: [FEED], automaticRefresh: false,
    worker: async () => {
      if (++entered === 2) firstEntered!();
      if (entered <= 2) await held;
      return { enabled: true, feeds: [{ feedId: FEED, cached: false, metadata: null, checkedAt: null, stale: true, error: null }] };
    } });
  const post = () => fetch(`${service.origin}/status`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: '{}' });
  try {
    const first = post(), second = post(); await started;
    assert.equal((await post()).status, 429);
    release!(); assert.equal((await first).status, 200); assert.equal((await second).status, 200);
    let limited = 0;
    for (let index = 0; index < 60; index++) { const response = await post(); if (response.status === 429) limited++; }
    assert.equal(limited, 3);
  } finally { release!(); await service.close(); }
}));

test('disconnected queries retain admission slots until their workers finish', async () => temporary(async directory => {
  let entered = 0, aborted = 0;
  let release!: () => void, ready!: () => void, stopped!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const bothEntered = new Promise<void>(resolve => { ready = resolve; });
  const bothAborted = new Promise<void>(resolve => { stopped = resolve; });
  const service = await startDomainFeedService({ directory, token: TOKEN, feedIds: [FEED], automaticRefresh: false,
    worker: async (_task, signal) => {
      if (++entered === 2) ready();
      signal.addEventListener('abort', () => { if (++aborted === 2) stopped(); }, { once: true });
      await held;
      return { enabled: true, feeds: [] };
    } });
  const post = (signal?: AbortSignal) => fetch(`${service.origin}/status`, { method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: '{}', ...(signal ? { signal } : {}) });
  const controller = new AbortController();
  const requests = [post(controller.signal).catch(() => null), post(controller.signal).catch(() => null)];
  try {
    await bothEntered; controller.abort(); await bothAborted; await Promise.all(requests);
    assert.equal((await post()).status, 429);
    assert.equal(entered, 2);
  } finally { release(); await service.close(); }
}));

test('service refresh ownership prevents duplicate concurrent jobs and preserves an explicit failure state', async () => temporary(async directory => {
  let refreshes = 0; let release: (() => void) | null = null;
  let started: (() => void) | null = null;
  const workerStarted = new Promise<void>(resolve => { started = resolve; });
  const service = await startDomainFeedService({ directory, token: TOKEN, feedIds: [FEED], automaticRefresh: false,
    worker: async task => {
      if (task.operation === 'refresh') { refreshes++; started!(); await new Promise<void>(resolve => { release = resolve; }); throw new Error('Fixture failed refresh.'); }
      return { enabled: true, feeds: [{ feedId: FEED, cached: false, metadata: null, checkedAt: null, stale: true, error: null }] };
    } });
  try {
    const running = service.refresh(FEED); await workerStarted;
    assert.equal(await service.refresh(FEED), false); assert.equal(refreshes, 1);
    release!(); assert.equal(await running, false);
    const response = await fetch(`${service.origin}/status`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: '{}' });
    assert.match((await response.json() as { feeds: Array<{ error: string }> }).feeds[0]!.error, /last-good/u);
  } finally { await service.close(); }
}));

test('service cache has one process owner and shutdown joins an interrupted refresh before removing its lock', async () => temporary(async directory => {
  let started: (() => void) | null = null;
  const workerStarted = new Promise<void>(resolve => { started = resolve; });
  const service = await startDomainFeedService({ directory, token: TOKEN, feedIds: [FEED], automaticRefresh: false,
    worker: async (_task, signal) => new Promise((_resolve, reject) => {
      started!(); signal.addEventListener('abort', () => reject(new Error('Fixture interrupted.')), { once: true });
    }) });
  await assert.rejects(startDomainFeedService({ directory, token: TOKEN, feedIds: [FEED], automaticRefresh: false }), /EEXIST/u);
  const refreshing = service.refresh(FEED); await workerStarted;
  await service.close(); assert.equal(await refreshing, false);
  assert.deepEqual(await readdir(directory), []);
}));

test('pre-existing staging output is never deleted when exclusive ownership fails', async () => temporary(async directory => {
  const filename = staging(directory);
  const existing = await open(filename, 'wx', 0o600); await existing.close();
  await assert.rejects(refreshDomainFeedCache({ directory, feedId: FEED, stagingFilename: filename, fetch: async () => feedResponse('exact.example\n') }), /EEXIST/u);
  assert.deepEqual(await readdir(directory), [path.basename(filename)]);
}));
