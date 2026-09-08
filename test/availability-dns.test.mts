import assert from 'node:assert/strict';
import test from 'node:test';
import { checkDnsDelegation, checkDomainAvailability, isPrivacyProtected } from '../lib/availability.mts';
import { recordValue, requiredValue, stringValue } from './value-assertions.mts';
import { promises as dns } from 'node:dns';
import { deferred } from './deferred.mts';

test('cancellation interrupts a private DNS resolver without becoming an absence', async (context) => {
  const started = deferred<void>();
  const controller = new AbortController();
  let cancelled = 0;
  context.mock.method(dns.Resolver.prototype, 'resolveNs', () => {
    started.resolve();
    return new Promise<string[]>(() => {});
  });
  context.mock.method(dns.Resolver.prototype, 'cancel', () => { cancelled += 1; });
  const pending = checkDnsDelegation('example.test', { signal: controller.signal });
  await started.promise;
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(cancelled, 1);
});

test('an interrupted registry request cannot trigger a DNS fallback', async () => {
  const controller = new AbortController();
  let dnsCalls = 0;
  const result = checkDomainAvailability('example.test', {
    fast: true, signal: controller.signal,
    rdapRecordPromise: new Promise(() => {}),
    resolveNs: async () => { dnsCalls += 1; return ['ns.example']; },
  });
  controller.abort();
  await assert.rejects(result, { name: 'AbortError' });
  assert.equal(dnsCalls, 0);
});

test('cancelling concurrent delegation and WHOIS does not leak a rejection or start later probes', async () => {
  const controller = new AbortController();
  const started = deferred<void>();
  let probes = 0;
  const pending = checkDomainAvailability('example.test', {
    signal: controller.signal, rdapRecord: null,
    whoisChainPromise: new Promise(() => {}),
    resolveNs: () => { started.resolve(); return new Promise(() => {}); },
    fetchHomepage: async () => { probes += 1; throw new Error('Unexpected probe'); },
  });
  await started.promise;
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(probes, 0);
});

async function availability(domain: string, options: unknown): Promise<Record<string, unknown>> {
  return recordValue(await checkDomainAvailability(
    domain,
    options as Parameters<typeof checkDomainAvailability>[1],
  ));
}

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
  assert.match(requiredValue(result.error), /temporary resolver failure/);
});

test('DNS delegation fallback keeps an empty Error message explicitly inconclusive', async () => {
  const result = await checkDnsDelegation('example.test', {
    resolver: async () => { throw new Error(); },
  });

  assert.equal(result.delegated, false);
  assert.deepEqual(result.nameservers, []);
  assert.equal(result.error, 'Error');
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
  const result = await availability('example.test', {
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
  assert.match(stringValue(result.detail), /DNS delegation confirms/i);
});

test('fast availability never treats a missing DNS delegation as available', async () => {
  const result = await availability('missing.test', {
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

test('privacy is tri-state and requires an explicit marker or usable contact evidence', () => {
  assert.equal(isPrivacyProtected(null), null);
  assert.equal(isPrivacyProtected({ handle: null, name: null, org: null, email: null, phone: null }), null);
  assert.equal(isPrivacyProtected({ handle: null, name: 'Redacted for privacy', org: null, email: null, phone: null }), true);
  assert.equal(isPrivacyProtected({ handle: null, name: 'Fixture Registrant', org: null, email: null, phone: null }), false);
});

test('unknown availability names a registry capability refusal', async () => {
  const result = await availability('example.gt', {
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
  assert.match(stringValue(result.detail), /RDAP was not queried/u);
  assert.match(stringValue(result.detail), /no IANA-published RDAP service/u);
});

test('deep availability names a registry permission requirement', async () => {
  const result = await availability('example.es', {
    rdapRecord: null,
    whoisChain: [{
      server: 'registry capability policy',
      queryProfile: 'not-issued',
      responseEncoding: 'utf-8',
      error: 'WHOIS collection requires registry permission or source authorization; no socket was opened.',
    }],
    dnsDelegation: {
      delegated: false,
      nameservers: [],
      nameserversTruncated: false,
      error: null,
    },
  });

  assert.equal(result.state, 'unknown');
  assert.match(stringValue(result.detail), /registry permission or source authorisation is required/u);
});

test('later WHOIS hops cannot decide availability after an inconclusive registry response', async () => {
  const root = {
    server: 'whois.iana.org',
    response: 'domain: TEST\nrefer: whois.registry.example\n',
  };
  const registry = { server: 'whois.registry.example', response: '% Registry terms only.\n' };
  const dnsDelegation = { delegated: false, nameservers: [], nameserversTruncated: false, error: null };
  for (const registrarResponse of [
    'No match for EXAMPLE.TEST.\n',
    'Domain Name: EXAMPLE.TEST\nRegistrar: Example Registrar\nName Server: NS1.EXAMPLE.TEST\n',
  ]) {
    const result = await availability('example.test', {
      rdapRecord: null,
      whoisChain: [root, registry, { server: 'whois.registrar.example', response: registrarResponse }],
      dnsDelegation,
    });
    assert.equal(result.state, 'unknown');
    assert.equal(result.confidence, 'low');
    assert.notEqual(result.state, 'available');
  }

  const delegated = await availability('example.test', {
    rdapRecord: null,
    whoisChain: [root, registry, {
      server: 'whois.registrar.example',
      response: 'Domain Name: EXAMPLE.TEST\nRegistrar: Example Registrar\nName Server: NS1.REGISTRAR.EXAMPLE\n',
    }],
    dnsDelegation: {
      delegated: true,
      nameservers: ['ns1.dns.example'],
      nameserversTruncated: false,
      error: null,
    },
  });
  assert.equal(delegated.state, 'registered');
  assert.equal(delegated.source, 'dns');
  assert.deepEqual(delegated.nameservers, ['ns1.dns.example']);
  assert.equal(delegated.registrar, null);
  assert.deepEqual(delegated.statuses, []);
});

test('RDAP registration remains authoritative and does not invoke the DNS fallback', async () => {
  let dnsCalls = 0;
  const result = await availability('example.test', {
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

test('RDAP lifecycle spelling is normalized before availability classification', async () => {
  for (const status of ['redemption period', 'Redemption-Period', 'redemptionPeriod', 'pending delete']) {
    const result = await availability('example.test', {
      fast: true,
      rdapRecord: {
        upstreamStatus: 200,
        parsed: { statuses: [status], nameservers: ['ns1.example.test'] },
      },
    });
    assert.equal(result.state, 'expiring', status);
  }
});
