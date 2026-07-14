import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildSyntheticDemoExport, createSyntheticDemoState, MAX_SYNTHETIC_DEMO_NOTE_LENGTH,
  normalizeSyntheticDemoState, SYNTHETIC_DEMO_CANDIDATES, SYNTHETIC_DEMO_EXPORT_SCHEMA,
  syntheticDemoCandidate, syntheticDemoStage,
} from '../frontend/src/lib/analysis/demo-model.js';

function completeState(overrides = {}) {
  return { version: 1, profileReady: true, candidatesReady: true, selectedCandidateId: 'credential-lure', caseReady: true, caseStatus: 'reviewing', note: 'Synthetic analyst note', ...overrides };
}

describe('synthetic demo state', () => {
  test('creates a bounded empty state', () => {
    assert.deepEqual(createSyntheticDemoState(), { version: 1, profileReady: false, candidatesReady: false, selectedCandidateId: '', caseReady: false, caseStatus: 'new', note: '' });
  });

  test('rejects malformed and future state envelopes', () => {
    assert.deepEqual(normalizeSyntheticDemoState(null), createSyntheticDemoState());
    assert.deepEqual(normalizeSyntheticDemoState({ version: 2, profileReady: true }), createSyntheticDemoState());
  });

  test('enforces stage dependencies and known candidate ids', () => {
    assert.deepEqual(normalizeSyntheticDemoState({ ...completeState(), profileReady: false }), createSyntheticDemoState());
    const unknown = normalizeSyntheticDemoState({ ...completeState(), selectedCandidateId: 'not-a-fixture' });
    assert.equal(unknown.selectedCandidateId, '');
    assert.equal(unknown.caseReady, false);
  });

  test('bounds notes, removes unsafe controls, and validates status', () => {
    const result = normalizeSyntheticDemoState(completeState({ caseStatus: 'escalated', note: `safe\u0000${'x'.repeat(MAX_SYNTHETIC_DEMO_NOTE_LENGTH + 20)}` }));
    assert.equal(result.caseStatus, 'new');
    assert.equal(result.note.includes('\u0000'), false);
    assert.equal(result.note.length, MAX_SYNTHETIC_DEMO_NOTE_LENGTH);
  });

  test('derives the furthest valid stage', () => {
    assert.equal(syntheticDemoStage(createSyntheticDemoState()), 'brand');
    assert.equal(syntheticDemoStage({ ...createSyntheticDemoState(), profileReady: true }), 'discover');
    assert.equal(syntheticDemoStage({ ...completeState(), caseReady: false }), 'evidence');
    assert.equal(syntheticDemoStage(completeState()), 'case');
  });

  test('exposes only the fixed candidate inventory', () => {
    assert.equal(SYNTHETIC_DEMO_CANDIDATES.length, 3);
    assert.equal(syntheticDemoCandidate('credential-lure')?.domain, 'northstar-login.example');
    assert.equal(syntheticDemoCandidate('unknown'), null);
  });
});

describe('synthetic demo export', () => {
  test('builds an explicitly synthetic deterministic package', () => {
    const payload = buildSyntheticDemoExport(completeState(), '2026-07-14T01:02:03.000Z');
    assert.equal(payload.schema, SYNTHETIC_DEMO_EXPORT_SCHEMA);
    assert.equal(payload.synthetic, true);
    assert.equal(payload.generatedAt, '2026-07-14T01:02:03.000Z');
    assert.equal(payload.case.domain, 'northstar-login.example');
    assert.match(payload.warning, /Synthetic demonstration data only/);
    assert.ok(payload.limitations.every((item) => /fixture|request|live assessment/i.test(item)));
  });

  test('does not mutate state or shared fixtures', () => {
    const state = completeState();
    const before = structuredClone(state);
    const payload = buildSyntheticDemoExport(state, '2026-07-14T01:02:03.000Z');
    payload.assessment.signals.push('Changed export');
    payload.evidence.nameservers.push('changed.invalid');
    assert.deepEqual(state, before);
    assert.equal(SYNTHETIC_DEMO_CANDIDATES[0].signals.includes('Changed export'), false);
    assert.equal(SYNTHETIC_DEMO_CANDIDATES[0].evidence.nameservers.includes('changed.invalid'), false);
  });

  test('refuses incomplete state and malformed timestamps', () => {
    assert.throws(() => buildSyntheticDemoExport(createSyntheticDemoState(), '2026-07-14T00:00:00.000Z'), /Complete the synthetic case/);
    assert.throws(() => buildSyntheticDemoExport(completeState(), 'not-a-date'), /valid export timestamp/);
    assert.throws(() => buildSyntheticDemoExport(completeState(), `2026-07-14T00:00:00.000Z\n`), /valid export timestamp/);
  });
});
