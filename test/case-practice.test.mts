import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCasePracticeRecord, createCasePracticeSession, CASE_PRACTICE_LATER_AT, CASE_PRACTICE_SCENARIOS, reviewCasePracticeInput, previewCasePracticeContainment, previewCasePracticePackets, casePracticeFeedback, casePracticeJourneyActions, casePracticeJourneyMaterials, casePracticeRoutes, casePracticeImageLineage } from '../frontend/src/lib/analysis/case-practice.ts';
import { compareCaseHandoffCopies } from '../packages/cases/case-handoff-comparison.mts';
import { validateCaseResponsePacket } from '../packages/cases/case-response-packet-validation.mts';
import { normalizeCase } from '../packages/cases/case-record-operations.mts';
import { replaceCaseDraft } from '../packages/cases/case-drafts.mts';
import { caseRecheckAnswerContext } from '../packages/cases/case-recheck-model.mts';
import { createCaseDraftRecovery, type CaseDraftRecoveryState } from '../frontend/src/lib/controllers/case-draft-recovery.ts';
import { caseIncidentTargets, buildCaseIncidentCoverage } from '../packages/cases/case-workflow-metadata.mts';
import { latestEvidenceRequests, submittedPacketReceipts } from '../packages/cases/case-requested-evidence.mts';

test('fictional image history preserves separately declared operations without adding practice attachments', () => {
  const record = createCasePracticeRecord('requested-amendment'), before = structuredClone(record);
  const reviewed = casePracticeImageLineage();
  assert.equal(reviewed.termination, 'no_further_declaration');
  assert.deepEqual(reviewed.steps.map(step => [step.declaration.operations, step.declaration.source.digestSha256, step.parentHasDeclaredEdits]), [
    [['outline'], `sha256:${'b'.repeat(64)}`, true], [['redact'], `sha256:${'a'.repeat(64)}`, false],
  ]);
  assert.deepEqual(casePracticeImageLineage(), reviewed);
  assert.deepEqual(record, before);
  assert.equal(record.attachments?.length ?? 0, 0);
});

test('practice starts from fictional, separately attributed complete and unavailable observations', () => {
  const record = createCasePracticeRecord();
  assert.equal(record.domain, 'case-practice.example');
  assert.equal(record.disposition, 'unreviewed');
  assert.equal(record.evidencePins.length, 4);
  assert.equal(record.evidencePins[0]!.completeness, 'complete');
  assert.equal(record.evidencePins[1]!.completeness, 'partial');
  assert.equal(record.evidencePins[1]!.sourceState, 'unavailable');
  assert.equal(record.assertions[0]!.recheck?.baselinePinId, record.evidencePins[0]!.id);
  assert.equal(record.actions.length, 0);
  assert.equal(record.closures.records.length, 0);
});

test('the existing offer-page practice runs deterministic offline owners without changing its evidence or open follow-up', async () => {
  const record = createCasePracticeRecord(), before = structuredClone(record);
  const first = await reviewCasePracticeInput(record), repeated = await reviewCasePracticeInput(record);
  assert.deepEqual(first, repeated);
  assert.deepEqual(first.intake.indicators.map(item => [item.kind, item.value]), [['sha256', 'a'.repeat(64)], ['ipv4', '192.0.2.17']]);
  assert.ok(first.intake.indicators.every(item => item.location.partId === 'input'));
  assert.equal(first.intake.distributionContext?.channel, 'advertisement');
  assert.equal(first.intake.distributionContext?.observedAt, '2026-09-01T12:00:00.000Z');
  assert.equal(first.intake.reviewedAt, CASE_PRACTICE_LATER_AT);
  assert.equal(JSON.stringify(first.intake).includes('campaign=fictional'), false);
  assert.equal(first.history.state, 'partial');
  const boundary = first.history.observations.find(item => item.state === 'reported')!;
  assert.ok(boundary.source.includes(record.evidencePins[0]!.id));
  assert.equal(record.evidenceHistory.length, 0);
  const included = await previewCasePracticeContainment(record, 'internal', true);
  assert.deepEqual(included.evidencePins, [record.evidencePins[0]]);
  assert.equal(included.assertions[0]!.state, 'open');
  assert.equal(included.assertions[0]!.evidence[0]!.stance, 'unresolved');
  const excluded = await previewCasePracticeContainment(record, 'trusted', false);
  assert.equal(excluded.state, 'partial'); assert.equal(excluded.assertions[0]!.evidence[0]!.state, 'not_selected');
  const publicPreview = await previewCasePracticeContainment(record, 'public', true);
  assert.deepEqual(publicPreview.assertions, []); assert.deepEqual(publicPreview.evidencePins, []);
  assert.deepEqual(record, before);
});

