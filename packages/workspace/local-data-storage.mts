/** Stored representations shared by the browser coordinator and local adapters. */
export type LocalDataStoredRecord = Readonly<{
  key: [string, string];
  collection: string;
  lookupKey: string;
  ordinal: number;
  codec: string;
  payload: string;
  payloadBytes: number;
}>;

export type LocalDataManifest = Readonly<{
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

export type LocalDataStoredBinary = Readonly<{
  key: [string, string]; collection: string; lookupKey: string; codec: string; payload: ArrayBuffer;
}>;

export type LocalDataCapture = Readonly<{ manifest: LocalDataManifest; records: LocalDataStoredRecord[] }>;
export type LocalDataBinaryChanges = Readonly<{
  collection: string; writes: readonly LocalDataStoredBinary[]; remove: readonly string[];
}>;
export type LocalDataStorageCommit = Readonly<{
  expected: ReadonlyMap<string, LocalDataManifest | null>;
  collections: readonly LocalDataCapture[];
  binaries: readonly LocalDataBinaryChanges[];
  createEmpty: ReadonlySet<string>;
}>;

/**
 * Transaction I/O only. Domain normalisation, draft coordination, migration,
 * codecs and conflict retries remain with the existing local-data provider.
 * A rejected commit must distinguish a confirmed non-write from an unknown
 * outcome; an adapter must never make an uncertain write retryable.
 */
export interface LocalDataStorage {
  manifests(collections: readonly string[]): Promise<(LocalDataManifest | undefined)[]>;
  capture(collections: readonly string[]): Promise<LocalDataCapture[]>;
  files(collection: string, keys: readonly string[]): Promise<(LocalDataStoredBinary | undefined)[]>;
  commit(change: LocalDataStorageCommit): Promise<void>;
  close(): Promise<void>;
}

export function localDataRecordContent(records: readonly LocalDataStoredRecord[]): string {
  return JSON.stringify(records.map(record => [record.lookupKey, record.ordinal, record.codec, record.payload, record.payloadBytes]));
}

export function localDataManifestMatches(manifest: LocalDataManifest | undefined, expected: LocalDataManifest | null): boolean {
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
