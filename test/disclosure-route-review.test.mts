import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildDisclosureRouteReview } from '../frontend/src/lib/analysis/disclosure-route-review.ts';
import { normalizeCase } from '../frontend/src/lib/analysis/case-model.ts';

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
});
