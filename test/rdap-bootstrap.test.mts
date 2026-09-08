import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  BOOTSTRAP_TTL_MS,
  BOOTSTRAP_STALE_TTL_MS,
  clearRdapBootstrapCache,
  fetchBootstrap,
  parseRdap,
} from '../lib/rdap.mts';
import { findRdapBases, ipv6ToBigInt } from '../lib/rdap-bootstrap.mts';
import { deferred } from './deferred.mts';
import { fetchRdapRecordWithParser } from '../lib/rdap-client.mts';

const FIXTURE = {
  version: '1.0',
  services: [[['com'], ['https://rdap.example/']]],
};

beforeEach(clearRdapBootstrapCache);

describe('IANA RDAP bootstrap cache', () => {
  test('cancellation before queued bootstrap work starts leaves no request or unhandled rejection', async () => {
    const controller = new AbortController();
    let calls = 0;
    const pending = fetchBootstrap('dns', {
      signal: controller.signal,
      fetchUpstream: async () => {
        calls += 1;
        throw new Error('Cancelled work must not start');
      },
    });
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(calls, 0);
  });
  test('the same deadline covers bootstrap and object collection without trying another endpoint', async () => {
    for (const phase of ['bootstrap', 'object']) {
      clearRdapBootstrapCache();
      const controller = new AbortController();
      const started = deferred<void>();
      let calls = 0;
      const pending = fetchRdapRecordWithParser('domain', `${phase}-cancel.example.com`, parseRdap, {
        signal: controller.signal,
        fetchUpstream: async (_url, options) => {
          assert.equal(options.signal, controller.signal);
          calls += 1;
          if (calls === 1 && phase === 'object') {
            return { ok: true, status: 200, text: JSON.stringify({
              services: [[['com'], ['https://rdap.example/', 'https://secondary.example/']]],
            }) };
          }
          started.resolve();
          return new Promise(() => {});
        },
      });
      await started.promise;
      controller.abort();
      await assert.rejects(pending, { name: 'AbortError' });
      assert.equal(calls, phase === 'bootstrap' ? 1 : 2);
    }
  });
  test('cancellation does not use stale fallback or cancel an independent refresh', async () => {
    let now = 1_000;
    await fetchBootstrap('dns', {
      now: () => now,
      fetchUpstream: async () => ({ ok: true, status: 200, text: JSON.stringify(FIXTURE) }),
    });
    now += BOOTSTRAP_TTL_MS + 1;
    const controller = new AbortController();
    const started = deferred<void>();
    const gate = deferred<void>();
    const independent = fetchBootstrap('dns', {
      now: () => now,
      fetchUpstream: async () => {
        await gate.promise;
        return { ok: true, status: 200, text: JSON.stringify(FIXTURE) };
      },
    });
    const cancelled = fetchBootstrap('dns', {
      now: () => now, signal: controller.signal,
      fetchUpstream: async (_url, options) => {
        assert.equal(options.signal, controller.signal);
        started.resolve();
        await gate.promise;
        throw new Error('Refresh interrupted');
      },
    });
    await started.promise;
    controller.abort();
    await assert.rejects(cancelled, { name: 'AbortError' });
    gate.resolve();
    assert.deepEqual(await independent, FIXTURE);
    assert.deepEqual(await fetchBootstrap('dns', { now: () => now }), FIXTURE);
  });
  test('deduplicates concurrent cold-cache requests', async () => {
    let calls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fetchUpstream = async () => {
      calls += 1;
      await gate;
      return { ok: true, status: 200, text: JSON.stringify(FIXTURE) };
    };
    const first = fetchBootstrap('dns', { fetchUpstream });
    const second = fetchBootstrap('dns', { fetchUpstream });
    release();
    assert.deepEqual(await first, FIXTURE);
    assert.deepEqual(await second, FIXTURE);
    assert.equal(calls, 1);
  });

  test('reuses a fresh validated bootstrap without another request', async () => {
    let calls = 0;
    let now = 1_000;
    const fetchUpstream = async () => {
      calls += 1;
      return { ok: true, status: 200, text: JSON.stringify(FIXTURE) };
    };
    await fetchBootstrap('dns', { fetchUpstream, now: () => now });
    now += BOOTSTRAP_TTL_MS - 1;
    assert.deepEqual(await fetchBootstrap('dns', { fetchUpstream, now: () => now }), FIXTURE);
    assert.equal(calls, 1);
  });

  test('uses a bounded stale bootstrap when refresh temporarily fails', async () => {
    let now = 1_000;
    await fetchBootstrap('dns', {
      now: () => now,
      fetchUpstream: async () => ({ ok: true, status: 200, text: JSON.stringify(FIXTURE) }),
    });
    now += BOOTSTRAP_TTL_MS + 1;
    const stale = await fetchBootstrap('dns', {
      now: () => now,
      fetchUpstream: async () => { throw new Error('IANA unavailable'); },
    });
    assert.deepEqual(stale, FIXTURE);
  });

  test('does not use a bootstrap beyond the stale safety window', async () => {
    let now = 1_000;
    await fetchBootstrap('dns', {
      now: () => now,
      fetchUpstream: async () => ({ ok: true, status: 200, text: JSON.stringify(FIXTURE) }),
    });
    now += BOOTSTRAP_STALE_TTL_MS + 1;
    await assert.rejects(fetchBootstrap('dns', {
      now: () => now,
      fetchUpstream: async () => { throw new Error('IANA unavailable'); },
    }), /IANA unavailable/);
  });

  test('rejects malformed bootstrap data and never caches it', async () => {
    let calls = 0;
    const fetchUpstream = async () => {
      calls += 1;
      return calls === 1
        ? { ok: true, status: 200, text: JSON.stringify({ services: 'wrong' }) }
        : { ok: true, status: 200, text: JSON.stringify(FIXTURE) };
    };
    await assert.rejects(fetchBootstrap('dns', { fetchUpstream }), /unexpected format/i);
    assert.deepEqual(await fetchBootstrap('dns', { fetchUpstream }), FIXTURE);
    assert.equal(calls, 2);
  });

  test('rejects bootstrap redirects away from the fixed IANA source endpoint', async () => {
    await assert.rejects(fetchBootstrap('dns', {
      fetchUpstream: async () => ({
        ok: true,
        status: 200,
        text: JSON.stringify(FIXTURE),
        finalUrl: 'https://redirect.example/rdap/dns.json',
      }),
    }), /redirected outside its fixed source endpoint/iu);
    assert.deepEqual(await fetchBootstrap('dns', {
      fetchUpstream: async (url) => ({
        ok: true,
        status: 200,
        text: JSON.stringify(FIXTURE),
        finalUrl: url,
      }),
    }), FIXTURE);
  });

  test('routes IPv4-embedded IPv6 through the matching bootstrap prefix', async () => {
    const fixture = {
      services: [
        [['::/0'], ['https://default.example/']],
        [['::ffff:0:0/96'], ['https://embedded.example/']],
        [['::ffff:0:0/97junk'], ['https://malformed-prefix.example/']],
      ],
    };
    await fetchBootstrap('ipv6', {
      fetchUpstream: async () => ({ ok: true, status: 200, text: JSON.stringify(fixture) }),
    });

    assert.equal(ipv6ToBigInt('::ffff:127.0.0.1'), (0xffffn << 32n) + 0x7f000001n);
    assert.deepEqual(await findRdapBases('ipv6', '::ffff:127.0.0.1'), ['https://embedded.example/']);
  });
});
