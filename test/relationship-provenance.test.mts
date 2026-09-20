import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { buildScanRelationships, relationshipObservation } from '../packages/comparison/relationship-evidence.mts';
import { normalizeRelationshipSourceProjection, qualifyRelationshipSources, relationshipSourceEvidence } from '../packages/comparison/relationship-provenance.mts';
import { buildRelationshipAdmissionPreview, relationshipAdmissionMatchesCurrent, snapshotRelationshipAdmission } from '../packages/relationships/relationship-admission-preview.mts';
import { buildRelationshipObservationExport, createRelationshipObservation, mergeRelationshipObservations, normalizeRelationshipObservationStore } from '../packages/workspace/relationship-observation-model.mts';
import { buildBulkSessionExport, mergeBulkSessions, normalizeBulkSessionStore, serializeBulkSessionStore } from '../packages/workspace/bulk-session-model.mts';
import { fromBulkSessionResult, toBulkSessionResult } from '../frontend/src/lib/analysis/bulk-result-model.ts';
import { richBulkSessionStore } from './bulk-session-fixture.mts';
import { requiredValue } from './value-assertions.mts';
import { previewWorkspaceArchive } from '../packages/workspace/workspace-archive.mts';
import { adaptRelationshipObservationsToEnvelope } from '../packages/investigation/observation-envelope.mts';
import { buildInvestigationProjection } from '../packages/investigation/investigation-projection.mts';
import { buildRetainedEvidenceTimeline } from '../frontend/src/lib/analysis/retained-evidence-timeline.ts';

const FIRST = '2026-08-01T01:00:00.000Z';
const LAST = '2026-08-01T02:00:00.000Z';
const RETAINED = '2026-08-02T01:00:00.000Z';
function tls(status: 'success' | 'partial' = 'success', observedAt = FIRST) {
  return { version: 1, source: 'tls', status, observedAt, complete: status === 'success', truncated: false,
    profileVersion: 2, certificate: { fingerprintSha256: 'a'.repeat(64) } };
}
function certificateGroup(partial = true) {
  const rows = ['one.example', 'two.example'].map((domain, index) => ({ domain,
    relationship: relationshipObservation({ tls: tls(partial && index === 1 ? 'partial' : 'success', index ? LAST : FIRST),
      dns: { version: 1, source: 'dns', status: 'error', observedAt: LAST, complete: false, truncated: true, records: {} } }),
  }));
  return requiredValue(buildScanRelationships(rows).groups.find((group) => group.type === 'certificate'));
}

test('partial TLS stays an exact positive pivot and preserves each contributing source through retention and export', () => {
  const group = certificateGroup();
  assert.equal(group.normalizedValue, 'a'.repeat(64));
  assert.deepEqual(group.domains, ['one.example', 'two.example']);
  assert.equal(group.complete, false);
  assert.equal(group.truncated, false);
  assert.deepEqual(group.sourceEvidence.map(({ domain, source, status, observedAt, complete }) => ({ domain, source, status, observedAt, complete })), [
    { domain: 'one.example', source: 'tls', status: 'success', observedAt: FIRST, complete: true },
    { domain: 'two.example', source: 'tls', status: 'partial', observedAt: LAST, complete: false },
  ]);
  const preview = buildRelationshipAdmissionPreview(group, { action: 'retain', observedAt: RETAINED, sourceIdentities: ['unrelated'] });
  assert.equal(preview.completeness, 'partial');
  assert.deepEqual(preview.sourceIdentities, ['tls']);
  assert.equal(preview.networkRequests, 0);
  const retained = createRelationshipObservation(group, { retainedAt: RETAINED, observedAt: RETAINED, complete: true });
  assert.equal(retained.observedAt, LAST);
  assert.equal(retained.complete, false);
  assert.deepEqual(retained.sourceEvidence, group.sourceEvidence);
  const exported = buildRelationshipObservationExport([retained], RETAINED);
  assert.deepEqual(requiredValue(exported.observations[0]).sourceEvidence, group.sourceEvidence);
  assert.equal(JSON.stringify(exported).includes('fingerprintSha256'), false);
  const forgedTime = normalizeRelationshipObservationStore([{ ...retained, observedAt: RETAINED }]);
  assert.equal(forgedTime.observations[0]?.observedAt, LAST);
});

