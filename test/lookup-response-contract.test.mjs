import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  INVALID_LOOKUP_RESPONSE,
  INVALID_LOOKUP_RESPONSE_MESSAGE,
  MAX_LOOKUP_RESPONSE_ERROR_LENGTH,
  MAX_LOOKUP_RESPONSE_HOST_LENGTH,
  MAX_LOOKUP_RESPONSE_QUERY_LENGTH,
  MAX_LOOKUP_RESPONSE_TOP_LEVEL_KEYS,
  MAX_THREAT_INTELLIGENCE_PROVIDERS,
  createLookupHttpResponse,
  createLookupViewModel,
  lookupHttpErrorMessage,
  parseLookupHttpResponse,
} from '../lib/lookup-response-contract.mts';

function response(overrides = {}) {
  return {
    query: 'portal.example.test',
    type: 'domain',
    inputHostname: 'portal.example.test',
    registrableDomain: 'example.test',
    isSubdomain: true,
    rdap: { parsed: { domain: 'EXAMPLE.TEST' } },
    whois: { parsed: { domainName: 'EXAMPLE.TEST' }, chain: [] },
    availability: { applicable: true, domain: 'example.test', state: 'registered' },
    diagnostics: {
      rdap: { status: 'success' },
      whois: { status: 'complete' },
      availability: { status: 'complete' },
    },
    ...overrides,
  };
}

