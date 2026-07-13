const { before, describe, test } = require('node:test');
const assert = require('node:assert/strict');

let comparison;
let baseline;
before(async () => {
  comparison = await import('../frontend/src/lib/analysis/page-similarity.js');
  baseline = await import('../frontend/src/lib/analysis/page-baseline.js');
});

const ISO = '2026-07-13T04:05:06.000Z';
const LATER = '2026-07-13T05:06:07.000Z';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);
const SHA_D = 'd'.repeat(64);

function stored(overrides = {}) {
  return {
    baselineVersion: 1,
    domain: 'official.example',
    lookupDomain: 'official.example',
    observedAt: ISO,
    pageIdentityVersion: 3,
    fingerprintVersion: 1,
    pageTitle: 'Account centre',
    canonicalHost: 'www.official.example',
    faviconHash: null,
    faviconPHash: null,
    normalizedHtml: { algorithm: 'sha256', value: SHA_A, tokenCount: 20, truncated: false },
    visibleText: { algorithm: 'simhash64-v1', value: '0000000000000000', tokenCount: 12, featureCount: 10, truncated: false },
    domStructure: { algorithm: 'sha256', value: SHA_B, nodeCount: 15, parser: 'static-tag-sequence-v1', truncated: false },
    formStructure: { algorithm: 'sha256', value: SHA_C, formCount: 1, controlCount: 2, truncated: false },
    resourceHosts: { algorithm: 'set-sha256', value: SHA_B, values: ['cdn.example', 'images.example'], truncated: false },
    trackingIdentifiers: { algorithm: 'set-sha256', value: SHA_C, values: [{ type: 'analytics-property', value: 'G-ABC123' }], truncated: false },
    complete: true,
    truncated: false,
    ...overrides,
  };
}

function item(result, id) {
  return result.components.find((entry) => entry.id === id);
}

