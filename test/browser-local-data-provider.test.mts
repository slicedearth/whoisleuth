import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';

import {
  BrowserLocalDataError,
  BrowserLocalDataProvider,
  MAX_LOCAL_DATA_OPERATION_TIMEOUT_MS,
  decodeLocalDataSnapshots,
  isExpectedBrowserLocalDataFailure,
  plaintextJsonCodec,
  prepareLocalDataContent,
  type AnyLocalDataCollectionDefinition,
  type BrowserLocalCollectionManifest,
  type BrowserLocalStoredRecord,
  type LocalDataCollectionDefinition,
} from '../frontend/src/lib/browser-local-data.ts';

const TIMEOUT_MS = 5;

const DEFINITION: AnyLocalDataCollectionDefinition = {
  id: 'fixture',
  label: 'Fixture collection',
  legacyKey: 'fixture-key',
  schemaVersion: 1,
  maximumBytes: 1_024,
  maximumRecords: 1,
  empty: () => [],
  acceptLegacyRoot: Array.isArray,
  normalize: (value) => Array.isArray(value) ? value : [],
  version: () => 1,
  serialize: JSON.stringify,
  split: () => [],
  join: () => [],
};

const WRITE_TIMEOUT_MS = 8;
const NULL_STORAGE = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

test('a late database upgrade is aborted after its opening deadline', async () => {
  let aborts = 0;
  let reads = 0;
  const request = {
    get result() { reads++; throw new Error('Late creation must not inspect or mutate stores.'); },
    transaction: { abort: () => { aborts++; } },
  } as unknown as IDBOpenDBRequest;
  const provider = new BrowserLocalDataProvider({
    indexedDB: { open: () => request } as unknown as IDBFactory,
    storage: NULL_STORAGE, timeoutMs: TIMEOUT_MS,
  });
  await assert.rejects(provider.initialize([DEFINITION]), (error: unknown) => error instanceof BrowserLocalDataError && error.code === 'LOCAL_DATA_TIMEOUT');
  request.onupgradeneeded?.call(request, { oldVersion: 0 } as IDBVersionChangeEvent);
  assert.equal(aborts, 1); assert.equal(reads, 0);
  assert.equal(provider.createdDatabase, false);
  await provider.close();
});

const WRITE_DEFINITION: LocalDataCollectionDefinition<string[]> = {
  id: 'fixture-write',
  label: 'Fixture writes',
  legacyKey: 'fixture-write-key',
  schemaVersion: 1,
  maximumBytes: 1_024,
  maximumRecords: 4,
  empty: () => [],
  acceptLegacyRoot: (value) => Array.isArray(value),
  normalize: (value) => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [],
  version: () => 1,
  serialize: JSON.stringify,
  split: (values) => values.map((value, index) => ({ id: `fixture-${index}`, value })),
  join: (records) => records.flatMap((record) => typeof record.value === 'string' ? [record.value] : []),
};

const SECOND_WRITE_DEFINITION: LocalDataCollectionDefinition<string[]> = {
  ...WRITE_DEFINITION,
  id: 'fixture-write-second',
  label: 'Second fixture writes',
  legacyKey: 'fixture-write-second-key',
};

type DelayedWriteState = {
  manifest: BrowserLocalCollectionManifest;
  records: BrowserLocalStoredRecord[];
  transactions: number;
  writeTransactions: number;
  abortAttempts: number;
  recoveryReads: number;
  recoveryReadBeforeAcknowledgement: boolean;
  lateAcknowledgements: number;
  writeApplied: boolean;
  recoveryReturned: boolean;
};

function emptyWriteManifest(): BrowserLocalCollectionManifest {
  return {
    collection: WRITE_DEFINITION.id,
    schemaVersion: WRITE_DEFINITION.schemaVersion,
    codec: 'json-v1',
    revision: 1,
    recordCount: 0,
    serializedBytes: 2,
    digest: createHash('sha256').update('[]').digest('base64url'),
    source: 'empty',
    updatedAt: '2026-08-16T00:00:00.000Z',
    legacyKey: WRITE_DEFINITION.legacyKey,
    legacyDigest: null,
  };
}

function storedRecord(
  lookupKey: string,
  payload: string,
  ordinal: number,
  payloadBytes = new TextEncoder().encode(payload).byteLength,
): BrowserLocalStoredRecord {
  return {
    key: [WRITE_DEFINITION.id, lookupKey],
    collection: WRITE_DEFINITION.id,
    lookupKey,
    ordinal,
    codec: 'json-v1',
    payload,
    payloadBytes,
  };
}

function successfulRequest<T>(result: T): IDBRequest<T> {
  const request = {
    result,
    error: null,
    onsuccess: null,
    onerror: null,
  } as unknown as IDBRequest<T>;
  queueMicrotask(() => request.onsuccess?.call(request, new Event('success')));
  return request;
}

function successfulCursorRequest<T>(values: readonly T[]): IDBRequest<IDBCursorWithValue | null> {
  const request = {
    result: null,
    error: null,
    onsuccess: null,
    onerror: null,
  } as unknown as IDBRequest<IDBCursorWithValue | null>;
  let index = 0;
  const deliver = () => {
    const value = values[index];
    Object.assign(request, {
      result: value === undefined
        ? null
        : {
            value,
            continue() {
              index += 1;
              queueMicrotask(deliver);
            },
          } as IDBCursorWithValue,
    });
    request.onsuccess?.call(request, new Event('success'));
  };
  queueMicrotask(deliver);
  return request;
}

