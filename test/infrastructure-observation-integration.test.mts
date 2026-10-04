import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { parseInfrastructureObservation, compareInfrastructureObservations, infrastructureObservationFacts } from '../packages/investigation/infrastructure-observation.mts';
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
import { buildInvestigationCaseRelationships, filterInvestigationCaseRelationships, caseRelationshipGroupId } from '../packages/relationships/case-relationships.mts';
import { buildCaseRelationshipClusters, applyCaseRelationshipClusterAdjustments } from '../packages/relationships/case-relationship-clusters.mts';
import { buildRelationshipGraphDocument, buildRelationshipGraphExport } from '../packages/relationships/case-relationship-graph-export.mts';

const raw = await readFile(new URL('./fixtures/infrastructure-observations/infrastructure-observation-v1.json', import.meta.url), 'utf8');
const fixture = () => parseInfrastructureObservation(raw);
function later() {
  const result = fixture(); result.id = 'selected-example-later'; result.observedAt = '2026-10-02T12:00:00.000Z';
  for (const row of [...result.dns, ...result.certificates, ...result.roles]) row.observedAt = '2026-10-02T11:59:00.000Z';
  return result;
}

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

test('reversed fact clocks stay qualified through CLI, retained browser comparison and Review Items', async () => {
  const earlier = fixture(), stale = later(), now = '2026-10-03T00:00:00.000Z';
  for (const row of [...stale.dns, ...stale.certificates, ...stale.roles]) row.observedAt = '2026-09-30T00:00:00.000Z';
  stale.dns[2]!.values = ['192.0.2.26'];
  const input = { schema: 'whoisleuth.infrastructure-comparison.input', version: 1, earlier, later: stale };
  const review = buildOfflineEvidenceReview(JSON.stringify(input), now);
  assert.match(formatOfflineEvidenceReview(review), /unknown/);
  assert.doesNotMatch(formatOfflineEvidenceReview(review), / · changed\n/);
  assert.equal(await runCli(['review-evidence', '--json', '--strict-exit'], { stdout: { write() {} }, stderr: { write() {} }, now: () => now, readArtifactInput: async () => JSON.stringify(input) }), EXIT_CODES.PARTIAL_FAILURE);
  let cases = mergeExternalFindingsIntoCases([], convertInfrastructureObservation(earlier), now).cases;
  cases = mergeExternalFindingsIntoCases(cases, convertInfrastructureObservation(stale), now).cases;
  const projection = buildInvestigationProjection({ cases: buildCaseExport(cases, now) }, { generatedAt: now });
  const summaries = reviewRetainedInfrastructureSnapshots(projection).summaries;
  const browser = reviewRetainedInfrastructureSnapshots(projection, summaries.map(row => row.identity));
  assert.equal(browser.comparison?.state, 'partial');
  assert.ok(browser.comparison?.rows.every(row => row.state === 'unknown'));
  const item = buildLocalAnalystReviewProjection({ cases }, now).items.find(row => row.title === 'Source-qualified infrastructure review')!;
  assert.ok(item); assert.equal(item.completeness, 'partial'); assert.equal(item.nextAction, 'refresh');
  assert.match(item.detail, /^0 changed/);
});

