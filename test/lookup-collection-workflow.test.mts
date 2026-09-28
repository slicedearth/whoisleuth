import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LookupCollectionWorkflow,
  type LookupCollectionContext,
  type LookupCollectionEffects,
} from '../frontend/src/lib/controllers/lookup-collection-workflow.ts';
import {
  LookupRequestController,
  type LookupRequest,
} from '../frontend/src/lib/controllers/lookup-request-controller.ts';
import {
  createLookupSessionState,
  LookupSession,
} from '../frontend/src/lib/controllers/lookup-session.ts';
import type { LookupHttpResponse } from '../lib/lookup-response-contract.mts';
import type { Candidate } from '../frontend/src/lib/candidate-handoff.ts';

const response: LookupHttpResponse = {
  query: 'example.test',
  type: 'domain',
  rdap: {},
  whois: {},
  availability: {},
  diagnostics: {},
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function harness(request?: LookupRequest, overrides: Partial<LookupCollectionEffects> = {}) {
  const state = createLookupSessionState();
  state.request.query = 'example.test';
  const seen: string[] = [];
  const calls: Array<{ url: string; selectedUrl?: string }> = [];
  const handoffs: Candidate[][] = [];
  const requests = new LookupRequestController({
    request: async (url, options) => {
      calls.push({ url, ...(options.selectedUrl ? { selectedUrl: options.selectedUrl } : {}) });
      seen.push('request');
      return request ? request(url, options) : { ok: true, value: response };
    },
  });
  const session = new LookupSession(state, {
    invalidateRequest: () => requests.invalidate(),
    resetSavedContext: (preserve) => seen.push(`reset:${preserve}`),
  });
  let context: LookupCollectionContext = {
    disabled: null,
    tooLarge: false,
    entries: ['example.test'],
    preferredCase: { id: 'case-original', domain: 'example.test' },
    capabilities: {
      externalIntelligenceSupported: false,
      malwareHostIntelligenceSupported: false,
      malwareIocIntelligenceSupported: false,
      securityTxtSupported: true,
      securityTxtEligible: true,
    },
  };
  const effects: LookupCollectionEffects = {
    context: () => context,
    active: () => true,
    saveHandoff: (_source, candidates) => {
      handoffs.push(candidates);
      return { saved: true, token: '<fixture-handoff>', generatedContextTruncated: false };
    },
    navigate: async (href) => {
      seen.push(href);
    },
    stopReveal: () => {
      seen.push('stop');
    },
    captureReveal: () => ({
      current: () => true,
      dispose: () => {
        seen.push('dispose');
      },
    }),
    refreshProfile: async () => {
      seen.push('profile');
    },
    refreshCase: async (_revision, preferred) => {
      seen.push(`case:${preferred?.id}`);
    },
    refreshWatchlist: async () => {
      seen.push('watchlist');
    },
    retainCase: async () => {
      seen.push('retain');
    },
    rendered: async () => {
      seen.push('render');
    },
    reveal: (refresh) => {
      seen.push(`reveal:${refresh}`);
    },
    ...overrides,
  };
  return {
    state,
    session,
    requests,
    seen,
    calls,
    handoffs,
    effects,
    workflow: new LookupCollectionWorkflow(session, requests, effects),
    context: (patch: Partial<LookupCollectionContext>) => {
      context = { ...context, ...patch };
    },
  };
}

test('collection admission preserves existing evidence and starts no effects for invalid or blocked input', async (t) => {
  for (const condition of [
    'disabled',
    'oversized',
    'empty',
    'busy',
    'incident',
    'selected-fast',
    'selected-disabled',
  ] as const) {
    const h = harness();
    t.after(() => h.requests.dispose());
    h.state.observation.response = response;
    if (condition === 'disabled') h.context({ disabled: { reason: 'Disabled by policy.' } });
    if (condition === 'oversized') h.context({ tooLarge: true });
    if (condition === 'empty') h.context({ entries: [] });
    if (condition === 'busy') h.state.loading = true;
    if (condition === 'incident') {
      h.state.task = 'incident';
      h.context({ entries: ['https://user:password@example.test/'] });
    }
    if (condition.startsWith('selected-')) {
      h.state.collectSelectedUrl = true;
      h.state.request.lookupMode = condition === 'selected-fast' ? 'fast' : 'deep';
      h.context({ entries: ['https://example.test/path'] });
      if (condition === 'selected-disabled')
        h.context({
          capabilities: {
            ...h.effects.context().capabilities,
            securityTxtSupported: false,
          },
        });
    }
    assert.equal(await h.workflow.run(), undefined, condition);
    assert.deepEqual(h.calls, [], condition);
    assert.deepEqual(h.handoffs, [], condition);
    assert.deepEqual(h.seen, [], condition);
    assert.equal(h.state.observation.response, response, condition);
    if (!['empty', 'busy'].includes(condition)) assert.ok(h.state.error, condition);
  }
});

test('multiple targets use the existing handoff without collection and failed retention prevents navigation', async (t) => {
  for (const saved of [true, false]) {
    const h = harness(
      undefined,
      saved ? {} : { saveHandoff: () => ({ saved: false, reason: 'storage_unavailable' }) },
    );
    t.after(() => h.requests.dispose());
    h.context({ entries: ['One.example.test', 'two.example.test'] });
    await h.workflow.run();
    assert.deepEqual(h.calls, []);
    if (saved) {
      assert.deepEqual(
        h.handoffs[0]?.map((candidate) => candidate.domain),
        ['one.example.test', 'two.example.test'],
      );
      assert.deepEqual(h.seen, ['reset:false', '/bulk?source=manual&handoff=<fixture-handoff>']);
    } else {
      assert.match(h.state.error, /could not retain/);
      assert.deepEqual(h.seen, ['reset:false']);
    }
  }
});

test('a submitted investigation owns target, Case preference and completion order across profile refresh', async (t) => {
  const h = harness();
  t.after(() => h.requests.dispose());
  h.state.task = 'incident';
  h.state.collectSelectedUrl = true;
  h.state.request.lookupMode = 'deep';
  h.context({ entries: ['https://login.example.test/path'] });
  const preferred = h.effects.context().preferredCase;
  // The injected context may change while preparation runs; the submitted Case is retained.
  const workflow = new LookupCollectionWorkflow(h.session, h.requests, {
    ...h.effects,
    refreshProfile: async () => {
      h.seen.push('profile');
      h.context({ preferredCase: { id: 'case-later', domain: 'example.test' } });
    },
  });
  const operation = await workflow.run({ refreshCaseEvidence: true });
  assert.ok(operation?.current());
  assert.equal(preferred?.id, 'case-original');
  assert.deepEqual(h.calls, [
    { url: '/api/lookup?q=login.example.test', selectedUrl: 'https://login.example.test/path' },
  ]);
  assert.equal(h.state.observation.target, 'login.example.test');
  assert.equal(h.state.observation.incidentUrl, 'https://login.example.test/path');
  assert.equal(h.state.observation.depth, 'deep');
  assert.deepEqual(h.seen, [
    'stop',
    'reset:true',
    'profile',
    'request',
    'case:case-original',
    'watchlist',
    'retain',
    'render',
    'reveal:true',
    'dispose',
  ]);
  assert.equal(h.state.loading, false);
  assert.equal(h.state.sourceProgress, null);
});

test('input invalidation while collecting or reconciling prevents later retention and reveal', async (t) => {
  for (const phase of ['collection', 'reconciliation'] as const) {
    const held = deferred<void>(),
      entered = deferred<void>();
    const h = harness(
      phase === 'collection'
        ? async () => {
            entered.resolve();
            await held.promise;
            return { ok: true, value: response };
          }
        : undefined,
      phase === 'reconciliation'
        ? {
            refreshCase: async () => {
              entered.resolve();
              await held.promise;
            },
          }
        : {},
    );
    t.after(() => h.requests.dispose());
    const pending = h.workflow.run({ refreshCaseEvidence: true });
    await entered.promise;
    h.session.changeQuery('other.test');
    h.context({ entries: ['other.test'] });
    held.resolve();
    assert.equal(await pending, undefined);
    assert.equal(h.state.observation.response, null);
    assert.equal(h.state.loading, false);
    assert.equal(h.seen.includes('retain'), false);
    assert.equal(
      h.seen.some((step) => step.startsWith('reveal:')),
      false,
    );
    assert.equal(h.seen.at(-1), 'dispose');
  }
});

test('preparation and collection failures leave a retryable idle state without leaking unexpected details', async (t) => {
  for (const phase of ['prepare', 'request', 'outcome'] as const) {
    const fail = async (): Promise<never> => {
      throw new Error('private implementation detail');
    };
    const h = harness(
      phase === 'request'
        ? fail
        : phase === 'outcome'
          ? async () => ({ ok: false, kind: 'network', message: 'Lookup unavailable.' })
          : undefined,
      phase === 'prepare' ? { refreshProfile: fail } : {},
    );
    t.after(() => h.requests.dispose());
    await h.workflow.run();
    assert.equal(h.state.observation.response, null);
    assert.equal(h.state.loading, false);
    assert.equal(
      h.state.error,
      phase === 'outcome' ? 'Lookup unavailable.' : 'Lookup request could not be prepared.',
    );
    assert.equal(h.seen.at(-1), 'dispose');
    assert.equal(h.seen.includes('retain'), false);
  }
});

test('cancelled reveal intent retains the observation without automatically saving or moving focus', async (t) => {
  const h = harness(undefined, { captureReveal: () => ({ current: () => false, dispose() {} }) });
  t.after(() => h.requests.dispose());
  assert.ok(await h.workflow.run({ refreshCaseEvidence: true }));
  assert.equal(h.state.observation.response, response);
  assert.equal(h.seen.includes('render'), true);
  assert.equal(h.seen.includes('retain'), false);
  assert.equal(
    h.seen.some((step) => step.startsWith('reveal:')),
    false,
  );
});
