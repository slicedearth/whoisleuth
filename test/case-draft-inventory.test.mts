import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCaseDraftInventory, type CaseDraftInventoryState } from '../frontend/src/lib/controllers/case-draft-inventory.ts';
import { hasUnprotectedCaseDrafts, setCaseDraftUnprotected, subscribeCaseDraftState, unconfirmedCaseDrafts } from '../frontend/src/lib/controllers/case-draft-state.ts';
import { createCaseDraftRecovery } from '../frontend/src/lib/controllers/case-draft-recovery.ts';
import { BrowserLocalDataError } from '../frontend/src/lib/browser-local-data.ts';
import { emptyCaseDraftStore, normalizeCaseDraftStore } from '../packages/cases/case-drafts.mts';
import type { CaseDraftRecord } from '../packages/contracts/case-drafts.mts';

const draft = (overrides: Partial<CaseDraftRecord> = {}): CaseDraftRecord => ({
  id: 'draft-one', revision: 'revision-one', caseId: 'case-one', form: 'evidence-pin', formVersion: 1,
  updatedAt: '2026-09-12T00:00:00.000Z', fields: { label: 'Unsubmitted reasoning', value: '', reviewed: false }, ...overrides,
});
const snapshot = (records: CaseDraftRecord[] = [draft()]) => ({
  case_drafts: normalizeCaseDraftStore({ ...emptyCaseDraftStore(), records }),
  cases: [{ id: 'case-one', domain: 'draft.example', title: 'Draft review' }],
});
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('draft inventory waits for an explicit read and projects all copies without modifying them', async () => {
  const input = snapshot([
    draft({ id: 'draft-b', caseId: 'case-unavailable', form: 'retired-form', formVersion: 2 }),
    draft({ id: 'draft-a' }),
    draft({ id: 'draft-newest', updatedAt: '2026-09-13T00:00:00.000Z', caseId: 'case-two' }),
  ]);
  input.cases.push({ id: 'case-two', domain: 'untitled.example', title: '' });
  const original = structuredClone(input), states: CaseDraftInventoryState[] = [];
  let reads = 0;
  const inventory = createCaseDraftInventory(async () => { reads++; return input; }, next => states.push(next));
  try {
    inventory.refreshIfRequested();
    assert.equal(reads, 0); assert.equal(states.length, 0);
    await inventory.refresh();
    assert.equal(reads, 1);
    assert.deepEqual(states.map(state => state.state), ['loading', 'ready']);
    assert.deepEqual(states.at(-1)?.entries.map(entry => [entry.draft.id, entry.caseLabel]), [
      ['draft-newest', 'untitled.example'], ['draft-a', 'Draft review'], ['draft-b', null],
    ]);
    assert.equal(states.at(-1)?.entries[2]?.draft.formVersion, 2);
    assert.deepEqual(input, original, 'inspection cannot change values, order, revisions or unsupported form versions');
    inventory.refreshIfRequested(); await Promise.resolve();
    assert.equal(reads, 2);
  } finally { inventory.dispose(); }
});

test('draft inventory distinguishes unavailable reads from empty storage and drops stale displayed values', async () => {
  const states: CaseDraftInventoryState[] = [];
  let fail = false, empty = false;
  const inventory = createCaseDraftInventory(async () => {
    if (fail) throw new Error('Private storage detail');
    return snapshot(empty ? [] : [draft()]);
  }, next => states.push(next));
  try {
    await inventory.refresh(); assert.equal(states.at(-1)?.entries.length, 1);
    fail = true; await inventory.refresh();
    assert.deepEqual(states.slice(-2), [{ state: 'loading', entries: [] }, { state: 'unavailable', entries: [] }]);
    assert.doesNotMatch(JSON.stringify(states), /Private storage detail/u);
    fail = false; empty = true; await inventory.refresh();
    assert.deepEqual(states.at(-1), { state: 'ready', entries: [] });
  } finally { inventory.dispose(); }
});

for (const outcome of ['success', 'failure'] as const) test(`a late ${outcome} cannot replace a newer draft inventory read`, async () => {
  const old = deferred<ReturnType<typeof snapshot>>(), current = deferred<ReturnType<typeof snapshot>>();
  const states: CaseDraftInventoryState[] = [];
  let reads = 0;
  const inventory = createCaseDraftInventory(() => ++reads === 1 ? old.promise : current.promise, next => states.push(next));
  try {
    const first = inventory.refresh(), second = inventory.refresh();
    current.resolve(snapshot([draft({ id: 'current-draft' })])); await second;
    const accepted = structuredClone(states);
    if (outcome === 'success') old.resolve(snapshot([draft({ id: 'stale-draft' })]));
    else old.reject(new Error('Old read failed'));
    await first;
    assert.deepEqual(states, accepted); assert.equal(states.at(-1)?.entries[0]?.draft.id, 'current-draft');
  } finally { inventory.dispose(); }
});

