'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable, Writable } = require('node:stream');

const { parseCliArguments } = require('../cli/arguments.mts');
const {
  MAX_BULK_INPUT_BYTES,
  MAX_DEEP_BULK_QUERIES,
  MAX_FAST_BULK_QUERIES,
  parseBulkQueries,
  readTextStreamBounded,
  runBulkLookups,
} = require('../cli/bulk.mts');
const EXIT_CODES = require('../cli/exit-codes.mts').default;
const { buildCliBulkDocument, formatJsonLines } = require('../cli/formatters/json.mts');
const { formatTerminalBulk } = require('../cli/formatters/terminal.mts');
const { runCli } = require('../cli/runner.mts');

function capture() {
  let value = '';
  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        value += chunk.toString();
        callback();
      },
    }),
    value: () => value,
  };
}

function classified(query) {
  const inputHostname = query.toLowerCase().replace(/^www\./, '');
  return {
    type: 'domain',
    value: inputHostname,
    inputHostname,
    registrableDomain: inputHostname,
    isSubdomain: false,
  };
}

function compactResult(domain) {
  return {
    availability: {
      applicable: true,
      domain,
      state: 'registered',
      confidence: 'high',
    },
    diagnostics: {
      version: 4,
      rdap: { status: 'success' },
      whois: { status: 'skipped' },
    },
  };
}

describe('bulk CLI argument parsing', () => {
  test('uses bounded fast defaults with stdin when no file is supplied', () => {
    assert.deepEqual(parseCliArguments(['bulk']), {
      action: 'bulk',
      source: null,
      output: 'terminal',
      deep: false,
      quiet: false,
      color: true,
      concurrency: 4,
    });
  });

  test('accepts a file, JSONL output, and explicit deep concurrency', () => {
    assert.deepEqual(parseCliArguments(['bulk', 'domains.txt', '--jsonl', '--deep', '--concurrency', '3', '--no-color']), {
      action: 'bulk',
      source: 'domains.txt',
      output: 'jsonl',
      deep: true,
      quiet: false,
      color: false,
      concurrency: 3,
    });
  });

  test('rejects conflicting formats, modes, files, and unsafe concurrency', () => {
    assert.throws(() => parseCliArguments(['bulk', '--json', '--jsonl']), /one output format/);
    assert.throws(() => parseCliArguments(['bulk', '--deep', '--fast']), /mutually exclusive/);
    assert.throws(() => parseCliArguments(['bulk', 'a.txt', 'b.txt']), /one optional input file/);
    assert.throws(() => parseCliArguments(['bulk', '--concurrency']), /requires an integer/);
    assert.throws(() => parseCliArguments(['bulk', '--concurrency', '0']), /from 1 to 8/);
    assert.throws(() => parseCliArguments(['bulk', '--deep', '--concurrency', '4']), /capped at 3/);
    assert.throws(() => parseCliArguments(['bulk', '--json', '--quiet']), /cannot be combined/);
  });
});

describe('bounded bulk input', () => {
  test('normalizes a BOM, blank lines, and case-insensitive raw duplicates', () => {
    assert.deepEqual(parseBulkQueries('\uFEFFExample.com\n\n example.COM \nother.test\r\n'), {
      queries: ['Example.com', 'other.test'],
      duplicates: 1,
      limit: MAX_FAST_BULK_QUERIES,
    });
  });

  test('enforces mode-specific query limits', () => {
    const fast = Array.from({ length: MAX_FAST_BULK_QUERIES + 1 }, (_, index) => `fast-${index}.test`).join('\n');
    const deep = Array.from({ length: MAX_DEEP_BULK_QUERIES + 1 }, (_, index) => `deep-${index}.test`).join('\n');
    assert.throws(() => parseBulkQueries(fast), /limited to 500/);
    assert.throws(() => parseBulkQueries(deep, { deep: true }), /limited to 50/);
  });

  test('rejects empty, controlled, overlong, and oversized inputs', () => {
    assert.throws(() => parseBulkQueries('\n \n'), /did not contain/);
    assert.throws(() => parseBulkQueries('example.com\u0000'), /control character/);
    assert.throws(() => parseBulkQueries(`${'x'.repeat(1025)}.test`), /overlong query/);
    assert.throws(() => parseBulkQueries('x'.repeat(MAX_BULK_INPUT_BYTES + 1)), /limited to/);
  });

  test('stream reader enforces the byte limit and does not wait on a TTY', async () => {
    assert.equal(await readTextStreamBounded(Readable.from(['one.test\ntwo.test\n'])), 'one.test\ntwo.test\n');
    await assert.rejects(readTextStreamBounded(Readable.from(['x'.repeat(9)]), 8), /limited to 8 bytes/);
    assert.equal(await readTextStreamBounded({ isTTY: true }), '');
  });
});

