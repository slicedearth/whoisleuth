'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { parseWhoisChain } = require('../lib/whois.mts');
const fixtures = require('../fixtures/whois-registry-fixtures');

const PARSER_FAMILY_ALIASES = [
  { profile: 'aeda-colon', baseSuffix: 'ae', aliases: ['xn--mgbaam7a8h'] },
  { profile: 'amnic-sectioned', baseSuffix: 'am', aliases: ['xn--y9a3aq'] },
  { profile: 'cctld-by-colon', baseSuffix: 'by', aliases: ['xn--90ais'] },
  { profile: 'channel-islands-sectioned', baseSuffix: 'gg', aliases: ['je'] },
  { profile: 'cnnic-colon', baseSuffix: 'cn', aliases: ['xn--fiqs8s', 'xn--fiqz9s'] },
  { profile: 'dot-leader', baseSuffix: 'kr', aliases: ['xn--3e0b707e'] },
  { profile: 'eurid-sectioned', baseSuffix: 'eu', aliases: ['xn--e1a4c', 'xn--qxa6a'] },
  { profile: 'hkirc-sectioned', baseSuffix: 'hk', aliases: ['xn--j6w193g'] },
  { profile: 'identity-digital-shared-colon', baseSuffix: 'gi', aliases: ['vc'] },
  { profile: 'lanic-icann-colon', baseSuffix: 'la', aliases: ['xn--q7ce6a'] },
  { profile: 'marnet-contact-indirection', baseSuffix: 'mk', aliases: ['xn--d1alf'] },
  { profile: 'mediaserv-object-colon', baseSuffix: 'mq', aliases: ['gf'] },
  { profile: 'monic-minimal-colon', baseSuffix: 'mo', aliases: ['xn--mix891f'] },
  { profile: 'isoc-il-colon', baseSuffix: 'il', aliases: ['xn--4dbrk0ce'] },
  { profile: 'irnic-handle-blocks', baseSuffix: 'ir', aliases: ['xn--mgba3a4f16a'] },
  { profile: 'mynic-colon', baseSuffix: 'my', aliases: ['xn--mgbx4cd0ab'] },
  { profile: 'nic-dz-colon', baseSuffix: 'dz', aliases: ['xn--lgbbat1ad8j'] },
  { profile: 'nic-io-colon', baseSuffix: 'io', aliases: ['ac'] },
  { profile: 'nic-sa-colon', baseSuffix: 'sa', aliases: ['xn--mgberp4a5d4ar'] },
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
      'xn--mgbbh1a',
      'xn--mgbbh1a71e',
      'xn--mgbgu82a',
      'xn--rvc1e0am3e',
      'xn--s9brj9c',
      'xn--xkc2dl3a5ee0h',
    ],
  },
  { profile: 'nic-kz-dot-leader', baseSuffix: 'kz', aliases: ['xn--80ao21a'] },
  { profile: 'om-registry-colon', baseSuffix: 'om', aliases: ['xn--mgb9awbf'] },
  { profile: 'rnids-colon', baseSuffix: 'rs', aliases: ['xn--90a3ac'] },
  { profile: 'afnic-colon', baseSuffix: 'fr', aliases: ['pm', 're', 'tf', 'wf', 'yt'] },
  {
    profile: 'sgnic-colon',
    baseSuffix: 'sg',
    aliases: ['xn--clchc0ea0b2g2a9gcd', 'xn--yfro4i67o'],
  },
  { profile: 'tci-colon', baseSuffix: 'ru', aliases: ['su', 'xn--p1ai'] },
  { profile: 'thnic-holder-colon', baseSuffix: 'th', aliases: ['xn--o3cw4h'] },
  { profile: 'ati-tn-dot-leader', baseSuffix: 'tn', aliases: ['xn--pgbs0dh'] },
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

  test('reuses each independently documented parser fixture for its declared suffix aliases', () => {
    let covered = 0;
    for (const family of PARSER_FAMILY_ALIASES) {
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
    assert.equal(covered, 52);
  });

  test('covers the version seventeen shared-service ccTLD batch', () => {
    const expectedProfiles = [
      'identity-digital-shared-colon',
      'lanic-icann-colon',
      'marnet-contact-indirection',
      'mediaserv-object-colon',
      'monic-minimal-colon',
    ];
    for (const scenario of ['registered', 'not_found']) {
      const coveredProfiles = fixtures
        .filter((fixture) => fixture.scenario === scenario
          && expectedProfiles.includes(fixture.capabilityProfile))
        .map((fixture) => fixture.capabilityProfile)
        .sort();
      assert.deepEqual(coveredProfiles, expectedProfiles, scenario);
    }
  });

  test('covers the version eighteen fixture-backed ccTLD batch', () => {
    const expectedProfiles = [
      'andorra-rdds-colon',
      'cc-registry-colon',
      'channel-islands-sectioned',
      'lsnic-contact-indirection',
      'mm-registry-colon',
      'nic-bh-icann-colon',
      'nic-cr-contact-indirection',
      'nic-dz-colon',
      'nic-gl-colon',
      'nic-mc-colon',
    ];
    for (const scenario of ['registered', 'not_found']) {
      const coveredProfiles = fixtures
        .filter((fixture) => fixture.scenario === scenario
          && expectedProfiles.includes(fixture.capabilityProfile))
        .map((fixture) => fixture.capabilityProfile)
        .sort();
      assert.deepEqual(coveredProfiles, expectedProfiles, scenario);
    }
  });

  test('covers the version nineteen Omani registry family', () => {
    for (const scenario of ['registered', 'not_found']) {
      const covered = fixtures.filter((fixture) => fixture.capabilityProfile === 'om-registry-colon'
        && fixture.scenario === scenario);
      assert.equal(covered.length, 1, scenario);
    }
  });

  test('covers the version twenty 25-suffix registered-response batch', () => {
    const expectedProfiles = [
      'iana-cc-colon-as', 'iana-cc-colon-bm', 'iana-cc-colon-cm', 'iana-cc-colon-cv',
      'iana-cc-colon-cx', 'iana-cc-colon-ec', 'iana-cc-colon-fm', 'iana-cc-colon-fo',
      'iana-cc-colon-gd', 'iana-cc-colon-gy', 'iana-cc-colon-hn', 'iana-cc-colon-ht',
      'iana-cc-colon-ky', 'iana-cc-colon-lb', 'iana-cc-colon-mg', 'iana-cc-colon-ml',
      'iana-cc-colon-ms', 'iana-cc-colon-mu', 'iana-cc-colon-ng', 'iana-cc-colon-pw',
      'iana-cc-colon-rw', 'iana-cc-colon-sd', 'iana-cc-colon-sr', 'iana-cc-colon-ss',
      'iana-cc-colon-to',
    ];
    const coveredProfiles = fixtures
      .filter((fixture) => fixture.scenario === 'registered'
        && expectedProfiles.includes(fixture.capabilityProfile))
      .map((fixture) => fixture.capabilityProfile)
      .sort();

    assert.deepEqual(coveredProfiles, expectedProfiles);
  });

  test('covers the version twenty-one 25-suffix registered and negative-response batch', () => {
    const registeredProfiles = [
      'iana-cc-colon-bf', 'iana-cc-colon-dm', 'iana-cc-colon-fj',
      'iana-cc-colon-kn', 'iana-cc-colon-ly', 'iana-cc-colon-mr',
      'iana-cc-colon-pe', 'iana-cc-colon-pg', 'iana-cc-colon-qa',
      'iana-cc-colon-st', 'iana-cc-colon-sx', 'iana-cc-colon-sy',
      'iana-cc-colon-tv', 'iana-cc-colon-ug', 'iana-cc-colon-uz',
      'iana-cc-colon-ws', 'iana-cc-colon-ye', 'iana-cc-colon-zm',
      'iana-cc-contact-mw', 'iana-cc-contact-tz', 'iana-cc-contact-ve',
      'internetstiftelsen-nu-colon', 'nic-kg-sectioned',
    ];
    const negativeProfiles = ['iana-cc-negative-nc', 'iana-cc-negative-vg'];

    assert.deepEqual(
      fixtures.filter((fixture) => fixture.scenario === 'registered'
        && registeredProfiles.includes(fixture.capabilityProfile))
        .map((fixture) => fixture.capabilityProfile).sort(),
      [...registeredProfiles].sort(),
    );
    assert.deepEqual(
      fixtures.filter((fixture) => fixture.scenario === 'not_found'
        && negativeProfiles.includes(fixture.capabilityProfile))
        .map((fixture) => fixture.capabilityProfile).sort(),
      [...negativeProfiles].sort(),
    );
    assert.equal(registeredProfiles.length + negativeProfiles.length, 25);
  });

  test('covers the version twenty-two 27-suffix authoritative-negative batch', () => {
    const expectedProfiles = [
      'ag', 'aw', 'ax', 'bi', 'bn', 'ci', 'gh', 'gn', 'gs',
      'im', 'ki', 'ma', 'mz', 'nf', 'pr', 'sc', 'sh', 'sn',
      'so', 'tc', 'td', 'tg', 'tm', 'vu', 'xn--j1amh',
      'xn--mgbah1a3hjkrd', 'xn--ogbpf8fl',
    ].map((suffix) => `iana-cc-negative-${suffix}`);

    assert.equal(expectedProfiles.length, 27);
    assert.deepEqual(
      fixtures.filter((fixture) => fixture.scenario === 'not_found'
        && expectedProfiles.includes(fixture.capabilityProfile))
        .map((fixture) => fixture.capabilityProfile).sort(),
      [...expectedProfiles].sort(),
    );
  });

  test('does not promote no-data wording embedded in policy prose', () => {
    const parsed = parseWhoisChain([
      { server: 'whois.iana.org', response: 'domain: TEST\nrefer: whois.registry.invalid\n' },
      {
        server: 'whois.registry.invalid',
        response: 'Policy notice: No Data Found is shown only when an object is absent.',
      },
    ]);

    assert.equal(parsed.registrationStatus, 'inconclusive');
    assert.equal(parsed.notFound, false);
    assert.equal(parsed.chainStatus, 'partial');
  });

  test('keeps available-for-purchase wording behind the complete response line', () => {
    const parsed = parseWhoisChain([
      { server: 'whois.iana.org', response: 'domain: TEST\nrefer: whois.registry.invalid\n' },
      {
        server: 'whois.registry.invalid',
        response: 'Policy notice: Domain example.test is available for purchase only after release.',
      },
    ]);

    assert.equal(parsed.registrationStatus, 'inconclusive');
    assert.equal(parsed.notFound, false);
    assert.equal(parsed.chainStatus, 'partial');
  });

  test('keeps Channel Islands ordinal dates behind the complete marker set', () => {
    const parsed = parseWhoisChain([
      { server: 'whois.iana.org', response: 'domain: TEST\nrefer: whois.registry.invalid\n' },
      {
        server: 'whois.registry.invalid',
        response: [
          'Domain:',
          '  example.test',
          'Relevant dates:',
          '  Registered on 24th April 1997 at 00:00:00.000',
          'Registration status:',
          '  Registered until cancelled',
        ].join('\n'),
      },
    ]);

    assert.equal(parsed.registrationStatus, 'registered');
    assert.equal(parsed.domainName, 'example.test');
    assert.equal(parsed.createdDate, undefined);
    assert.equal(parsed.createdDateIso, null);
    assert.deepEqual(parsed.statuses, ['Registered until cancelled']);
  });

  test('does not treat an empty sectioned registration status as positive evidence', () => {
    const parsed = parseWhoisChain([
      { server: 'whois.iana.org', response: 'domain: TEST\nrefer: whois.registry.invalid\n' },
      {
        server: 'whois.registry.invalid',
        response: [
          'Domain:',
          '  example.test',
          'Relevant dates:',
          'Registration status:',
          'Name servers:',
        ].join('\n'),
      },
    ]);

    assert.equal(parsed.registrationStatus, 'inconclusive');
    assert.equal(parsed.chainStatus, 'partial');
    assert.equal(parsed.domainName, 'example.test');
    assert.deepEqual(parsed.statuses, []);
  });

  test('keeps MONIC record and nameserver aliases behind the complete marker set', () => {
    const parsed = parseWhoisChain([
      { server: 'whois.iana.org', response: 'domain: TEST\nrefer: whois.registry.invalid\n' },
      {
        server: 'whois.registry.invalid',
        response: [
          'Domain Name: EXAMPLE.TEST',
          'Record created on 2020-01-02 03:04:05',
          'Domain name servers:',
          'ns1.example.invalid',
        ].join('\n'),
      },
    ]);

    assert.equal(parsed.registrationStatus, 'registered');
    assert.equal(parsed.createdDate, undefined);
    assert.deepEqual(parsed.nameservers, []);
  });

  test('caps MONIC bare nameservers and discloses truncation', () => {
    const nameservers = Array.from({ length: 205 }, (_, index) => `ns${index}.example.invalid`);
    const parsed = parseWhoisChain([
      { server: 'whois.iana.org', response: 'domain: MO\nrefer: whois.registry.invalid\n' },
      {
        server: 'whois.registry.invalid',
        response: [
          '% Monic Whois Server Version 1.0',
          'Domain Name: EXAMPLE.MO',
          'Record created on 2020-01-02 03:04:05',
          'Domain name servers:',
          ...nameservers,
        ].join('\n'),
      },
    ]);

    assert.equal(parsed.nameservers.length, 200);
    assert.equal(parsed.nameservers[0], 'ns0.example.invalid');
    assert.equal(parsed.nameservers.at(-1), 'ns199.example.invalid');
    assert.ok(parsed.fieldsTruncated.includes('nameservers'));
  });

  test('keeps Kyrgyz registry aliases behind the complete marker set', () => {
    const parsed = parseWhoisChain([
      { server: 'whois.iana.org', response: 'domain: KG\nrefer: whois.kg.invalid\n' },
      {
        server: 'whois.kg.invalid',
        response: [
          'Domain EXAMPLE.KG (ACTIVE)',
          'Record created: Mon May 16 08:46:41 2011',
          'Name servers in the listed order:',
          'NS1.EXAMPLE.INVALID',
        ].join('\n'),
      },
    ]);

    assert.equal(parsed.registrationStatus, 'inconclusive');
    assert.equal(parsed.domainName, undefined);
    assert.equal(parsed.createdDate, undefined);
    assert.deepEqual(parsed.nameservers, []);
  });

  test('caps Kyrgyz registry bare nameservers and discloses truncation', () => {
    const parsed = parseWhoisChain([
      { server: 'whois.iana.org', response: 'domain: KG\nrefer: whois.kg.invalid\n' },
      {
        server: 'whois.kg.invalid',
        response: [
          '% This is the .kg ccTLD Whois server',
          'Domain EXAMPLE.KG (ACTIVE)',
          'Record created: Mon May 16 08:46:41 2011',
          'Name servers in the listed order:',
          ...Array.from({ length: 205 }, (_, index) => `ns${index}.example.invalid`),
        ].join('\n'),
      },
    ]);

    assert.equal(parsed.registrationStatus, 'registered');
    assert.equal(parsed.nameservers.length, 200);
    assert.ok(parsed.fieldsTruncated.includes('nameservers'));
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
