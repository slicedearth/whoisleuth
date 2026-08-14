import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MAX_RDAP_NAMESERVER_SEARCH_RESULTS,
  RdapNameserverSearchInputError,
  normalizeRdapNameserver,
  normalizeRdapNameserverSearchPayload,
  normalizeRdapRegistryScope,
  searchRdapNameserver,
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

  test('propagates nested omissions and local display caps into per-domain partiality', () => {
    const malformed = normalizeRdapNameserverSearchPayload({
      objectClassName: 'domainSearchResults',
      domainSearchResults: [{
        objectClassName: 'domain',
        ldhName: 'ONE.EXAMPLE',
        status: ['active', null],
        events: [{ eventAction: 'registration', eventDate: '2020-01-01T00:00:00Z' }, null],
        nameservers: [{ ldhName: 'NS1.INFRA.EXAMPLE' }, null],
        secureDNS: { dsData: [{ keyTag: 1, algorithm: 13, digestType: 2, digest: 'ABCD' }, null] },
        entities: [{ handle: 'REG-1', roles: ['registrar'] }, null],
      }],
    }, 'ns1.infra.example', 'example');
    assert.equal(malformed?.domains[0]?.partial, true);

    const overLimit = normalizeRdapNameserverSearchPayload({
      objectClassName: 'domainSearchResults',
      domainSearchResults: [{
        objectClassName: 'domain',
        ldhName: 'ONE.EXAMPLE',
        status: Array.from({ length: 13 }, (_, index) => `status-${index}`),
        nameservers: [{ ldhName: 'NS1.INFRA.EXAMPLE' }],
      }],
    }, 'ns1.infra.example', 'example');
    assert.equal(overLimit?.domains[0]?.statuses.length, 12);
    assert.equal(overLimit?.domains[0]?.partial, true);

    const complete = normalizeRdapNameserverSearchPayload({
      objectClassName: 'domainSearchResults',
      domainSearchResults: [{
        objectClassName: 'domain',
        ldhName: 'ONE.EXAMPLE',
        status: Array.from({ length: 12 }, (_, index) => `status-${index}`),
        nameservers: [{ ldhName: 'NS1.INFRA.EXAMPLE' }],
        entities: [{
          handle: 'REG-1',
          roles: ['registrar'],
          vcardArray: ['vcard', [[
            'adr', {}, 'text', ['', '', '1 Example St', 'Example City', 'EX', '3000', 'AU'],
          ]]],
        }],
      }],
    }, 'ns1.infra.example', 'example');
    assert.equal(complete?.domains[0]?.partial, false);
  });

  test('rejects conflicting supplied object classes while retaining absent-class compatibility', () => {
    for (const objectClassName of ['ip network', 'autnum']) {
      const rejected = normalizeRdapNameserverSearchPayload({
        objectClassName: 'domainSearchResults',
        domainSearchResults: [{
          objectClassName,
          ldhName: 'ONE.EXAMPLE',
          nameservers: [{ ldhName: 'NS1.INFRA.EXAMPLE' }],
        }],
      }, 'ns1.infra.example', 'example');
      assert.deepEqual(rejected?.domains, []);
      assert.equal(rejected?.omittedInvalid, 1);
    }

    for (const objectClassName of ['domain', undefined]) {
      const accepted = normalizeRdapNameserverSearchPayload({
        objectClassName: 'domainSearchResults',
        domainSearchResults: [{
          ...(objectClassName === undefined ? {} : { objectClassName }),
          ldhName: 'ONE.EXAMPLE',
          nameservers: [{ ldhName: 'NS1.INFRA.EXAMPLE' }],
        }],
      }, 'ns1.infra.example', 'example');
      assert.deepEqual(accepted?.domains.map((domain) => domain.domain), ['one.example']);
      assert.equal(accepted?.omittedInvalid, 0);
    }
  });

  test('rejects malformed search object classes before normalizing results', () => {
    for (const objectClassName of [
      'domainSearchResults\n',
      'domainSearchResults\t',
      `${' '.repeat(80)}domainSearchResults`,
      '\u2028domainSearchResults',
      'domainSearchResults\u2029',
      '\ufeffdomainSearchResults',
    ]) {
      assert.equal(normalizeRdapNameserverSearchPayload({
        objectClassName,
        domainSearchResults: [{ objectClassName: 'domain', ldhName: 'ONE.EXAMPLE' }],
      }, 'ns1.infra.example', 'example'), null);
    }

    for (const objectClassName of ['domainSearchResults', ' DOMAINSEARCHRESULTS ', undefined]) {
      const normalized = normalizeRdapNameserverSearchPayload({
        ...(objectClassName === undefined ? {} : { objectClassName }),
        domainSearchResults: [{ objectClassName: 'domain', ldhName: 'ONE.EXAMPLE' }],
      }, 'ns1.infra.example', 'example');
      assert.deepEqual(normalized?.domains.map((domain) => domain.domain), ['one.example']);
    }

    for (const objectClassName of ['\u2028domain', 'domain\u2029', '\ufeffdomain']) {
      const normalized = normalizeRdapNameserverSearchPayload({
        objectClassName: 'domainSearchResults',
        domainSearchResults: [{ objectClassName, ldhName: 'ONE.EXAMPLE' }],
      }, 'ns1.infra.example', 'example');
      assert.deepEqual(normalized?.domains, []);
      assert.equal(normalized?.omittedInvalid, 1);
    }
  });

  test('marks supplied malformed domain, redaction, and variant neighbours partial', () => {
    const malformedFields = [
      { handle: { bad: true } },
      { unicodeName: { bad: true } },
      { redacted: [{ name: 'Registry ID', method: { bad: true } }] },
      { variants: [{ variantNames: [{ ldhName: 'variant.example', unicodeName: { bad: true } }] }] },
    ];
    for (const malformed of malformedFields) {
      const normalized = normalizeRdapNameserverSearchPayload({
        objectClassName: 'domainSearchResults',
        domainSearchResults: [{
          objectClassName: 'domain',
          ldhName: 'ONE.EXAMPLE',
          nameservers: [{ ldhName: 'NS1.INFRA.EXAMPLE' }],
          ...malformed,
        }],
      }, 'ns1.infra.example', 'example');
      assert.equal(normalized?.domains[0]?.partial, true, JSON.stringify(malformed));
    }

    const complete = normalizeRdapNameserverSearchPayload({
      objectClassName: 'domainSearchResults',
      domainSearchResults: [{
        objectClassName: 'domain',
        ldhName: 'ONE.EXAMPLE',
        unicodeName: 'one.example',
        handle: 'DOMAIN-1',
        nameservers: [{ ldhName: 'NS1.INFRA.EXAMPLE' }],
        redacted: [{ name: 'Registry ID', method: 'removal' }],
        variants: [{ variantNames: [{ ldhName: 'variant.example', unicodeName: 'variant.example' }] }],
      }],
    }, 'ns1.infra.example', 'example');
    assert.equal(complete?.domains[0]?.partial, false);
  });

  test('keeps usable search results but marks malformed entity and text children partial', async () => {
    const fixtures = [
      {
        domains: [{
          objectClassName: 'domain',
          ldhName: 'ONE.EXAMPLE',
          status: [],
          nameservers: [{ ldhName: 'NS1.INFRA.EXAMPLE' }],
          entities: [{ handle: 'REG-1', roles: ['registrar', null] }],
        }],
      },
      {
        domains: [{
          objectClassName: 'domain',
          ldhName: 'ONE.EXAMPLE',
          status: [],
          nameservers: [{ ldhName: 'NS1.INFRA.EXAMPLE' }],
          entities: [{
            handle: 'REG-1',
            roles: ['registrar'],
            vcardArray: ['vcard', [
              ['fn', {}, 'text', 'Valid Registrar'],
              ['email', {}, 'text', 'bad\n@example.com'],
            ]],
          }],
        }],
      },
      {
        domains: [{
          objectClassName: 'domain',
          ldhName: 'ONE.EXAMPLE',
          status: [],
          nameservers: [{ ldhName: 'NS1.INFRA.EXAMPLE' }],
        }],
        notices: [{ description: ['Retained notice.'] }, null],
      },
      {
        domains: [{
          objectClassName: 'domain',
          ldhName: 'ONE.EXAMPLE',
          status: [],
          nameservers: [{ ldhName: 'NS1.INFRA.EXAMPLE' }],
        }],
        remarks: [{ description: ['Retained remark.'] }, { description: [null] }],
      },
      {
        domains: [{
          objectClassName: 'domain',
          ldhName: 'ONE.EXAMPLE',
          status: [],
          nameservers: [{ ldhName: 'NS1.INFRA.EXAMPLE' }],
          rdapConformance: ['rdap_level_0', null],
          redacted: [null],
          variants: [{ relation: ['registered', null], variantNames: [] }],
          links: [{ rel: 'self', href: 'not-a-url' }],
          notices: [{ description: ['Retained notice.', null] }],
          remarks: [{ description: ['Retained remark.', null] }],
        }],
      },
    ];
    for (const fixture of fixtures) {
      const response = await searchRdapNameserverFromBases(
        'ns1.infra.example',
        'example',
        ['https://registry.example/rdap'],
        {
          now: () => NOW,
          fetchUpstream: async () => ({
            status: 200,
            ok: true,
            text: searchPayload(fixture.domains, fixture),
          }),
        },
      );
      assert.equal(response.state, 'partial');
      assert.equal(response.truncated, true);
      assert.deepEqual(response.domains.map((domain) => domain.domain), ['one.example']);
    }
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

  test('fails over when redirect provenance changes the nameserver-search identity', async () => {
    for (const finalUrl of [
      'https://redirect.example/rdap/domains?nsLdhName=ns2.infra.example',
      'https://redirect.example/rdap/domains?nsLdhName=ns1.infra.example&nsLdhName=ns1.infra.example',
      'https://redirect.example/rdap/domains?nsLdhName=ns1.infra.example&token=private',
      'https://redirect.example/rdap/domain?nsLdhName=ns1.infra.example',
    ]) {
      let calls = 0;
      const response = await searchRdapNameserverFromBases(
        'ns1.infra.example',
        'example',
        ['https://first.example/rdap', 'https://second.example/rdap'],
        {
          now: () => NOW,
          fetchUpstream: async () => {
            calls += 1;
            return {
              status: 200,
              ok: true,
              text: searchPayload([{
                objectClassName: 'domain',
                ldhName: 'ONE.EXAMPLE',
                status: [],
                nameservers: [{ ldhName: 'NS1.INFRA.EXAMPLE' }],
              }]),
              finalUrl: calls === 1
                ? finalUrl
                : 'https://redirect.example/rdap/domains?nsLdhName=ns1.infra.example',
            };
          },
        },
      );
      assert.equal(calls, 2, finalUrl);
      assert.equal(response.state, 'success', finalUrl);
      assert.equal(response.source.endpoint, 'https://redirect.example/rdap/domains?nsLdhName=ns1.infra.example');
      assert.deepEqual(response.source.attempts.map((attempt) => attempt.outcome), ['invalid_response', 'success']);
      assert.equal(JSON.stringify(response.source.attempts).includes(finalUrl), false, finalUrl);
    }
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

  test('enforces registry RDAP admission before bootstrap or transport work', async () => {
    let bootstrapCalls = 0;
    let transportCalls = 0;
    const response = await searchRdapNameserver('ns1.infra.example', 'ch', {
      now: () => NOW,
      findBases: async () => {
        bootstrapCalls += 1;
        return ['https://registry.example/rdap'];
      },
      fetchUpstream: async () => {
        transportCalls += 1;
        return { status: 200, ok: true, text: searchPayload([]) };
      },
    });
    assert.equal(response.state, 'unsupported');
    assert.equal(response.source.endpoint, null);
    assert.equal(bootstrapCalls, 0);
    assert.equal(transportCalls, 0);
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
    }), null);
  });

  test('browser normalization rejects URL-shaped evidence hostnames without rewriting them', () => {
    const base = {
      schema: 'whoisleuth.rdap-nameserver-search',
      version: 1,
      state: 'success',
      nameserver: 'ns1.infra.example',
      registryScope: 'example',
      lowerBound: true,
      observedAt: new Date(NOW).toISOString(),
      source: {},
      limitations: [],
    };
    for (const value of [
      'user@matched.example',
      'matched.example/private',
      'matched.example:443',
      'matched.example?query=1',
      'matched.example#fragment',
      'matched.example\\private',
    ]) {
      assert.equal(normalizeRdapNameserverSearchResponse({ ...base, nameserver: value }), null, value);
      assert.equal(
        normalizeRdapNameserverSearchResponse({ ...base, domains: [{ domain: value }] }),
        null,
        value,
      );
    }
    const valid = normalizeRdapNameserverSearchResponse({
      ...base,
      nameserver: 'NS1.BÜCHER.Example.',
      domains: [{ domain: 'BÜCHER.Example.', statuses: [], partial: false }],
    });
    assert.equal(valid?.nameserver, 'ns1.xn--bcher-kva.example');
    assert.deepEqual(valid?.domains.map((item) => item.domain), ['xn--bcher-kva.example']);
  });

  test('browser normalization rejects encoded and over-bound identities and counts local invalid omissions', () => {
    const base = {
      schema: 'whoisleuth.rdap-nameserver-search',
      version: 1,
      state: 'partial',
      nameserver: 'ns1.infra.example',
      registryScope: 'example',
      lowerBound: true,
      observedAt: new Date(NOW).toISOString(),
      source: {},
      omittedInvalid: 2,
      limitations: [],
    };
    for (const value of [
      'ns1.%65xample.com',
      'ns1.example%2ecom',
      `${'a'.repeat(252)}.example`,
      `${'a'.repeat(1_025)}.example`,
    ]) {
      assert.equal(normalizeRdapNameserverSearchResponse({ ...base, nameserver: value }), null, value);
    }
    const normalized = normalizeRdapNameserverSearchResponse({
      ...base,
      domains: [
        { domain: 'valid.example' },
        { domain: '%65xample.example' },
        { domain: 'bad host' },
        { domain: 'VALID.EXAMPLE' },
      ],
    });
    assert.deepEqual(normalized?.domains.map((item) => item.domain), ['valid.example']);
    assert.equal(normalized?.truncated, true);
    assert.equal(normalized?.omittedInvalid, 5);
  });

  test('browser normalization retains canonically bounded decomposed IDNA evidence', () => {
    const decomposed = `${`${'e\u0301'.repeat(45)}.`.repeat(3)}example`;
    const canonical = new URL(`http://${decomposed}`).hostname;
    assert.ok(decomposed.length > 253);
    for (const rootDot of ['', '.']) {
      const normalized = normalizeRdapNameserverSearchResponse({
        schema: 'whoisleuth.rdap-nameserver-search',
        version: 1,
        state: 'success',
        nameserver: `${decomposed}${rootDot}`,
        registryScope: 'example',
        lowerBound: true,
        observedAt: new Date(NOW).toISOString(),
        source: {},
        domains: [{ domain: `${decomposed}${rootDot}`, statuses: [], partial: false }],
        omittedInvalid: 0,
        truncated: false,
        limitations: [],
      });
      assert.equal(normalized?.nameserver, canonical);
      assert.deepEqual(normalized?.domains.map((item) => item.domain), [canonical]);
      assert.equal(normalized?.state, 'success');
      assert.equal(normalized?.truncated, false);
    }
  });

  test('browser normalization treats missing required per-domain completeness fields as partial', () => {
    const base = {
      schema: 'whoisleuth.rdap-nameserver-search',
      version: 1,
      state: 'success',
      nameserver: 'ns1.infra.example',
      registryScope: 'example',
      lowerBound: true,
      observedAt: new Date(NOW).toISOString(),
      source: {},
      omittedInvalid: 0,
      truncated: false,
      limitations: [],
    };
    for (const domain of [
      { domain: 'one.example', partial: false },
      { domain: 'one.example', statuses: [] },
      { domain: 'one.example', statuses: [], partial: 'false' },
    ]) {
      const normalized = normalizeRdapNameserverSearchResponse({ ...base, domains: [domain] });
      assert.equal(normalized?.state, 'partial');
      assert.equal(normalized?.truncated, true);
      assert.equal(normalized?.domains[0]?.partial, true);
    }
    const complete = normalizeRdapNameserverSearchResponse({
      ...base,
      domains: [{ domain: 'one.example', statuses: [], partial: false }],
    });
    assert.equal(complete?.state, 'success');
    assert.equal(complete?.truncated, false);
    assert.equal(complete?.domains[0]?.partial, false);
  });

  test('browser normalization treats missing or malformed top-level completeness fields as partial', () => {
    const base = {
      schema: 'whoisleuth.rdap-nameserver-search',
      version: 1,
      state: 'success',
      nameserver: 'ns1.infra.example',
      registryScope: 'example',
      lowerBound: true,
      observedAt: new Date(NOW).toISOString(),
      source: {},
      domains: [{ domain: 'one.example', statuses: [], partial: false }],
      limitations: [],
    };
    for (const completeness of [
      {},
      { truncated: false },
      { omittedInvalid: 0 },
      { truncated: 'false', omittedInvalid: 0 },
      { truncated: false, omittedInvalid: -1 },
      { truncated: false, omittedInvalid: 0.5 },
    ]) {
      const normalized = normalizeRdapNameserverSearchResponse({ ...base, ...completeness });
      assert.equal(normalized?.state, 'partial');
      assert.equal(normalized?.truncated, true);
    }
    const complete = normalizeRdapNameserverSearchResponse({
      ...base,
      truncated: false,
      omittedInvalid: 0,
    });
    assert.equal(complete?.state, 'success');
    assert.equal(complete?.truncated, false);
  });

  test('browser normalization rejects state/domain contradictions and derives partiality', () => {
    const base = {
      schema: 'whoisleuth.rdap-nameserver-search',
      version: 1,
      nameserver: 'ns1.infra.example',
      registryScope: 'example',
      lowerBound: true,
      observedAt: new Date(NOW).toISOString(),
      source: {},
      limitations: [],
      truncated: false,
      omittedInvalid: 0,
    };
    for (const state of ['no_results', 'unsupported', 'rate_limited', 'unavailable']) {
      assert.equal(normalizeRdapNameserverSearchResponse({
        ...base,
        state,
        domains: [{ domain: 'one.example' }],
      }), null, state);
    }
    assert.equal(normalizeRdapNameserverSearchResponse({
      ...base,
      state: 'no_results',
      domains: [],
      truncated: true,
    }), null);
    assert.equal(normalizeRdapNameserverSearchResponse({
      ...base,
      state: 'no_results',
      domains: [],
      omittedInvalid: 1,
    }), null);
    assert.equal(normalizeRdapNameserverSearchResponse({ ...base, state: 'success', domains: [] }), null);

    const upstreamOmission = normalizeRdapNameserverSearchResponse({
      ...base,
      state: 'success',
      domains: [{ domain: 'one.example' }],
      omittedInvalid: 2,
    });
    assert.equal(upstreamOmission?.state, 'partial');
    assert.equal(upstreamOmission?.truncated, true);
    assert.equal(upstreamOmission?.omittedInvalid, 2);

    const perDomainPartial = normalizeRdapNameserverSearchResponse({
      ...base,
      state: 'success',
      domains: [{ domain: 'one.example', partial: true }],
    });
    assert.equal(perDomainPartial?.state, 'partial');
    assert.equal(perDomainPartial?.truncated, true);

    const duplicateDomain = normalizeRdapNameserverSearchResponse({
      ...base,
      state: 'success',
      domains: [{ domain: 'one.example' }, { domain: 'ONE.EXAMPLE.' }],
    });
    assert.equal(duplicateDomain?.state, 'partial');
    assert.equal(duplicateDomain?.truncated, true);
    assert.equal(duplicateDomain?.omittedInvalid, 1);
    assert.deepEqual(duplicateDomain?.domains.map((domain) => domain.domain), ['one.example']);

    const discardedStatuses = normalizeRdapNameserverSearchResponse({
      ...base,
      state: 'success',
      domains: [{
        domain: 'one.example',
        statuses: [...Array.from({ length: 12 }, (_, index) => `status-${index}`), null],
      }],
    });
    assert.equal(discardedStatuses?.state, 'partial');
    assert.equal(discardedStatuses?.domains[0]?.statuses.length, 12);
    assert.equal(discardedStatuses?.domains[0]?.partial, true);
  });
});
