import { arrayValue, recordValue, requiredValue } from './value-assertions.mts';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  THREAT_INTELLIGENCE_CONTRACT_VERSION,
  THREAT_INTELLIGENCE_ENVELOPE_VERSION,
  THREAT_INTELLIGENCE_RESULT_STATES,
  THREAT_INTELLIGENCE_SCHEMA,
} from '../lib/threat-intelligence-types.mts';
import {
  MAX_HTTP_ATTEMPTS,
  MAX_HTTP_ERROR_LENGTH,
  MAX_HTTP_EVIDENCE_REDIRECTS,
  MAX_HTTP_PROVENANCE_URL,
} from '../lib/http-evidence-bounds.mts';
import {
  MAX_OBSERVATION_LIMITATIONS,
  MAX_OBSERVATION_LIMITATION_LENGTH,
} from '../lib/observation.mts';
import { MAX_BOUNDED_JSON_DEPTH } from '../lib/bounded-json.mts';
import { MAX_SECURITY_POSTURE_FINDINGS } from '../lib/website-security-posture.mts';
import { analyzeWebsiteSecurityPosture } from '../lib/website-security-posture.mts';
import { extractHtmlSignals } from '../lib/html-signals.mts';
import { buildTlsObservation, skippedTlsObservation } from '../lib/tls-intelligence.mts';
import {
  httpDeliveryMetadataFixture,
  pagePublicationMetadataFixture,
} from './homepage-metadata-fixtures.mts';

import {
  INVALID_COMPACT_LOOKUP_RESPONSE,
  INVALID_COMPACT_LOOKUP_RESPONSE_MESSAGE,
  INVALID_LOOKUP_RESPONSE,
  INVALID_LOOKUP_RESPONSE_MESSAGE,
  MAX_COMPACT_LOOKUP_AVAILABILITY_KEYS,
  MAX_LOOKUP_RESPONSE_ERROR_LENGTH,
  MAX_LOOKUP_RESPONSE_CONTAINER_ITEMS,
  MAX_LOOKUP_RESPONSE_HOST_LENGTH,
  MAX_LOOKUP_RESPONSE_QUERY_LENGTH,
  MAX_LOOKUP_RESPONSE_TOP_LEVEL_KEYS,
  MAX_LOOKUP_DNS_RECORDS_PER_TYPE,
  MAX_LOOKUP_REVERSE_DNS_PTR_RECORDS,
  MAX_LOOKUP_TLS_ALT_NAMES,
  MAX_LOOKUP_TLS_CERTIFICATE_POLICIES,
  MAX_LOOKUP_TLS_CHAIN_CERTIFICATES,
  MAX_LOOKUP_TLS_FINDINGS,
  MAX_LOOKUP_TLS_NAME_VALUES,
  MAX_LOOKUP_TIMING_MS,
  MAX_LOOKUP_TIMING_SOURCES,
  MAX_THREAT_INTELLIGENCE_FINDINGS,
  MAX_THREAT_INTELLIGENCE_LIMITATIONS,
  MAX_THREAT_INTELLIGENCE_PROVIDERS,
  createLookupHttpResponse,
  createLookupViewModel,
  isJsonObject,
  lookupHttpErrorMessage,
  normalizeLookupTiming,
  parseCompactLookupHttpResponse,
  parseLookupHttpResponse,
} from '../lib/lookup-response-contract.mts';
import { classifyQuery } from '../lib/classify.mts';

const THREAT_TARGET = Object.freeze({
  type: 'domain',
  value: 'example.test',
  exposure: 'registrable_domain',
});

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

function boundedHttpEvidence(overrides: Record<string, unknown> = {}) {
  const redirects = Array.from({ length: MAX_HTTP_EVIDENCE_REDIRECTS }, (_, index) => ({
    from: `https://redirect-${index}.example.test/`,
    to: `https://redirect-${index + 1}.example.test/`,
    status: 301,
    queryOmitted: false,
  }));
  return {
    status: 'success',
    complete: true,
    requestUrl: 'https://example.test/',
    finalUrl: 'https://redirect-5.example.test/',
    redirectCount: redirects.length,
    redirects,
    attempts: Array.from({ length: MAX_HTTP_ATTEMPTS }, (_, index) => ({
      url: `https://attempt-${index}.example.test/`,
      queryOmitted: false,
      outcome: 'response',
      httpStatus: 200,
      error: null,
    })),
    limitations: Array.from({ length: MAX_OBSERVATION_LIMITATIONS }, (_, index) => `Bounded limitation ${index}`),
    response: { status: 200 },
    ...overrides,
  };
}

function validHttpsRecord(overrides: Record<string, unknown> = {}) {
  return {
    type: 'HTTPS',
    owner: 'example.test',
    ttl: 300,
    priority: 1,
    mode: 'service',
    target: 'example.test',
    targetIsOwner: true,
    serviceUnavailable: false,
    compatible: true,
    parametersIgnored: false,
    parameters: {
      mandatory: [],
      alpn: ['h2'],
      noDefaultAlpn: false,
      port: 443,
      ipv4hint: ['192.0.2.1'],
      ipv6hint: ['2001:db8::1'],
      opaque: [],
      unknownKeys: [],
      unsupportedMandatoryKeys: [],
    },
    ...overrides,
  };
}

function nestedValue(depth: number): unknown {
  let value: unknown = 'leaf';
  for (let index = 0; index < depth; index += 1) value = { value };
  return value;
}

function canonicalPageProfiles() {
  const signals = extractHtmlSignals(
    '<html><head><title>Fixture</title></head><body><form><input type="password"></form><script id="__NEXT_DATA__"></script></body></html>',
    'example.test',
    {
      observedAt: '2026-07-13T04:05:06.000Z',
      includeCredentialSurfaceProfile: true,
    },
  );
  return {
    pageIdentity: requiredValue(signals.pageIdentity),
    credentialSurfaceProfile: requiredValue(signals.credentialSurfaceProfile),
    structuredDataIdentity: requiredValue(signals.structuredDataIdentity),
    technologyProfile: requiredValue(signals.technologyProfile),
    pageRoleProfile: requiredValue(signals.pageRoleProfile),
    clientBehaviorProfile: requiredValue(signals.clientBehaviorProfile),
    securityPosture: analyzeWebsiteSecurityPosture({
      pageIdentity: signals.pageIdentity,
      observedAt: '2026-07-13T04:05:06.000Z',
    }),
  };
}

function canonicalTlsProfile(overrides: Record<string, unknown> = {}) {
  return { ...skippedTlsObservation('Fixture TLS collection was skipped.'), ...overrides };
}

