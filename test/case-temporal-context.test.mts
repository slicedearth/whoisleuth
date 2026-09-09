import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCase, currentCaseEvidence, latestCaseEvidence, caseLookupTarget, caseEvidenceTimeline, type CaseEvidenceSnapshot } from '../packages/cases/case-model.mts';
import { buildCaseReport } from '../packages/cases/case-report.mts';
import { buildCaseResponsePacket, buildResponsePacketProfilePreview } from '../packages/cases/case-response-packet.mts';
import { buildRiskCalibrationDatasetExport } from '../packages/investigation/risk-calibration-export.mts';
import { deriveTimeline } from '../frontend/src/lib/analysis/evidence-display.ts';
import { projectCaseLifecycleEvents, serializeCaseLifecycleCalendarEvents } from '../frontend/src/lib/analysis/case-lifecycle-calendar.ts';
import { caseFollowUpSources } from '../packages/cases/case-follow-ups.mts';

const FIRST = '2026-06-01T00:00:00.000Z';
const LATER = '2026-06-02T00:00:00.000Z';
const NOW = '2026-06-05T00:00:00.000Z';
function record() { return createCase({ domain: 'temporal.example', disposition: 'suspicious' }, FIRST); }
function snapshot(id: string, capturedAt: string, riskScore: number): CaseEvidenceSnapshot {
  const value = createCase({ domain: 'temporal.example', evidence: { inputHostname: 'login.temporal.example', availability: 'registered', scanDepth: 'deep', riskScore } }, FIRST).evidenceHistory[0];
  assert.ok(value);
  return { ...value, id, capturedAt, firstCapturedAt: capturedAt };
}

test('latest Case evidence is numeric-time unique and independent of retained input order', () => {
  const older = snapshot('older', FIRST, 20);
  const newest = snapshot('newest', LATER, 80);
  for (const evidenceHistory of [[newest, older], [older, newest]]) {
    assert.equal(latestCaseEvidence({ evidenceHistory })?.id, 'newest');
    assert.equal(caseLookupTarget({ domain: 'temporal.example', evidenceHistory }), 'login.temporal.example');
  }
  const tie = { ...older, capturedAt: '2026-06-02T10:00:00+10:00' };
  for (const evidenceHistory of [[newest, tie], [tie, newest]]) {
    const selection = currentCaseEvidence({ evidenceHistory });
    assert.equal(selection.snapshot, null);
    assert.equal(selection.candidates.length, 2);
    assert.match(selection.limitation ?? '', /share the latest capture time/);
    assert.equal(caseLookupTarget({ domain: 'temporal.example', evidenceHistory }), 'temporal.example');
  }
  for (const capturedAt of ['', '2026-02-31T00:00:00Z', '2026-06-02']) {
    const evidenceHistory = [newest, { ...older, capturedAt }];
    assert.equal(latestCaseEvidence({ evidenceHistory }), null);
    assert.match(currentCaseEvidence({ evidenceHistory }).limitation ?? '', /unknown capture time/);
  }
  assert.equal(currentCaseEvidence(record()).limitation, null);
});

test('timeline retains equal-time snapshots without inventing a before/after or a tied baseline', () => {
  const first = snapshot('a', FIRST, 10);
  const peer = snapshot('b', FIRST, 90);
  const after = snapshot('c', LATER, 40);
  for (const history of [[peer, after, first], [first, peer, after]]) {
    const timeline = caseEvidenceTimeline(history);
    assert.deepEqual(timeline.map((entry) => entry.snapshot.id), ['a', 'b', 'c']);
    assert.ok(timeline.every((entry) => entry.changes === null && !entry.isBaseline));
    assert.ok(timeline.every((entry) => entry.orderingLimitation?.includes('Equal-time')));
    assert.deepEqual(deriveTimeline(history).map((entry) => entry.snapshot.id), ['c', 'b', 'a']);
  }
  const unique = caseEvidenceTimeline([after, first]);
  assert.equal(unique[0]?.isBaseline, true);
  assert.equal(unique[1]?.orderingLimitation, null);
  const undated = caseEvidenceTimeline([{ ...peer, capturedAt: '' }, { ...first, capturedAt: '' }]);
  assert.deepEqual(undated.map((entry) => entry.snapshot.id), ['a', 'b']);
  assert.ok(undated.every((entry) => entry.changes === null && entry.hasIncomparableChange));
  assert.deepEqual(caseEvidenceTimeline([{ ...peer, id: 'a' }, { ...first, id: 'Z' }]).map((entry) => entry.snapshot.id), ['Z', 'a']);
});

test('report and calibration never label ambiguous retained material as no captured evidence', () => {
  const value = { ...record(), evidenceHistory: [snapshot('a', FIRST, 10), snapshot('b', FIRST, 90)] };
  const report = buildCaseReport(value, { generatedAt: NOW });
  assert.equal(report.json.currentAssessment, null);
  assert.equal(report.json.evidenceTimeline.length, 2);
  assert.ok(report.json.evidenceTimeline.every((entry) => entry.changes === null));
  assert.match(report.markdown, /no unique latest assessment/i);
  assert.doesNotMatch(report.markdown, /No evidence captured/);
  assert.match(report.json.limitations, /share the latest capture time/);
  assert.throws(() => buildRiskCalibrationDatasetExport([value], [value.id]), /Cannot export calibration evidence.*share the latest capture time/);
});

