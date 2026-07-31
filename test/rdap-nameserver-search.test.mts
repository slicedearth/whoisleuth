import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MAX_RDAP_NAMESERVER_SEARCH_RESULTS,
  RdapNameserverSearchInputError,
  normalizeRdapNameserver,
  normalizeRdapNameserverSearchPayload,
  normalizeRdapRegistryScope,
  searchRdapNameserverFromBases,
} from '../lib/rdap-nameserver-search.mts';
import { normalizeRdapNameserverSearchResponse } from '../frontend/src/lib/analysis/rdap-nameserver-search.ts';

const NOW = 1_750_000_000_000;

function searchPayload(domains: unknown[], extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    objectClassName: 'domainSearchResults',
    domainSearchResults: domains,
    ...extra,
  });
}

describe('registry-scoped RDAP nameserver search', () => {
  test('normalizes the nameserver and one-label registry scope', () => {
    assert.equal(normalizeRdapNameserver(' NS1.BÜCHER.EXAMPLE. '), 'ns1.xn--bcher-kva.example');
    assert.equal(normalizeRdapRegistryScope('.COM'), 'com');
    assert.equal(normalizeRdapRegistryScope('中国'), 'xn--fiqs8s');
    for (const invalid of ['', 'localhost', 'ns_1.example', 'https://ns1.example/path']) {
      assert.throws(() => normalizeRdapNameserver(invalid), RdapNameserverSearchInputError);
    }
    for (const invalid of ['', 'co.uk', 'bad_scope']) {
      assert.throws(() => normalizeRdapRegistryScope(invalid), RdapNameserverSearchInputError);
    }
  });

  test('bounds results, filters out-of-scope objects, and retains truncation notices', () => {
    const domains = [
      { objectClassName: 'domain', ldhName: 'OTHER.NET' },
      ...Array.from({ length: MAX_RDAP_NAMESERVER_SEARCH_RESULTS + 5 }, (_, index) => ({
        objectClassName: 'domain',
        ldhName: `DOMAIN-${index}.EXAMPLE`,
        nameservers: [{ ldhName: 'NS1.INFRA.EXAMPLE' }],
      })),
    ];
    const normalized = normalizeRdapNameserverSearchPayload({
      objectClassName: 'domainSearchResults',
      domainSearchResults: domains,
      notices: [{
        title: 'Result limit',
        type: 'result set truncated due to excessive load',
        description: ['The registry limited this search.'],
      }],
    }, 'ns1.infra.example', 'example');
    assert.ok(normalized);
    assert.equal(normalized.domains.length, MAX_RDAP_NAMESERVER_SEARCH_RESULTS);
    assert.equal(normalized.localTruncated, true);
    assert.equal(normalized.serverTruncated, true);
    assert.deepEqual(normalized.serverTruncationReasons, ['result set truncated due to excessive load']);
    assert.equal(normalized.omittedInvalid, 1);
    assert.ok(normalized.domains.every((domain) => domain.nameserverObserved === true));
  });

  test('fails over unsupported services and returns a scoped lower-bound result', async () => {
    const calls: string[] = [];
    const response = await searchRdapNameserverFromBases(
      'ns1.infra.example',
      'example',
      ['https://first.example/rdap/', 'https://second.example/rdap'],
      {
        now: () => NOW,
        fetchUpstream: async (url) => {
          calls.push(url);
          if (url.includes('first.example')) return { status: 501, ok: false, text: '{}' };
          return {
            status: 200,
            ok: true,
            text: searchPayload([{
              objectClassName: 'domain',
              ldhName: 'MATCHED.EXAMPLE',
              status: ['active'],
              nameservers: [{ ldhName: 'NS1.INFRA.EXAMPLE' }],
            }]),
          };
        },
      },
    );
    assert.deepEqual(calls, [
      'https://first.example/rdap/domains?nsLdhName=ns1.infra.example',
      'https://second.example/rdap/domains?nsLdhName=ns1.infra.example',
    ]);
    assert.equal(response.state, 'success');
    assert.equal(response.lowerBound, true);
    assert.equal(response.registryScope, 'example');
    assert.deepEqual(response.domains.map((domain) => domain.domain), ['matched.example']);
    assert.deepEqual(response.source.attempts.map((attempt) => attempt.outcome), ['unsupported', 'success']);
    assert.match(response.limitations[0] ?? '', /only the \.example registry/iu);
    assert.ok(normalizeRdapNameserverSearchResponse(response));
  });

  test('preserves unsupported, no-result, rate-limit, and unavailable states', async () => {
    const unsupported = await searchRdapNameserverFromBases('ns1.infra.example', 'example', [
      'https://registry.example/rdap',
    ], { now: () => NOW, fetchUpstream: async () => ({ status: 405, ok: false, text: '{}' }) });
    assert.equal(unsupported.state, 'unsupported');

    const empty = await searchRdapNameserverFromBases('ns1.infra.example', 'example', [
      'https://registry.example/rdap',
    ], { now: () => NOW, fetchUpstream: async () => ({ status: 404, ok: false, text: '{}' }) });
    assert.equal(empty.state, 'no_results');

    const limited = await searchRdapNameserverFromBases('ns1.infra.example', 'example', [
      'https://registry.example/rdap',
    ], { now: () => NOW, fetchUpstream: async () => ({ status: 429, ok: false, text: '{}' }) });
    assert.equal(limited.state, 'rate_limited');

    const invalid = await searchRdapNameserverFromBases('ns1.infra.example', 'example', [
      'https://registry.example/rdap',
    ], { now: () => NOW, fetchUpstream: async () => ({ status: 200, ok: true, text: '{' }) });
    assert.equal(invalid.state, 'unavailable');

    const malformedMatches = await searchRdapNameserverFromBases('ns1.infra.example', 'example', [
      'https://registry.example/rdap',
    ], {
      now: () => NOW,
      fetchUpstream: async () => ({
        status: 200,
        ok: true,
        text: searchPayload([{ objectClassName: 'domain', ldhName: 'outside.test' }]),
      }),
    });
    assert.equal(malformedMatches.state, 'partial');
    assert.equal(malformedMatches.resultCount, 0);
    assert.equal(malformedMatches.omittedInvalid, 1);
  });

  test('browser normalization rejects malformed or unscoped payloads', () => {
    assert.equal(normalizeRdapNameserverSearchResponse({}), null);
    assert.equal(normalizeRdapNameserverSearchResponse({
      schema: 'whoisleuth.rdap-nameserver-search',
      version: 1,
      state: 'success',
      nameserver: 'ns1.infra.example',
      registryScope: 'example',
      lowerBound: true,
      observedAt: new Date(NOW).toISOString(),
      source: {},
      domains: [{ domain: 'outside.test' }],
      limitations: [],
    })?.domains.length, 0);
  });
});
