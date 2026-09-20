import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { normalizeBulkResultColumns } from '../packages/workspace/bulk-columns.mts';

import {
  BULK_AGE_FILTERS,
  BULK_GROUP_OPTIONS,
  BULK_LIFECYCLE_FILTERS,
  BULK_MAIL_FILTERS,
  BULK_REVIEW_SCHEMA,
  BULK_REVIEW_SCHEMA_VERSION,
  BULK_SOURCE_FILTERS,
  buildBulkReviewExport,
  mergeBulkReviewStores,
  normalizeBulkReviewStore,
  setBulkReviewRowState,
  upsertBulkReviewPreset,
} from '../frontend/src/lib/analysis/bulk-review-model.ts';

const EARLIER = '2026-07-27T01:00:00.000Z';
const LATER = '2026-07-28T01:00:00.000Z';

function view() {
  return {
    primaryFilter: 'high_risk',
    mutationFilter: 'homoglyph',
    signalFilters: ['password', 'idn'],
    sourceFilter: 'limited',
    lifecycleFilter: 'registered',
    ageFilter: 'new_30',
    mailFilter: 'authenticated',
    registrarFilter: 'Example Registrar',
    caseDispositionFilter: 'unreviewed',
    reviewStateFilter: 'reviewing',
    groupBy: 'registrar',
    sortKey: 'risk',
    sortDirection: -1,
    columns: ['registration', 'risk', 'website', 'registrar', 'mutation', 'review', 'case'],
  };
}

