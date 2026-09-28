import { assertBoundedJsonStructure, boundedJsonLimitsForBytes, scanBoundedJson } from './bounded-json.ts';
import { plaintextLocalBinaryCodec, type BrowserLocalBinaryCodec, type BrowserLocalStoredBinary } from './browser-local-binaries.ts';
import { captureRetainedFiles, readRetainedFileReference, type RetainedFileInput, type RetainedFileReference } from '../../../packages/evidence/retained-file.mts';
import { MAX_SELECTED_FILES } from '../../../packages/contracts/selected-file-limits.mts';
import {
  localDataRecordContent as canonicalRecordContent,
  type LocalDataStoredRecord as BrowserLocalStoredRecord,
  type LocalDataManifest as BrowserLocalCollectionManifest,
  type LocalDataCapture as CapturedLocalDataCollection,
} from '../../../packages/workspace/local-data-storage.mts';
export type {
  LocalDataStoredRecord as BrowserLocalStoredRecord,
  LocalDataManifest as BrowserLocalCollectionManifest,
  LocalDataCapture as CapturedLocalDataCollection,
} from '../../../packages/workspace/local-data-storage.mts';

export const LOCAL_DATA_OPERATION_TIMEOUT_MS = 10_000;
export const MAX_LOCAL_DATA_OPERATION_TIMEOUT_MS = 60_000;
export const MAX_LOCAL_DATA_COLLECTIONS = 16;
export const MAX_LOCAL_DATA_RECORDS_PER_COLLECTION = 2_000;
export const MAX_LOCAL_DATA_RECORD_ID_LENGTH = 256;
export const MAX_LOCAL_DATA_CODEC_ID_LENGTH = 64;
export const MAX_LOCAL_DATA_UPDATE_ATTEMPTS = 3;

const TEXT_ENCODER = new TextEncoder();

export type BrowserStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type LocalDataRecord<Value = unknown> = Readonly<{
  id: string;
  value: Value;
}>;

export type BrowserLocalDataInitializationOptions = Readonly<{
  /** Explicit approval to create only these absent, record-free collections. */
  createMissingCollections?: readonly string[];
}>;

type LocalDataCollectionMetadata = Readonly<{
  id: string;
  label: string;
  legacyKey: string;
  legacyRollback?: boolean;
  schemaVersion: number;
  minimumReadableVersion?: number;
  acceptsUnversionedLegacy?: boolean;
  maximumBytes: number;
  maximumRecords: number;
}>;

export type LocalDataCollectionDefinition<T> = LocalDataCollectionMetadata & Readonly<{
  empty: () => T;
  acceptLegacyRoot: (raw: unknown) => boolean;
  normalize: (raw: unknown) => T;
  version: (raw: unknown) => number | null;
  serialize: (document: T) => string;
  split: (document: T) => LocalDataRecord[];
  /** Optional compact wire records; split always exposes normalized values. */
  storageRecords?: (document: T) => LocalDataRecord[];
  /** Immutable content referenced by this collection, separately from provenance. */
  binaryReferences?: (document: T) => readonly RetainedFileReference[];
  join: (records: LocalDataRecord[], schemaVersion: number) => unknown;
}>;

// Heterogeneous batch operations cannot retain each collection's private
// document type in one array. Method syntax keeps those parameters correlated
// at the concrete definition while the provider treats mixed documents as
// unknown until the owning definition normalizes them.
export type AnyLocalDataCollectionDefinition = LocalDataCollectionMetadata & Readonly<{
  empty(): unknown;
  acceptLegacyRoot(raw: unknown): boolean;
  normalize(raw: unknown): unknown;
  version(raw: unknown): number | null;
  serialize(document: unknown): string;
  split(document: unknown): LocalDataRecord[];
  storageRecords?(document: unknown): LocalDataRecord[];
  binaryReferences?(document: unknown): readonly RetainedFileReference[];
  join(records: LocalDataRecord[], schemaVersion: number): unknown;
}>;

export type EncodedLocalDataRecord = Readonly<{
  lookupKey: string;
  payload: string;
}>;

export function localDataStorageRecords<T>(definition: LocalDataCollectionDefinition<T>, document: T): LocalDataRecord[] {
  return definition.storageRecords ? definition.storageRecords(document) : definition.split(document);
}

