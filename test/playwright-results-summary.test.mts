import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  renderPlaywrightResultSummary,
  summarizePlaywrightResults,
} from '../tools/playwright-results-summary.mts';
import {
  aggregatePlaywrightShardTimings,
  renderBrowserShardTimingSummary,
} from '../tools/playwright-shard-aggregate.mts';
import type { VerificationTimingProfile } from '../tools/verification-timing-profile.mts';

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

  test('aggregates the exact functional shard inventory without hiding retries or duplicates', () => {
    const files = ['a', 'b', 'c', 'd'].map((name, index) => Object.freeze({
      file: `e2e/${name}.spec.ts`,
      lane: 'browser' as const,
      weightMs: 100 - index,
      sampleCount: 1,
      provenanceId: 'browser',
    }));
    const profile: VerificationTimingProfile = Object.freeze({
      profileVersion: 1,
      inventoryFingerprint: 'a'.repeat(64),
      provenance: Object.freeze([Object.freeze({
        id: 'browser', lane: 'browser', environmentClass: 'fixture', sampleBasis: 'fixture', sampleCount: 4,
      })]),
      files: Object.freeze([
        ...files,
        Object.freeze({
          file: 'e2e/auth.setup.ts', lane: 'browser_setup' as const, weightMs: 10, sampleCount: 4, provenanceId: 'browser',
        }),
      ]),
    });
    const report = (file: string, setupDuration: number) => ({
      stats: { expected: 2, unexpected: 0, flaky: 0, skipped: 0, duration: 100 },
      suites: [{
        title: file,
        specs: [
          {
            file: 'auth.setup.ts',
            tests: [{ status: 'expected', results: [{ status: 'passed', duration: setupDuration, retry: 0 }] }],
          },
          {
            file: file.slice('e2e/'.length),
            tests: [{ status: 'expected', results: [{ status: 'passed', duration: 50, retry: 0 }] }],
          },
        ],
      }],
    });
    const accepted = files.map((item, index) => report(item.file, 10 + index));
    const result = aggregatePlaywrightShardTimings(accepted, profile);
    assert.equal(result.summary.passed, 8);
    assert.equal(result.summary.browserSpecifications, 4);
    assert.equal(result.summary.setupFiles, 1);
    assert.deepEqual(result.summary.observedShardWeightsMs, [50, 50, 50, 50]);
    assert.equal(result.aggregate.files.find((item) => item.file === 'e2e/auth.setup.ts')?.sampleCount, 4);
    assert.equal(result.aggregate.files.find((item) => item.file === 'e2e/auth.setup.ts')?.weightMs, 12);
    assert.match(renderBrowserShardTimingSummary(result.summary), /0 failed, flaky, skipped, or retried/u);

    assert.throws(
      () => aggregatePlaywrightShardTimings([accepted[0]!, accepted[0]!, accepted[2]!, accepted[3]!], profile),
      /uniquely match/u,
    );
    const retried = structuredClone(accepted);
    const retryTest = retried[0]!.suites[0]!.specs[1]!.tests[0]!;
    retryTest.status = 'flaky';
    retryTest.results.push({ status: 'passed', duration: 1, retry: 1 });
    assert.throws(() => aggregatePlaywrightShardTimings(retried, profile), /complete passing/u);
  });
});
