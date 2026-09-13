import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants, type Stats } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { constants as sqlConstants, DatabaseSync } from 'node:sqlite';
import { MAX_SELECTED_FILES, MAX_SELECTED_FILE_BYTES, MAX_SELECTED_FILE_TOTAL_BYTES } from '../packages/contracts/selected-file-limits.mts';
import { readCaseAttachments } from '../packages/cases/case-attachment-model.mts';
import { exact, array, digest } from '../packages/evidence/artifact-structure.mts';
import {
  LOCAL_APPLICATION_MAX_FILES, LOCAL_APPLICATION_MAX_MANIFEST_BYTES,
  localApplicationCollection, localApplicationCollections, localApplicationOperationId,
  localApplicationCaptureValue, parseLocalApplicationJson, readLocalApplicationCapture,
  readLocalApplicationManifest,
} from '../packages/workspace/local-application-protocol.mts';
import { localDataManifestMatches, type LocalDataCapture, type LocalDataManifest, type LocalDataStorageCommit, type LocalDataStoredBinary } from '../packages/workspace/local-data-storage.mts';
import { boundedJsonLimitsForBytes, parseBoundedJson } from './bounded-json.mts';
import { LocalWorkspaceError } from './local-application-errors.mts';
import { LOCAL_WORKSPACE_FILE, LOCAL_WORKSPACE_FORMAT_VERSION, LOCAL_WORKSPACE_APPLICATION_ID as APPLICATION_ID, LOCAL_WORKSPACE_MAX_DATABASE_BYTES as MAX_DATABASE_BYTES } from '../packages/contracts/local-application.mts';
export { LocalWorkspaceError } from './local-application-errors.mts';
export { LOCAL_WORKSPACE_FILE, LOCAL_WORKSPACE_FORMAT_VERSION } from '../packages/contracts/local-application.mts';

const MAX_RECEIPTS = 1_024;
const TABLE_DEFINITIONS = [
  'CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT',
  'CREATE TABLE collections (id TEXT PRIMARY KEY, manifest TEXT NOT NULL) STRICT',
  'CREATE TABLE records (collection TEXT NOT NULL REFERENCES collections(id), key TEXT NOT NULL, ordinal INTEGER NOT NULL, payload TEXT NOT NULL, bytes INTEGER NOT NULL, PRIMARY KEY(collection,key), UNIQUE(collection,ordinal)) STRICT',
  'CREATE TABLE files (key TEXT PRIMARY KEY, content BLOB NOT NULL) STRICT',
  'CREATE TABLE receipts (id TEXT PRIMARY KEY, digest TEXT NOT NULL, sequence INTEGER NOT NULL UNIQUE) STRICT',
] as const;
const TABLES = ['metadata', 'collections', 'records', 'files', 'receipts'];

type FileIdentity = Readonly<{ dev: number; ino: number }>;
function requirePrivateFile(stat: Stats, directory: boolean): void {
  if (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1 || stat.size > MAX_DATABASE_BYTES) {
    throw new LocalWorkspaceError('LOCAL_DATA_INTEGRITY', 'The workspace must contain private regular files, not symbolic links or special files.');
  }
  if (process.platform !== 'win32' && ((stat.mode & 0o077) !== 0 || process.getuid && stat.uid !== process.getuid())) {
    throw new LocalWorkspaceError('LOCAL_DATA_PERMISSIONS', 'The workspace folder and files must be private to the current operating-system user. No permissions were changed.');
  }
}

async function inspectWorkspaceFiles(directory: string, expected?: Readonly<{ directory: FileIdentity; file: FileIdentity }>) {
  const folder = await lstat(directory), file = await lstat(path.join(directory, LOCAL_WORKSPACE_FILE));
  requirePrivateFile(folder, true); requirePrivateFile(file, false);
  if (expected && (folder.dev !== expected.directory.dev || folder.ino !== expected.directory.ino || file.dev !== expected.file.dev || file.ino !== expected.file.ino)) {
    throw new LocalWorkspaceError('LOCAL_DATA_COMMIT_UNKNOWN', 'The workspace file or directory was replaced while open. Stop this instance and inspect the selected folder before continuing.');
  }
  for (const suffix of ['-journal', '-wal', '-shm']) {
    try {
      const stat = await lstat(path.join(directory, `${LOCAL_WORKSPACE_FILE}${suffix}`));
      requirePrivateFile(stat, false);
      if (suffix !== '-journal') throw new LocalWorkspaceError('LOCAL_DATA_INTEGRITY', 'Unexpected workspace journal mode. Use the application version that created this workspace.');
    } catch (cause) { if (!(cause instanceof Error && 'code' in cause && cause.code === 'ENOENT')) throw cause; }
  }
  return { directory: { dev: folder.dev, ino: folder.ino }, file: { dev: file.dev, ino: file.ino } };
}

