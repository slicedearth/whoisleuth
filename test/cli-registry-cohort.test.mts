import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRegistryCohortReport,
  formatRegistryCohortReport,
  LEGACY_REGISTRY_COHORT_VERSION,
  MAX_REGISTRY_COHORT_INPUT_POINTS,
  MAX_REGISTRY_COHORT_SAMPLES,
  MAX_REGISTRY_COHORT_TIMELINE_POINTS,
  MIN_REGISTRY_COHORT_SAMPLE,
  REGISTRY_COHORT_VERSION,
} from '../cli/registry-cohort.mts';

const NOW = '2026-08-05T00:00:00.000Z';

test('requires explicit current zones while migrating saved-Lookup version 1 instants as UTC', () => {
  const inputs = Array.from({ length: MIN_REGISTRY_COHORT_SAMPLE }, (_, index) => lookup(index, { version: 2 }));
  assert.throws(
    () => buildRegistryCohortReport(inputs.map((item) => JSON.stringify(item)).join('\n'), '2026-08-05T00:00:00'),
    /invalid/u,
  );
  const zoneLessInputs = inputs.map((item) => ({ ...item, generatedAt: '2026-08-05T00:00:00' }));
  assert.throws(
    () => buildRegistryCohortReport(zoneLessInputs.map((item) => JSON.stringify(item)).join('\n'), NOW),
    /explicit timezone/u,
  );
  const legacyZoneLessInputs = Array.from(
    { length: MIN_REGISTRY_COHORT_SAMPLE },
    (_, index) => lookup(index, { generatedAt: '2026-08-05T12:00:00' }),
  );
  const migrated = buildRegistryCohortReport(
    legacyZoneLessInputs.map((item) => JSON.stringify(item)).join('\n'),
    NOW,
  );
  assert.deepEqual(migrated.sampleWindow, {
    from: '2026-08-05T12:00:00.000Z',
    to: '2026-08-05T12:00:00.000Z',
  });
});

function lookup(index: number, options: { domain?: string; selfLink?: boolean; generatedAt?: string; version?: 1 | 2 } = {}) {
  const domain = options.domain ?? `sample-${index}.dev`;
  return {
    schema: 'whoisleuth.cli.lookup', version: options.version ?? 1, generatedAt: options.generatedAt ?? NOW, mode: 'deep', type: 'domain', query: domain, registrableDomain: domain,
    diagnostics: { rdap: { status: 'success' }, whois: { status: 'skipped' } },
    rdap: { parsed: {
      domain: domain.toUpperCase(), handle: `D-${index}`, objectClassName: 'domain', conformance: ['rdap_level_0'],
      links: options.selfLink === false ? [] : [{ rel: 'self', href: 'https://rdap.example.invalid/domain/example.test' }],
      events: [{ action: 'registration', date: '2020-01-01T00:00:00.000Z' }], lifecycle: { createdDateIso: '2020-01-01T00:00:00.000Z' },
    } },
    whois: { skipped: true },
  };
}

test('emits target-free registry quality cohorts after the fixed sample gate', () => {
  const inputs = Array.from({ length: MIN_REGISTRY_COHORT_SAMPLE }, (_, index) => lookup(index));
  const report = buildRegistryCohortReport(inputs.map((item) => JSON.stringify(item)).join('\n'), NOW);
  assert.equal(report.version, REGISTRY_COHORT_VERSION);
  assert.equal(report.inputFamily, 'saved_lookups');
  assert.equal(report.reportsMerged, 0);
  assert.equal(report.cohorts[0]?.state, 'consistent');
  assert.equal(report.cohorts[0]?.latestState, 'consistent');
  assert.equal(report.cohorts[0]?.timeline.length, 1);
  assert.equal(report.cohorts[0]?.sampleCount, MIN_REGISTRY_COHORT_SAMPLE);
  assert.equal(report.cohorts[0]?.publication.selfLinksObserved, MIN_REGISTRY_COHORT_SAMPLE);
  assert.doesNotMatch(JSON.stringify(report), /sample-\d/u);
  assert.match(formatRegistryCohortReport(report), /Registry quality cohort/u);
});

