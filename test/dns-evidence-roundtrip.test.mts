import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyOfflineArtifact } from '../cli/artifact-verify.mts';
import { formatTerminalLookup } from '../cli/formatters/terminal-lookup.mts';
import { buildLookupEvidence } from '../lib/evidence-export.mts';
import { buildLookupEvidenceReport } from '../lib/evidence-report.mts';
import { buildLookupDnsDisplay } from '../frontend/src/lib/analysis/lookup-dns-display.ts';
import { parseLookupEvidenceReplay } from '../frontend/src/lib/analysis/lookup-evidence-replay.ts';
import { buildLookupReplayCheckpointFacts, checkpointPinInputs } from '../frontend/src/lib/analysis/case-evidence-checkpoint.ts';
import { buildCaseExport, createCase, mergeCases } from '../packages/cases/case-model.mts';

test('DNS family outcomes survive export, offline verification, replay and Case portability', async () => {
  const observedAt = '2026-09-01T00:00:00.000Z';
  for (const [detail, status, expected, complete] of [
    ['empty_answer', 'not_found', 'No records returned', true],
    ['no_data', 'not_found', 'No data for this record type (NODATA)', true],
    ['name_not_found', 'not_found', 'Name not found by resolver', true],
    ['timeout', 'error', 'DNS query timed out', false],
    [undefined, 'not_found', 'Negative DNS outcome not recorded', false],
  ] as const) {
    const dns = { version: 1, source: 'dns', status: 'partial', complete: false, observedAt,
      records: { a: [], aaaa: ['2001:db8::1'] }, diagnostics: {
        a: { status, ...(detail ? { detail } : {}), truncated: false, discarded: 0 },
        aaaa: { status: 'success', detail: 'records', truncated: false, discarded: 0 },
        mx: { status: 'error' },
      } };
    const result = { query: 'example.test', type: 'domain', mode: 'deep', inputHostname: 'example.test',
      registrableDomain: 'example.test', rdap: { parsed: { domain: 'example.test' } },
      whois: { parsed: {}, chain: [] }, diagnostics: { rdap: { status: 'success' }, whois: { status: 'skipped' } },
      availability: { applicable: true, domain: 'example.test', state: 'registered', confidence: 'high', dns } };
    const exported = buildLookupEvidence(result, { generatedAt: observedAt });
    const serialized = JSON.stringify(exported);
    assert.equal((await verifyOfflineArtifact(serialized)).state, 'structure_valid');
    const replay = await parseLookupEvidenceReplay(serialized);
    const facts = buildLookupReplayCheckpointFacts(replay);
    const ipv4 = facts.find(fact => fact.field === 'dns.a')!;
    const ipv6 = facts.find(fact => fact.field === 'dns.aaaa')!;
    assert.equal(ipv4.value, expected);
    assert.equal(ipv4.completeness === 'complete', complete);
    assert.equal(ipv6.value, '2001:db8::1');
    assert.equal(ipv6.completeness, 'complete');
    assert.equal(ipv4.observedAt, observedAt);
    const created = createCase({ domain: 'example.test',
      evidencePins: checkpointPinInputs(facts, ['dns.a', 'dns.aaaa']) }, observedAt);
    const imported = mergeCases([], buildCaseExport([created], observedAt)).cases[0]!;
    assert.deepEqual(imported.evidencePins, created.evidencePins);
    assert.equal(imported.evidencePins.length, 2);
    const display = buildLookupDnsDisplay({ availability: result.availability, dnsEvidence: dns,
      dnsRecords: dns.records, reverseDns: {}, reverseDnsRecords: {} });
    assert.equal(display.dnsRows.find(row => row.label === 'A')?.value, expected);
    assert.equal(display.dnsRows.find(row => row.label === 'AAAA')?.value, '2001:db8::1');
    assert.ok(formatTerminalLookup(result).includes(expected));
    assert.equal(buildLookupEvidenceReport(exported).networkGroups.find(group => group.title === 'DNS and mail')?.fields.find(field => field.label === 'A address result')?.value, expected);
    assert.equal(exported.analysis.availability?.state, 'registered');
  }
});
