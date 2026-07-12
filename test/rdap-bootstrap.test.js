const { beforeEach, describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  BOOTSTRAP_TTL_MS,
  BOOTSTRAP_STALE_TTL_MS,
  clearRdapBootstrapCache,
  fetchBootstrap,
} = require('../lib/rdap');

const FIXTURE = {
  version: '1.0',
  services: [[['com'], ['https://rdap.example/']]],
};

beforeEach(clearRdapBootstrapCache);

describe('IANA RDAP bootstrap cache', () => {
  test('deduplicates concurrent cold-cache requests', async () => {
    let calls = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
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
});
