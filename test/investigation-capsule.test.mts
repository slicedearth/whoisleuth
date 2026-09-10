import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildInvestigationCapsule,
  INVESTIGATION_CAPSULE_VERSION,
  investigationCapsuleFilename,
  serializeInvestigationCapsule,
  verifyInvestigationCapsule,
  type SupportedInvestigationCapsule,
} from '../frontend/src/lib/analysis/investigation-capsule.ts';
import { sha256ArtifactDigestV2 } from '../frontend/src/lib/analysis/artifact-integrity.ts';
import {
  MAX_CASE_ASSERTIONS,
  MAX_CASE_DECISIONS,
  MAX_DECISION_PIN_REFERENCES,
} from '../frontend/src/lib/analysis/case-response-model.ts';
import { verifyOfflineArtifact } from '../cli/artifact-verify.mts';
import { projectDecisionFacts } from '../packages/evidence/decision-fact.mts';
import type { CaseRecord } from '../packages/cases/case-record-contracts.mts';
import { LOOKUP_ASSET_GRAPH_VERSION, LOOKUP_INVESTIGATION_BRIEF_VERSION } from '../packages/contracts/investigation-portability.mts';
import { buildLookupAssetGraph, type LookupAssetGraph } from '../packages/investigation/lookup-asset-graph.mts';
import { lookupGraphCapacityFixture } from './lookup-graph-capacity-fixture.mts';
import { createLookupViewModel, parseLookupHttpResponse } from '../lib/lookup-response-contract.mts';

const brief: import('../packages/investigation/lookup-investigation-brief.mts').LookupInvestigationBrief = {
  schema: 'whoisleuth.investigation-brief' as const,
  schemaVersion: LOOKUP_INVESTIGATION_BRIEF_VERSION,
  generatedAt: '2026-08-04T00:00:00.000Z',
  target: 'example.test', targetType: 'domain', task: 'general' as const,
  taskLabel: 'General review', question: 'What is known?', summary: 'Review evidence.',
  observation: { observedAt: '2026-08-04T00:00:00.000Z', evidenceAgeDays: 0, completeSources: 1, limitedSources: 0, freshnessPolicy: { version: 1 as const, id: 'task-default' as const, task: 'general' as const, thresholdsDays: { registration: 30, network: 7, web: 3 } } },
  decisionFacts: projectDecisionFacts([]),
  relationships: { nodes: 1, edges: 0, truncated: false, kinds: [] }, limitations: [],
};
const graph: LookupAssetGraph = { version: LOOKUP_ASSET_GRAPH_VERSION, targetId: 'target-example', nodes: [{ id: 'target-example', label: 'example.test', kind: 'target' as const, detail: 'Lookup target' }], edges: [], sources: [], coverage: { inputs: [] }, truncated: false, limitations: [] };

async function redigestCapsule<T extends Record<string, unknown>>(value: T): Promise<T> {
  const briefDigest = await sha256ArtifactDigestV2(value.investigationBrief);
  const graphDigest = await sha256ArtifactDigestV2(value.graphSnapshot);
  const analystRecordsDigest = value.analystRecords === null ? null : await sha256ArtifactDigestV2(value.analystRecords);
  for (const contract of value.sourceContracts as Array<Record<string, unknown>>) {
    if (contract.id === 'investigation-brief') contract.digest = briefDigest;
    else if (contract.id === 'asset-graph') contract.digest = graphDigest;
    else if (contract.id === 'analyst-records') contract.digest = analystRecordsDigest;
  }
  const { integrity: _integrity, ...unsigned } = value;
  Reflect.set(value, 'integrity', {
    algorithm: 'SHA-256', canonicalization: 'sorted-json-v2', scope: 'capsule excluding integrity',
    briefDigest, graphDigest, analystRecordsDigest, digestSha256: await sha256ArtifactDigestV2(unsigned),
  });
  return value;
}