type DelayedWriteOutcome =
  | 'committed'
  | 'unknown'
  | 'same_revision_different'
  | 'same_content_different_source'
  | 'same_content_different_legacy_digest'
  | 'deferred_unknown';

function delayedWriteFactory(outcome: DelayedWriteOutcome, onwrite: () => void = () => {}): {
  factory: IDBFactory;
  state: DelayedWriteState;
  recoveryStarted: Promise<void>;
  releaseRecovery: () => void;
  acknowledge: () => void;
} {
  let pendingAcknowledgement: (() => void) | null = null;
  let markRecoveryStarted: () => void = () => undefined;
  const recoveryStarted = new Promise<void>((resolve) => { markRecoveryStarted = resolve; });
  let resumeRecovery: () => void = () => undefined;
  const recoveryRelease = new Promise<void>((resolve) => { resumeRecovery = resolve; });
  const state: DelayedWriteState = {
    manifest: emptyWriteManifest(),
    records: [],
    transactions: 0,
    writeTransactions: 0,
    abortAttempts: 0,
    recoveryReads: 0,
    recoveryReadBeforeAcknowledgement: false,
    lateAcknowledgements: 0,
    writeApplied: false,
    recoveryReturned: false,
  };

  const database = {
    onversionchange: null,
    close() {},
    transaction(_stores: string | string[], mode: IDBTransactionMode = 'readonly') {
      state.transactions += 1;
      const readwrite = mode === 'readwrite';
      if (readwrite) state.writeTransactions += 1;
      let transaction: IDBTransaction;
      const recordsStore = {
        delete() {
          state.records = [];
          return successfulRequest(undefined);
        },
        put(value: BrowserLocalStoredRecord) {
          state.records = [...state.records.filter((item) => item.lookupKey !== value.lookupKey), value];
          return successfulRequest(value.key);
        },
        index() {
          return {
            openCursor(query?: IDBValidKey | IDBKeyRange | null) {
              const collection = typeof query === 'string' ? query : null;
              return successfulCursorRequest(state.records.filter((record) => !collection || record.collection === collection));
            },
          } as unknown as IDBIndex;
        },
      } as unknown as IDBObjectStore;
      const manifestsStore = {
        get() {
          let manifest = state.manifest;
          if (!readwrite && state.writeApplied && (
            !state.recoveryReturned
            || (outcome === 'same_revision_different' && state.recoveryReads < 2)
          )) {
            if (outcome !== 'same_revision_different' || state.recoveryReads === 1) state.recoveryReturned = true;
            state.recoveryReads += 1;
            state.recoveryReadBeforeAcknowledgement = state.lateAcknowledgements === 0;
            if (outcome === 'unknown' || outcome === 'deferred_unknown') manifest = { ...manifest, revision: manifest.revision + 1 };
            if (outcome === 'same_revision_different') {
              manifest = {
                ...manifest,
                revision: manifest.revision - 1,
                recordCount: 0,
                serializedBytes: 2,
                digest: createHash('sha256').update('different').digest('base64url'),
              };
            }
            if (outcome === 'same_content_different_source') {
              manifest = { ...manifest, source: 'empty' };
            }
            if (outcome === 'same_content_different_legacy_digest') {
              manifest = {
                ...manifest,
                legacyDigest: createHash('sha256').update('different provenance').digest('base64url'),
              };
            }
            if (outcome === 'deferred_unknown') {
              const request = {
                result: manifest,
                error: null,
                onsuccess: null,
                onerror: null,
              } as unknown as IDBRequest<BrowserLocalCollectionManifest>;
              markRecoveryStarted();
              void recoveryRelease.then(() => request.onsuccess?.call(request, new Event('success')));
              return request;
            }
          }
          return successfulRequest(manifest);
        },
        put(value: BrowserLocalCollectionManifest) {
          state.manifest = value;
          state.writeApplied = true;
          onwrite();
          return successfulRequest(value.collection);
        },
      } as unknown as IDBObjectStore;
      transaction = {
        error: null,
        oncomplete: null,
        onabort: null,
        onerror: null,
        abort() {
          state.abortAttempts += 1;
          if (readwrite && state.writeApplied) throw new DOMException('The transaction has committed.', 'InvalidStateError');
          transaction.onabort?.call(transaction, new Event('abort'));
        },
        objectStore(name: string) {
          return name === 'records' ? recordsStore : manifestsStore;
        },
      } as unknown as IDBTransaction;
      if (readwrite) {
        pendingAcknowledgement = () => {
          state.lateAcknowledgements += 1;
          transaction.oncomplete?.call(transaction, new Event('complete'));
        };
      } else {
        queueMicrotask(() => transaction.oncomplete?.call(transaction, new Event('complete')));
      }
      return transaction;
    },
  } as unknown as IDBDatabase;

  return {
    state,
    recoveryStarted,
    releaseRecovery: resumeRecovery,
    acknowledge: () => {
      const pending = pendingAcknowledgement;
      pendingAcknowledgement = null;
      pending?.();
    },
    factory: {
      open() {
        const request = {
          result: database,
          error: null,
          onupgradeneeded: null,
          onsuccess: null,
          onerror: null,
          onblocked: null,
        } as unknown as IDBOpenDBRequest;
        queueMicrotask(() => request.onsuccess?.call(request, new Event('success')));
        return request;
      },
    } as unknown as IDBFactory,
  };
}

