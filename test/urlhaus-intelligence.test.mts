import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  URLHAUS_PROVIDER,
  URLHAUS_HOST_ENDPOINT,
  URLHAUS_MAX_RESULTS,
  URLHAUS_MAX_RESPONSE_BYTES,
  createUrlhausIntelligenceAdapter,
  urlhausConfiguration,
} from '../lib/urlhaus-intelligence.mts';
import { requiredValue, stringValue } from './value-assertions.mts';

type AdapterDependencies = NonNullable<Parameters<typeof createUrlhausIntelligenceAdapter>[0]>;
type FetchDetailed = NonNullable<AdapterDependencies['fetchDetailed']>;
type FetchCall = {
  url: Parameters<FetchDetailed>[0];
  options: Parameters<FetchDetailed>[1];
  dependencies: Parameters<FetchDetailed>[2];
};

const ENABLED_ENV = Object.freeze({
  WHOISLEUTH_ENABLE_URLHAUS: '1',
  WHOISLEUTH_DEPLOYMENT_PURPOSE: 'personal',
  URLHAUS_AUTH_KEY: 'fixture-auth-key',
});

function hostRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: '123456',
    urlhaus_reference: 'https://urlhaus.abuse.ch/url/123456/',
    url: 'https://example.com/private/payload.exe?token=secret',
    url_status: 'online',
    date_added: '2026-07-14 01:02:03 UTC',
    threat: 'malware_download',
    tags: ['fixture-family', 'exe'],
    ...overrides,
  };
}

