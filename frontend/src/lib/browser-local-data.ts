export const LOCAL_DATA_DATABASE_NAME = 'whoisleuth-browser-data-v1';
export const LOCAL_DATA_DATABASE_VERSION = 1;
export const LOCAL_DATA_RECORD_STORE = 'records';
export const LOCAL_DATA_MANIFEST_STORE = 'manifests';
export const LOCAL_DATA_OPERATION_TIMEOUT_MS = 5_000;
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
  maximumBytes: number;
  maximumRecords: number;
  empty: () => T;
  normalize: (raw: unknown) => T;
  version: (raw: unknown) => number | null;
  serialize: (document: T) => string;
  split: (document: T) => LocalDataRecord[];
  join: (records: LocalDataRecord[], schemaVersion: number) => unknown;
}>;

export type AnyLocalDataCollectionDefinition = LocalDataCollectionDefinition<any>;

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

type StoredRecord = Readonly<{
  key: [string, string];
  collection: string;
  lookupKey: string;
  ordinal: number;
  codec: string;
  payload: string;
  payloadBytes: number;
}>;

type CollectionManifest = Readonly<{
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

type PreparedCollection<T> = Readonly<{
  definition: LocalDataCollectionDefinition<T>;
  document: T;
  records: StoredRecord[];
  serializedBytes: number;
  digest: string;
  source: CollectionManifest['source'];
  legacyDigest: string | null;
}>;

type CollectionSnapshot<T> = Readonly<{
  document: T;
  manifest: CollectionManifest;
}>;

function collectionContentMatches(prepared: PreparedCollection<any>, manifest: CollectionManifest, codec: string): boolean {
  return manifest.schemaVersion === prepared.definition.schemaVersion
    && manifest.codec === codec
    && manifest.recordCount === prepared.records.length
    && manifest.serializedBytes === prepared.serializedBytes
    && manifest.digest === prepared.digest;
}

export type BrowserLocalDataInitialization = Readonly<{
  state: 'ready';
  databaseName: string;
  migratedCollections: string[];
  retainedLegacyKeys: string[];
  codec: string;
}>;

export type LegacyRollbackCopyResult = Readonly<{
  collectionCount: number;
  serializedBytes: number;
  keys: string[];
}>;

export class BrowserLocalDataError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = 'BrowserLocalDataError';
    this.code = code;
  }
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

function canonicalRecordContent(records: readonly StoredRecord[]): string {
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
  return withDeadline(label, new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new BrowserLocalDataError('LOCAL_DATA_TRANSACTION_ABORTED', `${label} was aborted.`));
    transaction.onerror = () => { /* onabort carries the stable terminal failure */ };
  }), timeoutMs);
}

