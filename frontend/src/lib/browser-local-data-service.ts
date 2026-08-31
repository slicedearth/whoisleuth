import {
  BrowserLocalDataError,
  BrowserLocalDataProvider,
  type AnyLocalDataCollectionDefinition,
  type BrowserLocalDataInitialization,
  type LocalDataCollectionDefinition,
} from './browser-local-data.ts';
import type {
  BrowserLocalCollectionDocumentMap,
  BrowserLocalCollectionId,
} from './browser-local-data-definitions.ts';
import { isDeferredModuleLoadError, loadDeferredModule } from './deferred-module.js';

export type BrowserLocalDataServiceState =
  | Readonly<{ state: 'idle' | 'initializing' }>
  | Readonly<{ state: 'ready'; initialization: BrowserLocalDataInitialization }>
  | Readonly<{ state: 'error'; code: string; detail: string }>;

export type BrowserLocalDataProviderBoundary = Readonly<{
  initialize: BrowserLocalDataProvider['initialize'];
  restoreLegacyCopies: BrowserLocalDataProvider['restoreLegacyCopies'];
  read: BrowserLocalDataProvider['read'];
  update: BrowserLocalDataProvider['update'];
}>;

export type BrowserLocalDataServiceDependencies = Readonly<{
  loadCollections: () => Promise<readonly AnyLocalDataCollectionDefinition[]>;
  createProvider: () => BrowserLocalDataProviderBoundary;
}>;

function boundedDetail(cause: unknown): string {
  return (cause instanceof Error ? cause.message : 'Browser-local data could not be initialised.')
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 240) || 'Browser-local data could not be initialised.';
}

export function browserLocalDataServiceState(): BrowserLocalDataServiceState {
  return defaultService.state();
}

export function createBrowserLocalDataService(
  dependencies: Partial<BrowserLocalDataServiceDependencies> = {},
) {
  const loadCollections = dependencies.loadCollections ?? (() => loadDeferredModule(
    () => import('./browser-local-data-definitions.ts'),
  )
    .then((module) => module.BROWSER_LOCAL_COLLECTIONS));
  const createProvider = dependencies.createProvider ?? (() => new BrowserLocalDataProvider());
  let providerPromise: Promise<BrowserLocalDataProviderBoundary> | null = null;
  let collectionsPromise: Promise<readonly AnyLocalDataCollectionDefinition[]> | null = null;
  let serviceState: BrowserLocalDataServiceState = Object.freeze({ state: 'idle' });

  function collections(): Promise<readonly AnyLocalDataCollectionDefinition[]> {
    if (collectionsPromise) return collectionsPromise;
    const loading = loadCollections().catch((cause) => {
      collectionsPromise = null;
      throw cause;
    });
    collectionsPromise = loading;
    return loading;
  }

  async function collection<Collection extends BrowserLocalCollectionId>(
    id: Collection,
  ): Promise<LocalDataCollectionDefinition<BrowserLocalCollectionDocumentMap[Collection]>> {
    const definitions = await collections();
    const definition = definitions.find((candidate) => candidate.id === id);
    if (!definition) {
      throw new BrowserLocalDataError('INVALID_LOCAL_DATA_DEFINITION', `The ${id} collection is unavailable.`);
    }
    return definition as LocalDataCollectionDefinition<BrowserLocalCollectionDocumentMap[Collection]>;
  }

  async function activeProvider(): Promise<BrowserLocalDataProviderBoundary> {
    if (providerPromise) return providerPromise;
    serviceState = Object.freeze({ state: 'initializing' });
    providerPromise = (async () => {
      try {
        const definitions = await collections();
        const nextProvider = createProvider();
        const initialization = await nextProvider.initialize(definitions);
        serviceState = Object.freeze({ state: 'ready', initialization });
        return nextProvider;
      } catch (cause) {
        providerPromise = null;
        serviceState = Object.freeze({
          state: 'error',
          code: cause instanceof BrowserLocalDataError
            ? cause.code
            : isDeferredModuleLoadError(cause)
              ? 'DEFERRED_MODULE_UNAVAILABLE'
              : 'LOCAL_DATA_INITIALIZATION_FAILED',
          detail: boundedDetail(cause),
        });
        throw cause;
      }
    })();
    return providerPromise;
  }

  async function initialize(): Promise<BrowserLocalDataServiceState> {
    try { await activeProvider(); }
    catch { /* the explicit error state is returned below */ }
    return serviceState;
  }

  async function restoreLegacyCopies() {
    const [provider, definitions] = await Promise.all([activeProvider(), collections()]);
    return provider.restoreLegacyCopies(definitions);
  }

  async function read<Collection extends BrowserLocalCollectionId>(
    id: Collection,
  ): Promise<BrowserLocalCollectionDocumentMap[Collection]> {
    const [provider, definition] = await Promise.all([activeProvider(), collection(id)]);
    return provider.read(definition);
  }

  async function update<Collection extends BrowserLocalCollectionId, Result>(
    id: Collection,
    updater: (
      current: BrowserLocalCollectionDocumentMap[Collection],
    ) => Readonly<{ document: BrowserLocalCollectionDocumentMap[Collection]; result: Result }>,
  ): Promise<Result> {
    const [provider, definition] = await Promise.all([activeProvider(), collection(id)]);
    return provider.update(definition, updater);
  }

  return Object.freeze({
    state: () => serviceState,
    provider: activeProvider,
    initialize,
    restoreLegacyCopies,
    read,
    update,
    collection,
  });
}

const defaultService = createBrowserLocalDataService();

export async function browserLocalDataProvider(): Promise<BrowserLocalDataProvider> {
  return await defaultService.provider() as BrowserLocalDataProvider;
}

export async function initializeBrowserLocalData(): Promise<BrowserLocalDataServiceState> {
  return defaultService.initialize();
}

export async function restoreLegacyBrowserData() {
  return defaultService.restoreLegacyCopies();
}

export async function readBrowserLocalData<Collection extends BrowserLocalCollectionId>(
  collection: Collection,
): Promise<BrowserLocalCollectionDocumentMap[Collection]> {
  return defaultService.read(collection);
}

export async function updateBrowserLocalData<Collection extends BrowserLocalCollectionId, Result>(
  collection: Collection,
  updater: (
    current: BrowserLocalCollectionDocumentMap[Collection],
  ) => Readonly<{ document: BrowserLocalCollectionDocumentMap[Collection]; result: Result }>,
): Promise<Result> {
  return defaultService.update(collection, updater);
}

export async function browserLocalDataCollection<Collection extends BrowserLocalCollectionId>(
  collection: Collection,
): Promise<LocalDataCollectionDefinition<BrowserLocalCollectionDocumentMap[Collection]>> {
  return defaultService.collection(collection);
}
