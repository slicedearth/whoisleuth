import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendFile, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../cli/runner.mts';
import { parseCliArguments } from '../cli/arguments.mts';
import { commandDefinition, commandHelp } from '../cli/command-reference.mts';
import { readDomainFeedFile } from '../cli/domain-feed.mts';
import { checkInstalledDomainFeed } from '../tools/cli-domain-feed-package-check.mts';

const deny = () => assert.fail('Offline feed review must not perform collection.');
async function run(args: readonly string[], extra: Parameters<typeof runCli>[1] = {}) {
  let stdout = '', stderr = '';
  const code = await runCli(args, { stdout: { write(value) { stdout += value; } }, stderr: { write(value) { stderr += value; } },
    now: () => '2026-10-04T00:00:00.000Z', runUnifiedLookup: deny, safeFetch: deny, resolvePublicAddresses: deny,
    whoisQuery: deny, fetchHomepage: deny, collectTlsIntelligence: deny, ...extra });
  return { code, stdout, stderr };
}

test('canonical CLI command is unconditionally offline with explicit feed, file and literal selectors', async () => {
  assert.equal(commandDefinition('domain-feed').execution.networkEffect, 'offline');
  assert.match(commandHelp('domain-feed'), /Always available offline/u);
  const parsed = parseCliArguments(['domain-feed', 'review', 'nrd7', 'feed.txt', '--select', 'host:exact.example', '--select', 'term:brand', '--json']);
  assert.equal(parsed.action, 'domain-feed');
  for (const args of [
    ['domain-feed', 'review', 'nrd7', 'feed.txt'],
    ['domain-feed', 'review', 'unlisted', 'feed.txt', '--select', 'host:exact.example'],
    ['domain-feed', 'review', 'nrd7', 'feed.txt', '--select', 'host:https://exact.example'],
    ['domain-feed', 'review', 'nrd7', 'feed.txt', '--select', 'regex:.*'],
    ['domain-feed', 'watch-input', 'nrd7', 'feed.txt', '--select', 'host:exact.example'],
    ['domain-feed', 'review', 'nrd7', 'feed.txt', 'context.json', '--select', 'host:exact.example'],
  ]) assert.throws(() => parseCliArguments(args));
  const help = await run(['domain-feed', '--help'], { readDomainFeedInput: () => assert.fail('Help must not open the feed') });
  assert.equal(help.code, 0); assert.equal(help.stderr, '');
});

test('installed-command verification helper composes real local streams with watchlist plan/export and refuses URLs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'domain-feed-cli-'));
  const labels: string[] = [];
  try {
    await checkInstalledDomainFeed(directory, async (args, label, expected = 0, diagnostics) => {
      const result = await run(args); assert.equal(result.code, expected, result.stderr);
      if (diagnostics) assert.match(result.stderr, diagnostics); else assert.equal(result.stderr, '');
      labels.push(label); return result.stdout;
    });
    assert.equal(labels.length, 5);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('changed, malformed, symlinked or aborted local files never emit a partial CLI document', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'domain-feed-admission-'));
  try {
    const source = join(directory, 'feed.txt'), linked = join(directory, 'linked.txt');
    await writeFile(source, 'exact.example\nhttps://bad.example/path');
    let result = await run(['domain-feed', 'review', 'tif-mini', source, '--select', 'host:exact.example', '--json']);
    assert.equal(result.code, 3); assert.equal(result.stdout, ''); assert.match(result.stderr, /plain domain/u);
    await writeFile(source, 'exact.example\n');
    const reader = readDomainFeedFile(source);
    assert.equal((await reader.next()).done, false);
    await appendFile(source, 'later.example\n');
    await assert.rejects(async () => { while (!(await reader.next()).done) { /* Drain admitted bytes. */ } }, /changed/u);
    await symlink(source, linked);
    await assert.rejects(async () => { for await (const _ of readDomainFeedFile(linked)) { /* Must refuse before yielding. */ } });
    const activeAbort = new AbortController(), activeReader = readDomainFeedFile(source, activeAbort.signal);
    assert.equal((await activeReader.next()).done, false);
    activeAbort.abort();
    await assert.rejects(() => activeReader.next(), /cancelled/u);
    const abort = new AbortController(); abort.abort();
    result = await run(['domain-feed', 'review', 'tif-mini', source, '--select', 'host:exact.example', '--json'], { signal: abort.signal });
    assert.equal(result.code, 130); assert.equal(result.stdout, '');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('watch-input cannot smuggle unreviewed candidates through an existing context document', async () => {
  let reads = 0;
  const result = await run(['domain-feed', 'watch-input', 'tif-mini', 'feed.txt', 'context.json', '--select', 'host:exact.example', '--json'], {
    readDomainFeedInput: () => { reads++; return { async *[Symbol.asyncIterator]() { yield new TextEncoder().encode('exact.example'); } }; },
    readArtifactInput: () => JSON.stringify({ schema: 'whoisleuth.candidate-watch-input', version: 1, watchlists: null,
      selection: { name: 'Explicit review', candidates: [{ domain: 'unreviewed.example', sources: [], matches: [] }], brandProfileId: null, priority: 'p3', reason: 'Review explicit candidates.' } }),
  });
  assert.equal(result.code, 2); assert.equal(result.stdout, ''); assert.equal(reads, 0); assert.match(result.stderr, /empty candidates/u);
});

test('CLI negative selectors veto before the bound and cannot select a feed alone', async () => {
  const result = await run(['domain-feed', 'review', 'nrd7', 'feed.txt', '--select', 'term:launch', '--select', 'exclude:excluded', '--json'], {
    readDomainFeedInput: () => ({ async *[Symbol.asyncIterator]() {
      yield new TextEncoder().encode(`${Array.from({ length: 220 }, (_, i) => `excluded-launch-${i}.example`).join('\n')}\nlaunch.example\n`);
    } }),
  });
  assert.equal(result.code, 0, result.stderr); assert.equal(result.stderr, '');
  const review = JSON.parse(result.stdout);
  assert.deepEqual(review.selection.negativeTerms, ['excluded']);
  assert.deepEqual(review.matches.map((value: { domain: string }) => value.domain), ['launch.example']);
  assert.equal(review.truncated, false);
  assert.match(commandHelp('domain-feed'), /exclude:<literal>/u);
  assert.throws(() => parseCliArguments(['domain-feed', 'review', 'nrd7', 'feed.txt', '--select', 'exclude:launch']), /exact host or literal term/u);
});
