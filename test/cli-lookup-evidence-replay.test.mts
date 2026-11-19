import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { CLI_LOOKUP_EVIDENCE_DIFF_SCHEMA } from '../cli/lookup-evidence-diff.mts';
import { CLI_LOOKUP_EVIDENCE_VIEW_SCHEMA } from '../cli/lookup-evidence-replay.mts';
import { buildLookupEvidence } from '../frontend/src/lib/analysis/evidence-export.ts';
import { parseLookupEvidenceReplay } from '../frontend/src/lib/analysis/lookup-evidence-replay.ts';
import { buildLookupEvidenceReplayDiff } from '../frontend/src/lib/analysis/lookup-evidence-replay-diff.ts';

const EARLIER = '2026-08-01T00:00:00.000Z';
const LATER = '2026-08-08T00:00:00.000Z';
const saved = JSON.parse(readFileSync(new URL('./fixtures/cli-lookup-v1.json', import.meta.url), 'utf8'));

async function files(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'whoisleuth-evidence-diff-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return async (name: string, value: string) => {
    const path = join(root, name);
    await writeFile(path, value, { mode: 0o600 });
    return path;
  };
}

async function cli(args: string[], now = LATER) {
  let stdout = '', stderr = '';
  const code = await runCli(args, { now: () => now, stdout: { write: (value: string) => { stdout += value; } },
    stderr: { write: (value: string) => { stderr += value; } } });
  return { code, stdout, stderr };
}

async function cliExport(file: Awaited<ReturnType<typeof files>>, name: string, lookup: unknown, now: string) {
  const result = await cli(['export', await file(`${name}-lookup.json`, JSON.stringify(lookup))], now);
  assert.equal(result.code, EXIT_CODES.SUCCESS, result.stderr);
  return result.stdout;
}

const laterLookup = () => {
  const value = structuredClone(saved);
  value.rdap.parsed.nameservers = ['ns2.example.test'];
  return value;
};

test('diff compares a browser evidence download with a CLI export exactly as browser replay does', async t => {
  const file = await files(t);
  // A browser download and a CLI export of a later observation, from the same shared builder.
  const browserDownload = `${JSON.stringify(buildLookupEvidence(saved, { generatedAt: EARLIER, idnAnalysis: null }), null, 2)}\n`;
  const cliEvidence = await cliExport(file, 'later', laterLookup(), LATER);
  const result = await cli(['diff', await file('earlier.json', browserDownload), await file('later.json', cliEvidence), '--json']);
  assert.equal(result.code, EXIT_CODES.SUCCESS, result.stderr);
  const document = JSON.parse(result.stdout);
  assert.equal(document.schema, CLI_LOOKUP_EVIDENCE_DIFF_SCHEMA);
  assert.equal(document.target, 'example.test');
  assert.equal(document.left.exportedAt, EARLIER);
  assert.equal(document.right.exportedAt, LATER);

  const browser = buildLookupEvidenceReplayDiff(await parseLookupEvidenceReplay(browserDownload), await parseLookupEvidenceReplay(cliEvidence));
  assert.deepEqual(document.comparison.rows, JSON.parse(JSON.stringify(browser.rows)));
  assert.deepEqual(document.comparison.counts, browser.counts);
  assert.ok(document.comparison.counts.observedChanges >= 1);
  assert.equal(document.comparison.rows.find((row: { id: string }) => row.id === 'fact:registration.nameservers')?.kind, 'observed_change');

  const terminal = await cli(['diff', await file('earlier-2.json', browserDownload), await file('later-2.json', cliEvidence)]);
  assert.equal(terminal.code, EXIT_CODES.SUCCESS, terminal.stderr);
  assert.match(terminal.stdout, /^Lookup evidence comparison\n/u);
  assert.match(terminal.stdout, /\[observed change\]/u);
  assert.doesNotMatch(terminal.stdout, /\[unchanged\]/u);
});

test('evidence diff keeps the given order instead of inferring observation order from export time', async t => {
  const file = await files(t);
  // The left observation was exported later than the right one; neither export time is an observation time.
  const left = await file('left.json', await cliExport(file, 'left', laterLookup(), LATER));
  const right = await file('right.json', await cliExport(file, 'right', saved, EARLIER));
  const result = await cli(['diff', left, right, '--json']);
  assert.equal(result.code, EXIT_CODES.SUCCESS, result.stderr);
  const document = JSON.parse(result.stdout);
  assert.deepEqual([document.left.exportedAt, document.right.exportedAt], [LATER, EARLIER]);
  const nameservers = document.comparison.rows.find((row: { id: string }) => row.id === 'fact:registration.nameservers');
  assert.deepEqual([nameservers.left, nameservers.right], ['ns2.example.test', 'ns1.example.test']);
  const terminal = await cli(['diff', left, right]);
  assert.equal(terminal.code, EXIT_CODES.SUCCESS, terminal.stderr);
  assert.match(terminal.stdout, new RegExp(`^Left export {6}exported ${LATER}`, 'mu'));
  assert.match(terminal.stdout, /^ {2}Left: {2}ns2\.example\.test\n {2}Right: ns1\.example\.test$/mu);
  assert.doesNotMatch(terminal.stdout, /Earlier|Later/u);
});

