import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { CLI_LOOKUP_EVIDENCE_DIFF_SCHEMA } from '../cli/lookup-evidence-diff.mts';
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

test('evidence diff refuses reversed, mixed, cross-target and browse requests before comparing', async t => {
  const file = await files(t);
  const earlier = await file('earlier.json', await cliExport(file, 'earlier', saved, EARLIER));
  const later = await file('later.json', await cliExport(file, 'later', laterLookup(), LATER));
  const other = JSON.parse(await cliExport(file, 'other', laterLookup(), LATER));
  Object.assign(other.query, { submitted: 'other.example.test', inputHostname: 'other.example.test', registrableDomain: 'other.example.test' });
  const otherEvidence = await file('other.json', JSON.stringify(other));
  const savedLookup = await file('saved.json', JSON.stringify(saved));

  const cases: Array<[string[], RegExp]> = [
    [['diff', later, earlier], /earlier evidence export on the left/u],
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
