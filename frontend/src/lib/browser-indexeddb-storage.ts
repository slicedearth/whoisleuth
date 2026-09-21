import {
  BrowserLocalDataError, assertLocalDataManifest, encodedByteLimit, verifyStoredRecord,
  type AnyLocalDataCollectionDefinition, type LocalDataCollectionDefinition, type BrowserLocalDataCodec,
  type BrowserLocalStoredRecord, type BrowserLocalCollectionManifest, type CapturedLocalDataCollection,
} from './browser-local-data-content.ts';
import { localDataManifestMatches as manifestMatchesExpected, type LocalDataStorage, type LocalDataStorageCommit } from '../../../packages/workspace/local-data-storage.mts';
import type { BrowserLocalStoredBinary } from './browser-local-binaries.ts';

export const LOCAL_DATA_DATABASE_NAME = 'whoisleuth-browser-data-v1';
export const LOCAL_DATA_DATABASE_VERSION = 2;
export const LOCAL_DATA_RECORD_STORE = 'records';
export const LOCAL_DATA_MANIFEST_STORE = 'manifests';
export const LOCAL_DATA_BINARY_STORE = 'files';

const RECORD_COLLECTION_INDEX = 'collection';
const RECORD_ORDER_INDEX = 'collection-order';

/**
 * A timed-out IndexedDB transaction has had abort attempted. A subsequent
 * transaction is ordered after it, so the provider can reconcile exact content.
 * A disconnected external request cannot make this guarantee.
 */
export class UnacknowledgedIndexedDbCommit extends BrowserLocalDataError {}

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
  codec: BrowserLocalDataCodec,
  timeoutMs: number,
): Promise<BrowserLocalStoredRecord[]> {
  const label = `Reading ${definition.label}`;
  return withDeadline(label, new Promise<BrowserLocalStoredRecord[]>((resolve, reject) => {
    const records: BrowserLocalStoredRecord[] = [];
    const lookupKeys = new Set<string>();
    const maximumEncodedBytes = encodedByteLimit(codec, definition.maximumBytes * 2, definition.maximumRecords);
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
        verifyStoredRecord(record, definition, codec.id, lookupKeys, Math.min(encodedByteLimit(codec, definition.maximumBytes, 1), maximumEncodedBytes - retainedBytes));
        retainedBytes += record.payloadBytes;
        records.push(record);
        cursor.continue();
      } catch (cause) {
        reject(cause);
      }
    };
  }), timeoutMs);
}


/** IndexedDB transaction I/O. Domain updates, migration and retries stay in the provider. */
export class IndexedDbLocalDataStorage implements LocalDataStorage {
  readonly databaseName: string;
  readonly timeoutMs: number;
  readonly codec: BrowserLocalDataCodec;
  #factory: IDBFactory;
  #definition: (id: string) => AnyLocalDataCollectionDefinition;
  #assertWritable: () => void;
  #databasePromise: Promise<IDBDatabase> | null = null;
  #databaseInvalidated = false;
  #createdDatabase = false;