export type DecodedLocalDataRecord = Readonly<{
  id: string;
  value: unknown;
}>;

/**
 * The provider coordinates updates while the codec owns record confidentiality and
 * lookup-key disclosure. The current json-v1 codec stores plaintext records.
 */
export interface BrowserLocalDataCodec {
  readonly id: string;
  /** Optional immutable-file storage; missing support must never use plaintext. */
  readonly binary?: BrowserLocalBinaryCodec;
  /** Encoding overhead only; decoded collection and record bounds are unchanged. */
  encodedBytes?(plaintextBytes: number, records: number): number;
  /** A keyed codec authenticates the ordered collection, not just each record. */
  digestCollection?(input: Readonly<{ collection: string; schemaVersion: number; serializedBytes: number; content: string }>): Promise<string>;
  encode(input: Readonly<{ collection: string; id: string; value: unknown; maximumBytes: number }>): Promise<EncodedLocalDataRecord>;
  decode(input: Readonly<{ collection: string; lookupKey: string; payload: string; maximumBytes: number }>): Promise<DecodedLocalDataRecord>;
}

export type PreparedLocalDataContent = Readonly<{
  records: BrowserLocalStoredRecord[];
  serializedBytes: number;
  digest: string;
}>;

export type PreparedCollection = PreparedLocalDataContent & Readonly<{
  definition: AnyLocalDataCollectionDefinition;
  source: BrowserLocalCollectionManifest['source'];
  legacyDigest: string | null;
}>;

/** A pure update may be repeated against a newer revision after a conflict. */
export type BrowserLocalDataUpdater<T, R> = (current: T) =>
  | Readonly<{ document: T; result: R }>
  | Promise<Readonly<{ document: T; result: R }>>;

export type BrowserLocalDataUpdateOptions = Readonly<{
  preparation?: 'background';
  signal?: AbortSignal;
  files?: readonly RetainedFileInput[];
}>;

export function captureBrowserLocalDataUpdateOptions(options: BrowserLocalDataUpdateOptions): BrowserLocalDataUpdateOptions {
  return Object.freeze({ ...options, ...(options.files ? { files: captureRetainedFiles(options.files) } : {}) });
}

export type PreparedBinaryFiles = ReadonlyMap<string, Readonly<{ reference: RetainedFileReference; record: BrowserLocalStoredBinary }>>;
export type BrowserLocalDataBatchUpdateOptions = Readonly<{ files?: ReadonlyMap<string, readonly RetainedFileInput[]> }>;

export function collectionBinaryReferences(definition: AnyLocalDataCollectionDefinition, document: unknown): Map<string, RetainedFileReference> {
  const references = definition.binaryReferences?.(document) ?? [];
  if (!Array.isArray(references) || references.length > definition.maximumRecords * MAX_SELECTED_FILES) {
    throw new BrowserLocalDataError('INVALID_LOCAL_DATA_UPDATE', `${definition.label} exceeds its bounded file-reference count.`);
  }
  const unique = new Map<string, RetainedFileReference>();
  for (const value of references) {
    const reference = readRetainedFileReference(value);
    const previous = unique.get(reference.digestSha256);
    if (previous && previous.byteLength !== reference.byteLength) throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', 'One file digest has conflicting byte lengths.');
    unique.set(reference.digestSha256, reference);
  }
  return unique;
}

export type BrowserLocalDataPreparer = (
  definition: AnyLocalDataCollectionDefinition,
  input: unknown,
  codec: BrowserLocalDataCodec,
  options?: Readonly<{ signal?: AbortSignal }>,
) => Promise<PreparedLocalDataContent>;

export function requirePendingLocalDataUpdate(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Browser-local update was cancelled before saving.', 'AbortError');
}

export type CollectionSnapshot<T> = Readonly<{
  document: T;
  manifest: BrowserLocalCollectionManifest;
}>;

export type BrowserLocalDataSnapshotDecoder = <T>(
  definitions: readonly LocalDataCollectionDefinition<T>[],
  captured: readonly CapturedLocalDataCollection[],
  codec: BrowserLocalDataCodec,
) => Promise<T[]>;

