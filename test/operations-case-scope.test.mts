import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCase, updateCase } from '../packages/cases/case-model.mts';
import { appendCaseObservedEffectReview } from '../packages/cases/case-response-outcomes.mts';
import { appendCaseAction, appendCaseActionTransition } from '../packages/cases/case-response-actions.mts';
import { MAX_CASES } from '../packages/contracts/case-portability.mts';
import { buildOperationsScopeReview } from '../frontend/src/lib/analysis/operations-contributors.ts';
import { buildBrandProtectionOperationsReport, serializeBrandProtectionOperationsReport } from '../packages/interchange/brand-protection-operations-report.mts';

const BEFORE = '2026-09-01T00:00:00.000Z';
const AFTER = '2026-09-02T00:00:00.000Z';
function incident(id: string, domain = 'shared.example') {
  return { ...createCase({ domain, incidentTarget: `https://${domain}/${id}` }, BEFORE), id };
}
function withReview(record: ReturnType<typeof incident>, state: 'changed' | 'not_reproduced' | 'unavailable' | 'still_observed', at = AFTER) {
  return { ...record, observedEffects: appendCaseObservedEffectReview(record.observedEffects, {
    state, observedAt: at, sourceClass: 'analyst', source: 'Fixture review', completeness: state === 'unavailable' ? 'unknown' : 'complete',
    limitations: ['Hostname-scoped fixture, not exact-object removal'],
  }, at) };
}

test('campaign domain membership selects separate Case IDs without inferring shared incidents or brand relationships', () => {
  const first = incident('first'), second = incident('second'), unrelated = incident('unrelated', 'other.example');
  first.brandProfileIds = second.brandProfileIds = unrelated.brandProfileIds = ['same-profile'];
  const scope = buildOperationsScopeReview([first, second, unrelated], 'ready', ['shared.example', 'missing.example']);
  assert.deepEqual(scope.rows.map(row => row.record.id), ['first', 'second']);
  assert.deepEqual(scope.missingDomains, ['missing.example']);
  assert.equal(scope.openObjects, 2);
  assert.equal(scope.unknownObjectCoverage, 2);
  assert.deepEqual(scope.rows.map(row => row.coverage[0]!.target.url), ['https://shared.example/first', 'https://shared.example/second']);
});

test('partial analyst resolution leaves every other object and Case independent with unknown bindings', () => {
  const first = incident('first');
  const partial = updateCase([first], first.id, { incidentTarget: 'https://distribution.example/ad', incidentTargetResolution: first.workflowMetadata!.incidentTargets[0]!.id }, AFTER).record;
  const scope = buildOperationsScopeReview([partial, incident('second')], 'ready', ['shared.example']);
  assert.equal(scope.openObjects, 2);
  assert.equal(scope.analystResolvedObjects, 1);
  assert.equal(scope.unknownObjectCoverage, 3);
  assert.deepEqual(scope.rows.map(row => [row.openObjects, row.analystResolvedObjects]), [[1, 1], [1, 0]]);
  for (const row of scope.rows.flatMap(item => item.coverage)) {
    assert.equal(row.actionCoverage, 'unknown');
    assert.equal(row.observationCoverage, 'unknown');
  }
});

test('typed and historical object rows do not multiply current incident-link counts', () => {
  let record = incident('scoped');
  const target = record.workflowMetadata!.incidentTargets[0]!;
  const page = { kind: 'page', identifier: target.url, incidentTargetId: target.id };
  const advertisement = { ...page, kind: 'advertisement' };
  record = updateCase([record], record.id, { action: { type: 'internal_review', recipient: 'Example reviewer', responseObjects: [page, advertisement] } }, BEFORE).record;
  const first = buildOperationsScopeReview([record], 'ready');
  assert.equal(first.rows[0]!.coverage.length, 2); assert.equal(first.openObjects, 1);
  const changed = { ...record, workflowMetadata: { ...record.workflowMetadata!, incidentTargets: [{ ...target, url: 'https://shared.example/replacement' }] } };
  const historical = buildOperationsScopeReview([changed], 'ready');
  assert.equal(historical.rows[0]!.coverage.length, 3); assert.equal(historical.openObjects, 1);
  assert.equal(historical.rows[0]!.coverage.filter(row => !row.targetRetained).length, 2);
});

