import { loadDeferredModule } from './deferred-module.js';

type IdleWindow = Window & typeof globalThis & {
  requestIdleCallback?: (callback: IdleRequestCallback) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export type IdlePreloadScheduler = Readonly<{
  requestIdleCallback?: (callback: IdleRequestCallback) => number;
  cancelIdleCallback?: (handle: number) => void;
}>;

/** Run a bounded optional preload without exposing a rejected chunk request to the page. */
export function preloadBestEffort(load: () => Promise<unknown>, signal?: AbortSignal): void {
  void loadDeferredModule(load, signal ? { signal } : {}).catch(() => undefined);
}

export function scheduleIdlePreload(
  scheduler: IdlePreloadScheduler,
  load: () => void,
): () => void {
  if (!scheduler.requestIdleCallback || !scheduler.cancelIdleCallback) return () => undefined;
  const handle = scheduler.requestIdleCallback(load);
  return () => scheduler.cancelIdleCallback?.(handle);
}

/** Schedule inexpensive next-step code after the current page is responsive. */
export function preloadOnIdle(load: () => void): () => void {
  return scheduleIdlePreload(window as IdleWindow, load);
}