test('unrelated source failure cannot mark a complete TLS contribution partial', () => {
  const group = certificateGroup(false);
  assert.equal(group.complete, true);
  assert.equal(buildRelationshipAdmissionPreview(group, { action: 'expand', truncated: true }).completeness, 'complete');
  const retained = createRelationshipObservation(group, { complete: false, retainedAt: RETAINED });
  assert.equal(normalizeRelationshipObservationStore([retained]).observations[0]?.complete, false);
});

test('future or malformed source envelopes cannot acquire completeness or a guessed source time', () => {
  for (const raw of [{ ...tls(), version: 2 }, { ...tls(), source: 'http' }, { ...tls(), observedAt: '2026-08-01' }, { ...tls(), truncated: undefined }]) {
    assert.equal(relationshipSourceEvidence('tls', raw).complete, false);
  }
  const group = certificateGroup();
  const unknown = createRelationshipObservation({ ...group, sourceEvidence: [] }, { observedAt: RETAINED, retainedAt: RETAINED });
  assert.equal(unknown.observedAt, null);
  assert.equal(unknown.complete, false);
  assert.ok(unknown.sourceEvidence.every((entry) => entry.observedAt === null));
  for (const sourceVersion of [4, 1001, Number.MAX_SAFE_INTEGER, '3', 0]) {
    assert.throws(() => normalizeRelationshipObservationStore([{ ...unknown, sourceVersion }]), /(?:newer|unsupported) source-evidence version/u);
  }
  const legacy = createRelationshipObservation(group, { sourceVersion: 2, retainedAt: RETAINED });
  assert.equal(legacy.complete, false);
  assert.ok(legacy.sourceEvidence.every((entry) => entry.observedAt === null));
});

test('public retained pivots preserve their identity and original scan time without inventing source provenance', () => {
  const current = createRelationshipObservation(certificateGroup(), { retainedAt: RETAINED });
  const { sourceEvidence: _sources, ...legacy } = current;
  const original = { version: 1, observations: [{ ...legacy, sourceVersion: 2, observedAt: FIRST, complete: true }] };
  const before = structuredClone(original);
  const restored = requiredValue(normalizeRelationshipObservationStore(original).observations[0]);
  assert.equal(restored.id, current.id);
  assert.equal(restored.observedAt, FIRST);
  assert.equal(restored.complete, false);
  assert.ok(restored.sourceEvidence.every((entry) => entry.source === 'unknown' && entry.observedAt === null));
  assert.deepEqual(original, before);
});