test('the exact historical v3 capsule remains readable without rewriting its graph', async () => {
  const raw = await readFile(new URL('./fixtures/investigation-portability/investigation-capsule-v3.json', import.meta.url), 'utf8');
  const capsule = JSON.parse(raw) as SupportedInvestigationCapsule;
  assert.equal(capsule.schemaVersion, 3);
  assert.equal(capsule.graphSnapshot.version, 2);
  assert.equal((await verifyInvestigationCapsule(capsule)).valid, true);
  assert.equal((await verifyOfflineArtifact(raw)).state, 'verified');
});

test('the current capsule fixture keeps graph identity and missing source clocks consistent', async () => {
  const raw = await readFile(new URL('./fixtures/investigation-portability/investigation-capsule-v4.json', import.meta.url), 'utf8');
  const capsule = JSON.parse(raw) as import('../packages/investigation/investigation-capsule.mts').InvestigationCapsule;
  assert.equal(capsule.target.value, 'example.test');
  assert.equal(capsule.investigationBrief.target, 'example.test');
  assert.equal(capsule.graphSnapshot.nodes.find(node => node.id === capsule.graphSnapshot.targetId)?.label, 'example.test');
  assert.equal(capsule.investigationBrief.observation.observedAt, null);
  assert.equal(capsule.graphSnapshot.edges.find(edge => edge.kind === 'presents-certificate')?.observedAt, null);
  assert.equal((await verifyOfflineArtifact(raw)).state, 'verified');
});

test('complete current graph exports verify beyond historical graph bounds and reject coverage or version drift', async () => {
  const parsed = parseLookupHttpResponse(lookupGraphCapacityFixture());
  if (!parsed.ok) assert.fail('The source fixture must be admitted.');
  const view = createLookupViewModel(parsed.value);
  const fullGraph = buildLookupAssetGraph({ ...view, rdapEvidence: view.rdap, target: 'example.test' });
  const fullBrief = { ...brief, relationships: { nodes: fullGraph.nodes.length, edges: fullGraph.edges.length, truncated: fullGraph.truncated, kinds: [...new Set(fullGraph.edges.map(edge => edge.label))] } };
  const capsule = await buildInvestigationCapsule({ applicationVersion: '2.3.1', lookupEvidence: { schema: 'whoisleuth.lookup-evidence', schemaVersion: 31 }, brief: fullBrief, graph: fullGraph, generatedAt: brief.generatedAt });
  assert.ok(fullGraph.nodes.length > 72 && fullGraph.edges.length > 120);
  assert.equal((await verifyOfflineArtifact(serializeInvestigationCapsule(capsule))).state, 'verified');
  for (const mutate of [
    (value: Record<string, unknown>) => { value.schemaVersion = 5; },
    (value: Record<string, unknown>) => { (value.graphSnapshot as Record<string, unknown>).version = 2; },
    (value: Record<string, unknown>) => { (value.investigationBrief as Record<string, unknown>).schemaVersion = 2; },
    (value: Record<string, unknown>) => { (value.graphSnapshot as Record<string, unknown>).truncated = true; },
    (value: Record<string, unknown>) => {
      const row = (((value.graphSnapshot as Record<string, unknown>).coverage as Record<string, unknown>).inputs as Record<string, unknown>[]).find(row => Number(row.supplied) > 0)!;
      row.admitted = Number(row.admitted) + 1;
    },
  ]) {
    const changed = structuredClone(capsule) as unknown as Record<string, unknown>;
    mutate(changed);
    await redigestCapsule(changed);
    await assert.rejects(verifyOfflineArtifact(JSON.stringify(changed)), /unsupported|malformed/iu);
  }
});

