import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseCliArguments } from '../cli/arguments.mts';
import {
  buildOfflineEvidenceReview,
  formatOfflineEvidenceReview,
} from '../cli/offline-evidence-review.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';

const ISO = '2026-08-03T01:02:03.000Z';

function capture() {
  let output = '';
  return { stream: { write(chunk: string) { output += chunk; } }, value: () => output };
}

describe('offline evidence review command', () => {
  test('dispatches every supported versioned evidence family without a request', () => {
    const inputs = [
      {
        schema: 'whoisleuth.rdap-search-input',
        version: 1,
        help: { reverse_search_properties: [{ searchableResourceType: 'domains', relatedResourceType: 'entities', property: 'handle' }] },
        request: { searchableResourceType: 'domains', relatedResourceType: 'entities', property: 'handle', value: 'EXAMPLE' },
      },
      { schema: 'whoisleuth.dnssec-evidence-input', version: 1, ownerName: 'example.test', delegationSigned: false, dsRecords: [] },
      { schema: 'whoisleuth.tlsa-evidence-input', version: 1, serviceName: '_25._tcp.mx.example.test', dnssecState: 'unavailable', records: [] },
      { schema: 'whoisleuth.rpki-route-input', version: 1, routePrefix: '192.0.2.0/24', originAsn: 64496, authorizations: [] },
      {
        schema: 'whoisleuth.local-geoip-query',
        version: 1,
        address: '192.0.2.1',
        database: {
          sourceLabel: 'Fixture',
          databaseVersion: '1',
          license: 'Test data',
          records: [{ network: '192.0.2.0/24', countryCode: 'AU' }],
        },
      },
      {
        schema: 'whoisleuth.encrypted-dns-plan-input',
        version: 1,
        adapter: {
          id: 'fixture',
          label: 'Fixture',
          endpoint: 'https://resolver.example/dns-query',
          method: 'POST',
          representation: 'dns-wire',
          termsUrl: 'https://resolver.example/terms',
          privacyUrl: 'https://resolver.example/privacy',
          reviewedAt: ISO,
          queryRetention: 'unknown',
          maxResponseBytes: 65_536,
          timeoutMs: 5_000,
        },
        query: { name: 'example.test', type: 'DNSKEY' },
      },
    ];
    assert.deepEqual(inputs.map((input) => buildOfflineEvidenceReview(JSON.stringify(input), ISO).kind), [
      'rdap_search', 'dnssec', 'tlsa', 'rpki', 'geoip', 'encrypted_dns',
    ]);
  });

  test('exposes bounded terminal and JSON CLI output', async () => {
    assert.deepEqual(parseCliArguments(['review-evidence', 'evidence.json', '--json']), {
      action: 'review-evidence',
      source: 'evidence.json',
      output: 'json',
      quiet: false,
      color: true,
    });
    const input = JSON.stringify({
      schema: 'whoisleuth.rpki-route-input',
      version: 1,
      routePrefix: '192.0.2.0/24',
      originAsn: 'AS64496',
      authorizations: [{ prefix: '192.0.2.0/24', maxLength: 24, asn: 64496 }],
    });
    const stdout = capture();
    const code = await runCli(['review-evidence', '--json'], {
      stdout: stdout.stream,
      stderr: capture().stream,
      now: () => ISO,
      readArtifactInput: async () => input,
    });
    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(JSON.parse(stdout.value()).result.state, 'valid');
    assert.match(formatOfflineEvidenceReview(buildOfflineEvidenceReview(input, ISO)), /State\s+valid/u);
  });

  test('rejects unversioned and unknown documents', () => {
    assert.throws(() => buildOfflineEvidenceReview('{}'), /supported versioned/u);
    assert.throws(() => buildOfflineEvidenceReview(JSON.stringify({ schema: 'unknown', version: 1 })), /does not recognize/u);
  });
});
