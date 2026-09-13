import { zipSync } from 'fflate';
import { parseBoundedJson, boundedJsonLimitsForBytes } from '../../lib/bounded-json.mts';
import { BROWSER_LOCAL_COLLECTION_MANIFEST, BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID } from '../contracts/browser-local-collection-manifest.mts';
import { LOCAL_WORKSPACE_MAX_FILES } from '../contracts/local-application.mts';
import { MAX_SELECTED_FILES, MAX_SELECTED_FILE_BYTES, MAX_SELECTED_FILE_TOTAL_BYTES } from '../contracts/selected-file-limits.mts';
import { array, digest, enumeration, exact, integer, iso, text } from '../evidence/artifact-structure.mts';
import { extractBoundedZipEntries } from '../interchange/bounded-zip-extraction.mts';
import { localDataRecordContent, type LocalDataCapture, type LocalDataManifest, type LocalDataStorageCommit, type LocalDataStoredBinary } from './local-data-storage.mts';

export const LOCAL_APPLICATION_PROTOCOL_VERSION = 1;
export const LOCAL_APPLICATION_MAX_FILES = LOCAL_WORKSPACE_MAX_FILES;
export const LOCAL_APPLICATION_MAX_MANIFEST_BYTES = 2_048;
// JSON escaping can double each already-encoded record; record envelopes and
// removal identities have separate space. File bodies travel as bytes, not base64.
export const LOCAL_APPLICATION_MAX_JSON_BYTES = BROWSER_LOCAL_COLLECTION_MANIFEST.reduce((sum, definition) =>
  sum + definition.maximumBytes * 4 + definition.maximumRecords * 2_048 + LOCAL_APPLICATION_MAX_MANIFEST_BYTES, 0)
  + LOCAL_APPLICATION_MAX_FILES * 80;
export const LOCAL_APPLICATION_MAX_TRANSFER_BYTES = LOCAL_APPLICATION_MAX_JSON_BYTES + MAX_SELECTED_FILE_TOTAL_BYTES + (MAX_SELECTED_FILES + 1) * 512;
export const LOCAL_APPLICATION_READ_REQUEST_BYTES = 16_384;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const COLLECTION_IDS = BROWSER_LOCAL_COLLECTION_MANIFEST.map(definition => definition.id);

export type LocalApplicationStorageRequest =
  | Readonly<{ operation: 'manifests' | 'capture'; collections: readonly string[] }>
  | Readonly<{ operation: 'files'; collection: string; keys: readonly string[] }>
  | Readonly<{ operation: 'commit'; bytes: Uint8Array }>
  | Readonly<{ operation: 'receipt'; operationId: string }>
  | Readonly<{ operation: 'close' }>;

export function localApplicationCollection(value: unknown) {
  const id = enumeration(value, COLLECTION_IDS, 'Workspace collection');
  return BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID[id as keyof typeof BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID];
}

export function localApplicationCollections(value: unknown): string[] {
  const ids = array(value, 'Workspace collections', COLLECTION_IDS.length, 1).map(item => localApplicationCollection(item).id);
  if (new Set(ids).size !== ids.length) throw new TypeError('Workspace collections must be distinct.');
  return ids;
}

export function localApplicationOperationId(value: unknown): string {
  const id = text(value, 'Workspace operation', 36);
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(id)) throw new TypeError('Invalid workspace operation identity.');
  return id;
}

export function readLocalApplicationManifest(value: unknown): LocalDataManifest {
  const item = exact(value, ['collection', 'schemaVersion', 'codec', 'revision', 'recordCount', 'serializedBytes', 'digest', 'source', 'updatedAt', 'legacyKey', 'legacyDigest'], 'Workspace manifest');
  const definition = localApplicationCollection(item.collection);
  integer(item.schemaVersion, 'Workspace schema', definition.minimumReadableVersion, definition.schemaVersion);
  if (item.codec !== 'json-v1') throw new TypeError('The local application requires its plaintext workspace codec.');
  integer(item.revision, 'Workspace revision', 1);
  integer(item.recordCount, 'Workspace record count', 0, definition.maximumRecords);
  integer(item.serializedBytes, 'Workspace bytes', 0, definition.maximumBytes);
  for (const value of [item.digest, item.legacyDigest]) if (value !== null && (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(value))) throw new TypeError('Invalid workspace integrity value.');
  if (item.digest === null) throw new TypeError('Workspace integrity is required.');
  enumeration(item.source, ['empty', 'legacy-localstorage', 'application'], 'Workspace source');
  iso(item.updatedAt, 'Workspace update time'); text(item.legacyKey, 'Legacy key', 160);
  return item as LocalDataManifest;
}

