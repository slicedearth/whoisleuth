import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createCase, normalizeCaseStore } from '../frontend/src/lib/analysis/case-model.ts';
import {
  MAX_EXTERNAL_INTELLIGENCE_TREE_DEPTH,
  assertExternalIntelligenceTreeBounds,
  mergeExternalIntelligenceIntoCase,
  parseExternalIntelligenceDocument,
} from '../frontend/src/lib/analysis/external-intelligence-import.ts';

const DIGEST = 'a'.repeat(64);
const NOW = '2026-07-29T02:00:00.000Z';
const OBSERVED = '2026-07-28T01:00:00.000Z';

function stixBundle(objects: unknown[]) {
  return {
    type: 'bundle',
    id: 'bundle--00000000-0000-4000-8000-000000000001',
    objects,
  };
}

function stixObjects() {
  return [
    {
      type: 'identity',
      spec_version: '2.1',
      id: 'identity--00000000-0000-4000-8000-000000000002',
      name: 'External review team',
    },
    {
      type: 'marking-definition',
      spec_version: '2.1',
      id: 'marking-definition--00000000-0000-4000-8000-000000000003',
      definition_type: 'tlp',
      definition: { tlp: 'amber' },
    },
    {
      type: 'domain-name',
      spec_version: '2.1',
      id: 'domain-name--00000000-0000-4000-8000-000000000004',
      value: 'Candidate.Invalid',
    },
    {
      type: 'observed-data',
      spec_version: '2.1',
      id: 'observed-data--00000000-0000-4000-8000-000000000005',
      first_observed: OBSERVED,
      last_observed: OBSERVED,
      object_refs: ['domain-name--00000000-0000-4000-8000-000000000004'],
    },
    {
      type: 'indicator',
      spec_version: '2.1',
      id: 'indicator--00000000-0000-4000-8000-000000000006',
      created_by_ref: 'identity--00000000-0000-4000-8000-000000000002',
      pattern_type: 'stix',
      pattern: "[domain-name:value = 'candidate.invalid']",
      valid_from: OBSERVED,
      confidence: 72,
      labels: ['review', 'phishing'],
      object_marking_refs: ['marking-definition--00000000-0000-4000-8000-000000000003'],
    },
    {
      type: 'autonomous-system',
      spec_version: '2.1',
      id: 'autonomous-system--00000000-0000-4000-8000-000000000007',
      number: 64_496,
    },
    {
      type: 'malware',
      spec_version: '2.1',
      id: 'malware--00000000-0000-4000-8000-000000000008',
      name: 'Unsupported object',
    },
  ];
}

function mispEvent() {
  return {
    Event: {
      uuid: '00000000-0000-4000-8000-000000000010',
      info: 'Imported defensive review',
      distribution: '0',
      Orgc: { name: 'External MISP publisher' },
      Tag: [{ name: 'tlp:amber' }],
      Attribute: [
        {
          uuid: '00000000-0000-4000-8000-000000000011',
          type: 'hostname',
          value: 'Host.Candidate.Invalid',
          first_seen: OBSERVED,
          distribution: '5',
          Tag: [{ name: 'confidence:medium' }],
        },
        {
          uuid: '00000000-0000-4000-8000-000000000012',
          type: 'ip-dst',
          value: '192.0.2.25',
          timestamp: '1785200400',
        },
        {
          uuid: '00000000-0000-4000-8000-000000000013',
          type: 'email-src',
          value: 'not-retained@candidate.invalid',
        },
      ],
    },
  };
}

