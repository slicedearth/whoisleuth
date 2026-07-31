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
    assert.equal(review.routes[0]?.review, 'due');
    assert.match(review.limitations.join(' '), /no discovery or reachability check/i);
  });
});
