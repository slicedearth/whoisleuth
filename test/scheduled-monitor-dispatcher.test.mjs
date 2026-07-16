import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import {
  MAX_SCHEDULED_RESULT_BYTES,
  normalizeScheduledMonitorDelivery,
  ScheduledMonitorDispatcher,
  scheduledLookupResult,
  scheduledMonitorContinueDelivery,
  scheduledMonitorTickDelivery,
  SCHEDULED_MONITOR_DELIVERY_SCHEMA,
  SCHEDULED_MONITOR_DELIVERY_VERSION,
  SCHEDULED_MONITOR_LEASE_MS,
  SCHEDULED_MONITOR_STALE_RUN_MS,
} from '../frontend/src/lib/analysis/scheduled-monitor-dispatcher.js';
import {
  createScheduledWatchlist,
  emptyScheduledMonitorState,
  MAX_SCHEDULED_MONITOR_STATIC_BYTES,
  MAX_SCHEDULED_MONITOR_STORE_BYTES,
  normalizeScheduledMonitorState,
} from '../frontend/src/lib/analysis/scheduled-monitor-model.js';
import { ScheduledMonitorRepository } from '../lib/scheduled-monitor-repository.mts';

const START = Date.parse('2026-07-16T08:00:00.000Z');

function fixtureEntry(domains = ['alpha.example', 'beta.example']) {
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

function scheduledWatchlist({
  id = 'watchlist-00000001',
  name = 'Priority domains',
  domains,
  nextRunAt,
} = {}) {
  const record = createScheduledWatchlist({
    id,
    name,
    entry: fixtureEntry(domains),
    intervalHours: 24,
    now: new Date(START).toISOString(),
  });
  if (nextRunAt !== undefined) record.nextRunAt = nextRunAt;
  return record;
}

class MemoryVersionedTextStore {
  constructor() {
    this.value = null;
    this.version = null;
    this.writeCalls = 0;
  }

  async read() {
    return { value: this.value, version: this.version };
  }

  async compareAndSet(_key, expectedVersion, nextValue) {
    this.writeCalls += 1;
    if (this.version !== expectedVersion) return false;
    this.value = nextValue;
    this.version = String(Number(this.version || 0) + 1);
    return true;
  }
}

async function harness({ lookup, enqueue } = {}) {
  let now = START;
  let id = 0;
  const rawStore = new MemoryVersionedTextStore();
  const repository = new ScheduledMonitorRepository({
    rawStore,
    encryptionKey: randomBytes(32).toString('base64'),
    namespace: 'whoisleuth:scheduled-monitor:dispatcher-test',
    emptyState: emptyScheduledMonitorState,
    normalizeState: normalizeScheduledMonitorState,
  });
  const deliveries = [];
  const lookupCalls = [];
  const dispatcher = new ScheduledMonitorDispatcher({
    repository,
    lookup: lookup || (async (domain, options) => {
      lookupCalls.push({ domain, options: structuredClone(options) });
      return {
        availability: {
          state: 'registered',
          registrar: { name: 'Example Registrar' },
          nameservers: ['ns1.example', 'ns2.example'],
        },
      };
    }),
    enqueue: enqueue || (async (message, options) => {
      deliveries.push({ message: structuredClone(message), options: structuredClone(options) });
    }),
    now: () => now,
    randomUUID: () => `generated-${String(++id).padStart(8, '0')}`,
  });
  return {
    dispatcher,
    repository,
    rawStore,
    deliveries,
    lookupCalls,
    advance(milliseconds) { now += milliseconds; },
    async seed(watchlists) {
      await repository.update((state) => ({
        state: { ...state, watchlists, activeRun: null },
        result: null,
      }));
    },
  };
}

test('delivery messages are versioned, opaque, bounded, and strict about unknown fields', () => {
  assert.deepEqual(scheduledMonitorTickDelivery(), {
    schema: SCHEDULED_MONITOR_DELIVERY_SCHEMA,
    version: SCHEDULED_MONITOR_DELIVERY_VERSION,
    kind: 'tick',
  });
  assert.deepEqual(scheduledMonitorContinueDelivery('active-run-000001', 3), {
    schema: SCHEDULED_MONITOR_DELIVERY_SCHEMA,
    version: SCHEDULED_MONITOR_DELIVERY_VERSION,
    kind: 'continue',
    runId: 'active-run-000001',
    cursor: 3,
  });
  assert.equal(normalizeScheduledMonitorDelivery({ ...scheduledMonitorTickDelivery(), domain: 'alpha.example' }), null);
  assert.equal(normalizeScheduledMonitorDelivery({ ...scheduledMonitorTickDelivery(), version: 2 }), null);
  assert.equal(scheduledMonitorContinueDelivery('short', 0), null);
  assert.equal(scheduledMonitorContinueDelivery('active-run-000001', 101), null);
});

test('a tick selects the earliest due watchlist and publishes no domain data', async () => {
  const h = await harness();
  await h.seed([
    scheduledWatchlist({
      id: 'watchlist-00000002',
      name: 'Later',
      nextRunAt: '2026-07-16T08:10:00.000Z',
    }),
    scheduledWatchlist({
      id: 'watchlist-00000001',
      name: 'Due',
      nextRunAt: '2026-07-16T07:00:00.000Z',
    }),
  ]);
  assert.equal(await h.dispatcher.tick(), 'queued');
  assert.equal(h.deliveries.length, 1);
  assert.equal(h.deliveries[0].message.kind, 'continue');
  assert.equal(JSON.stringify(h.deliveries).includes('alpha.example'), false);
  assert.match(h.deliveries[0].options.deduplicationKey, /^scheduled-monitor-generated-/);
  const state = await h.repository.read();
  assert.equal(state.activeRun.watchlistId, 'watchlist-00000001');
  assert.deepEqual(state.activeRun.sources, [{ domain: 'alpha.example' }, { domain: 'beta.example' }]);
  assert.equal(state.watchlists.find((item) => item.id === 'watchlist-00000001').status, 'queued');
});

test('idle ticks and busy leases are true no-op updates', async () => {
  const h = await harness();
  await h.seed([{
    ...scheduledWatchlist(),
    enabled: false,
    status: 'paused',
    nextRunAt: null,
  }]);
  const writes = h.rawStore.writeCalls;
  assert.equal(await h.dispatcher.tick(), 'idle');
  assert.equal(h.rawStore.writeCalls, writes);

  await h.seed([scheduledWatchlist()]);
  await h.dispatcher.tick();
  const message = h.deliveries.at(-1).message;
  await h.repository.update((state) => {
    state.activeRun.lease = {
      token: 'lease-token-00001',
      cursor: 0,
      expiresAt: new Date(START + SCHEDULED_MONITOR_LEASE_MS).toISOString(),
    };
    return { state, result: null };
  });
  const beforeBusy = h.rawStore.writeCalls;
  assert.equal(await h.dispatcher.continue(message), 'busy');
  assert.equal(h.rawStore.writeCalls, beforeBusy);
});

test('sequential deliveries complete a scan through fast compact lookups', async () => {
  const h = await harness();
  await h.seed([scheduledWatchlist()]);
  assert.equal(await h.dispatcher.tick(), 'queued');
  const first = h.deliveries.at(-1).message;
  assert.equal(await h.dispatcher.continue(first), 'continue');
  const second = h.deliveries.at(-1).message;
  assert.equal(second.cursor, 1);
  assert.equal(await h.dispatcher.continue(second), 'complete');

  assert.deepEqual(h.lookupCalls, [
    { domain: 'alpha.example', options: { fast: true, compact: true } },
    { domain: 'beta.example', options: { fast: true, compact: true } },
  ]);
  const state = await h.repository.read();
  const record = state.watchlists[0];
  assert.equal(state.activeRun, null);
  assert.equal(record.status, 'complete');
  assert.equal(record.lastError, null);
  assert.equal(record.revision, 2);
  assert.equal(record.lastRunAt, '2026-07-16T08:00:00.000Z');
  assert.equal(record.nextRunAt, '2026-07-17T08:00:00.000Z');
  assert.equal(record.entry.history.at(-1).changeCount, 2);
  assert.deepEqual(record.entry.results.map((item) => item.mutationTypes), [['substitution'], ['substitution']]);
  assert.equal(h.deliveries.at(-1).message.kind, 'tick');
  assert.equal(
    h.deliveries.at(-1).options.deduplicationKey,
    `scheduled-monitor-tick-after-${first.runId}`,
  );
});

test('lookup misses and failures complete as partial without erasing conclusive baselines', async () => {
  let calls = 0;
  const h = await harness({
    lookup: async () => {
      calls += 1;
      if (calls === 1) return { availability: { state: 'unknown' } };
      throw new Error('upstream unavailable');
    },
  });
  await h.seed([scheduledWatchlist()]);
  await h.dispatcher.tick();
  assert.equal(await h.dispatcher.continue(h.deliveries.at(-1).message), 'continue');
  assert.equal(await h.dispatcher.continue(h.deliveries.at(-1).message), 'partial');
  const record = (await h.repository.read()).watchlists[0];
  assert.equal(record.status, 'partial');
  assert.match(record.lastError, /2 of 2 scheduled lookups were inconclusive/i);
  assert.deepEqual(record.entry.results.map((item) => item.availability), ['unknown', 'error']);
  assert.deepEqual(record.entry.baseline.map((item) => item.availability), ['available', 'available']);
  assert.equal(record.entry.history.at(-1).changeCount, 0);
});

test('duplicate cursors resume current progress and expired leases can be reclaimed', async () => {
  const h = await harness();
  await h.seed([scheduledWatchlist()]);
  await h.dispatcher.tick();
  const first = h.deliveries.at(-1).message;
  assert.equal(await h.dispatcher.continue(first), 'continue');
  assert.equal(await h.dispatcher.continue(first), 'resumed');
  assert.equal(h.deliveries.at(-1).message.cursor, 1);

  await h.repository.update((state) => {
    state.activeRun.lease = {
      token: 'lease-token-00001',
      cursor: 1,
      expiresAt: new Date(START + SCHEDULED_MONITOR_LEASE_MS).toISOString(),
    };
    return { state, result: null };
  });
  h.advance(SCHEDULED_MONITOR_LEASE_MS + 1);
  assert.equal(await h.dispatcher.continue(h.deliveries.at(-1).message), 'complete');
});

test('a stale partial run retains prior evidence, backs off, and allows another due list to start', async () => {
  const h = await harness();
  const first = scheduledWatchlist({
    id: 'watchlist-00000001',
    name: 'First',
  });
  const second = scheduledWatchlist({
    id: 'watchlist-00000002',
    name: 'Second',
  });
  await h.seed([first, second]);
  await h.dispatcher.tick();
  await h.repository.update((state) => {
    state.activeRun.cursor = 1;
    state.activeRun.results = [{ domain: 'alpha.example', availability: 'registered' }];
    state.activeRun.updatedAt = new Date(START).toISOString();
    return { state, result: null };
  });
  h.advance(SCHEDULED_MONITOR_STALE_RUN_MS);
  assert.equal(await h.dispatcher.tick(), 'queued');
  const state = await h.repository.read();
  const expired = state.watchlists.find((item) => item.id === first.id);
  assert.equal(expired.status, 'partial');
  assert.match(expired.lastError, /expired after 1 of 2/i);
  assert.equal(expired.nextRunAt, '2026-07-16T11:00:00.000Z');
  assert.equal(state.activeRun.watchlistId, second.id);
});

test('a revision change during lookup supersedes stale work without applying its result', async () => {
  let resolveLookup;
  let started;
  const lookupStarted = new Promise((resolve) => { started = resolve; });
  const lookupResult = new Promise((resolve) => { resolveLookup = resolve; });
  const h = await harness({
    lookup: async () => {
      started();
      return lookupResult;
    },
  });
  await h.seed([scheduledWatchlist({ domains: ['alpha.example'] })]);
  await h.dispatcher.tick();
  const continuation = h.dispatcher.continue(h.deliveries.at(-1).message);
  await lookupStarted;
  await h.repository.update((state) => {
    state.watchlists[0].revision += 1;
    state.watchlists[0].updatedAt = '2026-07-16T08:01:00.000Z';
    return { state, result: null };
  });
  resolveLookup({ availability: { state: 'registered' } });
  assert.equal(await continuation, 'superseded');
  const state = await h.repository.read();
  assert.equal(state.activeRun, null);
  assert.equal(state.watchlists[0].lastRunAt, null);
  assert.equal(state.watchlists[0].entry.results[0].availability, 'available');
});

test('queue publication failure leaves a resumable opaque run', async () => {
  let fail = true;
  const published = [];
  const h = await harness({
    enqueue: async (message) => {
      if (fail) throw new Error('queue unavailable');
      published.push(structuredClone(message));
    },
  });
  await h.seed([scheduledWatchlist()]);
  await assert.rejects(h.dispatcher.tick(), /queue unavailable/i);
  const stranded = await h.repository.read();
  assert.ok(stranded.activeRun);
  assert.equal(stranded.activeRun.cursor, 0);

  fail = false;
  assert.equal(await h.dispatcher.tick(), 'queued');
  assert.deepEqual(published[0], scheduledMonitorContinueDelivery(stranded.activeRun.id, 0));
});

test('a continuation publication failure retains the completed cursor for the next tick', async () => {
  let publications = 0;
  const h = await harness({
    enqueue: async () => {
      publications += 1;
      if (publications === 2) throw new Error('queue unavailable');
    },
  });
  await h.seed([scheduledWatchlist()]);
  await h.dispatcher.tick();
  const first = scheduledMonitorContinueDelivery((await h.repository.read()).activeRun.id, 0);
  await assert.rejects(h.dispatcher.continue(first), /queue unavailable/i);
  const progressed = await h.repository.read();
  assert.equal(progressed.activeRun.cursor, 1);
  assert.equal(progressed.activeRun.lease, null);
  assert.equal(await h.dispatcher.tick(), 'queued');
  assert.equal(publications, 3);
});

test('invalid messages are ignored without touching encrypted state', async () => {
  const h = await harness();
  await h.seed([scheduledWatchlist()]);
  const writes = h.rawStore.writeCalls;
  assert.equal(await h.dispatcher.process({ kind: 'continue', runId: 'bad', cursor: 0 }), 'ignored');
  assert.equal(await h.dispatcher.process({ ...scheduledMonitorTickDelivery(), extra: true }), 'ignored');
  assert.equal(h.rawStore.writeCalls, writes);
});

test('process accepts the strict tick envelope and delegates into the dispatcher', async () => {
  const h = await harness();
  await h.seed([scheduledWatchlist()]);
  assert.equal(await h.dispatcher.process(scheduledMonitorTickDelivery()), 'queued');
  assert.equal(h.deliveries[0].message.kind, 'continue');
});

test('scheduled result projection retains only compact registration evidence within its byte cap', () => {
  const result = scheduledLookupResult({ domain: 'alpha.example' }, {
    availability: {
      state: 'registered',
      registrar: { name: 'R'.repeat(500), private: 'drop me' },
      nameservers: Array.from({ length: 20 }, (_, index) => `NS${index}.EXAMPLE.`),
      createdDate: '2026-01-01',
      rawRdap: { secret: true },
    },
    diagnostics: { secret: true },
    rdap: { raw: true },
  });
  assert.equal(result.registrarName.length, 300);
  assert.equal(result.nameservers.length, 12);
  assert.equal(result.rawRdap, undefined);
  assert.equal(result.diagnostics, undefined);
  assert.ok(new TextEncoder().encode(JSON.stringify(result)).byteLength <= MAX_SCHEDULED_RESULT_BYTES);
  const maximumRunSources = new TextEncoder().encode(JSON.stringify({
    sources: Array.from({ length: 100 }, () => ({ domain: 'd'.repeat(253) })),
  })).byteLength;
  assert.ok(
    MAX_SCHEDULED_MONITOR_STATIC_BYTES
      + (MAX_SCHEDULED_RESULT_BYTES * 100)
      + maximumRunSources
      < MAX_SCHEDULED_MONITOR_STORE_BYTES,
  );
  assert.throws(() => scheduledLookupResult({ domain: 'not valid' }, {}), /source is invalid/i);
});

test('constructor rejects incomplete execution contracts and invalid generated identifiers', async () => {
  assert.throws(() => new ScheduledMonitorDispatcher({}), /repository is required/i);
  const h = await harness();
  const invalid = new ScheduledMonitorDispatcher({
    repository: h.repository,
    lookup: async () => ({}),
    enqueue: async () => {},
    now: () => START,
    randomUUID: () => 'short',
  });
  await h.seed([scheduledWatchlist()]);
  await assert.rejects(invalid.tick(), /identifier source returned an invalid value/i);
});
