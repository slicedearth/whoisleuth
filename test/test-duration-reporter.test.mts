import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createTestDurationReport,
  type TestDurationRecord,
} from '../tools/test-duration-reporter.mts';

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
});
