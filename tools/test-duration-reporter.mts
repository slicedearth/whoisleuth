import type { TestEvent } from 'node:test/reporters';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_LIMIT = 20;
const MAX_REPORTED_NAME_LENGTH = 180;
const UNKNOWN_FILE = '(unknown file)';
export const MAX_TEST_DURATION_REPORT_BYTES = 4 * 1024 * 1024;
const MAX_TEST_DURATION_MS = 30 * 60 * 1_000;
const SAFE_UNIT_PATH = /^test\/[a-zA-Z0-9._-]+\.test\.mts$/u;
const DATA_KEYS = new Set(['version', 'totals', 'files']);
const TOTAL_KEYS = new Set(['passed', 'failed', 'cancelled', 'skipped', 'todo', 'durationMs']);
const FILE_KEYS = new Set(['file', 'durationMs', 'tests', 'failures']);
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TEST_DURATION_DATA_BEGIN = '--- WHOISLEUTH TEST DURATION DATA V1 BEGIN ---';
export const TEST_DURATION_DATA_END = '--- WHOISLEUTH TEST DURATION DATA V1 END ---';

export type TestDurationRecord = Readonly<{
  name: string;
  file: string;
  durationMs: number;
  failed: boolean;
}>;

export type TestRunTotals = Readonly<{
  passed: number;
  failed: number;
  cancelled: number;
  skipped: number;
  todo: number;
  durationMs: number;
}>;

export type TestDurationFileSummary = Readonly<{
  file: string;
  durationMs: number;
  tests: number;
  failures: number;
}>;

export type TestDurationData = Readonly<{
  version: 1;
  totals: TestRunTotals;
  files: readonly TestDurationFileSummary[];
}>;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && Array.isArray(value) === false;
}

function exactKeys(value: UnknownRecord, expected: ReadonlySet<string>, label: string): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) {
    throw new TypeError(`${label} must use only the documented fields.`);
  }
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new TypeError(`${label} is outside the maintained integer bound.`);
  }
  return Number(value);
}

function boundedDuration(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_TEST_DURATION_MS) {
    throw new TypeError(`${label} is outside the maintained duration bound.`);
  }
  return value;
}

function parseDurationFile(value: unknown, index: number): TestDurationFileSummary {
  if (!isRecord(value)) throw new TypeError(`Duration file ${index + 1} must be an object.`);
  exactKeys(value, FILE_KEYS, `Duration file ${index + 1}`);
  if (typeof value.file !== 'string' || !SAFE_UNIT_PATH.test(value.file)) {
    throw new TypeError(`Duration file ${index + 1} must identify a maintained top-level unit test.`);
  }
  return Object.freeze({
    file: value.file,
    durationMs: boundedDuration(value.durationMs, `Duration for ${value.file}`),
    tests: boundedInteger(value.tests, `Test count for ${value.file}`, 1, 100_000),
    failures: boundedInteger(value.failures, `Failure count for ${value.file}`, 0, 100_000),
  });
}

export function parseTestDurationData(input: string): TestDurationData {
  const bytes = Buffer.byteLength(input, 'utf8');
  if (bytes < 1 || bytes > MAX_TEST_DURATION_REPORT_BYTES) {
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
    passed: boundedInteger(parsed.totals.passed, 'Passed count', 0, 1_000_000),
    failed: boundedInteger(parsed.totals.failed, 'Failed count', 0, 1_000_000),
    cancelled: boundedInteger(parsed.totals.cancelled, 'Cancelled count', 0, 1_000_000),
    skipped: boundedInteger(parsed.totals.skipped, 'Skipped count', 0, 1_000_000),
    todo: boundedInteger(parsed.totals.todo, 'Todo count', 0, 1_000_000),
    durationMs: boundedDuration(parsed.totals.durationMs, 'Run duration'),
  });
  if (totals.failed || totals.cancelled || totals.skipped || totals.todo || totals.passed < 1) {
    throw new TypeError('Timing health requires a complete passing, non-cancelled, non-skipped run.');
  }
  if (!Array.isArray(parsed.files) || parsed.files.length < 1 || parsed.files.length > 1_000) {
    throw new TypeError('Test duration files exceed the maintained inventory bound.');
  }
  const files = Object.freeze(parsed.files.map(parseDurationFile));
  const identities = files.map((file) => file.file);
  if (new Set(identities).size !== identities.length) throw new TypeError('Test duration file identities must be unique.');
  if (files.some((file) => file.failures !== 0) || files.reduce((sum, file) => sum + file.tests, 0) !== totals.passed) {
    throw new TypeError('Test duration file summaries do not match the accepted run totals.');
  }
  return Object.freeze({ version: 1, totals, files });
}

function boundedName(value: string): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  return normalized.length > MAX_REPORTED_NAME_LENGTH
    ? `${normalized.slice(0, MAX_REPORTED_NAME_LENGTH - 1)}…`
    : normalized;
}