test('investigation capsule links evidence and verifies embedded projections', async () => {
  const capsule = await buildInvestigationCapsule({
    applicationVersion: '1.35.0',
    lookupEvidence: { schema: 'whoisleuth.lookup-evidence', schemaVersion: 24, fact: 'bounded' },
    brief,
    graph,
    generatedAt: '2026-08-04T01:00:00Z',
  });
  assert.equal(capsule.sourceContracts[0]?.embedded, false);
  assert.equal(capsule.schemaVersion, INVESTIGATION_CAPSULE_VERSION);
  assert.equal(capsule.investigationBrief.schemaVersion, LOOKUP_INVESTIGATION_BRIEF_VERSION);
  assert.match(capsule.sourceContracts[0]?.digest ?? '', /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(await verifyInvestigationCapsule(capsule), { valid: true, brief: true, graph: true, analystRecords: null, whole: true });
  assert.equal(investigationCapsuleFilename(capsule), 'whoisleuth-investigation-capsule-example.test-2026-08-04.json');
  assert.ok(serializeInvestigationCapsule(capsule).endsWith('\n'));
});

test('capsule creation rejects mismatched targets and retained relationship summaries', async () => {
  const input = {
    applicationVersion: '2.3.1', lookupEvidence: { schema: 'whoisleuth.lookup-evidence', schemaVersion: 28 },
    brief, graph, generatedAt: brief.generatedAt,
  };
  const mismatches: LookupAssetGraph[] = [
    { ...graph, nodes: [{ ...graph.nodes[0]!, label: 'other.example' }] },
    { ...graph, nodes: [{ ...graph.nodes[0]!, kind: 'hostname' }] },
    { ...graph, nodes: [...graph.nodes, { ...graph.nodes[0]!, id: 'another-target' }] },
    { ...graph, targetId: 'missing-target' },
    { ...graph, truncated: true },
  ];
  for (const candidate of mismatches) {
    await assert.rejects(buildInvestigationCapsule({ ...input, graph: candidate }), /same target and retained relationships/u);
  }
  await assert.rejects(buildInvestigationCapsule({ ...input, brief: { ...brief, relationships: { ...brief.relationships, edges: 1 } } }), /same target and retained relationships/u);
  for (const [target, targetType] of [['sub.example.test', 'domain'], ['192.0.2.1', 'ipv4'], ['2001:db8::1', 'ipv6'], ['AS64500', 'asn']] as const) {
    const capsule = await buildInvestigationCapsule({ ...input,
      brief: { ...brief, target, targetType },
      graph: { ...graph, nodes: [{ ...graph.nodes[0]!, label: target }] },
    });
    assert.equal((await verifyOfflineArtifact(serializeInvestigationCapsule(capsule))).state, 'verified');
  }
});

test('redigested capsule target mismatches remain invalid despite matching checksums', async () => {
  const capsule = await buildInvestigationCapsule({
    applicationVersion: '2.3.1', lookupEvidence: { schema: 'whoisleuth.lookup-evidence', schemaVersion: 28 },
    brief, graph, generatedAt: brief.generatedAt,
  });
  const mutations: Array<(value: Record<string, unknown>) => void> = [
    (value) => { (value.target as Record<string, unknown>).value = 'other.example'; },
    (value) => { (value.target as Record<string, unknown>).type = 'ipv4'; },
    (value) => { (((value.graphSnapshot as Record<string, unknown>).nodes as Array<Record<string, unknown>>)[0]!).label = 'other.example'; },
    (value) => { (((value.graphSnapshot as Record<string, unknown>).nodes as Array<Record<string, unknown>>)[0]!).kind = 'hostname'; },
    (value) => {
      const nodes = (value.graphSnapshot as Record<string, unknown>).nodes as Array<Record<string, unknown>>;
      nodes.push({ ...nodes[0]!, id: 'another-target' });
      ((value.investigationBrief as Record<string, unknown>).relationships as Record<string, unknown>).nodes = nodes.length;
    },
    (value) => { ((value.investigationBrief as Record<string, unknown>).relationships as Record<string, unknown>).truncated = true; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(capsule) as unknown as Record<string, unknown>;
    mutate(changed);
    await redigestCapsule(changed);
    assert.equal((await verifyInvestigationCapsule(changed as unknown as SupportedInvestigationCapsule)).valid, true, 'Checksums establish content integrity, not consistent or factual observations.');
    await assert.rejects(verifyOfflineArtifact(JSON.stringify(changed)), /projection linkage.*unsupported or malformed/iu);
  }
});

test('a frozen synthetic v2 capsule retains whole-integrity compatibility', async () => {
  // This is a cross-contract integrity fixture, not a captured application release.
  const raw = await readFile(new URL('./fixtures/investigation-capsule-v2.json', import.meta.url), 'utf8');
  const capsule = JSON.parse(raw) as SupportedInvestigationCapsule;
  assert.equal(capsule.schemaVersion, 2);
  assert.deepEqual(await verifyInvestigationCapsule(capsule), {
    valid: true,
    brief: true,
    graph: true,
    analystRecords: null,
    whole: true,
  });
  const report = await verifyOfflineArtifact(raw);
  assert.equal(report.state, 'verified');
  assert.equal(report.checks.contentIntegrityScope, 'whole_artifact');
  const serialized = serializeInvestigationCapsule(capsule);
  assert.deepEqual(JSON.parse(serialized), capsule);
  assert.ok(serialized.endsWith('\n'));
});

test('offline verification rejects re-digested capsule contract and graph-linkage gaps', async () => {
  const linkedGraph = {
    ...graph,
    edges: [{
      id: 'edge-fixture', sourceId: 'source-fixture', source: 'target-example', target: 'target-example',
      kind: 'observed', label: 'Fixture relationship', sourceLabel: 'Fixture source', observedAt: brief.generatedAt,
      completeness: 'complete' as const, limitations: [], lenses: ['all' as const], href: '#fixture' as const,
    }],
    sources: [{
      id: 'source-fixture', label: 'Fixture source', href: '#fixture' as const, observedAt: brief.generatedAt,
      completeness: 'complete' as const, limitations: [],
    }],
  };
  const linkedBrief = { ...brief, relationships: { ...brief.relationships, edges: 1 } };
  const capsule = await buildInvestigationCapsule({
    applicationVersion: '1.35.0',
    lookupEvidence: { schema: 'whoisleuth.lookup-evidence', schemaVersion: 24 },
    brief: linkedBrief,
    graph: linkedGraph,
    generatedAt: '2026-08-04T01:00:00Z',
  });
  assert.equal((await verifyOfflineArtifact(JSON.stringify(capsule))).state, 'verified');

  const mutations: Array<(value: Record<string, unknown>) => void> = [
    (value) => { (value.sourceContracts as unknown[]).reverse(); },
    (value) => {
      const snapshot = value.graphSnapshot as Record<string, unknown>;
      const nodes = snapshot.nodes as Array<Record<string, unknown>>;
      nodes.push({ ...nodes[0]! });
      ((value.investigationBrief as Record<string, unknown>).relationships as Record<string, unknown>).nodes = 2;
    },
    (value) => {
      const sources = (value.graphSnapshot as Record<string, unknown>).sources as Array<Record<string, unknown>>;
      sources.push({ ...sources[0]! });
    },
    (value) => {
      const snapshot = value.graphSnapshot as Record<string, unknown>;
      const edges = snapshot.edges as Array<Record<string, unknown>>;
      edges.push({ ...edges[0]! });
      ((value.investigationBrief as Record<string, unknown>).relationships as Record<string, unknown>).edges = 2;
    },
    (value) => {
      const edge = (((value.graphSnapshot as Record<string, unknown>).edges as Array<Record<string, unknown>>)[0]!);
      edge.sourceId = 'missing-source';
    },
    (value) => {
      const edge = (((value.graphSnapshot as Record<string, unknown>).edges as Array<Record<string, unknown>>)[0]!);
      edge.target = 'missing-node';
    },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(capsule) as unknown as Record<string, unknown>;
    mutate(changed);
    await redigestCapsule(changed);
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(changed)),
      /investigation capsule .*unsupported or malformed structure/iu,
    );
  }
});