function installKeyRangeStub(): () => void {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
  Object.defineProperty(globalThis, 'IDBKeyRange', {
    configurable: true,
    value: { bound: () => ({}) },
  });
  return () => {
    if (original) Object.defineProperty(globalThis, 'IDBKeyRange', original);
    else Reflect.deleteProperty(globalThis, 'IDBKeyRange');
  };
}

function pendingRequest<T>(): IDBRequest<T> {
  return {
    result: undefined,
    error: null,
    onsuccess: null,
    onerror: null,
  } as unknown as IDBRequest<T>;
}

function stallFor(milliseconds: number): void {
  const end = performance.now() + milliseconds;
  while (performance.now() < end) {
    // Deliberately block this bounded fake renderer task.
  }
}

function stalledFactory(calls: { transactions: number; reads: number }): IDBFactory {
  const transaction = {
    error: null,
    oncomplete: null,
    onabort: null,
    onerror: null,
    abort() {},
    objectStore() {
      return {
        get() {
          calls.reads += 1;
          // The completion deadline already exists. Blocking here makes it
          // expire before requestResult installs its later request deadline.
          stallFor(TIMEOUT_MS * 3);
          return pendingRequest<unknown>();
        },
      } as unknown as IDBObjectStore;
    },
  } as unknown as IDBTransaction;

  const database = {
    onversionchange: null,
    close() {},
    transaction() {
      calls.transactions += 1;
      return transaction;
    },
  } as unknown as IDBDatabase;

  return {
    open() {
      const request = {
        result: database,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      } as unknown as IDBOpenDBRequest;

      queueMicrotask(() => {
        request.onsuccess?.call(request, new Event('success'));
      });
      return request;
    },
  } as unknown as IDBFactory;
}

function readyEmptyCollectionsFactory(
  definitions: readonly LocalDataCollectionDefinition<string[]>[],
  transactions: string[][] = [],
): IDBFactory {
  const manifests = new Map(definitions.map((definition) => [definition.id, {
    ...emptyWriteManifest(),
    collection: definition.id,
    legacyKey: definition.legacyKey,
  }]));
  const database = {
    onversionchange: null,
    close() {},
    transaction(stores: string | string[]) {
      transactions.push(typeof stores === 'string' ? [stores] : [...stores]);
      let transaction: IDBTransaction;
      transaction = {
        error: null,
        oncomplete: null,
        onabort: null,
        onerror: null,
        abort() { transaction.onabort?.call(transaction, new Event('abort')); },
        objectStore(name: string) {
          if (name === 'manifests') {
            return {
              get(key: IDBValidKey) {
                return successfulRequest(manifests.get(String(key)));
              },
            } as unknown as IDBObjectStore;
          }
          return {
            index() {
              return { openCursor: () => successfulCursorRequest([]) } as unknown as IDBIndex;
            },
          } as unknown as IDBObjectStore;
        },
      } as unknown as IDBTransaction;
      queueMicrotask(() => transaction.oncomplete?.call(transaction, new Event('complete')));
      return transaction;
    },
  } as unknown as IDBDatabase;
  return {
    open() {
      const request = {
        result: database,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      } as unknown as IDBOpenDBRequest;
      queueMicrotask(() => request.onsuccess?.call(request, new Event('success')));
      return request;
    },
  } as unknown as IDBFactory;
}

test('multi-collection reads use one captured transaction and reject invalid selections', async () => {
  const definitions = [WRITE_DEFINITION, SECOND_WRITE_DEFINITION];
  const transactions: string[][] = [];
  let decodes = 0;
  const provider = new BrowserLocalDataProvider({
    indexedDB: readyEmptyCollectionsFactory(definitions, transactions), storage: NULL_STORAGE,
    decodeSnapshots: async (selected, captured, codec) => {
      decodes += 1;
      await new Promise<void>((resolve) => setImmediate(resolve));
      return decodeLocalDataSnapshots(selected, captured, codec);
    },
  });
  await provider.initialize(definitions);
  assert.equal(decodes, definitions.length, 'Current collections are each verified once during initialisation.');
  transactions.length = 0;
  decodes = 0;
  const documents = await provider.readMany(definitions);
  assert.equal(decodes, 1);
  assert.deepEqual([...documents], definitions.map((definition) => [definition.id, []]));
  assert.deepEqual(transactions, [['records', 'manifests']]);
  (documents.get(WRITE_DEFINITION.id) as string[]).push('caller-only');
  assert.deepEqual(await provider.read(WRITE_DEFINITION), []);
  const previousTransactions = transactions.length;
  for (const selection of [[], [WRITE_DEFINITION, WRITE_DEFINITION], Array(17).fill(WRITE_DEFINITION), [{ ...WRITE_DEFINITION }], [null]]) {
    await assert.rejects(provider.readMany(selection as readonly AnyLocalDataCollectionDefinition[]),
      (cause: unknown) => cause instanceof BrowserLocalDataError && cause.code === 'INVALID_LOCAL_DATA_DEFINITION');
  }
  assert.equal(transactions.length, previousTransactions);
  const selection = [...definitions];
  const reading = provider.readMany(selection);
  selection.splice(0, selection.length, { ...WRITE_DEFINITION, id: 'unregistered' });
  assert.deepEqual([...await reading], definitions.map((definition) => [definition.id, []]));
  await provider.close();
});

