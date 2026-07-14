'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { Writable } = require('node:stream');

const { parseCliArguments } = require('../cli/arguments.mts');
const {
  DEFAULT_DISCOVERY_TLDS,
  MAX_DISCOVERY_TLD_TEXT_LENGTH,
  MAX_DISCOVERY_TLD_TOKENS_INSPECTED,
  normalizeDiscoveryTlds,
} = require('../cli/discover.mts');
const EXIT_CODES = require('../cli/exit-codes.mts').default;
const {
  buildCliDiscoverDocument,
  formatDiscoverJsonLines,
} = require('../cli/formatters/json.mts');
const {
  MAX_DISCOVER_TERMINAL_CANDIDATES,
  formatTerminalDiscover,
} = require('../cli/formatters/terminal.mts');
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

function candidate(index = 0) {
  return {
    domain: `candidate-${index}.test`,
    source: 'example.test',
    tld: 'test',
    mutationTypes: ['character_omission'],
  };
}

function generationResult(overrides = {}) {
  return {
    version: 1,
    candidates: [candidate()],
    inputValid: true,
    truncated: false,
    limitReasons: [],
    rejectedVariantCount: 0,
    limits: { tlds: 20, nameVariants: 1500, candidates: 2000 },
    ...overrides,
  };
}

function fakeGenerator(run) {
  return {
    MAX_GENERATION_TLDS: 20,
    MUTATION_LABELS: { character_omission: 'Character omission' },
    generateTyposquatCandidateSet: run,
  };
}

describe('discover CLI argument parsing', () => {
  test('uses web-compatible generation defaults', () => {
    assert.deepEqual(parseCliArguments(['discover', 'example.test']), {
      action: 'discover',
      seed: 'example.test',
      output: 'terminal',
      quiet: false,
      color: true,
      preset: 'all',
      keyboardLayout: 'qwerty',
      tldText: null,
    });
  });

  test('accepts JSONL plus explicit preset, keyboard, and TLD controls', () => {
    assert.deepEqual(parseCliArguments([
      'discover', 'example brand', '--jsonl', '--preset', 'impersonation',
      '--keyboard', 'azerty', '--tlds', 'com,net', '--no-color',
    ]), {
      action: 'discover',
      seed: 'example brand',
      output: 'jsonl',
      quiet: false,
      color: false,
      preset: 'impersonation',
      keyboardLayout: 'azerty',
      tldText: 'com,net',
    });
  });

  test('rejects conflicting formats, invalid values, repeated controls, and multiple seeds', () => {
    assert.throws(() => parseCliArguments(['discover', 'x', '--json', '--jsonl']), /one output format/);
    assert.throws(() => parseCliArguments(['discover', 'x', '--preset', 'unknown']), /requires common/);
    assert.throws(() => parseCliArguments(['discover', 'x', '--preset', 'all', '--preset', 'common']), /only once/);
    assert.throws(() => parseCliArguments(['discover', 'x', '--keyboard', 'dvorak']), /requires qwerty/);
    assert.throws(() => parseCliArguments(['discover', 'x', '--keyboard', 'qwerty', '--keyboard', 'azerty']), /only once/);
    assert.throws(() => parseCliArguments(['discover', 'x', '--tlds']), /requires a comma-separated/);
    assert.throws(() => parseCliArguments(['discover', 'x', '--tlds', 'com', '--tlds', 'net']), /only once/);
    assert.throws(() => parseCliArguments(['discover', 'one', 'two']), /one brand label or domain/);
    assert.throws(() => parseCliArguments(['discover', 'x', '--json', '--quiet']), /cannot be combined/);
  });
});

describe('discover TLD normalization', () => {
  test('normalizes, deduplicates, and preserves input order', () => {
    assert.deepEqual(normalizeDiscoveryTlds(' COM, .net; org com ', 20), ['com', 'net', 'org']);
    assert.deepEqual(DEFAULT_DISCOVERY_TLDS, ['com', 'net', 'org']);
  });

  test('rejects malformed, empty, over-limit, and excessive input before generation', () => {
    assert.throws(() => normalizeDiscoveryTlds('', 20), /at most 1024 characters/);
    assert.throws(() => normalizeDiscoveryTlds('com,invalid!', 20), /Invalid TLD/);
    assert.throws(() => normalizeDiscoveryTlds('com,net,org', 2), /At most 2 unique/);
    assert.throws(() => normalizeDiscoveryTlds('x'.repeat(MAX_DISCOVERY_TLD_TEXT_LENGTH + 1), 20), /at most 1024/);
    const many = Array.from({ length: MAX_DISCOVERY_TLD_TOKENS_INSPECTED + 1 }, () => 'com').join(',');
    assert.throws(() => normalizeDiscoveryTlds(many, 20), /inspect at most 80/);
  });
});

