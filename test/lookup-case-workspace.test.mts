import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { LookupCaseWorkspace } from '../frontend/src/lib/controllers/lookup-case-workspace.ts';
import type { LookupCaseActionResult, LookupCaseController } from '../frontend/src/lib/controllers/lookup-case-controller.ts';
import { createCase } from '../packages/cases/case-record-operations.mts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(settle => { resolve = settle; });
  return { promise, resolve };
}

const first = createCase({ domain: 'example.test', title: 'First incident' }, '2026-09-20T00:00:00.000Z');
const second = createCase({ domain: 'example.test', title: 'Second incident' }, '2026-09-20T01:00:00.000Z');
type ReadResult = Awaited<ReturnType<LookupCaseController['refresh']>>;
const ready: ReadResult = { record: first, records: [first, second], sourceState: 'ready', status: '' };

function harness(read: LookupCaseController['refresh'] = async () => ready) {
  let domain = 'example.test', revision = 0;
  let published = 0;
  const selected: string[] = [];
  const workspace = new LookupCaseWorkspace({
    controller: { refresh: read }, context: () => ({ domain, revision }),
    publish: () => { published++; }, select: id => selected.push(id),
  });
  return { workspace, selected, changeContext: (next: string) => { domain = next; revision++; },
    get published() { return published; } };
}

