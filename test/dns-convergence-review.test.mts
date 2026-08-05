import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DNS_CONVERGENCE_INPUT_SCHEMA,
  reviewDnsConvergence,
} from '../lib/dns-convergence-review.mts';

const NOW = '2026-08-05T09:00:00.000Z';

function snapshot(observer: string, address: string, observationState: 'observed' | 'partial' = 'observed') {
  return {
    observer,
    source: `${observer} fixture resolver`,
    observedAt: NOW,
    state: observationState,
    records: [{ owner: '@', type: 'A', value: address, ttl: 300 }],
  };
}

describe('DNS convergence review', () => {
  test('reports convergence against expected values and projects supplied TTL horizons', () => {
    const review = reviewDnsConvergence({
      schema: DNS_CONVERGENCE_INPUT_SCHEMA,
      version: 1,
      domain: 'example.test',
      expected: [{ owner: '@', type: 'A', values: ['192.0.2.20'] }],
      snapshots: [snapshot('Resolver A', '192.0.2.20'), snapshot('Resolver B', '192.0.2.20')],
    }, NOW);
    assert.equal(review.state, 'converged');
    assert.equal(review.rows[0]?.state, 'converged');
    assert.equal(review.rows[0]?.observations[0]?.cacheUntil, '2026-08-05T09:05:00.000Z');
  });

  test('keeps divergent, unexpected, and partial observations distinct', () => {
    const divergent = reviewDnsConvergence({
      schema: DNS_CONVERGENCE_INPUT_SCHEMA, version: 1, domain: 'example.test', expected: null,
      snapshots: [snapshot('Resolver A', '192.0.2.10'), snapshot('Resolver B', '192.0.2.20')],
    }, NOW);
    assert.equal(divergent.rows[0]?.state, 'divergent');

    const unexpected = reviewDnsConvergence({
      schema: DNS_CONVERGENCE_INPUT_SCHEMA, version: 1, domain: 'example.test',
      expected: [{ owner: '@', type: 'A', values: ['192.0.2.30'] }],
      snapshots: [snapshot('Resolver A', '192.0.2.20'), snapshot('Resolver B', '192.0.2.20')],
    }, NOW);
    assert.equal(unexpected.rows[0]?.state, 'unexpected');

    const partial = reviewDnsConvergence({
      schema: DNS_CONVERGENCE_INPUT_SCHEMA, version: 1, domain: 'example.test', expected: null,
      snapshots: [snapshot('Resolver A', '192.0.2.20'), snapshot('Resolver B', '192.0.2.20', 'partial')],
    }, NOW);
    assert.equal(partial.rows[0]?.state, 'incomplete');
    assert.equal(partial.gate.pass, false);
  });

  test('requires two distinct observers and rejects records on unavailable snapshots', () => {
    assert.throws(() => reviewDnsConvergence({
      schema: DNS_CONVERGENCE_INPUT_SCHEMA, version: 1, domain: 'example.test', expected: null,
      snapshots: [snapshot('Resolver A', '192.0.2.20'), snapshot('Resolver A', '192.0.2.20')],
    }, NOW), /distinct observer/iu);
    assert.throws(() => reviewDnsConvergence({
      schema: DNS_CONVERGENCE_INPUT_SCHEMA, version: 1, domain: 'example.test', expected: null,
      snapshots: [snapshot('Resolver A', '192.0.2.20'), { ...snapshot('Resolver B', '192.0.2.20'), state: 'unavailable' }],
    }, NOW), /cannot contain records/iu);
  });
});
