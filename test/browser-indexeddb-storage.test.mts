import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { IndexedDbLocalDataStorage } from '../frontend/src/lib/browser-indexeddb-storage.ts';
import { plaintextJsonCodec, type LocalDataCollectionDefinition } from '../frontend/src/lib/browser-local-data-content.ts';

const DEFINITION: LocalDataCollectionDefinition<string[]> = {
  id: 'fixture', label: 'Fixture records', legacyKey: 'fixture-legacy', schemaVersion: 1,
  maximumBytes: 1024, maximumRecords: 10, empty: () => [], acceptLegacyRoot: Array.isArray,
  normalize: value => Array.isArray(value) ? value : [], version: () => 1, serialize: JSON.stringify,
  split: values => values.map((value, index) => ({ id: String(index), value })),
  join: records => records.map(record => String(record.value)),
};
const MANIFEST = {
  collection: 'fixture', schemaVersion: 1, codec: 'json-v1', revision: 1,
  recordCount: 0, serializedBytes: 2, digest: createHash('sha256').update('[]').digest('base64url'),
  source: 'empty', updatedAt: '2026-01-01T00:00:00.000Z', legacyKey: 'fixture-legacy', legacyDigest: null,
};

function controlledRequest<T extends IDBRequest>() {
  const request = { onsuccess: null, onerror: null } as unknown as T;
  return {
    request,
    succeed(result: unknown) {
      Object.assign(request, { result });
      request.onsuccess?.call(request, new Event('success'));
    },
    fail(error: DOMException) {
      Object.assign(request, { error });
      request.onerror?.call(request, new Event('error'));
    },
  };
}

function storageHarness() {
  const opens: ReturnType<typeof controlledRequest<IDBOpenDBRequest>>[] = [];
  const reads: Array<{ store: string; key: IDBValidKey; control: ReturnType<typeof controlledRequest> }> = [];
  let closed = 0, aborted = 0, transactions = 0;
  let started!: () => void;
  const transactionStarted = new Promise<void>(resolve => { started = resolve; });
  const transaction = {
    oncomplete: null, onabort: null, onerror: null, error: null,
    abort() { aborted++; transaction.onabort?.call(transaction, new Event('abort')); },
    objectStore(store: string) {
      return { get(key: IDBValidKey) {
        const control = controlledRequest();
        reads.push({ store, key, control });
        return control.request;
      }, index() { assert.fail('Rejected metadata must not open a record cursor.'); } } as unknown as IDBObjectStore;
    },
  } as unknown as IDBTransaction;
  const database = {
    onversionchange: null,
    close() { closed++; },
    transaction() { transactions++; started(); return transaction; },
  } as unknown as IDBDatabase;
  const factory = { open() {
    const control = controlledRequest<IDBOpenDBRequest>();
    opens.push(control);
    return control.request;
  } } as unknown as IDBFactory;
  const storage = new IndexedDbLocalDataStorage({ databaseName: 'fixture-storage', timeoutMs: 1000,
    codec: plaintextJsonCodec, factory, definition: () => DEFINITION, assertWritable: () => assert.fail('Read path attempted a write.') });
  return { storage, opens, reads, database, transactionStarted,
    complete() { transaction.oncomplete?.call(transaction, new Event('complete')); },
    get closed() { return closed; }, get aborted() { return aborted; }, get transactions() { return transactions; } };
}

test('retained-file reads preserve key order and wait for transaction completion', async () => {
  const h = storageHarness();
  let settled = false;
  const pending = h.storage.files('fixture', ['first', 'absent']).then(value => { settled = true; return value; });
  h.opens[0]!.succeed(h.database);
  await h.transactionStarted;
  assert.deepEqual(h.reads.map(({ store, key }) => ({ store, key })), [
    { store: 'files', key: ['fixture', 'first'] }, { store: 'files', key: ['fixture', 'absent'] },
  ]);
  const retained = { lookupKey: 'first', payload: new Uint8Array([1, 2, 3]) };
  h.reads[1]!.control.succeed(undefined);
  h.reads[0]!.control.succeed(retained);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, false, 'Request success alone is not transaction success.');
  h.complete();
  assert.deepEqual(await pending, [retained, undefined]);
  assert.equal(h.aborted, 0);
  await h.storage.close();
  assert.equal(h.closed, 1);
});

