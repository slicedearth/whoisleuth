'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

const {
  REGISTRY_CAPABILITIES_VERSION,
  registryCapabilityFor,
  registryCompatibilityMatrix,
  listRegistryCapabilities,
} = require('../lib/registry-capabilities.mts');
const whoisFixtures = require('../fixtures/whois-registry-fixtures');

describe('registry capability metadata', () => {
  test('has a versioned, deterministic compatibility matrix', () => {
    assert.equal(REGISTRY_CAPABILITIES_VERSION, 2);
    const first = registryCompatibilityMatrix();
    const second = registryCompatibilityMatrix();
    assert.deepEqual(first, second);
    assert.deepEqual(first.map((row) => row.suffixes[0]), ['au', 'cz', 'de', 'edu', 'gt', 'it', 'jp', 'kr', 'tr']);
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
    for (const input of [null, '', '..au', 'example..au', '127.0.0.1', '.123', `${'a'.repeat(250)}.au`, 'au\n']) {
      assert.equal(registryCapabilityFor(input), null, String(input));
    }
  });

  test('returns defensive copies rather than mutable shared metadata', () => {
    const first = listRegistryCapabilities();
    first[0].suffixes.push('invalid');
    first[0].fixtureScenarios.push('invented');
    first[0].verificationFiles.push('invented');
    first[0].limitation = 'changed';

    const second = listRegistryCapabilities();
    assert.equal(second[0].suffixes.includes('invalid'), false);
    assert.equal(second[0].fixtureScenarios.includes('invented'), false);
    assert.equal(second[0].verificationFiles.includes('invented'), false);
    assert.notEqual(second[0].limitation, 'changed');
  });

  test('points every declared profile at an existing verification source', () => {
    for (const capability of listRegistryCapabilities()) {
      assert.ok(capability.verificationFiles.length > 0, `${capability.id}: verification files`);
      for (const file of capability.verificationFiles) {
        assert.equal(existsSync(resolve(__dirname, '..', file)), true, `${capability.id}: ${file}`);
      }
    }
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
    for (const capability of listRegistryCapabilities()) {
      assert.equal(capability.rdapDiscovery, 'iana-bootstrap');
      assert.equal(capability.whoisDiscovery, 'iana-referral');
      assert.equal(
        capability.whoisQueryProfile,
        capability.id === 'denic-domain-ace' ? 'denic-domain-ace' : 'plain-domain',
      );
      assert.equal(capability.whoisQueryScope, 'first-referral');
      assert.equal(capability.whoisEncodingProfile, 'utf-8');
      assert.equal('endpoint' in capability, false);
      assert.equal('queryTemplate' in capability, false);
    }
  });
});