async function inspectFormatBeforeWrite(file: string): Promise<void> {
  const handle = await open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
  try {
    const header = Buffer.alloc(100);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead !== 100 || header.subarray(0, 16).toString('binary') !== 'SQLite format 3\0'
      || header.readUInt32BE(68) !== APPLICATION_ID) throw new LocalWorkspaceError('LOCAL_DATA_INTEGRITY', 'The selected file is not a local application workspace.');
    if (header.readUInt32BE(60) !== LOCAL_WORKSPACE_FORMAT_VERSION) throw new LocalWorkspaceError('LOCAL_DATA_FUTURE_SCHEMA', 'Unsupported workspace file version. Open it with a compatible application; the file was not changed.');
  } finally { await handle.close(); }
}

/** One explicit folder; database paths and SQL never come from HTTP input. */
export class LocalApplicationStore {
  readonly directory: string;
  readonly workspaceId: string;
  #database: DatabaseSync;
  #identity: Readonly<{ directory: FileIdentity; file: FileIdentity }>;
  #closed = false;

  private constructor(directory: string, database: DatabaseSync, identity: Readonly<{ directory: FileIdentity; file: FileIdentity }>, workspaceId: string) {
    this.directory = directory; this.#database = database; this.#identity = identity; this.workspaceId = workspaceId;
  }

