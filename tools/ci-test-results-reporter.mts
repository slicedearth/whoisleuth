import type { TestEvent } from 'node:test/reporters';
import path from 'node:path';
import { summaryText, writeCiSummary } from './ci-summary.mts';

const MAX_FAILURES = 12;

export default async function* ciTestResultsReporter(source: AsyncIterable<TestEvent>): AsyncGenerator<string> {
  let totals: string | null = null;
  let failures = 0;
  const findings: string[] = [];
  for await (const event of source) {
    if (!process.env.GITHUB_STEP_SUMMARY) continue;
    if (event.type === 'test:summary' && event.data.file === undefined) {
      const { tests, passed, cancelled, skipped, todo } = event.data.counts;
      const failed = Math.max(0, tests - passed - cancelled - skipped - todo);
      totals = `${passed} passed · ${failed} failed · ${cancelled} cancelled · ${skipped} skipped · ${todo} todo`;
      if (!event.data.success && failed === 0 && cancelled === 0) {
        totals += '. The runner did not accept the run; check coverage or startup diagnostics';
      }
    }
    if (event.type !== 'test:fail' || event.data.details.type === 'suite') continue;
    failures++;
    if (findings.length >= MAX_FAILURES) continue;
    const { file, line, name, details } = event.data;
    const relative = file ? path.relative(process.cwd(), file).split(path.sep).join('/') : '';
    const location = /^test\/[\w.-]+\.test\.mts$/u.test(relative) ? `${relative}${line ? `:${line}` : ''}` : 'Test runner';
    const error = details.error as Error & { code?: string; cause?: { code?: string } };
    const reason = error.cause?.code === 'ERR_ASSERTION' || error.code === 'ERR_ASSERTION'
      ? 'Assertion failed' : 'Test or worker did not complete successfully';
    findings.push(`- ${summaryText(location)} — ${summaryText(name)}: ${reason}.`);
  }
  if (totals === null && failures === 0) return;
  const seed = process.env.WHOISLEUTH_FAST_CHECK_SEED;
  const seedNote = seed && /^\d{1,10}$/u.test(seed) ? ` Property seed: ${seed}.` : '';
  const sample = process.env.WHOISLEUTH_CI_PROFILE_SAMPLE;
  const label = process.env.npm_lifecycle_event;
  writeCiSummary([
    `## Node test results${label ? ` · ${summaryText(label)}` : ''}${sample && /^[123]$/u.test(sample) ? ` · sample ${sample}` : ''}`,
    '',
    (totals ?? 'No complete test totals were reported.') + seedNote,
    '',
    ...findings,
    ...(failures > findings.length ? [`- ${failures - findings.length} further failed results are in the test output.`] : []),
  ].join('\n'));
}
