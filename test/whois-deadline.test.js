const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildWhoisChainUncached } = require('../lib/whois');

test('the WHOIS referral chain shares one total deadline across hops', async () => {
  const times = [0, 0, 9000, 13000];
  const optionsSeen = [];
  const chain = await buildWhoisChainUncached('example.com', {
    chainDeadlineMs: 12000,
    now: () => times.shift() ?? 13000,
    whoisQuery: async (server, _query, options) => {
      optionsSeen.push({ server, ...options });
      if (server === 'whois.iana.org') return 'refer: whois.registry.example\n';
      return 'whois: whois.registrar.example\nDomain Name: EXAMPLE.COM\n';
    },
  });

  assert.equal(optionsSeen.length, 2);
  assert.equal(optionsSeen[0].totalDeadlineMs, 12000);
  assert.equal(optionsSeen[1].totalDeadlineMs, 3000);
  assert.equal(chain[2].server, 'whois.registrar.example');
  assert.match(chain[2].error, /total time limit/);
});
