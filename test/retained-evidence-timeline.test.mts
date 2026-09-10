import assert from 'node:assert/strict';
import test from 'node:test';
import { createCase, normalizeCase, normalizeCaseStore, serializeCaseStore } from '../frontend/src/lib/analysis/case-model.ts';
import type { BulkSession } from '../frontend/src/lib/analysis/bulk-session-model.ts';
import { createRelationshipObservation } from '../frontend/src/lib/analysis/relationship-observation-model.ts';
import {
  buildRetainedEvidenceTimeline,
  filterRetainedEvidenceTimeline,
} from '../frontend/src/lib/analysis/retained-evidence-timeline.ts';
import { normalizeWatchlistEntry } from '../frontend/src/lib/analysis/watchlist-history.ts';
import { normalizeWebsiteProfileSnapshot } from '../frontend/src/lib/analysis/website-snapshot-model.ts';
import { buildAnalystReviewInbox } from '../frontend/src/lib/analysis/analyst-review-inbox.ts';
import { emptyAnalystReviewStateStore, setAnalystReviewDecision } from '../packages/monitoring/analyst-review-state.mts';

const OBSERVED_AT = '2026-07-20T00:00:00.000Z';
const STORED_AT = '2026-07-21T00:00:00.000Z';
const ALL_FILTERS = { entity: '', caseId: '', source: '', area: '', freshness: 'all', eventType: 'all', time: 'all' } as const;

test('review activity retains every admitted decision, all current Case associations and separate event clocks', () => {
  const record = createCase({ domain: 'review-history.example' }, OBSERVED_AT);
  const review = buildAnalystReviewInbox({ cases: [record] }, OBSERVED_AT).items[0];
  assert.ok(review);
  let state = emptyAnalystReviewStateStore();
  for (let index = 0; index < 10; index += 1) state = setAnalystReviewDecision(state, review, {
    disposition: 'open', rationale: `Retained decision ${index}. ${'r'.repeat(960)}`,
    reviewedAt: new Date(Date.parse(OBSERVED_AT) + index * 60_000).toISOString(),
    caseIds: [record.id, 'missing-case'],
  });
  const before = structuredClone(state);
  const timeline = buildRetainedEvidenceTimeline({ cases: [record], reviewState: state, now: STORED_AT });
  const decisions = timeline.items.filter((item) => item.kind === 'review_decision');
  assert.equal(decisions.length, 9);
  assert.equal(timeline.counts.review_decision, 9);
  assert.equal(timeline.counts.activity, 9);
  assert.deepEqual(decisions.map((item) => item.detail), [state.records[0]!.rationale, ...state.records[0]!.history.map((item) => item.rationale)]);
  assert.ok(decisions.every((item) => item.observedAt === null && item.storedAt === null && item.freshness === 'unknown' && item.caseId === null));
  assert.deepEqual(decisions.map((item) => item.activityAt), [state.records[0]!.reviewedAt, ...state.records[0]!.history.map((item) => item.reviewedAt)]);
  assert.equal(new Set(decisions.map((item) => item.id)).size, 9);
  assert.ok(decisions.every((item) => new URL(item.href, 'https://example.test').searchParams.get('review') === review.subjectKey));
  assert.equal(filterRetainedEvidenceTimeline(timeline, { ...ALL_FILTERS, caseId: record.id, area: 'review' }).length, 9);
  assert.equal(filterRetainedEvidenceTimeline(timeline, { ...ALL_FILTERS, caseId: 'missing-case', time: '7d' }).length, 9);
  assert.equal(filterRetainedEvidenceTimeline(timeline, { ...ALL_FILTERS, eventType: 'evidence', area: 'review' }).length, 0);
  assert.deepEqual(timeline.cases.find((item) => item.id === 'missing-case'), { id: 'missing-case', label: 'missing-case (unavailable)' });
  assert.deepEqual(decisions[0]?.caseAssociations, [
    { id: record.id, label: 'review-history.example', present: true },
    { id: 'missing-case', label: 'missing-case (unavailable)', present: false },
  ].sort((left, right) => left.id.localeCompare(right.id)));
  assert.deepEqual(timeline.omissions, [{ source: 'Earlier analyst decisions no longer retained', count: 1 }]);
  assert.ok(decisions.slice(1).every((item) => item.limitations.some((value) => value.includes('historical associations were not stored'))));
  assert.deepEqual(state, before);
});