describe('bounded STIX and MISP import preview', () => {
  test('rejects zone-less protocol timestamps while preserving explicit offsets and epochs', () => {
    const zoneLessObjects = stixObjects().map((item) => (
      (item as Record<string, unknown>).type === 'observed-data'
        ? { ...item, first_observed: '2026-01-15T12:00:00.000', last_observed: '2026-01-15T12:00:00.000' }
        : item
    ));
    assert.throws(
      () => parseExternalIntelligenceDocument(stixBundle(zoneLessObjects), DIGEST),
      /explicit timezone/u,
    );

    const offsetObjects = stixObjects().map((item) => (
      (item as Record<string, unknown>).type === 'observed-data'
        ? { ...item, first_observed: '2026-01-15T12:00:00.000+01:00', last_observed: '2026-01-15T12:00:00.000+01:00' }
        : item
    ));
    const offset = parseExternalIntelligenceDocument(stixBundle(offsetObjects), DIGEST);
    assert.equal(
      offset.items.find((item) => item.entityType === 'domain' && item.claimType === 'observable')?.observedAt,
      '2026-01-15T11:00:00.000Z',
    );

    const misp = parseExternalIntelligenceDocument(mispEvent(), DIGEST);
    assert.equal(misp.items.find((item) => item.entityType === 'ipv4')?.createdAt, '2026-07-28T01:00:00.000Z');
    const malformedMisp = mispEvent();
    (malformedMisp.Event.Attribute[0] as Record<string, unknown>).first_seen = '2026-01-15T12:00:00.000';
    assert.throws(() => parseExternalIntelligenceDocument(malformedMisp, DIGEST), /explicit timezone/u);
  });

  test('normalizes supported STIX entities while preserving markings and publisher metadata', () => {
    const preview = parseExternalIntelligenceDocument(stixBundle(stixObjects()), DIGEST);
    assert.equal(preview.format, 'stix');
    assert.equal(preview.items.length, 3);
    assert.equal(preview.exclusions.length, 1);
    assert.equal(preview.items.find((item) => item.claimType === 'observable' && item.entityType === 'domain')?.observedAt, OBSERVED);
    const indicator = preview.items.find((item) => item.claimType === 'indicator');
    assert.equal(indicator?.entityValue, 'candidate.invalid');
    assert.equal(indicator?.publisher, 'External review team');
    assert.equal(indicator?.confidence, 72);
    assert.deepEqual(indicator?.labels, ['phishing', 'review']);
    assert.deepEqual(indicator?.markings, ['TLP:AMBER']);
    assert.equal(preview.items.find((item) => item.entityType === 'asn')?.entityValue, 'AS64496');
  });

  test('normalizes a bounded MISP subset and lists unsupported attributes without retaining their values', () => {
    const preview = parseExternalIntelligenceDocument(mispEvent(), DIGEST);
    assert.equal(preview.format, 'misp');
    assert.equal(preview.sourceName, 'Imported defensive review');
    assert.equal(preview.publisher, 'External MISP publisher');
    assert.deepEqual(preview.items.map((item) => item.entityValue), ['host.candidate.invalid', '192.0.2.25']);
    assert.equal(preview.exclusions.length, 1);
    assert.equal(preview.exclusions[0]?.type, 'email-src');
    assert.doesNotMatch(JSON.stringify(preview.exclusions), /not-retained/u);
  });

  test('reports duplicate and conflicting identifiers before merge', () => {
    const domain = stixObjects()[2] as Record<string, unknown>;
    const duplicate = { ...domain };
    const conflict = { ...domain, value: 'other.invalid' };
    const preview = parseExternalIntelligenceDocument(stixBundle([domain, duplicate, conflict]), DIGEST);
    assert.equal(preview.items.length, 0);
    assert.equal(preview.conflicts.length, 3);
  });

  test('rejects future STIX versions, missing digests, and excessive nesting', () => {
    assert.throws(() => parseExternalIntelligenceDocument(stixBundle([{
      type: 'domain-name',
      spec_version: '2.2',
      id: 'domain-name--00000000-0000-4000-8000-000000000020',
      value: 'candidate.invalid',
    }]), DIGEST), /STIX 2.1/u);
    assert.throws(() => parseExternalIntelligenceDocument(mispEvent(), 'bad'), /SHA-256 digest/u);
    let nested: unknown = 'leaf';
    for (let index = 0; index <= MAX_EXTERNAL_INTELLIGENCE_TREE_DEPTH; index += 1) nested = { child: nested };
    assert.throws(() => assertExternalIntelligenceTreeBounds(nested), /nested too deeply/u);
  });

  test('rejects retained Unicode formatting controls in STIX and MISP provenance', () => {
    for (const unsafe of ['\u202e', '\u2060']) {
      const stixPublisher = structuredClone(stixObjects());
      (stixPublisher[0] as Record<string, unknown>).name = `External${unsafe}publisher`;
      assert.throws(
        () => parseExternalIntelligenceDocument(stixBundle(stixPublisher), DIGEST),
        /unsafe control or formatting/iu,
      );

      const mispSource = structuredClone(mispEvent());
      mispSource.Event.info = `Imported${unsafe}review`;
      assert.throws(
        () => parseExternalIntelligenceDocument(mispSource, DIGEST),
        /unsafe control or formatting/iu,
      );

      const mispDistribution = structuredClone(mispEvent());
      mispDistribution.Event.Attribute[0]!.distribution = `5${unsafe}`;
      assert.throws(
        () => parseExternalIntelligenceDocument(mispDistribution, DIGEST),
        /unsafe control or formatting/iu,
      );
    }
  });
});

describe('external intelligence case merge', () => {
  test('adds separately attributed assertions only to an existing selected case', () => {
    const current = createCase({
      domain: 'case.invalid',
      status: 'reviewing',
      disposition: 'suspicious',
      source: 'manual',
    }, NOW);
    const preview = parseExternalIntelligenceDocument(mispEvent(), DIGEST);
    const merged = mergeExternalIntelligenceIntoCase([current], current.id, preview, NOW);
    assert.equal(merged.assertionsAdded, 2);
    assert.equal(merged.record.domain, 'case.invalid');
    assert.equal(merged.record.status, 'reviewing');
    assert.equal(merged.record.disposition, 'suspicious');
    assert.equal(merged.record.evidenceHistory.length, 0);
    assert.equal(merged.record.evidencePins.length, 0);
    assert.equal(merged.record.assertions[0]?.kind, 'unknown');
    assert.equal(merged.record.assertions[0]?.provenance?.origin, 'external_import');
    assert.equal(merged.record.assertions[0]?.provenance?.sourceDigestSha256, DIGEST);
    assert.match(merged.record.assertions[0]?.rationale ?? '', /did not collect or independently verify/u);
    const restored = normalizeCaseStore(merged.cases).cases[0];
    assert.equal(restored?.assertions[0]?.provenance?.entityValue, 'host.candidate.invalid');
    assert.deepEqual(restored?.assertions[0]?.provenance?.labels, ['confidence:medium', 'tlp:amber']);
  });

  test('is idempotent and never creates a case for a missing selection', () => {
    const current = createCase({ domain: 'case.invalid', source: 'manual' }, NOW);
    const preview = parseExternalIntelligenceDocument(mispEvent(), DIGEST);
    const first = mergeExternalIntelligenceIntoCase([current], current.id, preview, NOW);
    const second = mergeExternalIntelligenceIntoCase(first.cases, current.id, preview, NOW);
    assert.equal(second.assertionsAdded, 0);
    assert.equal(second.duplicatesSkipped, 2);
    assert.equal(second.cases.length, 1);
    assert.throws(() => mergeExternalIntelligenceIntoCase([], current.id, preview, NOW), /no longer exists/u);
  });
});
