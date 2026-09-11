import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createCaseDraftRecovery, restoreCaseDraftFields, type CaseDraftRecoveryState } from '../frontend/src/lib/controllers/case-draft-recovery.ts';
import { caseDraftFields, emptyCaseDraftStore, normalizeCaseDraftStore, removeCaseDraft, replaceCaseDraft, serializeCaseDraftStore } from '../packages/cases/case-drafts.mts';
import { MAX_CASE_DRAFT_RECORDS, type CaseDraftFields, type CaseDraftRecord } from '../packages/contracts/case-drafts.mts';
import { CASE_DRAFTS_COLLECTION } from '../frontend/src/lib/browser-local-data-definitions.ts';

const draft = (overrides: Partial<CaseDraftRecord> = {}): CaseDraftRecord => ({
  id: 'draft-one', revision: 'revision-one', caseId: 'case-one', form: 'decision', formVersion: 1,
  updatedAt: '2026-09-12T00:00:00.000Z', fields: { summary: 'Unfinished observation', rationale: '', references: [] }, ...overrides,
});
const gate = () => { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; };
function harness() {
  let store = emptyCaseDraftStore();
  let fields: CaseDraftFields = { summary: '' };
  let state: CaseDraftRecoveryState | undefined;
  let unprotected = false;
  let failWrite = false;
  let failRead = false;
  let hold: ReturnType<typeof gate> | undefined;
  let readHold: ReturnType<typeof gate> | undefined;
  let writes = 0;
  let ids = 0;
  const controller = createCaseDraftRecovery({
    caseId: 'case-one', form: 'decision', uuid: () => `generated-${++ids}`,
    readFields: () => fields, restoreFields: next => { fields = next; }, resetFields: () => { fields = { summary: '' }; },
    notify: (next, unsafe) => { state = next; unprotected = unsafe; },
    storage: {
      read: async () => { if (readHold) await readHold.promise; if (failRead) throw new Error('Read unavailable'); return store; },
      update: async change => { writes++; if (hold) await hold.promise; if (failWrite) throw new Error('Storage unavailable'); store = change(store); },
    },
  });
  return { controller, get store() { return store; }, set store(next) { store = next; }, get fields() { return fields; },
    set fields(next) { fields = next; }, get state() { return state; }, get unprotected() { return unprotected; }, get writes() { return writes; },
    set failWrite(value: boolean) { failWrite = value; }, set hold(value: ReturnType<typeof gate> | undefined) { hold = value; },
    set readHold(value: ReturnType<typeof gate> | undefined) { readHold = value; },
    set failRead(value: boolean) { failRead = value; },
  };
}

