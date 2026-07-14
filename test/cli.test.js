'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Readable, Writable } = require('node:stream');

const { parseCliArguments } = require('../cli/arguments');
const EXIT_CODES = require('../cli/exit-codes');
const { buildCliLookupDocument } = require('../cli/formatters/json');
const { formatTerminalLookup, safeTerminalValue } = require('../cli/formatters/terminal');
const { MAX_STDIN_BYTES, readStdinBounded, runCli } = require('../cli/runner');

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

describe('CLI argument parsing', () => {
  test('defaults lookup to fast terminal output', () => {
    assert.deepEqual(parseCliArguments(['lookup', 'example.com']), { action: 'lookup', query: 'example.com', output: 'terminal', deep: false, quiet: false, color: true });
  });

  test('accepts explicit deep JSON output and bounded stdin mode', () => {
    assert.deepEqual(parseCliArguments(['lookup', '--deep', '--json', '--no-color']), { action: 'lookup', query: null, output: 'json', deep: true, quiet: false, color: false });
  });

  test('rejects unknown commands, options, conflicting modes, and multiple queries', () => {
    assert.throws(() => parseCliArguments(['bulk', 'x']), /Unknown command/);
    assert.throws(() => parseCliArguments(['lookup', '--wat']), /Unknown option/);
    assert.throws(() => parseCliArguments(['lookup', '--deep', '--fast']), /mutually exclusive/);
    assert.throws(() => parseCliArguments(['lookup', '--fast', '--deep']), /mutually exclusive/);
    assert.throws(() => parseCliArguments(['lookup', '--fast', '--fast']), /only once/);
    assert.throws(() => parseCliArguments(['lookup', 'one.com', 'two.com']), /one query/);
    assert.throws(() => parseCliArguments(['lookup', 'x', '--json', '--quiet']), /cannot be combined/);
  });

  test('help and version actions never require a command', () => {
    assert.deepEqual(parseCliArguments([]), { action: 'help' });
    assert.deepEqual(parseCliArguments(['lookup', '--help']), { action: 'help' });
    assert.deepEqual(parseCliArguments(['--version']), { action: 'version' });
  });
});

describe('bounded CLI stdin', () => {
  test('reads one trimmed query', async () => {
    assert.equal(await readStdinBounded(Readable.from(['  example.com\n'])), 'example.com');
  });

  test('rejects multiple queries and oversized input before lookup', async () => {
    await assert.rejects(readStdinBounded(Readable.from(['one.com\ntwo.com\n'])), /one stdin query/);
    await assert.rejects(readStdinBounded(Readable.from(['x'.repeat(MAX_STDIN_BYTES + 1)])), /limited to/);
  });
});

describe('CLI lookup runner', () => {
  test('reuses classification and unified lookup with fast mode by default', async () => {
    const stdout = capture();
    const stderr = capture();
    let options;
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
    let options;
    const code = await runCli(['lookup', '--deep'], {
      stdout: stdout.stream,
      stderr: capture().stream,
      readStdin: async () => 'AS13335',
      classifyQuery: () => ({ type: 'asn', value: 'AS13335' }),
      runUnifiedLookup: async (_classified, received) => { options = received; return lookupResult({ availability: { applicable: false, type: 'asn' }, diagnostics: { rdap: { status: 'success' }, whois: { status: 'complete' } } }); },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.deepEqual(options, { fast: false, compact: false });
    assert.match(stdout.value(), /Type\s+asn/);
    assert.match(stdout.value(), /Mode\s+Deep/);
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
  const document = buildCliLookupDocument('example.com', { type: 'domain', value: 'example.com', registrableDomain: 'example.com' }, lookupResult(), '2026-07-14T00:00:00.000Z');
  const terminal = formatTerminalLookup(document);
  assert.match(terminal, /Availability\s+Registered/);
  assert.match(terminal, /RDAP\s+Success/);
  assert.match(terminal, /WHOIS\s+Skipped/);
  assert.equal(document.generatedAt, '2026-07-14T00:00:00.000Z');
});

test('terminal values strip controls and stay bounded', () => {
  const result = safeTerminalValue(`hello\nworld\u0000${'x'.repeat(500)}`);
  assert.doesNotMatch(result, /[\x00-\x1f\x7f]/);
  assert.ok(result.length <= 240);
});

test('package metadata exposes an executable local CLI entry point', () => {
  const root = path.join(__dirname, '..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.deepEqual(packageJson.bin, { whoisleuth: 'bin/whoisleuth.js' });
  const mode = fs.statSync(path.join(root, packageJson.bin.whoisleuth)).mode;
  assert.notEqual(mode & 0o111, 0);
  const result = spawnSync(process.execPath, [path.join(root, packageJson.bin.whoisleuth), '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /WHOISleuth CLI/);
  assert.equal(result.stderr, '');
});
