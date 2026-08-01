import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';

import { parseCliArguments } from '../cli/arguments.mts';
import type { BulkLookupResult, ClassifiedQuery } from '../cli/bulk.mts';
import {
  buildDiscoveryScanDocument,
  formatDiscoveryScanCsv,
  formatDiscoveryScanDomains,
  parseDiscoveryScanAllowlist,
  readDiscoveryScanListBounded,
  runDiscoveryScanChunks,
} from '../cli/discovery-scan.mts';
import {
  CLI_DISCOVERY_OBSERVATION_SCHEMA,
  CLI_DISCOVERY_OBSERVATION_VERSION,
  snapshotConfigurationDigest,
  updateDiscoveryObservationSnapshot,
} from '../cli/discovery-observation-snapshot.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { runCli } from '../cli/runner.mts';
import {
  createSelectedDnsResolvers,
  normalizeSelectedDnsResolvers,
} from '../lib/dns-resolver-selection.mts';

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

function classified(domain: string): ClassifiedQuery {
  return {
    type: 'domain', value: domain, inputHostname: domain, registrableDomain: domain, isSubdomain: false,
  };
}

function compactResult(domain: string, state = 'registered', shared = false) {
  return {
    availability: {
      applicable: true,
      domain,
      state,
      confidence: state === 'unknown' ? 'medium' : 'high',
      dns: {
        status: 'success',
        records: {
          a: [shared ? '192.0.2.10' : `192.0.2.${domain.length}`],
          aaaa: [],
          ns: [shared ? 'ns.shared.example' : `ns.${domain}`],
          mx: shared ? [{ priority: 10, exchange: 'mx.shared.example' }] : [],
        },
      },
      hasNullMx: false,
      hasSpf: shared,
      hasDmarc: shared,
    },
    diagnostics: { version: 8, rdap: { status: 'success' }, whois: { status: 'skipped' } },
  };
}

function success(index: number, domain: string, state = 'registered', shared = false): BulkLookupResult {
  return { index, query: domain, ok: true, classified: classified(domain), result: compactResult(domain, state, shared) };
}

function candidates() {
  return [
    { domain: 'one.example', source: 'brand.example', tld: 'example', mutationTypes: ['character_omission'] },
    { domain: 'two.example', source: 'brand.example', tld: 'example', mutationTypes: ['character_substitution'] },
    { domain: 'three.example', source: 'brand.example', tld: 'example', mutationTypes: ['tld_swap'] },
  ];
}

function metadata(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: '2026-08-01T00:00:00.000Z',
    seed: 'brand.example',
    preset: 'all',
    keyboardLayout: 'qwerty',
    tlds: ['example'],
    mutationFamilies: [],
    generatedCandidateCount: 3,
    selectedCandidateCount: 3,
    scanLimit: 100,
    chunkSize: 2,
    concurrency: 2,
    deep: true,
    filter: 'all' as const,
    resolverServers: [] as string[],
    ...overrides,
  };
}

