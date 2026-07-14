'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { Writable } = require('node:stream');

const { parseCliArguments } = require('../cli/arguments');
const EXIT_CODES = require('../cli/exit-codes');
const { buildCliHttpDocument } = require('../cli/formatters/json');
const { formatTerminalHttp } = require('../cli/formatters/terminal');
const { MAX_HTTP_CLI_DETAIL_LENGTH, buildHttpProbeResult } = require('../cli/http');
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

function httpObservation(overrides = {}) {
  return {
    version: 1,
    status: 'success',
    observedAt: '2026-07-14T03:00:00.000Z',
    scanMode: 'deep',
    source: 'http',
    durationMs: 25,
    complete: true,
    truncated: false,
    limitations: ['URL query strings were omitted from retained provenance.'],
    diagnostics: { redirectCount: 1, httpStatus: 200 },
    requestUrl: 'https://example.test/',
    finalUrl: 'https://www.example.test/home',
    transportSecurity: 'https',
    redirectCount: 1,
    redirectLimitReached: false,
    redirects: [{ from: 'https://example.test/', to: 'https://www.example.test/home', status: 301, durationMs: 5, queryOmitted: true }],
    crossOriginRedirect: true,
    httpsDowngrade: false,
    attempts: [{ url: 'https://example.test/', queryOmitted: false, outcome: 'response', httpStatus: 200, error: null }],
    response: {
      status: 200,
      contentType: 'text/html; charset=utf-8',
      contentLanguage: 'en',
      server: 'test-server',
      declaredContentLength: 20,
      capturedBodyBytes: 20,
      bodyInspected: true,
      bodyTruncated: false,
      bodyHash: { algorithm: 'sha256', value: 'a'.repeat(64), scope: 'complete-body', bytes: 20 },
      securityHeaders: {
        strictTransportSecurity: 'max-age=31536000',
        contentSecurityPolicy: "default-src 'self'",
        xFrameOptions: null,
        xContentTypeOptions: 'nosniff',
        referrerPolicy: null,
      },
    },
    ...overrides,
  };
}

function homepageProbe(overrides = {}) {
  return {
    text: '<html>captured body must not be exported</html>',
    status: 'fetched',
    detail: 'Homepage responded over HTTPS (HTTP 200).',
    http: httpObservation(),
    ...overrides,
  };
}

describe('HTTP CLI argument parsing', () => {
  test('accepts terminal defaults and JSON output', () => {
    assert.deepEqual(parseCliArguments(['http', 'example.test']), {
      action: 'http', domain: 'example.test', output: 'terminal', quiet: false, color: true,
    });
    assert.deepEqual(parseCliArguments(['http', 'example.test', '--json', '--no-color']), {
      action: 'http', domain: 'example.test', output: 'json', quiet: false, color: false,
    });
  });

  test('accepts stdin mode and quiet terminal execution', () => {
    assert.deepEqual(parseCliArguments(['http', '--quiet']), {
      action: 'http', domain: null, output: 'terminal', quiet: true, color: true,
    });
  });

  test('rejects repeated flags, multiple domains, and unrelated options', () => {
    assert.throws(() => parseCliArguments(['http', 'one.test', 'two.test']), /one domain/);
    assert.throws(() => parseCliArguments(['http', 'one.test', '--json', '--json']), /only once/);
    assert.throws(() => parseCliArguments(['http', 'one.test', '--deep']), /Unknown option/);
    assert.throws(() => parseCliArguments(['http', 'one.test', '--json', '--quiet']), /cannot be combined/);
  });
});

describe('HTTP CLI result normalization', () => {
  test('retains normalized evidence but never captured homepage text', () => {
    const probe = homepageProbe();
    const before = structuredClone(probe);
    const result = buildHttpProbeResult('example.test', probe);
    assert.equal(result.domain, 'example.test');
    assert.equal(result.probeStatus, 'fetched');
    assert.equal(result.activityStatus, 'active');
    assert.equal(result.http.finalUrl, 'https://www.example.test/home');
    assert.equal(Object.hasOwn(result, 'text'), false);
    assert.equal(JSON.stringify(result).includes('captured body'), false);
    assert.deepEqual(probe, before);
  });

  test('bounds and control-sanitizes probe detail', () => {
    const result = buildHttpProbeResult('example.test', homepageProbe({ detail: `ok\n${'x'.repeat(500)}` }));
    assert.ok(result.detail.length <= MAX_HTTP_CLI_DETAIL_LENGTH);
    assert.equal(result.detail.includes('\n'), false);
  });

  test('keeps failed dual-scheme collection explicitly inconclusive', () => {
    const result = buildHttpProbeResult('example.test', homepageProbe({
      text: null,
      status: 'inconclusive',
      detail: 'Could not confirm homepage activity.',
      http: httpObservation({ status: 'error', complete: false, response: null, finalUrl: null }),
    }));
    assert.equal(result.probeStatus, 'inconclusive');
    assert.equal(result.activityStatus, 'unreachable');
    assert.equal(result.http.status, 'error');
  });

  test('unknown probe shapes fail closed to an inconclusive content-free result', () => {
    const result = buildHttpProbeResult('example.test', { status: 'unexpected', text: 'secret', http: ['invalid'] });
    assert.equal(result.probeStatus, 'inconclusive');
    assert.equal(result.activityStatus, 'unreachable');
    assert.equal(result.http, null);
    assert.equal(JSON.stringify(result).includes('secret'), false);
  });
});

