import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { deferred } from './deferred.mts';
import {
  MAX_CYCLE_LOOKUPS,
  MAX_CYCLE_MS,
  runScheduledMonitorCycle,
} from '../lib/scheduled-monitor-cycle.mts';
import { ScheduledMonitorRepository } from '../lib/scheduled-monitor-repository.mts';
import {
  createScheduledWatchlist,
  emptyScheduledMonitorState,
  normalizeScheduledMonitorState,
} from '../frontend/src/lib/analysis/scheduled-monitor-model.ts';
import type {
  ScheduledMonitorState,
  ScheduledWatchlist,
} from '../frontend/src/lib/analysis/scheduled-monitor-model.ts';
import type { ScheduledMonitorCycleOptions } from '../lib/scheduled-monitor-cycle.mts';
import type { VersionedTextStore } from '../lib/scheduled-monitor-repository.mts';
import type { ScheduledMonitorLookupOptions } from '../packages/monitoring/scheduled-monitor-dispatcher.mts';

const START = Date.parse('2026-07-16T10:00:00.000Z');

class MemoryVersionedTextStore implements VersionedTextStore {
  value: string | null = null;
  version: string | null = null;

  async read() {
    return { value: this.value, version: this.version };
  }

  async compareAndSet(_key: string, expectedVersion: string | null, nextValue: string) {
    if (this.version !== expectedVersion) return false;
    this.value = nextValue;
    this.version = String(Number(this.version || 0) + 1);
    return true;
  }
}

