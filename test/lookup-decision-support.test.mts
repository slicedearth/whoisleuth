import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLookupDecisionSupport,
  buildLookupEvidenceQualityMatrix,
} from '../frontend/src/lib/analysis/lookup-decision-support.ts';
import type { EvidenceCoverageLedger } from '../frontend/src/lib/analysis/evidence-coverage-ledger.ts';
import type { LookupSourceRefreshPlan } from '../frontend/src/lib/analysis/lookup-source-refresh.ts';

const coverage: EvidenceCoverageLedger = {
  version: 1,
  entries: [
    {
      id: 'rdap',
      label: 'Registry RDAP',
      category: 'registry',
      state: 'complete',
      statusLabel: 'Complete',
      limitations: [],
      manualReviewSuggested: false,
    },
    {
      id: 'whois',
      label: 'WHOIS',
      category: 'registry',
      state: 'partial',
      statusLabel: 'Partial',
      limitations: ['The referral chain ended before an authoritative record was returned.'],
      manualReviewSuggested: true,
    },
    {
      id: 'http',
      label: 'HTTP',
      category: 'web',
      state: 'complete',
      statusLabel: 'Complete',
      limitations: [],
      manualReviewSuggested: false,
    },
  ],
  counts: {
    complete: 2,
    not_found: 0,
    partial: 1,
    skipped: 0,
    unavailable: 0,
    unknown: 0,
    unsupported: 0,
  },
  completeCount: 2,
  limitedCount: 1,
};

const refreshPlan: LookupSourceRefreshPlan = {
  version: 1,
  stale: false,
  ageDays: 1,
  items: [{
    id: 'whois',
    label: 'WHOIS',
    endpoint: '/api/whois',
    evidenceIds: ['whois'],
    reason: 'limited',
    requestDisclosure: 'Starts one bounded referral-aware WHOIS operation for this target.',
    supersedesObservedAt: '2026-07-30T00:00:00.000Z',
  }],
  limitations: [],
};

test('decision support keeps conflicts separate from incomplete source comparisons', () => {
  const support = buildLookupDecisionSupport({
    task: 'acquisition',
    coverage,
    refreshPlan,
    registryComparison: {
      fields: [
        {
          label: 'Registrar',
          status: 'conflict',
          rdapDisplay: 'Registrar One',
          whoisDisplay: 'Registrar Two',
        },
        {
          label: 'Statuses',
          status: 'whois_incomplete',
          rdapDisplay: 'transfer prohibited',
          whoisDisplay: 'Not observed (partial source)',
        },
      ],
    },
    registrarPublicationComparison: { fields: [] },
    requestedHost: 'example.test',
    registrableDomain: 'example.test',
    finalUrl: 'https://example.test/',
    canonicalUrl: 'https://example.test/',
    tlsAuthorization: { authorized: true },
    hasCaseSection: true,
  });

  assert.equal(support.guidance.task, 'acquisition');
  assert.equal(support.counts.conflicts, 1);
  assert.equal(support.counts.uncertainties, 1);
  assert.equal(support.entries[0]?.title, 'Registrar differs between registration sources');
  assert.match(support.entries[1]?.detail ?? '', /no disagreement or equivalence conclusion/u);
  assert.ok(support.actions.some((action) => action.id === 'review-priority-conflict'));
  assert.ok(support.actions.some((action) => action.id === 'review-refresh-options'));
});

test('identity inconsistencies are bounded review leads with direct evidence links', () => {
  const support = buildLookupDecisionSupport({
    task: 'brand',
    coverage,
    refreshPlan: { ...refreshPlan, items: [] },
    registryComparison: { fields: [] },
    registrarPublicationComparison: { fields: [] },
    requestedHost: 'example.test',
    registrableDomain: 'example.test',
    finalUrl: 'https://external.example/',
    canonicalUrl: 'https://canonical.example/',
    openGraphUrl: 'https://social.example/',
    tlsAuthorization: { authorized: false, error: 'Hostname mismatch' },
  });

  assert.deepEqual(
    support.entries.filter((entry) => entry.state === 'conflict').map((entry) => entry.id),
    [
      'tls-hostname-authorization',
      'page-canonical-origin',
      'http-cross-site-final-origin',
      'page-open-graph-origin',
    ],
  );
  assert.equal(support.entries.find((entry) => entry.id === 'page-open-graph-origin')?.href, '#evidence-page-identity');
});

test('quality matrix joins coverage, timing, freshness, refresh, and downstream use', () => {
  const matrix = buildLookupEvidenceQualityMatrix({
    coverage,
    refreshPlan,
    timing: {
      version: 1,
      totalMs: 1_250,
      sources: [
        { source: 'rdap', outcome: 'fulfilled', durationMs: 180, completedAfterMs: 180 },
        { source: 'whois', outcome: 'rejected', durationMs: 900, completedAfterMs: 1_020 },
        { source: 'domain_evidence', outcome: 'fulfilled', durationMs: 700, completedAfterMs: 1_250 },
      ],
    },
    observedAt: '2026-07-30T00:00:00.000Z',
    now: '2026-07-31T00:00:00.000Z',
  });

  assert.equal(matrix.totalMs, 1_250);
  assert.equal(matrix.ageDays, 1);
  assert.equal(matrix.entries.find((entry) => entry.id === 'whois')?.durationMs, 900);
  assert.equal(matrix.entries.find((entry) => entry.id === 'whois')?.timingOutcome, 'rejected');
  assert.equal(matrix.entries.find((entry) => entry.id === 'whois')?.refreshAvailable, true);
  assert.deepEqual(matrix.entries.find((entry) => entry.id === 'rdap')?.supports, [
    'Registration summary',
    'Lifecycle',
    'Availability',
  ]);
});
