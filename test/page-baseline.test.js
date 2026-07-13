const { before, describe, test } = require('node:test');
const assert = require('node:assert/strict');

let baseline;
before(async () => {
  baseline = await import('../frontend/src/lib/analysis/page-baseline.js');
});

const ISO = '2026-07-13T04:05:06.000Z';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);

function pageIdentity(overrides = {}) {
  return {
    identityVersion: 3,
    version: 1,
    status: 'success',
    observedAt: ISO,
    scanMode: 'deep',
    source: 'html',
    complete: true,
    truncated: false,
    canonical: { url: 'https://www.example.com/account?private=value' },
    fingerprints: {
      fingerprintVersion: 1,
      normalizedHtml: { algorithm: 'sha256', value: SHA_A, tokenCount: 120, truncated: false },
      visibleText: { algorithm: 'simhash64-v1', value: '1234567890abcdef', tokenCount: 80, featureCount: 72, truncated: false },
      domStructure: { algorithm: 'sha256', value: SHA_B, nodeCount: 60, parser: 'static-tag-sequence-v1', truncated: false },
      formStructure: { algorithm: 'sha256', value: SHA_C, formCount: 1, controlCount: 3, truncated: false },
      resourceHosts: { algorithm: 'set-sha256', value: SHA_B, values: ['cdn.example.net', 'images.example.org'], truncated: false },
      identifiers: { algorithm: 'set-sha256', value: SHA_C, values: [{ type: 'google-analytics', value: 'G-ABC123' }], truncated: false },
      complete: true,
      truncated: false,
      exact: { algorithm: 'sha256', value: 'd'.repeat(64), private: 'must not persist' },
      limitations: ['must not persist'],
    },
    rawHtml: '<p>must not persist</p>',
    diagnostics: { private: true },
    ...overrides,
  };
}

function availability(overrides = {}) {
  return {
    pageTitle: ' Example account centre ',
    faviconHash: 'e'.repeat(64),
    faviconPHash: '1234567890abcdef',
    pageIdentity: pageIdentity(),
    http: { finalUrl: 'https://example.com/private?token=secret' },
    rawHtml: '<p>secret</p>',
    ...overrides,
  };
}

