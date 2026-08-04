import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  URLSCAN_MAX_RESPONSE_BYTES,
  URLSCAN_PROVIDER,
  URLSCAN_SEARCH_ENDPOINT,
  URLSCAN_MAX_RESULTS,
  createUrlscanIntelligenceAdapter,
} from '../lib/urlscan-intelligence.mts';
import {
  URLHAUS_HOST_ENDPOINT,
  URLHAUS_MAX_RESPONSE_BYTES,
  URLHAUS_PROVIDER,
  URLHAUS_MAX_RESULTS,
  createUrlhausIntelligenceAdapter,
} from '../lib/urlhaus-intelligence.mts';
import {
  THREATFOX_MAX_RESPONSE_BYTES,
  THREATFOX_PROVIDER,
  THREATFOX_SEARCH_ENDPOINT,
  THREATFOX_MAX_RESULTS,
  createThreatfoxIntelligenceAdapter,
} from '../lib/threatfox-intelligence.mts';
import {
  runThreatProviderConformance,
  type ProviderConformanceProfile,
  type ProviderFixtureMode,
} from './helpers/threat-provider-conformance.mts';
import {
  LOOKUP_THREAT_INTELLIGENCE_PROVIDERS,
} from '../lib/lookup-threat-provider-inventory.mts';

const NOW = Date.parse('2026-07-15T02:03:04.000Z');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fixtureFetch(
  endpoint: string,
  mode: ProviderFixtureMode,
) {
  return async (url: string) => {
    if (mode.kind === 'timeout') {
      const error = new Error('fixture timeout');
      error.name = 'TimeoutError';
      throw error;
    }
    const response = mode.kind === 'response'
      ? await mode.response()
      : jsonResponse({});
    return {
      response,
      requestedUrl: url,
      finalUrl: endpoint,
      redirected: false,
      redirectCount: 0,
      redirectLimitReached: false,
      hops: [],
      durationMs: 1,
      status: response.status,
    };
  };
}

function oversizedReader(maxResponseBytes: number, mode: ProviderFixtureMode) {
  return mode.kind === 'oversized'
    ? async () => ({
      text: '{}',
      truncated: true,
      bytesRead: maxResponseBytes,
    })
    : undefined;
}

function urlscanRecord(index = 1) {
  const prefix = String(index).padStart(8, '0');
  return {
    _id: `${prefix}-1111-4111-8111-111111111111`,
    task: { url: 'https://example.com/', time: '2026-07-14T01:02:03.000Z' },
    page: { title: 'Fixture page' },
    verdicts: { malicious: true, categories: ['phishing'] },
  };
}

function urlhausRecord(index = 1) {
  return {
    id: String(index),
    url: `https://example.com/fixture-${index}`,
    url_status: 'online',
    date_added: '2026-07-14 01:02:03 UTC',
    threat: 'malware_download',
    tags: ['fixture'],
  };
}

function threatfoxRecord(index = 1) {
  return {
    id: String(index),
    ioc: 'example.com',
    threat_type: 'botnet_cc',
    threat_type_desc: 'Botnet command and control',
    ioc_type: 'domain',
    malware_printable: 'Fixture family',
    confidence_level: 90,
    first_seen: '2026-07-14 01:02:03 UTC',
    last_seen: '2026-07-15 02:03:04 UTC',
    tags: ['fixture'],
  };
}

