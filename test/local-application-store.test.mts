import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { unzipSync, zipSync } from 'fflate';
import { LocalApplicationStore, LocalWorkspaceError, LOCAL_WORKSPACE_FILE } from '../lib/local-application-store.mts';
import { BrowserLocalDataError, BrowserLocalDataProvider } from '../frontend/src/lib/browser-local-data.ts';
import { BROWSER_LOCAL_COLLECTIONS, CASES_COLLECTION, CASE_DRAFTS_COLLECTION } from '../frontend/src/lib/browser-local-data-definitions.ts';
import { encodeLocalApplicationCommit, decodeLocalApplicationCommit, LOCAL_APPLICATION_MAX_TRANSFER_BYTES } from '../packages/workspace/local-application-protocol.mts';
import { type LocalDataStorage, type LocalDataStorageCommit } from '../packages/workspace/local-data-storage.mts';
import { CURRENT_CASE_TIME, currentCaseFixture } from './support/current-case.mts';
import { caseStoreAtCapacity } from './workspace-backup-capacity-fixture.mts';
import { MAX_CASE_STORE_BYTES } from '../packages/contracts/case-portability.mts';
import { serializeCaseStore } from '../packages/cases/case-storage-model.mts';
import { MAX_SELECTED_FILE_TOTAL_BYTES } from '../packages/contracts/selected-file-limits.mts';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

test('the independent version-one SQL fixture opens without rewriting its identity or schema', async () => withWorkspace(async directory => {
  const filename = path.join(directory, LOCAL_WORKSPACE_FILE);
  await writeFile(filename, '', { mode: 0o600 });
  const database = new DatabaseSync(filename);
  database.exec(await readFile(new URL('./fixtures/local-application/workspace-v1.sql', import.meta.url), 'utf8')); database.close();
  const before = await readFile(filename), store = await LocalApplicationStore.open(directory);
  try { assert.equal(store.workspaceId, '00000000-0000-4000-8000-000000000001'); }
  finally { store.close(); }
  assert.deepEqual(await readFile(filename), before);
}));

test('maximum Case bytes and a maximum retained-file batch survive the filesystem transaction without pruning', async () => withWorkspace(async directory => {
  const store = await LocalApplicationStore.open(directory, { create: true }), data = providerFor(store);
  try {
    await data.initialize(BROWSER_LOCAL_COLLECTIONS);
    const { cases } = caseStoreAtCapacity();
    assert.equal(Buffer.byteLength(serializeCaseStore(cases)), MAX_CASE_STORE_BYTES);
    await data.update(CASES_COLLECTION, () => ({ document: cases, result: null }));
    assert.deepEqual(await data.read(CASES_COLLECTION), cases);
    const bytes = new Uint8Array(MAX_SELECTED_FILE_TOTAL_BYTES).fill(83);
    const reference = { digestSha256: `sha256:${sha(bytes)}`, byteLength: bytes.byteLength };
    const record = currentCaseFixture({ attachments: [{ ...reference, id: 'maximum-file', fileName: 'evidence.bin', mediaType: 'application/octet-stream', source: null, observedAt: null, retainedAt: CURRENT_CASE_TIME }] });
    await data.update(CASES_COLLECTION, () => ({ document: [record], result: null }), { files: [{ reference, file: new Blob([bytes]) }] });
    const restored = await data.readFiles(CASES_COLLECTION, [reference]);
    assert.equal(restored.get(reference.digestSha256)?.size, MAX_SELECTED_FILE_TOTAL_BYTES);
    assert.equal(sha(new Uint8Array(await restored.get(reference.digestSha256)!.arrayBuffer())), sha(bytes));
  } finally { await data.close(); }
}));

async function withWorkspace(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'workspace-store-test-'));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

function providerFor(store: LocalApplicationStore, onCommit?: (change: LocalDataStorageCommit, bytes: Uint8Array) => void) {
  const adapter: LocalDataStorage = {
    manifests: ids => store.manifests(ids), capture: ids => store.capture(ids), files: (id, keys) => store.files(id, keys),
    async commit(change) {
      try {
        const bytes = encodeLocalApplicationCommit(change, randomUUID());
        const decoded = await decodeLocalApplicationCommit(bytes);
        onCommit?.(change, bytes);
        await store.commit(decoded, decoded.operationId, sha(bytes));
      } catch (cause) {
        if (cause instanceof LocalWorkspaceError) throw new BrowserLocalDataError(cause.code, cause.message);
        throw cause;
      }
    },
    async close() { store.close(); },
  };
  return new BrowserLocalDataProvider({ storageAdapter: adapter });
}