test('complete imported NS responses share whole-set identity with Lookup through graph and cohort consumers', () => {
  const now = '2026-10-03T00:00:00.000Z';
  const imported = (values: string[], complete = true) => {
    const snapshot = fixture(); snapshot.scope = { hostnames: ['alias.example.test'], dnsTypes: ['NS'], selection: 'explicit_hosts' };
    snapshot.sources = [snapshot.sources[0]!]; snapshot.certificates = []; snapshot.roles = [];
    snapshot.coverage.state = complete ? 'complete' : 'partial';
    snapshot.dns = [{ sourceId: snapshot.sources[0]!.id, queriedName: 'alias.example.test', ownerName: 'example.test', type: 'NS', outcome: 'answered', values, observedAt: snapshot.observedAt, complete, truncated: !complete }];
    const record = createCase({ domain: 'example.test' }, now);
    const document = convertInfrastructureObservation(snapshot);
    record.evidencePins = [{ ...externalFindingCaseProjection(document.findings[0]!, document.source).evidencePin, id: `pin-${record.id}`, createdAt: now }];
    return record;
  };
  const project = (cases: ReturnType<typeof createCase>[]) => buildInvestigationProjection({ cases: buildCaseExport(cases, now) }, { generatedAt: now });
  const first = imported(['ns1.example.test', 'ns2.example.test']);
  const overlap = project([first, imported(['ns1.example.test', 'ns3.example.test'])]);
  assert.equal(buildInvestigationCaseRelationships(overlap).groups.length, 0);
  assert.equal(overlap.entities.filter(row => row.type === 'nameserver_set').length, 2);
  assert.ok(!overlap.entities.some(row => row.type === 'nameserver_set' && row.canonical === 'ns1.example.test'));
  const equal = imported(['ns2.example.test', 'ns1.example.test']);
  const lookup = createCase({ domain: 'lookup.example', evidence: { capturedAt: now, scanDepth: 'deep', nameservers: ['NS2.EXAMPLE.TEST.', 'ns1.example.test'] } }, now);
  const projection = project([first, equal, lookup]);
  const summary = buildInvestigationCaseRelationships(projection);
  const group = summary.groups.find(row => row.type === 'nameserver_set')!;
  assert.ok(group); assert.equal(group.cases.length, 3);
  assert.equal(new Set(group.cases.map(row => row.id)).size, 3);
  assert.equal(projection.entities.filter(row => row.type === 'nameserver_set').length, 1);
  assert.equal(buildCaseRelationshipClusters(summary).clusters[0]!.cases.length, 3);
  const graph = buildRelationshipGraphDocument(summary, { generatedAt: now });
  assert.equal(graph.graph.nodes.filter(row => row.kind === 'case').length, 3);
  assert.ok(JSON.stringify(graph).includes('ns1.example.test · ns2.example.test'));
  const partial = project([first, imported(['ns1.example.test', 'ns2.example.test'], false)]);
  assert.equal(buildInvestigationCaseRelationships(partial).groups.length, 0);
  assert.ok(partial.observations.some(row => row.limitations.some(value => /incomplete response/.test(value))));
  const singleton = project([imported(['ns1.example.test']), imported(['ns1.example.test'])]);
  assert.equal(buildInvestigationCaseRelationships(singleton).groups.length, 1);
  const separate = imported(['ns1.example.test']);
  const snapshot = separate.evidencePins[0]!.infrastructureObservation!;
  snapshot.dns.push({ ...snapshot.dns[0]!, values: ['ns2.example.test'], observedAt: '2026-10-01T11:00:00.000Z' });
  snapshot.sources.push({ ...snapshot.sources[0]!, id: 'another-source' });
  snapshot.dns.push({ ...snapshot.dns[0]!, sourceId: 'another-source', values: ['ns3.example.test'] });
  const separateProjection = project([separate, first]);
  assert.equal(buildInvestigationCaseRelationships(separateProjection).groups.length, 0);
  assert.deepEqual(separateProjection.entities.filter(row => row.type === 'nameserver_set').map(row => row.canonical).sort(), ['ns1.example.test', 'ns1.example.test|ns2.example.test', 'ns2.example.test', 'ns3.example.test']);
});

test('comparison output preserves exact query and certificate cohorts and clocks independently of input order',()=>{
  const before=fixture(),after=later();
  for(const snapshot of [before,after]){
    snapshot.dns[2]!.ownerName=snapshot.dns[1]!.ownerName;
    snapshot.dns[2]!.values=[...snapshot.dns[1]!.values];
    snapshot.certificates.push({...snapshot.certificates[0]!,fingerprintSha256:'b'.repeat(64),names:[...snapshot.certificates[0]!.names]});
  }
  before.dns[2]!.observedAt='2026-10-01T11:50:00.000Z';
  after.dns[2]!.observedAt='2026-10-02T11:50:00.000Z';
  after.dns[2]!.values=['192.0.2.27'];
  after.certificates[1]!.names.push('new.example.test');
  const result=compareInfrastructureObservations(before,after);
  for(const fact of infrastructureObservationFacts(before).facts.filter(row=>row.family==='certificate_names'))assert.equal(fact.hostname,fact.value);
  const dns=result.rows.filter(row=>row.family==='A');
  assert.equal(dns.length,2);
  const changed=dns.find(row=>row.cohort.kind==='dns'&&row.cohort.queriedName==='mail.example.test')!;
  assert.equal(changed.state,'changed'); assert.deepEqual(changed.beforeTimes,['2026-10-01T11:50:00.000Z']);
  assert.deepEqual(changed.afterTimes,['2026-10-02T11:50:00.000Z']);
  assert.equal(dns.find(row=>row.cohort.kind==='dns'&&row.cohort.queriedName==='www.example.test')!.state,'unchanged');
  const certificates=result.rows.filter(row=>row.cohort.kind==='certificate_names');
  assert.equal(certificates.length,2); assert.notDeepEqual(certificates[0]!.cohort,certificates[1]!.cohort);
  for(const snapshot of [before,after]){snapshot.dns.reverse();snapshot.certificates.reverse();for(const row of snapshot.certificates)row.names.reverse();}
  assert.deepEqual(compareInfrastructureObservations(before,after),result);
  assert.deepEqual(JSON.parse(JSON.stringify(result)),result);
  const review=buildOfflineEvidenceReview(JSON.stringify({schema:'whoisleuth.infrastructure-comparison.input',version:1,earlier:before,later:after}),'2026-10-03T00:00:00.000Z');
  assert.deepEqual(review.result,result);
  const rendered=formatOfflineEvidenceReview(review);
  assert.ok(rendered.includes('queriedName=mail.example.test'));
  assert.ok(rendered.includes('queriedName=www.example.test'));
  assert.ok(rendered.includes('b'.repeat(64)));
  assert.ok(rendered.includes('2026-10-01T11:50:00.000Z')); assert.ok(rendered.includes('2026-10-02T11:50:00.000Z'));
  const longHost = [63,63,63,48].map(length=>'a'.repeat(length)).join('.')+'.example.test';
  const longOwner = longHost.replace(/^a/u,'b');
  assert.equal(longHost.length,253);
  for(const snapshot of [before,after]){
    snapshot.scope.hostnames=snapshot.scope.hostnames.map(host=>host==='www.example.test'?longHost:host);
    for(const row of snapshot.dns)if(row.queriedName==='www.example.test'){row.queriedName=longHost;row.ownerName=longOwner;}
    for(const row of snapshot.roles)if(row.subject==='www.example.test')row.subject=longHost;
  }
  const longText=formatOfflineEvidenceReview(buildOfflineEvidenceReview(JSON.stringify({schema:'whoisleuth.infrastructure-comparison.input',version:1,earlier:before,later:after}),'2026-10-03T00:00:00.000Z'));
  assert.ok(longText.includes(`queriedName=${longHost}`));
  assert.ok(longText.includes(`ownerName=${longOwner}`));
});

