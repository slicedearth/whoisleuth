import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createCase } from '../frontend/src/lib/analysis/case-model.ts';
import {
  appendCaseAction,
  appendCaseActionTransition,
  appendCaseObservedEffectReview,
} from '../frontend/src/lib/analysis/case-response-model.ts';
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
  for (const raw of actions) {
    const action = raw as Record<string, unknown>;
    const targetAt = String(action.updatedAt || NOW);
    const targetState = typeof action.state === 'string' ? action.state : 'drafting';
    const route = targetState === 'drafting' ? []
      : targetState === 'ready_for_review' ? ['ready_for_review']
        : targetState === 'reviewed' ? ['ready_for_review', 'reviewed']
          : targetState === 'authorised' ? ['ready_for_review', 'reviewed', 'authorised']
            : targetState === 'submitted' ? ['ready_for_review', 'reviewed', 'authorised', 'submitted']
              : targetState === 'acknowledged' ? ['ready_for_review', 'reviewed', 'authorised', 'submitted', 'acknowledged']
                : ['ready_for_review', 'reviewed', 'authorised', 'submitted', 'acknowledged', 'terminal'];
    const createdAt = new Date(Date.parse(targetAt) - (route.length + 1) * 60_000).toISOString();
    current = appendCaseAction(current, action, createdAt);
    const actionId = current.at(-1)!.id;
    for (const [index, nextState] of route.entries()) {
      const occurredAt = new Date(Date.parse(targetAt) - (route.length - index - 1) * 60_000).toISOString();
      const final = index === route.length - 1;
      current = appendCaseActionTransition(current, actionId, {
        nextState,
        sourceClass: ['acknowledged', 'terminal'].includes(nextState) ? 'provider' : 'analyst',
        provenance: ['acknowledged', 'terminal'].includes(nextState) ? 'provider_fixture_event' : 'analyst_fixture_event',
        ...(final && action.reference ? { reference: action.reference } : {}),
        ...(final && action.providerOutcome ? { providerOutcome: action.providerOutcome } : {}),
        ...(final && action.outcome ? { outcomeDetail: action.outcome } : {}),
      }, occurredAt);
    }
  }
  return { ...record, actions: current, updatedAt: NOW };
}