test('awaited updates retain concurrent records and commit only against the current revision', { timeout: 3_000 }, async () => {
  const restoreKeyRange = installKeyRangeStub();
  let wrote!: () => void;
  const writing = new Promise<void>((resolve) => { wrote = resolve; });
  const harness = delayedWriteFactory('committed', wrote);
  const provider = new BrowserLocalDataProvider({ indexedDB: harness.factory, storage: NULL_STORAGE });
  try {
    await provider.initialize([WRITE_DEFINITION]);
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    let updating!: () => void;
    const started = new Promise<void>((resolve) => { updating = resolve; });
    const seen: string[][] = [];
    const pending = provider.update(WRITE_DEFINITION, async (current) => {
      seen.push([...current]);
      if (seen.length === 1) { updating(); await hold; }
      return { document: [...current, 'selected-file'], result: 'saved' };
    });
    await started;
    assert.equal(harness.state.writeTransactions, 0);
    const concurrent = await prepareLocalDataContent(WRITE_DEFINITION, ['other-tab'], plaintextJsonCodec);
    harness.state.records = concurrent.records;
    harness.state.manifest = {
      ...harness.state.manifest, revision: harness.state.manifest.revision + 1,
      serializedBytes: concurrent.serializedBytes, recordCount: concurrent.records.length,
      digest: concurrent.digest, source: 'application',
    };
    release();
    await writing;
    harness.acknowledge();
    assert.equal(await pending, 'saved');
    assert.deepEqual(seen, [[], ['other-tab']]);
    assert.deepEqual(await provider.read(WRITE_DEFINITION), ['other-tab', 'selected-file']);
    assert.equal(harness.state.writeTransactions, 2, 'The stale transaction is refused before the current revision is saved.');
  } finally { harness.acknowledge(); await provider.close(); restoreKeyRange(); }
});

test('background preparation is opt-in and cancellation or failure before commit leaves records unchanged', async () => {
  const restoreKeyRange = installKeyRangeStub();
  const harness = delayedWriteFactory('committed');
  let preparations = 0;
  let mode: 'reject' | 'abort' = 'reject';
  const controller = new AbortController();
  const provider = new BrowserLocalDataProvider({
    indexedDB: harness.factory, storage: NULL_STORAGE,
    prepareInBackground: async (definition, input, codec) => {
      preparations += 1;
      if (mode === 'reject') throw new BrowserLocalDataError('LOCAL_DATA_PREPARATION_FAILED', 'Worker unavailable.');
      const content = await prepareLocalDataContent(definition, input, codec);
      controller.abort();
      return content;
    },
  });
  try {
    await provider.initialize([WRITE_DEFINITION]);
    assert.equal(await provider.update(WRITE_DEFINITION, (current) => ({ document: current, result: 'unchanged' })), 'unchanged');
    assert.equal(preparations, 0, 'Ordinary mutations do not start background preparation.');
    await assert.rejects(provider.update(WRITE_DEFINITION, async () => ({ document: ['import'], result: 'saved' }), { preparation: 'background' }), /Worker unavailable/u);
    mode = 'abort';
    await assert.rejects(provider.update(WRITE_DEFINITION, async () => ({ document: ['import'], result: 'saved' }), { preparation: 'background', signal: controller.signal }), { name: 'AbortError' });
    assert.equal(preparations, 2);
    const before = harness.state.transactions;
    await assert.rejects(provider.update(WRITE_DEFINITION, () => { throw new Error('A cancelled updater must not run.'); }, { signal: controller.signal }), { name: 'AbortError' });
    assert.equal(harness.state.transactions, before);
    assert.equal(harness.state.writeTransactions, 0);
    assert.deepEqual(await provider.read(WRITE_DEFINITION), []);
  } finally { await provider.close(); restoreKeyRange(); }
});

test('cancellation after a commit begins cannot relabel the committed write as a failed import', { timeout: 3_000 }, async () => {
  const restoreKeyRange = installKeyRangeStub();
  const controller = new AbortController();
  let wrote!: () => void;
  const writing = new Promise<void>((resolve) => { wrote = resolve; });
  const harness = delayedWriteFactory('committed', wrote);
  const notifications: Array<readonly string[]> = [];
  const provider = new BrowserLocalDataProvider({ indexedDB: harness.factory, storage: NULL_STORAGE, oncommit: (ids) => { notifications.push(ids); } });
  try {
    await provider.initialize([WRITE_DEFINITION]);
    const pending = provider.update(WRITE_DEFINITION, async () => ({ document: ['saved'], result: 'committed' }), { signal: controller.signal });
    await writing;
    controller.abort();
    harness.acknowledge();
    assert.equal(await pending, 'committed');
    assert.deepEqual(await provider.read(WRITE_DEFINITION), ['saved']);
    assert.deepEqual(notifications, [[WRITE_DEFINITION.id]]);
  } finally { harness.acknowledge(); await provider.close(); restoreKeyRange(); }
});

test('failed captured-snapshot processing does not run an updater or start a write', async () => {
  const transactions: string[][] = [];
  let failed = false;
  let updaterCalls = 0;
  const provider = new BrowserLocalDataProvider({
    indexedDB: readyEmptyCollectionsFactory([WRITE_DEFINITION], transactions), storage: NULL_STORAGE,
    decodeSnapshots: async (selected, captured, codec) => {
      if (failed) throw new BrowserLocalDataError('LOCAL_DATA_READ_FAILED', 'Verification worker is unavailable.');
      return decodeLocalDataSnapshots(selected, captured, codec);
    },
  });
  await provider.initialize([WRITE_DEFINITION]);
  transactions.length = 0;
  failed = true;
  await assert.rejects(provider.update(WRITE_DEFINITION, (document) => {
    updaterCalls += 1;
    return { document, result: 'saved' };
  }), (cause: unknown) => cause instanceof BrowserLocalDataError && cause.code === 'LOCAL_DATA_READ_FAILED');
  assert.equal(updaterCalls, 0);
  assert.deepEqual(transactions, [['records', 'manifests']]);
  failed = false;
  assert.deepEqual(await provider.read(WRITE_DEFINITION), []);
  await provider.close();
});

