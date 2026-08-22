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
    options: { consistency: 'strong'; type: 'stream' },
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

type StreamReader = Readonly<{
  read: () => Promise<Readonly<{ done: unknown; value?: unknown }>>;
  cancel: (reason?: unknown) => Promise<unknown>;
  releaseLock?: () => void;
}>;

function streamReader(value: unknown): StreamReader | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const getReader = (value as { getReader?: unknown }).getReader;
  if (typeof getReader !== 'function') return null;
  try {
    const reader = getReader.call(value) as Partial<StreamReader>;
    return reader
      && typeof reader.read === 'function'
      && typeof reader.cancel === 'function'
      ? reader as StreamReader
      : null;
  } catch {
    return null;
  }
}

async function cancelQuietly(reader: StreamReader | null, reason: string): Promise<void> {
  if (!reader) return;
  try { await reader.cancel(reason); } catch { /* Preserve the primary validation failure. */ }
}

function releaseQuietly(reader: StreamReader | null): void {
  try { reader?.releaseLock?.(); } catch { /* The stream is no longer used. */ }
}

async function readBoundedBlobText(value: unknown): Promise<string> {
  const reader = streamReader(value);
  if (!reader) throw new Error('Netlify Blobs returned an invalid scheduled monitoring entry.');
  const chunks: Uint8Array[] = [];
  let total = 0;
  let completed = false;
  try {
    while (true) {
      const result = await reader.read();
      if (!result || typeof result !== 'object' || typeof result.done !== 'boolean') {
        await cancelQuietly(reader, 'invalid Blob stream result');
        throw new Error('Netlify Blobs returned an invalid scheduled monitoring entry.');
      }
      if (result.done) {
        completed = true;
        break;
      }
      if (!(result.value instanceof Uint8Array)) {
        await cancelQuietly(reader, 'invalid Blob stream chunk');
        throw new Error('Netlify Blobs returned an invalid scheduled monitoring entry.');
      }
      if (result.value.byteLength > MAX_ENVELOPE_BYTES - total) {
        await cancelQuietly(reader, 'scheduled monitoring entry exceeded its byte bound');
        throw new Error('Netlify Blobs returned an invalid scheduled monitoring entry.');
      }
      total += result.value.byteLength;
      chunks.push(result.value.slice());
    }
  } catch (cause) {
    if (!completed) await cancelQuietly(reader, 'scheduled monitoring Blob read failed');
    throw cause;
  } finally {
    releaseQuietly(reader);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Netlify Blobs returned an invalid scheduled monitoring entry.');
  }
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
        type: 'stream',
      });
      if (entry === null) return { value: null, version: null };
      if (!entry
        || typeof entry !== 'object'
        || Array.isArray(entry)
        || !validEtag(entry.etag)) {
        const reader = entry && typeof entry === 'object' && !Array.isArray(entry)
          ? streamReader(entry.data)
          : null;
        try {
          await cancelQuietly(reader, 'invalid scheduled monitoring entry metadata');
        } finally {
          releaseQuietly(reader);
        }
        throw new Error('Netlify Blobs returned an invalid scheduled monitoring entry.');
      }
      return { value: await readBoundedBlobText(entry.data), version: entry.etag };
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
