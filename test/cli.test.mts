import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable, Writable } from 'node:stream';

import { parseCliArguments } from '../cli/arguments.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { buildCliLookupDocument } from '../cli/formatters/json.mts';
import { formatTerminalLookup, safeTerminalValue } from '../cli/formatters/terminal.mts';
import { MAX_STDIN_BYTES, readStdinBounded, runCli } from '../cli/runner.mts';
import type { ClassifiedQuery } from '../lib/classify.mts';
import type { LookupSourceSettlement } from '../lib/lookup.mts';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function capture() {
  let value = '';
  return { stream: new Writable({ write(chunk, _encoding, callback) { value += chunk.toString(); callback(); } }), value: () => value };
}

function lookupResult(overrides = {}) {
  return {
    rdap: { parsed: { domain: 'EXAMPLE.COM' } },
    whois: { skipped: true, detail: 'WHOIS is omitted in fast mode.' },
    availability: { applicable: true, domain: 'example.com', state: 'registered', confidence: 'high' },
    diagnostics: { version: 4, rdap: { status: 'success', endpoint: 'https://rdap.invalid/domain/example.com' }, whois: { status: 'skipped' }, availability: { status: 'complete' } },
    ...overrides,
  };
}

function classifiedDomain(value: string, inputHostname = value): ClassifiedQuery {
  return {
    type: 'domain',
    value,
    inputHostname,
    registrableDomain: value,
    isSubdomain: inputHostname !== value,
  };
}