describe('bounded Case recovery drafts', () => {
  test('additive form fields take current defaults while incompatible fields fail without discarding text', () => {
    assert.deepEqual(restoreCaseDraftFields({ summary: 'Retained text' }, { summary: '', rationale: '', references: [] as string[] }), { summary: 'Retained text', rationale: '', references: [] });
    assert.throws(() => restoreCaseDraftFields({ removedField: 'Keep this' }, { summary: '' }));
    assert.throws(() => restoreCaseDraftFields({ references: [{}] }, { references: [] as string[] }));
    assert.throws(() => restoreCaseDraftFields({ relations: [{ evidencePinId: 'one', unexpected: 'value' }] }, { relations: [] as Record<string, string>[] }, { relations: { evidencePinId: '', stance: '' } }));
  });
  test('preserves incomplete values exactly and rejects malformed or future data without pruning', () => {
    const value = { ...emptyCaseDraftStore(), records: [draft()] };
    assert.deepEqual(normalizeCaseDraftStore(JSON.parse(serializeCaseDraftStore(value))), value);
    assert.throws(() => normalizeCaseDraftStore({ ...value, version: 2 }), /Unsupported/u);
    assert.throws(() => normalizeCaseDraftStore({ ...value, records: [draft(), draft()] }), /Duplicate/u);
    assert.throws(() => normalizeCaseDraftStore({ ...value, records: Array(MAX_CASE_DRAFT_RECORDS + 1).fill(draft()) }), /limit/u);
    assert.throws(() => caseDraftFields({ body: 'x'.repeat(8193) }), /Invalid/u);
    assert.throws(() => caseDraftFields({ choices: Array(513).fill('x') }));
    assert.throws(() => caseDraftFields(JSON.parse('{"__proto__":{"polluted":"yes"}}')));
    assert.throws(() => caseDraftFields({ invalid: [null] }));
  });
  test('requires the exact revision and Case identity for replacement or submission removal', () => {
    const store = { ...emptyCaseDraftStore(), records: [draft()] };
    assert.throws(() => replaceCaseDraft(store, draft({ revision: 'new' }), null), /another tab/u);
    assert.throws(() => removeCaseDraft(store, draft({ revision: 'new' }), 'case-one'), /No Case write/u);
    assert.throws(() => removeCaseDraft(store, draft(), 'case-other'), /No Case write/u);
    assert.equal(removeCaseDraft(store, draft(), 'case-one').records.length, 0);
    assert.equal(store.records.length, 1);
  });
  test('uses the protected provider collection and excludes legacy rollback copies', () => {
    assert.equal(CASE_DRAFTS_COLLECTION.legacyRollback, false);
    const value = normalizeCaseDraftStore({ ...emptyCaseDraftStore(), records: [draft()] });
    assert.deepEqual(CASE_DRAFTS_COLLECTION.normalize(CASE_DRAFTS_COLLECTION.join(CASE_DRAFTS_COLLECTION.split(value), 1)), value);
  });
  test('retains the latest edit and reports pending versus durable recovery honestly', async () => {
    const h = harness(); const held = gate(); h.hold = held;
    h.fields = { summary: 'Earlier' }; h.controller.changed();
    const saving = h.controller.flush();
    assert.equal(h.unprotected, true);
    h.fields = { summary: 'Later' }; h.controller.changed(); held.release();
    await saving;
    assert.deepEqual(h.store.records[0]?.fields, { summary: 'Later' });
    assert.equal(h.store.records.length, 1); assert.equal(h.unprotected, false);
    h.controller.destroy();
  });
  test('does not silently overwrite another tab and keeps a failed draft in memory', async () => {
    const h = harness(); h.fields = { summary: 'Mine' }; h.controller.changed(); await h.controller.flush();
    h.store = { ...h.store, records: h.store.records.map(item => ({ ...item, revision: 'other-tab', fields: { summary: 'Theirs' } })) };
    h.fields = { summary: 'My later edit' }; h.controller.changed();
    assert.equal(h.state?.status, 'pending'); assert.equal(h.state?.message, 'Saving recovery draft…');
    await assert.rejects(() => h.controller.flush(), /another tab/u);
    assert.equal(h.unprotected, true); assert.equal(h.state?.status, 'error');
    assert.deepEqual(h.store.records[0]?.fields, { summary: 'Theirs' });
    assert.deepEqual(h.fields, { summary: 'My later edit' }); h.controller.destroy();
  });
  test('restores only a current matching form after deliberate selection', async () => {
    const h = harness(); const original = draft(); h.store = { ...h.store, records: [original] };
    await h.controller.refresh(); assert.equal(h.state?.candidates.length, 1); assert.deepEqual(h.fields, { summary: '' });
    await h.controller.restore(original); assert.deepEqual(h.fields, original.fields);
    assert.equal(h.unprotected, false); assert.equal(h.state?.edited, true);
    await h.controller.discard(); assert.equal(h.store.records.length, 0); h.controller.destroy();
  });
  test('preserves future form versions and stale recovery selections', async () => {
    const h = harness(); const original = draft({ formVersion: 2 }); h.store = { ...h.store, records: [original] };
    await h.controller.restore(original); assert.deepEqual(h.fields, { summary: '' });
    assert.equal(h.store.records[0]?.formVersion, 2); assert.equal(h.state?.status, 'error'); h.controller.destroy();
  });
  test('a failed domain write leaves its recovery copy available', async () => {
    const h = harness(); h.fields = { summary: 'Not committed' }; h.controller.changed();
    assert.equal(await h.controller.submit(async () => false), false);
    assert.deepEqual(h.store.records[0]?.fields, h.fields); assert.equal(h.state?.edited, true); h.controller.destroy();
  });
  test('a programmatically prepared form has the same unchanged submission semantics', async () => {
    const h = harness(); h.fields = { summary: 'Prepared without input events' };
    const unchanged = h.controller.capture();
    assert.equal(await h.controller.submit(async receipt => { h.store = removeCaseDraft(h.store, receipt, 'case-one'); return true; }), true);
    assert.equal(unchanged(), true); assert.equal(h.store.records.length, 0); h.controller.destroy();
  });
  test('removes a committed submission while saving later edits under a new identity', async () => {
    const h = harness(); const held = gate(); const began = gate();
    h.fields = { summary: 'Submitted' }; h.controller.changed();
    let submittedId = '';
    const saving = h.controller.submit(async receipt => {
      submittedId = receipt.id; began.release(); await held.promise;
      h.store = removeCaseDraft(h.store, receipt, 'case-one'); return true;
    });
    await began.promise;
    h.fields = { summary: 'Later work' }; h.controller.changed(); held.release();
    assert.equal(await saving, true); await h.controller.flush();
    assert.equal(h.store.records.length, 1); assert.notEqual(h.store.records[0]?.id, submittedId);
    assert.deepEqual(h.store.records[0]?.fields, { summary: 'Later work' }); h.controller.destroy();
  });
  test('edits made while recovery storage is pending cannot join the earlier submission', async () => {
    const h = harness(); const held = gate(); h.hold = held;
    h.fields = { summary: 'Submitted before await' }; h.controller.changed();
    const saving = h.controller.submit(async receipt => {
      assert.deepEqual(h.store.records[0]?.fields, { summary: 'Submitted before await' });
      h.store = removeCaseDraft(h.store, receipt, 'case-one'); return true;
    });
    h.fields = { summary: 'Changed during storage' }; h.controller.changed(); held.release();
    await saving; await h.controller.flush();
    assert.deepEqual(h.store.records[0]?.fields, { summary: 'Changed during storage' }); h.controller.destroy();
  });
  test('a committed-but-interrupted result cannot repeat an append', async () => {
    const h = harness(); h.fields = { summary: 'Committed' }; h.controller.changed();
    assert.equal(await h.controller.submit(async receipt => { h.store = removeCaseDraft(h.store, receipt, 'case-one'); throw new Error('View unavailable'); }), false);
    let repeated = false;
    assert.equal(await h.controller.submit(async () => { repeated = true; return true; }), false);
    assert.equal(repeated, false); assert.equal(h.store.records.length, 0); h.controller.destroy();
  });
  test('changing form targets retains the previous recovery copy instead of overwriting it', async () => {
    const h = harness(); h.fields = { summary: 'First target' }; h.controller.changed();
    assert.equal(await h.controller.leaveForm(), true); assert.deepEqual(h.fields, { summary: '' });
    h.fields = { summary: 'Second target' }; h.controller.changed(); await h.controller.flush();
    assert.equal(h.store.records.length, 2); assert.notEqual(h.store.records[0]?.id, h.store.records[1]?.id); h.controller.destroy();
  });
  test('a failed preparatory save waits for deliberate retry instead of retrying itself', async () => {
    const h = harness(); h.fields = { summary: 'Keep this' }; h.controller.changed(); h.failWrite = true;
    let domainWrites = 0;
    assert.equal(await h.controller.submit(async () => { domainWrites++; return true; }), false);
    await new Promise<void>(resolve => queueMicrotask(resolve));
    assert.equal(h.writes, 1); assert.equal(domainWrites, 0); assert.equal(h.unprotected, true);
    h.failWrite = false; await h.controller.flush(); assert.equal(h.writes, 2); assert.equal(h.unprotected, false);
    h.controller.destroy();
  });
  test('a failed recovery read neither claims a failed write nor hides a later successful read', async () => {
    const h = harness(); h.failRead = true; await h.controller.refresh();
    assert.equal(h.state?.status, 'idle'); assert.match(h.state?.readError ?? '', /could not be read/u);
    assert.equal(h.writes, 0); assert.equal(h.unprotected, false);
    h.failRead = false; h.store = { ...h.store, records: [draft()] }; await h.controller.refresh();
    assert.equal(h.state?.readError, null); assert.equal(h.state?.candidates.length, 1); h.controller.destroy();
  });
  test('typing during a recovery read preserves the new form and the older saved copy', async () => {
    const h = harness(); const held = gate(); const original = draft();
    h.store = { ...h.store, records: [original] }; h.readHold = held;
    const restoring = h.controller.restore(original);
    h.fields = { summary: 'Newly typed' }; h.controller.changed(); held.release();
    await restoring; await h.controller.flush();
    assert.deepEqual(h.fields, { summary: 'Newly typed' });
    assert.deepEqual(h.store.records.find(item => item.id === original.id), original);
    assert.equal(h.store.records.length, 2); h.controller.destroy();
  });
  test('typing while a discard is committing preserves later edits under a new identity', async () => {
    const h = harness(); h.fields = { summary: 'Discard this version' }; h.controller.changed(); await h.controller.flush();
    const oldId = h.store.records[0]?.id; const held = gate(); h.hold = held;
    const discarding = h.controller.discard();
    h.fields = { summary: 'Keep this later version' }; h.controller.changed(); held.release();
    await discarding; await h.controller.flush();
    assert.deepEqual(h.fields, { summary: 'Keep this later version' });
    assert.equal(h.store.records.length, 1); assert.notEqual(h.store.records[0]?.id, oldId);
    assert.deepEqual(h.store.records[0]?.fields, h.fields); h.controller.destroy();
  });
  test('a new edit during target selection prevents the selection from clearing it', async () => {
    const h = harness(); h.fields = { summary: 'Previous target' }; h.controller.changed();
    const held = gate(); h.readHold = held; const changing = h.controller.leaveForm();
    await new Promise<void>(resolve => queueMicrotask(resolve));
    h.fields = { summary: 'Later edit of the same target' }; h.controller.changed(); held.release();
    assert.equal(await changing, false); await h.controller.flush();
    assert.deepEqual(h.fields, { summary: 'Later edit of the same target' });
    assert.deepEqual(h.store.records[0]?.fields, h.fields); h.controller.destroy();
  });
});
