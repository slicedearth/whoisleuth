import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  createBrowserLocalDataService,
  type BrowserLocalDataProviderBoundary,
} from '../frontend/src/lib/browser-local-data-service.ts';
import { SHORTLIST_COLLECTION } from '../frontend/src/lib/browser-local-data-definitions.ts';
import {
  BrowserLocalDataError,
  type BrowserLocalDataInitialization,
  type BrowserLocalDataUpdater,
} from '../frontend/src/lib/browser-local-data.ts';

const READY: BrowserLocalDataInitialization = Object.freeze({
  state: 'ready',
  databaseName: 'fixture-browser-data',
  migratedCollections: Object.freeze([]),
  retainedLegacyKeys: Object.freeze([]),
  codec: 'json-v1',
});

function readyProvider(overrides: Partial<BrowserLocalDataProviderBoundary> = {}): BrowserLocalDataProviderBoundary {
  return {
    initialize: async () => READY,
    restoreLegacyCopies: async () => ({ collectionCount: 0, serializedBytes: 0, keys: [] }),
    read: async <Document,>() => [] as Document,
    readMany: async (definitions) => new Map(definitions.map((definition) => [definition.id, []])),
    update: async <Document, Result>(
      _definition: unknown,
      updater: BrowserLocalDataUpdater<Document, Result>,
    ) => (await updater([] as Document)).result,
    ...overrides,
  } as BrowserLocalDataProviderBoundary;
}