describe('CLI argument parsing', () => {
  test('defaults lookup to fast terminal output', () => {
    assert.deepEqual(parseCliArguments(['lookup', 'example.com']), { action: 'lookup', query: 'example.com', output: 'terminal', deep: false, detail: 'standard', strictExit: false, events: false, plan: false, observerLabel: null, vantageLabel: null, quiet: false, color: true });
  });

  test('accepts explicit deep JSON output and bounded stdin mode', () => {
    assert.deepEqual(parseCliArguments(['lookup', '--deep', '--json', '--no-color']), { action: 'lookup', query: null, output: 'json', deep: true, detail: 'standard', strictExit: false, events: false, plan: false, observerLabel: null, vantageLabel: null, quiet: false, color: false });
  });

  test('rejects unknown commands, options, conflicting modes, and multiple queries', () => {
    assert.throws(() => parseCliArguments(['unknown', 'x']), /Unknown command/);
    assert.throws(() => parseCliArguments(['lookup', '--wat']), /Unknown option/);
    assert.throws(() => parseCliArguments(['lookup', '--deep', '--fast']), /mutually exclusive/);
    assert.throws(() => parseCliArguments(['lookup', '--fast', '--deep']), /mutually exclusive/);
    assert.throws(() => parseCliArguments(['lookup', '--fast', '--fast']), /only once/);
    assert.throws(() => parseCliArguments(['lookup', 'one.com', 'two.com']), /one query/);
    assert.throws(() => parseCliArguments(['lookup', 'x', '--json', '--quiet']), /cannot be combined/);
    assert.throws(() => parseCliArguments(['lookup', 'x', '--summary', '--verbose']), /mutually exclusive/);
    assert.throws(() => parseCliArguments(['lookup', 'x', '--summary', '--json']), /terminal output/);
  });

  test('parses terminal detail, completion, and offline-first doctor options', () => {
    assert.deepEqual(parseCliArguments(['lookup', 'example.test', '--summary']), {
      action: 'lookup',
      query: 'example.test',
      output: 'terminal',
      deep: false,
      detail: 'summary',
      strictExit: false,
      events: false,
      plan: false,
      observerLabel: null,
      vantageLabel: null,
      quiet: false,
      color: true,
    });
    assert.deepEqual(parseCliArguments(['lookup', 'example.test', '--verbose']), {
      action: 'lookup',
      query: 'example.test',
      output: 'terminal',
      deep: false,
      detail: 'verbose',
      strictExit: false,
      events: false,
      plan: false,
      observerLabel: null,
      vantageLabel: null,
      quiet: false,
      color: true,
    });
    assert.deepEqual(parseCliArguments(['completion', 'zsh']), { action: 'completion', shell: 'zsh' });
    assert.deepEqual(parseCliArguments(['completion', 'powershell']), { action: 'completion', shell: 'powershell' });
    assert.deepEqual(parseCliArguments(['doctor']), {
      action: 'doctor', network: false, output: 'terminal', quiet: false, color: true,
    });
    assert.deepEqual(parseCliArguments(['doctor', '--network', '--json']), {
      action: 'doctor', network: true, output: 'json', quiet: false, color: true,
    });
    assert.deepEqual(parseCliArguments(['commands', '--json']), {
      action: 'commands', output: 'json', quiet: false, color: true,
    });
    assert.throws(() => parseCliArguments(['completion', 'nushell']), /bash, zsh, fish, or powershell/u);
    assert.throws(() => parseCliArguments(['doctor', '--network', '--network']), /only once/u);
    assert.throws(() => parseCliArguments(['lookup', 'example.test', '--plan', '--events']), /cannot be combined/u);
  });

  test('help and version actions never require a command', () => {
    assert.deepEqual(parseCliArguments([]), { action: 'help' });
    assert.deepEqual(parseCliArguments(['lookup', '--help']), { action: 'help', command: 'lookup' });
    assert.deepEqual(parseCliArguments(['registry-support', '-h']), { action: 'help', command: 'registry-support' });
    assert.throws(() => parseCliArguments(['lookup', 'example.com', '--help']), /Help accepts/);
    assert.deepEqual(parseCliArguments(['--version']), { action: 'version' });
  });

  test('help groups workflows and gives each command a purpose, example, and boundary', async () => {
    const stdout = capture();
    const stderr = capture();
    assert.equal(await runCli([], { stdout: stdout.stream, stderr: stderr.stream }), EXIT_CODES.SUCCESS);
    assert.match(stdout.value(), /Investigate:\n/u);
    assert.match(stdout.value(), /Discover:\n/u);
    assert.match(stdout.value(), /Review saved evidence:\n/u);
    assert.match(stdout.value(), /Fast lookup is the default/u);
    assert.equal(stderr.value(), '');

    const commandStdout = capture();
    assert.equal(await runCli(['lookup', '--help'], { stdout: commandStdout.stream, stderr: stderr.stream }), EXIT_CODES.SUCCESS);
    assert.match(commandStdout.value(), /Collect registration evidence for one domain, IP, or ASN\./u);
    assert.match(commandStdout.value(), /Example:\n  whoisleuth lookup example\.test --deep/u);
    assert.match(commandStdout.value(), /Collection:\n  Network: Accepts one target\./u);
    assert.match(commandStdout.value(), /Boundary:\n  Fast is the default\./u);
    assert.doesNotMatch(commandStdout.value(), /whoisleuth bulk/u);
    assert.equal(stderr.value(), '');
  });

  test('prints a versioned command catalogue for local tooling', async () => {
    const stdout = capture();
    const stderr = capture();
    const code = await runCli(['commands', '--json'], { stdout: stdout.stream, stderr: stderr.stream });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(stderr.value(), '');
    const catalogue = JSON.parse(stdout.value());
    assert.equal(catalogue.schema, 'whoisleuth.cli.command-catalogue');
    assert.equal(catalogue.version, 1);
    assert.ok(catalogue.commands.length >= 25);
    const lookup = catalogue.commands.find((entry: { command: string }) => entry.command === 'lookup');
    assert.equal(lookup.collection.mode, 'network');
    assert.match(lookup.usage, /--plan/u);
    assert.match(lookup.boundary, /Fast is the default/u);
  });

  test('parses bounded offline artifact verification inputs', () => {
    assert.deepEqual(parseCliArguments([
      'verify-artifact',
      'workspace.json',
      '--passphrase-file',
      'passphrase.txt',
      '--json',
      '--no-color',
    ]), {
      action: 'verify-artifact',
      source: 'workspace.json',
      passphraseSource: 'passphrase.txt',
      output: 'json',
      quiet: false,
      color: false,
    });
    assert.throws(
      () => parseCliArguments(['verify-artifact', '--passphrase-file']),
      /requires one bounded UTF-8 file/u,
    );
    assert.throws(
      () => parseCliArguments(['verify-artifact', 'one.json', 'two.json']),
      /accepts one optional JSON file/u,
    );
  });

  test('parses redacted archive inspection and explicit evidence-signing inputs', () => {
    assert.deepEqual(parseCliArguments([
      'inspect-archive',
      'workspace.json',
      '--passphrase-file',
      'passphrase.txt',
      '--search',
      'review-target.invalid',
      '--reveal',
      '--json',
    ]), {
      action: 'inspect-archive',
      source: 'workspace.json',
      passphraseSource: 'passphrase.txt',
      search: 'review-target.invalid',
      reveal: true,
      requireMatch: false,
      output: 'json',
      quiet: false,
      color: true,
    });
    assert.deepEqual(parseCliArguments([
      'sign-artifact',
      'review.json',
      '--private-key-file',
      'private.pem',
    ]), {
      action: 'sign-artifact',
      source: 'review.json',
      privateKeySource: 'private.pem',
    });
    assert.deepEqual(parseCliArguments([
      'verify-signature',
      'signed.json',
      '--public-key-file',
      'public.pem',
      '--json',
    ]), {
      action: 'verify-signature',
      source: 'signed.json',
      publicKeySource: 'public.pem',
      output: 'json',
      quiet: false,
      color: true,
    });
    assert.throws(() => parseCliArguments(['inspect-archive', '--reveal']), /requires --search/iu);
    assert.throws(() => parseCliArguments(['inspect-archive', '--require-match']), /requires --search/iu);
    assert.throws(() => parseCliArguments(['sign-artifact']), /requires --private-key-file/iu);
  });

  test('parses privacy-safe source reliability report inputs', () => {
    assert.deepEqual(parseCliArguments([
      'source-report',
      'lookups.json',
      '--json',
    ]), {
      action: 'source-report',
      source: 'lookups.json',
      output: 'json',
      quiet: false,
      color: true,
    });
    assert.throws(
      () => parseCliArguments(['source-report', 'one.json', 'two.json']),
      /accepts one optional JSON file/u,
    );
  });
});

