#!/usr/bin/env node

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { summarizePlaywrightResults } from './playwright-results-summary.mts';
import {
  MAX_TIMING_REPORT_BYTES,
  buildBalancedBrowserShardPlan,
  parsePlaywrightTimingData,
  readVerificationTimingProfile,
  type VerificationTimingProfile,
} from './verification-timing-profile.mts';

type BrowserAggregateFile = Readonly<{
  file: string;
  lane: 'browser' | 'browser_setup';
  weightMs: number;
  sampleCount: number;
}>;

export type BrowserShardTimingAggregate = Readonly<{
  reportVersion: 1;
  inventoryFingerprint: string;
  files: readonly BrowserAggregateFile[];
}>;

export type BrowserShardTimingSummary = Readonly<{
  shardCount: number;
  passed: number;
  failed: 0;
  flaky: 0;
  skipped: 0;
  retried: 0;
  browserSpecifications: number;
  setupFiles: number;
  observedShardWeightsMs: readonly number[];
  observedImbalanceMs: number;
  observedImbalanceRatio: number;
  plannedImbalanceMs: number;
}>;

function median(values: readonly number[]): number {
  if (values.length < 1) throw new TypeError('Browser timing median requires at least one measurement.');
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1
    ? ordered[middle] as number
    : Math.round(((ordered[middle - 1] as number) + (ordered[middle] as number)) / 2);
}

function identity(files: readonly string[]): string {
  return [...files].sort().join('\n');
}

export function aggregatePlaywrightShardTimings(
  reports: readonly unknown[],
  profile: VerificationTimingProfile = readVerificationTimingProfile(),
): Readonly<{ aggregate: BrowserShardTimingAggregate; summary: BrowserShardTimingSummary }> {
  const plan = buildBalancedBrowserShardPlan(profile);
  if (reports.length !== plan.shardCount) {
    throw new TypeError(`Browser timing aggregation requires exactly ${plan.shardCount} functional shard reports.`);
  }
  const expectedSetup = identity(plan.setupFiles);
  const expectedByIdentity = new Map(plan.shards.map((shard) => [identity(shard.files), shard]));
  const matchedShards = new Set<number>();
  const browserWeights = new Map<string, number>();
  const setupWeights = new Map<string, number[]>();
  const observedShardWeights: number[] = [];
  let passed = 0;

  for (const raw of reports) {
    const summary = summarizePlaywrightResults(raw);
    if (summary.truncated || summary.failed || summary.flaky || summary.skipped || summary.retried || summary.extraAttempts) {
      throw new TypeError('Browser timing aggregation requires complete passing runs with no retries, flakes, skips, or truncation.');
    }
    const timings = parsePlaywrightTimingData(raw);
    const setupFiles = [...timings.keys()].filter((file) => file.endsWith('.setup.ts')).sort();
    if (identity(setupFiles) !== expectedSetup) {
      throw new TypeError('Browser shard report does not contain the exact maintained setup inventory.');
    }
    const browserFiles = [...timings.keys()].filter((file) => file.endsWith('.spec.ts')).sort();
    const shard = expectedByIdentity.get(identity(browserFiles));
    if (!shard || matchedShards.has(shard.shard)) {
      throw new TypeError('Browser shard report does not uniquely match the retained balanced plan.');
    }
    matchedShards.add(shard.shard);
    passed += summary.passed;
    let observedWeight = 0;
    for (const file of browserFiles) {
      const weightMs = timings.get(file);
      if (weightMs === undefined || browserWeights.has(file)) {
        throw new TypeError('Browser specification timing was missing or repeated across shards.');
      }
      browserWeights.set(file, weightMs);
      observedWeight += weightMs;
    }
    observedShardWeights[shard.shard - 1] = observedWeight;
    for (const file of setupFiles) {
      const weightMs = timings.get(file);
      if (weightMs === undefined) throw new TypeError('Browser setup timing was unavailable.');
      setupWeights.set(file, [...(setupWeights.get(file) ?? []), weightMs]);
    }
  }

  if (matchedShards.size !== plan.shardCount || browserWeights.size !== plan.shards.flatMap((shard) => shard.files).length
    || observedShardWeights.length !== plan.shardCount || observedShardWeights.some((weight) => !Number.isSafeInteger(weight))) {
    throw new TypeError('Browser timing aggregation did not cover the complete balanced plan exactly once.');
  }
  for (const file of plan.setupFiles) {
    if (setupWeights.get(file)?.length !== plan.shardCount) {
      throw new TypeError('Browser setup timing must be measured once in every functional shard.');
    }
  }
  const files: BrowserAggregateFile[] = [
    ...[...browserWeights].map(([file, weightMs]) => Object.freeze({ file, lane: 'browser' as const, weightMs, sampleCount: 1 })),
    ...[...setupWeights].map(([file, weights]) => Object.freeze({
      file,
      lane: 'browser_setup' as const,
      weightMs: median(weights),
      sampleCount: weights.length,
    })),
  ].sort((left, right) => left.file.localeCompare(right.file));
  const maximum = Math.max(...observedShardWeights);
  const minimum = Math.min(...observedShardWeights);
  const total = observedShardWeights.reduce((sum, weight) => sum + weight, 0);
  return Object.freeze({
    aggregate: Object.freeze({
      reportVersion: 1,
      inventoryFingerprint: profile.inventoryFingerprint,
      files: Object.freeze(files),
    }),
    summary: Object.freeze({
      shardCount: plan.shardCount,
      passed,
      failed: 0,
      flaky: 0,
      skipped: 0,
      retried: 0,
      browserSpecifications: browserWeights.size,
      setupFiles: setupWeights.size,
      observedShardWeightsMs: Object.freeze(observedShardWeights),
      observedImbalanceMs: maximum - minimum,
      observedImbalanceRatio: total === 0 ? 0 : Number(((maximum - minimum) / (total / plan.shardCount)).toFixed(6)),
      plannedImbalanceMs: plan.unavoidableImbalanceMs,
    }),
  });
}