describe('brand-protection operations report', () => {
  test('reports only explicit current action states with denominators and due controls', () => {
    const report = buildBrandProtectionOperationsReport([
      caseWithActions('prepared.example', [{
        type: 'registrar_report', recipient: 'Reviewed registrar route', contactSource: 'Published registrar policy',
        contactLimitations: ['Reachability was not tested.'], state: 'ready_for_review', dueAt: '2026-08-09T00:00:00.000Z', updatedAt: NOW,
      }]),
      (() => {
        const record = caseWithActions('resolved.example', [{
          type: 'security_contact_report', recipient: 'Security contact', state: 'terminal',
          providerOutcome: 'provider_reports_resolved', outcome: 'A provider resolution was recorded by the analyst.',
          reference: 'CASE-7', updatedAt: '2026-08-09T05:00:00.000Z',
        }]);
        return {
          ...record,
          observedEffects: appendCaseObservedEffectReview(record.observedEffects, {
            state: 'changed', observedAt: NOW, sourceClass: 'analyst', source: 'Independent fixture review',
            completeness: 'partial', limitations: ['Only selected paths were reviewed.'],
          }, NOW),
        };
      })(),
    ], { now: NOW, window: '30d' });

    assert.equal(report.schema, BRAND_PROTECTION_OPERATIONS_REPORT_SCHEMA);
    assert.deepEqual(report.counts, {
      casesInspected: 2,
      casesWithActions: 2,
      actions: 2,
      drafting: 0,
      readyForReview: 1,
      reviewed: 0,
      authorised: 0,
      submitted: 0,
      acknowledged: 0,
      terminal: 1,
      overdue: 1,
      followUpDue: 0,
      withProviderOutcome: 1,
      providerOutcomeEvents: 1,
      independentEffectReviews: 1,
      independentChangedReviews: 1,
      withReference: 1,
      reviewedRecipientRoute: 1,
      unqualifiedRecipientRoute: 1,
    });
    assert.equal(report.states?.ready_for_review, 1);
    assert.equal(report.actionTypes?.registrar_report, 1);
    assert.match(serializeBrandProtectionOperationsReport(report), /"readyForReview": 1/u);
    assert.deepEqual(report.durations?.submissionToProviderOutcome, {
      denominator: 2, eligible: 1, included: 1, ineligible: 0,
      omittedMissingStart: 1, omittedMissingEnd: 0, omittedAmbiguous: 0,
      minimumSeconds: 120, medianSeconds: 120, maximumSeconds: 120,
    });
    assert.deepEqual(report.durations?.providerReportedResolutionToIndependentChange, {
      denominator: 2, eligible: 1, included: 1, ineligible: 0,
      omittedMissingStart: 1, omittedMissingEnd: 0, omittedAmbiguous: 0,
      minimumSeconds: 86_400, medianSeconds: 86_400, maximumSeconds: 86_400,
    });
    assert.deepEqual(Object.keys(report).sort(), [
      'actionTypes', 'counts', 'durations', 'generatedAt', 'limitations', 'omissions', 'schema', 'sourceState', 'states', 'version', 'window',
    ]);
    assert.deepEqual(Object.keys(report.window).sort(), ['basis', 'endAt', 'id', 'startAt']);
    assert.deepEqual(Object.keys(report.omissions).sort(), [
      'actionsBeyondLimit', 'actionsOutsideWindow', 'actionsWithInvalidTime', 'casesBeyondLimit',
      'observedEffectReviewsOmitted', 'transitionEventsOmitted',
    ]);
    assert.deepEqual(Object.keys(report.counts || {}).sort(), [
      'acknowledged', 'actions', 'authorised', 'casesInspected', 'casesWithActions', 'drafting', 'followUpDue',
      'independentChangedReviews', 'independentEffectReviews', 'overdue', 'providerOutcomeEvents', 'readyForReview',
      'reviewed', 'reviewedRecipientRoute', 'submitted', 'terminal', 'unqualifiedRecipientRoute',
      'withProviderOutcome', 'withReference',
    ]);
  });

  test('excludes every case, domain, recipient, note, reference, and outcome sentinel recursively', () => {
    const sentinels = [
      'CASE-ID-SENTINEL', 'domain-sentinel.example', 'RECIPIENT-SENTINEL', 'NOTE-SENTINEL',
      'REFERENCE-SENTINEL', 'OUTCOME-SENTINEL', 'SOURCE-SENTINEL', 'LIMITATION-SENTINEL',
    ];
    const record = caseWithActions('domain-sentinel.example', [{
      id: 'ACTION-ID-SENTINEL',
      type: 'registrar_report', recipient: 'RECIPIENT-SENTINEL', contactSource: 'SOURCE-SENTINEL',
      contactLimitations: ['LIMITATION-SENTINEL'], state: 'terminal', reference: 'REFERENCE-SENTINEL',
      providerOutcome: 'provider_reports_resolved', outcome: 'OUTCOME-SENTINEL', updatedAt: NOW,
    }]);
    const report = buildBrandProtectionOperationsReport([{ ...record, id: 'CASE-ID-SENTINEL', notes: [{ id: 'NOTE-ID-SENTINEL', body: 'NOTE-SENTINEL', createdAt: NOW }] }], { now: NOW, window: 'all' });
    const serialized = serializeBrandProtectionOperationsReport(report);
    for (const sentinel of sentinels) assert.equal(serialized.includes(sentinel), false, sentinel);
  });

  test('does not treat a packet-like Case without an action as prepared or submitted', () => {
    const record = createCase({ domain: 'packet-only.example' }, NOW);
    const report = buildBrandProtectionOperationsReport([record], { now: NOW, window: 'all' });
    assert.equal(report.counts?.actions, 0);
    assert.equal(report.counts?.readyForReview, 0);
    assert.equal(report.counts?.submitted, 0);
    assert.match(report.limitations.join(' '), /creating or exporting a response packet does not/iu);
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
    const recent = caseWithActions('recent.example', [{ type: 'internal_review', recipient: 'Analyst', state: 'drafting', updatedAt: NOW }]);
    const old = caseWithActions('old.example', [{ type: 'internal_review', recipient: 'Analyst', state: 'terminal', updatedAt: '2026-01-01T00:00:00.000Z' }]);
    const records = [recent, old, ...Array.from({ length: MAX_OPERATIONS_REPORT_CASES }, (_, index) => createCase({ domain: `bounded-${index}.example` }, NOW))];
    const report = buildBrandProtectionOperationsReport(records, { now: NOW, window: '30d' });
    assert.equal(report.counts?.casesInspected, MAX_OPERATIONS_REPORT_CASES);
    assert.equal(report.counts?.actions, 1);
    assert.equal(report.omissions.actionsOutsideWindow, 1);
    assert.equal(report.omissions.casesBeyondLimit, 2);
  });

  test('keeps typed duration starts outside the selected window explicitly ineligible', () => {
    const record = caseWithActions('windowed-duration.example', [{
      type: 'registrar_report', recipient: 'Reviewed registrar route', state: 'terminal',
      providerOutcome: 'provider_reports_resolved', updatedAt: '2026-01-01T00:00:00.000Z',
    }]);
    const withReview = {
      ...record,
      observedEffects: appendCaseObservedEffectReview(record.observedEffects, {
        state: 'changed', observedAt: '2026-01-02T00:00:00.000Z', sourceClass: 'analyst',
        source: 'Independent fixture review', completeness: 'complete',
      }, '2026-01-02T00:00:00.000Z'),
    };
    const report = buildBrandProtectionOperationsReport([withReview], { now: NOW, window: '30d' });
    assert.deepEqual(report.durations?.providerReportedResolutionToIndependentChange, {
      denominator: 1, eligible: 0, included: 0, ineligible: 1,
      omittedMissingStart: 0, omittedMissingEnd: 0, omittedAmbiguous: 0,
      minimumSeconds: null, medianSeconds: null, maximumSeconds: null,
    });

    const base = createCase({ domain: 'windowed-submission.example' }, '2026-01-01T00:00:00.000Z');
    let actions = appendCaseAction(base.actions, { type: 'registrar_report', recipient: 'Reviewed registrar route' }, '2026-01-01T00:00:00.000Z');
    const actionId = actions[0]!.id;
    for (const [index, nextState] of (['ready_for_review', 'reviewed', 'authorised', 'submitted'] as const).entries()) {
      actions = appendCaseActionTransition(actions, actionId, { nextState, sourceClass: 'analyst' },
        new Date(Date.parse('2026-01-01T00:00:00.000Z') + (index + 1) * 60_000).toISOString());
    }
    actions = appendCaseActionTransition(actions, actionId, {
      nextState: 'acknowledged', sourceClass: 'provider', providerOutcome: 'accepted_for_review',
    }, '2026-08-09T00:00:00.000Z');
    const submissionReport = buildBrandProtectionOperationsReport([{ ...base, actions, updatedAt: NOW }], { now: NOW, window: '30d' });
    assert.deepEqual(submissionReport.durations?.submissionToProviderOutcome, {
      denominator: 1, eligible: 0, included: 0, ineligible: 1,
      omittedMissingStart: 0, omittedMissingEnd: 0, omittedAmbiguous: 0,
      minimumSeconds: null, medianSeconds: null, maximumSeconds: null,
    });
  });

  test('counts provider-outcome events only when their own typed time is inside the report window', () => {
    const base = createCase({ domain: 'windowed-provider-event.example' }, '2026-01-01T00:00:00.000Z');
    let actions = appendCaseAction(base.actions, { type: 'registrar_report', recipient: 'Reviewed registrar route' }, '2026-01-01T00:00:00.000Z');
    const actionId = actions[0]!.id;
    for (const [index, nextState] of (['ready_for_review', 'reviewed', 'authorised', 'submitted'] as const).entries()) {
      actions = appendCaseActionTransition(actions, actionId, { nextState, sourceClass: 'analyst' },
        new Date(Date.parse('2026-01-01T00:00:00.000Z') + (index + 1) * 60_000).toISOString());
    }
    actions = appendCaseActionTransition(actions, actionId, {
      nextState: 'acknowledged', sourceClass: 'provider', providerOutcome: 'accepted_for_review',
    }, '2026-01-02T00:00:00.000Z');
    actions = appendCaseActionTransition(actions, actionId, {
      nextState: 'acknowledged', sourceClass: 'provider', outcomeDetail: 'A later procedural update contained no typed outcome.',
    }, '2026-08-09T00:00:00.000Z');
    const report = buildBrandProtectionOperationsReport([{ ...base, actions, updatedAt: NOW }], { now: NOW, window: '30d' });
    assert.equal(report.counts?.withProviderOutcome, 1);
    assert.equal(report.counts?.providerOutcomeEvents, 0);
  });
});
