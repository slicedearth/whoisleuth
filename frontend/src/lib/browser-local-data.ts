import { boundedJsonLimitsForBytes, scanBoundedJson } from './bounded-json.ts';
import { IndexedDbLocalDataStorage, UnacknowledgedIndexedDbCommit, LOCAL_DATA_DATABASE_NAME } from './browser-indexeddb-storage.ts';
import {
  BrowserLocalDataError, plaintextJsonCodec, boundedIdentifier, normalizeDefinition,
  decodeLocalDataSnapshots, prepareLocalDataContent, assertLocalDataManifest,
  assertSerializedBound, byteLength, sha256, collectionBinaryReferences,
  captureBrowserLocalDataUpdateOptions, requirePendingLocalDataUpdate,
  collectionContentMatches, proposedManifest,
  LOCAL_DATA_OPERATION_TIMEOUT_MS, MAX_LOCAL_DATA_OPERATION_TIMEOUT_MS,
  MAX_LOCAL_DATA_CODEC_ID_LENGTH, MAX_LOCAL_DATA_COLLECTIONS,
  MAX_LOCAL_DATA_RECORD_ID_LENGTH, MAX_LOCAL_DATA_UPDATE_ATTEMPTS,
  type BrowserStorage, type BrowserLocalDataCodec, type BrowserLocalDataCommitListener,
  type BrowserLocalDataSnapshotDecoder, type BrowserLocalDataPreparer,
  type BrowserLocalDataInitializationOptions, type BrowserLocalDataInitialization,
  type AnyLocalDataCollectionDefinition, type LocalDataCollectionDefinition,
  type BrowserLocalDataUpdater, type BrowserLocalDataUpdateOptions,
  type BrowserLocalDataBatchUpdateOptions, type LegacyRollbackCopyResult,
  type PreparedCollection, type PreparedBinaryFiles, type CollectionSnapshot,
  type BrowserLocalCommitState, type ExpectedManifest,
} from './browser-local-data-content.ts';
import type { BrowserLocalBinaryCodec, BrowserLocalStoredBinary } from './browser-local-binaries.ts';
import { captureRetainedFiles, readRetainedFileReference, type RetainedFileInput, type RetainedFileReference } from '../../../packages/evidence/retained-file.mts';
import { MAX_SELECTED_FILES, MAX_SELECTED_FILE_TOTAL_BYTES } from '../../../packages/contracts/selected-file-limits.mts';
import {
  localDataManifestMatches as manifestMatchesExpected,
  type LocalDataManifest as BrowserLocalCollectionManifest,
  type LocalDataBinaryChanges as PreparedBinaryChanges,
  type LocalDataStorage,
} from '../../../packages/workspace/local-data-storage.mts';

// Retain the established entry point; the implementations have separate owners.
export {
  LOCAL_DATA_DATABASE_NAME, LOCAL_DATA_DATABASE_VERSION,
  LOCAL_DATA_RECORD_STORE, LOCAL_DATA_MANIFEST_STORE, LOCAL_DATA_BINARY_STORE,
} from './browser-indexeddb-storage.ts';
export {
  BrowserLocalDataError, isExpectedBrowserLocalDataFailure,
  LOCAL_DATA_OPERATION_TIMEOUT_MS, MAX_LOCAL_DATA_OPERATION_TIMEOUT_MS,
  MAX_LOCAL_DATA_COLLECTIONS, MAX_LOCAL_DATA_RECORDS_PER_COLLECTION,
  MAX_LOCAL_DATA_RECORD_ID_LENGTH, MAX_LOCAL_DATA_CODEC_ID_LENGTH,
  MAX_LOCAL_DATA_UPDATE_ATTEMPTS, localDataStorageRecords,
  captureBrowserLocalDataUpdateOptions, assertPreparedLocalDataContent,
  normalizeDefinition, decodeLocalDataJsonRecord, plaintextJsonCodec,
  decodeLocalDataSnapshots, prepareLocalDataContent,
  type BrowserLocalStoredRecord, type BrowserLocalCollectionManifest, type CapturedLocalDataCollection,
  type LocalDataRecord, type BrowserLocalDataInitializationOptions,
  type LocalDataCollectionDefinition, type AnyLocalDataCollectionDefinition,
  type EncodedLocalDataRecord, type DecodedLocalDataRecord, type BrowserLocalDataCodec,
  type PreparedLocalDataContent, type BrowserLocalDataUpdater, type BrowserLocalDataUpdateOptions,
  type BrowserLocalDataBatchUpdateOptions, type BrowserLocalDataPreparer, type BrowserLocalDataSnapshotDecoder,
  type BrowserLocalDataInitialization, type LegacyRollbackCopyResult, type BrowserLocalDataCommitListener,
} from './browser-local-data-content.ts';

