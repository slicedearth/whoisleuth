import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';

import { parseCliArguments } from '../cli/arguments.mts';
import {
  MAX_COMPARE_EVENTS,
  MAX_COMPARE_INPUT_BYTES,
  MAX_COMPARE_LIST_ITEMS,
  MAX_COMPARE_REGISTRY_ACCESS_LIMITATION_LENGTH,
  MAX_COMPARE_REGISTRY_ACCESS_SUFFIX_LENGTH,
  MAX_COMPARE_STRING_LENGTH,
  compareLookupDocument,
  parseCliLookupDocument,
  readCompareInputBounded,
} from '../cli/compare.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { buildCliCompareDocument } from '../cli/formatters/json.mts';
import { formatTerminalCompare } from '../cli/formatters/terminal.mts';
import { runCli } from '../cli/runner.mts';
import { arrayValue, recordValue } from './value-assertions.mts';

type RegistryAccessFixture = Record<string, unknown> & {
  suffix: string;
  coverageState: string;
  whoisAccessProfile: string;
  rdapAccessProfile: string;
  limitation: string;
  authority: string;
};

type LookupFixture = Record<string, unknown> & {
  rdap: {
    data: Record<string, unknown>;
    parsed: {
      domain: string;
      handle: string;
      registrar: { name: string };
      registrarIanaId: string;
      lifecycle: unknown;
      dnssec: string;
      statuses: unknown;
      nameservers: string[];
      events?: unknown;
    };
    registrarRdap?: {
      status: string;
      data?: Record<string, unknown>;
      parsed: unknown;
      detail?: string;
    };
  };
  whois: {
    chain: Array<Record<string, unknown>>;
    parsed: {
      domainName: string;
      registryDomainId: string;
      registrar: string;
      registrarIanaId: string;
      createdDate: string;
      createdDateIso: string;
      dnssec: string;
      statuses: unknown;
      nameservers: string[];
    };
  };
  diagnostics: {
    version: number;
    rdap: { status: string; registrar?: { status: string } };
    whois: { status: string };
    registryAccess?: RegistryAccessFixture;
  };
};

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

function lookupDocument(overrides: Record<string, unknown> = {}): LookupFixture {
  const document = {
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
  };
  return { ...document, ...overrides } as LookupFixture;
}

function withRegistrarPublication(
  source: LookupFixture,
  overrides: Record<string, unknown> = {},
): LookupFixture & { rdap: LookupFixture['rdap'] & { registrarRdap: NonNullable<LookupFixture['rdap']['registrarRdap']> } } {
  const registrarRdap = {
    status: 'success',
    data: { privateContact: 'must not enter comparison output' },
    parsed: {
      domain: 'EXAMPLE.TEST',
      handle: 'REGISTRAR-SPECIFIC-HANDLE',
      registrar: { name: 'Example Registrar LLC' },
      registrarIanaId: '9999',
      lifecycle: {
        createdDate: '2025-01-01',
        createdDateIso: '2025-01-01T00:00:00.000Z',
      },
      dnssec: 'secure',
      statuses: ['transfer prohibited'],
      nameservers: ['ns1.example.test'],
      entitiesByRole: { abuse: [{ email: 'private@example.test' }] },
    },
    ...overrides,
  };
  source.rdap.registrarRdap = registrarRdap;
  source.diagnostics.rdap.registrar = { status: registrarRdap.status };
  return source as LookupFixture & {
    rdap: LookupFixture['rdap'] & { registrarRdap: NonNullable<LookupFixture['rdap']['registrarRdap']> };
  };
}

