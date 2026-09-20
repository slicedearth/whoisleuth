import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
  CLI_DOMAIN_CONTROL_REVIEW_VERSION,
  buildCliDomainControlReview,
  domainControlObservationFromSavedLookup,
  formatCliDomainControlReview,
} from '../cli/domain-control-observations.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { parseSavedLookupDocument } from '../cli/saved-lookup.mts';
import { MAX_BOUNDED_JSON_DEPTH } from '../lib/bounded-json.mts';
import {
  DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
  buildDomainControlManifest,
} from '../lib/domain-control-manifest.mts';

const observedAt = '2026-08-05T01:02:03.000Z';

function lookup(domain = 'example.test', generatedAt = observedAt) {
  return {
    schema: 'whoisleuth.cli.lookup', version: 1, generatedAt, mode: 'deep', type: 'domain', query: domain, registrableDomain: domain,
    diagnostics: { rdap: { status: 'success', observedAt: generatedAt }, whois: { status: 'partial', observedAt: generatedAt } },
    rdap: { parsed: { registrar: { name: 'Example Registrar' }, statuses: ['clientTransferProhibited'], dnssec: 'signed', nameservers: ['ns1.example.test'] } },
    whois: { parsed: { nameservers: ['ns1.example.test'] } },
    availability: {
      dns: {
        status: 'success', observedAt: generatedAt,
        records: { ns: ['ns1.example.test'], mx: [{ priority: 10, exchange: 'mail.example.test' }], caa: [{ critical: 0, tag: 'issue', value: 'ca.example' }] },
        delegation: { status: 'success', observedAt: generatedAt, records: { ds: [{ keyTag: 12345, algorithm: 13, digestType: 2, digest: 'ABCDEF' }] } },
      },
      tls: { status: 'success', observedAt: generatedAt, certificate: { fingerprintSha256: 'a'.repeat(64), issuer: { commonNames: ['Example Issuer'] }, publicKey: { fingerprintSha256: 'b'.repeat(64) } } },
      http: { status: 'success', observedAt: generatedAt, finalOrigin: 'https://example.test' },
      pageIdentity: { status: 'success', observedAt: generatedAt, bodySha256: 'c'.repeat(64), title: 'Example account centre' },
    },
  };
}

function manifest() {
  return buildDomainControlManifest({
    schema: DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
    version: 1,
    expiresAt: '2026-09-05T01:02:03.000Z',
    entries: [{
      domain: 'example.test', nameservers: ['ns1.example.test'], ds: ['12345 13 2 abcdef'], mx: ['10 mail.example.test'],
      caa: ['0 issue ca.example'], tlsIssuer: 'Example Issuer', tlsSpkiSha256: 'b'.repeat(64), registrarLock: 'required', renewalReviewAt: null, note: null,
    }],
  }, observedAt);
}

