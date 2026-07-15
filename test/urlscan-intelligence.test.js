const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  URLSCAN_PROVIDER,
  URLSCAN_MAX_RESULTS,
  URLSCAN_MAX_RESPONSE_BYTES,
  createUrlscanIntelligenceAdapter,
  urlscanConfiguration,
} = require('../lib/urlscan-intelligence.mts');

const ENABLED_ENV = Object.freeze({
  WHOISLEUTH_ENABLE_URLSCAN: '1',
  URLSCAN_API_KEY: 'fixture-api-key',
});
const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

function searchRecord(overrides = {}) {
  return {
    _id: UUID_A,
    task: { url: 'https://login.example.com/account?private=value', time: '2026-07-14T01:02:03.000Z' },
    page: { title: 'Fixture sign-in' },
    verdicts: { malicious: true, categories: ['phishing'] },
    ...overrides,
  };
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function fixtureAdapter(responseFactory, calls = []) {
  return createUrlscanIntelligenceAdapter({
    now: () => Date.parse('2026-07-15T02:03:04.000Z'),
    fetchDetailed: async (url, options, dependencies) => {
      calls.push({ url, options, dependencies });
      return { response: await responseFactory() };
    },
  });
}

describe('URLscan provider policy and configuration', () => {
  test('declares a lookup-only, no-cache, bounded provider definition', () => {
    assert.equal(URLSCAN_PROVIDER.id, 'urlscan_search');
    assert.deepEqual(URLSCAN_PROVIDER.capabilities, ['domain_lookup', 'indicator_search']);
    assert.deepEqual(URLSCAN_PROVIDER.targets, { domain: 'registrable_domain' });
    assert.equal(URLSCAN_PROVIDER.interaction, 'lookup_only');
    assert.equal(URLSCAN_PROVIDER.terms.caching, 'prohibited');
    assert.equal(URLSCAN_PROVIDER.terms.queryRetention, 'provider_defined');
    assert.equal(URLSCAN_PROVIDER.terms.commercialUse, 'restricted');
    assert.equal(URLSCAN_PROVIDER.limits.cacheTtlMs, 0);
    assert.equal(URLSCAN_PROVIDER.limits.concurrency, 1);
    assert.equal(URLSCAN_PROVIDER.limits.maxResponseBytes, URLSCAN_MAX_RESPONSE_BYTES);
  });

  test('requires both an explicit enable switch and a bounded credential', () => {
    assert.deepEqual(urlscanConfiguration({}), {
      enabled: false,
      configured: false,
      apiKey: null,
      reason: 'Archived URLscan verdict search is not enabled for this deployment.',
    });
    assert.equal(urlscanConfiguration({ WHOISLEUTH_ENABLE_URLSCAN: 'true' }).configured, false);
    assert.equal(urlscanConfiguration({ ...ENABLED_ENV, URLSCAN_API_KEY: 'bad key' }).configured, false);
    assert.equal(urlscanConfiguration(ENABLED_ENV).configured, true);
  });
});

describe('URLscan archived-verdict lookup', () => {
  test('keeps disabled and malformed configurations explicit without making a request', async () => {
    let calls = 0;
    const adapter = fixtureAdapter(async () => {
      calls += 1;
      return jsonResponse({ results: [] });
    });
    const disabled = await adapter.lookupDomain('example.com', { env: {} });
    const unavailable = await adapter.lookupDomain('example.com', {
      env: { WHOISLEUTH_ENABLE_URLSCAN: '1', URLSCAN_API_KEY: 'short' },
    });
    assert.equal(disabled.state, 'skipped');
    assert.equal(unavailable.state, 'unavailable');
    assert.equal(calls, 0);
  });

  test('sends only the registrable domain to the fixed bounded search request', async () => {
    const calls = [];
    const adapter = fixtureAdapter(
      async () => jsonResponse({ results: [searchRecord()], has_more: false }),
      calls,
    );
    const result = await adapter.lookupDomain('login.example.com', { env: ENABLED_ENV });

    assert.equal(calls.length, 1);
    const requestUrl = new URL(calls[0].url);
    assert.equal(requestUrl.origin, 'https://urlscan.io');
    assert.equal(requestUrl.pathname, '/api/v1/search/');
    assert.equal(requestUrl.searchParams.get('size'), String(URLSCAN_MAX_RESULTS));
    assert.equal(requestUrl.searchParams.get('q'), 'task.apexDomain:example.com AND verdicts.malicious:true AND date:>now-90d');
    assert.equal(requestUrl.toString().includes('fixture-api-key'), false);
    assert.equal(requestUrl.toString().includes('account'), false);
    assert.equal(calls[0].options.headers['api-key'], 'fixture-api-key');
    assert.equal(calls[0].options.redirect, undefined);
    assert.equal(calls[0].dependencies.maxRedirects, 0);
    assert.equal(result.state, 'success');
    assert.deepEqual(result.target, { type: 'domain', value: 'example.com', exposure: 'registrable_domain' });
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].category, 'phishing');
    assert.equal(result.findings[0].referenceUrl, `https://urlscan.io/result/${UUID_A}/`);
    assert.equal(JSON.stringify(result).includes('private=value'), false);
    assert.equal(JSON.stringify(result).includes('fixture-api-key'), false);
  });

  test('keeps an empty search neutral and explicit', async () => {
    const adapter = fixtureAdapter(async () => jsonResponse({ results: [], has_more: false }));
    const result = await adapter.lookupDomain('example.com', { env: ENABLED_ENV });
    assert.equal(result.state, 'not_found');
    assert.deepEqual(result.findings, []);
    assert.match(result.observation.limitations.join(' '), /not evidence.*safe/i);
  });

  test('discards cross-domain, contradictory, and malformed records as partial data', async () => {
    const adapter = fixtureAdapter(async () => jsonResponse({
      results: [
        searchRecord({ task: { url: 'https://unrelated.example.net/' } }),
        searchRecord({ _id: UUID_B, verdicts: { malicious: false } }),
        { task: { url: 'https://example.com/' } },
      ],
      has_more: false,
    }));
    const result = await adapter.lookupDomain('example.com', { env: ENABLED_ENV });
    assert.equal(result.state, 'partial');
    assert.deepEqual(result.findings, []);
    assert.match(result.detail, /3 provider records were omitted/i);
  });

  test('bounds results and reports provider pagination as partial', async () => {
    const results = Array.from({ length: URLSCAN_MAX_RESULTS + 5 }, (_, index) => searchRecord({
      _id: `${String(index + 1).padStart(8, '0')}-1111-4111-8111-111111111111`,
    }));
    const adapter = fixtureAdapter(async () => jsonResponse({ results, has_more: true }));
    const result = await adapter.lookupDomain('example.com', { env: ENABLED_ENV });
    assert.equal(result.state, 'partial');
    assert.equal(result.findings.length, URLSCAN_MAX_RESULTS);
    assert.equal(result.observation.truncated, true);
    assert.match(result.detail, /newest 20 bounded/i);
  });

  test('maps upstream quota and credential responses without exposing response bodies', async () => {
    for (const fixture of [
      { status: 429, expected: 'rate_limited', headers: { 'retry-after': '45' } },
      { status: 401, expected: 'unavailable', headers: {} },
      { status: 503, expected: 'error', headers: {} },
    ]) {
      const adapter = fixtureAdapter(async () => jsonResponse({ message: 'secret upstream detail' }, fixture.status, fixture.headers));
      const result = await adapter.lookupDomain('example.com', { env: ENABLED_ENV });
      assert.equal(result.state, fixture.expected);
      assert.equal(result.upstreamStatus, fixture.status);
      assert.equal(JSON.stringify(result).includes('secret upstream detail'), false);
      if (fixture.status === 429) assert.equal(result.retryAfterSeconds, 45);
    }
  });

  test('rejects oversized, malformed, and unexpected successful responses', async () => {
    const fixtures = [
      createUrlscanIntelligenceAdapter({
        fetchDetailed: async () => ({ response: jsonResponse({ results: [] }) }),
        readResponse: async () => ({ text: '{}', truncated: true, bytesRead: URLSCAN_MAX_RESPONSE_BYTES }),
      }),
      fixtureAdapter(async () => new Response('{', { status: 200 })),
      fixtureAdapter(async () => jsonResponse({ records: [] })),
    ];
    for (const adapter of fixtures) {
      const result = await adapter.lookupDomain('example.com', { env: ENABLED_ENV });
      assert.equal(result.state, 'error');
      assert.deepEqual(result.findings, []);
    }
  });

  test('does not cache successful provider responses', async () => {
    let calls = 0;
    const adapter = fixtureAdapter(async () => {
      calls += 1;
      return jsonResponse({ results: [searchRecord()] });
    });
    await adapter.lookupDomain('example.com', { env: ENABLED_ENV });
    await adapter.lookupDomain('example.com', { env: ENABLED_ENV });
    assert.equal(calls, 2);
  });

  test('enforces one active provider request per runtime instance', async () => {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const adapter = fixtureAdapter(async () => {
      await held;
      return jsonResponse({ results: [searchRecord()] });
    });
    const first = adapter.lookupDomain('example.com', { env: ENABLED_ENV });
    await new Promise((resolve) => setImmediate(resolve));
    const second = await adapter.lookupDomain('example.net', { env: ENABLED_ENV });
    assert.equal(second.state, 'unavailable');
    assert.match(second.detail, /concurrency limit/i);
    release();
    assert.equal((await first).state, 'success');
  });

  test('returns a stable validation error for non-domain input', async () => {
    const adapter = fixtureAdapter(async () => jsonResponse({ results: [] }));
    await assert.rejects(
      adapter.lookupDomain('192.0.2.1', { env: ENABLED_ENV }),
      /valid registrable domain/,
    );
  });
});
