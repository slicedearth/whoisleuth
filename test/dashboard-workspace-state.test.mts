import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  DASHBOARD_REQUIRED_COLLECTION_IDS,
  buildDashboardAttentionSummary,
  dashboardWorkspaceState,
} from '../frontend/src/lib/analysis/dashboard-workspace-state.ts';
import {
  analystReviewLifecycle,
  analystReviewMaterialFingerprint,
  analystReviewSubjectKey,
  emptyAnalystReviewStateStore,
  setAnalystReviewDecision,
  type AnalystReviewItem,
} from '../frontend/src/lib/analysis/analyst-review-state.ts';

const NOW = '2026-08-23T04:00:00.000Z';

function item(fingerprint = analystReviewMaterialFingerprint(['first'])): AnalystReviewItem {
  return {
    id: 'dashboard-review',
    kind: 'comparison',
    evidenceFamily: 'comparison',
    subjectKey: analystReviewSubjectKey('comparison', ['dashboard-review']),
    materialFingerprint: fingerprint,
    requiresExpiry: true,
    priority: 'high',
    title: 'Review retained material change',
    detail: 'A retained comparison changed after an explicit review.',
    source: 'Retained comparison',
    sourceIds: ['comparison_ledger'],
    caseDomain: 'dashboard.example',
    observedAt: NOW,
    dueAt: '2026-08-23T03:00:00.000Z',
    age: 'current',
    completeness: 'complete',
    nextAction: 'review',
    rankingReason: 'The explicit due time has arrived.',
    href: '/monitor?view=timeline',
    retryHref: null,
    caseId: null,
    campaignIds: [],
    dismissalTarget: null,
  };
}

describe('Dashboard workspace and attention states', () => {
  test('distinguishes loading, genuine first use, unavailable, and returning work', () => {
    const empty = DASHBOARD_REQUIRED_COLLECTION_IDS.map(() => ({ status: 'ready' as const, count: 0 }));
    assert.equal(dashboardWorkspaceState(empty.slice(0, -1)), 'loading');
    assert.equal(dashboardWorkspaceState(empty), 'first_use');
    assert.equal(dashboardWorkspaceState(empty.map((entry, index) => index === 2 ? { status: 'unavailable' as const } : entry)), 'unavailable');
    assert.equal(dashboardWorkspaceState(empty.map((entry, index) => index === 0 ? { status: 'ready' as const, count: 1 } : entry)), 'returning');
  });

  test('counts changed-since-review only from explicit fingerprint-bound lifecycle state', () => {
    const reviewed = setAnalystReviewDecision(emptyAnalystReviewStateStore(), item(), {
      disposition: 'resolved',
      rationale: 'The exact retained comparison was reviewed.',
      reviewedAt: '2026-08-23T01:00:00.000Z',
    });
    const changed = item(analystReviewMaterialFingerprint(['second']));
    const lifecycle = analystReviewLifecycle(changed, reviewed, NOW);
    const summary = buildDashboardAttentionSummary({
      reviewItems: [{ ...changed, lifecycle }],
      cases: [],
      watchlistCount: 0,
      now: NOW,
    });
    assert.equal(lifecycle.invalidated, true);
    assert.equal(lifecycle.recurred, true);
    assert.equal(summary.changedSinceReview, 1);
    assert.equal(summary.overdue, 1);
    assert.equal(summary.attentionNeeded, 1);

    const neverReviewed = item(analystReviewMaterialFingerprint(['unreviewed']));
    const unreviewedSummary = buildDashboardAttentionSummary({
      reviewItems: [{ ...neverReviewed, lifecycle: analystReviewLifecycle(neverReviewed, emptyAnalystReviewStateStore(), NOW) }],
      cases: [],
      watchlistCount: 0,
      now: NOW,
    });
    assert.equal(unreviewedSummary.changedSinceReview, 0);
  });
});