function withRegistryAccess(
  source = lookupDocument(),
  overrides: Record<string, unknown> = {},
  version = 5,
): LookupFixture & { diagnostics: LookupFixture['diagnostics'] & { registryAccess: RegistryAccessFixture } } {
  source.diagnostics.version = version;
  source.diagnostics.registryAccess = {
    suffix: 'zz',
    coverageState: 'access_documented',
    whoisAccessProfile: 'source-ip-authorization-required',
    rdapAccessProfile: 'no-iana-service',
    limitation: 'Registry collection requires documented source authorization.',
    authority: 'context_only',
    ...overrides,
  };
  return source as LookupFixture & {
    diagnostics: LookupFixture['diagnostics'] & { registryAccess: RegistryAccessFixture };
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
    const source = withRegistrarPublication(lookupDocument());
    const before = structuredClone(source);
    const parsed = parseCliLookupDocument(JSON.stringify(source));
    assert.equal(parsed.query, 'example.test');
    assert.equal(recordValue(parsed.rdapParsed.registrar).name, 'Example Registrar, LLC');
    assert.equal(parsed.whoisParsed.registrar, 'Example Registrar LLC');
    assert.equal(parsed.registrarRdapRepresented, true);
    assert.equal(parsed.registrarRdapStatus, 'success');
    assert.equal(recordValue(parsed.registrarRdapParsed.registrar).name, 'Example Registrar LLC');
    assert.equal(Object.hasOwn(parsed.rdapParsed, 'data'), false);
    assert.equal(JSON.stringify(parsed).includes('payload must not be copied'), false);
    assert.equal(JSON.stringify(parsed).includes('REGISTRAR-SPECIFIC-HANDLE'), false);
    assert.equal(JSON.stringify(parsed).includes('private@example.test'), false);
    assert.deepEqual(source, before);
  });

  test('projects only bounded supported context-only registry access diagnostics', () => {
    for (const version of [5, 6, 7, 8]) {
      const source = withRegistryAccess(lookupDocument(), {}, version);
      source.diagnostics.registryAccess.privateDetail = 'must not enter comparison output';
      const before = structuredClone(source);
      const parsed = parseCliLookupDocument(JSON.stringify(source));

      assert.deepEqual(parsed.registryAccess, {
        suffix: 'zz',
        coverageState: 'access_documented',
        whoisAccessProfile: 'source-ip-authorization-required',
        rdapAccessProfile: 'no-iana-service',
        limitation: 'Registry collection requires documented source authorization.',
        authority: 'context_only',
      });
      assert.equal(JSON.stringify(parsed).includes('privateDetail'), false);
      assert.deepEqual(source, before);
    }
  });

  test('rejects malformed version-5 registry access context at the saved-document boundary', () => {
    const invalidValues = [
      { registryAccess: [], pattern: /must be an object/ },
      { registryAccess: { ...withRegistryAccess().diagnostics.registryAccess, authority: 'authoritative' }, pattern: /authority is unsupported/ },
      { registryAccess: { ...withRegistryAccess().diagnostics.registryAccess, coverageState: 'fixture_verified' }, pattern: /coverageState is unsupported/ },
      { registryAccess: { ...withRegistryAccess().diagnostics.registryAccess, suffix: `a${'-a'.repeat(MAX_COMPARE_REGISTRY_ACCESS_SUFFIX_LENGTH)}` }, pattern: /suffix is invalid/ },
      { registryAccess: { ...withRegistryAccess().diagnostics.registryAccess, suffix: 'bad.suffix' }, pattern: /suffix is invalid/ },
      { registryAccess: { ...withRegistryAccess().diagnostics.registryAccess, whoisAccessProfile: 'invented' }, pattern: /whoisAccessProfile is unsupported/ },
      { registryAccess: { ...withRegistryAccess().diagnostics.registryAccess, whoisAccessProfile: 'iana-bootstrap' }, pattern: /whoisAccessProfile is unsupported/ },
      { registryAccess: { ...withRegistryAccess().diagnostics.registryAccess, rdapAccessProfile: 'invented' }, pattern: /rdapAccessProfile is unsupported/ },
      { registryAccess: { ...withRegistryAccess().diagnostics.registryAccess, rdapAccessProfile: 'iana-referral' }, pattern: /rdapAccessProfile is unsupported/ },
      { registryAccess: { ...withRegistryAccess().diagnostics.registryAccess, limitation: 'x'.repeat(MAX_COMPARE_REGISTRY_ACCESS_LIMITATION_LENGTH + 1) }, pattern: /limitation is invalid/ },
    ];
    for (const { registryAccess, pattern } of invalidValues) {
      const source = lookupDocument({
        diagnostics: {
          version: 5,
          rdap: { status: 'success' },
          whois: { status: 'complete' },
          registryAccess,
        },
      });
      assert.throws(() => parseCliLookupDocument(JSON.stringify(source)), pattern);
    }
  });

  test('ignores registry access fields outside the supported diagnostic contracts', () => {
    const source = withRegistryAccess();
    source.diagnostics.version = 4;
    assert.equal(parseCliLookupDocument(JSON.stringify(source)).registryAccess, null);
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
    assert.throws(() => parseCliLookupDocument(JSON.stringify(lookupDocument({ schema: 'other' }))), /whoisleuth\.cli\.lookup version 1 or 2/);
    assert.throws(() => parseCliLookupDocument(JSON.stringify(lookupDocument({ version: 3 }))), /version 1 or 2/);
    assert.throws(() => parseCliLookupDocument(JSON.stringify(lookupDocument({ type: 'ip' }))), /unsupported lookup type/);
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

    const registrar = withRegistrarPublication(lookupDocument());
    registrar.rdap.registrarRdap.parsed = [];
    assert.throws(() => parseCliLookupDocument(JSON.stringify(registrar)), /registrarRdap\.parsed must be an object/);

    const mismatched = withRegistrarPublication(lookupDocument());
    assert.ok(mismatched.diagnostics.rdap.registrar);
    mismatched.diagnostics.rdap.registrar.status = 'error';
    assert.throws(() => parseCliLookupDocument(JSON.stringify(mismatched)), /statuses do not match/);
  });

  test('bounded stream reader stops after the configured byte limit', async () => {
    assert.equal(await readCompareInputBounded(Readable.from(['abc']), 3), 'abc');
    await assert.rejects(() => readCompareInputBounded(Readable.from(['ab', 'cd']), 3), /limited to 3 bytes/);
  });
});