test('legacy parent versions cannot admit new source metadata through added or mixed-version fields', () => {
  const current = createRelationshipObservation(certificateGroup(false), { retainedAt: RETAINED });
  const legacy = { version: 1, observations: [{ ...current, sourceVersion: 2 }] };
  const before = structuredClone(legacy);
  for (const observations of [normalizeRelationshipObservationStore(legacy).observations, mergeRelationshipObservations([], legacy).observations]) {
    const restored = requiredValue(observations[0]);
    assert.equal(restored.complete, false);
    assert.ok(restored.sourceEvidence.every((entry) => entry.status === 'unknown' && entry.observedAt === null));
  }
  const mixed = { version: 1, observations: [current] };
  assert.throws(() => normalizeRelationshipObservationStore(mixed), /schema 1 cannot contain newer source evidence/u);
  assert.throws(() => mergeRelationshipObservations([], mixed), /schema 1 cannot contain newer source evidence/u);
  assert.throws(() => normalizeRelationshipObservationStore({ version: 3, observations: [current] }), /newer schema 3/u);
  assert.deepEqual(legacy, before);

  const raw = normalizeBulkSessionStore(richBulkSessionStore(2));
  const row = requiredValue(requiredValue(raw.sessions[0]).results[0]);
  row.observedAt = LAST;
  row.relationship = relationshipObservation({ tls: tls() });
  const mixedBulk = { ...raw, version: 4 };
  assert.throws(() => normalizeBulkSessionStore(mixedBulk), /schema 4 cannot contain newer relationship source evidence/u);
  assert.throws(() => mergeBulkSessions([], mixedBulk), /schema 4 cannot contain newer relationship source evidence/u);
  const legacyBulk = structuredClone(mixedBulk);
  for (const session of legacyBulk.sessions) for (const result of session.results) {
    Object.assign(result.relationship, { version: 2 });
  }
  for (const sessions of [normalizeBulkSessionStore(legacyBulk).sessions, mergeBulkSessions([], legacyBulk).sessions]) {
    const restored = requiredValue(requiredValue(sessions[0]).results[0]);
    assert.equal(restored.observedAt, null);
    assert.deepEqual(restored.relationship.sourceEvidence, {});
  }
  assert.equal(legacyBulk.sessions[0]?.results[0]?.observedAt, LAST);
});

test('the shared admission snapshot detects source, status, time, member and context changes without mutation', () => {
  const group = certificateGroup();
  const snapshot = snapshotRelationshipAdmission(group, 'scan-one', ['Source-qualified evidence']);
  assert.equal(relationshipAdmissionMatchesCurrent(snapshot, [group], 'scan-one', ['Source-qualified evidence']), true);
  for (const patch of [{ status: 'success' }, { source: 'http' }, { observedAt: RETAINED }]) {
    const changed = { ...group, sourceEvidence: group.sourceEvidence.map((entry, index) => index ? { ...entry, ...patch } : entry) };
    assert.equal(relationshipAdmissionMatchesCurrent(snapshot, [changed as typeof group], 'scan-one', ['Source-qualified evidence']), false);
  }
  assert.equal(relationshipAdmissionMatchesCurrent(snapshot, [{ ...group, domains: ['one.example'] }], 'scan-one', ['Source-qualified evidence']), false);
  assert.equal(relationshipAdmissionMatchesCurrent(snapshot, [group], 'scan-two', ['Source-qualified evidence']), false);
  assert.equal(Object.isFrozen(snapshot.relationship.sourceEvidence), true);
  assert.equal(Object.isFrozen(snapshot.relationship.sourceEvidence?.[0]), true);
});

test('provenance caps, missing members and inconsistent success flags stay partial', () => {
  const valid = relationshipSourceEvidence('tls', tls());
  assert.equal(qualifyRelationshipSources([{ domain: 'one.example', ...valid }], ['one.example', 'two.example']).complete, false);
  const many = Array.from({ length: 4 }, (_, index) => ({ ...valid, observedAt: `2026-08-01T0${index}:00:00.000Z` }));
  const projected = normalizeRelationshipSourceProjection({ certificate: many });
  assert.equal(projected.certificate?.length, 3);
  assert.ok(projected.certificate?.every((entry) => !entry.complete && entry.truncated));
  assert.equal(qualifyRelationshipSources([{ domain: 'one.example', ...valid, status: 'partial', complete: true }], ['one.example']).complete, false);
});

