const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_HTTP_PROVENANCE_URL,
  buildHttpObservation,
  failedHttpObservation,
  normalizeProvenanceUrl,
  skippedHttpObservation,
} = require('../lib/http-intelligence');

const OBSERVED_AT = '2026-07-13T00:00:00.000Z';

describe('HTTP provenance URL normalization', () => {
  test('retains origin and path while omitting query strings and fragments', () => {
    assert.deepEqual(normalizeProvenanceUrl('https://example.com/login?token=secret#part'), {
      url: 'https://example.com/login',
      queryOmitted: true,
      pathTruncated: false,
    });
  });

  test('rejects credentials and non-HTTP schemes', () => {
    assert.equal(normalizeProvenanceUrl('https://user:secret@example.com/'), null);
    assert.equal(normalizeProvenanceUrl('file:///etc/passwd'), null);
  });

  test('replaces an overlong path with a bounded origin URL', () => {
    const result = normalizeProvenanceUrl(`https://example.com/${'a'.repeat(MAX_HTTP_PROVENANCE_URL)}`);
    assert.equal(result.url, 'https://example.com/');
    assert.equal(result.pathTruncated, true);
  });
});

describe('buildHttpObservation', () => {
  test('normalizes redirects, response metadata, and selected security headers', () => {
    const response = new Response('<title>Example</title>', {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-language': 'en',
        'content-length': '22',
        server: 'Example Server',
        'strict-transport-security': 'max-age=31536000',
        'content-security-policy': "default-src 'self'",
        'x-frame-options': 'DENY',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
      },
    });
    const result = buildHttpObservation({
      response,
      requestedUrl: 'https://example.com/?request=secret',
      finalUrl: 'https://www.example.com/home?session=secret',
      durationMs: 125,
      redirectLimitReached: false,
      hops: [
        { url: 'https://example.com/?request=secret', status: 301, location: 'https://www.example.com/home?session=secret', durationMs: 20 },
        { url: 'https://www.example.com/home?session=secret', status: 200, location: null, durationMs: 100 },
      ],
    }, {
      observedAt: OBSERVED_AT,
      capturedBodyBytes: 22,
      bodyInspected: true,
      bodySha256: 'A'.repeat(64),
    });

    assert.equal(result.version, 1);
    assert.equal(result.status, 'success');
    assert.equal(result.complete, true);
    assert.equal(result.requestUrl, 'https://example.com/');
    assert.equal(result.finalUrl, 'https://www.example.com/home');
    assert.equal(result.redirectCount, 1);
    assert.equal(result.crossOriginRedirect, true);
    assert.equal(result.httpsDowngrade, false);
    assert.equal(result.response.status, 200);
    assert.equal(result.response.declaredContentLength, 22);
    assert.equal(result.response.capturedBodyBytes, 22);
    assert.deepEqual(result.response.bodyHash, {
      algorithm: 'sha256',
      value: 'a'.repeat(64),
      scope: 'complete-body',
      bytes: 22,
    });
    assert.equal(result.response.securityHeaders.xFrameOptions, 'DENY');
    assert.match(result.limitations.join(' '), /query strings were omitted/i);
    assert.equal(JSON.stringify(result).includes('secret'), false);
  });

  test('marks body and redirect caps as partial without losing terminal metadata', () => {
    const result = buildHttpObservation({
      response: new Response('', { status: 302, headers: { location: '/next' } }),
      requestedUrl: 'https://example.com/',
      finalUrl: 'https://example.com/five',
      durationMs: 200,
      redirectLimitReached: true,
      hops: [{ url: 'https://example.com/five', status: 302, location: 'http://other.example/next', durationMs: 10 }],
    }, {
      observedAt: OBSERVED_AT,
      capturedBodyBytes: 300000,
      bodyInspected: true,
      bodyTruncated: true,
      bodySha256: 'b'.repeat(64),
    });

    assert.equal(result.status, 'partial');
    assert.equal(result.complete, false);
    assert.equal(result.truncated, true);
    assert.equal(result.redirectLimitReached, true);
    assert.equal(result.httpsDowngrade, true);
    assert.equal(result.response.bodyTruncated, true);
    assert.equal(result.response.bodyHash.scope, 'captured-prefix');
    assert.equal(result.response.bodyHash.bytes, 300000);
    assert.equal(result.limitations.length, 2);
  });

  test('bounds malformed and excessive response metadata', () => {
    const fixtureHeaders = {
      'content-length': '90071992547409930',
      server: `ok\n${'x'.repeat(500)}`,
      'content-security-policy': 'x'.repeat(2000),
    };
    const result = buildHttpObservation({
      response: {
        status: 204,
        headers: { get: (name) => fixtureHeaders[name] || null },
      },
      requestedUrl: 'https://example.com/',
      finalUrl: 'https://example.com/',
      hops: [],
    }, { observedAt: OBSERVED_AT, capturedBodyBytes: Number.MAX_SAFE_INTEGER });

    assert.equal(result.response.declaredContentLength, null);
    assert.ok(result.response.server.length <= 200);
    assert.ok(result.response.securityHeaders.contentSecurityPolicy.length <= 1024);
    assert.equal(result.response.capturedBodyBytes, 5 * 1024 * 1024);
    assert.equal(result.response.bodyHash, null);
  });

  test('rejects malformed hashes and hashes for uninspected bodies', () => {
    const detail = {
      response: new Response('', { status: 200 }),
      requestedUrl: 'https://example.com/',
      finalUrl: 'https://example.com/',
      hops: [],
    };
    assert.equal(buildHttpObservation(detail, {
      bodyInspected: true,
      bodySha256: 'not-a-hash',
    }).response.bodyHash, null);
    assert.equal(buildHttpObservation(detail, {
      bodyInspected: false,
      bodySha256: 'a'.repeat(64),
    }).response.bodyHash, null);
  });
});

describe('non-success observations', () => {
  test('failure attempts are bounded, control-safe, and query-free', () => {
    const result = failedHttpObservation([
      { url: 'https://example.com/?token=secret', error: `failed\n${'x'.repeat(300)}` },
      { url: 'http://example.com/', error: 'timed out' },
      { url: 'https://ignored.example/', error: 'ignored' },
    ], { observedAt: OBSERVED_AT, durationMs: 6000 });

    assert.equal(result.status, 'error');
    assert.equal(result.attempts.length, 2);
    assert.ok(result.attempts[0].error.length <= 180);
    assert.equal(JSON.stringify(result).includes('secret'), false);
  });

  test('disabled probing has an explicit skipped observation', () => {
    const result = skippedHttpObservation();
    assert.equal(result.status, 'skipped');
    assert.equal(result.complete, false);
    assert.equal(result.response, null);
  });
});
