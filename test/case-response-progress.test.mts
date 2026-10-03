import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCase, updateCase, type CaseRecord } from '../packages/cases/case-model.mts';
import { caseActionCompletesResponseDecision } from '../packages/cases/case-response-actions.mts';
import type { CaseActionState } from '../packages/cases/case-response-records.mts';
import { buildCaseResponsePreflight } from '../packages/cases/case-response-packet.mts';
import { buildCaseResponseProgress } from '../frontend/src/lib/analysis/case-response-progress.ts';
import type { CaseResponseStage } from '../frontend/src/lib/analysis/case-response-stage.ts';

const NOW = '2026-09-01T10:00:00.000Z';
const handoff: CaseResponseStage = {
  id: 'evidence_handoff', number: 4, label: 'Evidence handoff', status: 'attention',
  summary: 'Review required.', nextRequirement: 'Review the selected recipient.',
};
function progress(record: CaseRecord) {
  return buildCaseResponseProgress(record, handoff, NOW);
}

test('response progress distinguishes absent, unlinked and linked observations and decisions', () => {
  const empty = createCase({ domain: 'progress.example' }, NOW);
  const original = structuredClone(empty);
  assert.deepEqual(progress(empty).stages.map(({ id, status }) => [id, status]), [
    ['observation', 'not_started'], ['assessment', 'not_started'],
    ['response_decision', 'not_started'], ['evidence_handoff', 'attention'],
    ['outcome_tracking', 'not_started'],
  ]);
  assert.equal(progress(empty).currentStage?.id, 'observation');
  const observed = updateCase([empty], empty.id, {
    evidencePin: { label: 'Page', value: 'Observed form', observedAt: NOW },
  }, NOW).record;
  assert.equal(progress(observed).stages[0]?.status, 'complete');
  assert.equal(progress(observed).currentStage?.id, 'assessment');
  const unlinked = updateCase([observed], observed.id, {
    decision: { summary: 'Review', rationale: 'Review the retained observation.' },
  }, NOW).record;
  assert.equal(progress(unlinked).stages[1]?.status, 'in_progress');
  assert.equal(progress(unlinked).evidenceLinkedDecisionCount, 0);
  assert.match(progress(unlinked).stages[1]!.nextRequirement, /Link at least one/);
  const linked = updateCase([observed], observed.id, {
    decision: { summary: 'Review', rationale: 'Review the retained observation.', evidencePinIds: [observed.evidencePins[0]!.id] },
  }, NOW).record;
  assert.equal(progress(linked).stages[1]?.status, 'complete');
  assert.equal(progress(linked).evidenceLinkedDecisionCount, 1);
  assert.equal(progress(linked).currentStage?.id, 'response_decision');
  for (const patch of [
    { assertion: { kind: 'unknown', statement: 'Attribution is not established.' } },
    { trailEvent: { kind: 'review', summary: 'Reviewed the current observation.' } },
  ]) {
    assert.equal(progress(updateCase([empty], empty.id, patch, NOW).record).stages[1]?.status, 'in_progress');
  }
  const sighted = updateCase([empty], empty.id, {
    sighting: { state: 'reported_by_provider', source: 'Fixture report', observedAt: NOW },
  }, NOW).record;
  assert.equal(progress(sighted).stages[0]?.status, 'complete');
  assert.deepEqual(empty, original);
});

test('all action states retain independent stage and packet expectations', () => {
  const record = createCase({ domain: 'progress.example', action: { recipient: 'Internal queue', type: 'internal_review' } }, NOW);
  const expectations: ReadonlyArray<readonly [CaseActionState, boolean, boolean]> = [
    ['drafting', false, false], ['ready_for_review', false, false],
    ['reviewed', true, false], ['authorised', true, false],
    ['submitted', true, true], ['acknowledged', true, true], ['terminal', true, true],
  ];
  for (const [state, decisionComplete, outcomeStarted] of expectations) {
    // Exercise the read projection of each retained state, not transition validation.
    const current = { ...record, actions: [{ ...record.actions[0]!, state }] };
    const result = progress(current);
    assert.equal(caseActionCompletesResponseDecision(state), decisionComplete, state);
    assert.equal(result.stages[2]?.status, decisionComplete ? 'complete' : 'in_progress', state);
    assert.equal(result.stages[4]?.status, outcomeStarted ? 'in_progress' : 'not_started', state);
    assert.equal(buildCaseResponsePreflight(current, {}, NOW).checks.find(({ id }) => id === 'action_tracking')?.state, decisionComplete ? 'pass' : 'caution', state);
    assert.equal(result.actionSummary.total, 1);
    assert.strictEqual(result.stages[3], handoff);
  }
});

test('independent effects and deliberate closure remain separate from response action progress', () => {
  const empty = createCase({ domain: 'progress.example' }, NOW);
  const reviewed = updateCase([empty], empty.id, {
    observedEffectReview: { state: 'changed', sourceClass: 'analyst', source: 'Fixture review', completeness: 'partial', observedAt: NOW },
  }, NOW).record;
  assert.equal(progress(reviewed).stages[4]?.status, 'in_progress');
  assert.equal(progress(reviewed).stages[2]?.status, 'not_started');
  const closed = updateCase([reviewed], reviewed.id, {
    closure: { reason: 'infrastructure_changed', summary: 'A changed observation was reviewed.', observedEffectReviewId: reviewed.observedEffects.reviews[0]!.id },
  }, NOW).record;
  assert.equal(progress(closed).stages[4]?.status, 'complete');
  assert.match(progress(closed).stages[4]!.nextRequirement, /follow-up remains due/);
  assert.strictEqual(progress(closed).stages[3], handoff);
});
