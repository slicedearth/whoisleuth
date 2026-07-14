'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { Readable, Writable } = require('node:stream');

const { parseCliArguments } = require('../cli/arguments');
const { buildCliEvidenceExport, formatCliEvidenceExport } = require('../cli/export-evidence');
const EXIT_CODES = require('../cli/exit-codes');
const { runCli } = require('../cli/runner');

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

function savedLookup(overrides = {}) {
  return {
    schema: 'whoisleuth.cli.lookup',
    version: 1,
    generatedAt: '2026-07-14T08:00:00.000Z',
    mode: 'deep',
    query: 'login.example.test',
    type: 'domain',
    inputHostname: 'login.example.test',
    registrableDomain: 'example.test',
    isSubdomain: true,
    rdap: {
      rdapServer: 'https://rdap.example.test/domain/example.test',
      transportSecurity: 'https',
      upstreamStatus: 200,
      fetchedAt: '2026-07-14T07:59:50.000Z',
      attempts: [{ endpoint: 'https://rdap.example.test/domain/example.test', outcome: 'success', selected: true }],
      parsed: {
        domain: 'EXAMPLE.TEST',
        handle: 'TEST-1',
        registrar: { name: 'Example Registrar' },
        lifecycle: { createdDate: '2025-01-01T00:00:00Z', createdDateIso: '2025-01-01T00:00:00.000Z' },
        statuses: ['active'],
        nameservers: ['NS1.EXAMPLE.TEST'],
      },
      data: { objectClassName: 'domain', ldhName: 'EXAMPLE.TEST', publicContact: 'published@example.test' },
      registrarRdap: {
        status: 'success',
        endpoint: 'https://registrar.example.test/domain/example.test',
        data: { privateNestedValue: 'must not enter the established evidence schema' },
      },
    },
    whois: {
      parsed: {
        domainName: 'EXAMPLE.TEST',
        registryDomainId: 'TEST 1',
        registrar: 'Example Registrar',
        createdDate: '2025-01-01',
        createdDateIso: '2025-01-01T00:00:00.000Z',
        statuses: ['active'],
        nameservers: ['ns1.example.test'],
        chainStatus: 'complete',
        authoritativeHop: 'whois.registry.example.test',
      },
      chain: [{
        server: 'whois.registry.example.test',
        queriedAt: '2026-07-14T07:59:51.000Z',
        response: 'Domain Name: EXAMPLE.TEST\nRegistrant Email: published@example.test',
      }],
    },
    availability: {
      applicable: true,
      domain: 'example.test',
      state: 'registered',
      confidence: 'high',
      hasMx: true,
      tls: { version: 1, status: 'success', protocol: 'TLSv1.3' },
    },
    diagnostics: {
      version: 4,
      rdap: {
        status: 'success',
        endpoint: 'https://rdap.example.test/domain/example.test',
        registrar: { status: 'success', endpoint: 'https://registrar.example.test/domain/example.test' },
      },
      whois: { status: 'complete', authoritativeHop: 'whois.registry.example.test' },
      availability: { status: 'complete', resultState: 'registered' },
    },
    ignoredTopLevelValue: 'must not enter the evidence package',
    ...overrides,
  };
}

async function evidenceModule() {
  return import('../lib/evidence-export.mjs');
}

describe('evidence export CLI arguments', () => {
  test('accepts an optional file, stdin, and compact output', () => {
    assert.deepEqual(parseCliArguments(['export', 'lookup.json']), {
      action: 'export', source: 'lookup.json', compact: false,
    });
    assert.deepEqual(parseCliArguments(['export', '--compact']), {
      action: 'export', source: null, compact: true,
    });
  });

  test('rejects multiple files, repeated compact flags, and unrelated output flags', () => {
    assert.throws(() => parseCliArguments(['export', 'one.json', 'two.json']), /one optional lookup JSON file/);
    assert.throws(() => parseCliArguments(['export', '--compact', '--compact']), /only once/);
    assert.throws(() => parseCliArguments(['export', '--json']), /Unknown option/);
    assert.throws(() => parseCliArguments(['export', '--quiet']), /Unknown option/);
  });
});

