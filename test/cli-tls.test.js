'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { Writable } = require('node:stream');

const { parseCliArguments } = require('../cli/arguments');
const EXIT_CODES = require('../cli/exit-codes');
const { buildCliTlsDocument } = require('../cli/formatters/json');
const { MAX_TLS_TERMINAL_ALT_NAMES, formatTerminalTls } = require('../cli/formatters/terminal');
const { runCli } = require('../cli/runner');

function capture() {
  let value = '';
  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        value += chunk.toString();
        callback();
      },
    }),
    value: () => value,
  };
}

function certificate(overrides = {}) {
  return {
    subject: { commonNames: ['login.example.test'], organizations: ['Example organization'], organizationalUnits: [], countries: ['AU'], localities: [], states: [] },
    issuer: { commonNames: ['Example issuing CA'], organizations: ['Example CA'], organizationalUnits: [], countries: [], localities: [], states: [] },
    serialNumber: 'a1b2c3',
    validFrom: '2026-07-01T00:00:00.000Z',
    validTo: '2026-08-01T00:00:00.000Z',
    fingerprintSha256: 'a'.repeat(64),
    isCertificateAuthority: false,
    subjectAltNames: { dnsNames: ['*.example.test', 'login.example.test'], ipAddresses: ['93.184.216.34'], truncated: false },
    publicKey: { type: 'rsa', bits: 2048, curve: null, fingerprintSha256: 'b'.repeat(64) },
    ...overrides,
  };
}

function tlsObservation(overrides = {}) {
  return {
    version: 1,
    status: 'success',
    observedAt: '2026-07-14T05:00:00.000Z',
    scanMode: 'deep',
    source: 'tls',
    durationMs: 40,
    complete: true,
    truncated: false,
    limitations: [
      'This is a point-in-time TLS handshake to one validated public address; other addresses or edge locations may present different results.',
    ],
    diagnostics: { connectionAttempts: 1, resolvedAddressCount: 2, discardedFields: 0 },
    profileVersion: 1,
    connectedAddress: '93.184.216.34',
    connectedFamily: 4,
    port: 443,
    sniHost: 'login.example.test',
    protocol: 'TLSv1.3',
    alpnProtocol: 'h2',
    cipher: { name: 'TLS_AES_256_GCM_SHA384', standardName: 'TLS_AES_256_GCM_SHA384', version: 'TLSv1.3' },
    ephemeralKey: { type: 'ECDH', name: 'X25519', size: 253 },
    authorization: { authorized: true, error: null },
    hostname: { matches: true, error: null },
    validity: { status: 'valid' },
    certificate: certificate(),
    chain: [certificate(), certificate({ isCertificateAuthority: true, fingerprintSha256: 'c'.repeat(64) })],
    chainTruncated: false,
    findings: [{ id: 'wildcard_certificate', tone: 'neutral', label: 'Wildcard certificate', detail: 'Wildcard use is common and is not inherently suspicious.' }],
    ...overrides,
  };
}

describe('TLS CLI argument parsing', () => {
  test('accepts terminal defaults and JSON output', () => {
    assert.deepEqual(parseCliArguments(['tls', 'login.example.test']), {
      action: 'tls', hostname: 'login.example.test', output: 'terminal', quiet: false, color: true,
    });
    assert.deepEqual(parseCliArguments(['tls', 'login.example.test', '--json', '--no-color']), {
      action: 'tls', hostname: 'login.example.test', output: 'json', quiet: false, color: false,
    });
  });

  test('accepts stdin mode and quiet execution', () => {
    assert.deepEqual(parseCliArguments(['tls', '--quiet']), {
      action: 'tls', hostname: null, output: 'terminal', quiet: true, color: true,
    });
  });

  test('rejects repeated flags, multiple hostnames, and unsupported options', () => {
    assert.throws(() => parseCliArguments(['tls', 'one.test', 'two.test']), /one hostname/);
    assert.throws(() => parseCliArguments(['tls', 'one.test', '--json', '--json']), /only once/);
    assert.throws(() => parseCliArguments(['tls', 'one.test', '--deep']), /Unknown option/);
    assert.throws(() => parseCliArguments(['tls', 'one.test', '--json', '--quiet']), /cannot be combined/);
  });
});

