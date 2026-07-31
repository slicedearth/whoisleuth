import assert from 'node:assert/strict';
import test from 'node:test';
import { checkDomainAvailability } from '../lib/availability.mts';
import type { collectDnsIntelligence } from '../lib/dns-intelligence.mts';
import { networkFeaturePolicy } from '../lib/feature-policy.mts';
import { recordValue, stringValue } from './value-assertions.mts';

async function availability(domain: string, options: unknown): Promise<Record<string, unknown>> {
  return recordValue(await checkDomainAvailability(
    domain,
    options as Parameters<typeof checkDomainAvailability>[1],
  ));
}

test('disabled DNS and website probes produce skipped unknown evidence without network calls', async () => {
  let dnsCalls = 0;
  let delegationCalls = 0;
  let homepageCalls = 0;
  let faviconCalls = 0;
  let tlsCalls = 0;
  const result = await availability('example.com', {
    featurePolicy: networkFeaturePolicy({
      WHOISLEUTH_DISABLE_DNS_INTELLIGENCE: '1',
      WHOISLEUTH_DISABLE_WEBSITE_PROBE: '1',
      WHOISLEUTH_DISABLE_TLS_INTELLIGENCE: '1',
    }),
    rdapRecord: {
      rdapServer: 'https://rdap.example/domain/example.com',
      upstreamStatus: 200,
      parsed: {
        domain: 'EXAMPLE.COM',
        statuses: [],
        nameservers: [],
        registrar: { name: 'Example Registrar' },
        registrant: null,
        abuse: null,
        events: [],
        lifecycle: {},
        dnssec: null,
      },
    },
    resolveNs: async () => { delegationCalls += 1; throw new Error('must not run'); },
    collectDnsIntelligence: async () => { dnsCalls += 1; throw new Error('must not run'); },
    fetchHomepage: async () => { homepageCalls += 1; throw new Error('must not run'); },
    fetchFaviconHash: async () => { faviconCalls += 1; throw new Error('must not run'); },
    collectTlsIntelligence: async () => { tlsCalls += 1; throw new Error('must not run'); },
  });

  assert.equal(dnsCalls, 0);
  assert.equal(delegationCalls, 0);
  assert.equal(homepageCalls, 0);
  assert.equal(faviconCalls, 0);
  assert.equal(tlsCalls, 0);
  assert.equal(result.state, 'registered');
  assert.equal(result.activityStatus, 'unknown');
  assert.equal(result.websiteProbeStatus, 'skipped');
  assert.equal(recordValue(result.http).status, 'skipped');
  assert.equal(result.deepScanComplete, false);
  assert.match(stringValue(result.websiteProbeDetail), /disabled by deployment policy/i);
  assert.equal(recordValue(result.dns).status, 'skipped');
  assert.equal(recordValue(result.dns).complete, false);
  assert.equal(recordValue(result.tls).status, 'skipped');
  assert.equal(recordValue(result.tls).complete, false);
  assert.equal(result.hasMx, null);
  assert.equal(result.hasSpf, null);
  assert.equal(result.hasDmarc, null);
});

test('a disabled registry source prevents otherwise successful deep evidence being marked complete', async () => {
  const result = await availability('example.com', {
    featurePolicy: networkFeaturePolicy({ WHOISLEUTH_DISABLE_WHOIS: '1' }),
    rdapRecord: {
      rdapServer: 'https://rdap.example/domain/example.com',
      upstreamStatus: 200,
      parsed: {
        domain: 'EXAMPLE.COM',
        statuses: [],
        nameservers: ['NS1.EXAMPLE.COM'],
        registrar: { name: 'Example Registrar' },
        registrant: null,
        abuse: null,
        events: [],
        lifecycle: {},
        dnssec: null,
      },
    },
    collectDnsIntelligence: async () => ({
      status: 'complete',
      complete: true,
      records: { a: [], aaaa: [], cname: [], ns: ['ns1.example.com'], mx: [], spf: [], dmarc: [], caa: [] },
      hasMx: false,
      hasNullMx: false,
      mxHosts: [],
      hasSpf: false,
      hasDmarc: false,
    }),
    fetchHomepage: async () => ({ text: '<title>Example</title>', status: 'active', detail: 'Homepage responded.' }),
    fetchFaviconHash: async () => null,
    collectTlsIntelligence: async () => ({
      version: 1,
      status: 'success',
      source: 'tls',
      complete: true,
      certificate: { fingerprintSha256: 'a'.repeat(64) },
    }),
  });

  assert.equal(result.state, 'registered');
  assert.equal(result.websiteProbeStatus, 'active');
  assert.equal(result.deepScanComplete, false);
  assert.equal(recordValue(result.tls).status, 'success');
});

test('deep DNS collection receives the bounded registry publication without another RDAP request', async () => {
  const parsedRegistry = {
    domain: 'EXAMPLE.COM',
    statuses: [],
    nameservers: ['NS1.EXAMPLE.COM'],
    nameserverDetails: [{ name: 'NS1.EXAMPLE.COM', addresses: ['192.0.2.53'] }],
    delegationSigned: true,
    dsData: [{ keyTag: 1, algorithm: 13, digestType: 2, digest: 'aa' }],
    registrar: { name: 'Example Registrar' },
    registrant: null,
    abuse: null,
    events: [],
    lifecycle: {},
    dnssec: 'signed',
  };
  let dnsCalls = 0;
  await availability('example.com', {
    includeExtendedDnsContext: true,
    featurePolicy: networkFeaturePolicy({
      WHOISLEUTH_DISABLE_WHOIS: '1',
      WHOISLEUTH_DISABLE_WEBSITE_PROBE: '1',
      WHOISLEUTH_DISABLE_TLS_INTELLIGENCE: '1',
    }),
    rdapRecord: {
      upstreamStatus: 200,
      parsed: parsedRegistry,
    },
    collectDnsIntelligence: async (
      _domain: string,
      options: Parameters<typeof collectDnsIntelligence>[1],
    ) => {
      dnsCalls += 1;
      assert.equal(options?.includeExtendedContext, true);
      assert.equal(options?.registryEvidence, parsedRegistry);
      return {
        status: 'success',
        complete: true,
        records: { a: [], aaaa: [], cname: [], ns: ['ns1.example.com'], mx: [], spf: [], dmarc: [], caa: [] },
        hasMx: false,
        hasNullMx: false,
        mxHosts: [],
        hasSpf: false,
        hasDmarc: false,
      };
    },
  });

  assert.equal(dnsCalls, 1);
});

test('enabled TLS intelligence runs once in parallel and remains explicit in deep evidence', async () => {
  let tlsCalls = 0;
  const result = await availability('example.com', {
    featurePolicy: networkFeaturePolicy({
      WHOISLEUTH_DISABLE_WHOIS: '1',
      WHOISLEUTH_DISABLE_DNS_INTELLIGENCE: '1',
      WHOISLEUTH_DISABLE_WEBSITE_PROBE: '1',
    }),
    rdapRecord: {
      upstreamStatus: 200,
      parsed: { statuses: [], nameservers: [], events: [], lifecycle: {} },
    },
    collectTlsIntelligence: async (domain: string) => {
      tlsCalls += 1;
      assert.equal(domain, 'example.com');
      return {
        version: 1,
        status: 'success',
        source: 'tls',
        complete: true,
        certificate: { fingerprintSha256: 'b'.repeat(64) },
      };
    },
  });

  assert.equal(tlsCalls, 1);
  const tls = recordValue(result.tls);
  assert.equal(tls.status, 'success');
  assert.equal(recordValue(tls.certificate).fingerprintSha256, 'b'.repeat(64));
});