describe('bulk lookup execution', () => {
  test('preserves input order, bounds concurrency, and uses compact shared lookups', async () => {
    const queries = ['one.test', 'two.test', 'three.test', 'four.test'];
    const receivedOptions = [];
    let active = 0;
    let maximumActive = 0;
    const results = await runBulkLookups(queries, {
      concurrency: 2,
      classifyQuery: classified,
      runUnifiedLookup: async (item, options) => {
        receivedOptions.push(options);
        active++;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setImmediate(resolve));
        active--;
        return compactResult(item.value);
      },
    });
    assert.deepEqual(results.map((item) => item.query), queries);
    assert.equal(maximumActive, 2);
    assert.deepEqual(receivedOptions, Array(queries.length).fill(null).map(() => ({ fast: true, compact: true })));
  });

  test('canonically equivalent queries share one lookup while retaining ordered rows', async () => {
    let lookups = 0;
    const results = await runBulkLookups(['example.com', 'www.example.com'], {
      concurrency: 2,
      classifyQuery: (query) => ({
        type: 'domain',
        value: 'example.com',
        inputHostname: query,
        registrableDomain: 'example.com',
        isSubdomain: query.startsWith('www.'),
      }),
      runUnifiedLookup: async () => {
        lookups++;
        await new Promise((resolve) => setImmediate(resolve));
        return compactResult('example.com');
      },
    });
    assert.equal(lookups, 1);
    assert.deepEqual(results.map((item) => item.classified.inputHostname), ['example.com', 'www.example.com']);
  });

  test('keeps bounded classification and lookup failures beside successful results', async () => {
    const results = await runBulkLookups(['valid.test', 'invalid', 'failed.test'], {
      concurrency: 3,
      classifyQuery: (query) => {
        if (query === 'invalid') throw new Error(`invalid\n${'x'.repeat(500)}`);
        return classified(query);
      },
      runUnifiedLookup: async (item) => {
        if (item.value === 'failed.test') throw new Error('upstream failure');
        return compactResult(item.value);
      },
    });
    assert.deepEqual(results.map((item) => item.ok), [true, false, false]);
    assert.ok(results[1].error.length <= 300);
    assert.doesNotMatch(results[1].error, /[\x00-\x1f\x7f]/);
    assert.equal(results[2].error, 'upstream failure');
  });
});

describe('bulk output and runner', () => {
  test('JSON and JSONL outputs are versioned, timestamped, ordered, and summarized', () => {
    const items = [
      { index: 0, query: 'one.test', ok: true, classified: classified('one.test'), result: compactResult('one.test') },
      { index: 1, query: 'bad', ok: false, error: 'Invalid query' },
    ];
    const metadata = { deep: false, duplicates: 2, generatedAt: '2026-07-14T00:00:00.000Z' };
    const document = buildCliBulkDocument(items, metadata);
    assert.equal(document.schema, 'whoisleuth.cli.bulk');
    assert.deepEqual(document.summary, { total: 2, succeeded: 1, failed: 1, duplicatesRemoved: 2 });
    assert.deepEqual(document.results.map((item) => item.query), ['one.test', 'bad']);
    const lines = formatJsonLines(items, metadata).trim().split('\n').map(JSON.parse);
    assert.deepEqual(lines.map((item) => item.schema), ['whoisleuth.cli.bulk.item', 'whoisleuth.cli.bulk.item']);
    assert.ok(lines.every((item) => item.generatedAt === metadata.generatedAt));
  });

  test('terminal output presents each state and a compact summary', () => {
    const output = formatTerminalBulk([
      { index: 0, query: 'one.test', ok: true, classified: classified('one.test'), result: compactResult('one.test') },
      { index: 1, query: 'bad', ok: false, error: 'Invalid query' },
    ], { duplicates: 1 });
    assert.match(output, /✓ one\.test — Registered \(High confidence\)/);
    assert.match(output, /! bad — Invalid query/);
    assert.match(output, /2 queries · 1 succeeded · 1 failed · 1 duplicates removed/);
  });

  test('runner emits successful and failed JSON items with partial-failure exit code', async () => {
    const stdout = capture();
    const stderr = capture();
    const code = await runCli(['bulk', '--json'], {
      stdout: stdout.stream,
      stderr: stderr.stream,
      now: () => '2026-07-14T00:00:00.000Z',
      readBulkInput: async () => 'one.test\nbad\none.test\n',
      classifyQuery: (query) => {
        if (query === 'bad') throw new Error('Invalid query');
        return classified(query);
      },
      runUnifiedLookup: async (item) => compactResult(item.value),
    });
    assert.equal(code, EXIT_CODES.PARTIAL_FAILURE);
    assert.equal(stderr.value(), '');
    const output = JSON.parse(stdout.value());
    assert.deepEqual(output.summary, { total: 2, succeeded: 1, failed: 1, duplicatesRemoved: 1 });
  });

  test('runner treats unreadable input as usage failure before any lookup', async () => {
    const stderr = capture();
    let called = false;
    const code = await runCli(['bulk', 'missing.txt'], {
      stdout: capture().stream,
      stderr: stderr.stream,
      readBulkInput: async () => { throw new Error('ENOENT\nsecret detail'); },
      runUnifiedLookup: async () => { called = true; },
    });
    assert.equal(code, EXIT_CODES.USAGE);
    assert.equal(called, false);
    assert.match(stderr.value(), /^Usage error: Could not read bulk input: ENOENT secret detail/);
  });
});
