import assert from 'node:assert/strict';
import { relationshipObservation } from '../packages/comparison/relationship-evidence.mts';
import { describe, test } from 'node:test';
import {
  buildEvidenceDebtReview,
} from '../frontend/src/lib/analysis/evidence-debt-review.ts';
import { normalizeBulkSessionStore, serializeBulkSessionStore } from '../packages/workspace/bulk-session-model.mts';
import { buildAnalystReviewInbox } from '../frontend/src/lib/analysis/analyst-review-inbox.ts';
import { createCase, type CaseRecord } from '../frontend/src/lib/analysis/case-model.ts';
import { normalizeSnapshot } from '../packages/cases/case-evidence-model.mts';
import type {
  BulkSession,
  BulkSessionResult,
  BulkSessionSourceCoverage,
} from '../frontend/src/lib/analysis/bulk-session-model.ts';

const NOW = '2026-08-09T12:00:00.000Z';

function result(domain: string, sourceCoverage: BulkSessionSourceCoverage[]): BulkSessionResult {
  return {
    domain,
    status: 'complete',
    availability: 'registered',
    confidence: 'high',
    registrar: 'Example Registrar',
    activity: 'Inactive',
    risk: 10,
    opportunity: null,
    mutationTypes: [],
    trusted: null,
    error: '',
    scanDepth: 'deep',
    observedAt: null,
    createdDate: null,
    expiryDate: null,
    privacyProtected: null,
    nameservers: [],
    hasMx: null,
    hasNullMx: null,
    hasSpf: null,
    hasDmarc: null,
    activityStatus: null,
    pageTitle: null,
    faviconHash: null,
    faviconPHash: null,
    faviconMatch: false,
    faviconNearMatch: false,
    reusesOfficialAssets: false,
    hasPasswordField: false,
    hasExternalFormAction: null,
    phishingLanguageMatch: null,
    idnReferenceMatch: false,
    pageBaselineMatch: false,
    hasActiveBrandProfile: false,
    riskModelVersion: 7,
    opportunityModelVersion: null,
    riskFactors: [],
    dns: null,
    dnssec: null,
    comparisonEvidence: null,
    relationship: relationshipObservation({}),
    sourceCoverage: sourceCoverage.map((source) => ({ observedAt: '2026-08-01T00:00:00.000Z', ...source })),
    profileContext: {
      sourceState: 'ready',
      activeProfileId: null,
      profileUpdatedAt: null,
      limitation: '',
    },
  };
}

function session(overrides: Partial<BulkSession> = {}): BulkSession {
  return {
    id: 'session-one',
    name: 'Saved review',
    mode: 'deep',
    state: 'complete',
    inputDigest: `sha256:${'a'.repeat(64)}`,
    domains: ['review.invalid'],
    results: [result('review.invalid', [{ source: 'rdap', state: 'partial' }])],
    startedAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    completedAt: '2026-08-01T00:00:00.000Z',
    profileContext: {
      sourceState: 'ready',
      activeProfileId: null,
      profileUpdatedAt: null,
      limitation: '',
    },
    ...overrides,
  };
}