export type BrowserLocalCommitState = 'confirmed' | 'recovering' | 'unknown';
export type ExpectedManifest = BrowserLocalCollectionManifest | null;

export function collectionContentMatches(
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

export function proposedManifest(item: PreparedCollection, revision: number, codec: string, updatedAt: string): BrowserLocalCollectionManifest {
  const manifest = Object.freeze({
    collection: item.definition.id, schemaVersion: item.definition.schemaVersion,
    codec, revision: revision + 1, recordCount: item.records.length,
    serializedBytes: item.serializedBytes, digest: item.digest, source: item.source,
    updatedAt, legacyKey: item.definition.legacyKey, legacyDigest: item.legacyDigest,
  });
  assertLocalDataManifest(item.definition, manifest);
  return manifest;
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

export function boundedIdentifier(value: unknown, label: string, maximumLength: number): string {
  if (typeof value !== 'string') throw new BrowserLocalDataError('INVALID_LOCAL_DATA_ID', `${label} must be a string.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    throw new BrowserLocalDataError('INVALID_LOCAL_DATA_ID', `${label} is invalid or exceeds its bound.`);
  }
  return normalized;
}

export function byteLength(value: string): number {
  return TEXT_ENCODER.encode(value).byteLength;
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(value);
}

export function encodedByteLimit(codec: BrowserLocalDataCodec, plaintextBytes: number, records: number): number {
  const limit = codec.encodedBytes?.(plaintextBytes, records) ?? plaintextBytes;
  if (!Number.isSafeInteger(limit) || limit < plaintextBytes || limit > plaintextBytes * 4 + records * 256) {
    throw new BrowserLocalDataError('INVALID_LOCAL_DATA_CODEC', 'The local-data codec declares an unsupported encoding bound.');
  }
  return limit;
}

async function collectionDigest(codec: BrowserLocalDataCodec, collection: string, schemaVersion: number, serializedBytes: number, records: readonly BrowserLocalStoredRecord[]): Promise<string> {
  const content = canonicalRecordContent(records);
  const digest = codec.digestCollection
    ? await codec.digestCollection({ collection, schemaVersion, serializedBytes, content })
    : await sha256(content);
  if (!isDigest(digest)) throw new BrowserLocalDataError('INVALID_LOCAL_DATA_CODEC', 'The local-data codec returned an invalid integrity value.');
  return digest;
}

export function assertSerializedBound(value: string, maximumBytes: number, label: string): number {
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

export async function sha256(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new BrowserLocalDataError('LOCAL_DATA_CRYPTO_UNAVAILABLE', 'Browser cryptography is unavailable, so local-data integrity cannot be verified.');
  return base64Url(new Uint8Array(await subtle.digest('SHA-256', TEXT_ENCODER.encode(value))));
}

export function verifyStoredRecord(
  record: BrowserLocalStoredRecord,
  definition: Pick<AnyLocalDataCollectionDefinition, 'id' | 'label' | 'maximumRecords'>,
  codec: string,
  lookupKeys: Set<string>,
  remainingBytes: number,
): void {
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
    || record.payloadBytes > remainingBytes
    || record.payload.length > remainingBytes) {
    throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', `${definition.label} contains an invalid stored record.`);
  }
  const actualBytes = byteLength(record.payload);
  if (record.payloadBytes !== actualBytes || actualBytes > remainingBytes) {
    throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', `${definition.label} contains an invalid stored record.`);
  }
  lookupKeys.add(record.lookupKey);
}

/** Validate the worker transport without repeating domain normalisation or hashing. */
export function assertPreparedLocalDataContent(
  definition: AnyLocalDataCollectionDefinition, input: unknown, codec: string,
): asserts input is PreparedLocalDataContent {
  const content = input as PreparedLocalDataContent | null;
  if (!content || !Number.isSafeInteger(content.serializedBytes) || content.serializedBytes < 0
    || content.serializedBytes > definition.maximumBytes || !isDigest(content.digest)
    || !Array.isArray(content.records) || content.records.length > definition.maximumRecords) {
    throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', 'Browser-local preparation returned an incomplete or unexpected collection.');
  }
  const keys = new Set<string>();
  let bytes = 0;
  for (const [ordinal, record] of content.records.entries()) {
    verifyStoredRecord(record, definition, codec, keys, Math.min(definition.maximumBytes, definition.maximumBytes * 2 - bytes));
    if (record.ordinal !== ordinal) throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', 'Prepared browser-local records have an invalid order.');
    bytes += record.payloadBytes;
  }
}

export function normalizeDefinition<T extends AnyLocalDataCollectionDefinition>(definition: T): T {
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
  if (definition.legacyRollback !== undefined && typeof definition.legacyRollback !== 'boolean') {
    throw new BrowserLocalDataError('INVALID_LOCAL_DATA_DEFINITION', `${definition.label} has an invalid legacy rollback policy.`);
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
  if (definition.binaryReferences !== undefined && typeof definition.binaryReferences !== 'function') {
    throw new BrowserLocalDataError('INVALID_LOCAL_DATA_DEFINITION', `${definition.label} has an invalid file-reference projection.`);
  }
  return definition;
}

export function decodeLocalDataJsonRecord(payload: string, maximumBytes: number): DecodedLocalDataRecord {
  const limits = boundedJsonLimitsForBytes(maximumBytes);
  assertSerializedBound(payload, maximumBytes, 'Browser-local record');
  scanBoundedJson(payload, limits);
  const parsed = JSON.parse(payload) as { id?: unknown; value?: unknown };
  const id = boundedIdentifier(parsed?.id, 'Decoded record identifier', MAX_LOCAL_DATA_RECORD_ID_LENGTH);
  return { id, value: parsed.value };
}

export const plaintextJsonCodec: BrowserLocalDataCodec = Object.freeze<BrowserLocalDataCodec>({
  id: 'json-v1',
  binary: plaintextLocalBinaryCodec,
  async encode(input) {
    const id = boundedIdentifier(input.id, 'Record identifier', MAX_LOCAL_DATA_RECORD_ID_LENGTH);
    const document = { id, value: input.value };
    const limits = boundedJsonLimitsForBytes(input.maximumBytes);
    assertBoundedJsonStructure(document, 'Browser-local record', limits);
    const payload = JSON.stringify(document);
    assertSerializedBound(payload, input.maximumBytes, 'Browser-local record');
    return { lookupKey: id, payload };
  },
  async decode(input) {
    const record = decodeLocalDataJsonRecord(input.payload, input.maximumBytes);
    if (record.id !== input.lookupKey) {
      throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', 'A browser-local record lookup key does not match its payload.');
    }
    return record;
  },
});

export type BrowserLocalDataCommitListener = (collections: readonly string[]) => void;

/** Pure verification after bounded records and manifests leave their transaction. */
export async function decodeLocalDataSnapshots<T>(
  definitions: readonly LocalDataCollectionDefinition<T>[],
  captured: readonly CapturedLocalDataCollection[],
  codec: BrowserLocalDataCodec,
): Promise<T[]> {
  if (captured.length !== definitions.length || captured.length > MAX_LOCAL_DATA_COLLECTIONS) {
    throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', 'A browser-local snapshot is incomplete.');
  }
  return Promise.all(captured.map(async ({ manifest, records }, index) => {
    const definition = definitions[index]!;
    assertLocalDataManifest(definition, manifest);
    if (manifest.collection !== definition.id || manifest.codec !== codec.id
      || records.length !== manifest.recordCount || records.length > definition.maximumRecords) {
      throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', `${definition.label} record count or identity does not match its manifest.`);
    }
    const lookupKeys = new Set<string>();
    let encodedBytes = 0;
    for (const record of records) {
      verifyStoredRecord(record, definition, codec.id, lookupKeys, Math.min(encodedByteLimit(codec, definition.maximumBytes, 1), encodedByteLimit(codec, definition.maximumBytes * 2, definition.maximumRecords) - encodedBytes));
      encodedBytes += record.payloadBytes;
    }
    records.sort((left, right) => left.ordinal - right.ordinal || left.lookupKey.localeCompare(right.lookupKey));
    for (const [ordinal, record] of records.entries()) {
      if (record.ordinal !== ordinal) {
        throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', `${definition.label} contains an invalid stored record order.`);
      }
    }
    if (await collectionDigest(codec, definition.id, manifest.schemaVersion, manifest.serializedBytes, records) !== manifest.digest) {
      throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', `${definition.label} records do not match their verified manifest.`);
    }
    const decoded: LocalDataRecord[] = [];
    for (const record of records) {
      try { decoded.push(await codec.decode({ collection: definition.id, lookupKey: record.lookupKey, payload: record.payload, maximumBytes: definition.maximumBytes })); }
      catch (cause) {
        throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', `${definition.label} contains a record that could not be verified.`, { cause });
      }
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
    return document;
  }));
}

export function assertLocalDataManifest<T>(
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

/** Pure collection preparation shared by foreground and same-origin worker paths. */
export async function prepareLocalDataContent(
  definition: AnyLocalDataCollectionDefinition,
  input: unknown,
  codec: BrowserLocalDataCodec,
  options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<PreparedLocalDataContent> {
  requirePendingLocalDataUpdate(options.signal);
  let document: unknown;
  try { document = definition.normalize(input); }
  catch (cause) {
    throw new BrowserLocalDataError('INVALID_LOCAL_DATA', `${definition.label} could not be normalized.`, { cause });
  }
  const serialized = definition.serialize(document);
  const serializedBytes = assertSerializedBound(serialized, definition.maximumBytes, definition.label);
  const records = localDataStorageRecords(definition, document);
  if (!Array.isArray(records) || records.length > definition.maximumRecords || records.length > MAX_LOCAL_DATA_RECORDS_PER_COLLECTION) {
    throw new BrowserLocalDataError('LOCAL_DATA_RECORD_LIMIT', `${definition.label} exceeds its record limit.`);
  }
  const seen = new Set<string>();
  const storedRecords: BrowserLocalStoredRecord[] = [];
  let encodedBytes = 0;
  for (let ordinal = 0; ordinal < records.length; ordinal++) {
    requirePendingLocalDataUpdate(options.signal);
    const record = records[ordinal];
    if (!record) throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', `${definition.label} contains an incomplete record.`);
    const id = boundedIdentifier(record.id, `${definition.label} record identifier`, MAX_LOCAL_DATA_RECORD_ID_LENGTH);
    if (seen.has(id)) throw new BrowserLocalDataError('LOCAL_DATA_DUPLICATE_ID', `${definition.label} contains a duplicate record identifier.`);
    seen.add(id);
    let encoded: EncodedLocalDataRecord;
    try { encoded = await codec.encode({ collection: definition.id, id, value: record.value, maximumBytes: definition.maximumBytes }); }
    catch (cause) {
      throw new BrowserLocalDataError('LOCAL_DATA_ENCODING_FAILED', `${definition.label} could not be encoded for browser storage.`, { cause });
    }
    const lookupKey = boundedIdentifier(encoded.lookupKey, `${definition.label} lookup key`, MAX_LOCAL_DATA_RECORD_ID_LENGTH);
    const payloadBytes = assertSerializedBound(encoded.payload, encodedByteLimit(codec, definition.maximumBytes, 1), `${definition.label} record`);
    encodedBytes += payloadBytes;
    if (encodedBytes > encodedByteLimit(codec, definition.maximumBytes * 2, definition.maximumRecords)) {
      throw new BrowserLocalDataError('LOCAL_DATA_QUOTA', `${definition.label} encoded records exceed their application limit.`);
    }
    storedRecords.push(Object.freeze({
      key: [definition.id, lookupKey] as [string, string], collection: definition.id,
      lookupKey, ordinal, codec: codec.id, payload: encoded.payload, payloadBytes,
    }));
  }
  if (new Set(storedRecords.map((record) => record.lookupKey)).size !== storedRecords.length) {
    throw new BrowserLocalDataError('LOCAL_DATA_DUPLICATE_ID', `${definition.label} codec produced a duplicate lookup key.`);
  }
  const digest = await collectionDigest(codec, definition.id, definition.schemaVersion, serializedBytes, storedRecords);
  requirePendingLocalDataUpdate(options.signal);
  return Object.freeze({ records: storedRecords, serializedBytes, digest });
}
