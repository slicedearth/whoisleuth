import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  buildSyntheticDemoExport, createSyntheticDemoState, MAX_SYNTHETIC_DEMO_NOTE_LENGTH,
  normalizeSyntheticDemoState, SYNTHETIC_DEMO_CANDIDATES, SYNTHETIC_DEMO_EXPORT_SCHEMA,
  SYNTHETIC_DEMO_EXPORT_VERSION, SYNTHETIC_DEMO_PROFILE, SYNTHETIC_DEMO_STAGES,
  syntheticDemoCandidate, syntheticDemoCaseRecord, syntheticDemoLookupView,
  syntheticDemoRelationshipGroups, syntheticDemoStage, syntheticDemoTimeline,
} from '../frontend/src/lib/analysis/demo-model.js';

function completeState(overrides = {}) {
  return { version: 1, started: true, profileReady: true, candidatesReady: true, selectedCandidateId: 'credential-lure', caseReady: true, caseStatus: 'reviewing', note: 'Synthetic analyst note', followUpReady: true, ...overrides };
}

describe('synthetic demo state', () => {
  test('creates a bounded empty state', () => {
    assert.deepEqual(createSyntheticDemoState(), { version: 1, started: false, profileReady: false, candidatesReady: false, selectedCandidateId: '', caseReady: false, caseStatus: 'new', note: '', followUpReady: false });
  });

  test('rejects malformed and future state envelopes', () => {
    assert.deepEqual(normalizeSyntheticDemoState(null), createSyntheticDemoState());
    assert.deepEqual(normalizeSyntheticDemoState({ version: 2, profileReady: true }), createSyntheticDemoState());
  });

  test('enforces stage dependencies and known candidate ids', () => {
    const missingProfile = normalizeSyntheticDemoState({ ...completeState(), profileReady: false });
    assert.equal(missingProfile.started, true);
    assert.equal(missingProfile.profileReady, false);
    assert.equal(missingProfile.candidatesReady, false);
    assert.equal(missingProfile.selectedCandidateId, '');
    const unknown = normalizeSyntheticDemoState({ ...completeState(), selectedCandidateId: 'not-a-fixture' });
    assert.equal(unknown.selectedCandidateId, '');
    assert.equal(unknown.caseReady, false);
  });

  test('migrates earlier valid progress by inferring the dashboard start state', () => {
    const migrated = normalizeSyntheticDemoState({ version: 1, profileReady: true, candidatesReady: false });
    assert.equal(migrated.started, true);
    assert.equal(migrated.profileReady, true);
    assert.equal(migrated.followUpReady, false);
  });

  test('bounds notes, removes unsafe controls, and validates status', () => {
    const result = normalizeSyntheticDemoState(completeState({ caseStatus: 'escalated', note: `safe\u0000${'x'.repeat(MAX_SYNTHETIC_DEMO_NOTE_LENGTH + 20)}` }));
    assert.equal(result.caseStatus, 'new');
    assert.equal(result.note.includes('\u0000'), false);
    assert.equal(result.note.length, MAX_SYNTHETIC_DEMO_NOTE_LENGTH);
  });

  test('derives the furthest valid stage', () => {
    assert.equal(syntheticDemoStage(createSyntheticDemoState()), 'dashboard');
    assert.equal(syntheticDemoStage({ ...createSyntheticDemoState(), started: true }), 'brands');
    assert.equal(syntheticDemoStage({ ...completeState(), candidatesReady: false, selectedCandidateId: '', caseReady: false, followUpReady: false }), 'discover');
    assert.equal(syntheticDemoStage({ ...completeState(), selectedCandidateId: '', caseReady: false, followUpReady: false }), 'bulk');
    assert.equal(syntheticDemoStage({ ...completeState(), caseReady: false, followUpReady: false }), 'lookup');
    assert.equal(syntheticDemoStage(completeState()), 'monitor');
  });

  test('exposes only the fixed candidate inventory', () => {
    assert.equal(SYNTHETIC_DEMO_CANDIDATES.length, 3);
    assert.equal(syntheticDemoCandidate('credential-lure')?.domain, 'northstar-login.example');
    assert.equal(syntheticDemoCandidate('unknown'), null);
  });

  test('uses the production-shaped profile and centralized stage manifest', () => {
    assert.deepEqual(SYNTHETIC_DEMO_STAGES.map((stage) => stage.id), ['dashboard', 'brands', 'discover', 'bulk', 'lookup', 'monitor']);
    assert.deepEqual(SYNTHETIC_DEMO_PROFILE.officialDomains, ['northstar.example']);
    assert.equal(SYNTHETIC_DEMO_PROFILE.pageBaseline?.complete, true);
    assert.equal(Object.isFrozen(SYNTHETIC_DEMO_PROFILE.pageBaseline), true);
  });

  test('derives the bounded timeline through production case normalization', () => {
    const baseline = syntheticDemoTimeline('credential-lure');
    const complete = syntheticDemoTimeline('credential-lure', true);
    assert.equal(baseline.length, 1);
    assert.equal(complete.length, 2);
    assert.equal(complete[0].repeated, true);
    assert.ok(complete[1].changes.some((change) => change.field === 'Risk score'));
    complete[1].changes[0].field = 'Changed copy';
    assert.equal(SYNTHETIC_DEMO_CANDIDATES[0].observations[2].riskScore, 86);
    assert.deepEqual(syntheticDemoTimeline('unknown', true), []);
  });

  test('adapts fixtures to production lookup, relationship, and case component contracts', () => {
    const lookup = syntheticDemoLookupView('credential-lure');
    assert.equal(lookup.assessment.risk.score, 78);
    assert.equal(lookup.registry.rdapParsed.domain, 'northstar-login.example');
    assert.equal(lookup.dns.rows[0].label, 'Nameservers');
    assert.equal(lookup.http.attempts[0].detail, 'Synthetic fixture; no connection was attempted');
    assert.equal(lookup.tls.alternativeNames.length, 2);
    assert.equal(syntheticDemoLookupView('unknown'), null);

    const relationships = syntheticDemoRelationshipGroups();
    assert.equal(relationships.length, 1);
    assert.deepEqual(relationships[0].domains, ['northstar-login.example', 'northstarr.example']);

    const record = syntheticDemoCaseRecord(completeState());
    assert.equal(record.domain, 'northstar-login.example');
    assert.equal(record.evidenceHistory.length, 2);
    assert.notEqual(record.evidenceHistory[0].firstCapturedAt, record.evidenceHistory[0].capturedAt);
    assert.equal(syntheticDemoCaseRecord(createSyntheticDemoState()), null);
  });
});

