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
import { buildLookupEvidence } from '../lib/evidence-export.mts';

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

test('a saved Lookup and its evidence export select the same qualified creation date', async () => {
  // Partial RDAP retains one date; complete WHOIS supplies another.
  const mixed = structuredClone(lookup);
  mixed.diagnostics = { ...mixed.diagnostics, rdap: { status: 'partial', complete: false } };
  mixed.rdap.parsed.lifecycle = { createdDateIso: '2024-09-01T00:00:00.000Z' };
  mixed.whois.parsed = { ...mixed.whois.parsed, createdDate: '2024-02-01T00:00:00Z' };
  const exported = buildLookupEvidence(mixed, { generatedAt: AT, idnAnalysis: null });
  const certificate = { ...ctResults, matches: [
    { domain: 'example.test', hostnames: ['example.test'], firstObservedAt: '2023-06-01T00:00:00.000Z', lastObservedAt: AT, certificateCount: 1 },
  ] };
  const files = { 'saved.json': mixed, 'evidence.json': exported, 'ct.json': certificate };
  const results = [];
  for (const input of ['saved.json', 'evidence.json']) {
    const result = await cli(['prior-registration', input, '--ct-results', 'ct.json', '--json'], files);
    assert.equal(result.code, EXIT_CODES.SUCCESS, result.stderr);
    const document = JSON.parse(result.stdout);
    results.push([document.registrationSource, document.review.registrationCreatedAt, document.review.state]);
  }
  assert.deepEqual(results[0], ['WHOIS', '2024-02-01T00:00:00.000Z', 'earlier_observation']);
  assert.deepEqual(results[1], results[0]);
});

test('contradictory certificate chronology for the domain is not used as an earlier observation', async () => {
  const pair = (firstObservedAt: string, lastObservedAt: string) => ({ ...ctResults, matches: [
    { domain: 'example.test', hostnames: ['example.test'], firstObservedAt, lastObservedAt, certificateCount: 1 },
    // A contradictory row for another domain does not affect this review.
    { domain: 'other.example', hostnames: [], firstObservedAt: '2026-01-01T00:00:00.000Z', lastObservedAt: '2010-01-01T00:00:00.000Z', certificateCount: 1 },
  ] });
  const files = { 'lookup.json': lookup, 'valid.json': pair('2025-01-01T00:00:00.000Z', AT), 'contradictory.json': pair('2025-01-01T00:00:00.000Z', '2019-01-01T00:00:00.000Z') };
  const valid = JSON.parse((await cli(['prior-registration', 'lookup.json', '--ct-results', 'valid.json', '--json'], files)).stdout);
  assert.equal(valid.review.state, 'no_earlier_observation');
  assert.equal(valid.excludedObservations, undefined);
  const contradictory = JSON.parse((await cli(['prior-registration', 'lookup.json', '--ct-results', 'contradictory.json', '--json'], files)).stdout);
  assert.equal(contradictory.review.state, 'not_comparable');
  assert.deepEqual(contradictory.review.observations, []);
  assert.match(contradictory.excludedObservations[0], /first observation later than the last for example\.test/u);
  const terminal = await cli(['prior-registration', 'lookup.json', '--ct-results', 'contradictory.json'], files);
  assert.match(terminal.stdout, /^The certificate search result reports a first observation later than the last/mu);
});

test('certificate validity starts are reported as context and cannot establish an earlier registration', async () => {
  const validityOnly = { ...ctResults, matches: [
    { domain: 'example.test', hostnames: ['example.test'], firstObservedAt: null, lastObservedAt: null, certificateCount: 1,
      firstValidFrom: '2019-01-01T00:00:00.000Z', lastValidFrom: '2019-01-01T00:00:00.000Z' },
  ] };
  const files = { 'lookup.json': lookup, 'validity.json': validityOnly, 'archive.json': archive() };
  const json = JSON.parse((await cli(['prior-registration', 'lookup.json', '--ct-results', 'validity.json', '--json'], files)).stdout);
  assert.equal(json.review.state, 'not_comparable');
  assert.deepEqual(json.review.observations.map((item: { source: string; context: boolean }) => [item.source, item.context]), [['certificate_validity', true]]);
  assert.ok(json.review.limitations.some((item: string) => /context only/u.test(item)));
  // An archive capture after creation decides the state; the earlier validity start does not.
  const combined = JSON.parse((await cli(['prior-registration', 'lookup.json', '--ct-results', 'validity.json', '--archive-history', 'archive.json', '--json'], files)).stdout);
  assert.equal(combined.review.state, 'no_earlier_observation');
  const terminal = await cli(['prior-registration', 'lookup.json', '--ct-results', 'validity.json'], files);
  assert.match(terminal.stdout, /Earliest certificate validity start\s+2019-01-01T00:00:00\.000Z · \d+ days before creation · context only/u);
});

test('a certificate result from the unpublished date-basis format cannot establish an earlier registration', async () => {
  const legacy = { ...ctResults, matches: [
    { domain: 'example.test', hostnames: ['example.test'], firstObservedAt: '2018-03-01T00:00:00.000Z', lastObservedAt: '2018-03-01T00:00:00.000Z',
      certificateCount: 1, dateBasis: 'validity_start' },
  ] };
  const files = { 'lookup.json': lookup, 'legacy.json': legacy };
  const json = JSON.parse((await cli(['prior-registration', 'lookup.json', '--ct-results', 'legacy.json', '--json'], files)).stdout);
  assert.equal(json.review.state, 'not_comparable');
  assert.deepEqual(json.review.observations, []);
});