describe('TLS CLI output', () => {
  test('builds a protected versioned machine envelope without mutating evidence', () => {
    const result = tlsObservation({ schema: 'untrusted', version: 99, generatedAt: 'untrusted' });
    const before = structuredClone(result);
    const document = buildCliTlsDocument('LOGIN.example.test', result, '2026-07-14T06:00:00.000Z');
    assert.equal(document.schema, 'whoisleuth.cli.tls');
    assert.equal(document.version, 1);
    assert.equal(document.generatedAt, '2026-07-14T06:00:00.000Z');
    assert.equal(document.requestedHostname, 'LOGIN.example.test');
    assert.deepEqual(result, before);
  });

  test('terminal output presents negotiated, certificate, validation, finding, and limitation evidence', () => {
    const output = formatTerminalTls(buildCliTlsDocument('login.example.test', tlsObservation()));
    assert.match(output, /Hostname\s+login\.example\.test/);
    assert.match(output, /Evidence\s+Success/);
    assert.match(output, /Protocol\s+TLSv1\.3/);
    assert.match(output, /Cipher\s+TLS_AES_256_GCM_SHA384/);
    assert.match(output, /Authorized\s+Yes/);
    assert.match(output, /Hostname match\s+Yes/);
    assert.match(output, /Validity\s+Valid/);
    assert.match(output, /Subject\s+login\.example\.test/);
    assert.match(output, /Fingerprint\s+a{64}/);
    assert.match(output, /Public key\s+rsa 2048 bits/);
    assert.match(output, /Chain\s+2 certificates/);
    assert.match(output, /Finding\s+Wildcard certificate/);
    assert.match(output, /Limitation\s+This is a point-in-time TLS handshake/);
  });

  test('terminal alt-name cap is explicit while machine evidence remains complete', () => {
    const dnsNames = Array.from({ length: MAX_TLS_TERMINAL_ALT_NAMES + 2 }, (_, index) => `host-${index}.example.test`);
    const result = tlsObservation({ certificate: certificate({ subjectAltNames: { dnsNames, ipAddresses: [], truncated: false } }) });
    const output = formatTerminalTls(buildCliTlsDocument('login.example.test', result));
    assert.match(output, /\(\+2 more\)/);
    assert.doesNotMatch(output, /host-11\.example\.test/);
    assert.equal(result.certificate.subjectAltNames.dnsNames.length, MAX_TLS_TERMINAL_ALT_NAMES + 2);
  });

  test('terminal output keeps trust, hostname, and collection failures explicit', () => {
    const output = formatTerminalTls(tlsObservation({
      status: 'error',
      connectedAddress: null,
      protocol: null,
      cipher: null,
      authorization: { authorized: false, error: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' },
      hostname: { matches: false, error: 'Hostname mismatch' },
      validity: { status: 'unknown' },
      certificate: null,
      chain: [],
      diagnostics: { connectionAttempts: 1, error: 'TLS handshake timed out' },
      findings: [],
    }));
    assert.match(output, /Evidence\s+Error/);
    assert.match(output, /Authorized\s+No/);
    assert.match(output, /Hostname match\s+No/);
    assert.match(output, /Trust detail\s+UNABLE_TO_VERIFY_LEAF_SIGNATURE/);
    assert.match(output, /Name detail\s+Hostname mismatch/);
    assert.match(output, /Error\s+TLS handshake timed out/);
  });
});

describe('TLS CLI runner', () => {
  test('normalizes one hostname, invokes the shared collector, and emits JSON', async () => {
    const stdout = capture();
    let receivedHostname;
    const code = await runCli(['tls', 'LOGIN.example.test.', '--json'], {
      stdout: stdout.stream,
      stderr: capture().stream,
      now: () => '2026-07-14T06:00:00.000Z',
      normalizeTlsHostname: () => 'login.example.test',
      collectTlsIntelligence: async (hostname) => { receivedHostname = hostname; return tlsObservation(); },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(receivedHostname, 'login.example.test');
    const document = JSON.parse(stdout.value());
    assert.equal(document.schema, 'whoisleuth.cli.tls');
    assert.equal(document.requestedHostname, 'LOGIN.example.test.');
    assert.equal(document.certificate.fingerprintSha256, 'a'.repeat(64));
  });

  test('accepts stdin and quiet mode still performs collection', async () => {
    let collections = 0;
    const stdout = capture();
    const code = await runCli(['tls', '--quiet'], {
      stdout: stdout.stream,
      stderr: capture().stream,
      readStdin: async () => 'login.example.test',
      normalizeTlsHostname: (value) => value,
      collectTlsIntelligence: async () => { collections++; return tlsObservation(); },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(collections, 1);
    assert.equal(stdout.value(), '');
  });

  test('invalid, IP, and missing targets are usage errors without a connection', async () => {
    let collections = 0;
    const dependencies = {
      stdout: capture().stream,
      stderr: capture().stream,
      normalizeTlsHostname: () => null,
      collectTlsIntelligence: async () => { collections++; return tlsObservation(); },
    };
    assert.equal(await runCli(['tls', '127.0.0.1'], dependencies), EXIT_CODES.USAGE);
    assert.equal(await runCli(['tls'], { ...dependencies, readStdin: async () => '' }), EXIT_CODES.USAGE);
    assert.equal(collections, 0);
  });

  test('an inconclusive collected observation is a successful result, not a process failure', async () => {
    const stdout = capture();
    const code = await runCli(['tls', 'login.example.test', '--json'], {
      stdout: stdout.stream,
      stderr: capture().stream,
      normalizeTlsHostname: (value) => value,
      collectTlsIntelligence: async () => tlsObservation({ status: 'error', complete: false, certificate: null, chain: [], findings: [] }),
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(JSON.parse(stdout.value()).status, 'error');
  });

  test('unexpected collector failures are bounded on stderr', async () => {
    const stderr = capture();
    const code = await runCli(['tls', 'login.example.test'], {
      stdout: capture().stream,
      stderr: stderr.stream,
      normalizeTlsHostname: (value) => value,
      collectTlsIntelligence: async () => { throw new Error(`collector failed\n${'x'.repeat(500)}`); },
    });
    assert.equal(code, EXIT_CODES.LOOKUP_FAILED);
    assert.match(stderr.value(), /^TLS intelligence failed: collector failed /);
    assert.ok(stderr.value().length < 360);
  });
});