describe('synthetic demo export', () => {
  test('builds an explicitly synthetic deterministic package', () => {
    const payload = buildSyntheticDemoExport(completeState(), '2026-07-14T01:02:03.000Z');
    assert.equal(payload.schema, SYNTHETIC_DEMO_EXPORT_SCHEMA);
    assert.equal(payload.version, SYNTHETIC_DEMO_EXPORT_VERSION);
    assert.equal(payload.synthetic, true);
    assert.equal(payload.generatedAt, '2026-07-14T01:02:03.000Z');
    assert.equal(payload.case.domain, 'northstar-login.example');
    assert.equal(payload.timeline.length, 2);
    assert.equal(payload.provenance.source, 'Certificate Transparency');
    assert.match(payload.warning, /Synthetic demonstration data only/);
    assert.ok(payload.limitations.every((item) => /fixture|request|live assessment/i.test(item)));
  });

  test('does not mutate state or shared fixtures', () => {
    const state = completeState();
    const before = structuredClone(state);
    const payload = buildSyntheticDemoExport(state, '2026-07-14T01:02:03.000Z');
    payload.assessment.signals.push('Changed export');
    payload.evidence.dns.nameservers.push('changed.invalid');
    payload.timeline[1].changes[0].field = 'Changed timeline';
    assert.deepEqual(state, before);
    assert.equal(SYNTHETIC_DEMO_CANDIDATES[0].signals.includes('Changed export'), false);
    assert.equal(SYNTHETIC_DEMO_CANDIDATES[0].evidence.dns.nameservers.includes('changed.invalid'), false);
    assert.equal(SYNTHETIC_DEMO_CANDIDATES[0].observations[2].riskScore, 86);
  });

  test('refuses incomplete state and malformed timestamps', () => {
    assert.throws(() => buildSyntheticDemoExport(createSyntheticDemoState(), '2026-07-14T00:00:00.000Z'), /Complete the monitored synthetic case/);
    assert.throws(() => buildSyntheticDemoExport(completeState({ followUpReady: false }), '2026-07-14T00:00:00.000Z'), /Complete the monitored synthetic case/);
    assert.throws(() => buildSyntheticDemoExport(completeState(), 'not-a-date'), /valid export timestamp/);
    assert.throws(() => buildSyntheticDemoExport(completeState(), `2026-07-14T00:00:00.000Z\n`), /valid export timestamp/);
  });
});
