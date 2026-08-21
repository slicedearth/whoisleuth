import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

const ANALYSIS = new URL('../frontend/src/lib/analysis/', import.meta.url);
const SHARED_COMPARISON = new URL('../packages/comparison/', import.meta.url);
const COMPONENTS = new URL('../frontend/src/lib/components/', import.meta.url);
const FACADE = 'comparison-ledger.ts';
const CONTRACT = 'comparison-ledger-contract.ts';
const JSON_HELPER = 'comparison-ledger-json.ts';
const SERIALIZATION = 'comparison-ledger-serialization.ts';
const ADAPTERS = [
  'comparison-ledger-case.ts',
  'comparison-ledger-website.ts',
  'comparison-ledger-watchlist.ts',
  'comparison-ledger-bulk.ts',
] as const;

async function source(file: string): Promise<string> {
  return readFile(new URL(file, ANALYSIS), 'utf8');
}

async function sharedSource(file: string): Promise<string> {
  return readFile(new URL(file, SHARED_COMPARISON), 'utf8');
}

describe('comparison ledger architecture', () => {
  test('keeps the public facade and source adapters bounded', async () => {
    const limits = new Map<string, number>([
      [FACADE, 250],
      [CONTRACT, 470],
      [JSON_HELPER, 120],
      [SERIALIZATION, 120],
      ...ADAPTERS.map((file) => [file, 400] as const),
    ]);
    for (const [file, maximum] of limits) {
      const lines = (await source(file)).split('\n').length;
      assert.ok(lines <= maximum, `${file} has ${lines} lines; expected at most ${maximum}`);
    }
    for (const [file, maximum] of [
      ['comparison-ledger-contract.mts', 470],
      ['comparison-ledger-json.mts', 120],
      ['comparison-ledger-serialization.mts', 120],
      ['comparison-ledger-bulk.mts', 400],
    ] as const) {
      const lines = (await sharedSource(file)).split('\n').length;
      assert.ok(lines <= maximum, `packages/comparison/${file} has ${lines} lines; expected at most ${maximum}`);
    }
  });

  test('keeps dependency direction contract to adapters to facade', async () => {
    const serialization = await sharedSource('comparison-ledger-serialization.mts');
    assert.equal(/^import\s/gu.test(serialization), false, 'the bounded serialisation helper must be dependency-free');
    const json = await sharedSource('comparison-ledger-json.mts');
    assert.equal(/^import\s/gu.test(json), false, 'the bounded JSON helper must be dependency-free');
    const contract = await sharedSource('comparison-ledger-contract.mts');
    assert.ok(contract.includes("from './comparison-ledger-serialization.mts'"));
    assert.ok(contract.includes("from './comparison-ledger-json.mts'"));
    assert.equal(contract.includes("from './comparison-ledger.ts'"), false, 'the shared contract must not import the facade');
    assert.equal(contract.includes('frontend/src'), false, 'the shared contract must not import the frontend');
    for (const adapter of ADAPTERS) {
      assert.equal(contract.includes(`from './${adapter}'`), false, `the shared contract must not import ${adapter}`);
    }
    for (const adapter of ADAPTERS.filter((candidate) => candidate !== 'comparison-ledger-bulk.ts')) {
      const body = await source(adapter);
      assert.equal(body.includes("from './comparison-ledger.ts'"), false, `${adapter} must not import the facade`);
      for (const peer of ADAPTERS.filter((candidate) => candidate !== adapter)) {
        assert.equal(body.includes(`from './${peer}'`), false, `${adapter} must not import peer adapter ${peer}`);
      }
    }
    const bulk = await sharedSource('comparison-ledger-bulk.mts');
    assert.ok(bulk.includes("from './comparison-ledger-contract.mts'"));
    assert.equal(bulk.includes('frontend/src'), false, 'the shared Bulk adapter must not import the frontend');
    assert.equal(
      await source('comparison-ledger-bulk.ts'),
      "export * from '../../../../packages/comparison/comparison-ledger-bulk.mts';\n",
    );
    const facade = await source(FACADE);
    assert.ok(facade.includes("from './comparison-ledger-contract.ts'"));
    for (const adapter of ADAPTERS) {
      assert.ok(facade.includes(`from './${adapter}'`), `facade must compose ${adapter}`);
    }
  });

  test('keeps Monitor presentation dependent on the public facade only', async () => {
    for (const file of ['RetainedChangeReview.svelte', 'ComparisonLedgerRows.svelte']) {
      const body = await readFile(new URL(file, COMPONENTS), 'utf8');
      assert.ok(body.includes('$lib/analysis/comparison-ledger.ts'), `${file} must use the public ledger facade`);
      assert.equal(
        /comparison-ledger-(?:contract|case|website|watchlist|bulk)\.ts/u.test(body),
        false,
        `${file} must not bypass the public ledger facade`,
      );
    }
    const rows = await readFile(new URL('ComparisonLedgerRows.svelte', COMPONENTS), 'utf8');
    assert.equal(
      [...rows.matchAll(/\{#each rows as row \(row\.id\)\}/gu)].length,
      2,
      'desktop and mobile projections must both key the shared bounded row ID',
    );
    const facade = await source(FACADE);
    assert.ok(facade.includes('projectedRowIds.has(row.id)'), 'duplicate rendered row IDs must be rejected and reported');
    assert.ok(facade.includes('duplicateDetailRows += 1'), 'duplicate detail rows need a distinct omission counter');
    assert.match(rows, /Suppressed \{duplicateRows\} duplicate exact row/u, 'the shared renderer must disclose duplicate suppression');
  });

  test('validates and deduplicates explicit Bulk pairs before deriving comparisons', async () => {
    const bulk = await sharedSource('comparison-ledger-bulk.mts');
    assert.ok(bulk.indexOf('if (seen.has(id))') < bulk.indexOf('const comparison = compareBulkSessions'));
  });
});