test('bounds provider configuration and classifies only expected browser-local failures', () => {
  assert.equal(isExpectedBrowserLocalDataFailure(new BrowserLocalDataError('FIXTURE', 'fixture')), true);
  assert.equal(isExpectedBrowserLocalDataFailure(new DOMException('denied', 'SecurityError')), true);
  assert.equal(isExpectedBrowserLocalDataFailure(new Error('unrelated')), false);
  for (const timeoutMs of [0, -1, 1.5, MAX_LOCAL_DATA_OPERATION_TIMEOUT_MS + 1]) {
    assert.throws(() => new BrowserLocalDataProvider({
      databaseName: 'fixture-invalid-timeout',
      indexedDB: readyEmptyCollectionsFactory([WRITE_DEFINITION]),
      storage: NULL_STORAGE,
      timeoutMs,
    }), (cause: unknown) => cause instanceof BrowserLocalDataError && cause.code === 'INVALID_LOCAL_DATA_TIMEOUT');
  }
  assert.throws(() => new BrowserLocalDataProvider({
    databaseName: '../invalid\u0000',
    indexedDB: readyEmptyCollectionsFactory([WRITE_DEFINITION]),
    storage: NULL_STORAGE,
  }), (cause: unknown) => cause instanceof BrowserLocalDataError && cause.code === 'INVALID_LOCAL_DATA_ID');
});

test('round-trips bounded plaintext records and rejects mismatched or malformed payloads', async () => {
  const encoded = await plaintextJsonCodec.encode({
    collection: 'fixture',
    id: ' record-1 ',
    value: { retained: true },
    maximumBytes: DEFINITION.maximumBytes,
  });
  assert.deepEqual(encoded, {
    lookupKey: 'record-1',
    payload: '{"id":"record-1","value":{"retained":true}}',
  });
  assert.deepEqual(await plaintextJsonCodec.decode({
    collection: 'fixture',
    lookupKey: 'record-1',
    payload: encoded.payload,
    maximumBytes: DEFINITION.maximumBytes,
  }), { id: 'record-1', value: { retained: true } });
  await assert.rejects(
    plaintextJsonCodec.decode({ collection: 'fixture', lookupKey: 'record-2', payload: encoded.payload, maximumBytes: DEFINITION.maximumBytes }),
    (cause: unknown) => cause instanceof BrowserLocalDataError && cause.code === 'LOCAL_DATA_INTEGRITY',
  );
  await assert.rejects(
    plaintextJsonCodec.decode({ collection: 'fixture', lookupKey: 'record-1', payload: '{', maximumBytes: DEFINITION.maximumBytes }),
  );
});

test('plaintext writes and reads share byte and structure admission before serialization', async () => {
  const value = Array.from({ length: 1_000 }, () => Object.fromEntries(
    Array.from({ length: 51 }, (_, index) => [`field${index}`, index]),
  ));
  const input = { collection: 'fixture', id: 'record-1', value };
  const maximumBytes = Buffer.byteLength(JSON.stringify({ id: input.id, value }));
  const encoded = await plaintextJsonCodec.encode({ ...input, maximumBytes });
  assert.deepEqual(await plaintextJsonCodec.decode({
    collection: input.collection, lookupKey: encoded.lookupKey, payload: encoded.payload, maximumBytes,
  }), { id: input.id, value });
  await assert.rejects(plaintextJsonCodec.encode({ ...input, maximumBytes: maximumBytes - 1 }), /application limit/);
  await assert.rejects(plaintextJsonCodec.decode({
    collection: input.collection, lookupKey: encoded.lookupKey, payload: encoded.payload, maximumBytes: maximumBytes - 1,
  }), /application limit/);
  let accessorCalls = 0;
  const accessor = Object.defineProperty({}, 'field', { enumerable: true, get() { accessorCalls += 1; return 'not read'; } });
  for (const invalid of [accessor, { toJSON() { throw new Error('must not execute'); } }, [undefined], Number.NaN]) {
    await assert.rejects(plaintextJsonCodec.encode({ ...input, value: invalid, maximumBytes: 1_024 }), /accessor|non-JSON/);
  }
  assert.equal(accessorCalls, 0);
});

test('over-budget updates leave the previous collection and manifest readable', async () => {
  const notifications: Array<readonly string[]> = [];
  const provider = new BrowserLocalDataProvider({
    databaseName: 'fixture-rejected-write',
    oncommit: (ids) => { notifications.push(ids); },
    indexedDB: readyEmptyCollectionsFactory([WRITE_DEFINITION]),
    storage: NULL_STORAGE,
  });
  try {
    await provider.initialize([WRITE_DEFINITION]);
    await assert.rejects(provider.update(WRITE_DEFINITION, () => ({
      document: ['x'.repeat(WRITE_DEFINITION.maximumBytes)], result: 'not committed',
    })), (cause: unknown) => cause instanceof BrowserLocalDataError && cause.code === 'LOCAL_DATA_QUOTA');
    assert.deepEqual(await provider.read(WRITE_DEFINITION), []);
    assert.deepEqual(notifications, []);
  } finally {
    provider.close();
  }
});