test('keeps small cohorts explicitly insufficient and accepts a JSON array', () => {
  const report = buildRegistryCohortReport(JSON.stringify([lookup(1), lookup(2)]), NOW);
  assert.equal(report.cohorts[0]?.state, 'insufficient_sample');
});

test('rejects malformed and over-count inputs before aggregation', () => {
  assert.throws(() => buildRegistryCohortReport('{bad', NOW), /JSONL line 1/u);
  assert.throws(() => buildRegistryCohortReport(JSON.stringify([]), NOW), /from 1/u);
  assert.throws(
    () => buildRegistryCohortReport(Array.from({ length: MAX_REGISTRY_COHORT_SAMPLES + 1 }, () => '{}').join('\n'), NOW),
    /from 1 to 500/u,
  );
  assert.throws(() => buildRegistryCohortReport('[{"schema":"whoisleuth.cli.lookup","schema":"duplicate"}]', NOW), /duplicate object key/iu);
});

test('merges retained v2 reports without summing overlapping samples into consistency', () => {
  const earlyAt = '2026-06-01T00:00:00.000Z';
  const lateAt = '2026-07-01T00:00:00.000Z';
  const early = buildRegistryCohortReport(JSON.stringify([
    lookup(1, { generatedAt: earlyAt }),
    lookup(2, { generatedAt: earlyAt }),
  ]), earlyAt);
  const late = buildRegistryCohortReport(JSON.stringify(Array.from(
    { length: MIN_REGISTRY_COHORT_SAMPLE },
    (_, index) => lookup(index + 10, { generatedAt: lateAt }),
  )), lateAt);
  const merged = buildRegistryCohortReport(JSON.stringify([late, early]), NOW);
  assert.equal(merged.inputFamily, 'retained_reports');
  assert.equal(merged.reportsMerged, 2);
  assert.equal(merged.sampleCount, MIN_REGISTRY_COHORT_SAMPLE);
  assert.equal(merged.cohorts[0]?.state, 'insufficient_sample');
  assert.equal(merged.cohorts[0]?.latestState, 'consistent');
  assert.equal(merged.cohorts[0]?.timeline.length, 2);
  assert.deepEqual(merged.sampleWindow, { from: earlyAt, to: lateAt });
  assert.doesNotMatch(JSON.stringify(merged), /sample-\d/u);
});

test('migrates a retained v1 report as one target-free timeline point', () => {
  const current = buildRegistryCohortReport(JSON.stringify(Array.from(
    { length: MIN_REGISTRY_COHORT_SAMPLE },
    (_, index) => lookup(index),
  )), NOW);
  const legacy = {
    schema: current.schema,
    version: LEGACY_REGISTRY_COHORT_VERSION,
    generatedAt: current.generatedAt,
    sampleCount: current.sampleCount,
    minimumCohortSample: current.minimumCohortSample,
    cohorts: current.cohorts.map(({ timeline: _timeline, latestState: _latestState, sampleWindow: _window, timelineOmitted: _omitted, ...cohort }) => cohort),
    limitations: [
      'The report intentionally omits domains, queries and raw evidence. It groups saved observations only by suffix and capability profile.',
      `Cohorts with fewer than ${MIN_REGISTRY_COHORT_SAMPLE} observations remain insufficient sample and must not drive catalogue changes.`,
      'Repeated observations from one environment are not representative by themselves. Review fixture provenance and source health before changing a parser or access profile.',
    ],
  };
  const migrated = buildRegistryCohortReport(JSON.stringify([legacy]), '2026-08-06T00:00:00.000Z');
  assert.equal(migrated.reportsMerged, 1);
  assert.equal(migrated.cohorts[0]?.timeline.length, 1);
  assert.deepEqual(migrated.cohorts[0]?.timeline[0]?.sampleWindow, { from: NOW, to: NOW });
  assert.equal(migrated.cohorts[0]?.latestState, 'consistent');
});

