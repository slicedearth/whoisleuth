import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createPopularityRankReader, MAX_POPULARITY_LIST_BYTES, MAX_POPULARITY_LIST_ENTRIES, readPopularityRanks,
} from '../packages/analysis/popularity-list.mts';
import { runCli } from '../cli/runner.mts';

const WANTED = ['popular.example', 'second.example', 'absent.example', 'first.example'];

test('reads ranked CSV rows and plain domain lists without treating a header as an error', () => {
  const csv = readPopularityRanks('rank,domain\n1,popular.example\n2,Second.Example.\n3,popular.example\n4,not a domain\n', WANTED);
  // Every valid row counts; a repeated domain keeps its first rank.
  assert.equal(csv.entries, 3);
  assert.equal(csv.rejectedLines, 1);
  assert.deepEqual([...csv.ranks], [['popular.example', 1], ['second.example', 2]]);
  const plain = readPopularityRanks('\uFEFFfirst.example\n# comment\n\nsecond.example\r\n', WANTED);
  assert.deepEqual([plain.ranks.get('first.example'), plain.ranks.get('second.example')], [1, 2]);
});

test('rejects malformed rows and oversized input before reading the list', () => {
  const malformed = readPopularityRanks('1,first.example\n0,zero.example\nx,bad.example\n2,a,b\n', WANTED);
  assert.equal(malformed.entries, 1);
  assert.equal(malformed.rejectedLines, 3);
  assert.throws(() => readPopularityRanks('a'.repeat(MAX_POPULARITY_LIST_BYTES + 1), WANTED), /limited to 32 MiB/u);
});

test('chunked reading keeps only requested ranks and matches a single read', () => {
  const text = `rank,domain\n${Array.from({ length: 500 }, (_, index) => `${index + 1},site-${index}.example`).join('\r\n')}\n`;
  const wanted = ['site-7.example', 'site-499.example', 'missing.example'];
  const whole = readPopularityRanks(text, wanted);
  for (const size of [1, 7, 64, 4096]) {
    const reader = createPopularityRankReader(wanted);
    for (let offset = 0; offset < text.length; offset += size) reader.push(text.slice(offset, offset + size));
    const chunked = reader.finish();
    assert.deepEqual([chunked.entries, chunked.rejectedLines, chunked.truncated, [...chunked.ranks]],
      [whole.entries, whole.rejectedLines, whole.truncated, [...whole.ranks]], `chunk size ${size}`);
  }
  assert.deepEqual([...whole.ranks], [['site-7.example', 8], ['site-499.example', 500]]);
  assert.equal(whole.entries, 500);
  // Rows after the entry limit are not read.
  const limited = createPopularityRankReader(['late.example']);
  limited.push(`${'a.example\n'.repeat(MAX_POPULARITY_LIST_ENTRIES)}late.example\n`);
  const result = limited.finish();
  assert.deepEqual([result.entries, result.truncated, result.ranks.size], [MAX_POPULARITY_LIST_ENTRIES, true, 0]);
});

test('CLI discover marks candidates found in a selected list without fetching or copying it', async () => {
  const run = async (args: string[]) => {
    let stdout = '', stderr = '';
    const code = await runCli(args, { now: () => '2026-10-01T00:00:00.000Z',
      stdout: { write: (value: string) => { stdout += value; } }, stderr: { write: (value: string) => { stderr += value; } } });
    return { code, stdout, stderr };
  };
  const domains = (await run(['discover', 'example.test', '--preset', 'common', '--domains'])).stdout.trim().split('\n');
  assert.ok(domains.length >= 2);
  const root = await mkdtemp(join(tmpdir(), 'whoisleuth-popularity-'));
  try {
    const list = join(root, 'tranco.csv');
    await writeFile(list, `rank,domain\n1,unrelated.example\n7,${domains[1]}\n9,${domains[0]}\n`, { mode: 0o600 });
    const json = await run(['discover', 'example.test', '--preset', 'common', '--popularity-list', list, '--json']);
    assert.equal(json.code, 0, json.stderr);
    const popularity = JSON.parse(json.stdout).popularity;
    assert.deepEqual(popularity.ranked, [{ domain: domains[1], rank: 7 }, { domain: domains[0], rank: 9 }]);
    assert.equal(popularity.entries, 3);
    assert.match(popularity.listSha256, /^[a-f0-9]{64}$/u);
    assert.doesNotMatch(json.stdout, /unrelated\.example/u);
    const terminal = await run(['discover', 'example.test', '--preset', 'common', '--popularity-list', list]);
    assert.match(terminal.stdout, /^Popularity {5}2 of \d+ candidates ranked in the selected list \(3 entries\)$/mu);
    assert.match(terminal.stdout, new RegExp(`^${domains[1]!.replaceAll('.', '\\.')}: .+ · ranked #7$`, 'mu'));
    const plain = await run(['discover', 'example.test', '--preset', 'common', '--json']);
    assert.equal(JSON.parse(plain.stdout).popularity, undefined);
    // A failed command leaves no baseline behind, and an existing baseline does not advance.
    const snapshot = join(root, 'baseline.json');
    const missing = await run(['discover', 'example.test', '--preset', 'common', '--snapshot', snapshot, '--popularity-list', join(root, 'missing.csv'), '--json']);
    assert.notEqual(missing.code, 0);
    assert.equal(missing.stdout, '');
    await assert.rejects(stat(snapshot), { code: 'ENOENT' });
    assert.equal((await run(['discover', 'example.test', '--preset', 'common', '--snapshot', snapshot, '--json'])).code, 0);
    const baseline = await readFile(snapshot, 'utf8');
    const failed = await run(['discover', 'example.test', '--preset', 'impersonation', '--snapshot', snapshot, '--popularity-list', join(root, 'missing.csv'), '--json']);
    assert.notEqual(failed.code, 0);
    assert.match(failed.stderr, /missing\.csv|Popularity list/u);
    assert.equal(await readFile(snapshot, 'utf8'), baseline);
  } finally { await rm(root, { recursive: true, force: true }); }
});