export class BrowserLocalDataProvider {
  readonly databaseName: string;
  readonly codec: BrowserLocalDataCodec;
  readonly timeoutMs: number;

  #storage: BrowserStorage | undefined;
  #storageAdapter: LocalDataStorage;
  #indexedDb: IndexedDbLocalDataStorage | undefined;
  #now: () => Date;
  #initializationPromise: Promise<BrowserLocalDataInitialization> | null = null;
  #definitions = new Map<string, AnyLocalDataCollectionDefinition>();
  #commitState: BrowserLocalCommitState = 'confirmed';
  #oncommit: BrowserLocalDataCommitListener | undefined;
  #decodeSnapshots: BrowserLocalDataSnapshotDecoder;
  #prepareInBackground: BrowserLocalDataPreparer;
  #requireExistingCollections: boolean;

  /** Only initial provisioning may clean up a database created by this provider. */
  get createdDatabase(): boolean { return this.#indexedDb?.createdDatabase ?? false; }

  constructor(options: Readonly<{
    databaseName?: string;
    indexedDB?: IDBFactory;
    storage?: BrowserStorage;
    /** An explicit non-browser store never reads or migrates this origin's data. */
    storageAdapter?: LocalDataStorage;
    codec?: BrowserLocalDataCodec;
    requireExistingCollections?: boolean;
    timeoutMs?: number;
    now?: () => Date;
    oncommit?: BrowserLocalDataCommitListener;
    decodeSnapshots?: BrowserLocalDataSnapshotDecoder;
    prepareInBackground?: BrowserLocalDataPreparer;
  }> = {}) {
    let factory: IDBFactory | undefined;
    let storage: BrowserStorage | undefined;
    try {
      if (!options.storageAdapter) {
        factory = options.indexedDB || globalThis.indexedDB;
        storage = options.storage || globalThis.localStorage;
      }
    } catch (cause) {
      throw new BrowserLocalDataError('LOCAL_DATA_UNSUPPORTED', 'Browser-local storage is unavailable in this context.', { cause });
    }
    if (!options.storageAdapter && !factory) throw new BrowserLocalDataError('LOCAL_DATA_UNSUPPORTED', 'IndexedDB is unavailable in this browser.');
    if (!options.storageAdapter && !storage) throw new BrowserLocalDataError('LOCAL_DATA_UNSUPPORTED', 'Legacy browser storage is unavailable for safe migration.');
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
    this.#storage = storage;
    this.#indexedDb = options.storageAdapter ? undefined : new IndexedDbLocalDataStorage({
      databaseName: this.databaseName, timeoutMs, codec: this.codec, factory: factory!,
      definition: id => {
        const definition = this.#definitions.get(id);
        if (!definition) throw new BrowserLocalDataError('INVALID_LOCAL_DATA_DEFINITION', 'The collection is not registered with this provider.');
        return definition;
      },
      assertWritable: () => this.#requireConfirmedCommitState(),
    });
    this.#storageAdapter = options.storageAdapter ?? this.#indexedDb!;
    this.#now = options.now || (() => new Date());
    this.#oncommit = options.oncommit;
    this.#decodeSnapshots = options.decodeSnapshots ?? decodeLocalDataSnapshots;
    this.#prepareInBackground = options.prepareInBackground ?? prepareLocalDataContent;
    this.#requireExistingCollections = options.requireExistingCollections ?? false;
  }

  async initialize(definitions: readonly AnyLocalDataCollectionDefinition[], options: BrowserLocalDataInitializationOptions = {}): Promise<BrowserLocalDataInitialization> {
    if (this.#initializationPromise) return this.#initializationPromise;
    if (!Array.isArray(definitions) || definitions.length < 1 || definitions.length > MAX_LOCAL_DATA_COLLECTIONS) {
      throw new BrowserLocalDataError('INVALID_LOCAL_DATA_DEFINITION', `Local data requires between 1 and ${MAX_LOCAL_DATA_COLLECTIONS} collection definitions.`);
    }
    const normalized = definitions.map(normalizeDefinition);
    if (new Set(normalized.map((definition) => definition.id)).size !== normalized.length) {
      throw new BrowserLocalDataError('INVALID_LOCAL_DATA_DEFINITION', 'Local data collection identifiers must be unique.');
    }
    const requested = options.createMissingCollections ?? [];
    if (!Array.isArray(requested) || requested.length > normalized.length
      || requested.some(id => !normalized.some(definition => definition.id === id))
      || new Set(requested).size !== requested.length) {
      throw new BrowserLocalDataError('INVALID_LOCAL_DATA_DEFINITION', 'Only declared collections can be explicitly created.');
    }
    const approved = new Set<string>(requested);
    this.#definitions = new Map(normalized.map((definition) => [definition.id, definition]));
    this.#initializationPromise = this.#initialize(normalized, approved).catch((cause) => {
      this.#initializationPromise = null;
      throw cause;
    });
    return this.#initializationPromise;
  }

  async read<T>(definition: LocalDataCollectionDefinition<T>): Promise<T> {
    await this.#requireDefinition(definition);
    return (await this.#readSnapshot(definition)).document;
  }

  /** All requested collections are captured by one readonly transaction. */
  async readMany(definitions: readonly AnyLocalDataCollectionDefinition[]): Promise<ReadonlyMap<string, unknown>> {
    this.#assertDefinitionBatch(definitions);
    definitions = [...definitions];
    for (const definition of definitions) await this.#requireDefinition(definition);
    const snapshots = await this.#readSnapshots(definitions);
    return new Map(definitions.map((definition, index) => [definition.id, snapshots[index]!.document]));
  }

  /** Metadata is verified once; only explicitly requested file bodies are read. */
  async readFiles<T>(definition: LocalDataCollectionDefinition<T>, references: readonly RetainedFileReference[]): Promise<ReadonlyMap<string, Blob | null>> {
    if (!Array.isArray(references) || references.length > MAX_SELECTED_FILES) throw new BrowserLocalDataError('INVALID_LOCAL_DATA_UPDATE', `Select at most ${MAX_SELECTED_FILES} files per operation.`);
    const selected = references.map(readRetainedFileReference);
    if (selected.reduce((total, reference) => total + reference.byteLength, 0) > MAX_SELECTED_FILE_TOTAL_BYTES) throw new BrowserLocalDataError('LOCAL_DATA_QUOTA', 'Selected files exceed the combined byte limit.');
    await this.#requireDefinition(definition);
    const codec = this.#binaryCodec(definition);
    const current = collectionBinaryReferences(definition, (await this.#readSnapshot(definition)).document);
    for (const reference of selected) {
      if (current.get(reference.digestSha256)?.byteLength !== reference.byteLength) throw new BrowserLocalDataError('LOCAL_DATA_BINARY_UNREFERENCED', 'The selected file is no longer referenced by this collection. Refresh before continuing.');
    }
    const unique = [...new Map(selected.map(reference => [reference.digestSha256, reference])).values()];
    const keys = await Promise.all(unique.map(reference => codec.lookupKey(definition.id, reference)));
    const stored = await this.#storageAdapter.files(definition.id, keys);
    if (stored.length !== keys.length) throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', 'The retained-file response is incomplete.');
    const result = new Map<string, Blob | null>();
    for (const [index, reference] of unique.entries()) {
      const record = stored[index];
      if (record === undefined) { result.set(reference.digestSha256, null); continue; }
      try {
        if (!record || record.collection !== definition.id || record.lookupKey !== keys[index] || record.codec !== this.codec.id
          || !Array.isArray(record.key) || record.key.length !== 2 || record.key[0] !== definition.id || record.key[1] !== keys[index]
          || !(record.payload instanceof ArrayBuffer) || record.payload.byteLength < reference.byteLength || record.payload.byteLength > reference.byteLength + 28) throw new Error('Invalid stored file envelope.');
        // Current codecs store exact bytes or a 12-byte nonce and 16-byte tag.
        result.set(reference.digestSha256, await codec.decode({ collection: definition.id, lookupKey: keys[index]!, reference, payload: record.payload }));
      } catch (cause) {
        if (cause instanceof BrowserLocalDataError && cause.code === 'LOCAL_DATA_LOCKED') throw cause;
        throw new BrowserLocalDataError('LOCAL_DATA_BINARY_INTEGRITY', 'Retained file bytes could not be verified. The reference remains available; no file was replaced.', { cause });
      }
    }
    return result;
  }

  #binaryCodec(definition: AnyLocalDataCollectionDefinition): BrowserLocalBinaryCodec {
    if (!definition.binaryReferences || !this.codec.binary) throw new BrowserLocalDataError('LOCAL_DATA_BINARY_UNSUPPORTED', 'This collection or workspace codec does not support retained files.');
    return this.codec.binary;
  }

  async #encodeBinaryFiles(definition: AnyLocalDataCollectionDefinition, files: readonly RetainedFileInput[]): Promise<PreparedBinaryFiles> {
    const encoded = new Map<string, { reference: RetainedFileReference; record: BrowserLocalStoredBinary }>();
    if (!files.length) return encoded;
    const codec = this.#binaryCodec(definition), keys = new Set<string>();
    for (const input of files) {
      const lookupKey = boundedIdentifier(await codec.lookupKey(definition.id, input.reference), 'Retained file lookup key', MAX_LOCAL_DATA_RECORD_ID_LENGTH);
      const previous = encoded.get(input.reference.digestSha256);
      if (previous ? previous.reference.byteLength !== input.reference.byteLength || previous.record.lookupKey !== lookupKey : keys.has(lookupKey)) throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', 'Retained files have conflicting content identities.');
      const payload = await codec.encode({ ...input, collection: definition.id, lookupKey });
      if (!(payload instanceof ArrayBuffer) || payload.byteLength < input.reference.byteLength || payload.byteLength > input.reference.byteLength + 28) throw new BrowserLocalDataError('INVALID_LOCAL_DATA_CODEC', 'The file codec returned an unsupported envelope.');
      keys.add(lookupKey);
      encoded.set(input.reference.digestSha256, { reference: input.reference, record: {
        key: [definition.id, lookupKey], collection: definition.id, lookupKey, codec: this.codec.id, payload,
      } });
    }
    return encoded;
  }

  async #binaryChanges(definition: AnyLocalDataCollectionDefinition, before: unknown, after: unknown, files: PreparedBinaryFiles = new Map()): Promise<PreparedBinaryChanges> {
    const previous = collectionBinaryReferences(definition, before), next = collectionBinaryReferences(definition, after);
    const writes: BrowserLocalStoredBinary[] = [];
    for (const { reference, record } of files.values()) {
      if (next.get(reference.digestSha256)?.byteLength !== reference.byteLength) throw new BrowserLocalDataError('LOCAL_DATA_BINARY_UNREFERENCED', 'A selected file has no matching reference in the saved collection.');
      writes.push(record);
    }
    const removed = [...previous.values()].filter(reference => !next.has(reference.digestSha256));
    return { collection: definition.id, writes, remove: removed.length
      ? await Promise.all(removed.map(reference => this.#binaryCodec(definition).lookupKey(definition.id, reference))) : [] };
  }

  #assertDefinitionBatch(definitions: readonly AnyLocalDataCollectionDefinition[]): void {
    if (!Array.isArray(definitions) || definitions.length < 1 || definitions.length > MAX_LOCAL_DATA_COLLECTIONS
      || definitions.some((definition) => !definition || typeof definition.id !== 'string')
      || new Set(definitions.map((definition) => definition.id)).size !== definitions.length) {
      throw new BrowserLocalDataError('INVALID_LOCAL_DATA_DEFINITION', 'A local-data batch requires a bounded, non-empty set of distinct collections.');
    }
  }

  async update<T, R>(
    definition: LocalDataCollectionDefinition<T>,
    updater: BrowserLocalDataUpdater<T, R>,
    options: BrowserLocalDataUpdateOptions = {},
  ): Promise<R> {
    options = captureBrowserLocalDataUpdateOptions(options);
    requirePendingLocalDataUpdate(options.signal);
    await this.#requireDefinition(definition);
    this.#requireConfirmedCommitState();
    const files = await this.#encodeBinaryFiles(definition, options.files ?? []);
    for (let attempt = 1; attempt <= MAX_LOCAL_DATA_UPDATE_ATTEMPTS; attempt++) {
      requirePendingLocalDataUpdate(options.signal);
      this.#requireConfirmedCommitState();
      const snapshot = await this.#readSnapshot(definition);
      const before = snapshot.manifest.schemaVersion === definition.schemaVersion
        ? definition.serialize(snapshot.document) : null;
      requirePendingLocalDataUpdate(options.signal);
      this.#requireConfirmedCommitState();
      const updated = await updater(snapshot.document);
      const document = definition.normalize(updated.document);
      requirePendingLocalDataUpdate(options.signal);
      this.#requireConfirmedCommitState();
      if (!files.size && before !== null && definition.serialize(document) === before) return updated.result;
      const prepared = await this.#prepare(definition, document, 'application', snapshot.manifest.legacyDigest, options);
      const binaries = await this.#binaryChanges(definition, snapshot.document, document, files);
      requirePendingLocalDataUpdate(options.signal);
      this.#requireConfirmedCommitState();
      if (!files.size && collectionContentMatches(prepared, snapshot.manifest, this.codec.id)) return updated.result;
      try {
        // Once a commit starts, its acknowledgement/recovery owns the outcome.
        // Cancellation must not turn a successful write into a retryable failure.
        this.#requireConfirmedCommitState();
        await this.#commit([prepared], new Map([[definition.id, snapshot.manifest]]), [binaries]);
        this.#notifyCommitted([definition.id]);
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
    options: BrowserLocalDataBatchUpdateOptions = {},
  ): Promise<R> {
    this.#assertDefinitionBatch(definitions);
    definitions = [...definitions];
    const selected = new Map<string, readonly RetainedFileInput[]>();
    if (options.files) {
      if (options.files.size > definitions.length) throw new BrowserLocalDataError('INVALID_LOCAL_DATA_UPDATE', 'The file batch exceeds its collection count.');
      for (const [collection, files] of options.files) {
        if (!definitions.some(definition => definition.id === collection)) throw new BrowserLocalDataError('INVALID_LOCAL_DATA_UPDATE', 'A file batch refers to an undeclared collection.');
        selected.set(collection, captureRetainedFiles(files));
      }
      const allFiles = [...selected.values()].flat();
      if (allFiles.length > MAX_SELECTED_FILES || allFiles.reduce((total, input) => total + input.reference.byteLength, 0) > MAX_SELECTED_FILE_TOTAL_BYTES) {
        throw new BrowserLocalDataError('LOCAL_DATA_QUOTA', 'The selected file batch exceeds its count or combined byte limit.');
      }
    }
    for (const definition of definitions) await this.#requireDefinition(definition);
    this.#requireConfirmedCommitState();
    const filesByCollection = new Map<string, PreparedBinaryFiles>();
    for (const definition of definitions) filesByCollection.set(definition.id, await this.#encodeBinaryFiles(definition, selected.get(definition.id) ?? []));
    for (let attempt = 1; attempt <= MAX_LOCAL_DATA_UPDATE_ATTEMPTS; attempt++) {
      this.#requireConfirmedCommitState();
      const snapshots = await this.#readSnapshots(definitions);
      const before = snapshots.map((snapshot, index) => snapshot.manifest.schemaVersion === definitions[index]!.schemaVersion
        ? definitions[index]!.serialize(snapshot.document) : null);
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
      const prepared: (PreparedCollection | null)[] = [];
      const binaries: PreparedBinaryChanges[] = [];
      for (let index = 0; index < definitions.length; index++) {
        const definition = definitions[index];
        const snapshot = snapshots[index];
        if (!definition || !snapshot) {
          throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', 'A browser-local batch snapshot is incomplete.');
        }
        if (!updated.documents.has(definition.id)) {
          throw new BrowserLocalDataError('INVALID_LOCAL_DATA_UPDATE', `The ${definition.label} batch update did not return a document.`);
        }
        const document = definition.normalize(updated.documents.get(definition.id));
        const files = filesByCollection.get(definition.id)!;
        prepared.push(!files.size && before[index] !== null && definition.serialize(document) === before[index]
          ? null : await this.#prepare(definition, document, 'application', snapshot.manifest.legacyDigest));
        binaries.push(await this.#binaryChanges(definition, snapshot.document, document, files));
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
      const changed = prepared.filter((item, index): item is PreparedCollection => {
        if (!item) return false;
        const snapshot = snapshots[index];
        return Boolean(filesByCollection.get(item.definition.id)?.size) || !snapshot || !collectionContentMatches(item, snapshot.manifest, this.codec.id);
      });
      if (!changed.length) return updated.result;
      try {
        this.#requireConfirmedCommitState();
        await this.#commit(changed, expectedManifests, binaries);
        this.#notifyCommitted(changed.map((item) => item.definition.id));
        return updated.result;
      } catch (cause) {
        if (!(cause instanceof BrowserLocalDataError) || cause.code !== 'LOCAL_DATA_CONFLICT' || attempt === MAX_LOCAL_DATA_UPDATE_ATTEMPTS) throw cause;
      }
    }
    throw new BrowserLocalDataError('LOCAL_DATA_CONFLICT', 'Browser-local data changed repeatedly in another tab. Try again.');
  }

  #notifyCommitted(collections: readonly string[]): void {
    try { void Promise.resolve(this.#oncommit?.(Object.freeze([...collections]))).catch(() => {}); }
    catch { /* A confirmed write is independent of its read-only observers. */ }
  }

  async close(): Promise<void> {
    try {
      await this.#storageAdapter.close();
    } finally {
      this.#initializationPromise = null;
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
    const storage = this.#storage;
    if (!storage) throw new BrowserLocalDataError('LOCAL_DATA_LEGACY_UNAVAILABLE', 'This workspace is stored outside the browser. Use a workspace backup instead of a legacy browser copy.');
    this.#assertDefinitionBatch(definitions);
    definitions = definitions.filter(definition => definition.legacyRollback !== false);
    if (!definitions.length) return Object.freeze({ collectionCount: 0, serializedBytes: 0, keys: Object.freeze([]) });
    const documents = await this.readMany(definitions);
    const copies = definitions.map((definition) => {
      const serialized = definition.serialize(documents.get(definition.id));
      return {
        key: definition.legacyKey,
        value: serialized,
        bytes: assertSerializedBound(serialized, definition.maximumBytes, definition.label),
      };
    });
    let snapshot: Map<string, string | null>;
    try { snapshot = new Map(copies.map((copy) => [copy.key, storage.getItem(copy.key)])); }
    catch (cause) {
      throw new BrowserLocalDataError('LOCAL_DATA_LEGACY_UNAVAILABLE', 'Could not read the legacy rollback copy before updating it.', { cause });
    }
    const applied: Array<{ key: string; value: string }> = [];
    try {
      for (const copy of copies) {
        storage.setItem(copy.key, copy.value);
        applied.push({ key: copy.key, value: copy.value });
      }
    } catch (cause) {
      let concurrentChange = false;
      try {
        for (let index = applied.length - 1; index >= 0; index -= 1) {
          const copy = applied[index]!;
          if (storage.getItem(copy.key) !== copy.value) {
            concurrentChange = true;
            continue;
          }
          const previous = snapshot.get(copy.key) ?? null;
          if (previous === null) storage.removeItem(copy.key);
          else storage.setItem(copy.key, previous);
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

  async #initialize(definitions: readonly AnyLocalDataCollectionDefinition[], approved: ReadonlySet<string>): Promise<BrowserLocalDataInitialization> {
    const manifestState = await this.#readManifestState(definitions);
    const manifests = definitions.map(definition => manifestState.get(definition.id));

    const missing = definitions.filter((_definition, index) => !manifests[index]);
    if (this.#requireExistingCollections && missing.some(definition => !approved.has(definition.id))) {
      throw new BrowserLocalDataError('LOCAL_DATA_MISSING', 'The encrypted workspace is missing collection manifests. No empty collections were created. Restore a backup into a new workspace, or use an explicit supported storage migration.');
    }
    const migratedCollections: string[] = [];
    const retainedLegacyKeys: string[] = [];
    if (missing.length) {
      const existingSnapshots = new Map<string, CollectionSnapshot<unknown>>();
      const existing = definitions.filter((_definition, index) => manifests[index]);
      if (existing.length) {
        const snapshots = await this.#readSnapshots(existing);
        for (const [index, definition] of existing.entries()) existingSnapshots.set(definition.id, snapshots[index]!);
      }
      const prepared: PreparedCollection[] = [];
      for (const definition of missing) {
        let raw: string | null;
        try { raw = this.#storage?.getItem(definition.legacyKey) ?? null; }
        catch (cause) {
          throw new BrowserLocalDataError('LOCAL_DATA_LEGACY_UNAVAILABLE', `Could not read legacy ${definition.label} data for migration.`, { cause });
        }
        if (approved.has(definition.id) && raw !== null) {
          throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', 'Explicit collection creation cannot replace a retained legacy document.');
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
        ])), [], approved);
        migratedCollections.push(...missing.map((definition) => definition.id));
      } catch (cause) {
        if (!(cause instanceof BrowserLocalDataError) || cause.code !== 'LOCAL_DATA_CONFLICT') throw cause;
      }
    }

    // The same bounded transaction used by readMany verifies every collection
    // without serial transport round trips or a retained snapshot cache.
    const snapshots = await this.#readSnapshots(definitions);
    for (const [index, definition] of definitions.entries()) {
      const snapshot = snapshots[index]!;
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
      scanBoundedJson(raw, boundedJsonLimitsForBytes(definition.maximumBytes));
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
    options: BrowserLocalDataUpdateOptions = {},
  ): Promise<PreparedCollection> {
    const prepare = options.preparation === 'background' ? this.#prepareInBackground : prepareLocalDataContent;
    const content = await prepare(definition, input, this.codec, options);
    return Object.freeze({
      ...content,
      definition,
      source,
      legacyDigest,
    });
  }

  async #readSnapshot<T>(definition: LocalDataCollectionDefinition<T>): Promise<CollectionSnapshot<T>> {
    return (await this.#readSnapshots([definition]))[0]!;
  }

  async #readSnapshots<T>(definitions: readonly LocalDataCollectionDefinition<T>[]): Promise<CollectionSnapshot<T>[]> {
    const captured = await this.#storageAdapter.capture(definitions.map(definition => definition.id));
    const documents = await this.#decodeSnapshots(definitions, captured, this.codec);
    if (documents.length !== captured.length) {
      throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', 'A browser-local snapshot is incomplete.');
    }
    return documents.map((document, index) => Object.freeze({ document, manifest: captured[index]!.manifest }));
  }

  async #commit(
    prepared: readonly PreparedCollection[],
    expected: ReadonlyMap<string, ExpectedManifest>,
    binaries: readonly PreparedBinaryChanges[] = [],
    createEmpty: ReadonlySet<string> = new Set(),
  ): Promise<void> {
    this.#requireConfirmedCommitState();
    const now = this.#now();
    const updatedAt = Number.isFinite(now.getTime()) ? now.toISOString() : new Date().toISOString();
    binaries = binaries.filter(change => change.writes.length || change.remove.length);
    for (const [collection, manifest] of expected) {
      if (!this.#definitions.has(collection) || (manifest !== null && manifest.collection !== collection)) {
        throw new BrowserLocalDataError('INVALID_LOCAL_DATA_UPDATE', 'A workspace update contains an invalid expected revision.');
      }
    }
    for (const item of prepared) if (!expected.has(item.definition.id)) {
      throw new BrowserLocalDataError('INVALID_LOCAL_DATA_UPDATE', 'A workspace update is missing its expected revision.');
    }
    for (const change of binaries) if (!prepared.some(item => item.definition.id === change.collection)) {
      throw new BrowserLocalDataError('INVALID_LOCAL_DATA_UPDATE', 'Retained files require an atomic collection update.');
    }
    const collections = prepared.map(item => ({
      manifest: proposedManifest(item, expected.get(item.definition.id)?.revision ?? 0, this.codec.id, updatedAt),
      records: item.records,
    }));
    try {
      await this.#storageAdapter.commit({ expected, collections, binaries, createEmpty });
    } catch (cause) {
      if (cause instanceof UnacknowledgedIndexedDbCommit) {
        this.#commitState = 'recovering';
        const outcome = await this.#classifyTimedOutCommit(prepared, expected,
          new Map(collections.map(item => [item.manifest.collection, item.manifest])));
        this.#commitState = outcome === 'unknown' ? 'unknown' : 'confirmed';
        if (outcome === 'committed') return;
        if (outcome === 'not_committed') throw cause;
      }
      if (!(cause instanceof BrowserLocalDataError) || ['LOCAL_DATA_TIMEOUT', 'LOCAL_DATA_COMMIT_UNKNOWN'].includes(cause.code)) {
        this.#commitState = 'unknown';
        throw new BrowserLocalDataError('LOCAL_DATA_COMMIT_UNKNOWN', 'The workspace write may have succeeded, but its outcome could not be confirmed. Reload and review the saved record before making another change.', { cause });
      }
      throw cause;
    }
  }

  async #classifyTimedOutCommit(
    prepared: readonly PreparedCollection[],
    expectedManifests: ReadonlyMap<string, ExpectedManifest>,
    proposedManifests: ReadonlyMap<string, BrowserLocalCollectionManifest>,
  ): Promise<'committed' | 'not_committed' | 'unknown'> {
    try {
      const snapshots = await this.#readSnapshots(prepared.map((item) => item.definition));
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
    const manifests = await this.#storageAdapter.manifests(definitions.map(definition => definition.id));
    if (manifests.length !== definitions.length) throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', 'The workspace manifest response is incomplete.');
    return new Map(definitions.map((definition, index) => {
      const manifest = manifests[index];
      if (manifest !== undefined) assertLocalDataManifest(definition, manifest);
      return [definition.id, manifest];
    }));
  }
}