export async function readLocalApplicationCapture(value: unknown): Promise<LocalDataCapture> {
  const item = exact(value, ['manifest', 'records'], 'Workspace capture');
  const manifest = readLocalApplicationManifest(item.manifest), definition = localApplicationCollection(manifest.collection);
  const rows = array(item.records, 'Workspace records', definition.maximumRecords);
  if (rows.length !== manifest.recordCount) throw new TypeError('Workspace records do not match their manifest.');
  let retained = 0;
  const keys = new Set<string>();
  const records = rows.map((value, ordinal) => {
    const row = array(value, 'Workspace record', 3, 3);
    const lookupKey = text(row[0], 'Workspace record key', 256);
    if (keys.has(lookupKey)) throw new TypeError('Duplicate workspace record key.');
    keys.add(lookupKey);
    const payload = row[1];
    if (typeof payload !== 'string' || payload.length > definition.maximumBytes) throw new TypeError('Workspace record exceeds its byte limit.');
    const payloadBytes = integer(row[2], 'Workspace record bytes', 1, definition.maximumBytes);
    if (encoder.encode(payload).byteLength !== payloadBytes || (retained += payloadBytes) > definition.maximumBytes * 2) throw new TypeError('Workspace record byte counts do not match.');
    const decoded = exact(parseBoundedJson(payload, { maximumBytes: definition.maximumBytes, limits: boundedJsonLimitsForBytes(definition.maximumBytes) }), ['id', 'value'], 'Stored workspace record');
    if (decoded.id !== lookupKey) throw new TypeError('Workspace payload identity does not match its key.');
    return { key: [manifest.collection, lookupKey] as [string, string], collection: manifest.collection, lookupKey, ordinal, codec: manifest.codec, payload, payloadBytes };
  });
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(localDataRecordContent(records))));
  const hash = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  if (hash !== manifest.digest) throw new TypeError('Workspace records fail integrity verification.');
  return { manifest, records };
}

export function localApplicationCaptureValue(capture: LocalDataCapture) {
  return { manifest: capture.manifest, records: capture.records.map(record => [record.lookupKey, record.payload, record.payloadBytes]) };
}

export function parseLocalApplicationJson(bytes: Uint8Array, maximumBytes = LOCAL_APPLICATION_MAX_JSON_BYTES): unknown {
  if (bytes.byteLength < 1 || bytes.byteLength > maximumBytes) throw new TypeError('Workspace message exceeds its byte limit.');
  return parseBoundedJson(decoder.decode(bytes), { maximumBytes, limits: {
    ...boundedJsonLimitsForBytes(maximumBytes), maximumContainerItems: LOCAL_APPLICATION_MAX_FILES,
  } });
}

export function encodeLocalApplicationCommit(change: LocalDataStorageCommit, operationId: string): Uint8Array {
  localApplicationOperationId(operationId);
  const files: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
  let fileCount = 0, fileBytes = 0;
  const binaries = change.binaries.map(change => ({
    collection: change.collection, remove: change.remove, writes: change.writes.map(record => {
      if (++fileCount > MAX_SELECTED_FILES || record.payload.byteLength > MAX_SELECTED_FILE_BYTES
        || (fileBytes += record.payload.byteLength) > MAX_SELECTED_FILE_TOTAL_BYTES) throw new TypeError('Workspace file batch exceeds its bounds.');
      const name = `files/${fileCount}`;
      files[name] = new Uint8Array(record.payload);
      return { name, lookupKey: record.lookupKey, bytes: record.payload.byteLength };
    }),
  }));
  files['transaction.json'] = encoder.encode(JSON.stringify({ version: LOCAL_APPLICATION_PROTOCOL_VERSION, operationId,
    expected: [...change.expected], collections: change.collections.map(localApplicationCaptureValue), binaries, createEmpty: [...change.createEmpty] }));
  if (files['transaction.json'].byteLength > LOCAL_APPLICATION_MAX_JSON_BYTES) throw new TypeError('Workspace transaction exceeds its byte limit.');
  const bytes = zipSync(files, { level: 0 });
  if (bytes.byteLength > LOCAL_APPLICATION_MAX_TRANSFER_BYTES) throw new TypeError('Workspace transaction exceeds its transfer limit.');
  return bytes;
}