test('plaintext encoding rejects oversized aggregate text before creating JSON output', async (t) => {
  const stringify = t.mock.method(JSON, 'stringify', () => { throw new Error('Serialization must not begin.'); });
  await assert.rejects(plaintextJsonCodec.encode({
    collection: 'fixture', id: 'record-1', value: ['x'.repeat(600), 'x'.repeat(600)], maximumBytes: 1_024,
  }), /aggregate text limit/);
  assert.equal(stringify.mock.callCount(), 0);
});

test('rejects invalid collection sets and returns no-op update results without writing', async () => {
  const notifications: Array<readonly string[]> = [];
  const provider = new BrowserLocalDataProvider({
    databaseName: 'fixture-definition-bounds',
    indexedDB: readyEmptyCollectionsFactory([WRITE_DEFINITION, SECOND_WRITE_DEFINITION]),
    storage: NULL_STORAGE,
    oncommit: (ids) => { notifications.push(ids); },
  });
  await assert.rejects(provider.initialize([]), /between 1 and 16/u);
  await assert.rejects(provider.initialize([WRITE_DEFINITION, WRITE_DEFINITION]), /identifiers must be unique/u);
  const ready = await provider.initialize([WRITE_DEFINITION, SECOND_WRITE_DEFINITION]);
  assert.equal(ready.state, 'ready');
  assert.equal(await provider.update(WRITE_DEFINITION, (document) => ({ document, result: 'unchanged' })), 'unchanged');
  assert.equal(await provider.updateMany([WRITE_DEFINITION, SECOND_WRITE_DEFINITION], (documents) => ({
    documents,
    result: 'unchanged-many',
  })), 'unchanged-many');
  assert.deepEqual(notifications, []);
  await provider.close();
});

test('opening an existing protected workspace cannot initialise missing collections', async () => {
  const transactions: string[][] = [];
  const provider = new BrowserLocalDataProvider({ indexedDB: readyEmptyCollectionsFactory([], transactions), storage: NULL_STORAGE, requireExistingCollections: true });
  await assert.rejects(provider.initialize([WRITE_DEFINITION]), /No empty collections were created/);
  assert.deepEqual(transactions, [['manifests']]);
  await provider.close();
});

test('collections excluded from legacy rollback never read or write a plaintext copy', async () => {
  const definition = { ...WRITE_DEFINITION, legacyRollback: false };
  const transactions: string[][] = [];
  const provider = new BrowserLocalDataProvider({
    indexedDB: readyEmptyCollectionsFactory([definition], transactions),
    storage: { getItem() { throw new Error('No plaintext read is allowed.'); }, setItem() { throw new Error('No plaintext write is allowed.'); }, removeItem() { throw new Error('No plaintext removal is allowed.'); } },
  });
  try {
    await provider.initialize([definition]);
    const before = transactions.length;
    assert.deepEqual(await provider.restoreLegacyCopies([definition]), { collectionCount: 0, serializedBytes: 0, keys: [] });
    assert.equal(transactions.length, before);
  } finally { await provider.close(); }
});

for (const keyed of [false, true]) test(`${keyed ? 'keyed' : 'plaintext'} collections avoid re-encoding no-op writes but preserve in-place updater changes`, { timeout: 3_000 }, async () => {
  const restoreKeyRange = installKeyRangeStub();
  let wrote!: () => void;
  const writing = new Promise<void>(resolve => { wrote = resolve; });
  const harness = delayedWriteFactory('committed', wrote);
  const content = await prepareLocalDataContent(WRITE_DEFINITION, ['retained'], plaintextJsonCodec);
  harness.state.records = content.records;
  harness.state.manifest = { ...harness.state.manifest, recordCount: 1, digest: content.digest, serializedBytes: content.serializedBytes };
  let encodes = 0;
  const provider = new BrowserLocalDataProvider({
    indexedDB: harness.factory, storage: NULL_STORAGE,
    codec: { ...plaintextJsonCodec,
      ...(keyed ? { digestCollection: async (input: { content: string }) => createHash('sha256').update(input.content).digest('base64url') } : {}),
      encode: async input => { encodes++; return plaintextJsonCodec.encode(input); },
    },
  });
  try {
    await provider.initialize([WRITE_DEFINITION]);
    assert.equal(await provider.update(WRITE_DEFINITION, document => ({ document, result: 'unchanged' })), 'unchanged');
    assert.equal(await provider.updateMany([WRITE_DEFINITION], documents => ({ documents, result: 'unchanged-many' })), 'unchanged-many');
    assert.equal(encodes, 0);
    assert.equal(harness.state.writeTransactions, 0);
    const pending = provider.update(WRITE_DEFINITION, document => { document.push('later'); return { document, result: 'saved' }; });
    await writing;
    harness.acknowledge();
    assert.equal(await pending, 'saved');
    assert.deepEqual(await provider.read(WRITE_DEFINITION), ['retained', 'later']);
    assert.equal(encodes, 2);
  } finally { harness.acknowledge(); await provider.close(); restoreKeyRange(); }
});

