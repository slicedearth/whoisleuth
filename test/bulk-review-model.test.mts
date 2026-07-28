import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  BULK_REVIEW_SCHEMA,
  BULK_REVIEW_SCHEMA_VERSION,
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
    lifecycleFilter: 'new',
    ageFilter: '30d',
    mailFilter: 'dmarc_missing',
    registrarFilter: 'Example Registrar',
    caseDispositionFilter: 'unreviewed',
    reviewStateFilter: 'reviewing',
    groupBy: 'registrar',
    sortKey: 'risk',
    sortDirection: -1,
  };
}

describe('Bulk review model', () => {
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