describe('Bulk review model', () => {
  test('migrates public preferences without changing their filters or dropping column choices on round trip', async () => {
    const historical = JSON.parse(await readFile(new URL('./fixtures/workspace-lifecycle/portable-review-v1.json', import.meta.url), 'utf8'));
    historical.presets = [{ kind: 'preset', id: 'old', name: 'Earlier view', view: { ...view(), columns: undefined }, createdAt: EARLIER, updatedAt: EARLIER }];
    const migrated = mergeBulkReviewStores(null, historical).store;
    assert.equal(migrated.version, 2);
    assert.deepEqual(migrated.presets[0]?.view, view());
    const chosen = upsertBulkReviewPreset(migrated, { id: 'chosen', name: 'Evidence', view: { ...view(), columns: ['website', 'risk', 'risk', 'unsupported'] } }, LATER);
    assert.deepEqual(chosen.presets[0]?.view.columns, ['risk', 'website']);
    const exported = buildBulkReviewExport(chosen);
    assert.deepEqual(mergeBulkReviewStores(null, exported).store, exported);
    assert.deepEqual(normalizeBulkResultColumns([]), []);
    assert.deepEqual(normalizeBulkResultColumns(null), view().columns);
    assert.throws(() => normalizeBulkReviewStore({ ...exported, version: 3 }), /newer schema/);
    const privateInput = { ...view(), columns: ['risk'], targets: ['sensitive.example'], notes: 'private-review-note' };
    const saved = upsertBulkReviewPreset(null, { name: 'Minimal', view: privateInput }, EARLIER);
    assert.ok(!JSON.stringify(saved).includes('sensitive.example'));
    assert.ok(!JSON.stringify(saved).includes('private-review-note'));
  });
  test('normalizes saved views and domain review state without retaining scan results', () => {
    let store = upsertBulkReviewPreset(null, { id: 'priority-view', name: ' Priority review ', view: view() }, EARLIER);
    store = setBulkReviewRowState(store, 'EXAMPLE.INVALID.', 'reviewing', LATER);

    assert.equal(store.schema, BULK_REVIEW_SCHEMA);
    assert.equal(store.version, BULK_REVIEW_SCHEMA_VERSION);
    assert.equal(store.presets[0]?.name, 'Priority review');
    assert.deepEqual(store.presets[0]?.view.signalFilters, ['password', 'idn']);
    assert.deepEqual(store.rows.map((row) => ({ domain: row.domain, state: row.state })), [
      { domain: 'example.invalid', state: 'reviewing' },
    ]);
    assert.equal(JSON.stringify(store).includes('results'), false);
  });

  test('round-trips every current advanced filter and presentation option', () => {
    const current = {
      ...view(),
      sourceFilter: 'unrecorded',
      lifecycleFilter: 'registered',
      ageFilter: 'new_30',
      mailFilter: 'authenticated',
      groupBy: 'tld',
      sortKey: 'confidence',
    };
    const stored = upsertBulkReviewPreset(null, { id: 'current-view', name: 'Current controls', view: current }, EARLIER);
    assert.deepEqual(stored.presets[0]?.view, current);
    for (const [field, values] of [
      ['sourceFilter', BULK_SOURCE_FILTERS],
      ['lifecycleFilter', BULK_LIFECYCLE_FILTERS],
      ['ageFilter', BULK_AGE_FILTERS],
      ['mailFilter', BULK_MAIL_FILTERS],
      ['groupBy', BULK_GROUP_OPTIONS],
    ] as const) {
      for (const value of values) {
        const candidate = upsertBulkReviewPreset(null, { name: `${field}-${value || 'all'}`, view: { ...view(), [field]: value } }, EARLIER);
        assert.equal(candidate.presets[0]?.view[field], value, `${field}:${value}`);
      }
    }
  });

  test('uses unreviewed as the implicit state and removes an unnecessary row record', () => {
    const reviewing = setBulkReviewRowState(null, 'example.invalid', 'reviewing', EARLIER);
    const unreviewed = setBulkReviewRowState(reviewing, 'example.invalid', 'unreviewed', LATER);
    assert.deepEqual(unreviewed.rows, []);
  });

  test('rejects invalid states and strips invalid imported controls', () => {
    assert.throws(() => setBulkReviewRowState(null, 'example.invalid', 'unsafe'), /valid domain review state/);
    const normalized = normalizeBulkReviewStore({
      presets: [{
        kind: 'preset',
        id: 'view',
        name: 'Review',
        view: {
          ...view(),
          signalFilters: ['password', 'not-supported'],
          sortKey: 'arbitrary',
          sortDirection: 99,
        },
      }],
      rows: [{ kind: 'row', domain: 'example.invalid', state: 'arbitrary' }],
    });
    assert.deepEqual(normalized.presets[0]?.view.signalFilters, ['password']);
    assert.equal(normalized.presets[0]?.view.sortKey, 'risk');
    assert.equal(normalized.presets[0]?.view.sortDirection, -1);
    assert.equal(normalized.rows[0]?.state, 'unreviewed');
  });

  test('remaps a legacy Opportunity preset to Risk while preserving its direction through export and merge', () => {
    const legacy = normalizeBulkReviewStore({
      presets: [{
        kind: 'preset', id: 'legacy-opportunity', name: 'Legacy review',
        view: { ...view(), sortKey: 'opportunity', sortDirection: 1 },
        createdAt: EARLIER, updatedAt: LATER,
      }],
    });
    assert.equal(legacy.presets[0]?.view.sortKey, 'risk');
    assert.equal(legacy.presets[0]?.view.sortDirection, 1);
    const exported = buildBulkReviewExport(legacy);
    assert.equal(exported.schema, BULK_REVIEW_SCHEMA);
    assert.equal(exported.version, BULK_REVIEW_SCHEMA_VERSION);
    assert.equal(exported.presets[0]?.view.sortKey, 'risk');
    assert.equal(exported.presets[0]?.view.sortDirection, 1);
    const merged = mergeBulkReviewStores(null, exported).store;
    assert.equal(merged.presets[0]?.view.sortKey, 'risk');
    assert.equal(merged.presets[0]?.view.sortDirection, 1);
  });

  test('merges portable review records by identity and newer observation time', () => {
    const local = {
      schema: BULK_REVIEW_SCHEMA,
      version: BULK_REVIEW_SCHEMA_VERSION,
      presets: [{
        kind: 'preset', id: 'view', name: 'Earlier', view: view(), createdAt: EARLIER, updatedAt: EARLIER,
      }],
      rows: [{
        kind: 'row', id: 'domain-example.invalid', domain: 'example.invalid', state: 'reviewing', updatedAt: EARLIER,
      }],
    };
    const imported = buildBulkReviewExport({
      presets: [
        { kind: 'preset', id: 'view', name: 'Later', view: view(), createdAt: EARLIER, updatedAt: LATER },
        { kind: 'preset', id: 'new-view', name: 'New', view: view(), createdAt: LATER, updatedAt: LATER },
      ],
      rows: [
        { kind: 'row', domain: 'example.invalid', state: 'reviewed', updatedAt: LATER },
        { kind: 'row', domain: 'second.invalid', state: 'deferred', updatedAt: LATER },
      ],
    });
    const result = mergeBulkReviewStores(local, imported);

    assert.deepEqual({ added: result.added, updated: result.updated, skipped: result.skipped }, {
      added: 2,
      updated: 2,
      skipped: 0,
    });
    assert.equal(result.store.presets.find((item) => item.id === 'view')?.name, 'Later');
    assert.equal(result.store.rows.find((item) => item.domain === 'example.invalid')?.state, 'reviewed');
    assert.throws(
      () => mergeBulkReviewStores(local, { ...imported, version: BULK_REVIEW_SCHEMA_VERSION + 1 }),
      /newer schema/,
    );
  });
});