describe('discover-scan CLI arguments', () => {
  test('uses bounded fast collection defaults', () => {
    assert.deepEqual(parseCliArguments(['discover-scan', 'brand.example']), {
      action: 'discover-scan', seed: 'brand.example', output: 'terminal', quiet: false, color: true,
      preset: 'all', keyboardLayout: 'qwerty', tldText: null, dictionarySource: null,
      familyText: null, deep: false, scanLimit: 100, chunkSize: 25, concurrency: 4,
      checkpoint: null, resume: false, resolverText: null, observationSnapshot: null,
      allowlistSource: null, filter: 'all', events: false,
    });
  });

  test('accepts supervised collection controls and enforces mode bounds', () => {
    const parsed = parseCliArguments([
      'discover-scan', 'brand.example', '--deep', '--scan-limit', '40', '--chunk-size', '10',
      '--concurrency', '3', '--resolver', '192.0.2.53,2001:db8::53', '--allowlist', 'known.txt',
      '--checkpoint', 'state.json', '--resume', '--observation-snapshot', 'observed.json',
      '--registered-only', '--csv', '--events',
    ]);
    assert.equal(parsed.action, 'discover-scan');
    assert.equal(parsed.deep, true);
    assert.equal(parsed.scanLimit, 40);
    assert.equal(parsed.filter, 'registered');
    assert.equal(parsed.output, 'csv');
    assert.throws(() => parseCliArguments(['discover-scan', 'x.example', '--deep', '--scan-limit', '51']), /capped at 50/u);
    assert.throws(() => parseCliArguments(['discover-scan', 'x.example', '--deep', '--concurrency', '4']), /capped at 3/u);
    assert.throws(() => parseCliArguments(['discover-scan', 'x.example', '--resume']), /requires --checkpoint/u);
    assert.throws(() => parseCliArguments(['discover-scan', 'x.example', '--registered-only', '--suppressed-only']), /mutually exclusive/u);
  });
});

describe('analyst-selected DNS resolvers', () => {
  test('accepts bounded literal addresses and rejects hostnames or excessive lists', () => {
    assert.deepEqual(normalizeSelectedDnsResolvers('192.0.2.53, 2001:db8::53,192.0.2.53'), ['192.0.2.53', '2001:db8::53']);
    assert.throws(() => normalizeSelectedDnsResolvers('resolver.example'), /literal IPv4 or IPv6/u);
    assert.throws(() => normalizeSelectedDnsResolvers('192.0.2.1,192.0.2.2,192.0.2.3,192.0.2.4'), /1 to 3/u);
    assert.deepEqual(Object.keys(createSelectedDnsResolvers(['192.0.2.53'])).sort(), [
      'resolve4', 'resolve6', 'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNs', 'resolveSoa', 'resolveTxt',
    ]);
  });
});

describe('discovery scan allowlists and relationships', () => {
  test('bounds and normalizes analyst allowlists without discarding evidence', async () => {
    const text = await readDiscoveryScanListBounded(Readable.from(['# reviewed\nONE.example\n']));
    const allowlist = parseDiscoveryScanAllowlist(text, (value) => classified(value.toLowerCase()));
    assert.deepEqual([...allowlist], ['one.example']);
    const document = buildDiscoveryScanDocument(
      candidates(),
      [success(0, 'one.example', 'registered', true), success(1, 'two.example', 'registered', true), success(2, 'three.example', 'available')],
      metadata(),
      allowlist,
    );
    assert.equal(document.results.length, 3);
    assert.equal(document.results[0]?.review.lane, 'suppressed');
    assert.equal(document.results[2]?.review.lane, 'acquisition_review');
    assert.equal(document.relationships.length, 3);
    assert.ok(document.relationships.every((relationship) => relationship.domainCount === 2));
    assert.equal(document.summary.suppressed, 1);
  });

  test('filters output without changing whole-run coverage or summaries', () => {
    const document = buildDiscoveryScanDocument(
      candidates(),
      [success(0, 'one.example'), success(1, 'two.example', 'unknown'), success(2, 'three.example', 'available')],
      metadata({ filter: 'acquisition' }),
      new Set(),
    );
    assert.deepEqual(document.results.map((item) => item.domain), ['three.example']);
    assert.equal(document.summary.collected, 3);
    assert.equal(document.summary.matched, 1);
    assert.match(formatDiscoveryScanCsv(document), /^domain,availability,/u);
    assert.equal(formatDiscoveryScanDomains(document), 'three.example\n');
  });

  test('neutralizes untrusted collection errors in CSV output', () => {
    const failed: BulkLookupResult = { index: 0, query: 'one.example', ok: false, error: '=HYPERLINK("https://example.invalid")' };
    const document = buildDiscoveryScanDocument(candidates().slice(0, 1), [failed], metadata({ generatedCandidateCount: 1, selectedCandidateCount: 1 }), new Set());
    assert.match(formatDiscoveryScanCsv(document), /"'=HYPERLINK\(""https:\/\/example\.invalid""\)"/u);
  });
});

