import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildDomainControlManifest, reviewDomainControlManifest, validateDomainControlReviewDocument, verifyDomainControlManifest } from '../lib/domain-control-manifest.mts';
import { canonicalDomainControlRecords, domainControlRecordMode, normalizeDomainControlRecordModes, serializeDomainControlManifest } from '../packages/evidence/domain-control-runtime.mts';
import { applyVerifiedDomainControlPassport, buildBrandProfilePassportInput, buildDomainControlPassport, passportConfiguredFields, passportFieldSummary, verifyDomainControlPassport } from '../packages/workspace/domain-control-passport.mts';
import { DOMAIN_CONTROL_RECORD_LIST_FIELDS, type DomainControlRecordField } from '../packages/contracts/domain-control-manifest.mts';
import { normalizeBrandProfile, brandPostureObservationContext, normalizeBrandProfileStore, serializeBrandProfileStore } from '../packages/workspace/brand-profile-model.mts';
import { buildDomainPostureMatrix } from '../frontend/src/lib/analysis/domain-posture-matrix.ts';
import { buildDomainControlCentre } from '../frontend/src/lib/analysis/domain-control-centre.ts';
import { requiredValue } from './value-assertions.mts';
import { postureSource } from './posture-observation-fixture.mts';
import type { DomainControlReviewObservationField } from '../packages/contracts/domain-control-review.mts';

const AT = '2026-08-03T00:00:00.000Z';
const EMPTY = { nameservers: [], ds: [], mx: [], caa: [] };
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8');
const input = () => JSON.parse(fixture('domain-control-manifest-input-v2'));

test('current manifests preserve all four explicit modes across browser and CLI runtimes', async () => {
  const current = buildDomainControlManifest(input(), AT);
  assert.equal(current.version, 3);
  assert.deepEqual(current.entries[0]?.recordModes, { nameservers: 'expect_records', ds: 'unconfigured', mx: 'expect_none', caa: 'observe_only' });
  assert.equal(serializeDomainControlManifest(current), fixture('domain-control-manifest-v3'));
  assert.deepEqual(await buildDomainControlPassport(input(), AT), current);
  assert.deepEqual(await verifyDomainControlPassport(current, AT), current);
  assert.deepEqual(verifyDomainControlManifest(current), current);
});

test('public manifest bytes remain independently verifiable without stronger empty-field intent', async () => {
  const raw = fixture('domain-control-manifest-v2');
  const publicDocument = JSON.parse(raw);
  const verified = verifyDomainControlManifest(publicDocument);
  assert.equal(verified.version, 2);
  assert.equal(serializeDomainControlManifest(verified), raw);
  assert.deepEqual(await verifyDomainControlPassport(publicDocument, AT), verified);
  assert.equal(Object.hasOwn(verified.entries[0]!, 'recordModes'), false);
  assert.deepEqual(normalizeDomainControlRecordModes(undefined, EMPTY), { nameservers: 'unconfigured', ds: 'unconfigured', mx: 'unconfigured', caa: 'unconfigured' });
  const legacy = JSON.parse(fixture('domain-control-manifest-input-v1'));
  legacy.entries[0].mx = [];
  const converted = buildDomainControlManifest(legacy, AT);
  assert.equal(domainControlRecordMode(converted.entries[0]!, 'mx'), 'unconfigured');
  legacy.entries[0].recordModes = { mx: 'expect_none' };
  assert.throws(() => buildDomainControlManifest(legacy, AT), /unknown field/);
});

test('mode changes are integrity-covered and unsupported formats fail closed', () => {
  const current = buildDomainControlManifest(input(), AT);
  const changed = { ...current, entries: current.entries.map((entry) => ({ ...entry, recordModes: { ...entry.recordModes, mx: 'observe_only' } })) };
  assert.throws(() => verifyDomainControlManifest(changed), /integrity check/);
  assert.throws(() => verifyDomainControlManifest({ ...current, version: 4 }), /unsupported/);
  assert.throws(() => buildDomainControlManifest({ ...input(), version: 3 }, AT), /version/);
});

for (const field of DOMAIN_CONTROL_RECORD_LIST_FIELDS) {
  test(`${field} modes reject conflicting records, malformed values and unknown modes`, () => {
    for (const mode of ['unconfigured', 'expect_none', 'observe_only']) {
      assert.throws(() => normalizeDomainControlRecordModes({ [field]: mode }, { ...EMPTY, [field]: ['value'] }), /requires records only/);
    }
    assert.throws(() => normalizeDomainControlRecordModes({ [field]: 'expect_records' }, EMPTY), /requires records only/);
    for (const mode of ['future', null, undefined, false]) assert.throws(() => normalizeDomainControlRecordModes({ [field]: mode }, EMPTY), /unsupported/);
    assert.throws(() => canonicalDomainControlRecords(['malformed record'], field), /invalid record/);
  });
}

