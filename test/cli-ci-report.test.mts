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
