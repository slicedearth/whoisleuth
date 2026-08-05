import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
  buildCliDomainControlReview,
  domainControlObservationFromSavedLookup,
  formatCliDomainControlReview,
} from '../cli/domain-control-observations.mts';
import { runCli } from '../cli/runner.mts';
import EXIT_CODES from '../cli/exit-codes.mts';
import { parseSavedLookupDocument } from '../cli/saved-lookup.mts';
import {
  DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
  buildDomainControlManifest,
} from '../lib/domain-control-manifest.mts';

const observedAt = '2026-08-05T01:02:03.000Z';

function lookup(domain = 'example.test', generatedAt = observedAt) {
  return {
    schema: 'whoisleuth.cli.lookup', version: 1, generatedAt, mode: 'deep', type: 'domain', query: domain, registrableDomain: domain,
    diagnostics: { rdap: { status: 'success' }, whois: { status: 'partial' } },
    rdap: { parsed: { registrar: { name: 'Example Registrar' }, statuses: ['clientTransferProhibited'], dnssec: 'signed', nameservers: ['ns1.example.test'] } },
    whois: { parsed: { nameservers: ['ns1.example.test'] } },
    availability: {
      dns: {
        status: 'success',
        records: { ns: ['ns1.example.test'], mx: [{ priority: 10, exchange: 'mail.example.test' }], caa: [{ critical: 0, tag: 'issue', value: 'ca.example' }] },
        delegation: { status: 'success', records: { ds: [{ keyTag: 12345, algorithm: 13, digestType: 2, digest: 'ABCDEF' }] } },
      },
      tls: { status: 'success', certificate: { fingerprintSha256: 'a'.repeat(64), issuer: { commonNames: ['Example Issuer'] }, publicKey: { fingerprintSha256: 'b'.repeat(64) } } },
      http: { status: 'success', finalOrigin: 'https://example.test' },
      pageIdentity: { status: 'success', bodySha256: 'c'.repeat(64), title: 'Example account centre' },
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
  test('maps separately attributed bounded lookup evidence without raw payloads', () => {
    const document = parseSavedLookupDocument(JSON.stringify(lookup()));
    const observation = domainControlObservationFromSavedLookup(document);

    assert.equal(observation.domain, 'example.test');
    assert.deepEqual(observation.fields.find((field) => field.id === 'delegated_nameservers')?.values, ['ns1.example.test']);
    assert.deepEqual(observation.fields.find((field) => field.id === 'mail_exchangers')?.values, ['10 mail.example.test']);
    assert.deepEqual(observation.fields.find((field) => field.id === 'tls_public_key')?.values, ['b'.repeat(64)]);
    assert.doesNotMatch(JSON.stringify(observation), /raw|query/iu);
  });

  test('uses only the newest supplied lookup per domain for desired-state review', () => {
    const first = lookup('example.test', '2026-08-04T01:02:03.000Z');
    const latest = lookup();
    const report = buildCliDomainControlReview(JSON.stringify({
      schema: CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
      version: 1,
      manifest: manifest(),
      lookups: [first, latest],
    }), observedAt);

    assert.equal(report.review.state, 'aligned');
    assert.equal(report.input.lookupsReceived, 2);
    assert.equal(report.input.latestDomainObservations, 1);
    assert.equal(report.input.ignoredHistoricalLookups, 1);
    assert.match(formatCliDomainControlReview(report), /Domain-control evidence review/u);
  });

  test('rejects an unknown root field', () => {
    assert.throws(() => buildCliDomainControlReview(JSON.stringify({
      schema: CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
      version: 1,
      manifest: manifest(),
      lookups: [lookup()],
      rawEvidence: 'not accepted',
    }), observedAt), /unsupported field/iu);
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
        version: 1,
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