test('current record admission retains complete 64-record sets without a 32-record prefix', () => {
  const records: Record<DomainControlRecordField, string[]> = {
    nameservers: Array.from({ length: 64 }, (_, i) => `ns${i}.example.test`),
    ds: Array.from({ length: 64 }, (_, i) => `${i} 13 2 abcdef`),
    mx: Array.from({ length: 64 }, (_, i) => `${i} mail${i}.example.test`),
    caa: Array.from({ length: 64 }, (_, i) => `0 iodef "https://reports.example/Case${i}"`),
  };
  const value = input();
  value.entries[0] = { domain: 'example.test', ...records };
  const current = buildDomainControlManifest(value, AT);
  for (const field of DOMAIN_CONTROL_RECORD_LIST_FIELDS) {
    assert.equal(current.entries[0]![field].length, 64);
    assert.equal(verifyDomainControlManifest(current).entries[0]![field].length, 64);
    assert.throws(() => canonicalDomainControlRecords([...records[field], 'malformed record'], field), /invalid record/);
  }
  value.entries[0].nameservers.push('ns64.example.test');
  assert.throws(() => buildDomainControlManifest(value, AT), /exceeds 64 records/);
});

test('null MX is an explicit record, not an empty mail expectation', () => {
  const value = input();
  value.entries[0].mx = ['0 .'];
  assert.throws(() => buildDomainControlManifest(value, AT), /requires records only/);
  value.entries[0].recordModes.mx = 'expect_records';
  const result = buildDomainControlManifest(value, AT);
  assert.deepEqual(result.entries[0]!.mx, ['0 .']);
  assert.equal(domainControlRecordMode(result.entries[0]!, 'mx'), 'expect_records');
});

function brand() {
  return requiredValue(normalizeBrandProfile({
    id: 'record-expectations', name: 'Example profile', officialDomains: ['example.test'],
    desiredPostureBaselines: [{ domain: 'example.test', ...EMPTY, recordModes: { nameservers: 'observe_only', ds: 'expect_none', mx: 'expect_none', caa: 'unconfigured' }, updatedAt: AT }],
    createdAt: AT, updatedAt: AT,
  }, { nowIso: AT }));
}

test('explicit expectations survive browser storage, export and selected-field import', async () => {
  const source = brand();
  const stored = normalizeBrandProfileStore(JSON.parse(serializeBrandProfileStore([source])));
  assert.deepEqual(stored.profiles[0]?.desiredPostureBaselines[0]?.recordModes, source.desiredPostureBaselines[0]?.recordModes);
  const passport = await buildDomainControlPassport(buildBrandProfilePassportInput(source, ['example.test'], '2026-09-03T00:00:00.000Z'), AT);
  const entry = requiredValue(passport.entries[0]);
  assert.deepEqual(passportConfiguredFields(entry), ['nameservers', 'ds', 'mx']);
  assert.match(passportFieldSummary(entry, 'mx'), /Expect no records/);
  const destination = brand();
  destination.desiredPostureBaselines[0]!.mx = ['10 mail.example.test'];
  destination.desiredPostureBaselines[0]!.recordModes = { nameservers: 'unconfigured', ds: 'unconfigured', mx: 'expect_records', caa: 'unconfigured' };
  const before = structuredClone(destination);
  const result = await applyVerifiedDomainControlPassport(destination, passport, [{ domain: 'example.test', addOfficialDomain: false, fields: ['mx'] }], AT);
  assert.deepEqual(destination, before);
  assert.deepEqual(result.desiredPostureBaselines[0]?.mx, []);
  assert.equal(result.desiredPostureBaselines[0]?.recordModes?.mx, 'expect_none');
  assert.equal(result.desiredPostureBaselines[0]?.recordModes?.nameservers, 'unconfigured');
  assert.equal(result.desiredPostureBaselines[0]?.recordModes?.ds, 'unconfigured');
  assert.equal(result.desiredPostureBaselines[0]?.recordModes?.caa, 'unconfigured');
});

