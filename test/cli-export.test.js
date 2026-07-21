'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { Readable, Writable } = require('node:stream');

const { parseCliArguments } = require('../cli/arguments.mts');
const { buildCliEvidenceExport, formatCliEvidenceExport } = require('../cli/export-evidence.mts');
const {
  MAX_MARKDOWN_VALUE_LENGTH,
  escapeMarkdownValue,
  formatLookupEvidenceMarkdown,
} = require('../cli/formatters/markdown.mts');
const { formatLookupEvidenceHtml } = require('../cli/formatters/html.mts');
const EXIT_CODES = require('../cli/exit-codes.mts').default;
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
        parsed: {
          domain: 'example.test', handle: 'REGISTRAR-OBJECT',
          registrar: { name: 'EXAMPLE REGISTRAR' },
          lifecycle: { createdDate: '2025-01-01', expiryDate: '2031-01-01' },
          statuses: ['active'], nameservers: ['ns1.example.test'],
          entitiesByRole: { abuse: [{ email: 'private-registrar@example.test' }] },
        },
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
    networkContext: {
      contextVersion: 1, version: 1, status: 'success', observedAt: '2026-07-14T07:59:53.000Z',
      scanMode: 'deep', source: 'ip_rdap', durationMs: 14, complete: true, truncated: false,
      limitations: ['The selected address may represent shared edge infrastructure.'],
      diagnostics: { requestCount: 1, addressSource: 'tls_connection', httpStatus: 200, cidrCount: 1 },
      detail: 'The selected address was mapped to its network registration.',
      endpoint: { address: '93.184.216.34', family: 4, selectedFrom: 'tls_connection' },
      rdap: { endpoint: 'https://network.example.test/ip/93.184.216.34', transportSecurity: 'https', httpStatus: 200, fetchedAt: '2026-07-14T07:59:53.000Z', attempts: [] },
      network: { handle: 'NET-EXAMPLE', name: 'Example edge network', holder: 'Example network holder', cidrs: ['93.184.216.0/24'], startAddress: '93.184.216.0', endAddress: '93.184.216.255', country: 'AU', networkType: 'ALLOCATED', databaseUpdatedAt: '2026-07-13T00:00:00.000Z' },
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

function withRegistryAccess(source = savedLookup(), overrides = {}) {
  source.diagnostics.version = 5;
  source.diagnostics.registryAccess = {
    suffix: 'zz',
    coverageState: 'access_documented',
    whoisAccessProfile: 'source-ip-authorization-required',
    rdapAccessProfile: 'no-iana-service',
    limitation: 'Registry collection requires documented source authorization.',
    authority: 'context_only',
    ...overrides,
  };
  return source;
}

async function evidenceModule() {
  return import('../lib/evidence-export.mts');
}

describe('evidence export CLI arguments', () => {
  test('accepts an optional file, stdin, and compact output', () => {
    assert.deepEqual(parseCliArguments(['export', 'lookup.json']), {
      action: 'export', source: 'lookup.json', format: 'json', compact: false,
    });
    assert.deepEqual(parseCliArguments(['export', '--compact']), {
      action: 'export', source: null, format: 'json', compact: true,
    });
    assert.deepEqual(parseCliArguments(['export', 'lookup.json', '--markdown']), {
      action: 'export', source: 'lookup.json', format: 'markdown', compact: false,
    });
    assert.deepEqual(parseCliArguments(['export', '--html', 'lookup.json']), {
      action: 'export', source: 'lookup.json', format: 'html', compact: false,
    });
  });

  test('rejects multiple files, repeated or conflicting format flags, and unrelated output flags', () => {
    assert.throws(() => parseCliArguments(['export', 'one.json', 'two.json']), /one optional lookup JSON file/);
    assert.throws(() => parseCliArguments(['export', '--compact', '--compact']), /only once/);
    assert.throws(() => parseCliArguments(['export', '--markdown', '--markdown']), /only one evidence export format/);
    assert.throws(() => parseCliArguments(['export', '--markdown', '--html']), /only one evidence export format/);
    assert.throws(() => parseCliArguments(['export', '--markdown', '--compact']), /cannot be combined/);
    assert.throws(() => parseCliArguments(['export', '--html', '--compact']), /cannot be combined/);
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
    assert.equal(result.schemaVersion, 16);
    assert.equal(result.generatedAt, '2026-07-14T09:00:00.000Z');
    assert.equal(result.query.submitted, 'login.example.test');
    assert.equal(result.query.registrableDomain, 'example.test');
    assert.equal(result.sources.rdap.raw.publicContact, 'published@example.test');
    assert.match(result.sources.whois.chain[0].response, /Registrant Email/);
    assert.equal(result.analysis.availability.tls.protocol, 'TLSv1.3');
    assert.equal(result.sources.network.network.name, 'Example edge network');
    assert.equal(result.analysis.idn, null);
    assert.equal(result.analysis.registryComparison.counts.conflict, 0);
    assert.equal(result.analysis.registrarPublicationComparison.counts.conflict, 0);
    assert.ok(result.analysis.registrarPublicationComparison.counts.equivalent > 0);
    assert.equal(JSON.stringify(result).includes('REGISTRAR-OBJECT'), false);
    assert.equal(JSON.stringify(result).includes('private-registrar@example.test'), false);
    assert.equal(JSON.stringify(result).includes('privateNestedValue'), false);
    assert.equal(JSON.stringify(result).includes('ignoredTopLevelValue'), false);
    assert.deepEqual(source, before);
  });

  test('retains bounded registry-access diagnostics already present in the lookup contract', async () => {
    const source = withRegistryAccess();
    const result = buildCliEvidenceExport(JSON.stringify(source), await evidenceModule());
    assert.deepEqual(result.diagnostics.registryAccess, source.diagnostics.registryAccess);
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

  test('rejects malformed registrar publication comparison fields before producing a package', async () => {
    const source = savedLookup();
    source.rdap.registrarRdap.parsed.nameservers = 'ns1.example.test';
    assert.throws(
      () => buildCliEvidenceExport(JSON.stringify(source), { buildLookupEvidence() {} }),
      /rdap\.registrarRdap\.parsed\.nameservers must be an array/
    );
  });

  test('rejects inconsistent registrar publication source states before producing a package', async () => {
    const missingParsed = savedLookup();
    missingParsed.rdap.registrarRdap.parsed = null;
    assert.throws(
      () => buildCliEvidenceExport(JSON.stringify(missingParsed), { buildLookupEvidence() {} }),
      /Successful registrar RDAP input is missing normalized parsed data/
    );

    const unsupportedStatus = savedLookup();
    unsupportedStatus.rdap.registrarRdap.status = 'complete';
    unsupportedStatus.diagnostics.rdap.registrar.status = 'complete';
    assert.throws(
      () => buildCliEvidenceExport(JSON.stringify(unsupportedStatus), { buildLookupEvidence() {} }),
      /rdap\.registrarRdap\.status is unsupported/
    );
  });

  test('rejects an injected builder with the wrong report contract', () => {
    assert.throws(() => buildCliEvidenceExport(JSON.stringify(savedLookup()), {
      LOOKUP_EVIDENCE_SCHEMA: 'whoisleuth.lookup-evidence',
      LOOKUP_EVIDENCE_SCHEMA_VERSION: 16,
      buildLookupEvidence: () => ({ schema: 'other', schemaVersion: 16 }),
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

describe('lookup evidence Markdown rendering', () => {
  test('renders a readable source-attributed summary without raw registry bodies', async () => {
    const result = buildCliEvidenceExport(
      JSON.stringify(savedLookup()),
      await evidenceModule(),
      '2026-07-14T09:00:00.000Z'
    );
    const markdown = formatLookupEvidenceMarkdown(result);
    assert.match(markdown, /^# Lookup evidence report/);
    assert.match(markdown, /## Assessment/);
    assert.match(markdown, /### Registry RDAP/);
    assert.match(markdown, /### WHOIS/);
    assert.match(markdown, /## Registry-source comparison/);
    assert.match(markdown, /## Registry \/ registrar RDAP comparison/);
    assert.match(markdown, /Registry RDAP/);
    assert.match(markdown, /registrar RDAP/);
    assert.match(markdown, /## Network evidence/);
    assert.match(markdown, /### Observed network registration/);
    assert.match(markdown, /Example edge network/);
    assert.match(markdown, /edge or shared network rather than the origin host/);
    assert.match(markdown, /Raw registry payloads and full WHOIS referral responses are available only in the JSON evidence package/);
    assert.doesNotMatch(markdown, /publicContact|privateNestedValue|private-registrar/);
    assert.doesNotMatch(markdown, /Registrant Email/);
    assert.doesNotMatch(markdown, /Registry access suffix/);
    assert.equal(markdown.endsWith('\n'), true);
  });

  test('renders bounded context-only registry access diagnostics', async () => {
    const source = withRegistryAccess(savedLookup(), {
      limitation: `Restricted <script>alert(1)</script> [details](https://malicious.invalid) ${'x'.repeat(500)}`,
    });
    const result = buildCliEvidenceExport(JSON.stringify(source), await evidenceModule());
    const markdown = formatLookupEvidenceMarkdown(result);

    assert.match(markdown, /Registry access suffix/);
    assert.match(markdown, /WHOIS access:\*\* Source\\-IP authorization required/);
    assert.match(markdown, /RDAP access:\*\* No service published by IANA/);
    assert.match(markdown, /Registry access constraints describe collection reachability only/);
    assert.doesNotMatch(markdown, /<script>|\]\(https:\/\//i);
    assert.doesNotMatch(markdown, /x{301}/);
  });

  test('escapes untrusted Markdown, HTML, bare-link, and email syntax', () => {
    const hostile = '# [click](https://malicious.invalid) <SCRIPT>alert(1)</SCRIPT> user@example.invalid\u202e';
    const escaped = escapeMarkdownValue(hostile);
    assert.doesNotMatch(escaped, /^#/);
    assert.doesNotMatch(escaped, /\]\(https:\/\//);
    assert.doesNotMatch(escaped, /<script>/i);
    assert.doesNotMatch(escaped, /user@example/);
    assert.doesNotMatch(escaped, /\u202e/);
    assert.match(escaped, /\\#/);
    assert.match(escaped, /&lt;SCRIPT&gt;/);
    assert.match(escaped, /https\\:\/\//);
    assert.match(escaped, /user\\@example/);
  });

  test('bounds displayed values and lists while disclosing omissions', async () => {
    const result = buildCliEvidenceExport(JSON.stringify(savedLookup()), await evidenceModule());
    result.query.submitted = 'x'.repeat(MAX_MARKDOWN_VALUE_LENGTH + 100);
    result.sources.rdap.parsed.nameservers = Array.from({ length: 51 }, (_, index) => `ns${index}.example.test`);
    const markdown = formatLookupEvidenceMarkdown(result);
    assert.doesNotMatch(markdown, new RegExp(`x{${MAX_MARKDOWN_VALUE_LENGTH + 1}}`));
    assert.match(markdown, /and \d+ more/);
    assert.doesNotMatch(markdown, /ns50\\\.example\\\.test/);
  });

  test('uses diagnostics for an explicitly skipped source instead of calling it unknown', async () => {
    const source = savedLookup();
    source.mode = 'fast';
    source.whois = { skipped: true, detail: 'WHOIS is omitted in fast mode.' };
    source.diagnostics.whois = { status: 'skipped' };
    const result = buildCliEvidenceExport(JSON.stringify(source), await evidenceModule());
    const markdown = formatLookupEvidenceMarkdown(result);
    assert.match(markdown, /### WHOIS[\s\S]*\*\*Source status:\*\* Skipped/);
  });
});

describe('lookup evidence HTML rendering', () => {
  test('renders a self-contained semantic and printable report without active content', async () => {
    const result = buildCliEvidenceExport(
      JSON.stringify(savedLookup()),
      await evidenceModule(),
      '2026-07-14T09:00:00.000Z'
    );
    const html = formatLookupEvidenceHtml(result);
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<meta http-equiv="Content-Security-Policy"/);
    assert.match(html, /default-src 'none'/);
    assert.match(html, /<style>[\s\S]*@media print/);
    assert.match(html, /<main>[\s\S]*<h2>Registry sources<\/h2>/);
    assert.match(html, /<table>[\s\S]*Normalized registry publication comparison/);
    assert.match(html, /Normalized registry and registrar RDAP publication comparison/);
    assert.match(html, /Observed network registration/);
    assert.match(html, /Example edge network/);
    assert.match(html, /edge or shared network rather than the origin host/);
    assert.doesNotMatch(html, /<script\b/i);
    assert.doesNotMatch(html, /<a\b/i);
    assert.doesNotMatch(html, /publicContact|Registrant Email|privateNestedValue|private-registrar/);
    assert.doesNotMatch(html, /Registry access suffix/);
    assert.equal(html.endsWith('\n'), true);
  });

  test('renders registry access context as escaped static HTML diagnostics', async () => {
    const source = withRegistryAccess(savedLookup(), {
      limitation: 'Restricted <script>alert(1)</script> collection context.',
    });
    const result = buildCliEvidenceExport(JSON.stringify(source), await evidenceModule());
    const html = formatLookupEvidenceHtml(result);

    assert.match(html, /Registry access suffix/);
    assert.match(html, /Source-IP authorization required/);
    assert.match(html, /No service published by IANA/);
    assert.match(html, /Restricted &lt;script&gt;alert\(1\)&lt;\/script&gt; collection context\./);
    assert.doesNotMatch(html, /<script>alert/);
  });

  test('escapes hostile source values rather than creating HTML elements or attributes', async () => {
    const result = buildCliEvidenceExport(JSON.stringify(savedLookup()), await evidenceModule());
    result.query.submitted = '\"><script>alert(1)</script><img src=x onerror=alert(2)>';
    result.sources.rdap.parsed.registrar = { name: '<form action=https://malicious.invalid>Submit</form>' };
    const html = formatLookupEvidenceHtml(result);
    assert.doesNotMatch(html, /<script\b|<img\b|<form\b/i);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /&lt;form action=/);
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

  test('writes the readable Markdown format to stdout without raw source bodies', async () => {
    const stdout = capture();
    let lookupCalls = 0;
    const code = await runCli(['export', '--markdown'], {
      stdout: stdout.stream,
      stderr: capture().stream,
      readExportInput: async () => JSON.stringify(savedLookup()),
      runUnifiedLookup: async () => { lookupCalls++; },
      loadEvidenceExport: evidenceModule,
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(lookupCalls, 0);
    assert.match(stdout.value(), /^# Lookup evidence report/);
    assert.doesNotMatch(stdout.value(), /published@example/);
  });

  test('writes the self-contained HTML format to stdout without making a lookup', async () => {
    const stdout = capture();
    let lookupCalls = 0;
    const code = await runCli(['export', '--html'], {
      stdout: stdout.stream,
      stderr: capture().stream,
      readExportInput: async () => JSON.stringify(savedLookup()),
      runUnifiedLookup: async () => { lookupCalls++; },
      loadEvidenceExport: evidenceModule,
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(lookupCalls, 0);
    assert.match(stdout.value(), /^<!doctype html>/);
    assert.doesNotMatch(stdout.value(), /published@example/);
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
