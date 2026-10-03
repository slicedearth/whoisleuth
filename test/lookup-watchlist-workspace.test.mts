import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LookupWatchlistWorkspace } from '../frontend/src/lib/controllers/lookup-watchlist-workspace.ts';
import { appendWatchlistScan } from '../packages/workspace/watchlist-history.mts';

type Options = ConstructorParameters<typeof LookupWatchlistWorkspace>[0];
type Saved = Awaited<ReturnType<Options['save']>>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
function harness(overrides: Partial<Pick<Options, 'load' | 'save'>> = {}) {
  let context = {
    target: 'portal.example.test',
    revision: 1,
    evidence: { availability: 'registered' },
    depth: 'deep' as const,
  };
  let publications = 0;
  const writes: unknown[] = [];
  const workspace = new LookupWatchlistWorkspace({
    context: () => context,
    publish: () => {
      publications++;
    },
    load: overrides.load ?? (async () => ({})),
    save:
      overrides.save ??
      (async (...args) => {
        writes.push(args);
        return { created: true, name: args[0], changes: [] };
      }),
  });
  return {
    workspace,
    writes,
    get publications() {
      return publications;
    },
    change(target = 'other.test') {
      context = { ...context, target, revision: context.revision + 1 };
    },
  };
}

test('watchlist context keeps exact-host membership and retains a deliberate name on refresh', async () => {
  const entry = appendWatchlistScan(null, [{ domain: 'portal.example.test', scanDepth: 'deep' }], {
    checkedAt: '2026-09-20T00:00:00.000Z',
    mode: 'deep',
  }).entry;
  const h = harness({ load: async () => ({ Existing: entry }) });
  await h.workspace.refresh();
  assert.deepEqual(h.workspace.state.names, ['Existing']);
  assert.equal(h.workspace.state.name, 'Existing');
  h.workspace.setName('Separate review');
  await h.workspace.refresh();
  assert.equal(h.workspace.state.name, 'Separate review');
  h.workspace.reset(true);
  assert.equal(h.workspace.state.name, 'Separate review');
  assert.deepEqual(h.workspace.state.names, []);
  h.workspace.reset();
  assert.equal(h.workspace.state.name, '');
});

test('only the newest read can publish; reset, context change and disposal invalidate old reads', async () => {
  for (const action of ['newer', 'reset', 'context', 'dispose'] as const) {
    const held = deferred<Awaited<ReturnType<Options['load']>>>();
    let calls = 0;
    const h = harness({ load: () => (++calls === 1 ? held.promise : Promise.resolve({})) });
    const reading = h.workspace.refresh();
    if (action === 'newer') await h.workspace.refresh();
    else if (action === 'context') h.change();
    else h.workspace[action]();
    const publications = h.publications;
    held.resolve({});
    await reading;
    assert.equal(h.publications, publications, action);
  }
});

test('save admission uses the selected target and captured depth, and rejects duplicate writes', async () => {
  const held = deferred<Saved>();
  const writes: unknown[] = [];
  const h = harness({
    save: (...args) => {
      writes.push(args);
      return held.promise;
    },
  });
  await h.workspace.refresh();
  h.workspace.setName('Reviewed target');
  const saving = h.workspace.save();
  await h.workspace.save();
  assert.deepEqual(writes, [
    [
      'Reviewed target',
      {
        domain: 'portal.example.test',
        scanDepth: 'deep',
        registrarName: undefined,
        availability: 'registered',
      },
      'deep',
    ],
  ]);
  assert.equal(h.workspace.state.busy, true);
  held.resolve({ created: true, name: 'Reviewed target', changes: [] });
  await saving;
  assert.equal(h.workspace.state.busy, false);
  assert.equal(
    h.workspace.state.status,
    'Created the watchlist “Reviewed target” with this deep observation.',
  );
});

test('a committed write remains reported as saved when refreshing its list fails', async () => {
  const h = harness({
    load: async () => {
      throw new Error('Read unavailable');
    },
  });
  h.workspace.setName('Reviewed target');
  await h.workspace.save();
  assert.equal(h.writes.length, 1);
  assert.equal(h.workspace.state.sourceState, 'unavailable');
  assert.equal(
    h.workspace.state.status,
    'Created the watchlist “Reviewed target” with this deep observation.',
  );
  assert.equal(h.workspace.state.busy, false);
});

test('late writes cannot publish into a reset, changed or disposed observation', async () => {
  for (const action of ['reset', 'context', 'dispose'] as const) {
    const held = deferred<Saved>();
    const h = harness({ save: () => held.promise });
    h.workspace.setName('Original');
    const saving = h.workspace.save();
    if (action === 'context') {
      h.change();
      h.workspace.reset();
    } else h.workspace[action]();
    held.resolve({ created: true, name: 'Old completion', changes: [] });
    await saving;
    assert.notEqual(h.workspace.state.name, 'Old completion', action);
    assert.equal(h.workspace.state.status, '', action);
  }
});

test('write failure preserves the draft and permits a deliberate retry', async () => {
  let calls = 0;
  const h = harness({
    save: async (name) => {
      if (++calls === 1) throw new Error('Storage is unavailable.');
      return { name, created: false, changes: [] };
    },
  });
  h.workspace.setName('Keep this name');
  await h.workspace.save();
  assert.equal(h.workspace.state.name, 'Keep this name');
  assert.equal(h.workspace.state.status, 'Storage is unavailable.');
  assert.equal(h.workspace.state.busy, false);
  await h.workspace.save();
  assert.equal(calls, 2);
  assert.equal(
    h.workspace.state.status,
    'Updated “Keep this name”; no comparable material change was observed.',
  );
});

test('invalid targets, stale read requests and disposed workspaces do not start storage operations', async () => {
  let reads = 0;
  const h = harness({
    load: async () => {
      reads++;
      return {};
    },
  });
  await h.workspace.refresh(0);
  h.change('https://example.test/private');
  await h.workspace.save();
  assert.equal(h.writes.length, 0);
  assert.match(h.workspace.state.status, /cannot be saved/u);
  h.workspace.dispose();
  const publications = h.publications;
  await h.workspace.refresh();
  await h.workspace.save();
  h.workspace.setName('Do not publish');
  assert.equal(reads, 0);
  assert.equal(h.publications, publications);
});