test('evidence diff does not report an uncollected page result as an observed change', async t => {
  const file = await files(t);
  // A complete page capture followed by an unavailable one whose fallback cue is false.
  const capture = (page: 'complete' | 'unavailable', hasPasswordField: boolean, observedAt: string) => {
    const lookup = structuredClone(saved);
    Object.assign(lookup.availability, {
      hasPasswordField,
      pageIdentity: page === 'complete' ? { status: 'success', complete: true, observedAt } : { status: 'unavailable', observedAt },
      webCollectionQuality: { version: 1, page, favicon: 'unknown', combined: page === 'complete' ? 'partial' : 'unavailable' },
    });
    return `${JSON.stringify(buildLookupEvidence(lookup, { generatedAt: observedAt, idnAnalysis: null }))}\n`;
  };
  const complete = capture('complete', true, EARLIER), unavailable = capture('unavailable', false, LATER);
  const replay = await parseLookupEvidenceReplay(unavailable);
  assert.equal(replay.webCollection?.page, 'unavailable');
  assert.equal(replay.facts.find(fact => fact.id === 'page.password-field'), undefined, 'a fallback false is not an observed absence');
  assert.ok(replay.limitations.some(item => /Page collection was unavailable/u.test(item)));

  const result = await cli(['diff', await file('complete.json', complete), await file('unavailable.json', unavailable), '--json']);
  assert.equal(result.code, EXIT_CODES.SUCCESS, result.stderr);
  const rows: Array<{ id: string; kind: string; left: string; right: string }> = JSON.parse(result.stdout).comparison.rows;
  assert.equal(rows.find(row => row.id === 'source:page-identity')?.kind, 'collection_quality_difference');
  const password = rows.find(row => row.id === 'fact:page.password-field');
  assert.deepEqual([password?.kind, password?.left, password?.right], ['collection_quality_difference', 'true', 'not recorded']);
  assert.ok(rows.every(row => !row.id.startsWith('fact:page.') || row.kind !== 'observed_change'));

  // Complete observed absence on both sides remains an observed change.
  const absent = await parseLookupEvidenceReplay(capture('complete', false, LATER));
  const observed = buildLookupEvidenceReplayDiff(await parseLookupEvidenceReplay(complete), absent);
  assert.equal(observed.rows.find(row => row.id === 'fact:page.password-field')?.kind, 'observed_change');
});

test('evidence diff refuses mixed, cross-target and browse requests before comparing', async t => {
  const file = await files(t);
  const earlier = await file('earlier.json', await cliExport(file, 'earlier', saved, EARLIER));
  const later = await file('later.json', await cliExport(file, 'later', laterLookup(), LATER));
  const other = JSON.parse(await cliExport(file, 'other', laterLookup(), LATER));
  Object.assign(other.query, { submitted: 'other.example.test', inputHostname: 'other.example.test', registrableDomain: 'other.example.test' });
  const otherEvidence = await file('other.json', JSON.stringify(other));
  const savedLookup = await file('saved.json', JSON.stringify(saved));

  const cases: Array<[string[], RegExp]> = [
    [['diff', savedLookup, later], /Run whoisleuth export on the saved Lookup first/u],
    [['diff', earlier, otherEvidence], /same target/u],
    // Without an interactive terminal, the existing browse guard refuses first.
    [['diff', earlier, later, '--browse'], /--browse/u],
    [['diff', earlier, later, '--left-session', 'one'], /Saved-session selectors apply only to Bulk session exports/u],
  ];
  for (const [args, message] of cases) {
    const result = await cli(args);
    assert.equal(result.code, EXIT_CODES.USAGE, args.join(' '));
    assert.equal(result.stdout, '');
    assert.match(result.stderr, message);
  }
});

test('view reads a browser evidence download exactly as browser replay does', async t => {
  const file = await files(t);
  const browserDownload = `${JSON.stringify(buildLookupEvidence(saved, { generatedAt: EARLIER, idnAnalysis: null }), null, 2)}\n`;
  const path = await file('evidence.json', browserDownload);
  const result = await cli(['view', path, '--json']);
  assert.equal(result.code, EXIT_CODES.SUCCESS, result.stderr);
  const document = JSON.parse(result.stdout);
  assert.equal(document.schema, CLI_LOOKUP_EVIDENCE_VIEW_SCHEMA);
  assert.equal(document.generatedAt, LATER);
  assert.deepEqual(document.replay, JSON.parse(JSON.stringify(await parseLookupEvidenceReplay(browserDownload))));

  const terminal = await cli(['view', path]);
  assert.equal(terminal.code, EXIT_CODES.SUCCESS, terminal.stderr);
  assert.match(terminal.stdout, /^Lookup evidence replay\nTarget {11}example\.test\n/u);
  for (const heading of ['Sources:', 'Normalised facts:', 'Next manual steps:', 'Limitations:']) {
    assert.match(terminal.stdout, new RegExp(`^${heading}$`, 'mu'));
  }
  assert.match(terminal.stdout, new RegExp(`File SHA-256 {5}${document.replay.digestSha256}`, 'u'));

  // A saved Lookup still uses the saved-Lookup reader.
  const lookup = await cli(['view', await file('lookup.json', JSON.stringify(saved)), '--json']);
  assert.equal(lookup.code, EXIT_CODES.SUCCESS, lookup.stderr);
  assert.notEqual(JSON.parse(lookup.stdout).schema, CLI_LOOKUP_EVIDENCE_VIEW_SCHEMA);
});

test('view reports invalid evidence exports as usage errors without output', async t => {
  const file = await files(t);
  const evidence = JSON.parse(await cliExport(file, 'saved', saved, EARLIER));
  evidence.schemaVersion = 9999;
  const result = await cli(['view', await file('future.json', JSON.stringify(evidence))]);
  assert.equal(result.code, EXIT_CODES.USAGE);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Evidence export:/u);
});
