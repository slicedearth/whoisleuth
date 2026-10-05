import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCasePracticeRecord, casePracticeDefinition, casePracticeIdentityReview, CASE_PRACTICE_OBSERVED_AT, CASE_PRACTICE_LATER_AT, CASE_PRACTICE_JOURNEY_AT } from '../frontend/src/lib/analysis/case-practice.ts';
import { updateCase, buildCaseExport, mergeCases } from '../packages/cases/case-model.mts';
import { caseIncidentTargets } from '../packages/cases/case-workflow-metadata.mts';
import { buildCaseIncidentCoverage } from '../packages/cases/case-object-coverage.mts';
import { buildCaseResponseReadiness } from '../packages/cases/case-response-packet.mts';
import { caseRecheckAnswerContext, caseRecheckComparisonBlockers } from '../packages/cases/case-recheck-model.mts';
import { compareCaseAssertions } from '../packages/cases/case-assessment-comparison.mts';
import { caseSelectedEvidenceSourceLimitations, CASE_SELECTED_EVIDENCE_SOURCE_LIMITATION } from '../packages/cases/case-evidence-links.mts';
import { latestEvidenceRequests, submittedPacketReceipts } from '../packages/cases/case-requested-evidence.mts';
import { reviewIdentityIncident } from '../packages/investigation/identity-incident-review.mts';

test('compromised-path practice keeps the root, control assessment and infrastructure readiness separate', () => {
  const record = createCasePracticeRecord('compromised-page');
  assert.deepEqual(caseIncidentTargets(record).map(item => item.url), ['https://publisher.example/old-guide']);
  const root = record.evidencePins.find(pin => pin.label === 'Separate ordinary root-page capture')!;
  const control = record.evidencePins.find(pin => pin.label === 'Control assessment remains unresolved')!;
  assert.notEqual(root.id, record.evidencePins[0]!.id);
  assert.equal(control.observedAt, null);
  assert.match(control.limitations.join(' '), /hypothesis, not verified compromise/iu);
  assert.match(casePracticeDefinition('compromised-page').assessment, /Registration age, valid TLS and provider reputation/u);
  for (const profile of ['registrar', 'registry', 'network_hosting']) {
    const row = buildCaseResponseReadiness(record, { profile, selectedEvidencePinIds: [root.id] }, CASE_PRACTICE_LATER_AT)
      .rows.find(item => item.id === 'infrastructure_responsibility')!;
    assert.equal(row.requiredForAuthorisation, true);
    assert.equal(row.state, 'not_provided');
  }
  const assessed = updateCase([record], record.id, { assertion: { kind: 'hypothesis', statement: 'The supplied administrator account supports a possible unauthorised path change.',
    rationale: 'Analyst assessment limited to the reported path; control remains unverified.', evidenceRelations: [{ evidencePinId: control.id, stance: 'supports' }] } }, CASE_PRACTICE_LATER_AT).record;
  assert.deepEqual(assessed.evidencePins, record.evidencePins);
  assert.equal(assessed.disposition, 'unreviewed');
});

test('shared-platform practice retains unrelated tenants and redirect uncertainty without widening response scope', () => {
  const record = createCasePracticeRecord('hosted-object');
  const unrelated = record.evidencePins.find(pin => pin.label === 'Unrelated tenant with shared infrastructure')!;
  assert.match(unrelated.value, /edge address, nameserver, certificate and template/u);
  assert.match(unrelated.limitations.join(' '), /does not establish common control/u);
  assert.deepEqual(caseIncidentTargets(record).map(item => item.url), ['https://hosted.example/forms/object-seven']);
  assert.equal(record.actions.length, 0);
  assert.ok(buildCaseIncidentCoverage(record).every(row => row.actionCoverage === 'unknown' && row.observationCoverage === 'unknown'));
  assert.match(record.evidencePins.find(pin => pin.label === 'Redirect and destination remain distinct')!.limitations.join(' '), /not automatically the final destination/u);
});

