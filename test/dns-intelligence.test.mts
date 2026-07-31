import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectDnsIntelligence,
  collectEffectiveCaaPolicy,
  collectReverseDnsIntelligence,
  normalizeAddresses,
  normalizeHostnames,
  normalizeMx,
  normalizeTxtPolicies,
  normalizeCaa,
  normalizePtr,
  normalizeSoa,
} from '../lib/dns-intelligence.mts';
import { recordValue, requiredValue } from './value-assertions.mts';

type DnsOptions = NonNullable<Parameters<typeof collectDnsIntelligence>[1]>;
type DnsResolvers = NonNullable<DnsOptions['resolvers']>;

async function missing(): Promise<never> {
  const error = new Error('no data') as NodeJS.ErrnoException;
  error.code = 'ENODATA';
  throw error;
}

function resolvers(overrides: Partial<DnsResolvers> = {}): DnsResolvers {
  return {
    resolve4: missing,
    resolve6: missing,
    resolveCname: missing,
    resolveNs: missing,
    resolveMx: missing,
    resolveTxt: missing,
    resolveCaa: missing,
    resolveSoa: missing,
    resolveHttps: missing,
    ...overrides,
  };
}

test('normalizers reject malformed neighbours, deduplicate, sort, and disclose caps', () => {
  assert.deepEqual(normalizeAddresses(['192.0.2.2', 'bad', '192.0.2.1', '192.0.2.1'], 4), {
    records: ['192.0.2.1', '192.0.2.2'], truncated: false, discarded: 1,
  });
  assert.deepEqual(normalizeHostnames(['NS2.EXAMPLE.', 'bad_name', 'ns1.example', 'ns1.example']), {
    records: ['ns1.example', 'ns2.example'], truncated: false, discarded: 1,
  });
  const capped = normalizeHostnames(Array.from({ length: 20 }, (_, index) => `ns${String(index).padStart(2, '0')}.example`));
  assert.equal(capped.records.length, 16);
  assert.equal(capped.truncated, true);
  const cappedPtr = normalizePtr(Array.from({ length: 10 }, (_, index) => `ptr${String(index).padStart(2, '0')}.example`));
  assert.equal(cappedPtr.records.length, 8);
  assert.equal(cappedPtr.truncated, true);
});

test('MX, policy, and CAA normalization retains only bounded material records', () => {
  assert.deepEqual(normalizeMx([
    { priority: 20, exchange: 'MX2.EXAMPLE.' },
    { priority: 10, exchange: 'mx1.example' },
    { priority: -1, exchange: 'bad.example' },
    { priority: 0, exchange: '' },
  ]), {
    records: [
      { priority: 0, exchange: '' },
      { priority: 10, exchange: 'mx1.example' },
      { priority: 20, exchange: 'mx2.example' },
    ],
    truncated: false,
    discarded: 1,
  });
  assert.deepEqual(normalizeTxtPolicies([
    ['verification=secret'], ['v=spf1 ', 'include:mail.example -all'], ['V=SPF1 -ALL'], ['v=spf1\n-all'],
  ], 'v=spf1').records, ['V=SPF1 -ALL', 'v=spf1 include:mail.example -all']);
  assert.deepEqual(normalizeCaa([
    { critical: 0, tag: 'issue', value: 'ca.example' },
    { critical: 0, tag: 'ISSUE', value: 'ca.example' },
    { critical: 300, tag: 'issue', value: 'bad.example' },
  ]), {
    records: [{ critical: 0, tag: 'issue', value: 'ca.example' }],
    truncated: false,
    discarded: 1,
  });
});

test('effective CAA stops at the exact hostname when it publishes a policy', async () => {
  const queried: string[] = [];
  const result = await collectEffectiveCaaPolicy('shop.example.test', {
    resolver: async (owner) => {
      queried.push(owner);
      return [{ critical: 0, tag: 'issue', value: 'ca.example' }];
    },
    observedAt: () => '2026-07-31T00:00:00.000Z',
  });

  assert.equal(result.status, 'success');
  assert.equal(result.complete, true);
  assert.equal(result.effectiveOwner, 'shop.example.test');
  assert.equal(result.inherited, false);
  assert.deepEqual(result.records, [{ critical: 0, tag: 'issue', value: 'ca.example' }]);
  assert.deepEqual(queried, ['shop.example.test']);
});