describe('lookup evidence export conversion', () => {
  test('shares the exact evidence builder with the frontend compatibility module', async () => {
    const shared = await evidenceModule();
    const frontend = await import('../frontend/src/lib/analysis/evidence-export.js');
    assert.equal(frontend.buildLookupEvidence, shared.buildLookupEvidence);
    assert.equal(frontend.LOOKUP_EVIDENCE_SCHEMA_VERSION, shared.LOOKUP_EVIDENCE_SCHEMA_VERSION);
  });

  test('converts a saved lookup to the established rich evidence contract', async () => {
    const source = savedLookup();
    const before = structuredClone(source);
    const result = buildCliEvidenceExport(
      JSON.stringify(source),
      await evidenceModule(),
      '2026-07-14T09:00:00.000Z'
    );
    assert.equal(result.schema, 'whoisleuth.lookup-evidence');
    assert.equal(result.schemaVersion, 11);
    assert.equal(result.generatedAt, '2026-07-14T09:00:00.000Z');
    assert.equal(result.query.submitted, 'login.example.test');
    assert.equal(result.query.registrableDomain, 'example.test');
    assert.equal(result.sources.rdap.raw.publicContact, 'published@example.test');
    assert.match(result.sources.whois.chain[0].response, /Registrant Email/);
    assert.equal(result.analysis.availability.tls.protocol, 'TLSv1.3');
    assert.equal(result.analysis.idn, null);
    assert.equal(result.analysis.registryComparison.counts.conflict, 0);
    assert.equal(JSON.stringify(result).includes('privateNestedValue'), false);
    assert.equal(JSON.stringify(result).includes('ignoredTopLevelValue'), false);
    assert.deepEqual(source, before);
  });

  test('preserves partial source states in analysis instead of inventing conflicts', async () => {
    const source = savedLookup();
    source.whois.parsed.chainStatus = 'partial';
    source.whois.parsed.registrar = null;
    source.diagnostics.whois.status = 'partial';
    const result = buildCliEvidenceExport(JSON.stringify(source), await evidenceModule());
    const registrar = result.analysis.registryComparison.fields.find((item) => item.label === 'Registrar');
    assert.equal(registrar.status, 'whois_incomplete');
    assert.equal(result.analysis.registryComparison.counts.conflict, 0);
  });

  test('rejects malformed comparison fields before producing a package', async () => {
    const source = savedLookup();
    source.rdap.parsed.nameservers = 'ns1.example.test';
    assert.throws(
      () => buildCliEvidenceExport(JSON.stringify(source), { buildLookupEvidence() {} }),
      /must be an array/
    );
  });

  test('rejects an injected builder with the wrong report contract', () => {
    assert.throws(() => buildCliEvidenceExport(JSON.stringify(savedLookup()), {
      LOOKUP_EVIDENCE_SCHEMA: 'whoisleuth.lookup-evidence',
      LOOKUP_EVIDENCE_SCHEMA_VERSION: 11,
      buildLookupEvidence: () => ({ schema: 'other', schemaVersion: 11 }),
    }), /unsupported report contract/);
  });

  test('formats pretty and compact JSON with one terminating newline', async () => {
    const result = buildCliEvidenceExport(JSON.stringify(savedLookup()), await evidenceModule());
    const pretty = formatCliEvidenceExport(result);
    const compact = formatCliEvidenceExport(result, true);
    assert.match(pretty, /^\{\n  "schema"/);
    assert.equal(pretty.endsWith('\n'), true);
    assert.equal(compact.split('\n').length, 2);
    assert.deepEqual(JSON.parse(compact), result);
  });
});

describe('evidence export CLI runner', () => {
  test('reads stdin through the default builder without making a lookup request', async () => {
    const stdout = capture();
    let lookupCalls = 0;
    const code = await runCli(['export', '--compact'], {
      stdout: stdout.stream,
      stderr: capture().stream,
      stdin: Readable.from([JSON.stringify(savedLookup())]),
      runUnifiedLookup: async () => { lookupCalls++; },
      now: () => '2026-07-14T09:00:00.000Z',
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(lookupCalls, 0);
    const result = JSON.parse(stdout.value());
    assert.equal(result.schema, 'whoisleuth.lookup-evidence');
    assert.equal(result.generatedAt, '2026-07-14T09:00:00.000Z');
  });

  test('reads an optional file through the default bounded reader', async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'whoisleuth-export-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const filename = join(directory, 'lookup.json');
    await writeFile(filename, JSON.stringify(savedLookup()), 'utf8');
    const stdout = capture();
    const code = await runCli(['export', filename], {
      stdout: stdout.stream,
      stderr: capture().stream,
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(JSON.parse(stdout.value()).schema, 'whoisleuth.lookup-evidence');
  });

  test('passes an optional filename to an injected input reader', async () => {
    let received;
    const code = await runCli(['export', 'saved.json'], {
      stdout: capture().stream,
      stderr: capture().stream,
      readExportInput: async (source) => { received = source; return JSON.stringify(savedLookup()); },
      loadEvidenceExport: evidenceModule,
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(received, 'saved.json');
  });

  test('missing, invalid, and unreadable input return bounded usage errors', async () => {
    for (const readExportInput of [
      async () => '',
      async () => '{',
      async () => { throw new Error(`cannot read\n${'x'.repeat(500)}`); },
    ]) {
      const stderr = capture();
      const code = await runCli(['export'], {
        stdout: capture().stream,
        stderr: stderr.stream,
        readExportInput,
      });
      assert.equal(code, EXIT_CODES.USAGE);
      assert.match(stderr.value(), /^Usage error:/);
      assert.ok(stderr.value().length < 360);
    }
  });

  test('evidence module failures are bounded operational errors', async () => {
    const stderr = capture();
    const code = await runCli(['export'], {
      stdout: capture().stream,
      stderr: stderr.stream,
      readExportInput: async () => JSON.stringify(savedLookup()),
      loadEvidenceExport: async () => { throw new Error(`module failed\n${'x'.repeat(500)}`); },
    });
    assert.equal(code, EXIT_CODES.LOOKUP_FAILED);
    assert.match(stderr.value(), /^Evidence export failed: module failed /);
    assert.ok(stderr.value().length < 360);
  });
});
