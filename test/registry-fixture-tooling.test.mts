import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';

import { REGISTRY_FIXTURE_PROVENANCE } from '../fixtures/registry-fixture-provenance.mts';
import {
  buildRegistryFixtureFreshnessReport,
  DEFAULT_REGISTRY_FIXTURE_MAX_AGE_DAYS,
  main as freshnessMain,
} from '../tools/registry-fixture-freshness.mts';
import {
  buildRegistryFixtureScaffold,
  main as scaffoldMain,
} from '../tools/registry-fixture-scaffold.mts';

function writable() {
  let value = '';
  return {
    stream: { write(chunk: string) { value += chunk; } },
    value: () => value,
  };
}

describe('registry fixture freshness tooling', () => {
  test('reports current files and profiles when tracked digests match', async () => {
    const fixtureBytes = Buffer.from('synthetic fixture');
    const fixtureDigest = createHash('sha256').update(fixtureBytes).digest('hex');
    const provenance = [{
      path: 'fixtures/example.mts',
      sourceDate: '2026-07-27',
      verifiedAt: '2026-07-28',
      sha256: fixtureDigest,
      sourceUrls: ['https://www.iana.org/'],
      interpretation: 'Synthetic fixture.',
    }];
    const report = await buildRegistryFixtureFreshnessReport({
      now: () => new Date('2026-07-29T00:00:00.000Z'),
      provenance,
      capabilities: [{
        id: 'fixture-profile',
        suffixes: ['test'],
        registryClass: 'generic',
        rdapDiscovery: 'iana-bootstrap',
        whoisDiscovery: 'iana-referral',
        whoisQueryProfile: 'plain-domain',
        whoisQueryScope: 'first-referral',
        whoisEncodingProfile: 'utf-8',
        whoisParserProfile: 'generic-colon',
        whoisAccessProfile: 'iana-referral',
        rdapAccessProfile: 'iana-bootstrap',
        coverageState: 'fixture_verified',
        fixtureScenarios: ['registered'],
        verificationFiles: ['fixtures/example.mts'],
        documentationUrls: ['https://www.iana.org/'],
        officialLookupUrl: null,
        limitation: 'Synthetic fixture only.',
        explicitSuffixProfile: true,
      }],
      readFixture: async () => fixtureBytes,
    });
    assert.deepEqual(report.summary.fileStates, { current: 1, stale: 0, changed: 0, inconclusive: 0 });
    assert.deepEqual(report.summary.profileStates, { current: 1, stale: 0, changed: 0, inconclusive: 0 });
    assert.equal(report.profiles[0]?.state, 'current');
    assert.equal(report.files[0]?.sourceDate, '2026-07-27');
  });

  test('distinguishes stale, changed, and inconclusive verification files', async () => {
    const provenance = [{
      path: 'fixtures/example.mts',
      sourceDate: '2025-01-01',
      verifiedAt: '2025-01-01',
      sha256: '0'.repeat(64),
      sourceUrls: ['https://www.iana.org/'],
      interpretation: 'Synthetic fixture.',
    }];
    const capability = {
      id: 'fixture-profile',
      suffixes: ['test'],
      coverageState: 'fixture_verified' as const,
      verificationFiles: ['fixtures/example.mts'],
    };
    const stale = await buildRegistryFixtureFreshnessReport({
      now: () => new Date('2026-07-29T00:00:00.000Z'),
      provenance,
      capabilities: [capability as never],
      readFixture: async () => Buffer.alloc(0),
    });
    assert.equal(stale.files[0]?.state, 'changed');

    const missing = await buildRegistryFixtureFreshnessReport({
      now: () => new Date('2026-07-29T00:00:00.000Z'),
      provenance: [{ ...provenance[0]!, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' }],
      capabilities: [capability as never],
      readFixture: async () => { throw new Error('private path detail'); },
    });
    assert.equal(missing.files[0]?.state, 'inconclusive');
    assert.equal(missing.files[0]?.error, 'The tracked fixture file could not be read within its byte limit.');
  });

  test('uses a bounded review-age policy and stable command exit codes', async () => {
    const stdout = writable();
    const stderr = writable();
    const code = await freshnessMain(['--max-age-days', String(DEFAULT_REGISTRY_FIXTURE_MAX_AGE_DAYS), '--json'], {
      stdout: stdout.stream,
      stderr: stderr.stream,
      now: () => new Date('2026-07-29T00:00:00.000Z'),
      capabilities: [],
      readFixture: async (absolutePath) => {
        const entry = REGISTRY_FIXTURE_PROVENANCE.find((item) => absolutePath.endsWith(item.path));
        if (!entry) throw new Error('missing');
        return Buffer.from(entry.sha256, 'hex');
      },
    });
    assert.equal(code, 2);
    assert.match(stdout.value(), /"schema": "whoisleuth\.registry-fixture-freshness"/u);
    assert.equal(stderr.value(), '');
  });
});

describe('registry fixture contribution scaffold', () => {
  test('generates only reserved synthetic placeholders for a known profile', () => {
    const output = buildRegistryFixtureScaffold('nic-io-colon', 'ac', 'registered');
    assert.match(output, /EXAMPLE\.AC/u);
    assert.match(output, /example\.invalid/u);
    assert.match(output, /Do not paste a live WHOIS response/u);
    assert.doesNotMatch(output, /https?:\/\//u);
  });

  test('rejects unknown profiles, mismatched suffixes, and unsupported scenarios', () => {
    assert.throws(() => buildRegistryFixtureScaffold('missing', 'ac', 'registered'), /not present/u);
    assert.throws(() => buildRegistryFixtureScaffold('nic-io-colon', 'au', 'registered'), /does not cover/u);
    assert.throws(() => buildRegistryFixtureScaffold('nic-io-colon', 'ac', 'available'), /Scenario/u);
  });

  test('provides bounded command errors without writing a scaffold', async () => {
    const stdout = writable();
    const stderr = writable();
    const code = await scaffoldMain(['--profile', 'nic-io-colon', '--suffix', 'ac'], {
      stdout: stdout.stream,
      stderr: stderr.stream,
    });
    assert.equal(code, 2);
    assert.equal(stdout.value(), '');
    assert.match(stderr.value(), /--scenario requires a value/u);
  });
});