test('selected-field passport imports preserve undeclared legacy expectations without coercion', async () => {
  const destination = brand();
  const baseline = destination.desiredPostureBaselines[0]!;
  delete baseline.recordModes;
  baseline.ds = ['legacy unparsed delegation note'];
  baseline.caa = ['legacy unparsed certificate policy'];
  const before = structuredClone(baseline);
  const passport = await buildDomainControlPassport(input(), AT);
  const result = await applyVerifiedDomainControlPassport(destination, passport, [{ domain: 'example.test', addOfficialDomain: false, fields: ['mx'] }], AT);
  const saved = result.desiredPostureBaselines[0]!;
  assert.deepEqual(saved.ds, before.ds);
  assert.deepEqual(saved.caa, before.caa);
  assert.deepEqual(saved.recordModes, { mx: 'expect_none' });
  assert.deepEqual(saved.nameservers, before.nameservers);
  assert.deepEqual(destination.desiredPostureBaselines[0], before);
  const roundTrip = normalizeBrandProfileStore(JSON.parse(serializeBrandProfileStore([result])));
  assert.deepEqual(roundTrip.profiles[0]?.desiredPostureBaselines[0]?.caa, before.caa);
  assert.deepEqual(roundTrip.profiles[0]?.desiredPostureBaselines[0]?.recordModes, { mx: 'expect_none' });
});

test('current retained source evidence distinguishes observation, expected absence and unsupported DS', () => {
  const profile = brand();
  const baseline = requiredValue(profile.desiredPostureBaselines[0]);
  baseline.observationHistory = [{ observedAt: AT, context: brandPostureObservationContext(profile, 'example.test'), checks: [
    { id: 'nameservers', status: 'pass', records: ['ns1.example.test'], sourceContext: postureSource('dns_ns', AT) },
    { id: 'mx', status: 'warning', records: [], sourceContext: postureSource('dns_mx', AT) },
  ] }];
  const matrix = buildDomainPostureMatrix(profile, AT);
  const cells = requiredValue(matrix.rows[0]).cells;
  assert.equal(cells.find((cell) => cell.field === 'nameservers')?.state, 'observed');
  assert.deepEqual(cells.find((cell) => cell.field === 'nameservers')?.observed, ['ns1.example.test']);
  assert.equal(cells.find((cell) => cell.field === 'mx')?.state, 'aligned');
  assert.equal(cells.find((cell) => cell.field === 'ds')?.state, 'unsupported');
  assert.equal(cells.find((cell) => cell.field === 'caa')?.state, 'not_configured');
  assert.equal(matrix.stateCounts.observed, 1);
  assert.equal(buildDomainControlCentre(profile, AT).rows[0]?.nameserverPreflight, 'observed');
  assert.equal(buildDomainControlCentre(profile, AT).rows[0]?.baselineFields, 3);
  baseline.observationHistory[0]!.checks[1]!.records = ['0 .'];
  assert.equal(buildDomainPostureMatrix(profile, AT).rows[0]?.cells.find((cell) => cell.field === 'mx')?.state, 'drift');
});

test('partial, missing, old and ambiguous source observations never confirm absence', () => {
  for (const variant of ['missing', 'partial', 'undated', 'future', 'stale', 'conflicting'] as const) {
    const profile = brand();
    const baseline = requiredValue(profile.desiredPostureBaselines[0]);
    const source = { ...postureSource('dns_mx', AT), observedAt: variant === 'undated' ? null : variant === 'future' ? '2026-08-04T00:00:00.000Z' : variant === 'stale' ? '2026-07-01T00:00:00.000Z' : AT };
    baseline.observationHistory = [{ observedAt: AT, context: brandPostureObservationContext(profile, 'example.test'), checks: variant === 'missing' ? [] : [
      { id: 'mx', status: 'pass', records: [], sourceContext: variant === 'partial' ? { ...source, state: 'partial' } : source },
    ] }];
    if (variant === 'conflicting') baseline.observationHistory.push({ ...baseline.observationHistory[0]!, checks: [{ id: 'mx', status: 'pass', records: ['0 .'], sourceContext: source }] });
    const cell = requiredValue(buildDomainPostureMatrix(profile, AT).rows[0]?.cells.find((value) => value.field === 'mx'));
    assert.ok(['unknown', 'unavailable'].includes(cell.state), `${variant}: ${cell.state}`);
  }
});

function coreReview(manifest = buildDomainControlManifest(input(), AT), fields: Partial<Record<DomainControlRecordField, DomainControlReviewObservationField>> = {}) {
  return reviewDomainControlManifest({ schema: 'whoisleuth.domain-control-review-input', version: 2, manifest, observations: [{ domain: 'example.test', fields }] }, AT);
}

