'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable, Writable } = require('node:stream');

const { parseCliArguments } = require('../cli/arguments.mts');
const EXIT_CODES = require('../cli/exit-codes.mts').default;
const {
  MAX_REGISTRY_SUPPORT_REFERENCES,
  MAX_REGISTRY_SUPPORT_TEXT_LENGTH,
  buildRegistrySupportDocument,
} = require('../cli/registry-support.mts');
const { runCli } = require('../cli/runner.mts');
const { registryCapabilityFor } = require('../lib/registry-capabilities.mts');

function capture() {
  let value = '';
  return {
    stream: new Writable({ write(chunk, _encoding, callback) { value += chunk.toString(); callback(); } }),
    value: () => value,
  };
}

function fixtureCapability(overrides = {}) {
  return {
    id: 'fixture-profile',
    suffixes: ['test'],
    registryClass: 'generic',
    rdapDiscovery: 'iana-bootstrap',
    whoisDiscovery: 'iana-referral',
    whoisQueryProfile: 'plain-domain',
    whoisQueryScope: 'first-referral',
    whoisEncodingProfile: 'utf-8',
    whoisParserProfile: 'generic-colon',
    fallbackProfile: null,
    whoisAccessProfile: 'iana-referral',
    rdapAccessProfile: 'iana-bootstrap',
    coverageState: 'fixture_verified',
    fixtureScenarios: ['registered', 'not_found'],
    verificationFiles: ['fixtures/registry.test.js'],
    documentationUrls: ['https://www.iana.org/domains/root/db/test.html'],
    limitation: 'Fixture coverage does not prove current reachability.',
    explicitSuffixProfile: true,
    ...overrides,
  };
}

describe('registry-support argument parsing', () => {
  test('accepts one domain or leading-dot suffix with terminal options', () => {
    assert.deepEqual(parseCliArguments(['registry-support', 'portal.example.uk']), {
      action: 'registry-support', target: 'portal.example.uk', output: 'terminal', quiet: false, color: true,
    });
    assert.deepEqual(parseCliArguments(['registry-support', '.es', '--json', '--no-color']), {
      action: 'registry-support', target: '.es', output: 'json', quiet: false, color: false,
    });
  });

  test('rejects duplicate output, incompatible quiet mode, unknown options, and multiple inputs', () => {
    assert.throws(() => parseCliArguments(['registry-support', 'uk', '--json', '--json']), /only once/);
    assert.throws(() => parseCliArguments(['registry-support', 'uk', '--json', '--quiet']), /cannot be combined/);
    assert.throws(() => parseCliArguments(['registry-support', 'uk', '--deep']), /Unknown option/);
    assert.throws(() => parseCliArguments(['registry-support', 'uk', 'es']), /one domain or suffix/);
  });
});

describe('versioned registry-support document', () => {
  test('projects only known bounded catalogue fields', () => {
    const capability = fixtureCapability({
      unknownRawField: 'must not escape',
      limitation: `bounded ${'x'.repeat(MAX_REGISTRY_SUPPORT_TEXT_LENGTH + 100)}`,
      fixtureScenarios: Array.from({ length: MAX_REGISTRY_SUPPORT_REFERENCES + 5 }, (_, index) => `state_${index}`),
      verificationFiles: ['/absolute/private', '../outside', 'fixtures/safe.test.js'],
      documentationUrls: ['http://insecure.invalid/', 'https://docs.example.test/reference', 'not a URL'],
    });
    const document = buildRegistrySupportDocument('example.test', capability, 5, '2026-07-17T00:00:00.000Z');
    assert.equal(document.schema, 'whoisleuth.cli.registry-support');
    assert.equal(document.version, 2);
    assert.equal(document.catalogueVersion, 5);
    assert.deepEqual(document.standardsCoverage.genericAndRestricted, {
      total: 1113,
      rdapCovered: 1113,
    });
    assert.equal(document.profile.explicitSuffixProfile, true);
    assert.equal(document.verification.fixtureScenarios.length, MAX_REGISTRY_SUPPORT_REFERENCES);
    assert.deepEqual(document.verification.files, ['fixtures/safe.test.js']);
    assert.deepEqual(document.verification.documentationUrls, ['https://docs.example.test/reference']);
    assert.ok(document.limitation.length <= MAX_REGISTRY_SUPPORT_TEXT_LENGTH);
    assert.doesNotMatch(JSON.stringify(document), /must not escape|absolute\/private|insecure\.invalid/);
  });

  test('rejects a malformed projected suffix', () => {
    assert.throws(() => buildRegistrySupportDocument('bad', fixtureCapability({ suffixes: ['bad/suffix'] }), 5), /valid suffix/);
  });
});

