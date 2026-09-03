/**
 * Reviewed deferred interactions currently settle in well under one second.
 * Five seconds preserves generous failure headroom without changing any route
 * or interaction performance budget, while still giving every module request
 * a bounded terminal state.
 */
export const DEFERRED_MODULE_DEADLINE_MS = 5_000;

export const DEFERRED_MODULE_RECOVERY_DETAIL =
  'Reload this page to request the unavailable module again.';

export type DeferredModuleLoadFailure = 'aborted' | 'failed' | 'timed_out';

export class DeferredModuleLoadError extends Error {
  readonly code: DeferredModuleLoadFailure;

  constructor(code: DeferredModuleLoadFailure, cause?: unknown) {
    super(code === 'timed_out'
      ? 'The deferred module did not settle within five seconds.'
      : code === 'aborted'
        ? 'The deferred module load was cancelled.'
        : 'The deferred module could not be loaded.', cause === undefined ? undefined : { cause });
    this.name = 'DeferredModuleLoadError';
    this.code = code;
  }
}

export type DeferredModuleScheduler = Readonly<{
  setTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
}>;

export type DeferredModuleLoadOptions = Readonly<{
  deadlineMs?: number;
  scheduler?: DeferredModuleScheduler;
  signal?: AbortSignal;
}>;

export function isDeferredModuleLoadError(cause: unknown): cause is DeferredModuleLoadError {
  return cause instanceof DeferredModuleLoadError;
}

/**
 * Bound one dynamic import (or a small related import packet). The underlying
 * browser import cannot be cancelled, so late settlement is deliberately
 * detached after timeout or abort and must not mutate the caller's state.
 */
export function loadDeferredModule<Value>(
  load: () => Promise<Value>,
  options: DeferredModuleLoadOptions = {},
): Promise<Value> {
  const deadlineMs = options.deadlineMs ?? DEFERRED_MODULE_DEADLINE_MS;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > DEFERRED_MODULE_DEADLINE_MS) {
    throw new RangeError(`Deferred module deadlines must be whole milliseconds from 1 to ${DEFERRED_MODULE_DEADLINE_MS}.`);
  }
  const scheduler = options.scheduler ?? globalThis;

  return new Promise<Value>((resolve, reject) => {
    let settled = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (deadline !== undefined) scheduler.clearTimeout(deadline);
      options.signal?.removeEventListener('abort', abort);
      callback();
    };
    const abort = () => finish(() => reject(new DeferredModuleLoadError('aborted')));
    deadline = scheduler.setTimeout(
      () => finish(() => reject(new DeferredModuleLoadError('timed_out'))),
      deadlineMs,
    );
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) {
      abort();
      return;
    }

    let pending: Promise<Value>;
    try {
      pending = load();
    } catch (cause) {
      finish(() => reject(new DeferredModuleLoadError('failed', cause)));
      return;
    }
    void pending.then(
      (value) => finish(() => resolve(value)),
      (cause) => finish(() => reject(new DeferredModuleLoadError('failed', cause))),
    );
  });
}

export function reloadDeferredModulePage(): void {
  window.location.reload();
}
