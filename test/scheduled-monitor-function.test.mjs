import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import {
  config,
  runScheduledMonitorFunction,
  SCHEDULED_MONITOR_CRON,
  SCHEDULED_MONITOR_STORE_NAME,
} from '../netlify/functions/scheduled-monitor.mts';
import {
  ENABLE_ENV,
  KEY_ENV,
  NAMESPACE_ENV,
  SCHEDULED_MONITOR_UNAVAILABLE_CODE,
} from '../lib/scheduled-monitor-runtime.mts';

const key = randomBytes(32).toString('base64');
const namespace = 'whoisleuth:scheduled-monitor:function-test';

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
    this.entry = { data: value, etag: `"v${this.writes}"`, metadata: {} };
    return { modified: true };
  }
}

test('the production worker has a fixed bounded schedule and private store name', () => {
  assert.equal(SCHEDULED_MONITOR_CRON, '*/5 * * * *');
  assert.deepEqual(config, { schedule: SCHEDULED_MONITOR_CRON });
  assert.equal(SCHEDULED_MONITOR_STORE_NAME, 'whoisleuth-scheduled-monitor');
  assert.equal(SCHEDULED_MONITOR_STORE_NAME.includes('/'), false);
  assert.equal(SCHEDULED_MONITOR_STORE_NAME.includes(':'), false);
  assert.ok(Buffer.byteLength(SCHEDULED_MONITOR_STORE_NAME, 'utf8') <= 64);
});

test('the disabled worker performs no Blob construction, storage, or lookup work', async () => {
  let storeConstructions = 0;
  let lookups = 0;
  const result = await runScheduledMonitorFunction({
    env: {},
    blobStoreFactory: () => {
      storeConstructions += 1;
      throw new Error('The disabled worker must not construct a Blob store.');
    },
    lookup: async () => {
      lookups += 1;
      return {};
    },
  });
  assert.deepEqual(result, {
    status: 'disabled',
    stopReason: 'disabled',
    processedDeliveries: 0,
    lookupDeliveries: 0,
    deferredDeliveries: 0,
  });
  assert.equal(storeConstructions, 0);
  assert.equal(lookups, 0);
});

test('a manual invocation from a non-published deploy cannot touch the site-wide store', async () => {
  let storeConstructions = 0;
  let lookups = 0;
  const result = await runScheduledMonitorFunction({
    env: readyEnv(),
    deploy: { context: 'deploy-preview', published: false },
    blobStoreFactory: () => {
      storeConstructions += 1;
      throw new Error('A preview invocation must not construct the site-wide Blob store.');
    },
    lookup: async () => {
      lookups += 1;
      return {};
    },
  });
  assert.deepEqual(result, {
    status: 'skipped',
    stopReason: 'non_published_deploy',
    processedDeliveries: 0,
    lookupDeliveries: 0,
    deferredDeliveries: 0,
  });
  assert.equal(storeConstructions, 0);
  assert.equal(lookups, 0);
});

test('malformed enabled configuration fails before Blob construction or lookup work', async () => {
  let storeConstructions = 0;
  let lookups = 0;
  await assert.rejects(runScheduledMonitorFunction({
    env: { [ENABLE_ENV]: '1' },
    blobStoreFactory: () => {
      storeConstructions += 1;
      return new FakeBlobStore();
    },
    lookup: async () => {
      lookups += 1;
      return {};
    },
  }), (error) => error.code === SCHEDULED_MONITOR_UNAVAILABLE_CODE);
  assert.equal(storeConstructions, 0);
  assert.equal(lookups, 0);
});

test('a ready worker constructs the one named store and runs an idle bounded cycle', async () => {
  const blobs = new FakeBlobStore();
  const names = [];
  const result = await runScheduledMonitorFunction({
    env: readyEnv(),
    blobStoreFactory: (name) => {
      names.push(name);
      return blobs;
    },
    lookup: async () => {
      throw new Error('An empty scheduled state must not perform a lookup.');
    },
  });
  assert.deepEqual(names, [SCHEDULED_MONITOR_STORE_NAME]);
  assert.deepEqual(result, {
    status: 'idle',
    stopReason: 'complete',
    processedDeliveries: 1,
    lookupDeliveries: 0,
    deferredDeliveries: 0,
  });
  assert.equal(blobs.reads, 1);
  assert.equal(blobs.writes, 0);
});

test('Blob provider construction failures remain explicit and do not start lookups', async () => {
  let lookups = 0;
  await assert.rejects(runScheduledMonitorFunction({
    env: readyEnv(),
    blobStoreFactory: () => {
      throw new Error('fixture Blob provider unavailable');
    },
    lookup: async () => {
      lookups += 1;
      return {};
    },
  }), /fixture Blob provider unavailable/i);
  assert.equal(lookups, 0);
});
