import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXTERNAL_INTELLIGENCE_CALIBRATION_VERSION,
  EXTERNAL_INTELLIGENCE_RECENT_DAYS,
  calibrateExternalIntelligenceRisk,
} from '../frontend/src/lib/analysis/external-intelligence-risk.js';

const OBSERVED_AT = '2026-07-15T00:00:00.000Z';

function provider(id, overrides = {}) {
  return {
    provider: { id, label: 'Untrusted label' },
    state: 'success',
    findings: [{
      id: '1',
      category: 'malware',
      firstObservedAt: '2026-07-10T00:00:00.000Z',
      lastObservedAt: '2026-07-12T00:00:00.000Z',
    }],
    observation: { observedAt: OBSERVED_AT, limitations: ['Untrusted limitation'] },
    ...overrides,
  };
}

test('returns a stable empty calibration for missing and malformed input', () => {
  for (const value of [null, undefined, 'bad', [], {}, { providers: 'bad' }]) {
    const result = calibrateExternalIntelligenceRisk(value);
    assert.equal(result.version, EXTERNAL_INTELLIGENCE_CALIBRATION_VERSION);
    assert.equal(result.contribution, 0);
    assert.equal(result.factor, null);
    assert.deepEqual(result.sources, []);
  }
});

test('a lone provider remains independently presented but contributes no Risk points', () => {
  const result = calibrateExternalIntelligenceRisk({ providers: [provider('urlscan_search')] });
  assert.equal(result.eligibleProviderCount, 1);
  assert.equal(result.independentPublisherCount, 1);
  assert.equal(result.recentPublisherCount, 1);
  assert.equal(result.contribution, 0);
  assert.equal(result.factor, null);
  assert.equal(result.freshestAgeDays, 3);
});

test('two datasets from the same publisher family cannot corroborate one another', () => {
  const result = calibrateExternalIntelligenceRisk({ providers: [
    provider('urlhaus_host'),
    provider('threatfox_domain_ioc'),
  ] });
  assert.equal(result.eligibleProviderCount, 2);
  assert.equal(result.independentPublisherCount, 1);
  assert.equal(result.contribution, 0);
});

test('two independent recent publisher families produce one bounded contribution', () => {
  const result = calibrateExternalIntelligenceRisk({ providers: [
    provider('urlscan_search'),
    provider('urlhaus_host'),
  ] });
  assert.equal(result.independentPublisherCount, 2);
  assert.equal(result.recentPublisherCount, 2);
  assert.equal(result.contribution, 18);
  assert.deepEqual(result.factor, {
    label: 'Corroborated recent external phishing/malware records',
    delta: 18,
  });
});

test('corroborated stale or unknown-age evidence receives the lower contribution', () => {
  const stale = provider('urlscan_search', {
    findings: [{ category: 'phishing', lastObservedAt: '2026-01-01T00:00:00.000Z' }],
  });
  const unknown = provider('urlhaus_host', {
    findings: [{ category: 'malware', lastObservedAt: null, firstObservedAt: null }],
  });
  const result = calibrateExternalIntelligenceRisk({ providers: [stale, unknown] });
  assert.equal(result.independentPublisherCount, 2);
  assert.equal(result.recentPublisherCount, 0);
  assert.equal(result.unknownAgeProviderCount, 1);
  assert.equal(result.contribution, 10);
  assert.equal(result.factor.label, 'Corroborated external phishing/malware records');
});

test('the exact freshness boundary is recent and one day beyond it is stale', () => {
  const atBoundary = provider('urlscan_search', {
    findings: [{ category: 'phishing', lastObservedAt: '2026-04-16T00:00:00.000Z' }],
  });
  const beyondBoundary = provider('urlscan_search', {
    findings: [{ category: 'phishing', lastObservedAt: '2026-04-15T00:00:00.000Z' }],
  });
  assert.equal(calibrateExternalIntelligenceRisk({ providers: [atBoundary] }).sources[0].ageDays, EXTERNAL_INTELLIGENCE_RECENT_DAYS);
  assert.equal(calibrateExternalIntelligenceRisk({ providers: [atBoundary] }).sources[0].recent, true);
  assert.equal(calibrateExternalIntelligenceRisk({ providers: [beyondBoundary] }).sources[0].recent, false);
});

test('only allowlisted providers, positive states, and phishing or malware findings qualify', () => {
  const result = calibrateExternalIntelligenceRisk({ providers: [
    provider('invented_provider'),
    provider('toString'),
    provider('urlscan_search', { state: 'not_found' }),
    provider('urlhaus_host', { findings: [{ category: 'suspicious', lastObservedAt: '2026-07-12T00:00:00.000Z' }] }),
    provider('threatfox_domain_ioc', { findings: [{ category: 'malware', lastObservedAt: '2026-07-12T00:00:00.000Z' }] }),
  ] });
  assert.deepEqual(result.sources.map((source) => source.providerId), ['threatfox_domain_ioc']);
  assert.equal(result.contribution, 0);
});

test('duplicate provider IDs cannot manufacture corroboration', () => {
  const providers = Array.from({ length: 30 }, () => provider('urlscan_search'));
  providers[1] = provider('urlhaus_host');
  const result = calibrateExternalIntelligenceRisk({ providers });
  assert.deepEqual(result.sources.map((source) => source.providerId), ['urlhaus_host', 'urlscan_search']);
  assert.equal(result.independentPublisherCount, 2);
  assert.equal(result.contribution, 18);
});

test('provider and finding traversal stop at their hard input caps', () => {
  const providerOverflow = Array.from({ length: 10 }, () => provider('urlscan_search'));
  providerOverflow.push(provider('urlhaus_host'));
  const providerResult = calibrateExternalIntelligenceRisk({ providers: providerOverflow });
  assert.deepEqual(providerResult.sources.map((source) => source.providerId), ['urlscan_search']);
  assert.equal(providerResult.contribution, 0);

  const findings = Array.from({ length: 100 }, () => ({ category: 'suspicious' }));
  findings.push({ category: 'malware', lastObservedAt: '2026-07-12T00:00:00.000Z' });
  const findingResult = calibrateExternalIntelligenceRisk({
    providers: [provider('urlscan_search', { findings })],
  });
  assert.deepEqual(findingResult.sources, []);
});

test('future, invalid, and overlong timestamps cannot be treated as recent', () => {
  const findings = [
    { category: 'malware', lastObservedAt: '2026-07-17T00:00:00.000Z' },
    { category: 'malware', lastObservedAt: 'invalid' },
    { category: 'malware', lastObservedAt: 'x'.repeat(65) },
  ];
  const result = calibrateExternalIntelligenceRisk({ providers: [provider('urlscan_search', { findings })] });
  assert.equal(result.sources[0].ageDays, null);
  assert.equal(result.sources[0].recent, false);
  assert.equal(result.unknownAgeProviderCount, 1);
});

test('calibration does not mutate untrusted provider input', () => {
  const input = { providers: [provider('urlscan_search'), provider('urlhaus_host')] };
  const before = structuredClone(input);
  calibrateExternalIntelligenceRisk(input);
  assert.deepEqual(input, before);
});
