import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { MAX_CLI_ERROR_MESSAGE_LENGTH, boundedCliErrorMessage } from '../cli/errors.mts';
import { sha256ArtifactDigest } from '../frontend/src/lib/analysis/artifact-integrity.ts';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const BIN = join(ROOT, 'bin', 'whoisleuth.mts');

function savedLookup() {
  return {
    schema: 'whoisleuth.cli.lookup',
    version: 1,
    generatedAt: '2026-07-14T08:00:00.000Z',
    mode: 'deep',
    query: 'example.test',
    type: 'domain',
    inputHostname: 'example.test',
    registrableDomain: 'example.test',
    isSubdomain: false,
    rdap: {
      rdapServer: 'https://rdap.example.test/domain/example.test',
      upstreamStatus: 200,
      parsed: {
        domain: 'EXAMPLE.TEST',
        registrar: { name: 'Example Registrar' },
        statuses: ['active'],
        nameservers: ['NS1.EXAMPLE.TEST'],
      },
      data: { objectClassName: 'domain', fixtureSecret: 'raw JSON only' },
      registrarRdap: {
        status: 'success',
        data: { registrarSecret: 'must not enter portable comparison output' },
        parsed: {
          domain: 'example.test',
          registrar: { name: 'Example Registrar' },
          statuses: ['active'],
          nameservers: ['ns1.example.test'],
          entitiesByRole: { abuse: [{ email: 'private@example.test' }] },
        },
      },
    },
    whois: {
      parsed: {
        domainName: 'EXAMPLE.TEST',
        registrar: 'Example Registrar',
        statuses: ['active'],
        nameservers: ['ns1.example.test'],
        chainStatus: 'complete',
      },
      chain: [{ server: 'whois.example.test', response: 'fixture response body' }],
    },
    availability: { applicable: true, domain: 'example.test', state: 'registered', confidence: 'high' },
    diagnostics: {
      version: 4,
      rdap: { status: 'success', registrar: { status: 'success' } },
      whois: { status: 'complete' },
      availability: { status: 'complete' },
    },
  };
}

function runBinary(args: string[], input = '') {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    input,
    timeout: 10_000,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
}

