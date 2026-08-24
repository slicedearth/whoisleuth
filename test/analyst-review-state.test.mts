import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, test } from 'node:test';

import {
  ANALYST_REVIEW_STATE_SCHEMA,
  ANALYST_REVIEW_STATE_SCHEMA_VERSION,
  analystReviewLifecycle,
  analystReviewMaterialFingerprint,
  analystReviewSubjectKey,
  canonicalAnalystReviewIdentityJson,
  emptyAnalystReviewStateStore,
  mergeAnalystReviewStateStores,
  migrateDevelopmentAnalystReviewStateStore,
  normalizeAnalystReviewStateStore,
  orphanedAnalystReviewStates,
  serializeAnalystReviewStateStore,
  setAnalystReviewDecision,
  type AnalystReviewItem,
} from '../packages/monitoring/analyst-review-state.mts';

const NOW = '2026-08-23T01:00:00.000Z';

function item(overrides: Partial<AnalystReviewItem> = {}): AnalystReviewItem {
  const subjectKey = analystReviewSubjectKey('case', ['evidence-gap', 'case-one']);
  return {
    id: 'evidence-gap:case-one',
    kind: 'evidence_gap',
    evidenceFamily: 'case',
    subjectKey,
    materialFingerprint: analystReviewMaterialFingerprint(['pin-one', 'partial']),
    requiresExpiry: true,
    priority: 'high',
    title: 'Review retained evidence gap',
    detail: 'One retained evidence pin is partial.',
    source: 'Browser-local case evidence',
    sourceIds: ['case'],
    caseDomain: 'review-state.invalid',
    observedAt: NOW,
    dueAt: null,
    age: 'current',
    completeness: 'partial',
    nextAction: 'refresh',
    rankingReason: 'Partial evidence remains open.',
    href: '/monitor?view=cases&case=case-one',
    retryHref: '/lookup?q=review-state.invalid&depth=deep',
    caseId: 'case-one',
    campaignIds: ['campaign-one'],
    dismissalTarget: null,
    ...overrides,
  };
}

