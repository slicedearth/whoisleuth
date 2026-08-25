import type { TestEvent } from 'node:test/reporters';

function assertionFailure(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== 'object' || depth > 8) return false;
  const error = value as { code?: unknown; cause?: unknown; error?: unknown };
  return error.code === 'ERR_ASSERTION'
    || assertionFailure(error.cause, depth + 1)
    || assertionFailure(error.error, depth + 1);
}

export default async function* mutationTestReporter(source: AsyncIterable<TestEvent>): AsyncGenerator<string> {
  let assertionFailures = 0;
  let nonAssertionFailures = 0;
  let summary: null | {
    tests: number;
    passed: number;
    failed: number;
    cancelled: number;
    skipped: number;
    todo: number;
    durationMs: number;
  } = null;
  for await (const event of source) {
    if (event.type === 'test:fail' && event.data.details.type !== 'suite') {
      if (assertionFailure(event.data.details.error)) assertionFailures += 1;
      else nonAssertionFailures += 1;
    }
    if (event.type === 'test:summary' && event.data.file === undefined) {
      const counts = event.data.counts;
      summary = {
        tests: counts.tests,
        passed: counts.passed,
        failed: Math.max(0, counts.tests - counts.passed - counts.cancelled - counts.skipped - counts.todo),
        cancelled: counts.cancelled,
        skipped: counts.skipped,
        todo: counts.todo,
        durationMs: event.data.duration_ms,
      };
    }
  }
  yield `${JSON.stringify({ ...(summary ?? {}), assertionFailures, nonAssertionFailures })}\n`;
}
