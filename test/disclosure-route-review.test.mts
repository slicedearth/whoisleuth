import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildDisclosureRouteReview } from '../frontend/src/lib/analysis/disclosure-route-review.ts';
import { normalizeCase } from '../frontend/src/lib/analysis/case-model.ts';
import { CASE_SCHEMA_VERSION, MAX_CASE_ACTIONS, MAX_CASES, MAX_CASE_STORE_BYTES } from '../packages/contracts/case-portability.mts';
import { enforceStoreBudget, serializeCaseStore } from '../packages/cases/case-storage-model.mts';

const CLOCK = '2026-09-10T10:00:00.000Z';

function fixtureRecord(id: string, actions: unknown[]) {
  const record = normalizeCase({ id, domain: `${id}.test`, source: 'manual', createdAt: CLOCK, updatedAt: CLOCK, actions }, undefined, CLOCK, CASE_SCHEMA_VERSION);
  assert.ok(record);
  return record;
}

describe('disclosure route review', () => {
  test('projects only saved reporting actions and preserves review uncertainty', () => {
    const record = normalizeCase({
      id: 'case-1',
      domain: 'example.test',
      source: 'manual',
      status: 'reviewing',
      disposition: 'unreviewed',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
      actions: [
        {
          id: 'action-1',
          type: 'registrar_report',
          recipient: 'Published registrar route',
          contactSource: 'Registry insight',
          contactLimitations: ['Reachability was not checked.'],
          dueAt: '2026-04-01T00:00:00.000Z',
          state: 'planned',
          reference: null,
          followUpAt: null,
          outcome: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-03-01T00:00:00.000Z',
        },
        {
          id: 'action-2',
          type: 'internal_review',
          recipient: 'Internal',
          contactSource: '',
          contactLimitations: [],
          dueAt: null,
          state: 'planned',
          reference: null,
          followUpAt: null,
          outcome: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    assert.ok(record);
    const review = buildDisclosureRouteReview(record ? [record] : [], '2026-06-01T00:00:00.000Z');
    assert.equal(review.routes.length, 1);
    assert.equal(review.routes[0]?.review, 'unconfirmed');
    assert.equal(review.routes[0]?.followUpAt, '2026-04-01T00:00:00.000Z');
    assert.match(review.limitations.join(' '), /no discovery or reachability check/i);
  });

  test('source freshness remains independent of operational deadlines and descriptive notes', () => {
    const now = '2026-09-08T12:00:00.000Z';
    const record = normalizeCase({
      id: 'route-freshness', domain: 'example.test', createdAt: now, updatedAt: now,
      actions: [
        { id: 'expired', type: 'security_contact_report', recipient: 'security@example.test', contactSource: 'Publisher disclosure file', routeObservedAt: '2026-09-08T10:00:00.000Z', routeReviewAfter: now, followUpAt: '2027-01-01T00:00:00.000Z' },
        { id: 'old', type: 'registrar_report', recipient: 'abuse@example.test', contactSource: 'Registry record', routeObservedAt: '2026-07-01T00:00:00.000Z', contactLimitations: ['Not checked.'] },
        { id: 'current', type: 'registrar_report', recipient: 'report@example.test', contactSource: 'Registry record', routeObservedAt: now, dueAt: '2026-09-01T00:00:00.000Z' },
        { id: 'unknown', type: 'registrar_report', recipient: 'unknown@example.test', contactSource: 'A source label', contactLimitations: ['A descriptive note.'] },
      ],
    });
    assert.ok(record);
    const routes = buildDisclosureRouteReview([record], now).routes;
    assert.equal(routes.find((route) => route.recipient === 'security@example.test')?.review, 'due');
    assert.equal(routes.find((route) => route.recipient === 'abuse@example.test')?.review, 'due');
    assert.equal(routes.find((route) => route.recipient === 'report@example.test')?.review, 'current');
    assert.equal(routes.find((route) => route.recipient === 'unknown@example.test')?.review, 'unconfirmed');
  });

  test('every existing external reporting action participates, including platform reports', () => {
    const types = ['network_hosting_report', 'registrar_report', 'registry_report', 'security_contact_report', 'platform_report', 'defensive_control', 'internal_review'];
    const record = fixtureRecord('reporting-types', types.map((type) => ({ id: type, type, recipient: 'Fixture recipient', contactSource: 'Fixture source', routeObservedAt: CLOCK })));
    assert.deepEqual(buildDisclosureRouteReview([record], CLOCK).routes.map((route) => route.actionType).sort(),
      ['network_hosting_report', 'platform_report', 'registrar_report', 'registry_report', 'security_contact_report']);
  });

  test('source, action and evaluation clocks retain unknown and malformed values without a Case-edit fallback', () => {
    const record = fixtureRecord('route-clocks', [{ id: 'clock-action', type: 'platform_report', recipient: 'Fixture route', contactSource: 'Fixture source', routeObservedAt: CLOCK }]);
    const action = record.actions[0]!;
    record.actions = [
      { ...action, id: 'unknown', routeObservedAt: null, updatedAt: '', followUpAt: '2026-09-11T10:00:00.000Z' },
      { ...action, id: 'invalid', routeObservedAt: '2026-02-29T10:00:00Z', updatedAt: '2026-09-10', routeReviewAfter: '2026-09-20' },
      { ...action, id: 'known', routeObservedAt: '2026-09-10T09:00:00.123Z', routeReviewAfter: '2026-09-11T10:00:00.000Z' },
    ];
    const review = buildDisclosureRouteReview([record], CLOCK);
    assert.equal(review.evaluatedAt, CLOCK);
    for (const id of ['unknown', 'invalid']) {
      const route = review.routes.find((value) => value.id.endsWith(`:${id}`))!;
      assert.equal(route.observedAt, null);
      assert.equal(route.updatedAt, null);
      assert.equal(route.review, 'unconfirmed');
    }
    assert.equal(review.routes.find((value) => value.id.endsWith(':known'))?.observedAt, '2026-09-10T09:00:00.123Z');
    assert.deepEqual(buildDisclosureRouteReview([{ ...record, actions: [...record.actions].reverse() }], CLOCK), review);
    const invalidClock = buildDisclosureRouteReview([record], '2026-09-10');
    assert.equal(invalidClock.evaluatedAt, null);
    assert.ok(invalidClock.routes.every((route) => route.review === 'unconfirmed'));
    assert.equal(buildDisclosureRouteReview([record], '2026-09-11T10:00:00.000Z').routes.find((value) => value.id.endsWith(':known'))?.review, 'due');
  });

  test('all reporting routes in an admitted multi-Case store remain available beyond the former projection ceiling', () => {
    const records = Array.from({ length: 50 }, (_, caseIndex) => fixtureRecord(`routes-${caseIndex}`, Array.from({ length: 50 }, (_, actionIndex) => ({
      id: `action-${actionIndex}`, type: 'platform_report', recipient: `Fixture recipient ${actionIndex}`, contactSource: 'Retained platform policy', routeObservedAt: CLOCK,
    }))));
    assert.equal(records.length, 50);
    assert.ok(records.every((record) => record.actions.length === 50));
    assert.ok(Buffer.byteLength(serializeCaseStore(records)) <= MAX_CASE_STORE_BYTES);
    const admitted = enforceStoreBudget(records);
    assert.equal(admitted.pruned, 0);
    const review = buildDisclosureRouteReview(admitted.cases, CLOCK);
    assert.equal(review.routes.length, 2_500);
    assert.equal(new Set(review.routes.map((route) => route.id)).size, 2_500);
    assert.equal(review.truncated, false);
    assert.equal(review.sourceCasesOmitted, 0);
    assert.equal(review.sourceActionsOmitted, 0);
  });

  test('out-of-contract source arrays retain exact separate omissions instead of a silent display cap', () => {
    const record = fixtureRecord('oversized-routes', [{ id: 'route', type: 'registrar_report', recipient: 'Fixture recipient' }]);
    const action = record.actions[0]!;
    record.actions = Array.from({ length: MAX_CASE_ACTIONS + 3 }, (_, index) => ({ ...action, id: `route-${index}` }));
    const records = Array.from({ length: MAX_CASES + 2 }, (_, index) => ({ ...record, id: `case-${index}` }));
    const review = buildDisclosureRouteReview(records, CLOCK);
    assert.equal(review.sourceCasesOmitted, 2);
    assert.equal(review.sourceActionsOmitted, MAX_CASES * 3);
    assert.equal(review.routes.length, MAX_CASES * MAX_CASE_ACTIONS);
    assert.equal(review.truncated, true);
    assert.ok(review.routes.every((route) => !route.id.endsWith(':route-0') && !route.id.endsWith(':route-1') && !route.id.endsWith(':route-2')));
  });
});