export function renderBrowserShardTimingSummary(summary: BrowserShardTimingSummary): string {
  return [
    '## Browser shard timing health',
    '',
    `${summary.passed} tests passed across ${summary.shardCount} functional shards; 0 failed, flaky, skipped, or retried.`,
    `${summary.browserSpecifications} browser specifications and ${summary.setupFiles} setup file(s) were covered exactly.`,
    `Observed shard weights: ${summary.observedShardWeightsMs.join(', ')} ms.`,
    `Observed imbalance: ${summary.observedImbalanceMs} ms (${(summary.observedImbalanceRatio * 100).toFixed(2)}% of mean); retained-plan projection: ${summary.plannedImbalanceMs} ms.`,
    '',
    'Timing differences are review evidence. The retained profile is not rewritten automatically.',
    '',
  ].join('\n');
}

function reportPaths(args: readonly string[]): Readonly<{ paths: readonly string[]; summary: boolean }> {
  const summary = args.includes('--summary');
  const unexpected = args.filter((arg) => arg !== '--summary' && !arg.startsWith('--report='));
  const paths = args.filter((arg) => arg.startsWith('--report=')).map((arg) => arg.slice('--report='.length));
  if (unexpected.length || paths.length !== 4 || args.length !== paths.length + (summary ? 1 : 0)) {
    throw new TypeError('Usage: node tools/playwright-shard-aggregate.mts [--summary] --report=/absolute/path repeated exactly four times');
  }
  for (const filename of paths) {
    if (!path.isAbsolute(filename)) throw new TypeError('Browser shard report paths must be absolute.');
    const size = statSync(filename).size;
    if (size < 1 || size > MAX_TIMING_REPORT_BYTES) throw new TypeError('Browser shard report has an invalid byte count.');
  }
  return Object.freeze({ paths: Object.freeze(paths), summary });
}

export function main(args = process.argv.slice(2)): number {
  try {
    const options = reportPaths(args);
    const reports = options.paths.map((filename) => {
      let parsed: unknown;
      try { parsed = JSON.parse(readFileSync(filename, 'utf8')) as unknown; } catch { throw new TypeError('Browser shard report must be valid JSON.'); }
      return parsed;
    });
    const result = aggregatePlaywrightShardTimings(reports);
    process.stdout.write(options.summary
      ? renderBrowserShardTimingSummary(result.summary)
      : `${JSON.stringify(result.aggregate, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Browser shard timing aggregation failed.'}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