test('investigation capsule includes analyst records only when deliberately selected', async () => {
  const maximumPinReferences = Array.from({ length: MAX_DECISION_PIN_REFERENCES }, (_, index) => `pin-${index}`);
  const caseRecord: CaseRecord = {
    id: 'case-1', domain: 'example.test', status: 'reviewing', disposition: 'unreviewed', brandProfileIds: [], tags: [], notes: [{ id: 'note', body: 'excluded note', createdAt: '2026-08-04T00:00:00.000Z' }], source: 'lookup', evidenceHistory: [], evidencePins: [], actions: [], manualTrail: [], sightings: [],
    observedEffects: { reviews: [], omitted: 0, preV13HistoryUnavailable: false, limitations: [] },
    closures: { records: [], omitted: 0, preV13HistoryUnavailable: false, limitations: [] },
    createdAt: '2026-08-04T00:00:00.000Z', updatedAt: '2026-08-04T00:00:00.000Z',
    decisions: [{ id: 'decision-1', summary: 'Review registration conflict', rationale: 'Two publications differ.', confidence: 'unknown' as const, confidenceBasis: '', evidencePinIds: maximumPinReferences, createdAt: '2026-08-04T00:00:00.000Z' }],
    assertions: [{ id: 'assertion-1', kind: 'hypothesis' as const, statement: 'Publication lag may explain the difference.', rationale: null, evidencePinIds: maximumPinReferences, state: 'open' as const, createdAt: '2026-08-04T00:00:00.000Z', updatedAt: '2026-08-04T00:00:00.000Z' }],
  };
  const capsule = await buildInvestigationCapsule({ applicationVersion: '1.35.0', lookupEvidence: { schema: 'whoisleuth.lookup-evidence', schemaVersion: 24 }, brief, graph, caseRecord, includeAnalystRecords: true, generatedAt: '2026-08-04T01:00:00Z' });
  const serialized = serializeInvestigationCapsule(capsule);
  assert.equal(capsule.analystRecords?.decisions.length, 1);
  assert.equal(capsule.analystRecords?.assertions.length, 1);
  assert.equal(serialized.includes('excluded note'), false);
  assert.equal((await verifyInvestigationCapsule(capsule)).valid, true);
  assert.equal((await verifyOfflineArtifact(JSON.stringify(capsule))).state, 'verified');

  for (const collection of ['decisions', 'assertions'] as const) {
    const changed = structuredClone(capsule) as unknown as Record<string, unknown>;
    const records = changed.analystRecords as Record<string, unknown>;
    const item = ((records[collection] as Array<Record<string, unknown>>)[0]!);
    item.evidencePinIds = [...maximumPinReferences, 'pin-over-bound'];
    await redigestCapsule(changed);
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(changed)),
      /investigation capsule .* evidence pins.*unsupported or malformed structure/iu,
    );
  }

  for (const collection of ['decisions', 'assertions'] as const) {
    const changed = structuredClone(capsule) as unknown as Record<string, unknown>;
    const records = changed.analystRecords as Record<string, unknown>;
    if (collection === 'decisions') {
      records.decisions = Array.from({ length: MAX_CASE_DECISIONS + 1 }, (_, index) => ({
        id: `decision-${index}`, summary: 'Review evidence', rationale: '', evidencePinIds: [], createdAt: brief.generatedAt,
      }));
    } else {
      records.assertions = Array.from({ length: MAX_CASE_ASSERTIONS + 1 }, (_, index) => ({
        id: `assertion-${index}`, kind: 'hypothesis', statement: 'Review evidence.', rationale: null,
        evidencePinIds: [], state: 'open', createdAt: brief.generatedAt, updatedAt: brief.generatedAt,
      }));
    }
    await redigestCapsule(changed);
    await assert.rejects(
      verifyOfflineArtifact(JSON.stringify(changed)),
      /investigation capsule (decisions|assertions).*unsupported or malformed structure/iu,
    );
  }

  const changed = {
    ...capsule,
    graphSnapshot: {
      ...capsule.graphSnapshot,
      nodes: capsule.graphSnapshot.nodes.map((node, index) => index === 0 ? { ...node, label: 'changed.test' } : node),
    },
  };
  assert.deepEqual(await verifyInvestigationCapsule(changed), { valid: false, brief: true, graph: false, analystRecords: true, whole: false });
});
