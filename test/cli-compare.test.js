'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { Readable, Writable } = require('node:stream');

const { parseCliArguments } = require('../cli/arguments.mts');
const {
  MAX_COMPARE_EVENTS,
  MAX_COMPARE_INPUT_BYTES,
  MAX_COMPARE_LIST_ITEMS,
  MAX_COMPARE_STRING_LENGTH,
  compareLookupDocument,
  parseCliLookupDocument,
  readCompareInputBounded,
} = require('../cli/compare.mts');
const EXIT_CODES = require('../cli/exit-codes.mts').default;
const { buildCliCompareDocument } = require('../cli/formatters/json.mts');
const { formatTerminalCompare } = require('../cli/formatters/terminal.mts');
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

function lookupDocument(overrides = {}) {
  return {
    schema: 'whoisleuth.cli.lookup',
    version: 1,
    generatedAt: '2026-07-14T06:00:00.000Z',
    mode: 'deep',
    query: 'example.test',
    type: 'domain',
    inputHostname: 'example.test',
    registrableDomain: 'example.test',
    isSubdomain: false,
    rdap: {
      data: { raw: 'RDAP payload must not be copied' },
      parsed: {
        domain: 'example.test',
        handle: 'TEST-1',
        registrar: { name: 'Example Registrar, LLC' },
        registrarIanaId: '9999',
        lifecycle: {
          createdDate: '2025-01-01T00:00:00Z',
          createdDateIso: '2025-01-01T00:00:00.000Z',
        },
        dnssec: 'signed',
        statuses: ['client transfer prohibited'],
        nameservers: ['NS1.EXAMPLE.TEST.'],
      },
    },
    whois: {
      chain: [{ body: 'WHOIS payload must not be copied' }],
      parsed: {
        domainName: 'EXAMPLE.TEST',
        registryDomainId: 'TEST 1',
        registrar: 'Example Registrar LLC',
        registrarIanaId: '9999',
        createdDate: '2025-01-01',
        createdDateIso: '2025-01-01T00:00:00.000Z',
        dnssec: 'Signed',
        statuses: ['clientTransferProhibited'],
        nameservers: ['ns1.example.test'],
      },
    },
    diagnostics: {
      version: 4,
      rdap: { status: 'success' },
      whois: { status: 'complete' },
    },
    ...overrides,
  };
}

async function comparisonModule() {
  return import('../lib/registry-comparison.mts');
}

describe('comparison CLI arguments', () => {
  test('accepts a file, stdin, terminal flags, and JSON output', () => {
    assert.deepEqual(parseCliArguments(['compare', 'lookup.json']), {
      action: 'compare', source: 'lookup.json', output: 'terminal', quiet: false, color: true,
    });
    assert.deepEqual(parseCliArguments(['compare', '--json', '--no-color']), {
      action: 'compare', source: null, output: 'json', quiet: false, color: false,
    });
    assert.deepEqual(parseCliArguments(['compare', '--quiet']), {
      action: 'compare', source: null, output: 'terminal', quiet: true, color: true,
    });
  });

  test('rejects multiple files, repeated JSON, unrelated flags, and quiet JSON', () => {
    assert.throws(() => parseCliArguments(['compare', 'one.json', 'two.json']), /one optional lookup JSON file/);
    assert.throws(() => parseCliArguments(['compare', '--json', '--json']), /only once/);
    assert.throws(() => parseCliArguments(['compare', '--deep']), /Unknown option/);
    assert.throws(() => parseCliArguments(['compare', '--json', '--quiet']), /cannot be combined/);
  });
});

