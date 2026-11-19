import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectWebArchiveHistory, formatWebArchiveHistory } from '../lib/web-archive-history.mts';
import { readWebArchiveHistory, webArchiveCaptureUrl, webArchiveTimestamp, normaliseWebArchiveRequest } from '../packages/evidence/web-archive-history.mts';
import type { safeFetch } from '../lib/safe-fetch.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';

const AT = '2026-10-01T00:00:00.000Z';
const DOMAIN = 'archive-review.example';
function fixture(respond: (limit: string) => Response | Promise<Response>) {
  const calls: Array<{ url: string; redirects: number | undefined }> = [];
  const fetch: typeof safeFetch = async (url, _options, redirects) => {
    calls.push({ url, redirects });
    return respond(new URL(url).searchParams.get('limit') ?? '');
  };
  return { calls, dependencies: { fetch, now: () => AT } };
}

test('collects the earliest and latest homepage captures with only the domain sent', async () => {
  const { calls, dependencies } = fixture((limit) => Response.json(limit === '1'
    ? [['timestamp', 'statuscode'], ['20120304050607', '200']]
    : [['timestamp', 'statuscode'], ['20260901000000', '-']]));
  const report = await collectWebArchiveHistory(DOMAIN, {}, dependencies);
  assert.deepEqual(report.queries.map((query) => [query.kind, query.outcome, query.capturedAt, query.capturedStatus]), [
    ['earliest', 'capture', '2012-03-04T05:06:07.000Z', 200],
    ['latest', 'capture', '2026-09-01T00:00:00.000Z', null],
  ]);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    const url = new URL(call.url);
    assert.equal(url.origin + url.pathname, 'https://web.archive.org/cdx/search/cdx');
    assert.equal(url.searchParams.get('url'), DOMAIN);
    assert.equal(url.searchParams.get('fl'), 'timestamp,statuscode');
    assert.equal(call.redirects, 0);
  }
  assert.deepEqual(readWebArchiveHistory(JSON.parse(JSON.stringify(report)), DOMAIN), report);
  assert.throws(() => readWebArchiveHistory(report, 'other.example'));
  assert.match(formatWebArchiveHistory(report), /^Earliest capture: 2012-03-04T05:06:07\.000Z · HTTP 200$/mu);
});

test('no captures, failures and malformed responses stay distinct rather than becoming absence', async () => {
  const empty = await collectWebArchiveHistory(DOMAIN, {}, fixture(() => Response.json([])).dependencies);
  assert.deepEqual(empty.queries.map((query) => query.outcome), ['no_capture', 'no_capture']);
  const failed = await collectWebArchiveHistory(DOMAIN, {}, fixture(() => new Response('busy', { status: 503 })).dependencies);
  assert.deepEqual(failed.queries.map((query) => query.outcome), ['invalid_response', 'invalid_response']);
  const malformed = await collectWebArchiveHistory(DOMAIN, {}, fixture(() => Response.json([['timestamp', 'statuscode'], ['not-a-time', '200']])).dependencies);
  assert.deepEqual(malformed.queries.map((query) => query.outcome), ['invalid_response', 'invalid_response']);
  const unreachable = await collectWebArchiveHistory(DOMAIN, {}, fixture(() => { throw new TypeError('network'); }).dependencies);
  assert.deepEqual(unreachable.queries.map((query) => query.outcome), ['error', 'error']);
  assert.ok([empty, failed, malformed, unreachable].every((report) => report.queries.every((query) => query.capturedAt === null)));
});

test('requests, timestamps and capture links are validated and bounded', async () => {
  assert.throws(() => normaliseWebArchiveRequest('https://archive-review.example/'));
  assert.throws(() => normaliseWebArchiveRequest(' archive-review.example'));
  assert.throws(() => normaliseWebArchiveRequest('192.0.2.1'));
  assert.equal(webArchiveTimestamp('2012'), '2012-01-01T00:00:00.000Z');
  assert.equal(webArchiveTimestamp('20121399000000'), null);
  assert.equal(webArchiveCaptureUrl(DOMAIN, '2012-03-04T05:06:07.000Z'), 'https://web.archive.org/web/20120304050607/archive-review.example/');
  const oversized = fixture(() => new Response(JSON.stringify([['timestamp', 'statuscode'], ['20120304050607', 'x'.repeat(20_000)]])));
  const report = await collectWebArchiveHistory(DOMAIN, {}, oversized.dependencies);
  assert.deepEqual(report.queries.map((query) => query.outcome), ['invalid_response', 'invalid_response']);
});

test('the CLI command sends one validated domain and reports failed queries as partial', async () => {
  const output = { value: '' }, errors = { value: '' };
  const io = { stdout: { write: (value: string) => { output.value += value; } }, stderr: { write: (value: string) => { errors.value += value; } } };
  const captured = await collectWebArchiveHistory(DOMAIN, {}, fixture((limit) => Response.json(limit === '1'
    ? [['timestamp', 'statuscode'], ['20120304050607', '200']] : [['timestamp', 'statuscode'], ['20260901000000', '200']])).dependencies);
  const calls: unknown[] = [];
  assert.equal(await runCli(['archive-history', 'Archive-Review.example', '--json'], { ...io,
    collectWebArchiveHistory: async (domain: unknown) => { calls.push(domain); return captured; } }), EXIT_CODES.SUCCESS);
  assert.deepEqual(calls, [DOMAIN]);
  assert.deepEqual(JSON.parse(output.value), JSON.parse(JSON.stringify(captured)));
  const failed = await collectWebArchiveHistory(DOMAIN, {}, fixture(() => { throw new TypeError('network'); }).dependencies);
  output.value = '';
  assert.equal(await runCli(['archive-history', DOMAIN], { ...io, collectWebArchiveHistory: async () => failed }), EXIT_CODES.PARTIAL_FAILURE);
  assert.match(output.value, /^Earliest capture: error$/mu);
  assert.equal(await runCli(['archive-history', 'https://archive-review.example/'], { ...io,
    collectWebArchiveHistory: async () => assert.fail('Invalid input must not collect') }), EXIT_CODES.USAGE);
});