test('provider-reported resolution is separate from unavailable independent review and open objects', () => {
  let record = incident('provider-case');
  let actions = appendCaseAction([], { type: 'registrar_report', recipient: 'Fixture recipient' }, BEFORE);
  const actionId = actions[0]!.id;
  for (const nextState of ['ready_for_review', 'reviewed', 'authorised', 'submitted', 'acknowledged', 'terminal'] as const) {
    actions = appendCaseActionTransition(actions, actionId, {
      nextState, sourceClass: nextState === 'acknowledged' || nextState === 'terminal' ? 'provider' : 'analyst', provenance: 'Fixture event',
      ...(nextState === 'terminal' ? { providerOutcome: 'provider_reports_resolved' } : {}),
    }, BEFORE);
  }
  record = withReview({ ...record, actions }, 'unavailable');
  const scope = buildOperationsScopeReview([record], 'ready');
  assert.equal(scope.rows[0]!.lifecycle.latestProviderOutcome?.outcome, 'provider_reports_resolved');
  assert.equal(scope.rows[0]!.providerEvent?.sourceClass, 'provider');
  assert.equal(scope.rows[0]!.latestReview?.state, 'unavailable');
  assert.equal(scope.openObjects, 1);
  assert.equal(scope.analystResolvedObjects, 0);
});

test('independent change, non-reproduction and unavailable remain separate rather than proving removal', () => {
  const scope = buildOperationsScopeReview([
    withReview(incident('changed'), 'changed'), withReview(incident('not-reproduced'), 'not_reproduced'), withReview(incident('unavailable'), 'unavailable'),
  ], 'ready');
  assert.deepEqual(scope.rows.map(row => row.latestReview!.state), ['changed', 'not_reproduced', 'unavailable']);
  assert.equal(scope.openObjects, 3);
  assert.equal(scope.unknownObjectCoverage, 3);
});

test('no evidence and tied latest reviews stay missing or ambiguous, and incomplete history is disclosed', () => {
  const missing = createCase({ domain: 'missing.example' }, BEFORE);
  const tied = withReview(withReview(incident('tied'), 'changed'), 'unavailable');
  tied.observedEffects.omitted = 1;
  const scope = buildOperationsScopeReview([missing, tied], 'ready');
  assert.deepEqual(scope.rows.map(row => row.observedState), ['missing', 'ambiguous']);
  assert.equal(scope.rows[0]!.coverage.length, 0);
  assert.equal(scope.rows[1]!.latestReview, null);
  assert.equal(scope.rows[1]!.historyIncomplete, true);
});

test('structured baseline context remains literal and prose never becomes dispute, restoration or recurrence', () => {
  const record = withReview(incident('context'), 'still_observed');
  record.observedEffects.reviews[0]!.recheck = { questionId: 'question', question: 'Does the earlier form reproduce?', targetHostname: 'shared.example', baselinePinId: 'baseline', conditions: 'Same supplied conditions', conditionsMatch: 'unknown' };
  record.notes.push({ id: 'note', body: 'Restored after dispute; recurrence confirmed', createdAt: AFTER });
  const scope = buildOperationsScopeReview([record], 'ready');
  assert.deepEqual(scope.rows[0]!.latestReview?.recheck, record.observedEffects.reviews[0]!.recheck);
  assert.equal(scope.rows[0]!.baselineRetained, false);
  for (const key of ['recurrence', 'recurred', 'dispute', 'restoration', 'removed']) assert.equal(Object.hasOwn(scope.rows[0]!, key), false);
  assert.equal(scope.rows[0]!.latestReview?.state, 'still_observed');
  assert.equal(scope.unknownObjectCoverage, 1);
});

test('source states withhold counts, inspection stays at the existing Case cap and export bytes are unchanged', () => {
  const records = Array.from({ length: MAX_CASES + 1 }, (_, index) => incident(`case-${index}`));
  for (const state of ['loading', 'unavailable'] as const) {
    const scope = buildOperationsScopeReview(records, state, ['shared.example']);
    assert.deepEqual(scope.rows, []);
    assert.equal(scope.openObjects, null);
    assert.equal(scope.analystResolvedObjects, null);
    assert.equal(scope.unknownObjectCoverage, null);
    assert.equal(scope.missingDomains, null);
  }
  const before = serializeBrandProtectionOperationsReport(buildBrandProtectionOperationsReport(records, { now: AFTER, window: 'all' }));
  const scope = buildOperationsScopeReview(records, 'ready');
  assert.equal(scope.rows.length, MAX_CASES);
  assert.equal(scope.casesOmitted, 1);
  assert.equal(scope.openObjects, MAX_CASES);
  assert.equal(serializeBrandProtectionOperationsReport(buildBrandProtectionOperationsReport(records, { now: AFTER, window: 'all' })), before);
});