test('filesystem workspace initialisation, complete collection capture and restart preserve the exact saved records', async () => withWorkspace(async directory => {
  const store = await LocalApplicationStore.open(directory, { create: true });
  const identity = store.workspaceId, provider = providerFor(store);
  try {
    await provider.initialize(BROWSER_LOCAL_COLLECTIONS);
    assert.equal((await store.capture(BROWSER_LOCAL_COLLECTIONS.map(definition => definition.id))).length, BROWSER_LOCAL_COLLECTIONS.length);
    const fixture = currentCaseFixture();
    await provider.update(CASES_COLLECTION, () => ({ document: [fixture], result: null }));
    await provider.close();
    const restored = await LocalApplicationStore.open(directory), next = providerFor(restored);
    try {
      assert.equal(restored.workspaceId, identity);
      await next.initialize(BROWSER_LOCAL_COLLECTIONS);
      assert.deepEqual(await next.read(CASES_COLLECTION), [fixture]);
      assert.equal((await lstat(path.join(directory, LOCAL_WORKSPACE_FILE))).mode & 0o077, 0);
    } finally { await next.close(); }
  } finally { store.close(); }
}));

test('a missing workspace is not silently created and initialisation never replaces an existing file', async () => withWorkspace(async directory => {
  await assert.rejects(LocalApplicationStore.open(directory), { code: 'ENOENT' });
  const store = await LocalApplicationStore.open(directory, { create: true }); store.close();
  const before = await readFile(path.join(directory, LOCAL_WORKSPACE_FILE));
  await assert.rejects(LocalApplicationStore.open(directory, { create: true }), { code: 'EEXIST' });
  assert.deepEqual(await readFile(path.join(directory, LOCAL_WORKSPACE_FILE)), before);
}));

test('the database and parent folder reject symbolic links and broad filesystem access', async () => withWorkspace(async directory => {
  const selected = path.join(directory, 'selected');
  await symlink(directory, selected);
  await assert.rejects(LocalApplicationStore.open(selected, { create: true }), { code: 'LOCAL_DATA_INTEGRITY' });
  const store = await LocalApplicationStore.open(directory, { create: true }); store.close();
  const file = path.join(directory, LOCAL_WORKSPACE_FILE);
  await chmod(file, 0o644);
  await assert.rejects(LocalApplicationStore.open(directory), { code: 'LOCAL_DATA_PERMISSIONS' });
  await chmod(file, 0o600);
  await symlink(file, `${file}-journal`);
  await assert.rejects(LocalApplicationStore.open(directory), { code: 'LOCAL_DATA_INTEGRITY' });
}));

test('future workspace versions are rejected before write access and preserve every byte', async () => withWorkspace(async directory => {
  const store = await LocalApplicationStore.open(directory, { create: true }); store.close();
  const file = path.join(directory, LOCAL_WORKSPACE_FILE), db = new DatabaseSync(file);
  db.exec('PRAGMA user_version=99'); db.close();
  const before = await readFile(file);
  await assert.rejects(LocalApplicationStore.open(directory), { code: 'LOCAL_DATA_FUTURE_SCHEMA' });
  assert.deepEqual(await readFile(file), before);
}));

test('unexpected tables, triggers and views cannot be opened as a current workspace', async () => {
  for (const sql of [
    'CREATE TABLE extra (value TEXT)',
    'CREATE VIEW substitute AS SELECT * FROM records',
    'CREATE TRIGGER changed AFTER INSERT ON records BEGIN DELETE FROM collections; END',
  ]) await withWorkspace(async directory => {
    const store = await LocalApplicationStore.open(directory, { create: true }); store.close();
    const db = new DatabaseSync(path.join(directory, LOCAL_WORKSPACE_FILE)); db.exec(sql); db.close();
    await assert.rejects(LocalApplicationStore.open(directory), { code: 'LOCAL_DATA_INTEGRITY' });
  });
});

