import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { parseInfrastructureObservation } from '../packages/investigation/infrastructure-observation.mts';
import { convertInfrastructureObservation } from '../packages/interchange/external-findings-converters.mts';
import { parseExternalFindingsDocument, externalFindingCaseProjection, mergeExternalFindingsIntoCases, serializeExternalFindingsDocument, MAX_EXTERNAL_FINDINGS_IMPORT_BYTES } from '../packages/interchange/external-findings-import.mts';
import { projectInfrastructureObservation } from '../packages/investigation/infrastructure-collection-projection.mts';
import type { InvestigationCollectionProjectionContext } from '../packages/investigation/investigation-projection-collections.mts';
import type { InvestigationEntity, InvestigationObservation, InvestigationRelationship, NormalizedCaseEvidencePin, NormalizedCaseRecord } from '../packages/investigation/investigation-projection.mts';
import { reviewRetainedInfrastructureSnapshots } from '../packages/investigation/retained-infrastructure-snapshots.mts';
import { buildOfflineEvidenceReview, formatOfflineEvidenceReview } from '../cli/offline-evidence-review.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { buildLocalAnalystReviewProjection } from '../frontend/src/lib/analysis/analyst-review-local-projections.ts';
import { createCase } from '../packages/cases/case-record-operations.mts';
import { buildInvestigationProjection } from '../packages/investigation/investigation-projection.mts';
import { buildCaseExport, serializeCaseStore } from '../packages/cases/case-storage-model.mts';
import { normalizeCaseStore } from '../packages/cases/case-migration-model.mts';
import { projectCaseForAudience } from '../packages/cases/case-record-projection.mts';

const raw = await readFile(new URL('./fixtures/infrastructure-observations/infrastructure-observation-v1.json', import.meta.url), 'utf8');
const fixture = () => parseInfrastructureObservation(raw);
function later() { const result = fixture(); result.id = 'selected-example-later'; result.observedAt = '2026-10-02T12:00:00.000Z'; return result; }