test('effective CAA inherits the first parent policy without merging source owners', async () => {
  const queried: string[] = [];
  const result = await collectEffectiveCaaPolicy('shop.eu.example.test', {
    resolver: async (owner) => {
      queried.push(owner);
      if (owner === 'example.test') {
        return [{ critical: 128, tag: 'issuewild', value: 'parent-ca.example' }];
      }
      return [];
    },
  });

  assert.equal(result.status, 'success');
  assert.equal(result.complete, true);
  assert.equal(result.effectiveOwner, 'example.test');
  assert.equal(result.inherited, true);
  assert.deepEqual(result.queriedOwners.map((query) => query.owner), [
    'shop.eu.example.test',
    'eu.example.test',
    'example.test',
  ]);
  assert.deepEqual(queried, [
    'shop.eu.example.test',
    'eu.example.test',
    'example.test',
  ]);
});

test('effective CAA stops on resolver failure instead of treating it as absence', async () => {
  const queried: string[] = [];
  const result = await collectEffectiveCaaPolicy('shop.example.test', {
    resolver: async (owner) => {
      queried.push(owner);
      if (owner === 'example.test') throw new Error('resolver unavailable');
      return [];
    },
  });

  assert.equal(result.status, 'partial');
  assert.equal(result.complete, false);
  assert.equal(result.effectiveOwner, null);
  assert.equal(result.inherited, null);
  assert.deepEqual(queried, ['shop.example.test', 'example.test']);
  assert.match(String(recordValue(recordValue(result.diagnostics.tree)).error), /resolver unavailable/);
});

test('effective CAA discloses the eight-owner cap without querying closer to the root', async () => {
  const queried: string[] = [];
  const result = await collectEffectiveCaaPolicy('a.b.c.d.e.f.g.h.example.test', {
    resolver: async (owner) => {
      queried.push(owner);
      return [];
    },
  });

  assert.equal(result.status, 'partial');
  assert.equal(result.complete, false);
  assert.equal(result.truncated, true);
  assert.equal(queried.length, 8);
  assert.equal(queried.includes('example.test'), false);
});

test('SOA normalization retains one bounded record and rejects malformed timing values', () => {
  assert.deepEqual(normalizeSoa({
    nsname: 'NS1.EXAMPLE.',
    hostmaster: 'HOSTMASTER.EXAMPLE.',
    serial: 2026072701,
    refresh: 3600,
    retry: 600,
    expire: 1209600,
    minttl: 300,
  }), {
    records: [{
      nsname: 'ns1.example',
      hostmaster: 'hostmaster.example',
      serial: 2026072701,
      refresh: 3600,
      retry: 600,
      expire: 1209600,
      minttl: 300,
    }],
    truncated: false,
    discarded: 0,
  });
  assert.deepEqual(normalizeSoa({
    nsname: 'ns1.example',
    hostmaster: 'hostmaster.example',
    serial: 1,
    refresh: -1,
    retry: 600,
    expire: 1209600,
    minttl: 300,
  }), { records: [], truncated: false, discarded: 1 });
});