test('current offline reviews retain explicit absence and observation-only states', () => {
  const manifest = buildDomainControlManifest(input(), AT);
  const report = coreReview(manifest, {
    nameservers: { state: 'observed', values: ['ns1.example.test'], source: 'Saved DNS NS', observedAt: AT },
    mx: { state: 'observed', values: [], source: 'Saved DNS MX', observedAt: AT },
    caa: { state: 'observed', values: ['0 iodef "https://reports.example/CaseX"'], source: 'Saved DNS CAA', observedAt: AT },
  });
  assert.equal(report.version, 2);
  assert.equal(report.domains[0]?.comparisons.find((value) => value.field === 'mx')?.state, 'aligned');
  assert.equal(report.domains[0]?.comparisons.find((value) => value.field === 'mx')?.expectation, 'expect_none');
  assert.equal(report.domains[0]?.comparisons.find((value) => value.field === 'caa')?.state, 'observed');
  assert.deepEqual(report.domains[0]?.comparisons.find((value) => value.field === 'caa')?.observed, ['0 iodef https://reports.example/CaseX']);
  assert.equal(report.counts.observed, 1);
  assert.deepEqual(validateDomainControlReviewDocument(report), report);
  const drift = coreReview(manifest, { mx: { state: 'observed', values: ['0 .'], source: 'Saved DNS MX', observedAt: AT } });
  assert.equal(drift.domains[0]?.comparisons.find((value) => value.field === 'mx')?.state, 'drift');
});

test('an entirely unconfigured or observation-only review cannot claim alignment', () => {
  const raw = input();
  raw.entries[0] = { domain: 'example.test', ...EMPTY };
  assert.equal(coreReview(buildDomainControlManifest(raw, AT)).state, 'not_configured');
  raw.entries[0].recordModes = { mx: 'observe_only' };
  const report = coreReview(buildDomainControlManifest(raw, AT), { mx: { state: 'observed', values: [], source: 'Saved DNS MX', observedAt: AT } });
  assert.equal(report.state, 'observed');
  assert.equal(report.counts.aligned, 0);
  assert.deepEqual(validateDomainControlReviewDocument(report), report);
});

test('offline expected absence requires complete and currently admissible source evidence', () => {
  for (const state of ['partial', 'unavailable', 'unsupported'] as const) {
    const report = coreReview(undefined, { mx: { state, values: [], source: 'Saved DNS MX', observedAt: AT } });
    assert.equal(report.domains[0]?.comparisons.find((value) => value.field === 'mx')?.state, state);
  }
  for (const observedAt of [null, '2026-08-04T00:00:00.000Z', '2026-07-01T00:00:00.000Z']) {
    const report = coreReview(undefined, { mx: { state: 'observed', values: [], source: 'Saved DNS MX', observedAt } });
    assert.equal(report.domains[0]?.comparisons.find((value) => value.field === 'mx')?.state, 'partial');
  }
  assert.equal(coreReview().domains[0]?.comparisons.find((value) => value.field === 'mx')?.state, 'unavailable');
  assert.throws(() => coreReview(undefined, { mx: { state: 'observed', values: [], source: 'Saved DNS MX', observedAt: '2026-08-03' } }), /invalid observation/);
});

test('review readers preserve independent public bytes and reject current contradictory conclusions', () => {
  const publicRaw = fixture('domain-control-review-v1');
  assert.equal(`${JSON.stringify(validateDomainControlReviewDocument(JSON.parse(publicRaw)), null, 2)}\n`, publicRaw);
  const report = coreReview(undefined, { mx: { state: 'observed', values: [], source: 'Saved DNS MX', observedAt: AT } });
  const raw = JSON.parse(JSON.stringify(report));
  raw.domains[0].comparisons.find((value: { field: string }) => value.field === 'mx').observedAt = null;
  assert.throws(() => validateDomainControlReviewDocument(raw), /source timing/);
  const wrong = JSON.parse(JSON.stringify(report));
  wrong.domains[0].comparisons.find((value: { field: string }) => value.field === 'mx').expectation = 'observe_only';
  assert.throws(() => validateDomainControlReviewDocument(wrong), /expectation is inconsistent/);
  assert.throws(() => validateDomainControlReviewDocument({ ...report, version: 3 }), /version/);
});

test('current offline review preserves and validates every member of a complete 64-record set', () => {
  const raw = input();
  const records = Array.from({ length: 64 }, (_, i) => `${i} mail${i}.example.test`).sort();
  raw.entries[0] = { domain: 'example.test', ...EMPTY, mx: records };
  const report = coreReview(buildDomainControlManifest(raw, AT), { mx: { state: 'observed', values: records, source: 'Saved DNS MX', observedAt: AT } });
  const comparison = requiredValue(report.domains[0]?.comparisons.find((value) => value.field === 'mx'));
  assert.equal(comparison.state, 'aligned');
  assert.deepEqual(comparison.desired, records);
  assert.deepEqual(comparison.observed, records);
  assert.deepEqual(validateDomainControlReviewDocument(report), report);
});
