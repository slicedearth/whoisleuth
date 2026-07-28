import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_LOOKUP_READABLE_REPORT_BYTES,
  buildLookupReadableReport,
  lookupReadableReportFilename,
  projectLookupForReadableReport,
} from '../lib/lookup-readable-report.mts';
import {
  isJsonObject,
  type JsonObject,
  type LookupHttpResponse,
} from '../lib/lookup-response-contract.mts';

function lookupResponse(overrides: Partial<LookupHttpResponse> = {}): LookupHttpResponse {
  return {
    query: 'report.example.test',
    type: 'domain',
    inputHostname: 'report.example.test',
    registrableDomain: 'example.test',
    isSubdomain: true,
    rdap: {
      rdapServer: 'https://rdap.example.test/domain/example.test',
      transportSecurity: 'https',
      upstreamStatus: 200,
      fetchedAt: '2026-07-26T01:02:03.000Z',
      data: { rawRegistryMarker: 'must-not-enter-readable-report' },
      parsed: {
        domain: 'EXAMPLE.TEST',
        handle: 'REGISTRY-1',
        registrar: { name: 'Example Registrar', privateField: 'omit-me' },
        lifecycle: { createdDate: '2025-01-01', expiryDate: '2030-01-01' },
        statuses: ['active'],
        nameservers: ['ns1.example.test'],
        serverTruncated: true,
        entitiesByRole: {
          registrant: [{ emails: ['private-contact@example.test'] }],
        },
      },
      registrarRdap: {
        status: 'success',
        endpoint: 'https://registrar.example.test/domain/example.test',
        upstreamStatus: 200,
        parsed: {
          domain: 'example.test',
          handle: 'REGISTRAR-1',
          registrar: { name: 'EXAMPLE REGISTRAR' },
          lifecycle: { createdDate: '2025-01-01', expiryDate: '2031-01-01' },
          statuses: ['active'],
          nameservers: ['NS1.EXAMPLE.TEST.'],
          entitiesByRole: {
            abuse: [{ emails: ['registrar-contact@example.test'] }],
          },
        },
      },
    },
    whois: {
      parsed: {
        domainName: 'EXAMPLE.TEST',
        registrar: 'Example Registrar',
        createdDate: '2025-01-01',
        chainStatus: 'partial',
        nameservers: ['ns1.example.test'],
      },
      chain: [{
        queriedAt: '2026-07-26T01:02:04.000Z',
        response: 'Registrant Email: whois-contact@example.test',
      }],
    },
    availability: {
      applicable: true,
      state: 'registered',
      confidence: 'medium',
      detail: 'Registry evidence supports a registered assessment.',
      deepScanComplete: false,
      dns: {
        status: 'partial',
        observedAt: '2026-07-26T01:02:05.000Z',
        records: {
          soa: [{
            nsname: 'ns1.example.test',
            hostmaster: 'hostmaster.example.test',
            serial: 2026072601,
            refresh: 3600,
            retry: 600,
            expire: 1_209_600,
            minttl: 300,
            privateField: 'must-not-enter-readable-report',
          }],
        },
      },
      http: { status: 'unavailable' },
      tls: { status: 'partial' },
    },
    networkContext: {
      contextVersion: 1,
      version: 1,
      status: 'partial',
      complete: false,
      truncated: true,
      limitations: ['One bounded network record was omitted.'],
      endpoint: { address: '192.0.2.20', family: 4, selectedFrom: 'dns_a' },
      rdap: { data: { rawNetworkMarker: 'must-not-enter-readable-report' } },
      network: { name: 'Example network', holder: 'Example holder', cidrs: ['192.0.2.0/24'] },
    },
    diagnostics: {
      version: 8,
      privateDiagnostic: 'must-not-enter-readable-report',
      rdap: { status: 'success', registrar: { status: 'success' } },
      whois: { status: 'partial' },
      availability: { status: 'complete' },
    },
    ...overrides,
  };
}