describe('installed CLI process boundary', () => {
  test('help, version, and usage failures preserve stable streams and exit codes', () => {
    const help = runBinary(['--help']);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /^WHOISleuth CLI/);
    assert.equal(help.stderr, '');

    const commandHelp = runBinary(['registry-support', '--help']);
    assert.equal(commandHelp.status, 0);
    assert.match(commandHelp.stdout, /^WHOISleuth registry-support/);
    assert.match(commandHelp.stdout, /registry-support <domain\|suffix>/);
    assert.doesNotMatch(commandHelp.stdout, /whoisleuth bulk/);
    assert.equal(commandHelp.stderr, '');

    const version = runBinary(['--version']);
    assert.equal(version.status, 0);
    assert.match(version.stdout, /^\d+\.\d+\.\d+\n$/);
    assert.equal(version.stderr, '');

    const invalid = runBinary(['not-a-command']);
    assert.equal(invalid.status, 2);
    assert.equal(invalid.stdout, '');
    assert.match(invalid.stderr, /^Usage error: Unknown command/);
    assert.equal(invalid.stderr.trim().split('\n').length, 1);
  });

  test('offline discovery runs through the executable without hosted or network access', () => {
    const result = runBinary(['discover', 'example', '--tlds', 'com', '--preset', 'common', '--json']);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    const document = JSON.parse(result.stdout);
    assert.equal(document.schema, 'whoisleuth.cli.discover');
    assert.equal(document.seed, 'example');
    assert.ok(document.candidates.length > 0);
  });

  test('registry capability coverage runs through the executable as an offline catalogue view', () => {
    const result = runBinary(['registry-support', 'portal.example.uk', '--json']);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    const document = JSON.parse(result.stdout);
    assert.equal(document.schema, 'whoisleuth.cli.registry-support');
    assert.equal(document.version, 2);
    assert.equal(document.catalogueVersion, 26);
    assert.equal(document.standardsCoverage.genericAndRestricted.rdapCovered, 1114);
    assert.equal(document.suffix, 'uk');
    assert.equal(document.profile.explicitSuffixProfile, true);
    assert.equal(document.interpretation.liveReachability, 'not_tested');
  });

  test('Risk calibration runs through the executable as an offline fixture replay', () => {
    const input = {
      schema: 'whoisleuth.risk-calibration-dataset',
      version: 1,
      records: [{
        id: 'fixture-1',
        domain: 'login.example.test',
        analystDisposition: 'confirmed_abuse',
        evidence: {
          availability: 'registered',
          mutationTypes: ['dictionary'],
          faviconMatch: true,
          phishingLanguageMatch: 'verify account',
          hasPasswordField: true,
        },
      }],
    };
    const result = runBinary(['risk-calibrate', '--json'], JSON.stringify(input));
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    const document = JSON.parse(result.stdout);
    assert.equal(document.schema, 'whoisleuth.cli.risk-calibration');
    assert.equal(document.riskModelVersion, 6);
    assert.equal(document.interpretation.networkRequests, false);
    assert.match(document.interpretation.statement, /does not.*prove maliciousness or safety/i);
  });

  test('offline artifact verification checks integrity without printing artifact contents', async () => {
    const unsigned = {
      schema: 'whoisleuth.acquisition-decision',
      version: 1,
      generatedAt: '2026-07-29T00:00:00.000Z',
      decision: {
        domain: 'sensitive-target.invalid',
        rationale: 'Analyst-only rationale that must not be echoed.',
      },
    };
    const input = {
      ...unsigned,
      integrity: {
        algorithm: 'SHA-256',
        digestSha256: await sha256ArtifactDigest(unsigned),
      },
    };
    const result = runBinary(['verify-artifact', '--json'], JSON.stringify(input));
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    const document = JSON.parse(result.stdout);
    assert.equal(document.schema, 'whoisleuth.offline-artifact-verification');
    assert.equal(document.state, 'verified');
    assert.equal(document.checks.contentIntegrity, 'verified');
    assert.doesNotMatch(result.stdout, /sensitive-target|Analyst-only rationale/);
  });

  test('source reliability reporting aggregates operations without retaining targets or queries', () => {
    const lookup = savedLookup();
    const input = {
      ...lookup,
      diagnostics: {
        ...lookup.diagnostics,
        timing: {
          version: 1,
          sources: [{ source: 'rdap', durationMs: 125 }],
        },
      },
    };
    const result = runBinary(['source-report', '--json'], JSON.stringify(input));
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    const document = JSON.parse(result.stdout);
    assert.equal(document.schema, 'whoisleuth.source-reliability-report');
    assert.equal(document.documentsReviewed, 1);
    assert.deepEqual(document.privacy, {
      targetsRetained: 0,
      queriesRetained: 0,
      rawEvidenceRetained: 0,
    });
    assert.doesNotMatch(result.stdout, /example\\.test|rdap\\.example|fixtureSecret/);
  });

  test('saved lookup comparison is a real-process offline transformation', () => {
    const result = runBinary(['compare', '--json'], JSON.stringify(savedLookup()));
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    const document = JSON.parse(result.stdout);
    assert.equal(document.schema, 'whoisleuth.cli.compare');
    assert.equal(document.version, 3);
    assert.equal(document.counts.conflict, 0);
    assert.equal(document.registrarPublicationComparison.counts.conflict, 0);
    assert.ok(document.registrarPublicationComparison.counts.equivalent > 0);
    assert.doesNotMatch(result.stdout, /fixtureSecret|fixture response body|registrarSecret|private@example/);
  });

  test('JSON, Markdown, and HTML evidence formats preserve their process contracts', () => {
    const input = JSON.stringify(savedLookup());
    const json = runBinary(['export', '--compact'], input);
    assert.equal(json.status, 0);
    assert.equal(json.stderr, '');
    assert.equal(JSON.parse(json.stdout).schema, 'whoisleuth.lookup-evidence');
    assert.match(json.stdout, /fixtureSecret/);

    const markdown = runBinary(['export', '--markdown'], input);
    assert.equal(markdown.status, 0);
    assert.equal(markdown.stderr, '');
    assert.match(markdown.stdout, /^# Lookup evidence report/);
    assert.doesNotMatch(markdown.stdout, /fixtureSecret|fixture response body/);

    const html = runBinary(['export', '--html'], input);
    assert.equal(html.status, 0);
    assert.equal(html.stderr, '');
    assert.match(html.stdout, /^<!doctype html>/);
    assert.doesNotMatch(html.stdout, /fixtureSecret|fixture response body|<script\b|<a\b/i);
  });
});

test('CLI error text is one bounded control-safe line at every entry point', () => {
  const message = boundedCliErrorMessage(new Error(`failure\n\u202edetail\u0000${'x'.repeat(500)}`));
  assert.ok(message.length <= MAX_CLI_ERROR_MESSAGE_LENGTH);
  assert.doesNotMatch(message, /[\x00-\x1f\x7f\u202e]/);
  assert.match(message, /^failure detail/);
});

test('serverless deployment roots exclude the local CLI implementation', () => {
  const config = readFileSync(join(ROOT, 'netlify.toml'), 'utf8');
  assert.match(config, /^\s*publish\s*=\s*"frontend\/build"\s*$/m);
  assert.match(config, /^\s*functions\s*=\s*"netlify\/functions"\s*$/m);
  assert.doesNotMatch(config, /^\s*(publish|functions)\s*=\s*"(?:bin|cli)(?:\/|\")/m);
});
