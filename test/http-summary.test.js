const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

async function moduleUnderTest() {
  return import('../frontend/src/lib/analysis/http-summary.js');
}

describe('compact HTTP summary', () => {
  test('derives bounded response facts without retaining paths, header values, or redirect inventories', async () => {
    const summary = await moduleUnderTest();
    const result = summary.compactHttpObservation({
      status: 'success',
      source: 'http',
      finalUrl: 'https://login.example.test/account?token=secret',
      transportSecurity: 'https',
      redirectCount: 2,
      crossOriginRedirect: true,
      httpsDowngrade: false,
      redirects: [{ from: 'https://example.test/', to: 'https://login.example.test/account' }],
      attempts: [{ error: 'sensitive diagnostic' }],
      response: {
        status: 200,
        contentType: 'Text/HTML; charset=utf-8',
        server: 'private server value',
        securityHeaders: {
          strictTransportSecurity: 'max-age=31536000',
          contentSecurityPolicy: "default-src 'self'",
          xFrameOptions: 'DENY',
          xContentTypeOptions: 'nosniff',
          referrerPolicy: null,
        },
      },
    });

    assert.deepEqual(result, {
      httpSummaryVersion: 1,
      httpEvidenceStatus: 'success',
      httpFinalOrigin: 'https://login.example.test',
      httpResponseStatus: 200,
      httpTransportSecurity: 'https',
      httpRedirectCount: 2,
      httpCrossOriginRedirect: true,
      httpHttpsDowngrade: false,
      httpContentType: 'text/html',
      httpSecurityHeaders: ['content-security-policy', 'content-type-protection', 'frame-protection', 'hsts'],
    });
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes('/account'), false);
    assert.equal(serialized.includes('secret'), false);
    assert.equal(serialized.includes('private server value'), false);
    assert.equal(serialized.includes('max-age'), false);
    assert.equal(serialized.includes('redirects'), false);
    assert.equal(serialized.includes('attempts'), false);
  });

  test('retains partial terminal responses but rejects failed, skipped, or response-less observations', async () => {
    const summary = await moduleUnderTest();
    assert.equal(summary.compactHttpObservation({ status: 'partial', response: { status: 206 } }).httpEvidenceStatus, 'partial');
    assert.equal(summary.compactHttpObservation({ status: 'error', response: null }), null);
    assert.equal(summary.compactHttpObservation({ status: 'skipped', response: null }), null);
    assert.equal(summary.compactHttpObservation({ status: 'success', response: null }), null);
  });

  test('derives transport from a safe final origin when explicit provenance is absent', async () => {
    const summary = await moduleUnderTest();
    const result = summary.compactHttpObservation({
      status: 'success', finalUrl: 'http://example.test/path', response: { status: 204, securityHeaders: {} },
    });
    assert.equal(result.httpFinalOrigin, 'http://example.test');
    assert.equal(result.httpTransportSecurity, 'http');
    assert.deepEqual(result.httpSecurityHeaders, []);
  });

  test('uses the retained origin as the canonical transport source', async () => {
    const summary = await moduleUnderTest();
    const rich = summary.compactHttpObservation({
      status: 'success', finalUrl: 'https://example.test/path', transportSecurity: 'http', response: { status: 200 },
    });
    const imported = summary.normalizeHttpSummary({
      ...rich,
      httpTransportSecurity: 'http',
    });
    assert.equal(rich.httpTransportSecurity, 'https');
    assert.equal(imported.httpTransportSecurity, 'https');
  });

  test('revalidates compact imports field-by-field and discards unknown keys', async () => {
    const summary = await moduleUnderTest();
    const result = summary.normalizeHttpSummary({
      httpSummaryVersion: 1,
      httpEvidenceStatus: 'success',
      httpFinalOrigin: 'https://example.test/private/path?secret=yes',
      httpResponseStatus: 200,
      httpTransportSecurity: 'https',
      httpRedirectCount: 1,
      httpCrossOriginRedirect: false,
      httpHttpsDowngrade: false,
      httpContentType: 'application/json; charset=utf-8',
      httpSecurityHeaders: ['hsts', 'hsts', 'unknown', 'frame-protection'],
      rawHeaders: { authorization: 'secret' },
    });
    assert.deepEqual(result, {
      httpSummaryVersion: 1,
      httpEvidenceStatus: 'success',
      httpFinalOrigin: 'https://example.test',
      httpResponseStatus: 200,
      httpTransportSecurity: 'https',
      httpRedirectCount: 1,
      httpCrossOriginRedirect: false,
      httpHttpsDowngrade: false,
      httpContentType: 'application/json',
      httpSecurityHeaders: ['frame-protection', 'hsts'],
    });
    assert.equal('rawHeaders' in result, false);
  });

  test('rejects malformed required fields and nulls malformed optional fields', async () => {
    const summary = await moduleUnderTest();
    assert.equal(summary.normalizeHttpSummary({ httpSummaryVersion: 1, httpEvidenceStatus: 'error', httpResponseStatus: 200 }), null);
    assert.equal(summary.normalizeHttpSummary({ httpSummaryVersion: 1, httpEvidenceStatus: 'success', httpResponseStatus: 99 }), null);
    assert.equal(summary.normalizeHttpSummary({ httpSummaryVersion: 2, httpEvidenceStatus: 'success', httpResponseStatus: 200 }), null);
    const result = summary.normalizeHttpSummary({
      httpSummaryVersion: 1,
      httpEvidenceStatus: 'success',
      httpResponseStatus: 200,
      httpFinalOrigin: 'https://user:secret@example.test/',
      httpRedirectCount: 99,
      httpContentType: 'not a mime',
      httpSecurityHeaders: 'hsts',
    });
    assert.equal(result.httpFinalOrigin, null);
    assert.equal(result.httpRedirectCount, null);
    assert.equal(result.httpContentType, null);
    assert.equal(result.httpSecurityHeaders, null);
  });

  test('bounds imported header-token work and rejects malformed rich header values', async () => {
    const summary = await moduleUnderTest();
    const tokens = Array.from({ length: summary.MAX_HTTP_SECURITY_HEADER_INPUTS + 1 }, () => 'unknown');
    tokens[tokens.length - 1] = 'hsts';
    const imported = summary.normalizeHttpSummary({
      httpSummaryVersion: 1,
      httpEvidenceStatus: 'success',
      httpResponseStatus: 200,
      httpSecurityHeaders: tokens,
    });
    assert.deepEqual(imported.httpSecurityHeaders, []);

    const rich = summary.compactHttpObservation({
      status: 'success',
      response: {
        status: 200,
        securityHeaders: {
          strictTransportSecurity: 'max-age=31536000\nInjected',
          contentSecurityPolicy: 'x'.repeat(301),
          referrerPolicy: 'strict-origin',
        },
      },
    });
    assert.deepEqual(rich.httpSecurityHeaders, ['referrer-policy']);
  });

  test('does not mutate either rich or compact input', async () => {
    const summary = await moduleUnderTest();
    const rich = { status: 'success', finalUrl: 'https://example.test/path', response: { status: 200, securityHeaders: {} } };
    const compact = { httpSummaryVersion: 1, httpEvidenceStatus: 'success', httpResponseStatus: 200, httpSecurityHeaders: ['hsts'] };
    const richBefore = structuredClone(rich);
    const compactBefore = structuredClone(compact);
    summary.compactHttpObservation(rich);
    summary.normalizeHttpSummary(compact);
    assert.deepEqual(rich, richBefore);
    assert.deepEqual(compact, compactBefore);
  });
});
