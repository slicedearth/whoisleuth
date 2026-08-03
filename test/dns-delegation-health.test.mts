import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MAX_AUTHORITIES,
  MAX_AUTHORITY_ADDRESSES,
  collectDnsDelegationHealth,
  skippedDnsDelegationHealth,
} from '../lib/dns-delegation-health.mts';
import { recordValue, requiredValue } from './value-assertions.mts';

const OBSERVED_AT = '2026-07-30T02:03:04.000Z';
const PARENT = {
  status: 'success' as const,
  records: ['ns1.example.test', 'ns2.example.test'],
  error: null,
  truncated: false,
  discarded: 0,
};
const REGISTRY = {
  nameservers: ['ns1.example.test', 'ns2.example.test'],
  nameserverDetails: [
    { name: 'ns1.example.test', addresses: ['93.184.216.34'] },
    { name: 'ns2.example.test', addresses: ['1.1.1.1'] },
  ],
  delegationSigned: true,
  dsData: [{ keyTag: 1, algorithm: 13, digestType: 2, digest: 'aa' }],
};

describe('DNS delegation health', () => {
  test('keeps registry, parent, and direct authority evidence separately attributed', async () => {
    const calls: Array<{ nameserver: string; address: string }> = [];
    const result = await collectDnsDelegationHealth('example.test', PARENT, {
      registryEvidence: REGISTRY,
      queryAuthority: async ({ nameserver, address }) => {
        calls.push({ nameserver, address });
        return {
          nameservers: PARENT.records,
          soaPrimary: 'ns1.example.test',
          soa: {
            nsname: 'ns1.example.test',
            hostmaster: 'hostmaster.example.test',
            serial: 2026080301,
            refresh: 3600,
            retry: 600,
            expire: 1209600,
            minttl: 300,
          },
          errorCode: null,
          error: null,
        };
      },
      observedAt: () => OBSERVED_AT,
    });

    assert.equal(result.status, 'success');
    assert.equal(result.complete, true);
    assert.equal(result.source, 'dns_delegation');
    assert.equal(result.observedAt, OBSERVED_AT);
    assert.deepEqual(result.parent.nameservers, PARENT.records);
    assert.deepEqual(result.registry.nameservers, PARENT.records);
    assert.deepEqual(calls, [
      { nameserver: 'ns1.example.test', address: '93.184.216.34' },
      { nameserver: 'ns2.example.test', address: '1.1.1.1' },
    ]);
    assert.equal(recordValue(requiredValue(result.authorities[0]).soa).serial, 2026080301);
    assert.equal(result.findings.find((finding) => finding.id === 'authority_soa_consistency')?.state, 'healthy');
    assert.equal(result.authorities.every((authority) => authority.addressSource === 'registry_glue'), true);
    assert.equal(result.findings.every((finding) => finding.state === 'healthy'), true);
    assert.match(result.limitations.join(' '), /does not decide registration availability/i);
  });

  test('flags different authoritative SOA serials without treating either answer as absent', async () => {
    const result = await collectDnsDelegationHealth('example.test', PARENT, {
      registryEvidence: REGISTRY,
      queryAuthority: async ({ nameserver }) => ({
        nameservers: PARENT.records,
        soaPrimary: 'ns1.example.test',
        soa: {
          nsname: 'ns1.example.test',
          hostmaster: 'hostmaster.example.test',
          serial: nameserver.startsWith('ns1') ? 2026080301 : 2026080209,
          refresh: 3600,
          retry: 600,
          expire: 1209600,
          minttl: 300,
        },
        errorCode: null,
        error: null,
      }),
      observedAt: () => OBSERVED_AT,
    });
    const finding = requiredValue(result.findings.find((item) => item.id === 'authority_soa_consistency'));
    assert.equal(finding.state, 'warning');
    assert.match(finding.summary, /different SOA serials/u);
    assert.equal(result.complete, true);
  });

  test('reports inconsistent, lame, unreachable, missing-glue, and DNSSEC publication states', async () => {
    const result = await collectDnsDelegationHealth('example.test', PARENT, {
      registryEvidence: {
        nameservers: ['ns1.example.test', 'ns3.example.test'],
        nameserverDetails: [{ name: 'ns1.example.test', addresses: ['93.184.216.34'] }],
        delegationSigned: true,
        dsData: [],
      },
      resolve4: async (name) => name === 'ns2.example.test' ? ['1.1.1.1'] : [],
      resolve6: async () => [],
      queryAuthority: async ({ nameserver }) => {
        if (nameserver === 'ns1.example.test') {
          return {
            nameservers: ['ns1.example.test', 'ns3.example.test'],
            soaPrimary: 'ns1.example.test',
            errorCode: null,
            error: null,
          };
        }
        if (nameserver === 'ns2.example.test') {
          return {
            nameservers: [],
            soaPrimary: null,
            errorCode: 'EREFUSED',
            error: 'query refused',
          };
        }
        return {
          nameservers: [],
          soaPrimary: null,
          errorCode: 'ETIMEOUT',
          error: 'query timed out',
        };
      },
      observedAt: () => OBSERVED_AT,
    });

    assert.equal(result.status, 'partial');
    assert.equal(result.complete, false);
    assert.equal(result.authorities.find((item) => item.nameserver === 'ns2.example.test')?.state, 'lame');
    assert.equal(result.authorities.find((item) => item.nameserver === 'ns3.example.test')?.state, 'unreachable');
    assert.equal(result.findings.find((item) => item.id === 'parent_registry_ns')?.state, 'warning');
    assert.equal(result.findings.find((item) => item.id === 'authority_reachability')?.state, 'danger');
    assert.equal(result.findings.find((item) => item.id === 'authority_ns_consistency')?.state, 'warning');
    assert.equal(result.findings.find((item) => item.id === 'in_bailiwick_glue')?.state, 'warning');
    assert.equal(result.findings.find((item) => item.id === 'dnssec_delegation')?.state, 'warning');
  });

  test('bounds authority and address fan-out and rejects non-public addresses', async () => {
    const nameservers = Array.from({ length: MAX_AUTHORITIES + 3 }, (_, index) => `ns${index}.outside.test`);
    let calls = 0;
    const result = await collectDnsDelegationHealth('example.test', {
      ...PARENT,
      records: nameservers,
    }, {
      registryEvidence: {
        nameservers,
        nameserverDetails: nameservers.map((name) => ({
          name,
          addresses: ['127.0.0.1', '10.0.0.1', '93.184.216.34', '1.1.1.1', '8.8.8.8'],
        })),
      },
      queryAuthority: async () => {
        calls += 1;
        return { nameservers, soaPrimary: nameservers[0], errorCode: null, error: null };
      },
    });

    assert.equal(result.authorities.length, MAX_AUTHORITIES);
    assert.equal(result.authorities.every((authority) => authority.addresses.length <= MAX_AUTHORITY_ADDRESSES), true);
    assert.equal(result.authorities.some((authority) => authority.addresses.includes('127.0.0.1')), false);
    assert.equal(result.authorities.some((authority) => authority.addresses.includes('10.0.0.1')), false);
    assert.equal(calls, MAX_AUTHORITIES * MAX_AUTHORITY_ADDRESSES);
  });

  test('preserves a partial direct authority answer without calling it unreachable', async () => {
    const result = await collectDnsDelegationHealth('example.test', {
      ...PARENT,
      records: ['ns1.example.test'],
    }, {
      registryEvidence: {
        nameservers: ['ns1.example.test'],
        nameserverDetails: [{ name: 'ns1.example.test', addresses: ['8.8.8.8'] }],
      },
      queryAuthority: async () => ({
        nameservers: ['ns1.example.test'],
        soaPrimary: null,
        errorCode: 'ETIMEOUT',
        error: 'SOA query timed out',
      }),
      now: () => 0,
      observedAt: () => OBSERVED_AT,
    });

    assert.equal(result.status, 'partial');
    assert.equal(result.authorities[0]?.state, 'partial');
    assert.deepEqual(result.authorities[0]?.nameservers, ['ns1.example.test']);
    assert.equal(result.diagnostics.partialAuthorityCount, 1);
    assert.equal(result.diagnostics.unreachableAuthorityCount, 0);
  });

  test('keeps resolver failure inconclusive and exposes no source payload', async () => {
    const result = await collectDnsDelegationHealth('example.test', {
      status: 'error',
      records: [],
      error: 'resolver failed',
      truncated: false,
      discarded: 0,
    }, {
      registryEvidence: {},
      observedAt: () => OBSERVED_AT,
    });
    assert.equal(result.status, 'error');
    assert.equal(result.complete, false);
    assert.equal(result.parent.state, 'error');
    assert.match(result.parent.error ?? '', /resolver failed/i);
    assert.deepEqual(result.authorities, []);
  });

  test('returns a stable skipped envelope for ineligible or disabled collection', async () => {
    const ineligible = await collectDnsDelegationHealth('invalid', PARENT);
    const skipped = skippedDnsDelegationHealth('Disabled for this fixture.');
    assert.equal(ineligible.status, 'skipped');
    assert.equal(skipped.status, 'skipped');
    assert.equal(recordValue(requiredValue(skipped.parent)).state, 'not_collected');
  });
});
