import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildServiceDependencyReview } from '../frontend/src/lib/analysis/service-dependency-review.ts';

describe('service dependency review projection', () => {
  test('surfaces external and in-domain aliases without claiming a vulnerability', () => {
    const review = buildServiceDependencyReview({
      domain: 'example.test',
      dnsEvidence: {
        source: 'dns',
        complete: true,
        diagnostics: {
          cname: { status: 'success' },
          https: { status: 'success' },
        },
      },
      dnsRecords: {
        cname: ['edge.external.test'],
        https: [{
          mode: 'alias',
          target: 'service.example.test',
          serviceUnavailable: false,
        }],
      },
    });

    assert.ok(review);
    assert.equal(review.state, 'review');
    assert.equal(review.dependencies.length, 2);
    assert.equal(review.dependencies[0]?.relation, 'external');
    assert.equal(review.dependencies[1]?.relation, 'in_domain');
    assert.equal(review.dependencies.some((item) => ['vulnerable', 'claimable'].includes(item.state)), false);
    assert.match(review.limitations.join(' '), /not evidence that it is dangling, vulnerable/u);
  });

  test('reports complete point-in-time non-observation without calling it safe', () => {
    const review = buildServiceDependencyReview({
      domain: 'example.test',
      dnsEvidence: {
        source: 'dns',
        complete: true,
        diagnostics: {
          cname: { status: 'not_found' },
          https: { status: 'not_found' },
        },
      },
      dnsRecords: { cname: [], https: [] },
    });

    assert.ok(review);
    assert.equal(review.state, 'not_observed');
    assert.match(review.label, /No alias dependency observed in this capture/u);
    assert.doesNotMatch(review.label, /safe/iu);
  });

  test('preserves resolver failure as unavailable', () => {
    const review = buildServiceDependencyReview({
      domain: 'example.test',
      dnsEvidence: {
        source: 'dns',
        complete: false,
        diagnostics: {
          cname: { status: 'error' },
        },
      },
      dnsRecords: { cname: [] },
    });

    assert.ok(review);
    assert.equal(review.state, 'unavailable');
    assert.match(review.nextSteps[0] ?? '', /Refresh complete DNS evidence/u);
  });

  test('keeps an omitted extended HTTPS query unavailable when no CNAME was observed', () => {
    const review = buildServiceDependencyReview({
      domain: 'example.test',
      dnsEvidence: {
        source: 'dns',
        complete: true,
        diagnostics: {
          cname: { status: 'not_found' },
        },
      },
      dnsRecords: { cname: [] },
    });

    assert.ok(review);
    assert.equal(review.state, 'unavailable');
  });

  test('rejects malformed targets and bounds dependency count', () => {
    const review = buildServiceDependencyReview({
      domain: 'EXAMPLE.TEST.',
      dnsEvidence: {
        source: 'dns',
        complete: true,
        diagnostics: { cname: { status: 'success' } },
      },
      dnsRecords: {
        cname: [
          'bad target',
          'duplicate.external.test',
          'DUPLICATE.EXTERNAL.TEST.',
          ...Array.from({ length: 30 }, (_, index) => `edge-${index}.external.test`),
        ],
      },
    });

    assert.ok(review);
    assert.equal(review.dependencies.length, 20);
    assert.equal(review.dependencies.filter((item) => item.target === 'duplicate.external.test').length, 1);
  });
});
