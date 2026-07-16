import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import {
  MAX_CYCLE_LOOKUPS,
  MAX_CYCLE_MS,
  MIN_LOOKUP_WINDOW_MS,
  runScheduledMonitorCycle,
} from '../lib/scheduled-monitor-cycle.mts';
import { ScheduledMonitorRepository } from '../lib/scheduled-monitor-repository.mts';
import {
  createScheduledWatchlist,
  emptyScheduledMonitorState,
  normalizeScheduledMonitorState,
} from '../frontend/src/lib/analysis/scheduled-monitor-model.js';

const START = Date.parse('2026-07-16T10:00:00.000Z');

class MemoryVersionedTextStore {
  value = null;
  version = null;

  async read() {
    return { value: this.value, version: this.version };
  }

  async compareAndSet(_key, expectedVersion, nextValue) {
    if (this.version !== expectedVersion) return false;
    this.value = nextValue;
    this.version = String(Number(this.version || 0) + 1);
    return true;
  }
}

function fixtureEntry(domains) {
  return {
    updatedAt: new Date(START).toISOString(),
    results: domains.map((domain) => ({
      domain,
      scanDepth: 'fast',
      availability: 'available',
      mutationTypes: ['substitution'],
    })),
    baseline: domains.map((domain) => ({
      domain,
      scanDepth: 'fast',
      availability: 'available',
    })),
    history: [],
  };
}

function scheduledWatchlist(domains) {
  return createScheduledWatchlist({
    id: 'watchlist-00000001',
    name: 'Priority domains',
    entry: fixtureEntry(domains),
    intervalHours: 24,
    now: new Date(START).toISOString(),
  });
}

async function harness(domains = []) {
  let now = START;
  let id = 0;
  const repository = new ScheduledMonitorRepository({
    rawStore: new MemoryVersionedTextStore(),
    encryptionKey: randomBytes(32).toString('base64'),
    namespace: 'whoisleuth:scheduled-monitor:cycle-test',
    emptyState: emptyScheduledMonitorState,
    normalizeState: normalizeScheduledMonitorState,
  });
  if (domains.length > 0) {
    await repository.update((state) => ({
      state: { ...state, watchlists: [scheduledWatchlist(domains)] },
      result: null,
    }));
  }
  const lookupCalls = [];
  const options = {
    repository,
    lookup: async (domain, lookupOptions) => {
      lookupCalls.push({ domain, options: structuredClone(lookupOptions) });
      return { availability: { state: 'registered' } };
    },
    now: () => now,
    randomUUID: () => `generated-${String(++id).padStart(8, '0')}`,
  };
  return {
    repository,
    lookupCalls,
    options,
    advance(milliseconds) { now += milliseconds; },
  };
}

test('an idle scheduled cycle performs one bounded control delivery and no lookup', async () => {
  const h = await harness();
  assert.deepEqual(await runScheduledMonitorCycle(h.options), {
    status: 'idle',
    stopReason: 'complete',
    processedDeliveries: 1,
    lookupDeliveries: 0,
    deferredDeliveries: 0,
  });
  assert.deepEqual(h.lookupCalls, []);
});

test('a cycle starts at most two fast compact lookups and leaves durable progress resumable', async () => {
  const h = await harness(['alpha.invalid', 'beta.invalid', 'gamma.invalid']);
  const first = await runScheduledMonitorCycle(h.options);
  assert.deepEqual(first, {
    status: 'deferred',
    stopReason: 'lookup_limit',
    processedDeliveries: 3,
    lookupDeliveries: MAX_CYCLE_LOOKUPS,
    deferredDeliveries: 1,
  });
  assert.deepEqual(h.lookupCalls.map((call) => call.options), [
    { fast: true, compact: true },
    { fast: true, compact: true },
  ]);
  let state = await h.repository.read();
  assert.equal(state.activeRun.cursor, 2);
  assert.equal(state.watchlists[0].entry.results[0].availability, 'available');

  const second = await runScheduledMonitorCycle(h.options);
  assert.equal(second.status, 'complete');
  assert.equal(second.lookupDeliveries, 1);
  state = await h.repository.read();
  assert.equal(state.activeRun, null);
  assert.equal(state.watchlists[0].status, 'complete');
  assert.deepEqual(state.watchlists[0].entry.results.map((item) => item.availability), [
    'registered',
    'registered',
    'registered',
  ]);
});

test('a cycle defers another lookup when the soft deadline no longer leaves a safe window', async () => {
  const h = await harness(['alpha.invalid', 'beta.invalid']);
  h.options.lookup = async (domain, lookupOptions) => {
    h.lookupCalls.push({ domain, options: structuredClone(lookupOptions) });
    h.advance(MAX_CYCLE_MS - MIN_LOOKUP_WINDOW_MS + 1);
    return { availability: { state: 'registered' } };
  };
  const result = await runScheduledMonitorCycle(h.options);
  assert.deepEqual(result, {
    status: 'deferred',
    stopReason: 'deadline',
    processedDeliveries: 2,
    lookupDeliveries: 1,
    deferredDeliveries: 1,
  });
  assert.equal((await h.repository.read()).activeRun.cursor, 1);
});

test('cycle summaries contain counts and states but no domain or delivery payloads', async () => {
  const h = await harness(['sensitive.invalid']);
  const result = await runScheduledMonitorCycle(h.options);
  assert.equal(JSON.stringify(result).includes('sensitive.invalid'), false);
  assert.deepEqual(Object.keys(result).sort(), [
    'deferredDeliveries',
    'lookupDeliveries',
    'processedDeliveries',
    'status',
    'stopReason',
  ]);
});

test('invalid cycle dependencies and clocks fail before lookup work', async () => {
  await assert.rejects(runScheduledMonitorCycle(), /cycle options are required/i);
  await assert.rejects(runScheduledMonitorCycle({}), /lookup function is required/i);
  await assert.rejects(
    runScheduledMonitorCycle({ lookup: async () => ({}), randomUUID: null }),
    /identifier function is required/i,
  );
  await assert.rejects(
    runScheduledMonitorCycle({
      repository: {},
      lookup: async () => ({}),
      randomUUID: () => 'generated-00000001',
      now: () => Number.NaN,
    }),
    /clock returned an invalid time/i,
  );
});
