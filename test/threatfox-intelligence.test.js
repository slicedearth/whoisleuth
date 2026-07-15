const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  THREATFOX_PROVIDER,
  THREATFOX_SEARCH_ENDPOINT,
  THREATFOX_MAX_RESULTS,
  THREATFOX_MAX_RESPONSE_BYTES,
  createThreatfoxIntelligenceAdapter,
  threatfoxConfiguration,
} = require('../lib/threatfox-intelligence.mts');

const ENABLED_ENV = Object.freeze({
  WHOISLEUTH_ENABLE_THREATFOX: '1',
  ABUSECH_AUTH_KEY: 'fixture-auth-key',
});

function iocRecord(overrides = {}) {
  return {
    id: '123456',
    ioc: 'example.com',
    threat_type: 'botnet_cc',
    threat_type_desc: 'Botnet command and control',
    ioc_type: 'domain',
    malware: 'win.fixture',
    malware_printable: 'Fixture family',
    confidence_level: 90,
    first_seen: '2026-07-14 01:02:03 UTC',
    last_seen: '2026-07-15 02:03:04 UTC',
    tags: ['fixture-tag'],
    reporter: 'untrusted-reporter',
    reference: 'https://untrusted.example/private?token=secret',
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
  return createThreatfoxIntelligenceAdapter({
    now: () => Date.parse('2026-07-15T03:04:05.000Z'),
    fetchDetailed: async (url, options, dependencies) => {
      calls.push({ url, options, dependencies });
      return { response: await responseFactory() };
    },
  });
}

describe('malware-IOC provider policy and configuration', () => {
  test('declares a bounded exact-domain, lookup-only provider', () => {
    assert.equal(THREATFOX_PROVIDER.id, 'threatfox_domain_ioc');
    assert.deepEqual(THREATFOX_PROVIDER.targets, { domain: 'registrable_domain' });
    assert.equal(THREATFOX_PROVIDER.interaction, 'lookup_only');
    assert.equal(THREATFOX_PROVIDER.terms.commercialUse, 'restricted');
    assert.equal(THREATFOX_PROVIDER.limits.cacheTtlMs, 0);
    assert.equal(THREATFOX_PROVIDER.limits.concurrency, 1);
    assert.equal(THREATFOX_PROVIDER.limits.maxResponseBytes, THREATFOX_MAX_RESPONSE_BYTES);
  });

  test('requires an enable switch and accepts the shared or legacy abuse.ch key', () => {
    assert.equal(threatfoxConfiguration({}).configured, false);
    assert.equal(threatfoxConfiguration({ WHOISLEUTH_ENABLE_THREATFOX: '1' }).configured, false);
    assert.equal(threatfoxConfiguration(ENABLED_ENV).configured, true);
    assert.equal(threatfoxConfiguration({
      WHOISLEUTH_ENABLE_THREATFOX: '1', URLHAUS_AUTH_KEY: 'legacy-fixture-key',
    }).configured, true);
    assert.equal(threatfoxConfiguration({
      ...ENABLED_ENV, ABUSECH_AUTH_KEY: 'bad key', URLHAUS_AUTH_KEY: 'legacy-fixture-key',
    }).authKey, 'legacy-fixture-key');
  });
});

describe('malware-IOC lookup', () => {
  test('posts only an exact registrable-domain query to the fixed endpoint', async () => {
    const calls = [];
    const adapter = fixtureAdapter(async () => jsonResponse({ query_status: 'ok', data: [iocRecord()] }), calls);
    const result = await adapter.lookupDomain('login.example.com', { env: ENABLED_ENV });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, THREATFOX_SEARCH_ENDPOINT);
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      query: 'search_ioc', search_term: 'example.com', exact_match: true,
    });
    assert.equal(calls[0].options.headers['auth-key'], 'fixture-auth-key');
    assert.equal(calls[0].dependencies.maxRedirects, 0);
    assert.equal(calls[0].url.includes('fixture-auth-key'), false);
    assert.equal(result.state, 'success');
    assert.deepEqual(result.target, { type: 'domain', value: 'example.com', exposure: 'registrable_domain' });
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].category, 'malware');
    assert.equal(result.findings[0].confidence, 'high');
    assert.equal(result.findings[0].referenceUrl, 'https://threatfox.abuse.ch/ioc/123456/');
    assert.equal(result.findings[0].firstObservedAt, '2026-07-14T01:02:03.000Z');
    assert.equal(result.findings[0].lastObservedAt, '2026-07-15T02:03:04.000Z');
    assert.equal(JSON.stringify(result).includes('untrusted-reporter'), false);
    assert.equal(JSON.stringify(result).includes('private?token'), false);
    assert.equal(JSON.stringify(result).includes('fixture-auth-key'), false);
  });

  test('keeps disabled configuration and neutral misses explicit without inference', async () => {
    let calls = 0;
    const adapter = fixtureAdapter(async () => {
      calls += 1;
      return jsonResponse({ query_status: 'no_result', data: [] });
    });
    assert.equal((await adapter.lookupDomain('example.com', { env: {} })).state, 'skipped');
    const miss = await adapter.lookupDomain('example.com', { env: ENABLED_ENV });
    assert.equal(miss.state, 'not_found');
    assert.deepEqual(miss.findings, []);
    assert.match(miss.observation.limitations.join(' '), /not evidence.*safe/i);
    assert.match(miss.observation.limitations.join(' '), /expires older indicators/i);
    assert.equal(calls, 1);
  });

  test('rejects cross-domain and non-domain records rather than misattributing them', async () => {
    const adapter = fixtureAdapter(async () => jsonResponse({
      query_status: 'ok',
      data: [iocRecord(), iocRecord({ id: '2', ioc: 'example.net' }), iocRecord({ id: '3', ioc_type: 'url' })],
    }));
    const result = await adapter.lookupDomain('example.com', { env: ENABLED_ENV });
    assert.equal(result.state, 'partial');
    assert.equal(result.findings.length, 1);
    assert.match(result.observation.limitations.join(' '), /2 provider records were omitted/i);
  });

  test('bounds findings and keeps truncation explicit', async () => {
    const data = Array.from({ length: THREATFOX_MAX_RESULTS + 4 }, (_, index) => iocRecord({ id: String(index + 1) }));
    const adapter = fixtureAdapter(async () => jsonResponse({ query_status: 'ok', data }));
    const result = await adapter.lookupDomain('example.com', { env: ENABLED_ENV });
    assert.equal(result.state, 'partial');
    assert.equal(result.findings.length, THREATFOX_MAX_RESULTS);
    assert.equal(result.observation.truncated, true);
  });

  test('normalizes confidence conservatively and does not invent severity', async () => {
    const adapter = fixtureAdapter(async () => jsonResponse({
      query_status: 'ok',
      data: [
        iocRecord({ id: '1', confidence_level: 20 }),
        iocRecord({ id: '2', confidence_level: 60 }),
        iocRecord({ id: '3', confidence_level: '90' }),
      ],
    }));
    const result = await adapter.lookupDomain('example.com', { env: ENABLED_ENV });
    assert.deepEqual(result.findings.map((item) => item.confidence), ['low', 'medium', 'unknown']);
    assert.ok(result.findings.every((item) => item.severity === 'unknown'));
  });

  test('maps quota, credential, and upstream failures without retaining bodies', async () => {
    for (const fixture of [
      { status: 429, expected: 'rate_limited', headers: { 'retry-after': '90' } },
      { status: 403, expected: 'unavailable', headers: {} },
      { status: 503, expected: 'error', headers: {} },
    ]) {
      const adapter = fixtureAdapter(async () => jsonResponse({ secret: 'provider detail' }, fixture.status, fixture.headers));
      const result = await adapter.lookupDomain('example.com', { env: ENABLED_ENV });
      assert.equal(result.state, fixture.expected);
      assert.equal(result.upstreamStatus, fixture.status);
      assert.equal(JSON.stringify(result).includes('provider detail'), false);
      if (fixture.status === 429) assert.equal(result.retryAfterSeconds, 90);
    }
  });

  test('rejects oversized, malformed, and unexpected successful responses', async () => {
    const fixtures = [
      createThreatfoxIntelligenceAdapter({
        fetchDetailed: async () => ({ response: jsonResponse({ query_status: 'ok', data: [] }) }),
        readResponse: async () => ({ text: '{}', truncated: true, bytesRead: THREATFOX_MAX_RESPONSE_BYTES }),
      }),
      fixtureAdapter(async () => new Response('{', { status: 200 })),
      fixtureAdapter(async () => jsonResponse({ query_status: 'ok', data: {} })),
    ];
    for (const adapter of fixtures) {
      const result = await adapter.lookupDomain('example.com', { env: ENABLED_ENV });
      assert.equal(result.state, 'error');
      assert.deepEqual(result.findings, []);
    }
  });

  test('does not cache responses and enforces one active request per runtime', async () => {
    let calls = 0;
    const adapter = fixtureAdapter(async () => {
      calls += 1;
      return jsonResponse({ query_status: 'no_result', data: [] });
    });
    await adapter.lookupDomain('example.com', { env: ENABLED_ENV });
    await adapter.lookupDomain('example.com', { env: ENABLED_ENV });
    assert.equal(calls, 2);

    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const concurrent = fixtureAdapter(async () => {
      await held;
      return jsonResponse({ query_status: 'no_result', data: [] });
    });
    const first = concurrent.lookupDomain('example.com', { env: ENABLED_ENV });
    await new Promise((resolve) => setImmediate(resolve));
    const second = await concurrent.lookupDomain('example.net', { env: ENABLED_ENV });
    assert.equal(second.state, 'unavailable');
    release();
    await first;
  });

  test('returns a stable validation error for non-domain input', async () => {
    const adapter = fixtureAdapter(async () => jsonResponse({ query_status: 'no_result' }));
    await assert.rejects(adapter.lookupDomain('192.0.2.1', { env: ENABLED_ENV }), /valid registrable domain/);
  });
});
