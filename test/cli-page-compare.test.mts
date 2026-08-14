import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseCliArguments } from '../cli/arguments.mts';
import { buildCliPageComparison, formatCliPageComparison } from '../cli/page-compare.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';

const ISO = '2026-08-01T01:02:03.000Z';

function savedLookup(domain: string, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    schema: 'whoisleuth.cli.lookup',
    version: 1,
    generatedAt: ISO,
    mode: 'deep',
    query: domain,
    type: 'domain',
    registrableDomain: domain,
    diagnostics: { rdap: { status: 'success' }, whois: { status: 'skipped' } },
    rdap: { parsed: { domain } },
    availability: {
      pageTitle: 'Example account centre',
      faviconHash: 'a'.repeat(64),
      faviconPHash: '0123456789abcdef',
      pageIdentity: {
        identityVersion: 3,
        version: 1,
        status: 'success',
        observedAt: ISO,
        scanMode: 'deep',
        source: 'html',
        complete: true,
        truncated: false,
        canonical: { url: `https://${domain}/private?token=discarded` },
        fingerprints: {
          fingerprintVersion: 1,
          normalizedHtml: { algorithm: 'sha256', value: 'b'.repeat(64), tokenCount: 50, truncated: false },
          visibleText: { algorithm: 'simhash64-v1', value: '0123456789abcdef', tokenCount: 40, featureCount: 30, truncated: false },
          domStructure: { algorithm: 'sha256', value: 'c'.repeat(64), nodeCount: 20, parser: 'static-tag-sequence-v1', truncated: false },
          formStructure: { algorithm: 'sha256', value: 'd'.repeat(64), formCount: 1, controlCount: 2, truncated: false },
          resourceHosts: { algorithm: 'set-sha256', value: 'e'.repeat(64), values: ['cdn.example'], truncated: false },
          identifiers: { algorithm: 'set-sha256', value: 'f'.repeat(64), values: [{ type: 'tag-container', value: 'GTM-FIXTURE' }], truncated: false },
          complete: true,
          truncated: false,
        },
      },
      technologyProfile: { status: 'success', findings: [{ id: 'fixture-platform' }] },
      tls: {
        status: 'success',
        certificate: {
          issuer: { commonNames: ['Fixture CA'] },
          publicKey: { fingerprintSha256: '1'.repeat(64) },
        },
      },
      ...overrides,
    },
  });
}

function capture() {
  let output = '';
  return { stream: { write(chunk: string) { output += chunk; } }, value: () => output };
}

describe('offline static page comparison', () => {
  test('compares bounded page, favicon, technology, and TLS components without an aggregate score', () => {
    const document = buildCliPageComparison(
      savedLookup('left.example'),
      savedLookup('right.example', { faviconHash: '2'.repeat(64), faviconPHash: '0123456789abcdee' }),
      ISO,
    );
    assert.equal(document.schema, 'whoisleuth.cli.page-compare');
    assert.equal(document.version, 4);
    assert.equal(document.page.components.find((component) => component.id === 'favicon')?.outcome, 'Perceptually similar');
    assert.equal(document.technology.state, 'equal');
    assert.equal(document.tls.issuer.state, 'equal');
    assert.equal(document.tls.publicKey.state, 'equal');
    assert.equal(Object.hasOwn(document, 'score'), false);
    assert.doesNotMatch(JSON.stringify(document), /private\?|token=|discarded/u);
    assert.match(formatCliPageComparison(document), /Static page comparison/u);
  });

  test('requires two distinct deep lookup documents with supported static evidence', () => {
    assert.deepEqual(parseCliArguments(['page-compare', 'left.json', 'right.json', '--json']), {
      action: 'page-compare', leftSource: 'left.json', rightSource: 'right.json', output: 'json', quiet: false, color: true,
    });
    assert.throws(() => parseCliArguments(['page-compare', 'same.json', 'same.json']), /different input files/u);
    assert.throws(() => buildCliPageComparison(savedLookup('same.example'), savedLookup('same.example')), /two different domains/u);
    const unsupported = JSON.parse(savedLookup('missing.example'));
    delete unsupported.availability.pageIdentity;
    assert.throws(() => buildCliPageComparison(JSON.stringify(unsupported), savedLookup('right.example')), /deep lookup/u);
  });

  test('withholds technology equality when either retained technology set is partial', () => {
    const partial = JSON.parse(savedLookup('left.example'));
    partial.availability.technologyProfile = {
      status: 'partial',
      truncated: true,
      findings: [{ id: 'fixture-platform' }],
    };
    const document = buildCliPageComparison(JSON.stringify(partial), savedLookup('right.example'), ISO);
    assert.equal(document.technology.state, 'partial');
    assert.equal(document.technology.partial, true);
    assert.match(formatCliPageComparison(document), /equality and disjointness withheld/u);
  });

  test('withholds TLS equality and difference when either retained TLS source is partial', () => {
    const partial = JSON.parse(savedLookup('left.example'));
    partial.availability.tls.status = 'partial';
    const different = JSON.parse(savedLookup('right.example'));
    different.availability.tls.certificate.issuer.commonNames = ['Different CA'];
    different.availability.tls.certificate.publicKey.fingerprintSha256 = '9'.repeat(64);

    const document = buildCliPageComparison(JSON.stringify(partial), JSON.stringify(different), ISO);
    assert.equal(document.tls.issuer.state, 'partial');
    assert.equal(document.tls.publicKey.state, 'partial');
    assert.match(formatCliPageComparison(document), /Issuer\s+partial/u);
    assert.match(formatCliPageComparison(document), /Public key\s+partial/u);
  });

  test('routes saved inputs through the CLI without making a lookup request', async () => {
    const stdout = capture();
    const stderr = capture();
    let lookupCalled = false;
    const code = await runCli(['page-compare', 'left.json', 'right.json', '--json'], {
      stdout: stdout.stream,
      stderr: stderr.stream,
      now: () => ISO,
      readDiffInput: async (source) => source === 'left.json' ? savedLookup('left.example') : savedLookup('right.example'),
      runUnifiedLookup: async () => { lookupCalled = true; return {}; },
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(lookupCalled, false);
    assert.equal(JSON.parse(stdout.value()).schema, 'whoisleuth.cli.page-compare');
    assert.equal(stderr.value(), '');
  });
});
