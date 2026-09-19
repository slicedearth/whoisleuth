import assert from 'node:assert/strict';
import { EventEmitter, getEventListeners } from 'node:events';
import { describe, test } from 'node:test';
import { deferred } from './deferred.mts';
import { searchCertificateTransparency } from '../lib/ct-search.mts';
import { searchRdapNameserver, searchRdapNameserverFromBases } from '../lib/rdap-nameserver-search.mts';
import { buildWhoisChainUncached, queryWhoisAddress, whoisQuery } from '../lib/whois.mts';

describe('caller-owned collector cancellation', () => {
  test('pre-cancelled collectors start no request, bootstrap, DNS or socket', async () => {
    const signal = AbortSignal.abort(new Error('fixture cancellation'));
    const forbidden = async (): Promise<never> => assert.fail('collection must not start');
    await assert.rejects(searchCertificateTransparency('example', { signal, fetcher: forbidden }), /fixture cancellation/u);
    await assert.rejects(searchRdapNameserver('ns.example.test', 'test', { signal, findBases: forbidden }), /fixture cancellation/u);
    await assert.rejects(searchRdapNameserverFromBases('ns.example.test', 'test', ['https://registry.example/'], { signal, fetchUpstream: forbidden }), /fixture cancellation/u);
    await assert.rejects(buildWhoisChainUncached('example.com', { signal, whoisQuery: forbidden }), /fixture cancellation/u);
    await assert.rejects(whoisQuery('whois.example', 'example.com', { signal, resolveAddresses: forbidden }), /fixture cancellation/u);
    await assert.rejects(queryWhoisAddress('192.0.2.1', 'whois.example', 'example.com', {
      signal, createConnection: () => assert.fail('socket must not open'),
    }), /fixture cancellation/u);
  });

  test('CT cancellation interrupts backoff without turning it into a timeout retry', async () => {
    const controller = new AbortController();
    const waiting = deferred<void>();
    let fetches = 0;
    const result = searchCertificateTransparency('example', {
      signal: controller.signal,
      fetcher: async (_url, options) => {
        assert.ok(options?.signal instanceof AbortSignal);
        fetches += 1;
        return new Response('', { status: 503 });
      },
      delay: async (_milliseconds, signal) => {
        assert.equal(signal, controller.signal);
        waiting.resolve();
        await new Promise<void>((_resolve, reject) => signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }));
      },
    });
    const rejected = assert.rejects(result, /fixture cancellation/u);
    await waiting.promise;
    controller.abort(new Error('fixture cancellation'));
    await rejected;
    assert.equal(fetches, 1);
  });

  test('CT cancellation aborts the active transport without a further attempt', async () => {
    const controller = new AbortController();
    const started = deferred<void>();
    let fetches = 0;
    const result = searchCertificateTransparency('example', {
      signal: controller.signal,
      fetcher: async (_url, options) => {
        fetches += 1;
        const signal = options!.signal!;
        started.resolve();
        return new Promise<Response>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      },
      delay: async () => assert.fail('cancelled requests must not retry'),
    });
    const rejected = assert.rejects(result, /fixture cancellation/u);
    await started.promise;
    controller.abort(new Error('fixture cancellation'));
    await rejected;
    assert.equal(fetches, 1);
  });

  test('nameserver search does not try another endpoint or retain a cancelled response', async () => {
    const controller = new AbortController();
    let fetches = 0;
    await assert.rejects(searchRdapNameserverFromBases('ns.example.test', 'test', [
      'https://registry.example/', 'https://fallback.example/',
    ], {
      signal: controller.signal,
      fetchUpstream: async (_url, options) => {
        assert.equal(options?.signal, controller.signal);
        fetches += 1;
        controller.abort(new Error('fixture cancellation'));
        return { ok: true, status: 200, text: '{"domainSearchResults":[]}' };
      },
    }), /fixture cancellation/u);
    assert.equal(fetches, 1);
  });

  test('one nameserver caller cannot cancel its peer sharing the same query', async () => {
    const first = new AbortController(), second = new AbortController();
    const started = deferred<void>();
    const cancelled = searchRdapNameserver('ns.cancel.example.test', 'test', {
      signal: first.signal,
      findBases: async (_type, _value, options) => {
        assert.equal(options?.signal, first.signal);
        started.resolve();
        return new Promise<string[]>((_resolve, reject) => first.signal.addEventListener('abort', () => reject(first.signal.reason), { once: true }));
      },
    });
    const rejected = assert.rejects(cancelled, /fixture cancellation/u);
    await started.promise;
    const peer = searchRdapNameserver('ns.cancel.example.test', 'test', {
      signal: second.signal, findBases: async () => ['https://registry.example/'],
      fetchUpstream: async () => ({ ok: true, status: 200, text: '{"domainSearchResults":[]}' }),
    });
    first.abort(new Error('fixture cancellation'));
    await rejected;
    assert.equal((await peer).state, 'no_results');
    assert.equal(second.signal.aborted, false);
  });

  test('WHOIS waits for in-flight resolution and never opens a socket after cancellation', async () => {
    const controller = new AbortController(), resolving = deferred<void>();
    const addresses = deferred<{ address: string; family: number }[]>();
    let settled = false;
    const result = whoisQuery('whois.example', 'example.com', {
      signal: controller.signal,
      resolveAddresses: async () => { resolving.resolve(); return addresses.promise; },
      queryAddress: async () => assert.fail('cancelled DNS result must not start a socket'),
    });
    void result.then(() => { settled = true; }, () => { settled = true; });
    const rejected = assert.rejects(result, /fixture cancellation/u);
    await resolving.promise;
    controller.abort(new Error('fixture cancellation'));
    await Promise.resolve();
    assert.equal(settled, false);
    addresses.resolve([{ address: '192.0.2.1', family: 4 }]);
    await rejected;
  });

  test('WHOIS cancellation prevents address failover and referral collection', async () => {
    const addressController = new AbortController();
    let attempts = 0;
    await assert.rejects(whoisQuery('whois.example', 'example.com', {
      signal: addressController.signal,
      resolveAddresses: async () => [{ address: '192.0.2.1', family: 4 }, { address: '192.0.2.2', family: 4 }],
      queryAddress: async (_address, _server, _query, options) => {
        assert.equal(options.signal, addressController.signal);
        attempts += 1; addressController.abort(new Error('fixture cancellation'));
        throw new Error('socket closed');
      },
    }), /fixture cancellation/u);
    assert.equal(attempts, 1);
    const referralController = new AbortController();
    let hops = 0;
    await assert.rejects(buildWhoisChainUncached('example.com', {
      signal: referralController.signal,
      whoisQuery: async (_server, _query, options) => {
        assert.equal(options.signal, referralController.signal);
        hops += 1; referralController.abort(new Error('fixture cancellation'));
        return 'refer: next.example';
      },
    }), /fixture cancellation/u);
    assert.equal(hops, 1);
  });

  test('WHOIS cancellation destroys its socket and cannot return a partial success on close', async () => {
    class Socket extends EventEmitter {
      destroyed = false;
      writes: string[] = [];
      write(value: string) { this.writes.push(value); }
      setTimeout() {}
      destroy() { this.destroyed = true; this.emit('close'); }
    }
    for (const connectedBeforeCancellation of [false, true]) {
      const controller = new AbortController(), socket = new Socket();
      let connected!: () => void;
      const result = queryWhoisAddress('192.0.2.1', 'whois.example', 'example.com', {
        signal: controller.signal,
        createConnection: (_options, callback) => { connected = callback; return socket; },
      });
      const rejected = assert.rejects(result, /fixture cancellation/u);
      if (connectedBeforeCancellation) { connected(); socket.emit('data', Buffer.from('Domain Name: EXAMPLE.COM')); }
      controller.abort(new Error('fixture cancellation'));
      connected(); socket.emit('data', Buffer.from('ignored')); socket.emit('end');
      await rejected;
      assert.equal(socket.destroyed, true);
      assert.deepEqual(socket.writes, connectedBeforeCancellation ? ['example.com\r\n'] : []);
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    }
  });
});
