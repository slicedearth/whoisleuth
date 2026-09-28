import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LookupPageLifecycle } from '../frontend/src/lib/controllers/lookup-page-lifecycle.ts';
import {
  LookupSession,
  createLookupSessionState,
} from '../frontend/src/lib/controllers/lookup-session.ts';

function harness(retained = true) {
  const events: string[] = [];
  const state = createLookupSessionState();
  const session = new LookupSession(state, { invalidateRequest() {}, resetSavedContext() {} });
  const saved = {
    ...session.snapshot(),
    query: 'example.test',
    completedTarget: 'example.test',
    completedLookupDepth: 'deep' as const,
    result: retained
      ? {
          query: 'example.test',
          type: 'domain' as const,
          rdap: {},
          whois: {},
          diagnostics: {},
          availability: {},
        }
      : null,
  };
  let frame: FrameRequestCallback | undefined;
  let releaseProfile!: () => void;
  let rejectProfile!: (error: Error) => void;
  const profile = new Promise<void>((resolve, reject) => {
    releaseProfile = resolve;
    rejectProfile = reject;
  });
  const browser = {
    addEventListener: () => events.push('listen'),
    removeEventListener: () => events.push('unlisten'),
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      frame = callback;
      return 17;
    },
    cancelAnimationFrame: (id: number) => {
      assert.equal(id, 17);
      events.push('cancel-frame');
    },
  } as Pick<
    Window,
    'addEventListener' | 'removeEventListener' | 'requestAnimationFrame' | 'cancelAnimationFrame'
  >;
  const options: ConstructorParameters<typeof LookupPageLifecycle>[0] = {
    session,
    restore: () => {
      events.push('restore');
      return { saved, task: 'owned' };
    },
    retain: (snapshot) => {
      events.push('retain');
      assert.equal(snapshot.query, state.request.query);
    },
    request: { revision: 4, dispose: () => events.push('request-dispose') },
    savedWorkspaces: [
      { dispose: () => events.push('case-dispose') },
      { dispose: () => events.push('watchlist-dispose') },
    ],
    createAnchor: () => ({
      begin: () => false,
      align: () => false,
      contentReady() {},
      stop() {},
      captureRevealIntent: () => ({ current: () => true, dispose() {} }),
      destroy: () => events.push('anchor-destroy'),
    }),
    refreshProfile: () => {
      events.push('profile');
      return profile;
    },
    refreshSaved: async (revision) => {
      assert.equal(state.urlReady, true);
      events.push(`saved-${revision}`);
    },
    navigateHash: () => events.push('hash'),
  };
  return {
    events,
    state,
    options,
    browser,
    releaseProfile,
    rejectProfile,
    runFrame: () => frame?.(0),
  };
}

test('page restoration precedes refresh and cleanup happens once before retention', async () => {
  const h = harness();
  const lifecycle = new LookupPageLifecycle(h.options);
  const dispose = lifecycle.mount(new URL('https://console.test/lookup#registry'), h.browser);
  assert.deepEqual(h.events, ['restore', 'listen', 'profile']);
  assert.equal(lifecycle.active, true);
  assert.equal(h.state.task, 'owned');
  h.runFrame();
  h.releaseProfile();
  await lifecycle.ready;
  assert.deepEqual(h.events.slice(3), ['hash', 'saved-4']);
  dispose();
  dispose();
  assert.deepEqual(h.events.slice(5), [
    'unlisten',
    'request-dispose',
    'case-dispose',
    'watchlist-dispose',
    'anchor-destroy',
    'retain',
  ]);
  assert.equal(lifecycle.anchor, null);
  assert.equal(lifecycle.active, false);
  assert.throws(
    () => lifecycle.mount(new URL('https://console.test/lookup'), h.browser),
    /already started/,
  );
});

test('disposal cancels scheduled navigation and suppresses late context refresh', async () => {
  const h = harness();
  const lifecycle = new LookupPageLifecycle(h.options);
  lifecycle.mount(new URL('https://console.test/lookup'), h.browser)();
  h.runFrame();
  h.releaseProfile();
  await lifecycle.ready;
  assert.ok(h.events.includes('cancel-frame'));
  assert.ok(!h.events.includes('hash'));
  assert.ok(!h.events.includes('saved-4'));
});

test('empty sessions do not refresh saved evidence and asynchronous failures remain bounded', async () => {
  const empty = harness(false);
  const emptyLifetime = new LookupPageLifecycle(empty.options);
  const dispose = emptyLifetime.mount(new URL('https://console.test/lookup'), empty.browser);
  empty.releaseProfile();
  await emptyLifetime.ready;
  assert.deepEqual(empty.events, ['restore', 'listen', 'profile']);
  dispose();
  for (const afterDisposal of [false, true]) {
    const h = harness();
    const lifecycle = new LookupPageLifecycle(h.options);
    const cleanup = lifecycle.mount(new URL('https://console.test/lookup'), h.browser);
    if (afterDisposal) cleanup();
    h.rejectProfile(new Error('fixture internal detail'));
    await lifecycle.ready;
    assert.equal(
      h.state.error,
      afterDisposal
        ? ''
        : 'Saved investigation context could not be refreshed. Saved records were not changed.',
    );
    assert.ok(!h.state.error.includes('fixture internal detail'));
    cleanup();
  }
});

test('failed restoration releases acquired resources without overwriting the retained session', () => {
  const h = harness();
  const lifecycle = new LookupPageLifecycle({
    ...h.options,
    restore: () => {
      throw Error('fixture restore failure');
    },
  });
  assert.throws(
    () => lifecycle.mount(new URL('https://console.test/lookup'), h.browser),
    /fixture restore failure/,
  );
  assert.equal(lifecycle.active, false);
  assert.equal(lifecycle.anchor, null);
  assert.deepEqual(h.events, [
    'unlisten',
    'request-dispose',
    'case-dispose',
    'watchlist-dispose',
    'anchor-destroy',
  ]);
});
