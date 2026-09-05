import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { normalizeLookupSourceSettlement } from '../lib/lookup-source-progress.mts';
import {
  createThreatIntelligenceResult,
  defineThreatIntelligenceProvider,
} from '../lib/threat-intelligence-contract.mts';
import { THREAT_INTELLIGENCE_RESULT_STATES } from '../lib/threat-intelligence-types.mts';

const PROVIDER = defineThreatIntelligenceProvider({
  id: 'fixture_feed',
  label: 'Fixture feed',
  capabilities: ['domain_lookup'],
  targets: { domain: 'registrable_domain' },
  interaction: 'lookup_only',
  terms: {
    reviewedAt: '2026-07-15T00:00:00Z',
    termsUrl: 'https://provider.invalid/terms',
    privacyUrl: 'https://provider.invalid/privacy',
    commercialUse: 'allowed',
    attribution: 'required',
    caching: 'bounded',
    queryRetention: 'limited',
    redistribution: 'restricted',
  },
  limits: {
    timeoutMs: 5_000,
    maxResponseBytes: 256 * 1024,
    cacheTtlMs: 60_000,
    concurrency: 2,
    dailyRequests: 100,
    monthlyRequests: 1_000,
  },
});

const FINDING = Object.freeze({
  id: 'fixture-1',
  category: 'phishing',
  severity: 'high',
  confidence: 'medium',
  providerVerdict: 'listed',
  detail: 'Provider-published fixture observation.',
  firstObservedAt: '2026-07-10T00:00:00Z',
  lastObservedAt: '2026-07-14T00:00:00Z',
  referenceUrl: 'https://provider.invalid/record/fixture-1',
  tags: ['fixture'],
});

describe('Lookup source progress settlements', () => {
  test('preserves every canonical optional-intelligence state and nested observation quality', () => {
    const sources = [
      'external_intelligence',
      'malware_host_intelligence',
      'malware_ioc_intelligence',
    ] as const;
    for (const source of sources) {
      for (const requestedState of THREAT_INTELLIGENCE_RESULT_STATES) {
        const result = createThreatIntelligenceResult(PROVIDER, { type: 'domain', value: 'example.test' }, {
          state: requestedState,
          ...(requestedState === 'success' || requestedState === 'partial' ? { findings: [FINDING] } : {}),
          ...(requestedState === 'partial' ? { truncated: true } : {}),
        }, '2026-07-15T01:02:03Z');
        const settlement = normalizeLookupSourceSettlement(source, 'fulfilled', result);
        assert.equal(settlement.state, result.state, `${source} ${requestedState} state`);
        assert.equal(settlement.complete, result.observation.complete, `${source} ${requestedState} complete`);
        assert.equal(settlement.truncated, result.observation.truncated, `${source} ${requestedState} truncated`);
        assert.deepEqual(Object.keys(settlement.fragment).sort(), [
          ...(Object.hasOwn(settlement.fragment, 'limitation') ? ['limitation'] : []),
          'status',
        ]);
        assert.doesNotMatch(JSON.stringify(settlement.fragment), /fixture_feed|example\.test|fixture-1/u);
      }
    }
  });

  test('fails closed when an optional-intelligence result lacks its canonical envelope state', () => {
    const settlement = normalizeLookupSourceSettlement('external_intelligence', 'fulfilled', {
      status: 'success',
      observation: { complete: true, truncated: false },
    });
    assert.equal(settlement.state, 'error');
    assert.equal(settlement.complete, false);
    assert.equal(settlement.truncated, false);
  });
});
