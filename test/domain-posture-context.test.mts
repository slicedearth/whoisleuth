import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeDomainPostureProfileContext, normalizeDomainPostureSourceContext, postureTransferRestriction } from '../packages/evidence/domain-posture-context.mts';
import { canonicalPostureRecords } from '../packages/evidence/domain-control-runtime.mts';
import { brandPostureObservationContext, currentDesiredPostureObservation, normalizeBrandProfile, normalizeDesiredPostureObservationHistory, type DesiredPostureObservation } from '../packages/workspace/brand-profile-model.mts';
import { buildDesiredPostureComparisonsFromObservation, buildDesiredPostureHistory, buildDesiredPostureObservation } from '../frontend/src/lib/analysis/owned-domain-posture-review.ts';
import { buildDomainPostureMatrix } from '../frontend/src/lib/analysis/domain-posture-matrix.ts';
import { buildDomainControlCentre } from '../frontend/src/lib/analysis/domain-control-centre.ts';
import type { DomainPostureHttpResponse } from '../frontend/src/lib/analysis/client-response-contracts.ts';
import { postureSource } from './posture-observation-fixture.mts';
import { requiredValue } from './value-assertions.mts';
import { buildLocalAnalystReviewProjection } from '../frontend/src/lib/analysis/analyst-review-local-projections.ts';
import { analystReviewAgeAt, analystReviewCanResolve, analystReviewLifecycle, emptyAnalystReviewStateStore, setAnalystReviewDecision } from '../packages/monitoring/analyst-review-state.mts';

const BEFORE = '2026-08-09T00:00:00.000Z';
const CAPTURE = '2026-08-10T00:00:00.000Z';
const NOW = '2026-08-11T00:00:00.000Z';
const profile = requiredValue(normalizeBrandProfile({
  id: 'posture-profile', name: 'Fixture profile', officialDomains: ['example.test'],
  desiredPostureBaselines: [{ domain: 'example.test', nameservers: ['ns1.example.test'], mx: ['0 .'], caa: ['0 iodef "https://reports.example/Case"'], registrarLock: 'required', renewalReviewAt: NOW, updatedAt: BEFORE }],
  createdAt: BEFORE, updatedAt: BEFORE,
}, { nowIso: BEFORE }));
const baseline = requiredValue(profile.desiredPostureBaselines[0]);
const context = brandPostureObservationContext(profile, 'example.test');

function observation(overrides: Partial<DesiredPostureObservation> = {}): DesiredPostureObservation {
  return { observedAt: CAPTURE, context, checks: [
    { id: 'nameservers', status: 'pass', records: ['NS1.EXAMPLE.TEST.'], sourceContext: postureSource('dns_ns', CAPTURE) },
    { id: 'mx', status: 'pass', records: ['0 .'], sourceContext: postureSource('dns_mx', CAPTURE) },
    { id: 'caa', status: 'pass', records: ['0 iodef "https://reports.example/Case"'], sourceContext: postureSource('dns_caa', CAPTURE) },
    { id: 'registration_lock', status: 'pass', records: ['client transfer prohibited'], sourceContext: postureSource('registry_rdap', CAPTURE) },
  ], ...overrides };
}

function comparisons(value: DesiredPostureObservation, now: unknown = NOW) {
  return buildDesiredPostureComparisonsFromObservation(baseline, value, now, { context });
}

test('qualified source records compare with canonical DNS syntax and preserve null MX', () => {
  const result = comparisons(observation());
  assert.equal(result.find((row) => row.field === 'nameservers')?.state, 'aligned');
  assert.equal(result.find((row) => row.field === 'mx')?.state, 'aligned');
  assert.deepEqual(result.find((row) => row.field === 'mx')?.observed, ['0 .']);
  assert.equal(result.find((row) => row.field === 'registrarLock')?.state, 'aligned');
  assert.equal(canonicalPostureRecords('mx', ['broken']), null);
  assert.equal(canonicalPostureRecords('caa', ['0 iodef "https://reports.example/Case"'])?.[0], '0 iodef https://reports.example/Case');
});

for (const [label, modify] of [
  ['legacy context', (value: DesiredPostureObservation) => { delete value.context; }],
  ['different profile', (value: DesiredPostureObservation) => { value.context = { ...context, profileId: 'other-profile' }; }],
  ['different target', (value: DesiredPostureObservation) => { value.context = { ...context, domain: 'other.test' }; }],
  ['different collection settings', (value: DesiredPostureObservation) => { value.context = { ...context, profileFingerprint: '0'.repeat(64) }; }],
  ['omitted checks', (value: DesiredPostureObservation) => { value.omittedChecks = 1; }],
  ['duplicate check ids', (value: DesiredPostureObservation) => { value.checks.push(value.checks[0]!); }],
  ['missing capture time', (value: DesiredPostureObservation) => { value.observedAt = ''; }],
  ['future capture time', (value: DesiredPostureObservation) => { value.observedAt = '2027-01-01T00:00:00.000Z'; }],
] as const) test(`${label} cannot establish alignment`, () => {
  const value = observation(); modify(value);
  assert.equal(comparisons(value).find((row) => row.field === 'nameservers')?.state, 'unknown');
});

