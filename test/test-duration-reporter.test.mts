import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createTestDurationReport,
  type TestDurationRecord,
} from '../tools/test-duration-reporter.mts';
import {
  buildTestDurationHealth,
  formatTestDurationHealth,
  parseTestDurationData,
} from '../tools/test-duration-health.mts';
import type { VerificationTimingProfile } from '../tools/verification-timing-profile.mts';

function record(
  name: string,
  file: string,
  durationMs: number,
  failed = false,
): TestDurationRecord {
  return Object.freeze({ name, file, durationMs, failed });
}

describe('test duration report', () => {
  it('orders files and tests by measured duration', () => {
    const report = createTestDurationReport([
      record('quick case', 'test/second.test.mts', 2),
      record('slow case', 'test/first.test.mts', 25),
      record('medium case', 'test/second.test.mts', 10),
    ], 2);

    assert.match(report, /Measured 3 tests across 2 files; 0 failed\./u);
    assert.match(report, /Accepted totals: 3 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo\./u);
    assert.match(report, /Unit lane duration: 37\.0 ms\./u);
    assert.ok(report.indexOf('test/first.test.mts: 25.0 ms') < report.indexOf('test/second.test.mts: 12.0 ms'));
    assert.ok(report.indexOf('slow case: 25.0 ms') < report.indexOf('medium case: 10.0 ms'));
    assert.doesNotMatch(report, /quick case/u);
  });

  it('uses accepted runner totals for cancellation, skip, todo, and lane duration', () => {
    const report = createTestDurationReport([
      record('passed case', 'test/pass.test.mts', 5),
      record('failed case', 'test/fail.test.mts', 7, true),
    ], 20, {
      passed: 1,
      failed: 1,
      cancelled: 2,
      skipped: 3,
      todo: 4,
      durationMs: 123,
    });
    assert.match(report, /Accepted totals: 1 passed, 1 failed, 2 cancelled, 3 skipped, 4 todo\./u);
    assert.match(report, /Unit lane duration: 123 ms\./u);
  });

  it('reports failures and ignores invalid durations', () => {
    const report = createTestDurationReport([
      record('failed case', 'test/failing.test.mts', 4, true),
      record('invalid duration', 'test/invalid.test.mts', Number.NaN),
    ]);

    assert.match(report, /Measured 1 test across 1 file; 1 failed\./u);
    assert.match(report, /1 failed/u);
    assert.match(report, /\[failed\]/u);
    assert.doesNotMatch(report, /invalid duration/u);
  });

  it('bounds an invalid or excessive display limit', () => {
    const records = Array.from({ length: 120 }, (_, index) => (
      record(`case ${index}`, `test/${index}.test.mts`, index)
    ));
    const report = createTestDurationReport(records, 1_000);

    assert.match(report, /Slowest files \(top 100\)/u);
    assert.match(report, /Slowest tests \(top 100\)/u);
    assert.doesNotMatch(report, /^101\./mu);
  });

  it('retains a bounded machine-readable summary for every measured file', () => {
    const report = createTestDurationReport([
      record('case a', 'test/a.test.mts', 4),
      record('case b', 'test/a.test.mts', 6),
      record('case c', 'test/b.test.mts', 2),
    ], 1, { passed: 3, failed: 0, cancelled: 0, skipped: 0, todo: 0, durationMs: 20 });
    const data = parseTestDurationData(report);

    assert.deepEqual(data, {
      version: 1,
      totals: { passed: 3, failed: 0, cancelled: 0, skipped: 0, todo: 0, durationMs: 20 },
      files: [
        { file: 'test/a.test.mts', durationMs: 10, tests: 2, failures: 0 },
        { file: 'test/b.test.mts', durationMs: 2, tests: 1, failures: 0 },
      ],
    });
    assert.doesNotMatch(report.split('Slowest tests')[1]?.split('--- WHOISLEUTH')[0] ?? '', /case a|case c/u);
  });

  it('compares medians from three accepted runs without rewriting the retained profile', () => {
    const run = (a: number, b: number, wall: number) => parseTestDurationData(createTestDurationReport([
      record('a', 'test/a.test.mts', a),
      record('b', 'test/b.test.mts', b),
    ], 20, { passed: 2, failed: 0, cancelled: 0, skipped: 0, todo: 0, durationMs: wall }));
    const profile: VerificationTimingProfile = Object.freeze({
      profileVersion: 1,
      sourceRevision: 'a'.repeat(40),
      provenance: Object.freeze([Object.freeze({
        id: 'unit', lane: 'unit', environmentClass: 'fixture', sampleBasis: 'fixture', sampleCount: 1,
      })]),
      files: Object.freeze([
        Object.freeze({ file: 'test/a.test.mts', lane: 'unit', weightMs: 10, sampleCount: 1, provenanceId: 'unit' }),
        Object.freeze({ file: 'test/b.test.mts', lane: 'unit', weightMs: 25, sampleCount: 1, provenanceId: 'unit' }),
      ]),
    });
    const health = buildTestDurationHealth([
      run(10, 30, 90),
      run(30, 20, 110),
      run(20, 10, 100),
    ], profile, ['test/a.test.mts', 'test/b.test.mts']);

    assert.equal(health.wallDurationMedianMs, 100);
    assert.equal(health.observedAggregateMs, 40);
    assert.equal(health.retainedAggregateMs, 35);
    assert.equal(health.aggregateDeltaMs, 5);
    assert.match(formatTestDurationHealth(health), /Median of 3 complete runs/u);
    assert.match(formatTestDurationHealth(health), /test\/a\.test\.mts: 20 ms \(\+10 ms, \+100%\)/u);
    assert.match(formatTestDurationHealth(health), /not rewritten automatically/u);
  });

  it('rejects partial, repeated, malformed, and inventory-inconsistent timing data', () => {
    const valid = createTestDurationReport([
      record('a', 'test/a.test.mts', 1),
    ], 20, { passed: 1, failed: 0, cancelled: 0, skipped: 0, todo: 0, durationMs: 2 });
    assert.throws(() => parseTestDurationData(valid.replace('"failed":0', '"failed":1')), /complete passing/u);
    assert.throws(() => parseTestDurationData(`${valid}\n${valid}`), /exactly one complete/u);
    assert.throws(() => parseTestDurationData(valid.replaceAll('test/a.test.mts', '../a.test.mts')), /top-level unit test/u);

    const data = parseTestDurationData(valid);
    assert.throws(() => buildTestDurationHealth(
      [data, data],
      null as unknown as VerificationTimingProfile,
      ['test/a.test.mts'],
    ), /exactly 3/u);
  });
});