describe('chunked discovery collection', () => {
  test('runs deterministic chunks, preserves global indexes, and forwards resolver selection', async () => {
    const settled: number[] = [];
    const modes: unknown[] = [];
    const results = await runDiscoveryScanChunks(['one.example', 'two.example', 'three.example'], {
      deep: false,
      chunkSize: 2,
      concurrency: 2,
      dnsResolverServers: ['192.0.2.53'],
      classifyQuery: classified,
      runUnifiedLookup: async (item, options) => {
        modes.push(options);
        return compactResult(item.value);
      },
      onItemSettled: (item) => settled.push(item.index),
    });
    assert.deepEqual(results.map((item) => item.index), [0, 1, 2]);
    assert.deepEqual(settled.sort((a, b) => a - b), [0, 1, 2]);
    assert.ok(modes.every((value) => {
      const options = value as Record<string, unknown>;
      return options.fast === true && options.compact === true
        && JSON.stringify(options.dnsResolverServers) === JSON.stringify(['192.0.2.53']);
    }));
  });
});

describe('discovery observation snapshots', () => {
  test('reports material changes and preserves prior evidence across a failed attempt', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-observed-'));
    const snapshot = path.join(directory, 'observed.json');
    try {
      const selected = candidates().slice(0, 2);
      const first = await updateDiscoveryObservationSnapshot(
        snapshot, selected,
        [success(0, 'one.example'), success(1, 'two.example')],
        { deep: true, resolverServers: [] },
        '2026-08-01T00:00:00.000Z',
      );
      assert.equal(first.baselineCreated, true);
      const failed: BulkLookupResult = { index: 1, query: 'two.example', ok: false, error: 'timeout' };
      const changedResult = success(0, 'one.example', 'available');
      const second = await updateDiscoveryObservationSnapshot(
        snapshot, selected, [changedResult, failed],
        { deep: true, resolverServers: [] },
        '2026-08-02T00:00:00.000Z',
      );
      assert.deepEqual(second.unavailable, ['two.example']);
      assert.equal(second.changed[0]?.domain, 'one.example');
      const stored = JSON.parse(await readFile(snapshot, 'utf8'));
      assert.equal(stored.schema, CLI_DISCOVERY_OBSERVATION_SCHEMA);
      assert.equal(stored.version, CLI_DISCOVERY_OBSERVATION_VERSION);
      assert.equal(stored.observations[1].latestAttemptState, 'error');
      assert.equal(stored.observations[1].availabilityState, 'registered');
      assert.equal(stored.observations[1].registrationObservedAt, '2026-08-01T00:00:00.000Z');
      assert.equal(stored.observations[1].dnsObservedAt, '2026-08-01T00:00:00.000Z');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('preserves complete DNS evidence when a later component is partial', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-observed-partial-'));
    const snapshot = path.join(directory, 'observed.json');
    try {
      const selected = candidates().slice(0, 1);
      await updateDiscoveryObservationSnapshot(
        snapshot, selected, [success(0, 'one.example')],
        { deep: true, resolverServers: [] }, '2026-08-01T00:00:00.000Z',
      );
      const partial = success(0, 'one.example');
      if (partial.ok) {
        const availability = (partial.result as Record<string, unknown>).availability as Record<string, unknown>;
        availability.dns = { status: 'partial', records: { a: [], aaaa: [], ns: [], mx: [] } };
      }
      const result = await updateDiscoveryObservationSnapshot(
        snapshot, selected, [partial],
        { deep: true, resolverServers: [] }, '2026-08-02T00:00:00.000Z',
      );
      assert.deepEqual(result.changed, []);
      assert.deepEqual(result.unavailable, ['one.example']);
      assert.deepEqual(result.unavailableComponents, [{ domain: 'one.example', components: ['dns'] }]);
      const stored = JSON.parse(await readFile(snapshot, 'utf8'));
      const observation = stored.observations[0];
      assert.equal(observation.latestAttemptState, 'partial');
      assert.equal(observation.latestDnsState, 'partial');
      assert.deepEqual(observation.dns.a, ['192.0.2.11']);
      assert.equal(observation.dns.status, 'success');
      assert.equal(observation.dnsObservedAt, '2026-08-01T00:00:00.000Z');
      assert.equal(observation.registrationObservedAt, '2026-08-02T00:00:00.000Z');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test('migrates a version 1 snapshot before replacing it with component-aware version 2 evidence', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'whoisleuth-observed-v1-'));
    const snapshot = path.join(directory, 'observed.json');
    const domains = ['one.example'];
    const configuration = { domains, deep: true, resolverServers: [] as string[] };
    try {
      await writeFile(snapshot, `${JSON.stringify({
        schema: CLI_DISCOVERY_OBSERVATION_SCHEMA,
        version: 1,
        generatedAt: '2026-07-31T00:00:00.000Z',
        configurationDigestSha256: snapshotConfigurationDigest(configuration),
        observationCount: 1,
        observations: [{
          domain: 'one.example',
          observedAt: '2026-07-31T00:00:00.000Z',
          latestAttemptAt: '2026-07-31T00:00:00.000Z',
          latestAttemptState: 'success',
          availabilityState: 'registered',
          confidence: 'high',
          dns: { status: 'success', a: ['192.0.2.1'], aaaa: [], ns: [], mx: [], hasNullMx: false, hasSpf: false, hasDmarc: false },
        }],
      }, null, 2)}\n`, { mode: 0o600 });
      await updateDiscoveryObservationSnapshot(
        snapshot, candidates().slice(0, 1), [success(0, 'one.example')],
        { deep: true, resolverServers: [] }, '2026-08-01T00:00:00.000Z',
      );
      const stored = JSON.parse(await readFile(snapshot, 'utf8'));
      assert.equal(stored.version, 2);
      assert.equal(stored.observations[0].registrationObservedAt, '2026-08-01T00:00:00.000Z');
      assert.equal(stored.observations[0].dnsObservedAt, '2026-08-01T00:00:00.000Z');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('discover-scan runner', () => {
  test('composes generation, compact collection, review, and JSON output', async () => {
    const stdout = capture();
    const stderr = capture();
    const received: Array<Record<string, unknown>> = [];
    const code = await runCli([
      'discover-scan', 'brand.example', '--scan-limit', '2', '--resolver', '192.0.2.53', '--json',
    ], {
      stdout: stdout.stream,
      stderr: stderr.stream,
      now: () => '2026-08-01T00:00:00.000Z',
      loadTyposquatGenerator: async () => ({
        MAX_GENERATION_TLDS: 20,
        MUTATION_FAMILY_IDS: ['character_omission'],
        MUTATION_LABELS: { character_omission: 'Character omission' },
        normalizeMutationFamilyIds: () => [],
        normalizeCustomDictionaryTerms: () => ({ values: [], rejectedCount: 0 }),
        generateTyposquatCandidateSet: () => ({ inputValid: true, candidates: candidates(), version: 1 }),
      }),
      classifyQuery: classified,
      runUnifiedLookup: async (item, options) => {
        received.push(options as Record<string, unknown>);
        return compactResult(item.value);
      },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    const document = JSON.parse(stdout.value());
    assert.equal(document.schema, 'whoisleuth.cli.discovery-scan');
    assert.equal(document.summary.collected, 2);
    assert.equal(document.generation.generatedCandidateCount, 3);
    assert.equal(document.collection.resolver, 'analyst_selected');
    assert.ok(received.every((options) => options.fast === true && options.compact === true));
    assert.equal(stderr.value(), '');
  });
});
