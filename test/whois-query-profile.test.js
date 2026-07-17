'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { buildWhoisChainUncached } = require('../lib/whois.mts');

describe('WHOIS referral query profiles', () => {
  test('applies the domain-and-ACE profile only to the first .de referral', async () => {
    const calls = [];
    const responses = new Map([
      ['whois.iana.org', 'domain: DE\nrefer: whois.de.invalid\n'],
      ['whois.de.invalid', 'Domain: example.de\nStatus: connect\nwhois: whois.registrar.invalid\n'],
      ['whois.registrar.invalid', 'Domain Name: EXAMPLE.DE\n'],
    ]);
    const chain = await buildWhoisChainUncached('example.de', {
      whoisQuery: async (server, query) => {
        calls.push({ server, query });
        return responses.get(server) || '';
      },
    });

    assert.deepEqual(calls, [
      { server: 'whois.iana.org', query: 'example.de' },
      { server: 'whois.de.invalid', query: '-T dn,ace example.de' },
      { server: 'whois.registrar.invalid', query: 'example.de' },
    ]);
    assert.deepEqual(chain.map((hop) => hop.queryProfile), [
      'plain-domain', 'denic-domain-ace', 'plain-domain',
    ]);
    assert.deepEqual(chain.map((hop) => hop.responseEncoding), ['utf-8', 'utf-8', 'utf-8']);
  });

  test('requests English output only from the first .jp registry referral', async () => {
    const calls = [];
    const chain = await buildWhoisChainUncached('example.jp', {
      whoisQuery: async (server, query) => {
        calls.push({ server, query });
        return server === 'whois.iana.org'
          ? 'domain: JP\nrefer: whois.jp.invalid\n'
          : '[Domain Name] EXAMPLE.JP\n';
      },
    });

    assert.deepEqual(calls, [
      { server: 'whois.iana.org', query: 'example.jp' },
      { server: 'whois.jp.invalid', query: 'example.jp/e' },
    ]);
    assert.deepEqual(chain.map((hop) => hop.queryProfile), ['plain-domain', 'jprs-domain-english']);
    assert.deepEqual(chain.map((hop) => hop.responseEncoding), ['utf-8', 'utf-8']);
  });

  test('leaves parser-only capability profiles on the plain-domain query', async () => {
    const calls = [];
    await buildWhoisChainUncached('example.kr', {
      whoisQuery: async (server, query) => {
        calls.push({ server, query });
        return server === 'whois.iana.org'
          ? 'domain: KR\nrefer: whois.kr.invalid\n'
          : 'Domain Name................: example.kr\n';
      },
    });

    assert.deepEqual(calls, [
      { server: 'whois.iana.org', query: 'example.kr' },
      { server: 'whois.kr.invalid', query: 'example.kr' },
    ]);
  });

  test('retains query provenance when the first referral fails', async () => {
    const chain = await buildWhoisChainUncached('example.de', {
      whoisQuery: async (server) => {
        if (server === 'whois.iana.org') return 'domain: DE\nrefer: whois.de.invalid\n';
        throw new Error('synthetic registry failure');
      },
    });

    assert.equal(chain[1].server, 'whois.de.invalid');
    assert.equal(chain[1].queryProfile, 'denic-domain-ace');
    assert.equal(chain[1].responseEncoding, 'utf-8');
    assert.equal(chain[1].error, 'synthetic registry failure');
  });
});
