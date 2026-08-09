import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildAnalystReviewInbox,
  filterAnalystReviewItems,
  MAX_ANALYST_REVIEW_ITEMS,
} from '../frontend/src/lib/analysis/analyst-review-inbox.ts';
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
    brandProfileIds: [],
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
    sightings: [],
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
    profileContext: {
      sourceState: 'ready',
      activeProfileId: null,
      profileUpdatedAt: null,
      limitation: '',
    },
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
    assert.equal(inbox.items.find((item) => item.kind === 'bulk_session')?.href, '/bulk#bulk-sessions-title');
  });

  test('projects explicit case evidence gaps without inventing missing facts', () => {
    const record = caseRecord();
    record.disposition = 'suspicious';
    record.evidencePins = [{
      id: 'pin-limited',
      checkpointId: null,
      field: 'whois.registrar',
      category: 'registration',
      label: 'WHOIS registrar',
      value: 'Unavailable',
      source: 'whois',
      sourceState: 'partial',
      sourceSchema: null,
      observedAt: '2026-07-27T08:00:00.000Z',
      collectionDepth: 'deep',
      completeness: 'partial',
      truncated: false,
      transitionExpectation: null,
      limitations: ['The authoritative WHOIS hop did not answer.'],
      createdAt: '2026-07-27T08:00:00.000Z',
    }];
    record.assertions = [{
      id: 'assertion-unknown',
      kind: 'unknown',
      statement: 'The effective registrar contact remains unresolved.',
      rationale: null,
      evidencePinIds: ['pin-limited'],
      state: 'open',
      createdAt: '2026-07-27T08:00:00.000Z',
      updatedAt: '2026-07-27T08:00:00.000Z',
    }];
    const inbox = buildAnalystReviewInbox({ cases: [record] }, NOW);
    const gap = inbox.items.find((item) => item.kind === 'evidence_gap');
    assert.ok(gap);
    assert.equal(inbox.counts.evidence_gap, 1);
    assert.equal(gap.completeness, 'inconclusive');
    assert.match(gap.detail, /1 open unknown · 1 limited evidence pin/i);
    assert.deepEqual(gap.sourceIds, ['analyst_assertion', 'whois']);
    assert.equal(gap.caseDomain, 'review.invalid');
    assert.equal(gap.age, 'current');
    assert.equal(gap.nextAction, 'refresh');
    assert.match(gap.rankingReason, /high priority/i);
    assert.match(gap.href, /case-response-case-one$/);
    assert.equal(gap.retryHref, '/lookup?q=review.invalid&depth=deep');
    assert.match(gap.dismissalTarget ?? '', /^evidence-gap-review:case-one:/u);
  });

  test('filters the queue by source, age, case, severity, and next action', () => {
    const record = caseRecord();
    record.disposition = 'suspicious';
    record.updatedAt = '2026-06-01T08:00:00.000Z';
    record.evidencePins = [{
      id: 'pin-failed',
      checkpointId: null,
      field: 'whois.registrar',
      category: 'registration',
      label: 'WHOIS registrar',
      value: 'Unavailable',
      source: 'whois',
      sourceState: 'failed',
      sourceSchema: null,
      observedAt: '2026-06-01T08:00:00.000Z',
      collectionDepth: 'deep',
      completeness: 'complete',
      truncated: false,
      transitionExpectation: null,
      limitations: ['The source did not answer.'],
      createdAt: '2026-06-01T08:00:00.000Z',
    }];
    const inbox = buildAnalystReviewInbox({ cases: [record], bulkSessions: [bulkSession()] }, NOW);
    const matches = filterAnalystReviewItems(inbox.items, {
      source: 'whois',
      age: 'stale',
      caseQuery: 'REVIEW.',
      priority: 'high',
      nextAction: 'refresh',
    });
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.kind, 'evidence_gap');
    assert.match(matches[0]?.detail ?? '', /stale observation/u);
    assert.deepEqual(filterAnalystReviewItems(inbox.items, { source: 'bulk' }).map((item) => item.kind), ['bulk_session']);
  });

  test('hides only an explicitly reviewed gap fingerprint and restores a changed gap', () => {
    const record = caseRecord();
    record.disposition = 'suspicious';
    record.assertions = [{
      id: 'assertion-unknown',
      kind: 'unknown',
      statement: 'The effective service remains unresolved.',
      rationale: null,
      evidencePinIds: [],
      state: 'open',
      createdAt: '2026-07-27T08:00:00.000Z',
      updatedAt: '2026-07-27T08:00:00.000Z',
    }];
    const first = buildAnalystReviewInbox({ cases: [record] }, NOW);
    const gap = first.items.find((item) => item.kind === 'evidence_gap');
    assert.ok(gap?.dismissalTarget);
    record.manualTrail = [{
      id: 'trail-dismissal',
      kind: 'review',
      summary: 'Dismissed the current evidence-gap review: Accepted source limitation.',
      target: gap.dismissalTarget,
      createdAt: NOW,
    }];
    assert.equal(buildAnalystReviewInbox({ cases: [record] }, NOW).counts.evidence_gap, 0);

    record.assertions.push({
      ...record.assertions[0]!,
      id: 'assertion-new',
      statement: 'A new contradiction requires review.',
      kind: 'contradiction',
    });
    const changed = buildAnalystReviewInbox({ cases: [record] }, NOW);
    assert.equal(changed.counts.evidence_gap, 1);
    assert.notEqual(changed.items.find((item) => item.kind === 'evidence_gap')?.dismissalTarget, gap.dismissalTarget);
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