test('collector returns deterministic bounded evidence and compatible mail signals', async () => {
  let clock = 100;
  const result = await collectDnsIntelligence('example.test', {
    resolvers: resolvers({
      resolve4: async (name: string) => name === 'example.test'
        ? ['192.0.2.2', '192.0.2.1']
        : ['93.184.216.34'],
      resolve6: async () => ['2001:db8::1'],
      resolveCname: missing,
      resolveNs: async () => ['ns2.example.', 'ns1.example.'],
      resolveMx: async () => [{ priority: 10, exchange: 'mail.example.' }],
      resolveTxt: async (name: string) => name.startsWith('_dmarc.') ? [['v=DMARC1; p=reject']] : [['other=value'], ['v=spf1 -all']],
      resolveCaa: async () => [{ critical: 0, tag: 'issue', value: 'ca.example' }],
      resolveSoa: async () => ({
        nsname: 'ns1.example.',
        hostmaster: 'hostmaster.example.',
        serial: 2026072701,
        refresh: 3600,
        retry: 600,
        expire: 1209600,
        minttl: 300,
      }),
      resolveHttps: async () => ({
        records: [{
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
            mandatory: [1],
            alpn: ['h2', 'h3'],
            noDefaultAlpn: false,
            port: null,
            ipv4hint: [],
            ipv6hint: [],
            opaque: [{ key: 5, name: 'ech', length: 72 }],
            unknownKeys: [],
            unsupportedMandatoryKeys: [],
          },
        }],
        truncated: false,
      }),
    }),
    includeExtendedContext: true,
    registryEvidence: {
      nameservers: ['ns1.example', 'ns2.example'],
      nameserverDetails: [
        { name: 'ns1.example', addresses: ['93.184.216.34'] },
        { name: 'ns2.example', addresses: ['1.1.1.1'] },
      ],
      delegationSigned: false,
      dsData: [],
    },
    queryAuthority: async () => ({
      nameservers: ['ns1.example', 'ns2.example'],
      soaPrimary: 'ns1.example',
      errorCode: null,
      error: null,
    }),
    now: () => clock += 5,
    observedAt: () => '2026-07-13T00:00:00.000Z',
  });

  assert.equal(result.status, 'success');
  assert.equal(result.complete, true);
  assert.equal(result.observedAt, '2026-07-13T00:00:00.000Z');
  assert.equal(result.durationMs, 15);
  assert.deepEqual(result.records.a, ['192.0.2.1', '192.0.2.2']);
  assert.deepEqual(result.records.ns, ['ns1.example', 'ns2.example']);
  assert.deepEqual(result.records.spf, ['v=spf1 -all']);
  assert.deepEqual(result.records.dmarc, ['v=DMARC1; p=reject']);
  assert.equal(requiredValue(requiredValue(result.records.soa)[0]).nsname, 'ns1.example');
  assert.equal(requiredValue(requiredValue(result.records.soa)[0]).serial, 2026072701);
  assert.deepEqual(requiredValue(requiredValue(result.records.https)[0]).parameters.alpn, ['h2', 'h3']);
  assert.deepEqual(requiredValue(requiredValue(result.records.https)[0]).parameters.opaque, [{ key: 5, name: 'ech', length: 72 }]);
  assert.equal(result.hasMx, true);
  assert.equal(result.hasNullMx, false);
  assert.equal(result.hasSpf, true);
  assert.equal(result.hasDmarc, true);
  assert.equal(recordValue(result.diagnostics.cname).status, 'not_found');
  assert.equal(recordValue(result.diagnostics.soa).status, 'success');
  assert.equal(recordValue(result.diagnostics.https).status, 'success');
  assert.equal(recordValue(result.diagnostics.delegation).status, 'success');
  assert.equal(requiredValue(result.delegation).status, 'success');
});

test('extended SOA and HTTPS work is omitted unless the deep single-lookup caller requests it', async () => {
  let soaCalls = 0;
  let httpsCalls = 0;
  const result = await collectDnsIntelligence('example.test', {
    resolvers: resolvers({
      resolveSoa: async () => {
        soaCalls += 1;
        return {};
      },
      resolveHttps: async () => {
        httpsCalls += 1;
        return { records: [] };
      },
    }),
  });
  assert.equal(soaCalls, 0);
  assert.equal(httpsCalls, 0);
  assert.equal(Object.hasOwn(result.records, 'soa'), false);
  assert.equal(Object.hasOwn(result.records, 'https'), false);
  assert.equal(Object.hasOwn(result.diagnostics, 'soa'), false);
  assert.equal(Object.hasOwn(result.diagnostics, 'https'), false);
  assert.equal(Object.hasOwn(result, 'caaPolicy'), false);
});

test('the full deep DNS collector reuses the exact-owner CAA result before walking parents', async () => {
  const caaQueries: string[] = [];
  const result = await collectDnsIntelligence('shop.example.test', {
    resolvers: resolvers({
      resolveCaa: async (owner) => {
        caaQueries.push(owner);
        return owner === 'example.test'
          ? [{ critical: 0, tag: 'issue', value: 'parent-ca.example' }]
          : [];
      },
    }),
    includeInheritedCaa: true,
  });

  assert.deepEqual(caaQueries, ['shop.example.test', 'example.test']);
  assert.deepEqual(result.records.caa, []);
  const caaPolicy = requiredValue(result.caaPolicy);
  assert.equal(caaPolicy.effectiveOwner, 'example.test');
  assert.equal(caaPolicy.inherited, true);
  assert.deepEqual(caaPolicy.records, [
    { critical: 0, tag: 'issue', value: 'parent-ca.example' },
  ]);
});