function extractLocalApplicationPacket(input: Uint8Array, metadataName: string, maximumJsonBytes: number) {
  if (input.byteLength > LOCAL_APPLICATION_MAX_TRANSFER_BYTES) throw new TypeError('Workspace transaction exceeds its transfer limit.');
  const { files } = extractBoundedZipEntries(input, {
    maximumEntries: MAX_SELECTED_FILES + 1, maximumSelectedBytes: maximumJsonBytes + MAX_SELECTED_FILE_TOTAL_BYTES,
    keyForName: name => name,
    inspect: (entry, metadata) => {
      if (!['file', 'unspecified'].includes(metadata.kind) || entry.compression !== 0
        || (entry.name !== metadataName && !/^files\/[1-9][0-9]{0,2}$/u.test(entry.name))) throw new TypeError('Unexpected workspace transaction entry.');
      return { key: entry.name, selected: true, maximumBytes: entry.name === metadataName ? maximumJsonBytes : MAX_SELECTED_FILE_BYTES, exceededMessage: 'Workspace transaction entry exceeds its bounds.' };
    }, selectedBytesExceededMessage: 'Workspace transaction exceeds its expanded bounds.', metadataMismatchMessage: 'Workspace transaction ZIP metadata is inconsistent.',
  });
  return files;
}

export function encodeLocalApplicationFiles(records: readonly (LocalDataStoredBinary | undefined)[]): Uint8Array {
  if (records.length > MAX_SELECTED_FILES) throw new TypeError('Too many selected workspace files.');
  const files: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
  let bytes = 0;
  for (const [index, record] of records.entries()) if (record) {
    if (record.payload.byteLength > MAX_SELECTED_FILE_BYTES || (bytes += record.payload.byteLength) > MAX_SELECTED_FILE_TOTAL_BYTES) throw new TypeError('Selected workspace files exceed their byte limit.');
    files[`files/${index + 1}`] = new Uint8Array(record.payload);
  }
  files['files.json'] = encoder.encode(JSON.stringify({ version: LOCAL_APPLICATION_PROTOCOL_VERSION, present: records.map(Boolean) }));
  return zipSync(files, { level: 0 });
}

export function decodeLocalApplicationFiles(input: Uint8Array, keys: readonly string[]): (LocalDataStoredBinary | undefined)[] {
  array(keys, 'Selected workspace files', MAX_SELECTED_FILES);
  const files = extractLocalApplicationPacket(input, 'files.json', LOCAL_APPLICATION_READ_REQUEST_BYTES), metadata = files.get('files.json');
  if (!metadata) throw new TypeError('Selected workspace file metadata is missing.');
  const item = exact(parseLocalApplicationJson(metadata, LOCAL_APPLICATION_READ_REQUEST_BYTES), ['version', 'present'], 'Selected workspace files');
  const present = array(item.present, 'Selected workspace file presence', keys.length, keys.length);
  if (item.version !== LOCAL_APPLICATION_PROTOCOL_VERSION || present.some(value => typeof value !== 'boolean')) throw new TypeError('Unsupported selected workspace file response.');
  let consumed = 1, bytes = 0;
  const result = keys.map((key, index) => {
    digest(key, 'Retained file key');
    const content = files.get(`files/${index + 1}`);
    if (present[index] !== Boolean(content) || (bytes += content?.byteLength ?? 0) > MAX_SELECTED_FILE_TOTAL_BYTES) throw new TypeError('Selected workspace file response is incomplete.');
    if (!content) return undefined;
    consumed++;
    return { key: ['cases', key] as [string, string], collection: 'cases', lookupKey: key, codec: 'json-v1', payload: content.slice().buffer };
  });
  if (consumed !== files.size) throw new TypeError('Selected workspace file response contains extra entries.');
  return result;
}

