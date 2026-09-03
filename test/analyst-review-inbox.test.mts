import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
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
    assert.equal(inbox.admission.displayed, 4);
    assert.equal(inbox.admission.totalAtLeast, 4);
    assert.equal(inbox.admission.omittedAtLeast, 0);
    assert.equal(inbox.admission.totalIsExact, true);
    assert.equal(inbox.truncated, false);
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
