import assert from 'node:assert/strict';
import test from 'node:test';

import {
  preloadBestEffort,
  scheduleIdlePreload,
} from '../frontend/src/lib/idle-preload.ts';

test('idle preload uses the native scheduler and cancels its exact handle', () => {
  let scheduled: IdleRequestCallback | undefined;
  let cancelled = 0;
  let loaded = false;
  const cancel = scheduleIdlePreload({
    requestIdleCallback(callback) {
      scheduled = callback;
      return 17;
    },
    cancelIdleCallback(handle) {
      cancelled = handle;
    },
  }, () => {
    loaded = true;
  });

  assert.equal(loaded, false);
  scheduled?.({ didTimeout: false, timeRemaining: () => 50 });
  assert.equal(loaded, true);
  cancel();
  assert.equal(cancelled, 17);
});

test('idle preload does not become immediate work when idle callbacks are unavailable', () => {
  let loaded = false;
  const cancel = scheduleIdlePreload({}, () => {
    loaded = true;
  });
  cancel();
  assert.equal(loaded, false);
});

test('best-effort preloads contain rejected chunk requests', async () => {
  let invoked = false;
  preloadBestEffort(async () => {
    invoked = true;
    throw new Error('synthetic chunk failure');
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(invoked, true);
});
