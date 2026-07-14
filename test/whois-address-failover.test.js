const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { whoisQuery, buildWhoisChainUncached } = require('../lib/whois.mts');

describe('WHOIS address failover', () => {
  test('tries validated addresses sequentially within one hop deadline', async () => {
    const calls = [];
    let clock = 1000;
    let selected = null;
    const response = await whoisQuery('whois.example', 'example.com', {
      totalDeadlineMs: 1000,
      now: () => clock,
      resolveAddresses: async () => [
        { address: '192.0.2.1', family: 4 },
        { address: '2001:db8::1', family: 6 },
      ],
      queryAddress: async (address, server, query, options) => {
        calls.push({ address, server, query, options });
        clock += 100;
        if (calls.length === 1) throw new Error('connect failed');
        return 'Domain Name: EXAMPLE.COM';
      },
      onAddressSelected: (address) => { selected = address; },
    });

    assert.equal(response, 'Domain Name: EXAMPLE.COM');
    assert.deepEqual(calls.map((call) => call.address), ['192.0.2.1', '2001:db8::1']);
    assert.equal(calls[0].options.totalDeadlineMs, 1000);
    assert.equal(calls[1].options.totalDeadlineMs, 900);
    assert.equal(selected, '2001:db8::1');
  });

  test('caps connection attempts at three validated addresses', async () => {
    const calls = [];
    await assert.rejects(
      whoisQuery('whois.example', 'example.com', {
        resolveAddresses: async () => [
          { address: '192.0.2.1' },
          { address: '192.0.2.2' },
          { address: '192.0.2.3' },
          { address: '192.0.2.4' },
        ],
        queryAddress: async (address) => {
          calls.push(address);
          throw new Error('connect failed');
        },
      }),
      /failed after 3 of 3 validated address\(es\)/
    );
    assert.deepEqual(calls, ['192.0.2.1', '192.0.2.2', '192.0.2.3']);
  });

  test('does not begin another attempt after the shared deadline expires', async () => {
    const calls = [];
    let clock = 0;
    await assert.rejects(
      whoisQuery('whois.example', 'example.com', {
        totalDeadlineMs: 500,
        now: () => clock,
        resolveAddresses: async () => [{ address: '192.0.2.1' }, { address: '192.0.2.2' }],
        queryAddress: async (address) => {
          calls.push(address);
          clock = 500;
          throw new Error('connect failed');
        },
      }),
      /failed after 1 of 2 validated address\(es\)/
    );
    assert.deepEqual(calls, ['192.0.2.1']);
  });

  test('records the address that served each successful referral hop', async () => {
    const chain = await buildWhoisChainUncached('example.com', {
      whoisQuery: async (server, query, options) => {
        options.onAddressSelected('192.0.2.10');
        return 'No match for domain';
      },
    });
    assert.equal(chain[0].address, '192.0.2.10');
  });
});
