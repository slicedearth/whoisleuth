const test = require('node:test');
const assert = require('node:assert/strict');
const {
  collectDnsIntelligence,
  normalizeAddresses,
  normalizeHostnames,
  normalizeMx,
  normalizeTxtPolicies,
  normalizeCaa,
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
    }),
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
  assert.equal(result.hasMx, true);
  assert.equal(result.hasNullMx, false);
  assert.equal(result.hasSpf, true);
  assert.equal(result.hasDmarc, true);
  assert.equal(result.diagnostics.cname.status, 'not_found');
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
