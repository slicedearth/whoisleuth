import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareCaseAssertions } from '../packages/cases/case-assessment-comparison.mts';
import type { CaseAssertionRecord, CaseEvidencePin } from '../packages/cases/case-response-records.mts';

const pin: CaseEvidencePin = {
  id: 'pin-one', checkpointId: 'checkpoint-one', field: 'dns.nameservers', category: 'dns',
  label: 'Nameservers', value: 'ns1.example.test', source: 'DNS', sourceState: 'partial', sourceSchema: null,
  observedAt: null, collectionDepth: 'deep', completeness: 'partial', truncated: false,
  transitionExpectation: null, limitations: ['Resolver response incomplete.'], createdAt: '2026-09-01T00:00:00.000Z',
};
const assertion: CaseAssertionRecord = {
  id: 'assertion-one', kind: 'hypothesis', statement: 'Shared infrastructure explains the match.', rationale: null,
  evidencePinIds: [pin.id], evidenceRelations: [{ evidencePinId: pin.id, stance: 'supports' }],
  state: 'open', createdAt: pin.createdAt, updatedAt: pin.createdAt,
};

test('comparison keeps opposing analyst relationships without deciding between explanations', () => {
  const result = compareCaseAssertions([pin], assertion, { ...assertion, id: 'assertion-two', evidenceRelations: [{ evidencePinId: pin.id, stance: 'contradicts' }] });
  assert.deepEqual(result, { rows: [{ id: pin.id, pin, left: 'supports', right: 'contradicts' }], sharedContext: [] });
  assert.equal(result.rows[0]?.pin?.observedAt, null);
  assert.equal(result.rows[0]?.pin?.completeness, 'partial');
});

test('missing evidence, unlinked evidence and an unspecified relationship remain different states', () => {
  const historical = { ...assertion };
  delete historical.evidenceRelations;
  const result = compareCaseAssertions([pin], { ...assertion, evidencePinIds: ['missing'], evidenceRelations: [] }, historical);
  assert.deepEqual(result.rows, [
    { id: pin.id, pin, left: 'not_linked', right: 'unspecified' },
    { id: 'missing', pin: null, left: 'unspecified', right: 'not_linked' },
  ]);
});

test('explicit unresolved relations are retained even when an older id list is incomplete', () => {
  const result = compareCaseAssertions([pin], { ...assertion, evidencePinIds: [], evidenceRelations: [{ evidencePinId: pin.id, stance: 'unresolved' }] }, { ...assertion, evidencePinIds: [], evidenceRelations: [] });
  assert.equal(result.rows[0]?.left, 'unresolved');
  assert.equal(result.rows[0]?.right, 'not_linked');
});

test('shared checkpoint, imported content and source labels remain separate provenance cues', () => {
  const first = { ...pin, importContentSha256: 'a'.repeat(64) };
  const second = { ...first, id: 'pin-two', label: 'Addresses', value: '192.0.2.1' };
  const unrelated = { ...pin, id: 'unlinked' };
  const result = compareCaseAssertions([first, second, unrelated], assertion, { ...assertion, evidencePinIds: [second.id], evidenceRelations: [{ evidencePinId: second.id, stance: 'supports' }] });
  assert.deepEqual(result.sharedContext, [
    { kind: 'checkpoint', label: 'Same collection checkpoint', pinIds: [first.id, second.id] },
    { kind: 'import', label: 'Same imported content', pinIds: [first.id, second.id] },
    { kind: 'source', label: 'Same declared source: DNS', pinIds: [first.id, second.id] },
  ]);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0]?.right, 'not_linked');
  assert.equal(result.rows[1]?.left, 'not_linked');
});

test('no relationships produces an empty comparison without inventing evidence', () => {
  const empty = { ...assertion, evidencePinIds: [], evidenceRelations: [] };
  assert.deepEqual(compareCaseAssertions([pin], empty, { ...empty, id: 'other' }), { rows: [], sharedContext: [] });
});
