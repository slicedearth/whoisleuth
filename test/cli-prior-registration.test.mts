import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { CLI_PRIOR_REGISTRATION_SCHEMA } from '../cli/prior-registration.mts';
import { WEB_ARCHIVE_HISTORY_SCHEMA, WEB_ARCHIVE_HISTORY_VERSION } from '../packages/evidence/web-archive-history.mts';

const AT = '2026-10-01T00:00:00.000Z';
const lookup = JSON.parse(readFileSync(new URL('./fixtures/cli-lookup-v1.json', import.meta.url), 'utf8'));
lookup.rdap.parsed.lifecycle = { createdDateIso: '2024-03-01T00:00:00.000Z' };
const ctResults = { schema: 'whoisleuth.cli.ct-search', version: 1, generatedAt: AT, keyword: 'example', certCount: 5, truncated: false, matches: [
  { domain: 'other.example', hostnames: [], firstObservedAt: '2010-01-01T00:00:00.000Z', lastObservedAt: null, certificateCount: 1 },
  { domain: 'example.test', hostnames: ['example.test'], firstObservedAt: '2019-06-10T12:00:00.000Z', lastObservedAt: AT, certificateCount: 4 },
] };
const archive = (domain = 'example.test') => ({ schema: WEB_ARCHIVE_HISTORY_SCHEMA, version: WEB_ARCHIVE_HISTORY_VERSION, domain,
  startedAt: AT, completedAt: AT, queries: [
    { kind: 'earliest', observedAt: AT, requestStarted: true, outcome: 'capture', capturedAt: '2024-05-01T00:00:00.000Z', capturedStatus: 200 },
    { kind: 'latest', observedAt: AT, requestStarted: true, outcome: 'capture', capturedAt: '2026-09-01T00:00:00.000Z', capturedStatus: 200 },
  ] });

async function cli(args: readonly string[], files: Record<string, unknown>) {
  const root = await mkdtemp(join(tmpdir(), 'whoisleuth-prior-registration-'));
  try {
    for (const [name, value] of Object.entries(files)) await writeFile(join(root, name), JSON.stringify(value), { mode: 0o600 });
    let stdout = '', stderr = '';
    const resolved = args.map((value) => Object.hasOwn(files, value) ? join(root, value) : value);
    const code = await runCli(resolved, { now: () => AT,
      stdout: { write: (value: string) => { stdout += value; } }, stderr: { write: (value: string) => { stderr += value; } } });
    return { code, stdout, stderr };
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('compares a saved Lookup with certificate and archive observations for the same domain', async () => {
  const files = { 'lookup.json': lookup, 'ct.json': ctResults, 'archive.json': archive() };
  const json = await cli(['prior-registration', 'lookup.json', '--ct-results', 'ct.json', '--archive-history', 'archive.json', '--json'], files);
  assert.equal(json.code, EXIT_CODES.SUCCESS, json.stderr);
  const document = JSON.parse(json.stdout);
  assert.equal(document.schema, CLI_PRIOR_REGISTRATION_SCHEMA);
  assert.equal(document.domain, 'example.test');
  assert.equal(document.registrationSource, 'Registry RDAP');
  assert.equal(document.review.state, 'earlier_observation');
  assert.deepEqual(document.review.observations.map((item: { source: string; daysBeforeRegistration: number | null }) =>
    [item.source, item.daysBeforeRegistration]), [['certificate_log', 1725], ['web_archive', null]]);
  const terminal = await cli(['prior-registration', 'lookup.json', '--ct-results', 'ct.json'], files);
  assert.match(terminal.stdout, /^Result {11}Observed before the current registration$/mu);
  assert.match(terminal.stdout, /^Earliest logged certificate {2}2019-06-10T12:00:00\.000Z · 1725 days before creation$/mu);
});

test('refuses missing supporting results, other domains and unrelated files', async () => {
  const files = { 'lookup.json': lookup, 'archive.json': archive('other.example'), 'ct.json': { schema: 'unrelated' } };
  for (const [args, message] of [
    [['prior-registration', 'lookup.json'], /--ct-results, --archive-history or both/u],
    [['prior-registration', 'lookup.json', '--archive-history', 'archive.json'], /different domain/u],
    [['prior-registration', 'lookup.json', '--ct-results', 'ct.json'], /ct-search --json/u],
  ] as const) {
    const result = await cli([...args], files);
    assert.equal(result.code, EXIT_CODES.USAGE, args.join(' '));
    assert.equal(result.stdout, '');
    assert.match(result.stderr, message);
  }
});

test('uses only a creation date from a successful registration source and validated certificate results', async () => {
  // RDAP failed but its retained display value remains; WHOIS is unavailable too.
  const failed = structuredClone(lookup);
  failed.diagnostics = { ...failed.diagnostics, rdap: { status: 'error', complete: false }, whois: { status: 'error' } };
  const files = {
    'failed.json': failed, 'ct.json': ctResults,
    // Duplicate rows for one domain merge to its earliest observation.
    'duplicate.json': { ...ctResults, matches: [
      { domain: 'example.test', hostnames: ['example.test'], firstObservedAt: '2023-01-01T00:00:00.000Z', lastObservedAt: AT, certificateCount: 1 },
      { domain: 'example.test', hostnames: ['www.example.test'], firstObservedAt: '2018-02-01T00:00:00.000Z', lastObservedAt: AT, certificateCount: 1 },
    ] },
    'uncounted.json': { ...ctResults, certCount: undefined },
    'lookup.json': lookup,
  };
  const unqualified = JSON.parse((await cli(['prior-registration', 'failed.json', '--ct-results', 'ct.json', '--json'], files)).stdout);
  assert.equal(unqualified.review.state, 'not_comparable');
  assert.equal(unqualified.registrationSource, null);
  assert.match(unqualified.review.limitations[0], /successful, complete registration source/u);

  const merged = JSON.parse((await cli(['prior-registration', 'lookup.json', '--ct-results', 'duplicate.json', '--json'], files)).stdout);
  assert.equal(merged.review.observations[0].observedAt, '2018-02-01T00:00:00.000Z');

  const invalid = await cli(['prior-registration', 'lookup.json', '--ct-results', 'uncounted.json'], files);
  assert.equal(invalid.code, EXIT_CODES.USAGE);
  assert.match(invalid.stderr, /certificate count/u);
});