test('source matching respects the same per-row bounds as the relationship projection', () => {
  const observation = relationshipObservation({ dns: { version: 1, source: 'dns', status: 'success', observedAt: FIRST,
    complete: true, truncated: false, records: { a: ['192.0.2.20'] } } });
  const addresses = Array.from({ length: 51 }, (_, index) => `192.0.2.${index + 1}`);
  const oversized = { ...observation, ipAddresses: addresses };
  const summary = buildScanRelationships([
    { domain: 'one.example', relationship: oversized },
    { domain: 'two.example', relationship: observation },
  ]);
  const group = requiredValue(summary.groups.find((entry) => entry.type === 'ip_address' && entry.normalizedValue === '192.0.2.20'));
  assert.equal(group.complete, false);
  assert.equal(group.truncated, true);
  const excluded = buildScanRelationships([
    { domain: 'one.example', relationship: { ...oversized, ipAddresses: [...Array.from({ length: 50 }, () => '192.0.2.21'), '192.0.2.20'] } },
    { domain: 'two.example', relationship: observation },
  ]);
  assert.equal(excluded.groups.some((entry) => entry.normalizedValue === '192.0.2.20'), false);
});

test('saved Bulk round trips preserve source times, while public rows remain explicitly undated', async () => {
  const raw = richBulkSessionStore(2);
  const normalized = normalizeBulkSessionStore(raw);
  const session = requiredValue(normalized.sessions[0]);
  const result = requiredValue(session.results[0]);
  result.relationship = relationshipObservation({ tls: tls('partial') });
  result.observedAt = LAST;
  result.sourceCoverage = [{ source: 'dns', state: 'partial', observedAt: FIRST }, { source: 'tls', state: 'partial', observedAt: LAST }];
  const browserRow = fromBulkSessionResult(result);
  assert.equal(browserRow.saved.observedAt, LAST);
  assert.equal(toBulkSessionResult(browserRow).observedAt, LAST);
  assert.deepEqual(toBulkSessionResult(browserRow).sourceCoverage, result.sourceCoverage);
  const restored = normalizeBulkSessionStore(JSON.parse(serializeBulkSessionStore(normalized)));
  const after = requiredValue(requiredValue(restored.sessions[0]).results[0]);
  assert.equal(after.observedAt, LAST);
  assert.deepEqual(after.relationship.sourceEvidence, result.relationship.sourceEvidence);
  assert.deepEqual(after.sourceCoverage, result.sourceCoverage);
  const imported = mergeBulkSessions([], buildBulkSessionExport(restored, RETAINED));
  assert.equal(requiredValue(requiredValue(imported.sessions[0]).results[0]).observedAt, LAST);
  const publicEmpty = JSON.parse(await readFile(new URL('./fixtures/workspace-lifecycle/browser-bulk-v4.json', import.meta.url), 'utf8'));
  assert.equal(normalizeBulkSessionStore(publicEmpty).version, 5);
  assert.equal(requiredValue(normalizeBulkSessionStore(raw).sessions[0])?.results[0]?.observedAt, null);
});

test('the exact public archive migrates real rows and pivots without changing historical bytes or inventing source metadata', async () => {
  // Emitted by the exact public 2.3.0 writer at b4f7fd940b04ea07e3f0b1e3b23e8d92c6cbc6c5.
  const bytes = await readFile(new URL('./fixtures/workspace-source-provenance-v8-public.json', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), 'bb542f13e1a74d178a1137da7fdb96243a99172d7b08b94d31bc277cb97ed4c2');
  const raw = JSON.parse(bytes.toString('utf8'));
  const before = structuredClone(raw);
  assert.equal(raw.version, 8);
  assert.equal(raw.sections.bulkSessions.version, 4);
  assert.equal(raw.sections.relationshipObservations.version, 1);
  const preview = await previewWorkspaceArchive(raw, {});
  assert.equal(preview.unsupportedCount, 0);
  assert.equal(preview.sections.find((section) => section.id === 'bulkSessions')?.added, 1);
  assert.equal(preview.sections.find((section) => section.id === 'relationshipObservations')?.added, 1);
  const bulk = requiredValue(normalizeBulkSessionStore(raw.sections.bulkSessions).sessions[0]);
  assert.equal(bulk.results.length, 2);
  assert.ok(bulk.results.every((row) => row.observedAt === null && Object.keys(row.relationship.sourceEvidence).length === 0));
  assert.ok(bulk.results.every((row) => row.sourceCoverage.every((source) => source.observedAt === null)));
  const addedClocks = structuredClone(raw.sections.bulkSessions);
  for (const row of addedClocks.sessions[0].results) {
    row.observedAt = RETAINED;
    for (const source of row.sourceCoverage) source.observedAt = RETAINED;
  }
  const migrated = requiredValue(normalizeBulkSessionStore(addedClocks).sessions[0]);
  assert.ok(migrated.results.every((row) => row.observedAt === null && row.sourceCoverage.every((source) => source.observedAt === null)));
  const pivot = requiredValue(normalizeRelationshipObservationStore(raw.sections.relationshipObservations).observations[0]);
  assert.equal(pivot.normalizedValue, 'a'.repeat(64));
  assert.equal(pivot.complete, false);
  assert.equal(pivot.observedAt, '2026-08-01T00:00:00.000Z');
  assert.ok(pivot.sourceEvidence.every((entry) => entry.observedAt === null && entry.status === 'unknown'));
  assert.deepEqual(raw, before);
});

