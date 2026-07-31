import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { MAX_CLI_ERROR_MESSAGE_LENGTH, boundedCliErrorMessage } from '../cli/errors.mts';

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
  test('usage failures preserve the installed executable stream and exit contract', () => {
    const invalid = runBinary(['not-a-command']);
    assert.equal(invalid.status, 2);
    assert.equal(invalid.stdout, '');
    assert.match(invalid.stderr, /^Usage error: Unknown command/);
    assert.equal(invalid.stderr.trim().split('\n').length, 1);
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
