import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLookupClaimReadiness } from '../frontend/src/lib/analysis/lookup-claim-readiness.ts';
import type { EvidenceCoverageLedger } from '../frontend/src/lib/analysis/evidence-coverage-ledger.ts';
import type { LookupDecisionSupport } from '../frontend/src/lib/analysis/lookup-decision-support.ts';

function ledger(states: Readonly<Record<string, EvidenceCoverageLedger['entries'][number]['state']>>): EvidenceCoverageLedger {
  const entries = Object.entries(states).map(([id, state]) => ({
    id,
    label: id.toUpperCase(),
    category: id === 'rdap' || id === 'whois' ? 'registry' as const : 'web' as const,
    state,
    statusLabel: state,
    truncated: false,
    limitations: state === 'complete' ? [] : [`${id} collection was incomplete.`],
    manualReviewSuggested: state === 'partial' || state === 'unavailable' || state === 'unknown',
  }));
  const counts = { complete: 0, not_found: 0, partial: 0, skipped: 0, unavailable: 0, unknown: 0, unsupported: 0 };
  for (const entry of entries) counts[entry.state] += 1;
  return {
    version: 1,
    entries,
    counts,
    completeCount: counts.complete,
    limitedCount: counts.partial + counts.unavailable + counts.unknown,
  };
}

const decisionSupport: LookupDecisionSupport = {
  version: 1,
  guidance: { task: 'general', label: 'General', summary: '', questions: [], prioritySections: [] },
  entries: [],
  actions: [],
  counts: { conflicts: 0, uncertainties: 0 },
};

test('claim readiness keeps evidence sufficiency separate for each statement', () => {
  const readiness = buildLookupClaimReadiness({
    targetType: 'domain',
    task: 'owned',
    coverage: ledger({ availability: 'complete', rdap: 'complete', dns: 'partial', http: 'complete', tls: 'complete' }),
    decisionSupport,
    availabilityState: 'registered',
  });
  assert.equal(readiness.entries.find((entry) => entry.id === 'registration-state')?.state, 'ready');
  assert.equal(readiness.entries.find((entry) => entry.id === 'current-web-observation')?.state, 'ready');
  assert.equal(readiness.entries.find((entry) => entry.id === 'controlled-change')?.state, 'limited');
  assert.deepEqual(readiness.entries.find((entry) => entry.id === 'controlled-change')?.missingEvidence, ['DNS observation']);
});

test('brand claim remains limited without a reviewed profile', () => {
  const readiness = buildLookupClaimReadiness({
    targetType: 'domain',
    task: 'brand',
    coverage: ledger({ availability: 'complete', rdap: 'complete', http: 'complete', tls: 'complete', 'page-identity': 'complete' }),
    decisionSupport,
    availabilityState: 'registered',
    hasActiveProfile: false,
  });
  assert.equal(readiness.entries.find((entry) => entry.id === 'brand-resemblance')?.state, 'limited');
  assert.ok(readiness.entries.find((entry) => entry.id === 'brand-resemblance')?.missingEvidence.includes('Reviewed Brand Profile'));
});

test('registration disagreements produce bounded hypotheses without claiming a cause', () => {
  const readiness = buildLookupClaimReadiness({
    targetType: 'domain',
    task: 'general',
    coverage: ledger({ availability: 'complete', rdap: 'complete', whois: 'complete', http: 'complete', tls: 'complete' }),
    decisionSupport: { ...decisionSupport, counts: { conflicts: 1, uncertainties: 0 } },
    availabilityState: 'registered',
    registryComparison: {
      fields: [{ label: 'Registrar', status: 'conflict' }],
    },
    observedAt: {
      registry: '2026-08-01T00:00:00.000Z',
      whois: '2026-08-02T12:00:00.000Z',
    },
  });
  assert.equal(readiness.disagreements.length, 1);
  assert.match(readiness.disagreements[0]?.hypothesis ?? '', /Collection-time/u);
  assert.match(readiness.disagreements[0]?.detail ?? '', /could explain/u);
  assert.match(readiness.limitation, /hypotheses/u);
});

test('registration readiness follows the authority-aware decision for WHOIS-only and RDAP-only registries', () => {
  for (const registrationSources of [
    { availability: 'complete', whois: 'complete', rdap: 'unsupported', dns: 'complete' },
    { availability: 'complete', whois: 'unsupported', rdap: 'complete', dns: 'complete' },
  ] as const) {
    const readiness = buildLookupClaimReadiness({
      targetType: 'domain',
      task: 'owned',
      coverage: ledger(registrationSources),
      decisionSupport,
      availabilityState: 'registered',
    });
    assert.equal(readiness.entries.find((entry) => entry.id === 'registration-state')?.state, 'ready');
    assert.equal(readiness.entries.find((entry) => entry.id === 'controlled-change')?.state, 'ready');
    assert.deepEqual(readiness.entries.find((entry) => entry.id === 'registration-state')?.requiredEvidence, ['Authority-aware availability decision']);
  }
});

test('registration sources cannot bypass an incomplete or unsettled authority decision', () => {
  const incomplete = buildLookupClaimReadiness({
    targetType: 'domain',
    task: 'owned',
    coverage: ledger({ availability: 'partial', whois: 'complete', rdap: 'complete', dns: 'complete' }),
    decisionSupport,
    availabilityState: 'inconclusive',
  });
  assert.equal(incomplete.entries.find((entry) => entry.id === 'registration-state')?.state, 'limited');
  assert.ok(incomplete.entries.find((entry) => entry.id === 'registration-state')?.missingEvidence.includes('Authority-aware availability decision'));

  const unsettled = buildLookupClaimReadiness({
    targetType: 'domain',
    task: 'general',
    coverage: ledger({ availability: 'complete', whois: 'complete', rdap: 'complete' }),
    decisionSupport,
    availabilityState: 'inconclusive',
  });
  assert.equal(unsettled.entries.find((entry) => entry.id === 'registration-state')?.state, 'limited');
  assert.ok(unsettled.entries.find((entry) => entry.id === 'registration-state')?.missingEvidence.includes('Settled authority-aware availability state'));
});