describe('official-site page baseline', () => {
  test('builds the bounded current schema from a deep page-identity response', () => {
    const result = baseline.createPageBaseline('EXAMPLE.COM.', availability());
    assert.deepEqual(result, {
      baselineVersion: 1,
      domain: 'example.com',
      lookupDomain: 'example.com',
      observedAt: ISO,
      pageIdentityVersion: 3,
      fingerprintVersion: 1,
      pageTitle: 'Example account centre',
      canonicalHost: 'www.example.com',
      faviconHash: 'e'.repeat(64),
      faviconPHash: '1234567890abcdef',
      normalizedHtml: { algorithm: 'sha256', value: SHA_A, tokenCount: 120, truncated: false },
      visibleText: { algorithm: 'simhash64-v1', value: '1234567890abcdef', tokenCount: 80, featureCount: 72, truncated: false },
      domStructure: { algorithm: 'sha256', value: SHA_B, nodeCount: 60, parser: 'static-tag-sequence-v1', truncated: false },
      formStructure: { algorithm: 'sha256', value: SHA_C, formCount: 1, controlCount: 3, truncated: false },
      resourceHosts: { algorithm: 'set-sha256', value: SHA_B, values: ['cdn.example.net', 'images.example.org'], truncated: false },
      trackingIdentifiers: { algorithm: 'set-sha256', value: SHA_C, values: [{ type: 'google-analytics', value: 'G-ABC123' }], truncated: false },
      complete: true,
      truncated: false,
    });
  });

  test('never retains raw HTML, exact response hashes, URLs, limitations, or diagnostics', () => {
    const serialized = JSON.stringify(baseline.createPageBaseline('example.com', availability()));
    assert.doesNotMatch(serialized, /rawHtml|must not persist|private\?|token=|exact|limitations|diagnostics|<p>/);
  });

  test('does not mutate the source response', () => {
    const source = availability();
    const before = structuredClone(source);
    baseline.createPageBaseline('example.com', source);
    assert.deepEqual(source, before);
  });

  test('requires an HTML page identity with core versioned fingerprints', () => {
    assert.equal(baseline.createPageBaseline('example.com', {}), null);
    assert.equal(baseline.createPageBaseline('example.com', availability({ pageIdentity: pageIdentity({ source: 'json' }) })), null);
    assert.equal(baseline.createPageBaseline('example.com', availability({ pageIdentity: pageIdentity({ fingerprints: null }) })), null);
    assert.equal(baseline.createPageBaseline('not a domain', availability()), null);
  });

  test('canonicalizes Unicode domains and canonical hosts through the shared domain normalizer', () => {
    const result = baseline.createPageBaseline('bücher.example', availability({
      pageIdentity: pageIdentity({ canonical: { url: 'https://BÜCHER.example/path?secret=yes' } }),
    }));
    assert.equal(result.domain, 'xn--bcher-kva.example');
    assert.equal(result.lookupDomain, 'xn--bcher-kva.example');
    assert.equal(result.canonicalHost, 'xn--bcher-kva.example');
  });

  test('distinguishes the configured official hostname from the registrable domain actually probed', () => {
    const result = baseline.createPageBaseline('www.example.com', availability({ domain: 'example.com' }));
    assert.equal(result.domain, 'www.example.com');
    assert.equal(result.lookupDomain, 'example.com');
  });

  test('drops invalid or credential-bearing canonical URLs', () => {
    const credentialed = baseline.createPageBaseline('example.com', availability({
      pageIdentity: pageIdentity({ canonical: { url: 'https://user:password@example.com/private' } }),
    }));
    const invalid = baseline.createPageBaseline('example.com', availability({
      pageIdentity: pageIdentity({ canonical: { url: 'javascript:alert(1)' } }),
    }));
    assert.equal(credentialed.canonicalHost, null);
    assert.equal(invalid.canonicalHost, null);
  });

  test('normalizes valid persisted baselines and drops unknown fields', () => {
    const current = baseline.createPageBaseline('example.com', availability());
    const normalized = baseline.normalizePageBaseline({ ...current, injected: 'discard me', rawHtml: '<secret>' });
    assert.deepEqual(normalized, current);
    assert.equal('injected' in normalized, false);
    assert.equal('rawHtml' in normalized, false);
  });

  test('rejects legacy, future, malformed, and incomplete core schemas', () => {
    const current = baseline.createPageBaseline('example.com', availability());
    assert.equal(baseline.normalizePageBaseline({ ...current, baselineVersion: 0 }), null);
    assert.equal(baseline.normalizePageBaseline({ ...current, baselineVersion: 2 }), null);
    assert.equal(baseline.normalizePageBaseline({ ...current, normalizedHtml: null }), null);
    assert.equal(baseline.normalizePageBaseline({ ...current, domStructure: null }), null);
    assert.equal(baseline.normalizePageBaseline({ ...current, observedAt: 'invalid' }), null);
    assert.equal(baseline.normalizePageBaseline({ ...current, pageIdentityVersion: baseline.PAGE_IDENTITY_VERSION + 1 }), null);
    assert.equal(baseline.normalizePageBaseline({ ...current, fingerprintVersion: baseline.PAGE_FINGERPRINT_VERSION + 1 }), null);
  });

  test('bounds and sorts external hosts while reporting truncation', () => {
    const values = Array.from({ length: baseline.MAX_BASELINE_RESOURCE_HOSTS + 5 }, (_, index) => `z${index}.example.net`).reverse();
    const result = baseline.createPageBaseline('example.com', availability({
      pageIdentity: pageIdentity({
        fingerprints: {
          ...pageIdentity().fingerprints,
          resourceHosts: { algorithm: 'set-sha256', value: SHA_A, values, truncated: false },
        },
      }),
    }));
    assert.equal(result.resourceHosts.values.length, baseline.MAX_BASELINE_RESOURCE_HOSTS);
    assert.deepEqual(result.resourceHosts.values, [...result.resourceHosts.values].sort());
    assert.equal(result.resourceHosts.truncated, true);
    assert.equal(result.truncated, true);
    assert.equal(result.complete, false);
  });

  test('bounds, deduplicates, and sorts recognized tracking identifiers', () => {
    const values = Array.from({ length: baseline.MAX_BASELINE_IDENTIFIERS + 5 }, (_, index) => ({ type: 'google-analytics', value: `G-ID${String(index).padStart(3, '0')}` })).reverse();
    values.push(values[0], { type: 'invalid_type', value: 'secret/value' });
    const result = baseline.createPageBaseline('example.com', availability({
      pageIdentity: pageIdentity({
        fingerprints: {
          ...pageIdentity().fingerprints,
          identifiers: { algorithm: 'set-sha256', value: SHA_A, values, truncated: false },
        },
      }),
    }));
    assert.equal(result.trackingIdentifiers.values.length, baseline.MAX_BASELINE_IDENTIFIERS);
    assert.deepEqual(result.trackingIdentifiers.values, [...result.trackingIdentifiers.values].sort((a, b) => a.type.localeCompare(b.type) || a.value.localeCompare(b.value)));
    assert.equal(result.trackingIdentifiers.truncated, true);
  });

  test('rejects overlong/control-bearing titles instead of persisting them', () => {
    const overlong = baseline.createPageBaseline('example.com', availability({ pageTitle: 'x'.repeat(baseline.MAX_BASELINE_TITLE_LENGTH + 1) }));
    const control = baseline.createPageBaseline('example.com', availability({ pageTitle: 'Account\nsecret' }));
    assert.equal(overlong.pageTitle, null);
    assert.equal(control.pageTitle, null);
  });

  test('keeps absent optional fingerprints explicitly null', () => {
    const fingerprints = { ...pageIdentity().fingerprints, visibleText: null, formStructure: null };
    const result = baseline.createPageBaseline('example.com', availability({ pageIdentity: pageIdentity({ fingerprints }) }));
    assert.equal(result.visibleText, null);
    assert.equal(result.formStructure, null);
    assert.equal(result.complete, true);
    assert.equal(result.truncated, false);
  });

  test('rejects malformed optional components instead of preserving their contents', () => {
    const fingerprints = {
      ...pageIdentity().fingerprints,
      visibleText: { algorithm: 'simhash64-v1', value: 'not-a-hash', private: 'secret' },
      formStructure: { algorithm: 'sha256', value: SHA_A, formCount: 999, controlCount: 1 },
    };
    const result = baseline.createPageBaseline('example.com', availability({ pageIdentity: pageIdentity({ fingerprints }) }));
    assert.equal(result.visibleText, null);
    assert.equal(result.formStructure, null);
    assert.equal(result.complete, false);
    assert.equal(result.truncated, true);
    assert.doesNotMatch(JSON.stringify(result), /private|secret/);
  });

  test('accepts only informative perceptual favicon hashes', () => {
    const result = baseline.createPageBaseline('example.com', availability({ faviconPHash: '0000000000000000' }));
    assert.equal(result.faviconPHash, null);
    assert.equal(result.faviconHash, 'e'.repeat(64));
  });

  test('partial identity evidence remains explicit and cannot claim completeness', () => {
    const result = baseline.createPageBaseline('example.com', availability({
      pageIdentity: pageIdentity({ complete: false, truncated: true }),
    }));
    assert.equal(result.complete, false);
    assert.equal(result.truncated, true);
  });
});
