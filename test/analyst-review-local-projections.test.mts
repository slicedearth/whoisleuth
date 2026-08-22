import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildLocalAnalystReviewProjection } from '../frontend/src/lib/analysis/analyst-review-local-projections.ts';
import { normalizeBrandProfile } from '../frontend/src/lib/analysis/brand-profile-model.ts';
import { requiredValue } from './value-assertions.mts';

const NOW = '2026-08-23T04:00:00.000Z';
const WINDOWS = Object.freeze({
  first: Object.freeze({ id: 'change-window-first', startsAt: '2026-08-23T03:00:00.000Z', endsAt: '2026-08-23T05:00:00.000Z', summary: 'Reviewed DNS maintenance' }),
  second: Object.freeze({ id: 'change-window-second', startsAt: '2026-08-24T03:00:00.000Z', endsAt: '2026-08-24T05:00:00.000Z', summary: 'Reviewed mail maintenance' }),
  inserted: Object.freeze({ id: 'change-window-inserted', startsAt: '2026-08-22T03:00:00.000Z', endsAt: '2026-08-22T05:00:00.000Z', summary: 'Reviewed unrelated maintenance' }),
});

function profile(options: Readonly<{
  reason?: string;
  windows?: readonly Readonly<{ id: string; startsAt: string; endsAt: string; summary: string }>[];
  baselineUpdatedAt?: string;
  note?: string;
}> = {}) {
  return requiredValue(normalizeBrandProfile({
    id: 'projection-profile',
    name: 'Projection profile',
    officialDomains: ['projection.example'],
    desiredPostureBaselines: [{
      domain: 'projection.example',
      approvedChangeWindows: options.windows ?? [WINDOWS.first, WINDOWS.second],
      suppressions: [{
        field: 'nameservers',
        reason: options.reason ?? 'Reviewed maintenance exception',
        expiresAt: '2026-08-23T03:30:00.000Z',
      }],
      note: options.note ?? '',
      updatedAt: options.baselineUpdatedAt ?? '2026-08-22T04:00:00.000Z',
    }],
    createdAt: NOW,
    updatedAt: NOW,
  }));
}

function windowItems(value: ReturnType<typeof profile>) {
  return buildLocalAnalystReviewProjection({ profiles: [value] }, NOW).items
    .filter((item) => item.kind === 'change_window');
}

function itemByTitlePart(items: ReturnType<typeof windowItems>, summary: string) {
  return requiredValue(items.find((item) => item.detail.startsWith(summary)));
}

describe('local analyst Review Item projections', () => {
  test('projects structured change windows and suppressions with explicit due state', () => {
    const projection = buildLocalAnalystReviewProjection({ profiles: [profile()] }, NOW);
    const window = requiredValue(projection.items.find((item) => item.kind === 'change_window'));
    const suppression = requiredValue(projection.items.find((item) => item.kind === 'suppression'));
    assert.equal(window.dueAt, '2026-08-23T03:00:00.000Z');
    assert.equal(suppression.dueAt, '2026-08-23T03:30:00.000Z');
    assert.equal(suppression.completeness, 'complete');
    assert.match(suppression.detail, /changes only analyst triage/iu);
  });

  test('keeps suppression subject identity stable while reviewed material changes', () => {
    const first = requiredValue(buildLocalAnalystReviewProjection({ profiles: [profile({ reason: 'First rationale' })] }, NOW)
      .items.find((item) => item.kind === 'suppression'));
    const changed = requiredValue(buildLocalAnalystReviewProjection({ profiles: [profile({ reason: 'Changed rationale' })] }, NOW)
      .items.find((item) => item.kind === 'suppression'));
    assert.equal(changed.subjectKey, first.subjectKey);
    assert.notEqual(changed.materialFingerprint, first.materialFingerprint);
  });

  test('preserves every unaffected window identity through insertion, deletion and reorder', () => {
    const initial = windowItems(profile());
    const inserted = windowItems(profile({ windows: [WINDOWS.inserted, WINDOWS.first, WINDOWS.second] }));
    const deleted = windowItems(profile({ windows: [WINDOWS.second, WINDOWS.first] }));
    const reordered = windowItems(profile({ windows: [WINDOWS.second, WINDOWS.first] }));
    for (const [summary, expected] of [
      [WINDOWS.first.summary, itemByTitlePart(initial, WINDOWS.first.summary)],
      [WINDOWS.second.summary, itemByTitlePart(initial, WINDOWS.second.summary)],
    ] as const) {
      for (const projection of [inserted, deleted, reordered]) {
        const retained = itemByTitlePart(projection, summary);
        assert.equal(retained.subjectKey, expected.subjectKey);
        assert.equal(retained.materialFingerprint, expected.materialFingerprint);
      }
    }
    assert.notEqual(
      itemByTitlePart(inserted, WINDOWS.inserted.summary).subjectKey,
      itemByTitlePart(inserted, WINDOWS.first.summary).subjectKey,
    );
  });

  test('does not reopen windows or suppressions after an unrelated baseline edit', () => {
    const initial = buildLocalAnalystReviewProjection({ profiles: [profile()] }, NOW).items;
    const edited = buildLocalAnalystReviewProjection({
      profiles: [profile({ baselineUpdatedAt: '2026-08-23T03:59:00.000Z', note: 'Unrelated baseline note.' })],
    }, NOW).items;
    for (const kind of ['change_window', 'suppression'] as const) {
      const expected = initial.filter((item) => item.kind === kind);
      const actual = edited.filter((item) => item.kind === kind);
      assert.deepEqual(actual.map((item) => [item.subjectKey, item.materialFingerprint]).sort(), expected.map((item) => [item.subjectKey, item.materialFingerprint]).sort());
    }
  });

  test('reopens only the materially edited logical row while retaining its durable subject', () => {
    const initial = windowItems(profile());
    const editedFirst = { ...WINDOWS.first, summary: 'Reviewed DNS and DS maintenance' };
    const edited = windowItems(profile({ windows: [editedFirst, WINDOWS.second] }));
    const beforeFirst = itemByTitlePart(initial, WINDOWS.first.summary);
    const afterFirst = itemByTitlePart(edited, editedFirst.summary);
    const beforeSecond = itemByTitlePart(initial, WINDOWS.second.summary);
    const afterSecond = itemByTitlePart(edited, WINDOWS.second.summary);
    assert.equal(afterFirst.subjectKey, beforeFirst.subjectKey);
    assert.notEqual(afterFirst.materialFingerprint, beforeFirst.materialFingerprint);
    assert.equal(afterSecond.subjectKey, beforeSecond.subjectKey);
    assert.equal(afterSecond.materialFingerprint, beforeSecond.materialFingerprint);
  });
});
