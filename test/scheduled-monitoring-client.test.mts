import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchScheduledMonitoring,
  mutateScheduledMonitoring,
  normalizeScheduledMonitoringResponse,
} from '../frontend/src/lib/scheduled-monitoring.ts';

const NOW = '2026-07-16T12:00:00.000Z';

function required<T>(value: T | null | undefined): T {
  assert.ok(value);
  return value;
}

function entry(domain = 'alpha.invalid') {
  return {
    updatedAt: NOW,
    results: [{
      domain,
      scanDepth: 'fast' as const,
      availability: 'registered',
      registrarName: null,
      nameservers: [],
      mutationTypes: [],
      riskModelVersion: null,
      riskScore: null,
      rawWhois: 'drop me',
    }],
    baseline: [],
    history: [],
    privateField: 'drop me',
  };
}

function publicWatchlist(overrides: Record<string, unknown> = {}) {
  return {
    id: 'watchlist-00000001',
    name: 'Priority domains',
    enabled: true,
    intervalHours: 24,
    revision: 1,
    domainCount: 1,
    updatedAt: NOW,
    nextRunAt: NOW,
    lastRunAt: null,
    status: 'idle',
    lastError: null,
    prunedHistoryEvents: 0,
    entry: entry(),
    progress: null,
    lease: { secret: true },
    ...overrides,
  };
}

function responseFixture(overrides: Record<string, unknown> = {}) {
  return {
    state: {
      schema: 'whoisleuth.scheduled-monitor',
      version: 1,
      watchlists: [publicWatchlist()],
    },
    capacity: {
      version: 1,
      triggerIntervalMinutes: 5,
      lookupLimitPerInvocation: 2,
      theoreticalLookupsPerWeek: 4032,
      admittedLookupsPerWeek: 3024,
      projectedLookupsPerWeek: 7,
      remainingLookupsPerWeek: 3017,
      utilizationPercent: 0.23,
      reservePercent: 25,
    },
    ...overrides,
  };
}

test('normalizes public hosted state and discards unknown compact evidence and operational fields', () => {
  const result = normalizeScheduledMonitoringResponse(responseFixture());
  assert.ok(result);
  assert.equal(result.action, null);
  assert.equal(result.id, null);
  assert.equal(result.recovery, null);
  const watchlist = required(result.state.watchlists[0]);
  assert.equal(watchlist.entry.results[0]?.rawWhois, undefined);
  assert.equal(Object.hasOwn(watchlist.entry, 'privateField'), false);
  assert.equal(Object.hasOwn(watchlist, 'lease'), false);
  assert.equal(result.capacity.remainingLookupsPerWeek, 3017);
});

test('accepts only a count-only bounded recovery projection', () => {
  const categories = {
    invalidWatchlists: 1,
    duplicateIdentifiers: 2,
    duplicateNames: 0,
    truncatedInputs: 3,
    normalisedWatchlists: 0,
    invalidActiveRuns: 1,
    releasedMalformedLeases: 1,
    resetInconsistentStatuses: 0,
  };
  const result = normalizeScheduledMonitoringResponse(responseFixture({
    recovery: { version: 1, recoveredItems: 8, categories },
  }));
  assert.deepEqual(result?.recovery, { version: 1, recoveredItems: 8, categories });
  assert.doesNotMatch(JSON.stringify(result?.recovery), /target|watchlist name|lease token|ciphertext/u);

  for (const recovery of [
    { version: 1, recoveredItems: 7, categories },
    { version: 2, recoveredItems: 8, categories },
    { version: 1, recoveredItems: 8, categories: { ...categories, rawTarget: 'private.invalid' } },
    { version: 1, recoveredItems: 1, categories: { ...categories, invalidWatchlists: -1 } },
  ]) {
    assert.equal(normalizeScheduledMonitoringResponse(responseFixture({ recovery })), null);
  }
});

test('accepts a bounded mutation result and validates progress against membership', () => {
  const result = normalizeScheduledMonitoringResponse(responseFixture({
    action: 'updated',
    id: 'watchlist-00000001',
    state: {
      schema: 'whoisleuth.scheduled-monitor',
      version: 1,
      watchlists: [publicWatchlist({ status: 'running', progress: { completed: 0, total: 1 } })],
    },
  }));
  assert.ok(result);
  assert.equal(result.action, 'updated');
  assert.equal(result.id, 'watchlist-00000001');
  assert.deepEqual(required(result.state.watchlists[0]).progress, { completed: 0, total: 1 });

  assert.equal(normalizeScheduledMonitoringResponse(responseFixture({
    state: {
      schema: 'whoisleuth.scheduled-monitor',
      version: 1,
      watchlists: [publicWatchlist({ progress: { completed: 0, total: 2 } })],
    },
  })), null);
});

