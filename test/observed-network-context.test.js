const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_NETWORK_ATTEMPTS,
  MAX_NETWORK_CIDRS,
  OBSERVED_NETWORK_CONTEXT_VERSION,
  collectObservedNetworkContext,
  selectObservedNetworkAddress,
} = require('../lib/observed-network-context.mts');

const OBSERVED_AT = '2026-07-22T03:04:05.000Z';
const IPV4 = '93.184.216.34';
const IPV6 = '2600:1234::10';

function availability(overrides = {}) {
  return {
    tls: {
      source: 'tls', status: 'success', complete: true,
      connectedAddress: IPV4,
    },
    dns: {
      source: 'dns', status: 'success', complete: true,
      records: { a: ['11.22.33.44'], aaaa: [IPV6] },
      diagnostics: { a: { status: 'success' }, aaaa: { status: 'success' } },
    },
    ...overrides,
  };
}

function ipRdap(overrides = {}) {
  return {
    rdapServer: `https://rdap.registry.test/ip/${IPV4}`,
    transportSecurity: 'https',
    upstreamStatus: 200,
    fetchedAt: OBSERVED_AT,
    attempts: [{
      endpoint: `https://rdap.registry.test/ip/${IPV4}`,
      transportSecurity: 'https', status: 200, outcome: 'success',
      detail: 'The endpoint returned the requested RDAP object.', selected: true,
    }],
    parsed: {
      objectClassName: 'ip network',
      handle: 'NET-EXAMPLE',
      name: 'EXAMPLE-NETWORK',
      startAddress: '93.184.216.0',
      endAddress: '93.184.216.255',
      cidrs: ['93.184.216.0/24'],
      country: 'au',
      networkType: 'DIRECT ALLOCATION',
      lifecycle: { databaseUpdatedDateIso: '2026-07-21T12:00:00.000Z' },
      org: {
        handle: 'ORG-EXAMPLE', name: 'Example Network Holder',
        email: 'contact@example.test', addresses: ['private contact data'],
      },
      serverTruncated: false,
      cidrsTruncated: false,
      entitiesTruncated: false,
    },
    data: { privateRawPayload: 'must not be retained' },
    ...overrides,
  };
}