test('response packets require an explicit clock when default Case evidence is ambiguous', async () => {
  const value = { ...record(), evidenceHistory: [snapshot('a', FIRST, 10), snapshot('b', FIRST, 90)] };
  const input = { profile: 'internal_soc', category: 'Phishing', affectedParty: 'Example organisation', abusiveUrls: ['https://login.temporal.example/'], observedHarm: 'An analyst recorded a credential form.' };
  assert.ok(buildResponsePacketProfilePreview(value, input).missingEvidence.includes('Observation time'));
  await assert.rejects(buildCaseResponsePacket(value, input, NOW), /observation time/);
  const packet = await buildCaseResponsePacket(value, { ...input, observedAt: FIRST }, NOW);
  assert.equal(packet.json.incident.observedAt, FIRST);
});

test('calendar dates require latest-cohort agreement and never fall back through a newer unknown', () => {
  const value = record();
  const old = { ...snapshot('a', FIRST, 10), expiryDate: '2027-01-01T00:00:00.000Z' };
  const newer = { ...snapshot('b', LATER, 90), expiryDate: '2027-03-01T00:00:00.000Z' };
  for (const history of [[newer, old], [old, newer]]) {
    const result = projectCaseLifecycleEvents([{ ...value, evidenceHistory: history }], { window: 'all' }, NOW);
    assert.deepEqual(result.events.map((event) => event.startsAt), ['2027-01-30T00:00:00.000Z']);
    assert.equal(result.dateLimitations.length, 0);
  }
  for (const candidate of [{ ...newer, expiryDate: null }, { ...newer, capturedAt: '2027-01-01T00:00:00.000Z' }, { ...newer, capturedAt: '' }]) {
    const result = projectCaseLifecycleEvents([{ ...value, evidenceHistory: [candidate, old] }], { window: 'all' }, NOW);
    assert.equal(result.events.length, 0);
    assert.equal(result.dateLimitations.length, 1);
  }
  const peer = { ...old, capturedAt: LATER };
  const conflict = projectCaseLifecycleEvents([{ ...value, evidenceHistory: [peer, newer] }], { window: 'all' }, NOW);
  assert.equal(conflict.events.length, 0);
  assert.match(conflict.dateLimitations[0]?.detail ?? '', /disagree/);
  const consensus = projectCaseLifecycleEvents([{ ...value, evidenceHistory: [{ ...peer, expiryDate: newer.expiryDate }, newer] }], { window: 'all' }, NOW);
  assert.equal(consensus.events.length, 1);
  assert.equal(consensus.dateLimitations.length, 0);
});

test('active follow-up and calendar views share the same policy while historical inclusion remains explicit', () => {
  const value = record();
  value.observedEffects.reviews = [{ id: 'old', state: 'not_checked', observedAt: FIRST, sourceClass: 'analyst', source: 'Private review', completeness: 'unknown', limitations: [], evidencePinId: null, sightingId: null, followUpAt: '2026-06-10T00:00:00.000Z', createdAt: FIRST }];
  value.observedEffects.reviews.push({ ...value.observedEffects.reviews[0]!, id: 'latest', observedAt: LATER, followUpAt: null });
  assert.deepEqual(caseFollowUpSources(value).reviews.map((review) => review.id), ['latest']);
  assert.equal(projectCaseLifecycleEvents([value], { window: 'all' }, NOW).events.length, 0);
  const historical = projectCaseLifecycleEvents([value], { window: 'all', includeHistorical: true }, NOW);
  assert.equal(historical.events.length, 1);
  const calendar = serializeCaseLifecycleCalendarEvents(historical.events, {}, NOW);
  assert.doesNotMatch(calendar, /temporal\.example|Private review|not_checked/);
  const sensitive = [{ ...historical.events[0]!, uid: 'private-owner@example.test-sensitive-action' }];
  const privateCalendar = serializeCaseLifecycleCalendarEvents(sensitive, {}, NOW);
  assert.doesNotMatch(privateCalendar, /private-owner|sensitive-action/);
  assert.match(privateCalendar.replaceAll(/\r\n[ \t]/gu, ''), /UID:[a-f0-9]{64}@whoisleuth\.local/);
  assert.equal(privateCalendar, serializeCaseLifecycleCalendarEvents(sensitive, {}, NOW));
});

test('calendar pin dates use source observation time rather than when the analyst saved a pin', () => {
  const value = record();
  for (const [field, kind] of [['tls.valid_to', 'certificate_expiry_review'], ['disclosure.security_txt_expires', 'disclosure_expiry_review']] as const) {
    const older = {
      id: 'older-pin', checkpointId: null, field, category: 'evidence', label: 'Retained expiry',
      value: '2027-01-01T00:00:00.000Z', source: 'Retained fixture', sourceState: 'success', sourceSchema: null,
      observedAt: FIRST, collectionDepth: 'deep', completeness: 'complete', truncated: false,
      transitionExpectation: null, limitations: [], createdAt: NOW,
    } as const;
    const newer = { ...older, id: 'newer-pin', observedAt: LATER, createdAt: LATER, value: '2027-03-01T00:00:00.000Z' };
    for (const pins of [[older, newer], [newer, older]]) {
      const result = projectCaseLifecycleEvents([{ ...value, evidencePins: pins.map((pin) => ({ ...pin, limitations: [] })) }], { window: 'all' }, NOW);
      assert.equal(result.events.length, 1);
      assert.equal(result.events[0]?.kind, kind);
      assert.equal(result.events[0]?.startsAt, kind === 'certificate_expiry_review' ? '2027-01-30T00:00:00.000Z' : '2027-02-15T00:00:00.000Z');
    }
    const unknown = { ...newer, observedAt: '', limitations: [] };
    const result = projectCaseLifecycleEvents([{ ...value, evidencePins: [{ ...older, limitations: [] }, unknown] }], { window: 'all' }, NOW);
    assert.equal(result.events.length, 0);
    assert.match(result.dateLimitations[0]?.detail ?? '', /capture time is unknown/);
  }
});
