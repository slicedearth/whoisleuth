import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  renderPlaywrightResultSummary,
  summarizePlaywrightResults,
} from '../tools/playwright-results-summary.mts';

function fixture() {
  return {
    stats: { duration: 1_500 },
    suites: [{
      title: 'Console',
      file: '/checkout/e2e/console.spec.ts',
      specs: [{
        title: 'loads a saved view',
        file: '/checkout/e2e/console.spec.ts',
        tests: [{
          status: 'expected',
          results: [{ status: 'passed', duration: 220, retry: 0, attachments: [] }],
        }, {
          status: 'flaky',
          results: [
            { status: 'failed', duration: 140, retry: 0, attachments: [{ name: 'screenshot', path: '/private/result.png' }] },
            { status: 'passed', duration: 180, retry: 1, attachments: [{ name: 'trace', path: '/private/trace.zip' }] },
          ],
        }],
      }, {
        title: 'shows a bounded error',
        tests: [{
          status: 'unexpected',
          results: [{ status: 'failed', duration: 800, retry: 0, attachments: [{ name: 'trace' }] }],
        }],
      }],
    }],
  };
}

describe('Playwright result summary', () => {
  test('counts retries and failures while retaining only bounded diagnostic labels', () => {
    const summary = summarizePlaywrightResults(fixture(), '1-of-2');
    assert.deepEqual({
      total: summary.total,
      passed: summary.passed,
      failed: summary.failed,
      flaky: summary.flaky,
      skipped: summary.skipped,
      retried: summary.retried,
      extraAttempts: summary.extraAttempts,
      observedDurationMs: summary.observedDurationMs,
      attemptDurationMs: summary.attemptDurationMs,
      laneDurations: summary.laneDurations,
    }, {
      total: 3,
      passed: 1,
      failed: 1,
      flaky: 1,
      skipped: 0,
      retried: 1,
      extraAttempts: 1,
      observedDurationMs: 1_500,
      attemptDurationMs: 1_340,
      laneDurations: { setup: 0, browser: 1_340 },
    });
    assert.equal(summary.slowest[0]?.file, 'e2e/console.spec.ts');
    assert.deepEqual(summary.failureAttachments, ['screenshot', 'trace']);
    assert.doesNotMatch(JSON.stringify(summary), /private\/result|private\/trace/u);
  });

  test('renders a safe concise GitHub summary', () => {
    const report = renderPlaywrightResultSummary(summarizePlaywrightResults(fixture(), 'shard | one', {
      shard: '1/2',
      plannedWeightMs: 24_000,
      projectedImbalanceMs: 120,
    }));
    assert.match(report, /Playwright result summary: shard &#124; one/u);
    assert.match(report, /\| Flaky \| 1 \|/u);
    assert.match(report, /Retried tests/u);
    assert.match(report, /Failure attachment types: screenshot, trace/u);
    assert.match(report, /Observed run duration: 1500 ms/u);
    assert.match(report, /Lane durations: setup 0 ms; browser 1340 ms/u);
    assert.match(report, /Balanced shard 1\/2 planned weight: 24000 ms; projected complete-plan imbalance: 120 ms/u);
    assert.doesNotMatch(report, /\/private\//u);
  });

  test('rejects malformed top-level result data', () => {
    assert.throws(() => summarizePlaywrightResults(null), /must be an object/u);
  });
});