  get createdDatabase(): boolean { return this.#createdDatabase; }

  constructor(options: Readonly<{
    databaseName: string; timeoutMs: number; codec: BrowserLocalDataCodec; factory: IDBFactory;
    definition: (id: string) => AnyLocalDataCollectionDefinition;
    assertWritable: () => void;
  }>) {
    this.databaseName = options.databaseName;
    this.timeoutMs = options.timeoutMs;
    this.codec = options.codec;
    this.#factory = options.factory;
    this.#definition = options.definition;
    this.#assertWritable = options.assertWritable;
  }

  async files(collection: string, keys: readonly string[]): Promise<(BrowserLocalStoredBinary | undefined)[]> {
    const database = await this.#database();
    const transaction = database.transaction(LOCAL_DATA_BINARY_STORE, 'readonly');
    const done = transactionComplete(transaction, 'Reading retained files', this.timeoutMs);
    try {
      const stored = await Promise.all(keys.map(key => requestResult(transaction.objectStore(LOCAL_DATA_BINARY_STORE).get([collection, key]) as IDBRequest<BrowserLocalStoredBinary | undefined>, 'Reading a retained file', this.timeoutMs)));
      await done;
      return stored;
    } catch (cause) {
      try { transaction.abort(); } catch { /* already terminal */ }
      await done.catch(() => undefined);
      throw new BrowserLocalDataError('LOCAL_DATA_READ_FAILED', 'Selected retained files could not be read. No saved data was changed.', { cause });
    }
  }

  async capture(collections: readonly string[]): Promise<CapturedLocalDataCollection[]> {
    const definitions = collections.map(id => this.#definition(id));
    const database = await this.#database();
    const transaction = database.transaction([LOCAL_DATA_RECORD_STORE, LOCAL_DATA_MANIFEST_STORE], 'readonly');
    const label = definitions.length === 1 ? definitions[0]!.label : 'workspace collections';
    const done = transactionComplete(transaction, `Reading ${label}`, this.timeoutMs);
    let captured: CapturedLocalDataCollection[];
    try {
      captured = await Promise.all(definitions.map(async (definition) => {
        const manifest = await requestResult(
          transaction.objectStore(LOCAL_DATA_MANIFEST_STORE).get(definition.id) as IDBRequest<BrowserLocalCollectionManifest | undefined>,
          `Reading the ${definition.label} manifest`,
          this.timeoutMs,
        );
        if (!manifest) throw new BrowserLocalDataError('LOCAL_DATA_MISSING', `${definition.label} has no migration manifest.`);
        assertLocalDataManifest(definition, manifest);
        if (manifest.codec !== this.codec.id) {
          throw new BrowserLocalDataError('LOCAL_DATA_LOCKED', `${definition.label} uses ${manifest.codec} and cannot be opened with the active local-data codec.`);
        }
        const records = await readBoundedStoredRecords(
          transaction.objectStore(LOCAL_DATA_RECORD_STORE).index(RECORD_COLLECTION_INDEX),
          definition,
          this.codec,
          this.timeoutMs,
        );
        return { manifest, records };
      }));
      await done;
    } catch (cause) {
      try { transaction.abort(); } catch { /* the transaction may already be terminal */ }
      await done.catch(() => undefined);
      if (cause instanceof BrowserLocalDataError) throw cause;
      throw new BrowserLocalDataError(
        'LOCAL_DATA_READ_FAILED',
        `${label} could not be read from workspace storage.`,
        { cause },
      );
    }
    return captured;
  }


  async manifests(collections: readonly string[]): Promise<(BrowserLocalCollectionManifest | undefined)[]> {
    const database = await this.#database();
    const transaction = database.transaction(LOCAL_DATA_MANIFEST_STORE, 'readonly');
    const done = transactionComplete(transaction, 'Reconciling browser-local data', this.timeoutMs);
    try {
      const store = transaction.objectStore(LOCAL_DATA_MANIFEST_STORE);
      const manifests = await Promise.all(collections.map(collection => requestResult(
        store.get(collection) as IDBRequest<BrowserLocalCollectionManifest | undefined>,
        `Reading the ${this.#definition(collection).label} manifest`,
        this.timeoutMs,
      )));
      await done;
      return manifests;
    } catch (cause) {
      try { transaction.abort(); } catch { /* the transaction may already be terminal */ }
      await done.catch(() => undefined);
      if (cause instanceof BrowserLocalDataError) throw cause;
      throw new BrowserLocalDataError('LOCAL_DATA_READ_FAILED', 'Browser-local commit recovery could not read the current manifests.', { cause });
    }
  }

  async commit(change: LocalDataStorageCommit): Promise<void> {
    this.#assertWritable();
    const database = await this.#database();
    const transaction = database.transaction([LOCAL_DATA_RECORD_STORE, LOCAL_DATA_MANIFEST_STORE,
      ...(change.binaries.length || change.createEmpty.size ? [LOCAL_DATA_BINARY_STORE] : [])], 'readwrite');
    const done = transactionComplete(transaction, 'Saving browser-local data', this.timeoutMs);
    try {
      const records = transaction.objectStore(LOCAL_DATA_RECORD_STORE);
      const manifests = transaction.objectStore(LOCAL_DATA_MANIFEST_STORE);
      const expected = [...change.expected];
      const current = await Promise.all(expected.map(([collection]) => requestResult(
        manifests.get(collection) as IDBRequest<BrowserLocalCollectionManifest | undefined>,
        `Checking the ${this.#definition(collection).label} revision`, this.timeoutMs,
      )));
      for (const [index, [collection, manifest]] of expected.entries()) {
        if (!manifestMatchesExpected(current[index], manifest)) {
          throw new BrowserLocalDataError('LOCAL_DATA_CONFLICT', `${this.#definition(collection).label} changed in another tab.`);
        }
      }
      for (const collection of change.createEmpty) {
        if (change.expected.get(collection) !== null) continue;
        const range = IDBKeyRange.bound([collection], [collection, []]);
        const counts = await Promise.all([
          requestResult(records.count(range), 'Checking retained records before collection creation', this.timeoutMs),
          requestResult(transaction.objectStore(LOCAL_DATA_BINARY_STORE).count(range), 'Checking retained files before collection creation', this.timeoutMs),
        ]);
        if (counts.some(count => count !== 0)) {
          throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', 'The missing collection still has retained records or files. Nothing was replaced; restore from a verified backup or recover its missing metadata.');
        }
      }
      this.#assertWritable();
      for (const { manifest, records: values } of change.collections) {
        records.delete(IDBKeyRange.bound([manifest.collection], [manifest.collection, []]));
        for (const record of values) records.put(record);
        manifests.put(manifest);
      }
      for (const binary of change.binaries) {
        const files = transaction.objectStore(LOCAL_DATA_BINARY_STORE);
        for (const key of binary.remove) files.delete([binary.collection, key]);
        for (const record of binary.writes) files.put(record);
      }
      await done;
    } catch (cause) {
      try { transaction.abort(); } catch { /* the transaction may already be terminal */ }
      await done.catch(() => undefined);
      if (cause instanceof BrowserLocalDataError && cause.code === 'LOCAL_DATA_TIMEOUT') {
        throw new UnacknowledgedIndexedDbCommit(cause.code, cause.message, { cause });
      }
      if (cause instanceof BrowserLocalDataError) throw cause;
      if (cause instanceof DOMException && cause.name === 'QuotaExceededError') {
        throw new BrowserLocalDataError('LOCAL_DATA_QUOTA', 'Could not save browser-local data because this origin is out of storage space.', { cause });
      }
      throw new BrowserLocalDataError('LOCAL_DATA_WRITE_FAILED', 'Could not save browser-local data. Browser storage may be unavailable.', { cause });
    }
  }

  async close(): Promise<void> {
    try { if (this.#databasePromise) (await this.#databasePromise).close(); }
    finally {
      this.#databasePromise = null;
      this.#databaseInvalidated = false;
      this.#createdDatabase = false;
    }
  }

  async #database(): Promise<IDBDatabase> {
    const factory = this.#factory;
    if (!factory) throw new BrowserLocalDataError('LOCAL_DATA_UNSUPPORTED', 'This workspace does not use IndexedDB.');
    if (this.#databaseInvalidated) {
      throw new BrowserLocalDataError('LOCAL_DATA_VERSION_CHANGED', 'Browser-local data changed in another tab. Reload this page before continuing.');
    }
    if (this.#databasePromise) return this.#databasePromise;
    this.#databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(this.databaseName, LOCAL_DATA_DATABASE_VERSION);
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
      request.onupgradeneeded = event => {
        if (settled) { request.transaction?.abort(); return; }
        this.#createdDatabase = event.oldVersion === 0;
        const database = request.result;
        if (!database.objectStoreNames.contains(LOCAL_DATA_RECORD_STORE)) {
          const records = database.createObjectStore(LOCAL_DATA_RECORD_STORE, { keyPath: 'key' });
          records.createIndex(RECORD_COLLECTION_INDEX, 'collection', { unique: false });
          records.createIndex(RECORD_ORDER_INDEX, ['collection', 'ordinal'], { unique: true });
        }
        if (!database.objectStoreNames.contains(LOCAL_DATA_MANIFEST_STORE)) {
          database.createObjectStore(LOCAL_DATA_MANIFEST_STORE, { keyPath: 'collection' });
        }
        if (!database.objectStoreNames.contains(LOCAL_DATA_BINARY_STORE)) {
          database.createObjectStore(LOCAL_DATA_BINARY_STORE, { keyPath: 'key' });
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