test('review-only timelines preserve orphan histories without inventing evidence dates or Case records', () => {
  const record = createCase({ domain: 'unavailable-history.example' }, OBSERVED_AT);
  const review = buildAnalystReviewInbox({ cases: [record] }, OBSERVED_AT).items[0];
  assert.ok(review);
  const state = setAnalystReviewDecision(emptyAnalystReviewStateStore(), review, { disposition: 'open', rationale: 'Awaiting evidence.', reviewedAt: OBSERVED_AT });
  const timeline = buildRetainedEvidenceTimeline({ reviewState: state, now: STORED_AT });
  assert.equal(timeline.items.length, 1);
  assert.deepEqual(timeline.items[0]?.entities, []);
  assert.equal(timeline.items[0]?.caseAssociations?.[0]?.present, false);
  assert.equal(timeline.items[0]?.completeness, 'unknown');
  assert.equal(timeline.items[0]?.freshnessThresholdDays, null);
  assert.equal(timeline.truncated, false);
  const next = setAnalystReviewDecision(state, review, { disposition: 'open', rationale: 'A later review.', reviewedAt: STORED_AT });
  const revised = buildRetainedEvidenceTimeline({ reviewState: next, now: STORED_AT });
  assert.equal(revised.items.find((item) => item.detail === 'Awaiting evidence.')?.id, timeline.items[0]?.id);
  const repeated = setAnalystReviewDecision(state, review, { disposition: 'open', rationale: 'Awaiting evidence.', reviewedAt: OBSERVED_AT });
  const duplicated = buildRetainedEvidenceTimeline({ reviewState: repeated, now: STORED_AT });
  assert.equal(duplicated.items.length, 2);
  assert.equal(new Set(duplicated.items.map((item) => item.id)).size, 2);
  const overflow = buildRetainedEvidenceTimeline({ reviewState: { ...next, records: [
    { ...next.records[0]!, historyOmitted: Number.MAX_SAFE_INTEGER },
    { ...next.records[0]!, subjectKey: review.subjectKey.replace(/.$/u, review.subjectKey.endsWith('0') ? '1' : '0'), historyOmitted: Number.MAX_SAFE_INTEGER },
  ] } });
  assert.equal(overflow.omissions[0]?.count, Number.MAX_SAFE_INTEGER);
});

test('all admitted pins remain searchable beyond the former 2,000-entry projection limit', () => {
  const cases = Array.from({ length: 75 }, (_, index) => {
    const record = createCase({ domain: `retained-${index}.example`, evidencePin: { label: 'Undated fact', value: 'Known value', source: 'whois', observedAt: null } }, STORED_AT);
    record.evidencePins = Array.from({ length: 40 }, (_, pin) => ({ ...record.evidencePins[0]!, id: `pin-${index}-${pin}` }));
    return record;
  });
  const admitted = normalizeCaseStore(JSON.parse(serializeCaseStore(cases))).cases;
  assert.equal(admitted.length, 75);
  assert.equal(admitted.flatMap((record) => record.evidencePins).length, 3_000);
  const timeline = buildRetainedEvidenceTimeline({ cases: admitted, now: STORED_AT });
  assert.equal(timeline.items.length, 3_000);
  assert.equal(timeline.truncated, false);
  assert.equal(timeline.freshnessCounts.unknown, 3_000);
  assert.equal(filterRetainedEvidenceTimeline(timeline, { ...ALL_FILTERS, entity: 'retained-74.example', time: 'undated' }).length, 40);
  assert.equal(filterRetainedEvidenceTimeline(timeline, { ...ALL_FILTERS, time: '7d' }).length, 0);
});

