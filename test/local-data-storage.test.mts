import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { BrowserLocalDataError, BrowserLocalDataProvider, type LocalDataCollectionDefinition } from '../frontend/src/lib/browser-local-data.ts';
import { localDataManifestMatches, type LocalDataCapture, type LocalDataStorage, type LocalDataStorageCommit, type LocalDataStoredBinary } from '../packages/workspace/local-data-storage.mts';

const DEFINITION: LocalDataCollectionDefinition<string[]> = {
  id: 'fixture', label: 'Fixture records', legacyKey: 'fixture-legacy', schemaVersion: 1,
  maximumBytes: 1024, maximumRecords: 10, empty: () => [], acceptLegacyRoot: Array.isArray,
  normalize: value => {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error('Invalid fixture.');
    return value;
  },
  version: () => 1, serialize: JSON.stringify,
  split: values => values.map((value, index) => ({ id: String(index), value })),
  join: records => records.map(record => record.value),
};
const SECOND = { ...DEFINITION, id: 'second', legacyKey: 'second-legacy' };

function memoryStorage() {
  const collections = new Map<string, LocalDataCapture>();
  const binaries = new Map<string, LocalDataStoredBinary>();
  const changes: LocalDataStorageCommit[] = [];
  let beforeCommit: (() => Promise<void>) | undefined;
  let failure: Error | undefined;
  let closed = 0;
  const adapter: LocalDataStorage = {
    async manifests(ids) { return structuredClone(ids.map(id => collections.get(id)?.manifest)); },
    async capture(ids) { return structuredClone(ids.map(id => {
      const collection = collections.get(id);
      if (!collection) throw new BrowserLocalDataError('LOCAL_DATA_MISSING', 'Missing fixture.');
      return collection;
    })); },
    async files(collection, keys) { return structuredClone(keys.map(key => binaries.get(`${collection}/${key}`))); },
    async commit(change) {
      const before = beforeCommit; beforeCommit = undefined;
      await before?.();
      if (failure) throw failure;
      for (const [id, expected] of change.expected) if (!localDataManifestMatches(collections.get(id)?.manifest, expected)) {
        throw new BrowserLocalDataError('LOCAL_DATA_CONFLICT', 'Concurrent fixture change.');
      }
      changes.push(structuredClone(change));
      for (const capture of change.collections) collections.set(capture.manifest.collection, structuredClone(capture));
      for (const binary of change.binaries) {
        for (const key of binary.remove) binaries.delete(`${binary.collection}/${key}`);
        for (const record of binary.writes) binaries.set(`${binary.collection}/${record.lookupKey}`, structuredClone(record));
      }
    },
    async close() { closed++; },
  };
  return { adapter, collections, binaries, changes, get closed() { return closed; },
    beforeCommit(value: () => Promise<void>) { beforeCommit = value; }, fail(value: Error) { failure = value; } };
}

test('an explicit storage adapter does not open, inspect or migrate browser storage', async () => {
  const store = memoryStorage();
  const provider = new BrowserLocalDataProvider({ storageAdapter: store.adapter,
    indexedDB: { open: () => { throw new Error('Unexpected IndexedDB access.'); } } as unknown as IDBFactory,
    storage: { getItem: () => { throw new Error('Unexpected legacy access.'); }, setItem: () => assert.fail(), removeItem: () => assert.fail() },
  });
  const initialization = await provider.initialize([DEFINITION]);
  assert.deepEqual(initialization.retainedLegacyKeys, []);
  assert.equal(store.collections.get('fixture')?.manifest.source, 'empty');
  assert.deepEqual(await provider.read(DEFINITION), []);
  assert.equal(provider.createdDatabase, false);
  await assert.rejects(provider.restoreLegacyCopies([DEFINITION]), { code: 'LOCAL_DATA_LEGACY_UNAVAILABLE' });
  await provider.close(); assert.equal(store.closed, 1);
});

test('adapter updates retain the existing pure updater, full-revision conflict retry and observer isolation', async () => {
  const store = memoryStorage();
  const first = new BrowserLocalDataProvider({ storageAdapter: store.adapter, oncommit: () => { throw new Error('Observer failure.'); } });
  const second = new BrowserLocalDataProvider({ storageAdapter: store.adapter });
  await first.initialize([DEFINITION]); await second.initialize([DEFINITION]);
  store.beforeCommit(async () => { await second.update(DEFINITION, current => ({ document: [...current, 'other tab'], result: null })); });
  let calls = 0;
  const result = await first.update(DEFINITION, current => { calls++; return { document: [...current, 'current tab'], result: 42 }; });
  assert.equal(calls, 2); assert.equal(result, 42);
  assert.deepEqual(await first.read(DEFINITION), ['other tab', 'current tab']);
  assert.equal(store.collections.get('fixture')?.manifest.revision, 3);
  const commits = store.changes.length;
  await first.update(DEFINITION, document => ({ document, result: null }));
  assert.equal(store.changes.length, commits);
});

