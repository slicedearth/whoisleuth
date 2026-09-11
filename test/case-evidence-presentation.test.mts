import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CaseEvidencePin } from '../packages/cases/case-response-records.mts';
import { caseEvidenceCheckpointGroups, caseEvidenceChoiceName, caseEvidenceReferences } from '../frontend/src/lib/analysis/case-evidence-presentation.ts';

const pin: CaseEvidencePin = {
  id: 'pin-one', checkpointId: 'checkpoint-one', field: 'dns.nameservers', category: 'dns',
  label: 'Nameservers', value: 'ns1.example.test', source: 'DNS', sourceState: 'partial',
  sourceSchema: null, observedAt: '2026-09-01T00:00:00.000Z', collectionDepth: 'deep',
  completeness: 'partial', truncated: false, transitionExpectation: null,
  limitations: ['One resolver observation.'], createdAt: '2026-09-02T00:00:00.000Z',
};

test('evidence choices identify duplicate labels and do not substitute creation time for observation time', () => {
  assert.equal(caseEvidenceChoiceName(pin, 0), 'Pin 1: Nameservers · DNS · 2026-09-01T00:00:00.000Z');
  assert.equal(caseEvidenceChoiceName({ ...pin, observedAt: null }, 1), 'Pin 2: Nameservers · DNS · Observation time unavailable');
  assert.notEqual(caseEvidenceChoiceName(pin, 0), caseEvidenceChoiceName(pin, 1));
});

test('linked evidence keeps order, missing references and explicit contradictory relationships', () => {
  const references = caseEvidenceReferences([pin], ['missing', pin.id, pin.id], [{ evidencePinId: pin.id, stance: 'contradicts' }]);
  assert.deepEqual(references, [
    { id: 'missing', pin: null, stance: null },
    { id: pin.id, pin, stance: 'contradicts' },
  ]);
  assert.equal(caseEvidenceReferences([pin], [pin.id])[0]?.stance, null);
});

test('checkpoint selection includes every member instead of labelling the group with an arbitrary last pin', () => {
  const second = { ...pin, id: 'pin-two', label: 'Addresses', value: '192.0.2.1' };
  const third = { ...pin, id: 'pin-three', checkpointId: 'checkpoint-two' };
  const groups = caseEvidenceCheckpointGroups([pin, second, { ...pin, id: 'manual', checkpointId: null }, third]);
  assert.deepEqual(groups, [{ id: 'checkpoint-one', pins: [pin, second] }, { id: 'checkpoint-two', pins: [third] }]);
});