test('full relationship membership stays searchable and unavailable clocks never become current', () => {
  const domains = Array.from({ length: 50 }, (_, index) => `member-${String(index).padStart(2, '0')}.example`);
  const relationship = createRelationshipObservation({ type: 'ip_address', value: '192.0.2.10', domains }, { retainedAt: STORED_AT });
  for (const observedAt of [null, '', '2026-07-20T00:00:00', '2026-07-22T00:00:00.000Z']) {
    const timeline = buildRetainedEvidenceTimeline({ relationships: [{ ...relationship, observedAt }], now: STORED_AT });
    assert.equal(timeline.items[0]?.freshness, 'unknown');
    assert.deepEqual(timeline.items[0]?.entities, domains);
    assert.equal(filterRetainedEvidenceTimeline(timeline, { ...ALL_FILTERS, entity: 'member-49' }).length, 1);
    assert.equal(filterRetainedEvidenceTimeline(timeline, { ...ALL_FILTERS, time: '7d' }).length, 0);
  }
  const timeline = buildRetainedEvidenceTimeline({ relationships: [{ ...relationship, observedAt: OBSERVED_AT }], now: 'invalid' });
  assert.equal(timeline.evaluatedAt, null);
  assert.equal(timeline.items[0]?.freshness, 'unknown');
  assert.equal(filterRetainedEvidenceTimeline(timeline, { ...ALL_FILTERS, time: '7d' }).length, 0);
  assert.equal(filterRetainedEvidenceTimeline(timeline, ALL_FILTERS).length, 1);
});

test('the timeline retains the complete supported Case history and counts nested exclusions', () => {
  const base = createCase({ domain: 'history.example', source: 'lookup', evidence: { scanDepth: 'deep', availability: 'registered', capturedAt: OBSERVED_AT } }, STORED_AT);
  assert.ok(base.evidenceHistory[0]);
  const history = Array.from({ length: 25 }, (_, index) => ({
    ...base.evidenceHistory[0]!,
    registrar: `Fixture registrar ${index}`,
    capturedAt: new Date(Date.parse(OBSERVED_AT) + index * 60_000).toISOString(),
  }));
  const record = normalizeCase({ ...base, evidenceHistory: history });
  assert.ok(record);
  assert.equal(record.evidenceHistory.length, 25);
  const complete = buildRetainedEvidenceTimeline({ cases: [record], now: STORED_AT });
  assert.equal(complete.items.length, 25);
  assert.equal(complete.truncated, false);
  assert.deepEqual(complete.omissions, []);
  assert.deepEqual(new Set(complete.items.map((item) => item.id)), new Set(record.evidenceHistory.map((item) => `case-snapshot:${record.id}:${item.id}`)));
  assert.deepEqual(new Set(complete.items.map((item) => item.observedAt)), new Set(history.map((item) => item.capturedAt)));

  const overBound = buildRetainedEvidenceTimeline({ cases: [{ ...record, evidenceHistory: [...history, { ...history[0]!, id: 'extra' }] }], now: STORED_AT });
  assert.equal(overBound.items.length, 25);
  assert.equal(overBound.truncated, true);
  assert.deepEqual(overBound.omissions, [{ source: 'Case snapshots outside the source bound', count: 1 }]);
  const undated = buildRetainedEvidenceTimeline({ cases: [{ ...record, evidenceHistory: [{ ...history[0]!, capturedAt: '' }] }], now: STORED_AT });
  assert.equal(undated.items.length, 1);
  assert.equal(undated.items[0]?.observedAt, null);
  assert.equal(undated.items[0]?.freshness, 'unknown');
  assert.equal(undated.truncated, false);
  assert.deepEqual(undated.omissions, []);
});

