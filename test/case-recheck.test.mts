import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCase, updateCase, normalizeCaseStore, serializeCaseStore, buildCaseExport, mergeCases, projectCaseForAudience, recordCaseRecheckOutcome } from '../packages/cases/case-model.mts';
import { appendCaseEvidencePin } from '../packages/cases/case-response-model.mts';
import { buildCaseReport } from '../packages/cases/case-report.mts';
import { assertCurrentRecheckQuestion, assertRecheckNonReproduction, caseRecheckAnswerContext, caseRecheckComparisonWarnings, caseRecheckQuestions, readCaseRecheckAnswerContext, readCaseRecheckContext } from '../packages/cases/case-recheck-model.mts';

const before = '2026-09-01T10:00:00.000Z', after = '2026-09-02T10:00:00.000Z';
const plan = { targetHostname: 'login.recheck.example', baselinePinId: null, conditions: 'Same selected page, browser viewport and unauthenticated session.' };
function planned() {
  return createCase({ domain: 'recheck.example', assertion: { kind: 'next_step', statement: 'Is the reported form still served?', recheck: plan } }, before);
}
function baselineAndCurrent() {
  return appendCaseEvidencePin(appendCaseEvidencePin([], { label: 'Form', value: 'Form present', source: 'Fixture page', field: 'page.form',
    sourceState: 'complete', completeness: 'complete', observedAt: before, observationHostname: plan.targetHostname }, before),
  { label: 'Form', value: 'Form not found', source: 'Fixture page', field: 'page.form', sourceState: 'complete', completeness: 'complete', observedAt: after,
    observationHostname: plan.targetHostname }, after);
}

test('recheck plans are strict detached context on next steps, not observations or requests', () => {
  const input = { ...plan }, parsed = readCaseRecheckContext(input)!;
  input.conditions = 'Changed later'; assert.equal(parsed.conditions, plan.conditions); assert.ok(Object.isFrozen(parsed));
  const record = planned();
  assert.deepEqual(caseRecheckQuestions(record.assertions).map(item => item.statement), ['Is the reported form still served?']);
  assert.deepEqual(record.observedEffects.reviews, []); assert.deepEqual(record.evidenceHistory, []);
  assert.deepEqual(record.assertions[0]!.recheck, plan);
  assert.throws(() => createCase({ domain: record.domain, assertion: { kind: 'verified_fact', statement: 'Wrong role', recheck: plan } }, before), /next step/);
  assert.equal(readCaseRecheckContext(undefined, 15), undefined);
});

test('recheck context rejects invalid targets, excess text, unknown properties and historical formats', () => {
  for (const value of [{ ...plan, targetHostname: 'https://recheck.example/private?token=x' }, { ...plan, targetHostname: 'UPPER.example' },
    { ...plan, conditions: ' ' }, { ...plan, conditions: 'a'.repeat(2001) }, { ...plan, extra: 1 }, { ...plan, baselinePinId: '../pin' }]) assert.throws(() => readCaseRecheckContext(value));
  assert.throws(() => readCaseRecheckContext(plan, 15), /format/);
  const answer = caseRecheckAnswerContext(planned().assertions[0]!, 'comparable');
  for (const value of [{ ...answer, question: 'a'.repeat(2001) }, { ...answer, question: ' ' }, { ...answer, questionId: '../question' }, { ...answer, conditionsMatch: 'same' }]) assert.throws(() => readCaseRecheckAnswerContext(value));
  assert.throws(() => readCaseRecheckAnswerContext(answer, 15), /format/);
});

test('answers snapshot question conditions and preserve independent observation times across plan changes', () => {
  const original = planned(), question = original.assertions[0]!, recheck = caseRecheckAnswerContext(question, 'comparable');
  const answered = updateCase([original], original.id, { observedEffectReview: { state: 'not_reproduced', source: 'Independent fixture review',
    sourceClass: 'analyst', completeness: 'complete', observedAt: after, recheck } }, after).record;
  const changed = updateCase([answered], answered.id, { assertionUpdate: { id: question.id, statement: 'A different question', recheck: { ...plan, conditions: 'Changed conditions' } } }, after).record;
  assert.equal(changed.observedEffects.reviews[0]!.observedAt, after);
  assert.deepEqual(changed.observedEffects.reviews[0]!.recheck, recheck);
  assert.throws(() => assertCurrentRecheckQuestion(recheck, changed.assertions), /changed or was resolved/);
  assert.throws(() => updateCase([changed], changed.id, { observedEffectReview: { ...answered.observedEffects.reviews[0] } }, after), /changed or was resolved/);
  const resolved = updateCase([answered], answered.id, { assertionUpdate: { id: question.id, state: 'resolved' } }, after).record;
  assert.deepEqual(caseRecheckQuestions(resolved.assertions), []); assert.deepEqual(resolved.observedEffects.reviews, answered.observedEffects.reviews);
});

