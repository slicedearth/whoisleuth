import {
  BrowserLocalDataError,
  BrowserLocalDataProvider,
  type AnyLocalDataCollectionDefinition,
  type BrowserLocalDataInitialization,
  type BrowserLocalDataCommitListener,
  type LocalDataCollectionDefinition,
  type BrowserLocalDataUpdater,
  type BrowserLocalDataUpdateOptions,
} from './browser-local-data.ts';
import type {
  BrowserLocalCollectionDocumentMap,
  BrowserLocalCollectionId,
} from './browser-local-data-definitions.ts';
import { isDeferredModuleLoadError, loadDeferredModule } from './deferred-module.ts';
import { decodeBrowserLocalDataSnapshots, loadBrowserLocalDataPreparation } from './browser-local-data-worker.ts';
import { currentBrowserWorkspaceId, DEFAULT_BROWSER_WORKSPACE } from './browser-workspace-context.ts';

export type BrowserLocalDataServiceState =
  | Readonly<{ state: 'idle' | 'initializing' }>
  | Readonly<{ state: 'ready'; initialization: BrowserLocalDataInitialization }>
  | Readonly<{ state: 'error'; code: string; detail: string }>;

/** Loading one collection is distinct from initialising the shared provider. */
export type BrowserLocalCollectionLoadState = 'idle' | 'loading' | 'ready' | 'unavailable';

export type BrowserLocalDataProviderBoundary = Readonly<{
  initialize: BrowserLocalDataProvider['initialize'];
  restoreLegacyCopies: BrowserLocalDataProvider['restoreLegacyCopies'];
  read: BrowserLocalDataProvider['read'];
  readMany: BrowserLocalDataProvider['readMany'];
  update: BrowserLocalDataProvider['update'];
  close?: BrowserLocalDataProvider['close'];
}>;

export type BrowserLocalDataServiceDependencies = Readonly<{
  loadCollections: () => Promise<readonly AnyLocalDataCollectionDefinition[]>;
  createProvider: (oncommit: BrowserLocalDataCommitListener) => BrowserLocalDataProviderBoundary | Promise<BrowserLocalDataProviderBoundary>;
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
  const createProvider = dependencies.createProvider ?? (async (oncommit: BrowserLocalDataCommitListener) => {
    const options: ConstructorParameters<typeof BrowserLocalDataProvider>[0] = {
      oncommit, decodeSnapshots: decodeBrowserLocalDataSnapshots,
      prepareInBackground: async (...args) => {
        const { prepareBrowserLocalDataContent } = await loadBrowserLocalDataPreparation(args[3] ?? {});
        return prepareBrowserLocalDataContent(...args);
      },
    };
    if (currentBrowserWorkspaceId() === DEFAULT_BROWSER_WORKSPACE) return new BrowserLocalDataProvider(options);
    const { createNamedWorkspaceProvider } = await loadDeferredModule(() => import('./browser-workspace-provider.ts'));
    return createNamedWorkspaceProvider(options);
  });
  const listeners = new Map<BrowserLocalCollectionId, Set<() => void>>();
  let providerPromise: Promise<BrowserLocalDataProviderBoundary> | null = null;
  let collectionsPromise: Promise<readonly AnyLocalDataCollectionDefinition[]> | null = null;
  let serviceState: BrowserLocalDataServiceState = Object.freeze({ state: 'idle' });

  function subscribe(id: BrowserLocalCollectionId, listener: () => void): () => void {
    const collectionListeners = listeners.get(id) ?? new Set<() => void>();
    collectionListeners.add(listener);
    listeners.set(id, collectionListeners);
    return () => {
      collectionListeners.delete(listener);
      if (!collectionListeners.size) listeners.delete(id);
    };
  }

  function notifyCommitted(ids: readonly string[]): void {
    for (const [id, collectionListeners] of listeners) {
      if (!ids.includes(id)) continue;
      for (const listener of [...collectionListeners]) {
        try { void Promise.resolve(listener()).catch(() => {}); } catch { /* Observers do not participate in persistence. */ }
      }
    }
  }

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
        const nextProvider = await createProvider(notifyCommitted);
        const initialization = await nextProvider.initialize(definitions).catch(async (cause) => {
          try { await nextProvider.close?.(); } catch { /* Preserve the original initialisation failure. */ }
          throw cause;
        });
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
    if (currentBrowserWorkspaceId() !== DEFAULT_BROWSER_WORKSPACE) throw new Error('Named workspaces use portable backups; no historical legacy copy exists.');
    const [provider, definitions] = await Promise.all([activeProvider(), collections()]);
    return provider.restoreLegacyCopies(definitions);
  }

  async function read<Collection extends BrowserLocalCollectionId>(
    id: Collection,
  ): Promise<BrowserLocalCollectionDocumentMap[Collection]> {
    const [provider, definition] = await Promise.all([activeProvider(), collection(id)]);
    return provider.read(definition);
  }

  async function readMany<Collection extends BrowserLocalCollectionId>(
    ids: readonly Collection[],
  ): Promise<Pick<BrowserLocalCollectionDocumentMap, Collection>> {
    const [provider, definitions] = await Promise.all([activeProvider(), Promise.all(ids.map(collection))]);
    const documents = await provider.readMany(definitions);
    return Object.fromEntries(documents) as Pick<BrowserLocalCollectionDocumentMap, Collection>;
  }

  async function update<Collection extends BrowserLocalCollectionId, Result>(
    id: Collection,
    updater: BrowserLocalDataUpdater<BrowserLocalCollectionDocumentMap[Collection], Result>,
    options: BrowserLocalDataUpdateOptions = {},
  ): Promise<Result> {
    const [provider, definition] = await Promise.all([activeProvider(), collection(id)]);
    return provider.update(definition, updater, options);
  }

  return Object.freeze({
    state: () => serviceState,
    provider: activeProvider,
    initialize,
    restoreLegacyCopies,
    read,
    readMany,
    update,
    collection,
    subscribe,
  });
}

const defaultService = createBrowserLocalDataService();

export function subscribeBrowserLocalData(collection: BrowserLocalCollectionId, listener: () => void): () => void {
  return defaultService.subscribe(collection, listener);
}

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

export async function readBrowserLocalDataCollections<Collection extends BrowserLocalCollectionId>(
  collections: readonly Collection[],
): Promise<Pick<BrowserLocalCollectionDocumentMap, Collection>> {
  return defaultService.readMany(collections);
}

export async function updateBrowserLocalData<Collection extends BrowserLocalCollectionId, Result>(
  collection: Collection,
  updater: BrowserLocalDataUpdater<BrowserLocalCollectionDocumentMap[Collection], Result>,
  options: BrowserLocalDataUpdateOptions = {},
): Promise<Result> {
  return defaultService.update(collection, updater, options);
}

export async function browserLocalDataCollection<Collection extends BrowserLocalCollectionId>(
  collection: Collection,
): Promise<LocalDataCollectionDefinition<BrowserLocalCollectionDocumentMap[Collection]>> {
  return defaultService.collection(collection);
}