function responseBody(overrides: Record<string, unknown> = {}) {
  return {
    query_status: 'ok',
    host: 'example.com',
    firstseen: '2026-07-14 01:02:03 UTC',
    url_count: '1',
    urls: [hostRecord()],
    ...overrides,
  };
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('content-type', 'application/json');
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

function detailedResponse(
  response: Response,
  requestedUrl = URLHAUS_HOST_ENDPOINT,
): Awaited<ReturnType<FetchDetailed>> {
  return {
    response,
    requestedUrl,
    finalUrl: requestedUrl,
    redirected: false,
    redirectCount: 0,
    redirectLimitReached: false,
    hops: [],
    durationMs: 1,
    status: response.status,
  };
}

function fixtureAdapter(
  responseFactory: () => Response | Promise<Response>,
  calls: FetchCall[] = [],
) {
  return createUrlhausIntelligenceAdapter({
    now: () => Date.parse('2026-07-15T02:03:04.000Z'),
    fetchDetailed: async (url, options, dependencies) => {
      calls.push({ url, options, dependencies });
      return detailedResponse(await responseFactory(), url);
    },
  });
}

describe('malware-host provider policy and configuration', () => {
  test('declares a search-only, no-cache, bounded fair-use provider', () => {
    assert.equal(URLHAUS_PROVIDER.id, 'urlhaus_host');
    assert.deepEqual(URLHAUS_PROVIDER.capabilities, ['domain_lookup', 'indicator_search']);
    assert.deepEqual(URLHAUS_PROVIDER.targets, { domain: 'registrable_domain' });
    assert.equal(URLHAUS_PROVIDER.interaction, 'lookup_only');
    assert.equal(URLHAUS_PROVIDER.terms.commercialUse, 'restricted');
    assert.equal(URLHAUS_PROVIDER.terms.queryRetention, 'provider_defined');
    assert.equal(URLHAUS_PROVIDER.limits.cacheTtlMs, 0);
    assert.equal(URLHAUS_PROVIDER.limits.concurrency, 1);
    assert.equal(URLHAUS_PROVIDER.limits.maxResponseBytes, URLHAUS_MAX_RESPONSE_BYTES);
    assert.ok(URLHAUS_PROVIDER.limits.dailyRequests <= 200);
  });

  test('requires both an explicit enable switch and a bounded credential', () => {
    assert.deepEqual(urlhausConfiguration({}), {
      enabled: false,
      configured: false,
      authKey: null,
      reason: 'Malware-host intelligence is not enabled for this deployment.',
    });
    assert.equal(urlhausConfiguration({ WHOISLEUTH_ENABLE_URLHAUS: 'true' }).configured, false);
    assert.match(urlhausConfiguration({ WHOISLEUTH_ENABLE_URLHAUS: 'true' }).reason ?? '', /DEPLOYMENT_PURPOSE/u);
    assert.equal(urlhausConfiguration({ ...ENABLED_ENV, URLHAUS_AUTH_KEY: 'bad key' }).configured, false);
    assert.equal(urlhausConfiguration(ENABLED_ENV).configured, true);
    assert.equal(urlhausConfiguration({
      WHOISLEUTH_ENABLE_URLHAUS: '1', ABUSECH_AUTH_KEY: 'shared-fixture-key',
      WHOISLEUTH_DEPLOYMENT_PURPOSE: 'personal',
    }).configured, true);
  });
});

describe('malware-host lookup', () => {
  test('rejects zone-less provider times and canonicalizes explicit offsets', async () => {
    const invalid = await fixtureAdapter(async () => jsonResponse(responseBody({
      urls: [hostRecord({ date_added: '2026-07-14T12:00:00.000' })],
    }))).lookupDomain('example.com', { env: ENABLED_ENV });
    assert.equal(invalid.state, 'partial');
    assert.deepEqual(invalid.findings, []);
    const offset = await fixtureAdapter(async () => jsonResponse(responseBody({
      urls: [hostRecord({ date_added: '2026-07-14T12:00:00.000+01:00' })],
    }))).lookupDomain('example.com', { env: ENABLED_ENV });
    assert.equal(offset.findings[0]?.lastObservedAt, '2026-07-14T11:00:00.000Z');
  });

  test('keeps disabled and malformed configurations explicit without making a request', async () => {
    let calls = 0;
    const adapter = fixtureAdapter(async () => {
      calls += 1;
      return jsonResponse({ query_status: 'no_results' });
    });
    const disabled = await adapter.lookupDomain('example.com', { env: {} });
    const unavailable = await adapter.lookupDomain('example.com', {
      env: { WHOISLEUTH_ENABLE_URLHAUS: '1', URLHAUS_AUTH_KEY: 'short' },
    });
    assert.equal(disabled.state, 'skipped');
    assert.equal(unavailable.state, 'unavailable');
    assert.equal(calls, 0);
  });

  test('posts only the registrable domain to the fixed endpoint with a header credential', async () => {
    const calls: FetchCall[] = [];
    const adapter = fixtureAdapter(async () => jsonResponse(responseBody()), calls);
    const result = await adapter.lookupDomain('login.example.com', { env: ENABLED_ENV });

    assert.equal(calls.length, 1);
    const call = requiredValue(calls[0]);
    const options = requiredValue(call.options);
    assert.equal(call.url, URLHAUS_HOST_ENDPOINT);
    assert.equal(options.method, 'POST');
    assert.equal(options.body, 'host=example.com');
    assert.equal(new Headers(options.headers).get('auth-key'), 'fixture-auth-key');
    assert.equal(requiredValue(call.dependencies).maxRedirects, 0);
    assert.equal(JSON.stringify(call).includes('private/payload'), false);
    assert.equal(call.url.includes('fixture-auth-key'), false);
    assert.equal(result.state, 'success');
    assert.deepEqual(result.target, { type: 'domain', value: 'example.com', exposure: 'registrable_domain' });
    assert.equal(result.findings.length, 1);
    assert.equal(requiredValue(result.findings[0]).category, 'malware');
    assert.equal(requiredValue(result.findings[0]).severity, 'unknown');
    assert.equal(requiredValue(result.findings[0]).referenceUrl, 'https://urlhaus.abuse.ch/url/123456/');
    assert.equal(requiredValue(result.findings[0]).lastObservedAt, '2026-07-14T01:02:03.000Z');
    assert.equal(JSON.stringify(result).includes('private/payload'), false);
    assert.equal(JSON.stringify(result).includes('token=secret'), false);
    assert.equal(JSON.stringify(result).includes('fixture-auth-key'), false);
  });

  test('keeps a no-results response neutral and explicit', async () => {
    const adapter = fixtureAdapter(async () => jsonResponse({ query_status: 'no_results' }));
    const result = await adapter.lookupDomain('example.com', { env: ENABLED_ENV });
    assert.equal(result.state, 'not_found');
    assert.deepEqual(result.findings, []);
    assert.match(result.observation.limitations.join(' '), /not evidence.*safe/i);
  });

  test('rejects a mismatched host response instead of attaching cross-domain evidence', async () => {
    const adapter = fixtureAdapter(async () => jsonResponse(responseBody({ host: 'example.net' })));
    const result = await adapter.lookupDomain('example.com', { env: ENABLED_ENV });
    assert.equal(result.state, 'error');
    assert.deepEqual(result.findings, []);
  });

  test('omits malformed, cross-host, and non-malware records as partial data', async () => {
    const adapter = fixtureAdapter(async () => jsonResponse(responseBody({
      url_count: '4',
      urls: [
        hostRecord(),
        hostRecord({ id: 'not-an-id' }),
        hostRecord({ id: '234567', url: 'https://example.net/payload.exe' }),
        hostRecord({ id: '345678', threat: 'phishing' }),
      ],
    })));
    const result = await adapter.lookupDomain('example.com', { env: ENABLED_ENV });
    assert.equal(result.state, 'partial');
    assert.equal(result.findings.length, 1);
    assert.match(result.observation.limitations.join(' '), /3 provider records were omitted/i);
  });

  test('bounds findings while preserving provider truncation explicitly', async () => {
    const urls = Array.from({ length: URLHAUS_MAX_RESULTS + 5 }, (_, index) => hostRecord({
      id: String(100_000 + index),
      date_added: `2026-07-${String((index % 20) + 1).padStart(2, '0')} 01:02:03 UTC`,
    }));
    const adapter = fixtureAdapter(async () => jsonResponse(responseBody({
      url_count: '120',
      urls,
    })));
    const result = await adapter.lookupDomain('example.com', { env: ENABLED_ENV });
    assert.equal(result.state, 'partial');
    assert.equal(result.findings.length, URLHAUS_MAX_RESULTS);
    assert.equal(result.observation.truncated, true);
    assert.match(requiredValue(result.detail), /additional provider records may exist/i);
  });

  test('maps quota, credential, and upstream failures without exposing response bodies', async () => {
    const fixtures: Array<{ status: number; expected: string; headers: Record<string, string> }> = [
      { status: 429, expected: 'rate_limited', headers: { 'retry-after': '60' } },
      { status: 403, expected: 'unavailable', headers: {} },
      { status: 503, expected: 'error', headers: {} },
    ];
    for (const fixture of fixtures) {
      const adapter = fixtureAdapter(async () => jsonResponse({ message: 'secret provider detail' }, fixture.status, fixture.headers));
      const result = await adapter.lookupDomain('example.com', { env: ENABLED_ENV });
      assert.equal(result.state, fixture.expected);
      assert.equal(result.upstreamStatus, fixture.status);
      assert.equal(JSON.stringify(result).includes('secret provider detail'), false);
      if (fixture.status === 429) assert.equal(result.retryAfterSeconds, 60);
    }
  });

  test('maps credential failures returned inside a successful HTTP response', async () => {
    const adapter = fixtureAdapter(async () => jsonResponse({ query_status: 'no_api_key' }));
    const result = await adapter.lookupDomain('example.com', { env: ENABLED_ENV });
    assert.equal(result.state, 'unavailable');
  });

  test('rejects oversized, malformed, and unexpected successful responses', async () => {
    const fixtures = [
      createUrlhausIntelligenceAdapter({
        fetchDetailed: async () => detailedResponse(jsonResponse(responseBody())),
        readResponse: async () => ({ text: '{}', truncated: true, bytesRead: URLHAUS_MAX_RESPONSE_BYTES }),
      }),
      fixtureAdapter(async () => new Response('{', { status: 200 })),
      fixtureAdapter(async () => jsonResponse({ query_status: 'ok', host: 'example.com', records: [] })),
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
      return jsonResponse(responseBody());
    });
    await adapter.lookupDomain('example.com', { env: ENABLED_ENV });
    await adapter.lookupDomain('example.com', { env: ENABLED_ENV });
    assert.equal(calls, 2);
  });

  test('enforces one active provider request per runtime instance', async () => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const adapter = fixtureAdapter(async () => {
      await held;
      return jsonResponse(responseBody());
    });
    const first = adapter.lookupDomain('example.com', { env: ENABLED_ENV });
    await new Promise((resolve) => setImmediate(resolve));
    const second = await adapter.lookupDomain('example.net', { env: ENABLED_ENV });
    assert.equal(second.state, 'unavailable');
    assert.match(requiredValue(second.detail), /concurrency limit/i);
    requiredValue(release)();
    assert.equal((await first).state, 'success');
  });

  test('returns a stable validation error for non-domain input', async () => {
    const adapter = fixtureAdapter(async () => jsonResponse({ query_status: 'no_results' }));
    await assert.rejects(
      adapter.lookupDomain('192.0.2.1', { env: ENABLED_ENV }),
      /valid registrable domain/,
    );
  });
});
