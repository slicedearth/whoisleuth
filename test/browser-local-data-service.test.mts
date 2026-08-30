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
    update: async <Document, Result>(
      _definition: unknown,
      updater: (current: Document) => Readonly<{ document: Document; result: Result }>,
    ) => updater([] as Document).result,
    ...overrides,
  } as BrowserLocalDataProviderBoundary;
}

describe('browser-local data service', () => {
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
    const service = createBrowserLocalDataService({
      loadCollections: async () => [SHORTLIST_COLLECTION],
      createProvider: () => {
        providerCreations += 1;
        if (providerCreations === 1) {
          return readyProvider({
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
    assert.equal(failed.state, 'error');
    if (failed.state !== 'error') return;
    assert.equal(failed.code, 'LOCAL_DATA_UNSUPPORTED');
    assert.ok(failed.detail.length <= 240);
    assert.doesNotMatch(failed.detail, /[\u0000-\u001f\u007f]/u);

    assert.deepEqual(await service.initialize(), { state: 'ready', initialization: READY });
    assert.equal(providerCreations, 2);
  });

  test('delegates post-commit reconciliation once and never turns an unknown commit into an automatic retry', async () => {
    let mode: 'reconciled' | 'unknown' = 'reconciled';
    let providerCreations = 0;
    let updateCalls = 0;
    let updaterCalls = 0;
    const provider = readyProvider({
      update: async <Document, Result>(
        _definition: unknown,
        updater: (current: Document) => Readonly<{ document: Document; result: Result }>,
      ) => {
        updateCalls += 1;
        if (mode === 'unknown') {
          throw new BrowserLocalDataError(
            'LOCAL_DATA_COMMIT_UNKNOWN',
            'The browser-local write may have committed. Reload before retrying.',
          );
        }
        return updater([] as Document).result;
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
