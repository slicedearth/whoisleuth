import assert from 'node:assert/strict';
import test from 'node:test';
import { caseRequestedEvidenceQueue, caseResponseQueue } from '../packages/cases/case-response-queue.mts';
import { createCase } from '../packages/cases/case-model.mts';
import type { CaseActionRecord, CaseObservedEffectReview } from '../packages/cases/case-response-records.mts';

const NOW = '2026-09-10T10:00:00.000Z';
const action: CaseActionRecord = { id: 'active', type: 'registrar_report', recipient: 'Reviewed recipient', contactSource: 'Retained route',
  routeObservedAt: NOW, routeReviewAfter: '2026-09-10T10:01:00Z', contactLimitations: [], dueAt: null, state: 'acknowledged',
  reference: 'Manual receipt', followUpAt: '2026-09-10T10:01:00Z', providerOutcome: 'accepted_for_review', outcome: 'Acknowledged',
  originActionId: null, history: [], historyOmitted: 0, historyLimitations: [], createdAt: NOW, metadataUpdatedAt: NOW, updatedAt: NOW };
const review: CaseObservedEffectReview = { id: 'review', state: 'unavailable', observedAt: NOW, sourceClass: 'analyst', source: 'Separate observation',
  completeness: 'partial', limitations: ['Collection failed'], evidencePinId: null, sightingId: null, followUpAt: null, createdAt: NOW };

test('an empty response queue invents no action, acknowledgement or independent outcome', () => {
  const view = caseResponseQueue(createCase({ domain: 'queue.example' }, NOW), NOW);
  assert.deepEqual(view.actions, []); assert.deepEqual(view.questions, []);
  assert.deepEqual(view.independentReviews, { latest: [], undated: [], observedAt: null, superseded: 0 });
});

test('orders active due work before unscheduled and completed work while updating route health without writes', () => {
  const record = createCase({ domain: 'queue.example' }, NOW);
  record.actions = [{ ...action, id: 'undated', followUpAt: null }, { ...action, id: 'completed', state: 'terminal', followUpAt: '2026-01-01T00:00:00Z' }, action];
  const before = structuredClone(record);
  const first = caseResponseQueue(record, NOW);
  assert.deepEqual(first.actions.map(item => item.action.id), ['active', 'undated', 'completed']);
  assert.equal(first.actions[0]?.followUp.due, false); assert.equal(first.actions[0]?.routeFreshness, 'current');
  const later = caseResponseQueue(record, '2026-09-10T10:01:00Z');
  assert.equal(later.actions[0]?.followUp.due, true); assert.equal(later.actions[0]?.routeFreshness, 'stale');
  assert.equal(caseResponseQueue(record, 'invalid').actions[0]?.followUp.due, null);
  assert.deepEqual(record, before);
});

test('provider claims and unapplied conflicts never replace independent unavailable or recurring evidence', () => {
  const record = createCase({ domain: 'queue.example' }, NOW);
  record.actions = [{ ...action, providerOutcome: 'provider_reports_resolved', outcome: 'Provider reported resolution', history: [
    { id: 'applied', previousState: 'submitted', nextState: 'acknowledged', occurredAt: NOW, sourceClass: 'provider', provenance: 'Manual receipt', reference: 'RECEIPT',
      evidencePinId: null, limitations: [], providerOutcome: 'accepted_for_review', outcomeDetail: null, originActionId: null, applied: true },
    { id: 'conflict', previousState: 'submitted', nextState: 'terminal', occurredAt: '2026-09-10T11:00:00Z', sourceClass: 'provider', provenance: 'Concurrent receipt', reference: 'CONFLICT',
      evidencePinId: null, limitations: [], providerOutcome: 'provider_reports_resolved', outcomeDetail: null, originActionId: null, applied: false },
  ] }];
  record.observedEffects.reviews = [{ ...review, id: 'earlier', state: 'not_reproduced', observedAt: '2026-09-09T10:00:00Z' }, review,
    { ...review, id: 'recurring', state: 'still_observed', source: 'Second observer' }];
  const view = caseResponseQueue(record, NOW);
  assert.deepEqual(view.actions[0]?.latestEvent.latest.map(event => event.reference), ['RECEIPT']);
  assert.deepEqual(view.independentReviews.latest.map(item => [item.state, item.source]), [['unavailable', 'Separate observation'], ['still_observed', 'Second observer']]);
  assert.equal(view.independentReviews.superseded, 1);
  assert.equal(record.observedEffects.reviews.length, 3);
});

