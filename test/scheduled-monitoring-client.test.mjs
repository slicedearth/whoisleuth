import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchScheduledMonitoring,
  mutateScheduledMonitoring,
  normalizeScheduledMonitoringResponse,
} from '../frontend/src/lib/scheduled-monitoring.ts';

const NOW = '2026-07-16T12:00:00.000Z';

function entry(domain = 'alpha.invalid') {
  return {
    updatedAt: NOW,
    results: [{
      domain,
      scanDepth: 'fast',
      availability: 'registered',
      mutationTypes: [],
      rawWhois: 'drop me',
    }],
    baseline: [],
    history: [],
    privateField: 'drop me',
  };
}

function publicWatchlist(overrides = {}) {
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

function responseFixture(overrides = {}) {
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
  assert.equal(result.state.watchlists[0].entry.results[0].rawWhois, undefined);
  assert.equal(result.state.watchlists[0].entry.privateField, undefined);
  assert.equal(result.state.watchlists[0].lease, undefined);
  assert.equal(result.capacity.remainingLookupsPerWeek, 3017);
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
  assert.equal(result.action, 'updated');
  assert.equal(result.id, 'watchlist-00000001');
  assert.deepEqual(result.state.watchlists[0].progress, { completed: 0, total: 1 });

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
  assert.equal(result.state.watchlists.length, 1);
});

test('GET and POST use the canonical same-origin no-store endpoint contract', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options: structuredClone(options) });
    return new Response(JSON.stringify(responseFixture({
      ...(options?.method === 'POST' ? { action: 'created', id: 'watchlist-00000001' } : {}),
    })), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  await fetchScheduledMonitoring(fetcher);
  await mutateScheduledMonitoring({
    action: 'create', name: 'Priority domains', entry: entry(), intervalHours: 24,
  }, fetcher);

  assert.deepEqual(calls[0], {
    url: '/api/scheduled-monitor',
    options: { credentials: 'same-origin', cache: 'no-store' },
  });
  assert.equal(calls[1].url, '/api/scheduled-monitor');
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.credentials, 'same-origin');
  assert.equal(calls[1].options.cache, 'no-store');
  assert.equal(calls[1].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    action: 'create', name: 'Priority domains', entry: entry(), intervalHours: 24,
  });
});

test('bounds server error text and rejects malformed successful responses', async () => {
  await assert.rejects(fetchScheduledMonitoring(async () => new Response(JSON.stringify({
    error: 'Expected management failure',
  }), { status: 409 })), /Expected management failure/);
  await assert.rejects(fetchScheduledMonitoring(async () => new Response(JSON.stringify({
    error: `bad\n${'x'.repeat(500)}`,
  }), { status: 503 })), /Hosted monitoring request failed \(503\)/);
  await assert.rejects(fetchScheduledMonitoring(async () => new Response('{}', { status: 200 })), /invalid response/i);
});
