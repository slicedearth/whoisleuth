import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  INVALID_COMPACT_LOOKUP_RESPONSE,
  INVALID_COMPACT_LOOKUP_RESPONSE_MESSAGE,
  INVALID_LOOKUP_RESPONSE,
  INVALID_LOOKUP_RESPONSE_MESSAGE,
  MAX_COMPACT_LOOKUP_AVAILABILITY_KEYS,
  MAX_LOOKUP_RESPONSE_ERROR_LENGTH,
  MAX_LOOKUP_RESPONSE_HOST_LENGTH,
  MAX_LOOKUP_RESPONSE_QUERY_LENGTH,
  MAX_LOOKUP_RESPONSE_TOP_LEVEL_KEYS,
  MAX_LOOKUP_TIMING_MS,
  MAX_LOOKUP_TIMING_SOURCES,
  MAX_THREAT_INTELLIGENCE_PROVIDERS,
  createLookupHttpResponse,
  createLookupViewModel,
  lookupHttpErrorMessage,
  normalizeLookupTiming,
  parseCompactLookupHttpResponse,
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

function compactResponse(overrides = {}) {
  return {
    availability: {
      applicable: true,
      domain: 'example.test',
      state: 'registered',
      confidence: 'high',
    },
    diagnostics: {
      version: 7,
      rdap: { status: 'success' },
      whois: { status: 'skipped' },
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
        reverseDns: { version: 1, source: 'reverse_dns', records: { ptr: ['ptr.example.test'] } },
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
    assert.deepEqual(view.reverseDns, {});
    assert.deepEqual(view.reverseDnsRecords, {});
    assert.deepEqual(view.securityTxt, {});
    assert.deepEqual(view.threatIntelligenceProviders, []);
    assert.equal(view.timing, null);
  });

  test('normalizes bounded deep timing without mutating raw diagnostics', () => {
    const timing = {
      version: 1,
      totalMs: 2_500,
      sources: [
        { source: 'rdap', outcome: 'fulfilled', durationMs: 400, completedAfterMs: 400 },
        { source: 'reverse_dns', outcome: 'fulfilled', durationMs: 100, completedAfterMs: 500 },
        { source: 'whois', outcome: 'rejected', durationMs: 2_000, completedAfterMs: 2_100 },
      ],
    };
    const raw = response({ diagnostics: { version: 8, timing } });
    const before = structuredClone(raw);
    const parsed = parseLookupHttpResponse(raw);
    assert.equal(parsed.ok, true);

    const view = createLookupViewModel(parsed.value);
    assert.deepEqual(view.timing, timing);
    assert.notEqual(view.timing, timing);
    assert.notEqual(view.timing.sources, timing.sources);
    assert.deepEqual(raw, before);
  });

  test('drops malformed timing without rejecting otherwise valid evidence', () => {
    const validEntry = {
      source: 'rdap',
      outcome: 'fulfilled',
      durationMs: 10,
      completedAfterMs: 20,
    };
    const invalid = [
      null,
      [],
      { version: 2, totalMs: 20, sources: [validEntry] },
      { version: 1, totalMs: -1, sources: [] },
      { version: 1, totalMs: MAX_LOOKUP_TIMING_MS + 1, sources: [] },
      { version: 1, totalMs: 20, sources: Array(MAX_LOOKUP_TIMING_SOURCES + 1).fill(validEntry) },
      { version: 1, totalMs: 20, sources: [{ ...validEntry, source: 'unknown' }] },
      { version: 1, totalMs: 20, sources: [{ ...validEntry, outcome: 'complete' }] },
      { version: 1, totalMs: 20, sources: [{ ...validEntry, durationMs: 21 }] },
      { version: 1, totalMs: 20, sources: [{ ...validEntry, completedAfterMs: 9 }] },
      { version: 1, totalMs: 20, sources: [validEntry, validEntry] },
    ];

    for (const timing of invalid) {
      assert.equal(normalizeLookupTiming(timing), null);
      const parsed = parseLookupHttpResponse(response({ diagnostics: { version: 8, timing } }));
      assert.equal(parsed.ok, true);
      assert.equal(createLookupViewModel(parsed.value).timing, null);
    }
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
      response({ reverseDns: [] }),
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
        credentialSurfaceProfile: { source: 'html', inputs: { classifiedCount: 2 } },
        structuredDataIdentity: { source: 'html', entities: [{ name: 'Example publisher' }] },
        technologyProfile: { source: 'derived' },
        securityPosture: { summary: { observed: 1 } },
      },
      diagnostics: { registryAccess: { suffix: 'test' } },
      networkContext: { endpoint: { address: '192.0.2.1' }, rdap: { status: 'success' }, network: { handle: 'NET-1' } },
      reverseDns: {
        version: 1,
        source: 'reverse_dns',
        status: 'success',
        records: { ptr: ['ptr.example.test'] },
      },
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
    assert.equal(view.credentialSurfaceProfile.inputs.classifiedCount, 2);
    assert.equal(view.structuredDataIdentity.entities[0].name, 'Example publisher');
    assert.equal(view.securityPostureSummary.observed, 1);
    assert.equal(view.registryAccess.suffix, 'test');
    assert.equal(view.observedNetworkEndpoint.address, '192.0.2.1');
    assert.equal(view.reverseDns.source, 'reverse_dns');
    assert.deepEqual(view.reverseDnsRecords.ptr, ['ptr.example.test']);
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

describe('compact Bulk Lookup HTTP response contract', () => {
  test('accepts current bounded compact evidence without copying or mutation', () => {
    const raw = compactResponse({
      availability: {
        applicable: true,
        domain: 'example.test',
        state: 'unknown',
        confidence: 'low',
        deepScanComplete: false,
        additiveEvidence: { source: 'bounded' },
      },
    });
    const before = structuredClone(raw);
    const parsed = parseCompactLookupHttpResponse(raw, 'example.test');

    assert.equal(parsed.ok, true);
    assert.equal(parsed.value, raw);
    assert.deepEqual(raw, before);
  });

  test('rejects absent, scalar, array, oversized, and future-shaped availability', () => {
    const oversizedAvailability = compactResponse().availability;
    for (let index = 0; Object.keys(oversizedAvailability).length <= MAX_COMPACT_LOOKUP_AVAILABILITY_KEYS; index += 1) {
      oversizedAvailability[`extra${index}`] = index;
    }
    const invalid = [
      null,
      [],
      {},
      compactResponse({ availability: null }),
      compactResponse({ availability: 'registered' }),
      compactResponse({ availability: [] }),
      compactResponse({ availability: {} }),
      compactResponse({ availability: { applicable: true, domain: 'example.test', state: 'registered' } }),
      compactResponse({
        availability: {
          applicable: false,
          domain: 'example.test',
          state: 'registered',
          confidence: 'high',
        },
      }),
      compactResponse({
        availability: {
          applicable: true,
          domain: 'bad\ndomain',
          state: 'registered',
          confidence: 'high',
        },
      }),
      compactResponse({
        availability: {
          applicable: true,
          domain: 'example.test',
          state: 'future_state',
          confidence: 'high',
        },
      }),
      compactResponse({
        availability: {
          applicable: true,
          domain: 'example.test',
          state: 'registered',
          confidence: 'future_confidence',
        },
      }),
      compactResponse({
        availability: {
          applicable: true,
          domain: 'other.test',
          state: 'registered',
          confidence: 'high',
        },
      }),
      compactResponse({
        availability: {
          applicable: true,
          domain: 'not a domain',
          state: 'registered',
          confidence: 'high',
        },
      }),
      compactResponse({ availability: oversizedAvailability }),
      compactResponse({ diagnostics: { ...compactResponse().diagnostics, version: 8 } }),
      compactResponse({
        diagnostics: {
          ...compactResponse().diagnostics,
          availability: { status: 'future_status' },
        },
      }),
    ];

    for (const value of invalid) {
      assert.deepEqual(parseCompactLookupHttpResponse(value, 'example.test'), {
        ok: false,
        errorCode: INVALID_COMPACT_LOOKUP_RESPONSE,
        error: INVALID_COMPACT_LOOKUP_RESPONSE_MESSAGE,
      });
    }
  });

  test('accepts a registrable response for a requested subdomain', () => {
    const parsed = parseCompactLookupHttpResponse(
      compactResponse(),
      'portal.example.test',
    );
    assert.equal(parsed.ok, true);
  });
});