describe('comparison output', () => {
  test('uses the same comparison function through the frontend compatibility module', async () => {
    const shared = await comparisonModule();
    const frontend = await import('../frontend/src/lib/analysis/registry-comparison.ts');
    assert.equal(frontend.compareRegistrySources, shared.compareRegistrySources);
  });

  test('reports equivalent normalized values and material conflicts without raw payloads', async () => {
    const source = withRegistrarPublication(lookupDocument());
    source.whois.parsed.registrar = 'Different Registrar';
    const parsed = parseCliLookupDocument(JSON.stringify(source));
    const shared = await comparisonModule();
    const result = compareLookupDocument(parsed, shared.compareRegistrySources, shared.compareRdapPublications);
    const counts = recordValue(result.counts);
    const fields = arrayValue(result.fields).map(recordValue);
    const publication = recordValue(result.registrarPublicationComparison);
    const publicationFields = arrayValue(publication.fields).map(recordValue);
    const publicationCounts = recordValue(publication.counts);
    assert.equal(counts.conflict, 1);
    assert.ok(Number(counts.equivalent) >= 7);
    assert.equal(fields.find((item) => item.label === 'Registrar')?.status, 'conflict');
    assert.equal(publicationFields.find((item) => item.label === 'Statuses')?.status, 'equivalent');
    assert.equal(publicationCounts.conflict, 0);
    assert.equal(JSON.stringify(result).includes('payload must not be copied'), false);
    assert.equal(JSON.stringify(result).includes('privateContact'), false);
  });

  test('keeps absent and unavailable registrar publications explicit and neutral', async () => {
    const shared = await comparisonModule();
    const absent = compareLookupDocument(
      parseCliLookupDocument(JSON.stringify(lookupDocument())),
      shared.compareRegistrySources,
      shared.compareRdapPublications,
    );
    assert.equal(absent.registrarPublicationComparison, null);

    const unavailableSource = withRegistrarPublication(lookupDocument(), {
      status: 'unsupported',
      parsed: null,
      detail: 'No eligible registrar RDAP link was published.',
    });
    const unavailable = compareLookupDocument(
      parseCliLookupDocument(JSON.stringify(unavailableSource)),
      shared.compareRegistrySources,
      shared.compareRdapPublications,
    );
    const unavailablePublication = recordValue(unavailable.registrarPublicationComparison);
    const unavailableCounts = recordValue(unavailablePublication.counts);
    assert.equal(unavailableCounts.conflict, 0);
    assert.ok(Number(unavailableCounts.registrar_unavailable) > 0);
  });

  test('requires the registrar comparison dependency only when the source was represented', async () => {
    const shared = await comparisonModule();
    const represented = parseCliLookupDocument(JSON.stringify(withRegistrarPublication(lookupDocument())));
    assert.throws(
      () => compareLookupDocument(represented, shared.compareRegistrySources),
      /Registrar RDAP comparison dependency is required/,
    );
    assert.doesNotThrow(() => compareLookupDocument(
      parseCliLookupDocument(JSON.stringify(lookupDocument())),
      shared.compareRegistrySources,
    ));
  });

  test('treats fast-mode WHOIS omission as unavailable rather than publication absence', async () => {
    const source = lookupDocument({
      mode: 'fast',
      whois: { skipped: true },
      diagnostics: { rdap: { status: 'success' }, whois: { status: 'skipped' } },
    });
    const shared = await comparisonModule();
    const result = compareLookupDocument(parseCliLookupDocument(JSON.stringify(source)), shared.compareRegistrySources);
    assert.equal(recordValue(recordValue(result.sourceHealth).whois).condition, 'unavailable');
    const fields = arrayValue(result.fields).map(recordValue);
    assert.ok(fields.every((item) => item.status === 'whois_unavailable'));
    assert.ok(fields.every((item) => item.whoisDisplay === 'Source skipped'));
  });

  test('protects the versioned JSON envelope from result-field collisions', () => {
    const result = { schema: 'untrusted', version: 99, generatedAt: 'untrusted', fields: [], counts: {}, sourceHealth: {} };
    const before = structuredClone(result);
    const document = buildCliCompareDocument(result, '2026-07-14T07:00:00.000Z');
    assert.equal(document.schema, 'whoisleuth.cli.compare');
    assert.equal(document.version, 3);
    assert.equal(document.generatedAt, '2026-07-14T07:00:00.000Z');
    assert.deepEqual(result, before);
  });

  test('renders bounded source health, summary, values, and interpretation warning', async () => {
    const source = withRegistryAccess(withRegistrarPublication(lookupDocument()), {
      limitation: `Restricted\ncollection ${'x'.repeat(270)}`,
    });
    source.whois.parsed.registrar = 'Different Registrar';
    const shared = await comparisonModule();
    const result = compareLookupDocument(
      parseCliLookupDocument(JSON.stringify(source)),
      shared.compareRegistrySources,
      shared.compareRdapPublications,
    );
    const output = formatTerminalCompare(buildCliCompareDocument(result));
    assert.match(output, /RDAP source\s+Success/);
    assert.match(output, /WHOIS source\s+Complete/);
    assert.match(output, /\[CONFLICT\] Registrar/);
    assert.match(output, /RDAP\s+Example Registrar, LLC/);
    assert.match(output, /WHOIS\s+Different Registrar/);
    assert.match(output, /Registry \/ registrar RDAP publication/);
    assert.match(output, /Registrar RDAP Success/);
    assert.match(output, /\[EQUIVALENT\] Statuses/);
    assert.match(output, /not an availability or ownership decision/);
    assert.match(output, /Registry access \.zz/);
    assert.match(output, /WHOIS access\s+Source-IP authorisation required/);
    assert.match(output, /RDAP access\s+No service published by IANA/);
    assert.match(output, /Registry access describes collection reachability only/);
    assert.doesNotMatch(output, /Restricted\ncollection|x{241}/);
  });

  test('keeps ordinary comparisons free of access-context output', async () => {
    const shared = await comparisonModule();
    const result = compareLookupDocument(
      parseCliLookupDocument(JSON.stringify(lookupDocument())),
      shared.compareRegistrySources,
    );
    assert.equal(Object.hasOwn(result, 'registryAccess'), false);
    assert.doesNotMatch(formatTerminalCompare(buildCliCompareDocument(result)), /Registry access|Access note/);
  });
});

describe('comparison CLI runner', () => {
  test('reads stdin, emits versioned JSON, and does not make a lookup request', async () => {
    const stdout = capture();
    let lookupCalls = 0;
    const code = await runCli(['compare', '--json'], {
      stdout: stdout.stream,
      stderr: capture().stream,
      stdin: Readable.from([JSON.stringify(withRegistryAccess())]),
      runUnifiedLookup: async () => { lookupCalls++; },
      now: () => '2026-07-14T07:00:00.000Z',
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(lookupCalls, 0);
    const document = JSON.parse(stdout.value());
    assert.equal(document.schema, 'whoisleuth.cli.compare');
    assert.equal(document.version, 3);
    assert.equal(document.lookupGeneratedAt, '2026-07-14T06:00:00.000Z');
    assert.equal(document.generatedAt, '2026-07-14T07:00:00.000Z');
    assert.equal(document.registrarPublicationComparison, null);
    assert.equal(document.registryAccess.authority, 'context_only');
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
    let source: string | null | undefined;
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
