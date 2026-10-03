import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { createCase, normalizeCaseStore } from '../frontend/src/lib/analysis/case-model.ts';
import {
  MAX_EXTERNAL_INTELLIGENCE_TREE_DEPTH,
  assertExternalIntelligenceTreeBounds,
  mergeExternalIntelligenceIntoCase,
  parseExternalIntelligenceDocument,
  externalIntelligenceAssertionContent,
} from '../frontend/src/lib/analysis/external-intelligence-import.ts';

const DIGEST = 'a'.repeat(64);
const NOW = '2026-07-29T02:00:00.000Z';
const OBSERVED = '2026-07-28T01:00:00.000Z';

test('rejects an over-bound canonical URL instead of retaining a different shortened identity', () => {
  for (const count of [100, 200]) {
    const value = `https://example.test/${'ü'.repeat(count)}`;
    const preview = parseExternalIntelligenceDocument(stixBundle([{
      type: 'url', spec_version: '2.1', id: 'url--00000000-0000-4000-8000-000000000010', value,
    }]), DIGEST);
    if (count === 100) assert.equal(preview.items[0]?.entityValue, new URL(value).toString());
    else {
      assert.equal(preview.items.length, 0);
      assert.ok(preview.limitations.length > 0);
    }
  }
});

test('intelligence retention preview preserves source time and excludes generated save metadata', () => {
  const preview = parseExternalIntelligenceDocument(stixBundle(stixObjects()), DIGEST);
  const item = preview.items.find((value) => value.entityValue === 'candidate.invalid' && value.observedAt === OBSERVED);
  assert.ok(item);
  const content = externalIntelligenceAssertionContent(item, preview);
  assert.equal(content.provenance?.sourceDigestSha256, DIGEST);
  assert.equal(content.provenance?.observedAt, OBSERVED);
  assert.equal(content.kind, 'unknown');
  assert.equal(content.state, 'open');
  assert.deepEqual(content.evidencePinIds, []);
  assert.equal(Object.hasOwn(content, 'createdAt'), false);
  assert.equal(Object.hasOwn(content, 'id'), false);
  const target = createCase({ domain: 'candidate.invalid' }, NOW);
  const merged = mergeExternalIntelligenceIntoCase([target], target.id, { ...preview, items: [item] }, NOW);
  const { id: _id, createdAt: _created, updatedAt: _updated, ...saved } = merged.record.assertions[0]!;
  assert.deepEqual(saved, content);
});

test('source relationship inspection preserves references without importing unsupported semantics or descriptions', () => {
  const domain = { type: 'domain-name', spec_version: '2.1', id: 'domain-name--00000000-0000-4000-8000-000000000004', value: 'candidate.invalid' };
  const relation = { type: 'relationship', spec_version: '2.1', id: 'relationship--00000000-0000-4000-8000-000000000090',
    relationship_type: 'related-to', source_ref: domain.id, target_ref: 'infrastructure--00000000-0000-4000-8000-000000000091',
    created: NOW, modified: NOW, description: 'private-unimported-description', object_marking_refs: ['marking-definition--00000000-0000-4000-8000-000000000003'] };
  const input = stixBundle([domain, relation]);
  const before = structuredClone(input);
  const preview = parseExternalIntelligenceDocument(input, DIGEST);
  assert.equal(preview.items.length, 1);
  const row = preview.sourceInspection!.relationships[0]!;
  assert.equal(row.sourceState, 'Accepted claim');
  assert.equal(row.targetState, 'Referenced object not present');
  assert.equal(row.source, domain.id); assert.equal(row.target, relation.target_ref);
  assert.equal(row.createdAt, NOW); assert.deepEqual(row.markings, relation.object_marking_refs);
  const target = createCase({ domain: 'candidate.invalid' }, NOW);
  const merged = mergeExternalIntelligenceIntoCase([target], target.id, preview, NOW);
  assert.equal(merged.assertionsAdded, 1);
  assert.doesNotMatch(JSON.stringify(merged.record), /private-unimported-description|sourceInspection|related-to|infrastructure--/u);
  assert.deepEqual(input, before);
  const duplicate = parseExternalIntelligenceDocument(stixBundle([domain, { ...domain, value: 'other.invalid' }, relation]), DIGEST);
  assert.equal(duplicate.sourceInspection!.relationships[0]!.sourceState, 'Ambiguous repeated source identifier');
  assert.equal(duplicate.items.length, 0);
});

