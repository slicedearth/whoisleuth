import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCaseDecisionOverview } from '../packages/cases/case-decision-overview.mts';
import { createCase } from '../packages/cases/case-model.mts';
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