describe('CLI domain-control observations', () => {
  test('retains null MX and case-sensitive CAA payloads in their canonical form', () => {
    const value = lookup();
    value.availability.dns.records.mx = [{ priority: 0, exchange: '' }];
    value.availability.dns.records.caa = [{ critical: 0, tag: 'iodef', value: 'https://REPORTS.EXAMPLE/Case?Ticket=One' }];
    const observation = domainControlObservationFromSavedLookup(parseSavedLookupDocument(JSON.stringify(value)));
    assert.deepEqual(observation.fields.find((item) => item.id === 'mail_exchangers')?.values, ['0 .']);
    assert.deepEqual(observation.fields.find((item) => item.id === 'caa_policy')?.values, ['0 iodef https://reports.example/Case?Ticket=One']);
    assert.equal(observation.fields.find((item) => item.id === 'caa_policy')?.state, 'observed');
  });

  test('maps separately attributed bounded lookup evidence without raw payloads', () => {
    const document = parseSavedLookupDocument(JSON.stringify(lookup()));
    const observation = domainControlObservationFromSavedLookup(document);

    assert.equal(observation.domain, 'example.test');
    assert.deepEqual(observation.fields.find((field) => field.id === 'delegated_nameservers')?.values, ['ns1.example.test']);
    assert.deepEqual(observation.fields.find((field) => field.id === 'mail_exchangers')?.values, ['10 mail.example.test']);
    assert.deepEqual(observation.fields.find((field) => field.id === 'caa_policy')?.values, ['0 issue ca.example']);
    assert.deepEqual(observation.fields.find((field) => field.id === 'delegation_ds')?.values, ['12345 13 2 abcdef']);
    assert.deepEqual(observation.fields.find((field) => field.id === 'tls_public_key')?.values, ['b'.repeat(64)]);
    assert.doesNotMatch(JSON.stringify(observation), /raw|query/iu);
  });

  test('does not relabel registry DS metadata as a DNS delegation observation', () => {
    const value = lookup();
    Object.assign(value.rdap.parsed, {
      dsData: [{ keyTag: 12345, algorithm: 13, digestType: 2, digest: 'ABCDEF' }],
    });
    delete (value.availability.dns as Record<string, unknown>).delegation;
    const observation = domainControlObservationFromSavedLookup(parseSavedLookupDocument(JSON.stringify(value)));
    const delegation = observation.fields.find((field) => field.id === 'delegation_ds');
    assert.deepEqual(delegation, {
      id: 'delegation_ds', source: 'DNS delegation', state: 'unsupported', values: [], observedAt: null,
    });
  });

  test('rejects non-finite saved evidence numbers before parsing', () => {
    for (const value of ['1e400', '-1e400']) {
      const raw = JSON.stringify(lookup()).replace('"registrar":', `"numericExtension":${value},"registrar":`);
      assert.throws(() => parseSavedLookupDocument(raw), /contains a non-finite number/u, value);
    }
    const finite = JSON.stringify(lookup()).replace(
      '"registrar":',
      '"numericExtension":1.7976931348623157e308,"registrar":',
    );
    assert.doesNotThrow(() => parseSavedLookupDocument(finite));
  });

  test('uses only the newest supplied lookup per domain for desired-state review', () => {
    const first = lookup('example.test', '2026-08-04T15:30:00.000Z');
    const firstDns = (first.availability.dns as Record<string, unknown>).records as Record<string, unknown>;
    firstDns.mx = [{ priority: 20, exchange: 'older-mail.example.test' }];
    const latest = lookup('example.test', '2026-08-05T01:00:00.000Z');
    const report = buildCliDomainControlReview(JSON.stringify({
      schema: CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
      version: CLI_DOMAIN_CONTROL_REVIEW_VERSION,
      manifest: manifest(),
      lookups: [first, latest],
    }), observedAt);

    assert.equal(report.review.state, 'aligned');
    const comparisons = report.review.domains[0]?.comparisons ?? [];
    assert.equal(comparisons.find((item) => item.field === 'mx')?.state, 'aligned');
    assert.equal(comparisons.find((item) => item.field === 'caa')?.state, 'aligned');
    assert.equal(comparisons.find((item) => item.field === 'ds')?.state, 'aligned');
    assert.equal(report.input.lookupsReceived, 2);
    assert.equal(report.input.latestDomainObservations, 1);
    assert.equal(report.input.ignoredHistoricalLookups, 1);
    assert.match(formatCliDomainControlReview(report), /Domain-control evidence review/u);
  });

  test('keeps conflicting latest fields partial while comparing independent equal fields', () => {
    const first = lookup();
    const second = lookup();
    second.rdap.parsed.nameservers = ['ns2.example.test'];
    second.availability.tls.certificate.issuer.commonNames = ['Another issuer'];
    const older = lookup('example.test', '2026-08-04T01:00:00.000Z');
    const input = (lookups: ReturnType<typeof lookup>[]) => JSON.stringify({ schema: CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA, version: CLI_DOMAIN_CONTROL_REVIEW_VERSION, manifest: manifest(), lookups });
    const forward = buildCliDomainControlReview(input([older, first, second]), observedAt);
    const reverse = buildCliDomainControlReview(input([second, first, older]), observedAt);
    assert.deepEqual(forward, reverse);
    const comparisons = forward.review.domains[0]!.comparisons;
    assert.equal(comparisons.find((item) => item.field === 'nameservers')?.state, 'partial');
    assert.equal(comparisons.find((item) => item.field === 'tlsIssuer')?.state, 'partial');
    assert.equal(comparisons.find((item) => item.field === 'mx')?.state, 'aligned');
    assert.equal(forward.input.ignoredHistoricalLookups, 1);
    const nameservers = forward.observations[0]!.fields.find((item) => item.id === 'registry_nameservers');
    assert.deepEqual(nameservers?.values, ['ns1.example.test', 'ns2.example.test']);
    assert.match(nameservers?.source ?? '', /conflicting observations/u);
    const duplicate = buildCliDomainControlReview(input([first, first]), observedAt);
    assert.equal(duplicate.review.state, 'aligned');
    assert.equal(duplicate.input.ignoredHistoricalLookups, 0);
  });

  test('rejects an unknown root field', () => {
    assert.throws(() => buildCliDomainControlReview(JSON.stringify({
      schema: CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
      version: CLI_DOMAIN_CONTROL_REVIEW_VERSION,
      manifest: manifest(),
      lookups: [lookup()],
      rawEvidence: 'not accepted',
    }), observedAt), /unsupported field/iu);
  });

  test('rejects duplicate keys inside an embedded saved Lookup before parsing can collapse them', () => {
    const input = JSON.stringify({
      schema: CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
      version: CLI_DOMAIN_CONTROL_REVIEW_VERSION,
      manifest: manifest(),
      lookups: [lookup()],
    }).replace('"mode":"deep"', '"mode":"deep","mode":"fast"');

    assert.throws(
      () => buildCliDomainControlReview(input, observedAt),
      /Domain-control review input contains a duplicate object key/u,
    );
  });

  test('rejects over-nested embedded evidence with a stable bounded-input error', () => {
    const source = lookup();
    let nested: unknown = 'leaf';
    for (let index = 0; index < MAX_BOUNDED_JSON_DEPTH - 1; index += 1) nested = { value: nested };
    source.rdap = { ...source.rdap, data: nested } as typeof source.rdap & { data: unknown };

    assert.throws(
      () => buildCliDomainControlReview(JSON.stringify({
        schema: CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
        version: CLI_DOMAIN_CONTROL_REVIEW_VERSION,
        manifest: manifest(),
        lookups: [source],
      }), observedAt),
      /Domain-control review input exceeds the 50-level nesting limit/u,
    );
  });

  test('accepts an embedded Lookup at its exact standalone nesting boundary', () => {
    const source = lookup();
    let nested: unknown = 'leaf';
    for (let index = 0; index < MAX_BOUNDED_JSON_DEPTH - 2; index += 1) nested = { value: nested };
    source.rdap = { ...source.rdap, data: nested } as typeof source.rdap & { data: unknown };

    assert.doesNotThrow(() => buildCliDomainControlReview(JSON.stringify({
      schema: CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
      version: CLI_DOMAIN_CONTROL_REVIEW_VERSION,
      manifest: manifest(),
      lookups: [source],
    }), observedAt));
  });

  test('routes the saved-Lookup review through the existing offline command', async () => {
    let stdout = '';
    let lookupCalled = false;
    const code = await runCli(['domain-control', '--json'], {
      stdout: { write(value) { stdout += value; } },
      stderr: { write() {} },
      now: () => observedAt,
      readArtifactInput: async () => JSON.stringify({
        schema: CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
        version: CLI_DOMAIN_CONTROL_REVIEW_VERSION,
        manifest: manifest(),
        lookups: [lookup()],
      }),
      runUnifiedLookup: async () => { lookupCalled = true; return {}; },
    });

    assert.equal(code, EXIT_CODES.SUCCESS);
    assert.equal(lookupCalled, false);
    assert.equal(JSON.parse(stdout).schema, 'whoisleuth.cli.domain-control-review');
  });
});