describe('explainable page-baseline comparison', () => {
  test('reports independent identical components without an aggregate score', () => {
    const result = comparison.comparePageBaselines(stored(), stored({ domain: 'observed.example', lookupDomain: 'observed.example', observedAt: LATER }));
    assert.equal(result.comparisonVersion, 1);
    assert.deepEqual(result.counts, { same: 6, overlap: 0, different: 0, notObserved: 0, unavailable: 0 });
    assert.equal(result.partial, false);
    assert.equal('score' in result, false);
    assert.equal('similarity' in result, false);
    assert.equal(item(result, 'visible_text').agreementPercent, 100);
    assert.equal(item(result, 'visible_text').hammingDistance, 0);
  });

  test('keeps exact component differences separate', () => {
    const result = comparison.comparePageBaselines(stored(), stored({
      normalizedHtml: { algorithm: 'sha256', value: SHA_D, tokenCount: 20, truncated: false },
      domStructure: { algorithm: 'sha256', value: SHA_D, nodeCount: 15, parser: 'static-tag-sequence-v1', truncated: false },
    }));
    assert.equal(item(result, 'normalized_html').status, 'different');
    assert.equal(item(result, 'dom_structure').status, 'different');
    assert.equal(item(result, 'form_structure').status, 'same');
  });

  test('reports visible-text bit agreement without calling it copied-text percentage', () => {
    const result = comparison.comparePageBaselines(stored(), stored({
      visibleText: { algorithm: 'simhash64-v1', value: 'f000000000000000', tokenCount: 12, featureCount: 10, truncated: false },
    }));
    const visible = item(result, 'visible_text');
    assert.equal(visible.hammingDistance, 4);
    assert.equal(visible.agreementPercent, 94);
    assert.match(visible.detail, /not a percentage of copied text/i);
  });

  test('does not treat absent optional fingerprints as a positive match', () => {
    const neither = comparison.comparePageBaselines(stored({ visibleText: null, formStructure: null }), stored({ visibleText: null, formStructure: null }));
    assert.equal(item(neither, 'visible_text').status, 'not_observed');
    assert.equal(item(neither, 'form_structure').status, 'not_observed');
    assert.equal(neither.counts.same, 4);

    const one = comparison.comparePageBaselines(stored({ visibleText: null, formStructure: null }), stored());
    assert.equal(item(one, 'visible_text').status, 'unavailable');
    assert.equal(item(one, 'form_structure').status, 'unavailable');
  });

  test('reports bounded set equality, overlap, and disjoint sets independently', () => {
    const result = comparison.comparePageBaselines(stored(), stored({
      resourceHosts: { algorithm: 'set-sha256', value: SHA_D, values: ['cdn.example', 'other.example'], truncated: false },
      trackingIdentifiers: { algorithm: 'set-sha256', value: SHA_D, values: [{ type: 'tag-container', value: 'GTM-OTHER' }], truncated: false },
    }));
    const hosts = item(result, 'resource_hosts');
    assert.equal(hosts.status, 'overlap');
    assert.deepEqual(hosts.sharedValues, ['cdn.example']);
    assert.deepEqual([hosts.referenceCount, hosts.observedCount, hosts.sharedCount], [2, 2, 1]);
    assert.equal(item(result, 'tracking_identifiers').status, 'different');
  });

  test('does not treat two empty sets as a positive match', () => {
    const empty = { algorithm: 'set-sha256', value: null, values: [], truncated: false };
    const result = comparison.comparePageBaselines(stored({ resourceHosts: empty, trackingIdentifiers: empty }), stored({ resourceHosts: empty, trackingIdentifiers: empty }));
    assert.equal(item(result, 'resource_hosts').status, 'not_observed');
    assert.equal(item(result, 'tracking_identifiers').status, 'not_observed');
    assert.equal(item(result, 'resource_hosts').sharedCount, 0);
  });

  test('marks capped evidence partial while preserving component observations', () => {
    const result = comparison.comparePageBaselines(stored({
      normalizedHtml: { algorithm: 'sha256', value: SHA_A, tokenCount: 20, truncated: true },
      resourceHosts: { algorithm: 'set-sha256', value: SHA_B, values: ['cdn.example'], truncated: true },
      complete: false,
      truncated: true,
    }), stored());
    assert.equal(result.partial, true);
    assert.equal(item(result, 'normalized_html').status, 'same');
    assert.equal(item(result, 'normalized_html').partial, true);
    assert.equal(item(result, 'resource_hosts').partial, true);
    assert.match(item(result, 'resource_hosts').outcome, /partial evidence/i);
  });

  test('fails closed for unsupported or malformed baseline contracts', () => {
    assert.equal(comparison.comparePageBaselines(null, stored()), null);
    assert.equal(comparison.comparePageBaselines(stored({ baselineVersion: 2 }), stored()), null);
    assert.equal(comparison.comparePageBaselines(stored(), stored({ normalizedHtml: null })), null);
  });

  test('strict normalization drops unknown and hostile fields from the result', () => {
    const result = comparison.comparePageBaselines(
      { ...stored(), rawHtml: '<secret>', injected: 'private' },
      { ...stored(), rawResponse: 'private response' },
    );
    assert.doesNotMatch(JSON.stringify(result), /secret|private|rawHtml|rawResponse|injected/);
  });

  test('is deterministic and does not mutate either input', () => {
    const reference = stored();
    const observed = stored({ observedAt: LATER });
    const beforeReference = structuredClone(reference);
    const beforeObserved = structuredClone(observed);
    const first = comparison.comparePageBaselines(reference, observed);
    const second = comparison.comparePageBaselines(reference, observed);
    assert.deepEqual(first, second);
    assert.deepEqual(reference, beforeReference);
    assert.deepEqual(observed, beforeObserved);
  });

  test('uses the same strict current schema as saved Brand Profile baselines', () => {
    assert.deepEqual(baseline.normalizePageBaseline(stored()), stored());
    assert.ok(comparison.comparePageBaselines(stored(), stored()));
  });
});
