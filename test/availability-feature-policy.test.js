const test = require('node:test');
const assert = require('node:assert/strict');

const { checkDomainAvailability } = require('../lib/availability');
const { networkFeaturePolicy } = require('../lib/feature-policy');

test('disabled DNS and website probes produce skipped unknown evidence without network calls', async () => {
  let dnsCalls = 0;
  let delegationCalls = 0;
  let homepageCalls = 0;
  let faviconCalls = 0;
  const result = await checkDomainAvailability('example.com', {
    featurePolicy: networkFeaturePolicy({
      WHOISLEUTH_DISABLE_DNS_INTELLIGENCE: '1',
      WHOISLEUTH_DISABLE_WEBSITE_PROBE: '1',
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
  });

  assert.equal(dnsCalls, 0);
  assert.equal(delegationCalls, 0);
  assert.equal(homepageCalls, 0);
  assert.equal(faviconCalls, 0);
  assert.equal(result.state, 'registered');
  assert.equal(result.activityStatus, 'unknown');
  assert.equal(result.websiteProbeStatus, 'skipped');
  assert.equal(result.deepScanComplete, false);
  assert.match(result.websiteProbeDetail, /disabled by deployment policy/i);
  assert.equal(result.dns.status, 'skipped');
  assert.equal(result.dns.complete, false);
  assert.equal(result.hasMx, null);
  assert.equal(result.hasSpf, null);
  assert.equal(result.hasDmarc, null);
});

test('a disabled registry source prevents otherwise successful deep evidence being marked complete', async () => {
  const result = await checkDomainAvailability('example.com', {
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
  });

  assert.equal(result.state, 'registered');
  assert.equal(result.websiteProbeStatus, 'active');
  assert.equal(result.deepScanComplete, false);
});