export async function decodeLocalApplicationCommit(input: Uint8Array): Promise<LocalDataStorageCommit & Readonly<{ operationId: string }>> {
  const files = extractLocalApplicationPacket(input, 'transaction.json', LOCAL_APPLICATION_MAX_JSON_BYTES);
  const metadata = files.get('transaction.json');
  if (!metadata) throw new TypeError('Workspace transaction metadata is missing.');
  const item = exact(parseLocalApplicationJson(metadata), ['version', 'operationId', 'expected', 'collections', 'binaries', 'createEmpty'], 'Workspace transaction');
  if (item.version !== LOCAL_APPLICATION_PROTOCOL_VERSION) throw new TypeError('Unsupported local application protocol version. Update the application; nothing was changed.');
  const operationId = localApplicationOperationId(item.operationId);
  const expected = new Map<string, LocalDataManifest | null>();
  for (const value of array(item.expected, 'Expected workspace revisions', COLLECTION_IDS.length, 1)) {
    const [key, raw] = array(value, 'Expected workspace revision', 2, 2), id = localApplicationCollection(key).id;
    const manifest = raw === null ? null : readLocalApplicationManifest(raw);
    if (expected.has(id) || manifest && manifest.collection !== id) throw new TypeError('Invalid expected workspace revision.');
    expected.set(id, manifest);
  }
  const collections = await Promise.all(array(item.collections, 'Changed workspace collections', expected.size, 1).map(readLocalApplicationCapture));
  if (new Set(collections.map(capture => capture.manifest.collection)).size !== collections.length) throw new TypeError('Duplicate changed workspace collection.');
  for (const { manifest } of collections) {
    const before = expected.get(manifest.collection);
    if (before === undefined || manifest.revision !== (before?.revision ?? 0) + 1
      || manifest.schemaVersion !== localApplicationCollection(manifest.collection).schemaVersion
      || before && manifest.legacyKey !== before.legacyKey) throw new TypeError('Invalid proposed workspace revision.');
  }
  const createEmpty = item.createEmpty;
  const createIds = array(createEmpty, 'New workspace collections', expected.size).map(id => localApplicationCollection(id).id);
  if (new Set(createIds).size !== createIds.length || createIds.some(id => !expected.has(id))) throw new TypeError('Invalid workspace creation guard.');
  const consumed = new Set(['transaction.json']);
  let fileBytes = 0;
  const binaries = array(item.binaries, 'Changed workspace files', 1).map(value => {
    const group = exact(value, ['collection', 'writes', 'remove'], 'Changed workspace files');
    if (group.collection !== 'cases' || !collections.some(capture => capture.manifest.collection === group.collection)) throw new TypeError('Retained files require an atomic Case collection update.');
    const removed = array(group.remove, 'Removed workspace files', LOCAL_APPLICATION_MAX_FILES).map(key => { digest(key, 'Retained file key'); return key as string; });
    if (new Set(removed).size !== removed.length) throw new TypeError('Duplicate retained-file removal.');
    const keys = new Set<string>();
    const writes = array(group.writes, 'Retained workspace files', MAX_SELECTED_FILES).map(value => {
      const write = exact(value, ['name', 'lookupKey', 'bytes'], 'Retained workspace file');
      const name = text(write.name, 'Transaction entry', 16); digest(write.lookupKey, 'Retained file key');
      const bytes = integer(write.bytes, 'Retained file bytes', 1, MAX_SELECTED_FILE_BYTES), content = files.get(name);
      if (!content || consumed.has(name) || keys.has(write.lookupKey as string) || content.byteLength !== bytes
        || (fileBytes += bytes) > MAX_SELECTED_FILE_TOTAL_BYTES) throw new TypeError('Retained workspace file metadata does not match its bytes.');
      consumed.add(name); keys.add(write.lookupKey as string);
      return { key: ['cases', write.lookupKey as string] as [string, string], collection: 'cases', lookupKey: write.lookupKey as string,
        codec: 'json-v1', payload: content.slice().buffer } satisfies LocalDataStoredBinary;
    });
    return { collection: 'cases', writes, remove: removed };
  });
  if (consumed.size !== files.size) throw new TypeError('Workspace transaction contains unreferenced entries.');
  return { operationId, expected, collections, binaries, createEmpty: new Set(createIds) };
}