test('rejects future schemas, malformed records, count mismatches, and forged capacity math', () => {
  assert.equal(normalizeScheduledMonitoringResponse(null), null);
  assert.equal(normalizeScheduledMonitoringResponse(responseFixture({
    state: { schema: 'whoisleuth.scheduled-monitor', version: 2, watchlists: [] },
  })), null);
  assert.equal(normalizeScheduledMonitoringResponse(responseFixture({
    state: {
      schema: 'whoisleuth.scheduled-monitor', version: 1,
      watchlists: [publicWatchlist({ domainCount: 2 })],
    },
  })), null);
  assert.equal(normalizeScheduledMonitoringResponse(responseFixture({
    capacity: { ...responseFixture().capacity, projectedLookupsPerWeek: 0 },
  })), null);
  assert.equal(normalizeScheduledMonitoringResponse(responseFixture({ action: 'forged' })), null);
  assert.equal(normalizeScheduledMonitoringResponse(responseFixture({ id: 'watchlist-00000001' })), null);
  assert.equal(normalizeScheduledMonitoringResponse(responseFixture({ action: 'updated' })), null);
  for (const field of ['updatedAt', 'nextRunAt', 'lastRunAt'] as const) {
    assert.equal(normalizeScheduledMonitoringResponse(responseFixture({
      state: {
        schema: 'whoisleuth.scheduled-monitor',
        version: 1,
        watchlists: [publicWatchlist({ [field]: '2026-07-16T12:00:00' })],
      },
    })), null);
  }
});

test('deduplicates bounded watchlists by id and case-insensitive name', () => {
  const result = normalizeScheduledMonitoringResponse(responseFixture({
    state: {
      schema: 'whoisleuth.scheduled-monitor',
      version: 1,
      watchlists: [
        publicWatchlist(),
        publicWatchlist({ id: 'watchlist-00000002' }),
        publicWatchlist({ id: 'watchlist-00000003', name: 'PRIORITY DOMAINS' }),
      ],
    },
  }));
  assert.ok(result);
  assert.equal(result.state.watchlists.length, 1);
});

test('GET and POST use the canonical same-origin no-store endpoint contract', async () => {
  const calls: Array<{ url: string; options: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, options) => {
    const url = String(input);
    calls.push({ url, options: structuredClone(options || {}) });
    return new Response(JSON.stringify(responseFixture({
      ...(options?.method === 'POST' ? { action: 'created', id: 'watchlist-00000001' } : {}),
    })), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  await fetchScheduledMonitoring(fetcher);
  await mutateScheduledMonitoring({
    action: 'create', name: 'Priority domains', entry: entry(), intervalHours: 24,
  }, fetcher);

  const get = required(calls[0]);
  assert.equal(get.url, '/api/scheduled-monitor');
  assert.equal(get.options.credentials, 'same-origin');
  assert.equal(get.options.cache, 'no-store');
  assert.ok(get.options.signal, 'the bounded response reader must be able to abort the request');
  const post = required(calls[1]);
  assert.equal(post.url, '/api/scheduled-monitor');
  assert.equal(post.options.method, 'POST');
  assert.equal(post.options.credentials, 'same-origin');
  assert.equal(post.options.cache, 'no-store');
  assert.equal(new Headers(post.options.headers).get('Content-Type'), 'application/json');
  const postBody = post.options.body;
  assert.equal(typeof postBody, 'string');
  assert.deepEqual(JSON.parse(typeof postBody === 'string' ? postBody : ''), {
    action: 'create', name: 'Priority domains', entry: entry(), intervalHours: 24,
  });
});

test('bounds server error text and rejects malformed successful responses', async () => {
  await assert.rejects(fetchScheduledMonitoring(async () => new Response(JSON.stringify({
    error: 'Expected management failure',
  }), { status: 409, headers: { 'content-type': 'application/json' } })), /Expected management failure/);
  await assert.rejects(fetchScheduledMonitoring(async () => new Response(JSON.stringify({
    error: `bad\n${'x'.repeat(500)}`,
  }), { status: 503 })), /Hosted monitoring request failed \(503\)/);
  await assert.rejects(fetchScheduledMonitoring(async () => new Response('{}', { status: 200 })), /invalid response/i);
});
