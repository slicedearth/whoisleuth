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

  test('covers the version eleven authoritative-negative ccTLD batch', () => {
    const expectedProfiles = [
      'afnic-colon',
      'cira-colon',
      'eurid-sectioned',
      'fi-dot-leader',
      'fred-contact-indirection',
      'internetstiftelsen-colon',
      'nic-at-colon',
      'norid-dot-leader',
      'registro-br-colon',
      'sidn-sectioned',
      'tci-colon',
      'weare-ie-colon',
    ];
    const coveredProfiles = fixtures
      .filter((fixture) => fixture.scenario === 'not_found'
        && expectedProfiles.includes(fixture.capabilityProfile))
      .map((fixture) => fixture.capabilityProfile)
      .sort();
    assert.deepEqual(coveredProfiles, expectedProfiles);
  });

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

  test('keeps new section and handle aliases behind complete registry marker sets', () => {
    const parsed = parseWhoisChain([
      { server: 'whois.iana.org', response: 'domain: TEST\nrefer: whois.registry.invalid\n' },
      {
        server: 'whois.registry.invalid',
        response: [
          'Domain Name: EXAMPLE.TEST',
          'record created: 2020-01-02',
          'registrant: HANDLE-1',
          'role: SHOULD-NOT-PROMOTE',
          'nic-hdl: HANDLE-1',
          '[Holder]',
          'Name: SHOULD-NOT-PROMOTE',
          'RegNr: SHOULD-NOT-PROMOTE',
          'Registrar:',
          '   SHOULD-NOT-PROMOTE',
          'Domain nameservers:',
          '   ns1.example.invalid',
          'registration status: busy, active',
          'DNSSEC signed: yes',
          'Administrative contact: SHOULD-NOT-PROMOTE',
        ].join('\n'),
      },
    ]);

    assert.equal(parsed.createdDate, undefined);
    assert.equal(parsed.registrantOrg, undefined);
    assert.equal(parsed.registrantId, undefined);
    assert.equal(parsed.registrar, undefined);
    assert.equal(parsed.adminName, undefined);
    assert.equal(parsed.dnssec, undefined);
    assert.deepEqual(parsed.nameservers, []);
    assert.deepEqual(parsed.statuses, []);
  });

  test('keeps version ten terse aliases behind complete registry markers', () => {
    const parsed = parseWhoisChain([
      { server: 'whois.iana.org', response: 'domain: TEST\nrefer: whois.registry.invalid\n' },
      {
        server: 'whois.registry.invalid',
        response: [
          'Org: SHOULD-NOT-PROMOTE',
          'Registration or other identification number: SHOULD-NOT-PROMOTE',
          'Domain Name Commencement Date: 02-01-2020',
          'holder-c: HANDLE-1',
          'nic-hdl: HANDLE-1',
          'person: SHOULD-NOT-PROMOTE',
          'org: SHOULD-NOT-PROMOTE',
          'source: NOT-IRNIC',
          'Current Registar: SHOULD-NOT-PROMOTE',
          'Primary server: ns1.example.invalid',
          'domainname: should-not-promote.test',
          'registrar-name: SHOULD-NOT-PROMOTE',
          'Domain Holder Organization: SHOULD-NOT-PROMOTE',
          'Exp date: 02 Jan 2030',
        ].join('\n'),
      },
    ]);

    assert.equal(parsed.registrantId, undefined);
    assert.equal(parsed.registrantOrg, undefined);
    assert.equal(parsed.registrantName, undefined);
    assert.equal(parsed.registrar, undefined);
    assert.equal(parsed.createdDate, undefined);
    assert.equal(parsed.expiryDate, undefined);
    assert.deepEqual(parsed.nameservers, []);
  });

  test('caps newly sectioned bare nameservers and discloses truncation', () => {
    const nameservers = Array.from({ length: 205 }, (_, index) => `ns${index}.example.invalid`);
    const parsed = parseWhoisChain([
      { server: 'whois.iana.org', response: 'domain: BG\nrefer: whois.bg.invalid\n' },
      {
        server: 'whois.bg.invalid',
        response: [
          'DOMAIN NAME: example.bg (example.bg)',
          'registration status: busy, active',
          'NAME SERVER INFORMATION:',
          ...nameservers,
          '',
          'DNSSEC: active',
        ].join('\n'),
      },
    ]);

    assert.equal(parsed.nameservers.length, 200);
    assert.equal(parsed.nameservers[0], 'ns0.example.invalid');
    assert.equal(parsed.nameservers.at(-1), 'ns199.example.invalid');
    assert.ok(parsed.fieldsTruncated.includes('nameservers'));
  });
});