function object(value: unknown): JsonObject {
  assert.ok(isJsonObject(value));
  return value;
}

describe('browser-local readable Lookup report', () => {
  test('projects known normalized evidence before formatting and does not mutate the response', () => {
    const source = lookupResponse();
    const before = structuredClone(source);
    const projected = projectLookupForReadableReport(source);
    const serialized = JSON.stringify(projected);

    assert.equal(serialized.includes('rawRegistryMarker'), false);
    assert.equal(serialized.includes('private-contact@example.test'), false);
    assert.equal(serialized.includes('registrar-contact@example.test'), false);
    assert.equal(serialized.includes('whois-contact@example.test'), false);
    assert.equal(serialized.includes('privateDiagnostic'), false);
    assert.equal(serialized.includes('rawNetworkMarker'), false);
    assert.equal(serialized.includes('REGISTRAR-1'), false);
    assert.equal(serialized.includes('must-not-enter-readable-report'), false);
    const availability = object(projected.availability);
    const dns = object(availability.dns);
    const records = object(dns.records);
    assert.ok(Array.isArray(records.soa));
    const soa = object(records.soa[0]);
    assert.equal(soa.nsname, 'ns1.example.test');
    assert.equal(soa.serial, 2026072601);
    assert.deepEqual(source, before);
  });

  test('renders bounded source health, Risk explanation, truncation, and limitations without private fields', () => {
    const source = lookupResponse();
    const report = buildLookupReadableReport(source, {
      generatedAt: '2026-07-26T02:00:00.000Z',
      risk: {
        modelVersion: 6,
        score: 42,
        factors: [{
          label: 'Hostile [factor](https://untrusted.example) <script>alert(1)</script>',
          delta: 15,
        }],
      },
    });

    assert.match(report, /^# Lookup evidence report/u);
    assert.match(report, /Generated:\*\* 2026\\-07\\-26T02\\:00\\:00\\\.000Z/u);
    assert.match(report, /Risk score:\*\* 42\/100/u);
    assert.match(report, /Risk model:\*\* v6/u);
    assert.match(report, /Risk factors:\*\* Hostile/u);
    assert.match(report, /Source status:\*\* Partial/u);
    assert.match(report, /### Registrar RDAP/u);
    assert.match(report, /## Registry interpretation/u);
    assert.match(report, /Lifecycle:\*\* Registered/u);
    assert.match(report, /Registry RDAP disclosure:\*\* Unavailable/u);
    assert.match(report, /registrar\\\.example\\\.test\/domain\/example\\\.test/u);
    assert.match(report, /Server-declared truncation:\*\* Yes/u);
    assert.match(report, /Truncated response:\*\* Yes/u);
    assert.match(report, /One bounded network record was omitted/u);
    assert.match(report, /SOA primary server:\*\* ns1\\\.example\\\.test/u);
    assert.match(report, /SOA serial:\*\* 2026072601/u);
    assert.match(report, /heuristic review priority/u);
    assert.doesNotMatch(report, /must-not-enter-readable-report/u);
    assert.doesNotMatch(report, /contact@example\.test/u);
    assert.doesNotMatch(report, /REGISTRAR-1/u);
    assert.doesNotMatch(report, /<script>|\]\(https:\/\//iu);
    assert.ok(new TextEncoder().encode(report).byteLength <= MAX_LOOKUP_READABLE_REPORT_BYTES);
  });

  test('uses a deterministic safe filename', () => {
    assert.equal(
      lookupReadableReportFilename(
        lookupResponse({ registrableDomain: '../Unsafe Name.example.test' }),
        Date.parse('2026-07-26T03:04:05.006Z'),
      ),
      'whoisleuth-lookup-report-unsafe-name.example.test-2026-07-26T03-04-05-006Z.md',
    );
  });

  test('renders a bounded IP report with registration, reverse-DNS, and source health', () => {
    const source = lookupResponse({
      query: '192.0.2.8',
      type: 'ipv4',
      inputHostname: '',
      registrableDomain: '',
      isSubdomain: false,
      rdap: {
        rdapServer: 'https://rdap.example.test/ip/192.0.2.8?discard=this',
        transportSecurity: 'https',
        upstreamStatus: 200,
        fetchedAt: '2026-07-29T01:02:03.000Z',
        data: { raw: 'excluded' },
        parsed: {
          handle: 'NET-192-0-2-0-1',
          name: 'Example Network',
          startAddress: '192.0.2.0',
          endAddress: '192.0.2.255',
          cidrs: ['192.0.2.0/24'],
          cidrsTruncated: false,
          country: 'AU',
          networkType: 'DIRECT ALLOCATION',
          statuses: ['active'],
          lifecycle: {
            createdDateIso: '2001-02-03T04:05:06.000Z',
            updatedDateIso: '2024-05-06T07:08:09.000Z',
          },
          entitiesByRole: { registrant: [{ emails: ['private@example.test'] }] },
        },
      },
      reverseDns: {
        version: 1,
        status: 'partial',
        observedAt: '2026-07-29T01:02:04.000Z',
        scanMode: 'deep',
        complete: false,
        truncated: true,
        limitations: ['One PTR answer was omitted.'],
        records: { ptr: ['edge.example.test'] },
        raw: 'excluded',
      },
      diagnostics: {
        version: 8,
        rdap: { status: 'success' },
        whois: { status: 'unsupported' },
        availability: { status: 'not_applicable' },
        reverseDns: { status: 'partial' },
      },
    });
    const projected = projectLookupForReadableReport(source);
    const report = buildLookupReadableReport(source, {
      generatedAt: '2026-07-29T02:00:00.000Z',
    });

    assert.match(report, /^# IP evidence report/u);
    assert.match(report, /192\\\.0\\\.2\\\.0 to 192\\\.0\\\.2\\\.255/u);
    assert.match(report, /192\\\.0\\\.2\\\.0\/24/u);
    assert.match(report, /edge\\\.example\\\.test/u);
    assert.match(report, /Reverse DNS:\*\* partial/u);
    assert.match(report, /WHOIS:\*\* unsupported/u);
    assert.match(report, /One PTR answer was omitted/u);
    assert.equal(JSON.stringify(projected).includes('private@example.test'), false);
    assert.equal(JSON.stringify(projected).includes('"raw"'), false);
    assert.doesNotMatch(report, /private@example\.test|discard=this/u);
  });

  test('renders a bounded ASN report without inventing reverse-DNS context', () => {
    const source = lookupResponse({
      query: 'AS64496',
      type: 'asn',
      inputHostname: '',
      registrableDomain: '',
      isSubdomain: false,
      rdap: {
        upstreamStatus: 200,
        fetchedAt: '2026-07-29T01:02:03.000Z',
        parsed: {
          handle: 'AS64496',
          name: 'Example Autonomous System',
          startAutnum: 64496,
          endAutnum: 64500,
          country: 'AU',
          autnumType: 'DIRECT ALLOCATION',
          statuses: ['active'],
          lifecycle: {
            createdDate: '2003-04-05T06:07:08Z',
            updatedDate: '2024-05-06T07:08:09Z',
          },
          entitiesByRole: { abuse: [{ emails: ['private@example.test'] }] },
        },
      },
      diagnostics: {
        version: 8,
        rdap: { status: 'partial' },
        whois: { status: 'unavailable' },
        availability: { status: 'not_applicable' },
      },
    });
    const report = buildLookupReadableReport(source, {
      generatedAt: '2026-07-29T02:00:00.000Z',
    });

    assert.match(report, /^# ASN evidence report/u);
    assert.match(report, /64496 to 64500/u);
    assert.match(report, /DIRECT ALLOCATION/u);
    assert.match(report, /RDAP:\*\* partial/u);
    assert.match(report, /WHOIS:\*\* unavailable/u);
    assert.doesNotMatch(report, /Reverse DNS context|private@example\.test/u);
  });
});
