import assert from 'node:assert/strict';
import { EventEmitter, getEventListeners } from 'node:events';
import { test } from 'node:test';
import { fetchFaviconHash } from '../lib/favicon.mts';
import { collectTlsIntelligence } from '../lib/tls-intelligence.mts';
import { collectDnsIntelligence, collectEffectiveCaaPolicy } from '../lib/dns-intelligence.mts';
import { collectDnsDelegationHealth } from '../lib/dns-delegation-health.mts';
import { resolveServiceBindingRecords } from '../lib/service-binding-dns.mts';
import { checkDomainAvailability, fetchHomepage } from '../lib/availability.mts';
import { networkFeaturePolicy } from '../lib/feature-policy.mts';
import { deferred } from './deferred.mts';

const cancellation = () => new Error('secondary fixture cancelled');
const forbidden = async (): Promise<never> => assert.fail('cancelled operation must not start');
const parent = { status: 'success' as const, records: ['ns.example.test'], error: null, truncated: false, discarded: 0 };

test('pre-cancelled secondary collectors admit no work', async () => {
  const signal = AbortSignal.abort(cancellation());
  await assert.rejects(collectTlsIntelligence('example.test', { signal, resolveAddresses: forbidden }), /fixture cancelled/);
  await assert.rejects(fetchFaviconHash('example.test', { signal, fetcher: forbidden }), /fixture cancelled/);
  await assert.rejects(collectDnsIntelligence('example.test', { signal, resolvers: { resolve4: forbidden } }), /fixture cancelled/);
  await assert.rejects(collectEffectiveCaaPolicy('example.test', { signal, resolver: forbidden }), /fixture cancelled/);
  await assert.rejects(collectDnsDelegationHealth('example.test', parent, { signal, resolve4: forbidden }), /fixture cancelled/);
  await assert.rejects(resolveServiceBindingRecords('example.test', 'HTTPS', { signal, exchange: forbidden }), /fixture cancelled/);
});

test('TLS drains held resolution without opening a later socket', async () => {
  const controller = new AbortController(), started = deferred<void>(), addresses = deferred<unknown>();
  let settled = false;
  const result = collectTlsIntelligence('example.test', { signal: controller.signal,
    resolveAddresses: async () => { started.resolve(); return addresses.promise; },
    connect: () => assert.fail('cancelled resolution must not open a TLS socket'),
  });
  void result.then(() => { settled = true; }, () => { settled = true; });
  const rejected = assert.rejects(result, /fixture cancelled/);
  await started.promise;
  controller.abort(cancellation());
  await Promise.resolve();
  assert.equal(settled, false);
  addresses.resolve([{ address: '93.184.216.34', family: 4 }]);
  await rejected;
});

test('TLS cancellation destroys its owned socket and removes its abort listener', async () => {
  class Socket extends EventEmitter {
    destroyed = false;
    destroy() { this.destroyed = true; }
    getPeerCertificate() { return {}; }
    getProtocol() { return null; }
    getCipher() { return {}; }
    getEphemeralKeyInfo() { return {}; }
  }
  const controller = new AbortController(), started = deferred<void>(), socket = new Socket();
  const result = collectTlsIntelligence('example.test', { signal: controller.signal,
    resolveAddresses: async () => [{ address: '93.184.216.34', family: 4 }],
    connect: () => { started.resolve(); return socket; },
  });
  const rejected = assert.rejects(result, /fixture cancelled/);
  await started.promise;
  controller.abort(cancellation());
  await rejected;
  assert.equal(socket.destroyed, true);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  socket.emit('error', new Error('late socket event'));
});

test('cancelled favicon failure cannot admit another declared or fallback candidate', async () => {
  const controller = new AbortController(), started = deferred<void>(), response = deferred<Response>();
  let requests = 0;
  let requestSignal: AbortSignal | null | undefined;
  const result = fetchFaviconHash('example.test', { signal: controller.signal,
    html: '<link rel="icon" href="/one.png"><link rel="icon" href="/two.png">',
    fetcher: async (_url, options) => { requests += 1; requestSignal = options?.signal; started.resolve(); return response.promise; },
  });
  const rejected = assert.rejects(result, /fixture cancelled/);
  await started.promise;
  controller.abort(cancellation());
  assert.equal(requestSignal?.aborted, true);
  response.reject(new Error('first candidate failed'));
  await rejected;
  assert.equal(requests, 1);
});