test('retained-file request failures abort and expose only the stable read consequence', async () => {
  const h = storageHarness();
  const pending = h.storage.files('fixture', ['first']);
  h.opens[0]!.succeed(h.database);
  await h.transactionStarted;
  h.reads[0]!.control.fail(new DOMException('private transport detail', 'UnknownError'));
  await assert.rejects(pending, { code: 'LOCAL_DATA_READ_FAILED',
    message: 'Selected retained files could not be read. No saved data was changed.' });
  assert.equal(h.aborted, 1);
  await h.storage.close();
});

test('missing or differently encrypted manifests reject before reading records', async context => {
  for (const [manifest, code] of [[undefined, 'LOCAL_DATA_MISSING'], [{ ...MANIFEST, codec: 'encrypted-v1' }, 'LOCAL_DATA_LOCKED']] as const) {
    await context.test(code, async () => {
      const h = storageHarness();
      const pending = h.storage.capture(['fixture']);
      h.opens[0]!.succeed(h.database);
      await h.transactionStarted;
      h.reads[0]!.control.succeed(manifest);
      await assert.rejects(pending, { code });
      assert.equal(h.aborted, 1);
      assert.equal(h.reads.length, 1);
      await h.storage.close();
    });
  }
});

test('unexpected metadata read failures remain distinct from missing data and private diagnostics', async context => {
  for (const operation of ['capture', 'manifests'] as const) await context.test(operation, async () => {
    const h = storageHarness();
    const pending = h.storage[operation](['fixture']);
    h.opens[0]!.succeed(h.database);
    await h.transactionStarted;
    h.reads[0]!.control.fail(new DOMException('private transport detail', 'UnknownError'));
    await assert.rejects(pending, { code: 'LOCAL_DATA_READ_FAILED', message: operation === 'capture'
      ? 'Fixture records could not be read from workspace storage.'
      : 'Browser-local commit recovery could not read the current manifests.' });
    assert.equal(h.aborted, 1);
    await h.storage.close();
  });
});

test('database opening failures retain their classification and close a late connection', async context => {
  for (const [failure, code] of [['VersionError', 'LOCAL_DATA_FUTURE_DATABASE'], ['UnknownError', 'LOCAL_DATA_OPEN_FAILED'], ['blocked', 'LOCAL_DATA_BLOCKED']] as const) {
    await context.test(failure, async () => {
      const h = storageHarness();
      const pending = h.storage.manifests(['fixture']);
      const open = h.opens[0]!;
      if (failure === 'blocked') open.request.onblocked?.call(open.request, new Event('blocked') as IDBVersionChangeEvent);
      else open.fail(new DOMException('private transport detail', failure));
      await assert.rejects(pending, (cause: unknown) => {
        assert.equal((cause as { code: string }).code, code);
        assert.doesNotMatch((cause as Error).message, /private transport detail/u);
        return true;
      });
      open.succeed(h.database);
      assert.equal(h.closed, 1);
      assert.equal(h.transactions, 0);
      await h.storage.close();
    });
  }
});

test('a version change closes the connection and blocks reuse until the owner closes it', async () => {
  const h = storageHarness();
  const pending = h.storage.manifests(['fixture']);
  h.opens[0]!.succeed(h.database);
  await h.transactionStarted;
  h.reads[0]!.control.succeed(MANIFEST);
  h.complete();
  assert.deepEqual(await pending, [MANIFEST]);
  h.database.onversionchange?.call(h.database, new Event('versionchange') as IDBVersionChangeEvent);
  assert.equal(h.closed, 1);
  await assert.rejects(h.storage.manifests(['fixture']), { code: 'LOCAL_DATA_VERSION_CHANGED' });
  assert.equal(h.opens.length, 1);
  assert.equal(h.transactions, 1);
  await h.storage.close();
  const reopened = h.storage.manifests(['fixture']);
  assert.equal(h.opens.length, 2);
  h.opens[1]!.fail(new DOMException('Unavailable fixture', 'UnknownError'));
  await assert.rejects(reopened, { code: 'LOCAL_DATA_OPEN_FAILED' });
});