test('closing a draft inventory suppresses pending reads and later notifications', async () => {
  const held = deferred<ReturnType<typeof snapshot>>(), states: CaseDraftInventoryState[] = [];
  let reads = 0;
  const inventory = createCaseDraftInventory(() => { reads++; return held.promise; }, next => states.push(next));
  const pending = inventory.refresh(); inventory.dispose();
  held.resolve(snapshot()); await pending;
  await inventory.refresh(); inventory.refreshIfRequested();
  assert.equal(reads, 1); assert.deepEqual(states, [{ state: 'loading', entries: [] }]);
});

test('unconfirmed draft notices keep independent owners and copy metadata without form values', () => {
  const first = {}, second = {}, transient = {};
  const context = { caseId: 'case-one', form: 'decision', get fields() { return assert.fail('Draft values cannot enter the guard'); } };
  let notices = 0;
  const stop = subscribeCaseDraftState(() => { notices++; });
  const throwing = subscribeCaseDraftState(() => { throw new Error('A display observer failed'); });
  try {
    setCaseDraftUnprotected(first, true, context);
    assert.equal(notices, 1);
    setCaseDraftUnprotected(first, true, context); assert.equal(notices, 1);
    setCaseDraftUnprotected(second, true, context);
    context.caseId = 'changed-input';
    setCaseDraftUnprotected(transient, true);
    assert.deepEqual(unconfirmedCaseDrafts(), [
      { owner: first, caseId: 'case-one', form: 'decision' },
      { owner: second, caseId: 'case-one', form: 'decision' },
    ]);
    assert.equal(hasUnprotectedCaseDrafts(), true);
    setCaseDraftUnprotected(first, false);
    assert.deepEqual(unconfirmedCaseDrafts().map(value => value.owner), [second]);
    setCaseDraftUnprotected(second, false);
    assert.deepEqual(unconfirmedCaseDrafts(), []);
    assert.equal(hasUnprotectedCaseDrafts(), true, 'a transient form still owns its leave guard');
    stop(); const before = notices;
    setCaseDraftUnprotected(transient, false);
    assert.equal(notices, before); assert.equal(hasUnprotectedCaseDrafts(), false);
  } finally {
    stop(); throwing();
    for (const owner of [first, second, transient]) setCaseDraftUnprotected(owner, false);
  }
});

for (const timing of ['before', 'after'] as const) test(`reading inventory cannot settle an unknown ${timing}-commit acknowledgement`, async () => {
  const owner = {}, states: CaseDraftInventoryState[] = [];
  let store = emptyCaseDraftStore(), writes = 0;
  const recovery = createCaseDraftRecovery({
    caseId: 'case-one', form: 'decision', readFields: () => ({ summary: 'Unfinished reasoning' }),
    restoreFields: () => assert.fail('Inventory cannot restore'), resetFields: () => assert.fail('Inventory cannot reset'),
    notify: (state, unsafe) => setCaseDraftUnprotected(owner, unsafe,
      state.status === 'unknown' ? { caseId: 'case-one', form: 'decision' } : undefined),
    storage: { read: async () => store, update: async change => {
      writes++; if (timing === 'after') store = change(store);
      throw new BrowserLocalDataError('LOCAL_DATA_COMMIT_UNKNOWN', 'Unconfirmed acknowledgement');
    } },
  });
  const inventory = createCaseDraftInventory(async () => ({ ...snapshot([]), case_drafts: store }), next => states.push(next));
  try {
    recovery.changed(); await assert.rejects(recovery.flush(), { code: 'LOCAL_DATA_COMMIT_UNKNOWN' });
    await inventory.refresh(); await recovery.refresh();
    assert.equal(states.at(-1)?.entries.length, timing === 'after' ? 1 : 0);
    assert.deepEqual(unconfirmedCaseDrafts(), [{ owner, caseId: 'case-one', form: 'decision' }]);
    assert.equal(hasUnprotectedCaseDrafts(), true);
    assert.equal(await recovery.submit(async () => assert.fail('No repeat submission')), false);
    assert.equal(writes, 1);
  } finally { inventory.dispose(); recovery.destroy(); setCaseDraftUnprotected(owner, false); }
});