test('multi-brand practice preserves earlier source observations when another association is deliberately retained', () => {
  const record = createCasePracticeRecord('related-hosts');
  const first = record.evidencePins.find(pin => pin.label === 'Service A identity claim')!;
  const second = record.evidencePins.find(pin => pin.label === 'Service B identity claim')!;
  assert.notEqual(first.source, second.source);
  assert.equal(first.observedAt, CASE_PRACTICE_OBSERVED_AT);
  assert.equal(second.observedAt, CASE_PRACTICE_LATER_AT);
  const earlier = structuredClone(record);
  const next = updateCase([record], record.id, { brandProfileIds: [...record.brandProfileIds, 'practice-service-c'],
    evidencePin: { label: 'Later Service C claim', value: 'A supplied later observation makes another affected-identity claim.', source: 'Fictional Service C capture',
      observedAt: CASE_PRACTICE_JOURNEY_AT, completeness: 'partial', limitations: ['No common control is established by the shared parent.'] } }, CASE_PRACTICE_JOURNEY_AT).record;
  const restored = mergeCases([], buildCaseExport([next], CASE_PRACTICE_JOURNEY_AT)).cases[0]!;
  assert.deepEqual(restored.brandProfileIds, [...earlier.brandProfileIds, 'practice-service-c']);
  assert.deepEqual(restored.evidencePins.slice(0, earlier.evidencePins.length), earlier.evidencePins);
  assert.deepEqual(restored.assertions, earlier.assertions);
  assert.deepEqual(record, earlier);
});

test('residual-object practice does not turn a landing-page account into ad or replacement closure', () => {
  const record = createCasePracticeRecord('ad-redirect');
  const before = structuredClone(record);
  const rows = buildCaseIncidentCoverage(record);
  assert.deepEqual(rows.map(row => row.target.url), ['https://distribution.example/ad/7', 'https://landing.example/offer', 'https://replacement.example/offer']);
  assert.ok(rows.every(row => row.observationCoverage === 'unknown' && row.closures.length === 0));
  assert.match(record.evidencePins.find(pin => pin.label === 'Replacement and advertisement remain unresolved')!.limitations.join(' '), /not a verified navigation event/u);
  assert.match(casePracticeDefinition('ad-redirect').assessment, /do not measure campaign elimination or reduced harm/u);
  assert.equal(record.status, 'new');
  assert.deepEqual(record, before);
});

test('conditional-capture practice retains both scopes and rejects different or unknown conditions as non-reproduction', () => {
  const record = createCasePracticeRecord('conditional-presentation');
  const mobile = record.evidencePins.find(pin => pin.label === 'Supplied mobile exact-path capture')!;
  const desktop = record.evidencePins.find(pin => pin.label === 'Different desktop root capture')!;
  assert.notEqual(mobile.source, desktop.source);
  assert.notEqual(mobile.observedAt, desktop.observedAt);
  const question = { ...record.assertions[0]!, recheck: { ...record.assertions[0]!.recheck!, baselinePinId: mobile.id } };
  for (const conditions of ['different', 'unknown'] as const) {
    const blockers = caseRecheckComparisonBlockers(caseRecheckAnswerContext(question, conditions), record.evidencePins, desktop);
    assert.ok(blockers.includes(conditions === 'different' ? 'different_conditions' : 'unconfirmed_conditions'));
    assert.ok(blockers.includes('different_field_or_source'));
  }
  assert.deepEqual(record.observedEffects.reviews, []);
});

test('identity practice distinguishes seven supplied mechanisms without confirming exposure or collecting authentication material', () => {
  const { stages, review } = casePracticeIdentityReview();
  assert.deepEqual(stages.map(stage => stage.id), ['password', 'approval', 'device-code', 'session', 'consent', 'installation', 'support-call']);
  assert.equal(stages.find(stage => stage.id === 'approval')!.basis, 'retained_observation');
  assert.equal(stages.find(stage => stage.id === 'session')!.basis, 'imported_record');
  assert.ok(stages.filter(stage => !['approval', 'session'].includes(stage.id)).every(stage => stage.basis === 'reported_action'));
  assert.ok(stages.every(stage => stage.referenceSha256 === null && stage.completeness === 'partial'));
  assert.equal(review.state, 'partial');
  assert.equal(Object.hasOwn(review, 'verdict'), false);
  const record = createCasePracticeRecord('identity-actions');
  assert.equal(record.evidencePins.length, 9);
  assert.deepEqual(record.observedEffects.reviews, []);
  assert.match(casePracticeDefinition('identity-actions').assessment, /without a password form is not necessarily safe/u);
  const consent = reviewIdentityIncident({ reportedActions: ['granted_consent'] });
  assert.ok(consent.nextSteps.some(step => step.id === 'grants'));
  assert.equal(consent.nextSteps.some(step => step.id === 'password'), false);
});

