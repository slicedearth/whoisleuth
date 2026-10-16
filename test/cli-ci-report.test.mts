import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildPostureSarif, formatCliJunit } from '../cli/ci-report.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';

describe('redacted CLI CI formats', () => {
  test('emits target-free JUnit cases from source states', () => {
    const output = formatCliJunit({
      schema: 'whoisleuth.cli.lookup',
      query: 'sensitive.example',
      diagnostics: { rdap: { status: 'success' }, whois: { status: 'partial', endpoint: 'whois.sensitive.example' } },
    });
    assert.match(output, /tests="2" failures="1"/u);
    assert.match(output, /name="source whois"/u);
    assert.doesNotMatch(output, /sensitive\.example|endpoint/iu);
  });

  test('does not turn diagnostic metadata into failed source checks', () => {
    const output = formatCliJunit({
      schema: 'whoisleuth.cli.lookup',
      diagnostics: {
        version: 8,
        timing: { version: 1, totalMs: 120, sources: [{ source: 'rdap', outcome: 'fulfilled', durationMs: 120, completedAfterMs: 120 }] },
        registryAccess: { suffix: 'test', limitation: 'Private context omitted.' },
        rdap: { status: 'success' }, whois: { status: 'skipped' },
      },
    });
    assert.match(output, /tests="2" failures="0"/u);
    assert.doesNotMatch(output, /source (?:version|timing|registryAccess)|Private context/u);
  });

  test('reports nested registrar and additional failures without copying diagnostic paths', () => {
    const output = formatCliJunit({
      schema: 'whoisleuth.cli.lookup',
      diagnostics: {
        rdap: { status: 'success', registrar: { status: 'unavailable', endpoint: 'private.example' } },
        whois: { status: 'partial' },
        reverseDns: { status: 'unsupported' },
        network: { status: 'not_applicable' },
        securityTxt: { status: 'skipped' },
        registrar: { status: 'failed' },
        providers: [{ 'private.example': { state: 'timeout', detail: 'private diagnostic' } }],
      },
    });
    assert.match(output, /tests="7" failures="3"/u);
    assert.match(output, /name="source registrar_rdap"><failure message="Source state: unavailable"/u);
    assert.match(output, /name="source whois"><failure message="Source state: partial"/u);
    assert.match(output, /name="additional source diagnostics"><failure message="Source states: failed, timeout"/u);
    assert.doesNotMatch(output, /private|endpoint|providers/u);
  });

  test('keeps present unusable sources incomplete beside another valid source', async () => {
    for (const rdap of [{}, null, { status: 'private.invalid' }, { status: null }]) {
      const diagnostics = { rdap, whois: { status: 'skipped' } };
      const formatted = formatCliJunit({ schema: 'whoisleuth.cli.lookup', diagnostics });
      assert.match(formatted, /tests="2" failures="1"/u);
      assert.match(formatted, /name="source rdap"><failure message="Source state: unavailable"/u);
      assert.doesNotMatch(formatted, /private\.invalid/u);
      let output = '';
      const code = await runCli(['lookup', 'example.test', '--junit'], {
        stdout: { write(value) { output += value; } }, stderr: { write() {} },
        runUnifiedLookup: async () => ({
          rdap: { parsed: {} }, diagnostics,
          availability: { state: 'registered' },
        }),
      });
      // Required RDAP/WHOIS diagnostics are validated before the real writer.
      assert.equal(code, EXIT_CODES.LOOKUP_FAILED);
      assert.equal(output, '');
    }
  });

  test('the normal Lookup command retains present unusable optional diagnostic sources', async () => {
    for (const optional of [
      { network: null }, { network: {} }, { network: { status: 'private.invalid' } },
      { rdap: { status: 'success', registrar: {} } },
      { rdap: { status: 'success', registrar: null } },
      { rdap: { status: 'success', registrar: { status: 'private.invalid' } } },
    ]) {
      let output = '';
      const code = await runCli(['lookup', 'example.test', '--junit'], {
        stdout: { write(value) { output += value; } }, stderr: { write() {} },
        runUnifiedLookup: async () => ({
          rdap: { parsed: {} },
          diagnostics: { rdap: { status: 'success' }, whois: { status: 'skipped' }, ...optional },
          availability: { state: 'registered' },
        }),
      });
      assert.equal(code, EXIT_CODES.SUCCESS);
      assert.match(output, /tests="3" failures="1"/u);
      assert.match(output, /name="source (?:network_context|registrar_rdap)"><failure message="Source state: unavailable"/u);
      assert.doesNotMatch(output, /private\.invalid/u);
    }
  });

  test('distinguishes missing optional sources from present unusable nested diagnostics', () => {
    for (const registrar of [{}, null, { status: 'unknown' }]) {
      const output = formatCliJunit({ schema: 'whoisleuth.cli.lookup', diagnostics: {
        rdap: { status: 'success', registrar }, whois: { status: 'skipped' },
      } });
      assert.match(output, /tests="3" failures="1"/u);
      assert.match(output, /name="source registrar_rdap"><failure message="Source state: unavailable"/u);
      assert.doesNotMatch(output, /source (?:reverse_dns|network_context|security_txt|sslbl)/u);
    }
    const absent = formatCliJunit({ schema: 'whoisleuth.cli.lookup', diagnostics: { rdap: { status: 'success' } } });
    assert.match(absent, /tests="1" failures="0"/u);
    assert.doesNotMatch(absent, /name="source (?:registrar_rdap|whois|reverse_dns|network_context|security_txt|sslbl)"/u);
  });

  test('ignores failed attempt metadata but keeps missing and bounded diagnostics incomplete', () => {
    const success = formatCliJunit({ schema: 'whoisleuth.cli.lookup', diagnostics: {
      rdap: { status: 'success', attempts: [{ outcome: 'failed' }, { outcome: 'success' }] },
    } });
    assert.match(success, /tests="1" failures="0"/u);
    for (const diagnostics of [undefined, {}, { version: 8 }, { rdap: { status: 'unknown' } }]) {
      assert.match(formatCliJunit({ schema: 'whoisleuth.cli.lookup', diagnostics }), /failures="1"/u);
    }
    const oversized = { rdap: { status: 'success' }, nested: Array.from({ length: 100 }, () => Array.from({ length: 100 }, () => ({}))) };
    assert.match(formatCliJunit({ schema: 'whoisleuth.cli.lookup', diagnostics: oversized }), /Source states: partial/u);
  });

  test('emits bounded owned-domain SARIF without DNS records or contact data', () => {
    const sarif = buildPostureSarif({
      schema: 'whoisleuth.cli.posture', generatedAt: '2026-08-05T07:00:00Z', domain: 'sensitive.example',
      checks: [
        { id: 'dmarc', label: 'DMARC', status: 'danger', summary: 'No enforcement policy', remediation: 'Publish an enforcement policy.', records: ['private record'] },
        { id: 'spf', label: 'SPF', status: 'pass', summary: 'Configured', records: ['private pass record'] },
      ],
    });
    assert.equal(sarif.version, '2.1.0');
    assert.equal(sarif.runs[0]?.results.length, 1);
    const encoded = JSON.stringify(sarif);
    assert.doesNotMatch(encoded, /sensitive\.example|private record|private pass record/iu);
    assert.match(encoded, /No enforcement policy/u);
  });

  test('routes JUnit and guarded SARIF through normal commands', async () => {
    let junit = '';
    const lookupCode = await runCli(['lookup', 'example.test', '--junit'], {
      stdout: { write(value) { junit += value; } }, stderr: { write() {} },
      runUnifiedLookup: async () => ({
        rdap: { parsed: {} },
        diagnostics: { rdap: { status: 'success' }, whois: { status: 'skipped' } },
        availability: { state: 'registered' },
      }),
    });
    assert.equal(lookupCode, EXIT_CODES.SUCCESS);
    assert.match(junit, /^<\?xml/u);

    let sarifOutput = '';
    const postureCode = await runCli(['posture', 'example.test', '--sarif', '--owned-domain'], {
      stdout: { write(value) { sarifOutput += value; } }, stderr: { write() {} },
      normalizeAuditDomain: () => 'example.test', normalizeDkimSelectors: () => [],
      checkDomainPosture: async () => ({ checks: [{ id: 'dmarc', label: 'DMARC', status: 'warning', summary: 'Review policy', remediation: '' }], summary: {} }),
    });
    assert.equal(postureCode, EXIT_CODES.SUCCESS);
    assert.equal(JSON.parse(sarifOutput).version, '2.1.0');
  });
});
