import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildCliLookupBrief, formatCliLookupBrief } from '../cli/lookup-brief.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';

const NOW = '2026-08-05T02:00:00.000Z';

function lookup() {
  return {
    schema: 'whoisleuth.cli.lookup', version: 1, generatedAt: NOW, mode: 'deep', query: 'example.test', type: 'domain', registrableDomain: 'example.test',
    diagnostics: { rdap: { status: 'success', observedAt: NOW }, whois: { status: 'partial', observedAt: NOW } },
    rdap: { parsed: { registrar: { name: 'Example Registrar' }, lifecycle: { createdIso: '2024-01-02T00:00:00Z' } } },
    whois: { parsed: {} },
    availability: { state: 'registered', activityStatus: 'active', pageTitle: 'Example service', dns: { status: 'success' }, http: { status: 'success' }, tls: { status: 'unavailable' } },
  };
}

describe('CLI Lookup brief', () => {
  test('separates facts from incomplete sources without copying raw evidence', () => {
    const brief = buildCliLookupBrief(JSON.stringify({ ...lookup(), rawWhois: 'private raw value' }), NOW);
    assert.equal(brief.target, 'example.test');
    assert.ok(brief.facts.some((item) => item.label === 'Registrar' && item.value === 'Example Registrar'));
    assert.ok(brief.unknowns.includes('whois: partial'));
    assert.ok(brief.unknowns.includes('tls: unavailable'));
    assert.ok(brief.actionPlan.every((item) => item.expectedOutcome.length > 20));
    assert.match(brief.actionPlan.find((item) => item.id === 'source-state-review')?.expectedOutcome ?? '', /transient|persistent/u);
    assert.doesNotMatch(JSON.stringify(brief), /private raw value/u);
    assert.match(formatCliLookupBrief(brief), /Recommended manual actions/u);
  });

  test('routes the offline command without collecting', async () => {
    let stdout = '';
    let collected = false;
    const code = await runCli(['brief', '--json'], {
      stdout: { write(value) { stdout += value; } }, stderr: { write() {} }, now: () => NOW,
      readArtifactInput: async () => JSON.stringify(lookup()),
      runUnifiedLookup: async () => { collected = true; return {}; },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(collected, false);
    assert.equal(JSON.parse(stdout).schema, 'whoisleuth.cli.lookup-brief');
  });
});
