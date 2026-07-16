import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { createNetlifyBlobVersionedTextStore } from '../lib/scheduled-monitor-netlify-store.mts';
import { ScheduledMonitorRepository } from '../lib/scheduled-monitor-repository.mts';
import {
  createScheduledMonitorRuntime,
  ENABLE_ENV,
  KEY_ENV,
  NAMESPACE_ENV,
  scheduledMonitorRuntimeConfiguration,
  SCHEDULED_MONITOR_UNAVAILABLE_CODE,
} from '../lib/scheduled-monitor-runtime.mts';
import {
  createScheduledWatchlist,
  emptyScheduledMonitorState,
  normalizeScheduledMonitorState,
} from '../frontend/src/lib/analysis/scheduled-monitor-model.js';

const START = Date.parse('2026-07-16T12:00:00.000Z');
const key = randomBytes(32).toString('base64');
const namespace = 'whoisleuth:scheduled-monitor:runtime-test';

function readyEnv(overrides = {}) {
  return {
    [ENABLE_ENV]: '1',
    [KEY_ENV]: key,
    [NAMESPACE_ENV]: namespace,
    ...overrides,
  };
}

class FakeBlobStore {
  entry = null;
  reads = 0;
  writes = 0;

  async getWithMetadata() {
    this.reads += 1;
    return this.entry;
  }

  async set(_key, value, options) {
    this.writes += 1;
    const current = this.entry?.etag || null;
    if ((options.onlyIfNew === true && current !== null)
      || (options.onlyIfMatch !== undefined && options.onlyIfMatch !== current)) {
      return { modified: false };
    }
    const etag = `"v${this.writes}"`;
    this.entry = { data: value, etag, metadata: {} };
    return { modified: true, etag };
  }
}

function fixtureEntry(domains) {
  return {
    updatedAt: new Date(START).toISOString(),
    results: domains.map((domain) => ({
      domain,
      scanDepth: 'fast',
      availability: 'available',
      mutationTypes: [],
    })),
    baseline: domains.map((domain) => ({
      domain,
      scanDepth: 'fast',
      availability: 'available',
    })),
    history: [],
  };
}

test('configuration is disabled by default and accepts explicit true and false values', () => {
  for (const value of [undefined, '', '0', 'false', 'no', 'off']) {
    const configuration = scheduledMonitorRuntimeConfiguration(
      value === undefined ? {} : { [ENABLE_ENV]: value },
    );
    assert.equal(configuration.status, 'disabled');
    assert.equal(configuration.enabled, false);
  }
  for (const value of ['1', 'true', 'yes', 'on', ' TRUE ']) {
    assert.equal(scheduledMonitorRuntimeConfiguration(readyEnv({ [ENABLE_ENV]: value })).status, 'ready');
  }
});

test('malformed enabled configuration fails closed without exposing the encryption key', () => {
  const cases = [
    [{ [ENABLE_ENV]: true }, ENABLE_ENV],
    [{ [ENABLE_ENV]: 'sometimes' }, ENABLE_ENV],
    [{ [ENABLE_ENV]: '1', [NAMESPACE_ENV]: namespace }, KEY_ENV],
    [{ [ENABLE_ENV]: '1', [KEY_ENV]: 'not-a-key', [NAMESPACE_ENV]: namespace }, KEY_ENV],
    [{ [ENABLE_ENV]: '1', [KEY_ENV]: key }, NAMESPACE_ENV],
    [readyEnv({ [NAMESPACE_ENV]: 'invalid namespace' }), NAMESPACE_ENV],
  ];
  for (const [env, expected] of cases) {
    const configuration = scheduledMonitorRuntimeConfiguration(env);
    assert.equal(configuration.status, 'unavailable');
    assert.match(configuration.reason, new RegExp(expected));
    assert.equal(JSON.stringify(configuration).includes(key), false);
  }
});