for (const [label, source] of [
  ['missing source context', undefined],
  ['unknown source time', { ...postureSource('dns_ns', CAPTURE), observedAt: null }],
  ['wrong source', postureSource('dns_mx', CAPTURE)],
  ['source after capture', postureSource('dns_ns', NOW)],
  ['partial source', postureSource('dns_ns', CAPTURE, 'partial')],
  ['unavailable source', postureSource('dns_ns', CAPTURE, 'unavailable')],
  ['omitted record', { ...postureSource('dns_ns', CAPTURE), omittedRecords: 1 }],
] as const) test(`${label} does not become drift or alignment`, () => {
  const value = observation();
  if (source) value.checks[0]!.sourceContext = source;
  else delete value.checks[0]!.sourceContext;
  const row = comparisons(value).find((item) => item.field === 'nameservers');
  assert.equal(row?.state, 'unknown');
  assert.deepEqual(row?.observed, ['NS1.EXAMPLE.TEST.']);
});

test('invalid review time stays unknown instead of using profile metadata', () => {
  const result = comparisons(observation(), 'invalid');
  assert.equal(result.find((row) => row.field === 'nameservers')?.state, 'unknown');
  assert.equal(result.find((row) => row.field === 'renewalReviewAt')?.state, 'unknown');
  const matrix = buildDomainPostureMatrix(profile, 'invalid');
  assert.equal(matrix.generatedAt, '');
});

test('approved windows use the source time rather than report completion', () => {
  const value = observation();
  value.checks[0]!.records = ['ns2.example.test'];
  value.checks[0]!.sourceContext = postureSource('dns_ns', BEFORE);
  const result = buildDesiredPostureComparisonsFromObservation({ ...baseline, approvedChangeWindows: [{ id: 'window', startsAt: CAPTURE, endsAt: NOW, summary: 'Reviewed change' }] }, value, NOW, { context });
  assert.equal(result[0]?.state, 'drift');
  assert.equal(result[0]?.approvedWindowSummary, '');
});

test('history compares source records, not check badges or lowercased CAA payloads', () => {
  const before = observation({ observedAt: BEFORE });
  for (const check of before.checks) check.sourceContext = { ...check.sourceContext!, observedAt: BEFORE };
  const current = observation();
  current.checks[0]!.status = 'warning';
  current.checks[2]!.records = ['0 iodef "https://reports.example/case"'];
  const history = buildDesiredPostureHistory([current, before], NOW);
  assert.deepEqual(history[0]?.changedChecks, ['caa']);
  assert.equal(history[0]?.comparableChecks, 4);
  assert.equal(history[0]?.unknownChecks, 0);
  current.checks[0]!.sourceContext = { ...current.checks[0]!.sourceContext!, observedAt: BEFORE };
  assert.equal(buildDesiredPostureHistory([before, current], NOW)[0]?.unknownChecks, 1);
});

test('distinct equal-time and undated observations survive retention without an arbitrary latest selection', () => {
  const first = observation();
  const second = observation(); second.checks[0]!.records = ['ns2.example.test'];
  const history = normalizeDesiredPostureObservationHistory([second, first, first], null);
  assert.equal(history.length, 2);
  assert.deepEqual(history, normalizeDesiredPostureObservationHistory([first, second], null));
  const ambiguous = { ...baseline, observationHistory: history, previousObservation: null };
  assert.equal(currentDesiredPostureObservation(ambiguous).observation, null);
  assert.match(currentDesiredPostureObservation(ambiguous).limitation!, /share the latest capture time/);
  const owner = { ...profile, desiredPostureBaselines: [ambiguous] };
  assert.equal(buildDomainControlCentre(owner, NOW).counts.retainedObservations, 1);
  const matrix = buildDomainPostureMatrix(owner, NOW);
  assert.equal(matrix.observationCount, 1);
  assert.equal(matrix.rows[0]?.observationAt, null);
  assert.equal(matrix.rows[0]?.cells[0]?.state, 'unknown');
  assert.ok(matrix.rows[0]?.cells[0]?.observationHref);
  assert.equal(buildDesiredPostureHistory(history, NOW)[0]?.comparableChecks, 0);
  const undated = normalizeDesiredPostureObservationHistory([first, observation({ observedAt: '' })], null);
  assert.equal(undated.length, 2);
  assert.equal(currentDesiredPostureObservation({ ...baseline, observationHistory: undated }).observation, null);
});

