import type { TestEvent } from 'node:test/reporters';

const DEFAULT_LIMIT = 20;
const MAX_REPORTED_NAME_LENGTH = 180;
const UNKNOWN_FILE = '(unknown file)';

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

function boundedName(value: string): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  return normalized.length > MAX_REPORTED_NAME_LENGTH
    ? `${normalized.slice(0, MAX_REPORTED_NAME_LENGTH - 1)}…`
    : normalized;
}

function relativeFile(value: string): string {
  const normalized = value.replaceAll('\\', '/');
  const marker = '/whois-rdap-tool/';
  const position = normalized.lastIndexOf(marker);
  return boundedName(position >= 0 ? normalized.slice(position + marker.length) : normalized) || UNKNOWN_FILE;
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