describe('observed network context', () => {
  test('prefers the validated successful TLS connection address', () => {
    assert.deepEqual(selectObservedNetworkAddress(availability()), {
      address: IPV4, family: 4, selectedFrom: 'tls_connection',
    });
  });

  test('falls back deterministically to retained public A evidence', () => {
    const selected = selectObservedNetworkAddress(availability({
      tls: { source: 'tls', status: 'error', connectedAddress: IPV4 },
      dns: {
        source: 'dns', status: 'partial',
        records: { a: ['44.33.22.11', '11.22.33.44'], aaaa: [IPV6] },
        diagnostics: { a: { status: 'success' }, aaaa: { status: 'success' } },
      },
    }));
    assert.deepEqual(selected, { address: '11.22.33.44', family: 4, selectedFrom: 'dns_a' });
  });

  test('rejects private and inconclusive A evidence before using public AAAA', () => {
    const selected = selectObservedNetworkAddress(availability({
      tls: { source: 'tls', status: 'error', connectedAddress: '127.0.0.1' },
      dns: {
        source: 'dns', status: 'partial',
        records: { a: ['10.0.0.1'], aaaa: [IPV6] },
        diagnostics: { a: { status: 'error' }, aaaa: { status: 'success' } },
      },
    }));
    assert.deepEqual(selected, { address: IPV6, family: 6, selectedFrom: 'dns_aaaa' });
  });

  test('does not select addresses from missing or unsupported source envelopes', () => {
    assert.equal(selectObservedNetworkAddress({}), null);
    assert.equal(selectObservedNetworkAddress(availability({
      tls: { source: 'tls', status: 'skipped', connectedAddress: IPV4 },
      dns: {
        source: 'dns', status: 'success', records: { a: [IPV4] },
        diagnostics: { a: { status: 'not_found' } },
      },
    })), null);
  });

  test('fetches one IP RDAP object and retains only bounded registration context', async () => {
    const calls = [];
    const result = await collectObservedNetworkContext(availability(), {
      fetchRdapRecord: async (type, address) => {
        calls.push({ type, address });
        return ipRdap();
      },
      now: (() => { const values = [100, 125]; return () => values.shift() ?? 125; })(),
      observedAt: () => OBSERVED_AT,
    });

    assert.deepEqual(calls, [{ type: 'ipv4', address: IPV4 }]);
    assert.equal(result.contextVersion, OBSERVED_NETWORK_CONTEXT_VERSION);
    assert.equal(result.version, 1);
    assert.equal(result.status, 'success');
    assert.equal(result.source, 'ip_rdap');
    assert.equal(result.scanMode, 'deep');
    assert.equal(result.durationMs, 25);
    assert.equal(result.complete, true);
    assert.deepEqual(result.endpoint, { address: IPV4, family: 4, selectedFrom: 'tls_connection' });
    assert.deepEqual(result.network, {
      handle: 'NET-EXAMPLE',
      name: 'EXAMPLE-NETWORK',
      holder: 'Example Network Holder',
      cidrs: ['93.184.216.0/24'],
      startAddress: '93.184.216.0',
      endAddress: '93.184.216.255',
      country: 'AU',
      networkType: 'DIRECT ALLOCATION',
      databaseUpdatedAt: '2026-07-21T12:00:00.000Z',
    });
    assert.equal(result.rdap.endpoint, `https://rdap.registry.test/ip/${IPV4}`);
    assert.equal(result.rdap.fetchedAt, OBSERVED_AT);
    assert.equal(result.diagnostics.requestCount, 1);
    assert.equal(result.diagnostics.addressSource, 'tls_connection');
    assert.doesNotMatch(JSON.stringify(result), /privateRawPayload|contact@example|private contact data/);
    assert.match(result.limitations.join(' '), /not a definitive origin host/i);
  });

  test('marks server and local CIDR truncation as partial', async () => {
    const cidrs = Array.from({ length: MAX_NETWORK_CIDRS + 4 }, (_, index) => `93.184.${index}.0/24`);
    const result = await collectObservedNetworkContext(availability(), {
      fetchRdapRecord: async () => ipRdap({
        parsed: { ...ipRdap().parsed, cidrs, serverTruncated: true },
      }),
      observedAt: () => OBSERVED_AT,
    });
    assert.equal(result.status, 'partial');
    assert.equal(result.complete, false);
    assert.equal(result.truncated, true);
    assert.equal(result.network.cidrs.length, MAX_NETWORK_CIDRS);
    assert.match(result.limitations.join(' '), /server declared/i);
    assert.match(result.limitations.join(' '), /local retention limit/i);
  });

  test('makes no request when no validated public endpoint was retained', async () => {
    let calls = 0;
    const result = await collectObservedNetworkContext({}, {
      fetchRdapRecord: async () => { calls += 1; throw new Error('must not run'); },
      observedAt: () => OBSERVED_AT,
    });
    assert.equal(calls, 0);
    assert.equal(result.status, 'unsupported');
    assert.equal(result.endpoint, null);
    assert.equal(result.diagnostics.requestCount, 0);
    assert.match(result.detail, /no validated public endpoint/i);
  });

  test('keeps missing bootstrap coverage neutral after one logical request', async () => {
    let calls = 0;
    const result = await collectObservedNetworkContext(availability(), {
      fetchRdapRecord: async () => { calls += 1; return null; },
      observedAt: () => OBSERVED_AT,
    });
    assert.equal(calls, 1);
    assert.equal(result.status, 'unsupported');
    assert.equal(result.complete, false);
    assert.equal(result.network, null);
    assert.match(result.limitations.join(' '), /not identify a definitive origin host/i);
  });

  test('retains an authoritative IP RDAP not-found response without affecting domain semantics', async () => {
    const result = await collectObservedNetworkContext(availability(), {
      fetchRdapRecord: async () => ipRdap({
        upstreamStatus: 404,
        parsed: null,
        attempts: [{ endpoint: `https://rdap.registry.test/ip/${IPV4}`, status: 404, outcome: 'not_found', selected: true }],
      }),
      observedAt: () => OBSERVED_AT,
    });
    assert.equal(result.status, 'not_found');
    assert.equal(result.complete, true);
    assert.equal(result.network, null);
    assert.match(result.limitations.join(' '), /not a domain availability/i);
  });

  test('sanitizes transient failure detail and bounds attempt provenance', async () => {
    const attempts = Array.from({ length: MAX_NETWORK_ATTEMPTS + 4 }, (_, index) => ({
      endpoint: `https://rdap-${index}.registry.test/ip/${IPV4}?secret=value`,
      status: 503, outcome: 'server_error', detail: `detail-${index}`,
    }));
    const result = await collectObservedNetworkContext(availability(), {
      fetchRdapRecord: async () => {
        throw Object.assign(new Error('private upstream failure'), { attempts, secret: 'must not escape' });
      },
      observedAt: () => OBSERVED_AT,
    });
    assert.equal(result.status, 'error');
    assert.equal(result.complete, false);
    assert.equal(result.rdap.attempts.length, MAX_NETWORK_ATTEMPTS);
    assert.equal(result.rdap.attempts[0].endpoint.includes('?'), false);
    assert.doesNotMatch(JSON.stringify(result), /private upstream failure|must not escape|secret=value/);
  });

  test('does not mutate availability or RDAP source objects', async () => {
    const availabilityInput = availability();
    const rdapInput = ipRdap();
    const availabilityBefore = structuredClone(availabilityInput);
    const rdapBefore = structuredClone(rdapInput);
    await collectObservedNetworkContext(availabilityInput, {
      fetchRdapRecord: async () => rdapInput,
      observedAt: () => OBSERVED_AT,
    });
    assert.deepEqual(availabilityInput, availabilityBefore);
    assert.deepEqual(rdapInput, rdapBefore);
  });
});
