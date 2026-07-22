import {
  BrowserLocalDataError,
  BrowserLocalDataProvider,
  type BrowserLocalDataInitialization,
} from './browser-local-data.js';
import { BROWSER_LOCAL_COLLECTIONS } from './browser-local-data-definitions.js';

export type BrowserLocalDataServiceState =
  | Readonly<{ state: 'idle' | 'initializing' }>
  | Readonly<{ state: 'ready'; initialization: BrowserLocalDataInitialization }>
  | Readonly<{ state: 'error'; code: string; detail: string }>;

let provider: BrowserLocalDataProvider | null = null;
let providerPromise: Promise<BrowserLocalDataProvider> | null = null;
let serviceState: BrowserLocalDataServiceState = Object.freeze({ state: 'idle' });

function boundedDetail(cause: unknown): string {
  return (cause instanceof Error ? cause.message : 'Browser-local data could not be initialized.')
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 240) || 'Browser-local data could not be initialized.';
}

export function browserLocalDataServiceState(): BrowserLocalDataServiceState {
  return serviceState;
}

export async function browserLocalDataProvider(): Promise<BrowserLocalDataProvider> {
  if (providerPromise) return providerPromise;
  serviceState = Object.freeze({ state: 'initializing' });
  providerPromise = (async () => {
    try {
      provider = new BrowserLocalDataProvider();
      const initialization = await provider.initialize(BROWSER_LOCAL_COLLECTIONS);
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
  return (await browserLocalDataProvider()).restoreLegacyCopies(BROWSER_LOCAL_COLLECTIONS);
}