test('long whole-set labels keep separate canonical groups through filtering, graph export and manual cluster merging',()=>{
  const now='2026-10-03T00:00:00.000Z';
  const shared=Array.from({length:10},(_,index)=>`ns${index}-${'shared'.repeat(5)}.example.test`);
  const cases=['a-one','a-two','b-one','b-two'].map((name,index)=>createCase({domain:`${name}.example`,evidence:{capturedAt:now,scanDepth:'deep',nameservers:[...shared,`zz-${index<2?'first':'second'}.example.test`]}},now));
  const projection=buildInvestigationProjection({cases:buildCaseExport(cases,now)},{generatedAt:now});
  const summary=buildInvestigationCaseRelationships(projection);
  assert.equal(summary.groups.length,2); assert.equal(summary.groups[0]!.value,summary.groups[1]!.value);
  assert.ok(summary.groups[0]!.value.length<=300);
  assert.ok(projection.entities.filter(row=>row.type==='nameserver_set').every(row=>row.canonical.length>300));
  assert.notEqual(summary.groups[0]!.entityId,summary.groups[1]!.entityId);
  assert.equal(new Set(summary.groups.map(caseRelationshipGroupId)).size,2);
  const filtered=filterInvestigationCaseRelationships(summary);
  assert.equal(filtered.groups.length,2); assert.equal(filtered.discardedRelationshipCount,0); assert.equal(summary.truncated,false);
  assert.deepEqual(filtered.groups.map(group=>group.cases.map(row=>row.domain).sort()).sort(),[['a-one.example','a-two.example'],['b-one.example','b-two.example']]);
  const graph=buildRelationshipGraphDocument(summary,{generatedAt:now});
  const nodes=graph.graph.nodes.filter(row=>row.kind==='relationship');
  assert.equal(nodes.length,2); assert.equal(new Set(nodes.map(row=>row.id)).size,2);
  assert.equal(new Set(nodes.map(row=>row.entityId)).size,2); assert.equal(graph.graph.edges.length,4); assert.equal(graph.graph.truncated,false);
  for(const node of nodes)assert.equal(graph.graph.edges.filter(edge=>edge.target===node.id).length,2);
  for(const format of ['json','graphml','gexf'] as const){
    const exported=buildRelationshipGraphExport(summary,{generatedAt:now,format}).content;
    for(const node of nodes){assert.ok(exported.includes(node.id));assert.equal(typeof node.entityId,'string');assert.ok(exported.includes(String(node.entityId)));}
  }
  const clusters=buildCaseRelationshipClusters(summary);
  assert.equal(clusters.clusters.length,2);
  const merged=applyCaseRelationshipClusterAdjustments(clusters,{labels:{},dismissed:[],merged:[clusters.clusters.map(row=>row.id)],splitCases:{}});
  assert.equal(merged.clusters.length,1); assert.equal(merged.clusters[0]!.groups.length,2);
});