describe('registry-support runner', () => {
  test('returns an explicit fixture-backed profile as JSON without calling lookup', async () => {
    const stdout = capture();
    const stderr = capture();
    let lookupCalled = false;
    const code = await runCli(['registry-support', 'portal.example.uk', '--json'], {
      stdout: stdout.stream,
      stderr: stderr.stream,
      now: () => '2026-07-17T00:00:00.000Z',
      runUnifiedLookup: async () => { lookupCalled = true; },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(stderr.value(), '');
    assert.equal(lookupCalled, false);
    const document = JSON.parse(stdout.value());
    assert.equal(document.catalogueVersion, 25);
    assert.equal(document.suffix, 'uk');
    assert.equal(document.profile.explicitSuffixProfile, true);
    assert.equal(document.profile.coverageState, 'fixture_verified');
    assert.equal(document.interpretation.liveReachability, 'not_tested');
    assert.equal(document.standardsCoverage.verifiedAt, '2026-07-19');
    assert.match(document.interpretation.statement, /does not test current live reachability/);
  });

  test('returns the generic discovery profile for an unknown valid suffix', async () => {
    const stdout = capture();
    const code = await runCli(['registry-support', 'example.test', '--json'], {
      stdout: stdout.stream,
      stderr: capture().stream,
      now: () => '2026-07-17T00:00:00.000Z',
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    const document = JSON.parse(stdout.value());
    assert.equal(document.suffix, 'test');
    assert.equal(document.profile.explicitSuffixProfile, false);
    assert.equal(document.profile.coverageState, 'discovery_only');
  });

  test('accepts one stdin suffix and renders access constraints neutrally', async () => {
    const stdout = capture();
    const code = await runCli(['registry-support'], {
      stdout: stdout.stream,
      stderr: capture().stream,
      stdin: Readable.from(['.es\n']),
      now: () => '2026-07-17T00:00:00.000Z',
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.match(stdout.value(), /Suffix\s+\.es/);
    assert.match(stdout.value(), /Coverage\s+Access documented/);
    assert.match(stdout.value(), /Source-IP authorization required/);
    assert.match(stdout.value(), /does not test current live reachability/);
    assert.match(stdout.value(), /not evidence that the domain is unregistered/);
    assert.doesNotMatch(stdout.value(), /Domain is (?:unregistered|safe)/);
  });

  test('renders registry-policy restrictions from the actual catalogue', async () => {
    const stdout = capture();
    const code = await runCli(['registry-support', '.ch'], {
      stdout: stdout.stream,
      stderr: capture().stream,
      now: () => '2026-07-18T00:00:00.000Z',
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.match(stdout.value(), /Suffix\s+\.ch/);
    assert.match(stdout.value(), /Registry policy restricted/);
    assert.match(stdout.value(), /missing registry data is not evidence/i);
  });

  test('renders sponsored and infrastructure exceptions from the shared catalogue', async () => {
    const military = capture();
    assert.equal(await runCli(['registry-support', '.mil'], {
      stdout: military.stream,
      stderr: capture().stream,
    }), EXIT_CODES.SUCCESS);
    assert.match(military.value(), /Registry class Sponsored/);
    assert.match(military.value(), /RDAP access\s+No service published by IANA/);
    assert.match(military.value(), /WHOIS access\s+No service published by IANA/);
    assert.match(military.value(), /gTLD RDAP\s+1113 \/ 1113/);

    const infrastructure = capture();
    assert.equal(await runCli(['registry-support', '.arpa'], {
      stdout: infrastructure.stream,
      stderr: capture().stream,
    }), EXIT_CODES.SUCCESS);
    assert.match(infrastructure.value(), /Registry class Infrastructure/);
    assert.match(infrastructure.value(), /not ordinary public registration/i);
  });

  test('quiet mode performs validation without writing output', async () => {
    const stdout = capture();
    const code = await runCli(['registry-support', 'uk', '--quiet'], {
      stdout: stdout.stream,
      stderr: capture().stream,
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(stdout.value(), '');
  });

  test('invalid input is a usage error and missing input is read only once', async () => {
    const invalidStderr = capture();
    assert.equal(await runCli(['registry-support', 'not a domain'], {
      stdout: capture().stream,
      stderr: invalidStderr.stream,
    }), EXIT_CODES.USAGE);
    assert.match(invalidStderr.value(), /^Usage error:/);

    let calls = 0;
    const missingStderr = capture();
    assert.equal(await runCli(['registry-support'], {
      stdout: capture().stream,
      stderr: missingStderr.stream,
      readStdin: async () => { calls += 1; return ''; },
    }), EXIT_CODES.USAGE);
    assert.equal(calls, 1);
    assert.match(missingStderr.value(), /requires one domain or suffix/);
  });

  test('uses the injected catalogue boundary and never mutates its capability', async () => {
    const capability = fixtureCapability();
    const before = structuredClone(capability);
    const stdout = capture();
    const code = await runCli(['registry-support', 'example.test', '--json'], {
      stdout: stdout.stream,
      stderr: capture().stream,
      registryCapabilityFor: (value) => {
        assert.equal(value, 'example.test');
        return capability;
      },
      registryCapabilitiesVersion: 10,
      now: () => '2026-07-17T00:00:00.000Z',
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(JSON.parse(stdout.value()).catalogueVersion, 10);
    assert.deepEqual(capability, before);
  });

  test('actual catalogue lookup returns a defensive copy', () => {
    const first = registryCapabilityFor('example.uk');
    const second = registryCapabilityFor('example.uk');
    first.fixtureScenarios.push('changed');
    assert.doesNotMatch(second.fixtureScenarios.join(','), /changed/);
  });
});