test('trust-claim practice compares retained explanations without converting organisation existence into endorsement or fraud', () => {
  const record = createCasePracticeRecord('trust-claim');
  const explanations = record.assertions.filter(item => item.kind === 'hypothesis');
  assert.equal(explanations.length, 2);
  const comparison = compareCaseAssertions(record.evidencePins, explanations[0]!, explanations[1]!);
  assert.equal(comparison.rows.length, 2);
  assert.ok(comparison.rows.every(row => row.left === 'unresolved' || row.right === 'unresolved'));
  const existence = record.evidencePins.find(pin => pin.label === 'Organisation-existence scope')!;
  assert.equal(comparison.rows.some(row => row.id === existence.id), false);
  assert.match(existence.limitations.join(' '), /not confirmation of this campaign/u);
  assert.equal(record.disposition, 'unreviewed');
  assert.equal(record.decisions.length, 0);
});

test('packet-sufficiency practice leaves logo and edge evidence qualified and preserves requested, prepared and unavailable history', () => {
  const record = createCasePracticeRecord('requested-amendment');
  const logo = record.evidencePins.find(pin => pin.label === 'Logo-only supplied image account')!;
  const edge = record.evidencePins.find(pin => pin.label === 'Observed edge, origin not established')!;
  assert.match(logo.limitations.join(' '), /logo alone does not establish credential collection/u);
  assert.match(edge.limitations.join(' '), /does not establish origin responsibility/u);
  const readiness = buildCaseResponseReadiness(record, { profile: 'network_hosting', selectedEvidencePinIds: [logo.id, edge.id] }, CASE_PRACTICE_LATER_AT);
  assert.equal(readiness.rows.find(row => row.id === 'observed_behaviour')!.state, 'not_provided');
  assert.equal(readiness.rows.find(row => row.id === 'infrastructure_responsibility')!.state, 'not_provided');
  const original = structuredClone(record.actions[0]!);
  const requested = latestEvidenceRequests(original)[0]!;
  const apply = (current: typeof record, state: 'prepared' | 'unavailable', evidencePinIds: string[]) => updateCase([current], current.id, { actionUpdate: { id: original.id,
    transition: { nextState: 'acknowledged', sourceClass: 'analyst', provenance: 'Fictional evidence preparation', evidenceRequest: {
      ...requested.evidenceRequest, state, evidencePinIds, rationale: state === 'prepared' ? 'The supplied earlier exact-page pin is prepared; no new observation is claimed.' : 'A complete later exact-page capture is unavailable.',
      previousEventIds: latestEvidenceRequests(current.actions[0]!).map(event => event.id),
    } } } }, CASE_PRACTICE_JOURNEY_AT).record;
  const prepared = apply(record, 'prepared', [record.evidencePins.find(pin => pin.label === 'Requested exact-page evidence')!.id]);
  const unavailable = apply(prepared, 'unavailable', []);
  assert.deepEqual(unavailable.actions[0]!.history.slice(0, original.history.length), original.history);
  assert.deepEqual(unavailable.actions[0]!.history.flatMap(event => event.evidenceRequest ? [event.evidenceRequest.state] : []).sort(), ['prepared', 'requested', 'unavailable']);
  assert.equal(latestEvidenceRequests(unavailable.actions[0]!)[0]!.evidenceRequest.state, 'unavailable', 'Causal request links, not tied event array order, determine the current state.');
  assert.equal(submittedPacketReceipts(unavailable.actions[0]!)[0]!.digestSha256, submittedPacketReceipts(original)[0]!.digestSha256);
  assert.deepEqual(unavailable.evidencePins, record.evidencePins);
});

test('source-reuse practice retains declared reuse alongside separate and unknown-method observations without adding a verdict', () => {
  const record = createCasePracticeRecord('dependent-sources');
  const provider = record.evidencePins.find(pin => pin.label === 'Provider explicitly reused the report')!;
  const distinct = record.evidencePins.find(pin => pin.label === 'Separately documented page observation')!;
  const unknown = record.evidencePins.find(pin => pin.label === 'Provider collection method unknown')!;
  assert.equal(record.evidenceLinks!.length, 1);
  assert.equal(record.evidenceLinks![0]!.fromPinId, provider.id);
  assert.equal(record.evidenceLinks![0]!.toPinId, record.evidencePins[0]!.id);
  assert.deepEqual(caseSelectedEvidenceSourceLimitations(record.evidencePins, record.evidenceLinks, [provider.id]), [CASE_SELECTED_EVIDENCE_SOURCE_LIMITATION]);
  assert.deepEqual(caseSelectedEvidenceSourceLimitations(record.evidencePins, record.evidenceLinks, [distinct.id, unknown.id]), []);
  assert.equal(unknown.observedAt, null);
  assert.equal(record.disposition, 'unreviewed');
  assert.deepEqual(record.decisions, []);
});
