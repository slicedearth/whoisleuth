'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { Writable } = require('node:stream');

const { parseCliArguments } = require('../cli/arguments.mts');
const EXIT_CODES = require('../cli/exit-codes.mts').default;
const { buildCliPostureDocument } = require('../cli/formatters/json.mts');
const { MAX_POSTURE_TERMINAL_RECORDS, formatTerminalPosture } = require('../cli/formatters/terminal.mts');
const { MAX_POSTURE_SELECTORS, normalizePostureSelectors } = require('../cli/posture.mts');
const { runCli } = require('../cli/runner.mts');
const { normalizeDkimSelectors } = require('../lib/domain-posture.mts');

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

function postureReport(overrides = {}) {
  return {
    domain: 'example.test',
    checkedAt: '2026-07-14T01:00:00.000Z',
    dkimSelectors: ['selector1'],
    summary: { pass: 1, warning: 1, danger: 1, info: 1 },
    checks: [
      { id: 'spf', label: 'SPF', status: 'pass', summary: 'Restrictive policy', detail: '', records: ['v=spf1 -all'], remediation: '' },
      { id: 'dmarc', label: 'DMARC', status: 'danger', summary: 'No policy', detail: 'No record returned.', records: [], remediation: 'Publish a policy.' },
    ],
    ...overrides,
  };
}

describe('posture CLI argument parsing', () => {
  test('accepts terminal defaults and optional selectors', () => {
    assert.deepEqual(parseCliArguments(['posture', 'example.test']), {
      action: 'posture', domain: 'example.test', output: 'terminal', quiet: false, color: true, selectorText: null,
    });
    assert.deepEqual(parseCliArguments(['posture', 'example.test', '--selectors', 'one,two', '--json', '--no-color']), {
      action: 'posture', domain: 'example.test', output: 'json', quiet: false, color: false, selectorText: 'one,two',
    });
  });

  test('accepts stdin mode and quiet terminal execution', () => {
    assert.deepEqual(parseCliArguments(['posture', '--quiet']), {
      action: 'posture', domain: null, output: 'terminal', quiet: true, color: true, selectorText: null,
    });
  });

  test('rejects repeated flags, multiple domains, and unrelated options', () => {
    assert.throws(() => parseCliArguments(['posture', 'one.test', 'two.test']), /one domain/);
    assert.throws(() => parseCliArguments(['posture', 'one.test', '--json', '--json']), /only once/);
    assert.throws(() => parseCliArguments(['posture', 'one.test', '--selectors', 'one', '--selectors', 'two']), /only once/);
    assert.throws(() => parseCliArguments(['posture', 'one.test', '--selectors']), /requires/);
    assert.throws(() => parseCliArguments(['posture', 'one.test', '--deep']), /Unknown option/);
    assert.throws(() => parseCliArguments(['posture', 'one.test', '--json', '--quiet']), /cannot be combined/);
  });
});

describe('posture selector validation', () => {
  test('normalizes and deduplicates selectors with the canonical helper', () => {
    assert.deepEqual(
      normalizePostureSelectors(' Selector1,selector1,.mail.2026. ', normalizeDkimSelectors),
      ['selector1', 'mail.2026']
    );
  });

  test('rejects empty, malformed, and over-limit selector lists without silently dropping entries', () => {
    assert.throws(() => normalizePostureSelectors('one,,two', normalizeDkimSelectors), /empty/);
    assert.throws(() => normalizePostureSelectors('valid,-invalid', normalizeDkimSelectors), /invalid/);
    const tooMany = Array.from({ length: MAX_POSTURE_SELECTORS + 1 }, (_, index) => `selector${index}`).join(',');
    assert.throws(() => normalizePostureSelectors(tooMany, normalizeDkimSelectors), /at most 10/);
  });

  test('returns an empty list when no selector option was supplied', () => {
    assert.deepEqual(normalizePostureSelectors(null, normalizeDkimSelectors), []);
  });
});

