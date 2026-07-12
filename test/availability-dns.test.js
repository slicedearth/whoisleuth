const test = require('node:test');
const assert = require('node:assert/strict');

const { checkDnsDelegation, checkDomainAvailability } = require('../lib/availability');

test('DNS delegation fallback normalizes, deduplicates, and sorts nameservers', async () => {
  const result = await checkDnsDelegation('example.test', {
    resolver: async () => ['NS2.EXAMPLE.', 'ns1.example', 'ns2.example.', '', 'bad_name.example'],
  });

  assert.deepEqual(result, {
    delegated: true,
    nameservers: ['ns1.example', 'ns2.example'],
    nameserversTruncated: false,
    error: null,
  });
});

test('DNS delegation fallback treats an authoritative absence as non-delegated, not available', async () => {
  const error = Object.assign(new Error('queryA ENOTFOUND'), { code: 'ENOTFOUND' });
  const result = await checkDnsDelegation('missing.test', {
    resolver: async () => { throw error; },
  });

  assert.deepEqual(result, {
    delegated: false,
    nameservers: [],
    nameserversTruncated: false,
    error: null,
  });
});

test('DNS delegation fallback preserves resolver failures as inconclusive diagnostics', async () => {
  const error = Object.assign(new Error('temporary resolver failure'), { code: 'ESERVFAIL' });
  const result = await checkDnsDelegation('example.test', {
    resolver: async () => { throw error; },
  });

  assert.equal(result.delegated, false);
  assert.deepEqual(result.nameservers, []);
  assert.match(result.error, /temporary resolver failure/);
});

test('DNS delegation fallback caps only the normalized unique nameserver inventory', async () => {
  const records = Array.from({ length: 51 }, (_, index) => `ns${String(index).padStart(2, '0')}.example`);
  records.push('NS00.EXAMPLE.', 'bad_name.example');
  const result = await checkDnsDelegation('example.test', { resolver: async () => records });

  assert.equal(result.delegated, true);
  assert.equal(result.nameservers.length, 50);
  assert.equal(result.nameserversTruncated, true);
  assert.equal(result.nameservers[0], 'ns00.example');
  assert.equal(result.nameservers.at(-1), 'ns49.example');
});

test('fast availability positively confirms a DNS-delegated domain when RDAP is unsupported', async () => {
  const result = await checkDomainAvailability('example.test', {
    fast: true,
    rdapRecord: null,
    dnsDelegation: {
      delegated: true,
      nameservers: ['ns1.example', 'ns2.example'],
      nameserversTruncated: false,
      error: null,
    },
  });

  assert.equal(result.state, 'registered');
  assert.equal(result.confidence, 'medium');
  assert.equal(result.source, 'dns');
  assert.equal(result.privacyProtected, null);
  assert.deepEqual(result.nameservers, ['ns1.example', 'ns2.example']);
  assert.match(result.detail, /DNS delegation confirms/i);
});

test('fast availability never treats a missing DNS delegation as available', async () => {
  const result = await checkDomainAvailability('missing.test', {
    fast: true,
    rdapRecord: null,
    dnsDelegation: {
      delegated: false,
      nameservers: [],
      nameserversTruncated: false,
      error: null,
    },
  });

  assert.equal(result.state, 'unknown');
  assert.equal(result.confidence, 'low');
  assert.notEqual(result.state, 'available');
});

test('RDAP registration remains authoritative and does not invoke the DNS fallback', async () => {
  let dnsCalls = 0;
  const result = await checkDomainAvailability('example.test', {
    fast: true,
    rdapRecord: {
      upstreamStatus: 200,
      rdapServer: 'https://rdap.example/domain/example.test',
      parsed: { statuses: ['active'], nameservers: [], events: [] },
    },
    resolveNs: async () => { dnsCalls += 1; return ['ns1.example']; },
  });

  assert.equal(result.state, 'registered');
  assert.equal(result.confidence, 'high');
  assert.equal(result.source, 'rdap');
  assert.equal(dnsCalls, 0);
});