test('graph and search projections keep source times distinct and never collapse same-time sources', () => {
  const group = certificateGroup();
  const record = createRelationshipObservation(group, { retainedAt: RETAINED });
  const input = { version: 2, observations: [record] };
  const envelope = adaptRelationshipObservationsToEnvelope(input, { generatedAt: RETAINED });
  assert.equal(envelope.state, 'ready');
  const observations = requiredValue(envelope.document).observations;
  assert.deepEqual(observations.map(({ source, observedAt, complete }) => ({ source, observedAt, complete })), [
    { source: 'tls', observedAt: FIRST, complete: true },
    { source: 'tls', observedAt: LAST, complete: false },
  ]);
  const sameTime = { ...record, type: 'tracking_identifier', normalizedValue: 'tag-container:GTM-EXAMPLE', sourceEvidence: [
    { ...requiredValue(record.sourceEvidence[0]), source: 'http' as const },
    { ...requiredValue(record.sourceEvidence[0]), source: 'page_identity' as const },
    { ...requiredValue(record.sourceEvidence[1]), source: 'http' as const },
  ] };
  const projection = buildInvestigationProjection({ relationshipObservations: { version: 2, observations: [sameTime] } }, { generatedAt: RETAINED });
  const projected = projection.observations.filter((entry) => entry.store === 'relationshipObservations');
  assert.equal(projected.length, 3);
  assert.equal(new Set(projected.map((entry) => entry.id)).size, 3);
  assert.deepEqual(projected.map((entry) => entry.source).sort(), ['http', 'http', 'page_identity']);
});

test('an undated pivot stays available as an explicit retention event, not a fresh source observation', () => {
  const group = certificateGroup();
  const record = createRelationshipObservation({ ...group, sourceEvidence: [] }, { retainedAt: RETAINED });
  const envelope = adaptRelationshipObservationsToEnvelope({ version: 2, observations: [record] }, { generatedAt: RETAINED });
  assert.equal(envelope.state, 'ready');
  const document = requiredValue(envelope.document);
  assert.equal(document.relationships.length, 2);
  assert.ok(document.observations.every((entry) => entry.source === 'analyst_retention' && entry.derivation === 'analyst'
    && entry.observedAt === RETAINED && entry.complete === false && entry.limitations.some((text) => text.includes('retention only'))));
  const timeline = buildRetainedEvidenceTimeline({ relationships: [record], now: RETAINED });
  const event = requiredValue(timeline.items.find((entry) => entry.kind === 'relationship'));
  assert.equal(event.eventType, 'evidence');
  assert.equal(event.freshness, 'unknown');
  assert.equal(event.source, record.source);
  assert.equal(event.observedAt, null);
  assert.equal(event.storedAt, RETAINED);
  assert.equal(record.observedAt, null);
});
