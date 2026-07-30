import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildDisclosurePolicyHealth } from '../frontend/src/lib/analysis/disclosure-policy-health.ts';

describe('disclosure policy health', () => {
  test('summarizes current disclosure coverage without claiming reachability', () => {
    const health = buildDisclosurePolicyHealth({
      state: 'present',
      expiresAt: '2026-12-01T00:00:00.000Z',
      contacts: ['mailto:security@example.test'],
      policies: ['https://example.test/security'],
      encryption: ['https://example.test/key'],
      languages: ['en'],
    }, '2026-06-01T00:00:00.000Z');
    assert.equal(health.state, 'current');
    assert.equal(health.coverage.contacts, 1);
    assert.match(health.limitations.join(' '), /no reachability check/iu);
  });

  test('keeps missing and expired evidence separate', () => {
    const expired = buildDisclosurePolicyHealth({
      state: 'present',
      expiresAt: '2026-05-01T00:00:00.000Z',
      contacts: ['mailto:security@example.test'],
    }, '2026-06-01T00:00:00.000Z');
    const unavailable = buildDisclosurePolicyHealth({ state: 'unavailable' }, '2026-06-01T00:00:00.000Z');
    assert.equal(expired.state, 'expired');
    assert.equal(unavailable.state, 'unavailable');
    assert.notEqual(expired.state, unavailable.state);
  });
});
