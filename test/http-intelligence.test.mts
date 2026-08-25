import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HTTP_DELIVERY_METADATA_VERSION,
  MAX_HTTP_DELIVERY_HEADER_LENGTH,
  MAX_HTTP_PROVENANCE_URL,
  buildHttpObservation,
  failedHttpObservation,
  normalizeProvenanceUrl,
  skippedHttpObservation,
} from '../lib/http-intelligence.mts';
import {
  HTTP_DELIVERY_LIMITATIONS,
  validHttpDeliveryMetadata,
} from '../lib/homepage-metadata-contract.mts';
import { requiredValue } from './value-assertions.mts';

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
    const result = requiredValue(normalizeProvenanceUrl(`https://example.com/${'a'.repeat(MAX_HTTP_PROVENANCE_URL)}`));
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
    assert.equal(result.response.securityHeaders.xFrameOptions, 'observed');
    assert.equal(result.response.securityHeaders.contentSecurityPolicy, 'observed');
    assert.doesNotMatch(JSON.stringify(result), /default-src|DENY|nosniff|no-referrer|max-age/);
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
    assert.equal(requiredValue(result.response.bodyHash).scope, 'captured-prefix');
    assert.equal(requiredValue(result.response.bodyHash).bytes, 300000);
    assert.equal(result.limitations.length, 2);
  });

  test('reduces selected delivery and cache headers to fixed bounded declarations', () => {
    const response = new Response('', {
      status: 200,
      headers: {
        'content-encoding': 'br, gzip',
        'cache-control': 'public, immutable, max-age="3600", s-maxage=120, private="field,a"',
        age: '45',
        etag: 'W/"private-validator"',
        'last-modified': 'Wed, 21 Oct 2015 07:28:00 GMT',
        expires: 'Wed, 21 Oct 2015 08:28:00 GMT',
      },
    });
    const delivery = buildHttpObservation({
      response,
      requestedUrl: 'https://example.com/',
      finalUrl: 'https://example.com/',
      hops: [],
    }, { observedAt: OBSERVED_AT }).response.deliveryMetadata;
    assert.equal(delivery.version, HTTP_DELIVERY_METADATA_VERSION);
    assert.equal(delivery.status, 'success');
    assert.equal(delivery.complete, true);
    assert.deepEqual(delivery.contentEncoding, {
      status: 'observed', codings: ['br', 'gzip'], encoded: true, unknownCodingCount: 0,
    });
    assert.deepEqual(delivery.cachePolicy, {
      status: 'observed',
      noStore: false,
      noCache: false,
      mustRevalidate: false,
      public: true,
      private: true,
      immutable: true,
      maxAgeSeconds: 3600,
      sMaxAgeSeconds: 120,
      ageSeconds: 45,
      maxAgePresent: true,
      sMaxAgePresent: true,
      agePresent: true,
      unknownDirectiveCount: 0,
      etag: { present: true, valid: true },
      lastModified: { present: true, valid: true },
      expires: { present: true, valid: true },
    });
    assert.doesNotMatch(JSON.stringify(delivery), /private-validator|field,a|Wed,|max-age=/u);
  });

  test('withholds overlong and malformed delivery headers instead of parsing a prefix', () => {
    const values: Record<string, string> = {
      'content-encoding': 'x'.repeat(MAX_HTTP_DELIVERY_HEADER_LENGTH + 1),
      'cache-control': 'public, max-age=not-a-number',
      age: '-1',
      etag: 'private-validator',
      expires: 'not-a-date',
    };
    const result = buildHttpObservation({
      response: { status: 200, headers: { get: (name: string) => values[name] ?? null } },
      requestedUrl: 'https://example.com/',
      finalUrl: 'https://example.com/',
      hops: [],
    }, { observedAt: OBSERVED_AT });
    const delivery = result.response.deliveryMetadata;
    assert.equal(delivery.status, 'partial');
    assert.equal(delivery.complete, false);
    assert.equal(delivery.truncated, true);
    assert.deepEqual(delivery.contentEncoding, {
      status: 'partial', codings: [], encoded: null, unknownCodingCount: 0,
    });
    assert.equal(delivery.cachePolicy.status, 'malformed');
    assert.equal(delivery.cachePolicy.maxAgeSeconds, null);
    assert.equal(delivery.cachePolicy.ageSeconds, null);
    assert.equal(delivery.cachePolicy.maxAgePresent, true);
    assert.equal(delivery.cachePolicy.agePresent, true);
    assert.deepEqual(delivery.cachePolicy.etag, { present: true, valid: false });
    assert.deepEqual(delivery.cachePolicy.expires, { present: true, valid: false });
    assert.doesNotMatch(JSON.stringify(delivery), /not-a-number|private-validator|not-a-date/u);
  });

  test('keeps malformed coding combinations inside the producer-validator contract', () => {
    const delivery = buildHttpObservation({
      response: new Response('', { status: 200, headers: { 'content-encoding': 'identity, x-example' } }),
      requestedUrl: 'https://example.com/',
      finalUrl: 'https://example.com/',
      hops: [],
    }, { observedAt: OBSERVED_AT }).response.deliveryMetadata;
    assert.deepEqual(delivery.contentEncoding, {
      status: 'malformed', codings: [], encoded: null, unknownCodingCount: 0,
    });
    assert.equal(delivery.status, 'partial');
    assert.equal(validHttpDeliveryMetadata(delivery), true);
  });

  test('withholds conflicting cache ages and strictly classifies dates and validators', () => {
    const values: Record<string, string> = {
      'cache-control': 'public, max-age=60, max-age=120',
      age: '"45"',
      etag: '"contains a space"',
      'last-modified': '0',
      expires: 'Wed, 21 Oct 2015 08:28:00 GMT',
    };
    const delivery = buildHttpObservation({
      response: { status: 200, headers: { get: (name: string) => values[name] ?? null } },
      requestedUrl: 'https://example.com/',
      finalUrl: 'https://example.com/',
      hops: [],
    }, { observedAt: OBSERVED_AT }).response.deliveryMetadata;
    assert.equal(delivery.cachePolicy.status, 'malformed');
    assert.equal(delivery.cachePolicy.maxAgePresent, true);
    assert.equal(delivery.cachePolicy.maxAgeSeconds, null);
    assert.equal(delivery.cachePolicy.agePresent, true);
    assert.equal(delivery.cachePolicy.ageSeconds, null);
    assert.deepEqual(delivery.cachePolicy.etag, { present: true, valid: false });
    assert.deepEqual(delivery.cachePolicy.lastModified, { present: true, valid: false });
    assert.deepEqual(delivery.cachePolicy.expires, { present: true, valid: true });
    assert.equal(validHttpDeliveryMetadata(delivery), true);
  });

  test('treats malformed cache validators and directive arguments as incomplete', () => {
    const values: Record<string, string> = {
      'cache-control': 'no-cache=, private=garbage',
      etag: '"contains a space"',
      'last-modified': 'Wed, 31 Feb 2024 07:28:00 GMT',
      expires: 'Fri, 21 Oct 2015 08:28:00 GMT',
    };
    const delivery = buildHttpObservation({
      response: { status: 200, headers: { get: (name: string) => values[name] ?? null } },
      requestedUrl: 'https://example.com/',
      finalUrl: 'https://example.com/',
      hops: [],
    }, { observedAt: OBSERVED_AT }).response.deliveryMetadata;
    assert.equal(delivery.status, 'partial');
    assert.equal(delivery.complete, false);
    assert.equal(delivery.truncated, false);
    assert.equal(delivery.cachePolicy.status, 'malformed');
    assert.deepEqual(delivery.cachePolicy.etag, { present: true, valid: false });
    assert.deepEqual(delivery.cachePolicy.lastModified, { present: true, valid: false });
    assert.deepEqual(delivery.cachePolicy.expires, { present: true, valid: false });
    assert.equal(validHttpDeliveryMetadata(delivery), true);
  });

  test('withholds all Cache-Control semantics when its directive bound is exceeded', () => {
    const delivery = buildHttpObservation({
      response: new Response('', {
        status: 200,
        headers: {
          'cache-control': ['no-store', ...Array.from({ length: 32 }, (_, index) => `x-${index}`)].join(', '),
        },
      }),
      requestedUrl: 'https://example.com/',
      finalUrl: 'https://example.com/',
      hops: [],
    }, { observedAt: OBSERVED_AT }).response.deliveryMetadata;
    assert.equal(delivery.cachePolicy.status, 'partial');
    assert.equal(delivery.cachePolicy.noStore, false);
    assert.equal(delivery.cachePolicy.unknownDirectiveCount, 0);
    assert.equal(delivery.cachePolicy.maxAgePresent, false);
    assert.equal(delivery.limitations.includes(HTTP_DELIVERY_LIMITATIONS.bounds), true);
    assert.equal(validHttpDeliveryMetadata(delivery), true);
  });

  test('rejects impossible delivery states and unrelated limitations', () => {
    const delivery = buildHttpObservation({
      response: new Response('', { status: 200, headers: { 'cache-control': 'public' } }),
      requestedUrl: 'https://example.com/',
      finalUrl: 'https://example.com/',
      hops: [],
    }, { observedAt: OBSERVED_AT }).response.deliveryMetadata;
    assert.equal(validHttpDeliveryMetadata(delivery), true);

    const emptyObservedEncoding = structuredClone(delivery);
    emptyObservedEncoding.contentEncoding.status = 'observed';
    assert.equal(validHttpDeliveryMetadata(emptyObservedEncoding), false);

    const emptyObservedCache = structuredClone(delivery);
    emptyObservedCache.cachePolicy.public = false;
    assert.equal(validHttpDeliveryMetadata(emptyObservedCache), false);

    const unresolvedAge = structuredClone(delivery);
    unresolvedAge.cachePolicy.agePresent = true;
    assert.equal(validHttpDeliveryMetadata(unresolvedAge), false);

    const spuriousLimitation = structuredClone(delivery);
    spuriousLimitation.limitations.push(HTTP_DELIVERY_LIMITATIONS.malformed);
    assert.equal(validHttpDeliveryMetadata(spuriousLimitation), false);
  });

  test('retains both bounded and malformed limitations for mixed cache failures', () => {
    const values: Record<string, string> = {
      'cache-control': 'max-age=not-a-number',
      etag: 'x'.repeat(MAX_HTTP_DELIVERY_HEADER_LENGTH + 1),
    };
    const delivery = buildHttpObservation({
      response: { status: 200, headers: { get: (name: string) => values[name] ?? null } },
      requestedUrl: 'https://example.com/',
      finalUrl: 'https://example.com/',
      hops: [],
    }, { observedAt: OBSERVED_AT }).response.deliveryMetadata;
    assert.equal(delivery.cachePolicy.status, 'partial');
    assert.equal(delivery.truncated, true);
    assert.equal(delivery.cachePolicy.etag.present, true);
    assert.equal(delivery.cachePolicy.etag.valid, null);
    assert.equal(delivery.limitations.some((item: string) => /byte or item bound/iu.test(item)), true);
    assert.equal(delivery.limitations.some((item: string) => /could not be interpreted/iu.test(item)), true);
    assert.equal(validHttpDeliveryMetadata(delivery), true);
  });

  test('reports absent delivery declarations without inferring compression or caching', () => {
    const result = buildHttpObservation({
      response: new Response('', { status: 200 }),
      requestedUrl: 'https://example.com/',
      finalUrl: 'https://example.com/',
      hops: [],
    }, { observedAt: OBSERVED_AT });
    assert.equal(result.response.deliveryMetadata.contentEncoding.status, 'not_observed');
    assert.equal(result.response.deliveryMetadata.contentEncoding.encoded, null);
    assert.equal(result.response.deliveryMetadata.cachePolicy.status, 'not_observed');
    assert.equal(result.response.deliveryMetadata.complete, true);
  });

  test('bounds malformed and excessive response metadata', () => {
    const fixtureHeaders: Record<string, string> = {
      'content-length': '90071992547409930',
      server: `ok\n${'x'.repeat(500)}`,
      'content-security-policy': 'x'.repeat(2000),
    };
    const result = buildHttpObservation({
      response: {
        status: 204,
        headers: { get: (name: string) => fixtureHeaders[name] || null },
      },
      requestedUrl: 'https://example.com/',
      finalUrl: 'https://example.com/',
      hops: [],
    }, { observedAt: OBSERVED_AT, capturedBodyBytes: Number.MAX_SAFE_INTEGER });

    assert.equal(result.response.declaredContentLength, null);
    assert.ok(requiredValue(result.response.server).length <= 200);
    assert.equal(result.response.securityHeaders.contentSecurityPolicy, 'observed');
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
    assert.ok(requiredValue(requiredValue(result.attempts[0]).error).length <= 180);
    assert.equal(JSON.stringify(result).includes('secret'), false);
  });

  test('disabled probing has an explicit skipped observation', () => {
    const result = skippedHttpObservation();
    assert.equal(result.status, 'skipped');
    assert.equal(result.complete, false);
    assert.equal(result.response, null);
  });
});
