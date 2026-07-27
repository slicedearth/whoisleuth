import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkDomainAvailability,
  deriveWebsiteActivity,
  fetchHomepage,
  forSaleRedirectSignal,
} from '../lib/availability.mts';
import { networkFeaturePolicy } from '../lib/feature-policy.mts';
import { arrayValue, recordValue, requiredValue } from './value-assertions.mts';

describe('website activity classification', () => {
  test('any HTTP response proves that a web service is active', async () => {
    for (const status of [401, 403, 404, 503]) {
      const result = await fetchHomepage('example.com', {
        fetcher: async () => new Response('not inspected', { status }),
      });
      assert.equal(result.status, 'responded');
      assert.match(result.detail, new RegExp(`HTTP ${status}`));
      assert.equal(deriveWebsiteActivity(result.status, false), 'active');
      assert.equal(result.http.status, 'success');
      const response = recordValue(result.http.response);
      assert.equal(response.status, status);
      assert.equal(response.bodyInspected, false);
    }
  });

  test('retains redirect provenance from the shared safe fetch without another request', async () => {
    let calls = 0;
    const result = await fetchHomepage('example.com', {
      fetcher: async () => {
        calls += 1;
        return {
          response: new Response('<title>Final</title>', { status: 200, headers: { 'content-type': 'text/html' } }),
          requestedUrl: 'https://example.com/',
          finalUrl: 'https://www.example.com/final?token=secret',
          redirectCount: 1,
          redirectLimitReached: false,
          durationMs: 20,
          hops: [
            { url: 'https://example.com/', status: 301, location: 'https://www.example.com/final?token=secret', durationMs: 5 },
            { url: 'https://www.example.com/final?token=secret', status: 200, location: null, durationMs: 15 },
          ],
        };
      },
    });

    assert.equal(calls, 1);
    assert.equal(result.status, 'fetched');
    assert.equal(result.http.redirectCount, 1);
    assert.equal(result.http.finalUrl, 'https://www.example.com/final');
    assert.equal(result.http.crossOriginRedirect, true);
    assert.equal(JSON.stringify(result.http).includes('secret'), false);
  });

  test('records HTTPS failure before a successful HTTP fallback', async () => {
    let calls = 0;
    const result = await fetchHomepage('example.com', {
      fetcher: async () => {
        calls += 1;
        if (calls === 1) throw new Error('TLS handshake failed');
        return new Response('fallback', { status: 200 });
      },
    });

    assert.equal(calls, 2);
    assert.equal(result.http.transportSecurity, 'http');
    const attempts = arrayValue(result.http.attempts);
    assert.equal(attempts.length, 2);
    assert.equal(recordValue(attempts[0]).outcome, 'error');
    assert.equal(recordValue(attempts[1]).outcome, 'response');
  });

  test('both failed schemes produce explicit inconclusive HTTP evidence', async () => {
    const result = await fetchHomepage('example.com', {
      fetcher: async () => { throw new Error('connection refused'); },
    });

    assert.equal(result.status, 'inconclusive');
    assert.equal(result.http.status, 'error');
    assert.equal(result.http.complete, false);
    assert.equal(arrayValue(result.http.attempts).length, 2);
  });

  test('a capped homepage prefix is usable but explicitly partial', async () => {
    const result = await fetchHomepage('example.com', {
      fetcher: async () => new Response(Buffer.alloc(300100, 0x61), { status: 200 }),
    });

    assert.equal(result.status, 'fetched');
    assert.equal(result.http.status, 'partial');
    const response = recordValue(result.http.response);
    const bodyHash = recordValue(response.bodyHash);
    assert.equal(response.capturedBodyBytes, 300000);
    assert.equal(response.bodyTruncated, true);
    assert.equal(bodyHash.algorithm, 'sha256');
    assert.equal(bodyHash.value, '12e1b9b179b29a4f7e5889b185d7ac71bff0ad1f49a7b391d0911b737a0f5381');
    assert.equal(bodyHash.scope, 'captured-prefix');
    assert.equal(bodyHash.bytes, 300000);
  });

  test('a fetched favicon resolves an otherwise inconclusive homepage probe', () => {
    assert.equal(deriveWebsiteActivity('inconclusive', true), 'active');
    assert.equal(deriveWebsiteActivity('inconclusive', false), 'unreachable');
  });

  test('parking evidence remains stronger than generic HTTP activity', () => {
    assert.equal(deriveWebsiteActivity('fetched', true, true), 'parked');
  });

  test('recognizes an explicit for-sale landing path in bounded redirect provenance', () => {
    assert.match(requiredValue(forSaleRedirectSignal({
      finalUrl: 'https://market.example/premium-domains-for-sale',
      redirects: [],
    })), /for-sale landing-page redirect/i);
    assert.equal(forSaleRedirectSignal({
      finalUrl: 'https://market.example/account',
      redirects: [],
    }), null);
  });

  test('a sale landing redirect remains usable when the terminal page cannot be inspected', async () => {
    const result = await checkDomainAvailability('example.test', {
      featurePolicy: networkFeaturePolicy({ WHOISLEUTH_DISABLE_DNS_INTELLIGENCE: '1', WHOISLEUTH_DISABLE_TLS_INTELLIGENCE: '1' }),
      rdapRecord: {
        upstreamStatus: 200,
        parsed: { statuses: [], nameservers: [], events: [], lifecycle: {} },
      },
      fetchHomepage: async () => ({
        text: null,
        status: 'responded',
        detail: 'Web server responded, but the homepage could not be inspected.',
        http: {
          finalUrl: 'https://market.example/premium-domains-for-sale',
          redirects: [{ from: 'https://example.test/', to: 'https://market.example/premium-domains-for-sale' }],
        },
      }),
      fetchFaviconHash: async () => null,
    });

    const availability = recordValue(result);
    assert.equal(availability.state, 'for_sale');
    assert.equal(availability.activityStatus, 'parked');
    const detail = availability.detail;
    assert.ok(typeof detail === 'string');
    assert.match(detail, /for-sale landing-page redirect/i);
  });

  test('binds page identity to the homepage HTTP observation without another request', async () => {
    let homepageCalls = 0;
    const result = await checkDomainAvailability('example.test', {
      featurePolicy: networkFeaturePolicy({ WHOISLEUTH_DISABLE_DNS_INTELLIGENCE: '1', WHOISLEUTH_DISABLE_TLS_INTELLIGENCE: '1' }),
      rdapRecord: {
        upstreamStatus: 200,
        parsed: { statuses: [], nameservers: [], events: [], lifecycle: {} },
      },
      fetchHomepage: async () => {
        homepageCalls += 1;
        return {
          text: '<html lang="en"><meta name="generator" content="Hugo 0.1"><link rel="canonical" href="../account?token=secret"><astro-island></astro-island><form method="post" action="https://collect.example/submit?key=secret"></form></html>',
          status: 'fetched',
          detail: 'Homepage responded.',
          http: {
            observedAt: '2026-07-13T04:05:06.000Z',
            finalUrl: 'https://www.example.test/start/index.html',
            response: {
              bodyTruncated: true,
              bodyHash: { algorithm: 'sha256', value: 'a'.repeat(64), scope: 'captured-prefix', bytes: 162 },
              server: 'Caddy',
            },
          },
        };
      },
      fetchFaviconHash: async () => null,
    });

    const availability = recordValue(result);
    const pageIdentity = recordValue(availability.pageIdentity);
    const fingerprints = recordValue(pageIdentity.fingerprints);
    const exactFingerprint = recordValue(fingerprints.exact);
    const canonical = recordValue(pageIdentity.canonical);
    const forms = recordValue(pageIdentity.forms);
    const technologyProfile = recordValue(availability.technologyProfile);
    const technologyFindings = arrayValue(technologyProfile.findings).map(recordValue);
    const securityPosture = recordValue(availability.securityPosture);
    const securityFindings = arrayValue(securityPosture.findings).map(recordValue);
    assert.equal(homepageCalls, 1);
    assert.equal(pageIdentity.identityVersion, 3);
    assert.equal(pageIdentity.observedAt, '2026-07-13T04:05:06.000Z');
    assert.equal(pageIdentity.status, 'partial');
    assert.equal(exactFingerprint.value, 'a'.repeat(64));
    assert.equal(exactFingerprint.source, 'captured-response-bytes');
    assert.equal(canonical.url, 'https://www.example.test/account');
    assert.deepEqual(forms.externalActionOrigins, ['https://collect.example']);
    assert.doesNotMatch(JSON.stringify(pageIdentity), /token=|key=|secret|submit/);
    assert.equal(availability.credentialSurfaceProfile, null);
    assert.equal(technologyProfile.status, 'partial');
    assert.deepEqual(technologyFindings.map((item) => item.id), ['hugo', 'astro', 'caddy']);
    assert.doesNotMatch(JSON.stringify(technologyProfile), /token=|key=|secret|submit|0\.1/);
    assert.equal(securityPosture.postureVersion, 1);
    assert.equal(securityPosture.source, 'derived');
    assert.equal(securityPosture.status, 'partial');
    assert.equal(securityFindings.some((item) => item.id === 'external_form_destinations'), true);
    assert.doesNotMatch(JSON.stringify(securityPosture), /token=|key=|secret|submit|collect\.example/);
  });

  test('does not describe an explicitly non-HTML response as page identity evidence', async () => {
    const result = await checkDomainAvailability('example.test', {
      featurePolicy: networkFeaturePolicy({ WHOISLEUTH_DISABLE_DNS_INTELLIGENCE: '1', WHOISLEUTH_DISABLE_TLS_INTELLIGENCE: '1' }),
      rdapRecord: {
        upstreamStatus: 200,
        parsed: { statuses: [], nameservers: [], events: [], lifecycle: {} },
      },
      fetchHomepage: async () => ({
        text: '{"value":"<meta property=\\"og:title\\" content=\\"not a page\\">"}',
        status: 'fetched',
        detail: 'Endpoint responded.',
        http: {
          observedAt: '2026-07-13T04:05:06.000Z',
          finalUrl: 'https://example.test/api',
          response: { contentType: 'application/json', bodyTruncated: false },
        },
      }),
      fetchFaviconHash: async () => null,
    });

    const availability = recordValue(result);
    const securityPosture = recordValue(availability.securityPosture);
    const findings = arrayValue(securityPosture.findings).map(recordValue);
    assert.equal(availability.pageIdentity, null);
    assert.equal(availability.technologyProfile, null);
    assert.equal(securityPosture.source, 'derived');
    assert.equal(findings.some((item) => item.id === 'static_page_evidence_unavailable'), true);
  });
});