describe('comparison input boundary', () => {
  test('parses and projects only the normalized fields needed by comparison', () => {
    const source = lookupDocument();
    const before = structuredClone(source);
    const parsed = parseCliLookupDocument(JSON.stringify(source));
    assert.equal(parsed.query, 'example.test');
    assert.equal(parsed.rdapParsed.registrar.name, 'Example Registrar, LLC');
    assert.equal(parsed.whoisParsed.registrar, 'Example Registrar LLC');
    assert.equal(Object.hasOwn(parsed.rdapParsed, 'data'), false);
    assert.equal(JSON.stringify(parsed).includes('payload must not be copied'), false);
    assert.deepEqual(source, before);
  });

  test('accepts a leading JSON BOM and explicit unavailable source states', () => {
    const source = lookupDocument({
      mode: 'fast',
      whois: { skipped: true },
      diagnostics: { rdap: { status: 'success' }, whois: { status: 'skipped' } },
    });
    const parsed = parseCliLookupDocument(`\uFEFF${JSON.stringify(source)}`);
    assert.equal(parsed.lookupMode, 'fast');
    assert.equal(parsed.whoisStatus, 'skipped');
    assert.deepEqual(parsed.whoisParsed.statuses, []);
  });

  test('rejects malformed JSON, arrays, and unsupported schemas or lookup types', () => {
    assert.throws(() => parseCliLookupDocument('{'), /valid JSON/);
    assert.throws(() => parseCliLookupDocument('[]'), /one JSON object/);
    assert.throws(() => parseCliLookupDocument(JSON.stringify(lookupDocument({ schema: 'other' }))), /whoisleuth\.cli\.lookup version 1/);
    assert.throws(() => parseCliLookupDocument(JSON.stringify(lookupDocument({ version: 2 }))), /version 1/);
    assert.throws(() => parseCliLookupDocument(JSON.stringify(lookupDocument({ type: 'ip' }))), /domain lookup documents only/);
    assert.throws(() => parseCliLookupDocument(JSON.stringify(lookupDocument({ mode: 'custom' }))), /lookup mode/);
  });

  test('requires identity, timestamp, diagnostics, and parsed successful-source data', () => {
    assert.throws(() => parseCliLookupDocument(JSON.stringify(lookupDocument({ query: '' }))), /query is missing/);
    assert.throws(() => parseCliLookupDocument(JSON.stringify(lookupDocument({ registrableDomain: null }))), /registrableDomain is missing/);
    assert.throws(() => parseCliLookupDocument(JSON.stringify(lookupDocument({ generatedAt: null }))), /generatedAt is missing/);
    assert.throws(() => parseCliLookupDocument(JSON.stringify(lookupDocument({ diagnostics: {} }))), /diagnostics\.rdap\.status/);
    assert.throws(() => parseCliLookupDocument(JSON.stringify(lookupDocument({ diagnostics: { rdap: { status: 'invented' }, whois: { status: 'complete' } } }))), /unsupported/);
    assert.throws(() => parseCliLookupDocument(JSON.stringify(lookupDocument({ rdap: {}, diagnostics: { rdap: { status: 'success' }, whois: { status: 'complete' } } }))), /RDAP input is missing/);
    assert.throws(() => parseCliLookupDocument(JSON.stringify(lookupDocument({ whois: {}, diagnostics: { rdap: { status: 'success' }, whois: { status: 'partial' } } }))), /WHOIS input is missing/);
  });

  test('enforces total-byte, string, list, and event bounds', () => {
    assert.throws(() => parseCliLookupDocument('x'.repeat(MAX_COMPARE_INPUT_BYTES + 1)), /limited/);
    const long = lookupDocument();
    long.rdap.parsed.handle = 'x'.repeat(MAX_COMPARE_STRING_LENGTH + 1);
    assert.throws(() => parseCliLookupDocument(JSON.stringify(long)), /value limit/);
    const list = lookupDocument();
    list.rdap.parsed.nameservers = Array.from({ length: MAX_COMPARE_LIST_ITEMS + 1 }, (_, index) => `ns${index}.test`);
    assert.throws(() => parseCliLookupDocument(JSON.stringify(list)), /item limit/);
    const events = lookupDocument();
    events.rdap.parsed.events = Array.from({ length: MAX_COMPARE_EVENTS + 1 }, () => ({ action: 'registration', date: '2025-01-01' }));
    assert.throws(() => parseCliLookupDocument(JSON.stringify(events)), /item limit/);
  });

  test('rejects malformed nested comparison shapes instead of silently dropping them', () => {
    const lifecycle = lookupDocument();
    lifecycle.rdap.parsed.lifecycle = [];
    assert.throws(() => parseCliLookupDocument(JSON.stringify(lifecycle)), /lifecycle must be an object/);
    const statuses = lookupDocument();
    statuses.whois.parsed.statuses = 'active';
    assert.throws(() => parseCliLookupDocument(JSON.stringify(statuses)), /must be an array/);
    const event = lookupDocument();
    event.rdap.parsed.events = ['invalid'];
    assert.throws(() => parseCliLookupDocument(JSON.stringify(event)), /must be an object/);
  });

  test('bounded stream reader stops after the configured byte limit', async () => {
    assert.equal(await readCompareInputBounded(Readable.from(['abc']), 3), 'abc');
    await assert.rejects(() => readCompareInputBounded(Readable.from(['ab', 'cd']), 3), /limited to 3 bytes/);
  });
});