test('retained evidence timeline keeps observation, storage, source, and owner context separate', () => {
  const caseRecord = createCase({
    domain: 'timeline.invalid',
    source: 'lookup',
    evidence: {
      scanDepth: 'deep',
      availability: 'registered',
      capturedAt: OBSERVED_AT,
    },
    evidencePin: {
      checkpointId: 'checkpoint-one',
      field: 'registration.registrar',
      category: 'registration',
      label: 'Registrar',
      value: 'Example Registrar',
      source: 'Registry RDAP',
      sourceState: 'complete',
      observedAt: OBSERVED_AT,
      collectionDepth: 'deep',
      completeness: 'complete',
      limitations: ['Registrar publication is not proof of current control.'],
    },
  }, STORED_AT);
  const websiteSnapshot = normalizeWebsiteProfileSnapshot({
    id: 'website-one',
    domain: 'timeline.invalid',
    observedAt: OBSERVED_AT,
    savedAt: STORED_AT,
    complete: false,
    truncated: true,
    technologies: [{ id: 'platform', name: 'Example platform', category: 'platform', confidence: 'medium' }],
    posture: [],
    identity: {},
    sources: [{ source: 'http', state: 'partial' }],
  });
  assert.ok(websiteSnapshot);
  const watchlist = normalizeWatchlistEntry({
    updatedAt: STORED_AT,
    results: [],
    baseline: [],
    history: [{
      checkedAt: OBSERVED_AT,
      mode: 'deep',
      resultCount: 1,
      conclusiveCount: 1,
      changeCount: 1,
      omittedChanges: 0,
      changes: [{ domain: 'timeline.invalid', field: 'availability', before: 'available', after: 'registered', kind: 'new_registration', tone: 'danger' }],
    }],
  });
  const relationship = createRelationshipObservation({
    type: 'ip_address',
    value: '203.0.113.8',
    domains: ['timeline.invalid', 'related.invalid'],
  }, {
    observedAt: OBSERVED_AT,
    retainedAt: STORED_AT,
    complete: true,
    limitations: ['Shared hosting is common.'],
  });
  const bulkSession: BulkSession = {
    id: 'timeline-bulk',
    name: 'Timeline review',
    mode: 'deep',
    state: 'partial',
    inputDigest: `sha256:${'a'.repeat(64)}`,
    domains: ['timeline.invalid'],
    results: [],
    startedAt: OBSERVED_AT,
    updatedAt: STORED_AT,
    completedAt: OBSERVED_AT,
    profileContext: {
      sourceState: 'ready',
      activeProfileId: null,
      profileUpdatedAt: null,
      limitation: '',
    },
  };

  const timeline = buildRetainedEvidenceTimeline({
    cases: [caseRecord],
    bulkSessions: [bulkSession],
    watchlists: { 'Timeline review': watchlist },
    relationships: [relationship],
    websiteSnapshots: [websiteSnapshot],
    now: '2026-07-29T00:00:00.000Z',
  });

  assert.equal(timeline.counts.all, 6);
  assert.equal(timeline.counts.bulk_session, 1);
  assert.equal(timeline.counts.case_snapshot, 1);
  assert.equal(timeline.counts.evidence_checkpoint, 1);
  assert.equal(timeline.counts.website_snapshot, 1);
  assert.equal(timeline.counts.watchlist_check, 1);
  assert.equal(timeline.counts.relationship, 1);
  assert.equal(timeline.counts.change, 1);
  assert.equal(timeline.freshnessCounts.stale, 1);
  assert.equal(timeline.freshnessCounts.current, 4);
  assert.equal(timeline.freshnessCounts.unknown, 1);
  assert.ok(timeline.items.filter((item) => item.kind !== 'bulk_session').every((item) => item.observedAt === OBSERVED_AT));
  assert.equal(timeline.items.find((item) => item.kind === 'bulk_session')?.observedAt, null);
  assert.equal(timeline.items.find((item) => item.kind === 'bulk_session')?.activityAt, OBSERVED_AT);
  assert.equal(timeline.counts.activity, 1);
  assert.ok(timeline.items.every((item) => item.storedAt === STORED_AT));
  assert.ok(timeline.items.every((item) => item.href.startsWith('/')));
  assert.doesNotMatch(JSON.stringify(timeline), /Example Registrar/u);
  assert.doesNotMatch(JSON.stringify(timeline), /203\.0\.113\.8/u);
});

