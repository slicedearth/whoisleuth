import { scanBoundedJson } from './bounded-json.ts';

export const LOCAL_DATA_DATABASE_NAME = 'whoisleuth-browser-data-v1';
export const LOCAL_DATA_DATABASE_VERSION = 1;
export const LOCAL_DATA_RECORD_STORE = 'records';
export const LOCAL_DATA_MANIFEST_STORE = 'manifests';
export const LOCAL_DATA_OPERATION_TIMEOUT_MS = 10_000;
export const MAX_LOCAL_DATA_OPERATION_TIMEOUT_MS = 60_000;
export const MAX_LOCAL_DATA_COLLECTIONS = 16;
export const MAX_LOCAL_DATA_RECORDS_PER_COLLECTION = 2_000;
export const MAX_LOCAL_DATA_RECORD_ID_LENGTH = 256;
export const MAX_LOCAL_DATA_CODEC_ID_LENGTH = 64;
export const MAX_LOCAL_DATA_UPDATE_ATTEMPTS = 3;

const RECORD_COLLECTION_INDEX = 'collection';
const RECORD_ORDER_INDEX = 'collection-order';
const TEXT_ENCODER = new TextEncoder();

type BrowserStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type LocalDataRecord = Readonly<{
  id: string;
  value: unknown;
}>;

export type LocalDataCollectionDefinition<T> = Readonly<{
  id: string;
  label: string;
  legacyKey: string;
  schemaVersion: number;
  minimumReadableVersion?: number;
  acceptsUnversionedLegacy?: boolean;
  maximumBytes: number;
  maximumRecords: number;
  empty: () => T;
  acceptLegacyRoot: (raw: unknown) => boolean;
  normalize: (raw: unknown) => T;
  version: (raw: unknown) => number | null;
  serialize: (document: T) => string;
  split: (document: T) => LocalDataRecord[];
  join: (records: LocalDataRecord[], schemaVersion: number) => unknown;
}>;

// Heterogeneous batch operations cannot retain each collection's private
// document type in one array. Method syntax keeps those parameters correlated
// at the concrete definition while the provider treats mixed documents as
// unknown until the owning definition normalizes them.
export type AnyLocalDataCollectionDefinition = Readonly<{
  id: string;
  label: string;
  legacyKey: string;
  schemaVersion: number;
  minimumReadableVersion?: number;
  acceptsUnversionedLegacy?: boolean;
  maximumBytes: number;
  maximumRecords: number;
  empty(): unknown;
  acceptLegacyRoot(raw: unknown): boolean;
  normalize(raw: unknown): unknown;
  version(raw: unknown): number | null;
  serialize(document: unknown): string;
  split(document: unknown): LocalDataRecord[];
  join(records: LocalDataRecord[], schemaVersion: number): unknown;
}>;

export type EncodedLocalDataRecord = Readonly<{
  lookupKey: string;
  payload: string;
}>;

export type DecodedLocalDataRecord = Readonly<{
  id: string;
  value: unknown;
}>;

/**
 * The provider owns persistence while the codec owns record confidentiality and
 * lookup-key disclosure. The initial codec is deliberately plaintext. A future
 * encrypted vault can supply authenticated encryption and blind lookup keys
 * without changing the IndexedDB schema or collection models.
 */
export interface BrowserLocalDataCodec {
  readonly id: string;
  encode(input: Readonly<{ collection: string; id: string; value: unknown }>): Promise<EncodedLocalDataRecord>;
  decode(input: Readonly<{ collection: string; lookupKey: string; payload: string }>): Promise<DecodedLocalDataRecord>;
}

export type BrowserLocalStoredRecord = Readonly<{
  key: [string, string];
  collection: string;
  lookupKey: string;
  ordinal: number;
  codec: string;
  payload: string;
  payloadBytes: number;
}>;

export type BrowserLocalCollectionManifest = Readonly<{
  collection: string;
  schemaVersion: number;
  codec: string;
  revision: number;
  recordCount: number;
  serializedBytes: number;
  digest: string;
  source: 'empty' | 'legacy-localstorage' | 'application';
  updatedAt: string;
  legacyKey: string;
  legacyDigest: string | null;
}>;

type PreparedCollection = Readonly<{
  definition: AnyLocalDataCollectionDefinition;
  records: BrowserLocalStoredRecord[];
  serializedBytes: number;
  digest: string;
  source: BrowserLocalCollectionManifest['source'];
  legacyDigest: string | null;
}>;

type CollectionSnapshot<T> = Readonly<{
  document: T;
  manifest: BrowserLocalCollectionManifest;
}>;

type BrowserLocalCommitState = 'confirmed' | 'recovering' | 'unknown';
type ExpectedManifest = BrowserLocalCollectionManifest | null;

function collectionContentMatches(
  prepared: PreparedCollection,
  manifest: BrowserLocalCollectionManifest,
  codec: string,
): boolean {
  return manifest.schemaVersion === prepared.definition.schemaVersion
    && manifest.codec === codec
    && manifest.recordCount === prepared.records.length
    && manifest.serializedBytes === prepared.serializedBytes
    && manifest.digest === prepared.digest;
}

function manifestMatchesExpected(
  manifest: BrowserLocalCollectionManifest | undefined,
  expected: ExpectedManifest,
): boolean {
  if (expected === null) return manifest === undefined;
  return manifest?.collection === expected.collection
    && manifest.schemaVersion === expected.schemaVersion
    && manifest.codec === expected.codec
    && manifest.revision === expected.revision
    && manifest.recordCount === expected.recordCount
    && manifest.serializedBytes === expected.serializedBytes
    && manifest.digest === expected.digest
    && manifest.source === expected.source
    && manifest.updatedAt === expected.updatedAt
    && manifest.legacyKey === expected.legacyKey
    && manifest.legacyDigest === expected.legacyDigest;
}

export type BrowserLocalDataInitialization = Readonly<{
  state: 'ready';
  databaseName: string;
  migratedCollections: readonly string[];
  retainedLegacyKeys: readonly string[];
  codec: string;
}>;

export type LegacyRollbackCopyResult = Readonly<{
  collectionCount: number;
  serializedBytes: number;
  keys: readonly string[];
}>;

export class BrowserLocalDataError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = 'BrowserLocalDataError';
    this.code = code;
  }
}

export function isExpectedBrowserLocalDataFailure(cause: unknown): boolean {
  return cause instanceof BrowserLocalDataError || cause instanceof DOMException;
}