describe('shared discovery core', () => {
  test('frontend compatibility exports and CLI core resolve to the same functions', async () => {
    const shared = await import('../lib/typosquat-generator.mts');
    const frontend = await import('../frontend/src/lib/analysis/typosquat-generator.js');
    assert.equal(frontend.generateTyposquatCandidateSet, shared.generateTyposquatCandidateSet);
    assert.equal(frontend.estimateTyposquatCandidateCount, shared.estimateTyposquatCandidateCount);
    assert.deepEqual(
      frontend.generateTyposquatCandidateSet('example.test', ['com', 'net'], { preset: 'common' }),
      shared.generateTyposquatCandidateSet('example.test', ['com', 'net'], { preset: 'common' }),
    );
  });

  test('shared IDN compatibility exports retain one mapping implementation', async () => {
    const shared = await import('../lib/idn-confusables.mts');
    const frontend = await import('../frontend/src/lib/analysis/idn-confusables.js');
    assert.equal(frontend.analyzeDomainIdn, shared.analyzeDomainIdn);
    assert.equal(frontend.confusableCharactersForAscii, shared.confusableCharactersForAscii);
  });
});

describe('discover output', () => {
  const metadata = {
    generatedAt: '2026-07-14T00:00:00.000Z',
    seed: 'example.test',
    preset: 'common',
    keyboardLayout: 'qwerty',
    tlds: ['test'],
  };

  test('machine document protects its versioned envelope and does not mutate generation results', () => {
    const result = generationResult({ schema: 'untrusted', version: 999, seed: 'untrusted' });
    const before = structuredClone(result);
    const document = buildCliDiscoverDocument(metadata.seed, result, metadata);
    assert.equal(document.schema, 'whoisleuth.cli.discover');
    assert.equal(document.version, 1);
    assert.equal(document.seed, 'example.test');
    assert.equal(document.generatedAt, metadata.generatedAt);
    assert.deepEqual(result, before);
  });

  test('JSONL items are independently versioned and empty results emit no blank record', () => {
    const lines = formatDiscoverJsonLines([candidate(0), candidate(1)], metadata).trim().split('\n').map(JSON.parse);
    assert.deepEqual(lines.map((item) => item.schema), ['whoisleuth.cli.discover.item', 'whoisleuth.cli.discover.item']);
    assert.ok(lines.every((item) => item.generatedAt === metadata.generatedAt));
    assert.deepEqual(lines.map((item) => item.domain), ['candidate-0.test', 'candidate-1.test']);
    assert.equal(formatDiscoverJsonLines([], metadata), '');
  });

  test('terminal display cap and mutation labels are explicit', () => {
    const candidates = Array.from({ length: MAX_DISCOVER_TERMINAL_CANDIDATES + 1 }, (_, index) => candidate(index));
    const document = buildCliDiscoverDocument(metadata.seed, generationResult({ candidates }), metadata);
    const output = formatTerminalDiscover(document, { character_omission: 'Character omission' });
    assert.match(output, /candidate-0\.test — Character omission/);
    assert.match(output, /Showing 200 of 201 candidates/);
    assert.equal(document.candidates.length, 201);
  });
});

describe('discover runner', () => {
  test('passes normalized controls to the shared generator and emits JSON', async () => {
    const stdout = capture();
    const stderr = capture();
    let received;
    const code = await runCli([
      'discover', 'Example Brand', '--json', '--preset', 'impersonation',
      '--keyboard', 'qwertz', '--tlds', 'COM, .net, com',
    ], {
      stdout: stdout.stream,
      stderr: stderr.stream,
      now: () => '2026-07-14T00:00:00.000Z',
      loadTyposquatGenerator: async () => fakeGenerator((seed, tlds, options) => {
        received = { seed, tlds, options };
        return generationResult();
      }),
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.deepEqual(received, {
      seed: 'Example Brand',
      tlds: ['com', 'net'],
      options: { preset: 'impersonation', keyboardLayout: 'qwertz' },
    });
    assert.equal(stderr.value(), '');
    const document = JSON.parse(stdout.value());
    assert.equal(document.schema, 'whoisleuth.cli.discover');
    assert.deepEqual(document.tlds, ['com', 'net']);
  });

  test('stdin and quiet mode use defaults without producing output', async () => {
    const stdout = capture();
    let received;
    const code = await runCli(['discover', '--quiet'], {
      stdout: stdout.stream,
      stderr: capture().stream,
      readStdin: async () => 'example.test',
      loadTyposquatGenerator: async () => fakeGenerator((_seed, tlds, options) => {
        received = { tlds, options };
        return generationResult();
      }),
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.deepEqual(received, {
      tlds: ['com', 'net', 'org'],
      options: { preset: 'all', keyboardLayout: 'qwerty' },
    });
    assert.equal(stdout.value(), '');
  });

  test('invalid generator input is a usage error', async () => {
    const stderr = capture();
    const code = await runCli(['discover', 'bad.input.example'], {
      stdout: capture().stream,
      stderr: stderr.stream,
      loadTyposquatGenerator: async () => fakeGenerator(() => generationResult({ inputValid: false, candidates: [] })),
    });
    assert.equal(code, EXIT_CODES.USAGE);
    assert.match(stderr.value(), /^Usage error:/);
  });

  test('module failures are bounded and use a stable nonzero exit', async () => {
    const stderr = capture();
    const code = await runCli(['discover', 'example.test'], {
      stdout: capture().stream,
      stderr: stderr.stream,
      loadTyposquatGenerator: async () => { throw new Error(`load failed\n${'x'.repeat(500)}`); },
    });
    assert.equal(code, EXIT_CODES.LOOKUP_FAILED);
    assert.match(stderr.value(), /^Candidate generation failed: load failed /);
    assert.ok(stderr.value().length < 340);
  });
});