test('preserves a concurrent legacy value when a later rollback-copy write fails', async () => {
  const restoreKeyRange = installKeyRangeStub();
  const values = new Map<string, string>([
    [WRITE_DEFINITION.legacyKey, '["previous-one"]'],
    [SECOND_WRITE_DEFINITION.legacyKey, '["previous-two"]'],
  ]);
  try {
    const provider = new BrowserLocalDataProvider({
      databaseName: 'fixture-legacy-rollback-conflict',
      indexedDB: readyEmptyCollectionsFactory([WRITE_DEFINITION, SECOND_WRITE_DEFINITION]),
      storage: {
        getItem: (key) => values.get(key) ?? null,
        setItem(key, value) {
          if (key === SECOND_WRITE_DEFINITION.legacyKey) {
            values.set(WRITE_DEFINITION.legacyKey, '["concurrent-tab"]');
            throw new DOMException('Fixture quota reached.', 'QuotaExceededError');
          }
          values.set(key, value);
        },
        removeItem: (key) => { values.delete(key); },
      },
    });
    await provider.initialize([WRITE_DEFINITION, SECOND_WRITE_DEFINITION]);
    await assert.rejects(
      provider.restoreLegacyCopies([WRITE_DEFINITION, SECOND_WRITE_DEFINITION]),
      (cause: unknown) => cause instanceof BrowserLocalDataError && cause.code === 'LOCAL_DATA_CONFLICT',
    );
    assert.equal(values.get(WRITE_DEFINITION.legacyKey), '["concurrent-tab"]');
    assert.equal(values.get(SECOND_WRITE_DEFINITION.legacyKey), '["previous-two"]');
  } finally {
    restoreKeyRange();
  }
});

test('observes a deferred transaction timeout without masking the caller rejection', {
  timeout: 1_000,
}, async () => {
  const calls = { transactions: 0, reads: 0 };
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);

  try {
    const provider = new BrowserLocalDataProvider({
      databaseName: 'fixture-timeout',
      indexedDB: stalledFactory(calls),
      storage: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
      timeoutMs: TIMEOUT_MS,
    });

    await assert.rejects(provider.initialize([DEFINITION]), (cause: unknown) => {
      assert.ok(cause instanceof BrowserLocalDataError);
      assert.equal(cause.code, 'LOCAL_DATA_TIMEOUT');
      assert.equal(cause.message, 'Reading the Fixture collection manifest timed out.');
      return true;
    });

    // Permit Node to report any previously unhandled transaction rejection.
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(calls.transactions, 1);
    assert.equal(calls.reads, 1);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('admits IndexedDB records incrementally before retaining bounded payloads', async (t) => {
  const restoreKeyRange = installKeyRangeStub();
  try {
    const cases = [
      {
        name: 'record count',
        records: Array.from({ length: WRITE_DEFINITION.maximumRecords + 1 }, (_, index) => (
          storedRecord(`fixture-${index}`, '{}', index)
        )),
        manifestCount: WRITE_DEFINITION.maximumRecords,
        expected: /bounded record count/iu,
      },
      {
        name: 'declared payload bytes',
        records: [storedRecord('fixture-0', '{}', 0, WRITE_DEFINITION.maximumBytes * 2 + 1)],
        manifestCount: 1,
        expected: /invalid stored record/iu,
      },
      {
        name: 'actual payload bytes',
        records: [storedRecord('fixture-0', 'x'.repeat(WRITE_DEFINITION.maximumBytes * 2 + 1), 0, 1)],
        manifestCount: 1,
        expected: /invalid stored record/iu,
      },
      {
        name: 'aggregate payload bytes',
        records: Array.from({ length: 3 }, (_, index) => storedRecord(`fixture-${index}`, 'x'.repeat(800), index)),
        manifestCount: 3,
        expected: /invalid stored record/iu,
      },
    ];
    for (const fixture of cases) {
      await t.test(fixture.name, async () => {
        const harness = delayedWriteFactory('committed');
        const provider = new BrowserLocalDataProvider({
          databaseName: `fixture-bounded-cursor-${fixture.name.replace(/\s/gu, '-')}`,
          indexedDB: harness.factory,
          storage: NULL_STORAGE,
          timeoutMs: WRITE_TIMEOUT_MS,
        });
        await provider.initialize([WRITE_DEFINITION]);
        harness.state.records = fixture.records;
        harness.state.manifest = { ...harness.state.manifest, recordCount: fixture.manifestCount };
        await assert.rejects(provider.read(WRITE_DEFINITION), fixture.expected);
      });
    }
  } finally {
    restoreKeyRange();
  }
});

test('confirms a durably applied write after its completion acknowledgement times out', {
  timeout: 1_000,
}, async () => {
  const harness = delayedWriteFactory('committed');
  const notifications: Array<readonly string[]> = [];
  const restoreKeyRange = installKeyRangeStub();
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);

  try {
    const provider = new BrowserLocalDataProvider({
      databaseName: 'fixture-late-commit',
      oncommit: (ids) => { notifications.push(ids); throw new Error('Observer unavailable'); },
      indexedDB: harness.factory,
      storage: NULL_STORAGE,
      timeoutMs: WRITE_TIMEOUT_MS,
    });
    await provider.initialize([WRITE_DEFINITION]);
    let updaterCalls = 0;
    const result = await provider.update(WRITE_DEFINITION, (current) => {
      updaterCalls += 1;
      assert.deepEqual(current, []);
      return { document: ['saved'], result: 'committed' };
    });

    assert.equal(result, 'committed');
    assert.deepEqual(notifications, [[WRITE_DEFINITION.id]]);
    assert.equal(updaterCalls, 1);
    assert.equal(harness.state.writeTransactions, 1);
    assert.equal(harness.state.abortAttempts, 1);
    assert.equal(harness.state.manifest.revision, 2);
    assert.equal(harness.state.records.length, 1);
    assert.equal(harness.state.recoveryReads, 1);
    assert.equal(harness.state.recoveryReadBeforeAcknowledgement, true);
    assert.deepEqual(await provider.read(WRITE_DEFINITION), ['saved']);

    harness.acknowledge();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(harness.state.lateAcknowledgements, 1);
    assert.deepEqual(unhandled, []);
  } finally {
    restoreKeyRange();
    process.off('unhandledRejection', onUnhandled);
  }
});

test('blocks a duplicate retry when timed-out write recovery cannot establish the commit state', {
  timeout: 1_000,
}, async () => {
  const harness = delayedWriteFactory('unknown');
  const notifications: Array<readonly string[]> = [];
  const restoreKeyRange = installKeyRangeStub();
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);

  try {
    const provider = new BrowserLocalDataProvider({
      databaseName: 'fixture-unknown-commit',
      oncommit: (ids) => { notifications.push(ids); },
      indexedDB: harness.factory,
      storage: NULL_STORAGE,
      timeoutMs: WRITE_TIMEOUT_MS,
    });
    await provider.initialize([WRITE_DEFINITION]);
    await assert.rejects(
      provider.update(WRITE_DEFINITION, () => ({ document: ['saved'], result: undefined })),
      (cause: unknown) => cause instanceof BrowserLocalDataError && cause.code === 'LOCAL_DATA_COMMIT_UNKNOWN',
    );

    const transactionsAfterUnknown = harness.state.transactions;
    let retryUpdaterCalls = 0;
    await assert.rejects(
      provider.update(WRITE_DEFINITION, (current) => {
        retryUpdaterCalls += 1;
        return { document: [...current, 'duplicate'], result: undefined };
      }),
      (cause: unknown) => cause instanceof BrowserLocalDataError && cause.code === 'LOCAL_DATA_COMMIT_UNKNOWN',
    );
    assert.equal(retryUpdaterCalls, 0);
    assert.deepEqual(notifications, []);
    assert.equal(harness.state.transactions, transactionsAfterUnknown);
    assert.deepEqual(await provider.read(WRITE_DEFINITION), ['saved']);

    harness.acknowledge();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(harness.state.lateAcknowledgements, 1);
    assert.deepEqual(unhandled, []);
  } finally {
    restoreKeyRange();
    process.off('unhandledRejection', onUnhandled);
  }
});