describe('canonical analyst Review Item lifecycle', () => {
  test('keeps stable subject identity separate from material evidence identity', () => {
    assert.equal(
      analystReviewSubjectKey('case', ['evidence-gap', 'case-one']),
      analystReviewSubjectKey('case', ['evidence-gap', 'case-one']),
    );
    assert.notEqual(
      analystReviewMaterialFingerprint(['pin-one', 'partial']),
      analystReviewMaterialFingerprint(['pin-one', 'complete']),
    );
    assert.match(analystReviewSubjectKey('case', ['evidence-gap']), /^review:case:[a-f0-9]{64}$/u);
    assert.match(analystReviewMaterialFingerprint(['evidence']), /^material:[a-f0-9]{64}$/u);
  });

  test('hashes the complete typed identity without collapsing order, suffixes, or nullish values', () => {
    assert.notEqual(
      analystReviewMaterialFingerprint(['a'.repeat(500) + 'X']),
      analystReviewMaterialFingerprint(['a'.repeat(500) + 'Y']),
    );
    const left = Array.from({ length: 101 }, (_, index) => index);
    const right = [...left];
    right[100] = 10_000;
    assert.notEqual(analystReviewMaterialFingerprint(left), analystReviewMaterialFingerprint(right));
    assert.notEqual(analystReviewMaterialFingerprint(['first', 'second']), analystReviewMaterialFingerprint(['second', 'first']));
    assert.notEqual(analystReviewMaterialFingerprint([null]), analystReviewMaterialFingerprint([undefined]));
    assert.equal(
      analystReviewMaterialFingerprint([{ second: 2, first: 1 }]),
      analystReviewMaterialFingerprint([{ first: 1, second: 2 }]),
    );
    for (const parts of [
      [] as unknown[],
      ['fixture', { ordered: ['first', 'second'] }],
      ['Unicode — 🔎'.repeat(80)],
    ]) {
      const canonical = canonicalAnalystReviewIdentityJson(parts);
      assert.equal(
        analystReviewMaterialFingerprint(parts),
        `material:${createHash('sha256').update(canonical).digest('hex')}`,
      );
    }
    const reviewed = item({
      materialFingerprint: analystReviewMaterialFingerprint(['a'.repeat(500) + 'X']),
      completeness: 'complete',
    });
    const retained = setAnalystReviewDecision(emptyAnalystReviewStateStore(), reviewed, {
      disposition: 'resolved', rationale: 'The exact complete evidence was reviewed.', reviewedAt: NOW,
    });
    const changed = { ...reviewed, materialFingerprint: analystReviewMaterialFingerprint(['a'.repeat(500) + 'Y']) };
    assert.equal(analystReviewLifecycle(changed, retained, NOW).state, 'invalidated');
  });

  test('fails closed before hashing cyclic, accessor-backed, or over-broad identity input', () => {
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    assert.throws(() => analystReviewMaterialFingerprint(cyclic), /cycles/);

    const accessor = Object.defineProperty({}, 'value', {
      enumerable: true,
      get: () => 'must not be read',
    });
    assert.throws(() => analystReviewSubjectKey('case', [accessor]), /accessor/);
    assert.throws(
      () => analystReviewMaterialFingerprint(Array.from({ length: 2_001 }, (_, index) => index)),
      /array bound/,
    );
  });

  test('retains a bounded decision overlay and never resolves partial evidence', () => {
    assert.throws(
      () => setAnalystReviewDecision(emptyAnalystReviewStateStore(), item(), {
        disposition: 'resolved',
        rationale: 'This should remain open.',
        reviewedAt: NOW,
      }),
      /Partial, inconclusive, or stale evidence cannot resolve/,
    );
    assert.throws(
      () => setAnalystReviewDecision(emptyAnalystReviewStateStore(), item({ completeness: 'complete', age: 'stale' }), {
        disposition: 'resolved',
        rationale: 'A stale observation must not close review.',
        reviewedAt: NOW,
      }),
      /stale evidence cannot resolve/,
    );

    const expected = setAnalystReviewDecision(emptyAnalystReviewStateStore(), item(), {
      disposition: 'expected',
      rationale: 'A reviewed maintenance period explains the retained observation.',
      reviewedAt: NOW,
      expiresAt: '2026-08-24T01:00:00.000Z',
      reviewDueAt: '2026-08-24T02:00:00.000Z',
    });
    assert.equal(expected.records[0]?.disposition, 'expected');
    assert.deepEqual(expected.records[0]?.caseIds, ['case-one']);
    assert.deepEqual(expected.records[0]?.campaignIds, ['campaign-one']);
    assert.equal(analystReviewLifecycle(item(), expected, '2026-08-23T12:00:00.000Z').state, 'expected');
  });

  test('returns expired and materially changed decisions to review while preserving history', () => {
    const first = setAnalystReviewDecision(emptyAnalystReviewStateStore(), item(), {
      disposition: 'suppressed',
      rationale: 'A bounded duplicate source is temporarily suppressed.',
      reviewedAt: NOW,
      expiresAt: '2026-08-24T01:00:00.000Z',
    });
    const expired = analystReviewLifecycle(item(), first, '2026-08-24T01:00:00.000Z');
    assert.deepEqual(
      { state: expired.state, disposition: expired.effectiveDisposition, recurred: expired.recurred },
      { state: 'expired', disposition: 'open', recurred: true },
    );

    const changed = item({ materialFingerprint: analystReviewMaterialFingerprint(['pin-two', 'partial']) });
    const invalidated = analystReviewLifecycle(changed, first, '2026-08-23T12:00:00.000Z');
    assert.equal(invalidated.state, 'invalidated');
    assert.equal(invalidated.effectiveDisposition, 'open');
    assert.equal(invalidated.invalidated, true);

    const second = setAnalystReviewDecision(first, changed, {
      disposition: 'open',
      rationale: 'Material evidence changed; review remains open.',
      reviewedAt: '2026-08-23T13:00:00.000Z',
    });
    assert.equal(second.records[0]?.history.length, 1);
    assert.equal(second.records[0]?.historyOmitted, 0);
    assert.equal(second.records[0]?.history[0]?.rationale, 'A bounded duplicate source is temporarily suppressed.');
    assert.equal(second.records[0]?.reviewedFingerprint, changed.materialFingerprint);
  });

  test('reports bounded history omissions instead of silently dropping them', () => {
    let store = emptyAnalystReviewStateStore();
    for (let index = 0; index < 12; index += 1) {
      store = setAnalystReviewDecision(store, item({
        materialFingerprint: analystReviewMaterialFingerprint(['revision', index]),
      }), {
        disposition: 'open',
        rationale: `Review revision ${index}.`,
        reviewedAt: new Date(Date.parse(NOW) + index * 60_000).toISOString(),
      });
    }
    assert.equal(store.records[0]?.history.length, 8);
    assert.equal(store.records[0]?.historyOmitted, 3);
  });

  test('merges non-destructively by review time and preserves orphaned imported states', () => {
    const local = setAnalystReviewDecision(emptyAnalystReviewStateStore(), item(), {
      disposition: 'open', rationale: 'Local review is still open.', reviewedAt: NOW,
    });
    const importedItem = item({
      subjectKey: analystReviewSubjectKey('certificate_identity', ['certificate', 'profile-one']),
      evidenceFamily: 'certificate_identity',
      materialFingerprint: analystReviewMaterialFingerprint(['issuer-one']),
      completeness: 'complete',
      caseId: null,
      campaignIds: [],
    });
    const imported = setAnalystReviewDecision(emptyAnalystReviewStateStore(), importedItem, {
      disposition: 'resolved', rationale: 'The retained certificate observation was reviewed.', reviewedAt: NOW,
    });
    const result = mergeAnalystReviewStateStores(local, imported);
    assert.equal(result.added, 1);
    assert.equal(result.updated, 0);
    assert.equal(result.store.records.length, 2);
    assert.deepEqual(orphanedAnalystReviewStates(result.store, [item()]).map((record) => record.subjectKey), [importedItem.subjectKey]);
  });

  test('retains bounded local rationale history when a newer imported decision wins', () => {
    const local = setAnalystReviewDecision(emptyAnalystReviewStateStore(), item(), {
      disposition: 'open', rationale: 'Local review remains open.', reviewedAt: NOW,
    });
    const imported = setAnalystReviewDecision(emptyAnalystReviewStateStore(), item(), {
      disposition: 'suppressed',
      rationale: 'A newer imported review is time-bounded.',
      reviewedAt: '2026-08-23T02:00:00.000Z',
      expiresAt: '2026-08-24T02:00:00.000Z',
    });
    const result = mergeAnalystReviewStateStores(local, imported);
    assert.equal(result.updated, 1);
    assert.equal(result.skipped, 0);
    assert.equal(result.store.records[0]?.rationale, 'A newer imported review is time-bounded.');
    assert.deepEqual(result.store.records[0]?.history.map((entry) => entry.rationale), ['Local review remains open.']);
  });

  test('uses exact current documents, deterministic ordering, byte bounds, and future-version refusal', () => {
    const store = setAnalystReviewDecision(emptyAnalystReviewStateStore(), item(), {
      disposition: 'open', rationale: 'Review remains open.', reviewedAt: NOW,
    });
    const normalized = normalizeAnalystReviewStateStore(store);
    assert.equal(normalized.schema, ANALYST_REVIEW_STATE_SCHEMA);
    assert.equal(normalized.version, ANALYST_REVIEW_STATE_SCHEMA_VERSION);
    assert.equal(serializeAnalystReviewStateStore(normalized), serializeAnalystReviewStateStore(structuredClone(normalized)));
    assert.throws(
      () => normalizeAnalystReviewStateStore({ ...store, version: 2 }),
      /newer schema 2/,
    );
    assert.throws(
      () => normalizeAnalystReviewStateStore({ ...store, extra: true }),
      /missing or undeclared fields/,
    );
  });

  test('rejects accessors, custom prototypes, sparse arrays, cycles, and invalid expiry', () => {
    const accessor = Object.defineProperty({}, 'version', { enumerable: true, get: () => 1 });
    assert.throws(() => normalizeAnalystReviewStateStore(accessor), /accessor/);
    assert.throws(() => normalizeAnalystReviewStateStore(Object.create({ version: 1 })), /custom prototype/);
    const sparse: unknown[] = [];
    sparse.length = 2;
    assert.throws(
      () => normalizeAnalystReviewStateStore({ schema: ANALYST_REVIEW_STATE_SCHEMA, version: 1, records: sparse }),
      /sparse/,
    );
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    assert.throws(() => normalizeAnalystReviewStateStore(cyclic), /cycles/);
    assert.throws(
      () => setAnalystReviewDecision(emptyAnalystReviewStateStore(), item(), {
        disposition: 'expected', rationale: 'Missing expiry.', reviewedAt: NOW,
      }),
      /require an expiry/,
    );
    const current = setAnalystReviewDecision(emptyAnalystReviewStateStore(), item(), {
      disposition: 'open', rationale: 'Current review.', reviewedAt: NOW,
    });
    assert.throws(
      () => normalizeAnalystReviewStateStore({
        ...current,
        records: [{ ...current.records[0], reviewDueAt: NOW }],
      }),
      /reviewDueAt must be later than reviewedAt/,
    );
  });

  test('reopens the retired local development identity without accepting it as the public contract', () => {
    const development = {
      schema: ANALYST_REVIEW_STATE_SCHEMA,
      version: 1,
      records: [{
        subjectKey: 'review:case:0123456789abcdef',
        reviewedFingerprint: 'material:fedcba9876543210',
        evidenceFamily: 'case',
        disposition: 'resolved',
        rationale: 'Earlier local rationale.',
        reviewedAt: NOW,
        reviewDueAt: null,
        expiresAt: null,
        caseIds: ['case-one'],
        campaignIds: ['campaign-one'],
        history: [],
      }],
    };
    assert.throws(() => normalizeAnalystReviewStateStore(development), /missing or undeclared fields/);
    const migrated = migrateDevelopmentAnalystReviewStateStore(development);
    assert.match(migrated.records[0]?.subjectKey ?? '', /^review:case:[a-f0-9]{64}$/u);
    assert.equal(migrated.records[0]?.disposition, 'open');
    assert.equal(migrated.records[0]?.history[0]?.rationale, 'Earlier local rationale.');
    assert.deepEqual(migrated.records[0]?.caseIds, ['case-one']);
    assert.deepEqual(migrated.records[0]?.campaignIds, ['campaign-one']);
  });
});
