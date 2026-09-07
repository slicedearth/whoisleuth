import assert from 'node:assert/strict';
import test from 'node:test';
import { createCase, normalizeCase } from '../frontend/src/lib/analysis/case-model.ts';
import type { BulkSession } from '../frontend/src/lib/analysis/bulk-session-model.ts';
import { createRelationshipObservation } from '../frontend/src/lib/analysis/relationship-observation-model.ts';
import {
  buildRetainedEvidenceTimeline,
  filterRetainedEvidenceTimeline,
} from '../frontend/src/lib/analysis/retained-evidence-timeline.ts';
import { normalizeWatchlistEntry } from '../frontend/src/lib/analysis/watchlist-history.ts';
import { normalizeWebsiteProfileSnapshot } from '../frontend/src/lib/analysis/website-snapshot-model.ts';

const OBSERVED_AT = '2026-07-20T00:00:00.000Z';
const STORED_AT = '2026-07-21T00:00:00.000Z';

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
  assert.equal(undated.items.length, 0);
  assert.equal(undated.truncated, true);
  assert.deepEqual(undated.omissions, [{ source: 'Undated Case snapshots', count: 1 }]);
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
  assert.equal(timeline.freshnessCounts.stale, 2);
  assert.equal(timeline.freshnessCounts.current, 4);
  assert.ok(timeline.items.every((item) => item.observedAt === OBSERVED_AT));
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
    freshness: 'stale',
    eventType: 'all',
    time: 'all',
  }, '2026-07-29T00:00:00.000Z');
  assert.equal(staleBulk.length, 1);
  assert.equal(staleBulk[0]?.kind, 'bulk_session');
  assert.equal(staleBulk[0]?.freshnessThresholdDays, 7);
  assert.match(staleBulk[0]?.limitations.join(' ') ?? '', /does not establish the current state/u);

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
