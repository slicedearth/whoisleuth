// Strong, bounded text reads and conditional writes over Netlify Blobs.
import { abortable } from './abort.mts';

export type VersionedTextSnapshot = { value: string | null; version: string | null };
export type VersionedTextStore = {
  read: (key: string, options?: { signal?: AbortSignal }) => Promise<VersionedTextSnapshot>;
  compareAndSet: (key: string, expectedVersion: string | null, nextValue: string, options?: { signal?: AbortSignal }) => Promise<boolean>;
};
export type ConditionalVersionedTextReader = Pick<VersionedTextStore, 'read'> & {
  readIfChanged: (key: string, version: string, options?: { signal?: AbortSignal }) => Promise<VersionedTextSnapshot | 'unchanged'>;
};

export class InvalidVersionedTextEntry extends TypeError {
  constructor() { super('Netlify Blobs returned an invalid versioned text entry.'); }
}

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
    options: { consistency: 'strong'; type: 'stream'; etag?: string },
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

// Versions remain opaque for writes. Only a single strong HTTP validator is
// suitable for reusing bytes; weak, wildcard and non-HTTP versions are not.
function strongHttpEtag(value: string): boolean {
  return validEtag(value) && /^"[\u0021\u0023-\u007e\u0080-\u00ff]+"$/u.test(value);
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
  if (!reader) throw new InvalidVersionedTextEntry();
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
        throw new InvalidVersionedTextEntry();
      }
      if (result.done) {
        completed = true;
        break;
      }
      if (!(result.value instanceof Uint8Array)) {
        cancelQuietly(reader, 'invalid Blob stream chunk');
        throw new InvalidVersionedTextEntry();
      }
      if (result.value.byteLength > maximumBytes - total) {
        cancelQuietly(reader, 'versioned text entry exceeded its byte bound');
        throw new InvalidVersionedTextEntry();
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
    throw new InvalidVersionedTextEntry();
  }
}

function createNetlifyBlobTextStore(store: NetlifyBlobStore, maximumBytes: number): VersionedTextStore & ConditionalVersionedTextReader {
  if (!validStore(store) || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error('A Netlify Blob store is required for versioned text.');
  }

  function readBlob(key: string, signal?: AbortSignal): Promise<VersionedTextSnapshot>;
  function readBlob(key: string, signal: AbortSignal | undefined, etag: string): Promise<VersionedTextSnapshot | 'unchanged'>;
  async function readBlob(key: string, signal?: AbortSignal, etag?: string): Promise<VersionedTextSnapshot | 'unchanged'> {
    if (!validBlobKey(key)) throw new Error('Versioned text Blob key is invalid.');
    const entry = await abortable(async () => {
      const value = await store.getWithMetadata(key, {
        consistency: 'strong', type: 'stream', ...(etag === undefined ? {} : { etag }),
      });
      if (signal?.aborted) {
        const reader = streamReader(value?.data);
        cancelQuietly(reader, 'versioned text Blob response arrived after cancellation');
        releaseQuietly(reader);
        signal.throwIfAborted();
      }
      return value;
    }, signal);
    if (entry === null) return { value: null, version: null };
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !validEtag(entry.etag)) {
      const reader = entry && typeof entry === 'object' && !Array.isArray(entry) ? streamReader(entry.data) : null;
      try {
        cancelQuietly(reader, 'invalid versioned text entry metadata');
      } finally {
        releaseQuietly(reader);
      }
      throw new InvalidVersionedTextEntry();
    }
    // The SDK projects a 304 to a null stream. Require the same validator so
    // that missing data or an unrelated response cannot confirm the cache.
    if (etag !== undefined && entry.etag === etag && entry.data === null) return 'unchanged';
    return { value: await readBoundedBlobText(entry.data, maximumBytes, signal), version: entry.etag };
  }

  return {
    read(key, options = {}) {
      return readBlob(key, options.signal);
    },
    readIfChanged(key, version, options = {}) {
      return strongHttpEtag(version) ? readBlob(key, options.signal, version) : readBlob(key, options.signal);
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
