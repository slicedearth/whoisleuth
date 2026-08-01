import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';

import { parseCliArguments } from '../cli/arguments.mts';
import {
  DEFAULT_DISCOVERY_TLDS,
  MAX_DISCOVERY_DICTIONARY_BYTES,
  MAX_DISCOVERY_TLD_TEXT_LENGTH,
  MAX_DISCOVERY_TLD_TOKENS_INSPECTED,
  normalizeDiscoveryTlds,
  readDiscoveryDictionaryBounded,
} from '../cli/discover.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import {
  buildCliDiscoverDocument,
  formatDiscoverDomainList,
  formatDiscoverJsonLines,
} from '../cli/formatters/json.mts';
import {
  MAX_DISCOVER_TERMINAL_CANDIDATES,
  formatTerminalDiscover,
} from '../cli/formatters/terminal.mts';
import { runCli } from '../cli/runner.mts';
import { arrayValue, recordValue } from './value-assertions.mts';

type DiscoveryCandidate = ReturnType<typeof candidate>;
type GenerationResult = Record<string, unknown> & {
  version: number;
  candidates: DiscoveryCandidate[];
  inputValid: boolean;
  truncated: boolean;
  limitReasons: string[];
  rejectedVariantCount: number;
  limits: Record<string, number>;
};
type GenerationRun = (
  seed: string,
  tlds: string[],
  options: Record<string, unknown>,
) => GenerationResult;

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

function generationResult(overrides: Record<string, unknown> = {}): GenerationResult {
  const result: GenerationResult = {
    version: 1,
    candidates: [candidate()],
    inputValid: true,
    truncated: false,
    limitReasons: [],
    rejectedVariantCount: 0,
    limits: { tlds: 20, nameVariants: 1500, candidates: 2000 },
  };
  return { ...result, ...overrides } as GenerationResult;
}

