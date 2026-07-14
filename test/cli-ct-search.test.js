'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { Writable } = require('node:stream');

const { parseCliArguments } = require('../cli/arguments');
const EXIT_CODES = require('../cli/exit-codes');
const { buildCliCtSearchDocument } = require('../cli/formatters/json');
const {
  MAX_CT_TERMINAL_HOSTNAMES,
  MAX_CT_TERMINAL_MATCHES,
  formatTerminalCtSearch,
} = require('../cli/formatters/terminal');
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

function ctResult(overrides = {}) {
  return {
    domains: ['login.example.test', 'secure.example.test'],
    certCount: 3,
    truncated: false,
    matches: [{
      domain: 'example.test',
      hostnames: ['login.example.test', 'secure.example.test'],
      firstObservedAt: '2026-07-01T00:00:00.000Z',
      lastObservedAt: '2026-07-14T00:00:00.000Z',
      certificateCount: 2,
    }],
    observation: {
      version: 1,
      status: 'success',
      source: 'certificate_transparency',
      observedAt: '2026-07-14T00:00:01.000Z',
      complete: true,
      truncated: false,
    },
    ...overrides,
  };
}

describe('ct-search CLI argument parsing', () => {
  test('accepts one quoted keyword with terminal defaults', () => {
    assert.deepEqual(parseCliArguments(['ct-search', 'example brand']), {
      action: 'ct-search',
      keyword: 'example brand',
      output: 'terminal',
      quiet: false,
      color: true,
    });
  });

  test('accepts stdin mode and JSON output', () => {
    assert.deepEqual(parseCliArguments(['ct-search', '--json', '--no-color']), {
      action: 'ct-search',
      keyword: null,
      output: 'json',
      quiet: false,
      color: false,
    });
  });

  test('rejects repeated output flags, multiple keywords, and unrelated scan options', () => {
    assert.throws(() => parseCliArguments(['ct-search', 'one', 'two']), /one keyword/);
    assert.throws(() => parseCliArguments(['ct-search', '--json', '--json']), /only once/);
    assert.throws(() => parseCliArguments(['ct-search', '--deep']), /Unknown option/);
    assert.throws(() => parseCliArguments(['ct-search', '--json', '--quiet']), /cannot be combined/);
  });
});

describe('ct-search output', () => {
  test('builds a versioned machine document without changing the shared result', () => {
    const result = ctResult({ schema: 'upstream-value', version: 999, keyword: 'upstream-value' });
    const before = structuredClone(result);
    const document = buildCliCtSearchDocument('example brand', result, '2026-07-14T00:00:00.000Z');
    assert.equal(document.schema, 'whoisleuth.cli.ct-search');
    assert.equal(document.version, 1);
    assert.equal(document.generatedAt, '2026-07-14T00:00:00.000Z');
    assert.equal(document.keyword, 'example brand');
    assert.deepEqual(document.matches, result.matches);
    assert.deepEqual(result, before);
  });

  test('terminal output exposes provenance and completeness', () => {
    const output = formatTerminalCtSearch(buildCliCtSearchDocument('example', ctResult()));
    assert.match(output, /Keyword\s+example/);
    assert.match(output, /CT status\s+Success/);
    assert.match(output, /Certificates\s+3/);
    assert.match(output, /example\.test/);
    assert.match(output, /login\.example\.test, secure\.example\.test/);
    assert.match(output, /2026-07-01T00:00:00\.000Z → 2026-07-14T00:00:00\.000Z/);
  });

  test('terminal-only display caps are explicit while machine results remain complete', () => {
    const hostnames = Array.from({ length: MAX_CT_TERMINAL_HOSTNAMES + 2 }, (_, index) => `host-${index}.example.test`);
    const matches = Array.from({ length: MAX_CT_TERMINAL_MATCHES + 1 }, (_, index) => ({
      domain: `example-${index}.test`,
      hostnames,
      firstObservedAt: null,
      lastObservedAt: null,
      certificateCount: 1,
    }));
    const document = buildCliCtSearchDocument('example', ctResult({ matches }));
    const output = formatTerminalCtSearch(document);
    assert.match(output, /\(\+2 more\)/);
    assert.match(output, /Showing 100 of 101 structured matches/);
    assert.equal(document.matches.length, 101);
    assert.equal(document.matches[0].hostnames.length, 7);
  });

  test('empty structured results remain an explicit successful state', () => {
    const output = formatTerminalCtSearch(buildCliCtSearchDocument('empty', ctResult({ domains: [], certCount: 0, matches: [] })));
    assert.match(output, /Certificates\s+0/);
    assert.match(output, /No structured registrable-domain matches/);
  });
});

describe('ct-search runner', () => {
  test('reuses the shared search function and emits its bounded result as JSON', async () => {
    const stdout = capture();
    const stderr = capture();
    let receivedKeyword;
    const code = await runCli(['ct-search', 'example brand', '--json'], {
      stdout: stdout.stream,
      stderr: stderr.stream,
      now: () => '2026-07-14T00:00:00.000Z',
      searchCertificateTransparency: async (keyword) => {
        receivedKeyword = keyword;
        return ctResult();
      },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(receivedKeyword, 'example brand');
    assert.equal(stderr.value(), '');
    const document = JSON.parse(stdout.value());
    assert.equal(document.schema, 'whoisleuth.cli.ct-search');
    assert.equal(document.observation.source, 'certificate_transparency');
  });

  test('accepts one stdin keyword and quiet mode still performs the search', async () => {
    const stdout = capture();
    let searches = 0;
    const code = await runCli(['ct-search', '--quiet'], {
      stdout: stdout.stream,
      stderr: capture().stream,
      readStdin: async () => 'example brand',
      searchCertificateTransparency: async () => {
        searches++;
        return ctResult();
      },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(searches, 1);
    assert.equal(stdout.value(), '');
  });

  test('missing input is a usage error and never starts a search', async () => {
    const stderr = capture();
    let called = false;
    const code = await runCli(['ct-search'], {
      stdout: capture().stream,
      stderr: stderr.stream,
      readStdin: async () => '',
      searchCertificateTransparency: async () => { called = true; },
    });
    assert.equal(code, EXIT_CODES.USAGE);
    assert.equal(called, false);
    assert.match(stderr.value(), /^Usage error:/);
  });

  test('upstream failures are bounded on stderr and use the lookup-failure exit code', async () => {
    const stderr = capture();
    const code = await runCli(['ct-search', 'example'], {
      stdout: capture().stream,
      stderr: stderr.stream,
      searchCertificateTransparency: async () => { throw new Error(`overloaded\n${'x'.repeat(500)}`); },
    });
    assert.equal(code, EXIT_CODES.LOOKUP_FAILED);
    assert.match(stderr.value(), /^Certificate Transparency search failed: overloaded /);
    assert.ok(stderr.value().length < 360);
  });
});
