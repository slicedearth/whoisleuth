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
    assert.ok(report.indexOf('test/first.test.mts: 25.0 ms') < report.indexOf('test/second.test.mts: 12.0 ms'));
    assert.ok(report.indexOf('slow case: 25.0 ms') < report.indexOf('medium case: 10.0 ms'));
    assert.doesNotMatch(report, /quick case/u);
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
