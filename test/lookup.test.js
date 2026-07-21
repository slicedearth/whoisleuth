const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { runUnifiedLookup } = require('../lib/lookup.mts');
const { networkFeaturePolicy } = require('../lib/feature-policy.mts');

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
      attempts: [
        { endpoint: 'https://first.example/domain/example.com', outcome: 'rate_limited', selected: false },
        { endpoint: 'https://rdap.example/domain/example.com', outcome: 'success', selected: true },
      ],
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
    assert.equal(result.diagnostics.version, 7);
    assert.equal(result.diagnostics.rdap.status, 'success');
    assert.equal(result.diagnostics.rdap.transportSecurity, 'https');
    assert.deepEqual(result.diagnostics.rdap.attempts, rdapRecord.attempts);
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

  test('retains bounded RDAP attempt provenance when every endpoint fails', async () => {
    const attempts = [{
      endpoint: 'https://rdap.example/domain/example.com',
      transportSecurity: 'https', status: null, outcome: 'timeout', detail: 'request timed out', selected: false,
    }];
    const result = await runUnifiedLookup(classifiedDomain, {
      fetchRdapRecord: async () => {
        throw Object.assign(new Error('RDAP endpoints failed'), { attempts });
      },
      buildWhoisChain: async () => [],
      checkDomainAvailability: async (_domain, options) => {
        await assert.rejects(options.rdapRecordPromise, /endpoints failed/);
        return { state: 'unknown', confidence: 'low' };
      },
    });

    assert.deepEqual(result.rdap.attempts, attempts);
    assert.deepEqual(result.diagnostics.rdap.attempts, attempts);
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
      checkDomainAvailability: async (_domain, options) => {
        assert.equal(options.includeTechnologyProfile, false);
        assert.equal(options.includeSecurityPosture, false);
        return {
          state: 'registered', confidence: 'high', registrar: 'Example Registrar',
          technologyProfile: { source: 'derived', findings: [{ name: 'must be omitted' }] },
          securityPosture: { source: 'derived', findings: [{ label: 'must be omitted' }] },
        };
      },
    });

    assert.deepEqual(result.availability.registrar, 'Example Registrar');
    assert.equal(result.diagnostics.rdap.status, 'success');
    assert.equal(Object.hasOwn(result, 'rdap'), false);
    assert.equal(Object.hasOwn(result, 'whois'), false);
    assert.equal(Object.hasOwn(result.availability, 'technologyProfile'), false);
    assert.equal(Object.hasOwn(result.availability, 'securityPosture'), false);
  });

  test('adds non-authoritative registry-access context without changing source work or availability', async () => {
    const classifiedEs = {
      type: 'domain', value: 'example.es', inputHostname: 'example.es',
      registrableDomain: 'example.es', isSubdomain: false,
    };
    const calls = { rdap: 0, whois: 0, availability: 0 };
    const availability = { state: 'unknown', confidence: 'low', detail: 'Registry sources were inconclusive.' };
    const result = await runUnifiedLookup(classifiedEs, {
      fetchRdapRecord: async () => { calls.rdap += 1; return null; },
      buildWhoisChain: async () => { calls.whois += 1; return []; },
      checkDomainAvailability: async () => { calls.availability += 1; return availability; },
    });

    assert.deepEqual(calls, { rdap: 1, whois: 1, availability: 1 });
    assert.deepEqual(result.availability, {
      applicable: true, domain: 'example.es', inputHostname: 'example.es',
      registrableDomain: 'example.es', isSubdomain: false, ...availability,
    });
    assert.equal(result.diagnostics.version, 7);
    assert.deepEqual(result.diagnostics.registryAccess, {
      suffix: 'es', coverageState: 'access_documented',
      whoisAccessProfile: 'source-ip-authorization-required',
      rdapAccessProfile: 'no-iana-service',
      limitation: 'The registry WHOIS service requires advance source-IP authorization. A failed or unavailable query is not evidence that the domain is unregistered.',
      authority: 'context_only',
    });
  });

  test('omits registry-access context from compact and ordinary lookup diagnostics', async () => {
    const common = {
      fetchRdapRecord: async () => null,
      buildWhoisChain: async () => [],
      checkDomainAvailability: async () => ({ state: 'unknown', confidence: 'low' }),
    };
    const classifiedVn = {
      type: 'domain', value: 'example.vn', inputHostname: 'example.vn',
      registrableDomain: 'example.vn', isSubdomain: false,
    };
    const compact = await runUnifiedLookup(classifiedVn, { ...common, compact: true });
    const ordinary = await runUnifiedLookup(classifiedDomain, common);
    assert.equal(Object.hasOwn(compact.diagnostics, 'registryAccess'), false);
    assert.equal(Object.hasOwn(ordinary.diagnostics, 'registryAccess'), false);
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
    assert.equal(result.rdap.registrarRdap.status, 'skipped');
    assert.equal(result.diagnostics.rdap.registrar.status, 'skipped');
    assert.equal(result.diagnostics.whois.status, 'skipped');
    assert.equal(result.diagnostics.whois.errorCode, null);
    assert.deepEqual(result.whois, { skipped: true, detail: 'WHOIS is omitted in fast RDAP-only mode.' });
  });

  test('adds registrar RDAP only to deep non-compact domain lookups', async () => {
    const rdapRecord = {
      rdapServer: 'https://registry.example/domain/example.com',
      upstreamStatus: 200,
      parsed: { domain: 'EXAMPLE.COM', links: [] },
    };
    let registrarCalls = 0;
    const result = await runUnifiedLookup(classifiedDomain, {
      fetchRdapRecord: async () => rdapRecord,
      fetchRegistrarRdapRecord: async (domain, record) => {
        registrarCalls += 1;
        assert.equal(domain, 'example.com');
        assert.equal(record, rdapRecord);
        return {
          status: 'success',
          detail: null,
          endpoint: 'https://registrar.example/domain/example.com',
          transportSecurity: 'https',
          upstreamStatus: 200,
          fetchedAt: '2026-07-14T00:00:00.000Z',
          data: { ldhName: 'EXAMPLE.COM' },
          parsed: { domain: 'EXAMPLE.COM', entitiesByRole: {} },
          attempt: { outcome: 'success', selected: true },
        };
      },
      buildWhoisChain: async () => [],
      checkDomainAvailability: async () => ({ state: 'registered', confidence: 'high' }),
    });

    assert.equal(registrarCalls, 1);
    assert.equal(result.rdap.registrarRdap.status, 'success');
    assert.equal(result.rdap.parsed, rdapRecord.parsed);
    assert.equal(result.diagnostics.version, 7);
    assert.deepEqual(result.diagnostics.rdap.registrar, {
      status: 'success',
      endpoint: 'https://registrar.example/domain/example.com',
      transportSecurity: 'https',
      httpStatus: 200,
      fetchedAt: '2026-07-14T00:00:00.000Z',
      attempt: { outcome: 'success', selected: true },
    });
  });

  test('adds one separately attributed IP RDAP enrichment without changing availability', async () => {
    const calls = [];
    const availability = {
      state: 'registered',
      confidence: 'high',
      tls: {
        source: 'tls',
        status: 'success',
        connectedAddress: '93.184.216.34',
      },
      dns: {
        source: 'dns',
        status: 'success',
        records: { a: ['11.22.33.44'], aaaa: [] },
        diagnostics: { a: { status: 'success' }, aaaa: { status: 'success' } },
      },
    };
    const availabilityBefore = structuredClone(availability);
    const result = await runUnifiedLookup(classifiedDomain, {
      fetchRdapRecord: async (type, value) => {
        calls.push([type, value]);
        if (type === 'domain') return {
          rdapServer: 'https://registry.example/domain/example.com',
          transportSecurity: 'https',
          upstreamStatus: 200,
          parsed: { domain: 'EXAMPLE.COM', links: [] },
        };
        return {
          rdapServer: `https://network.example/ip/${value}`,
          transportSecurity: 'https',
          upstreamStatus: 200,
          fetchedAt: '2026-07-22T00:00:00.000Z',
          attempts: [{
            endpoint: `https://network.example/ip/${value}`,
            transportSecurity: 'https', status: 200, outcome: 'success', detail: null, selected: true,
          }],
          parsed: {
            handle: 'NET-EXAMPLE', name: 'Example edge network',
            startAddress: '93.184.216.0', endAddress: '93.184.216.255',
            cidrs: ['93.184.216.0/24'], country: 'AU', networkType: 'ALLOCATED',
            org: { name: 'Example network holder' },
            lifecycle: { databaseUpdatedDateIso: '2026-07-21T00:00:00.000Z' },
          },
        };
      },
      fetchRegistrarRdapRecord: async () => ({ status: 'unsupported' }),
      buildWhoisChain: async () => [],
      checkDomainAvailability: async () => availability,
    });

    assert.deepEqual(calls, [
      ['domain', 'example.com'],
      ['ipv4', '93.184.216.34'],
    ]);
    assert.deepEqual(availability, availabilityBefore);
    assert.equal(result.availability.state, 'registered');
    assert.equal(result.networkContext.status, 'success');
    assert.deepEqual(result.networkContext.endpoint, {
      address: '93.184.216.34', family: 4, selectedFrom: 'tls_connection',
    });
    assert.equal(result.networkContext.network.holder, 'Example network holder');
    assert.equal(result.networkContext.network.cidrs[0], '93.184.216.0/24');
    assert.equal(result.diagnostics.version, 7);
    assert.deepEqual(result.diagnostics.network, {
      status: 'success',
      address: '93.184.216.34',
      family: 4,
      addressSource: 'tls_connection',
      endpoint: 'https://network.example/ip/93.184.216.34',
      transportSecurity: 'https',
      httpStatus: 200,
      fetchedAt: '2026-07-22T00:00:00.000Z',
      attempts: [{
        endpoint: 'https://network.example/ip/93.184.216.34',
        transportSecurity: 'https', status: 200, outcome: 'success', detail: null, selected: true,
      }],
    });
  });

  test('never adds observed network context to fast, compact, disabled, or non-domain lookups', async () => {
    let networkCalls = 0;
    const common = {
      fetchRdapRecord: async () => null,
      buildWhoisChain: async () => [],
      checkDomainAvailability: async () => ({
        state: 'registered', confidence: 'high',
        tls: { source: 'tls', status: 'success', connectedAddress: '93.184.216.34' },
      }),
      collectObservedNetworkContext: async () => {
        networkCalls += 1;
        throw new Error('must not run');
      },
    };
    const fast = await runUnifiedLookup(classifiedDomain, { ...common, fast: true });
    const compact = await runUnifiedLookup(classifiedDomain, { ...common, compact: true });
    const rdapDisabled = await runUnifiedLookup(classifiedDomain, {
      ...common,
      featurePolicy: networkFeaturePolicy({ WHOISLEUTH_DISABLE_RDAP: '1' }),
    });
    const availabilityDisabled = await runUnifiedLookup(classifiedDomain, {
      ...common,
      featurePolicy: networkFeaturePolicy({ WHOISLEUTH_DISABLE_AVAILABILITY: '1' }),
    });
    const ip = await runUnifiedLookup({ type: 'ipv4', value: '192.0.2.1' }, common);

    assert.equal(networkCalls, 0);
    for (const result of [fast, compact, rdapDisabled, availabilityDisabled, ip]) {
      assert.equal(Object.hasOwn(result, 'networkContext'), false);
      assert.equal(Object.hasOwn(result.diagnostics, 'network'), false);
    }
  });

  test('adds security.txt only when explicitly requested and keeps it outside availability', async () => {
    const availability = { state: 'registered', confidence: 'high' };
    const before = structuredClone(availability);
    let securityCalls = 0;
    const result = await runUnifiedLookup(classifiedDomain, {
      securityTxt: true,
      fetchRdapRecord: async () => null,
      buildWhoisChain: async () => [],
      checkDomainAvailability: async () => availability,
      collectSecurityTxt: async (hostname) => {
        securityCalls += 1;
        assert.equal(hostname, 'login.example.com');
        return {
          securityTxtVersion: 1, version: 1, state: 'present', status: 'success',
          observedAt: '2026-07-22T01:00:00.000Z', scanMode: 'deep', source: 'security_txt',
          durationMs: 9, complete: true, truncated: false, limitations: [], diagnostics: {},
          detail: 'A current security disclosure file was published for this hostname.',
          requestedUrl: 'https://login.example.com/.well-known/security.txt',
          finalUrl: 'https://login.example.com/.well-known/security.txt', httpStatus: 200,
          redirectCount: 0, contacts: ['mailto:security@example.com'], policies: [],
          encryption: [], canonical: [], preferredLanguages: ['en'], expiresAt: '2027-01-01T00:00:00.000Z',
          signed: false, canonicalMatches: null,
        };
      },
    });

    assert.equal(securityCalls, 1);
    assert.deepEqual(availability, before);
    assert.equal(result.availability.state, 'registered');
    assert.equal(result.securityTxt.state, 'present');
    assert.deepEqual(result.diagnostics.securityTxt, {
      status: 'success', state: 'present',
      endpoint: 'https://login.example.com/.well-known/security.txt',
      httpStatus: 200, observedAt: '2026-07-22T01:00:00.000Z', complete: true, truncated: false,
    });
  });

  test('does not request security.txt by default or in ineligible lookup modes', async () => {
    let securityCalls = 0;
    const common = {
      fetchRdapRecord: async () => null,
      buildWhoisChain: async () => [],
      checkDomainAvailability: async () => ({ state: 'registered', confidence: 'high' }),
      collectSecurityTxt: async () => {
        securityCalls += 1;
        throw new Error('must not run');
      },
    };
    const ordinary = await runUnifiedLookup(classifiedDomain, common);
    const fast = await runUnifiedLookup(classifiedDomain, { ...common, securityTxt: true, fast: true });
    const compact = await runUnifiedLookup(classifiedDomain, { ...common, securityTxt: true, compact: true });
    const disabled = await runUnifiedLookup(classifiedDomain, {
      ...common,
      securityTxt: true,
      featurePolicy: networkFeaturePolicy({ WHOISLEUTH_DISABLE_WEBSITE_PROBE: '1' }),
    });
    const ip = await runUnifiedLookup({ type: 'ipv4', value: '192.0.2.1' }, { ...common, securityTxt: true });

    assert.equal(securityCalls, 0);
    for (const result of [ordinary, fast, compact, disabled, ip]) {
      assert.equal(Object.hasOwn(result, 'securityTxt'), false);
      assert.equal(Object.hasOwn(result.diagnostics, 'securityTxt'), false);
    }
  });

  test('keeps an unexpected security.txt failure as explicit neutral source health', async () => {
    const result = await runUnifiedLookup(classifiedDomain, {
      securityTxt: true,
      fetchRdapRecord: async () => null,
      buildWhoisChain: async () => [],
      checkDomainAvailability: async () => ({ state: 'registered', confidence: 'high' }),
      collectSecurityTxt: async () => { throw new Error('fixture collector failure'); },
    });

    assert.equal(result.availability.state, 'registered');
    assert.equal(result.securityTxt.state, 'unavailable');
    assert.equal(result.securityTxt.status, 'error');
    assert.match(result.securityTxt.detail, /fixture collector failure/u);
    assert.equal(result.diagnostics.securityTxt.state, 'unavailable');
  });

  test('registrar not_found remains diagnostic and cannot alter availability', async () => {
    const availability = { state: 'registered', confidence: 'high', registrar: 'Registry value' };
    const rdapRecord = {
      rdapServer: 'https://registry.example/domain/example.com',
      upstreamStatus: 200,
      parsed: { domain: 'EXAMPLE.COM', links: [] },
    };
    const result = await runUnifiedLookup(classifiedDomain, {
      fetchRdapRecord: async () => rdapRecord,
      fetchRegistrarRdapRecord: async () => ({
        status: 'not_found', detail: 'No object', endpoint: 'https://registrar.example/domain/example.com',
        transportSecurity: 'https', upstreamStatus: 404, fetchedAt: '2026-07-14T00:00:00.000Z',
        data: { errorCode: 404 }, parsed: null, attempt: { outcome: 'not_found', selected: true },
      }),
      buildWhoisChain: async () => [],
      checkDomainAvailability: async () => availability,
    });
    assert.deepEqual(
      result.availability,
      { applicable: true, domain: 'example.com', inputHostname: 'login.example.com', registrableDomain: 'example.com', isSubdomain: true, ...availability }
    );
    assert.equal(result.rdap.registrarRdap.status, 'not_found');
    assert.equal(result.diagnostics.rdap.status, 'success');
  });

  test('omits registrar follow-up for compact, disabled, and non-domain lookups', async () => {
    const rdapRecord = {
      rdapServer: 'https://registry.example/domain/example.com',
      upstreamStatus: 200,
      parsed: { domain: 'EXAMPLE.COM', links: [] },
    };
    let registrarCalls = 0;
    const common = {
      fetchRdapRecord: async () => rdapRecord,
      fetchRegistrarRdapRecord: async () => { registrarCalls += 1; },
      buildWhoisChain: async () => [],
      checkDomainAvailability: async () => ({ state: 'registered', confidence: 'high' }),
    };
    const compact = await runUnifiedLookup(classifiedDomain, { ...common, compact: true });
    const disabled = await runUnifiedLookup(classifiedDomain, {
      ...common,
      featurePolicy: networkFeaturePolicy({ WHOISLEUTH_DISABLE_RDAP: '1' }),
    });
    const ip = await runUnifiedLookup({ type: 'ipv4', value: '192.0.2.1' }, common);
    assert.equal(registrarCalls, 0);
    assert.equal(Object.hasOwn(compact.diagnostics.rdap, 'registrar'), false);
    assert.equal(Object.hasOwn(disabled.rdap, 'registrarRdap'), false);
    assert.equal(Object.hasOwn(ip.rdap, 'registrarRdap'), false);
  });

  test('adds archived provider intelligence only to an explicit deep non-compact domain lookup', async () => {
    let intelligenceCalls = 0;
    const providerResult = {
      schema: 'whoisleuth.threat-intelligence-result',
      version: 1,
      provider: { id: 'fixture_provider', label: 'Fixture provider' },
      target: { type: 'domain', value: 'example.com', exposure: 'registrable_domain' },
      state: 'not_found',
      detail: 'No fixture record.',
      upstreamStatus: 200,
      retryAfterSeconds: null,
      findings: [],
      observation: { status: 'not_found', limitations: ['No match is neutral.'] },
    };
    const result = await runUnifiedLookup(classifiedDomain, {
      externalIntelligence: true,
      fetchRdapRecord: async () => null,
      buildWhoisChain: async () => [],
      checkDomainAvailability: async () => ({ state: 'registered', confidence: 'high' }),
      lookupUrlscanDomain: async (domain) => {
        intelligenceCalls += 1;
        assert.equal(domain, 'example.com');
        return providerResult;
      },
    });
    assert.equal(intelligenceCalls, 1);
    assert.deepEqual(result.threatIntelligence, { version: 1, providers: [providerResult] });
    assert.equal(result.availability.state, 'registered');
    assert.equal(Object.hasOwn(result.diagnostics, 'threatIntelligence'), false);
  });

  test('never runs archived provider intelligence implicitly or in fast, compact, and non-domain paths', async () => {
    let intelligenceCalls = 0;
    const common = {
      fetchRdapRecord: async () => null,
      buildWhoisChain: async () => [],
      checkDomainAvailability: async () => ({ state: 'registered', confidence: 'high' }),
      lookupUrlscanDomain: async () => {
        intelligenceCalls += 1;
        throw new Error('must not run');
      },
    };
    const implicit = await runUnifiedLookup(classifiedDomain, common);
    const fast = await runUnifiedLookup(classifiedDomain, { ...common, fast: true, externalIntelligence: true });
    const compact = await runUnifiedLookup(classifiedDomain, { ...common, compact: true, externalIntelligence: true });
    const ip = await runUnifiedLookup({ type: 'ipv4', value: '192.0.2.1' }, {
      ...common,
      externalIntelligence: true,
    });
    assert.equal(intelligenceCalls, 0);
    assert.equal(Object.hasOwn(implicit, 'threatIntelligence'), false);
    assert.equal(Object.hasOwn(fast, 'threatIntelligence'), false);
    assert.equal(Object.hasOwn(compact, 'threatIntelligence'), false);
    assert.equal(Object.hasOwn(ip, 'threatIntelligence'), false);
  });

  test('keeps unexpected archived-provider failures as an explicit neutral source state', async () => {
    const result = await runUnifiedLookup(classifiedDomain, {
      externalIntelligence: true,
      fetchRdapRecord: async () => null,
      buildWhoisChain: async () => [],
      checkDomainAvailability: async () => ({ state: 'registered', confidence: 'high' }),
      lookupUrlscanDomain: async () => { throw new Error('secret provider failure'); },
    });
    const provider = result.threatIntelligence.providers[0];
    assert.equal(provider.state, 'error');
    assert.deepEqual(provider.findings, []);
    assert.equal(JSON.stringify(provider).includes('secret provider failure'), false);
    assert.equal(result.availability.state, 'registered');
  });

  test('adds malware-host intelligence only to an explicit deep non-compact domain lookup', async () => {
    let malwareCalls = 0;
    const providerResult = {
      schema: 'whoisleuth.threat-intelligence-result',
      version: 1,
      provider: { id: 'fixture_malware', label: 'Fixture malware provider' },
      target: { type: 'domain', value: 'example.com', exposure: 'registrable_domain' },
      state: 'not_found',
      detail: 'No fixture record.',
      upstreamStatus: 200,
      retryAfterSeconds: null,
      findings: [],
      observation: { status: 'not_found', limitations: ['No match is neutral.'] },
    };
    const result = await runUnifiedLookup(classifiedDomain, {
      malwareHostIntelligence: true,
      fetchRdapRecord: async () => null,
      buildWhoisChain: async () => [],
      checkDomainAvailability: async () => ({ state: 'registered', confidence: 'high' }),
      lookupUrlhausDomain: async (domain) => {
        malwareCalls += 1;
        assert.equal(domain, 'example.com');
        return providerResult;
      },
    });
    assert.equal(malwareCalls, 1);
    assert.deepEqual(result.threatIntelligence, { version: 1, providers: [providerResult] });
    assert.equal(result.availability.state, 'registered');
  });

  test('keeps requested external providers ordered and neutral when one adapter fails', async () => {
    const archivedResult = {
      schema: 'whoisleuth.threat-intelligence-result', version: 1,
      provider: { id: 'fixture_archive', label: 'Fixture archive' },
      target: { type: 'domain', value: 'example.com', exposure: 'registrable_domain' },
      state: 'not_found', detail: 'No match.', upstreamStatus: 200, retryAfterSeconds: null,
      findings: [], observation: { status: 'not_found', limitations: [] },
    };
    const result = await runUnifiedLookup(classifiedDomain, {
      externalIntelligence: true,
      malwareHostIntelligence: true,
      fetchRdapRecord: async () => null,
      buildWhoisChain: async () => [],
      checkDomainAvailability: async () => ({ state: 'registered', confidence: 'high' }),
      lookupUrlscanDomain: async () => archivedResult,
      lookupUrlhausDomain: async () => { throw new Error('private upstream detail'); },
    });
    assert.deepEqual(result.threatIntelligence.providers.map((provider) => provider.provider.id), [
      'fixture_archive',
      'urlhaus_host',
    ]);
    assert.equal(result.threatIntelligence.providers[1].state, 'error');
    assert.equal(JSON.stringify(result).includes('private upstream detail'), false);
    assert.equal(result.availability.state, 'registered');
  });

  test('never runs malware-host intelligence implicitly or in fast, compact, and non-domain paths', async () => {
    let malwareCalls = 0;
    const common = {
      fetchRdapRecord: async () => null,
      buildWhoisChain: async () => [],
      checkDomainAvailability: async () => ({ state: 'registered', confidence: 'high' }),
      lookupUrlhausDomain: async () => {
        malwareCalls += 1;
        throw new Error('must not run');
      },
    };
    const implicit = await runUnifiedLookup(classifiedDomain, common);
    const fast = await runUnifiedLookup(classifiedDomain, { ...common, fast: true, malwareHostIntelligence: true });
    const compact = await runUnifiedLookup(classifiedDomain, { ...common, compact: true, malwareHostIntelligence: true });
    const ip = await runUnifiedLookup({ type: 'ipv4', value: '192.0.2.1' }, {
      ...common,
      malwareHostIntelligence: true,
    });
    assert.equal(malwareCalls, 0);
    assert.equal(Object.hasOwn(implicit, 'threatIntelligence'), false);
    assert.equal(Object.hasOwn(fast, 'threatIntelligence'), false);
    assert.equal(Object.hasOwn(compact, 'threatIntelligence'), false);
    assert.equal(Object.hasOwn(ip, 'threatIntelligence'), false);
  });

  test('adds malware-IOC intelligence only to an explicit deep non-compact domain lookup', async () => {
    let iocCalls = 0;
    const providerResult = {
      schema: 'whoisleuth.threat-intelligence-result', version: 1,
      provider: { id: 'fixture_ioc', label: 'Fixture IOC provider' },
      target: { type: 'domain', value: 'example.com', exposure: 'registrable_domain' },
      state: 'not_found', detail: 'No fixture record.', upstreamStatus: 200, retryAfterSeconds: null,
      findings: [], observation: { status: 'not_found', limitations: ['No match is neutral.'] },
    };
    const result = await runUnifiedLookup(classifiedDomain, {
      malwareIocIntelligence: true,
      fetchRdapRecord: async () => null,
      buildWhoisChain: async () => [],
      checkDomainAvailability: async () => ({ state: 'registered', confidence: 'high' }),
      lookupThreatfoxDomain: async (domain) => {
        iocCalls += 1;
        assert.equal(domain, 'example.com');
        return providerResult;
      },
    });
    assert.equal(iocCalls, 1);
    assert.deepEqual(result.threatIntelligence, { version: 1, providers: [providerResult] });
    assert.equal(result.availability.state, 'registered');
  });

  test('never runs malware-IOC intelligence implicitly or in fast, compact, and non-domain paths', async () => {
    let iocCalls = 0;
    const common = {
      fetchRdapRecord: async () => null,
      buildWhoisChain: async () => [],
      checkDomainAvailability: async () => ({ state: 'registered', confidence: 'high' }),
      lookupThreatfoxDomain: async () => {
        iocCalls += 1;
        throw new Error('must not run');
      },
    };
    const implicit = await runUnifiedLookup(classifiedDomain, common);
    const fast = await runUnifiedLookup(classifiedDomain, { ...common, fast: true, malwareIocIntelligence: true });
    const compact = await runUnifiedLookup(classifiedDomain, { ...common, compact: true, malwareIocIntelligence: true });
    const ip = await runUnifiedLookup({ type: 'ipv4', value: '192.0.2.1' }, {
      ...common, malwareIocIntelligence: true,
    });
    assert.equal(iocCalls, 0);
    assert.equal(Object.hasOwn(implicit, 'threatIntelligence'), false);
    assert.equal(Object.hasOwn(fast, 'threatIntelligence'), false);
    assert.equal(Object.hasOwn(compact, 'threatIntelligence'), false);
    assert.equal(Object.hasOwn(ip, 'threatIntelligence'), false);
  });

  test('converts registrar transient failures into an additive error source', async () => {
    const attempt = {
      endpoint: 'https://registrar.example/domain/example.com', transportSecurity: 'https',
      status: 429, outcome: 'rate_limited', detail: 'HTTP 429', selected: false,
    };
    const result = await runUnifiedLookup(classifiedDomain, {
      fetchRdapRecord: async () => ({
        rdapServer: 'https://registry.example/domain/example.com',
        upstreamStatus: 200,
        parsed: { domain: 'EXAMPLE.COM', links: [] },
      }),
      fetchRegistrarRdapRecord: async () => {
        throw Object.assign(new Error('HTTP 429'), {
          registrarRdap: {
            status: 'error', detail: 'HTTP 429', endpoint: attempt.endpoint,
            transportSecurity: 'https', upstreamStatus: 429, fetchedAt: null, attempt,
          },
        });
      },
      buildWhoisChain: async () => [],
      checkDomainAvailability: async () => ({ state: 'registered', confidence: 'high' }),
    });
    assert.equal(result.rdap.registrarRdap.status, 'error');
    assert.equal(result.diagnostics.rdap.registrar.status, 'error');
    assert.equal(result.diagnostics.rdap.registrar.attempt.outcome, 'rate_limited');
    assert.equal(result.availability.state, 'registered');
  });

  test('bounds unexpected registrar error detail before returning it', async () => {
    const result = await runUnifiedLookup(classifiedDomain, {
      fetchRdapRecord: async () => ({
        rdapServer: 'https://registry.example/domain/example.com',
        upstreamStatus: 200,
        parsed: { domain: 'EXAMPLE.COM', links: [] },
      }),
      fetchRegistrarRdapRecord: async () => { throw new Error(`unexpected\n${'x'.repeat(500)}`); },
      buildWhoisChain: async () => [],
      checkDomainAvailability: async () => ({ state: 'registered', confidence: 'high' }),
    });
    assert.equal(result.rdap.registrarRdap.status, 'error');
    assert.ok(result.rdap.registrarRdap.detail.length <= 240);
    assert.equal(/[\u0000-\u001f\u007f]/.test(result.rdap.registrarRdap.detail), false);
  });

  test('disabled RDAP and WHOIS sources are never called and remain explicit in diagnostics', async () => {
    let rdapCalls = 0;
    let whoisCalls = 0;
    const policy = networkFeaturePolicy({
      WHOISLEUTH_DISABLE_RDAP: '1',
      WHOISLEUTH_DISABLE_WHOIS: 'true',
    });
    const result = await runUnifiedLookup(classifiedDomain, {
      featurePolicy: policy,
      fetchRdapRecord: async () => { rdapCalls += 1; throw new Error('must not run'); },
      buildWhoisChain: async () => { whoisCalls += 1; throw new Error('must not run'); },
      checkDomainAvailability: async (_domain, options) => {
        assert.equal(options.featurePolicy, policy);
        assert.equal(await options.rdapRecordPromise, null);
        assert.equal(await options.whoisChainPromise, null);
        return { state: 'unknown', confidence: 'low' };
      },
    });
    assert.equal(rdapCalls, 0);
    assert.equal(whoisCalls, 0);
    assert.equal(result.diagnostics.rdap.status, 'disabled');
    assert.equal(result.diagnostics.whois.status, 'disabled');
    assert.equal(result.diagnostics.rdap.errorCode, 'FEATURE_DISABLED');
    assert.match(result.rdap.detail, /disabled by deployment policy/i);
    assert.match(result.whois.detail, /disabled by deployment policy/i);
  });

  test('disabled availability analysis is not invoked or presented as an observed result', async () => {
    let availabilityCalls = 0;
    const result = await runUnifiedLookup(classifiedDomain, {
      featurePolicy: networkFeaturePolicy({ WHOISLEUTH_DISABLE_AVAILABILITY: 'on' }),
      fetchRdapRecord: async () => null,
      buildWhoisChain: async () => [],
      checkDomainAvailability: async () => { availabilityCalls += 1; },
    });
    assert.equal(availabilityCalls, 0);
    assert.equal(result.availability.disabled, true);
    assert.equal(result.availability.state, 'unknown');
    assert.equal(result.diagnostics.availability.status, 'disabled');
    assert.equal(result.diagnostics.availability.errorCode, 'FEATURE_DISABLED');
  });
});