describe('posture output', () => {
  test('builds a versioned machine document without mutating the report or accepting schema overrides', () => {
    const report = postureReport({ schema: 'untrusted', version: 99, generatedAt: 'untrusted' });
    const before = structuredClone(report);
    const document = buildCliPostureDocument('EXAMPLE.test', report, '2026-07-14T02:00:00.000Z');
    assert.equal(document.schema, 'whoisleuth.cli.posture');
    assert.equal(document.version, 1);
    assert.equal(document.generatedAt, '2026-07-14T02:00:00.000Z');
    assert.equal(document.requestedDomain, 'EXAMPLE.test');
    assert.equal(document.domain, 'example.test');
    assert.deepEqual(report, before);
  });

  test('terminal output presents summary, checks, evidence, and remediation', () => {
    const output = formatTerminalPosture(buildCliPostureDocument('example.test', postureReport()));
    assert.match(output, /Domain\s+example\.test/);
    assert.match(output, /1 action · 1 review · 1 pass · 1 info/);
    assert.match(output, /\[PASS\] SPF — Restrictive policy/);
    assert.match(output, /Record\s+v=spf1 -all/);
    assert.match(output, /\[DANGER\] DMARC — No policy/);
    assert.match(output, /Next\s+Publish a policy/);
  });

  test('terminal-only record caps are explicit and do not alter the machine report', () => {
    const records = Array.from({ length: MAX_POSTURE_TERMINAL_RECORDS + 2 }, (_, index) => `record-${index}`);
    const document = buildCliPostureDocument('example.test', postureReport({
      checks: [{ id: 'spf', label: 'SPF', status: 'pass', summary: 'Configured', records }],
    }));
    const output = formatTerminalPosture(document);
    assert.match(output, /2 more omitted/);
    assert.doesNotMatch(output, /record-6/);
    assert.equal(document.checks[0].records.length, MAX_POSTURE_TERMINAL_RECORDS + 2);
  });

  test('terminal output sanitizes upstream control characters and handles an empty check list', () => {
    const output = formatTerminalPosture(postureReport({ domain: 'bad\nvalue.test', checks: [] }));
    assert.match(output, /Domain\s+bad value\.test/);
    assert.match(output, /No posture checks were returned/);
  });
});

describe('posture runner', () => {
  test('normalizes the domain and selectors before calling the shared audit', async () => {
    const stdout = capture();
    let received;
    const code = await runCli(['posture', 'EXAMPLE.test.', '--selectors', 'Selector1,.mail.2026.', '--json'], {
      stdout: stdout.stream,
      stderr: capture().stream,
      now: () => '2026-07-14T02:00:00.000Z',
      normalizeAuditDomain: () => 'example.test',
      normalizeDkimSelectors,
      checkDomainPosture: async (domain, options) => {
        received = { domain, options };
        return postureReport({ domain, dkimSelectors: options.dkimSelectors });
      },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.deepEqual(received, { domain: 'example.test', options: { dkimSelectors: ['selector1', 'mail.2026'] } });
    const document = JSON.parse(stdout.value());
    assert.equal(document.schema, 'whoisleuth.cli.posture');
    assert.equal(document.requestedDomain, 'EXAMPLE.test.');
    assert.deepEqual(document.dkimSelectors, ['selector1', 'mail.2026']);
  });

  test('accepts one stdin domain and quiet mode still performs the audit', async () => {
    let audits = 0;
    const stdout = capture();
    const code = await runCli(['posture', '--quiet'], {
      stdout: stdout.stream,
      stderr: capture().stream,
      readStdin: async () => 'example.test',
      normalizeAuditDomain: (value) => value,
      checkDomainPosture: async () => { audits++; return postureReport(); },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(audits, 1);
    assert.equal(stdout.value(), '');
  });

  test('invalid or missing domains are usage errors and never start an audit', async () => {
    let audits = 0;
    const dependencies = {
      stdout: capture().stream,
      stderr: capture().stream,
      normalizeAuditDomain: () => null,
      checkDomainPosture: async () => { audits++; return postureReport(); },
    };
    assert.equal(await runCli(['posture', 'invalid'], dependencies), EXIT_CODES.USAGE);
    assert.equal(await runCli(['posture'], { ...dependencies, readStdin: async () => '' }), EXIT_CODES.USAGE);
    assert.equal(audits, 0);
  });

  test('audit failures are bounded on stderr and use the lookup-failure exit code', async () => {
    const stderr = capture();
    const code = await runCli(['posture', 'example.test'], {
      stdout: capture().stream,
      stderr: stderr.stream,
      normalizeAuditDomain: (value) => value,
      checkDomainPosture: async () => { throw new Error(`resolver failed\n${'x'.repeat(500)}`); },
    });
    assert.equal(code, EXIT_CODES.LOOKUP_FAILED);
    assert.match(stderr.value(), /^Domain posture audit failed: resolver failed /);
    assert.ok(stderr.value().length < 360);
  });
});