const profiles: readonly ProviderConformanceProfile[] = Object.freeze([
  {
    provider: URLSCAN_PROVIDER,
    enabledEnv: {
      WHOISLEUTH_ENABLE_URLSCAN: '1',
      WHOISLEUTH_DEPLOYMENT_PURPOSE: 'personal',
      URLSCAN_API_KEY: 'fixture-api-key',
    },
    createAdapter: (mode) => {
      const readResponse = oversizedReader(URLSCAN_MAX_RESPONSE_BYTES, mode);
      return createUrlscanIntelligenceAdapter({
        now: () => NOW,
        fetchDetailed: fixtureFetch(URLSCAN_SEARCH_ENDPOINT, mode),
        ...(readResponse ? { readResponse } : {}),
      });
    },
    neutralResponse: () => jsonResponse({ results: [], has_more: false }),
    successResponse: () => jsonResponse({ results: [urlscanRecord()], has_more: false }),
    truncatedResponse: () => jsonResponse({
      results: Array.from({ length: URLSCAN_MAX_RESULTS + 1 }, (_, index) => urlscanRecord(index + 1)),
      has_more: true,
    }),
  },
  {
    provider: URLHAUS_PROVIDER,
    enabledEnv: {
      WHOISLEUTH_ENABLE_URLHAUS: '1',
      WHOISLEUTH_DEPLOYMENT_PURPOSE: 'personal',
      URLHAUS_AUTH_KEY: 'fixture-auth-key',
    },
    createAdapter: (mode) => {
      const readResponse = oversizedReader(URLHAUS_MAX_RESPONSE_BYTES, mode);
      return createUrlhausIntelligenceAdapter({
        now: () => NOW,
        fetchDetailed: fixtureFetch(URLHAUS_HOST_ENDPOINT, mode),
        ...(readResponse ? { readResponse } : {}),
      });
    },
    neutralResponse: () => jsonResponse({ query_status: 'no_results' }),
    successResponse: () => jsonResponse({
      query_status: 'ok',
      host: 'example.com',
      url_count: '1',
      urls: [urlhausRecord()],
    }),
    truncatedResponse: () => jsonResponse({
      query_status: 'ok',
      host: 'example.com',
      url_count: String(URLHAUS_MAX_RESULTS + 1),
      urls: Array.from({ length: URLHAUS_MAX_RESULTS + 1 }, (_, index) => urlhausRecord(index + 1)),
    }),
  },
  {
    provider: THREATFOX_PROVIDER,
    enabledEnv: {
      WHOISLEUTH_ENABLE_THREATFOX: '1',
      WHOISLEUTH_DEPLOYMENT_PURPOSE: 'personal',
      ABUSECH_AUTH_KEY: 'fixture-auth-key',
    },
    createAdapter: (mode) => {
      const readResponse = oversizedReader(THREATFOX_MAX_RESPONSE_BYTES, mode);
      return createThreatfoxIntelligenceAdapter({
        now: () => NOW,
        fetchDetailed: fixtureFetch(THREATFOX_SEARCH_ENDPOINT, mode),
        ...(readResponse ? { readResponse } : {}),
      });
    },
    neutralResponse: () => jsonResponse({ query_status: 'no_result', data: [] }),
    successResponse: () => jsonResponse({ query_status: 'ok', data: [threatfoxRecord()] }),
    truncatedResponse: () => jsonResponse({
      query_status: 'ok',
      data: Array.from({ length: THREATFOX_MAX_RESULTS + 1 }, (_, index) => threatfoxRecord(index + 1)),
    }),
  },
]);

describe('optional provider contract conformance', () => {
  test('covers every optional provider used by Deep Lookup exactly once', () => {
    assert.deepEqual(
      profiles.map((profile) => profile.provider.id).sort(),
      LOOKUP_THREAT_INTELLIGENCE_PROVIDERS.map((provider) => provider.id).sort(),
    );
    assert.equal(
      new Set(profiles.map((profile) => profile.provider.id)).size,
      profiles.length,
    );
  });

  for (const profile of profiles) {
    test(`${profile.provider.id} passes the shared bounded fixture contract`, async () => {
      const report = await runThreatProviderConformance(profile);
      assert.equal(report.ready, true, JSON.stringify(report, null, 2));
      assert.deepEqual(
        report.scenarios.map((item) => item.id),
        ['neutral_miss', 'rate_limit', 'oversized', 'malformed', 'timeout', 'truncation', 'provenance'],
      );
      assert.ok(report.scenarios.every((item) => item.ready));
    });
  }
});
