import assert from 'node:assert/strict';
import { test } from 'node:test';
import { relationshipObservation, buildScanRelationships } from '../packages/comparison/relationship-evidence.mts';
import { createRelationshipObservation, normalizeRelationshipObservationStore, buildRelationshipObservationExport, relationshipObservationId } from '../packages/workspace/relationship-observation-model.mts';
import { buildInvestigationProjection } from '../packages/investigation/investigation-projection.mts';
import { buildInvestigationCaseRelationships } from '../packages/relationships/case-relationships.mts';
import { buildCaseRelationshipClusters } from '../packages/relationships/case-relationship-clusters.mts';
import { buildRelationshipAdmissionPreview } from '../packages/relationships/relationship-admission-preview.mts';
import { CASE_SCHEMA_VERSION } from '../packages/contracts/case-portability.mts';

const TIME = '2026-08-01T01:00:00.000Z';
const DOMAINS = Array.from({ length: 6 }, (_, index) => `scope-${index}.example`);
const SOURCES = DOMAINS.map(domain => ({ domain, source: 'dns', status: 'success', observedAt: TIME, complete: true, truncated: false }));

test('historical non-public pivots keep their identity, dates and source evidence with an explicit scope qualification', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '192.0.2.1', '::1', 'fc00::1', '2001:db8::1']) {
    const input = { type: 'ip_address', normalizedValue: address, domains: DOMAINS, sourceEvidence: SOURCES };
    const old = createRelationshipObservation(input, { sourceVersion: 3, observedAt: TIME, retainedAt: TIME });
    const before = structuredClone(old);
    const restored = normalizeRelationshipObservationStore({ version: 2, observations: [old] }).observations[0]!;
    assert.equal(restored.id, relationshipObservationId(input));
    assert.equal(restored.normalizedValue, address);
    assert.equal(restored.observedAt, TIME);
    assert.equal(restored.complete, true);
    assert.deepEqual(restored.sourceEvidence, SOURCES);
    assert.equal(restored.label, 'Shared non-public DNS answer');
    assert.match(restored.limitations.join(' '), /not evidence of shared public hosting/u);
    assert.deepEqual(buildRelationshipObservationExport([restored], TIME).observations, [restored]);
    assert.deepEqual(old, before);
    assert.throws(() => createRelationshipObservation(input), /Non-public DNS answers cannot be retained/u);
  }
});

test('historical non-public relationships stay qualified through Case projection, clustering and admission', () => {
  const retained = createRelationshipObservation({ type: 'ip_address', normalizedValue: '127.0.0.1', domains: DOMAINS, sourceEvidence: SOURCES }, { sourceVersion: 3, retainedAt: TIME });
  const projection = buildInvestigationProjection({
    cases: { version: CASE_SCHEMA_VERSION, cases: DOMAINS.map((domain, index) => ({ id: `case-${index}`, domain, createdAt: TIME, updatedAt: TIME, status: 'reviewing', disposition: 'unreviewed', source: 'lookup', evidenceHistory: [] })) },
    relationshipObservations: { version: 2, observations: [retained] },
  }, { generatedAt: TIME });
  const summary = buildInvestigationCaseRelationships(projection);
  const group = summary.groups.find(group => group.type === 'ip_address');
  assert.ok(group);
  assert.equal(group.cases.length, DOMAINS.length);
  assert.equal(group.label, 'Shared non-public DNS answer');
  assert.match(group.description, /not evidence of shared public hosting/u);
  const cluster = buildCaseRelationshipClusters(summary).clusters[0];
  assert.ok(cluster);
  assert.equal(cluster.confidence, 'exact_observation');
  assert.deepEqual(cluster.infrastructureMatches, []);
  assert.match(cluster.limitations.join(' '), /not evidence of shared public hosting/u);
  const preview = buildRelationshipAdmissionPreview({ ...retained, value: retained.normalizedValue }, { action: 'expand' });
  assert.match(preview.sharedInfrastructureWarning, /not evidence of shared public hosting/u);
  assert.equal(preview.networkRequests, 0);
});

test('version 3 source qualification is retained when rebuilding current public-address groups', () => {
  const current = relationshipObservation({ dns: { version: 1, source: 'dns', status: 'success', observedAt: TIME, complete: true, truncated: false, records: { a: ['11.12.13.14'] } } });
  const rows = DOMAINS.map(domain => ({ domain, relationship: { ...current, version: 3 } }));
  const group = buildScanRelationships(rows).groups.find(group => group.type === 'ip_address');
  assert.ok(group);
  assert.equal(group.complete, true);
  assert.equal(group.observedAt, TIME);
  assert.deepEqual(group.sourceEvidence, SOURCES);
});

test('a transitive favicon group explains its connected basis rather than claiming every pair matches', () => {
  const base = 0x0f0f0f0f0f0f0f0fn;
  const hashes = [base, base ^ 0x3fn, base ^ 0xfffn];
  const rows = hashes.map((hash, index) => ({ domain: DOMAINS[index], relationship: relationshipObservation({ faviconPHash: hash.toString(16).padStart(16, '0') }) }));
  const group = buildScanRelationships(rows).groups.find(group => group.type === 'favicon');
  assert.ok(group);
  assert.equal(group.domains.length, 3);
  assert.equal(group.label, 'Connected favicon matches');
  assert.match(group.description, /Not every pair necessarily matches/u);
  assert.equal(createRelationshipObservation(group, { retainedAt: TIME }).description, group.description);
});
