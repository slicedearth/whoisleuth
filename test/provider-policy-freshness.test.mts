import assert from 'node:assert/strict';
import test from 'node:test';

import { buildProviderPolicyFreshnessReport } from '../tools/provider-policy-freshness.mts';
import type { ThreatIntelligenceProviderDefinition } from '../lib/threat-intelligence-types.mts';

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
});
