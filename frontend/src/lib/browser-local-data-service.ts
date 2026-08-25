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

export type BrowserLocalDataServiceState =
  | Readonly<{ state: 'idle' | 'initializing' }>
  | Readonly<{ state: 'ready'; initialization: BrowserLocalDataInitialization }>
  | Readonly<{ state: 'error'; code: string; detail: string }>;

let provider: BrowserLocalDataProvider | null = null;
let providerPromise: Promise<BrowserLocalDataProvider> | null = null;
let collectionsPromise: Promise<readonly AnyLocalDataCollectionDefinition[]> | null = null;
let serviceState: BrowserLocalDataServiceState = Object.freeze({ state: 'idle' });

function browserLocalCollections(): Promise<readonly AnyLocalDataCollectionDefinition[]> {
  if (!collectionsPromise) {
    collectionsPromise = import('./browser-local-data-definitions.ts')
      .then((module) => module.BROWSER_LOCAL_COLLECTIONS)
      .catch((cause) => {
        collectionsPromise = null;
        throw cause;
      });
  }
  return collectionsPromise;
}

async function browserLocalDataCollection<Collection extends BrowserLocalCollectionId>(
  collection: Collection,
): Promise<LocalDataCollectionDefinition<BrowserLocalCollectionDocumentMap[Collection]>> {
  const definitions = await browserLocalCollections();
  const definition = definitions.find((candidate) => candidate.id === collection);
  if (!definition) {
    throw new BrowserLocalDataError('INVALID_LOCAL_DATA_DEFINITION', `The ${collection} collection is unavailable.`);
  }
  return definition as LocalDataCollectionDefinition<BrowserLocalCollectionDocumentMap[Collection]>;
}

function boundedDetail(cause: unknown): string {
  return (cause instanceof Error ? cause.message : 'Browser-local data could not be initialised.')
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 240) || 'Browser-local data could not be initialised.';
}

export function browserLocalDataServiceState(): BrowserLocalDataServiceState {
  return serviceState;
}

export async function browserLocalDataProvider(): Promise<BrowserLocalDataProvider> {
  if (providerPromise) return providerPromise;
  serviceState = Object.freeze({ state: 'initializing' });
  providerPromise = (async () => {
    try {
      const collections = await browserLocalCollections();
      provider = new BrowserLocalDataProvider();
      const initialization = await provider.initialize(collections);
      serviceState = Object.freeze({ state: 'ready', initialization });
      return provider;
    } catch (cause) {
      provider = null;
      providerPromise = null;
      serviceState = Object.freeze({
        state: 'error',
        code: cause instanceof BrowserLocalDataError ? cause.code : 'LOCAL_DATA_INITIALIZATION_FAILED',
        detail: boundedDetail(cause),
      });
      throw cause;
    }
  })();
  return providerPromise;
}

export async function initializeBrowserLocalData(): Promise<BrowserLocalDataServiceState> {
  try { await browserLocalDataProvider(); }
  catch { /* the explicit error state is returned below */ }
  return browserLocalDataServiceState();
}

export async function restoreLegacyBrowserData() {
  const [activeProvider, collections] = await Promise.all([
    browserLocalDataProvider(),
    browserLocalCollections(),
  ]);
  return activeProvider.restoreLegacyCopies(collections);
}

export async function readBrowserLocalData<Collection extends BrowserLocalCollectionId>(
  collection: Collection,
): Promise<BrowserLocalCollectionDocumentMap[Collection]> {
  const [activeProvider, definition] = await Promise.all([
    browserLocalDataProvider(),
    browserLocalDataCollection(collection),
  ]);
  return activeProvider.read(definition);
}

export async function updateBrowserLocalData<Collection extends BrowserLocalCollectionId, Result>(
  collection: Collection,
  updater: (
    current: BrowserLocalCollectionDocumentMap[Collection],
  ) => Readonly<{ document: BrowserLocalCollectionDocumentMap[Collection]; result: Result }>,
): Promise<Result> {
  const [activeProvider, definition] = await Promise.all([
    browserLocalDataProvider(),
    browserLocalDataCollection(collection),
  ]);
  return activeProvider.update(definition, updater);
}

export { browserLocalDataCollection };
