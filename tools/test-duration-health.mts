#!/usr/bin/env node

import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TEST_DURATION_DATA_BEGIN,
  TEST_DURATION_DATA_END,
  type TestDurationData,
  type TestDurationFileSummary,
} from './test-duration-reporter.mts';
import {
  MAX_TIMING_REPORT_BYTES,
  readVerificationTestInventory,
  readVerificationTimingProfile,
  type VerificationTimingProfile,
} from './verification-timing-profile.mts';

const REQUIRED_RUNS = 3;
const MAX_TEST_DURATION_MS = 30 * 60 * 1_000;
const SAFE_UNIT_PATH = /^test\/[a-zA-Z0-9._-]+\.test\.mts$/u;
const DATA_KEYS = new Set(['version', 'totals', 'files']);
const TOTAL_KEYS = new Set(['passed', 'failed', 'cancelled', 'skipped', 'todo', 'durationMs']);
const FILE_KEYS = new Set(['file', 'durationMs', 'tests', 'failures']);
type UnknownRecord = Record<string, unknown>;

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

const isRecord = (value: unknown): value is UnknownRecord => (
  typeof value === 'object' && value !== null && Array.isArray(value) === false
);

function exactKeys(value: UnknownRecord, expected: ReadonlySet<string>, label: string): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) {
    throw new TypeError(`${label} must use only the documented fields.`);
  }
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new TypeError(`${label} is outside the maintained integer bound.`);
  }
  return Number(value);
}

function duration(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_TEST_DURATION_MS) {
    throw new TypeError(`${label} is outside the maintained duration bound.`);
  }
  return value;
}

function parseFile(value: unknown, index: number): TestDurationFileSummary {
  if (!isRecord(value)) throw new TypeError(`Duration file ${index + 1} must be an object.`);
  exactKeys(value, FILE_KEYS, `Duration file ${index + 1}`);
  if (typeof value.file !== 'string' || !SAFE_UNIT_PATH.test(value.file)) {
    throw new TypeError(`Duration file ${index + 1} must identify a maintained top-level unit test.`);
  }
  return Object.freeze({
    file: value.file,
    durationMs: duration(value.durationMs, `Duration for ${value.file}`),
    tests: integer(value.tests, `Test count for ${value.file}`, 1, 100_000),
    failures: integer(value.failures, `Failure count for ${value.file}`, 0, 100_000),
  });
}

export function parseTestDurationData(input: string): TestDurationData {
  if (Buffer.byteLength(input, 'utf8') < 1 || Buffer.byteLength(input, 'utf8') > MAX_TIMING_REPORT_BYTES) {
    throw new TypeError('Test duration report has an invalid byte count.');
  }
  const begin = input.indexOf(TEST_DURATION_DATA_BEGIN);
  const end = input.indexOf(TEST_DURATION_DATA_END);
  if (begin < 0 || end < begin || input.indexOf(TEST_DURATION_DATA_BEGIN, begin + 1) >= 0 || input.indexOf(TEST_DURATION_DATA_END, end + 1) >= 0) {
    throw new TypeError('Test duration report must contain exactly one complete machine-data block.');
  }
  const json = input.slice(begin + TEST_DURATION_DATA_BEGIN.length, end).trim();
  let parsed: unknown;
  try { parsed = JSON.parse(json) as unknown; } catch { throw new TypeError('Test duration machine data must be valid JSON.'); }
  if (!isRecord(parsed)) throw new TypeError('Test duration machine data must be an object.');
  exactKeys(parsed, DATA_KEYS, 'Test duration machine data');
  if (parsed.version !== 1) throw new TypeError('Test duration machine data must use version 1.');
  if (!isRecord(parsed.totals)) throw new TypeError('Test duration totals must be an object.');
  exactKeys(parsed.totals, TOTAL_KEYS, 'Test duration totals');
  const totals = Object.freeze({
    passed: integer(parsed.totals.passed, 'Passed count', 0, 1_000_000),
    failed: integer(parsed.totals.failed, 'Failed count', 0, 1_000_000),
    cancelled: integer(parsed.totals.cancelled, 'Cancelled count', 0, 1_000_000),
    skipped: integer(parsed.totals.skipped, 'Skipped count', 0, 1_000_000),
    todo: integer(parsed.totals.todo, 'Todo count', 0, 1_000_000),
    durationMs: duration(parsed.totals.durationMs, 'Run duration'),
  });
  if (totals.failed || totals.cancelled || totals.skipped || totals.todo || totals.passed < 1) {
    throw new TypeError('Timing health requires a complete passing, non-cancelled, non-skipped run.');
  }
  if (!Array.isArray(parsed.files) || parsed.files.length < 1 || parsed.files.length > 1_000) {
    throw new TypeError('Test duration files exceed the maintained inventory bound.');
  }
  const files = Object.freeze(parsed.files.map(parseFile));
  const identities = files.map((file) => file.file);
  if (new Set(identities).size !== identities.length) throw new TypeError('Test duration file identities must be unique.');
  if (files.some((file) => file.failures !== 0) || files.reduce((sum, file) => sum + file.tests, 0) !== totals.passed) {
    throw new TypeError('Test duration file summaries do not match the accepted run totals.');
  }
  return Object.freeze({ version: 1, totals, files });
}

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
    if (size < 1 || size > MAX_TIMING_REPORT_BYTES) throw new TypeError('Timing health report has an invalid byte count.');
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