test('fictional packet comparison retains exact identities and omitted source pins without authorising or changing practice', async () => {
  const record = createCasePracticeRecord(), before = structuredClone(record);
  const [baseline, comparison] = await previewCasePracticePackets(record);
  for (const copy of [baseline, comparison]) {
    assert.equal(copy.kind, 'response_packet');
    assert.equal(copy.caseId, record.id);
    assert.equal(copy.domain, record.domain);
    await validateCaseResponsePacket(copy.record);
    assert.equal(copy.record.reviewRequired, true);
    assert.equal(copy.record.submissionPerformed, false);
    const authority = copy.record.authorisation as Record<string, unknown>;
    assert.equal(authority.status, 'draft');
    assert.equal(authority.confirmedAt, null);
    assert.equal(authority.suppliedReviewDigestSha256, null);
    const actions = copy.record.escalationHistory as Record<string, unknown>[];
    assert.equal(actions.length, 1);
    assert.equal(actions[0]!.state, 'drafting');
    assert.equal(JSON.stringify(actions).includes('packetReceipt'), false);
  }
  const changes = compareCaseHandoffCopies(baseline, comparison);
  assert.equal(changes.state, 'ready');
  assert.equal(changes.rows.find(row => row.field === 'recipientRoute')?.state, 'changed');
  assert.equal(changes.rows.find(row => row.field === 'incident')?.state, 'changed');
  assert.equal(changes.rows.find(row => row.field === 'actionBinding')?.state, 'unchanged');
  const action = changes.rows.find(row => row.field === 'escalationHistory')!;
  assert.equal(action.state, 'changed');
  assert.ok(action.recordId);
  assert.deepEqual((action.baseline as { responseObjects: unknown }).responseObjects, [record.evidencePins[0]!.responseObject]);
  assert.deepEqual((action.comparison as { responseObjects: unknown }).responseObjects, [record.evidencePins[3]!.responseObject]);
  const selected = changes.rows.filter(row => row.field === 'selectedEvidence');
  assert.deepEqual(selected.filter(row => row.state === 'baseline_only').map(row => row.recordId), [record.evidencePins[0]!.id, record.evidencePins[2]!.id]);
  assert.deepEqual(selected.filter(row => row.state === 'comparison_only').map(row => row.recordId), [record.evidencePins[3]!.id]);
  assert.deepEqual(record, before);
  assert.equal(record.actions.length, 0);
  assert.equal(record.evidencePins.length, 4);
});

test('fictional packet preparation rejects other scenarios and stops an already cancelled attempt', async () => {
  await assert.rejects(previewCasePracticePackets(createCasePracticeRecord('provider-resolved')), /supplied offer-page/u);
  const controller = new AbortController(); controller.abort();
  const record = createCasePracticeRecord(), before = structuredClone(record);
  await assert.rejects(previewCasePracticePackets(record, controller.signal), { name: 'AbortError' });
  assert.deepEqual(record, before);
});

