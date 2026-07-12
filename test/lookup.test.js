const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { runUnifiedLookup } = require('../lib/lookup');

const classifiedDomain = {
  type: 'domain',
  value: 'example.com',
  inputHostname: 'login.example.com',
  registrableDomain: 'example.com',
  isSubdomain: true,
};

describe('runUnifiedLookup', () => {
  test('fetches RDAP and WHOIS once and reuses both for availability', async () => {
    const rdapRecord = {
      rdapServer: 'https://rdap.example/domain/example.com',
      transportSecurity: 'https',
      upstreamStatus: 200,
      data: { ldhName: 'EXAMPLE.COM' },
      parsed: { domain: 'EXAMPLE.COM', statuses: [], nameservers: [], events: [] },
    };
    const whoisChain = [
      { server: 'whois.iana.org', response: 'refer: whois.example\n' },
      {
        server: 'whois.example',
        response: 'Domain Name: EXAMPLE.COM\nRegistrar: Example Registrar\n',
      },
    ];
    let rdapCalls = 0;
    let whoisCalls = 0;
    let availabilityCalls = 0;

    const result = await runUnifiedLookup(classifiedDomain, {
      fetchRdapRecord: async () => { rdapCalls += 1; return rdapRecord; },
      buildWhoisChain: async () => { whoisCalls += 1; return whoisChain; },
      checkDomainAvailability: async (domain, options) => {
        availabilityCalls += 1;
        assert.equal(domain, 'example.com');
        assert.equal(await options.rdapRecordPromise, rdapRecord);
        assert.equal(await options.whoisChainPromise, whoisChain);
        return { state: 'registered', confidence: 'high' };
      },
    });

    assert.equal(rdapCalls, 1);
    assert.equal(whoisCalls, 1);
    assert.equal(availabilityCalls, 1);
    assert.equal(result.rdap.parsed.domain, 'EXAMPLE.COM');
    assert.equal(result.whois.parsed.registrationStatus, 'registered');
    assert.equal(result.availability.domain, 'example.com');
    assert.equal(result.availability.inputHostname, 'login.example.com');
    assert.equal(result.diagnostics.version, 1);
    assert.equal(result.diagnostics.rdap.status, 'success');
    assert.equal(result.diagnostics.rdap.transportSecurity, 'https');
    assert.equal(result.diagnostics.whois.status, 'complete');
    assert.equal(result.diagnostics.availability.status, 'complete');
  });

  test('keeps a usable WHOIS result when RDAP fails', async () => {
    const result = await runUnifiedLookup(classifiedDomain, {
      fetchRdapRecord: async () => { throw new Error('RDAP timed out'); },
      buildWhoisChain: async () => [
        { server: 'whois.iana.org', response: 'refer: whois.example\n' },
        { server: 'whois.example', response: 'No match for EXAMPLE.COM' },
      ],
      checkDomainAvailability: async (_domain, options) => {
        await assert.rejects(options.rdapRecordPromise, /timed out/);
        assert.ok(Array.isArray(await options.whoisChainPromise));
        return { state: 'available', confidence: 'medium' };
      },
    });

    assert.match(result.rdap.error, /timed out/);
    assert.equal(result.whois.parsed.registrationStatus, 'not_found');
    assert.equal(result.availability.state, 'available');
    assert.equal(result.diagnostics.rdap.status, 'error');
    assert.equal(result.diagnostics.rdap.errorCode, 'RDAP_UPSTREAM_FAILED');
    assert.equal(result.diagnostics.whois.status, 'complete');
  });

  test('does not run domain availability for IP lookups', async () => {
    let availabilityCalls = 0;
    const result = await runUnifiedLookup({ type: 'ipv4', value: '192.0.2.1' }, {
      fetchRdapRecord: async () => null,
      buildWhoisChain: async () => [],
      checkDomainAvailability: async () => { availabilityCalls += 1; },
    });

    assert.equal(availabilityCalls, 0);
    assert.deepEqual(result.availability, { applicable: false, type: 'ipv4' });
    assert.equal(result.diagnostics.rdap.status, 'unsupported');
    assert.equal(result.diagnostics.rdap.errorCode, 'RDAP_UNSUPPORTED');
    assert.equal(result.diagnostics.availability.status, 'not_applicable');
  });

  test('reports availability execution failures separately from an unknown result', async () => {
    const result = await runUnifiedLookup(classifiedDomain, {
      fetchRdapRecord: async () => null,
      buildWhoisChain: async () => [],
      checkDomainAvailability: async () => { throw new Error('enrichment failed'); },
    });

    assert.equal(result.availability.state, 'unknown');
    assert.equal(result.diagnostics.availability.status, 'error');
    assert.equal(result.diagnostics.availability.errorCode, 'AVAILABILITY_CHECK_FAILED');
  });

  test('returns an availability-only payload for compact bulk lookups', async () => {
    const result = await runUnifiedLookup(classifiedDomain, {
      compact: true,
      fetchRdapRecord: async () => ({
        rdapServer: 'https://rdap.example/domain/example.com',
        upstreamStatus: 200,
        data: { large: 'raw RDAP body' },
        parsed: { domain: 'EXAMPLE.COM' },
      }),
      buildWhoisChain: async () => [{ server: 'whois.example', response: 'large raw WHOIS body' }],
      checkDomainAvailability: async () => ({ state: 'registered', confidence: 'high', registrar: 'Example Registrar' }),
    });

    assert.deepEqual(result.availability.registrar, 'Example Registrar');
    assert.equal(result.diagnostics.rdap.status, 'success');
    assert.equal(Object.hasOwn(result, 'rdap'), false);
    assert.equal(Object.hasOwn(result, 'whois'), false);
  });

  test('fast lookups skip WHOIS while reusing RDAP for availability', async () => {
    const rdapRecord = {
      rdapServer: 'https://rdap.example/domain/example.com',
      upstreamStatus: 200,
      parsed: { domain: 'EXAMPLE.COM' },
    };
    let whoisCalls = 0;
    const result = await runUnifiedLookup(classifiedDomain, {
      fast: true,
      fetchRdapRecord: async () => rdapRecord,
      buildWhoisChain: async () => { whoisCalls += 1; return []; },
      checkDomainAvailability: async (_domain, options) => {
        assert.equal(await options.rdapRecordPromise, rdapRecord);
        assert.equal(await options.whoisChainPromise, null);
        return { state: 'registered', confidence: 'high' };
      },
    });
    assert.equal(whoisCalls, 0);
    assert.equal(result.diagnostics.whois.status, 'skipped');
    assert.equal(result.diagnostics.whois.errorCode, null);
    assert.deepEqual(result.whois, { skipped: true, detail: 'WHOIS is omitted in fast RDAP-only mode.' });
  });
});