describe('HTTP CLI output', () => {
  test('builds a protected versioned machine envelope without mutation', () => {
    const result = { ...buildHttpProbeResult('example.test', homepageProbe()), schema: 'untrusted', version: 99 };
    const before = structuredClone(result);
    const document = buildCliHttpDocument('EXAMPLE.test', result, '2026-07-14T04:00:00.000Z');
    assert.equal(document.schema, 'whoisleuth.cli.http');
    assert.equal(document.version, 1);
    assert.equal(document.generatedAt, '2026-07-14T04:00:00.000Z');
    assert.equal(document.requestedDomain, 'EXAMPLE.test');
    assert.deepEqual(result, before);
  });

  test('terminal output exposes response, attempts, completeness, hash, and header presence', () => {
    const output = formatTerminalHttp(buildCliHttpDocument('example.test', buildHttpProbeResult('example.test', homepageProbe())));
    assert.match(output, /Probe\s+Fetched/);
    assert.match(output, /Activity\s+Active/);
    assert.match(output, /HTTP status\s+200/);
    assert.match(output, /Final URL\s+https:\/\/www\.example\.test\/home/);
    assert.match(output, /strictTransportSecurity, contentSecurityPolicy, xContentTypeOptions/);
    assert.match(output, /sha256:a{64} \(complete-body\)/);
    assert.match(output, /Attempt\s+https:\/\/example\.test\/ — HTTP 200/);
    assert.match(output, /Limitation\s+URL query strings were omitted/);
  });

  test('terminal output remains explicit when no response was obtained', () => {
    const result = buildHttpProbeResult('example.test', homepageProbe({
      status: 'inconclusive',
      http: httpObservation({ status: 'error', response: null, finalUrl: null, attempts: [] }),
    }));
    const output = formatTerminalHttp(buildCliHttpDocument('example.test', result));
    assert.match(output, /Evidence\s+Error/);
    assert.match(output, /HTTP status\s+—/);
    assert.match(output, /No selected headers observed/);
  });
});

describe('HTTP CLI runner', () => {
  test('normalizes the domain, invokes one shared probe, and emits content-free JSON', async () => {
    const stdout = capture();
    let receivedDomain;
    const code = await runCli(['http', 'EXAMPLE.test.', '--json'], {
      stdout: stdout.stream,
      stderr: capture().stream,
      now: () => '2026-07-14T04:00:00.000Z',
      normalizeAuditDomain: () => 'example.test',
      fetchHomepage: async (domain) => { receivedDomain = domain; return homepageProbe(); },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(receivedDomain, 'example.test');
    const document = JSON.parse(stdout.value());
    assert.equal(document.schema, 'whoisleuth.cli.http');
    assert.equal(document.requestedDomain, 'EXAMPLE.test.');
    assert.equal(document.http.finalUrl, 'https://www.example.test/home');
    assert.equal(stdout.value().includes('captured body'), false);
  });

  test('accepts stdin and quiet mode still performs the probe', async () => {
    let probes = 0;
    const stdout = capture();
    const code = await runCli(['http', '--quiet'], {
      stdout: stdout.stream,
      stderr: capture().stream,
      readStdin: async () => 'example.test',
      normalizeAuditDomain: (value) => value,
      fetchHomepage: async () => { probes++; return homepageProbe(); },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(probes, 1);
    assert.equal(stdout.value(), '');
  });

  test('invalid and missing domains are usage errors without network work', async () => {
    let probes = 0;
    const dependencies = {
      stdout: capture().stream,
      stderr: capture().stream,
      normalizeAuditDomain: () => null,
      fetchHomepage: async () => { probes++; return homepageProbe(); },
    };
    assert.equal(await runCli(['http', 'invalid'], dependencies), EXIT_CODES.USAGE);
    assert.equal(await runCli(['http'], { ...dependencies, readStdin: async () => '' }), EXIT_CODES.USAGE);
    assert.equal(probes, 0);
  });

  test('probe failures are bounded on stderr with the lookup-failure exit code', async () => {
    const stderr = capture();
    const code = await runCli(['http', 'example.test'], {
      stdout: capture().stream,
      stderr: stderr.stream,
      normalizeAuditDomain: (value) => value,
      fetchHomepage: async () => { throw new Error(`probe failed\n${'x'.repeat(500)}`); },
    });
    assert.equal(code, EXIT_CODES.LOOKUP_FAILED);
    assert.match(stderr.value(), /^HTTP probe failed: probe failed /);
    assert.ok(stderr.value().length < 360);
  });
});
