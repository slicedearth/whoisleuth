const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { fetchHomepage, deriveWebsiteActivity } = require('../lib/availability');

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
      assert.equal(result.http.response.status, status);
      assert.equal(result.http.response.bodyInspected, false);
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
    assert.equal(result.http.attempts.length, 2);
    assert.equal(result.http.attempts[0].outcome, 'error');
    assert.equal(result.http.attempts[1].outcome, 'response');
  });

  test('both failed schemes produce explicit inconclusive HTTP evidence', async () => {
    const result = await fetchHomepage('example.com', {
      fetcher: async () => { throw new Error('connection refused'); },
    });

    assert.equal(result.status, 'inconclusive');
    assert.equal(result.http.status, 'error');
    assert.equal(result.http.complete, false);
    assert.equal(result.http.attempts.length, 2);
  });

  test('a capped homepage prefix is usable but explicitly partial', async () => {
    const result = await fetchHomepage('example.com', {
      fetcher: async () => new Response(Buffer.alloc(300100, 0x61), { status: 200 }),
    });

    assert.equal(result.status, 'fetched');
    assert.equal(result.http.status, 'partial');
    assert.equal(result.http.response.capturedBodyBytes, 300000);
    assert.equal(result.http.response.bodyTruncated, true);
  });

  test('a fetched favicon resolves an otherwise inconclusive homepage probe', () => {
    assert.equal(deriveWebsiteActivity('inconclusive', true), 'active');
    assert.equal(deriveWebsiteActivity('inconclusive', false), 'unreachable');
  });

  test('parking evidence remains stronger than generic HTTP activity', () => {
    assert.equal(deriveWebsiteActivity('fetched', true, true), 'parked');
  });
});