describe('browser-local data service', () => {
  test('awaits one asynchronous provider selection and never dispatches an early read', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let creations = 0;
    let reads = 0;
    const provider = readyProvider({ read: async <Document,>() => { reads++; return [] as Document; } });
    const service = createBrowserLocalDataService({
      loadCollections: async () => [SHORTLIST_COLLECTION],
      createProvider: async () => { creations++; await gate; return provider; },
    });
    const first = service.read('shortlist');
    const second = service.provider();
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(creations, 1); assert.equal(reads, 0);
    assert.equal(service.state().state, 'initializing');
    release();
    assert.deepEqual(await first, []); assert.equal(await second, provider);
    assert.equal(creations, 1); assert.equal(reads, 1);
  });

  test('an asynchronous selection failure exposes an error before a deliberate provider retry', async () => {
    let attempts = 0;
    const service = createBrowserLocalDataService({
      loadCollections: async () => [SHORTLIST_COLLECTION],
      createProvider: async () => { if (++attempts === 1) throw new Error('Selected workspace is unavailable.'); return readyProvider(); },
    });
    assert.equal((await service.initialize()).state, 'error');
    assert.equal(attempts, 1);
    assert.equal((await service.initialize()).state, 'ready');
    assert.equal(attempts, 2);
  });

  test('explicit collection creation is captured once and is not inherited by later retries', async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const observed: unknown[] = [];
    const service = createBrowserLocalDataService({
      loadCollections: async () => { await pending; return [SHORTLIST_COLLECTION]; },
      createProvider: () => readyProvider({ initialize: async (_definitions, options) => {
        observed.push(options);
        throw new BrowserLocalDataError('LOCAL_DATA_MISSING', 'Missing fixture collection');
      } }),
    });
    const selected = ['shortlist'];
    const attempt = service.initialize({ createMissingCollections: selected });
    selected[0] = 'cases'; release();
    assert.equal((await attempt).state, 'error');
    assert.equal((await service.initialize()).state, 'error');
    assert.deepEqual(observed, [{ createMissingCollections: ['shortlist'] }, {}]);
  });
  test('forwards an awaited updater and cancellation without another save coordinator', async () => {
    const controller = new AbortController();
    let calls = 0;
    const service = createBrowserLocalDataService({
      loadCollections: async () => [SHORTLIST_COLLECTION],
      createProvider: () => readyProvider({
        update: async (definition, updater, options) => {
          calls += 1;
          assert.equal(definition, SHORTLIST_COLLECTION);
          assert.equal(options?.signal, controller.signal);
          assert.equal(options?.preparation, 'background');
          return (await updater(definition.empty())).result;
        },
      }),
    });
    const value = await service.update('shortlist', async (current) => ({ document: current, result: 'prepared' }), { preparation: 'background', signal: controller.signal });
    assert.equal(value, 'prepared');
    assert.equal(calls, 1);
  });
  test('a multi-collection request uses the provider snapshot rather than separate reads', async () => {
    const documents = new Map<string, unknown>([['shortlist', [{ domain: 'snapshot.example' }]]]);
    let reads = 0;
    const service = createBrowserLocalDataService({
      loadCollections: async () => [SHORTLIST_COLLECTION],
      createProvider: () => readyProvider({
        read: async () => { throw new Error('Separate reads are not a consistent snapshot.'); },
        readMany: async (definitions) => {
          reads += 1;
          assert.deepEqual(definitions, [SHORTLIST_COLLECTION]);
          return documents;
        },
      }),
    });
    const snapshot = await service.readMany(['shortlist']);
    assert.deepEqual(snapshot, { shortlist: documents.get('shortlist') });
    assert.equal(reads, 1);
  });

  test('scopes post-commit notifications and isolates unsubscribed or failing observers', async () => {
    let commit: (ids: readonly string[]) => void = () => {};
    const service = createBrowserLocalDataService({
      loadCollections: async () => [SHORTLIST_COLLECTION],
      createProvider: (oncommit) => { commit = oncommit; return readyProvider(); },
    });
    let cases = 0;
    let shortlist = 0;
    const unsubscribe = service.subscribe('cases', () => { cases += 1; });
    const broken = service.subscribe('cases', () => { throw new Error('View unavailable'); });
    const asyncBroken = service.subscribe('cases', async () => { throw new Error('Async view unavailable'); });
    const other = service.subscribe('shortlist', () => { shortlist += 1; });
    await service.initialize();
    assert.equal(cases, 0);
    commit(['shortlist']);
    assert.equal(cases, 0);
    assert.equal(shortlist, 1);
    commit(['cases', 'shortlist']);
    assert.equal(cases, 1);
    assert.equal(shortlist, 2);
    unsubscribe(); broken(); asyncBroken(); other();
    commit(['cases', 'shortlist']);
    assert.equal(cases, 1);
    assert.equal(shortlist, 2);
    await new Promise<void>((resolve) => setImmediate(resolve));
  });

  test('shares one in-flight initialisation and exposes only the settled ready state', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let providerCreations = 0;
    let initialisations = 0;
    const provider = readyProvider({
      initialize: async () => {
        initialisations += 1;
        await gate;
        return READY;
      },
    });
    const service = createBrowserLocalDataService({
      loadCollections: async () => [SHORTLIST_COLLECTION],
      createProvider: () => {
        providerCreations += 1;
        return provider;
      },
    });

    const first = service.provider();
    const second = service.provider();
    assert.deepEqual(service.state(), { state: 'initializing' });
    release();
    const [firstProvider, secondProvider] = await Promise.all([first, second]);

    assert.equal(firstProvider, provider);
    assert.equal(secondProvider, provider);
    assert.equal(providerCreations, 1);
    assert.equal(initialisations, 1);
    assert.deepEqual(service.state(), { state: 'ready', initialization: READY });
  });

  test('records a bounded initialisation failure and creates a fresh provider on explicit retry', async () => {
    let providerCreations = 0;
    let closed = 0;
    const service = createBrowserLocalDataService({
      loadCollections: async () => [SHORTLIST_COLLECTION],
      createProvider: () => {
        providerCreations += 1;
        if (providerCreations === 1) {
          return readyProvider({
            close: async () => { closed += 1; throw new Error('Cleanup did not replace the original failure.'); },
            initialize: async () => {
              throw new BrowserLocalDataError(
                'LOCAL_DATA_UNSUPPORTED',
                `Browser storage failed.\u0000 ${'sensitive fixture detail '.repeat(30)}`,
              );
            },
          });
        }
        return readyProvider();
      },
    });

    const failed = await service.initialize();
    assert.equal(closed, 1);
    assert.equal(failed.state, 'error');
    if (failed.state !== 'error') return;
    assert.equal(failed.code, 'LOCAL_DATA_UNSUPPORTED');
    assert.ok(failed.detail.length <= 240);
    assert.doesNotMatch(failed.detail, /[\u0000-\u001f\u007f]/u);

    assert.deepEqual(await service.initialize(), { state: 'ready', initialization: READY });
    assert.equal(providerCreations, 2);
    assert.equal(closed, 1);
  });

  test('delegates post-commit reconciliation once and never turns an unknown commit into an automatic retry', async () => {
    let mode: 'reconciled' | 'unknown' = 'reconciled';
    let providerCreations = 0;
    let updateCalls = 0;
    let updaterCalls = 0;
    const provider = readyProvider({
      update: async <Document, Result>(
        _definition: unknown,
        updater: BrowserLocalDataUpdater<Document, Result>,
      ) => {
        updateCalls += 1;
        if (mode === 'unknown') {
          throw new BrowserLocalDataError(
            'LOCAL_DATA_COMMIT_UNKNOWN',
            'The browser-local write may have committed. Reload before retrying.',
          );
        }
        return (await updater([] as Document)).result;
      },
    });
    const service = createBrowserLocalDataService({
      loadCollections: async () => [SHORTLIST_COLLECTION],
      createProvider: () => {
        providerCreations += 1;
        return provider;
      },
    });

    const result = await service.update('shortlist', (current) => {
      updaterCalls += 1;
      return { document: current, result: 'committed' as const };
    });
    assert.equal(result, 'committed');
    assert.equal(updaterCalls, 1);

    mode = 'unknown';
    await assert.rejects(
      service.update('shortlist', (current) => {
        updaterCalls += 1;
        return { document: current, result: 'duplicate' };
      }),
      (cause: unknown) => cause instanceof BrowserLocalDataError && cause.code === 'LOCAL_DATA_COMMIT_UNKNOWN',
    );
    assert.equal(updateCalls, 2);
    assert.equal(updaterCalls, 1);
    assert.equal(providerCreations, 1);
    assert.equal(service.state().state, 'ready');
  });
});
