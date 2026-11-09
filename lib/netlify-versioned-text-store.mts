// Strong, bounded text reads and conditional writes over Netlify Blobs.
import { abortable } from './abort.mts';
import type { VersionedTextStore } from './versioned-text-store.mts';

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

function boundedNetlifyBlobFetch(signal: AbortSignal): typeof globalThis.fetch {
  return (input, init) => {
    signal.throwIfAborted();
    const requestSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    return globalThis.fetch(input, { ...init, signal: requestSignal ? AbortSignal.any([signal, requestSignal]) : signal });
  };
}

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

function cancelQuietly(reader: StreamReader | null, reason: string): void {
  if (!reader) return;
  // Cancellation is best effort; an uncooperative stream must not extend the
  // operation deadline or suppress its original failure.
  try { void reader.cancel(reason).catch(() => {}); } catch { /* Preserve the primary failure. */ }
}

function releaseQuietly(reader: StreamReader | null): void {
  try { reader?.releaseLock?.(); } catch { /* The stream is no longer used. */ }
}

async function readBoundedBlobText(value: unknown, maximumBytes: number, signal?: AbortSignal): Promise<string> {
  const reader = streamReader(value);
  if (!reader) throw new TypeError('Netlify Blobs returned an invalid versioned text entry.');
  const cancel = () => cancelQuietly(reader, 'versioned text Blob read cancelled');
  signal?.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  let completed = false;
  try {
    while (true) {
      const result = await abortable(() => reader.read(), signal);
      if (!result || typeof result !== 'object' || typeof result.done !== 'boolean') {
        cancelQuietly(reader, 'invalid Blob stream result');
        throw new TypeError('Netlify Blobs returned an invalid versioned text entry.');
      }
      if (result.done) {
        completed = true;
        break;
      }
      if (!(result.value instanceof Uint8Array)) {
        cancelQuietly(reader, 'invalid Blob stream chunk');
        throw new TypeError('Netlify Blobs returned an invalid versioned text entry.');
      }
      if (result.value.byteLength > maximumBytes - total) {
        cancelQuietly(reader, 'versioned text entry exceeded its byte bound');
        throw new TypeError('Netlify Blobs returned an invalid versioned text entry.');
      }
      if (result.value.byteLength === 0) continue;
      total += result.value.byteLength;
      chunks.push(result.value.slice());
    }
  } catch (cause) {
    if (!completed) cancelQuietly(reader, 'versioned text Blob read failed');
    throw cause;
  } finally {
    signal?.removeEventListener('abort', cancel);
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
    throw new TypeError('Netlify Blobs returned an invalid versioned text entry.');
  }
}

function createNetlifyBlobTextStore(store: NetlifyBlobStore, maximumBytes: number): VersionedTextStore {
  if (!validStore(store) || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error('A Netlify Blob store is required for versioned text.');
  }

  return {
    async read(key, options = {}) {
      if (!validBlobKey(key)) throw new Error('Versioned text Blob key is invalid.');
      const entry = await abortable(async () => {
        const value = await store.getWithMetadata(key, {
          consistency: 'strong',
          type: 'stream',
        });
        if (options.signal?.aborted) {
          const reader = streamReader(value?.data);
          cancelQuietly(reader, 'versioned text Blob response arrived after cancellation');
          releaseQuietly(reader);
          options.signal.throwIfAborted();
        }
        return value;
      }, options.signal);
      if (entry === null) return { value: null, version: null };
      if (!entry
        || typeof entry !== 'object'
        || Array.isArray(entry)
        || !validEtag(entry.etag)) {
        const reader = entry && typeof entry === 'object' && !Array.isArray(entry)
          ? streamReader(entry.data)
          : null;
        try {
          cancelQuietly(reader, 'invalid versioned text entry metadata');
        } finally {
          releaseQuietly(reader);
        }
        throw new TypeError('Netlify Blobs returned an invalid versioned text entry.');
      }
      return { value: await readBoundedBlobText(entry.data, maximumBytes, options.signal), version: entry.etag };
    },

    async compareAndSet(key, expectedVersion, nextValue, options = {}) {
      if (!validBlobKey(key)) throw new Error('Versioned text Blob key is invalid.');
      if (typeof nextValue !== 'string'
        || Buffer.byteLength(nextValue, 'utf8') > maximumBytes) {
        throw new Error('Versioned text Blob value is invalid.');
      }
      if (expectedVersion !== null && !validEtag(expectedVersion)) {
        throw new Error('Versioned text Blob version is invalid.');
      }
      const result = await abortable(() => store.set(
        key,
        nextValue,
        expectedVersion === null
          ? { onlyIfNew: true }
          : { onlyIfMatch: expectedVersion },
      ), options.signal);
      if (!result || typeof result !== 'object' || Array.isArray(result)
        || typeof result.modified !== 'boolean') {
        throw new Error('Netlify Blobs returned an invalid conditional-write result.');
      }
      return result.modified;
    },
  };
}

export {
  boundedNetlifyBlobFetch,
  createNetlifyBlobTextStore,
  MAX_BLOB_KEY_BYTES,
};
export type { NetlifyBlobStore };
