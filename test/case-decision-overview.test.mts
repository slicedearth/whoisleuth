import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCaseCompletionReview, buildCaseDecisionOverview, caseQuestionNextActions } from '../packages/cases/case-decision-overview.mts';
import { createCase } from '../packages/cases/case-model.mts';
import { caseRecheckComparisonWarnings } from '../packages/cases/case-recheck-model.mts';
import type { CaseEvidencePin, CaseDecisionRecord, CaseActionRecord } from '../packages/cases/case-response-records.mts';

const NOW = '2026-09-10T10:00:00.000Z';
const pin: CaseEvidencePin = { id: 'pin-one', checkpointId: null, field: 'http.status', category: 'http', label: 'Response status',
  value: '200', source: 'Retained HTTP observation', sourceState: 'complete', sourceSchema: null, observedAt: NOW,
  collectionDepth: 'deep', completeness: 'complete', truncated: false, transitionExpectation: null, limitations: [], createdAt: NOW };
const decision: CaseDecisionRecord = { id: 'decision-one', summary: 'Continue review', rationale: 'Conflicting observations',
  confidence: 'low', confidenceBasis: 'Limited independent evidence', evidencePinIds: ['pin-one', 'missing'], createdAt: NOW };

test('empty overview neither invents a question, judgement nor a scheduled review', () => {
  const record = createCase({ domain: 'review.example' }, NOW);
  const view = buildCaseDecisionOverview(record, NOW);
  assert.deepEqual(view, { claims: [], conclusions: [], earlierConclusions: 0, evidenceGaps: [], reviews: [] });
});

test('preserves explicit contrary, unresolved and unclassified evidence with independent source identities', () => {
  const record = createCase({ domain: 'review.example' }, NOW);
  record.evidencePins = [pin, { ...pin, id: 'pin-two', source: 'Separate imported observation', completeness: 'partial', truncated: true }];
  record.assertions = [{ id: 'claim', kind: 'hypothesis', statement: 'A question for review', rationale: null, state: 'open',
    evidencePinIds: ['pin-one', 'pin-two', 'missing'], evidenceRelations: [{ evidencePinId: 'pin-two', stance: 'contradicts' }, { evidencePinId: 'missing', stance: 'unresolved' }],
    createdAt: NOW, updatedAt: NOW }];
  const before = structuredClone(record);
  const view = buildCaseDecisionOverview(record, NOW);
  assert.deepEqual(view.claims[0]?.references.map(reference => [reference.id, reference.stance, reference.pin?.source ?? null]), [
    ['pin-one', null, 'Retained HTTP observation'], ['pin-two', 'contradicts', 'Separate imported observation'], ['missing', 'unresolved', null],
  ]);
  assert.deepEqual(view.evidenceGaps.map(value => value.id), ['pin-two']);
  assert.deepEqual(record, before);
});

test('keeps equally timed conclusions, missing links and newer evidence visible', () => {
  const record = createCase({ domain: 'review.example' }, NOW);
  record.evidencePins = [{ ...pin, createdAt: '2026-09-10T11:00:00.000Z' }];
  record.decisions = [{ ...decision, id: 'earlier', createdAt: '2026-09-09T10:00:00.000Z' }, decision, { ...decision, id: 'same-time', summary: 'Different reasoning' }];
  const view = buildCaseDecisionOverview(record, NOW);
  assert.deepEqual(view.conclusions.map(value => value.decision.id), ['decision-one', 'same-time']);
  assert.equal(view.earlierConclusions, 1);
  assert.ok(view.conclusions.every(value => value.evidenceAddedLater));
  assert.equal(view.conclusions[0]?.references[1]?.pin, null);
});

test('undated and unavailable observations remain gaps even when a producer calls the pin complete', () => {
  const record = createCase({ domain: 'review.example' }, NOW);
  record.evidencePins = [{ ...pin, observedAt: null }, { ...pin, id: 'failed', sourceState: 'unavailable' }, { ...pin, id: 'cut', truncated: true }];
  assert.deepEqual(buildCaseDecisionOverview(record, NOW).evidenceGaps.map(value => value.id), ['pin-one', 'failed', 'cut']);
});

