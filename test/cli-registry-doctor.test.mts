import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { REGISTRY_DOCTOR_VERSION, buildRegistryDoctorReport } from '../cli/registry-doctor.mts';

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
    const report = buildRegistryDoctorReport(lookup('example.com'), NOW);
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

  test('normalizes registry event dates deterministically before lifecycle comparison', () => {
    const base = JSON.parse(lookup('dates.dev'));
    base.rdap.parsed.events = [{ action: 'registration', date: '2020-01-01T12:00:00' }];
    base.rdap.parsed.lifecycle = { createdDateIso: '2020-01-01T12:00:00.000Z' };
    const publication = buildRegistryDoctorReport(JSON.stringify(base), NOW).publication;
    assert.equal(publication.events.state, 'observed');
    assert.deepEqual(publication.events.conflictingActions, []);

    base.rdap.parsed.events = [{ action: 'registration', date: 'not a registry date' }];
    const malformed = buildRegistryDoctorReport(JSON.stringify(base), NOW).publication;
    assert.equal(malformed.events.state, 'inconsistent');
    assert.deepEqual(malformed.events.conflictingActions, ['registration']);

    base.rdap.parsed.events = [
      { action: 'registration', date: '2020-01-01T12:00:00.000Z' },
      { action: 'last changed', date: '2021-01-01T12:00:00.000Z' },
    ];
    base.rdap.parsed.lifecycle = {
      createdDateIso: 'not a registry date',
      updatedDateIso: '2021-01-01T12:00:00.000Z',
    };
    const malformedLifecycle = buildRegistryDoctorReport(JSON.stringify(base), NOW).publication;
    assert.equal(malformedLifecycle.events.state, 'unavailable');
    assert.deepEqual(malformedLifecycle.events.conflictingActions, []);
    assert.equal(malformedLifecycle.reviewItems, 1);
  });

  test('withholds conclusions when bounded RDAP publication families are incomplete', () => {
    const base = JSON.parse(lookup('bounded.dev'));
    base.rdap.parsed = {
      ...base.rdap.parsed,
      conformance: Array.from({ length: 101 }, (_, index) => `extension_${index}`),
      redactions: [],
      links: Array.from({ length: 101 }, (_, index) => ({ rel: index === 100 ? 'self' : 'alternate' })),
      events: Array.from({ length: 100 }, (_, index) => ({
        action: 'last changed',
        date: `2020-01-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
      })),
      lifecycle: { createdDateIso: '2020-01-01T00:00:00.000Z' },
    };
    base.rdap.parsed.events.push({ action: 'registration', date: '2020-01-01T00:00:00.000Z' });
    base.rdap.parsed.redactionsTruncated = true;
    const report = buildRegistryDoctorReport(JSON.stringify(base), NOW);
    assert.equal(report.version, REGISTRY_DOCTOR_VERSION);
    assert.equal(report.publication.baseConformance.state, 'unavailable');
    assert.equal(report.publication.baseConformance.truncated, true);
    assert.equal(report.publication.redactionMetadata.state, 'unavailable');
    assert.equal(report.publication.redactionMetadata.truncated, true);
    assert.equal(report.publication.selfLink.state, 'unavailable');
    assert.equal(report.publication.selfLink.truncated, true);
    assert.equal(report.publication.events.state, 'unavailable');
    assert.equal(report.publication.events.truncated, true);
    assert.deepEqual(report.publication.events.conflictingActions, []);
    assert.match(report.limitations.join(' '), /omitted values remain unavailable/iu);
  });

  test('propagates producer truncation flags even when retained arrays are short', () => {
    const base = JSON.parse(lookup('flags.dev'));
    Object.assign(base.rdap.parsed, {
      conformance: [],
      conformanceTruncated: true,
      links: [],
      linksTruncated: true,
      events: [],
      eventsTruncated: true,
      redactions: [],
      redactionsTruncated: true,
    });
    const publication = buildRegistryDoctorReport(JSON.stringify(base), NOW).publication;
    assert.equal(publication.baseConformance.state, 'unavailable');
    assert.equal(publication.selfLink.state, 'unavailable');
    assert.equal(publication.events.state, 'unavailable');
    assert.equal(publication.redactionMetadata.state, 'unavailable');
  });
});
