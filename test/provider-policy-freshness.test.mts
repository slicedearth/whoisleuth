import assert from 'node:assert/strict';
import test from 'node:test';

import { buildProviderPolicyFreshnessReport } from '../tools/provider-policy-freshness.mts';
import type { ThreatIntelligenceProviderDefinition } from '../lib/threat-intelligence-types.mts';
import { PROVIDER_POLICY_MAX_FUTURE_SKEW_MS } from '../lib/provider-policy-admission.mts';

function provider(reviewedAt: string): ThreatIntelligenceProviderDefinition {
  return {
    version: 1,
    id: 'fixture-provider',
    label: 'Fixture provider',
    capabilities: ['domain_lookup'],
    targets: { domain: 'registrable_domain' },
    interaction: 'lookup_only',
    terms: {
      reviewedAt,
      termsUrl: 'https://provider.example/terms',
      privacyUrl: 'https://provider.example/privacy',
      commercialUse: 'restricted',
      attribution: 'unknown',
      caching: 'prohibited',
      queryRetention: 'provider_defined',
      redistribution: 'restricted',
    },
    limits: { timeoutMs: 1000, maxResponseBytes: 1000, cacheTtlMs: 0, concurrency: 1, dailyRequests: 1, monthlyRequests: 1 },
  };
}

test('provider policy freshness report passes only within the review-age bound', () => {
  const fresh = buildProviderPolicyFreshnessReport([provider('2026-07-15T00:00:00Z')], new Date('2026-08-04T00:00:00Z'));
  assert.equal(fresh.state, 'pass');
  assert.equal(fresh.entries[0]?.reviewAgeDays, 20);

  const stale = buildProviderPolicyFreshnessReport([provider('2025-01-01T00:00:00Z')], new Date('2026-08-04T00:00:00Z'));
  assert.equal(stale.state, 'fail');
  assert.equal(stale.entries[0]?.state, 'stale');

  const now = new Date('2026-08-04T00:00:00Z');
  const atSkewBoundary = buildProviderPolicyFreshnessReport([
    provider(new Date(now.getTime() + PROVIDER_POLICY_MAX_FUTURE_SKEW_MS).toISOString()),
  ], now);
  assert.equal(atSkewBoundary.state, 'pass');
  assert.equal(atSkewBoundary.entries[0]?.reviewAgeDays, 0);

  const beyondSkew = buildProviderPolicyFreshnessReport([
    provider(new Date(now.getTime() + PROVIDER_POLICY_MAX_FUTURE_SKEW_MS + 1).toISOString()),
  ], now);
  assert.equal(beyondSkew.state, 'fail');
  assert.equal(beyondSkew.entries[0]?.state, 'stale');
  assert.equal(beyondSkew.entries[0]?.reviewAgeDays, null);
});
