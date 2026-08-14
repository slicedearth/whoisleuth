import { requiredValue } from './value-assertions.mts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWhoisChainUncached } from '../lib/whois.mts';

test('the WHOIS referral chain shares one total deadline across hops', async () => {
  const times = [0, 0, 9000, 13000];
  const optionsSeen: Array<{
    server: string;
    totalDeadlineMs?: number;
  }> = [];
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
  assert.equal(requiredValue(optionsSeen[0]).totalDeadlineMs, 12000);
  assert.equal(requiredValue(optionsSeen[1]).totalDeadlineMs, 3000);
  const finalHop = chain[2];
  assert.ok(finalHop);
  assert.equal(finalHop.server, 'whois.registrar.example');
  assert.ok(finalHop.error);
  assert.match(finalHop.error, /total time limit/);
});

test('hop-limit and loop terminations remain explicit partial evidence', async () => {
  let calls = 0;
  const bounded = await buildWhoisChainUncached('example.com', {
    whoisQuery: async () => {
      calls += 1;
      return `Domain Name: EXAMPLE.COM\nRegistrar: Example Registrar\nwhois: hop${calls}.example\n`;
    },
  });
  assert.equal(calls, 6);
  assert.equal(bounded.length, 7);
  assert.equal(bounded.at(-1)?.queryProfile, 'not-issued');
  assert.match(bounded.at(-1)?.error ?? '', /hop limit/u);

  const servers: string[] = [];
  const loop = await buildWhoisChainUncached('example.com', {
    whoisQuery: async (server) => {
      servers.push(server);
      return server === 'whois.iana.org'
        ? 'refer: registry.example\n'
        : 'Domain Name: EXAMPLE.COM\nwhois: whois.iana.org\n';
    },
  });
  assert.deepEqual(servers, ['whois.iana.org', 'registry.example']);
  assert.equal(loop.at(-1)?.server, 'whois.iana.org');
  assert.match(loop.at(-1)?.error ?? '', /repeated/u);
});
