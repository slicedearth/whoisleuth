import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';

import {
  BrowserLocalDataError,
  BrowserLocalDataProvider,
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

type DelayedWriteOutcome =
  | 'committed'
  | 'unknown'
  | 'same_revision_different'
  | 'same_content_different_source'
  | 'same_content_different_legacy_digest'
  | 'deferred_unknown';

function delayedWriteFactory(outcome: DelayedWriteOutcome): {
  factory: IDBFactory;
  state: DelayedWriteState;
  recoveryStarted: Promise<void>;
  releaseRecovery: () => void;
} {
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
            getAll(_query?: IDBValidKey | IDBKeyRange | null, count?: number) {
              return successfulRequest(state.records.slice(0, count));
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
        setTimeout(() => {
          state.lateAcknowledgements += 1;
          transaction.oncomplete?.call(transaction, new Event('complete'));
        }, WRITE_TIMEOUT_MS * 3);
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

test('confirms a durably applied write after its completion acknowledgement times out', {
  timeout: 1_000,
}, async () => {
  const harness = delayedWriteFactory('committed');
  const restoreKeyRange = installKeyRangeStub();
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);

  try {
    const provider = new BrowserLocalDataProvider({
      databaseName: 'fixture-late-commit',
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
    assert.equal(updaterCalls, 1);
    assert.equal(harness.state.writeTransactions, 1);
    assert.equal(harness.state.abortAttempts, 1);
    assert.equal(harness.state.manifest.revision, 2);
    assert.equal(harness.state.records.length, 1);
    assert.equal(harness.state.recoveryReads, 1);
    assert.equal(harness.state.recoveryReadBeforeAcknowledgement, true);
    assert.deepEqual(await provider.read(WRITE_DEFINITION), ['saved']);

    await new Promise<void>((resolve) => setTimeout(resolve, WRITE_TIMEOUT_MS * 4));
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
  const restoreKeyRange = installKeyRangeStub();
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);

  try {
    const provider = new BrowserLocalDataProvider({
      databaseName: 'fixture-unknown-commit',
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

    await new Promise<void>((resolve) => setTimeout(resolve, WRITE_TIMEOUT_MS * 4));
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