test('retained evidence timeline filters without changing unknown or partial states', () => {
  const first = createCase({
    domain: 'first.invalid',
    source: 'lookup',
    evidence: { scanDepth: 'fast', availability: 'registered', capturedAt: '2026-07-27T00:00:00.000Z' },
  }, '2026-07-28T00:00:00.000Z');
  const second = createCase({
    domain: 'second.invalid',
    source: 'lookup',
    evidence: { scanDepth: 'deep', availability: 'registered', capturedAt: '2026-05-01T00:00:00.000Z' },
  }, '2026-05-02T00:00:00.000Z');
  const timeline = buildRetainedEvidenceTimeline({
    cases: [first, second],
    now: '2026-07-29T00:00:00.000Z',
  });

  const filtered = filterRetainedEvidenceTimeline(timeline, {
    entity: 'first.invalid',
    caseId: first.id,
    source: 'lookup',
    area: 'lookup',
    freshness: 'current',
    eventType: 'evidence',
    time: '7d',
  }, '2026-07-29T00:00:00.000Z');

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.entities[0], 'first.invalid');
  assert.equal(filtered[0]?.completeness, 'unknown');
  assert.match(filtered[0]?.limitations[0] ?? '', /do not retain a complete source-coverage/u);
});

test('retained evidence timeline exposes bounded area and freshness review across workspaces', () => {
  const timeline = buildRetainedEvidenceTimeline({
    bulkSessions: [{
      id: 'stale-bulk',
      name: 'Stale Bulk review',
      mode: 'fast',
      state: 'partial',
      inputDigest: `sha256:${'b'.repeat(64)}`,
      domains: ['stale.invalid'],
      results: [],
      startedAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-02T00:00:00.000Z',
      completedAt: null,
      profileContext: {
        sourceState: 'ready',
        activeProfileId: null,
        profileUpdatedAt: null,
        limitation: '',
      },
    }],
    websiteSnapshots: [normalizeWebsiteProfileSnapshot({
      id: 'current-lookup',
      domain: 'current.invalid',
      observedAt: '2026-07-28T00:00:00.000Z',
      savedAt: '2026-07-28T01:00:00.000Z',
      complete: true,
      truncated: false,
      technologies: [],
      posture: [],
      identity: {},
      sources: [{ source: 'http', state: 'complete' }],
    })!],
    now: '2026-07-29T00:00:00.000Z',
  });

  const staleBulk = filterRetainedEvidenceTimeline(timeline, {
    entity: '',
    caseId: '',
    source: '',
    area: 'bulk',
    freshness: 'unknown',
    eventType: 'all',
    time: 'all',
  }, '2026-07-29T00:00:00.000Z');
  assert.equal(staleBulk.length, 1);
  assert.equal(staleBulk[0]?.kind, 'bulk_session');
  assert.equal(staleBulk[0]?.freshnessThresholdDays, 7);
  assert.match(staleBulk[0]?.limitations.join(' ') ?? '', /not a source observation/u);

  const currentLookup = filterRetainedEvidenceTimeline(timeline, {
    entity: '',
    caseId: '',
    source: '',
    area: 'lookup',
    freshness: 'current',
    eventType: 'all',
    time: 'all',
  }, '2026-07-29T00:00:00.000Z');
  assert.equal(currentLookup.length, 1);
  assert.equal(currentLookup[0]?.kind, 'website_snapshot');
  assert.equal(currentLookup[0]?.freshnessThresholdDays, 30);
});