describe('bounded CLI stdin', () => {
  test('reads one trimmed query', async () => {
    assert.equal(await readStdinBounded(Readable.from(['  example.com\n'])), 'example.com');
  });

  test('rejects multiple queries and oversized input before lookup', async () => {
    await assert.rejects(readStdinBounded(Readable.from(['one.com\ntwo.com\n'])), /one stdin line/);
    await assert.rejects(readStdinBounded(Readable.from(['x'.repeat(MAX_STDIN_BYTES + 1)])), /limited to/);
  });
});

describe('CLI lookup runner', () => {
  test('reuses classification and unified lookup with fast mode by default', async () => {
    const stdout = capture();
    const stderr = capture();
    let options: {
      fast?: boolean;
      compact?: boolean;
      onSourceSettled?: (settlement: LookupSourceSettlement) => void;
    } | undefined;
    const code = await runCli(['lookup', 'login.example.com', '--json'], {
      stdout: stdout.stream,
      stderr: stderr.stream,
      now: () => '2026-07-14T00:00:00.000Z',
      classifyQuery: () => ({ type: 'domain', value: 'example.com', inputHostname: 'login.example.com', registrableDomain: 'example.com', isSubdomain: true }),
      runUnifiedLookup: async (_classified, received) => { options = received; return lookupResult(); },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.deepEqual(options, { fast: true, compact: false });
    assert.equal(stderr.value(), '');
    const output = JSON.parse(stdout.value());
    assert.equal(output.schema, 'whoisleuth.cli.lookup');
    assert.equal(output.version, 1);
    assert.equal(output.mode, 'fast');
    assert.equal(output.inputHostname, 'login.example.com');
    assert.equal(output.registrableDomain, 'example.com');
  });

  test('deep mode is explicit and stdin can provide the one query', async () => {
    const stdout = capture();
    let lookupCalled = false;
    const code = await runCli(['lookup', '--deep'], {
      stdout: stdout.stream,
      stderr: capture().stream,
      readStdin: async () => 'AS13335',
      classifyQuery: () => ({ type: 'asn', value: 'AS13335' }),
      runUnifiedLookup: async (_classified, received) => {
        lookupCalled = true;
        assert.equal(received?.fast, false);
        assert.equal(received?.compact, false);
        assert.equal(typeof received?.onSourceSettled, 'function');
        return lookupResult({ availability: { applicable: false, type: 'asn' }, diagnostics: { rdap: { status: 'success' }, whois: { status: 'complete' } } });
      },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(lookupCalled, true);
    assert.match(stdout.value(), /Type\s+asn/);
    assert.match(stdout.value(), /Mode\s+Deep/);
  });

  test('lookup preflight makes no network request and preserves conditional disclosures', async () => {
    const stdout = capture();
    const stderr = capture();
    let lookupCalled = false;
    const code = await runCli(['lookup', 'login.example.test', '--deep', '--plan', '--json'], {
      stdout: stdout.stream,
      stderr: stderr.stream,
      runUnifiedLookup: async () => { lookupCalled = true; return {}; },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(lookupCalled, false);
    assert.equal(stderr.value(), '');
    const plan = JSON.parse(stdout.value());
    assert.equal(plan.schema, 'whoisleuth.cli.lookup-plan');
    assert.equal(plan.mode, 'deep');
    assert.equal(plan.target.normalized, 'example.test');
    assert.equal(plan.target.inputHostname, 'login.example.test');
    assert.equal(plan.planning.networkRequestsMade, false);
    assert.deepEqual(plan.planning.sources.map((source: { source: string }) => source.source), [
      'rdap', 'whois', 'domain_evidence', 'registrar_rdap', 'network_context',
    ]);
    assert.equal(plan.planning.sources.find((source: { source: string }) => source.source === 'registrar_rdap').conditional, true);
  });

  test('invalid input is a usage error and never calls lookup', async () => {
    const stderr = capture();
    let called = false;
    const code = await runCli(['lookup', 'not-a-domain'], { stdout: capture().stream, stderr: stderr.stream, runUnifiedLookup: async () => { called = true; } });
    assert.equal(code, EXIT_CODES.USAGE);
    assert.equal(called, false);
    assert.match(stderr.value(), /^Usage error:/);
  });

  test('upstream failure is bounded on stderr with a stable exit code', async () => {
    const stderr = capture();
    const code = await runCli(['lookup', 'example.com'], { stdout: capture().stream, stderr: stderr.stream, runUnifiedLookup: async () => { throw new Error(`upstream\n${'x'.repeat(500)}`); } });
    assert.equal(code, EXIT_CODES.LOOKUP_FAILED);
    assert.ok(stderr.value().length < 330);
    assert.doesNotMatch(stderr.value(), /\n.*\n/);
  });

  test('an upstream validation-sounding error is not misclassified as user input', async () => {
    const stderr = capture();
    const code = await runCli(['lookup', 'example.com'], { stdout: capture().stream, stderr: stderr.stream, runUnifiedLookup: async () => { throw new Error('upstream returned not a valid response'); } });
    assert.equal(code, EXIT_CODES.LOOKUP_FAILED);
    assert.match(stderr.value(), /^Lookup failed:/);
  });

  test('quiet output suppresses success text but not execution', async () => {
    const stdout = capture();
    const code = await runCli(['lookup', 'example.com', '--quiet'], { stdout: stdout.stream, stderr: capture().stream, runUnifiedLookup: async () => lookupResult() });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(stdout.value(), '');
  });
});

test('machine document and terminal formatter preserve explicit source states', () => {
  const document = buildCliLookupDocument('example.com', classifiedDomain('example.com'), lookupResult(), '2026-07-14T00:00:00.000Z');
  const terminal = formatTerminalLookup(document);
  assert.match(terminal, /Availability\s+Registered/);
  assert.match(terminal, /RDAP\s+Success/);
  assert.match(terminal, /WHOIS\s+Skipped/);
  assert.equal(document.generatedAt, '2026-07-14T00:00:00.000Z');
});

test('terminal lookup groups evidence and supports concise and diagnostic detail levels', () => {
  const document = buildCliLookupDocument(
    'example.test',
    classifiedDomain('example.test'),
    lookupResult({
      timing: {
        version: 1,
        totalMs: 120,
        sources: [{ source: 'rdap', outcome: 'fulfilled', durationMs: 40, completedAfterMs: 40 }],
      },
    }),
    '2026-07-14T00:00:00.000Z',
    'deep',
  );
  const standard = formatTerminalLookup(document);
  const summary = formatTerminalLookup(document, { detail: 'summary' });
  const verbose = formatTerminalLookup(document, { detail: 'verbose' });

  assert.match(standard, /^Target:\n/u);
  assert.match(standard, /\nRegistration:\n/u);
  assert.match(standard, /RDAP source\s+https:\/\/rdap\.invalid/u);
  assert.doesNotMatch(summary, /RDAP source|Generated|Total time/u);
  assert.match(verbose, /\nCollection:\n/u);
  assert.match(verbose, /Generated\s+2026-07-14T00:00:00\.000Z/u);
  assert.match(verbose, /Total time\s+120 ms/u);
  assert.match(verbose, /rdap Fulfilled · 40 ms/u);
});

test('terminal lookup separately attributes represented registrar RDAP diagnostics', () => {
  const result = lookupResult({
    rdap: {
      parsed: { domain: 'EXAMPLE.COM' },
      registrarRdap: {
        status: 'success',
        data: { privateMarker: 'raw-registrar-payload' },
        parsed: { entities: [{ contact: 'private-contact-marker' }] },
      },
    },
    diagnostics: {
      version: 4,
      rdap: {
        status: 'success',
        endpoint: 'https://registry.invalid/domain/example.com',
        registrar: {
          status: 'success',
          endpoint: 'https://registrar.invalid/domain/example.com',
        },
      },
      whois: { status: 'success' },
      availability: { status: 'complete' },
    },
  });
  const document = buildCliLookupDocument('example.com', classifiedDomain('example.com'), result, '2026-07-14T00:00:00.000Z', 'deep');
  const terminal = formatTerminalLookup(document);

  assert.match(terminal, /Registrar RDAP Success/);
  assert.match(terminal, /Registrar source https:\/\/registrar\.invalid\/domain\/example\.com/);
  assert.doesNotMatch(terminal, /raw-registrar-payload|private-contact-marker/);
});

test('terminal lookup summarizes bounded registry interpretation without publishing contacts', () => {
  const result = lookupResult({
    registryInsights: {
      version: 1,
      lifecycle: { label: 'Redemption period' },
      contactDisclosure: {
        registryRdap: { state: 'privacy_proxy' },
        whois: { state: 'redacted' },
      },
      reconciliation: { state: 'source_specific' },
      publications: [
        { state: 'complete' },
        { state: 'partial' },
        { state: 'unavailable' },
      ],
      abuseRouting: [{ contact: 'private-routing-value@example.test' }],
    },
  });
  const document = buildCliLookupDocument('example.com', classifiedDomain('example.com'), result, '2026-07-14T00:00:00.000Z', 'deep');
  const terminal = formatTerminalLookup(document);

  assert.match(terminal, /Lifecycle\s+Redemption period/);
  assert.match(terminal, /Disclosure\s+RDAP Privacy proxy · WHOIS Redacted/);
  assert.match(terminal, /Reconciliation\s+Source specific/);
  assert.match(terminal, /Publications\s+1 complete · 1 partial · 1 unavailable/);
  assert.doesNotMatch(terminal, /private-routing-value/);
});

test('terminal lookup preserves registrar skip states and omits absent diagnostics', () => {
  const skipped = lookupResult({
    diagnostics: {
      version: 4,
      rdap: {
        status: 'success',
        endpoint: 'https://registry.invalid/domain/example.com',
        registrar: { status: 'skipped', endpoint: null },
      },
      whois: { status: 'skipped' },
      availability: { status: 'complete' },
    },
  });
  const skippedDocument = buildCliLookupDocument('example.com', classifiedDomain('example.com'), skipped, '2026-07-14T00:00:00.000Z');
  assert.match(formatTerminalLookup(skippedDocument), /Registrar RDAP Skipped/);

  const absentDocument = buildCliLookupDocument('AS65536', { type: 'asn', value: 'AS65536' }, lookupResult(), '2026-07-14T00:00:00.000Z');
  assert.doesNotMatch(formatTerminalLookup(absentDocument), /Registrar/);
});

test('terminal lookup presents bounded observed network registration context', () => {
  const result = lookupResult({
    networkContext: {
      contextVersion: 1,
      status: 'success',
      endpoint: { address: '93.184.216.34', family: 4, selectedFrom: 'tls_connection' },
      network: { name: 'Example edge network', holder: 'Example network holder' },
      rawContact: 'must-not-render@example.test',
    },
  });
  const document = buildCliLookupDocument('example.com', classifiedDomain('example.com'), result, '2026-07-14T00:00:00.000Z', 'deep');
  const terminal = formatTerminalLookup(document);

  assert.match(terminal, /Network RDAP\s+Success/);
  assert.match(terminal, /Selected IP\s+93\.184\.216\.34/);
  assert.match(terminal, /Network\s+Example edge network/);
  assert.doesNotMatch(terminal, /must-not-render/);
});

test('terminal deep IP lookup presents separately attributed reverse DNS names', () => {
  const result = lookupResult({
    reverseDns: {
      version: 1,
      status: 'success',
      source: 'reverse_dns',
      records: { ptr: ['edge.example.test', 'fallback.example.test'] },
      rawAnswer: 'must-not-render',
    },
  });
  const document = buildCliLookupDocument(
    '192.0.2.1',
    { type: 'ipv4', value: '192.0.2.1' },
    result,
    '2026-07-14T00:00:00.000Z',
    'deep',
  );
  const terminal = formatTerminalLookup(document);

  assert.match(terminal, /Reverse DNS\s+Success/);
  assert.match(terminal, /PTR names\s+edge\.example\.test, fallback\.example\.test/);
  assert.doesNotMatch(terminal, /must-not-render/);
});

test('terminal deep lookup summarizes current website evidence without exposing raw details', () => {
  const result = lookupResult({
    availability: {
      applicable: true,
      domain: 'example.com',
      state: 'registered',
      confidence: 'high',
      activityStatus: 'active',
      pageTitle: 'Example account portal',
      dns: { source: 'dns', status: 'partial', complete: false },
      http: {
        source: 'http',
        status: 'success',
        transportSecurity: 'https',
        response: { status: 200 },
      },
      tls: { source: 'tls', status: 'success', protocol: 'TLSv1.3' },
      credentialSurfaceProfile: {
        source: 'html',
        status: 'success',
        complete: true,
        forms: {
          count: 2,
          methods: { missing: 0, get: 1, post: 1, dialog: 0, other: 0 },
          actions: { sameOrigin: 1, external: 1, missing: 0, cleartext: 0, unclassified: 0 },
        },
        inputs: {
          count: 4,
          classifiedCount: 3,
          categories: { password: 1, email: 1, username: 1, one_time_code: 0, payment: 0 },
        },
        privateField: 'credential-private-marker-must-not-render',
      },
      structuredDataIdentity: {
        source: 'html',
        status: 'success',
        entities: [{
          types: ['Organization', 'WebSite'],
          name: 'Example publisher',
          declaredOrigin: 'https://example.com',
          sameAsHosts: ['social.example'],
          privateField: 'must-not-render',
        }],
      },
      technologyProfile: {
        source: 'derived',
        status: 'success',
        findings: [
          {
            name: 'Example Commerce',
            category: 'commerce platform',
            confidence: 'high',
            evidence: [{ description: 'private-marker-must-not-render' }],
          },
          { name: `Example Edge\n${'x'.repeat(500)}`, category: 'delivery platform', confidence: 'medium' },
        ],
        browserLibraryProfile: {
          profileVersion: 1,
          source: 'derived',
          status: 'success',
          findings: [
            { name: 'fixture library', apparentVersion: '1.2.3', advisoryCount: 1 },
            { name: 'fixture helper', apparentVersion: '2.0.0', advisoryCount: 0 },
          ],
        },
      },
      securityPosture: {
        source: 'derived',
        status: 'partial',
        summary: { observed: 3, potentialExposure: 1, observedAbsence: 2, unavailable: 1 },
        findings: [{ detail: 'private-posture-detail-must-not-render' }],
      },
    },
  });
  const document = buildCliLookupDocument(
    'example.com',
    classifiedDomain('example.com'),
    result,
    '2026-07-24T00:00:00.000Z',
    'deep',
  );
  const terminal = formatTerminalLookup(document);

  assert.match(terminal, /Web activity\s+Active/);
  assert.match(terminal, /Page title\s+Example account portal/);
  assert.match(terminal, /DNS evidence\s+Partial/);
  assert.match(terminal, /HTTP evidence\s+Success/);
  assert.match(terminal, /HTTP response\s+HTTP 200 · HTTPS/);
  assert.match(terminal, /TLS evidence\s+Success/);
  assert.match(terminal, /TLS protocol\s+TLSv1\.3/);
  assert.match(terminal, /Credential UI\s+Success · 3 classified inputs/);
  assert.match(terminal, /Form surface\s+2 forms · 4 inputs · 1 external action/);
  assert.match(terminal, /Input purposes\s+password 1 · email 1 · username 1/);
  assert.match(terminal, /Structured ID\s+Success · 1 declared entity/);
  assert.match(terminal, /Declarations\s+Example publisher \(Organization\/WebSite\)/);
  assert.match(terminal, /Technology\s+Success · 2 indicators/);
  assert.match(terminal, /Example Commerce \(commerce platform, high\)/);
  assert.match(terminal, /JS libraries\s+Success · 2 apparent · 1 with catalogue advisory match/);
  assert.match(terminal, /Posture\s+Partial/);
  assert.match(terminal, /Posture counts 3 observed · 1 potential exposure · 2 observed absence · 1 unavailable/);
  assert.doesNotMatch(terminal, /private-marker|private-posture-detail|credential-private-marker|must-not-render/);
  assert.doesNotMatch(terminal, /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/);
});

test('terminal lookup explains represented registry access constraints', () => {
  const restricted = lookupResult({
    diagnostics: {
      version: 5,
      registryAccess: {
        suffix: 'es',
        whoisAccessProfile: 'source-ip-authorization-required',
        rdapAccessProfile: 'no-iana-service',
        limitation: 'Registry collection requires documented source authorization.',
        authority: 'context_only',
      },
      rdap: { status: 'unsupported', endpoint: null },
      whois: { status: 'error' },
      availability: { status: 'complete' },
    },
  });
  const document = buildCliLookupDocument('restricted.invalid', classifiedDomain('restricted.invalid'), restricted, '2026-07-17T00:00:00.000Z', 'deep');
  const terminal = formatTerminalLookup(document);

  assert.match(terminal, /Registry access \.es/);
  assert.match(terminal, /WHOIS access\s+Source-IP authorisation required/);
  assert.match(terminal, /RDAP access\s+No service published by IANA/);
  assert.match(terminal, /Access note\s+Registry collection requires documented source authorization\./);
});

test('terminal registry access context remains bounded and absent by default', () => {
  const constrained = lookupResult({
    diagnostics: {
      version: 5,
      registryAccess: {
        suffix: 'zz\ninvalid',
        whoisAccessProfile: 'no-iana-service',
        rdapAccessProfile: 'no-iana-service',
        limitation: `No public machine service.\n${'x'.repeat(500)}`,
        authority: 'context_only',
      },
      rdap: { status: 'unsupported', endpoint: null },
      whois: { status: 'error' },
      availability: { status: 'complete' },
    },
  });
  const constrainedDocument = buildCliLookupDocument('unpublished.invalid', classifiedDomain('unpublished.invalid'), constrained, '2026-07-17T00:00:00.000Z', 'deep');
  const constrainedTerminal = formatTerminalLookup(constrainedDocument);
  const accessNote = constrainedTerminal.split('\n').find((line) => line.startsWith('Access note'));

  assert.doesNotMatch(constrainedTerminal, /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/);
  assert.ok(accessNote);
  assert.ok(accessNote.length <= 'Access note    '.length + 240);

  const ordinaryDocument = buildCliLookupDocument('example.com', classifiedDomain('example.com'), lookupResult(), '2026-07-17T00:00:00.000Z');
  assert.doesNotMatch(formatTerminalLookup(ordinaryDocument), /Registry access|WHOIS access|RDAP access|Access note/);
});

test('terminal values strip controls and stay bounded', () => {
  const result = safeTerminalValue(`hello\nworld\u0000${'x'.repeat(500)}`);
  assert.doesNotMatch(result, /[\x00-\x1f\x7f]/);
  assert.ok(result.length <= 240);
});

test('repository source exposes an executable local CLI entry point', () => {
  const root = path.join(__dirname, '..');
  const entryPoint = path.join(root, 'bin/whoisleuth.mts');
  const mode = fs.statSync(entryPoint).mode;
  assert.notEqual(mode & 0o111, 0);
  const result = spawnSync(process.execPath, [entryPoint, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /WHOISleuth CLI/);
  assert.match(result.stdout, /Copyright 2026 slicedearth/);
  assert.match(result.stdout, /Licensed under AGPL-3\.0-only/);
  assert.match(result.stdout, /Source and licence: https:\/\/github\.com\/slicedearth\/whoisleuth/);
  assert.equal(result.stderr, '');
});
