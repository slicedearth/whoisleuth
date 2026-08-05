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
    rdap: { parsed: {
      domain: domain.toUpperCase(),
      handle: 'D-1',
      objectClassName: 'domain',
      conformance: ['rdap_level_0', 'redacted_0'],
      redactions: [{ name: 'Registrant email', method: 'removal' }],
      links: [{ rel: 'self', href: 'https://rdap.example.invalid/domain/example.invalid' }],
      events: [{ action: 'registration', date: '2020-01-01T00:00:00.000Z' }],
      lifecycle: { createdDateIso: '2020-01-01T00:00:00.000Z' },
    } },
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
    assert.equal(report.publication.objectClass.state, 'observed');
    assert.equal(report.publication.baseConformance.state, 'observed');
    assert.equal(report.publication.redactionMetadata.count, 1);
    assert.equal(report.publication.selfLink.state, 'observed');
    assert.equal(report.publication.mediaType.state, 'unavailable');
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

  test('keeps missing publication elements distinct from a collection failure', () => {
    const report = buildRegistryDoctorReport(JSON.stringify({
      ...JSON.parse(lookup('publication.dev')),
      rdap: { parsed: { domain: 'PUBLICATION.DEV', objectClassName: 'autnum', events: [
        { action: 'registration', date: '2020-01-01T00:00:00.000Z' },
        { action: 'registration', date: '2021-01-01T00:00:00.000Z' },
      ], lifecycle: { createdDateIso: '2022-01-01T00:00:00.000Z' } } },
    }), NOW);
    assert.equal(report.publication.objectClass.state, 'inconsistent');
    assert.equal(report.publication.baseConformance.state, 'not_observed');
    assert.equal(report.publication.selfLink.state, 'not_observed');
    assert.equal(report.publication.events.state, 'inconsistent');
    assert.equal(report.publication.reviewItems, 4);
  });
});