test('multi-collection adapter updates compare unchanged dependencies and commit together', async () => {
  const store = memoryStorage();
  const provider = new BrowserLocalDataProvider({ storageAdapter: store.adapter });
  await provider.initialize([DEFINITION, SECOND]);
  await provider.updateMany([DEFINITION, SECOND], current => ({
    documents: new Map([[DEFINITION.id, ['saved']], [SECOND.id, current.get(SECOND.id)]]), result: 'done',
  }));
  const commit = store.changes.at(-1)!;
  assert.equal(commit.expected.size, 2); assert.equal(commit.collections.length, 1);
  assert.deepEqual([...await provider.readMany([DEFINITION, SECOND])], [['fixture', ['saved']], ['second', []]]);
});

test('adapter data still passes independent digest, schema, order and decoded-record verification', async () => {
  for (const corrupt of [
    (capture: LocalDataCapture) => ({ ...capture, manifest: { ...capture.manifest, schemaVersion: 99 } }),
    (capture: LocalDataCapture) => ({ ...capture, manifest: { ...capture.manifest, digest: 'a'.repeat(43) } }),
    (capture: LocalDataCapture) => ({ ...capture, records: [{ ...capture.records[0]!, ordinal: 5 }] }),
  ]) {
    const store = memoryStorage(), provider = new BrowserLocalDataProvider({ storageAdapter: store.adapter });
    await provider.initialize([DEFINITION]);
    await provider.update(DEFINITION, () => ({ document: ['saved'], result: null }));
    store.collections.set('fixture', corrupt(store.collections.get('fixture')!));
    await assert.rejects(provider.read(DEFINITION), cause => cause instanceof BrowserLocalDataError);
  }
});

test('unknown adapter commit outcomes block all later mutations without rerunning the updater', async () => {
  for (const failure of [new Error('Lost transport.'), new BrowserLocalDataError('LOCAL_DATA_COMMIT_UNKNOWN', 'Unknown.'), new BrowserLocalDataError('LOCAL_DATA_TIMEOUT', 'No acknowledgement.')]) {
    const store = memoryStorage(), provider = new BrowserLocalDataProvider({ storageAdapter: store.adapter });
    await provider.initialize([DEFINITION, SECOND]);
    store.fail(failure);
    let calls = 0;
    await assert.rejects(provider.update(DEFINITION, current => { calls++; return { document: [...current, 'once'], result: null }; }), { code: 'LOCAL_DATA_COMMIT_UNKNOWN' });
    await assert.rejects(provider.update(SECOND, current => { calls++; return { document: current, result: null }; }), { code: 'LOCAL_DATA_COMMIT_UNKNOWN' });
    assert.equal(calls, 1);
  }
});

test('confirmed adapter write failures preserve drafts and allow a deliberate retry', async () => {
  const store = memoryStorage(), provider = new BrowserLocalDataProvider({ storageAdapter: store.adapter });
  await provider.initialize([DEFINITION]);
  store.fail(new BrowserLocalDataError('LOCAL_DATA_QUOTA', 'Insufficient space.'));
  let calls = 0;
  for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(provider.update(DEFINITION, current => {
    calls++; return { document: [...current, 'draft'], result: null };
  }), { code: 'LOCAL_DATA_QUOTA' });
  assert.equal(calls, 2); assert.deepEqual(await provider.read(DEFINITION), []);
});

test('retained file bytes and references share the adapter transaction and are verified on retrieval', async () => {
  const bytes = new TextEncoder().encode('retained fixture'), digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const reference = { digestSha256: digest, byteLength: bytes.byteLength };
  const definition = { ...DEFINITION, binaryReferences: (values: string[]) => values.length ? [reference] : [] };
  const store = memoryStorage(), provider = new BrowserLocalDataProvider({ storageAdapter: store.adapter });
  await provider.initialize([definition]);
  await provider.update(definition, () => ({ document: ['attachment'], result: null }), { files: [{ reference, file: new Blob([bytes]) }] });
  const change = store.changes.at(-1)!;
  assert.equal(change.collections.length, 1); assert.equal(change.binaries[0]?.writes.length, 1);
  assert.equal(await (await provider.readFiles(definition, [reference])).get(digest)?.text(), 'retained fixture');
  await provider.update(definition, () => ({ document: [], result: null }));
  assert.equal(store.binaries.size, 0);
  await assert.rejects(provider.readFiles(definition, [reference]), { code: 'LOCAL_DATA_BINARY_UNREFERENCED' });
});