describe('comparison output', () => {
  test('uses the same comparison function through the frontend compatibility module', async () => {
    const shared = await comparisonModule();
    const frontend = await import('../frontend/src/lib/analysis/registry-comparison.js');
    assert.equal(frontend.compareRegistrySources, shared.compareRegistrySources);
  });

  test('reports equivalent normalized values and material conflicts without raw payloads', async () => {
    const source = lookupDocument();
    source.whois.parsed.registrar = 'Different Registrar';
    const parsed = parseCliLookupDocument(JSON.stringify(source));
    const shared = await comparisonModule();
    const result = compareLookupDocument(parsed, shared.compareRegistrySources);
    assert.equal(result.counts.conflict, 1);
    assert.ok(result.counts.equivalent >= 7);
    assert.equal(result.fields.find((item) => item.label === 'Registrar').status, 'conflict');
    assert.equal(JSON.stringify(result).includes('payload must not be copied'), false);
  });

  test('treats fast-mode WHOIS omission as unavailable rather than publication absence', async () => {
    const source = lookupDocument({
      mode: 'fast',
      whois: { skipped: true },
      diagnostics: { rdap: { status: 'success' }, whois: { status: 'skipped' } },
    });
    const shared = await comparisonModule();
    const result = compareLookupDocument(parseCliLookupDocument(JSON.stringify(source)), shared.compareRegistrySources);
    assert.equal(result.sourceHealth.whois.condition, 'unavailable');
    assert.ok(result.fields.every((item) => item.status === 'whois_unavailable'));
    assert.ok(result.fields.every((item) => item.whoisDisplay === 'Source skipped'));
  });

  test('protects the versioned JSON envelope from result-field collisions', () => {
    const result = { schema: 'untrusted', version: 99, generatedAt: 'untrusted', fields: [], counts: {}, sourceHealth: {} };
    const before = structuredClone(result);
    const document = buildCliCompareDocument(result, '2026-07-14T07:00:00.000Z');
    assert.equal(document.schema, 'whoisleuth.cli.compare');
    assert.equal(document.version, 1);
    assert.equal(document.generatedAt, '2026-07-14T07:00:00.000Z');
    assert.deepEqual(result, before);
  });

  test('renders bounded source health, summary, values, and interpretation warning', async () => {
    const source = lookupDocument();
    source.whois.parsed.registrar = 'Different Registrar';
    const shared = await comparisonModule();
    const result = compareLookupDocument(parseCliLookupDocument(JSON.stringify(source)), shared.compareRegistrySources);
    const output = formatTerminalCompare(buildCliCompareDocument(result));
    assert.match(output, /RDAP source\s+Success/);
    assert.match(output, /WHOIS source\s+Complete/);
    assert.match(output, /\[CONFLICT\] Registrar/);
    assert.match(output, /RDAP\s+Example Registrar, LLC/);
    assert.match(output, /WHOIS\s+Different Registrar/);
    assert.match(output, /not an availability or ownership decision/);
  });
});

describe('comparison CLI runner', () => {
  test('reads stdin, emits versioned JSON, and does not make a lookup request', async () => {
    const stdout = capture();
    let lookupCalls = 0;
    const code = await runCli(['compare', '--json'], {
      stdout: stdout.stream,
      stderr: capture().stream,
      stdin: Readable.from([JSON.stringify(lookupDocument())]),
      runUnifiedLookup: async () => { lookupCalls++; },
      now: () => '2026-07-14T07:00:00.000Z',
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(lookupCalls, 0);
    const document = JSON.parse(stdout.value());
    assert.equal(document.schema, 'whoisleuth.cli.compare');
    assert.equal(document.lookupGeneratedAt, '2026-07-14T06:00:00.000Z');
    assert.equal(document.generatedAt, '2026-07-14T07:00:00.000Z');
    assert.equal(stdout.value().includes('payload must not be copied'), false);
  });

  test('reads an optional file through the default bounded reader', async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'whoisleuth-compare-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const filename = join(directory, 'lookup.json');
    await writeFile(filename, JSON.stringify(lookupDocument()), 'utf8');
    const stdout = capture();
    const code = await runCli(['compare', filename], {
      stdout: stdout.stream,
      stderr: capture().stream,
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.match(stdout.value(), /Query\s+example\.test/);
    assert.match(stdout.value(), /\[EQUIVALENT\] Domain/);
  });

  test('passes an optional filename to the bounded input dependency', async () => {
    const shared = await comparisonModule();
    let source;
    const code = await runCli(['compare', 'saved.json', '--quiet'], {
      stdout: capture().stream,
      stderr: capture().stream,
      readCompareInput: async (value) => { source = value; return JSON.stringify(lookupDocument()); },
      loadRegistryComparison: async () => shared,
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(source, 'saved.json');
  });

  test('conflicts are findings and still exit successfully', async () => {
    const shared = await comparisonModule();
    const source = lookupDocument();
    source.whois.parsed.registrar = 'Different Registrar';
    const code = await runCli(['compare', '--quiet'], {
      stdout: capture().stream,
      stderr: capture().stream,
      readCompareInput: async () => JSON.stringify(source),
      loadRegistryComparison: async () => shared,
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
  });

  test('missing, invalid, and unreadable input return bounded usage errors', async () => {
    for (const readCompareInput of [
      async () => '',
      async () => '{',
      async () => { throw new Error(`cannot read\n${'x'.repeat(500)}`); },
    ]) {
      const stderr = capture();
      const code = await runCli(['compare'], {
        stdout: capture().stream,
        stderr: stderr.stream,
        readCompareInput,
      });
      assert.equal(code, EXIT_CODES.USAGE);
      assert.match(stderr.value(), /^Usage error:/);
      assert.ok(stderr.value().length < 360);
    }
  });

  test('comparison module failures are bounded operational errors', async () => {
    const stderr = capture();
    const code = await runCli(['compare'], {
      stdout: capture().stream,
      stderr: stderr.stream,
      readCompareInput: async () => JSON.stringify(lookupDocument()),
      loadRegistryComparison: async () => { throw new Error(`module failed\n${'x'.repeat(500)}`); },
    });
    assert.equal(code, EXIT_CODES.LOOKUP_FAILED);
    assert.match(stderr.value(), /^Registry comparison failed: module failed /);
    assert.ok(stderr.value().length < 360);
  });
});