test('separate instances preserve concurrent Case changes through the existing revision retry', async () => withWorkspace(async directory => {
  const first = await LocalApplicationStore.open(directory, { create: true }), second = await LocalApplicationStore.open(directory);
  const a = providerFor(first), b = providerFor(second);
  try {
    await a.initialize(BROWSER_LOCAL_COLLECTIONS); await b.initialize(BROWSER_LOCAL_COLLECTIONS);
    let resume!: () => void, reached!: () => void;
    const paused = new Promise<void>(resolve => { resume = resolve; }), ready = new Promise<void>(resolve => { reached = resolve; });
    let calls = 0;
    const saving = a.update(CASES_COLLECTION, async current => {
      if (++calls === 1) { reached(); await paused; }
      return { document: [...current, currentCaseFixture({ id: 'first' })], result: null };
    });
    await ready;
    await b.update(CASES_COLLECTION, current => ({ document: [...current, currentCaseFixture({ id: 'second' })], result: null }));
    resume(); await saving;
    assert.equal(calls, 2);
    assert.deepEqual((await a.read(CASES_COLLECTION)).map(record => record.id), ['second', 'first']);
  } finally { await a.close(); await b.close(); }
}));

test('replaying a confirmed transaction is idempotent and changing its content under the same operation ID is rejected', async () => withWorkspace(async directory => {
  const store = await LocalApplicationStore.open(directory, { create: true });
  let packet: Uint8Array | undefined;
  const provider = providerFor(store, (_change, bytes) => { packet = bytes; });
  try {
    await provider.initialize(BROWSER_LOCAL_COLLECTIONS);
    await provider.update(CASES_COLLECTION, () => ({ document: [currentCaseFixture()], result: null }));
    const bytes = packet!, decoded = await decodeLocalApplicationCommit(bytes);
    await store.commit(decoded, decoded.operationId, sha(bytes));
    assert.equal(await store.receipt(decoded.operationId), sha(bytes));
    assert.equal((await store.manifests(['cases']))[0]?.revision, 2);
    assert.equal((await provider.read(CASES_COLLECTION)).length, 1);
    await assert.rejects(store.commit(decoded, decoded.operationId, 'a'.repeat(64)), { code: 'LOCAL_DATA_INTEGRITY' });
    const database = new DatabaseSync(path.join(directory, LOCAL_WORKSPACE_FILE));
    try { database.prepare('UPDATE receipts SET digest=? WHERE id=?').run('a'.repeat(4_096), decoded.operationId); }
    finally { database.close(); }
    await assert.rejects(store.receipt(decoded.operationId), { code: 'LOCAL_DATA_INTEGRITY' });
    await assert.rejects(store.commit(decoded, decoded.operationId, sha(bytes)), { code: 'LOCAL_DATA_INTEGRITY' });
    assert.equal((await store.manifests(['cases']))[0]?.revision, 2);
  } finally { await provider.close(); }
}));

test('collection dependencies and retained files are atomic, content verified and repairable', async () => withWorkspace(async directory => {
  const store = await LocalApplicationStore.open(directory, { create: true }), provider = providerFor(store);
  const bytes = new TextEncoder().encode('original fixture'), reference = { digestSha256: `sha256:${sha(bytes)}`, byteLength: bytes.byteLength };
  const attachment = { ...reference, id: 'attachment', fileName: 'evidence.txt', mediaType: 'application/octet-stream' as const, source: null, observedAt: null, retainedAt: CURRENT_CASE_TIME };
  const fixture = currentCaseFixture({ attachments: [attachment] });
  try {
    await provider.initialize(BROWSER_LOCAL_COLLECTIONS);
    await provider.updateMany([CASES_COLLECTION, CASE_DRAFTS_COLLECTION], current => ({
      documents: new Map([[CASES_COLLECTION.id, [fixture]], [CASE_DRAFTS_COLLECTION.id, current.get(CASE_DRAFTS_COLLECTION.id)]]), result: null,
    }), { files: new Map([['cases', [{ reference, file: new Blob([bytes]) }]]]) });
    assert.equal(await (await provider.readFiles(CASES_COLLECTION, [reference])).get(reference.digestSha256)?.text(), 'original fixture');
    const db = new DatabaseSync(path.join(directory, LOCAL_WORKSPACE_FILE));
    db.prepare('UPDATE files SET content=?').run(new Uint8Array(bytes.length)); db.close();
    await assert.rejects(provider.readFiles(CASES_COLLECTION, [reference]), { code: 'LOCAL_DATA_BINARY_INTEGRITY' });
    await provider.update(CASES_COLLECTION, document => ({ document, result: null }), { files: [{ reference, file: new Blob([bytes]) }] });
    assert.equal(await (await provider.readFiles(CASES_COLLECTION, [reference])).get(reference.digestSha256)?.text(), 'original fixture');
    await provider.update(CASES_COLLECTION, () => ({ document: [], result: null }));
    assert.deepEqual(await store.files('cases', [reference.digestSha256]), [undefined]);
  } finally { await provider.close(); }
}));