test('decision and recheck views retain the same collection-quality boundary without conflating dates', () => {
  const record = createCase({ domain: 'review.example' }, NOW);
  const context = { targetHostname: 'review.example', baselinePinId: null, conditions: 'Same page',
    questionId: 'question', question: 'Still present?', conditionsMatch: 'comparable' as const };
  for (const sourceState of ['complete', 'success', 'reviewed', 'not_found', 'unavailable', 'skipped', null]) {
    for (const completeness of ['complete', 'partial'] as const) {
      for (const truncated of [false, true]) {
        const current = { ...pin, sourceState, completeness, truncated, observationHostname: 'review.example' };
        record.evidencePins = [current];
        const complete = ['complete', 'success', 'reviewed', 'not_found'].includes(sourceState ?? '') && completeness === 'complete' && !truncated;
        assert.equal(buildCaseDecisionOverview(record, NOW).evidenceGaps.length, complete ? 0 : 1);
        assert.equal(caseRecheckComparisonWarnings(context, [current], current).length, complete ? 0 : 1);
      }
    }
  }
  const undated = { ...pin, observedAt: null, observationHostname: 'review.example' };
  record.evidencePins = [undated];
  assert.equal(buildCaseDecisionOverview(record, NOW).evidenceGaps.length, 1);
  assert.deepEqual(caseRecheckComparisonWarnings(context, [undated], undated), []);
});

test('manual acknowledgement schedules follow-up without implying removal or altering evidence', () => {
  const record = createCase({ domain: 'review.example' }, NOW);
  const action: CaseActionRecord = { id: 'action', type: 'registrar_report', recipient: 'Reviewed recipient', contactSource: 'Manual contact',
    routeObservedAt: NOW, routeReviewAfter: null, contactLimitations: [], dueAt: null, state: 'acknowledged', reference: 'Manual receipt',
    followUpAt: '2026-09-10T10:01:00.000Z', providerOutcome: 'accepted_for_review', outcome: 'Acknowledged', originActionId: null,
    history: [], historyOmitted: 0, historyLimitations: [], createdAt: NOW, metadataUpdatedAt: NOW, updatedAt: NOW };
  record.actions = [action, { ...action, id: 'historical', state: 'terminal', followUpAt: '2026-09-01T00:00:00Z' }];
  const before = structuredClone(record);
  const first = buildCaseDecisionOverview(record, NOW);
  assert.equal(first.reviews.length, 1); assert.equal(first.reviews[0]?.due, false);
  assert.equal(buildCaseDecisionOverview(record, '2026-09-10T10:01:00Z').reviews[0]?.due, true);
  assert.equal(buildCaseDecisionOverview(record, 'not a timestamp').reviews[0]?.due, null);
  assert.deepEqual(record, before); assert.equal(record.observedEffects.reviews.length, 0);
});

test('question reviews are scoped, deterministic and leave further reviews reachable without changing a Case', () => {
  const record = createCase({ domain: 'review.example' }, NOW);
  record.evidencePins = [pin, { ...pin, id: 'limited', completeness: 'partial', observedAt: null }, { ...pin, id: 'unrelated', sourceState: 'unavailable' }];
  record.assertions = [{ id: 'question', kind: 'hypothesis', statement: 'Which observation applies?', rationale: null, state: 'open',
    evidencePinIds: ['missing', 'pin-one', 'limited', 'limited'], evidenceRelations: [{ evidencePinId: 'limited', stance: 'contradicts' }], createdAt: NOW, updatedAt: NOW },
  { id: 'other', kind: 'hypothesis', statement: 'A separate question', rationale: null, state: 'open', evidencePinIds: ['pin-one'],
    evidenceRelations: [{ evidencePinId: 'pin-one', stance: 'supports' }], createdAt: NOW, updatedAt: NOW }];
  const before = structuredClone(record);
  const overview = buildCaseDecisionOverview(record, NOW);
  const next = caseQuestionNextActions(overview, 'question');
  assert.deepEqual(next.actions.map(action => action.id), ['links', 'relationships', 'observations']);
  assert.deepEqual(next.further.map(action => action.id), ['classification']);
  assert.match(next.actions[2]!.reason, /^1 linked observation is/);
  assert.ok(next.actions.every(action => action.prerequisite && action.limitation && action.expectedOutcome));
  assert.deepEqual(caseQuestionNextActions(overview, 'other'), { actions: [], further: [] });
  assert.deepEqual(caseQuestionNextActions(overview, 'missing'), { actions: [], further: [] });
  assert.deepEqual(record, before);
  record.assertions[0]!.state = 'resolved';
  assert.deepEqual(caseQuestionNextActions(buildCaseDecisionOverview(record, NOW), 'question'), { actions: [], further: [] });
});