  static async open(selected: string, options: Readonly<{ create?: boolean }> = {}): Promise<LocalApplicationStore> {
    if (typeof selected !== 'string' || !selected.trim() || selected.length > 4_096 || /[\u0000-\u001f\u007f]/u.test(selected)) throw new LocalWorkspaceError('INVALID_LOCAL_DATA_PATH', 'Choose a valid workspace directory explicitly.');
    const requested = path.resolve(selected);
    const parent = await realpath(path.dirname(requested)), directory = path.join(parent, path.basename(requested));
    if (options.create) {
      try { await mkdir(directory, { mode: 0o700 }); }
      catch (cause) { if (!(cause instanceof Error && 'code' in cause && cause.code === 'EEXIST')) throw cause; }
    }
    requirePrivateFile(await lstat(directory), true);
    const filename = path.join(directory, LOCAL_WORKSPACE_FILE);
    if (options.create) {
      // Exclusive creation never replaces an existing workspace, including a
      // newer, damaged or empty file left for explicit recovery.
      const handle = await open(filename, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR | fsConstants.O_NOFOLLOW, 0o600);
      await handle.close();
    } else await inspectFormatBeforeWrite(filename);
    const identity = await inspectWorkspaceFiles(directory);
    const database = new DatabaseSync(filename, { allowExtension: false, defensive: true, timeout: 0 });
    try {
      database.exec('PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON; PRAGMA cache_size=-8192; PRAGMA temp_store=MEMORY;');
      if (options.create) {
        database.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=${LOCAL_WORKSPACE_FORMAT_VERSION}; BEGIN IMMEDIATE;`);
        for (const statement of TABLE_DEFINITIONS) database.exec(statement);
        database.prepare('INSERT INTO metadata VALUES (?,?)').run('workspaceId', randomUUID());
        database.exec('COMMIT');
      }
      // Reject triggers, views, rewritten tables and extra schema before any
      // application query or write can invoke a changed database structure.
      const counts = database.prepare('SELECT length(name) AS nameBytes, length(sql) AS sqlBytes FROM sqlite_schema LIMIT 17').all();
      if (counts.length > 16 || counts.some(row => Number(row.nameBytes) > 128 || Number(row.sqlBytes ?? 0) > 1_024)) throw new LocalWorkspaceError('LOCAL_DATA_INTEGRITY', 'Unexpected workspace database structure.');
      const entries = database.prepare('SELECT type,name,sql FROM sqlite_schema').all();
      const tables = entries.filter(entry => entry.type === 'table');
      if (tables.length !== TABLE_DEFINITIONS.length || TABLE_DEFINITIONS.some((sql, index) => !tables.some(entry => entry.name === TABLES[index] && entry.sql === sql))
        || entries.some(entry => entry.type !== 'table' && (entry.type !== 'index' || entry.sql !== null || !/^sqlite_autoindex_(metadata|collections|records|files|receipts)_[12]$/u.test(String(entry.name))))) {
        throw new LocalWorkspaceError('LOCAL_DATA_INTEGRITY', 'Unexpected workspace database structure.');
      }
      if (database.prepare('PRAGMA user_version').get()?.user_version !== LOCAL_WORKSPACE_FORMAT_VERSION
        || database.prepare('PRAGMA application_id').get()?.application_id !== APPLICATION_ID
        || database.prepare('PRAGMA journal_mode').get()?.journal_mode !== 'delete') throw new LocalWorkspaceError('LOCAL_DATA_FUTURE_SCHEMA', 'Unsupported workspace file version or journal mode.');
      database.exec('PRAGMA synchronous=FULL;');
      const identityRow = database.prepare('SELECT key, length(value) AS bytes FROM metadata LIMIT 2').all();
      if (identityRow.length !== 1 || identityRow[0]?.key !== 'workspaceId' || identityRow[0]?.bytes !== 36) throw new LocalWorkspaceError('LOCAL_DATA_INTEGRITY', 'Invalid workspace identity.');
      const workspaceId = localApplicationOperationId(database.prepare('SELECT value FROM metadata WHERE key=?').get('workspaceId')?.value);
      database.setAuthorizer((action, arg1, arg2, dbName, source) => {
        if (source || dbName && dbName !== 'main') return sqlConstants.SQLITE_DENY;
        if ([sqlConstants.SQLITE_ATTACH, sqlConstants.SQLITE_DETACH, sqlConstants.SQLITE_PRAGMA].includes(action)) return sqlConstants.SQLITE_DENY;
        if (action === sqlConstants.SQLITE_FUNCTION && !['length', 'sum', 'count', 'max', 'coalesce'].includes(arg2 ?? '')) return sqlConstants.SQLITE_DENY;
        if ([sqlConstants.SQLITE_READ, sqlConstants.SQLITE_INSERT, sqlConstants.SQLITE_UPDATE, sqlConstants.SQLITE_DELETE].includes(action)
          && !TABLES.includes(arg1 ?? '')) return sqlConstants.SQLITE_DENY;
        return [sqlConstants.SQLITE_SELECT, sqlConstants.SQLITE_READ, sqlConstants.SQLITE_INSERT, sqlConstants.SQLITE_UPDATE,
          sqlConstants.SQLITE_DELETE, sqlConstants.SQLITE_TRANSACTION, sqlConstants.SQLITE_FUNCTION].includes(action) ? sqlConstants.SQLITE_OK : sqlConstants.SQLITE_DENY;
      });
      await inspectWorkspaceFiles(directory, identity);
      return new LocalApplicationStore(directory, database, identity, workspaceId);
    } catch (cause) { database.close(); throw cause; }
  }

  async #check(): Promise<void> {
    if (this.#closed) throw new LocalWorkspaceError('LOCAL_DATA_CLOSED', 'The local workspace is closed.');
    await inspectWorkspaceFiles(this.directory, this.#identity);
  }

  #manifest(id: string): LocalDataManifest | undefined {
    const size = this.#database.prepare('SELECT length(CAST(manifest AS BLOB)) AS bytes FROM collections WHERE id=?').get(id);
    if (!size) return undefined;
    if (!Number.isSafeInteger(size.bytes) || Number(size.bytes) > LOCAL_APPLICATION_MAX_MANIFEST_BYTES) throw new LocalWorkspaceError('LOCAL_DATA_INTEGRITY', 'Stored workspace manifest exceeds its bounds.');
    const raw = this.#database.prepare('SELECT manifest FROM collections WHERE id=?').get(id)?.manifest;
    if (typeof raw !== 'string') throw new LocalWorkspaceError('LOCAL_DATA_INTEGRITY', 'Stored workspace manifest is missing.');
    const manifest = readLocalApplicationManifest(parseLocalApplicationJson(Buffer.from(raw), LOCAL_APPLICATION_MAX_MANIFEST_BYTES));
    if (manifest.collection !== id) throw new LocalWorkspaceError('LOCAL_DATA_INTEGRITY', 'Stored workspace manifest identity does not match.');
    return manifest;
  }

  async manifests(ids: readonly string[]): Promise<(LocalDataManifest | undefined)[]> {
    localApplicationCollections(ids); await this.#check();
    this.#database.exec('BEGIN');
    try { const result = ids.map(id => this.#manifest(id)); this.#database.exec('COMMIT'); return result; }
    catch (cause) { this.#database.exec('ROLLBACK'); throw cause; }
  }

  async capture(ids: readonly string[]): Promise<LocalDataCapture[]> {
    localApplicationCollections(ids); await this.#check();
    this.#database.exec('BEGIN');
    let values: unknown[];
    try {
      values = ids.map(id => {
        const definition = localApplicationCollection(id), manifest = this.#manifest(id);
        if (!manifest) throw new LocalWorkspaceError('LOCAL_DATA_MISSING', 'A workspace collection is missing.');
        const sizes = this.#database.prepare('SELECT count(*) AS count, sum(length(CAST(payload AS BLOB))) AS bytes, max(length(key)) AS keyLength FROM records WHERE collection=?').get(id)!;
        if (Number(sizes.count) !== manifest.recordCount || Number(sizes.bytes ?? 0) > definition.maximumBytes * 2 || Number(sizes.keyLength ?? 0) > 256) throw new LocalWorkspaceError('LOCAL_DATA_INTEGRITY', 'Stored workspace records exceed their bounds.');
        const records = this.#database.prepare('SELECT key,ordinal,payload,bytes FROM records WHERE collection=? ORDER BY ordinal').all(id);
        if (records.some((record, index) => record.ordinal !== index)) throw new LocalWorkspaceError('LOCAL_DATA_INTEGRITY', 'Stored workspace record order is invalid.');
        return { manifest, records: records.map(record => [record.key, record.payload, record.bytes]) };
      });
      this.#database.exec('COMMIT');
    } catch (cause) { this.#database.exec('ROLLBACK'); throw cause; }
    return Promise.all(values.map(readLocalApplicationCapture));
  }

  async files(collection: string, keys: readonly string[]): Promise<(LocalDataStoredBinary | undefined)[]> {
    if (collection !== 'cases') throw new LocalWorkspaceError('LOCAL_DATA_BINARY_UNSUPPORTED', 'Only Cases retain original files.');
    array(keys, 'Selected retained files', MAX_SELECTED_FILES); for (const key of keys) digest(key, 'Retained file key');
    if (new Set(keys).size !== keys.length) throw new TypeError('Select distinct retained files.');
    await this.#check(); this.#database.exec('BEGIN');
    try {
      let bytes = 0;
      const sizes = keys.map(key => this.#database.prepare('SELECT length(content) AS bytes FROM files WHERE key=?').get(key)?.bytes);
      if (sizes.some(size => size !== undefined && (!Number.isSafeInteger(size) || Number(size) < 1 || Number(size) > MAX_SELECTED_FILE_BYTES || (bytes += Number(size)) > MAX_SELECTED_FILE_TOTAL_BYTES))) throw new LocalWorkspaceError('LOCAL_DATA_QUOTA', 'Selected file bytes exceed the operation limit.');
      const result = keys.map((key, index) => {
        if (sizes[index] === undefined) return undefined;
        const content = this.#database.prepare('SELECT content FROM files WHERE key=?').get(key)?.content;
        if (!(content instanceof Uint8Array) || content.byteLength !== sizes[index] || `sha256:${createHash('sha256').update(content).digest('hex')}` !== key) throw new LocalWorkspaceError('LOCAL_DATA_BINARY_INTEGRITY', 'Retained file bytes failed integrity verification.');
        return { key: [collection, key] as [string, string], collection, lookupKey: key, codec: 'json-v1', payload: content.slice().buffer };
      });
      this.#database.exec('COMMIT'); return result;
    } catch (cause) { this.#database.exec('ROLLBACK'); throw cause; }
  }

  async receipt(id: string): Promise<string | null> {
    localApplicationOperationId(id); await this.#check();
    return this.#receipt(id);
  }

  #receipt(id: string): string | null {
    const row = this.#database.prepare('SELECT length(digest) AS bytes FROM receipts WHERE id=?').get(id);
    if (!row) return null;
    if (row.bytes !== 64) throw new LocalWorkspaceError('LOCAL_DATA_INTEGRITY', 'Invalid workspace commit acknowledgement.');
    const value = this.#database.prepare('SELECT digest FROM receipts WHERE id=?').get(id)?.digest;
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new LocalWorkspaceError('LOCAL_DATA_INTEGRITY', 'Invalid workspace commit acknowledgement.');
    return value;
  }

  /** Input has already passed the bounded transaction decoder; recheck captures before writing. */
  async commit(change: LocalDataStorageCommit, operationId: string, requestDigest: string): Promise<void> {
    localApplicationOperationId(operationId);
    if (!/^[a-f0-9]{64}$/u.test(requestDigest)) throw new TypeError('Invalid transaction digest.');
    const captures = await Promise.all(change.collections.map(capture => readLocalApplicationCapture(localApplicationCaptureValue(capture))));
    const cases = captures.find(capture => capture.manifest.collection === 'cases');
    const references = new Map<string, number>();
    if (cases) for (const stored of cases.records) {
      const decoded = exact(parseBoundedJson(stored.payload, { maximumBytes: localApplicationCollection('cases').maximumBytes, limits: boundedJsonLimitsForBytes(localApplicationCollection('cases').maximumBytes) }), ['id', 'value'], 'Case record');
      const value = decoded.value as Record<string, unknown> | null;
      for (const attachment of readCaseAttachments(value?.attachments) ?? []) {
        const previous = references.get(attachment.digestSha256);
        if (previous !== undefined && previous !== attachment.byteLength) throw new TypeError('Conflicting retained file lengths.');
        references.set(attachment.digestSha256, attachment.byteLength);
      }
    }
    let fileBytes = 0, fileCount = 0;
    for (const group of change.binaries) {
      if (!cases || group.collection !== 'cases') throw new TypeError('Files require an atomic Case change.');
      for (const key of group.remove) if (references.has(key)) throw new TypeError('A retained file is still referenced by a Case.');
      for (const record of group.writes) {
        if (record.collection !== 'cases' || record.codec !== 'json-v1' || references.get(record.lookupKey) !== record.payload.byteLength
          || ++fileCount > MAX_SELECTED_FILES || (fileBytes += record.payload.byteLength) > MAX_SELECTED_FILE_TOTAL_BYTES
          || `sha256:${createHash('sha256').update(new Uint8Array(record.payload)).digest('hex')}` !== record.lookupKey) throw new TypeError('Retained file bytes have no matching verified Case reference.');
      }
    }
    await this.#check();
    let committed = false, commitAttempted = false;
    try {
      this.#database.exec('BEGIN IMMEDIATE');
      const previousReceipt = this.#receipt(operationId);
      if (previousReceipt) {
        if (previousReceipt !== requestDigest) throw new LocalWorkspaceError('LOCAL_DATA_INTEGRITY', 'A workspace operation identity was reused with different content.');
        this.#database.exec('ROLLBACK'); committed = true; return;
      }
      for (const [id, expected] of change.expected) {
        localApplicationCollection(id);
        if (!localDataManifestMatches(this.#manifest(id), expected)) throw new LocalWorkspaceError('LOCAL_DATA_CONFLICT', 'The workspace changed in another tab or instance.');
        if (expected === null) {
          const records = this.#database.prepare('SELECT count(*) AS count FROM records WHERE collection=?').get(id)?.count;
          const files = id === 'cases' ? this.#database.prepare('SELECT count(*) AS count FROM files').get()?.count : 0;
          if (records !== 0 || files !== 0) throw new LocalWorkspaceError('LOCAL_DATA_INTEGRITY', 'An absent collection still has retained records or files. Nothing was replaced.');
        }
      }
      for (const capture of captures) {
        const expected = change.expected.get(capture.manifest.collection);
        if (expected === undefined || capture.manifest.revision !== (expected?.revision ?? 0) + 1) throw new TypeError('A workspace write has an invalid expected revision.');
        const serialized = JSON.stringify(capture.manifest);
        if (Buffer.byteLength(serialized) > LOCAL_APPLICATION_MAX_MANIFEST_BYTES) throw new TypeError('Workspace manifest exceeds its bounds.');
        this.#database.prepare('INSERT INTO collections VALUES (?,?) ON CONFLICT(id) DO UPDATE SET manifest=excluded.manifest').run(capture.manifest.collection, serialized);
        this.#database.prepare('DELETE FROM records WHERE collection=?').run(capture.manifest.collection);
        const insert = this.#database.prepare('INSERT INTO records VALUES (?,?,?,?,?)');
        for (const record of capture.records) insert.run(record.collection, record.lookupKey, record.ordinal, record.payload, record.payloadBytes);
      }
      if (cases) {
        const count = this.#database.prepare('SELECT count(*) AS count, max(length(key)) AS keyLength FROM files').get()!;
        if (Number(count.count) > LOCAL_APPLICATION_MAX_FILES || Number(count.keyLength ?? 0) > 71) throw new TypeError('Workspace file inventory exceeds its bounds.');
        for (const row of this.#database.prepare('SELECT key FROM files').all()) if (!references.has(String(row.key))) this.#database.prepare('DELETE FROM files WHERE key=?').run(row.key!);
      }
      const write = this.#database.prepare('INSERT INTO files VALUES (?,?) ON CONFLICT(key) DO UPDATE SET content=excluded.content');
      for (const group of change.binaries) for (const record of group.writes) write.run(record.lookupKey, new Uint8Array(record.payload));
      if (Number(this.#database.prepare('SELECT count(*) AS count FROM files').get()?.count) > LOCAL_APPLICATION_MAX_FILES) throw new TypeError('Workspace file inventory exceeds its bounds.');
      const sequence = Number(this.#database.prepare('SELECT coalesce(max(sequence),0) AS value FROM receipts').get()?.value) + 1;
      if (!Number.isSafeInteger(sequence)) throw new TypeError('Workspace acknowledgement sequence is exhausted.');
      this.#database.prepare('INSERT INTO receipts VALUES (?,?,?)').run(operationId, requestDigest, sequence);
      this.#database.prepare('DELETE FROM receipts WHERE sequence<=?').run(sequence - MAX_RECEIPTS);
      commitAttempted = true;
      this.#database.exec('COMMIT'); committed = true;
      await this.#check();
    } catch (cause) {
      if (committed || commitAttempted && !this.#database.isTransaction) throw new LocalWorkspaceError('LOCAL_DATA_COMMIT_UNKNOWN', 'The workspace write may have committed, but its outcome could not be reverified. Reload and inspect the saved record before changing it again.', { cause });
      if (this.#database.isTransaction) {
        try { this.#database.exec('ROLLBACK'); }
        catch { throw new LocalWorkspaceError('LOCAL_DATA_COMMIT_UNKNOWN', 'The workspace transaction outcome could not be confirmed.', { cause }); }
      }
      if (cause instanceof LocalWorkspaceError) throw cause;
      const code = cause instanceof Error && 'errcode' in cause ? cause.errcode : null;
      if (code === 5 || code === 6) throw new LocalWorkspaceError('LOCAL_DATA_CONFLICT', 'Another instance is writing this workspace. Retry after it finishes.');
      throw new LocalWorkspaceError('LOCAL_DATA_WRITE_FAILED', 'The workspace transaction was not saved. Check available disk space and access to the selected folder.', { cause });
    }
  }

  close(): void { if (!this.#closed) { this.#database.close(); this.#closed = true; } }
}
