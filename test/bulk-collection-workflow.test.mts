import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BulkCollectionWorkflow,
  type BulkCollectionContext,
  type BulkCollectionEffects,
} from '../frontend/src/lib/controllers/bulk-collection-workflow.ts';
import { BulkScanController } from '../frontend/src/lib/controllers/bulk-scan-controller.ts';
import { bulkQueryLimit } from '../frontend/src/lib/analysis/bulk-limits.ts';
import type { CompactLookupHttpResponse } from '../frontend/src/lib/analysis/lookup-response.ts';

function response(domain: string): CompactLookupHttpResponse {
  return {
    query: domain,
    type: 'domain',
    inputHostname: domain,
    registrableDomain: domain,
    isSubdomain: false,
    availability: { applicable: true, domain, state: 'registered', confidence: 'high' },
    diagnostics: {
      version: 7,
      rdap: { status: 'success' },
      whois: { status: 'skipped' },
      availability: { status: 'complete' },
    },
  };
}
function harness(overrides: Partial<BulkCollectionEffects> = {}) {
  let context: BulkCollectionContext = {
    mode: 'fast',
    pacing: 'gentle',
    profile: null,
    profileSourceState: 'ready',
  };
  let admitted = true;
  const effects: string[] = [];
  const statuses: string[] = [];
  const workspace = {
    state: { busy: false },
    beginScan(replace: boolean) {
      effects.push(`begin:${replace}`);
      return admitted;
    },
  };
  const scan = new BulkScanController(() => {});
  const workflow = new BulkCollectionWorkflow(scan, workspace, {
    context: () => context,
    active: () => true,
    prepareView: () => {
      effects.push('view');
    },
    status: (message) => {
      statuses.push(message);
    },
    provenance: () => undefined,
    fetchLookup: async (domain, mode) => {
      effects.push(`fetch:${domain}:${mode}`);
      return response(domain);
    },
    ...overrides,
  });
  return {
    scan,
    workflow,
    workspace,
    effects,
    statuses,
    context(value: Partial<BulkCollectionContext>) {
      context = { ...context, ...value };
    },
    admit(value: boolean) {
      admitted = value;
    },
  };
}

test('Bulk admission prevents collection during storage/profile work and outside domain limits', async () => {
  for (const blocked of ['storage', 'profile', 'empty', 'limit', 'admission'] as const) {
    const h = harness();
    if (blocked === 'storage') h.workspace.state.busy = true;
    if (blocked === 'profile') h.context({ profileSourceState: 'loading' });
    if (blocked === 'admission') h.admit(false);
    const domains =
      blocked === 'empty'
        ? []
        : blocked === 'limit'
          ? Array.from({ length: bulkQueryLimit('fast') + 1 }, (_, i) => `${i}.example.test`)
          : ['example.test'];
    assert.equal(await h.workflow.run(domains), null);
    assert.deepEqual(h.effects, blocked === 'admission' ? ['begin:true'] : []);
    assert.equal(h.scan.state.running, false);
    h.scan.dispose();
  }
});

test('Bulk uses the submitted collection depth and unavailable profile throughout a run', async () => {
  const h = harness({
    fetchLookup: async (domain, mode) => {
      assert.equal(mode, 'deep');
      h.context({ mode: 'fast', profileSourceState: 'ready' });
      return response(domain);
    },
  });
  h.context({ mode: 'deep', profileSourceState: 'unavailable' });
  assert.deepEqual(await h.workflow.run(['one.example.test', 'two.example.test']), []);
  assert.equal(h.scan.results.length, 2);
  assert.ok(
    h.scan.results.every(
      (row) =>
        row.saved.scanDepth === 'deep' && row.saved.profileContext.sourceState === 'unavailable',
    ),
  );
  assert.match(h.statuses.at(-1)!, /Completed 2 of 2.*inconclusive/);
  assert.deepEqual(h.effects, ['begin:true', 'view']);
  h.scan.dispose();
});

test('Bulk rejects a concurrent run and cannot announce completion after cancellation or disposal', async () => {
  for (const stop of ['cancel', 'dispose'] as const) {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = harness({
      fetchLookup: async (domain) => {
        await held;
        return response(domain);
      },
    });
    const pending = h.workflow.run(['example.test']);
    assert.equal(await h.workflow.run(['other.test']), null);
    h.scan[stop]();
    release();
    assert.equal(await pending, null);
    assert.ok(h.statuses.every((message) => !message.startsWith('Completed')));
    h.scan.dispose();
  }
});

test('Bulk retry retains stronger prior observations and reports the preservation', async () => {
  let fail = false;
  const h = harness({
    fetchLookup: async (domain) => {
      if (fail) throw new Error('Unavailable');
      return response(domain);
    },
  });
  await h.workflow.run(['example.test']);
  const original = h.scan.results[0];
  fail = true;
  const retained = await h.workflow.run(['example.test'], false, true);
  assert.equal(retained?.length, 1);
  assert.equal(h.scan.results[0]?.availability, original?.availability);
  assert.match(h.statuses.at(-1)!, /Retained 1 stronger prior result/);
  assert.ok(h.effects.includes('begin:false'));
  h.scan.dispose();
});

test('Bulk projection failure reports stopped work without exposing internal errors', async () => {
  const h = harness({
    provenance: () => {
      throw new Error('private detail');
    },
  });
  assert.equal(await h.workflow.run(['example.test']), null);
  assert.match(h.statuses.at(-1)!, /stopped unexpectedly.*Completed results remain available/);
  assert.doesNotMatch(h.statuses.join('\n'), /private detail/);
  assert.equal(h.scan.state.running, false);
  h.scan.dispose();
});
