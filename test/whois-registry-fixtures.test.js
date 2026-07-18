'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { parseWhoisChain } = require('../lib/whois.mts');
const fixtures = require('../fixtures/whois-registry-fixtures');

const SHARED_ENDPOINT_FAMILIES = [
  { profile: 'amnic-sectioned', baseSuffix: 'am', aliases: ['xn--y9a3aq'] },
  { profile: 'cctld-by-colon', baseSuffix: 'by', aliases: ['xn--90ais'] },
  { profile: 'cnnic-colon', baseSuffix: 'cn', aliases: ['xn--fiqs8s', 'xn--fiqz9s'] },
  { profile: 'dot-leader', baseSuffix: 'kr', aliases: ['xn--3e0b707e'] },
  { profile: 'eurid-sectioned', baseSuffix: 'eu', aliases: ['xn--e1a4c', 'xn--qxa6a'] },
  { profile: 'hkirc-sectioned', baseSuffix: 'hk', aliases: ['xn--j6w193g'] },
  {
    profile: 'nixi-colon',
    baseSuffix: 'in',
    aliases: [
      'xn--2scrj9c',
      'xn--3hcrj9c',
      'xn--45br5cyl',
      'xn--45brj9c',
      'xn--fpcrj9c3d',
      'xn--gecrj9c',
      'xn--h2breg3eve',
      'xn--h2brj9c',
      'xn--h2brj9c8c',
      'xn--rvc1e0am3e',
      'xn--s9brj9c',
      'xn--xkc2dl3a5ee0h',
    ],
  },
  { profile: 'nic-kz-dot-leader', baseSuffix: 'kz', aliases: ['xn--80ao21a'] },
  { profile: 'rnids-colon', baseSuffix: 'rs', aliases: ['xn--90a3ac'] },
  { profile: 'tci-colon', baseSuffix: 'ru', aliases: ['su', 'xn--p1ai'] },
  { profile: 'thnic-holder-colon', baseSuffix: 'th', aliases: ['xn--o3cw4h'] },
  { profile: 'twnic-colon', baseSuffix: 'tw', aliases: ['xn--kprw13d', 'xn--kpry57d'] },
];

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

  test('covers the version twelve authoritative-negative ccTLD batch', () => {
    const expectedProfiles = [
      'carnet-icann-colon',
      'eif-sectioned',
      'hkirc-sectioned',
      'isnic-handle-blocks',
      'nic-ar-colon',
      'nic-chile-colon',
      'nic-lv-sectioned',
      'register-bg-sectioned',
      'register-si-colon',
      'rnids-colon',
      'sk-nic-colon',
    ];
    const coveredProfiles = fixtures
      .filter((fixture) => fixture.scenario === 'not_found'
        && expectedProfiles.includes(fixture.capabilityProfile))
      .map((fixture) => fixture.capabilityProfile)
      .sort();
    assert.deepEqual(coveredProfiles, expectedProfiles);
  });

  test('reuses each shared-endpoint registry fixture for its declared suffix aliases', () => {
    let covered = 0;
    for (const family of SHARED_ENDPOINT_FAMILIES) {
      const fixture = fixtures.find((candidate) => candidate.capabilityProfile === family.profile
        && candidate.scenario === 'registered');
      assert.ok(fixture, `${family.profile}: registered fixture`);
      const baseDomain = fixture.expected.domainName;
      assert.match(baseDomain, new RegExp(`\\.${escaped(family.baseSuffix)}$`, 'i'));

      for (const alias of family.aliases) {
        const aliasDomain = baseDomain.replace(
          new RegExp(`${escaped(family.baseSuffix)}$`, 'i'),
          alias,
        );
        const chain = fixture.chain.map((hop) => ({
          ...hop,
          response: hop.response
            .replace(new RegExp(escaped(baseDomain), 'gi'), aliasDomain)
            .replace(
              new RegExp(`(^domain:\\s*)${escaped(family.baseSuffix)}(\\s*$)`, 'gim'),
              `$1${alias}$2`,
            ),
        }));
        const parsed = parseWhoisChain(chain);
        assert.equal(parsed.registrationStatus, 'registered', alias);
        assert.equal(parsed.domainName, aliasDomain, alias);
        covered += 1;
      }
    }
    assert.equal(covered, 27);
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

  test('caps repeated Kazakhstan nameserver lines and discloses truncation', () => {
    const nameservers = Array.from(
      { length: 201 },
      (_, index) => `Secondary server: ns${index}.example.invalid`,
    );
    const parsed = parseWhoisChain([
      { server: 'whois.iana.org', response: 'domain: KZ\nrefer: whois.kz.invalid\n' },
      {
        server: 'whois.kz.invalid',
        response: [
          'Domain Name: example.kz',
          'Current Registar: Example Registrar',
          'Primary server: primary.example.invalid',
          ...nameservers,
        ].join('\n'),
      },
    ]);

    assert.equal(parsed.nameservers.length, 200);
    assert.equal(parsed.nameservers[0], 'primary.example.invalid');
    assert.equal(parsed.nameservers.at(-1), 'ns198.example.invalid');
    assert.ok(parsed.fieldsTruncated.includes('nameservers'));
  });
});
