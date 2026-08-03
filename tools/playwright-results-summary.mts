import {
  appendFileSync,
  readFileSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_RESULTS_BYTES = 64 * 1024 * 1024;
const MAX_TEST_RESULTS = 4_000;
const MAX_TREE_DEPTH = 32;
const MAX_TEXT_LENGTH = 180;
const SLOW_TEST_LIMIT = 10;

type RecordValue = Record<string, unknown>;

type PlaywrightTestResult = Readonly<{
  title: string;
  file: string;
  status: 'passed' | 'failed' | 'flaky' | 'skipped';
  durationMs: number;
  retried: boolean;
  extraAttempts: number;
  attachments: readonly string[];
}>;

export type PlaywrightResultSummary = Readonly<{
  label: string;
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  retried: number;
  extraAttempts: number;
  truncated: boolean;
  slowest: readonly PlaywrightTestResult[];
  failureAttachments: readonly string[];
}>;

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function boundedText(value: unknown): string {
  if (typeof value !== 'string') return '';
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return normalized.slice(0, MAX_TEXT_LENGTH);
}

function relativeFile(value: unknown): string {
  const normalized = boundedText(value).replaceAll('\\', '/');
  const e2ePosition = normalized.lastIndexOf('/e2e/');
  if (e2ePosition >= 0) return normalized.slice(e2ePosition + 1);
  return normalized.startsWith('e2e/') ? normalized : path.basename(normalized) || '(unknown file)';
}

function finiteDuration(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(value, 24 * 60 * 60 * 1_000)
    : 0;
}

function resultStatus(test: RecordValue, results: readonly RecordValue[]): PlaywrightTestResult['status'] {
  if (test.status === 'flaky') return 'flaky';
  if (test.status === 'unexpected') return 'failed';
  if (test.status === 'skipped') return 'skipped';
  if (test.status === 'expected') return 'passed';
  const finalStatus = results.at(-1)?.status;
  if (finalStatus === 'skipped') return 'skipped';
  if (finalStatus === 'passed') return results.length > 1 ? 'flaky' : 'passed';
  return 'failed';
}

function testResult(
  rawTest: unknown,
  title: string,
  file: string,
): PlaywrightTestResult | null {
  const test = record(rawTest);
  if (!test) return null;
  const results = Array.isArray(test.results)
    ? test.results.map(record).filter((value): value is RecordValue => value !== null)
    : [];
  const attachments = [...new Set(results.flatMap((result) => (
    Array.isArray(result.attachments)
      ? result.attachments.map((attachment) => boundedText(record(attachment)?.name)).filter(Boolean)
      : []
  )))].slice(0, 20);
  const retryValues = results.map((result) => (
    typeof result.retry === 'number' && Number.isSafeInteger(result.retry) && result.retry > 0
      ? result.retry
      : 0
  ));
  const extraAttempts = Math.max(results.length - 1, ...retryValues, 0);
  return Object.freeze({
    title: boundedText(title) || '(unnamed test)',
    file: relativeFile(file),
    status: resultStatus(test, results),
    durationMs: results.reduce((total, result) => total + finiteDuration(result.duration), 0),
    retried: extraAttempts > 0,
    extraAttempts,
    attachments,
  });
}

function collectSuites(
  rawSuites: unknown,
  output: PlaywrightTestResult[],
  parentTitles: readonly string[],
  depth: number,
): boolean {
  if (!Array.isArray(rawSuites) || depth > MAX_TREE_DEPTH) return depth > MAX_TREE_DEPTH;
  let truncated = false;
  for (const rawSuite of rawSuites) {
    if (output.length >= MAX_TEST_RESULTS) return true;
    const suite = record(rawSuite);
    if (!suite) continue;
    const suiteTitle = boundedText(suite.title);
    const defaultFile = relativeFile(suite.file);
    const titles = suiteTitle && suiteTitle !== path.basename(defaultFile)
      ? [...parentTitles, suiteTitle]
      : parentTitles;
    if (Array.isArray(suite.specs)) {
      for (const rawSpec of suite.specs) {
        if (output.length >= MAX_TEST_RESULTS) return true;
        const spec = record(rawSpec);
        if (!spec) continue;
        const specTitle = boundedText(spec.title);
        const title = [...titles, specTitle].filter(Boolean).join(' › ');
        const file = boundedText(spec.file) ? relativeFile(spec.file) : defaultFile;
        if (!Array.isArray(spec.tests)) continue;
        for (const rawTest of spec.tests) {
          if (output.length >= MAX_TEST_RESULTS) return true;
          const projected = testResult(rawTest, title, file);
          if (projected) output.push(projected);
        }
      }
    }
    truncated = collectSuites(suite.suites, output, titles, depth + 1) || truncated;
  }
  return truncated;
}

export function summarizePlaywrightResults(
  raw: unknown,
  rawLabel = '',
): PlaywrightResultSummary {
  const root = record(raw);
  if (!root) throw new Error('Playwright result data must be an object.');
  const results: PlaywrightTestResult[] = [];
  const truncated = collectSuites(root.suites, results, [], 0);
  const failures = results.filter(({ status }) => status === 'failed');
  const diagnostics = results.filter(({ status }) => status === 'failed' || status === 'flaky');
  return Object.freeze({
    label: boundedText(rawLabel) || 'run',
    total: results.length,
    passed: results.filter(({ status }) => status === 'passed').length,
    failed: failures.length,
    flaky: results.filter(({ status }) => status === 'flaky').length,
    skipped: results.filter(({ status }) => status === 'skipped').length,
    retried: results.filter(({ retried }) => retried).length,
    extraAttempts: results.reduce((total, result) => total + result.extraAttempts, 0),
    truncated,
    slowest: [...results]
      .sort((left, right) => right.durationMs - left.durationMs || left.title.localeCompare(right.title))
      .slice(0, SLOW_TEST_LIMIT),
    failureAttachments: [...new Set(diagnostics.flatMap(({ attachments }) => attachments))].slice(0, 20),
  });
}

function markdown(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', '&#124;')
    .replaceAll('`', '&#96;');
}

export function renderPlaywrightResultSummary(summary: PlaywrightResultSummary): string {
  const lines = [
    `## Playwright result summary: ${markdown(summary.label)}`,
    '',
    '| Result | Count |',
    '| --- | ---: |',
    `| Passed | ${summary.passed} |`,
    `| Failed | ${summary.failed} |`,
    `| Flaky | ${summary.flaky} |`,
    `| Skipped | ${summary.skipped} |`,
    `| Retried tests | ${summary.retried} |`,
    `| Extra attempts | ${summary.extraAttempts} |`,
    '',
    `Total recorded tests: ${summary.total}${summary.truncated ? ' (bounded summary truncated)' : ''}.`,
    '',
    '### Slowest tests',
    '',
    ...(summary.slowest.length
      ? summary.slowest.map((result, index) => (
        `${index + 1}. ${markdown(result.file)}: ${markdown(result.title)} (${Math.round(result.durationMs)} ms, ${result.status})`
      ))
      : ['No test results were recorded.']),
  ];
  if (summary.failureAttachments.length) {
    lines.push('', `Failure attachment types: ${summary.failureAttachments.map(markdown).join(', ')}.`);
  }
  return `${lines.join('\n')}\n`;
}

function main(): void {
  const resultPath = process.argv[2] || 'playwright-results.json';
  let output: string;
  try {
    const size = statSync(resultPath).size;
    if (size > MAX_RESULTS_BYTES) throw new Error('Playwright result data exceeds the 64 MiB diagnostic limit.');
    const parsed: unknown = JSON.parse(readFileSync(resultPath, 'utf8'));
    output = renderPlaywrightResultSummary(summarizePlaywrightResults(
      parsed,
      process.env.WHOISLEUTH_PLAYWRIGHT_RUN_LABEL,
    ));
  } catch (error) {
    const detail = error instanceof Error ? boundedText(error.message) : 'unknown diagnostic error';
    output = `## Playwright result summary\n\nResult data was unavailable: ${markdown(detail)}.\n`;
  }
  process.stdout.write(output);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) appendFileSync(summaryPath, output, 'utf8');
}

const entryPoint = process.argv[1];
if (entryPoint && pathToFileURL(entryPoint).href === import.meta.url) main();