test('MISP object references remain inspection-only and report missing objects rather than constructing associations', () => {
  const input = mispEvent();
  const objectId = 'AAAAAAAA-0000-4000-8000-000000000091';
  const enriched = { Event: { ...input.Event, Object: [{ uuid: objectId, name: 'domain-ip', ObjectReference: [{
    uuid: 'aaaaaaaa-0000-4000-8000-000000000092', relationship_type: 'resolves-to',
    referenced_uuid: 'aaaaaaaa-0000-4000-8000-000000000093', timestamp: '1785376800', comment: 'private-reference-comment',
  }] }] } };
  const preview = parseExternalIntelligenceDocument(enriched, DIGEST);
  const row = preview.sourceInspection!.relationships[0]!;
  assert.equal(row.source, objectId.toLowerCase());
  assert.equal(row.sourceState, 'Source object not imported as a claim');
  assert.equal(row.targetState, 'Referenced object not present');
  assert.ok(preview.sourceInspection!.transformations.some(value => value.includes('not imported')));
  assert.doesNotMatch(JSON.stringify(preview), /private-reference-comment/u);
  assert.equal(preview.items.length, parseExternalIntelligenceDocument(input, DIGEST).items.length);
});

test('current interchange fixtures retain unknown observation times through the browser importer', () => {
  for (const format of ['stix', 'misp']) {
    const content = readFileSync(new URL(`./fixtures/extracted-domain-lifecycle/${format}-indicators-v2.json`, import.meta.url), 'utf8');
    const preview = parseExternalIntelligenceDocument(JSON.parse(content), DIGEST);
    const known = preview.items.filter((item) => item.entityValue === 'known.example');
    const unknown = preview.items.filter((item) => item.entityValue === 'unknown.example');
    assert.ok(known.length > 0);
    assert.ok(unknown.length > 0);
    assert.ok(known.some((item) => item.observedAt === '2026-08-31T12:00:00.000Z'));
    assert.ok(unknown.every((item) => item.observedAt === null));
  }
});

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

test('STIX publisher attribution requires an explicit producer and keeps observation time paired with it', () => {
  const target = { type: 'domain-name', spec_version: '2.1', id: 'domain-name--00000000-0000-4000-8000-000000000004', value: 'candidate.invalid' };
  const first = { type: 'identity', id: 'identity--00000000-0000-4000-8000-000000000002', name: 'First producer' };
  const second = { type: 'identity', id: 'identity--00000000-0000-4000-8000-000000000003', name: 'Second producer' };
  const observation = (time: string, creator: string | null) => ({ type: 'observed-data', id: 'observed-data--00000000-0000-4000-8000-000000000005', last_observed: time, created_by_ref: creator, object_refs: [target.id] });
  const preview = (objects: unknown[]) => parseExternalIntelligenceDocument(stixBundle(objects), DIGEST);
  const unbound = preview([first, target]);
  assert.equal(unbound.publisher, null);
  assert.equal(unbound.items[0]?.publisher, null);
  const older = observation(OBSERVED, first.id), later = observation(NOW, second.id);
  for (const ordered of [[older, later], [later, older]]) {
    const item = preview([first, second, target, ...ordered]).items[0];
    assert.equal(item?.observedAt, NOW);
    assert.equal(item?.publisher, 'Second producer');
  }
  for (const ordered of [[first.id, second.id], [second.id, first.id]]) {
    const item = preview([first, second, target, ...ordered.map(id => observation(NOW, id))]).items[0];
    assert.equal(item?.observedAt, NOW);
    assert.equal(item?.publisher, null);
  }
  assert.equal(preview([first, target, observation(NOW, second.id)]).items[0]?.publisher, null);
  assert.equal(preview([first, { ...first, name: 'Conflicting identity' }, target, observation(NOW, first.id)]).items[0]?.publisher, null);
  const indicator = { type: 'indicator', id: 'indicator--00000000-0000-4000-8000-000000000006', pattern_type: 'stix', pattern: "[domain-name:value = 'candidate.invalid']" };
  assert.equal(preview([first, indicator]).items[0]?.publisher, null);
  assert.equal(preview([first, { ...indicator, created_by_ref: first.id }]).items[0]?.publisher, 'First producer');
});

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
    const timestampOnly = misp.items.find((item) => item.entityType === 'ipv4');
    assert.equal(timestampOnly?.observedAt, null);
    assert.equal(timestampOnly?.createdAt, null);
    assert.equal(timestampOnly?.modifiedAt, '2026-07-28T01:00:00.000Z');
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
    assert.equal(indicator?.observedAt, null);
    assert.match(preview.limitations.join(' '), /valid_from.*not relabelled as an observation time/u);
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
    const timestampOnly = restored?.assertions.find((item) => item.provenance?.entityType === 'ipv4');
    assert.equal(timestampOnly?.provenance?.observedAt, null);
    assert.equal(timestampOnly?.provenance?.modifiedAt, '2026-07-28T01:00:00.000Z');
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