test('locked database writes fail without losing saved data and can be deliberately retried', async () => withWorkspace(async directory => {
  const store = await LocalApplicationStore.open(directory, { create: true }), provider = providerFor(store);
  await provider.initialize(BROWSER_LOCAL_COLLECTIONS);
  const lock = new DatabaseSync(path.join(directory, LOCAL_WORKSPACE_FILE));
  try {
    lock.exec('BEGIN IMMEDIATE');
    await assert.rejects(provider.update(CASES_COLLECTION, () => ({ document: [currentCaseFixture()], result: null })), { code: 'LOCAL_DATA_CONFLICT' });
    lock.exec('ROLLBACK');
    assert.deepEqual(await provider.read(CASES_COLLECTION), []);
    await provider.update(CASES_COLLECTION, () => ({ document: [currentCaseFixture()], result: null }));
    assert.equal((await provider.read(CASES_COLLECTION)).length, 1);
  } finally { lock.close(); await provider.close(); }
}));

test('untrusted transaction structure, future versions, CRC failures and extra files are rejected', async () => withWorkspace(async directory => {
  const store = await LocalApplicationStore.open(directory, { create: true }); let packet!: Uint8Array;
  const provider = providerFor(store, (_change, bytes) => { packet = bytes; });
  try {
    await provider.initialize(BROWSER_LOCAL_COLLECTIONS);
    const files = unzipSync(packet), raw = JSON.parse(new TextDecoder().decode(files['transaction.json']!));
    for (const change of [
      { version: 99 }, { operationId: '../workspace' }, { extra: 'unsupported' },
      { expected: [...raw.expected, raw.expected[0]] },
      { collections: [...raw.collections, raw.collections[0]] },
    ]) {
      const changed = { ...files, 'transaction.json': new TextEncoder().encode(JSON.stringify({ ...raw, ...change })) };
      await assert.rejects(decodeLocalApplicationCommit(zipSync(changed, { level: 0 })));
    }
    await assert.rejects(decodeLocalApplicationCommit(zipSync({ ...files, '../outside': new Uint8Array([1]) }, { level: 0 })));
    await assert.rejects(decodeLocalApplicationCommit(zipSync({ ...files, 'files/1': new Uint8Array([1]) }, { level: 0 })));
    await assert.rejects(decodeLocalApplicationCommit(zipSync(files, { level: 6 })));
    const corrupt = packet.slice(); corrupt[50] = corrupt[50]! ^ 1;
    await assert.rejects(decodeLocalApplicationCommit(corrupt));
    assert.ok(packet.byteLength < LOCAL_APPLICATION_MAX_TRANSFER_BYTES);
    assert.deepEqual(await provider.read(CASES_COLLECTION), []);
  } finally { await provider.close(); }
}));

test('missing collection metadata does not overwrite orphaned records', async () => withWorkspace(async directory => {
  const store = await LocalApplicationStore.open(directory, { create: true }), provider = providerFor(store);
  await provider.initialize(BROWSER_LOCAL_COLLECTIONS);
  await provider.update(CASES_COLLECTION, () => ({ document: [currentCaseFixture()], result: null }));
  await provider.close();
  const db = new DatabaseSync(path.join(directory, LOCAL_WORKSPACE_FILE), { enableForeignKeyConstraints: false });
  db.prepare('DELETE FROM collections WHERE id=?').run('cases'); db.close();
  const reopened = await LocalApplicationStore.open(directory), replacement = providerFor(reopened);
  try { await assert.rejects(replacement.initialize(BROWSER_LOCAL_COLLECTIONS), { code: 'LOCAL_DATA_INTEGRITY' }); }
  finally { await replacement.close(); }
}));

test('a replaced database path is detected before a later write', async () => withWorkspace(async directory => {
  const store = await LocalApplicationStore.open(directory, { create: true }), provider = providerFor(store);
  try {
    await provider.initialize(BROWSER_LOCAL_COLLECTIONS);
    const filename = path.join(directory, LOCAL_WORKSPACE_FILE), retained = await readFile(filename);
    await rm(filename); await writeFile(filename, retained, { mode: 0o600 });
    await assert.rejects(provider.update(CASES_COLLECTION, () => ({ document: [currentCaseFixture()], result: null })), { code: 'LOCAL_DATA_COMMIT_UNKNOWN' });
  } finally { await provider.close(); }
}));
