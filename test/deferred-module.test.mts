import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DEFERRED_MODULE_DEADLINE_MS,
  DeferredModuleLoadError,
  isDeferredModuleLoadError,
  loadDeferredModule,
  type DeferredModuleScheduler,
} from '../frontend/src/lib/deferred-module.ts';

function controlledScheduler() {
  let nextHandle = 0;
  const callbacks = new Map<number, () => void>();
  const cleared: number[] = [];
  const scheduler: DeferredModuleScheduler = {
    setTimeout(callback: () => void) {
      nextHandle += 1;
      callbacks.set(nextHandle, callback as () => void);
      return nextHandle as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout(handle) {
      const numeric = handle as unknown as number;
      cleared.push(numeric);
      callbacks.delete(numeric);
    },
  };
  return {
    scheduler,
    cleared,
    expire(handle = 1) {
      const callback = callbacks.get(handle);
      callbacks.delete(handle);
      callback?.();
    },
  };
}

describe('bounded deferred module loading', () => {
  test('resolves a healthy module and clears its deadline', async () => {
    const clock = controlledScheduler();
    const module = await loadDeferredModule(async () => ({ value: 7 }), { scheduler: clock.scheduler });
    assert.deepEqual(module, { value: 7 });
    assert.deepEqual(clock.cleared, [1]);
  });

  test('times out a pending module and ignores its late resolution', async () => {
    const clock = controlledScheduler();
    let resolveModule = (_value: string) => {};
    const pending = new Promise<string>((resolve) => { resolveModule = resolve; });
    const result = loadDeferredModule(() => pending, { scheduler: clock.scheduler });
    clock.expire();
    await assert.rejects(result, (cause) => (
      isDeferredModuleLoadError(cause) && cause.code === 'timed_out'
    ));
    resolveModule('late module');
    await Promise.resolve();
    await assert.rejects(result, (cause) => cause instanceof DeferredModuleLoadError && cause.code === 'timed_out');
  });

  test('aborts on destruction and detaches the underlying import', async () => {
    const clock = controlledScheduler();
    const controller = new AbortController();
    const result = loadDeferredModule(() => new Promise<string>(() => {}), {
      scheduler: clock.scheduler,
      signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(result, (cause) => (
      cause instanceof DeferredModuleLoadError && cause.code === 'aborted'
    ));
    assert.deepEqual(clock.cleared, [1]);
  });

  test('normalises rejected and synchronous module failures', async () => {
    const rejected = loadDeferredModule(
      async () => { throw new Error('private failure detail'); },
      { deadlineMs: 1 },
    );
    await assert.rejects(rejected, (cause) => (
      cause instanceof DeferredModuleLoadError
      && cause.code === 'failed'
      && cause.message === 'The deferred module could not be loaded.'
    ));
    await assert.rejects(
      loadDeferredModule(() => { throw new Error('synchronous failure'); }),
      (cause) => cause instanceof DeferredModuleLoadError && cause.code === 'failed',
    );
  });

  test('rejects invalid or widened deadlines', () => {
    for (const deadlineMs of [0, 1.5, DEFERRED_MODULE_DEADLINE_MS + 1]) {
      assert.throws(
        () => loadDeferredModule(async () => true, { deadlineMs }),
        /Deferred module deadlines must be whole milliseconds/u,
      );
    }
  });
});
