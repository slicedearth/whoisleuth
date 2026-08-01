import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isValidAsciiDomainName, isValidAsciiHostname } from '../lib/hostname.mts';

describe('linear ASCII hostname validation', () => {
  test('accepts bounded LDH and punycode labels', () => {
    assert.equal(isValidAsciiHostname('www.example.test'), true);
    assert.equal(isValidAsciiHostname('xn--bcher-kva.example', { requireLowercase: true }), true);
    assert.equal(isValidAsciiHostname('localhost', { requireDot: false }), true);
  });

  test('rejects malformed, mixed-case, and adversarially repeated labels', () => {
    assert.equal(isValidAsciiHostname('-bad.example'), false);
    assert.equal(isValidAsciiHostname('bad-.example'), false);
    assert.equal(isValidAsciiHostname('bad_label.example'), false);
    assert.equal(isValidAsciiHostname('Upper.example', { requireLowercase: true }), false);
    assert.equal(isValidAsciiHostname(`${'xn--0.'.repeat(20_000)}example`), false);
  });

  test('domain-only validation excludes IP literals without narrowing hostname syntax', () => {
    assert.equal(isValidAsciiDomainName('candidate.example', { requireLowercase: true }), true);
    assert.equal(isValidAsciiDomainName('192.0.2.10', { requireLowercase: true }), false);
    assert.equal(isValidAsciiDomainName('999.0.2.10', { requireLowercase: true }), true);
    assert.equal(isValidAsciiDomainName('2001:db8::1', { requireLowercase: true }), false);
  });
});
