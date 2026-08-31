import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';

import { parseCliArguments } from '../cli/arguments.mts';
import { verifyOfflineArtifact } from '../cli/artifact-verify.mts';
import { APPLICATION_VERSION, buildCliEvidenceExport, formatCliEvidenceExport } from '../cli/export-evidence.mts';
import {
  MAX_MARKDOWN_VALUE_LENGTH,
  escapeMarkdownValue,
  formatLookupEvidenceMarkdown,
} from '../cli/formatters/markdown.mts';
import { formatLookupEvidenceHtml } from '../cli/formatters/html.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { runCli } from '../cli/runner.mts';
import { MAX_BOUNDED_JSON_DEPTH } from '../lib/bounded-json.mts';
import { arrayValue, recordValue } from './value-assertions.mts';
import { httpDeliveryMetadataFixture, pagePublicationMetadataFixture } from './homepage-metadata-fixtures.mts';

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
      credentialSurfaceProfile: {
        credentialSurfaceVersion: 1, version: 1, status: 'success', observedAt: '2026-07-14T07:59:53.000Z',
        scanMode: 'deep', source: 'html', complete: true, truncated: false,
        limitations: ['Fixed semantic categories and counts only.'],
        diagnostics: { formsObserved: 1, inputsObserved: 2, classifiedInputs: 2, unclassifiedActions: 0 },
        forms: {
          count: 1,
          methods: { missing: 0, get: 0, post: 1, dialog: 0, other: 0 },
          actions: { sameOrigin: 1, external: 0, missing: 0, cleartext: 0, unclassified: 0 },
        },
        inputs: {
          count: 2,
          classifiedCount: 2,
          categories: { password: 1, email: 0, username: 1, one_time_code: 0, payment: 0 },
        },
      },
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

function withRegistryAccess(
  source = savedLookup(),
  overrides: Record<string, unknown> = {},
) {
  source.diagnostics.version = 5;
  recordValue(source.diagnostics).registryAccess = {
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
      action: 'export', source: 'lookup.json', format: 'json', compact: false, includeAttribution: true,
    });
    assert.deepEqual(parseCliArguments(['export', '--compact']), {
      action: 'export', source: null, format: 'json', compact: true, includeAttribution: true,
    });
    assert.deepEqual(parseCliArguments(['export', 'lookup.json', '--markdown']), {
      action: 'export', source: 'lookup.json', format: 'markdown', compact: false, includeAttribution: true,
    });
    assert.deepEqual(parseCliArguments(['export', '--html', 'lookup.json']), {
      action: 'export', source: 'lookup.json', format: 'html', compact: false, includeAttribution: true,
    });
    assert.deepEqual(parseCliArguments(['export', '--markdown', '--no-attribution']), {
      action: 'export', source: null, format: 'markdown', compact: false, includeAttribution: false,
    });
  });

  test('rejects multiple files, repeated or conflicting format flags, and unrelated output flags', () => {
    assert.throws(() => parseCliArguments(['export', 'one.json', 'two.json']), /one optional lookup JSON file/);
    assert.throws(() => parseCliArguments(['export', '--compact', '--compact']), /only once/);
    assert.throws(() => parseCliArguments(['export', '--markdown', '--markdown']), /only one evidence export format/);
    assert.throws(() => parseCliArguments(['export', '--markdown', '--html']), /only one evidence export format/);
    assert.throws(() => parseCliArguments(['export', '--markdown', '--compact']), /cannot be combined/);
    assert.throws(() => parseCliArguments(['export', '--html', '--compact']), /cannot be combined/);
    assert.throws(() => parseCliArguments(['export', '--no-attribution']), /only to Markdown or HTML/);
    assert.throws(() => parseCliArguments(['export', '--markdown', '--no-attribution', '--no-attribution']), /only once/);
    assert.throws(() => parseCliArguments(['export', '--json']), /Unknown option/);
    assert.throws(() => parseCliArguments(['export', '--quiet']), /Unknown option/);
  });
});

