// Netlify Blobs adapter for the provider-neutral scheduled-monitoring
// repository. The runtime owns store construction and credentials; this
// boundary requests strong reads and maps ETag preconditions onto the
// repository's bounded compare-and-set contract.

import { MAX_ENVELOPE_BYTES } from './scheduled-monitor-crypto.mts';
import type { VersionedTextStore } from './scheduled-monitor-repository.mts';

type NetlifyBlobReadResult = {
  data: unknown;
  etag?: unknown;
};

type NetlifyBlobWriteResult = {
  modified: unknown;
};

type NetlifyBlobStore = {
  getWithMetadata: (
    key: string,
    options: { consistency: 'strong'; type: 'text' },
  ) => Promise<NetlifyBlobReadResult | null>;
  set: (
    key: string,
    value: string,
    options: { onlyIfNew: true } | { onlyIfMatch: string },
  ) => Promise<NetlifyBlobWriteResult>;
};

const MAX_BLOB_KEY_BYTES = 600;
const MAX_ETAG_LENGTH = 256;
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;

function validBlobKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && !value.startsWith('/')
    && !CONTROL_RE.test(value)
    && Buffer.byteLength(value, 'utf8') <= MAX_BLOB_KEY_BYTES;
}

function validEtag(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_ETAG_LENGTH
    && !CONTROL_RE.test(value);
}

function validStore(value: unknown): value is NetlifyBlobStore {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<NetlifyBlobStore>;
  return typeof candidate.getWithMetadata === 'function' && typeof candidate.set === 'function';
}

function createNetlifyBlobVersionedTextStore(store: NetlifyBlobStore): VersionedTextStore {
  if (!validStore(store)) {
    throw new Error('A Netlify Blob store is required for scheduled monitoring.');
  }

  return {
    async read(key) {
      if (!validBlobKey(key)) throw new Error('Scheduled monitoring Blob key is invalid.');
      const entry = await store.getWithMetadata(key, {
        consistency: 'strong',
        type: 'text',
      });
      if (entry === null) return { value: null, version: null };
      if (!entry
        || typeof entry !== 'object'
        || Array.isArray(entry)
        || typeof entry.data !== 'string'
        || Buffer.byteLength(entry.data, 'utf8') > MAX_ENVELOPE_BYTES
        || !validEtag(entry.etag)) {
        throw new Error('Netlify Blobs returned an invalid scheduled monitoring entry.');
      }
      return { value: entry.data, version: entry.etag };
    },

    async compareAndSet(key, expectedVersion, nextValue) {
      if (!validBlobKey(key)) throw new Error('Scheduled monitoring Blob key is invalid.');
      if (typeof nextValue !== 'string'
        || Buffer.byteLength(nextValue, 'utf8') > MAX_ENVELOPE_BYTES) {
        throw new Error('Scheduled monitoring Blob value is invalid.');
      }
      if (expectedVersion !== null && !validEtag(expectedVersion)) {
        throw new Error('Scheduled monitoring Blob version is invalid.');
      }
      const result = await store.set(
        key,
        nextValue,
        expectedVersion === null
          ? { onlyIfNew: true }
          : { onlyIfMatch: expectedVersion },
      );
      if (!result || typeof result !== 'object' || Array.isArray(result)
        || typeof result.modified !== 'boolean') {
        throw new Error('Netlify Blobs returned an invalid conditional-write result.');
      }
      return result.modified;
    },
  };
}

export {
  createNetlifyBlobVersionedTextStore,
  MAX_BLOB_KEY_BYTES,
};
export type { NetlifyBlobStore };
