'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

const {
  REGISTRY_CAPABILITIES_VERSION,
  registryAccessDiagnosticFor,
  registryCapabilityFor,
  registryCompatibilityMatrix,
  listRegistryCapabilities,
} = require('../lib/registry-capabilities.mts');
const whoisFixtures = require('../fixtures/whois-registry-fixtures');

describe('registry capability metadata', () => {
  test('has a versioned, deterministic compatibility matrix', () => {
    assert.equal(REGISTRY_CAPABILITIES_VERSION, 9);
    const first = registryCompatibilityMatrix();
    const second = registryCompatibilityMatrix();
    assert.deepEqual(first, second);
    assert.deepEqual(first.map((row) => row.suffixes[0]), [
      'ar', 'at', 'au', 'be', 'bg', 'br', 'ca', 'ch', 'cl', 'cn', 'cz', 'de',
      'dk', 'edu', 'ee', 'es', 'eu', 'fi', 'fr', 'gt', 'hr', 'hu', 'id', 'ie',
      'il', 'in', 'is', 'it', 'jp', 'kr', 'lt', 'lv', 'mx', 'my', 'nl', 'no',
      'nz', 'pl', 'pt', 'ro', 'rs', 'ru', 'se', 'sg', 'si', 'sk', 'tr', 'tw',
      'ua', 'uk', 'us', 'vn',
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
