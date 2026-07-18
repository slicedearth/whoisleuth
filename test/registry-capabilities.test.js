'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
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
  { id: 'amnic-sectioned', suffixes: ['xn--y9a3aq'] },
  { id: 'cctld-by-colon', suffixes: ['xn--90ais'] },
  { id: 'cnnic-colon', suffixes: ['xn--fiqs8s', 'xn--fiqz9s'] },
  { id: 'dot-leader', suffixes: ['xn--3e0b707e'] },
  { id: 'eurid-sectioned', suffixes: ['xn--e1a4c', 'xn--qxa6a'] },
  { id: 'hkirc-sectioned', suffixes: ['xn--j6w193g'] },
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
  { id: 'nic-kz-dot-leader', suffixes: ['xn--80ao21a'] },
  { id: 'rnids-colon', suffixes: ['xn--90a3ac'] },
  { id: 'tci-colon', suffixes: ['su', 'xn--p1ai'] },
  { id: 'thnic-holder-colon', suffixes: ['xn--o3cw4h'] },
  { id: 'twnic-colon', suffixes: ['xn--kprw13d', 'xn--kpry57d'] },
];

describe('registry capability metadata', () => {
  test('has a versioned, deterministic compatibility matrix', () => {
    assert.equal(REGISTRY_CAPABILITIES_VERSION, 13);
    const first = registryCompatibilityMatrix();
    const second = registryCompatibilityMatrix();
    assert.deepEqual(first, second);
    assert.deepEqual(first.map((row) => row.suffixes[0]), [
      'ae', 'af', 'ai', 'al', 'am', 'ar', 'at', 'au', 'ba', 'be', 'bg', 'br',
      'by', 'ca', 'ch', 'cl', 'cn', 'co', 'cy', 'cz', 'de', 'dk', 'edu', 'ee',
      'es', 'eu', 'fi', 'fr', 'gr', 'gt', 'hk', 'hr', 'hu', 'id', 'ie', 'il',
      'in', 'io', 'ir', 'is', 'it', 'jp', 'ke', 'kr', 'kz', 'lt', 'lu', 'lv',
      'md', 'me', 'mn', 'mx', 'my', 'nl', 'no', 'nz', 'ph', 'pk', 'pl', 'pt',
      'ro', 'rs', 'ru', 'sa', 'se', 'sg', 'si', 'sk', 'su', 'th', 'tn', 'tr',
      'tw', 'ua', 'uk', 'us', 'vn', 'xn--2scrj9c', 'xn--3e0b707e',
      'xn--3hcrj9c', 'xn--45br5cyl', 'xn--45brj9c', 'xn--80ao21a',
      'xn--90a3ac', 'xn--90ais', 'xn--e1a4c', 'xn--fiqs8s', 'xn--fiqz9s',
      'xn--fpcrj9c3d', 'xn--gecrj9c', 'xn--h2breg3eve', 'xn--h2brj9c',
      'xn--h2brj9c8c', 'xn--j6w193g', 'xn--kprw13d', 'xn--kpry57d',
      'xn--o3cw4h', 'xn--p1ai', 'xn--qxa6a', 'xn--rvc1e0am3e',
      'xn--s9brj9c', 'xn--xkc2dl3a5ee0h', 'xn--y9a3aq', 'za',
    ]);
    assert.equal(first.every((row) => row.explicitSuffixProfile), true);
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

    assert.equal(covered, 27);
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