test('all 64 admitted records survive report retention and excess records remain qualified', () => {
  const records = Array.from({ length: 64 }, (_, index) => `ns${index}.example.test`);
  const report = { checkedAt: CAPTURE, checks: [{ id: 'nameservers', status: 'pass', records, sourceContext: postureSource('dns_ns', CAPTURE) }] } as DomainPostureHttpResponse;
  const captured = buildDesiredPostureObservation(report, context);
  assert.equal(captured.checks[0]?.records.length, 64);
  assert.equal(normalizeDesiredPostureObservationHistory([captured], null)[0]?.checks[0]?.records.length, 64);
  report.checks[0]!.records.push('ns64.example.test');
  const capped = buildDesiredPostureObservation(report, context);
  assert.equal(capped.checks[0]?.sourceContext?.state, 'partial');
  assert.equal(capped.checks[0]?.sourceContext?.omittedRecords, 1);
});

test('declared future context fails closed while legacy context stays absent', () => {
  assert.equal(normalizeDomainPostureSourceContext(undefined), undefined);
  assert.equal(normalizeDomainPostureProfileContext(undefined), undefined);
  assert.throws(() => normalizeDomainPostureSourceContext({ ...postureSource('dns_ns', CAPTURE), version: 2 }), /unsupported/);
  assert.throws(() => normalizeDomainPostureProfileContext({ ...context, version: 2 }), /unsupported/);
  assert.throws(() => normalizeDomainPostureSourceContext({ ...postureSource('dns_ns', CAPTURE), omittedRecords: null }), /invalid/);
  const future = { ...observation(), context: { ...context, version: 2 } };
  assert.throws(() => normalizeDesiredPostureObservationHistory([future], null), /unsupported/);
});

test('transfer status requires an exact token and does not infer unlocked from an empty inventory', () => {
  assert.equal(postureTransferRestriction([]), null);
  assert.equal(postureTransferRestriction(['ok']), 'not_required');
  assert.equal(postureTransferRestriction(['notclienttransferprohibited']), 'not_required');
  assert.equal(postureTransferRestriction(['servertransferprohibited']), 'required');
});

test('review inbox preserves source gaps and never infers baseline drift from a warning badge', () => {
  const legacy = observation();
  delete legacy.context;
  delete legacy.checks[0]!.sourceContext;
  legacy.checks[0]!.status = 'warning';
  const owner = { ...profile, desiredPostureBaselines: [{ ...baseline, observationHistory: [legacy] }] };
  const result = buildLocalAnalystReviewProjection({ profiles: [owner] }, NOW);
  const row = requiredValue(result.items.find((value) => value.kind === 'desired_posture' && value.title.includes('nameservers')));
  assert.equal(row.observedAt, '');
  assert.equal(row.age, 'unknown');
  assert.equal(row.completeness, 'partial');
  assert.doesNotMatch(row.detail, /differs from/);
  assert.equal(analystReviewCanResolve(row), false);
  assert.throws(() => setAnalystReviewDecision(emptyAnalystReviewStateStore(), { ...row, completeness: 'complete' }, {
    disposition: 'resolved', rationale: 'Missing source time cannot close review.', reviewedAt: NOW,
  }), /evidence cannot resolve/);
  const formerlyCurrent = { ...row, age: 'current' as const, completeness: 'complete' as const, observedAt: CAPTURE };
  const stored = setAnalystReviewDecision(emptyAnalystReviewStateStore(), formerlyCurrent, { disposition: 'resolved', rationale: 'Reviewed complete retained source.', reviewedAt: NOW });
  assert.equal(analystReviewLifecycle(row, stored, NOW).effectiveDisposition, 'open');
});

test('review ages reject missing, invalid and future dates without a machine-clock fallback', () => {
  assert.equal(analystReviewAgeAt('', NOW), 'unknown');
  assert.equal(analystReviewAgeAt('2026-02-30T00:00:00.000Z', NOW), 'unknown');
  assert.equal(analystReviewAgeAt(NOW, BEFORE), 'unknown');
  assert.equal(analystReviewAgeAt(CAPTURE, ''), 'unknown');
  assert.equal(analystReviewAgeAt(CAPTURE, NOW), 'current');
  assert.equal(analystReviewAgeAt('2026-08-01T00:00:00.000Z', NOW), 'aging');
  assert.equal(analystReviewAgeAt('2026-07-01T00:00:00.000Z', NOW), 'stale');
});
