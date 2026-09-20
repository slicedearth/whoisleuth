import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCasePracticeRecord, createCasePracticeSession, CASE_PRACTICE_LATER_AT } from '../frontend/src/lib/analysis/case-practice.ts';
import { replaceCaseDraft } from '../packages/cases/case-drafts.mts';
import { caseRecheckAnswerContext } from '../packages/cases/case-recheck-model.mts';
import { createCaseDraftRecovery, type CaseDraftRecoveryState } from '../frontend/src/lib/controllers/case-draft-recovery.ts';

test('practice starts from fictional, separately attributed complete and unavailable observations', () => {
  const record = createCasePracticeRecord();
  assert.equal(record.domain, 'case-practice.example');
  assert.equal(record.disposition, 'unreviewed');
  assert.equal(record.evidencePins.length, 2);
  assert.equal(record.evidencePins[0]!.completeness, 'complete');
  assert.equal(record.evidencePins[1]!.completeness, 'partial');
  assert.equal(record.evidencePins[1]!.sourceState, 'unavailable');
  assert.equal(record.assertions[0]!.recheck?.baselinePinId, record.evidencePins[0]!.id);
  assert.equal(record.actions.length, 0);
  assert.equal(record.closures.records.length, 0);
});

test('practice sessions and detached read results cannot alter each other', () => {
  const first = createCasePracticeSession(), second = createCasePracticeSession();
  const untouched = second.read();
  const copy = first.read(); copy.notes[0]!.body = 'Changed only in the detached copy.';
  assert.notEqual(first.read().notes[0]!.body, copy.notes[0]!.body);
  first.edit({ note: 'Only this practice session changed.' });
  assert.deepEqual(second.read(), untouched);
  assert.equal(first.read().notes.at(-1)!.body, 'Only this practice session changed.');
  first.close(); second.close();
});

test('a practice Case mutation and its submitted draft settle together without stale overwrites', async () => {
  const session = createCasePracticeSession();
  const before = session.read();
  const draft = { id: 'practice-draft', revision: 'revision-one', caseId: before.id, form: 'evidence-pin', formVersion: 1,
    updatedAt: CASE_PRACTICE_LATER_AT, fields: { pinLabel: 'Pending fictional fact' } };
  await session.storage.update(store => replaceCaseDraft(store, draft, null));
  assert.throws(() => session.edit({ note: 'Must not commit' }, { id: draft.id, revision: 'stale' }), /draft changed/u);
  assert.deepEqual(session.read(), before);
  await assert.rejects(session.storage.update(store => replaceCaseDraft(store, { ...draft, id: 'other-draft', caseId: 'another-case' }, null)), /fictional Case/u);
  assert.deepEqual((await session.storage.read()).records, [draft]);
  session.edit({ note: 'The reviewed practice note.' }, draft);
  assert.equal(session.read().notes.at(-1)!.body, 'The reviewed practice note.');
  assert.deepEqual((await session.storage.read()).records, []);
  session.close();
});

test('practice uses the same non-reproduction boundary and retains unavailable evidence honestly', () => {
  const session = createCasePracticeSession(), before = session.read();
  const later = before.evidencePins[1]!;
  const review = { state: 'not_reproduced', observedAt: later.observedAt!, sourceClass: 'analyst', source: later.source,
    completeness: later.completeness, evidencePinId: later.id, recheck: caseRecheckAnswerContext(before.assertions[0]!, 'comparable') };
  assert.throws(() => session.edit({ observedEffectReview: review }), /complete|partial/iu);
  assert.deepEqual(session.read(), before);
  const saved = session.edit({ observedEffectReview: { ...review, state: 'unavailable' } });
  assert.equal(saved.observedEffects.reviews[0]!.state, 'unavailable');
  assert.equal(saved.observedEffects.reviews[0]!.completeness, 'partial');
  assert.deepEqual(saved.evidencePins, before.evidencePins);
  assert.deepEqual(saved.actions, []); assert.deepEqual(saved.closures, before.closures);
  session.close();
});

test('practice draft feedback does not promise persistent recovery and commits once', async () => {
  const session = createCasePracticeSession();
  let fields = { note: 'The draft stays on this page.' };
  let state: CaseDraftRecoveryState | undefined;
  const recovery = createCaseDraftRecovery({ caseId: session.read().id, form: 'note', retention: 'document', storage: session.storage,
    readFields: () => fields, restoreFields: next => { fields = next as typeof fields; }, resetFields: () => { fields = { note: '' }; },
    notify: next => { state = next; } });
  try {
    recovery.changed(); await recovery.flush();
    assert.match(state!.message, /page only/u); assert.doesNotMatch(state!.message, /saved in this workspace/u);
    assert.equal(await recovery.submit(async receipt => { session.edit({ note: fields.note }, receipt); return true; }), true);
    assert.equal(session.read().notes.filter(note => note.body === fields.note).length, 1);
    assert.deepEqual((await session.storage.read()).records, []);
  } finally { recovery.destroy(); session.close(); }
});

test('closing practice destroys its in-memory records and rejects delayed writes', async () => {
  const session = createCasePracticeSession(); session.close();
  assert.throws(() => session.read(), /closed/u);
  assert.throws(() => session.edit({ note: 'Too late' }), /closed/u);
  await assert.rejects(session.storage.read(), /closed/u);
  await assert.rejects(session.storage.update(store => store), /closed/u);
});
