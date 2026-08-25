import { requiredValue } from './value-assertions.mts';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createNetlifyBlobVersionedTextStore,
  MAX_BLOB_KEY_BYTES,
} from '../lib/scheduled-monitor-netlify-store.mts';
import type { NetlifyBlobStore } from '../lib/scheduled-monitor-netlify-store.mts';
import { MAX_ENVELOPE_BYTES } from '../lib/scheduled-monitor-crypto.mts';

type BlobRead = Awaited<ReturnType<NetlifyBlobStore['getWithMetadata']>>;
type BlobReadCall = { key: string; options: { consistency: 'strong'; type: 'stream' } };
type BlobWriteCall = {
  key: string;
  value: string;
  options: { onlyIfNew: true } | { onlyIfMatch: string };
};

class FakeBlobStore implements NetlifyBlobStore {
  entry: BlobRead = null;
  reads: BlobReadCall[] = [];
  writes: BlobWriteCall[] = [];

  async getWithMetadata(
    key: string,
    options: BlobReadCall['options'],
  ): Promise<BlobRead> {
    this.reads.push({ key, options });
    return this.entry;
  }

  async set(
    key: string,
    value: string,
    options: BlobWriteCall['options'],
  ): Promise<{ modified: unknown }> {
    this.writes.push({ key, value, options });
    return { modified: true };
  }
}

function blobStream(value: string): ReadableStream<Uint8Array> {
  return new Blob([value]).stream();
}

describe('scheduled monitoring Netlify Blobs adapter', () => {
  test('uses a strongly consistent stream read and maps a missing Blob to an empty snapshot', async () => {
    const blobs = new FakeBlobStore();
    const store = createNetlifyBlobVersionedTextStore(blobs);
    assert.deepEqual(await store.read('whoisleuth:scheduled-monitor'), {
      value: null,
      version: null,
    });
    assert.deepEqual(blobs.reads, [{
      key: 'whoisleuth:scheduled-monitor',
      options: { consistency: 'strong', type: 'stream' },
    }]);
  });

  test('preserves bounded ciphertext and the opaque ETag returned by Netlify', async () => {
    const blobs = new FakeBlobStore();
    blobs.entry = { data: blobStream('{"ciphertext":"opaque"}'), etag: 'W/"opaque-version"' };
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
    assert.deepEqual(requiredValue(blobs.writes[0]).options, { onlyIfMatch: '"stale"' });
  });

  test('rejects malformed stores, Blob keys, entries, versions, values, and write responses', async () => {
    assert.throws(
      () => createNetlifyBlobVersionedTextStore({} as NetlifyBlobStore),
      /Blob store is required/i,
    );

    const blobs = new FakeBlobStore();
    const store = createNetlifyBlobVersionedTextStore(blobs);
    for (const key of ['', '/state', 'bad\nkey', 'x'.repeat(MAX_BLOB_KEY_BYTES + 1)]) {
      await assert.rejects(store.read(key), /Blob key is invalid/i);
    }

    for (const entry of [
      {},
      { data: null, etag: '"v1"' },
      { data: blobStream('ciphertext'), etag: null },
      { data: blobStream('ciphertext'), etag: 'bad\netag' },
      { data: new Blob([new Uint8Array([0xc3, 0x28])]).stream(), etag: '"v1"' },
    ]) {
      blobs.entry = entry as NonNullable<BlobRead>;
      await assert.rejects(store.read('state'), /invalid scheduled monitoring entry/i);
    }

    const invalidMetadataStream = blobStream('ciphertext');
    blobs.entry = { data: invalidMetadataStream, etag: null } as NonNullable<BlobRead>;
    await assert.rejects(store.read('state'), /invalid scheduled monitoring entry/i);
    assert.equal(invalidMetadataStream.locked, false);

    let pulls = 0;
    let cancelled = false;
    blobs.entry = {
      etag: '"v1"',
      data: new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          controller.enqueue(new Uint8Array(pulls === 1 ? MAX_ENVELOPE_BYTES : 1));
        },
        cancel() { cancelled = true; },
      }),
    };
    await assert.rejects(store.read('state'), /invalid scheduled monitoring entry/i);
    assert.ok(pulls >= 2 && pulls <= 3);
    assert.equal(cancelled, true);

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
