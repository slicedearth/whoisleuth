import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createCase, updateCase, buildCaseExport, projectCaseForAudience, normalizeCaseStore, serializeCaseStore } from '../packages/cases/case-model.mts';
import { buildCaseIncidentCoverage } from '../packages/cases/case-workflow-metadata.mts';
import { readCaseResponseObject, readCaseResponseObjects } from '../packages/cases/case-response-object.mts';
import { caseRecheckComparisonBlockers, caseRecheckAnswerContext } from '../packages/cases/case-recheck-model.mts';
import { buildCaseReport } from '../packages/cases/case-report.mts';
import { buildCaseResponseReviewInputs, validateCaseResponseReviewInputs } from '../packages/cases/case-response-packet.mts';
import { normalizeSnapshot, compareCaseEvidence } from '../packages/cases/case-evidence-model.mts';
const NOW = '2026-09-01T10:00:00.000Z', AFTER = '2026-09-02T10:00:00.000Z';
function scoped() {
  let record = createCase({ domain: 'incident.example', incidentTarget: 'https://incident.example/one' }, NOW);
  record = updateCase([record], record.id, { incidentTarget: 'https://incident.example/two' }, NOW).record;
  const objects = record.workflowMetadata!.incidentTargets.map(target => ({ kind: 'page' as const, identifier: target.url, incidentTargetId: target.id }));
  record = updateCase([record], record.id, { action: { type: 'hosting_report', recipient: 'Example hosting desk', contactSource: 'Analyst reviewed route', responseObjects: objects } }, NOW).record;
  return { record, objects };
}
function transition(record: ReturnType<typeof createCase>, nextState: string, extra: Record<string, unknown> = {}) {
  return updateCase([record], record.id, { actionUpdate: { id: record.actions[0]!.id, transition: { nextState, sourceClass: 'analyst', provenance: 'Reviewed manual event', ...extra } } }, AFTER).record;
}
function submitted() {
  const input = scoped();
  for (const state of ['ready_for_review', 'reviewed', 'authorised', 'submitted']) input.record = transition(input.record, state);
  return input;
}
test('one shared receipt can cover two exact objects without applying a partial result to both', () => {
  const { record: before, objects } = submitted();
  const record = transition(before, 'acknowledged', { sourceClass: 'provider', reference: 'TICKET-EXAMPLE', providerOutcome: 'provider_reports_resolved', responseObjects: [objects[0]], objectOutcome: 'removed' });
  const rows = buildCaseIncidentCoverage(record);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.providerEvents.at(-1)?.outcome, 'removed');
  assert.equal(rows[1]!.providerEvents.length, 0);
  assert.equal(rows[0]!.observationCoverage, 'unknown');
  assert.equal(rows[1]!.observationCoverage, 'unknown');
  assert.equal(record.actions.length, 1);
  assert.equal(record.actions[0]!.history.at(-1)?.responseObjects?.length, 1);
  assert.deepEqual(record.actions[0]!.responseObjects, before.actions[0]!.responseObjects);
});
test('generic acknowledgement stays separate from an object outcome and unknown historical binding', () => {
  const { record, objects } = submitted();
  assert.throws(() => transition(record, 'acknowledged', { sourceClass: 'provider', objectOutcome: 'removed' }), /Select the objects|explicit/i);
  const acknowledged = transition(record, 'acknowledged', { sourceClass: 'provider' });
  assert.ok(buildCaseIncidentCoverage(acknowledged).every(row => row.providerEvents.at(-1)?.outcome === null));
  const legacy = { ...acknowledged, actions: acknowledged.actions.map(action => {
    const { responseObjects: _scope, ...unbound } = action;
    return { ...unbound, history: action.history.map(event => { const { responseObjects: _eventScope, ...oldEvent } = event; return oldEvent; }) };
  }) };
  assert.ok(buildCaseIncidentCoverage(legacy).every(row => row.actionCoverage === 'unknown' && row.providerEvents.length === 0));
  assert.equal(objects.length, 2);
});
test('binding edits invalidate review and never rewrite earlier event snapshots', () => {
  const { record, objects } = scoped();
  const reviewed = transition(transition(record, 'ready_for_review'), 'reviewed');
  const saved = JSON.stringify(reviewed.actions[0]!.history);
  const changed = updateCase([reviewed], reviewed.id, { actionUpdate: { id: reviewed.actions[0]!.id, responseObjects: [objects[0]] } }, AFTER).record;
  assert.equal(changed.actions[0]!.state, 'drafting');
  assert.equal(JSON.stringify(changed.actions[0]!.history.slice(0, -1)), saved);
  assert.equal(changed.actions[0]!.history.at(-1)?.responseObjects?.length, 1);
  const sent = submitted().record;
  assert.throws(() => updateCase([sent], sent.id, { actionUpdate: { id: sent.actions[0]!.id, responseObjects: [] } }, AFTER), /submitted|locked|material|immutable/i);
});
test('scope validation is strict, bounded, detached and rejects stale or foreign identities', () => {
  const { record, objects } = scoped();
  const value = readCaseResponseObject(objects[0])!;
  assert.ok(Object.isFrozen(value));
  assert.throws(() => readCaseResponseObjects([], 17), /schema 18/);
  assert.throws(() => readCaseResponseObjects(Array.from({ length: 21 }, () => objects[0])), /bounded|array|Response objects/);
  assert.throws(() => readCaseResponseObjects([objects[0], objects[0]]), /unique/);
  assert.throws(() => updateCase([record], record.id, { evidencePin: { label: 'Foreign', value: 'Observed', responseObject: { ...objects[0], identifier: 'https://incident.example/unknown' } } }, AFTER), /changed|not retained/);
  assert.throws(() => updateCase([record], record.id, { evidencePin: { label: 'Foreign', value: 'Observed', responseObject: { kind: 'domain', identifier: 'other.example', incidentTargetId: null } } }, AFTER), /match this Case/);
});
test('unavailable is not removal; typed restoration and dispute retain independent point-in-time history', () => {
  let { record, objects } = scoped();
  assert.throws(() => updateCase([record], record.id, { observedEffectReview: { state: 'unavailable', source: 'Failed manual review', responseObject: objects[0], objectOutcome: 'removed' } }, AFTER), /unavailable|observed/i);
  for (const outcome of ['restored', 'disputed']) record = updateCase([record], record.id, { observedEffectReview: { state: 'changed', observedAt: AFTER, sourceClass: 'analyst', source: 'Independent manual review', completeness: 'complete', responseObject: objects[0], objectOutcome: outcome } }, AFTER).record;
  assert.deepEqual(record.observedEffects.reviews.map(review => review.objectOutcome).sort(), ['disputed', 'restored']);
  const rows = buildCaseIncidentCoverage(record);
  assert.equal(rows[0]!.observationCoverage, 'ambiguous');
  assert.equal(rows[1]!.observationCoverage, 'unknown');
});
test('hostname similarity does not establish comparable exact-object non-reproduction', () => {
  const { record, objects } = scoped();
  const baseline = updateCase([record], record.id, { evidencePin: { label: 'Page', value: 'Observed', source: 'Manual', sourceState: 'reviewed', observedAt: NOW, completeness: 'complete', observationHostname: 'incident.example', responseObject: objects[0] } }, NOW).record.evidencePins[0]!;
  const context = { targetHostname: 'incident.example', baselinePinId: baseline.id, conditions: 'Same unauthenticated page condition', responseObject: objects[0]! };
  const question = { id: 'question-example', kind: 'next_step' as const, state: 'open' as const, statement: 'Is this page still present?', recheck: context, rationale: '', evidencePinIds: [], createdAt: NOW, updatedAt: NOW };
  const answer = caseRecheckAnswerContext(question, 'comparable');
  const current = { ...baseline, id: 'current-example', observedAt: AFTER, responseObject: objects[1]! };
  assert.ok(caseRecheckComparisonBlockers(answer, [baseline], current).includes('current_object_mismatch'));
  assert.deepEqual(caseRecheckComparisonBlockers(answer, [baseline], { ...current, responseObject: objects[0]! }), []);
  const { responseObject: _object, ...unboundBaseline } = baseline;
  assert.ok(caseRecheckComparisonBlockers(answer, [unboundBaseline], { ...current, responseObject: objects[0]! }).includes('baseline_object_mismatch'));
});
test('scoped closures preserve the Case and other objects, and partial provider claims cannot close another object', () => {
  const { record: sent, objects } = submitted();
  const record = transition(sent, 'acknowledged', { sourceClass: 'provider', providerOutcome: 'provider_reports_resolved', responseObjects: [objects[0]], objectOutcome: 'removed' });
  assert.throws(() => updateCase([record], record.id, { closure: { reason: 'provider_reported_resolution_not_independently_checked', summary: 'Reviewed provider receipt', actionId: record.actions[0]!.id, responseObject: objects[1] } }, AFTER), /linked typed provider/);
  const closed = updateCase([record], record.id, { closure: { reason: 'provider_reported_resolution_not_independently_checked', summary: 'Reviewed provider receipt', actionId: record.actions[0]!.id, responseObject: objects[0] } }, AFTER).record;
  assert.equal(closed.status, record.status);
  assert.equal(closed.workflowMetadata!.incidentTargets[1]!.state, 'open');
  assert.equal(buildCaseReport(closed).json.responseLifecycle.latestClosure, null);
});
test('scope survives private portability but public evidence projection removes sensitive exact identifiers', () => {
  const { record, objects } = scoped();
  const pinned = updateCase([record], record.id, { evidencePin: { label: 'Exact object', value: 'Observed condition', responseObject: objects[0] } }, NOW).record;
  const restored = normalizeCaseStore(JSON.parse(serializeCaseStore([pinned]))).cases[0]!;
  assert.deepEqual(restored.actions[0]!.responseObjects, pinned.actions[0]!.responseObjects);
  assert.deepEqual(restored.evidencePins[0]!.responseObject, objects[0]);
  const projected = projectCaseForAudience(pinned, 'public');
  assert.equal(projected.evidencePins[0]!.responseObject, undefined);
  assert.equal(projected.actions.length, 0);
  const old = JSON.parse(readFileSync(new URL('./fixtures/case-lifecycle/browser-case-v17.json', import.meta.url), 'utf8'));
  old.cases[0].actions = pinned.actions;
  assert.throws(() => normalizeCaseStore(old), /schema 18/);
});
test('review-input digest material preserves exact immutable scope snapshots', () => {
  const { record } = scoped();
  const review = buildCaseResponseReviewInputs(record, { actionId: record.actions[0]!.id, profile: 'network_hosting', abusiveUrls: ['https://incident.example/one'] }, NOW);
  const parsed = validateCaseResponseReviewInputs(review);
  assert.deepEqual((parsed.escalationHistory as typeof record.actions)[0]!.responseObjects, record.actions[0]!.responseObjects);
  const historical = { ...review, version: 5 };
  assert.throws(() => validateCaseResponseReviewInputs(historical), /unsupported|unexpected|exact|field/i);
});
test('external password destination scalar preserves historical fingerprints and version-aware unknowns', () => {
  const input = { scanDepth: 'deep', capturedAt: NOW, riskModelVersion: 8, hasPasswordField: true, hasExternalFormAction: true };
  const old = normalizeSnapshot(input)!;
  const unknown = normalizeSnapshot({ ...input, hasExternalPasswordForm: null })!;
  assert.equal(unknown.fingerprint, old.fingerprint);
  const attributed = normalizeSnapshot({ ...input, capturedAt: AFTER, hasExternalPasswordForm: true })!;
  assert.notEqual(attributed.fingerprint, old.fingerprint);
  assert.equal(compareCaseEvidence(old, attributed).some(change => change.field === 'hasExternalPasswordForm'), false);
  const exportValue = buildCaseExport([createCase({ domain: 'incident.example', evidence: { ...input, hasExternalPasswordForm: true } }, NOW)], NOW);
  assert.throws(() => normalizeCaseStore({ ...exportValue, version: 17 }), /schema 18/);
});
