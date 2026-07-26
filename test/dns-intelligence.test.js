const test = require('node:test');
const assert = require('node:assert/strict');
const {
  collectDnsIntelligence,
  collectReverseDnsIntelligence,
  normalizeAddresses,
  normalizeHostnames,
  normalizeMx,
  normalizeTxtPolicies,
  normalizeCaa,
  normalizePtr,
  normalizeSoa,
} = require('../lib/dns-intelligence.mts');

function missing() {
  const error = new Error('no data');
  error.code = 'ENODATA';
  throw error;
}

function resolvers(overrides = {}) {
  return {
    resolve4: missing,
    resolve6: missing,
    resolveCname: missing,
    resolveNs: missing,
    resolveMx: missing,
    resolveTxt: missing,
    resolveCaa: missing,
    resolveSoa: missing,
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
      resolve4: async () => ['192.0.2.2', '192.0.2.1'],
      resolve6: async () => ['2001:db8::1'],
      resolveCname: missing,
      resolveNs: async () => ['ns2.example.', 'ns1.example.'],
      resolveMx: async () => [{ priority: 10, exchange: 'mail.example.' }],
      resolveTxt: async (name) => name.startsWith('_dmarc.') ? [['v=DMARC1; p=reject']] : [['other=value'], ['v=spf1 -all']],
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
    }),
    includeExtendedContext: true,
    now: () => clock += 5,
    observedAt: () => '2026-07-13T00:00:00.000Z',
  });

  assert.equal(result.status, 'success');
  assert.equal(result.complete, true);
  assert.equal(result.observedAt, '2026-07-13T00:00:00.000Z');
  assert.equal(result.durationMs, 5);
  assert.deepEqual(result.records.a, ['192.0.2.1', '192.0.2.2']);
  assert.deepEqual(result.records.ns, ['ns1.example', 'ns2.example']);
  assert.deepEqual(result.records.spf, ['v=spf1 -all']);
  assert.deepEqual(result.records.dmarc, ['v=DMARC1; p=reject']);
  assert.equal(result.records.soa[0].nsname, 'ns1.example');
  assert.equal(result.records.soa[0].serial, 2026072701);
  assert.equal(result.hasMx, true);
  assert.equal(result.hasNullMx, false);
  assert.equal(result.hasSpf, true);
  assert.equal(result.hasDmarc, true);
  assert.equal(result.diagnostics.cname.status, 'not_found');
  assert.equal(result.diagnostics.soa.status, 'success');
});

test('extended SOA work is omitted unless the deep single-lookup caller requests it', async () => {
  let soaCalls = 0;
  const result = await collectDnsIntelligence('example.test', {
    resolvers: resolvers({
      resolveSoa: async () => {
        soaCalls += 1;
        return {};
      },
    }),
  });
  assert.equal(soaCalls, 0);
  assert.equal(Object.hasOwn(result.records, 'soa'), false);
  assert.equal(Object.hasOwn(result.diagnostics, 'soa'), false);
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
  assert.match(result.diagnostics.mx.error, /resolver unavailable/);
});

test('discarded malformed neighbours make the observation explicitly partial', async () => {
  const result = await collectDnsIntelligence('example.test', {
    resolvers: resolvers({ resolve4: async () => ['192.0.2.1', 'malformed'] }),
  });
  assert.equal(result.status, 'partial');
  assert.equal(result.complete, false);
  assert.deepEqual(result.records.a, ['192.0.2.1']);
  assert.equal(result.diagnostics.a.discarded, 1);
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
  assert.doesNotMatch(result.diagnostics.a.error, /\n/);
});

test('a stalled resolver is bounded by the per-query deadline', async () => {
  const result = await collectDnsIntelligence('example.test', {
    resolvers: resolvers({ resolve4: () => new Promise(() => {}) }),
    timeoutMs: 5,
  });
  assert.equal(result.status, 'partial');
  assert.equal(result.diagnostics.a.status, 'error');
  assert.match(result.diagnostics.a.error, /timed out/);
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
  assert.equal(result.diagnostics.ptr.discarded, 1);
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
  assert.match(failed.diagnostics.ptr.error, /resolver unavailable/);
  assert.equal(unsupported.status, 'unsupported');
  assert.equal(unsupported.complete, false);
  assert.equal(calls, 0);
});
