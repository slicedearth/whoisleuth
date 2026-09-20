import assert from 'node:assert/strict';
import test from 'node:test';
import { readObservationTime } from '../packages/evidence/observation.mts';
import { buildLookupEvidenceQualityMatrix } from '../frontend/src/lib/analysis/lookup-decision-support.ts';
import { buildLookupSourceRefreshPlan } from '../frontend/src/lib/analysis/lookup-source-refresh.ts';
import { buildEvidenceCoverageLedger } from '../frontend/src/lib/analysis/evidence-coverage-ledger.ts';
import { buildLookupObservationProjection } from '../frontend/src/lib/analysis/lookup-route-projections.ts';
import { createLookupViewModel, type LookupHttpResponse } from '../lib/lookup-response-contract.mts';

const NOW = '2026-07-30T00:00:00.000Z';

test('source age uses explicit calendar-valid timestamps and never clamps a future observation to current', () => {
  assert.deepEqual(readObservationTime('2026-07-28T10:00:00+10:00', NOW), {
    observedAt: '2026-07-28T00:00:00.000Z', ageDays: 2,
  });
  for (const value of [null, '', 0, '2026-02-30T00:00:00Z', '2026-07-29T00:00:00', '2026-07-29']) {
    assert.deepEqual(readObservationTime(value, NOW), { observedAt: null, ageDays: null });
  }
  assert.deepEqual(readObservationTime('2026-07-31T00:00:00Z', NOW), {
    observedAt: '2026-07-31T00:00:00.000Z', ageDays: null,
  });
  assert.equal(readObservationTime(NOW, 'invalid').ageDays, null);
});

test('missing and mixed source times do not borrow the envelope clock or invent a superseded cohort', () => {
  const coverage = buildEvidenceCoverageLedger([
    { id: 'rdap', label: 'Registry', category: 'registry', status: 'complete' },
    { id: 'http', label: 'HTTP', category: 'web', status: 'complete' },
    { id: 'tls', label: 'TLS', category: 'web', status: 'complete' },
  ]);
  const sourceTimes = { http: '2026-07-01T00:00:00.000Z', tls: '2026-07-31T00:00:00.000Z' };
  const plan = buildLookupSourceRefreshPlan(coverage, NOW, NOW, { observedAtByEvidence: sourceTimes });
  assert.equal(plan.stale, true);
  assert.deepEqual(plan.items.map((item) => [item.id, item.reason, item.ageDays, item.supersedesObservedAt]), [
    ['rdap', 'limited', null, null], ['availability', 'limited', null, null],
  ]);
  assert.match(plan.limitations.join(' '), /observation times.*unknown/u);
  const quality = buildLookupEvidenceQualityMatrix({
    coverage, refreshPlan: plan, timing: null, observedAt: NOW, observedAtByEvidence: sourceTimes, now: NOW,
  });
  assert.deepEqual(quality.entries.map((entry) => [entry.id, entry.observedAt, entry.ageDays]), [
    ['rdap', null, null],
    ['http', '2026-07-01T00:00:00.000Z', 29],
    ['tls', '2026-07-31T00:00:00.000Z', null],
  ]);
  const missing = buildLookupEvidenceQualityMatrix({ coverage, refreshPlan: plan, timing: null, observedAt: NOW, now: NOW });
  assert.ok(missing.entries.every((entry) => entry.observedAt === null && entry.ageDays === null));
});

test('page analysis keeps its own time instead of inheriting a newer HTTP observation', () => {
  const result: LookupHttpResponse = {
    query: 'example.test', type: 'domain', observedAt: NOW,
    rdap: { fetchedAt: '2026-07-02T00:00:00.000Z' }, whois: {}, diagnostics: {},
    availability: {
      state: 'registered',
      http: { observedAt: NOW },
      technologyProfile: { observedAt: '2026-07-01T00:00:00.000Z' },
      pageIdentity: {}, pageRoleProfile: {}, clientBehaviorProfile: {}, securityPosture: {},
    },
  };
  const projected = buildLookupObservationProjection(result, createLookupViewModel(result));
  assert.equal(projected.evidenceObservedAtById.rdap, '2026-07-02T00:00:00.000Z');
  assert.equal(projected.evidenceObservedAtById.http, NOW);
  assert.equal(projected.evidenceObservedAtById.technology, '2026-07-01T00:00:00.000Z');
  for (const id of ['availability', 'page-identity', 'page-role', 'client-behavior', 'security-posture']) {
    assert.equal(projected.evidenceObservedAtById[id], undefined);
  }
  const invalidSource: LookupHttpResponse = {
    ...result, rdap: { fetchedAt: 'invalid' }, diagnostics: { rdap: { fetchedAt: NOW } },
  };
  const invalidProjection = buildLookupObservationProjection(invalidSource, createLookupViewModel(invalidSource));
  assert.equal(readObservationTime(invalidProjection.evidenceObservedAtById.rdap, NOW).ageDays, null);
});

test('missing times do not request unsupported, skipped or merely derived availability work', () => {
  const coverage = buildEvidenceCoverageLedger([
    { id: 'rdap', label: 'Registry', category: 'registry', status: 'complete' },
    { id: 'availability', label: 'Availability decision', category: 'analysis', status: 'complete' },
    { id: 'whois', label: 'WHOIS', category: 'registry', status: 'skipped' },
    { id: 'http', label: 'HTTP', category: 'web', status: 'unsupported' },
  ]);
  const plan = buildLookupSourceRefreshPlan(coverage, NOW, NOW, { observedAtByEvidence: { rdap: NOW } });
  assert.deepEqual(plan.items, []);
  assert.equal(plan.stale, false);
});