test('disabled and unavailable runtimes perform no Blob or lookup work', async () => {
  const blobs = new FakeBlobStore();
  let lookups = 0;
  const disabled = createScheduledMonitorRuntime({
    env: {},
    blobStore: blobs,
    lookup: async () => { lookups += 1; return {}; },
  });
  assert.deepEqual(await disabled.run(), {
    status: 'disabled',
    stopReason: 'disabled',
    processedDeliveries: 0,
    lookupDeliveries: 0,
    deferredDeliveries: 0,
  });

  const unavailable = createScheduledMonitorRuntime({
    env: { [ENABLE_ENV]: '1' },
    blobStore: blobs,
    lookup: async () => { lookups += 1; return {}; },
  });
  await assert.rejects(unavailable.run(), (error) => {
    assert.equal(error.code, SCHEDULED_MONITOR_UNAVAILABLE_CODE);
    return true;
  });
  assert.equal(blobs.reads, 0);
  assert.equal(blobs.writes, 0);
  assert.equal(lookups, 0);
});

test('an enabled runtime requires a Blob store before reading or looking up', async () => {
  let lookups = 0;
  const runtime = createScheduledMonitorRuntime({
    env: readyEnv(),
    lookup: async () => { lookups += 1; return {}; },
  });
  assert.equal(runtime.status, 'unavailable');
  assert.match(runtime.reason, /Blob storage is unavailable/i);
  await assert.rejects(runtime.run(), (error) => error.code === SCHEDULED_MONITOR_UNAVAILABLE_CODE);
  assert.equal(lookups, 0);
});

test('a ready runtime composes encrypted storage and the fast compact cycle without exposing secrets', async () => {
  const blobs = new FakeBlobStore();
  const repository = new ScheduledMonitorRepository({
    rawStore: createNetlifyBlobVersionedTextStore(blobs),
    encryptionKey: key,
    namespace,
    emptyState: emptyScheduledMonitorState,
    normalizeState: normalizeScheduledMonitorState,
  });
  await repository.update((state) => ({
    state: {
      ...state,
      watchlists: [createScheduledWatchlist({
        id: 'watchlist-00000001',
        name: 'Priority domains',
        entry: fixtureEntry(['alpha.invalid']),
        intervalHours: 24,
        now: new Date(START).toISOString(),
      })],
    },
    result: null,
  }));
  const calls = [];
  let id = 0;
  const runtime = createScheduledMonitorRuntime({
    env: readyEnv(),
    blobStore: blobs,
    lookup: async (domain, options) => {
      calls.push({ domain, options: structuredClone(options) });
      return { availability: { state: 'registered' } };
    },
    now: () => START,
    randomUUID: () => `generated-${String(++id).padStart(8, '0')}`,
  });
  assert.deepEqual(
    { status: runtime.status, enabled: runtime.enabled, configured: runtime.configured, reason: runtime.reason },
    { status: 'ready', enabled: true, configured: true, reason: null },
  );
  assert.equal(JSON.stringify(runtime).includes(key), false);
  const result = await runtime.run();
  assert.equal(result.status, 'complete');
  assert.deepEqual(calls, [{ domain: 'alpha.invalid', options: { fast: true, compact: true } }]);
  assert.equal(blobs.entry.data.includes('alpha.invalid'), false);
});

test('the default lookup path honors the hosted lookup emergency switch without network work', async () => {
  const blobs = new FakeBlobStore();
  const repository = new ScheduledMonitorRepository({
    rawStore: createNetlifyBlobVersionedTextStore(blobs),
    encryptionKey: key,
    namespace,
    emptyState: emptyScheduledMonitorState,
    normalizeState: normalizeScheduledMonitorState,
  });
  await repository.update((state) => ({
    state: {
      ...state,
      watchlists: [createScheduledWatchlist({
        id: 'watchlist-00000001',
        name: 'Priority domains',
        entry: fixtureEntry(['alpha.invalid']),
        intervalHours: 24,
        now: new Date(START).toISOString(),
      })],
    },
    result: null,
  }));
  let id = 0;
  const runtime = createScheduledMonitorRuntime({
    env: readyEnv({ WHOISLEUTH_DISABLE_LOOKUP: '1' }),
    blobStore: blobs,
    now: () => START,
    randomUUID: () => `generated-${String(++id).padStart(8, '0')}`,
  });
  const result = await runtime.run();
  assert.equal(result.status, 'partial');
  const state = await repository.read();
  assert.equal(state.watchlists[0].entry.results[0].availability, 'error');
  assert.equal(state.watchlists[0].entry.baseline[0].availability, 'available');
});
