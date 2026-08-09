import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildInvestigationCapsule,
  investigationCapsuleFilename,
  serializeInvestigationCapsule,
  verifyInvestigationCapsule,
} from '../frontend/src/lib/analysis/investigation-capsule.ts';

const brief = {
  schema: 'whoisleuth.investigation-brief' as const,
  schemaVersion: 1 as const,
  generatedAt: '2026-08-04T00:00:00.000Z',
  target: 'example.test', targetType: 'domain', task: 'general' as const,
  taskLabel: 'General review', question: 'What is known?', summary: 'Review evidence.',
  observation: { observedAt: '2026-08-04T00:00:00.000Z', evidenceAgeDays: 0, completeSources: 1, limitedSources: 0, freshnessPolicy: { version: 1 as const, id: 'task-default' as const, task: 'general' as const, thresholdsDays: { registration: 30, network: 7, web: 3 } } },
  verifiedFacts: [], contradictions: [], unknowns: [], nextActions: [],
  relationships: { nodes: 1, edges: 0, truncated: false, kinds: [] }, limitations: [],
};
const graph = { version: 2 as const, targetId: 'target-example', nodes: [{ id: 'target-example', label: 'example.test', kind: 'target' as const, detail: 'Lookup target' }], edges: [], sources: [], truncated: false, limitations: [] };

test('investigation capsule links evidence and verifies embedded projections', async () => {
  const capsule = await buildInvestigationCapsule({
    applicationVersion: '1.35.0',
    lookupEvidence: { schema: 'whoisleuth.lookup-evidence', schemaVersion: 24, fact: 'bounded' },
    brief,
    graph,
    generatedAt: '2026-08-04T01:00:00Z',
  });
  assert.equal(capsule.sourceContracts[0]?.embedded, false);
  assert.match(capsule.sourceContracts[0]?.digest ?? '', /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(await verifyInvestigationCapsule(capsule), { valid: true, brief: true, graph: true, analystRecords: null });
  assert.equal(investigationCapsuleFilename(capsule), 'whoisleuth-investigation-capsule-example.test-2026-08-04.json');
  assert.ok(serializeInvestigationCapsule(capsule).endsWith('\n'));
});

test('investigation capsule includes analyst records only when deliberately selected', async () => {
  const caseRecord = {
    id: 'case-1', domain: 'example.test', status: 'reviewing', disposition: 'unreviewed', brandProfileIds: [], tags: [], notes: [{ id: 'note', body: 'excluded note', createdAt: '2026-08-04T00:00:00Z' }], source: 'lookup', evidenceHistory: [], evidencePins: [], actions: [], manualTrail: [], sightings: [], createdAt: '2026-08-04T00:00:00Z', updatedAt: '2026-08-04T00:00:00Z',
    decisions: [{ id: 'decision-1', summary: 'Review registration conflict', rationale: 'Two publications differ.', evidencePinIds: [], createdAt: '2026-08-04T00:00:00Z' }],
    assertions: [{ id: 'assertion-1', kind: 'hypothesis' as const, statement: 'Publication lag may explain the difference.', rationale: null, evidencePinIds: [], state: 'open' as const, createdAt: '2026-08-04T00:00:00Z', updatedAt: '2026-08-04T00:00:00Z' }],
  };
  const capsule = await buildInvestigationCapsule({ applicationVersion: '1.35.0', lookupEvidence: { schema: 'whoisleuth.lookup-evidence', schemaVersion: 24 }, brief, graph, caseRecord, includeAnalystRecords: true, generatedAt: '2026-08-04T01:00:00Z' });
  const serialized = serializeInvestigationCapsule(capsule);
  assert.equal(capsule.analystRecords?.decisions.length, 1);
  assert.equal(capsule.analystRecords?.assertions.length, 1);
  assert.equal(serialized.includes('excluded note'), false);
  assert.equal((await verifyInvestigationCapsule(capsule)).valid, true);

  const changed = {
    ...capsule,
    graphSnapshot: {
      ...capsule.graphSnapshot,
      nodes: capsule.graphSnapshot.nodes.map((node, index) => index === 0 ? { ...node, label: 'changed.test' } : node),
    },
  };
  assert.deepEqual(await verifyInvestigationCapsule(changed), { valid: false, brief: true, graph: false, analystRecords: true });
});