test('authoritative absence remains false while resolver failure remains unknown', async () => {
  const result = await collectDnsIntelligence('example.test', {
    resolvers: resolvers({
      resolveMx: async () => { throw new Error('resolver unavailable'); },
      resolveTxt: missing,
    }),
  });
  assert.equal(result.status, 'partial');
  assert.equal(result.complete, false);
  assert.equal(result.hasMx, null);
  assert.equal(result.hasSpf, false);
  assert.equal(result.hasDmarc, false);
  assert.match(String(recordValue(result.diagnostics.mx).error), /resolver unavailable/);
});

test('discarded malformed neighbours make the observation explicitly partial', async () => {
  const result = await collectDnsIntelligence('example.test', {
    resolvers: resolvers({ resolve4: async () => ['192.0.2.1', 'malformed'] }),
  });
  assert.equal(result.status, 'partial');
  assert.equal(result.complete, false);
  assert.deepEqual(result.records.a, ['192.0.2.1']);
  assert.equal(recordValue(result.diagnostics.a).discarded, 1);
});

test('all resolver failures produce an error observation without leaking controls', async () => {
  const fail = async () => { throw new Error('resolver\nfailed'); };
  const result = await collectDnsIntelligence('example.test', { resolvers: resolvers({
    resolve4: fail, resolve6: fail, resolveCname: fail, resolveNs: fail,
    resolveMx: fail, resolveTxt: fail, resolveCaa: fail,
  }) });
  assert.equal(result.status, 'error');
  assert.equal(result.complete, false);
  assert.equal(result.hasSpf, null);
  assert.doesNotMatch(String(recordValue(result.diagnostics.a).error), /\n/);
});

test('a stalled resolver is bounded by the per-query deadline', async () => {
  const result = await collectDnsIntelligence('example.test', {
    resolvers: resolvers({ resolve4: () => new Promise(() => {}) }),
    timeoutMs: 5,
  });
  assert.equal(result.status, 'partial');
  assert.equal(recordValue(result.diagnostics.a).status, 'error');
  assert.match(String(recordValue(result.diagnostics.a).error), /timed out/);
});

test('reverse DNS retains bounded normalized PTR names as non-authoritative context', async () => {
  let clock = 100;
  const result = await collectReverseDnsIntelligence('192.0.2.10', {
    isEligibleAddress: () => true,
    resolver: async () => ['PTR2.EXAMPLE.', 'ptr1.example', 'bad_name.example'],
    now: () => clock += 5,
    observedAt: () => '2026-07-27T00:00:00.000Z',
  });

  assert.equal(result.status, 'partial');
  assert.equal(result.complete, false);
  assert.equal(result.observedAt, '2026-07-27T00:00:00.000Z');
  assert.equal(result.durationMs, 5);
  assert.deepEqual(result.records.ptr, ['ptr1.example', 'ptr2.example']);
  assert.equal(recordValue(result.diagnostics.ptr).discarded, 1);
  assert.match(result.limitations.join(' '), /does not prove hosting control/i);
});

test('reverse DNS distinguishes no PTR data, resolver failure, and ineligible addresses', async () => {
  const absent = await collectReverseDnsIntelligence('192.0.2.10', {
    isEligibleAddress: () => true,
    resolver: missing,
  });
  const failed = await collectReverseDnsIntelligence('192.0.2.10', {
    isEligibleAddress: () => true,
    resolver: async () => { throw new Error('resolver unavailable'); },
  });
  let calls = 0;
  const unsupported = await collectReverseDnsIntelligence('192.0.2.10', {
    resolver: async () => {
      calls += 1;
      return ['must-not-run.example'];
    },
  });

  assert.equal(absent.status, 'not_found');
  assert.equal(absent.complete, true);
  assert.equal(failed.status, 'error');
  assert.equal(failed.complete, false);
  assert.match(String(recordValue(failed.diagnostics.ptr).error), /resolver unavailable/);
  assert.equal(unsupported.status, 'unsupported');
  assert.equal(unsupported.complete, false);
  assert.equal(calls, 0);
});
