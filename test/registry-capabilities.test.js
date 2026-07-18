'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { domainToUnicode } = require('node:url');

const {
  REGISTRY_CAPABILITIES_VERSION,
  registryAccessDiagnosticFor,
  registryCapabilityFor,
  registryCompatibilityMatrix,
  listRegistryCapabilities,
} = require('../lib/registry-capabilities.mts');
const whoisFixtures = require('../fixtures/whois-registry-fixtures');

const SHARED_ENDPOINT_SUFFIXES = [
  { id: 'aeda-idn-colon', suffixes: ['xn--mgbaam7a8h'] },
  { id: 'amnic-sectioned', suffixes: ['xn--y9a3aq'] },
  { id: 'cctld-by-colon', suffixes: ['xn--90ais'] },
  { id: 'channel-islands-sectioned', suffixes: ['je'] },
  { id: 'cnnic-colon', suffixes: ['xn--fiqs8s', 'xn--fiqz9s'] },
  { id: 'dot-leader', suffixes: ['xn--3e0b707e'] },
  { id: 'eurid-sectioned', suffixes: ['xn--e1a4c', 'xn--qxa6a'] },
  { id: 'hkirc-sectioned', suffixes: ['xn--j6w193g'] },
  { id: 'identity-digital-shared-colon', suffixes: ['vc'] },
  { id: 'lanic-icann-colon', suffixes: ['xn--q7ce6a'] },
  { id: 'marnet-contact-indirection', suffixes: ['xn--d1alf'] },
  { id: 'mediaserv-object-colon', suffixes: ['gf'] },
  { id: 'monic-minimal-colon', suffixes: ['xn--mix891f'] },
  { id: 'isoc-il-idn-colon', suffixes: ['xn--4dbrk0ce'] },
  { id: 'irnic-idn-handle-blocks', suffixes: ['xn--mgba3a4f16a'] },
  { id: 'identity-digital-colon-mn', suffixes: ['xn--l1acc'] },
  { id: 'mynic-idn-colon', suffixes: ['xn--mgbx4cd0ab'] },
  { id: 'nic-dz-idn-colon', suffixes: ['xn--lgbbat1ad8j'] },
  { id: 'nic-io-colon', suffixes: ['ac'] },
  { id: 'nic-sa-idn-colon', suffixes: ['xn--mgberp4a5d4ar'] },
  {
    id: 'nixi-colon',
    suffixes: [
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
  { id: 'nixi-arabic-colon', suffixes: ['xn--mgbbh1a', 'xn--mgbbh1a71e', 'xn--mgbgu82a'] },
  { id: 'nic-kz-dot-leader', suffixes: ['xn--80ao21a'] },
  { id: 'om-registry-colon', suffixes: ['xn--mgb9awbf'] },
  { id: 'qatar-idn-colon', suffixes: ['xn--wgbl6a'] },
  { id: 'rnids-colon', suffixes: ['xn--90a3ac'] },
  { id: 'afnic-colon', suffixes: ['pm', 're', 'tf', 'wf', 'yt'] },
  { id: 'sgnic-colon', suffixes: ['xn--clchc0ea0b2g2a9gcd', 'xn--yfro4i67o'] },
  { id: 'tci-colon', suffixes: ['su', 'xn--p1ai'] },
  { id: 'thnic-holder-colon', suffixes: ['xn--o3cw4h'] },
  { id: 'ati-tn-idn-dot-leader', suffixes: ['xn--pgbs0dh'] },
  { id: 'twnic-colon', suffixes: ['xn--kprw13d', 'xn--kpry57d'] },
];

const VERSION_14_SUFFIXES = [
  { id: 'nic-io-colon', suffixes: ['ac'], coverageState: 'fixture_verified' },
  { id: 'norid-closed-no-iana-service', suffixes: ['bv', 'sj'], coverageState: 'access_documented' },
  { id: 'switch-policy-restricted', suffixes: ['li'], coverageState: 'access_documented' },
  { id: 'afnic-colon', suffixes: ['pm', 're', 'tf', 'wf', 'yt'], coverageState: 'fixture_verified' },
  { id: 'sgnic-colon', suffixes: ['xn--clchc0ea0b2g2a9gcd', 'xn--yfro4i67o'], coverageState: 'fixture_verified' },
  { id: 'no-iana-machine-service-gr', suffixes: ['xn--qxam'], coverageState: 'access_documented' },
];

const VERSION_15_ACCESS_SUFFIXES = [
  'ao', 'az', 'bb', 'bd', 'bs', 'bt', 'bz', 'cd', 'cg', 'ck',
  'cu', 'cw', 'dj', 'eg', 'et', 'fk', 'gm', 'gu', 'jo', 'kh',
];
const VERSION_16_ACCESS_SUFFIXES = [
  'aq', 'er', 'ga', 'gb', 'gw', 'jm', 'km', 'kp', 'kw', 'lc',
  'lk', 'lr', 'mh', 'mp', 'mt', 'mv', 'ne', 'ni', 'np', 'nr',
  'pa', 'ps', 'py', 'sl', 'sv', 'sz', 'tj', 'tt', 'va',
  'xn--54b7fta0cc', 'xn--fzc2c9e2c', 'xn--node', 'xn--xkc2al3hye2a', 'zw',
];
const VERSION_18_FIXTURE_SUFFIXES = [
  { id: 'andorra-rdds-colon', suffixes: ['ad'], rdapAccessProfile: 'iana-bootstrap' },
  { id: 'nic-bh-icann-colon', suffixes: ['bh'], rdapAccessProfile: 'no-iana-service' },
  { id: 'cc-registry-colon', suffixes: ['cc'], rdapAccessProfile: 'iana-bootstrap' },
  { id: 'nic-cr-contact-indirection', suffixes: ['cr'], rdapAccessProfile: 'iana-bootstrap' },
  { id: 'nic-dz-colon', suffixes: ['dz'], rdapAccessProfile: 'no-iana-service' },
  { id: 'channel-islands-sectioned', suffixes: ['gg', 'je'], rdapAccessProfile: 'no-iana-service' },
  { id: 'nic-gl-colon', suffixes: ['gl'], rdapAccessProfile: 'no-iana-service' },
  { id: 'lsnic-contact-indirection', suffixes: ['ls'], rdapAccessProfile: 'no-iana-service' },
  { id: 'nic-mc-colon', suffixes: ['mc'], rdapAccessProfile: 'no-iana-service' },
  { id: 'mm-registry-colon', suffixes: ['mm'], rdapAccessProfile: 'no-iana-service' },
];
const VERSION_19_NO_MACHINE_SUFFIXES = [
  'xn--mgbai9azgqp6j', 'xn--mgbayh7gpa', 'xn--mgbc0a9azcg',
  'xn--mgbcpq6gpa1a', 'xn--mgbpl2fh', 'xn--wgbh1c',
];
const VERSION_19_RDAP_ONLY_SUFFIXES = ['na', 'pn'];
const VERSION_19_SHARED_FIXTURE_SUFFIXES = [
  'xn--4dbrk0ce', 'xn--lgbbat1ad8j', 'xn--mgba3a4f16a', 'xn--mgbaam7a8h',
  'xn--mgbbh1a', 'xn--mgbbh1a71e', 'xn--mgberp4a5d4ar', 'xn--mgbgu82a',
  'xn--mgbx4cd0ab', 'xn--pgbs0dh',
];
const VERSION_20_FIXTURE_SUFFIXES = [
  'as', 'bm', 'cm', 'cv', 'cx', 'ec', 'fm', 'fo', 'gd', 'gy',
  'hn', 'ht', 'ky', 'lb', 'mg', 'ml', 'ms', 'mu', 'ng', 'pw',
  'rw', 'sd', 'sr', 'ss', 'to',
];
const VERSION_21_STANDARD_SUFFIXES = [
  'bf', 'dm', 'fj', 'kn', 'ly', 'mr', 'pe', 'pg', 'qa',
  'st', 'sx', 'sy', 'tv', 'ug', 'uz', 'ws', 'ye', 'zm',
];
const VERSION_21_CONTACT_SUFFIXES = ['mw', 'tz', 've'];
const VERSION_21_NEGATIVE_SUFFIXES = ['nc', 'vg'];
const VERSION_21_RDAP_SUFFIXES = new Set([
  'fj', 'kg', 'ly', 'pg', 'tv', 'tz', 'uz', 'vg', 'ye', 'zm',
]);
const VERSION_22_NEGATIVE_SUFFIXES = [
  'ag', 'aw', 'ax', 'bi', 'bn', 'ci', 'gh', 'gn', 'gs',
  'im', 'ki', 'ma', 'mz', 'nf', 'pr', 'sc', 'sh', 'sn',
  'so', 'tc', 'td', 'tg', 'tm', 'vu', 'xn--j1amh',
  'xn--mgbah1a3hjkrd', 'xn--ogbpf8fl',
];
const VERSION_22_RDAP_SUFFIXES = new Set(['gs', 'nf', 'sn']);
const VERSION_23_NEGATIVE_SUFFIXES = ['bj', 'do'];
const VERSION_23_UNVERIFIED_SUFFIXES = [
  'bo', 'bw', 'cf', 'ge', 'gp', 'gq', 'hm', 'iq', 'pf', 'sb',
  'sm', 'tk', 'tl', 'uy', 'vi', 'xn--90ae', 'xn--l1acc',
  'xn--mgbtx2b', 'xn--wgbl6a', 'xn--ygbi2ammx',
];
const VERSION_23_RDAP_SUFFIXES = new Set(['vi']);
const VERSION_24_PROMOTED_SUFFIXES = new Set(['xn--90ae', 'xn--l1acc', 'xn--wgbl6a']);

describe('registry capability metadata', () => {
  test('has a versioned, deterministic compatibility matrix', () => {
    assert.equal(REGISTRY_CAPABILITIES_VERSION, 24);
    const first = registryCompatibilityMatrix();
    const second = registryCompatibilityMatrix();
    assert.deepEqual(first, second);
    assert.deepEqual(first.map((row) => row.suffixes[0]), [
      'ac', 'ad', 'ae', 'af', 'ag', 'ai', 'al', 'am', 'ao', 'aq', 'ar', 'as', 'at', 'au', 'aw', 'ax', 'az', 'ba', 'bb',
      'bd', 'be', 'bf', 'bg', 'bh', 'bi', 'bj', 'bm', 'bn', 'bo', 'br', 'bs', 'bt', 'bv', 'bw', 'by', 'bz', 'ca', 'cc', 'cd', 'cf', 'cg', 'ch',
      'ci', 'ck', 'cl', 'cm', 'cn', 'co', 'cr', 'cu', 'cv', 'cw', 'cx', 'cy', 'cz', 'de', 'dj', 'dk', 'dm', 'do', 'dz', 'ec', 'edu', 'ee',
      'eg', 'er', 'es', 'et', 'eu', 'fi', 'fj', 'fk', 'fm', 'fo', 'fr', 'ga', 'gb', 'gd', 'ge', 'gf', 'gg', 'gh', 'gi', 'gl', 'gm',
      'gn', 'gp', 'gq', 'gr', 'gs', 'gt', 'gu', 'gw', 'gy', 'hk', 'hm', 'hn', 'hr', 'ht',
      'hu', 'id', 'ie', 'il', 'im', 'in', 'io', 'iq', 'ir', 'is', 'it', 'je', 'jm', 'jo', 'jp', 'ke', 'kg',
      'kh', 'ki', 'km', 'kn', 'kp', 'kr', 'kw', 'ky', 'kz', 'la', 'lb', 'lc', 'li', 'lk', 'lr', 'ls', 'lt', 'lu',
      'lv', 'ly', 'ma', 'mc', 'md', 'me', 'mg', 'mh', 'mk', 'ml', 'mm', 'mn',
      'mo', 'mp', 'mq', 'mr', 'ms', 'mt', 'mu', 'mv', 'mw', 'mx', 'my', 'mz', 'na', 'nc', 'ne', 'nf', 'ng', 'ni', 'nl', 'no',
      'np', 'nr', 'nu', 'nz', 'om', 'pa', 'pe', 'pf', 'pg', 'ph', 'pk', 'pl', 'pm', 'pn', 'pr', 'ps', 'pt', 'pw', 'py', 'qa', 're', 'ro',
      'rs', 'ru', 'rw', 'sa', 'sb', 'sc', 'sd', 'se', 'sg', 'sh', 'si', 'sj', 'sk', 'sl', 'sm', 'sn', 'so', 'sr', 'ss', 'st', 'su', 'sv', 'sx', 'sy', 'sz',
      'tc', 'td', 'tf', 'tg', 'th', 'tj', 'tk', 'tl', 'tm', 'tn', 'to', 'tr', 'tt', 'tv', 'tw', 'tz', 'ua', 'ug', 'uk', 'us', 'uy', 'uz', 'va', 'vc', 've', 'vg', 'vi', 'vn', 'vu', 'wf', 'ws',
      'xn--2scrj9c', 'xn--3e0b707e',
      'xn--3hcrj9c', 'xn--45br5cyl', 'xn--45brj9c', 'xn--4dbrk0ce', 'xn--54b7fta0cc', 'xn--80ao21a',
      'xn--90a3ac', 'xn--90ae', 'xn--90ais', 'xn--clchc0ea0b2g2a9gcd', 'xn--d1alf',
      'xn--e1a4c', 'xn--fiqs8s', 'xn--fiqz9s',
      'xn--fpcrj9c3d', 'xn--fzc2c9e2c', 'xn--gecrj9c', 'xn--h2breg3eve', 'xn--h2brj9c',
      'xn--h2brj9c8c', 'xn--j1amh', 'xn--j6w193g', 'xn--kprw13d', 'xn--kpry57d',
      'xn--l1acc', 'xn--lgbbat1ad8j', 'xn--mgb9awbf', 'xn--mgba3a4f16a', 'xn--mgbaam7a8h', 'xn--mgbah1a3hjkrd',
      'xn--mgbai9azgqp6j', 'xn--mgbayh7gpa', 'xn--mgbbh1a', 'xn--mgbbh1a71e',
      'xn--mgbc0a9azcg', 'xn--mgbcpq6gpa1a', 'xn--mgberp4a5d4ar', 'xn--mgbgu82a',
      'xn--mgbpl2fh', 'xn--mgbtx2b', 'xn--mgbx4cd0ab', 'xn--mix891f', 'xn--node', 'xn--o3cw4h', 'xn--ogbpf8fl',
      'xn--p1ai', 'xn--pgbs0dh', 'xn--q7ce6a', 'xn--qxa6a', 'xn--qxam',
      'xn--rvc1e0am3e', 'xn--s9brj9c', 'xn--wgbh1c', 'xn--wgbl6a', 'xn--xkc2al3hye2a',
      'xn--xkc2dl3a5ee0h', 'xn--y9a3aq', 'xn--yfro4i67o', 'xn--ygbi2ammx', 'ye', 'yt', 'za', 'zm', 'zw',
    ]);
    assert.equal(first.every((row) => row.explicitSuffixProfile), true);
    assert.equal(first.filter((row) => row.registryClass === 'country-code').length, 309);
  });

  test('keeps the published compatibility table synchronized with the catalogue', () => {
    const markdown = readFileSync(resolve(__dirname, '..', 'docs', 'registry-compatibility.md'), 'utf8');
    const documentedSuffixes = Array.from(markdown.matchAll(/^\| `\.([^`]+)`/gm), (match) => match[1]);
    const catalogueSuffixes = registryCompatibilityMatrix().map((row) => row.suffixes[0]);

    assert.deepEqual(documentedSuffixes, catalogueSuffixes);
  });

  test('resolves a domain, a suffix, case, and one terminal root dot', () => {
    const inputs = ['example.com.au', '.AU', 'EXAMPLE.COM.AU.'];
    for (const input of inputs) {
      const capability = registryCapabilityFor(input);
      assert.equal(capability.id, 'eligibility-contact');
      assert.deepEqual(capability.suffixes, ['au']);
      assert.equal(capability.coverageState, 'fixture_verified');
      assert.equal(capability.explicitSuffixProfile, true);
    }
  });

  test('returns a conservative discovery-only profile for an unknown suffix', () => {
    const capability = registryCapabilityFor('example.unknown');
    assert.equal(capability.id, 'iana-generic');
    assert.deepEqual(capability.suffixes, ['unknown']);
    assert.equal(capability.coverageState, 'discovery_only');
    assert.equal(capability.registryClass, 'unknown');
    assert.equal(capability.explicitSuffixProfile, false);
    assert.match(capability.limitation, /no suffix-specific/i);
  });

  test('canonicalizes an internationalized suffix to its A-label', () => {
    const capability = registryCapabilityFor('example.测试');
    assert.deepEqual(capability.suffixes, ['xn--0zwm56d']);
    assert.equal(capability.explicitSuffixProfile, false);
  });

  test('resolves shared-endpoint ASCII and IDN suffixes to suffix-correct profiles', () => {
    const profiles = new Map(listRegistryCapabilities().map((entry) => [entry.id, entry]));
    let covered = 0;

    for (const family of SHARED_ENDPOINT_SUFFIXES) {
      const profile = profiles.get(family.id);
      assert.ok(profile, family.id);
      for (const suffix of family.suffixes) {
        const inputs = [suffix];
        if (suffix.startsWith('xn--')) {
          const unicodeSuffix = domainToUnicode(suffix);
          assert.notEqual(unicodeSuffix, suffix, suffix);
          inputs.push(unicodeSuffix);
        }
        for (const input of inputs) {
          const capability = registryCapabilityFor(`example.${input}`);
          assert.equal(capability.id, family.id, input);
          assert.deepEqual(capability.suffixes, [suffix], input);
          assert.equal(capability.registryClass, 'country-code', input);
          assert.equal(capability.coverageState, 'fixture_verified', input);
          assert.equal(capability.explicitSuffixProfile, true, input);
        }
        assert.ok(
          profile.documentationUrls.includes(`https://www.iana.org/domains/root/db/${suffix}.html`),
          `${suffix}: IANA provenance`,
        );
        covered += 1;
      }
    }

    assert.equal(covered, 54);
  });

  test('records version fourteen shared-operator suffixes with explicit provenance and coverage', () => {
    const profiles = new Map(listRegistryCapabilities().map((entry) => [entry.id, entry]));
    let covered = 0;

    for (const family of VERSION_14_SUFFIXES) {
      const profile = profiles.get(family.id);
      assert.ok(profile, family.id);
      for (const suffix of family.suffixes) {
        const inputs = [suffix];
        if (suffix.startsWith('xn--')) {
          const unicodeSuffix = domainToUnicode(suffix);
          assert.notEqual(unicodeSuffix, suffix, suffix);
          inputs.push(unicodeSuffix);
        }
        for (const input of inputs) {
          const capability = registryCapabilityFor(`example.${input}`);
          assert.equal(capability.id, family.id, input);
          assert.deepEqual(capability.suffixes, [suffix], input);
          assert.equal(capability.registryClass, 'country-code', input);
          assert.equal(capability.coverageState, family.coverageState, input);
          assert.equal(capability.explicitSuffixProfile, true, input);
        }
        assert.ok(
          profile.documentationUrls.includes(`https://www.iana.org/domains/root/db/${suffix}.html`),
          `${suffix}: IANA provenance`,
        );
        covered += 1;
      }
    }

    assert.equal(covered, 12);
  });

  test('records version fifteen no-machine-service suffixes as access context only', () => {
    const profiles = new Map(listRegistryCapabilities().map((entry) => [entry.id, entry]));

    for (const suffix of VERSION_15_ACCESS_SUFFIXES) {
      const profile = profiles.get(`no-iana-machine-service-${suffix}`);
      assert.ok(profile, suffix);
      assert.deepEqual(profile.suffixes, [suffix], suffix);
      assert.equal(profile.coverageState, 'access_documented', suffix);
      assert.equal(profile.whoisAccessProfile, 'no-iana-service', suffix);
      assert.equal(profile.rdapAccessProfile, 'no-iana-service', suffix);
      assert.deepEqual(profile.fixtureScenarios, [], suffix);
      assert.deepEqual(profile.verificationFiles, [], suffix);
      assert.deepEqual(
        profile.documentationUrls,
        [`https://www.iana.org/domains/root/db/${suffix}.html`],
        suffix,
      );

      const capability = registryCapabilityFor(`example.${suffix}`);
      assert.equal(capability.id, profile.id, suffix);
      assert.deepEqual(capability.suffixes, [suffix], suffix);
      assert.equal(capability.registryClass, 'country-code', suffix);
      assert.equal(capability.coverageState, 'access_documented', suffix);
      assert.equal(capability.explicitSuffixProfile, true, suffix);
      assert.match(capability.limitation, /no domain WHOIS or RDAP service/i, suffix);
      const diagnostic = registryAccessDiagnosticFor(`example.${suffix}`);
      assert.equal(diagnostic.authority, 'context_only', suffix);
      assert.equal(diagnostic.whoisAccessProfile, 'no-iana-service', suffix);
      assert.equal(diagnostic.rdapAccessProfile, 'no-iana-service', suffix);
    }
  });

  test('completes version sixteen no-machine-service coverage as access context only', () => {
    const profiles = new Map(listRegistryCapabilities().map((entry) => [entry.id, entry]));

    for (const suffix of VERSION_16_ACCESS_SUFFIXES) {
      const profile = profiles.get(`no-iana-machine-service-${suffix}`);
      assert.ok(profile, suffix);
      assert.deepEqual(profile.suffixes, [suffix], suffix);
      assert.equal(profile.coverageState, 'access_documented', suffix);
      assert.equal(profile.whoisAccessProfile, 'no-iana-service', suffix);
      assert.equal(profile.rdapAccessProfile, 'no-iana-service', suffix);
      assert.deepEqual(profile.fixtureScenarios, [], suffix);
      assert.deepEqual(profile.verificationFiles, [], suffix);
      assert.deepEqual(
        profile.documentationUrls,
        [`https://www.iana.org/domains/root/db/${suffix}.html`],
        suffix,
      );

      const inputs = [suffix];
      if (suffix.startsWith('xn--')) {
        const unicodeSuffix = domainToUnicode(suffix);
        assert.notEqual(unicodeSuffix, suffix, suffix);
        inputs.push(unicodeSuffix);
      }
      for (const input of inputs) {
        const capability = registryCapabilityFor(`example.${input}`);
        assert.equal(capability.id, profile.id, input);
        assert.deepEqual(capability.suffixes, [suffix], input);
        assert.equal(capability.registryClass, 'country-code', input);
        assert.equal(capability.coverageState, 'access_documented', input);
        assert.equal(capability.explicitSuffixProfile, true, input);
        assert.match(capability.limitation, /no domain WHOIS or RDAP service/i, input);
      }
      const diagnostic = registryAccessDiagnosticFor(`example.${suffix}`);
      assert.equal(diagnostic.authority, 'context_only', suffix);
      assert.equal(diagnostic.whoisAccessProfile, 'no-iana-service', suffix);
      assert.equal(diagnostic.rdapAccessProfile, 'no-iana-service', suffix);
    }
  });

  test('records version eighteen fixture-backed suffixes with IANA service provenance', () => {
    const profiles = new Map(listRegistryCapabilities().map((entry) => [entry.id, entry]));
    let covered = 0;

    for (const family of VERSION_18_FIXTURE_SUFFIXES) {
      const profile = profiles.get(family.id);
      assert.ok(profile, family.id);
      assert.equal(
        family.suffixes.every((suffix) => profile.suffixes.includes(suffix)),
        true,
        family.id,
      );
      assert.equal(profile.coverageState, 'fixture_verified', family.id);
      assert.equal(profile.whoisAccessProfile, 'iana-referral', family.id);
      assert.equal(profile.rdapAccessProfile, family.rdapAccessProfile, family.id);
      assert.deepEqual(profile.fixtureScenarios, ['registered', 'not_found'], family.id);

      for (const suffix of family.suffixes) {
        const capability = registryCapabilityFor(`example.${suffix}`);
        assert.equal(capability.id, family.id, suffix);
        assert.deepEqual(capability.suffixes, [suffix], suffix);
        assert.equal(capability.registryClass, 'country-code', suffix);
        assert.equal(capability.coverageState, 'fixture_verified', suffix);
        assert.equal(capability.rdapAccessProfile, family.rdapAccessProfile, suffix);
        assert.ok(
          profile.documentationUrls.includes(`https://www.iana.org/domains/root/db/${suffix}.html`),
          `${suffix}: IANA provenance`,
        );
        covered += 1;
      }
    }

    assert.equal(covered, 11);
  });

  test('records the version nineteen 20-suffix service and fixture batch', () => {
    const allProfiles = listRegistryCapabilities();
    const profiles = new Map(allProfiles.map((entry) => [entry.id, entry]));

    for (const suffix of VERSION_19_SHARED_FIXTURE_SUFFIXES) {
      const capability = registryCapabilityFor(`example.${suffix}`);
      assert.equal(capability.coverageState, 'fixture_verified', suffix);
      assert.equal(capability.whoisAccessProfile, 'iana-referral', suffix);
      assert.equal(capability.rdapAccessProfile, 'no-iana-service', suffix);
      assert.match(capability.limitation, /exact shared IANA WHOIS service/i, suffix);
      const profile = profiles.get(capability.id);
      assert.ok(profile.documentationUrls.includes(`https://www.iana.org/domains/root/db/${suffix}.html`), suffix);
      const unicodeSuffix = domainToUnicode(suffix);
      assert.notEqual(unicodeSuffix, suffix, suffix);
      assert.equal(registryCapabilityFor(`example.${unicodeSuffix}`).id, capability.id, suffix);
    }

    const omProfile = profiles.get('om-registry-colon');
    assert.deepEqual(omProfile.suffixes, ['om', 'xn--mgb9awbf']);
    assert.deepEqual(omProfile.fixtureScenarios, ['registered', 'not_found']);
    assert.equal(omProfile.coverageState, 'fixture_verified');
    assert.equal(omProfile.whoisAccessProfile, 'iana-referral');
    assert.equal(omProfile.rdapAccessProfile, 'no-iana-service');

    for (const suffix of VERSION_19_NO_MACHINE_SUFFIXES) {
      const profile = profiles.get(`no-iana-machine-service-${suffix}`);
      assert.ok(profile, suffix);
      assert.equal(profile.coverageState, 'access_documented', suffix);
      assert.equal(profile.whoisAccessProfile, 'no-iana-service', suffix);
      assert.equal(profile.rdapAccessProfile, 'no-iana-service', suffix);
      assert.deepEqual(profile.fixtureScenarios, [], suffix);
      assert.deepEqual(profile.verificationFiles, [], suffix);
      assert.match(profile.limitation, /no domain WHOIS or RDAP service/i, suffix);
      assert.equal(registryAccessDiagnosticFor(`example.${suffix}`).authority, 'context_only', suffix);
    }

    for (const suffix of VERSION_19_RDAP_ONLY_SUFFIXES) {
      const profile = profiles.get(`iana-rdap-only-${suffix}`);
      assert.ok(profile, suffix);
      assert.equal(profile.coverageState, 'access_documented', suffix);
      assert.equal(profile.whoisAccessProfile, 'no-iana-service', suffix);
      assert.equal(profile.rdapAccessProfile, 'iana-bootstrap', suffix);
      assert.deepEqual(profile.fixtureScenarios, [], suffix);
      assert.deepEqual(profile.verificationFiles, [], suffix);
      assert.match(profile.limitation, /RDAP bootstrap service but no domain WHOIS referral/i, suffix);
      const diagnostic = registryAccessDiagnosticFor(`example.${suffix}`);
      assert.equal(diagnostic.authority, 'context_only', suffix);
      assert.equal(diagnostic.whoisAccessProfile, 'no-iana-service', suffix);
      assert.equal(diagnostic.rdapAccessProfile, 'iana-bootstrap', suffix);
    }

    assert.equal(
      VERSION_19_SHARED_FIXTURE_SUFFIXES.length
        + omProfile.suffixes.length
        + VERSION_19_NO_MACHINE_SUFFIXES.length
        + VERSION_19_RDAP_ONLY_SUFFIXES.length,
      20,
    );
  });

  test('records the version twenty 25-suffix fixture-backed service batch', () => {
    const profiles = new Map(listRegistryCapabilities().map((entry) => [entry.id, entry]));

    for (const suffix of VERSION_20_FIXTURE_SUFFIXES) {
      const profile = profiles.get(`iana-cc-colon-${suffix}`);
      assert.ok(profile, suffix);
      assert.deepEqual(profile.suffixes, [suffix], suffix);
      assert.equal(profile.registryClass, 'country-code', suffix);
      assert.equal(profile.coverageState, 'fixture_verified', suffix);
      assert.equal(profile.whoisAccessProfile, 'iana-referral', suffix);
      assert.equal(profile.rdapAccessProfile, 'iana-bootstrap', suffix);
      assert.equal(profile.whoisParserProfile, 'icann-style-colon', suffix);
      assert.deepEqual(profile.fixtureScenarios, ['registered'], suffix);
      assert.deepEqual(
        profile.documentationUrls,
        [`https://www.iana.org/domains/root/db/${suffix}.html`],
        suffix,
      );
      assert.equal(registryAccessDiagnosticFor(`example.${suffix}`), null, suffix);
    }

    assert.equal(VERSION_20_FIXTURE_SUFFIXES.length, 25);
  });

  test('records the version twenty-one 25-suffix fixture-backed service batch', () => {
    const profiles = new Map(listRegistryCapabilities().map((entry) => [entry.id, entry]));

    for (const suffix of VERSION_21_STANDARD_SUFFIXES) {
      const profile = profiles.get(`iana-cc-colon-${suffix}`);
      assert.ok(profile, suffix);
      assert.deepEqual(profile.suffixes, [suffix], suffix);
      assert.equal(profile.whoisParserProfile, 'icann-style-colon', suffix);
      assert.deepEqual(profile.fixtureScenarios, ['registered'], suffix);
      assert.equal(
        profile.rdapAccessProfile,
        VERSION_21_RDAP_SUFFIXES.has(suffix) ? 'iana-bootstrap' : 'no-iana-service',
        suffix,
      );
    }

    for (const suffix of VERSION_21_CONTACT_SUFFIXES) {
      const profile = profiles.get(`iana-cc-contact-${suffix}`);
      assert.ok(profile, suffix);
      assert.equal(profile.whoisParserProfile, 'contact-indirection', suffix);
      assert.deepEqual(profile.fixtureScenarios, ['registered'], suffix);
    }

    assert.equal(profiles.get('internetstiftelsen-nu-colon').rdapAccessProfile, 'no-iana-service');
    assert.deepEqual(profiles.get('internetstiftelsen-nu-colon').fixtureScenarios, ['registered']);
    assert.equal(profiles.get('nic-kg-sectioned').rdapAccessProfile, 'iana-bootstrap');
    assert.deepEqual(profiles.get('nic-kg-sectioned').fixtureScenarios, ['registered']);

    for (const suffix of VERSION_21_NEGATIVE_SUFFIXES) {
      const profile = profiles.get(`iana-cc-negative-${suffix}`);
      assert.ok(profile, suffix);
      assert.deepEqual(profile.fixtureScenarios, ['not_found'], suffix);
      assert.equal(
        profile.rdapAccessProfile,
        VERSION_21_RDAP_SUFFIXES.has(suffix) ? 'iana-bootstrap' : 'no-iana-service',
        suffix,
      );
    }

    const allSuffixes = [
      ...VERSION_21_STANDARD_SUFFIXES,
      ...VERSION_21_CONTACT_SUFFIXES,
      'nu',
      'kg',
      ...VERSION_21_NEGATIVE_SUFFIXES,
    ];
    assert.equal(allSuffixes.length, 25);
    assert.equal(new Set(allSuffixes).size, 25);
    for (const suffix of allSuffixes) {
      const diagnostic = registryAccessDiagnosticFor(`example.${suffix}`);
      if (VERSION_21_RDAP_SUFFIXES.has(suffix)) assert.equal(diagnostic, null, suffix);
      else {
        assert.equal(diagnostic?.suffix, suffix, suffix);
        assert.equal(diagnostic?.rdapAccessProfile, 'no-iana-service', suffix);
        assert.equal(diagnostic?.authority, 'context_only', suffix);
      }
    }
  });

  test('records the version twenty-two 27-suffix authoritative-negative batch', () => {
    const profiles = new Map(listRegistryCapabilities().map((entry) => [entry.id, entry]));

    assert.equal(VERSION_22_NEGATIVE_SUFFIXES.length, 27);
    assert.equal(new Set(VERSION_22_NEGATIVE_SUFFIXES).size, 27);
    for (const suffix of VERSION_22_NEGATIVE_SUFFIXES) {
      const profile = profiles.get(`iana-cc-negative-${suffix}`);
      assert.ok(profile, suffix);
      assert.deepEqual(profile.suffixes, [suffix], suffix);
      assert.equal(profile.whoisParserProfile, 'generic-colon', suffix);
      assert.deepEqual(profile.fixtureScenarios, ['not_found'], suffix);
      assert.match(profile.limitation, /registered-field compatibility is not claimed/i, suffix);
      assert.equal(
        profile.rdapAccessProfile,
        VERSION_22_RDAP_SUFFIXES.has(suffix) ? 'iana-bootstrap' : 'no-iana-service',
        suffix,
      );
      const diagnostic = registryAccessDiagnosticFor(`example.${suffix}`);
      if (VERSION_22_RDAP_SUFFIXES.has(suffix)) assert.equal(diagnostic, null, suffix);
      else {
        assert.equal(diagnostic?.suffix, suffix, suffix);
        assert.equal(diagnostic?.rdapAccessProfile, 'no-iana-service', suffix);
        assert.equal(diagnostic?.authority, 'context_only', suffix);
      }
    }
  });

  test('records the version twenty-three final 22 assigned ccTLD profiles', () => {
    const profiles = new Map(listRegistryCapabilities().map((entry) => [entry.id, entry]));
    const allSuffixes = [...VERSION_23_NEGATIVE_SUFFIXES, ...VERSION_23_UNVERIFIED_SUFFIXES];

    assert.equal(allSuffixes.length, 22);
    assert.equal(new Set(allSuffixes).size, 22);
    for (const suffix of VERSION_23_NEGATIVE_SUFFIXES) {
      const profile = profiles.get(`iana-cc-negative-${suffix}`);
      assert.ok(profile, suffix);
      assert.deepEqual(profile.fixtureScenarios, ['not_found'], suffix);
      assert.equal(profile.coverageState, 'fixture_verified', suffix);
      assert.equal(profile.rdapAccessProfile, 'no-iana-service', suffix);
      assert.match(profile.limitation, /registered-field compatibility is not claimed/i, suffix);
    }
    for (const suffix of VERSION_23_UNVERIFIED_SUFFIXES.filter(
      (candidate) => !VERSION_24_PROMOTED_SUFFIXES.has(candidate),
    )) {
      const profile = profiles.get(`iana-referral-unverified-${suffix}`);
      assert.ok(profile, suffix);
      assert.deepEqual(profile.suffixes, [suffix], suffix);
      assert.deepEqual(profile.fixtureScenarios, [], suffix);
      assert.deepEqual(profile.verificationFiles, [], suffix);
      assert.equal(profile.coverageState, 'access_documented', suffix);
      assert.equal(profile.whoisAccessProfile, 'iana-referral', suffix);
      assert.equal(
        profile.rdapAccessProfile,
        VERSION_23_RDAP_SUFFIXES.has(suffix) ? 'iana-bootstrap' : 'no-iana-service',
        suffix,
      );
      assert.match(profile.limitation, /response behavior is not fixture-verified/i, suffix);
      assert.match(profile.limitation, /not evidence that the domain is unregistered/i, suffix);
      assert.deepEqual(
        profile.documentationUrls,
        [`https://www.iana.org/domains/root/db/${suffix}.html`],
        suffix,
      );
      const diagnostic = registryAccessDiagnosticFor(`example.${suffix}`);
      if (VERSION_23_RDAP_SUFFIXES.has(suffix)) assert.equal(diagnostic, null, suffix);
      else {
        assert.equal(diagnostic?.coverageState, 'access_documented', suffix);
        assert.equal(diagnostic?.rdapAccessProfile, 'no-iana-service', suffix);
        assert.equal(diagnostic?.authority, 'context_only', suffix);
      }
    }
  });

  test('records the version twenty-four alternate-script depth promotions', () => {
    const bulgarian = registryCapabilityFor('примерен-домейн.бг');
    assert.equal(bulgarian.id, 'imena-bg-idn-sectioned');
    assert.deepEqual(bulgarian.suffixes, ['xn--90ae']);
    assert.equal(bulgarian.whoisQueryProfile, 'registry-domain-unicode');
    assert.equal(bulgarian.whoisParserProfile, 'register-bg-sectioned');
    assert.deepEqual(bulgarian.fixtureScenarios, ['registered', 'not_found']);
    assert.equal(bulgarian.rdapAccessProfile, 'no-iana-service');

    const mongolian = registryCapabilityFor('example.мон');
    assert.equal(mongolian.id, 'identity-digital-colon-mn');
    assert.deepEqual(mongolian.suffixes, ['xn--l1acc']);
    assert.deepEqual(mongolian.fixtureScenarios, ['registered']);
    assert.equal(mongolian.rdapAccessProfile, 'no-iana-service');
    assert.match(mongolian.limitation, /exact shared IANA WHOIS service/i);

    const qatari = registryCapabilityFor('example.قطر');
    assert.equal(qatari.id, 'qatar-idn-colon');
    assert.deepEqual(qatari.suffixes, ['xn--wgbl6a']);
    assert.deepEqual(qatari.fixtureScenarios, ['registered', 'not_found']);
    assert.equal(qatari.rdapAccessProfile, 'no-iana-service');

    for (const suffix of VERSION_24_PROMOTED_SUFFIXES) {
      const capability = registryCapabilityFor(`example.${suffix}`);
      assert.equal(capability.coverageState, 'fixture_verified', suffix);
      assert.equal(capability.explicitSuffixProfile, true, suffix);
      assert.ok(
        capability.documentationUrls.includes(`https://www.iana.org/domains/root/db/${suffix}.html`),
        `${suffix}: IANA provenance`,
      );
      const diagnostic = registryAccessDiagnosticFor(`example.${suffix}`);
      assert.equal(diagnostic?.rdapAccessProfile, 'no-iana-service', suffix);
      assert.equal(diagnostic?.authority, 'context_only', suffix);
    }
  });

  test('rejects malformed, numeric, overlong, and control-bearing inputs', () => {
    for (const input of [
      null, '', '..au', 'example..au', '127.0.0.1', '.123', `${'a'.repeat(250)}.au`, 'au\n',
      '//com', 'user@com', 'com/path', 'com:443',
    ]) {
      assert.equal(registryCapabilityFor(input), null, String(input));
    }
  });

  test('returns defensive copies rather than mutable shared metadata', () => {
    const expected = listRegistryCapabilities()[0];
    const first = listRegistryCapabilities();
    first[0].suffixes.push('invalid');
    first[0].fixtureScenarios.push('invented');
    first[0].verificationFiles.push('invented');
    first[0].documentationUrls.push('https://invalid.example');
    first[0].limitation = 'changed';

    const second = listRegistryCapabilities();
    assert.deepEqual(second[0], expected);
  });

  test('points every declared profile at a local fixture or bounded authoritative documentation', () => {
    for (const capability of listRegistryCapabilities()) {
      assert.ok(capability.verificationFiles.length > 0 || capability.documentationUrls.length > 0, `${capability.id}: verification sources`);
      for (const file of capability.verificationFiles) {
        assert.equal(existsSync(resolve(__dirname, '..', file)), true, `${capability.id}: ${file}`);
      }
      for (const url of capability.documentationUrls) {
        const parsed = new URL(url);
        assert.equal(parsed.protocol, 'https:', `${capability.id}: ${url}`);
        assert.ok(parsed.hostname.length > 0 && url.length <= 300, `${capability.id}: ${url}`);
        assert.doesNotMatch(url, /[\u0000-\u001f\u007f]/, `${capability.id}: ${url}`);
      }
    }
  });

  test('describes restricted and unpublished registry access without making an authority claim', () => {
    const es = registryAccessDiagnosticFor('example.es');
    assert.deepEqual(es, {
      suffix: 'es',
      coverageState: 'access_documented',
      whoisAccessProfile: 'source-ip-authorization-required',
      rdapAccessProfile: 'no-iana-service',
      limitation: 'The registry WHOIS service requires advance source-IP authorization. A failed or unavailable query is not evidence that the domain is unregistered.',
      authority: 'context_only',
    });
    const vn = registryAccessDiagnosticFor('example.vn');
    assert.equal(vn.whoisAccessProfile, 'no-iana-service');
    assert.equal(vn.rdapAccessProfile, 'no-iana-service');
    assert.match(vn.limitation, /official browser lookup is not integrated/i);
    const ch = registryAccessDiagnosticFor('example.ch');
    assert.equal(ch.whoisAccessProfile, 'registry-policy-restricted');
    assert.equal(ch.rdapAccessProfile, 'no-iana-service');
    assert.match(ch.limitation, /non-standard-port.*not integrated.*no RDAP service/i);
    const gr = registryAccessDiagnosticFor('example.gr');
    assert.equal(gr.whoisAccessProfile, 'no-iana-service');
    assert.equal(gr.rdapAccessProfile, 'no-iana-service');
    assert.match(gr.limitation, /no domain WHOIS or RDAP service.*not evidence/i);
    const li = registryAccessDiagnosticFor('example.li');
    assert.equal(li.whoisAccessProfile, 'registry-policy-restricted');
    assert.match(li.limitation, /official lookup.*not integrated.*no RDAP service/i);
    const bv = registryAccessDiagnosticFor('example.bv');
    assert.equal(bv.whoisAccessProfile, 'no-iana-service');
    assert.equal(bv.rdapAccessProfile, 'no-iana-service');
    assert.match(bv.limitation, /not opened.*no domain WHOIS or RDAP service.*live availability/i);
    const greekIdn = registryAccessDiagnosticFor('example.ελ');
    assert.equal(greekIdn.suffix, 'xn--qxam');
    assert.match(greekIdn.limitation, /no domain WHOIS or RDAP service.*not evidence/i);
    assert.equal(registryAccessDiagnosticFor('example.com'), null);
    assert.equal(registryAccessDiagnosticFor('bad\n'), null);
  });

  test('keeps suffixes and profile identifiers unique', () => {
    const capabilities = listRegistryCapabilities();
    assert.equal(new Set(capabilities.map((entry) => entry.id)).size, capabilities.length);
    const suffixes = capabilities.flatMap((entry) => entry.suffixes);
    assert.equal(new Set(suffixes).size, suffixes.length);
  });

  test('links every shared WHOIS fixture to a declared parser profile and scenario', () => {
    const capabilities = new Map(listRegistryCapabilities().map((entry) => [entry.id, entry]));
    capabilities.set('iana-generic', registryCapabilityFor('example.unknown'));

    for (const fixture of whoisFixtures) {
      const capability = capabilities.get(fixture.capabilityProfile);
      assert.ok(capability, `${fixture.name}: declared capability profile`);
      assert.ok(capability.fixtureScenarios.includes(fixture.scenario), `${fixture.name}: declared fixture scenario`);
    }
  });

  test('keeps discovery authoritative and exposes only approved query profiles', () => {
    const exceptionalProfiles = new Map([
      ['denic-domain-ace', 'denic-domain-ace'],
      ['imena-bg-idn-sectioned', 'registry-domain-unicode'],
      ['bracketed-bilingual', 'jprs-domain-english'],
    ]);
    for (const capability of listRegistryCapabilities()) {
      assert.equal(capability.rdapDiscovery, 'iana-bootstrap');
      assert.equal(capability.whoisDiscovery, 'iana-referral');
      assert.equal(
        capability.whoisQueryProfile,
        exceptionalProfiles.get(capability.id) || 'plain-domain',
      );
      assert.equal(capability.whoisQueryScope, 'first-referral');
      assert.equal(capability.whoisEncodingProfile, 'utf-8');
      assert.ok(['iana-referral', 'registry-policy-restricted', 'source-ip-authorization-required', 'no-iana-service'].includes(capability.whoisAccessProfile));
      assert.ok(['iana-bootstrap', 'no-iana-service'].includes(capability.rdapAccessProfile));
      assert.equal('endpoint' in capability, false);
      assert.equal('queryTemplate' in capability, false);
    }
  });
});
