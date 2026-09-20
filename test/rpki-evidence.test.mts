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
  test('rejects coerced origins and treats AS0 authorisations as a denial rather than a valid route', () => {
    for (const originAsn of [undefined, null, false, true, '', ' ', [], {}, '1e2', '0x10', 0, 'AS0']) {
      const report = reviewRpkiRoute({ routePrefix: '192.0.2.0/24', originAsn, authorizations: { roas: [{ prefix: '192.0.2.0/24', maxLength: 24, asn: 0 }] } });
      assert.equal(report.state, 'invalid_input', JSON.stringify(originAsn));
      assert.equal(report.matchingAuthorizationCount, 0);
    }
    const denied = reviewRpkiRoute({ routePrefix: '192.0.2.0/24', originAsn: 64496, authorizations: { roas: [{ prefix: '192.0.2.0/24', maxLength: 24, asn: 0 }] } });
    assert.equal(denied.state, 'invalid');
    assert.equal(denied.coveringAuthorizationCount, 1);
    assert.equal(denied.matches[0]?.asn, 0);
    for (const asn of [null, false, true, '', []]) {
      const report = reviewRpkiRoute({ routePrefix: '192.0.2.0/24', originAsn: 64496, authorizations: { roas: [{ prefix: '192.0.2.0/24', maxLength: 24, asn }] } });
      assert.equal(report.state, 'partial');
      assert.equal(report.rejectedCount, 1);
    }
  });

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
    assert.equal(report.state, 'partial');
    assert.equal(report.coveringAuthorizationCount, 0);
    assert.equal(report.rejectedCount, 1);
  });

  test('counts matches across the full bounded input before limiting displayed evidence', () => {
    const report = reviewRpkiRoute({
      routePrefix: '192.0.2.0/24',
      originAsn: 'AS64496',
      authorizations: {
        roas: Array.from({ length: 51 }, (_, index) => ({
          prefix: '192.0.2.0/24',
          maxLength: 24,
          asn: index === 50 ? 'AS64496' : 'AS64497',
        })),
      },
    });
    assert.equal(report.state, 'partial');
    assert.equal(report.coveringAuthorizationCount, 51);
    assert.equal(report.matchingAuthorizationCount, 1);
    assert.equal(report.matches.length, 50);
    assert.equal(report.truncated, true);
  });
});