test('required practice families have distinct supplied evidence, scope, report comparisons and recheck conditions', () => {
  const required = ['credential-form', 'compromised-page', 'unobserved-lookalike', 'related-hosts', 'fake-shop', 'ad-redirect', 'social-payment', 'role-impersonation',
    'email-only', 'conditional-presentation', 'hosted-object', 'app-listing', 'requested-amendment', 'restored-dispute', 'infrastructure-move', 'unexpected-notice'];
  assert.ok(required.every(id => CASE_PRACTICE_SCENARIOS.some(item => item.id === id)));
  assert.equal(new Set(CASE_PRACTICE_SCENARIOS.map(item => item.observation)).size, CASE_PRACTICE_SCENARIOS.length);
  assert.equal(new Set(CASE_PRACTICE_SCENARIOS.map(item => item.adequate)).size, CASE_PRACTICE_SCENARIOS.length);
  for (const item of CASE_PRACTICE_SCENARIOS) {
    const record = createCasePracticeRecord(item.id);
    assert.equal(record.evidencePins[0]!.value, item.observation);
    assert.equal(record.assertions[0]!.statement, item.question);
    assert.equal(record.assertions[0]!.recheck?.conditions, item.conditions);
    assert.deepEqual(caseIncidentTargets(record).map(target => target.url), [...item.urls]);
    assert.deepEqual(casePracticeRoutes(item.id).map(route => route.id), [...item.routes]);
    assert.ok(item.adequate.length > 60 && item.inadequate.length > 60);
  }
});

test('connected practice records separate recipient material, simulated delivery and independently scoped page closure', () => {
  const session = createCasePracticeSession();
  try {
    const initial = session.read();
    assert.throws(() => session.journey('prepare'), /evidence-linked/u);
    assert.deepEqual(session.read(), initial);
    session.edit({ decision: { summary: 'Review the observed credential request and separate distribution.', rationale: 'Copied prose and name resemblance do not establish rights or actor identity.', evidencePinIds: [initial.evidencePins[0]!.id] } });
    const prepared = session.journey('prepare');
    const materials = casePracticeJourneyMaterials(prepared);
    assert.equal(materials.length, 2);
    assert.deepEqual(materials.map(item => item.recipientRoute?.contact), ['page-review@example.invalid', 'ad-review@example.invalid']);
    assert.deepEqual(materials.map(item => item.incident.abusiveUrls), [['https://case-practice.example/offer'], ['https://distribution.example/ad/7']]);
    assert.deepEqual(materials.map(item => item.selectedEvidence.map(pin => pin.label)), [['Earlier page', 'Reference offer text'], ['Advertisement distribution object']]);
    assert.ok(materials.every(item => item.selectedEvidence.every(pin => !Object.hasOwn(pin, 'value'))));
    const preparedCoverage = buildCaseIncidentCoverage(prepared);
    assert.deepEqual(preparedCoverage.map(row => row.responseObject.kind), ['page', 'advertisement']);
    assert.ok(preparedCoverage.every(row => row.actionCoverage === 'bound' && row.responseContexts.length === 1
      && row.responseContexts[0]!.currentState === 'drafting' && row.responseContexts[0]!.deliveryEvents.length === 0));
    const signature = JSON.stringify(materials);
    session.edit({ actionUpdate: { id: prepared.actions[0]!.id, recipient: 'changed-recipient@example.invalid' } });
    assert.throws(() => session.journey('deliver', signature), /changed/u);
    const delivered = session.journey('deliver', JSON.stringify(casePracticeJourneyMaterials(session.read())));
    assert.deepEqual(casePracticeJourneyActions(delivered).map(action => action.state), ['acknowledged', 'submitted']);
    assert.equal(delivered.observedEffects.reviews.length, 0, 'acknowledgement cannot invent independent remediation');
    assert.ok(delivered.actions.every(action => action.history.some(event => event.nextState === 'submitted' && event.reference?.startsWith('Practice-only'))));
    const deliveredCoverage = buildCaseIncidentCoverage(delivered);
    assert.deepEqual(deliveredCoverage.map(row => row.providerEvents.length), [1, 0]);
    assert.ok(deliveredCoverage.every(row => row.responseContexts[0]!.reviewEvents.length === 2
      && row.responseContexts[0]!.deliveryEvents.length === 1 && row.reviews.length === 0));
    assert.ok(deliveredCoverage.flatMap(row => row.responseContexts[0]!.deliveryEvents).every(event => !event.packetReceipt), 'do not invent exported packet receipts');
    const closed = session.journey('close-page');
    assert.equal(casePracticeJourneyActions(closed)[0]!.state, 'terminal');
    assert.equal(casePracticeJourneyActions(closed)[1]!.state, 'submitted');
    assert.equal(closed.observedEffects.reviews.at(-1)!.state, 'not_reproduced');
    assert.deepEqual(caseIncidentTargets(closed).map(target => target.url), ['https://distribution.example/ad/7']);
    assert.notEqual(closed.status, 'resolved');
    assert.equal(closed.closures.records.length, 0, 'closing one page must not close the whole Case');
    const closedCoverage = buildCaseIncidentCoverage(closed);
    assert.equal(closedCoverage.find(row => row.responseObject.kind === 'page')!.reviews[0]!.state, 'not_reproduced');
    assert.equal(closedCoverage.find(row => row.responseObject.kind === 'advertisement')!.observationCoverage, 'unknown');
    assert.deepEqual(normalizeCase(closed), closed);
    assert.deepEqual(initial.actions, []);
    assert.throws(() => session.journey('close-page'), /separate fictional deliveries/u);
  } finally { session.close(); }
});

