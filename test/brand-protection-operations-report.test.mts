import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createCase } from '../frontend/src/lib/analysis/case-model.ts';
import { appendCaseAction } from '../frontend/src/lib/analysis/case-response-model.ts';
import {
  BRAND_PROTECTION_OPERATIONS_REPORT_SCHEMA,
  buildBrandProtectionOperationsReport,
  MAX_OPERATIONS_REPORT_CASES,
  serializeBrandProtectionOperationsReport,
} from '../frontend/src/lib/analysis/brand-protection-operations-report.ts';

const NOW = '2026-08-10T05:00:00.000Z';

function caseWithActions(domain: string, actions: unknown[]) {
  const record = createCase({ domain }, '2026-07-01T00:00:00.000Z');
  let current = record.actions;
  for (const action of actions) current = appendCaseAction(current, action, String((action as { updatedAt?: string }).updatedAt || NOW));
  return { ...record, actions: current, updatedAt: NOW };
}

describe('brand-protection operations report', () => {
  test('reports only explicit current action states with denominators and due controls', () => {
    const report = buildBrandProtectionOperationsReport([
      caseWithActions('prepared.example', [{
        type: 'registrar_report', recipient: 'Reviewed registrar route', contactSource: 'Published registrar policy',
        contactLimitations: ['Reachability was not tested.'], state: 'ready_for_review', dueAt: '2026-08-09T00:00:00.000Z', updatedAt: NOW,
      }]),
      caseWithActions('resolved.example', [{
        type: 'security_contact_report', recipient: 'Security contact', state: 'resolved',
        outcome: 'A provider resolution was recorded by the analyst.', reference: 'CASE-7', updatedAt: NOW,
      }]),
    ], { now: NOW, window: '30d' });

    assert.equal(report.schema, BRAND_PROTECTION_OPERATIONS_REPORT_SCHEMA);
    assert.deepEqual(report.counts, {
      casesInspected: 2,
      casesWithActions: 2,
      actions: 2,
      planned: 0,
      prepared: 1,
      submitted: 0,
      acknowledged: 0,
      resolved: 1,
      closed: 0,
      overdue: 1,
      followUpDue: 0,
      withOutcome: 1,
      withReference: 1,
      reviewedRecipientRoute: 1,
      unqualifiedRecipientRoute: 1,
    });
    assert.equal(report.states?.ready_for_review, 1);
    assert.equal(report.actionTypes?.registrar_report, 1);
    assert.match(serializeBrandProtectionOperationsReport(report), /"prepared": 1/u);
  });

  test('does not treat a packet-like Case without an action as prepared or submitted', () => {
    const record = createCase({ domain: 'packet-only.example' }, NOW);
    const report = buildBrandProtectionOperationsReport([record], { now: NOW, window: 'all' });
    assert.equal(report.counts?.actions, 0);
    assert.equal(report.counts?.prepared, 0);
    assert.equal(report.counts?.submitted, 0);
    assert.match(report.limitations.join(' '), /Creating or exporting a response packet does not/u);
  });

  test('withholds numeric conclusions while Cases load or are unavailable', () => {
    for (const sourceState of ['loading', 'unavailable'] as const) {
      const report = buildBrandProtectionOperationsReport([], { sourceState, now: NOW });
      assert.equal(report.counts, null);
      assert.equal(report.states, null);
      assert.throws(() => serializeBrandProtectionOperationsReport(report), /complete Case source/u);
      assert.match(report.limitations[0] || '', /No zero or absence conclusion/u);
    }
  });

  test('applies the action time window and bounded Case cap deterministically', () => {
    const recent = caseWithActions('recent.example', [{ type: 'internal_review', recipient: 'Analyst', state: 'planned', updatedAt: NOW }]);
    const old = caseWithActions('old.example', [{ type: 'internal_review', recipient: 'Analyst', state: 'closed', updatedAt: '2026-01-01T00:00:00.000Z' }]);
    const records = [recent, old, ...Array.from({ length: MAX_OPERATIONS_REPORT_CASES }, (_, index) => createCase({ domain: `bounded-${index}.example` }, NOW))];
    const report = buildBrandProtectionOperationsReport(records, { now: NOW, window: '30d' });
    assert.equal(report.counts?.casesInspected, MAX_OPERATIONS_REPORT_CASES);
    assert.equal(report.counts?.actions, 1);
    assert.equal(report.omissions.actionsOutsideWindow, 1);
    assert.equal(report.omissions.casesBeyondLimit, 2);
  });
});