describe('Lookup Case workspace lifecycle', () => {
  test('rechecks compare only the current collection and do not publish after disposal', async () => {
    const h = harness();
    await h.workspace.refresh();
    await h.workspace.recheck(async () => ({ revision: 1, current: () => true }));
    assert.equal(h.workspace.state.comparison?.available, false);
    assert.match(h.workspace.state.comparison!.detail, /prior and current/);
    await h.workspace.recheck(async () => {
      h.workspace.select(second.id);
      return { revision: 1, current: () => true };
    });
    assert.equal(h.workspace.state.comparison, null);
    for (const result of [undefined, { revision: 2, current: () => false }]) {
      await h.workspace.recheck(async () => result);
      assert.equal(h.workspace.state.comparison, null);
    }
    const held = deferred<{ revision: number; current: () => boolean }>();
    const running = h.workspace.recheck(() => held.promise);
    h.workspace.dispose();
    held.resolve({ revision: 3, current: () => true });
    await running;
    assert.equal(h.workspace.state.comparison, null);
    await h.workspace.recheck(async () => { assert.fail('No collection after disposal'); });
  });
  test('one reset restores every draft, selection and status without sharing mutable defaults', async () => {
    const h = harness();
    const initial = structuredClone(h.workspace.state);
    await h.workspace.refresh();
    h.workspace.setNote('Unfinished note');
    h.workspace.setDisposition('malicious');
    h.workspace.setReviewReason('analyst-reviewed');
    h.workspace.setComparison({ available: false, changes: [], observedAt: '', detail: 'Comparison unavailable' });
    h.workspace.reset();
    assert.deepEqual(h.workspace.state, initial);
    assert.notEqual(h.workspace.state.candidates, initial.candidates);
    assert.deepEqual(h.selected, []);
  });

  test('only the latest read can publish and reset invalidates an unfinished read', async () => {
    const earlier = deferred<ReadResult>(), later = deferred<ReadResult>();
    let calls = 0;
    const h = harness(() => ++calls === 1 ? earlier.promise : later.promise);
    const one = h.workspace.refresh(), two = h.workspace.refresh();
    later.resolve({ ...ready, record: second });
    await two;
    earlier.resolve(ready);
    await one;
    assert.equal(h.workspace.state.record?.id, second.id);
    const held = deferred<ReadResult>();
    const reset = harness(() => held.promise);
    const reading = reset.workspace.refresh();
    reset.workspace.reset();
    held.resolve(ready);
    await reading;
    assert.equal(reset.workspace.state.record, null);
  });

  test('context changes and disposal prevent late reads and further operations', async () => {
    for (const action of ['context', 'dispose'] as const) {
      const held = deferred<ReadResult>();
      let calls = 0;
      const h = harness(() => { calls++; return held.promise; });
      const reading = h.workspace.refresh();
      if (action === 'context') h.changeContext('other.test'); else h.workspace.dispose();
      held.resolve(ready);
      await reading;
      assert.equal(h.workspace.state.record, null, action);
      if (action === 'dispose') {
        await h.workspace.refresh();
        assert.equal(calls, 1);
        assert.equal(await h.workspace.perform(async () => { throw new Error('Must not write'); }), 'stale');
      }
    }
  });

  test('selecting an incident discards only its prior draft and invalidates stale reads', async () => {
    const h = harness();
    await h.workspace.refresh();
    h.workspace.setNote('First incident draft');
    h.workspace.setReviewReason('Prior reason');
    h.workspace.select('missing');
    assert.equal(h.workspace.state.note, 'First incident draft');
    h.workspace.select(second.id);
    assert.equal(h.workspace.state.record?.id, second.id);
    assert.equal(h.workspace.state.note, '');
    assert.equal(h.workspace.state.reviewReason, second.reviewReasonCode ?? '');
    assert.deepEqual(h.selected, [second.id]);
  });

  test('unavailable context cannot write, while rejected and unknown results preserve drafts', async () => {
    const h = harness();
    assert.equal(await h.workspace.perform(async () => { throw new Error('Must not write'); }), 'rejected');
    await h.workspace.refresh();
    h.workspace.setNote('Keep this draft');
    for (const mutationOutcome of ['rejected', 'unknown'] as const) {
      const outcome = await h.workspace.perform(async () => ({ record: null, status: 'Refresh before retrying.', mutationOutcome }));
      assert.equal(outcome, mutationOutcome);
      assert.equal(h.workspace.state.note, 'Keep this draft');
      assert.equal(h.workspace.state.busy, false);
      assert.equal(h.workspace.state.status, 'Refresh before retrying.');
    }
    assert.deepEqual(h.selected, []);
  });

  test('committed writes preserve their outcome and reconciliation message', async () => {
    const h = harness();
    await h.workspace.refresh();
    const updated = { ...first, title: 'Updated incident' };
    const result = await h.workspace.perform(async () => ({ record: updated, status: 'Saved. Refresh the list; do not save again.',
      sourceState: 'unavailable', mutationOutcome: 'committed' }), next => h.workspace.synchroniseDecision(next.record));
    assert.equal(result, 'committed');
    assert.equal(h.workspace.state.record?.title, updated.title);
    assert.equal(h.workspace.state.candidates.filter(record => record.id === first.id).length, 1);
    assert.equal(h.workspace.state.sourceState, 'unavailable');
    assert.match(h.workspace.state.status, /^Saved\./u);
    assert.deepEqual(h.selected, [first.id]);
  });

  test('one write owns publication; reset, invalidation and context changes suppress stale completion', async () => {
    for (const invalidation of ['reset', 'invalidate', 'dispose', 'context'] as const) {
      const h = harness();
      await h.workspace.refresh();
      const held = deferred<LookupCaseActionResult>();
      const writing = h.workspace.perform(() => held.promise);
      assert.equal(h.workspace.state.busy, true);
      h.workspace.select(second.id);
      assert.equal(h.workspace.state.record?.id, first.id);
      assert.equal(await h.workspace.perform(async () => { throw new Error('Duplicate write'); }), 'stale');
      if (invalidation === 'context') h.changeContext('other.test'); else h.workspace[invalidation]();
      held.resolve({ record: { ...first, title: 'Stale completion' }, status: 'Saved', mutationOutcome: 'committed' });
      assert.equal(await writing, 'stale', invalidation);
      assert.notEqual(h.workspace.state.record?.title, 'Stale completion');
      assert.equal(h.workspace.state.busy, false);
      assert.deepEqual(h.selected, []);
    }
  });

  test('unexpected action failure releases the write slot without clearing a draft', async () => {
    const h = harness();
    await h.workspace.refresh();
    h.workspace.setNote('Unsaved draft');
    await assert.rejects(h.workspace.perform(async () => { throw new Error('Synthetic write failure'); }), /Synthetic write failure/u);
    assert.equal(h.workspace.state.busy, false);
    assert.equal(h.workspace.state.note, 'Unsaved draft');
    h.workspace.setDisposition('unreviewed');
    assert.equal(h.workspace.state.reviewReason, '');
  });
});