test('question answers link by explicit identity and retain every answer without resolving the question', () => {
  const record = createCase({ domain: 'queue.example' }, NOW);
  const context = { targetHostname: 'page.queue.example', baselinePinId: null, conditions: 'Compare the reported page' };
  record.assertions = [{ id: 'question', kind: 'next_step', statement: 'Is it still observed?', rationale: '', state: 'open',
    evidencePinIds: [], recheck: context, createdAt: NOW, updatedAt: NOW }];
  record.observedEffects.reviews = [{ ...review, recheck: { ...context, questionId: 'question', question: 'Is it still observed?', conditionsMatch: 'unknown' } },
    { ...review, id: 'unlinked', state: 'not_reproduced' }];
  const view = caseResponseQueue(record, NOW);
  assert.deepEqual(view.questions[0]?.answers.map(answer => answer.id), ['review']);
  assert.equal(view.questions[0]?.question.state, 'open');
  assert.equal(view.independentReviews.latest.length, 2);
});

test('evidence follow-ups preserve deadlines, concurrent preparations and actual delivery boundaries', () => {
  const record = createCase({ domain: 'queue.example' }, NOW);
  const baseEvent = { id: 'request', previousState: 'submitted', nextState: 'acknowledged', occurredAt: NOW,
    sourceClass: 'provider', provenance: 'Recorded request', reference: null, evidencePinId: null, limitations: [],
    providerOutcome: 'more_information_requested', outcomeDetail: null, originActionId: null, applied: true,
    evidenceRequest: { id: 'need-page', packetDigestSha256: 'a'.repeat(64), summary: 'Retain the specific page', dueAt: NOW,
      state: 'requested', evidencePinIds: [], rationale: '', previousEventIds: [] },
  } satisfies CaseActionRecord['history'][number];
  record.actions = [{ ...action, history: [baseEvent] }];
  const before = structuredClone(record);
  const pending = caseRequestedEvidenceQueue(record, NOW)[0]!;
  assert.equal(pending.due, true);
  assert.equal(pending.label, 'Evidence requested');
  assert.equal(pending.deliveries.length, 0);
  assert.equal(caseRequestedEvidenceQueue(record, 'unknown')[0]?.due, null);
  assert.deepEqual(record, before);
  const prepared = { ...baseEvent, id: 'prepared', sourceClass: 'analyst' as const,
    evidenceRequest: { ...baseEvent.evidenceRequest, state: 'prepared' as const, evidencePinIds: ['pin'], previousEventIds: ['request'] } };
  record.actions[0]!.history.push(prepared);
  assert.equal(caseRequestedEvidenceQueue(record, NOW)[0]?.label, 'Prepared; delivery not recorded');
  record.actions.push({ ...action, id: 'amendment', state: 'authorised', originActionId: action.id,
    amendment: { packetDigestSha256: 'a'.repeat(64), requestEventIds: ['prepared'] }, history: [] });
  assert.equal(caseRequestedEvidenceQueue(record, NOW)[0]?.deliveries.length, 0, 'a draft or authorised amendment is not delivery');
  const deliveryEvent: CaseActionRecord['history'][number] = { ...baseEvent, id: 'delivered',
    previousState: 'authorised', nextState: 'submitted', sourceClass: 'analyst', providerOutcome: null,
    reference: `response-packet-sha256:${'b'.repeat(64)}` };
  delete deliveryEvent.evidenceRequest;
  record.actions[1]!.history.push(deliveryEvent);
  assert.equal(caseRequestedEvidenceQueue(record, NOW)[0]?.label, 'Delivery recorded');
  record.actions[0]!.history.push({ ...prepared, id: 'conflicting-preparation', evidenceRequest: {
    ...prepared.evidenceRequest, state: 'unavailable', evidencePinIds: [], rationale: 'Source is no longer retained',
  } });
  const conflict = caseResponseQueue(record, NOW).requestedEvidence;
  assert.equal(conflict.length, 2);
  assert.ok(conflict.every(item => item.concurrent));
  assert.equal(conflict[0]?.eventId, 'conflicting-preparation');
  assert.equal(conflict[0]?.deliveries.length, 0, 'delivery of one branch cannot settle the other');
  record.actions[0]!.state = 'terminal';
  assert.ok(caseRequestedEvidenceQueue(record, NOW).every(item => !item.editable));
});
