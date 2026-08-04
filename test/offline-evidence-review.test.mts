import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseCliArguments } from '../cli/arguments.mts';
import {
  buildOfflineEvidenceReview,
  buildOfflineEvidenceReviewWithLocalResources,
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
        response: { reverse_search_properties_mapping: [{ property: 'handle', propertyPath: '$.entities[*].handle' }] },
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
      {
        schema: 'whoisleuth.zone-intent.input', version: 1, origin: 'example.test',
        desired: { format: 'records', records: [{ owner: '@', type: 'A', ttl: 300, value: '192.0.2.1' }] },
        observed: { state: 'observed', source: 'Fixture', observedAt: ISO, records: [{ owner: '@', type: 'A', ttl: 300, value: '192.0.2.1' }] },
      },
      {
        schema: 'whoisleuth.domain-portfolio.input', version: 1, portfolioLabel: 'Fixture',
        assets: [{
          domain: 'example.test', criticality: 'standard', registrar: null, registrarAccount: null,
          expiresAt: null, autoRenew: null, dnsProviders: [], mailProviders: [], certificateProviders: [], recoveryDomains: [], reviewedAt: ISO,
        }],
      },
      {
        schema: 'whoisleuth.domain-change.input', version: 1, domain: 'example.test',
        authoritySnapshots: [], resolverSnapshots: [], acmeDependencies: [], certificate: null, hsts: null,
      },
      {
        schema: 'whoisleuth.nameserver-preflight.input', version: 1, domain: 'example.test',
        intendedNameservers: ['ns1.example.test'], observations: [],
      },
    ];
    assert.deepEqual(inputs.map((input) => buildOfflineEvidenceReview(JSON.stringify(input), ISO).kind), [
      'rdap_search', 'dnssec', 'tlsa', 'rpki', 'geoip', 'encrypted_dns', 'zone_intent', 'domain_portfolio', 'domain_change', 'nameserver_preflight',
    ]);
    const rdap = buildOfflineEvidenceReview(JSON.stringify(inputs[0]), ISO).result as {
      responseInspection: { state: string; mappings: Array<{ state: string }> };
    };
    assert.equal(rdap.responseInspection.state, 'complete');
    assert.equal(rdap.responseInspection.mappings[0]?.state, 'registered');
  });

  test('exposes bounded terminal and JSON CLI output', async () => {
    assert.deepEqual(parseCliArguments(['review-evidence', 'evidence.json', '--json']), {
      action: 'review-evidence',
      source: 'evidence.json',
      mmdbSource: null,
      output: 'json',
      strictExit: false,
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

  test('offers an opt-in CI gate for explicit domain-change and zone-intent review failures', async () => {
    const domainChange = JSON.stringify({
      schema: 'whoisleuth.domain-change.input', version: 1, domain: 'example.test',
      authoritySnapshots: [], resolverSnapshots: [],
      acmeDependencies: [{ method: 'dns-01', owner: '_acme-challenge.example.test', target: null, provider: null, state: 'unknown' }],
      certificate: null, hsts: null,
    });
    const code = await runCli(['review-evidence', '--json', '--strict-exit'], {
      stdout: capture().stream,
      stderr: capture().stream,
      now: () => ISO,
      readArtifactInput: async () => domainChange,
    });
    assert.equal(code, EXIT_CODES.PARTIAL_FAILURE);
    const parsed = parseCliArguments(['review-evidence', '--strict-exit']);
    assert.equal(parsed.action, 'review-evidence');
    assert.equal(parsed.action === 'review-evidence' && parsed.strictExit, true);
    assert.throws(() => parseCliArguments(['review-evidence', '--strict-exit', '--strict-exit']), /only once/iu);
  });

  test('reads an explicitly supplied local MMDB without transmitting the address', async () => {
    const input = JSON.stringify({
      schema: 'whoisleuth.local-mmdb-query',
      version: 1,
      address: '81.2.69.142',
      sourceLabel: 'Pinned test database',
      databaseVersion: '606235df',
      license: 'MIT',
    });
    const document = await buildOfflineEvidenceReviewWithLocalResources(input, ISO, {
      mmdbPath: 'fixtures/mmdb/maxmind-db-test-data/GeoIP2-City-Test.mmdb',
    });
    const result = document.result as { state: string; match: { network: string; countryCode: string; city: string } };
    assert.equal(result.state, 'matched');
    assert.equal(result.match.network, '81.2.69.142/31');
    assert.equal(result.match.countryCode, 'GB');
    assert.equal(result.match.city, 'London');
    await assert.rejects(buildOfflineEvidenceReviewWithLocalResources(input, ISO), /requires --mmdb/u);
  });

  test('rejects unversioned and unknown documents', () => {
    assert.throws(() => buildOfflineEvidenceReview('{}'), /supported versioned/u);
    assert.throws(() => buildOfflineEvidenceReview(JSON.stringify({ schema: 'unknown', version: 1 })), /does not recognise/u);
  });
});
