import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  analystReviewQueue,
  analystReviewQueueMembership,
  compareAnalystReviewAdmission,
  buildAnalystReviewInbox,
  filterAnalystReviewItems,
  MAX_ANALYST_REVIEW_ITEMS,
} from '../frontend/src/lib/analysis/analyst-review-inbox.ts';
import {
  analystReviewMaterialFingerprint,
  analystReviewSubjectKey,
  emptyAnalystReviewStateStore,
  setAnalystReviewDecision,
  type AnalystReviewItem,
} from '../frontend/src/lib/analysis/analyst-review-state.ts';
import type { CaseRecord } from '../frontend/src/lib/analysis/case-model.ts';
import { createCase } from '../packages/cases/case-model.mts';
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
      routeObservedAt: null,
      routeReviewAfter: null,
      contactLimitations: ['Role address not independently verified.'],
      dueAt: '2026-07-27T08:00:00.000Z',
      state: 'ready_for_review',
      reference: null,
      followUpAt: null,
      providerOutcome: null,
      outcome: null,
      originActionId: null,
      history: [{
        id: 'event-create', previousState: null, nextState: 'drafting',
        occurredAt: '2026-07-26T08:00:00.000Z', sourceClass: 'analyst', provenance: 'fixture_creation',
        reference: null, evidencePinId: null, limitations: [], providerOutcome: null,
        outcomeDetail: null, originActionId: null, applied: true,
      }, {
        id: 'event-ready', previousState: 'drafting', nextState: 'ready_for_review',
        occurredAt: '2026-07-27T08:00:00.000Z', sourceClass: 'analyst', provenance: 'fixture_readiness_review',
        reference: null, evidencePinId: null, limitations: [], providerOutcome: null,
        outcomeDetail: null, originActionId: null, applied: true,
      }],
      historyOmitted: 0,
      historyLimitations: [],
      createdAt: '2026-07-26T08:00:00.000Z',
      metadataUpdatedAt: '2026-07-26T08:00:00.000Z',
      updatedAt: '2026-07-27T08:00:00.000Z',
    }],
    assertions: [],
    manualTrail: [],
    sightings: [],
    observedEffects: { reviews: [], omitted: 0, preV13HistoryUnavailable: false, limitations: [] },
    closures: { records: [], omitted: 0, preV13HistoryUnavailable: false, limitations: [] },
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

function watchlists(domain = 'changed.invalid'): WatchlistCollection {
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
        changes: [{ domain, field: 'hasMx', before: false, after: true, kind: 'mail_activated', tone: 'warning' }],
      }],
    },
  };
}

