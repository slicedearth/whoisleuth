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

  test('does not report convergence without a comparable scope', () => {
    const emptySnapshot = (observer: string) => ({
      observer,
      source: `${observer} fixture resolver`,
      observedAt: NOW,
      state: 'observed' as const,
      records: [],
    });
    const unscoped = reviewDnsConvergence({
      schema: DNS_CONVERGENCE_INPUT_SCHEMA, version: 1, domain: 'example.test', expected: null,
      snapshots: [emptySnapshot('Resolver A'), emptySnapshot('Resolver B')],
    }, NOW);
    assert.equal(unscoped.rows.length, 0);
    assert.equal(unscoped.state, 'review');
    assert.equal(unscoped.gate.pass, false);
    assert.match(unscoped.gate.reasons[0] ?? '', /no comparable/iu);

    const unqueried = reviewDnsConvergence({
      schema: DNS_CONVERGENCE_INPUT_SCHEMA, version: 1, domain: 'example.test',
      expected: [{ owner: '@', type: 'MX', values: [] }],
      snapshots: [emptySnapshot('Resolver A'), emptySnapshot('Resolver B')],
    }, NOW);
    assert.equal(unqueried.rows[0]?.state, 'incomplete');
    assert.equal(unqueried.rows[0]?.observations[0]?.state, 'not_queried');
    assert.equal(unqueried.gate.pass, false);
  });

  test('requires explicit complete query coverage for an empty answer', () => {
    const input = {
      schema: DNS_CONVERGENCE_INPUT_SCHEMA, version: 2, domain: 'example.test',
      expected: [{ owner: '@', type: 'MX', values: [] }],
      snapshots: ['Resolver A', 'Resolver B'].map((observer) => ({
        observer, source: 'fixture resolver', observedAt: NOW, state: 'observed', records: [],
        queries: [{ owner: '@', type: 'MX', state: 'observed' }],
      })),
    };
    const complete = reviewDnsConvergence(input, NOW);
    assert.equal(complete.version, 2);
    assert.equal(complete.gate.pass, true);
    assert.equal(complete.rows[0]?.state, 'converged');
    for (const state of ['partial', 'unavailable']) {
      const incomplete = structuredClone(input);
      incomplete.snapshots[1]!.state = state;
      incomplete.snapshots[1]!.queries[0]!.state = state;
      const review = reviewDnsConvergence(incomplete, NOW);
      assert.equal(review.gate.pass, false);
      assert.equal(review.rows[0]?.observations[1]?.state, state);
    }
    input.snapshots[1]!.queries = [];
    assert.equal(reviewDnsConvergence(input, NOW).rows[0]?.observations[1]?.state, 'not_queried');
    assert.equal(reviewDnsConvergence(input, NOW).gate.pass, false);
  });

  test('rejects undeclared, contradictory, duplicate and over-budget query coverage', () => {
    const input = {
      schema: DNS_CONVERGENCE_INPUT_SCHEMA, version: 2, domain: 'example.test', expected: null,
      snapshots: [snapshot('Resolver A', '192.0.2.20'), snapshot('Resolver B', '192.0.2.20')]
        .map((item) => ({ ...item, queries: [{ owner: '@', type: 'A', state: 'observed' }] })),
    };
    assert.equal(reviewDnsConvergence(input, NOW).gate.pass, true);
    const absent = structuredClone(input);
    absent.snapshots[0]!.queries = [];
    assert.throws(() => reviewDnsConvergence(absent, NOW), /declare an observed or partial query/u);
    const duplicate = structuredClone(input);
    duplicate.snapshots[0]!.queries.push({ owner: 'example.test.', type: 'a', state: 'observed' });
    assert.throws(() => reviewDnsConvergence(duplicate, NOW), /duplicates an owner and type/u);
    const contradictory = structuredClone(input);
    contradictory.snapshots[0]!.queries[0]!.state = 'unavailable';
    assert.throws(() => reviewDnsConvergence(contradictory, NOW), /contradicts the snapshot state/u);
    for (const value of [undefined, [{ owner: '@', type: 'ANY', state: 'observed' }], [{ owner: '@', type: 'A', state: 'unknown' }]]) {
      const invalid = structuredClone(input);
      Reflect.set(invalid.snapshots[0]!, 'queries', value);
      assert.throws(() => reviewDnsConvergence(invalid, NOW), /query outcomes|unsupported/u);
    }
    const oversized = structuredClone(input);
    oversized.snapshots[0]!.queries = Array.from({ length: 2_000 }, (_, index) => ({ owner: `s${index}.example.test`, type: 'A', state: 'observed' }));
    oversized.snapshots[0]!.records = [];
    assert.throws(() => reviewDnsConvergence(oversized, NOW), /no more than 0 query outcomes/u);
    assert.throws(() => reviewDnsConvergence({ ...input, version: 3 }, NOW), /version 1 or 2/u);
    assert.throws(() => reviewDnsConvergence({ ...input, version: 1 }, NOW), /unknown field: queries/u);
  });

  test('compares equivalent IPv6 spellings by address value', () => {
    const ipv6Snapshot = (observer: string, value: string) => ({
      observer,
      source: `${observer} fixture resolver`,
      observedAt: NOW,
      state: 'observed' as const,
      records: [{ owner: '@', type: 'AAAA', value, ttl: 300 }],
    });
    const review = reviewDnsConvergence({
      schema: DNS_CONVERGENCE_INPUT_SCHEMA,
      version: 1,
      domain: 'example.test',
      expected: [{ owner: '@', type: 'AAAA', values: ['2001:db8::1'] }],
      snapshots: [
        ipv6Snapshot('Resolver A', '2001:0DB8:0:0:0:0:0:1'),
        ipv6Snapshot('Resolver B', '2001:db8::1'),
      ],
    }, NOW);
    assert.equal(review.rows[0]?.state, 'converged');
    assert.equal(review.gate.pass, true);
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
