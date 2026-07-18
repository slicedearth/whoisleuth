'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { parseWhoisChain } = require('../lib/whois.mts');
const fixtures = require('../fixtures/whois-registry-fixtures');

describe('WHOIS registry compatibility fixtures', () => {
  for (const fixture of fixtures) {
    test(fixture.name, () => {
      const parsed = parseWhoisChain(fixture.chain);
      for (const [field, expected] of Object.entries(fixture.expected)) {
        assert.deepEqual(parsed[field], expected, `${fixture.name}: ${field}`);
      }
    });
  }

  test('does not unlock ambiguous aliases when registry marker sets are incomplete', () => {
    const parsed = parseWhoisChain([
      { server: 'whois.iana.org', response: 'domain: TEST\nrefer: whois.registry.invalid\n' },
      {
        server: 'whois.registry.invalid',
        response: [
          'Domain Name: EXAMPLE.TEST',
          'ROID: SHOULD-NOT-PROMOTE',
          'Expiration Time: 2030-01-02',
          'Sponsoring Registrar Organization: SHOULD-NOT-PROMOTE',
          'validity: 02-01-2030',
          'Record created on: 2020-01-02',
          'Registration Service Provider: SHOULD-NOT-PROMOTE',
        ].join('\n'),
      },
    ]);

    assert.equal(parsed.registryDomainId, undefined);
    assert.equal(parsed.registrar, undefined);
    assert.equal(parsed.createdDate, undefined);
    assert.equal(parsed.expiryDate, undefined);
  });
});