test('DNS cancellation stops inherited CAA and authority admission but drains sibling queries', async () => {
  const controller = new AbortController(), started = deferred<void>();
  const addresses = deferred<unknown>(), nameservers = deferred<unknown>(), caa = deferred<unknown>();
  let settled = false, caaCalls = 0, nsCalls = 0;
  const empty = async () => [];
  const result = collectDnsIntelligence('example.test', { signal: controller.signal, includeExtendedContext: true, includeInheritedCaa: true,
    resolvers: { resolve4: async () => { started.resolve(); return addresses.promise; }, resolve6: empty,
      resolveCname: empty, resolveNs: async () => { nsCalls += 1; return nameservers.promise; }, resolveMx: empty,
      resolveTxt: empty, resolveCaa: async () => { caaCalls += 1; return caa.promise; }, resolveSoa: empty, resolveHttps: empty },
    queryAuthority: forbidden,
  });
  void result.then(() => { settled = true; }, () => { settled = true; });
  const rejected = assert.rejects(result, /fixture cancelled/);
  await started.promise;
  controller.abort(cancellation());
  nameservers.resolve(['ns.example.test']); caa.resolve([]);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, false, 'an early cancelled continuation must not release still-running siblings');
  addresses.resolve([]);
  await rejected;
  assert.equal(caaCalls, 1); assert.equal(nsCalls, 1);
});

test('delegation cancellation after address resolution prevents authority sockets', async () => {
  const controller = new AbortController(), started = deferred<void>(), addresses = deferred<unknown>();
  const result = collectDnsDelegationHealth('example.test', parent, { signal: controller.signal,
    resolve4: async () => { started.resolve(); return addresses.promise; }, resolve6: async () => [],
    queryAuthority: forbidden, queryAuthorityRecords: forbidden,
  });
  const rejected = assert.rejects(result, /fixture cancelled/);
  await started.promise; controller.abort(cancellation()); addresses.resolve(['93.184.216.34']);
  await rejected;
});

test('delegation forwards cancellation to authority transport and stops record follow-up', async () => {
  const controller = new AbortController(), started = deferred<void>();
  const result = collectDnsDelegationHealth('example.test', parent, { signal: controller.signal,
    resolve4: async () => ['93.184.216.34'], resolve6: async () => [],
    queryAuthority: async input => {
      assert.equal(input.signal, controller.signal); started.resolve();
      return new Promise((_resolve, reject) => input.signal!.addEventListener('abort', () => reject(input.signal!.reason), { once: true }));
    }, queryAuthorityRecords: forbidden,
  });
  const rejected = assert.rejects(result, /fixture cancelled/);
  await started.promise; controller.abort(cancellation()); await rejected;
});

test('service-binding cancellation forbids TCP fallback and later resolvers', async () => {
  const controller = new AbortController(), started = deferred<void>(), wire = deferred<Buffer>();
  let calls = 0;
  const result = resolveServiceBindingRecords('example.test', 'HTTPS', { signal: controller.signal,
    transactionId: 0x1234, servers: ['192.0.2.53', '192.0.2.54'],
    exchange: async (_query, _resolver, options) => { assert.equal(options.signal, controller.signal); calls += 1; started.resolve(); return wire.promise; },
    tcpExchange: forbidden,
  });
  const rejected = assert.rejects(result, /fixture cancelled/);
  await started.promise; controller.abort(cancellation());
  const truncated = Buffer.alloc(12); truncated.writeUInt16BE(0x1234, 0); truncated.writeUInt16BE(0x8200, 2); wire.resolve(truncated);
  await rejected; assert.equal(calls, 1);
});

test('website enrichment forwards one caller signal and drains both secondary collectors', async () => {
  const controller = new AbortController(), entered = deferred<void>(), dns = deferred<never>(), tls = deferred<never>();
  let settled = false;
  const result = checkDomainAvailability('example.test', { signal: controller.signal,
    featurePolicy: networkFeaturePolicy({}),
    rdapRecord: { upstreamStatus: 200, parsed: { domain: 'EXAMPLE.TEST', statuses: [], nameservers: [], registrar: { name: 'Example Registrar' }, events: [], lifecycle: {} } },
    fetchHomepage: async (_domain, options) => { assert.equal(options?.signal, controller.signal); return fetchHomepage('example.test', { fetcher: async () => new Response('<main>Example</main>') }); },
    collectDnsIntelligence: async (_domain, options) => { assert.equal(options?.signal, controller.signal); return dns.promise; },
    collectTlsIntelligence: async (_domain, options) => { assert.equal(options?.signal, controller.signal); entered.resolve(); return tls.promise; },
    fetchFaviconHash: forbidden,
  });
  void result.then(() => { settled = true; }, () => { settled = true; });
  const rejected = assert.rejects(result, /fixture cancelled/);
  await entered.promise; controller.abort(cancellation()); dns.reject(controller.signal.reason);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  tls.reject(controller.signal.reason); await rejected;
});