describe('Lookup HTTP response contract', () => {
  test('accepts every canonical domain identity produced by query classification', () => {
    for (const [query, expected] of [
      ['portal.example.test', 'example.test'],
      ['https://portal.example.test:443/path', 'example.test'],
      ['münchen.example', 'xn--mnchen-3ya.example'],
      ['shop.example.co.uk', 'example.co.uk'],
      ['portal.example.test.', 'example.test'],
    ] as const) {
      const classified = classifyQuery(query);
      const raw = createLookupHttpResponse(query, classified, response({
        rdap: { parsed: { domain: expected.toUpperCase() } },
        whois: { parsed: { domainName: expected.toUpperCase() }, chain: [] },
        availability: { applicable: true, domain: expected, state: 'registered' },
      }));

      assert.equal(parseLookupHttpResponse(raw).ok, true, query);
    }
    assert.throws(() => classifyQuery('foo_bar.example.test'), /invalid domain label/u);
  });

  test('accepts the full response without copying, pruning, or mutating additive evidence', () => {
    const raw = response({ additiveSection: { version: 1, value: 'retained' } });
    const before = structuredClone(raw);
    const parsed = parseLookupHttpResponse(raw);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.value, raw);
    assert.deepEqual(raw, before);
    assert.deepEqual(parsed.value.additiveSection, { version: 1, value: 'retained' });
  });

  test('rejects complete registration diagnostics without normalized publication data', () => {
    assert.equal(parseLookupHttpResponse(response({ rdap: {} })).ok, false);
    assert.equal(parseLookupHttpResponse(response({ whois: { chain: [] } })).ok, false);
    assert.equal(parseLookupHttpResponse(response({
      rdap: {},
      whois: { chain: [] },
      diagnostics: {
        rdap: { status: 'partial' },
        whois: { status: 'partial' },
        availability: { status: 'complete' },
      },
    })).ok, true);
  });

  test('accepts the producer redaction ceiling without inventing truncation', () => {
    const redactions = Array.from({ length: 51 }, (_, index) => ({
      name: `Field ${index}`,
      reason: null,
      method: 'removal',
      pathLanguage: 'jsonpath',
      prePath: `$.entities[${index}]`,
      postPath: null,
      replacementPath: null,
    }));
    const parsed = parseLookupHttpResponse(response({
      rdap: {
        parsed: {
          domain: 'EXAMPLE.TEST',
          redactions,
          redactionsTruncated: false,
        },
      },
    }));
    assert.equal(parsed.ok, true);
  });

  test('accepts exact homepage metadata, projects it for display, and rejects malformed children', () => {
    const publicationMetadata = pagePublicationMetadataFixture();
    const deliveryMetadata = httpDeliveryMetadataFixture();
    const profiles = canonicalPageProfiles();
    const raw = response({
      availability: {
        applicable: true,
        domain: 'example.test',
        state: 'registered',
        pageIdentity: { ...profiles.pageIdentity, publicationMetadata },
        http: { status: 'success', response: { status: 200, deliveryMetadata } },
      },
    });
    const parsed = parseLookupHttpResponse(raw);
    assert.equal(parsed.ok, true);
    const view = createLookupViewModel(parsed.value);
    assert.equal(view.pagePublicationMetadata, publicationMetadata);
    assert.equal(view.httpDeliveryMetadata, deliveryMetadata);
    assert.equal(parseLookupHttpResponse(response({
      availability: {
        applicable: true,
        domain: 'example.test',
        state: 'registered',
        pageTitle: 'Account\u009b\u202e centre',
      },
    })).ok, false);

    for (const child of [
      { ...pagePublicationMetadataFixture(), version: 2 },
      { ...pagePublicationMetadataFixture(), privateValue: 'not allowed' },
    ]) {
      const parsedChild = parseLookupHttpResponse(response({
        availability: {
          applicable: true, state: 'registered',
          pageIdentity: { ...profiles.pageIdentity, publicationMetadata: child },
        },
      }));
      assert.equal(parsedChild.ok, true);
      assert.equal(recordValue(parsedChild.value.availability.pageIdentity).compatibility, 'malformed');
    }
    for (const child of [
      { ...httpDeliveryMetadataFixture(), version: 2 },
      { ...httpDeliveryMetadataFixture(), rawHeaders: 'not allowed' },
    ]) {
      assert.equal(parseLookupHttpResponse(response({
        availability: {
          applicable: true, state: 'registered',
          http: { status: 'success', response: { status: 200, deliveryMetadata: child } },
        },
      })).ok, false);
    }

    for (const parentState of ['error', 'skipped', 'unavailable']) {
      assert.equal(parseLookupHttpResponse(response({
        availability: {
          applicable: true, state: 'registered',
          pageIdentity: { source: 'html', status: parentState },
        },
      })).ok, true);
      const incompatiblePage = parseLookupHttpResponse(response({
        availability: {
          applicable: true, state: 'registered',
          pageIdentity: { source: 'html', status: parentState, publicationMetadata },
        },
      }));
      assert.equal(incompatiblePage.ok, true);
      assert.equal(recordValue(incompatiblePage.value.availability.pageIdentity).compatibility, 'malformed');
      assert.equal(parseLookupHttpResponse(response({
        availability: {
          applicable: true, state: 'registered',
          http: { status: parentState, response: { status: 200 } },
        },
      })).ok, true);
      assert.equal(parseLookupHttpResponse(response({
        availability: {
          applicable: true, state: 'registered',
          http: { status: parentState, response: { status: 200, deliveryMetadata } },
        },
      })).ok, false);
    }

    const impossiblePartial = structuredClone(publicationMetadata);
    impossiblePartial.status = 'partial';
    impossiblePartial.complete = false;
    const invalidPublication = parseLookupHttpResponse(response({
      availability: {
        applicable: true, state: 'registered',
        pageIdentity: { ...profiles.pageIdentity, status: 'partial', complete: false, publicationMetadata: impossiblePartial },
      },
    }));
    assert.equal(invalidPublication.ok, true);
    assert.equal(recordValue(invalidPublication.value.availability.pageIdentity).compatibility, 'malformed');
  });

  test('rejects a structurally over-nested response before display models can consume it', () => {
    const raw = response({
      rdap: { parsed: { domain: 'EXAMPLE.TEST' }, additive: nestedValue(MAX_BOUNDED_JSON_DEPTH + 1) },
    });
    assert.deepEqual(parseLookupHttpResponse(raw), {
      ok: false,
      error: INVALID_LOOKUP_RESPONSE_MESSAGE,
      errorCode: INVALID_LOOKUP_RESPONSE,
    });
  });

  test('rejects prototype-sensitive nested keys before they can influence derived evidence', () => {
    const raw = response({
      rdap: {
        parsed: JSON.parse('{"__proto__":{"domain":"forged.example.test","statuses":["pendingDelete"]},"handle":"REAL-1"}'),
      },
    });
    assert.equal(parseLookupHttpResponse(raw).ok, false);
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

  test('accepts exact HTTP evidence bounds without copying or pruning additive fields', () => {
    const http = boundedHttpEvidence({ additiveField: { retained: true } });
    const raw = response({ availability: { applicable: true, state: 'registered', http } });
    const before = structuredClone(raw);
    const parsed = parseLookupHttpResponse(raw);

    assert.equal(parsed.ok, true);
    assert.equal(parsed.value, raw);
    assert.deepEqual(raw, before);
    assert.deepEqual((http as typeof http & { additiveField: { retained: boolean } }).additiveField.retained, true);
  });

  test('accepts exact producer network bounds and rejects over-bound or nested collection values', () => {
    const exact = response({
      reverseDns: { records: { ptr: Array.from({ length: MAX_LOOKUP_REVERSE_DNS_PTR_RECORDS }, (_, index) => `ptr-${index}.example.test`) } },
      availability: {
        applicable: true,
        state: 'registered',
        dns: {
          diagnostics: Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`source${index}`, { status: 'success' }])),
          records: {
            a: Array.from({ length: MAX_LOOKUP_DNS_RECORDS_PER_TYPE }, (_, index) => `192.0.2.${index + 1}`),
            mx: Array.from({ length: MAX_LOOKUP_DNS_RECORDS_PER_TYPE }, (_, index) => ({ priority: index, exchange: `mx-${index}.example.test` })),
            https: [validHttpsRecord()],
          },
        },
        tls: canonicalTlsProfile({
          limitations: Array.from({ length: MAX_OBSERVATION_LIMITATIONS }, (_, index) => `TLS limitation ${index}`),
          findings: Array.from({ length: MAX_LOOKUP_TLS_FINDINGS }, (_, index) => ({
            id: `finding-${index}`,
            tone: 'neutral',
            label: `Finding ${index}`,
            detail: 'Bounded fixture detail.',
          })),
          chain: Array.from({ length: MAX_LOOKUP_TLS_CHAIN_CERTIFICATES }, (_, index) => ({ fingerprintSha256: String(index).padStart(64, '0') })),
          certificate: {
            subject: { commonNames: Array.from({ length: MAX_LOOKUP_TLS_NAME_VALUES }, (_, index) => `name-${index}.example.test`) },
            subjectAltNames: { dnsNames: Array.from({ length: MAX_LOOKUP_TLS_ALT_NAMES }, (_, index) => `san-${index}.example.test`), ipAddresses: [] },
            extensionProfile: { certificatePolicies: { oids: Array.from({ length: MAX_LOOKUP_TLS_CERTIFICATE_POLICIES }, (_, index) => `1.2.3.${index}`) } },
          },
        }),
      },
    });
    assert.equal(parseLookupHttpResponse(exact).ok, true);

    const invalidOuterEvidence = [
      response({ availability: { applicable: true, state: 'registered', dns: { records: { a: Array(MAX_LOOKUP_DNS_RECORDS_PER_TYPE + 1).fill('192.0.2.1') } } } }),
      response({ reverseDns: { records: { ptr: Array(MAX_LOOKUP_REVERSE_DNS_PTR_RECORDS + 1).fill('ptr.example.test') } } }),
      response({ availability: { applicable: true, state: 'registered', dns: { records: { a: [Array(500).fill('nested')] } } } }),
      response({ reverseDns: { records: { ptr: [Array(500).fill('nested')] } } }),
      response({ availability: { applicable: true, state: 'registered', dns: { records: { mx: [{ priority: 0, exchange: Array(500).fill('nested') }] } } } }),
      response({ availability: { applicable: true, state: 'registered', dns: { records: { caa: [{ critical: 0, tag: 'issue', value: Array(500).fill('nested') }] } } } }),
      response({ availability: { applicable: true, state: 'registered', dns: { records: { soa: [{ nsname: Array(500).fill('nested'), hostmaster: 'hostmaster.example.test', serial: 1, refresh: 1, retry: 1, expire: 1, minttl: 1 }] } } } }),
      response({ availability: { applicable: true, state: 'registered', dns: { records: { https: [validHttpsRecord({ parameters: { ...validHttpsRecord().parameters, alpn: [Array(500).fill('nested')] } })] } } } }),
    ];
    for (const candidate of invalidOuterEvidence) assert.equal(parseLookupHttpResponse(candidate).ok, false);

    const malformedTlsProfiles = [
      canonicalTlsProfile({ chain: Array(MAX_LOOKUP_TLS_CHAIN_CERTIFICATES + 1).fill({}) }),
      canonicalTlsProfile({ certificate: { subject: { commonNames: [Array(500).fill('nested')] } } }),
      canonicalTlsProfile({ limitations: Array(MAX_OBSERVATION_LIMITATIONS + 1).fill('limit') }),
      canonicalTlsProfile({ limitations: [Array(500).fill('nested')] }),
      canonicalTlsProfile({ diagnostics: { collection: { error: Array(500).fill('nested') } } }),
    ];
    for (const tls of malformedTlsProfiles) {
      const parsed = parseLookupHttpResponse(response({
        availability: { applicable: true, state: 'registered', tls },
      }));
      assert.equal(parsed.ok, true);
      assert.equal(recordValue(parsed.value.availability.tls).compatibility, 'malformed');
    }
  });

  test('enforces registration, page, observation, and live-container producer bounds', () => {
    const profiles = canonicalPageProfiles();
    const postureFinding = (index: number) => ({
      id: `posture-${index}`,
      category: 'transport',
      state: 'observed',
      tone: 'configured',
      label: `Posture ${index}`,
      detail: 'Bounded posture detail.',
      evidence: ['Fixture evidence'],
    });
    const exact = response({
      rdap: {
        parsed: {
          statuses: Array.from({ length: 100 }, (_, index) => `status-${index}`),
          nameservers: Array.from({ length: 200 }, (_, index) => `ns-${index}.example.test`),
          events: Array.from({ length: 100 }, (_, index) => ({ action: 'last changed', date: `2026-01-${String(index % 28 + 1).padStart(2, '0')}T00:00:00.000Z` })),
          entitiesByRole: {
            registrant: Array.from({ length: 5 }, (_, index) => ({
              handle: `CONTACT-${index}`,
              roles: ['registrant'],
              names: [`Contact ${index}`],
              address: 'A'.repeat(1_000),
              addresses: ['B'.repeat(1_000)],
              publicIds: [],
              links: [],
            })),
          },
          redactions: [{ prePath: 'P'.repeat(512), postPath: 'Q'.repeat(512), replacementPath: 'R'.repeat(512) }],
        },
      },
      whois: {
        parsed: {
          statuses: Array.from({ length: 100 }, (_, index) => `status-${index}`),
          nameservers: Array.from({ length: 200 }, (_, index) => `ns-${index}.example.test`),
          fieldsTruncated: Array.from({ length: 64 }, (_, index) => `field-${index}`),
        },
      },
      availability: {
        applicable: true,
        domain: 'example.test',
        state: 'registered',
        pageIdentity: {
          ...profiles.pageIdentity,
          embeddedOrigins: Array.from({ length: 20 }, (_, index) => `https://embed-${index}.example.test`),
          contactDomains: Array.from({ length: 20 }, (_, index) => `contact-${index}.example.test`),
          forms: { externalActionOrigins: Array.from({ length: 10 }, (_, index) => `https://form-${index}.example.test`) },
          resources: { externalOrigins: Array.from({ length: 30 }, (_, index) => `https://asset-${index}.example.test`) },
          downloads: {
            riskyFileTypes: Array.from({ length: 20 }, (_, index) => `.type${index}`),
            externalOrigins: Array.from({ length: 20 }, (_, index) => `https://download-${index}.example.test`),
          },
        },
        securityPosture: {
          ...profiles.securityPosture,
          summary: {
            observed: MAX_SECURITY_POSTURE_FINDINGS,
            potentialExposure: 0,
            observedAbsence: 0,
            unavailable: 0,
          },
          findings: Array.from({ length: MAX_SECURITY_POSTURE_FINDINGS }, (_, index) => postureFinding(index)),
        },
      },
    });
    assert.equal(parseLookupHttpResponse(exact).ok, true);

    const invalid = [
      response({ rdap: { error: [Array(500).fill('nested')] } }),
      response({ availability: { applicable: true, domain: [Array(500).fill('nested')], state: 'registered' } }),
      response({ availability: { applicable: true, state: 'registered', dns: { status: [Array(500).fill('nested')] } } }),
      response({ rdap: { parsed: { statuses: Array(101).fill('status') } } }),
      response({ rdap: { parsed: { entitiesByRole: { registrant: [{ address: 'A'.repeat(1_001) }] } } } }),
      response({ rdap: { parsed: { redactions: [{ prePath: 'P'.repeat(513) }] } } }),
      response({ whois: { parsed: { nameservers: Array(201).fill('ns.example.test') } } }),
      response({ additive: Array(MAX_LOOKUP_RESPONSE_CONTAINER_ITEMS + 1).fill(null) }),
    ];
    for (const candidate of invalid) assert.equal(parseLookupHttpResponse(candidate).ok, false);

    for (const child of [
      {
        key: 'pageIdentity',
        value: { ...profiles.pageIdentity, resources: { ...profiles.pageIdentity.resources, externalOrigins: Array(31).fill('https://asset.example.test') } },
      },
      {
        key: 'securityPosture',
        value: { ...profiles.securityPosture, findings: Array.from({ length: MAX_SECURITY_POSTURE_FINDINGS + 1 }, (_, index) => postureFinding(index)) },
      },
    ]) {
      const parsed = parseLookupHttpResponse(response({
        availability: { applicable: true, state: 'registered', [child.key]: child.value },
      }));
      assert.equal(parsed.ok, true);
      assert.equal(recordValue(parsed.value.availability[child.key]).compatibility, 'malformed');
    }
  });

  test('accepts producer-shaped null page profiles and exact TLS distinguished-name bounds', () => {
    const withNullProfiles = response({
      availability: {
        applicable: true,
        domain: 'example.test',
        state: 'registered',
        pageIdentity: null,
        credentialSurfaceProfile: null,
        structuredDataIdentity: null,
        technologyProfile: null,
        pageRoleProfile: null,
        clientBehaviorProfile: null,
        securityPosture: null,
      },
    });
    assert.equal(parseLookupHttpResponse(withNullProfiles).ok, true);

    const exactNames = response({
      availability: {
        applicable: true,
        state: 'registered',
        tls: canonicalTlsProfile({
          certificate: {
            subject: { commonNames: ['C'.repeat(256)], organizations: ['O'.repeat(256)] },
          },
        }),
      },
    });
    assert.equal(parseLookupHttpResponse(exactNames).ok, true);
    const malformed = parseLookupHttpResponse(response({
      availability: {
        applicable: true,
        state: 'registered',
        tls: canonicalTlsProfile({ certificate: { subject: { commonNames: ['C'.repeat(257)] } } }),
      },
    }));
    assert.equal(malformed.ok, true);
    assert.equal(recordValue(malformed.value.availability.tls).compatibility, 'malformed');
  });

  test('fails closed for malformed and future nested profiles while retaining independent evidence', () => {
    const profiles = canonicalPageProfiles();
    const futureTechnology = { ...profiles.technologyProfile, profileVersion: 999 };
    const raw = response({
      availability: {
        applicable: true,
        domain: 'example.test',
        state: 'registered',
        pageIdentity: profiles.pageIdentity,
        technologyProfile: futureTechnology,
        securityPosture: profiles.securityPosture,
        tls: canonicalTlsProfile(),
      },
    });
    const before = structuredClone(raw);
    const first = parseLookupHttpResponse(raw);
    const second = parseLookupHttpResponse(raw);
    assert.equal(first.ok, true);
    assert.deepEqual(first, second);
    assert.deepEqual(raw, before);
    assert.notEqual(first.value, raw);
    assert.equal(first.value.availability.pageIdentity, profiles.pageIdentity);
    assert.equal(first.value.availability.securityPosture, profiles.securityPosture);
    assert.deepEqual(recordValue(first.value.availability.technologyProfile), {
      status: 'unsupported',
      source: 'derived',
      complete: false,
      truncated: false,
      compatibility: 'unsupported_version',
      limitations: ['Technology profile uses a newer unsupported version; its evidence was withheld.'],
      findings: [],
      browserLibraryProfile: null,
    });

    for (const technologyProfile of [
      { ...profiles.technologyProfile, status: 'unknown_status' },
      { ...profiles.technologyProfile, source: 'http' },
      { ...profiles.technologyProfile, findings: 'not-an-array' },
      { ...profiles.technologyProfile, findings: [{ ...profiles.technologyProfile.findings[0], name: 'x'.repeat(121) }] },
      { ...profiles.technologyProfile, findings: Array(25).fill(profiles.technologyProfile.findings[0]) },
      42,
    ]) {
      const parsed = parseLookupHttpResponse(response({
        availability: {
          applicable: true,
          domain: 'example.test',
          state: 'registered',
          pageIdentity: profiles.pageIdentity,
          technologyProfile,
        },
      }));
      assert.equal(parsed.ok, true);
      assert.equal(recordValue(parsed.value.availability.technologyProfile).compatibility, 'malformed');
      assert.equal(parsed.value.availability.pageIdentity, profiles.pageIdentity);
    }

    const futureLibrary = parseLookupHttpResponse(response({
      availability: {
        applicable: true,
        state: 'registered',
        technologyProfile: {
          ...profiles.technologyProfile,
          browserLibraryProfile: {
            ...requiredValue(profiles.technologyProfile.browserLibraryProfile),
            profileVersion: 999,
          },
        },
      },
    }));
    assert.equal(futureLibrary.ok, true);
    const retainedTechnology = recordValue(futureLibrary.value.availability.technologyProfile);
    assert.equal(arrayValue(retainedTechnology.findings).length > 0, true);
    assert.equal(recordValue(retainedTechnology.browserLibraryProfile).compatibility, 'unsupported_version');

    for (const [key, value] of [
      ['tls', { ...canonicalTlsProfile(), profileVersion: 999 }],
      ['securityPosture', { ...profiles.securityPosture, postureVersion: 999 }],
      ['pageIdentity', { ...profiles.pageIdentity, identityVersion: 999 }],
      ['credentialSurfaceProfile', { ...profiles.credentialSurfaceProfile, credentialSurfaceVersion: 999 }],
      ['structuredDataIdentity', { ...profiles.structuredDataIdentity, structuredDataVersion: 999 }],
      ['pageRoleProfile', { ...profiles.pageRoleProfile, pageRoleProfileVersion: 999 }],
      ['clientBehaviorProfile', { ...profiles.clientBehaviorProfile, clientBehaviorProfileVersion: 999 }],
    ] as const) {
      const parsed = parseLookupHttpResponse(response({
        availability: { applicable: true, state: 'registered', [key]: value },
      }));
      assert.equal(parsed.ok, true, key);
      assert.equal(recordValue(parsed.value.availability[key]).compatibility, 'unsupported_version', key);
    }

    const excessivelyNested = response({
      availability: {
        applicable: true,
        state: 'registered',
        technologyProfile: { ...profiles.technologyProfile, nested: nestedValue(MAX_BOUNDED_JSON_DEPTH + 1) },
      },
    });
    assert.equal(parseLookupHttpResponse(excessivelyNested).ok, false);
    assert.deepEqual(parseLookupHttpResponse(excessivelyNested), parseLookupHttpResponse(excessivelyNested));
  });

  test('withholds unowned nested profile fields instead of retaining them as current evidence', () => {
    const profiles = canonicalPageProfiles();
    const credential = structuredClone(profiles.credentialSurfaceProfile);
    recordValue(credential.inputs).unreviewed = { raw: 'x'.repeat(10_000) };
    const credentialResult = parseLookupHttpResponse(response({
      availability: {
        applicable: true,
        state: 'registered',
        pageIdentity: profiles.pageIdentity,
        credentialSurfaceProfile: credential,
      },
    }));
    assert.equal(credentialResult.ok, true);
    assert.equal(recordValue(credentialResult.value.availability.credentialSurfaceProfile).compatibility, 'malformed');
    assert.equal(credentialResult.value.availability.pageIdentity, profiles.pageIdentity);

    const pageIdentity = structuredClone(profiles.pageIdentity);
    recordValue(recordValue(pageIdentity.fingerprints).resourceHosts).unreviewed = ['raw-origin.example'];
    const pageResult = parseLookupHttpResponse(response({
      availability: { applicable: true, state: 'registered', pageIdentity },
    }));
    assert.equal(pageResult.ok, true);
    const retainedPage = recordValue(pageResult.value.availability.pageIdentity);
    assert.equal(recordValue(retainedPage.fingerprints).compatibility, 'malformed');
    assert.equal(retainedPage.openGraph, pageIdentity.openGraph);

    const tls = buildTlsObservation({
      cipher: { name: 'TLS_AES_128_GCM_SHA256', standardName: 'TLS_AES_128_GCM_SHA256', version: 'TLSv1.3' },
      peerCertificate: { subject: { CN: 'example.test' } },
      sniHost: 'example.test',
    }, { observedAt: '2026-07-13T04:05:06.000Z' });
    recordValue(tls.cipher).unreviewed = 'raw cipher data';
    const tlsResult = parseLookupHttpResponse(response({
      availability: { applicable: true, state: 'registered', tls },
    }));
    assert.equal(tlsResult.ok, true);
    assert.equal(recordValue(tlsResult.value.availability.tls).compatibility, 'malformed');

    const posture = structuredClone(profiles.securityPosture);
    recordValue(posture.findings[0]).unreviewed = { nested: true };
    const postureResult = parseLookupHttpResponse(response({
      availability: { applicable: true, state: 'registered', securityPosture: posture },
    }));
    assert.equal(postureResult.ok, true);
    assert.equal(recordValue(postureResult.value.availability.securityPosture).compatibility, 'malformed');

    const technology = structuredClone(profiles.technologyProfile);
    recordValue(recordValue(technology.browserLibraryProfile).catalog).unreviewed = 'raw catalogue value';
    const libraryResult = parseLookupHttpResponse(response({
      availability: { applicable: true, state: 'registered', technologyProfile: technology },
    }));
    assert.equal(libraryResult.ok, true);
    const retainedTechnology = recordValue(libraryResult.value.availability.technologyProfile);
    assert.ok(arrayValue(retainedTechnology.findings).length > 0);
    assert.equal(recordValue(retainedTechnology.browserLibraryProfile).compatibility, 'malformed');
  });

  test('rejects over-bound or malformed nested HTTP evidence with the stable response error', () => {
    const baseRedirect = {
      from: 'https://from.example.test/',
      to: 'https://to.example.test/',
      status: 302,
      queryOmitted: false,
    };
    const baseAttempt = {
      url: 'https://attempt.example.test/',
      outcome: 'error',
      httpStatus: null,
      error: 'Fixture connection failed.',
    };
    const invalidHttp = [
      boundedHttpEvidence({ redirects: Array.from({ length: MAX_HTTP_EVIDENCE_REDIRECTS + 1 }, () => baseRedirect), redirectCount: MAX_HTTP_EVIDENCE_REDIRECTS }),
      boundedHttpEvidence({ attempts: Array.from({ length: MAX_HTTP_ATTEMPTS + 1 }, () => baseAttempt) }),
      boundedHttpEvidence({ redirects: [null], redirectCount: 1 }),
      boundedHttpEvidence({ redirects: [{ ...baseRedirect, from: 'https://user:secret@from.example.test/' }], redirectCount: 1 }),
      boundedHttpEvidence({ redirects: [{ ...baseRedirect, to: 'file:///tmp/evidence' }], redirectCount: 1 }),
      boundedHttpEvidence({ redirects: [{ ...baseRedirect, to: `https://to.example.test/${'x'.repeat(MAX_HTTP_PROVENANCE_URL)}` }], redirectCount: 1 }),
      boundedHttpEvidence({ redirects: [{ ...baseRedirect, status: 99 }], redirectCount: 1 }),
      boundedHttpEvidence({ redirects: [{ ...baseRedirect, status: 600 }], redirectCount: 1 }),
      boundedHttpEvidence({ attempts: [{ ...baseAttempt, error: 'x'.repeat(MAX_HTTP_ERROR_LENGTH + 1) }] }),
      boundedHttpEvidence({ attempts: [{ ...baseAttempt, error: 'bad\nerror' }] }),
      boundedHttpEvidence({ limitations: Array.from({ length: MAX_OBSERVATION_LIMITATIONS + 1 }, () => 'Limit') }),
      boundedHttpEvidence({ limitations: ['x'.repeat(MAX_OBSERVATION_LIMITATION_LENGTH + 1)] }),
      boundedHttpEvidence({ limitations: ['bad\nlimitation'] }),
    ];

    for (const http of invalidHttp) {
      assert.deepEqual(parseLookupHttpResponse(response({
        availability: { applicable: true, state: 'registered', http },
      })), {
        ok: false,
        errorCode: INVALID_LOOKUP_RESPONSE,
        error: INVALID_LOOKUP_RESPONSE_MESSAGE,
      });
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
    const oversized: Record<string, unknown> = response();
    for (let index = 0; Object.keys(oversized).length <= MAX_LOOKUP_RESPONSE_TOP_LEVEL_KEYS; index += 1) {
      oversized[`extra${index}`] = index;
    }
    assert.equal(parseLookupHttpResponse(oversized).ok, false);
  });

  test('projects separately attributed evidence without mutating the response', () => {
    const profiles = canonicalPageProfiles();
    const raw = response({
      rdap: { parsed: { domain: 'EXAMPLE.TEST' }, registrarRdap: { parsed: { domain: 'EXAMPLE.TEST' } } },
      availability: {
        applicable: true,
        dns: { records: { a: ['192.0.2.1'] } },
        http: { response: { securityHeaders: { contentSecurityPolicy: 'default-src none' } } },
        tls: buildTlsObservation({
          peerCertificate: { subject: { CN: 'example.test' } },
          sniHost: 'example.test',
        }, { observedAt: '2026-07-13T04:05:06.000Z' }),
        pageIdentity: { ...profiles.pageIdentity, openGraph: { ...profiles.pageIdentity.openGraph, url: { url: 'https://example.test/', queryOmitted: false, pathTruncated: false } } },
        credentialSurfaceProfile: profiles.credentialSurfaceProfile,
        structuredDataIdentity: { ...profiles.structuredDataIdentity, entities: [{ types: ['Organization'], name: 'Example publisher', declaredOrigin: null, sameAsHosts: [] }] },
        technologyProfile: profiles.technologyProfile,
        securityPosture: profiles.securityPosture,
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
    assert.ok(isJsonObject(view.credentialSurfaceProfile.inputs));
    assert.equal(view.credentialSurfaceProfile.inputs.classifiedCount, 1);
    assert.ok(Array.isArray(view.structuredDataIdentity.entities));
    assert.ok(isJsonObject(view.structuredDataIdentity.entities[0]));
    assert.equal(view.structuredDataIdentity.entities[0].name, 'Example publisher');
    assert.equal(view.securityPostureSummary.observed, profiles.securityPosture.summary.observed);
    assert.equal(view.registryAccess.suffix, 'test');
    assert.equal(view.observedNetworkEndpoint.address, '192.0.2.1');
    assert.equal(view.reverseDns.source, 'reverse_dns');
    assert.deepEqual(view.reverseDnsRecords.ptr, ['ptr.example.test']);
    assert.deepEqual(raw, before);
  });

  test('bounds, filters, and de-duplicates provider records while preserving raw evidence', () => {
    const providerIds = ['urlscan_search', 'urlhaus_host', 'threatfox_domain_ioc'] as const;
    const providers: unknown[] = Array.from(
      { length: MAX_THREAT_INTELLIGENCE_PROVIDERS + 4 },
      (_, index) => ({
        schema: THREAT_INTELLIGENCE_SCHEMA,
        version: THREAT_INTELLIGENCE_CONTRACT_VERSION,
        provider: { id: providerIds[index % providerIds.length], label: `Provider ${index}` },
        target: THREAT_TARGET,
        state: 'success',
        findings: [],
        observation: { observedAt: '2026-07-01T00:00:00.000Z', limitations: [] },
      }),
    );
    providers.splice(2, 0, null, 'invalid');
    const threatIntelligence = { version: THREAT_INTELLIGENCE_ENVELOPE_VERSION, providers };
    const raw = response({ threatIntelligence });
    const parsed = parseLookupHttpResponse(raw);
    assert.equal(parsed.ok, true);

    const view = createLookupViewModel(parsed.value);
    assert.deepEqual(
      view.threatIntelligenceProviders.map((provider) => recordValue(provider.provider).id),
      [...providerIds],
    );
    assert.equal(threatIntelligence.providers.length, MAX_THREAT_INTELLIGENCE_PROVIDERS + 6);
  });

  test('keeps only the first separately attributed record for each provider', () => {
    const provider = (detail: string) => ({
      schema: THREAT_INTELLIGENCE_SCHEMA,
      version: THREAT_INTELLIGENCE_CONTRACT_VERSION,
      provider: { id: 'urlhaus_host', label: 'Untrusted wire label' },
      target: THREAT_TARGET,
      state: 'not_found',
      detail,
      findings: [],
      observation: { observedAt: '2026-07-01T00:00:00.000Z', limitations: [] },
    });
    const parsed = parseLookupHttpResponse(response({
      threatIntelligence: { version: 1, providers: [provider('First'), provider('Second'), provider('Third')] },
    }));
    assert.equal(parsed.ok, true);

    const view = createLookupViewModel(parsed.value);
    assert.equal(view.threatIntelligenceProviders.length, 1);
    assert.equal(view.threatIntelligenceProviders[0]?.detail, 'First');
    assert.equal(
      recordValue(view.threatIntelligenceProviders[0]?.provider).label,
      'URLhaus malware-host records',
    );
  });

  test('bounds nested provider evidence and permits only attributed HTTPS record links', () => {
    const rawProvider = {
      schema: THREAT_INTELLIGENCE_SCHEMA,
      version: THREAT_INTELLIGENCE_CONTRACT_VERSION,
      provider: { id: 'urlscan_search', label: `Provider ${'x'.repeat(300)}` },
      target: THREAT_TARGET,
      state: 'success',
      detail: 'd'.repeat(900),
      findings: [
        {
          id: 'valid',
          category: 'phishing',
          providerVerdict: 'review',
          referenceUrl: 'https://urlscan.io/result/11111111-1111-4111-8111-111111111111/',
        },
        { id: 'script', category: 'malware', referenceUrl: 'javascript:alert(1)' },
        { id: 'wrong-host', category: 'spam', referenceUrl: 'https://unrelated.invalid/record' },
        ...Array.from({ length: MAX_THREAT_INTELLIGENCE_FINDINGS + 4 }, (_, index) => ({ id: `finding-${index}`, category: 'unknown' })),
      ],
      observation: {
        observedAt: '2026-07-01T00:00:00.000Z',
        limitations: Array.from({ length: MAX_THREAT_INTELLIGENCE_LIMITATIONS + 4 }, (_, index) => `Limit ${index}`),
      },
    };
    const threatIntelligence = { version: 1, providers: [rawProvider, { provider: { id: 'unknown' }, state: 'success' }] };
    const parsed = parseLookupHttpResponse(response({ threatIntelligence }));
    assert.equal(parsed.ok, true);

    const view = createLookupViewModel(parsed.value);
    assert.equal(view.threatIntelligenceProviders.length, 1);
    const provider = requiredValue(view.threatIntelligenceProviders[0]);
    assert.equal(recordValue(provider.provider).label, 'URLscan archived verdicts');
    assert.equal(String(provider.detail).length, 500);
    const findings = arrayValue(provider.findings);
    assert.equal(findings.length, MAX_THREAT_INTELLIGENCE_FINDINGS);
    assert.equal(recordValue(findings[0]).referenceUrl, 'https://urlscan.io/result/11111111-1111-4111-8111-111111111111/');
    assert.equal(recordValue(findings[1]).referenceUrl, null);
    assert.equal(recordValue(findings[2]).referenceUrl, null);
    assert.equal(arrayValue(recordValue(provider.observation).limitations).length, MAX_THREAT_INTELLIGENCE_LIMITATIONS);
    assert.equal(rawProvider.findings.length, MAX_THREAT_INTELLIGENCE_FINDINGS + 7);
  });

  test('does not host-normalize zone-less threat-intelligence wire timestamps', () => {
    const parsed = parseLookupHttpResponse(response({
      threatIntelligence: {
        version: 1,
        providers: [{
          schema: THREAT_INTELLIGENCE_SCHEMA,
          version: THREAT_INTELLIGENCE_CONTRACT_VERSION,
          provider: { id: 'urlscan_search', label: 'Wire label' },
          target: THREAT_TARGET,
          state: 'success',
          findings: [{ id: 'fixture', category: 'phishing', firstObservedAt: '2026-07-01T12:00:00.000', lastObservedAt: '2026-07-01T12:00:00.000+01:00' }],
          observation: { observedAt: '2026-07-01T12:00:00.000', limitations: [] },
        }],
      },
    }));
    assert.equal(parsed.ok, true);
    const provider = requiredValue(createLookupViewModel(parsed.value).threatIntelligenceProviders[0]);
    assert.equal(recordValue(provider.observation).observedAt, null);
    assert.equal(recordValue(arrayValue(provider.findings)[0]).firstObservedAt, null);
    assert.equal(recordValue(arrayValue(provider.findings)[0]).lastObservedAt, '2026-07-01T11:00:00.000Z');
  });

  test('retains every explicit provider result state without inventing disabled evidence', () => {
    const states = [...THREAT_INTELLIGENCE_RESULT_STATES];
    for (const [index, state] of states.entries()) {
      const parsed = parseLookupHttpResponse(response({
        threatIntelligence: {
          version: 1,
          providers: [{
            schema: THREAT_INTELLIGENCE_SCHEMA,
            version: THREAT_INTELLIGENCE_CONTRACT_VERSION,
            provider: { id: 'urlscan_search', label: `Provider ${index}` },
            target: THREAT_TARGET,
            state,
            findings: state === 'partial'
              ? [{ id: 'bounded', category: 'suspicious', detail: 'Retained partial finding' }]
              : [],
            observation: {
              observedAt: `2026-07-01T00:0${index}:00.000Z`,
              limitations: state === 'partial' ? ['The provider result was truncated.'] : [],
            },
          }],
        },
      }));
      assert.equal(parsed.ok, true);

      const provider = requiredValue(createLookupViewModel(parsed.value).threatIntelligenceProviders[0]);
      assert.equal(provider.state, state);
      if (state === 'partial') {
        assert.equal(recordValue(arrayValue(provider.findings)[0]).detail, 'Retained partial finding');
        assert.deepEqual(arrayValue(recordValue(provider.observation).limitations), ['The provider result was truncated.']);
      }
    }

    const invalid = parseLookupHttpResponse(response({
      threatIntelligence: {
        version: 1,
        providers: [{
          schema: THREAT_INTELLIGENCE_SCHEMA,
          version: THREAT_INTELLIGENCE_CONTRACT_VERSION,
          provider: { id: 'urlscan_search', label: 'Invalid state' },
          target: THREAT_TARGET,
          state: 'disabled',
          findings: [],
          observation: { observedAt: '2026-07-01T00:09:00.000Z', limitations: [] },
        }],
      },
    }));
    assert.equal(invalid.ok, true);
    assert.deepEqual(createLookupViewModel(invalid.value).threatIntelligenceProviders, []);
  });

  test('rejects wrong or future threat-intelligence result markers before projection', () => {
    const provider = {
      schema: THREAT_INTELLIGENCE_SCHEMA,
      version: THREAT_INTELLIGENCE_CONTRACT_VERSION,
      provider: { id: 'urlscan_search', label: 'Wire label' },
      target: THREAT_TARGET,
      state: 'success',
      findings: [],
      observation: { observedAt: '2026-07-01T00:00:00.000Z', limitations: [] },
    };
    for (const changed of [
      { ...provider, schema: 'whoisleuth.unsupported-result' },
      { ...provider, version: THREAT_INTELLIGENCE_CONTRACT_VERSION + 1 },
      (({ schema: _schema, ...rest }) => rest)(provider),
    ]) {
      const parsed = parseLookupHttpResponse(response({
        threatIntelligence: { version: 1, providers: [changed] },
      }));
      assert.equal(parsed.ok, true);
      assert.deepEqual(createLookupViewModel(parsed.value).threatIntelligenceProviders, []);
    }
  });

  test('binds projected threat intelligence to the current registrable domain and envelope version', () => {
    const provider = {
      schema: THREAT_INTELLIGENCE_SCHEMA,
      version: THREAT_INTELLIGENCE_CONTRACT_VERSION,
      provider: { id: 'urlscan_search', label: 'Wire label' },
      target: THREAT_TARGET,
      state: 'success',
      findings: [],
      observation: { observedAt: '2026-07-01T00:00:00.000Z', limitations: [] },
    };
    const parsedValid = parseLookupHttpResponse(response({
      threatIntelligence: { version: THREAT_INTELLIGENCE_ENVELOPE_VERSION, providers: [provider] },
    }));
    assert.equal(parsedValid.ok, true);
    const valid = createLookupViewModel(parsedValid.value);
    assert.equal(valid.threatIntelligenceProviders.length, 1);
    assert.deepEqual(recordValue(valid.threatIntelligenceProviders[0]?.target), THREAT_TARGET);
    assert.equal(valid.threatIntelligence.version, THREAT_INTELLIGENCE_ENVELOPE_VERSION);

    for (const threatIntelligence of [
      { version: THREAT_INTELLIGENCE_ENVELOPE_VERSION + 1, providers: [provider] },
      { version: THREAT_INTELLIGENCE_ENVELOPE_VERSION, providers: [(({ target: _target, ...rest }) => rest)(provider)] },
      { version: THREAT_INTELLIGENCE_ENVELOPE_VERSION, providers: [{ ...provider, target: { ...THREAT_TARGET, value: 'other.example' } }] },
      { version: THREAT_INTELLIGENCE_ENVELOPE_VERSION, providers: [{ ...provider, target: { ...THREAT_TARGET, value: 'portal.example.test' } }] },
      { version: THREAT_INTELLIGENCE_ENVELOPE_VERSION, providers: [{ ...provider, target: { ...THREAT_TARGET, exposure: 'hostname' } }] },
      { version: THREAT_INTELLIGENCE_ENVELOPE_VERSION, providers: [{ ...provider, target: { ...THREAT_TARGET, value: 'EXAMPLE.TEST' } }] },
    ]) {
      const parsed = parseLookupHttpResponse(response({ threatIntelligence }));
      assert.equal(parsed.ok, true);
      const view = createLookupViewModel(parsed.value);
      assert.deepEqual(view.threatIntelligenceProviders, []);
      assert.deepEqual(view.threatIntelligence, {});
    }
  });

  test('binds the response identity to the current domain and rejects reversed threat finding timelines', () => {
    const provider = {
      schema: THREAT_INTELLIGENCE_SCHEMA,
      version: THREAT_INTELLIGENCE_CONTRACT_VERSION,
      provider: { id: 'urlscan_search', label: 'Wire label' },
      target: THREAT_TARGET,
      state: 'success',
      findings: [{
        id: 'reversed',
        category: 'phishing',
        firstObservedAt: '2026-07-20T00:00:00.000Z',
        lastObservedAt: '2026-07-12T00:00:00.000Z',
      }],
      observation: { observedAt: '2026-07-21T00:00:00.000Z', limitations: [] },
    };
    const parsed = parseLookupHttpResponse(response({
      query: 'Portal.Example.Test.',
      threatIntelligence: { version: THREAT_INTELLIGENCE_ENVELOPE_VERSION, providers: [provider] },
    }));
    assert.equal(parsed.ok, true);
    const view = createLookupViewModel(parsed.value);
    assert.equal(view.threatIntelligenceProviders.length, 1);
    assert.deepEqual(recordValue(view.threatIntelligenceProviders[0]?.target), THREAT_TARGET);
    assert.deepEqual(arrayValue(view.threatIntelligenceProviders[0]?.findings), []);

    for (const changed of [
      response({ registrableDomain: 'other.test' }),
      response({ availability: { applicable: true, domain: 'portal.example.test', state: 'registered' } }),
      response({ inputHostname: 'portal.other.test' }),
      response({ isSubdomain: false }),
    ]) {
      assert.equal(parseLookupHttpResponse(changed).ok, false);
    }
  });

  test('uses the same ICANN registrable boundary as collection for private-suffix hosts', () => {
    const target = { type: 'domain', value: 'github.io', exposure: 'registrable_domain' };
    const parsed = parseLookupHttpResponse(response({
      query: 'tenant.github.io',
      inputHostname: 'tenant.github.io',
      registrableDomain: 'github.io',
      isSubdomain: true,
      availability: { applicable: true, domain: 'github.io', state: 'registered' },
      threatIntelligence: {
        version: THREAT_INTELLIGENCE_ENVELOPE_VERSION,
        providers: [{
          schema: THREAT_INTELLIGENCE_SCHEMA,
          version: THREAT_INTELLIGENCE_CONTRACT_VERSION,
          provider: { id: 'urlscan_search', label: 'Wire label' },
          target,
          state: 'success',
          findings: [],
          observation: { observedAt: '2026-07-21T00:00:00.000Z', limitations: [] },
        }],
      },
    }));
    assert.equal(parsed.ok, true);
    assert.deepEqual(recordValue(createLookupViewModel(parsed.value).threatIntelligenceProviders[0]?.target), target);
  });

  test('binds convenient URL and host-port queries to the classifier domain identity', () => {
    for (const query of [
      'https://Portal.Example.Test./review/path?fixture=1',
      'Portal.Example.Test:443',
    ]) {
      const parsed = parseLookupHttpResponse(response({ query }));
      assert.equal(parsed.ok, true, query);
      const accepted = recordValue(parsed.value);
      assert.equal(accepted.inputHostname, 'portal.example.test');
      assert.equal(accepted.registrableDomain, 'example.test');
    }
  });

  test('builds the same additive HTTP envelope for domain and non-domain results', () => {
    const domain = createLookupHttpResponse(
      'portal.example.test',
      {
        type: 'domain', inputHostname: 'portal.example.test',
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
      { type: 'ipv4' },
      { rdap: {}, whois: {}, availability: {}, diagnostics: {} },
    );
    assert.equal(ip.type, 'ipv4');
    assert.equal(ip.inputHostname, undefined);
    assert.equal(ip.registrableDomain, undefined);
  });

  test('sanitizes and bounds server error text before display', () => {
    const message = lookupHttpErrorMessage({ error: `upstream\n\u009b\u202e${'x'.repeat(400)}` }, 502);
    assert.equal(message.includes('\n'), false);
    assert.doesNotMatch(message, /[\u007f-\u009f]|\p{Default_Ignorable_Code_Point}/u);
    assert.equal(message.length, MAX_LOOKUP_RESPONSE_ERROR_LENGTH);
    assert.equal(lookupHttpErrorMessage({}, 503), 'Lookup failed (503)');
  });
});

describe('compact Bulk Lookup HTTP response contract', () => {
  test('accepts the metadata envelope added by the shared HTTP response adapter', () => {
    const raw = createLookupHttpResponse(
      'portal.example.test',
      {
        type: 'domain',
        inputHostname: 'portal.example.test',
        registrableDomain: 'example.test',
        isSubdomain: true,
      },
      compactResponse(),
    );
    const parsed = parseCompactLookupHttpResponse(raw, 'portal.example.test');

    assert.equal(parsed.ok, true);
    assert.equal(parsed.value, raw);
  });

  test('accepts current bounded compact evidence without copying or mutation', () => {
    const raw = compactResponse({
      availability: {
        applicable: true,
        domain: 'example.test',
        state: 'unknown',
        confidence: 'low',
        deepScanComplete: false,
        bulkComparison: {
          version: 1,
          technology: {
            state: 'success',
            ids: ['shop-platform', 'web-framework'],
            truncated: false,
          },
          tls: {
            state: 'partial',
            issuerLabel: 'Example Issuing CA',
            spkiSha256: 'a'.repeat(64),
          },
        },
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
    const oversizedAvailability: Record<string, unknown> = compactResponse().availability;
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
      compactResponse({
        availability: {
          ...compactResponse().availability,
          bulkComparison: {
            version: 2,
            technology: { state: 'success', ids: [], truncated: false },
            tls: { state: 'success', issuerLabel: null, spkiSha256: null },
          },
        },
      }),
      compactResponse({
        availability: {
          ...compactResponse().availability,
          bulkComparison: {
            version: 1,
            technology: {
              state: 'success',
              ids: Array.from({ length: 13 }, (_, index) => `technology-${index}`),
              truncated: true,
            },
            tls: { state: 'success', issuerLabel: null, spkiSha256: null },
          },
        },
      }),
      compactResponse({
        availability: {
          ...compactResponse().availability,
          bulkComparison: {
            version: 1,
            technology: { state: 'future', ids: [], truncated: false },
            tls: { state: 'success', issuerLabel: null, spkiSha256: 'not-a-digest' },
          },
        },
      }),
      compactResponse({ diagnostics: { ...compactResponse().diagnostics, version: 8 } }),
      compactResponse({
        diagnostics: {
          ...compactResponse().diagnostics,
          availability: { status: 'future_status' },
        },
      }),
      compactResponse({ query: 'other.test' }),
      compactResponse({ type: 'ipv4' }),
      compactResponse({ inputHostname: 'other.test' }),
      compactResponse({ registrableDomain: 'other.test' }),
      compactResponse({ isSubdomain: 'yes' }),
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

  test('rejects rich homepage metadata at the compact boundary', () => {
    for (const availabilityValue of [
      {
        ...compactResponse().availability,
        pageIdentity: { publicationMetadata: pagePublicationMetadataFixture() },
      },
      {
        ...compactResponse().availability,
        http: { response: { deliveryMetadata: httpDeliveryMetadataFixture() } },
      },
    ]) {
      assert.equal(parseCompactLookupHttpResponse(compactResponse({ availability: availabilityValue }), 'example.test').ok, false);
    }
  });
});
