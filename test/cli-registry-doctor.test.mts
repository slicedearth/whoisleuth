import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildRegistryDoctorReport } from '../cli/registry-doctor.mts';

const NOW = '2026-08-04T00:00:00.000Z';

function lookup(domain: string, whoisStatus = 'skipped'): string {
  return JSON.stringify({
    schema: 'whoisleuth.cli.lookup',
    version: 1,
    generatedAt: NOW,
    mode: 'deep',
    query: domain,
    type: 'domain',
    registrableDomain: domain,
    rdap: { parsed: { domain: domain.toUpperCase(), handle: 'D-1' } },
    whois: { skipped: true },
    diagnostics: {
      rdap: { status: 'success' },
      whois: { status: whoisStatus },
    },
  });
}

describe('registry doctor', () => {
  test('recognizes an expected RDAP-only registry constraint', () => {
    const report = buildRegistryDoctorReport(lookup('registry-only.dev'), NOW);
    assert.equal(report.sources.find((source) => source.source === 'rdap')?.alignment, 'observed');
    assert.equal(report.sources.find((source) => source.source === 'whois')?.alignment, 'expected_constraint');
    assert.equal(report.summary.investigate, 0);
  });

  test('flags an allowed source that was skipped without converting the result to absence', () => {
    const report = buildRegistryDoctorReport(lookup('generic.example.com'), NOW);
    assert.equal(report.sources.find((source) => source.source === 'whois')?.alignment, 'investigate');
    assert.ok(report.summary.investigate > 0);
    assert.match(report.limitations.join(' '), /does not prove live reachability/u);
  });

  test('keeps a missing registry object identifier as not observed', () => {
    const report = buildRegistryDoctorReport(JSON.stringify({
      ...JSON.parse(lookup('identifier.dev')),
      rdap: { parsed: { domain: 'IDENTIFIER.DEV' } },
    }), NOW);
    assert.equal(report.sources.find((source) => source.source === 'rdap')?.objectIdentifier, 'not_observed');
    assert.match(report.recommendations.join(' '), /valid publication omission/u);
  });
});
