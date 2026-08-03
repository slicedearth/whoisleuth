import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { reviewRpkiRoute } from '../lib/rpki-evidence.mts';

const SNAPSHOT = {
  roas: [
    { prefix: '192.0.2.0/24', maxLength: 24, asn: 'AS64496' },
    { prefix: '2001:db8::/32', maxLength: 48, asID: 64497 },
  ],
};

describe('local RPKI route review', () => {
  test('distinguishes valid, wrong-origin, excessive-prefix, and uncovered routes', () => {
    assert.equal(reviewRpkiRoute({
      routePrefix: '192.0.2.0/24',
      originAsn: 'AS64496',
      authorizations: SNAPSHOT,
    }).state, 'valid');
    assert.equal(reviewRpkiRoute({
      routePrefix: '192.0.2.0/24',
      originAsn: 'AS64497',
      authorizations: SNAPSHOT,
    }).state, 'invalid');
    assert.equal(reviewRpkiRoute({
      routePrefix: '192.0.2.0/25',
      originAsn: 'AS64496',
      authorizations: SNAPSHOT,
    }).matches[0]?.state, 'max_length_exceeded');
    assert.equal(reviewRpkiRoute({
      routePrefix: '198.51.100.0/24',
      originAsn: 'AS64496',
      authorizations: SNAPSHOT,
    }).state, 'not_found');
  });

  test('supports bounded IPv6 authorizations and explicit malformed input', () => {
    assert.equal(reviewRpkiRoute({
      routePrefix: '2001:db8:1::/48',
      originAsn: 64497,
      authorizations: SNAPSHOT,
    }).state, 'valid');
    assert.equal(reviewRpkiRoute({
      routePrefix: 'not-a-route',
      originAsn: 64497,
      authorizations: SNAPSHOT,
    }).state, 'invalid_input');
  });

  test('rejects malformed authorization prefixes without manufacturing route invalidity', () => {
    const report = reviewRpkiRoute({
      routePrefix: '198.51.100.0/24',
      originAsn: 64496,
      authorizations: { roas: [{ prefix: '192.0.2.0/', maxLength: 0, asn: 64500 }] },
    });
    assert.equal(report.state, 'not_found');
    assert.equal(report.coveringAuthorizationCount, 0);
    assert.equal(report.rejectedCount, 1);
  });
});