function boundedIdentifier(value: unknown, label: string, maximumLength: number): string {
  if (typeof value !== 'string') throw new BrowserLocalDataError('INVALID_LOCAL_DATA_ID', `${label} must be a string.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new BrowserLocalDataError('INVALID_LOCAL_DATA_ID', `${label} is invalid or exceeds its bound.`);
  }
  return normalized;
}

function byteLength(value: string): number {
  return TEXT_ENCODER.encode(value).byteLength;
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(value);
}

function canonicalRecordContent(records: readonly BrowserLocalStoredRecord[]): string {
  return JSON.stringify(records.map((record) => [
    record.lookupKey,
    record.ordinal,
    record.codec,
    record.payload,
    record.payloadBytes,
  ]));
}

function assertSerializedBound(value: string, maximumBytes: number, label: string): number {
  if (typeof value !== 'string') throw new BrowserLocalDataError('INVALID_LOCAL_DATA', `${label} did not serialize to text.`);
  const bytes = byteLength(value);
  if (bytes > maximumBytes) {
    throw new BrowserLocalDataError('LOCAL_DATA_QUOTA', `${label} exceeds its ${maximumBytes}-byte application limit.`);
  }
  return bytes;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '');
}

async function sha256(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new BrowserLocalDataError('LOCAL_DATA_CRYPTO_UNAVAILABLE', 'Browser cryptography is unavailable, so local-data integrity cannot be verified.');
  return base64Url(new Uint8Array(await subtle.digest('SHA-256', TEXT_ENCODER.encode(value))));
}

function withDeadline<T>(label: string, task: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new BrowserLocalDataError('LOCAL_DATA_TIMEOUT', `${label} timed out.`)), timeoutMs);
    task.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (cause) => { clearTimeout(timer); reject(cause); },
    );
  });
}

function requestResult<T>(request: IDBRequest<T>, label: string, timeoutMs: number): Promise<T> {
  return withDeadline(label, new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new BrowserLocalDataError('LOCAL_DATA_REQUEST_FAILED', `${label} failed.`));
  }), timeoutMs);
}

function transactionComplete(transaction: IDBTransaction, label: string, timeoutMs: number): Promise<void> {
  const completion = withDeadline(label, new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new BrowserLocalDataError('LOCAL_DATA_TRANSACTION_ABORTED', `${label} was aborted.`));
    transaction.onerror = () => { /* onabort carries the stable terminal failure */ };
  }), timeoutMs);
  // Some operations deliberately await one or more request results before
  // awaiting the transaction. Observe an earlier transaction failure now so a
  // stalled renderer cannot surface it as an unhandled rejection; callers
  // still receive the original rejection when they await `completion`.
  void completion.catch(() => undefined);
  return completion;
}

function readBoundedStoredRecords<T>(
  index: IDBIndex,
  definition: LocalDataCollectionDefinition<T>,
  codec: string,
  timeoutMs: number,
): Promise<BrowserLocalStoredRecord[]> {
  const label = `Reading ${definition.label}`;
  return withDeadline(label, new Promise<BrowserLocalStoredRecord[]>((resolve, reject) => {
    const records: BrowserLocalStoredRecord[] = [];
    const lookupKeys = new Set<string>();
    const maximumEncodedBytes = definition.maximumBytes * 2;
    let retainedBytes = 0;
    const request = index.openCursor(definition.id);
    request.onerror = () => reject(request.error || new BrowserLocalDataError('LOCAL_DATA_REQUEST_FAILED', `${label} failed.`));
    request.onsuccess = () => {
      try {
        const cursor = request.result;
        if (!cursor) {
          resolve(records);
          return;
        }
        if (records.length >= definition.maximumRecords) {
          throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', `${definition.label} exceeds its bounded record count.`);
        }
        const record = cursor.value as BrowserLocalStoredRecord;
        if (!record || typeof record !== 'object'
          || record.collection !== definition.id
          || !Array.isArray(record.key)
          || record.key.length !== 2
          || record.key[0] !== definition.id
          || record.key[1] !== record.lookupKey
          || typeof record.lookupKey !== 'string'
          || !record.lookupKey
          || record.lookupKey.length > MAX_LOCAL_DATA_RECORD_ID_LENGTH
          || /[\u0000-\u001f\u007f]/u.test(record.lookupKey)
          || lookupKeys.has(record.lookupKey)
          || !Number.isSafeInteger(record.ordinal)
          || record.ordinal < 0
          || record.ordinal >= definition.maximumRecords
          || record.codec !== codec
          || typeof record.payload !== 'string'
          || !Number.isSafeInteger(record.payloadBytes)
          || record.payloadBytes < 0
          || record.payloadBytes > maximumEncodedBytes - retainedBytes
          || record.payload.length > maximumEncodedBytes - retainedBytes) {
          throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', `${definition.label} contains an invalid stored record.`);
        }
        const actualBytes = byteLength(record.payload);
        if (record.payloadBytes !== actualBytes || actualBytes > maximumEncodedBytes - retainedBytes) {
          throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', `${definition.label} contains an invalid stored record.`);
        }
        lookupKeys.add(record.lookupKey);
        retainedBytes += actualBytes;
        records.push(record);
        cursor.continue();
      } catch (cause) {
        reject(cause);
      }
    };
  }), timeoutMs);
}

function normalizeDefinition<T>(definition: LocalDataCollectionDefinition<T>): LocalDataCollectionDefinition<T> {
  boundedIdentifier(definition.id, 'Collection identifier', 64);
  boundedIdentifier(definition.label, 'Collection label', 100);
  boundedIdentifier(definition.legacyKey, 'Legacy storage key', 160);
  if (!Number.isSafeInteger(definition.schemaVersion) || definition.schemaVersion < 1) {
    throw new BrowserLocalDataError('INVALID_LOCAL_DATA_DEFINITION', `${definition.label} has an invalid schema version.`);
  }
  if (definition.minimumReadableVersion !== undefined
    && (!Number.isSafeInteger(definition.minimumReadableVersion)
      || definition.minimumReadableVersion < 1
      || definition.minimumReadableVersion > definition.schemaVersion)) {
    throw new BrowserLocalDataError('INVALID_LOCAL_DATA_DEFINITION', `${definition.label} has an invalid minimum readable schema version.`);
  }
  if (definition.acceptsUnversionedLegacy !== undefined && typeof definition.acceptsUnversionedLegacy !== 'boolean') {
    throw new BrowserLocalDataError('INVALID_LOCAL_DATA_DEFINITION', `${definition.label} has an invalid unversioned-data policy.`);
  }
  if (!Number.isSafeInteger(definition.maximumBytes) || definition.maximumBytes < 1) {
    throw new BrowserLocalDataError('INVALID_LOCAL_DATA_DEFINITION', `${definition.label} has an invalid byte bound.`);
  }
  if (!Number.isSafeInteger(definition.maximumRecords) || definition.maximumRecords < 0 || definition.maximumRecords > MAX_LOCAL_DATA_RECORDS_PER_COLLECTION) {
    throw new BrowserLocalDataError('INVALID_LOCAL_DATA_DEFINITION', `${definition.label} has an invalid record bound.`);
  }
  if (typeof definition.acceptLegacyRoot !== 'function') {
    throw new BrowserLocalDataError('INVALID_LOCAL_DATA_DEFINITION', `${definition.label} has no legacy-root validator.`);
  }
  return definition;
}

export const plaintextJsonCodec: BrowserLocalDataCodec = Object.freeze({
  id: 'json-v1',
  async encode(input: Readonly<{ collection: string; id: string; value: unknown }>) {
    const id = boundedIdentifier(input.id, 'Record identifier', MAX_LOCAL_DATA_RECORD_ID_LENGTH);
    return { lookupKey: id, payload: JSON.stringify({ id, value: input.value }) };
  },
  async decode(input: Readonly<{ collection: string; lookupKey: string; payload: string }>) {
    scanBoundedJson(input.payload);
    const parsed = JSON.parse(input.payload) as { id?: unknown; value?: unknown };
    const id = boundedIdentifier(parsed?.id, 'Decoded record identifier', MAX_LOCAL_DATA_RECORD_ID_LENGTH);
    if (id !== input.lookupKey) {
      throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', 'A browser-local record lookup key does not match its payload.');
    }
    return { id, value: parsed.value };
  },
});

export class BrowserLocalDataProvider {
  readonly databaseName: string;
  readonly codec: BrowserLocalDataCodec;
  readonly timeoutMs: number;

  #factory: IDBFactory;
  #storage: BrowserStorage;
  #now: () => Date;
  #databasePromise: Promise<IDBDatabase> | null = null;
  #initializationPromise: Promise<BrowserLocalDataInitialization> | null = null;
  #definitions = new Map<string, AnyLocalDataCollectionDefinition>();
  #databaseInvalidated = false;
  #commitState: BrowserLocalCommitState = 'confirmed';

  constructor(options: Readonly<{
    databaseName?: string;
    indexedDB?: IDBFactory;
    storage?: BrowserStorage;
    codec?: BrowserLocalDataCodec;
    timeoutMs?: number;
    now?: () => Date;
  }> = {}) {
    let factory: IDBFactory | undefined;
    let storage: BrowserStorage | undefined;
    try {
      factory = options.indexedDB || globalThis.indexedDB;
      storage = options.storage || globalThis.localStorage;
    } catch (cause) {
      throw new BrowserLocalDataError('LOCAL_DATA_UNSUPPORTED', 'Browser-local storage is unavailable in this context.', { cause });
    }
    if (!factory) throw new BrowserLocalDataError('LOCAL_DATA_UNSUPPORTED', 'IndexedDB is unavailable in this browser.');
    if (!storage) throw new BrowserLocalDataError('LOCAL_DATA_UNSUPPORTED', 'Legacy browser storage is unavailable for safe migration.');
    this.databaseName = boundedIdentifier(options.databaseName || LOCAL_DATA_DATABASE_NAME, 'Database name', 160);
    this.codec = options.codec || plaintextJsonCodec;
    boundedIdentifier(this.codec.id, 'Codec identifier', MAX_LOCAL_DATA_CODEC_ID_LENGTH);
    const timeoutMs = options.timeoutMs ?? LOCAL_DATA_OPERATION_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_LOCAL_DATA_OPERATION_TIMEOUT_MS) {
      throw new BrowserLocalDataError(
        'INVALID_LOCAL_DATA_TIMEOUT',
        `Browser-local operations require a timeout between 1 and ${MAX_LOCAL_DATA_OPERATION_TIMEOUT_MS} milliseconds.`,
      );
    }
    this.timeoutMs = timeoutMs;
    this.#factory = factory;
    this.#storage = storage;
    this.#now = options.now || (() => new Date());
  }

  async initialize(definitions: readonly AnyLocalDataCollectionDefinition[]): Promise<BrowserLocalDataInitialization> {
    if (this.#initializationPromise) return this.#initializationPromise;
    if (!Array.isArray(definitions) || definitions.length < 1 || definitions.length > MAX_LOCAL_DATA_COLLECTIONS) {
      throw new BrowserLocalDataError('INVALID_LOCAL_DATA_DEFINITION', `Local data requires between 1 and ${MAX_LOCAL_DATA_COLLECTIONS} collection definitions.`);
    }
    const normalized = definitions.map(normalizeDefinition);
    if (new Set(normalized.map((definition) => definition.id)).size !== normalized.length) {
      throw new BrowserLocalDataError('INVALID_LOCAL_DATA_DEFINITION', 'Local data collection identifiers must be unique.');
    }
    this.#definitions = new Map(normalized.map((definition) => [definition.id, definition]));
    this.#initializationPromise = this.#initialize(normalized).catch((cause) => {
      this.#initializationPromise = null;
      throw cause;
    });
    return this.#initializationPromise;
  }

  async read<T>(definition: LocalDataCollectionDefinition<T>): Promise<T> {
    await this.#requireDefinition(definition);
    return (await this.#readSnapshot(definition)).document;
  }

  async update<T, R>(
    definition: LocalDataCollectionDefinition<T>,
    updater: (current: T) => Readonly<{ document: T; result: R }>,
  ): Promise<R> {
    await this.#requireDefinition(definition);
    this.#requireConfirmedCommitState();
    for (let attempt = 1; attempt <= MAX_LOCAL_DATA_UPDATE_ATTEMPTS; attempt++) {
      this.#requireConfirmedCommitState();
      const snapshot = await this.#readSnapshot(definition);
      this.#requireConfirmedCommitState();
      const updated = updater(snapshot.document);
      const prepared = await this.#prepare(definition, updated.document, 'application', snapshot.manifest.legacyDigest);
      if (collectionContentMatches(prepared, snapshot.manifest, this.codec.id)) return updated.result;
      try {
        this.#requireConfirmedCommitState();
        await this.#commit([prepared], new Map([[definition.id, snapshot.manifest]]));
        return updated.result;
      } catch (cause) {
        if (!(cause instanceof BrowserLocalDataError) || cause.code !== 'LOCAL_DATA_CONFLICT' || attempt === MAX_LOCAL_DATA_UPDATE_ATTEMPTS) throw cause;
      }
    }
    throw new BrowserLocalDataError('LOCAL_DATA_CONFLICT', 'Browser-local data changed repeatedly in another tab. Try again.');
  }

  async updateMany<R>(
    definitions: readonly AnyLocalDataCollectionDefinition[],
    updater: (documents: ReadonlyMap<string, unknown>) => Readonly<{
      documents: ReadonlyMap<string, unknown>;
      result: R;
    }>,
  ): Promise<R> {
    for (const definition of definitions) await this.#requireDefinition(definition);
    this.#requireConfirmedCommitState();
    for (let attempt = 1; attempt <= MAX_LOCAL_DATA_UPDATE_ATTEMPTS; attempt++) {
      this.#requireConfirmedCommitState();
      const snapshots = await Promise.all(definitions.map((definition) => this.#readSnapshot(definition)));
      this.#requireConfirmedCommitState();
      const current = new Map<string, unknown>();
      for (let index = 0; index < definitions.length; index++) {
        const definition = definitions[index];
        const snapshot = snapshots[index];
        if (!definition || !snapshot) {
          throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', 'A browser-local batch snapshot is incomplete.');
        }
        current.set(definition.id, snapshot.document);
      }
      const updated = updater(current);
      const prepared: PreparedCollection[] = [];
      for (let index = 0; index < definitions.length; index++) {
        const definition = definitions[index];
        const snapshot = snapshots[index];
        if (!definition || !snapshot) {
          throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', 'A browser-local batch snapshot is incomplete.');
        }
        if (!updated.documents.has(definition.id)) {
          throw new BrowserLocalDataError('INVALID_LOCAL_DATA_UPDATE', `The ${definition.label} batch update did not return a document.`);
        }
        prepared.push(await this.#prepare(definition, updated.documents.get(definition.id), 'application', snapshot.manifest.legacyDigest));
      }
      const expectedManifests = new Map<string, ExpectedManifest>();
      for (let index = 0; index < definitions.length; index++) {
        const definition = definitions[index];
        const snapshot = snapshots[index];
        if (!definition || !snapshot) {
          throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', 'A browser-local batch snapshot is incomplete.');
        }
        expectedManifests.set(definition.id, snapshot.manifest);
      }
      const changed = prepared.filter((item, index) => {
        const snapshot = snapshots[index];
        return !snapshot || !collectionContentMatches(item, snapshot.manifest, this.codec.id);
      });
      if (!changed.length) return updated.result;
      try {
        this.#requireConfirmedCommitState();
        await this.#commit(changed, expectedManifests);
        return updated.result;
      } catch (cause) {
        if (!(cause instanceof BrowserLocalDataError) || cause.code !== 'LOCAL_DATA_CONFLICT' || attempt === MAX_LOCAL_DATA_UPDATE_ATTEMPTS) throw cause;
      }
    }
    throw new BrowserLocalDataError('LOCAL_DATA_CONFLICT', 'Browser-local data changed repeatedly in another tab. Try again.');
  }

  async close(): Promise<void> {
    if (!this.#databasePromise) return;
    try { (await this.#databasePromise).close(); } finally {
      this.#databasePromise = null;
      this.#initializationPromise = null;
      this.#databaseInvalidated = false;
      this.#commitState = 'confirmed';
    }
  }

  #requireConfirmedCommitState(): void {
    if (this.#commitState !== 'confirmed') {
      throw new BrowserLocalDataError(
        'LOCAL_DATA_COMMIT_UNKNOWN',
        this.#commitState === 'recovering'
          ? 'A browser-local write is still being reconciled. Wait for it to finish before retrying any browser-local change.'
          : 'A browser-local write may have been saved, but its committed state could not be verified. Reload before retrying any browser-local change.',
      );
    }
  }

  async restoreLegacyCopies(definitions: readonly AnyLocalDataCollectionDefinition[]): Promise<LegacyRollbackCopyResult> {
    for (const definition of definitions) await this.#requireDefinition(definition);
    const documents = await Promise.all(definitions.map((definition) => this.read(definition)));
    const copies = definitions.map((definition, index) => {
      const serialized = definition.serialize(definition.normalize(documents[index]));
      return {
        key: definition.legacyKey,
        value: serialized,
        bytes: assertSerializedBound(serialized, definition.maximumBytes, definition.label),
      };
    });
    let snapshot: Map<string, string | null>;
    try { snapshot = new Map(copies.map((copy) => [copy.key, this.#storage.getItem(copy.key)])); }
    catch (cause) {
      throw new BrowserLocalDataError('LOCAL_DATA_LEGACY_UNAVAILABLE', 'Could not read the legacy rollback copy before updating it.', { cause });
    }
    const applied: Array<{ key: string; value: string }> = [];
    try {
      for (const copy of copies) {
        this.#storage.setItem(copy.key, copy.value);
        applied.push({ key: copy.key, value: copy.value });
      }
    } catch (cause) {
      let concurrentChange = false;
      try {
        for (let index = applied.length - 1; index >= 0; index -= 1) {
          const copy = applied[index]!;
          if (this.#storage.getItem(copy.key) !== copy.value) {
            concurrentChange = true;
            continue;
          }
          const previous = snapshot.get(copy.key) ?? null;
          if (previous === null) this.#storage.removeItem(copy.key);
          else this.#storage.setItem(copy.key, previous);
        }
      } catch (rollbackCause) {
        throw new BrowserLocalDataError('LOCAL_DATA_LEGACY_ROLLBACK_FAILED', 'Could not save or fully restore the legacy rollback copy. Download a workspace backup before changing this browser data.', { cause: rollbackCause });
      }
      if (concurrentChange) {
        throw new BrowserLocalDataError('LOCAL_DATA_CONFLICT', 'The legacy rollback copy changed in another tab while it was being saved. Concurrent data was preserved; retry after reviewing the current browser state.', { cause });
      }
      if (cause instanceof DOMException && cause.name === 'QuotaExceededError') {
        throw new BrowserLocalDataError('LOCAL_DATA_QUOTA', 'The current workspace is too large for a legacy local-storage rollback copy. Download a workspace backup instead.', { cause });
      }
      throw new BrowserLocalDataError('LOCAL_DATA_LEGACY_WRITE_FAILED', 'Could not update the legacy rollback copy. Browser storage may be unavailable.', { cause });
    }
    return Object.freeze({
      collectionCount: copies.length,
      serializedBytes: copies.reduce((sum, copy) => sum + copy.bytes, 0),
      keys: Object.freeze(copies.map((copy) => copy.key)),
    });
  }

  async #requireDefinition<T>(definition: LocalDataCollectionDefinition<T>): Promise<void> {
    if (!this.#initializationPromise) throw new BrowserLocalDataError('LOCAL_DATA_NOT_INITIALIZED', 'Browser-local data has not been initialised.');
    await this.#initializationPromise;
    if (this.#definitions.get(definition.id) !== definition) {
      throw new BrowserLocalDataError('INVALID_LOCAL_DATA_DEFINITION', `The ${definition.label} definition is not registered with this provider.`);
    }
  }

  async #initialize(definitions: readonly AnyLocalDataCollectionDefinition[]): Promise<BrowserLocalDataInitialization> {
    const database = await this.#database();
    const transaction = database.transaction(LOCAL_DATA_MANIFEST_STORE, 'readonly');
    const done = transactionComplete(transaction, 'Reading local-data manifests', this.timeoutMs);
    const manifestStore = transaction.objectStore(LOCAL_DATA_MANIFEST_STORE);
    const manifests = await Promise.all(definitions.map((definition) => requestResult(
      manifestStore.get(definition.id) as IDBRequest<BrowserLocalCollectionManifest | undefined>,
      `Reading the ${definition.label} manifest`,
      this.timeoutMs,
    )));
    await done;

    const missing = definitions.filter((_definition, index) => !manifests[index]);
    const existingSnapshots = new Map<string, CollectionSnapshot<unknown>>();
    for (let index = 0; index < definitions.length; index++) {
      const definition = definitions[index];
      if (!definition) throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', 'A browser-local definition is missing.');
      const manifest = manifests[index];
      if (!manifest) continue;
      existingSnapshots.set(definition.id, await this.#readSnapshot(definition));
    }
    const migratedCollections: string[] = [];
    const retainedLegacyKeys: string[] = [];
    if (missing.length) {
      const prepared: PreparedCollection[] = [];
      for (const definition of missing) {
        let raw: string | null;
        try { raw = this.#storage.getItem(definition.legacyKey); }
        catch (cause) {
          throw new BrowserLocalDataError('LOCAL_DATA_LEGACY_UNAVAILABLE', `Could not read legacy ${definition.label} data for migration.`, { cause });
        }
        const document = this.#normalizeLegacy(definition, raw);
        prepared.push(await this.#prepare(
          definition,
          document,
          raw === null ? 'empty' : 'legacy-localstorage',
          raw === null ? null : await sha256(raw),
        ));
        if (raw !== null) retainedLegacyKeys.push(definition.legacyKey);
      }
      try {
        await this.#commit(prepared, new Map(definitions.map((definition) => [
          definition.id,
          existingSnapshots.get(definition.id)?.manifest ?? null,
        ])));
        migratedCollections.push(...missing.map((definition) => definition.id));
      } catch (cause) {
        if (!(cause instanceof BrowserLocalDataError) || cause.code !== 'LOCAL_DATA_CONFLICT') throw cause;
      }
    }

    for (const definition of definitions) {
      const snapshot = await this.#readSnapshot(definition);
      if (snapshot.manifest.schemaVersion < definition.schemaVersion) {
        const prepared = await this.#prepare(definition, snapshot.document, 'application', snapshot.manifest.legacyDigest);
        try { await this.#commit([prepared], new Map([[definition.id, snapshot.manifest]])); }
        catch (cause) {
          if (!(cause instanceof BrowserLocalDataError) || cause.code !== 'LOCAL_DATA_CONFLICT') throw cause;
          await this.#readSnapshot(definition);
        }
      }
    }
    return Object.freeze({
      state: 'ready',
      databaseName: this.databaseName,
      migratedCollections: Object.freeze(migratedCollections.slice()),
      retainedLegacyKeys: Object.freeze(retainedLegacyKeys.slice()),
      codec: this.codec.id,
    });
  }

  #normalizeLegacy<T>(definition: LocalDataCollectionDefinition<T>, raw: string | null): T {
    if (raw === null) return definition.normalize(definition.empty());
    if (byteLength(raw) > definition.maximumBytes) {
      throw new BrowserLocalDataError('LOCAL_DATA_LEGACY_TOO_LARGE', `Legacy ${definition.label} data exceeds its application limit.`);
    }
    let parsed: unknown;
    try {
      scanBoundedJson(raw);
      parsed = JSON.parse(raw);
    } catch (cause) {
      throw new BrowserLocalDataError('LOCAL_DATA_LEGACY_MALFORMED', `Legacy ${definition.label} data is malformed and was not migrated.`, { cause });
    }
    if (parsed === null || typeof parsed !== 'object') {
      throw new BrowserLocalDataError('LOCAL_DATA_LEGACY_MALFORMED', `Legacy ${definition.label} data is malformed and was not migrated.`);
    }
    if (!definition.acceptLegacyRoot(parsed)) {
      throw new BrowserLocalDataError('LOCAL_DATA_LEGACY_MALFORMED', `Legacy ${definition.label} data is malformed and was not migrated.`);
    }
    const version = definition.version(parsed);
    if (version === null && definition.acceptsUnversionedLegacy === false) {
      throw new BrowserLocalDataError(
        'LOCAL_DATA_RETIRED_SCHEMA',
        `Unversioned ${definition.label} data is retired. Export it with the last broad-reader release or choose an explicit reset before continuing; no data was changed.`,
      );
    }
    if (version !== null && version < (definition.minimumReadableVersion ?? 1)) {
      throw new BrowserLocalDataError(
        'LOCAL_DATA_RETIRED_SCHEMA',
        `${definition.label} schema ${version} is retired. Export it as schema ${definition.schemaVersion} with the last broad-reader release or choose an explicit reset; no data was changed.`,
      );
    }
    if (version !== null && version > definition.schemaVersion) {
      throw new BrowserLocalDataError('LOCAL_DATA_FUTURE_SCHEMA', `${definition.label} schema ${version} was created by a newer app version. Update the app before migration; no data was changed.`);
    }
    try { return definition.normalize(parsed); }
    catch (cause) {
      throw new BrowserLocalDataError('LOCAL_DATA_LEGACY_MALFORMED', `Legacy ${definition.label} data is malformed and was not migrated.`, { cause });
    }
  }

  async #prepare<T>(
    definition: LocalDataCollectionDefinition<T>,
    input: unknown,
    source: BrowserLocalCollectionManifest['source'],
    legacyDigest: string | null,
  ): Promise<PreparedCollection> {
    let document: T;
    try { document = definition.normalize(input); }
    catch (cause) {
      throw new BrowserLocalDataError('INVALID_LOCAL_DATA', `${definition.label} could not be normalized.`, { cause });
    }
    const serialized = definition.serialize(document);
    const serializedBytes = assertSerializedBound(serialized, definition.maximumBytes, definition.label);
    const records = definition.split(document);
    if (!Array.isArray(records) || records.length > definition.maximumRecords || records.length > MAX_LOCAL_DATA_RECORDS_PER_COLLECTION) {
      throw new BrowserLocalDataError('LOCAL_DATA_RECORD_LIMIT', `${definition.label} exceeds its record limit.`);
    }
    const seen = new Set<string>();
    const storedRecords: BrowserLocalStoredRecord[] = [];
    let encodedBytes = 0;
    for (let ordinal = 0; ordinal < records.length; ordinal++) {
      const record = records[ordinal];
      if (!record) {
        throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', `${definition.label} contains an incomplete record.`);
      }
      const id = boundedIdentifier(record.id, `${definition.label} record identifier`, MAX_LOCAL_DATA_RECORD_ID_LENGTH);
      if (seen.has(id)) throw new BrowserLocalDataError('LOCAL_DATA_DUPLICATE_ID', `${definition.label} contains a duplicate record identifier.`);
      seen.add(id);
      let encoded: EncodedLocalDataRecord;
      try { encoded = await this.codec.encode({ collection: definition.id, id, value: record.value }); }
      catch (cause) {
        throw new BrowserLocalDataError('LOCAL_DATA_ENCODING_FAILED', `${definition.label} could not be encoded for browser storage.`, { cause });
      }
      const lookupKey = boundedIdentifier(encoded.lookupKey, `${definition.label} lookup key`, MAX_LOCAL_DATA_RECORD_ID_LENGTH);
      const payloadBytes = assertSerializedBound(encoded.payload, definition.maximumBytes, `${definition.label} record`);
      encodedBytes += payloadBytes;
      if (encodedBytes > definition.maximumBytes * 2) {
        throw new BrowserLocalDataError('LOCAL_DATA_QUOTA', `${definition.label} encoded records exceed their application limit.`);
      }
      storedRecords.push(Object.freeze({
        key: [definition.id, lookupKey] as [string, string],
        collection: definition.id,
        lookupKey,
        ordinal,
        codec: this.codec.id,
        payload: encoded.payload,
        payloadBytes,
      }));
    }
    if (new Set(storedRecords.map((record) => record.lookupKey)).size !== storedRecords.length) {
      throw new BrowserLocalDataError('LOCAL_DATA_DUPLICATE_ID', `${definition.label} codec produced a duplicate lookup key.`);
    }
    return Object.freeze({
      definition,
      records: storedRecords,
      serializedBytes,
      digest: await sha256(canonicalRecordContent(storedRecords)),
      source,
      legacyDigest,
    });
  }

  async #readSnapshot<T>(definition: LocalDataCollectionDefinition<T>): Promise<CollectionSnapshot<T>> {
    const database = await this.#database();
    const transaction = database.transaction([LOCAL_DATA_RECORD_STORE, LOCAL_DATA_MANIFEST_STORE], 'readonly');
    const done = transactionComplete(transaction, `Reading ${definition.label}`, this.timeoutMs);
    let manifest: BrowserLocalCollectionManifest | undefined;
    let records: BrowserLocalStoredRecord[] = [];
    try {
      manifest = await requestResult(
        transaction.objectStore(LOCAL_DATA_MANIFEST_STORE).get(definition.id) as IDBRequest<BrowserLocalCollectionManifest | undefined>,
        `Reading the ${definition.label} manifest`,
        this.timeoutMs,
      );
      if (!manifest) throw new BrowserLocalDataError('LOCAL_DATA_MISSING', `${definition.label} has no migration manifest.`);
      this.#assertManifest(definition, manifest);
      if (manifest.codec !== this.codec.id) {
        throw new BrowserLocalDataError('LOCAL_DATA_LOCKED', `${definition.label} uses ${manifest.codec} and cannot be opened with the active local-data codec.`);
      }
      records = await readBoundedStoredRecords(
        transaction.objectStore(LOCAL_DATA_RECORD_STORE).index(RECORD_COLLECTION_INDEX),
        definition,
        manifest.codec,
        this.timeoutMs,
      );
      await done;
    } catch (cause) {
      try { transaction.abort(); } catch { /* the transaction may already be terminal */ }
      await done.catch(() => undefined);
      if (cause instanceof BrowserLocalDataError) throw cause;
      throw new BrowserLocalDataError(
        'LOCAL_DATA_READ_FAILED',
        `${definition.label} could not be read from browser-local storage.`,
        { cause },
      );
    }
    if (!manifest) throw new BrowserLocalDataError('LOCAL_DATA_MISSING', `${definition.label} has no migration manifest.`);
    if (records.length !== manifest.recordCount) {
      throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', `${definition.label} record count does not match its manifest.`);
    }
    records.sort((left, right) => left.ordinal - right.ordinal || left.lookupKey.localeCompare(right.lookupKey));
    const decoded: LocalDataRecord[] = [];
    for (const record of records) {
      if (record.ordinal >= records.length) {
        throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', `${definition.label} contains an invalid stored record.`);
      }
      try { decoded.push(await this.codec.decode({ collection: definition.id, lookupKey: record.lookupKey, payload: record.payload })); }
      catch (cause) {
        throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', `${definition.label} contains a record that could not be verified.`, { cause });
      }
    }
    if (await sha256(canonicalRecordContent(records)) !== manifest.digest) {
      throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', `${definition.label} records do not match their verified manifest.`);
    }
    let document: T;
    try { document = definition.normalize(definition.join(decoded, manifest.schemaVersion)); }
    catch (cause) {
      throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', `${definition.label} could not be reconstructed.`, { cause });
    }
    const serialized = definition.serialize(document);
    const serializedBytes = assertSerializedBound(serialized, definition.maximumBytes, definition.label);
    if (manifest.schemaVersion === definition.schemaVersion && serializedBytes !== manifest.serializedBytes) {
      throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', `${definition.label} byte count does not match its verified manifest.`);
    }
    return Object.freeze({ document, manifest });
  }

  #assertManifest<T>(
    definition: LocalDataCollectionDefinition<T>,
    manifest: BrowserLocalCollectionManifest,
  ): void {
    if (!manifest || typeof manifest !== 'object'
      || manifest.collection !== definition.id
      || !Number.isSafeInteger(manifest.schemaVersion)
      || manifest.schemaVersion < 1
      || typeof manifest.codec !== 'string'
      || !manifest.codec
      || manifest.codec.length > MAX_LOCAL_DATA_CODEC_ID_LENGTH
      || /[\u0000-\u001f\u007f]/u.test(manifest.codec)
      || !Number.isSafeInteger(manifest.revision)
      || manifest.revision < 1
      || !Number.isSafeInteger(manifest.recordCount)
      || manifest.recordCount < 0
      || manifest.recordCount > definition.maximumRecords
      || !Number.isSafeInteger(manifest.serializedBytes)
      || manifest.serializedBytes < 0
      || manifest.serializedBytes > definition.maximumBytes
      || !isDigest(manifest.digest)
      || !['empty', 'legacy-localstorage', 'application'].includes(manifest.source)
      || typeof manifest.updatedAt !== 'string'
      || manifest.updatedAt.length > 64
      || !Number.isFinite(Date.parse(manifest.updatedAt))
      || manifest.legacyKey !== definition.legacyKey
      || (manifest.legacyDigest !== null && !isDigest(manifest.legacyDigest))) {
      throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', `${definition.label} has an invalid migration manifest.`);
    }
    if (manifest.schemaVersion > definition.schemaVersion) {
      throw new BrowserLocalDataError('LOCAL_DATA_FUTURE_SCHEMA', `${definition.label} schema ${manifest.schemaVersion} was created by a newer app version. Update the app before reading it; no data was changed.`);
    }
    if (manifest.schemaVersion < (definition.minimumReadableVersion ?? 1)) {
      throw new BrowserLocalDataError(
        'LOCAL_DATA_RETIRED_SCHEMA',
        `${definition.label} schema ${manifest.schemaVersion} is retired. Restore or export it with the last broad-reader release, or choose an explicit reset; no data was changed.`,
      );
    }
  }

  async #commit(
    prepared: readonly PreparedCollection[],
    expectedManifests: ReadonlyMap<string, ExpectedManifest>,
  ): Promise<void> {
    this.#requireConfirmedCommitState();
    const database = await this.#database();
    const transaction = database.transaction([LOCAL_DATA_RECORD_STORE, LOCAL_DATA_MANIFEST_STORE], 'readwrite');
    const done = transactionComplete(transaction, 'Saving browser-local data', this.timeoutMs);
    const records = transaction.objectStore(LOCAL_DATA_RECORD_STORE);
    const manifests = transaction.objectStore(LOCAL_DATA_MANIFEST_STORE);
    const now = this.#now();
    const updatedAt = Number.isFinite(now.getTime()) ? now.toISOString() : new Date().toISOString();
    const proposedManifests = new Map<string, BrowserLocalCollectionManifest>();

    try {
      const expected = [...expectedManifests.entries()];
      for (const item of prepared) {
        if (!expectedManifests.has(item.definition.id)) {
          throw new BrowserLocalDataError('INVALID_LOCAL_DATA_UPDATE', `The ${item.definition.label} update has no expected revision.`);
        }
      }
      const current = await Promise.all(expected.map(([collection]) => requestResult(
        manifests.get(collection) as IDBRequest<BrowserLocalCollectionManifest | undefined>,
        `Checking the ${this.#definitions.get(collection)?.label ?? collection} revision`,
        this.timeoutMs,
      )));
      const currentByCollection = new Map<string, BrowserLocalCollectionManifest | undefined>();
      for (let index = 0; index < expected.length; index++) {
        const entry = expected[index];
        if (!entry) throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', 'An expected browser-local revision is missing.');
        const [collection, expectedManifest] = entry;
        const definition = this.#definitions.get(collection);
        if (!definition || (expectedManifest !== null && expectedManifest.collection !== collection)) {
          throw new BrowserLocalDataError('INVALID_LOCAL_DATA_UPDATE', 'A browser-local update contains an invalid expected revision.');
        }
        currentByCollection.set(collection, current[index]);
        if (!manifestMatchesExpected(current[index], expectedManifest)) {
          transaction.abort();
          await done.catch(() => undefined);
          throw new BrowserLocalDataError('LOCAL_DATA_CONFLICT', `${definition.label} changed in another tab.`);
        }
      }
      this.#requireConfirmedCommitState();
      for (const item of prepared) {
        const currentRevision = currentByCollection.get(item.definition.id)?.revision || 0;
        proposedManifests.set(item.definition.id, Object.freeze({
          collection: item.definition.id,
          schemaVersion: item.definition.schemaVersion,
          codec: this.codec.id,
          revision: currentRevision + 1,
          recordCount: item.records.length,
          serializedBytes: item.serializedBytes,
          digest: item.digest,
          source: item.source,
          updatedAt,
          legacyKey: item.definition.legacyKey,
          legacyDigest: item.legacyDigest,
        } satisfies BrowserLocalCollectionManifest));
      }
      for (let index = 0; index < prepared.length; index++) {
        const item = prepared[index];
        if (!item) throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', 'A prepared browser-local collection is missing.');
        const proposedManifest = proposedManifests.get(item.definition.id);
        if (!proposedManifest) throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', 'A proposed browser-local manifest is missing.');
        records.delete(IDBKeyRange.bound([item.definition.id], [item.definition.id, []]));
        for (const record of item.records) records.put(record);
        manifests.put(proposedManifest);
      }
      await done;
    } catch (cause) {
      try { transaction.abort(); } catch { /* the transaction may already be terminal */ }
      await done.catch(() => undefined);
      if (cause instanceof BrowserLocalDataError && cause.code === 'LOCAL_DATA_TIMEOUT') {
        this.#commitState = 'recovering';
        const recovered = await this.#classifyTimedOutCommit(prepared, expectedManifests, proposedManifests);
        if (recovered === 'committed') {
          this.#commitState = 'confirmed';
          return;
        }
        if (recovered === 'not_committed') this.#commitState = 'confirmed';
        if (recovered === 'unknown') {
          this.#commitState = 'unknown';
          throw new BrowserLocalDataError(
            'LOCAL_DATA_COMMIT_UNKNOWN',
            'Browser-local data may have been saved, but its committed state could not be verified. Reload before retrying this change.',
            { cause },
          );
        }
      }
      if (cause instanceof BrowserLocalDataError) throw cause;
      if (cause instanceof DOMException && cause.name === 'QuotaExceededError') {
        throw new BrowserLocalDataError('LOCAL_DATA_QUOTA', 'Could not save browser-local data because this origin is out of storage space.', { cause });
      }
      throw new BrowserLocalDataError('LOCAL_DATA_WRITE_FAILED', 'Could not save browser-local data. Browser storage may be unavailable.', { cause });
    }
  }

  async #classifyTimedOutCommit(
    prepared: readonly PreparedCollection[],
    expectedManifests: ReadonlyMap<string, ExpectedManifest>,
    proposedManifests: ReadonlyMap<string, BrowserLocalCollectionManifest>,
  ): Promise<'committed' | 'not_committed' | 'unknown'> {
    try {
      const snapshots = await Promise.all(prepared.map((item) => this.#readSnapshot(item.definition)));
      const committed = snapshots.every((snapshot, index) => {
        const item = prepared[index];
        if (!item) return false;
        const proposedManifest = proposedManifests.get(item.definition.id);
        return proposedManifest !== undefined
          && manifestMatchesExpected(snapshot.manifest, proposedManifest)
          && collectionContentMatches(item, snapshot.manifest, this.codec.id);
      });
      if (committed) return 'committed';
    } catch {
      // A missing or temporarily unreadable snapshot can still be an exact
      // pre-write state. Compare the bounded manifests separately below.
    }
    try {
      const current = await this.#readManifestState(prepared.map((item) => item.definition));
      const notCommitted = prepared.every((item) => {
        const expectedManifest = expectedManifests.get(item.definition.id);
        return expectedManifest !== undefined
          && manifestMatchesExpected(current.get(item.definition.id), expectedManifest);
      });
      return notCommitted ? 'not_committed' : 'unknown';
    } catch {
      return 'unknown';
    }
  }

  async #readManifestState(
    definitions: readonly AnyLocalDataCollectionDefinition[],
  ): Promise<Map<string, BrowserLocalCollectionManifest | undefined>> {
    const database = await this.#database();
    const transaction = database.transaction(LOCAL_DATA_MANIFEST_STORE, 'readonly');
    const done = transactionComplete(transaction, 'Reconciling browser-local data', this.timeoutMs);
    try {
      const store = transaction.objectStore(LOCAL_DATA_MANIFEST_STORE);
      const manifests = await Promise.all(definitions.map((definition) => requestResult(
        store.get(definition.id) as IDBRequest<BrowserLocalCollectionManifest | undefined>,
        `Reconciling the ${definition.label} manifest`,
        this.timeoutMs,
      )));
      await done;
      const result = new Map<string, BrowserLocalCollectionManifest | undefined>();
      for (let index = 0; index < definitions.length; index += 1) {
        const definition = definitions[index];
        if (!definition) throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', 'A browser-local reconciliation definition is missing.');
        const manifest = manifests[index];
        if (manifest !== undefined) this.#assertManifest(definition, manifest);
        result.set(definition.id, manifest);
      }
      return result;
    } catch (cause) {
      try { transaction.abort(); } catch { /* the transaction may already be terminal */ }
      await done.catch(() => undefined);
      if (cause instanceof BrowserLocalDataError) throw cause;
      throw new BrowserLocalDataError('LOCAL_DATA_READ_FAILED', 'Browser-local commit recovery could not read the current manifests.', { cause });
    }
  }

  async #database(): Promise<IDBDatabase> {
    if (this.#databaseInvalidated) {
      throw new BrowserLocalDataError('LOCAL_DATA_VERSION_CHANGED', 'Browser-local data changed in another tab. Reload this page before continuing.');
    }
    if (this.#databasePromise) return this.#databasePromise;
    this.#databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.#factory.open(this.databaseName, LOCAL_DATA_DATABASE_VERSION);
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new BrowserLocalDataError('LOCAL_DATA_TIMEOUT', 'Opening browser-local data timed out.'));
      }, this.timeoutMs);
      const fail = (cause: BrowserLocalDataError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(cause);
      };
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(LOCAL_DATA_RECORD_STORE)) {
          const records = database.createObjectStore(LOCAL_DATA_RECORD_STORE, { keyPath: 'key' });
          records.createIndex(RECORD_COLLECTION_INDEX, 'collection', { unique: false });
          records.createIndex(RECORD_ORDER_INDEX, ['collection', 'ordinal'], { unique: true });
        }
        if (!database.objectStoreNames.contains(LOCAL_DATA_MANIFEST_STORE)) {
          database.createObjectStore(LOCAL_DATA_MANIFEST_STORE, { keyPath: 'collection' });
        }
      };
      request.onsuccess = () => {
        if (settled) { request.result.close(); return; }
        settled = true;
        clearTimeout(timer);
        request.result.onversionchange = () => {
          this.#databaseInvalidated = true;
          request.result.close();
          this.#databasePromise = null;
        };
        resolve(request.result);
      };
      request.onerror = () => {
        const cause = request.error;
        if (cause?.name === 'VersionError') {
          fail(new BrowserLocalDataError('LOCAL_DATA_FUTURE_DATABASE', 'Browser-local data was created by a newer app version.', { cause }));
          return;
        }
        fail(new BrowserLocalDataError('LOCAL_DATA_OPEN_FAILED', 'Could not open browser-local data.', { cause }));
      };
      request.onblocked = () => {
        fail(new BrowserLocalDataError('LOCAL_DATA_BLOCKED', 'Browser-local data is open in another tab that must be reloaded before migration can continue.'));
      };
    }).catch((cause) => {
      this.#databasePromise = null;
      throw cause;
    });
    return this.#databasePromise;
  }
}
