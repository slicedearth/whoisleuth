import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  renderPlaywrightResultSummary,
  summarizePlaywrightResults,
  readPlaywrightResultData,
  MAX_PLAYWRIGHT_RESULTS_BYTES,
} from '../tools/playwright-results-summary.mts';
import {
  aggregatePlaywrightShardTimings,
  renderBrowserShardTimingSummary,
} from '../tools/playwright-shard-aggregate.mts';
import { PLAYWRIGHT_PERFORMANCE_AUTHORITY_SPECS } from '../tools/playwright-execution-contract.mts';
import type { VerificationTimingProfile } from '../tools/verification-timing-profile.mts';

function fixture(attachmentBody?: string) {
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
          results: [{ status: 'passed', duration: 220, retry: 0, attachments: attachmentBody ? [{ name: 'geometry', body: attachmentBody }] : [] }],
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
  test('admits attachment-rich raw reports without relaxing failure or byte admission', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'browser-report-admission-'));
    const filename = path.join(directory, 'report.json');
    try {
      const value = fixture('a'.repeat(12 * 1024 * 1024));
      writeFileSync(filename, JSON.stringify(value));
      const parsed = readPlaywrightResultData(filename);
      assert.deepEqual(summarizePlaywrightResults(parsed), summarizePlaywrightResults(value));
      assert.equal(summarizePlaywrightResults(parsed).failed, 1);
      assert.equal(summarizePlaywrightResults(parsed).flaky, 1);
      writeFileSync(filename, '{broken');
      assert.throws(() => readPlaywrightResultData(filename), /valid JSON/u);
      writeFileSync(filename, '');
      assert.throws(() => readPlaywrightResultData(filename), /byte limits/u);
      truncateSync(filename, MAX_PLAYWRIGHT_RESULTS_BYTES + 1);
      assert.throws(() => readPlaywrightResultData(filename), /byte limits/u);
      assert.throws(() => readPlaywrightResultData(directory), /regular file/u);
      writeFileSync(filename, '{}');
      const link = path.join(directory, 'linked.json');
      symlinkSync(filename, link);
      assert.throws(() => readPlaywrightResultData(link), /ELOOP|symbolic/i);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
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

  test('distinguishes recorded performance from a universal response-time guarantee', () => {
    const report = renderPlaywrightResultSummary(summarizePlaywrightResults(fixture(), 'performance'));
    assert.match(report, /Timing measurements are observational/u);
    assert.match(report, /does not certify a universal response-time target/u);
    assert.match(report, /execution context.*JSON attachments/u);
    assert.match(report, /\| Failed \| 1 \|/u);
    assert.match(report, /\| Flaky \| 1 \|/u);
    assert.match(report, /Observed run duration: 1500 ms/u);
    const functional = renderPlaywrightResultSummary(summarizePlaywrightResults(fixture(), '1-of-4'));
    assert.doesNotMatch(functional, /Timing measurements are observational/u);
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
        ...PLAYWRIGHT_PERFORMANCE_AUTHORITY_SPECS.map((file) => Object.freeze({
          file, lane: 'browser' as const, weightMs: 500, sampleCount: 1, provenanceId: 'browser',
        })),
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
    const inventory = [...files.map((item) => item.file), ...PLAYWRIGHT_PERFORMANCE_AUTHORITY_SPECS, 'e2e/auth.setup.ts'];
    const result = aggregatePlaywrightShardTimings(accepted, profile, inventory);
    assert.equal(result.summary.passed, 8);
    assert.equal(result.summary.browserSpecifications, 4);
    assert.equal(result.summary.setupFiles, 1);
    assert.deepEqual(result.summary.observedShardWeightsMs, [50, 50, 50, 50]);
    assert.equal(result.aggregate.files.find((item) => item.file === 'e2e/auth.setup.ts')?.sampleCount, 4);
    assert.equal(result.aggregate.files.find((item) => item.file === 'e2e/auth.setup.ts')?.weightMs, 12);
    assert.ok(PLAYWRIGHT_PERFORMANCE_AUTHORITY_SPECS.every((file) => (
      result.aggregate.files.every((item) => item.file !== file)
    )));
    assert.match(renderBrowserShardTimingSummary(result.summary), /0 failed, flaky, skipped, or retried/u);

    assert.throws(
      () => aggregatePlaywrightShardTimings([accepted[0]!, accepted[0]!, accepted[2]!, accepted[3]!], profile, inventory),
      /uniquely match/u,
    );
    const retried = structuredClone(accepted);
    const retryTest = retried[0]!.suites[0]!.specs[1]!.tests[0]!;
    retryTest.status = 'flaky';
    retryTest.results.push({ status: 'passed', duration: 1, retry: 1 });
    assert.throws(() => aggregatePlaywrightShardTimings(retried, profile, inventory), /complete passing/u);
    assert.throws(() => aggregatePlaywrightShardTimings(accepted, profile, [...inventory, 'e2e/new.spec.ts']),
      /uniquely match/u, 'an unmeasured new specification must not be omitted from execution');
  });
});
