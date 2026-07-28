import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildAnalystReviewInbox, MAX_ANALYST_REVIEW_ITEMS } from '../frontend/src/lib/analysis/analyst-review-inbox.ts';
import type { CaseRecord } from '../frontend/src/lib/analysis/case-model.ts';
import type { BulkSession } from '../frontend/src/lib/analysis/bulk-session-model.ts';
import type { WatchlistCollection } from '../frontend/src/lib/analysis/watchlist-store.ts';

const NOW = '2026-07-28T08:00:00.000Z';

function caseRecord(): CaseRecord {
  return {
    id: 'case-one',
    domain: 'review.invalid',
    status: 'reviewing',
    disposition: 'unreviewed',
    tags: [],
    notes: [],
    source: 'lookup',
    evidenceHistory: [],
    evidencePins: [],
    decisions: [],
    actions: [{
      id: 'action-one',
      type: 'registrar_report',
      recipient: 'Registrar abuse desk',
      contactSource: 'RDAP',
      contactLimitations: ['Role address not independently verified.'],
      dueAt: '2026-07-27T08:00:00.000Z',
      state: 'ready_for_review',
      reference: null,
      followUpAt: null,
      outcome: null,
      createdAt: '2026-07-26T08:00:00.000Z',
      updatedAt: '2026-07-27T08:00:00.000Z',
    }],
    assertions: [],
    manualTrail: [],
    createdAt: '2026-07-26T08:00:00.000Z',
    updatedAt: '2026-07-27T08:00:00.000Z',
  };
}

function bulkSession(): BulkSession {
  return {
    id: 'bulk-one',
    name: 'Candidate review',
    mode: 'deep',
    state: 'partial',
    inputDigest: `sha256:${'a'.repeat(64)}`,
    domains: ['one.invalid', 'two.invalid'],
    results: [],
    startedAt: '2026-07-27T07:00:00.000Z',
    updatedAt: '2026-07-27T09:00:00.000Z',
    completedAt: null,
  };
}

function watchlists(): WatchlistCollection {
  return {
    Priority: {
      updatedAt: '2026-07-27T10:00:00.000Z',
      results: [],
      baseline: [],
      history: [{
        checkedAt: '2026-07-27T10:00:00.000Z',
        mode: 'deep',
        resultCount: 2,
        conclusiveCount: 1,
        changeCount: 1,
        omittedChanges: 0,
        changes: [{ domain: 'changed.invalid', field: 'hasMx', before: false, after: true, kind: 'mail_activated', tone: 'warning' }],
      }],
    },
  };
}

describe('analyst review inbox', () => {
  test('combines retained work without changing source semantics', () => {
    const inbox = buildAnalystReviewInbox({
      cases: [caseRecord()],
      watchlists: watchlists(),
      bulkSessions: [bulkSession()],
    }, NOW);
    assert.equal(inbox.counts.all, 4);
    assert.equal(inbox.counts.overdue, 1);
    assert.equal(inbox.items[0]?.kind, 'case_action');
    assert.equal(inbox.items.find((item) => item.kind === 'watchlist_change')?.completeness, 'partial');
    assert.equal(inbox.items.find((item) => item.kind === 'case')?.completeness, 'inconclusive');
  });

  test('excludes resolved cases, settled actions, unchanged watchlists, and complete sessions', () => {
    const record = caseRecord();
    record.status = 'resolved';
    record.actions[0]!.state = 'closed';
    const unchanged = watchlists();
    unchanged.Priority!.history[0]!.changeCount = 0;
    const session = bulkSession();
    session.state = 'complete';
    assert.equal(buildAnalystReviewInbox({ cases: [record], watchlists: unchanged, bulkSessions: [session] }, NOW).items.length, 0);
  });

  test('bounds projected output deterministically', () => {
    const cases = Array.from({ length: MAX_ANALYST_REVIEW_ITEMS + 20 }, (_, index) => ({
      ...caseRecord(),
      id: `case-${index}`,
      domain: `review-${index}.invalid`,
      actions: [],
    }));
    const inbox = buildAnalystReviewInbox({ cases }, NOW);
    assert.equal(inbox.items.length, MAX_ANALYST_REVIEW_ITEMS);
    assert.equal(inbox.truncated, true);
  });
});