function normalizeDefinition<T>(definition: LocalDataCollectionDefinition<T>): LocalDataCollectionDefinition<T> {
  boundedIdentifier(definition.id, 'Collection identifier', 64);
  boundedIdentifier(definition.label, 'Collection label', 100);
  boundedIdentifier(definition.legacyKey, 'Legacy storage key', 160);
  if (!Number.isSafeInteger(definition.schemaVersion) || definition.schemaVersion < 1) {
    throw new BrowserLocalDataError('INVALID_LOCAL_DATA_DEFINITION', `${definition.label} has an invalid schema version.`);
  }
  if (!Number.isSafeInteger(definition.maximumBytes) || definition.maximumBytes < 1) {
    throw new BrowserLocalDataError('INVALID_LOCAL_DATA_DEFINITION', `${definition.label} has an invalid byte bound.`);
  }
  if (!Number.isSafeInteger(definition.maximumRecords) || definition.maximumRecords < 0 || definition.maximumRecords > MAX_LOCAL_DATA_RECORDS_PER_COLLECTION) {
    throw new BrowserLocalDataError('INVALID_LOCAL_DATA_DEFINITION', `${definition.label} has an invalid record bound.`);
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
    this.timeoutMs = options.timeoutMs || LOCAL_DATA_OPERATION_TIMEOUT_MS;
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
    for (let attempt = 1; attempt <= MAX_LOCAL_DATA_UPDATE_ATTEMPTS; attempt++) {
      const snapshot = await this.#readSnapshot(definition);
      const updated = updater(snapshot.document);
      const prepared = await this.#prepare(definition, updated.document, 'application', snapshot.manifest.legacyDigest);
      if (collectionContentMatches(prepared, snapshot.manifest, this.codec.id)) return updated.result;
      try {
        await this.#commit([prepared], new Map([[definition.id, snapshot.manifest.revision]]));
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
    for (let attempt = 1; attempt <= MAX_LOCAL_DATA_UPDATE_ATTEMPTS; attempt++) {
      const snapshots = await Promise.all(definitions.map((definition) => this.#readSnapshot(definition)));
      const current = new Map(definitions.map((definition, index) => [definition.id, snapshots[index].document]));
      const updated = updater(current);
      const prepared: PreparedCollection<any>[] = [];
      for (let index = 0; index < definitions.length; index++) {
        const definition = definitions[index];
        if (!updated.documents.has(definition.id)) {
          throw new BrowserLocalDataError('INVALID_LOCAL_DATA_UPDATE', `The ${definition.label} batch update did not return a document.`);
        }
        prepared.push(await this.#prepare(definition, updated.documents.get(definition.id), 'application', snapshots[index].manifest.legacyDigest));
      }
      const revisions = new Map(definitions.map((definition, index) => [definition.id, snapshots[index].manifest.revision]));
      const changed = prepared.filter((item, index) => !collectionContentMatches(item, snapshots[index].manifest, this.codec.id));
      if (!changed.length) return updated.result;
      try {
        await this.#commit(changed, revisions);
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
    try {
      for (const copy of copies) this.#storage.setItem(copy.key, copy.value);
    } catch (cause) {
      try {
        for (const [key, value] of snapshot) {
          if (value === null) this.#storage.removeItem(key);
          else this.#storage.setItem(key, value);
        }
      } catch (rollbackCause) {
        throw new BrowserLocalDataError('LOCAL_DATA_LEGACY_ROLLBACK_FAILED', 'Could not save or fully restore the legacy rollback copy. Download a workspace backup before changing this browser data.', { cause: rollbackCause });
      }
      if (cause instanceof DOMException && cause.name === 'QuotaExceededError') {
        throw new BrowserLocalDataError('LOCAL_DATA_QUOTA', 'The current workspace is too large for a legacy local-storage rollback copy. Download a workspace backup instead.', { cause });
      }
      throw new BrowserLocalDataError('LOCAL_DATA_LEGACY_WRITE_FAILED', 'Could not update the legacy rollback copy. Browser storage may be unavailable.', { cause });
    }
    return Object.freeze({
      collectionCount: copies.length,
      serializedBytes: copies.reduce((sum, copy) => sum + copy.bytes, 0),
      keys: Object.freeze(copies.map((copy) => copy.key)) as unknown as string[],
    });
  }

  async #requireDefinition<T>(definition: LocalDataCollectionDefinition<T>): Promise<void> {
    if (!this.#initializationPromise) throw new BrowserLocalDataError('LOCAL_DATA_NOT_INITIALIZED', 'Browser-local data has not been initialized.');
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
      manifestStore.get(definition.id) as IDBRequest<CollectionManifest | undefined>,
      `Reading the ${definition.label} manifest`,
      this.timeoutMs,
    )));
    await done;

    const missing = definitions.filter((_definition, index) => !manifests[index]);
    const migratedCollections: string[] = [];
    const retainedLegacyKeys: string[] = [];
    if (missing.length) {
      const prepared: PreparedCollection<any>[] = [];
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
        await this.#commit(prepared, new Map(missing.map((definition) => [definition.id, 0])));
        migratedCollections.push(...missing.map((definition) => definition.id));
      } catch (cause) {
        if (!(cause instanceof BrowserLocalDataError) || cause.code !== 'LOCAL_DATA_CONFLICT') throw cause;
      }
    }

    for (const definition of definitions) {
      const snapshot = await this.#readSnapshot(definition);
      if (snapshot.manifest.schemaVersion < definition.schemaVersion) {
        const prepared = await this.#prepare(definition, snapshot.document, 'application', snapshot.manifest.legacyDigest);
        try { await this.#commit([prepared], new Map([[definition.id, snapshot.manifest.revision]])); }
        catch (cause) {
          if (!(cause instanceof BrowserLocalDataError) || cause.code !== 'LOCAL_DATA_CONFLICT') throw cause;
          await this.#readSnapshot(definition);
        }
      }
    }
    return Object.freeze({
      state: 'ready',
      databaseName: this.databaseName,
      migratedCollections: Object.freeze(migratedCollections.slice()) as unknown as string[],
      retainedLegacyKeys: Object.freeze(retainedLegacyKeys.slice()) as unknown as string[],
      codec: this.codec.id,
    });
  }

  #normalizeLegacy<T>(definition: LocalDataCollectionDefinition<T>, raw: string | null): T {
    if (raw === null) return definition.normalize(definition.empty());
    if (byteLength(raw) > definition.maximumBytes) {
      throw new BrowserLocalDataError('LOCAL_DATA_LEGACY_TOO_LARGE', `Legacy ${definition.label} data exceeds its application limit.`);
    }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { return definition.normalize(definition.empty()); }
    const version = definition.version(parsed);
    if (version !== null && version > definition.schemaVersion) {
      throw new BrowserLocalDataError('LOCAL_DATA_FUTURE_SCHEMA', `${definition.label} was created by a newer app version. Update the app before migration.`);
    }
    try { return definition.normalize(parsed); }
    catch { return definition.normalize(definition.empty()); }
  }

  async #prepare<T>(
    definition: LocalDataCollectionDefinition<T>,
    input: unknown,
    source: CollectionManifest['source'],
    legacyDigest: string | null,
  ): Promise<PreparedCollection<T>> {
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
    const storedRecords: StoredRecord[] = [];
    let encodedBytes = 0;
    for (let ordinal = 0; ordinal < records.length; ordinal++) {
      const id = boundedIdentifier(records[ordinal].id, `${definition.label} record identifier`, MAX_LOCAL_DATA_RECORD_ID_LENGTH);
      if (seen.has(id)) throw new BrowserLocalDataError('LOCAL_DATA_DUPLICATE_ID', `${definition.label} contains a duplicate record identifier.`);
      seen.add(id);
      let encoded: EncodedLocalDataRecord;
      try { encoded = await this.codec.encode({ collection: definition.id, id, value: records[ordinal].value }); }
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
      document,
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
    const manifest = await requestResult(
      transaction.objectStore(LOCAL_DATA_MANIFEST_STORE).get(definition.id) as IDBRequest<CollectionManifest | undefined>,
      `Reading the ${definition.label} manifest`,
      this.timeoutMs,
    );
    const records = await requestResult(
      transaction.objectStore(LOCAL_DATA_RECORD_STORE).index(RECORD_COLLECTION_INDEX).getAll(definition.id) as IDBRequest<StoredRecord[]>,
      `Reading ${definition.label}`,
      this.timeoutMs,
    );
    await done;
    if (!manifest) throw new BrowserLocalDataError('LOCAL_DATA_MISSING', `${definition.label} has no migration manifest.`);
    this.#assertManifest(definition, manifest);
    if (manifest.codec !== this.codec.id) {
      throw new BrowserLocalDataError('LOCAL_DATA_LOCKED', `${definition.label} uses ${manifest.codec} and cannot be opened with the active local-data codec.`);
    }
    if (records.length !== manifest.recordCount || records.length > definition.maximumRecords) {
      throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', `${definition.label} record count does not match its manifest.`);
    }
    records.sort((left, right) => left.ordinal - right.ordinal || left.lookupKey.localeCompare(right.lookupKey));
    const decoded: LocalDataRecord[] = [];
    let payloadBytes = 0;
    const lookupKeys = new Set<string>();
    for (const record of records) {
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
        || record.ordinal >= records.length
        || record.codec !== manifest.codec
        || typeof record.payload !== 'string'
        || !Number.isSafeInteger(record.payloadBytes)
        || record.payloadBytes < 0
        || record.payloadBytes !== byteLength(record.payload)) {
        throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', `${definition.label} contains an invalid stored record.`);
      }
      lookupKeys.add(record.lookupKey);
      payloadBytes += record.payloadBytes;
      if (payloadBytes > definition.maximumBytes * 2) {
        throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', `${definition.label} encoded records exceed their read bound.`);
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

  #assertManifest<T>(definition: LocalDataCollectionDefinition<T>, manifest: CollectionManifest): void {
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
      throw new BrowserLocalDataError('LOCAL_DATA_FUTURE_SCHEMA', `${definition.label} was created by a newer app version. Update the app before reading it.`);
    }
  }

  async #commit(prepared: readonly PreparedCollection<any>[], expectedRevisions: ReadonlyMap<string, number>): Promise<void> {
    const database = await this.#database();
    const transaction = database.transaction([LOCAL_DATA_RECORD_STORE, LOCAL_DATA_MANIFEST_STORE], 'readwrite');
    const done = transactionComplete(transaction, 'Saving browser-local data', this.timeoutMs);
    const records = transaction.objectStore(LOCAL_DATA_RECORD_STORE);
    const manifests = transaction.objectStore(LOCAL_DATA_MANIFEST_STORE);
    const now = this.#now();
    const updatedAt = Number.isFinite(now.getTime()) ? now.toISOString() : new Date().toISOString();

    try {
      const current = await Promise.all(prepared.map((item) => requestResult(
        manifests.get(item.definition.id) as IDBRequest<CollectionManifest | undefined>,
        `Checking the ${item.definition.label} revision`,
        this.timeoutMs,
      )));
      for (let index = 0; index < prepared.length; index++) {
        const item = prepared[index];
        const currentRevision = current[index]?.revision || 0;
        if (currentRevision !== expectedRevisions.get(item.definition.id)) {
          transaction.abort();
          await done.catch(() => undefined);
          throw new BrowserLocalDataError('LOCAL_DATA_CONFLICT', `${item.definition.label} changed in another tab.`);
        }
      }
      for (let index = 0; index < prepared.length; index++) {
        const item = prepared[index];
        const currentRevision = current[index]?.revision || 0;
        records.delete(IDBKeyRange.bound([item.definition.id], [item.definition.id, []]));
        for (const record of item.records) records.put(record);
        manifests.put(Object.freeze({
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
        }) satisfies CollectionManifest);
      }
      await done;
    } catch (cause) {
      try { transaction.abort(); } catch { /* the transaction may already be terminal */ }
      await done.catch(() => undefined);
      if (cause instanceof BrowserLocalDataError) throw cause;
      if (cause instanceof DOMException && cause.name === 'QuotaExceededError') {
        throw new BrowserLocalDataError('LOCAL_DATA_QUOTA', 'Could not save browser-local data because this origin is out of storage space.', { cause });
      }
      throw new BrowserLocalDataError('LOCAL_DATA_WRITE_FAILED', 'Could not save browser-local data. Browser storage may be unavailable.', { cause });
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