test('treats divergent timed-out commit manifests as unknown outcomes', {
  timeout: 3_000,
}, async (t) => {
  for (const outcome of [
    'same_revision_different',
    'same_content_different_source',
    'same_content_different_legacy_digest',
  ] as const) {
    await t.test(outcome, async () => {
      const harness = delayedWriteFactory(outcome);
      const restoreKeyRange = installKeyRangeStub();
      try {
        const provider = new BrowserLocalDataProvider({
          databaseName: `fixture-divergent-commit-${outcome}`,
          indexedDB: harness.factory,
          storage: NULL_STORAGE,
          timeoutMs: WRITE_TIMEOUT_MS,
        });
        await provider.initialize([WRITE_DEFINITION]);
        await assert.rejects(
          provider.update(WRITE_DEFINITION, () => ({ document: ['saved'], result: undefined })),
          (cause: unknown) => cause instanceof BrowserLocalDataError && cause.code === 'LOCAL_DATA_COMMIT_UNKNOWN',
        );

        const transactionsAfterUnknown = harness.state.transactions;
        let retryUpdaterCalls = 0;
        await assert.rejects(
          provider.update(WRITE_DEFINITION, (current) => {
            retryUpdaterCalls += 1;
            return { document: [...current, 'duplicate'], result: undefined };
          }),
          (cause: unknown) => cause instanceof BrowserLocalDataError && cause.code === 'LOCAL_DATA_COMMIT_UNKNOWN',
        );
        assert.equal(retryUpdaterCalls, 0);
        assert.equal(harness.state.transactions, transactionsAfterUnknown);
        assert.deepEqual(await provider.read(WRITE_DEFINITION), ['saved']);
      } finally {
        restoreKeyRange();
      }
    });
  }
});

test('blocks another writer while a timed-out commit is still being reconciled', {
  timeout: 1_000,
}, async () => {
  const harness = delayedWriteFactory('deferred_unknown');
  const restoreKeyRange = installKeyRangeStub();
  try {
    const provider = new BrowserLocalDataProvider({
      databaseName: 'fixture-recovering-commit',
      indexedDB: harness.factory,
      storage: NULL_STORAGE,
      timeoutMs: WRITE_TIMEOUT_MS,
    });
    await provider.initialize([WRITE_DEFINITION]);
    const firstOutcome = provider.update(
      WRITE_DEFINITION,
      () => ({ document: ['saved'], result: undefined }),
    ).then(
      () => null,
      (cause: unknown) => cause,
    );
    await harness.recoveryStarted;

    const transactionsDuringRecovery = harness.state.transactions;
    let secondUpdaterCalls = 0;
    await assert.rejects(
      provider.update(WRITE_DEFINITION, (current) => {
        secondUpdaterCalls += 1;
        return { document: [...current, 'duplicate'], result: undefined };
      }),
      (cause: unknown) => cause instanceof BrowserLocalDataError && cause.code === 'LOCAL_DATA_COMMIT_UNKNOWN',
    );
    assert.equal(secondUpdaterCalls, 0);
    assert.equal(harness.state.transactions, transactionsDuringRecovery);

    harness.releaseRecovery();
    const firstCause = await firstOutcome;
    assert.ok(firstCause instanceof BrowserLocalDataError);
    assert.equal(firstCause.code, 'LOCAL_DATA_COMMIT_UNKNOWN');
    assert.deepEqual(await provider.read(WRITE_DEFINITION), ['saved']);
  } finally {
    harness.releaseRecovery();
    restoreKeyRange();
  }
});