describe('lookup evidence export conversion', () => {
  test('shares the exact evidence builder with the frontend compatibility module', async () => {
    const shared = await evidenceModule();
    const frontend = await import('../frontend/src/lib/analysis/evidence-export.ts');
    assert.equal(frontend.buildLookupEvidence, shared.buildLookupEvidence);
    assert.equal(frontend.LOOKUP_EVIDENCE_SCHEMA_VERSION, shared.LOOKUP_EVIDENCE_SCHEMA_VERSION);
  });

  test('converts a saved lookup to the established rich evidence contract', async () => {
    const shared = await evidenceModule();
    const source = savedLookup();
    const before = structuredClone(source);
    const result = buildCliEvidenceExport(
      JSON.stringify(source),
      shared,
      '2026-07-14T09:00:00.000Z'
    );
    assert.equal(result.schema, 'whoisleuth.lookup-evidence');
    assert.equal(result.schemaVersion, shared.LOOKUP_EVIDENCE_SCHEMA_VERSION);
    assert.equal(result.generatedAt, '2026-07-14T09:00:00.000Z');
    assert.deepEqual(result.application, {
      name: 'WHOISleuth',
      version: APPLICATION_VERSION,
      projectUrl: 'https://github.com/slicedearth/whoisleuth',
    });
    const query = recordValue(result.query);
    const sources = recordValue(result.sources);
    const analysis = recordValue(result.analysis);
    const rdap = recordValue(sources.rdap);
    const whois = recordValue(sources.whois);
    const network = recordValue(sources.network);
    const availability = recordValue(analysis.availability);
    const credentialSurface = recordValue(availability.credentialSurfaceProfile);
    const registryComparison = recordValue(analysis.registryComparison);
    const registrarComparison = recordValue(analysis.registrarPublicationComparison);
    assert.equal(query.submitted, 'login.example.test');
    assert.equal(query.registrableDomain, 'example.test');
    assert.equal(Object.hasOwn(rdap, 'raw'), false);
    assert.equal(recordValue(rdap.parsed).contactsExcluded, true);
    assert.equal(recordValue(whois.parsed).contactsExcluded, true);
    assert.equal(JSON.stringify(result).includes('published@example.test'), false);
    const whoisHop = recordValue(arrayValue(whois.chain)[0]);
    assert.equal(whoisHop.status, 'success');
    assert.equal(Object.hasOwn(whoisHop, 'response'), false);
    assert.equal(recordValue(availability.tls).protocol, 'TLSv1.3');
    assert.equal(recordValue(recordValue(credentialSurface.inputs).categories).username, 1);
    assert.equal(recordValue(network.network).name, 'Example edge network');
    assert.equal(analysis.idn, null);
    assert.equal(recordValue(registryComparison.counts).conflict, 0);
    assert.equal(recordValue(registrarComparison.counts).conflict, 0);
    assert.ok(Number(recordValue(registrarComparison.counts).equivalent) > 0);
    assert.equal(JSON.stringify(result).includes('REGISTRAR-OBJECT'), false);
    assert.equal(JSON.stringify(result).includes('private-registrar@example.test'), false);
    assert.equal(JSON.stringify(result).includes('privateNestedValue'), false);
    assert.equal(JSON.stringify(result).includes('ignoredTopLevelValue'), false);
    assert.deepEqual(source, before);
  });

  test('drops nested contact aliases and query-bearing generic values from saved lookup exports', async () => {
    const source = savedLookup();
    recordValue(source.availability).structuredDataIdentity = {
      structuredDataVersion: 1,
      version: 1,
      status: 'success',
      entities: [{
        types: ['Organization'],
        name: 'Example publisher',
        email: 'nested-private@example.test',
        owner: 'Private owner',
        value: 'https://example.test/path?session=private#fragment',
        url: 'https://example.test/path?session=private#fragment',
      }],
    };
    const exported = buildCliEvidenceExport(JSON.stringify(source), await evidenceModule());
    const availability = recordValue(recordValue(exported.analysis).availability);
    const entity = recordValue(arrayValue(recordValue(availability.structuredDataIdentity).entities)[0]);

    assert.deepEqual(entity, {
      types: ['Organization'],
      name: 'Example publisher',
      url: 'https://example.test/path',
    });
    assert.equal(availability.registryContactsExcluded, true);
    assert.doesNotMatch(JSON.stringify(exported), /nested-private|Private owner|session=private/iu);
  });

  test('sanitizes whitespace- and control-prefixed URL-shaped values from saved lookup exports', async () => {
    const shared = await evidenceModule();
    for (const prefix of [' ', '\u0001', '\u0085']) {
      const source = savedLookup();
      recordValue(source.availability).structuredDataIdentity = {
        structuredDataVersion: 1,
        version: 1,
        status: 'success',
        entities: [{
          types: ['Organization'],
          name: `${prefix}https://evidence.example.test/path?trace=private#fragment`,
        }],
      };
      const exported = buildCliEvidenceExport(JSON.stringify(source), shared);
      const availability = recordValue(recordValue(exported.analysis).availability);
      const entity = recordValue(arrayValue(recordValue(availability.structuredDataIdentity).entities)[0]);
      assert.equal(entity.name, null);
      assert.doesNotMatch(JSON.stringify(exported), /trace=private|fragment|[\u0001\u0085]/iu);
    }
  });

  test('retains producer-valid RDAP redactions without false completeness', async () => {
    const source = savedLookup();
    const parsed = recordValue(source.rdap.parsed);
    parsed.redactions = Array.from({ length: 51 }, (_, index) => ({
      name: `Field ${index}`,
      reason: null,
      method: 'removal',
      pathLanguage: 'jsonpath',
      prePath: `$.entities[${index}]`,
      postPath: null,
      replacementPath: null,
    }));
    parsed.redactionsTruncated = false;
    const exported = buildCliEvidenceExport(JSON.stringify(source), await evidenceModule());
    const rdap = recordValue(recordValue(exported.sources).rdap);
    const publication = recordValue(rdap.parsed);
    assert.equal(arrayValue(publication.redactions).length, 51);
    assert.equal(publication.redactionsTruncated, false);
    const verification = await verifyOfflineArtifact(JSON.stringify(exported));
    assert.equal(verification.state, 'structure_valid');
  });

  test('converts current saved Lookup metadata while keeping version 1 readable', async () => {
    const shared = await evidenceModule();
    const legacy = savedLookup();
    const current = structuredClone(legacy);
    current.version = 2;
    const availability = recordValue(current.availability);
    availability.pageIdentity = { status: 'success', publicationMetadata: pagePublicationMetadataFixture() };
    availability.http = { status: 'success', response: { deliveryMetadata: httpDeliveryMetadataFixture() } };

    const legacyExport = buildCliEvidenceExport(JSON.stringify(legacy), shared, '2026-07-14T09:00:00.000Z');
    const currentExport = buildCliEvidenceExport(JSON.stringify(current), shared, '2026-07-14T09:00:00.000Z');
    assert.equal(legacyExport.schemaVersion, shared.LOOKUP_EVIDENCE_SCHEMA_VERSION);
    assert.equal(currentExport.schemaVersion, shared.LOOKUP_EVIDENCE_SCHEMA_VERSION);
    assert.equal(recordValue(recordValue(currentExport.analysis).availability).pageIdentity !== null, true);
    assert.deepEqual(
      recordValue(recordValue(recordValue(currentExport.analysis).availability).pageIdentity).publicationMetadata,
      pagePublicationMetadataFixture(),
    );
    assert.deepEqual(
      recordValue(recordValue(recordValue(recordValue(currentExport.analysis).availability).http).response).deliveryMetadata,
      httpDeliveryMetadataFixture(),
    );
  });

  test('retains bounded registry-access diagnostics already present in the lookup contract', async () => {
    const source = withRegistryAccess();
    const result = buildCliEvidenceExport(JSON.stringify(source), await evidenceModule());
    assert.deepEqual(
      recordValue(result.diagnostics).registryAccess,
      recordValue(source.diagnostics).registryAccess,
    );
  });

  test('preserves partial source states in analysis instead of inventing conflicts', async () => {
    const source = savedLookup();
    source.whois.parsed.chainStatus = 'partial';
    recordValue(source.whois.parsed).registrar = null;
    source.diagnostics.whois.status = 'partial';
    const result = buildCliEvidenceExport(JSON.stringify(source), await evidenceModule());
    const analysis = recordValue(result.analysis);
    const comparison = recordValue(analysis.registryComparison);
    const registrar = arrayValue(comparison.fields)
      .map(recordValue)
      .find((item) => item.label === 'Registrar');
    assert.equal(registrar?.status, 'whois_incomplete');
    assert.equal(recordValue(comparison.counts).conflict, 0);
  });

  test('keeps unavailable registry source states explicit and bounds copied source detail', async () => {
    const unavailable = savedLookup();
    delete recordValue(unavailable).rdap;
    delete recordValue(unavailable).whois;
    recordValue(unavailable.diagnostics).rdap = { status: 'unsupported' };
    recordValue(unavailable.diagnostics).whois = { status: 'skipped' };
    const projected = buildCliEvidenceExport(JSON.stringify(unavailable), await evidenceModule());
    assert.equal(recordValue(recordValue(projected.sources).rdap).status, 'unsupported');
    assert.equal(recordValue(recordValue(projected.sources).whois).status, 'skipped');
    assert.equal(recordValue(recordValue(projected.sources).rdap).parsed, null);
    assert.equal(recordValue(recordValue(projected.sources).whois).parsed, null);

    const failed = savedLookup();
    recordValue(failed.diagnostics).rdap = { status: 'error' };
    recordValue(failed).rdap = {
      error: `upstream\n${'x'.repeat(10_100)}`,
      attempts: Array.from({ length: 17 }, (_, index) => ({ outcome: 'error', index })),
    };
    const boundedFailure = buildCliEvidenceExport(JSON.stringify(failed), await evidenceModule());
    const rdap = recordValue(recordValue(boundedFailure.sources).rdap);
    assert.equal(String(rdap.error).length, 10_000);
    assert.equal(String(rdap.error).includes('\n'), false);
    assert.equal(arrayValue(rdap.attempts).length, 16);

    const longChain = savedLookup();
    longChain.whois.chain = Array.from({ length: 17 }, (_, index) => ({
      server: `whois-${index}.example.test`,
      queriedAt: '2026-07-14T07:59:51.000Z',
      response: 'Domain Name: EXAMPLE.TEST',
    }));
    const boundedChain = buildCliEvidenceExport(JSON.stringify(longChain), await evidenceModule());
    assert.equal(arrayValue(recordValue(recordValue(boundedChain.sources).whois).chain).length, 16);
  });

  test('rejects an export that cannot fit the shared browser-import profile', async () => {
    const source = savedLookup();
    recordValue(source.availability).limitations = Array.from(
      { length: 6 },
      (_, index) => `${index}${'x'.repeat(1_000_000)}`,
    );
    const module = await evidenceModule();
    assert.throws(
      () => buildCliEvidenceExport(JSON.stringify(source), module),
      /5 MiB portable file limit/iu,
    );
  });

  test('rejects over-nested saved Lookup JSON before the unrestricted parser or evidence builder runs', () => {
    const source = savedLookup();
    let nested: unknown = 'leaf';
    for (let index = 0; index <= MAX_BOUNDED_JSON_DEPTH; index += 1) nested = { value: nested };
    recordValue(source.rdap).data = nested;
    assert.throws(
      () => buildCliEvidenceExport(JSON.stringify(source), { buildLookupEvidence() {} }),
      /Evidence export input exceeds the 48-level nesting limit/u,
    );
  });

  test('rejects duplicate saved Lookup object keys before JSON parsing can collapse them', () => {
    const raw = JSON.stringify(savedLookup()).replace(
      '"mode":"deep"',
      '"mode":"deep","mode":"fast"',
    );
    assert.throws(
      () => buildCliEvidenceExport(raw, { buildLookupEvidence() {} }),
      /Evidence export input contains a duplicate object key/u,
    );
  });

  test('rejects prototype-sensitive saved Lookup keys before evidence derivation', () => {
    const raw = JSON.stringify(savedLookup()).replace(
      '"handle":"TEST-1"',
      '"__proto__":{"domain":"forged.example.test"},"handle":"TEST-1"',
    );
    assert.throws(
      () => buildCliEvidenceExport(raw, { buildLookupEvidence() {} }),
      /Evidence export input contains an unsafe object key/u,
    );
  });

  test('rejects a saved query that does not identify its declared registrable domain', async () => {
    const source = savedLookup();
    source.query = 'other.test';
    const module = await evidenceModule();
    assert.throws(
      () => buildCliEvidenceExport(JSON.stringify(source), module),
      /query must identify the declared registrable domain/iu,
    );
  });

  test('rejects malformed comparison fields before producing a package', async () => {
    const source = savedLookup();
    recordValue(source.rdap.parsed).nameservers = 'ns1.example.test';
    assert.throws(
      () => buildCliEvidenceExport(JSON.stringify(source), { buildLookupEvidence() {} }),
      /must be an array/
    );
  });

  test('rejects malformed registrar publication comparison fields before producing a package', async () => {
    const source = savedLookup();
    recordValue(source.rdap.registrarRdap.parsed).nameservers = 'ns1.example.test';
    assert.throws(
      () => buildCliEvidenceExport(JSON.stringify(source), { buildLookupEvidence() {} }),
      /rdap\.registrarRdap\.parsed\.nameservers must be an array/
    );
  });

  test('rejects inconsistent registrar publication source states before producing a package', async () => {
    const missingParsed = savedLookup();
    recordValue(missingParsed.rdap.registrarRdap).parsed = null;
    assert.throws(
      () => buildCliEvidenceExport(JSON.stringify(missingParsed), { buildLookupEvidence() {} }),
      /Successful registrar RDAP input is missing normalised parsed data/
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
    assert.match(markdown, /## Registry interpretation/);
    assert.match(markdown, /Registry RDAP disclosure/);
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
    assert.match(markdown, /WHOIS access:\*\* Source\\-IP authorisation required/);
    assert.match(markdown, /RDAP access:\*\* No service published by IANA/);
    assert.match(markdown, /Registry access constraints describe collection reachability only/);
    assert.doesNotMatch(markdown, /<script>|\]\(https:\/\//i);
    assert.doesNotMatch(markdown, /x{301}/);
  });

  test('uses the same role-aware technology and nameserver semantics as interactive projections', async () => {
    const source = savedLookup();
    const availability = recordValue(source.availability);
    availability.nameservers = ['ns1.example.test'];
    availability.technologyProfile = {
      profileVersion: 11,
      version: 1,
      status: 'partial',
      observedAt: '2026-08-31T00:00:00.000Z',
      scanMode: 'deep',
      source: 'derived',
      durationMs: null,
      complete: false,
      truncated: false,
      limitations: ['A generic indicator remains incomplete.'],
      diagnostics: {
        findings: 3,
        htmlEvaluated: false,
        generatorEvaluated: false,
        serverEvaluated: true,
        resourceOriginsEvaluated: 0,
      },
      findings: [
        { id: 'fixture-edge', name: 'Fixture Edge', category: 'delivery platform', confidence: 'medium', roles: ['observed_edge'], evidence: [{ source: 'HTTP server header', role: 'observed_edge', description: 'A retained header indicates fixture edge delivery.' }] },
        { id: 'fixture-platform', name: 'Fixture Platform', category: 'content management', confidence: 'medium', roles: ['application_platform'], evidence: [{ source: 'passive response header', role: 'application_platform', description: 'A retained header indicates the fixture platform.' }] },
        { id: 'fixture-runtime', name: 'Fixture Runtime', category: 'application runtime', confidence: 'medium', roles: ['framework_runtime'], evidence: [{ source: 'passive response header', role: 'framework_runtime', description: 'A generic retained header indicates the fixture runtime.' }] },
      ],
      browserLibraryProfile: null,
    };

    const result = buildCliEvidenceExport(JSON.stringify(source), await evidenceModule());
    const markdown = formatLookupEvidenceMarkdown(result);

    assert.match(markdown, /Authoritative nameserver evidence:\*\* ns1\\\.example\\\.test/u);
    assert.match(markdown, /Observed edge, CDN, reverse proxy or WAF:\*\* Fixture Edge/u);
    assert.match(markdown, /Application-platform indicators:\*\* Fixture Platform/u);
    assert.match(markdown, /Framework or runtime indicators:\*\* Fixture Runtime/u);
    assert.match(markdown, /Embedded or third-party dependencies:\*\* Not reported/u);
    assert.match(markdown, /Origin host:\*\* Not established from retained evidence/u);
    assert.match(markdown, /Nameserver identity does not establish operator or web-host ownership/u);
    assert.match(markdown, /Edge and application-platform indicators do not establish concealed origin infrastructure/u);
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
    recordValue(result.query).submitted = 'x'.repeat(MAX_MARKDOWN_VALUE_LENGTH + 100);
    recordValue(recordValue(recordValue(result.sources).rdap).parsed).nameservers = Array.from(
      { length: 51 },
      (_, index) => `ns${index}.example.test`,
    );
    const markdown = formatLookupEvidenceMarkdown(result);
    assert.doesNotMatch(markdown, new RegExp(`x{${MAX_MARKDOWN_VALUE_LENGTH + 1}}`));
    assert.match(markdown, /and \d+ more/);
    assert.doesNotMatch(markdown, /ns50\\\.example\\\.test/);
  });

  test('uses diagnostics for an explicitly skipped source instead of calling it unknown', async () => {
    const source = savedLookup();
    source.mode = 'fast';
    recordValue(source).whois = { skipped: true, detail: 'WHOIS is omitted in fast mode.' };
    recordValue(source.diagnostics).whois = { status: 'skipped' };
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
    assert.ok(html.includes(`Generated with WHOISleuth ${APPLICATION_VERSION}`));
    assert.equal(html.endsWith('\n'), true);
  });

  test('omits only the presentation footer when requested', async () => {
    const result = buildCliEvidenceExport(JSON.stringify(savedLookup()), await evidenceModule());
    const markdown = formatLookupEvidenceMarkdown(result, { includeAttribution: false });
    const html = formatLookupEvidenceHtml(result, { includeAttribution: false });
    assert.doesNotMatch(markdown, /Generated with WHOISleuth/u);
    assert.doesNotMatch(html, /Generated with WHOISleuth/u);
    assert.ok(markdown.includes(`**Generator:** WHOISleuth ${APPLICATION_VERSION.replaceAll('.', '\\.')}`));
    assert.ok(html.includes(`<dt>Generator</dt><dd>WHOISleuth ${APPLICATION_VERSION}</dd>`));
  });

  test('renders registry access context as escaped static HTML diagnostics', async () => {
    const source = withRegistryAccess(savedLookup(), {
      limitation: 'Restricted <script>alert(1)</script> collection context.',
    });
    const result = buildCliEvidenceExport(JSON.stringify(source), await evidenceModule());
    const html = formatLookupEvidenceHtml(result);

    assert.match(html, /Registry access suffix/);
    assert.match(html, /Source-IP authorisation required/);
    assert.match(html, /No service published by IANA/);
    assert.match(html, /Restricted &lt;script&gt;alert\(1\)&lt;\/script&gt; collection context\./);
    assert.doesNotMatch(html, /<script>alert/);
  });

  test('escapes hostile source values rather than creating HTML elements or attributes', async () => {
    const result = buildCliEvidenceExport(JSON.stringify(savedLookup()), await evidenceModule());
    recordValue(result.query).submitted = '\"><script>alert(1)</script><img src=x onerror=alert(2)>';
    recordValue(recordValue(recordValue(result.sources).rdap).parsed).registrar = {
      name: '<form action=https://malicious.invalid>Submit</form>',
    };
    const html = formatLookupEvidenceHtml(result);
    assert.doesNotMatch(html, /<script\b|<img\b|<form\b/i);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /&lt;form action=/);
  });
});

describe('evidence export CLI runner', () => {
  test('feeds the domain-triage export directly into offline verification', async () => {
    const shared = await evidenceModule();
    const exported = capture();
    const exportCode = await runCli(['export', '--compact'], {
      stdout: exported.stream,
      stderr: capture().stream,
      readExportInput: async () => JSON.stringify(savedLookup()),
      loadEvidenceExport: async () => shared,
      now: () => '2026-07-14T09:00:00.000Z',
    });
    assert.equal(exportCode, EXIT_CODES.SUCCESS);

    const verified = capture();
    const verifyCode = await runCli(['verify-artifact', '--json', '--strict-exit'], {
      stdout: verified.stream,
      stderr: capture().stream,
      readArtifactInput: async () => exported.value(),
    });
    assert.equal(verifyCode, EXIT_CODES.SUCCESS);
    assert.deepEqual(JSON.parse(verified.value()).artifact, {
      kind: 'lookup_evidence',
      schema: 'whoisleuth.lookup-evidence',
      version: shared.LOOKUP_EVIDENCE_SCHEMA_VERSION,
    });
    assert.equal(JSON.parse(verified.value()).state, 'structure_valid');
  });

  test('verifies a minimal current domain export with absent optional availability diagnostics', async () => {
    const source = {
      schema: 'whoisleuth.cli.lookup',
      version: 1,
      generatedAt: '2026-07-14T08:00:00.000Z',
      mode: 'fast',
      query: 'example.test',
      type: 'domain',
      registrableDomain: 'example.test',
      isSubdomain: false,
      diagnostics: {
        rdap: { status: 'success' },
        whois: { status: 'skipped' },
      },
      rdap: {
        upstreamStatus: 200,
        rdapServer: 'https://rdap.example.test/domain/example.test',
        transportSecurity: 'https',
        fetchedAt: '2026-07-14T07:59:50.000Z',
        attempts: [],
        parsed: { domain: 'EXAMPLE.TEST' },
        data: { objectClassName: 'domain' },
      },
    };
    const exported = capture();
    const exportCode = await runCli(['export', '--compact'], {
      stdout: exported.stream,
      stderr: capture().stream,
      readExportInput: async () => JSON.stringify(source),
      loadEvidenceExport: evidenceModule,
      now: () => '2026-07-14T09:00:00.000Z',
    });
    assert.equal(exportCode, EXIT_CODES.SUCCESS);

    const evidence = JSON.parse(exported.value());
    assert.equal(recordValue(evidence.query).inputHostname, 'example.test');
    assert.equal(recordValue(evidence.analysis).availability, null);
    assert.equal(Object.hasOwn(recordValue(evidence.diagnostics), 'version'), false);

    const verified = capture();
    const verifyCode = await runCli(['verify-artifact', '--json', '--strict-exit'], {
      stdout: verified.stream,
      stderr: capture().stream,
      readArtifactInput: async () => exported.value(),
    });
    assert.equal(verifyCode, EXIT_CODES.SUCCESS);
    assert.equal(JSON.parse(verified.value()).artifact.kind, 'lookup_evidence');
    assert.equal(JSON.parse(verified.value()).state, 'structure_valid');
  });

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
    let received: string | null | undefined;
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
