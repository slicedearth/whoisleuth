#!/usr/bin/env node

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MAX_TEST_DURATION_REPORT_BYTES,
  parseTestDurationData,
  type TestDurationData,
} from './test-duration-reporter.mts';
import {
  readVerificationTestInventory,
  readVerificationTimingProfile,
  type VerificationTimingProfile,
} from './verification-timing-profile.mts';

const REQUIRED_RUNS = 3;

export type TestDurationComparison = Readonly<{
  file: string;
  retainedMs: number;
  observedMedianMs: number;
  deltaMs: number;
  deltaPercentage: number;
}>;

export type TestDurationHealth = Readonly<{
  runCount: 3;
  testsPerRun: number;
  fileCount: number;
  wallDurationMedianMs: number;
  retainedAggregateMs: number;
  observedAggregateMs: number;
  aggregateDeltaMs: number;
  aggregateDeltaPercentage: number;
  comparisons: readonly TestDurationComparison[];
}>;

export { parseTestDurationData } from './test-duration-reporter.mts';

function median(values: readonly number[]): number {
  if (!values.length) throw new TypeError('Median requires at least one measurement.');
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1
    ? ordered[middle] as number
    : ((ordered[middle - 1] as number) + (ordered[middle] as number)) / 2;
}

function percentageDelta(observed: number, retained: number): number {
  return retained === 0 ? 0 : ((observed - retained) / retained) * 100;
}

export function buildTestDurationHealth(
  runs: readonly TestDurationData[],
  profile: VerificationTimingProfile = readVerificationTimingProfile(),
  inventory: readonly string[] = readVerificationTestInventory().filter((file) => file.startsWith('test/')),
): TestDurationHealth {
  if (runs.length !== REQUIRED_RUNS) throw new TypeError(`Timing health requires exactly ${REQUIRED_RUNS} accepted runs.`);
  const expected = [...inventory].sort();
  for (const [index, run] of runs.entries()) {
    const actual = run.files.map((file) => file.file).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new TypeError(`Timing run ${index + 1} does not match the maintained unit-test inventory.`);
    }
  }
  const retained = new Map(profile.files.filter((file) => file.lane === 'unit').map((file) => [file.file, file.weightMs]));
  const comparisons = expected.map((file): TestDurationComparison => {
    const retainedMs = retained.get(file);
    if (retainedMs === undefined) throw new TypeError(`Retained timing profile is missing ${file}.`);
    const observedMedianMs = median(runs.map((run) => run.files.find((item) => item.file === file)?.durationMs as number));
    const deltaMs = observedMedianMs - retainedMs;
    return Object.freeze({
      file,
      retainedMs,
      observedMedianMs,
      deltaMs,
      deltaPercentage: percentageDelta(observedMedianMs, retainedMs),
    });
  });
  const retainedAggregateMs = comparisons.reduce((sum, item) => sum + item.retainedMs, 0);
  const observedAggregateMs = comparisons.reduce((sum, item) => sum + item.observedMedianMs, 0);
  const testsPerRun = runs[0]?.totals.passed ?? 0;
  if (runs.some((run) => run.totals.passed !== testsPerRun)) throw new TypeError('Timing runs must retain the same accepted test total.');
  return Object.freeze({
    runCount: 3,
    testsPerRun,
    fileCount: expected.length,
    wallDurationMedianMs: median(runs.map((run) => run.totals.durationMs)),
    retainedAggregateMs,
    observedAggregateMs,
    aggregateDeltaMs: observedAggregateMs - retainedAggregateMs,
    aggregateDeltaPercentage: percentageDelta(observedAggregateMs, retainedAggregateMs),
    comparisons: Object.freeze(comparisons),
  });
}

function milliseconds(value: number): string {
  return `${Math.round(value)} ms`;
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${Math.round(value)}`;
}

export function formatTestDurationHealth(health: TestDurationHealth): string {
  const regressions = [...health.comparisons]
    .filter((item) => item.deltaMs > 0)
    .sort((left, right) => right.deltaMs - left.deltaMs || left.file.localeCompare(right.file))
    .slice(0, 20);
  const improvements = [...health.comparisons]
    .filter((item) => item.deltaMs < 0)
    .sort((left, right) => left.deltaMs - right.deltaMs || left.file.localeCompare(right.file))
    .slice(0, 10);
  const lines = [
    '## Unit timing health',
    '',
    `Median of ${health.runCount} complete runs: ${health.testsPerRun} tests across ${health.fileCount} files; ${milliseconds(health.wallDurationMedianMs)} wall duration.`,
    `Aggregate file-test time: ${milliseconds(health.observedAggregateMs)} observed versus ${milliseconds(health.retainedAggregateMs)} retained (${signed(health.aggregateDeltaMs)} ms, ${signed(health.aggregateDeltaPercentage)}%).`,
    '',
    '### Largest increases',
    '',
    ...(regressions.length ? regressions.map((item) => `- ${item.file}: ${milliseconds(item.observedMedianMs)} (${signed(item.deltaMs)} ms, ${signed(item.deltaPercentage)}%)`) : ['- None.']),
    '',
    '### Largest decreases',
    '',
    ...(improvements.length ? improvements.map((item) => `- ${item.file}: ${milliseconds(item.observedMedianMs)} (${signed(item.deltaMs)} ms, ${signed(item.deltaPercentage)}%)`) : ['- None.']),
    '',
    'Timing differences are review evidence. The retained profile is not rewritten automatically.',
  ];
  return `${lines.join('\n')}\n`;
}

function reportPaths(args: readonly string[]): readonly string[] {
  if (args.length !== REQUIRED_RUNS || args.some((arg) => !arg.startsWith('--report='))) {
    throw new TypeError('Usage: node tools/test-duration-health.mts --report=/absolute/path repeated exactly three times');
  }
  return Object.freeze(args.map((arg) => {
    const filename = arg.slice('--report='.length);
    if (!path.isAbsolute(filename)) throw new TypeError('Timing health report paths must be absolute.');
    const size = statSync(filename).size;
    if (size < 1 || size > MAX_TEST_DURATION_REPORT_BYTES) throw new TypeError('Timing health report has an invalid byte count.');
    return filename;
  }));
}

export function main(args = process.argv.slice(2)): number {
  try {
    const reports = reportPaths(args).map((filename) => parseTestDurationData(readFileSync(filename, 'utf8')));
    process.stdout.write(formatTestDurationHealth(buildTestDurationHealth(reports)));
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Test duration health failed.'}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