describe('Lookup HTTP response contract', () => {
  test('accepts the full response without copying, pruning, or mutating additive evidence', () => {
    const raw = response({ additiveSection: { version: 1, value: 'retained' } });
    const before = structuredClone(raw);
    const parsed = parseLookupHttpResponse(raw);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.value, raw);
    assert.deepEqual(raw, before);
    assert.deepEqual(parsed.value.additiveSection, { version: 1, value: 'retained' });
  });

  test('accepts all supported query types and optional deep sections', () => {
    for (const type of ['domain', 'ipv4', 'ipv6', 'asn']) {
      const parsed = parseLookupHttpResponse(response({
        type,
        networkContext: { contextVersion: 1 },
        securityTxt: { securityTxtVersion: 1 },
        threatIntelligence: { version: 1, providers: [] },
      }));
      assert.equal(parsed.ok, true, type);
    }
  });

  test('keeps optional deep sections absent for compatible partial responses', () => {
    const parsed = parseLookupHttpResponse(response());
    assert.equal(parsed.ok, true);

    const view = createLookupViewModel(parsed.value);
    assert.deepEqual(view.observedNetworkContext, {});
    assert.deepEqual(view.securityTxt, {});
    assert.deepEqual(view.threatIntelligenceProviders, []);
  });

  test('rejects malformed envelope values with a stable error', () => {
    const invalid = [
      null,
      [],
      {},
      response({ query: '' }),
      response({ query: 'bad\nquery' }),
      response({ query: 'x'.repeat(MAX_LOOKUP_RESPONSE_QUERY_LENGTH + 1) }),
      response({ type: 'url' }),
      response({ rdap: [] }),
      response({ whois: null }),
      response({ availability: 'registered' }),
      response({ diagnostics: [] }),
      response({ inputHostname: 'x'.repeat(MAX_LOOKUP_RESPONSE_HOST_LENGTH + 1) }),
      response({ registrableDomain: 'bad\tdomain' }),
      response({ isSubdomain: 'yes' }),
      response({ networkContext: [] }),
      response({ securityTxt: false }),
      response({ threatIntelligence: [] }),
    ];

    for (const value of invalid) {
      assert.deepEqual(parseLookupHttpResponse(value), {
        ok: false,
        errorCode: INVALID_LOOKUP_RESPONSE,
        error: INVALID_LOOKUP_RESPONSE_MESSAGE,
      });
    }
  });

  test('bounds the additive top-level envelope', () => {
    const oversized = response();
    for (let index = 0; Object.keys(oversized).length <= MAX_LOOKUP_RESPONSE_TOP_LEVEL_KEYS; index += 1) {
      oversized[`extra${index}`] = index;
    }
    assert.equal(parseLookupHttpResponse(oversized).ok, false);
  });

  test('projects separately attributed evidence without mutating the response', () => {
    const raw = response({
      rdap: { parsed: { domain: 'EXAMPLE.TEST' }, registrarRdap: { parsed: { domain: 'EXAMPLE.TEST' } } },
      availability: {
        applicable: true,
        dns: { records: { a: ['192.0.2.1'] } },
        http: { response: { securityHeaders: { contentSecurityPolicy: 'default-src none' } } },
        tls: { certificate: { subject: { commonNames: ['example.test'] } } },
        pageIdentity: { openGraph: { url: { url: 'https://example.test/' } } },
        technologyProfile: { source: 'derived' },
        securityPosture: { summary: { observed: 1 } },
      },
      diagnostics: { registryAccess: { suffix: 'test' } },
      networkContext: { endpoint: { address: '192.0.2.1' }, rdap: { status: 'success' }, network: { handle: 'NET-1' } },
    });
    const before = structuredClone(raw);
    const parsed = parseLookupHttpResponse(raw);
    assert.equal(parsed.ok, true);

    const view = createLookupViewModel(parsed.value);
    assert.equal(view.rdapParsed.domain, 'EXAMPLE.TEST');
    assert.equal(view.registrarRdapParsed.domain, 'EXAMPLE.TEST');
    assert.deepEqual(view.dnsRecords.a, ['192.0.2.1']);
    assert.equal(view.httpSecurityHeaders.contentSecurityPolicy, 'default-src none');
    assert.deepEqual(view.tlsSubject.commonNames, ['example.test']);
    assert.equal(view.pageOpenGraphUrl.url, 'https://example.test/');
    assert.equal(view.securityPostureSummary.observed, 1);
    assert.equal(view.registryAccess.suffix, 'test');
    assert.equal(view.observedNetworkEndpoint.address, '192.0.2.1');
    assert.deepEqual(raw, before);
  });

  test('bounds and filters provider records in the view model while preserving raw evidence', () => {
    const providers = Array.from(
      { length: MAX_THREAT_INTELLIGENCE_PROVIDERS + 4 },
      (_, index) => ({ id: `provider-${index}` }),
    );
    providers.splice(2, 0, null, 'invalid');
    const raw = response({ threatIntelligence: { version: 1, providers } });
    const parsed = parseLookupHttpResponse(raw);
    assert.equal(parsed.ok, true);

    const view = createLookupViewModel(parsed.value);
    assert.equal(view.threatIntelligenceProviders.length, MAX_THREAT_INTELLIGENCE_PROVIDERS);
    assert.equal(view.threatIntelligenceProviders[0].id, 'provider-0');
    assert.equal(view.threatIntelligenceProviders.at(-1).id, 'provider-9');
    assert.equal(raw.threatIntelligence.providers.length, MAX_THREAT_INTELLIGENCE_PROVIDERS + 6);
  });

  test('builds the same additive HTTP envelope for domain and non-domain results', () => {
    const domain = createLookupHttpResponse(
      'portal.example.test',
      {
        type: 'domain', value: 'example.test', inputHostname: 'portal.example.test',
        registrableDomain: 'example.test', isSubdomain: true,
      },
      {
        query: 'overridden.example.test', type: 'asn', registrableDomain: 'overridden.example.test',
        rdap: {}, whois: {}, availability: {}, diagnostics: {}, marker: 'retained',
      },
    );
    assert.equal(domain.marker, 'retained');
    assert.equal(domain.query, 'portal.example.test');
    assert.equal(domain.type, 'domain');
    assert.equal(domain.inputHostname, 'portal.example.test');
    assert.equal(domain.registrableDomain, 'example.test');
    assert.equal(domain.isSubdomain, true);

    const ip = createLookupHttpResponse(
      '192.0.2.1',
      { type: 'ipv4', value: '192.0.2.1' },
      { rdap: {}, whois: {}, availability: {}, diagnostics: {} },
    );
    assert.equal(ip.type, 'ipv4');
    assert.equal(ip.inputHostname, undefined);
    assert.equal(ip.registrableDomain, undefined);
  });

  test('sanitizes and bounds server error text before display', () => {
    const message = lookupHttpErrorMessage({ error: `upstream\n${'x'.repeat(400)}` }, 502);
    assert.equal(message.includes('\n'), false);
    assert.equal(message.length, MAX_LOOKUP_RESPONSE_ERROR_LENGTH);
    assert.equal(lookupHttpErrorMessage({}, 503), 'Lookup failed (503)');
  });
});