function fixtureEntry(domains: readonly string[]) {
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

function scheduledWatchlist(domains: readonly string[]): ScheduledWatchlist {
  return createScheduledWatchlist({
    id: 'watchlist-00000001',
    name: 'Priority domains',
    entry: fixtureEntry(domains),
    intervalHours: 24,
    now: new Date(START).toISOString(),
  });
}

async function harness(domains: readonly string[] = []) {
  let now = START;
  let id = 0;
  const repository = new ScheduledMonitorRepository<ScheduledMonitorState>({
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
  const lookupCalls: Array<{
    domain: string;
    options: ScheduledMonitorLookupOptions;
  }> = [];
  const options: ScheduledMonitorCycleOptions = {
    repository,
    lookup: async (domain, lookupOptions) => {
      lookupCalls.push({ domain, options: { ...lookupOptions } });
      return { availability: { state: 'registered' } };
    },
    now: () => now,
    randomUUID: () => `generated-${String(++id).padStart(8, '0')}`,
  };
  return {
    repository,
    lookupCalls,
    options,
    advance(milliseconds: number) { now += milliseconds; },
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
  assert.deepEqual(h.lookupCalls.map(({ options: { fast, compact } }) => ({ fast, compact })), [
    { fast: true, compact: true },
    { fast: true, compact: true },
  ]);
  assert.ok(h.lookupCalls[0]?.options.signal instanceof AbortSignal);
  assert.equal(h.lookupCalls[0]?.options.signal, h.lookupCalls[1]?.options.signal);
  let state = await h.repository.read();
  assert.ok(state.activeRun);
  assert.equal(state.activeRun.cursor, 2);
  const initialWatchlist = state.watchlists[0];
  assert.ok(initialWatchlist);
  assert.equal(initialWatchlist.entry.results[0]?.availability, 'available');

  const second = await runScheduledMonitorCycle(h.options);
  assert.equal(second.status, 'complete');
  assert.equal(second.lookupDeliveries, 1);
  state = await h.repository.read();
  assert.equal(state.activeRun, null);
  const completedWatchlist = state.watchlists[0];
  assert.ok(completedWatchlist);
  assert.equal(completedWatchlist.status, 'complete');
  assert.deepEqual(completedWatchlist.entry.results.map((item) => item.availability), [
    'registered',
    'registered',
    'registered',
  ]);
});

test('a late lookup result cannot advance the cursor or erase an earlier completed observation', async () => {
  const h = await harness(['alpha.invalid', 'beta.invalid']);
  h.options.lookup = async (domain, lookupOptions) => {
    h.lookupCalls.push({ domain, options: { ...lookupOptions } });
    h.advance(15_000);
    return { availability: { state: 'registered' } };
  };
  const result = await runScheduledMonitorCycle(h.options);
  assert.deepEqual(result, {
    status: 'deferred',
    stopReason: 'deadline',
    processedDeliveries: 2,
    lookupDeliveries: 2,
    deferredDeliveries: 1,
  });
  const state = await h.repository.read();
  assert.ok(state.activeRun);
  assert.equal(state.activeRun.cursor, 1);
});

test('one deadline includes slow storage setup and interrupts collection without consuming its cursor', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const h = await harness(['alpha.invalid']);
  const read = h.repository.rawStore.read.bind(h.repository.rawStore);
  const reading = deferred<void>();
  const lookingUp = deferred<AbortSignal>();
  let firstRead = true;
  h.repository.rawStore.read = async (...args) => {
    if (firstRead) {
      firstRead = false;
      reading.resolve();
      await new Promise((resolve) => setTimeout(resolve, 8_000));
    }
    return read(...args);
  };
  h.options.lookup = async (_domain, options) => {
    assert.ok(options.signal);
    lookingUp.resolve(options.signal);
    return new Promise(() => {});
  };
  const running = runScheduledMonitorCycle(h.options);
  await reading.promise;
  context.mock.timers.tick(8_000);
  const signal = await lookingUp.promise;
  context.mock.timers.tick(MAX_CYCLE_MS - 8_000);
  assert.deepEqual(await running, {
    status: 'deferred', stopReason: 'deadline', processedDeliveries: 1,
    lookupDeliveries: 1, deferredDeliveries: 1,
  });
  assert.equal(signal.aborted, true);
  const state = await h.repository.read();
  assert.ok(state.activeRun);
  assert.equal(state.activeRun.cursor, 0);
  assert.equal(state.activeRun.results.length, 0);
  assert.equal(state.activeRun.errorCount, 0);
  assert.equal(state.watchlists[0]?.entry.results[0]?.availability, 'available');
  h.advance(5 * 60_000);
  let resumed = 0;
  h.options.lookup = async () => { resumed += 1; return { availability: { state: 'registered' } }; };
  assert.equal((await runScheduledMonitorCycle(h.options)).status, 'complete');
  assert.equal(resumed, 1);
  assert.equal((await h.repository.read()).watchlists[0]?.entry.results[0]?.availability, 'registered');
});

test('a held initial repository read is deferred before any lookup or write', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const h = await harness(['alpha.invalid']);
  const reached = deferred<AbortSignal>();
  h.repository.rawStore.read = async (_key, options) => {
    assert.ok(options?.signal);
    reached.resolve(options.signal);
    return new Promise(() => {});
  };
  let writes = 0;
  h.repository.rawStore.compareAndSet = async () => { writes += 1; return true; };
  const running = runScheduledMonitorCycle(h.options);
  const signal = await reached.promise;
  context.mock.timers.tick(MAX_CYCLE_MS);
  assert.deepEqual(await running, {
    status: 'deferred', stopReason: 'deadline', processedDeliveries: 0,
    lookupDeliveries: 0, deferredDeliveries: 1,
  });
  assert.equal(signal.aborted, true);
  assert.equal(writes, 0);
  assert.equal(h.lookupCalls.length, 0);
});

test('a completion written before cancellation is reconciled without repeating the observation', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const h = await harness(['alpha.invalid']);
  const write = h.repository.rawStore.compareAndSet.bind(h.repository.rawStore);
  const committed = deferred<void>();
  let writes = 0;
  h.repository.rawStore.compareAndSet = async (...args) => {
    writes += 1;
    const result = await write(...args);
    if (writes === 3) {
      committed.resolve();
      return new Promise(() => {});
    }
    return result;
  };
  const running = runScheduledMonitorCycle(h.options);
  await committed.promise;
  context.mock.timers.tick(MAX_CYCLE_MS);
  assert.equal((await running).stopReason, 'deadline');
  assert.equal(writes, 3);
  assert.equal((await h.repository.read()).activeRun, null);
  assert.equal((await runScheduledMonitorCycle(h.options)).status, 'idle');
  assert.equal(h.lookupCalls.length, 1);
  assert.equal(writes, 3);
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
  // @ts-expect-error Runtime validation must reject a missing options object.
  await assert.rejects(runScheduledMonitorCycle(), /cycle options are required/i);
  // @ts-expect-error Runtime validation must reject incomplete dependencies.
  await assert.rejects(runScheduledMonitorCycle({}), /lookup function is required/i);
  await assert.rejects(
    // @ts-expect-error Runtime validation must reject a non-callable identifier source.
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