test('snapshot import is one exact retained finding, preserving v4 historical reader output', () => {
  const document = convertInfrastructureObservation(fixture());
  assert.equal(document.schemaVersion, 5); assert.equal(document.findings.length, 1);
  assert.ok(Buffer.byteLength(serializeExternalFindingsDocument(document)) <= MAX_EXTERNAL_FINDINGS_IMPORT_BYTES);
  assert.deepEqual(parseExternalFindingsDocument(JSON.parse(serializeExternalFindingsDocument(document))), document);
  const projection = externalFindingCaseProjection(document.findings[0]!, document.source);
  assert.deepEqual((projection.evidencePin as unknown as Record<string, unknown>).infrastructureObservation, fixture());
  assert.throws(() => parseExternalFindingsDocument({ ...document, schemaVersion: 4 }), /version 5/u);
  const historical = { ...document, schemaVersion: 4, findings: document.findings.map(({ infrastructureObservation: _snapshot, ...finding }) => finding) };
  assert.equal(parseExternalFindingsDocument(historical).schemaVersion, 4);
});
test('version-5 findings bound aggregate snapshot accumulation before retained output', () => {
  const dense = fixture(); dense.coverage.state = 'partial'; dense.scope.dnsTypes = ['A']; dense.roles = []; dense.certificates = [];
  dense.scope.hostnames = Array.from({ length: 128 }, (_, index) => `host-${index}.example.test`);
  dense.dns = dense.scope.hostnames.flatMap(queriedName => Array.from({ length: 3 }, (_, index) => ({ ...fixture().dns[1]!, queriedName, ownerName: queriedName, observedAt: `2026-10-01T11:0${index}:00.000Z`, values: ['192.0.2.20'] })));
  const documents = Array.from({ length: 5 }, (_, index) => convertInfrastructureObservation({ ...dense, id: `dense-snapshot-${index}` }));
  assert.throws(() => parseExternalFindingsDocument({ ...documents[0], findings: documents.flatMap(row => row.findings) }), /aggregate byte bound/u);
});
test('Case retention, export and full projection preserve snapshot material while public projection excludes it', () => {
  const document = convertInfrastructureObservation(fixture()), now = '2026-10-03T00:00:00.000Z';
  const imported = mergeExternalFindingsIntoCases([], document, now);
  assert.equal(imported.findingsAdded, 1);
  const reread = normalizeCaseStore(JSON.parse(serializeCaseStore(imported.cases)));
  assert.deepEqual(reread.cases[0]?.evidencePins[0]?.infrastructureObservation, fixture());
  assert.deepEqual(buildCaseExport(reread.cases, now).cases[0]?.evidencePins[0]?.infrastructureObservation, fixture());
  assert.equal(mergeExternalFindingsIntoCases(reread.cases, document, now).duplicatesSkipped, 1);
  const projection = buildInvestigationProjection({ cases: { version: reread.version, cases: reread.cases } }, { generatedAt: now });
  const review = reviewRetainedInfrastructureSnapshots(projection);
  assert.equal(review.total, 1); assert.deepEqual(reviewRetainedInfrastructureSnapshots(projection, [review.summaries[0]!.identity]).selected[0]?.observation, fixture());
  const publicRecord = projectCaseForAudience(reread.cases[0]!, 'public');
  assert.equal(Object.hasOwn(publicRecord.evidencePins[0]!, 'infrastructureObservation'), false);
  assert.ok(!JSON.stringify(publicRecord).includes('*.example.test'));
  const future = structuredClone(projection); future.observations.find(row => row.infrastructureObservation)!.infrastructureObservation!.version = 2 as 1;
  assert.equal(reviewRetainedInfrastructureSnapshots(future).total, 0);
  assert.equal(reviewRetainedInfrastructureSnapshots(future).partial, true);
  assert.equal(reviewRetainedInfrastructureSnapshots(null).partial, true);
});
test('existing offline review command reads exact snapshots and comparisons without collection', () => {
  const review = buildOfflineEvidenceReview(raw, '2026-10-03T00:00:00.000Z');
  assert.equal(review.kind, 'infrastructure'); assert.match(formatOfflineEvidenceReview(review), /Wildcard patterns are not enumerated/u);
  const compared = buildOfflineEvidenceReview(JSON.stringify({ schema: 'whoisleuth.infrastructure-comparison.input', version: 1, earlier: fixture(), later: later() }), '2026-10-03T00:00:00.000Z');
  assert.equal(compared.kind, 'infrastructure_comparison'); assert.match(formatOfflineEvidenceReview(compared), /unchanged/u);
});
test('offline infrastructure strict exit qualifies partial and incomparable snapshots', async () => {
  const partial = later(); partial.coverage.state = 'partial'; partial.dns[0]!.complete = false;
  for (const [input, expected] of [[fixture(), EXIT_CODES.SUCCESS], [partial, EXIT_CODES.PARTIAL_FAILURE], [{ schema: 'whoisleuth.infrastructure-comparison.input', version: 1, earlier: fixture(), later: fixture() }, EXIT_CODES.PARTIAL_FAILURE]] as const) {
    const code = await runCli(['review-evidence', '--json', '--strict-exit'], { stdout: { write() {} }, stderr: { write() {} }, now: () => '2026-10-03T00:00:00.000Z', readArtifactInput: async () => JSON.stringify(input) });
    assert.equal(code, expected);
  }
});
test('local Review Items use exact retained pairs and keep complete baselines through a failed later observation', () => {
  const record = createCase({ domain: 'example.test' }, '2026-10-03T00:00:00.000Z');
  const failed = later(); failed.coverage.state = 'partial'; failed.dns[2] = { ...failed.dns[2]!, values: [], outcome: 'failed', complete: false };
  record.evidencePins = [fixture(), failed].map((snapshot, index) => ({ ...externalFindingCaseProjection(convertInfrastructureObservation(snapshot).findings[0]!, convertInfrastructureObservation(snapshot).source).evidencePin, id: `snapshot-pin-${index}`, createdAt: snapshot.observedAt }));
  const review = buildLocalAnalystReviewProjection({ cases: [record] }, '2026-10-03T00:00:00.000Z').items.find(row => row.title === 'Source-qualified infrastructure review');
  assert.ok(review); assert.equal(review.completeness, 'partial'); assert.equal(review.nextAction, 'refresh'); assert.match(review.detail, /unknown/u);
  const oldRecord = createCase({ domain: 'old.example.test' }, '2026-10-03T00:00:00.000Z');
  assert.ok(!buildLocalAnalystReviewProjection({ cases: [oldRecord] }, '2026-10-03T00:00:00.000Z').items.some(row => row.title === 'Source-qualified infrastructure review'));
});
test('projection links aliases to response owner, separates wildcard patterns and independently sourced roles', () => {
  const entities: InvestigationEntity[] = [], observations: InvestigationObservation[] = [], relationships: InvestigationRelationship[] = [];
  const caseEntity: InvestigationEntity = { id: 'case-one', type: 'case', canonical: 'case-one', label: 'Case', properties: {}, observationIds: [], observationsTruncated: false };
  const context = {
    cases: { version: 18 }, projectionLimitations: [], markTruncated() {}, stableId: (prefix: string, value: string) => `${prefix}:${value}`,
    addEntity(type: InvestigationEntity['type'], canonical: string, label: string, properties: Record<string, unknown>) { const existing = entities.find(row => row.type === type && row.canonical === canonical); if (existing) return existing; const row = { id: `${type}:${canonical}`, type, canonical, label, properties, observationIds: [], observationsTruncated: false }; entities.push(row); return row; },
    addObservation(row: InvestigationObservation) { observations.push(row); return row; }, linkObservationEntity(row: InvestigationObservation | null, entity: InvestigationEntity | null) { if (row && entity && !row.entityIds.includes(entity.id)) row.entityIds.push(entity.id); },
    addRelationship(row: InvestigationRelationship, observation: InvestigationObservation | null) { const value = { ...row, id: `edge-${relationships.length}`, sourceObservationIds: [observation?.id ?? ''], complete: observation?.complete ?? false }; relationships.push(value); return value; },
  } as unknown as InvestigationCollectionProjectionContext;
  assert.equal(projectInfrastructureObservation(context, { id: 'pin-one', infrastructureObservation: fixture() } as unknown as NormalizedCaseEvidencePin, { id: 'case-one' } as NormalizedCaseRecord, caseEntity), true);
  assert.ok(entities.some(row => row.type === 'certificate_pattern' && row.canonical === '*.example.test'));
  assert.ok(!entities.some(row => row.type === 'domain' && row.canonical.startsWith('*.')));
  const address = relationships.find(row => row.type === 'domain_resolved_to_ip' && row.to.endsWith('198.51.100.1'))!;
  assert.equal(address.from, 'domain:edge.example.test');
  assert.equal(relationships.filter(row => row.type === 'subject_observed_provider_role').length, 2);
  assert.equal(relationships.filter(row => row.type === 'ip_observed_routing_origin').length, 1);
  const projection = { schema: 'whoisleuth.investigation-projection', version: 1, entities, observations, relationships, truncated: false };
  const review = reviewRetainedInfrastructureSnapshots(projection);
  assert.equal(review.total, 1); assert.equal(review.summaries[0]!.hostCount, 2);
});
