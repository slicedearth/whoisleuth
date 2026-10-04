import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createCase, updateCase, buildCaseExport, projectCaseForAudience, normalizeCaseStore, serializeCaseStore } from '../packages/cases/case-model.mts';
import { buildCaseIncidentCoverage } from '../packages/cases/case-workflow-metadata.mts';
import { caseResponseObjectChoices, selectedCaseResponseObject, readCaseResponseObject, readCaseResponseObjects } from '../packages/cases/case-response-object.mts';
import { caseRecheckComparisonBlockers, caseRecheckAnswerContext, assertCaseObjectObservationOutcome } from '../packages/cases/case-recheck-model.mts';
import { buildCaseReport } from '../packages/cases/case-report.mts';
import { buildCaseResponseReviewInputs, validateCaseResponseReviewInputs } from '../packages/cases/case-response-packet.mts';
import { normalizeSnapshot, compareCaseEvidence } from '../packages/cases/case-evidence-model.mts';
import { caseClosureProviderBlocker, caseClosureActionBlocker } from '../packages/cases/case-response-outcomes.mts';
const NOW = '2026-09-01T10:00:00.000Z', AFTER = '2026-09-02T10:00:00.000Z';
function scoped() {
  let record = createCase({ domain: 'incident.example', incidentTarget: 'https://incident.example/one' }, NOW);
  record = updateCase([record], record.id, { incidentTarget: 'https://incident.example/two' }, NOW).record;
  const objects = record.workflowMetadata!.incidentTargets.map(target => ({ kind: 'page' as const, identifier: target.url, incidentTargetId: target.id }));
  record = updateCase([record], record.id, { action: { type: 'network_hosting_report', recipient: 'Example hosting desk', contactSource: 'Analyst reviewed route', responseObjects: objects } }, NOW).record;
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
test('unavailable is not removal; procedural dispute retains independent history without a technical state change', () => {
  let { record, objects } = scoped();
  assert.throws(() => updateCase([record], record.id, { observedEffectReview: { state: 'unavailable', source: 'Failed manual review', responseObject: objects[0], objectOutcome: 'removed' } }, AFTER), /unavailable|observed|baseline/i);
  assert.throws(() => updateCase([record], record.id, { observedEffectReview: { state: 'changed', observedAt: AFTER, sourceClass: 'analyst', source: 'Limited manual review', completeness: 'partial', responseObject: objects[0], objectOutcome: 'restored' } }, AFTER), /exact-object baseline|complete evidence/);
  record = updateCase([record], record.id, { observedEffectReview: { state: 'still_observed', observedAt: AFTER, sourceClass: 'analyst', source: 'Dispute correspondence reviewed', completeness: 'partial', responseObject: objects[0], objectOutcome: 'disputed' } }, AFTER).record;
  assert.deepEqual(record.observedEffects.reviews.map(review => review.objectOutcome), ['disputed']);
  const rows = buildCaseIncidentCoverage(record);
  assert.equal(rows[0]!.observationCoverage, 'available');
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
  for (const outcome of ['removed', 'restricted', 'suspended', 'delisted', 'transferred', 'restored'] as const) {
    assert.doesNotThrow(() => assertCaseObjectObservationOutcome(outcome, answer, 'complete', [baseline], { ...current, responseObject: objects[0]! }, AFTER));
    assert.throws(() => assertCaseObjectObservationOutcome(outcome, answer, 'partial', [baseline], { ...current, responseObject: objects[0]! }, AFTER), /complete|comparison/);
    assert.throws(() => assertCaseObjectObservationOutcome(outcome, { ...answer, conditionsMatch: 'different' }, 'complete', [baseline], { ...current, responseObject: objects[0]! }, AFTER), /comparable|comparison/);
    assert.throws(() => assertCaseObjectObservationOutcome(outcome, answer, 'complete', [{ ...baseline, completeness: 'partial' }], { ...current, responseObject: objects[0]! }, AFTER), /complete|comparison/);
  }
  const { responseObject: _object, ...unboundBaseline } = baseline;
  assert.ok(caseRecheckComparisonBlockers(answer, [unboundBaseline], { ...current, responseObject: objects[0]! }).includes('baseline_object_mismatch'));
});
test('retained historical URL snapshots stay visible without binding to changed or missing metadata', () => {
  const { record: sent, objects } = submitted();
  const record = transition(sent, 'acknowledged', { sourceClass: 'provider', providerOutcome: 'provider_reports_resolved', responseObjects: [objects[0]], objectOutcome: 'removed' });
  const changed = { ...record, workflowMetadata: { ...record.workflowMetadata!, incidentTargets: [{ ...record.workflowMetadata!.incidentTargets[0]!, url: 'https://incident.example/replacement' }] } };
  const rows = buildCaseIncidentCoverage(changed);
  const historical = rows.find(row => row.responseObject.identifier === objects[0]!.identifier)!;
  assert.equal(historical.targetRetained, false);
  assert.equal(historical.providerEvents.at(-1)?.outcome, 'removed');
  const choice = caseResponseObjectChoices(changed).find(choice => choice.value === JSON.stringify(objects[0]))!;
  assert.match(choice.label, /historical/);
  assert.deepEqual(selectedCaseResponseObject(changed, choice.value), objects[0]);
  const later = transition(changed, 'terminal', { sourceClass: 'provider', responseObjects: [objects[0]], objectOutcome: 'restored', providerOutcome: 'partially_remediated' });
  assert.equal(buildCaseIncidentCoverage(later).find(row => row.responseObject.identifier === objects[0]!.identifier)!.providerEvents.at(-1)?.outcome, 'restored');
  assert.throws(() => transition(changed, 'terminal', { sourceClass: 'provider', responseObjects: [{ ...objects[0], identifier: 'https://incident.example/arbitrary' }], objectOutcome: 'removed' }), /changed|not retained/);
  const replacement = rows.find(row => row.responseObject.identifier === 'https://incident.example/replacement')!;
  assert.equal(replacement.targetRetained, true);
  assert.equal(replacement.providerEvents.length, 0);
  assert.equal(replacement.actionCoverage, 'unknown');
  assert.equal(buildCaseIncidentCoverage({ ...record, workflowMetadata: { ...record.workflowMetadata!, incidentTargets: [] } }).length, 2);
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
test('new object-specific technical closures reject unbound reviews without re-adjudicating legacy whole-Case closure', () => {
  const responseObject = { kind: 'domain' as const, identifier: 'incident.example', incidentTargetId: null };
  for (const [reason, state] of [['independently_not_reproduced', 'not_reproduced'], ['infrastructure_changed', 'changed']] as const) {
    const record = createCase({ domain: 'incident.example', observedEffectReview: { state, sourceClass: 'analyst', source: 'Retained legacy review', observedAt: NOW, completeness: 'complete' } }, NOW);
    const closure = { reason, summary: 'Review the retained technical observation.', observedEffectReviewId: record.observedEffects.reviews[0]!.id };
    const original = JSON.stringify(record);
    assert.throws(() => updateCase([record], record.id, { closure: { ...closure, responseObject } }, AFTER), /explicitly bound.*exact object/);
    assert.equal(JSON.stringify(record), original);
    assert.equal(updateCase([record], record.id, { closure }, AFTER).record.status, 'resolved');
    const retained = { ...record, closures: { ...record.closures, records: [{ ...closure, responseObject, id: 'retained-object-closure', actionId: null, limitations: [], createdAt: AFTER }] } };
    const restored = normalizeCaseStore(buildCaseExport([retained], AFTER)).cases[0]!;
    assert.deepEqual(restored.closures.records, retained.closures.records);
  }
});

test('provider closure follows the latest exact-object cohort, independently of other objects', () => {
  const { record: sent, objects } = submitted();
  const first = '2026-09-03T10:00:00.000Z', second = '2026-09-04T10:00:00.000Z', third = '2026-09-05T10:00:00.000Z', closedAt = '2026-09-06T10:00:00.000Z';
  const event = (record: typeof sent, object: typeof objects[number], providerOutcome: string, occurredAt: string, objectOutcome?: string) => transition(record, 'acknowledged', { sourceClass: 'provider', responseObjects: [object], providerOutcome, occurredAt, ...(objectOutcome ? { objectOutcome } : {}) });
  const resolved = event(sent, objects[0]!, 'provider_reports_resolved', first, 'removed');
  const unrelated = event(resolved, objects[1]!, 'partially_remediated', second);
  assert.equal(unrelated.actions[0]!.providerOutcome, 'partially_remediated');
  assert.equal(caseClosureProviderBlocker(unrelated.actions[0], objects[0], closedAt), null);
  assert.equal(caseClosureActionBlocker('risk_accepted', unrelated.actions[0], objects[0], closedAt), null);
  assert.notEqual(caseClosureActionBlocker('risk_accepted', unrelated.actions[0], undefined, closedAt), null);
  assert.notEqual(caseClosureActionBlocker('risk_accepted', unrelated.actions[0], { kind: 'domain', identifier: sent.domain, incidentTargetId: null }, closedAt), null);
  const closure = { reason: 'provider_reported_resolution_not_independently_checked', summary: 'Reviewed latest exact-object provider receipt', actionId: sent.actions[0]!.id, responseObject: objects[0] };
  const closed = updateCase([unrelated], unrelated.id, { closure }, closedAt).record;
  assert.equal(closed.closures.records.length, 1);
  assert.equal(closed.status, sent.status);
  assert.equal(closed.workflowMetadata!.incidentTargets[1]!.state, 'open');
  const restored = event(resolved, objects[0]!, 'partially_remediated', second, 'restored');
  const otherResolved = event(restored, objects[1]!, 'provider_reports_resolved', third);
  assert.equal(otherResolved.actions[0]!.providerOutcome, 'provider_reports_resolved');
  assert.throws(() => updateCase([otherResolved], otherResolved.id, { closure }, closedAt), /latest applicable/);
  assert.equal(caseClosureProviderBlocker(otherResolved.actions[0], objects[1], closedAt), null);
  assert.equal(caseClosureProviderBlocker(otherResolved.actions[0], objects[0], first), null);
  assert.notEqual(caseClosureProviderBlocker(otherResolved.actions[0], objects[0], AFTER), null);
  const action = structuredClone(resolved.actions[0]!);
  const receipt = action.history.at(-1)!;
  action.history.push({ ...receipt, id: 'conflicting-same-time', providerOutcome: 'partially_remediated', objectOutcome: 'restored' });
  assert.notEqual(caseClosureProviderBlocker(action, objects[0], closedAt), null);
  const unbound = { ...resolved.actions[0]!, history: resolved.actions[0]!.history.map(({ responseObjects: _scope, ...row }) => row) };
  assert.notEqual(caseClosureProviderBlocker(unbound, objects[0], closedAt), null);
  assert.notEqual(caseClosureProviderBlocker(resolved.actions[0], undefined, closedAt), null);
  const { responseObjects: _bindings, ...wholeCaseAction } = unbound;
  assert.equal(caseClosureProviderBlocker(wholeCaseAction, undefined, closedAt), null);
  assert.deepEqual(normalizeCaseStore(buildCaseExport([closed], closedAt)).cases[0]!.closures.records, closed.closures.records);
});

test('partial provider outcomes require an explicit nonempty affected scope while acknowledgements remain administrative', () => {
  const { record, objects } = submitted();
  for (const scope of [undefined, []]) assert.throws(() => transition(record, 'acknowledged', { sourceClass: 'provider', providerOutcome: 'partially_remediated', ...(scope ? { responseObjects: scope } : {}) }), /Explicitly select/);
  for (const responseObjects of [[objects[0]], objects]) {
    const changed = transition(record, 'acknowledged', { sourceClass: 'provider', providerOutcome: 'partially_remediated', responseObjects });
    const restored = normalizeCaseStore(buildCaseExport([changed], AFTER)).cases[0]!;
    assert.deepEqual(restored.actions[0]!.history.at(-1)!.responseObjects, responseObjects);
  }
  assert.doesNotThrow(() => transition(record, 'acknowledged', { sourceClass: 'provider' }));
});
test('scoped changed closure requires complete later same-object comparison evidence', () => {
  const responseObject = { kind: 'domain' as const, identifier: 'incident.example', incidentTargetId: null };
  const observation = { field: 'http.status', label: 'Baseline', value: '200', source: 'Retained fixture observation', sourceState: 'complete', completeness: 'complete', observedAt: NOW, observationHostname: 'incident.example', responseObject };
  let record = createCase({ domain: 'incident.example', evidencePin: observation }, NOW);
  const baseline = record.evidencePins[0]!;
  record = updateCase([record], record.id, { evidencePin: { ...observation, label: 'Current', value: '404', observedAt: AFTER } }, AFTER).record;
  const current = record.evidencePins.find(pin => pin.label === 'Current')!;
  record = updateCase([record], record.id, { assertion: { kind: 'next_step', statement: 'Did this exact condition change?', recheck: { responseObject, targetHostname: 'incident.example', baselinePinId: baseline.id, conditions: 'Same retained unauthenticated response condition.' } } }, NOW).record;
  const context = caseRecheckAnswerContext(record.assertions[0]!, 'comparable');
  record = updateCase([record], record.id, { observedEffectReview: { state: 'changed', observedAt: AFTER, sourceClass: 'analyst', source: observation.source, completeness: 'complete', responseObject, evidencePinId: current.id, recheck: context } }, AFTER).record;
  const review = record.observedEffects.reviews[0]!;
  const closure = { reason: 'infrastructure_changed', summary: 'A source-qualified exact-object change was reviewed.', observedEffectReviewId: review.id, responseObject };
  assert.equal(updateCase([record], record.id, { closure }, AFTER).record.closures.records.length, 1);
  const variants = [
    { ...record, observedEffects: { ...record.observedEffects, reviews: [{ ...review, completeness: 'partial' as const }] } },
    { ...record, observedEffects: { ...record.observedEffects, reviews: [{ ...review, recheck: { ...context, conditionsMatch: 'different' as const } }] } },
    { ...record, evidencePins: record.evidencePins.map(pin => pin.id === baseline.id ? { ...pin, completeness: 'partial' as const } : pin) },
    { ...record, evidencePins: record.evidencePins.filter(pin => pin.id !== current.id) },
    { ...record, evidencePins: record.evidencePins.map(pin => pin.id === current.id ? { ...pin, observedAt: NOW } : pin) },
  ];
  for (const invalid of variants) assert.throws(() => updateCase([invalid], invalid.id, { closure }, AFTER), /complete observation under comparable conditions/);
  const { recheck: _context, ...unplanned } = review;
  assert.throws(() => updateCase([{ ...record, observedEffects: { ...record.observedEffects, reviews: [unplanned] } }], record.id, { closure }, AFTER), /complete exact-object baseline/);
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