function caseRecord(overrides: Partial<CaseRecord> = {}): CaseRecord {
  return {
    id: 'case-one',
    domain: 'case-review.invalid',
    status: 'reviewing',
    disposition: 'suspicious',
    brandProfileIds: [],
    tags: [],
    notes: [],
    source: 'lookup',
    evidenceHistory: [],
    evidencePins: [],
    decisions: [],
    actions: [],
    assertions: [],
    manualTrail: [],
    sightings: [],
    observedEffects: { reviews: [], omitted: 0, preV13HistoryUnavailable: false, limitations: [] },
    closures: { records: [], omitted: 0, preV13HistoryUnavailable: false, limitations: [] },
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function pin(
  id: string,
  sourceState: string | null,
  completeness: 'complete' | 'partial' | 'inconclusive' | 'unknown' = 'complete',
  source = 'whois',
) {
  return {
    id,
    checkpointId: null,
    field: `${id}.field`,
    category: 'registration',
    label: `${id} observation`,
    value: 'Retained value',
    source,
    sourceState,
    sourceSchema: null,
    observedAt: '2026-07-01T00:00:00.000Z',
    collectionDepth: 'deep' as const,
    completeness,
    truncated: false,
    transitionExpectation: null,
    limitations: ['Retained source limitation.'],
    createdAt: '2026-07-01T00:00:00.000Z',
  };
}

describe('evidence debt review', () => {
  test('Case refresh links retain the latest observed hostname and explicit Case identity', () => {
    const snapshot = normalizeSnapshot({
      capturedAt: NOW, inputHostname: 'login.case-review.invalid', scanDepth: 'deep', availability: 'registered',
    }, { caseDomain: 'case-review.invalid' });
    assert.ok(snapshot);
    const record = caseRecord({ evidenceHistory: [snapshot], evidencePins: [pin('refresh-pin', 'rate_limited')] });
    const debt = buildEvidenceDebtReview({ cases: [record], bulkSessions: [] }, NOW);
    const inbox = buildAnalystReviewInbox({ cases: [record] }, NOW);
    assert.equal(debt.items[0]?.nextHref, '/lookup?q=login.case-review.invalid&depth=deep&case=case-one');
    assert.equal(inbox.items.find(item => item.kind === 'evidence_gap')?.retryHref, '/lookup?q=login.case-review.invalid&depth=deep&case=case-one');
    assert.equal(record.domain, 'case-review.invalid');
  });

  test('keeps undated pins actionable without calling their save time a source observation or stale evidence', () => {
    const record = createCase({ domain: 'undated.invalid', evidencePin: {
      label: 'Retained source fact', value: 'Known value with unknown source time', source: 'whois',
      observedAt: null, completeness: 'complete',
    } }, '2026-01-01T00:00:00.000Z');
    const review = buildEvidenceDebtReview({ cases: [record], bulkSessions: [] }, NOW);
    assert.equal(review.counts.all, 1);
    assert.equal(review.counts.partial, 1);
    assert.equal(review.counts.stale, 0);
    assert.equal(review.items[0]?.observedAt, null);
    assert.match(review.items[0]?.limitations.join(' ') ?? '', /freshness cannot be determined from the save time/u);
  });

  test('projects only explicit actionable saved source states and separately pinned gaps', () => {
    const bulk = session({
      domains: ['review.invalid', 'no-coverage.invalid', 'expected.bv'],
      results: [
        result('review.invalid', [
          { source: 'rdap', state: 'partial' },
          { source: 'http', state: 'complete' },
          { source: 'whois', state: 'skipped' },
          { source: 'dns', state: 'not_found' },
        ]),
        result('no-coverage.invalid', []),
        result('expected.bv', [{ source: 'rdap', state: 'unsupported' }]),
      ],
    });
    const record = caseRecord({
      evidencePins: [
        pin('conflict-pin', 'conflicting'),
        pin('rate-pin', 'rate_limited'),
        pin('unsupported-pin', 'unsupported'),
        pin('unknown-pin', null, 'unknown'),
        pin('skipped-pin', 'skipped', 'partial'),
      ],
    });
    const review = buildEvidenceDebtReview({
      cases: [record, caseRecord({ id: 'case-empty', domain: 'empty.invalid' })],
      bulkSessions: [bulk],
    }, NOW);

    assert.equal(review.counts.all, 7);
    assert.deepEqual(review.counts, {
      conflicting: 1,
      rate_limited: 1,
      unavailable: 1,
      partial: 1,
      stale: 6,
      unsupported: 1,
      all: 7,
    });
    assert.equal(review.retention.bulkRowsWithoutCoverage, 1);
    assert.equal(review.retention.casesWithoutPins, 1);
    assert.equal(review.retention.explicitlySkipped, 2);
    assert.equal(review.retention.explicitlyNotFound, 1);
    assert.equal(review.items.some((item) => item.domain === 'expected.bv'), false);
    assert.equal(review.items.some((item) => item.detail.includes('skipped-pin')), false);
    assert.equal(review.items.find((item) => item.sourceId === 'rdap')?.nextAction, 'retry');
    assert.equal(review.items.find((item) => item.id.includes('debt-case') && item.primaryState === 'conflicting')?.nextAction, 'case_review');
    assert.equal(review.items.find((item) => item.primaryState === 'rate_limited')?.nextHref, '/lookup?q=case-review.invalid&depth=deep&case=case-one');
    assert.match(review.limitations.join(' '), /Empty compact fields do not create debt/u);
  });

  test('uses the newest exact Bulk source observation and remains input-order stable', () => {
    const older = session({
      id: 'older',
      updatedAt: '2026-07-01T00:00:00.000Z',
      results: [result('same.invalid', [{ source: 'rdap', state: 'partial', observedAt: '2026-07-01T00:00:00.000Z' }])],
    });
    const newer = session({
      id: 'newer',
      updatedAt: '2026-08-09T00:00:00.000Z',
      results: [result('same.invalid', [{ source: 'rdap', state: 'complete', observedAt: '2026-08-09T00:00:00.000Z' }])],
    });
    const forward = buildEvidenceDebtReview({ bulkSessions: [older, newer] }, NOW);
    const reverse = buildEvidenceDebtReview({ bulkSessions: [newer, older] }, NOW);
    assert.deepEqual(forward, reverse);
    assert.equal(forward.counts.all, 0);
    assert.equal(forward.omissions.olderBulkObservations, 1);
  });

  test('keeps unreadable sources explicit instead of announcing a complete zero', () => {
    const review = buildEvidenceDebtReview({
      cases: [caseRecord({ evidencePins: [pin('conflict-pin', 'conflicting')] })],
      bulkSessions: [session()],
      sourceStates: { cases: 'unavailable', bulk: 'loading' },
    }, NOW);
    assert.equal(review.counts.all, 0);
    assert.equal(review.countsComplete, false);
    assert.deepEqual(review.sourceStates, { bulk: 'loading', cases: 'unavailable' });
    assert.equal(review.retention.casesWithoutPins, 0);
  });

  test('suppresses expected unsupported services, reviewed gaps, and source-incompatible refreshes', () => {
    const expectedUnsupported = caseRecord({
      id: 'case-expected-unsupported',
      domain: 'expected.bv',
      evidencePins: [pin('expected-rdap', 'unsupported', 'complete', 'rdap')],
    });
    const manual = caseRecord({
      id: 'case-manual-source',
      domain: 'manual-source.invalid',
      evidencePins: [pin('manual-partial', 'partial', 'partial', 'external_feed')],
    });
    const dismissed = caseRecord({
      id: 'case-dismissed',
      domain: 'dismissed.invalid',
      evidencePins: [pin('dismissed-partial', 'partial', 'partial')],
    });
    const gap = buildAnalystReviewInbox({ cases: [dismissed] }, NOW).items.find((item) => item.kind === 'evidence_gap');
    assert.ok(gap?.dismissalTarget);
    dismissed.manualTrail = [{
      id: 'dismissal',
      kind: 'review',
      summary: 'Accepted source limitation.',
      target: gap.dismissalTarget,
      createdAt: NOW,
    }];
    dismissed.evidencePins.push({
      ...pin('later-unsupported', 'unsupported'),
      observedAt: NOW,
      createdAt: NOW,
    });

    const review = buildEvidenceDebtReview({ cases: [expectedUnsupported, manual, dismissed] }, NOW);
    assert.equal(review.items.some((item) => item.domain === 'expected.bv'), false);
    assert.equal(review.items.find((item) => item.domain === 'manual-source.invalid')?.nextAction, 'case_review');
    assert.deepEqual(
      review.items.filter((item) => item.domain === 'dismissed.invalid').map((item) => item.primaryState),
      ['unsupported'],
    );
    assert.equal(review.retention.reviewedCasePinsExcluded, 1);
  });

  test('uses the existing Case stale boundary without changing the exact 30-day observation', () => {
    const exact = caseRecord({
      id: 'case-exact-boundary',
      domain: 'exact-boundary.invalid',
      evidencePins: [{ ...pin('exact-pin', 'complete'), observedAt: '2026-07-10T12:00:00.000Z' }],
    });
    const older = caseRecord({
      id: 'case-older-boundary',
      domain: 'older-boundary.invalid',
      evidencePins: [{ ...pin('older-pin', 'complete'), observedAt: '2026-07-10T11:59:59.999Z' }],
    });
    const review = buildEvidenceDebtReview({ cases: [exact, older] }, NOW);
    assert.deepEqual(review.items.map((item) => item.domain), ['older-boundary.invalid']);
    assert.deepEqual(review.items[0]?.states, ['stale']);
  });

  test('keeps distinct bounded long source identities separate', () => {
    const shared = 'source-' + 'a'.repeat(62);
    const record = caseRecord({
      evidencePins: [
        pin('long-source-one', 'partial', 'partial', `${shared}-one`),
        pin('long-source-two', 'partial', 'partial', `${shared}-two`),
      ],
    });
    const review = buildEvidenceDebtReview({ cases: [record] }, NOW);
    assert.equal(review.matrix.length, 2);
    assert.equal(new Set(review.items.map((item) => item.sourceId)).size, 2);
  });

  test('projects every admitted row across sessions without a second scan or display cap', () => {
    const newestRows = Array.from({ length: 1_100 }, (_, index) => result(
      `new-${String(index).padStart(4, '0')}.invalid`,
      [{ source: 'rdap', state: 'partial' }],
    ));
    const olderRows = Array.from({ length: 1_100 }, (_, index) => result(
      `old-${String(index).padStart(4, '0')}.invalid`,
      [{ source: 'rdap', state: 'partial' }],
    ));
    const newer = session({ id: 'newer', updatedAt: '2026-08-09T00:00:00.000Z', domains: newestRows.map((row) => row.domain), results: newestRows });
    const older = session({ id: 'older', updatedAt: '2026-08-08T00:00:00.000Z', domains: olderRows.map((row) => row.domain), results: olderRows });
    const admitted = normalizeBulkSessionStore([older, newer]);
    assert.equal(admitted.sessions.flatMap((saved) => saved.results).length, 2_200);
    assert.doesNotThrow(() => serializeBulkSessionStore(admitted));
    const review = buildEvidenceDebtReview({ bulkSessions: admitted.sessions }, NOW);
    const reversed = buildEvidenceDebtReview({ bulkSessions: [...admitted.sessions].reverse() }, NOW);
    assert.deepEqual(review, reversed);
    assert.equal(review.omissions.bulkRows, 0);
    assert.equal(review.counts.all, 2_200);
    assert.equal(review.items.length, 2_200);
    assert.equal(review.omissions.items, 0);
    assert.equal(review.countsComplete, true);
    assert.equal(review.truncated, false);
    assert.deepEqual(new Set(review.items.map((item) => item.domain)), new Set([...newestRows, ...olderRows].map((row) => row.domain)));
  });

  test('keeps tied states and undated peers without selecting an arbitrary winner or trusting save time', () => {
    const observedAt = '2026-08-09T00:00:00.000Z';
    const values = [
      session({ id: 'complete', updatedAt: '2026-07-01T00:00:00.000Z', results: [result('same.invalid', [{ source: 'dns', state: 'complete', observedAt }])] }),
      session({ id: 'partial', updatedAt: NOW, results: [result('same.invalid', [{ source: 'dns', state: 'partial', observedAt }])] }),
      session({ id: 'undated', updatedAt: NOW, results: [result('same.invalid', [{ source: 'dns', state: 'complete', observedAt: null }])] }),
    ];
    const review = buildEvidenceDebtReview({ bulkSessions: values }, NOW);
    assert.deepEqual(review, buildEvidenceDebtReview({ bulkSessions: [...values].reverse() }, NOW));
    assert.equal(review.items.length, 3);
    assert.ok(review.items.every((item) => item.states.includes('conflicting') && item.states.includes('partial')));
    assert.equal(review.items.find((item) => item.ownerId === 'undated')?.observedAt, null);
    assert.equal(review.counts.stale, 0);
    assert.equal(review.omissions.olderBulkObservations, 0);
  });

  test('a skipped collection cannot supersede collected evidence and different scan depths stay independent', () => {
    const partial = session({ id: 'partial', results: [result('same.invalid', [{ source: 'dns', state: 'partial' }])] });
    const skipped = session({ id: 'skipped', results: [result('same.invalid', [{ source: 'dns', state: 'skipped', observedAt: NOW }])] });
    const fast = session({ id: 'fast', results: [{ ...result('same.invalid', [{ source: 'dns', state: 'complete', observedAt: NOW }]), scanDepth: 'fast' }] });
    const review = buildEvidenceDebtReview({ bulkSessions: [partial, skipped, fast] }, NOW);
    assert.deepEqual(review.items.map((item) => item.ownerId), ['partial']);
    assert.equal(review.omissions.olderBulkObservations, 0);
    assert.equal(review.retention.explicitlySkipped, 1);
  });

  test('missing, invalid and future source clocks and invalid review clocks never establish freshness', () => {
    for (const observedAt of [null, '', '2026-08-09T00:00:00', '2026-08-10T00:00:00.000Z']) {
      const review = buildEvidenceDebtReview({ bulkSessions: [session({ updatedAt: NOW, results: [result('clock.invalid', [{ source: 'dns', state: 'complete', observedAt }])] })] }, NOW);
      assert.equal(review.counts.partial, 1);
      assert.equal(review.counts.stale, 0);
      assert.match(review.items[0]?.limitations.join(' ') ?? '', /session save time does not establish freshness/u);
    }
    const review = buildEvidenceDebtReview({ bulkSessions: [session()], cases: [caseRecord({ evidencePins: [pin('clock-pin', 'complete')] })] }, 'invalid');
    assert.equal(review.evaluatedAt, null);
    assert.equal(review.counts.partial, 2);
    assert.equal(review.counts.stale, 0);
  });

  test('source spelling remains an identity rather than merging unrelated punctuation variants', () => {
    const record = caseRecord({ evidencePins: [pin('one', 'partial', 'partial', 'source-one'), pin('two', 'partial', 'partial', 'source_one')] });
    const review = buildEvidenceDebtReview({ cases: [record] }, NOW);
    assert.equal(review.matrix.length, 2);
    assert.deepEqual(new Set(review.matrix.map((row) => row.sourceId)), new Set(['source-one', 'source_one']));
  });
});