test('an unlinked assessment receives a local review, not an invented source or collection instruction', () => {
  const record = createCase({ domain: 'review.example' }, NOW);
  record.assertions = [{ id: 'question', kind: 'hypothesis', statement: 'Does the report apply?', rationale: null, state: 'open',
    evidencePinIds: [], createdAt: NOW, updatedAt: NOW }];
  const next = caseQuestionNextActions(buildCaseDecisionOverview(record, NOW), 'question');
  assert.deepEqual(next.actions.map(action => [action.id, action.section]), [['links', 'assessment']]);
  assert.match(next.actions[0]!.reason, /No evidence is linked/);
  assert.deepEqual(next.further, []);
});

test('completion review does not invent closure readiness, open objects or missing files for an empty Case', () => {
  const record = createCase({ domain: 'review.example' }, NOW);
  const before = structuredClone(record);
  assert.deepEqual(buildCaseCompletionReview(record, NOW), {
    openObjects: [], otherObjects: [], opposingClaims: [], reviews: [], requests: [],
  });
  assert.deepEqual(record, before);
});

test('completion review keeps current incident state distinct from resolved, historical and domain scopes', () => {
  const record = createCase({ domain: 'review.example' }, NOW);
  record.workflowMetadata = { types: [], investigationContext: null, incidentTargets: [
    { id: 'open-link', url: 'https://review.example/open', state: 'open', createdAt: NOW, updatedAt: NOW },
    { id: 'resolved-link', url: 'https://review.example/resolved', state: 'resolved', createdAt: NOW, updatedAt: NOW },
  ] };
  record.evidencePins = [
    { ...pin, id: 'current', responseObject: { kind: 'page', identifier: 'https://review.example/open', incidentTargetId: 'open-link' } },
    { ...pin, id: 'resolved', responseObject: { kind: 'page', identifier: 'https://review.example/resolved', incidentTargetId: 'resolved-link' } },
    { ...pin, id: 'historical', responseObject: { kind: 'page', identifier: 'https://review.example/earlier', incidentTargetId: 'old-link' } },
    { ...pin, id: 'domain', responseObject: { kind: 'domain', identifier: 'review.example', incidentTargetId: null } },
  ];
  record.status = 'resolved'; // Whole-Case status does not rewrite current object metadata.
  const before = structuredClone(record);
  const review = buildCaseCompletionReview(record, NOW);
  assert.deepEqual(review.openObjects.map(row => [row.object.identifier, row.target.state]), [['https://review.example/open', 'open']]);
  assert.deepEqual(review.otherObjects.map(row => [row.object.identifier, row.targetRetained]), [
    ['https://review.example/earlier', false], ['review.example', false],
  ]);
  assert.deepEqual(record, before);
});

test('completion review preserves exact contrary and unavailable links without reopening resolved assessments', () => {
  const record = createCase({ domain: 'review.example' }, NOW);
  record.evidencePins = [pin];
  const assertion = { id: 'open-question', kind: 'hypothesis' as const, statement: 'Which source describes the page?', rationale: null,
    state: 'open' as const, evidencePinIds: ['pin-one', 'missing'], evidenceRelations: [
      { evidencePinId: 'pin-one', stance: 'contradicts' as const }, { evidencePinId: 'missing', stance: 'unresolved' as const },
    ], createdAt: NOW, updatedAt: NOW };
  record.assertions = [assertion, { ...assertion, id: 'resolved-question', state: 'resolved' },
    { ...assertion, id: 'supporting-question', evidencePinIds: ['pin-one'], evidenceRelations: [{ evidencePinId: 'pin-one', stance: 'supports' }] }];
  const before = structuredClone(record);
  const review = buildCaseCompletionReview(record, NOW);
  assert.deepEqual(review.opposingClaims.map(claim => claim.assertion.id), ['open-question']);
  assert.deepEqual(review.opposingClaims[0]!.references.map(reference => [reference.id, reference.stance, reference.pin?.source ?? null]), [
    ['pin-one', 'contradicts', 'Retained HTTP observation'], ['missing', 'unresolved', null],
  ]);
  assert.deepEqual(record, before);
});