function relativeFile(value: string): string {
  const relative = path.relative(REPOSITORY_ROOT, path.resolve(value)).split(path.sep).join('/');
  if (!relative || relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) return UNKNOWN_FILE;
  return boundedName(relative) || UNKNOWN_FILE;
}

function duration(value: number): string {
  return `${value.toFixed(value >= 100 ? 0 : 1)} ms`;
}

function countLabel(value: number, singular: string): string {
  return `${value} ${singular}${value === 1 ? '' : 's'}`;
}

export function createTestDurationReport(
  records: readonly TestDurationRecord[],
  limit = DEFAULT_LIMIT,
  runTotals?: TestRunTotals,
): string {
  const safeLimit = Number.isSafeInteger(limit) && limit > 0
    ? Math.min(limit, 100)
    : DEFAULT_LIMIT;
  const ordered = [...records]
    .filter((record) => Number.isFinite(record.durationMs) && record.durationMs >= 0)
    .sort((left, right) => (
      right.durationMs - left.durationMs
      || left.file.localeCompare(right.file)
      || left.name.localeCompare(right.name)
    ));
  const byFile = new Map<string, { durationMs: number; tests: number; failures: number }>();
  for (const record of ordered) {
    const current = byFile.get(record.file) ?? { durationMs: 0, tests: 0, failures: 0 };
    current.durationMs += record.durationMs;
    current.tests += 1;
    if (record.failed) current.failures += 1;
    byFile.set(record.file, current);
  }
  const files = [...byFile.entries()]
    .sort(([leftFile, left], [rightFile, right]) => (
      right.durationMs - left.durationMs || leftFile.localeCompare(rightFile)
    ))
    .slice(0, safeLimit);
  const failures = ordered.filter((record) => record.failed).length;
  const totals = runTotals ?? Object.freeze({
    passed: ordered.length - failures,
    failed: failures,
    cancelled: 0,
    skipped: 0,
    todo: 0,
    durationMs: ordered.reduce((sum, record) => sum + record.durationMs, 0),
  });
  const data: TestDurationData = Object.freeze({
    version: 1,
    totals,
    files: Object.freeze([...byFile.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([file, summary]) => Object.freeze({
        file,
        durationMs: Number(summary.durationMs.toFixed(3)),
        tests: summary.tests,
        failures: summary.failures,
      }))),
  });
  const lines = [
    'Test duration profile',
    `Measured ${countLabel(ordered.length, 'test')} across ${countLabel(byFile.size, 'file')}; ${failures} failed.`,
    `Accepted totals: ${totals.passed} passed, ${totals.failed} failed, ${totals.cancelled} cancelled, ${totals.skipped} skipped, ${totals.todo} todo.`,
    `Unit lane duration: ${duration(totals.durationMs)}.`,
    '',
    `Slowest files (top ${Math.min(safeLimit, files.length)}):`,
    ...files.map(([file, summary], index) => (
      `${index + 1}. ${file}: ${duration(summary.durationMs)} across ${countLabel(summary.tests, 'test')}`
      + (summary.failures ? `, ${summary.failures} failed` : '')
    )),
    '',
    `Slowest tests (top ${Math.min(safeLimit, ordered.length)}):`,
    ...ordered.slice(0, safeLimit).map((record, index) => (
      `${index + 1}. ${record.file} :: ${boundedName(record.name) || '(unnamed test)'}: ${duration(record.durationMs)}`
      + (record.failed ? ' [failed]' : '')
    )),
    '',
    TEST_DURATION_DATA_BEGIN,
    JSON.stringify(data),
    TEST_DURATION_DATA_END,
  ];
  return `${lines.join('\n')}\n`;
}

export default async function* testDurationReporter(
  source: AsyncIterable<TestEvent>,
): AsyncGenerator<string> {
  const records: TestDurationRecord[] = [];
  let runTotals: TestRunTotals | undefined;
  for await (const event of source) {
    if (event.type === 'test:summary' && event.data.file === undefined) {
      const counts = event.data.counts;
      const failed = Math.max(0, counts.tests - counts.passed - counts.cancelled - counts.skipped - counts.todo);
      runTotals = Object.freeze({
        passed: counts.passed,
        failed,
        cancelled: counts.cancelled,
        skipped: counts.skipped,
        todo: counts.todo,
        durationMs: event.data.duration_ms,
      });
      continue;
    }
    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;
    if (event.data.details.type === 'suite') continue;
    records.push(Object.freeze({
      name: event.data.name,
      file: relativeFile(event.data.file ?? UNKNOWN_FILE),
      durationMs: event.data.details.duration_ms,
      failed: event.type === 'test:fail',
    }));
  }
  yield createTestDurationReport(records, DEFAULT_LIMIT, runTotals);
}