describe('analyst review inbox', () => {
  test('uses source times instead of recent Case edits and keeps unavailable dates unknown', () => {
    const record = createCase({ domain: 'review-clock.example', evidencePin: {
      label: 'Limited retained observation', value: 'Unavailable', field: 'tls.issuer', source: 'Fixture source',
      observedAt: '2026-06-01T00:00:00Z', completeness: 'partial', limitations: ['Source incomplete.'],
    } }, NOW);
    const gap = buildAnalystReviewInbox({ cases: [record] }, NOW).items.find((entry) => entry.kind === 'evidence_gap')!;
    assert.equal(gap.observedAt, '2026-06-01T00:00:00.000Z');
    assert.equal(gap.age, 'stale');
    const undated = { ...record, evidencePins: record.evidencePins.map((pin) => ({ ...pin, observedAt: '' })) };
    const unknown = buildAnalystReviewInbox({ cases: [undated] }, NOW).items.find((entry) => entry.kind === 'evidence_gap')!;
    assert.equal(unknown.observedAt, '');
    assert.equal(unknown.age, 'unknown');
    const session = bulkSession();
    for (const updatedAt of ['', '2026-02-30T00:00:00Z', '2026-07-27T09:00:00']) {
      const projected = buildAnalystReviewInbox({ bulkSessions: [{ ...session, updatedAt }] }, NOW).items[0]!;
      assert.equal(projected.observedAt, '');
      assert.equal(projected.age, 'unknown');
    }
  });

  test('selects material-change cohorts by check time and invalidates same-count content changes', () => {
    const source = watchlists();
    const older = source.Priority!.history[0]!;
    const recent = { ...older, checkedAt: '2026-07-28T07:00:00Z', changes: older.changes.map((change) => ({ ...change, domain: 'recent.example' })) };
    const project = (history: WatchlistCollection[string]['history']) => buildAnalystReviewInbox({ watchlists: { Priority: { ...source.Priority!, history } } }, NOW).items[0]!;
    const selected = project([recent, older]);
    assert.equal(selected.observedAt, '2026-07-28T07:00:00.000Z');
    assert.deepEqual(project([older, recent]), selected);
    const conflict = { ...recent, checkedAt: '2026-07-28T17:00:00+10:00', changes: older.changes };
    const ambiguous = project([recent, conflict]);
    assert.equal(ambiguous.completeness, 'inconclusive');
    assert.match(ambiguous.detail, /share the latest check time/u);
    assert.deepEqual(project([conflict, recent]), ambiguous);
    assert.equal(project([{ ...older, checkedAt: '' }, recent]).age, 'unknown');
    const changed = project([{ ...recent, changes: older.changes }]);
    assert.equal(changed.subjectKey, selected.subjectKey);
    assert.notEqual(changed.materialFingerprint, selected.materialFingerprint);
  });

  test('orders unknown dates and then newest observations without a non-finite comparator', () => {
    const first = buildAnalystReviewInbox({ cases: [caseRecord()] }, NOW).items[0]!;
    const old = { ...first, dueAt: null, observedAt: '2026-06-01T00:00:00Z' };
    const recent = { ...old, observedAt: NOW };
    const undated = { ...old, observedAt: '', dueAt: 'not a date' };
    assert.ok(compareAnalystReviewAdmission(undated, recent, NOW) < 0);
    assert.ok(compareAnalystReviewAdmission(recent, old, NOW) < 0);
    assert.equal(compareAnalystReviewAdmission(undated, { ...undated }, NOW), 0);
  });
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
    assert.equal(inbox.admission.displayed, 4);
    assert.equal(inbox.admission.totalAtLeast, 4);
    assert.equal(inbox.admission.omittedAtLeast, 0);
    assert.equal(inbox.admission.totalIsExact, true);
    assert.equal(inbox.truncated, false);
  });

  test('groups the main queue around analyst action rather than item taxonomy', () => {
    const inbox = buildAnalystReviewInbox({
      cases: [caseRecord()],
      watchlists: watchlists(),
      bulkSessions: [bulkSession()],
    }, NOW);
    assert.equal(analystReviewQueue(inbox.items.find((item) => item.kind === 'watchlist_change')!, NOW), 'changed');
    assert.equal(analystReviewQueue(inbox.items.find((item) => item.kind === 'case_action')!, NOW), 'needs_action');
    assert.equal(analystReviewQueue(inbox.items.find((item) => item.kind === 'bulk_session')!, NOW), 'needs_action');
    const reviewed = inbox.items.find((item) => item.kind === 'case_action')!;
    assert.equal(analystReviewQueue({
      ...reviewed,
      lifecycle: { ...reviewed.lifecycle, state: 'resolved' },
    }, NOW), 'reviewed');
    const changed = inbox.items.find((item) => item.kind === 'watchlist_change')!;
    assert.equal(analystReviewQueue({
      ...changed,
      lifecycle: { ...changed.lifecycle, state: 'expected' },
    }, NOW), 'waiting');
  });

  test('queue membership and its explanation share the same decision and priority', () => {
    const record = caseRecord();
    const item = buildAnalystReviewInbox({ cases: [record] }, NOW).items[0]!;
    const changedReason = 'Material evidence changed after the saved decision.';
    const cases = [
      { item, queue: 'needs_action', reason: /No analyst lifecycle decision/u },
      { item: { ...item, dueAt: '2026-07-29T00:00:00.000Z' }, queue: 'waiting', reason: /follow-up time has not arrived/u },
      { item: { ...item, lifecycle: { ...item.lifecycle, state: 'resolved' as const } }, queue: 'reviewed', reason: /outside the action queues/u },
      { item: { ...item, lifecycle: { ...item.lifecycle, state: 'resolved' as const, invalidated: true, reason: changedReason } }, queue: 'changed', reason: /Material evidence changed/u },
    ];
    for (const entry of cases) {
      const membership = analystReviewQueueMembership(entry.item, NOW);
      assert.equal(membership.queue, entry.queue);
      assert.equal(analystReviewQueue(entry.item, NOW), entry.queue);
      assert.match(membership.reason, entry.reason);
    }
    assert.equal(analystReviewQueueMembership({ ...item, dueAt: '2026-07-29T00:00:00.000Z' }, 'unavailable').queue, 'needs_action');
  });

  test('links a watchlist change directly to one matching Case but not an ambiguous set', () => {
    const matching = caseRecord();
    const target = 'login.review.invalid';
    matching.evidenceHistory = createCase({ domain: matching.domain, evidence: { inputHostname: target, scanDepth: 'deep', availability: 'registered' } }, NOW).evidenceHistory;
    const linked = buildAnalystReviewInbox({ cases: [matching], watchlists: watchlists(target) }, NOW)
      .items.find((item) => item.kind === 'watchlist_change');
    assert.equal(linked?.caseId, matching.id);
    assert.match(linked?.href ?? '', /case-response-case-one$/u);
    assert.match(linked?.detail ?? '', /Related Case: review\.invalid/u);

    const second = caseRecord();
    second.id = 'case-two';
    second.domain = target;
    const ambiguous = buildAnalystReviewInbox({ cases: [matching, second], watchlists: watchlists(target) }, NOW)
      .items.find((item) => item.kind === 'watchlist_change');
    assert.equal(ambiguous?.caseId, null);
    assert.match(ambiguous?.href ?? '', /^\/monitor\?view=watchlists/u);
    assert.match(ambiguous?.detail ?? '', /2 Cases match/u);
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
    assert.match(gap.dismissalTarget ?? '', /^evidence-gap-review:case-one:[a-f0-9]{64}$/u);
  });

  test('projects scheduled independent observed-effect follow-up without performing a request', () => {
    const record = caseRecord();
    record.observedEffects.reviews = [{
      id: 'effect-review-one', state: 'still_observed', observedAt: '2026-07-27T07:00:00.000Z',
      sourceClass: 'analyst', source: 'Independent fixture review', completeness: 'partial',
      limitations: ['Only the selected path was reviewed.'], evidencePinId: null, sightingId: null,
      followUpAt: '2026-07-28T07:00:00.000Z', createdAt: '2026-07-27T07:00:00.000Z',
    }];
    const inbox = buildAnalystReviewInbox({ cases: [record] }, NOW);
    const followUp = inbox.items.find((item) => item.kind === 'observed_effect_review');
    assert.ok(followUp);
    assert.equal(inbox.counts.observed_effect_review, 1);
    assert.equal(followUp.priority, 'urgent');
    assert.equal(followUp.nextAction, 'follow_up');
    assert.equal(followUp.retryHref, null);
    assert.deepEqual(followUp.sourceIds, ['observed_effect_review']);
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
    record.actions[0]!.state = 'terminal';
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
    assert.equal(inbox.admission.totalAtLeast, MAX_ANALYST_REVIEW_ITEMS);
    assert.equal(inbox.admission.omittedAtLeast, 0);
    assert.equal(inbox.admission.totalIsExact, false);
  });

  test('admits every projected family through one global order and reports bounded omissions', () => {
    const base = buildAnalystReviewInbox({ cases: [caseRecord()] }, NOW).items[0];
    assert.ok(base);
    const projected = Array.from({ length: MAX_ANALYST_REVIEW_ITEMS }, (_, index): AnalystReviewItem => ({
      ...base,
      id: `ordinary-${index}`,
      evidenceFamily: 'case',
      subjectKey: analystReviewSubjectKey('case', ['ordinary', index]),
      materialFingerprint: analystReviewMaterialFingerprint(['ordinary', index]),
      priority: 'normal',
      dueAt: null,
    }));
    const urgent: AnalystReviewItem = {
      ...base,
      id: 'urgent-certificate',
      kind: 'certificate',
      evidenceFamily: 'certificate_identity',
      subjectKey: analystReviewSubjectKey('certificate_identity', ['urgent-certificate']),
      materialFingerprint: analystReviewMaterialFingerprint(['urgent-certificate']),
      priority: 'urgent',
    };
    const admissions = [{
      omittedAtLeast: { comparison: 17 },
      lowerBoundFamilies: ['comparison' as const],
    }];
    const inbox = buildAnalystReviewInbox({
      projectedItems: [...projected, urgent],
      projectedAdmissions: admissions,
    }, NOW);
    const reversed = buildAnalystReviewInbox({
      projectedItems: [urgent, ...projected].reverse(),
      projectedAdmissions: admissions,
    }, NOW);

    assert.equal(inbox.items.length, MAX_ANALYST_REVIEW_ITEMS);
    assert.ok(inbox.items.some((item) => item.id === urgent.id));
    assert.deepEqual(reversed.items.map((item) => item.id), inbox.items.map((item) => item.id));
    assert.deepEqual(inbox.admission.byEvidenceFamily.certificate_identity, {
      displayed: 1,
      totalAtLeast: 1,
      omittedAtLeast: 0,
      totalIsExact: true,
    });
    assert.deepEqual(inbox.admission.byEvidenceFamily.case, {
      displayed: MAX_ANALYST_REVIEW_ITEMS - 1,
      totalAtLeast: MAX_ANALYST_REVIEW_ITEMS,
      omittedAtLeast: 1,
      totalIsExact: true,
    });
    assert.equal(inbox.admission.totalAtLeast, MAX_ANALYST_REVIEW_ITEMS + 18);
    assert.equal(inbox.admission.omittedAtLeast, 18);
    assert.equal(inbox.admission.totalIsExact, false);
    assert.equal(inbox.truncated, true);
  });

  test('does not reuse a dismissal across adversarially colliding legacy gap identifiers', () => {
    const record = caseRecord();
    // These two identifiers collided under the retired short dismissal digest.
    const gapPin = (id: string) => ({
      id,
      checkpointId: null,
      field: 'whois.registrar',
      category: 'registration',
      label: 'WHOIS registrar',
      value: 'Unavailable',
      source: 'whois',
      sourceState: 'partial',
      sourceSchema: null,
      observedAt: '2026-07-27T08:00:00.000Z',
      collectionDepth: 'deep' as const,
      completeness: 'partial' as const,
      truncated: false,
      transitionExpectation: null,
      limitations: ['The source did not answer.'],
      createdAt: '2026-07-27T08:00:00.000Z',
    });
    record.evidencePins = [gapPin('3usv5pnjrl0v')];
    const firstTarget = buildAnalystReviewInbox({ cases: [record] }, NOW)
      .items.find((item) => item.kind === 'evidence_gap')?.dismissalTarget;
    record.evidencePins = [gapPin('dqbukzxeanp1')];
    const secondTarget = buildAnalystReviewInbox({ cases: [record] }, NOW)
      .items.find((item) => item.kind === 'evidence_gap')?.dismissalTarget;
    assert.ok(firstTarget);
    assert.ok(secondTarget);
    assert.notEqual(firstTarget, secondTarget);

    record.manualTrail = [{
      id: 'legacy-collision-check',
      kind: 'review',
      summary: 'Reviewed a different evidence gap.',
      target: firstTarget,
      createdAt: NOW,
    }];
    assert.equal(buildAnalystReviewInbox({ cases: [record] }, NOW).counts.evidence_gap, 1);
  });

  test('filters derived recurrence and invalidation without treating either as a permanent disposition', () => {
    const original = caseRecord();
    const initial = buildAnalystReviewInbox({ cases: [original] }, NOW);
    const action = initial.items.find((item) => item.kind === 'case_action');
    assert.ok(action);
    const reviewState = setAnalystReviewDecision(emptyAnalystReviewStateStore(), action, {
      disposition: 'suppressed',
      rationale: 'The exact retained action is temporarily suppressed for fixture review.',
      reviewedAt: '2026-07-28T07:00:00.000Z',
      expiresAt: '2026-07-29T07:00:00.000Z',
    });
    assert.equal(filterAnalystReviewItems(
      buildAnalystReviewInbox({ cases: [original], reviewState }, NOW).items,
      { lifecycle: 'suppressed' },
    ).length, 1);

    const changed = caseRecord();
    changed.actions[0]!.recipient = 'Different reviewed route';
    const invalidated = buildAnalystReviewInbox({ cases: [changed], reviewState }, NOW);
    const recurrent = filterAnalystReviewItems(invalidated.items, { lifecycle: 'recurred' });
    assert.equal(recurrent.length, 1);
    assert.equal(recurrent[0]?.lifecycle.state, 'invalidated');
    assert.equal(recurrent[0]?.lifecycle.recurred, true);
    assert.equal(filterAnalystReviewItems(invalidated.items, { lifecycle: 'invalidated' }).length, 1);
  });

  test('preserves imported lifecycle state as explicitly orphaned when source evidence is unavailable', () => {
    const action = buildAnalystReviewInbox({ cases: [caseRecord()] }, NOW)
      .items.find((item) => item.kind === 'case_action');
    assert.ok(action);
    const reviewState = setAnalystReviewDecision(emptyAnalystReviewStateStore(), action, {
      disposition: 'expected',
      rationale: 'The exact source-qualified action was reviewed before export.',
      reviewedAt: '2026-07-28T07:00:00.000Z',
      expiresAt: '2026-07-29T07:00:00.000Z',
    });
    const importedWithoutEvidence = buildAnalystReviewInbox({ reviewState }, NOW);
    assert.equal(importedWithoutEvidence.items.length, 1);
    assert.equal(importedWithoutEvidence.items[0]?.kind, 'orphaned_state');
    assert.equal(importedWithoutEvidence.items[0]?.lifecycle.state, 'orphaned');
    assert.equal(importedWithoutEvidence.items[0]?.lifecycle.effectiveDisposition, 'open');
    assert.equal(importedWithoutEvidence.items[0]?.completeness, 'inconclusive');
    assert.equal(filterAnalystReviewItems(importedWithoutEvidence.items, { lifecycle: 'orphaned' }).length, 1);
  });
});
