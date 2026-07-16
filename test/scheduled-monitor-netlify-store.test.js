const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  createNetlifyBlobVersionedTextStore,
  MAX_BLOB_KEY_BYTES,
} = require('../lib/scheduled-monitor-netlify-store.mts');
const { MAX_ENVELOPE_BYTES } = require('../lib/scheduled-monitor-crypto.mts');

class FakeBlobStore {
  constructor() {
    this.entry = null;
    this.reads = [];
    this.writes = [];
  }

  async getWithMetadata(key, options) {
    this.reads.push({ key, options });
    return this.entry;
  }

  async set(key, value, options) {
    this.writes.push({ key, value, options });
    return { modified: true, etag: '"next"' };
  }
}

describe('scheduled monitoring Netlify Blobs adapter', () => {
  test('uses a strongly consistent text read and maps a missing Blob to an empty snapshot', async () => {
    const blobs = new FakeBlobStore();
    const store = createNetlifyBlobVersionedTextStore(blobs);
    assert.deepEqual(await store.read('whoisleuth:scheduled-monitor'), {
      value: null,
      version: null,
    });
    assert.deepEqual(blobs.reads, [{
      key: 'whoisleuth:scheduled-monitor',
      options: { consistency: 'strong', type: 'text' },
    }]);
  });

  test('preserves bounded ciphertext and the opaque ETag returned by Netlify', async () => {
    const blobs = new FakeBlobStore();
    blobs.entry = { data: '{"ciphertext":"opaque"}', etag: 'W/"opaque-version"', metadata: {} };
    const store = createNetlifyBlobVersionedTextStore(blobs);
    assert.deepEqual(await store.read('state'), {
      value: '{"ciphertext":"opaque"}',
      version: 'W/"opaque-version"',
    });
  });

  test('creates only when absent and updates only when the observed ETag still matches', async () => {
    const blobs = new FakeBlobStore();
    const store = createNetlifyBlobVersionedTextStore(blobs);
    assert.equal(await store.compareAndSet('state', null, 'ciphertext-1'), true);
    assert.equal(await store.compareAndSet('state', '"v1"', 'ciphertext-2'), true);
    assert.deepEqual(blobs.writes, [
      { key: 'state', value: 'ciphertext-1', options: { onlyIfNew: true } },
      { key: 'state', value: 'ciphertext-2', options: { onlyIfMatch: '"v1"' } },
    ]);
  });

  test('returns a conditional-write conflict without retrying or overwriting unconditionally', async () => {
    const blobs = new FakeBlobStore();
    blobs.set = async (key, value, options) => {
      blobs.writes.push({ key, value, options });
      return { modified: false };
    };
    const store = createNetlifyBlobVersionedTextStore(blobs);
    assert.equal(await store.compareAndSet('state', '"stale"', 'ciphertext'), false);
    assert.deepEqual(blobs.writes[0].options, { onlyIfMatch: '"stale"' });
  });

  test('rejects malformed stores, Blob keys, entries, versions, values, and write responses', async () => {
    assert.throws(() => createNetlifyBlobVersionedTextStore({}), /Blob store is required/i);

    const blobs = new FakeBlobStore();
    const store = createNetlifyBlobVersionedTextStore(blobs);
    for (const key of ['', '/state', 'bad\nkey', 'x'.repeat(MAX_BLOB_KEY_BYTES + 1)]) {
      await assert.rejects(store.read(key), /Blob key is invalid/i);
    }

    for (const entry of [
      {},
      { data: null, etag: '"v1"' },
      { data: 'ciphertext', etag: null },
      { data: 'ciphertext', etag: 'bad\netag' },
      { data: 'x'.repeat(MAX_ENVELOPE_BYTES + 1), etag: '"v1"' },
    ]) {
      blobs.entry = entry;
      await assert.rejects(store.read('state'), /invalid scheduled monitoring entry/i);
    }

    await assert.rejects(store.compareAndSet('state', '', 'ciphertext'), /Blob version is invalid/i);
    await assert.rejects(
      store.compareAndSet('state', null, 'x'.repeat(MAX_ENVELOPE_BYTES + 1)),
      /Blob value is invalid/i,
    );
    blobs.set = async () => ({ modified: 'yes' });
    await assert.rejects(
      store.compareAndSet('state', null, 'ciphertext'),
      /invalid conditional-write result/i,
    );
  });

  test('propagates provider failures so repository retries remain bounded and visible', async () => {
    const blobs = new FakeBlobStore();
    blobs.getWithMetadata = async () => { throw new Error('provider unavailable'); };
    const store = createNetlifyBlobVersionedTextStore(blobs);
    await assert.rejects(store.read('state'), /provider unavailable/i);

    blobs.set = async () => { throw new Error('conditional write unavailable'); };
    await assert.rejects(
      store.compareAndSet('state', null, 'ciphertext'),
      /conditional write unavailable/i,
    );
  });
});