function fakeGenerator(run: GenerationRun) {
  const mutationFamilies = [
    'character_omission',
    'dictionary',
    'dictionary_token_replacement',
    'pluralization',
    'unicode_homoglyph_depth_2',
  ];
  return {
    MAX_GENERATION_TLDS: 20,
    MUTATION_FAMILY_IDS: mutationFamilies,
    MUTATION_LABELS: { character_omission: 'Character omission' },
    generateTyposquatCandidateSet: run,
    normalizeMutationFamilyIds: (raw: unknown) => Array.isArray(raw)
      ? [...new Set(raw.filter((value): value is string => (
        typeof value === 'string' && mutationFamilies.includes(value)
      )))]
      : [],
    normalizeCustomDictionaryTerms: (raw: unknown) => {
      const values = String(raw || '').split(/\s+/).map((value) => value.trim()).filter(Boolean);
      return { values, truncated: false, rejectedCount: 0 };
    },
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
      dictionarySource: null,
      familyText: null,
      snapshotSource: null,
    });
  });

  test('accepts JSONL plus explicit preset, keyboard, and TLD controls', () => {
    assert.deepEqual(parseCliArguments([
      'discover', 'example brand', '--jsonl', '--preset', 'impersonation',
      '--keyboard', 'all', '--tlds', 'com,net', '--dictionary', 'terms.txt', '--no-color',
    ]), {
      action: 'discover',
      seed: 'example brand',
      output: 'jsonl',
      quiet: false,
      color: false,
      preset: 'impersonation',
      keyboardLayout: 'all',
      tldText: 'com,net',
      dictionarySource: 'terms.txt',
      familyText: null,
      snapshotSource: null,
    });
  });

  test('accepts a custom bounded family selection', () => {
    assert.deepEqual(parseCliArguments([
      'discover', 'example.test', '--families', 'pluralization,dictionary', '--dictionary', 'terms.txt',
    ]), {
      action: 'discover',
      seed: 'example.test',
      output: 'terminal',
      quiet: false,
      color: true,
      preset: 'custom',
      keyboardLayout: 'qwerty',
      tldText: null,
      dictionarySource: 'terms.txt',
      familyText: 'pluralization,dictionary',
      snapshotSource: null,
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
    assert.throws(() => parseCliArguments(['discover', 'x', '--dictionary']), /requires one UTF-8/);
    assert.throws(() => parseCliArguments(['discover', 'x', '--dictionary', 'one.txt', '--dictionary', 'two.txt']), /only once/);
    assert.throws(() => parseCliArguments(['discover', 'x', '--families']), /requires a comma-separated/);
    assert.throws(() => parseCliArguments(['discover', 'x', '--families', 'pluralization', '--families', 'dictionary']), /only once/);
    assert.throws(() => parseCliArguments(['discover', 'x', '--preset', 'all', '--families', 'pluralization']), /cannot be combined/);
    assert.throws(() => parseCliArguments(['discover', 'x', '--families', 'pluralization', '--preset', 'all']), /cannot be combined/);
    assert.throws(() => parseCliArguments(['discover', 'x', '--preset', 'common', '--dictionary', 'terms.txt']), /requires the impersonation or all preset/);
    assert.throws(() => parseCliArguments(['discover', 'one', 'two']), /one brand label or domain/);
    assert.throws(() => parseCliArguments(['discover', 'x', '--json', '--quiet']), /cannot be combined/);
    assert.throws(() => parseCliArguments(['discover', 'x', '--snapshot']), /requires one bounded/);
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

describe('discover dictionary input', () => {
  test('reads bounded UTF-8 dictionary text', async () => {
    async function* stream() {
      yield Buffer.from('invoice\n');
      yield Buffer.from('customer-care\n');
    }
    assert.equal(await readDiscoveryDictionaryBounded(stream()), 'invoice\ncustomer-care\n');
  });

  test('rejects dictionary files above the byte limit before generation', async () => {
    async function* stream() {
      yield Buffer.alloc(MAX_DISCOVERY_DICTIONARY_BYTES + 1, 97);
    }
    await assert.rejects(() => readDiscoveryDictionaryBounded(stream()), /limited to 4096 bytes/);
  });
});

describe('shared discovery core', () => {
  test('frontend compatibility exports and CLI core resolve to the same functions', async () => {
    const shared = await import('../lib/typosquat-generator.mts');
    const frontend = await import('../frontend/src/lib/analysis/typosquat-generator.ts');
    assert.equal(frontend.generateTyposquatCandidateSet, shared.generateTyposquatCandidateSet);
    assert.equal(frontend.estimateTyposquatCandidateCount, shared.estimateTyposquatCandidateCount);
    assert.deepEqual(
      frontend.generateTyposquatCandidateSet('example.test', ['com', 'net'], { preset: 'common' }),
      shared.generateTyposquatCandidateSet('example.test', ['com', 'net'], { preset: 'common' }),
    );
  });

  test('shared IDN compatibility exports retain one mapping implementation', async () => {
    const shared = await import('../lib/idn-confusables.mts');
    const frontend = await import('../frontend/src/lib/analysis/idn-confusables.ts');
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
    assert.equal(document.version, 2);
    assert.equal(document.seed, 'example.test');
    assert.equal(document.generatedAt, metadata.generatedAt);
    assert.deepEqual(document.mutationFamilies, []);
    assert.deepEqual(result, before);
  });

  test('JSONL items are independently versioned and empty results emit no blank record', () => {
    const lines = formatDiscoverJsonLines([candidate(0), candidate(1)], metadata).trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(lines.map((item) => item.schema), ['whoisleuth.cli.discover.item', 'whoisleuth.cli.discover.item']);
    assert.ok(lines.every((item) => item.version === 2));
    assert.ok(lines.every((item) => item.generatedAt === metadata.generatedAt));
    assert.ok(lines.every((item) => Array.isArray(item.mutationFamilies) && item.mutationFamilies.length === 0));
    assert.deepEqual(lines.map((item) => item.domain), ['candidate-0.test', 'candidate-1.test']);
    assert.equal(formatDiscoverJsonLines([], metadata), '');
  });

  test('domain-list output is newline-delimited and deduplicated', () => {
    assert.equal(formatDiscoverDomainList([candidate(0), candidate(1), candidate(0)]), 'candidate-0.test\ncandidate-1.test\n');
    assert.equal(formatDiscoverDomainList([]), '');
  });

  test('terminal display cap and mutation labels are explicit', () => {
    const candidates = Array.from({ length: MAX_DISCOVER_TERMINAL_CANDIDATES + 1 }, (_, index) => candidate(index));
    const document = buildCliDiscoverDocument(metadata.seed, generationResult({ candidates }), metadata);
    const output = formatTerminalDiscover(document, { character_omission: 'Character omission' });
    assert.match(output, /candidate-0\.test — Character omission/);
    assert.match(output, /Showing 200 of 201 candidates/);
    assert.equal(arrayValue(document.candidates).length, 201);
  });

  test('terminal output presents Unicode and DNS-safe forms together', () => {
    const unicodeCandidate = {
      domain: 'xn--e1argc3h.invalid',
      source: 'scope.invalid',
      tld: 'invalid',
      mutationTypes: ['unicode_homoglyph', 'unicode_whole_label'],
    };
    const document = buildCliDiscoverDocument(metadata.seed, generationResult({ candidates: [unicodeCandidate] }), metadata);
    const output = formatTerminalDiscover(document, {
      unicode_homoglyph: 'Unicode confusable',
      unicode_whole_label: 'Whole-label Unicode confusable',
    });
    assert.match(output, /xn--e1argc3h\.invalid \[Unicode: ѕсоре\.invalid\]/u);
    assert.match(output, /Unicode confusable, Whole-label Unicode confusable/u);
  });

  test('terminal and machine output retain advanced-family diagnostics', () => {
    const result = generationResult({
      advancedConfusable: { generated: 59, omittedByPolicy: 225, omittedByBudget: 0 },
    });
    const document = buildCliDiscoverDocument(metadata.seed, result, metadata);
    const output = formatTerminalDiscover(document);
    assert.match(output, /Advanced IDN   59 generated, 225 policy-omitted, 0 budget-omitted/u);
    assert.deepEqual(document.advancedConfusable, result.advancedConfusable);
  });
});

describe('discover runner', () => {
  test('passes normalized controls to the shared generator and emits JSON', async () => {
    const stdout = capture();
    const stderr = capture();
    let received: Record<string, unknown> | undefined;
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
      options: { preset: 'impersonation', keyboardLayout: 'qwertz', dictionaryTerms: '' },
    });
    assert.equal(stderr.value(), '');
    const document = JSON.parse(stdout.value());
    assert.equal(document.schema, 'whoisleuth.cli.discover');
    assert.deepEqual(document.tlds, ['com', 'net']);
  });

  test('stdin and quiet mode use defaults without producing output', async () => {
    const stdout = capture();
    let received: Record<string, unknown> | undefined;
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
      options: { preset: 'all', keyboardLayout: 'qwerty', dictionaryTerms: '' },
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

  test('loads a bounded dictionary without exposing its terms in machine metadata', async () => {
    const stdout = capture();
    let received: Record<string, unknown> | undefined;
    const code = await runCli([
      'discover', 'example.test', '--dictionary', 'private-terms.txt', '--json',
    ], {
      stdout: stdout.stream,
      stderr: capture().stream,
      readDiscoveryDictionary: async () => 'invoice\ncustomer-care\n',
      loadTyposquatGenerator: async () => fakeGenerator((seed, tlds, options) => {
        received = { seed, tlds, options };
        return generationResult();
      }),
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(recordValue(recordValue(received).options).dictionaryTerms, 'invoice\ncustomer-care\n');
    const document = JSON.parse(stdout.value());
    assert.equal(document.dictionaryTermCount, 2);
    assert.equal(document.rejectedDictionaryTermCount, 0);
    assert.equal(JSON.stringify(document).includes('invoice'), false);
    assert.equal(JSON.stringify(document).includes('customer-care'), false);
  });

  test('passes a validated custom family selection and records it in machine metadata', async () => {
    const stdout = capture();
    let received: Record<string, unknown> | undefined;
    const code = await runCli([
      'discover', 'example.test', '--families', 'pluralization,dictionary', '--json',
    ], {
      stdout: stdout.stream,
      stderr: capture().stream,
      loadTyposquatGenerator: async () => fakeGenerator((seed, tlds, options) => {
        received = { seed, tlds, options };
        return generationResult();
      }),
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.deepEqual(recordValue(recordValue(received).options).mutationTypes, ['pluralization', 'dictionary']);
    assert.deepEqual(JSON.parse(stdout.value()).mutationFamilies, ['pluralization', 'dictionary']);
  });

  test('accepts the explicit advanced Unicode family without enabling other families', async () => {
    const stdout = capture();
    let received: Record<string, unknown> | undefined;
    const code = await runCli([
      'discover', 'scope.invalid', '--families', 'unicode_homoglyph_depth_2', '--json',
    ], {
      stdout: stdout.stream,
      stderr: capture().stream,
      loadTyposquatGenerator: async () => fakeGenerator((seed, tlds, options) => {
        received = { seed, tlds, options };
        return generationResult({
          advancedConfusable: { generated: 59, omittedByPolicy: 225, omittedByBudget: 0 },
        });
      }),
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.deepEqual(recordValue(recordValue(received).options).mutationTypes, ['unicode_homoglyph_depth_2']);
    assert.deepEqual(JSON.parse(stdout.value()).mutationFamilies, ['unicode_homoglyph_depth_2']);
  });

  test('accepts a local dictionary for token-replacement-only generation', async () => {
    let received: Record<string, unknown> | undefined;
    const code = await runCli([
      'discover', 'alpha-portal.test',
      '--families', 'dictionary_token_replacement',
      '--dictionary', 'terms.txt',
      '--quiet',
    ], {
      stdout: capture().stream,
      stderr: capture().stream,
      readDiscoveryDictionary: async () => 'account\nsupport\n',
      loadTyposquatGenerator: async () => fakeGenerator((seed, tlds, options) => {
        received = { seed, options };
        return generationResult();
      }),
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.deepEqual(received, {
      seed: 'alpha-portal.test',
      options: {
        preset: 'custom',
        keyboardLayout: 'qwerty',
        dictionaryTerms: 'account\nsupport\n',
        mutationTypes: ['dictionary_token_replacement'],
      },
    });
  });

  test('rejects unknown or empty custom families and dictionary-family mismatches', async () => {
    for (const argv of [
      ['discover', 'example.test', '--families', 'unknown'],
      ['discover', 'example.test', '--families', ','],
      ['discover', 'example.test', '--families', 'pluralization', '--dictionary', 'terms.txt'],
    ]) {
      const stderr = capture();
      const code = await runCli(argv, {
        stdout: capture().stream,
        stderr: stderr.stream,
        readDiscoveryDictionary: async () => 'invoice',
        loadTyposquatGenerator: async () => fakeGenerator(() => generationResult()),
      });
      assert.equal(code, EXIT_CODES.USAGE);
      assert.match(stderr.value(), /famil/i);
    }
  });

  test('rejects a dictionary with no valid terms', async () => {
    const stderr = capture();
    const code = await runCli([
      'discover', 'example.test', '--dictionary', 'empty.txt',
    ], {
      stdout: capture().stream,
      stderr: stderr.stream,
      readDiscoveryDictionary: async () => '',
      loadTyposquatGenerator: async () => fakeGenerator(() => generationResult()),
    });
    assert.equal(code, EXIT_CODES.USAGE);
    assert.match(stderr.value(), /did not contain any valid terms/);
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

  test('local snapshots compare generated candidate sets without exposing dictionary terms', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-discovery-'));
    const snapshot = path.join(directory, 'state.json');
    try {
      const firstStdout = capture();
      const first = await runCli([
        'discover', 'example.test', '--json', '--dictionary', 'terms.txt', '--snapshot', snapshot,
      ], {
        stdout: firstStdout.stream,
        stderr: capture().stream,
        now: () => '2026-07-14T00:00:00.000Z',
        readDiscoveryDictionary: async () => 'invoice\n',
        loadTyposquatGenerator: async () => fakeGenerator(() => generationResult({ candidates: [candidate(0)] })),
      });
      assert.equal(first, EXIT_CODES.SUCCESS);
      const firstDocument = JSON.parse(firstStdout.value());
      assert.equal(firstDocument.snapshot.baselineCreated, true);
      assert.equal(JSON.stringify(firstDocument).includes('invoice'), false);

      const secondStdout = capture();
      const second = await runCli([
        'discover', 'example.test', '--json', '--dictionary', 'terms.txt', '--snapshot', snapshot,
      ], {
        stdout: secondStdout.stream,
        stderr: capture().stream,
        now: () => '2026-07-15T00:00:00.000Z',
        readDiscoveryDictionary: async () => 'invoice\n',
        loadTyposquatGenerator: async () => fakeGenerator(() => generationResult({ candidates: [candidate(1)] })),
      });
      assert.equal(second, EXIT_CODES.SUCCESS);
      const secondDocument = JSON.parse(secondStdout.value());
      assert.deepEqual(secondDocument.snapshot.added, ['candidate-1.test']);
      assert.deepEqual(secondDocument.snapshot.removed, ['candidate-0.test']);
      const saved = JSON.parse(await readFile(snapshot, 'utf8'));
      assert.deepEqual(saved.candidates, ['candidate-1.test']);
      assert.equal(saved.schema, 'whoisleuth.cli.discovery-snapshot');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