test('requested-evidence practice preserves synthetic original delivery and current causal request metadata', () => {
  const record = createCasePracticeRecord('requested-amendment');
  const action = record.actions[0]!;
  assert.equal(action.state, 'acknowledged');
  const receipt = submittedPacketReceipts(action)[0]!;
  const request = latestEvidenceRequests(action)[0]!;
  assert.equal(receipt.digestSha256, request.evidenceRequest.packetDigestSha256);
  assert.equal(request.evidenceRequest.state, 'requested');
  assert.deepEqual(request.evidenceRequest.previousEventIds, []);
  const page = record.evidencePins.find(pin => pin.label === 'Requested exact-page evidence')!;
  assert.equal(page.source, 'Fictional supplied capture');
  assert.equal(page.observationHostname, record.domain);
  assert.equal(page.sourceState, 'complete');
  assert.notEqual(page.source, record.evidencePins[0]!.source, 'request provenance must not be presented as the requested page capture');
  assert.equal(record.actions.filter(item => item.amendment).length, 0);
  const other = createCasePracticeSession('requested-amendment');
  assert.throws(() => other.journey('prepare'), /only/u);
  other.close();
});

test('every practice scenario uses valid current records and only checks explicit recorded relationships', () => {
  for (const { id } of CASE_PRACTICE_SCENARIOS) {
    const record = createCasePracticeRecord(id), ids = record.evidencePins.map(pin => pin.id);
    assert.deepEqual(normalizeCase(record), record);
    assert.ok(casePracticeFeedback(record, ids, id).every(check => !check.complete));
    const session = createCasePracticeSession(id), current = session.read();
    const pinIds = current.evidencePins.map(pin => pin.id);
    session.edit({ decision: { summary: 'The evidence needs review.', rationale: 'No automatic verdict.', confidence: 'low', evidencePinIds: [pinIds[0]!] } });
    assert.equal(casePracticeFeedback(session.read(), pinIds, id)[1]!.complete, id !== 'contradictory-sources');
    if (id === 'provider-resolved') {
      assert.equal(record.actions[0]!.providerOutcome, 'provider_reports_resolved');
      assert.deepEqual(record.observedEffects.reviews, []);
      assert.deepEqual(record.closures.records, []);
    }
    session.close();
  }
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
  await assert.rejects(session.storage.update(store => replaceCaseDraft(store, { ...draft, id: 'other-draft', caseId: 'another-case' }, null)), /fictional case/u);
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
    completeness: later.completeness, evidencePinId: later.id, responseObject: later.responseObject,
    recheck: caseRecheckAnswerContext(before.assertions[0]!, 'comparable') };
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