test('retains the conservative state when an older review point leaves the visible timeline', () => {
  const reports = Array.from({ length: MAX_REGISTRY_COHORT_TIMELINE_POINTS + 1 }, (_, reportIndex) => {
    const generatedAt = new Date(Date.UTC(2026, 0, reportIndex + 1)).toISOString();
    return buildRegistryCohortReport(JSON.stringify(Array.from(
      { length: MIN_REGISTRY_COHORT_SAMPLE },
      (_, index) => lookup(reportIndex * 10 + index, {
        generatedAt,
        selfLink: reportIndex === 0 ? false : true,
      }),
    )), generatedAt);
  });
  const merged = buildRegistryCohortReport(JSON.stringify(reports), '2026-08-05T00:00:00.000Z');
  assert.equal(merged.cohorts[0]?.timeline.length, MAX_REGISTRY_COHORT_TIMELINE_POINTS);
  assert.equal(merged.cohorts[0]?.timelineOmitted, 1);
  assert.equal(merged.cohorts[0]?.state, 'review');
  assert.equal(merged.cohorts[0]?.latestState, 'consistent');
  assert.equal(merged.omissions.timelinePoints, 1);
  assert.equal(merged.truncated, true);

  assert.throws(
    () => buildRegistryCohortReport(JSON.stringify(Array.from(
      { length: Math.floor(MAX_REGISTRY_COHORT_INPUT_POINTS / MAX_REGISTRY_COHORT_TIMELINE_POINTS) + 1 },
      () => merged,
    )), NOW),
    /more than 2000 timeline points/iu,
  );
});

test('deduplicates identical retained points and rejects mixed or future report families', () => {
  const report = buildRegistryCohortReport(JSON.stringify(Array.from(
    { length: MIN_REGISTRY_COHORT_SAMPLE },
    (_, index) => lookup(index),
  )), NOW);
  const merged = buildRegistryCohortReport(JSON.stringify([report, report]), NOW);
  assert.equal(merged.reportsMerged, 2);
  assert.equal(merged.cohorts[0]?.timeline.length, 1);
  assert.equal(merged.omissions.duplicateTimelinePoints, 1);
  assert.equal(merged.truncated, false);
  assert.throws(() => buildRegistryCohortReport(JSON.stringify([lookup(1), report]), NOW), /mixed families/iu);
  assert.throws(() => buildRegistryCohortReport(JSON.stringify([{ ...report, version: 99 }]), NOW), /version is unsupported/iu);
  const leaked = { ...report, target: 'must-not-be-retained.example' };
  assert.throws(() => buildRegistryCohortReport(JSON.stringify([leaked]), NOW), /exact retained contract/iu);
});

test('does not multiply inherited omission counts for duplicate retained reports', () => {
  const reports = Array.from({ length: MAX_REGISTRY_COHORT_TIMELINE_POINTS + 1 }, (_, reportIndex) => {
    const generatedAt = new Date(Date.UTC(2026, 0, reportIndex + 1)).toISOString();
    return buildRegistryCohortReport(JSON.stringify(Array.from(
      { length: MIN_REGISTRY_COHORT_SAMPLE },
      (_, index) => lookup(reportIndex * 10 + index, { generatedAt }),
    )), generatedAt);
  });
  const truncated = buildRegistryCohortReport(JSON.stringify(reports), NOW);
  assert.equal(truncated.omissions.timelinePoints, 1);
  const duplicated = buildRegistryCohortReport(JSON.stringify([truncated, truncated]), NOW);
  assert.equal(duplicated.omissions.timelinePoints, 1);
  assert.equal(duplicated.cohorts[0]?.timelineOmitted, 1);
  assert.equal(duplicated.omissions.duplicateTimelinePoints, MAX_REGISTRY_COHORT_TIMELINE_POINTS);
});