test('failed, partial, wrong-target and non-later evidence cannot establish non-reproduction', () => {
  const pins = baselineAndCurrent(), baseline = pins[0]!, current = pins[1]!;
  const { observationHostname: _hostname, ...unknownTarget } = current;
  const context = { ...caseRecheckAnswerContext(planned().assertions[0]!, 'comparable'), baselinePinId: baseline.id };
  assert.deepEqual(caseRecheckComparisonWarnings(context, pins, current), []);
  assert.doesNotThrow(() => assertRecheckNonReproduction('not_reproduced', context, 'complete', pins, current));
  for (const changed of [{ ...current, sourceState: 'failed' }, { ...current, completeness: 'partial' as const }, { ...current, truncated: true },
    { ...current, observationHostname: 'other.example' }, unknownTarget, { ...current, observedAt: before }, { ...current, observedAt: null }, { ...current, source: 'Different source' }, baseline]) {
    assert.throws(() => assertRecheckNonReproduction('not_reproduced', context, 'complete', pins, changed), /complete observation/);
    assert.doesNotThrow(() => assertRecheckNonReproduction('unavailable', context, 'unknown', pins, changed));
  }
  assert.throws(() => assertRecheckNonReproduction('not_reproduced', { ...context, conditionsMatch: 'different' }, 'complete', pins, current));
  assert.throws(() => assertRecheckNonReproduction('not_reproduced', context, 'complete', [], current));
  assert.throws(() => assertRecheckNonReproduction('not_reproduced', context, 'complete', pins, undefined, before));
  assert.doesNotThrow(() => assertRecheckNonReproduction('not_reproduced', context, 'complete', pins, undefined, after));
});

test('the mutation owner rejects incomplete answers and stale question context without changing retained data', () => {
  const original = planned(), recheck = caseRecheckAnswerContext(original.assertions[0]!, 'unknown'), beforeBytes = serializeCaseStore([original]);
  const review = { state: 'not_reproduced', source: 'Failed fixture collection', sourceClass: 'analyst', completeness: 'unknown', observedAt: after, recheck };
  assert.throws(() => updateCase([original], original.id, { observedEffectReview: review }, after), /complete observation/);
  assert.equal(serializeCaseStore([original]), beforeBytes);
  const unavailable = updateCase([original], original.id, { observedEffectReview: { ...review, state: 'unavailable' } }, after).record;
  assert.equal(unavailable.observedEffects.reviews[0]!.state, 'unavailable');
  assert.throws(() => normalizeCaseStore({ version: 16, cases: [{ ...unavailable, observedEffects: { ...unavailable.observedEffects,
    reviews: unavailable.observedEffects.reviews.map(item => ({ ...item, state: 'not_reproduced' })) } }] }), /incomplete evidence/);
});

test('question and answer context survives private portability while independent public policy excludes it', () => {
  const original = planned(), recheck = caseRecheckAnswerContext(original.assertions[0]!, 'comparable');
  const answered = updateCase([original], original.id, { observedEffectReview: { state: 'still_observed', source: 'Fixture observation', sourceClass: 'analyst',
    completeness: 'partial', observedAt: after, recheck } }, after).record;
  const serial = serializeCaseStore([answered]);
  assert.equal(serializeCaseStore(normalizeCaseStore(JSON.parse(serial)).cases), serial);
  const restored = mergeCases([], buildCaseExport([answered], after)).cases[0]!;
  assert.deepEqual(restored.assertions[0]!.recheck, plan); assert.deepEqual(restored.observedEffects.reviews[0]!.recheck, recheck);
  const publicBytes = JSON.stringify(projectCaseForAudience(answered, 'public'));
  for (const sensitive of [plan.conditions, plan.targetHostname, recheck.question, recheck.questionId]) assert.ok(!publicBytes.includes(sensitive));
  assert.throws(() => normalizeCaseStore({ version: 15, cases: [answered] }), /format/);
  const report = buildCaseReport(answered, { generatedAt: after });
  assert.deepEqual(report.json.analystResponse.assertions[0]!.recheck, plan);
  assert.deepEqual(report.json.analystResponse.observedEffects.reviews[0]!.recheck, recheck);
  for (const value of [plan.conditions, plan.targetHostname, recheck.question, recheck.questionId, 'Condition comparison: Comparable for this question']) assert.ok(report.markdown.includes(value));
});

test('Lookup recheck operations bind the actual hostname and retain question context with the comparison pin', () => {
  const original = planned(), recheck = caseRecheckAnswerContext(original.assertions[0]!, 'unknown');
  const input = { state: 'unavailable', observedAt: after, completeness: 'partial', comparisonSummary: 'One source could not complete.', source: 'Fixture review', recheck };
  for (const observationHostname of [undefined, 'other.example']) assert.throws(() => recordCaseRecheckOutcome([original], original.id,
    { ...input, observationHostname }, after), /different or unknown hostname/);
  const answered = recordCaseRecheckOutcome([original], original.id, { ...input, observationHostname: plan.targetHostname }, after).record;
  const review = answered.observedEffects.reviews[0]!;
  assert.deepEqual(review.recheck, recheck); assert.equal(review.state, 'unavailable');
  assert.equal(answered.evidencePins.find(item => item.id === review.evidencePinId)?.observationHostname, plan.targetHostname);
  assert.deepEqual(original.observedEffects.reviews, []);
  const changed = updateCase([original], original.id, { assertionUpdate: { id: original.assertions[0]!.id, statement: 'Updated question' } }, after).record;
  assert.throws(() => updateCase([changed], changed.id, { assertionUpdate: { id: original.assertions[0]!.id, state: 'resolved', expectedUpdatedAt: before } }, after), /another tab/);
});
