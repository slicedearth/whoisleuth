import {
  BULK_REVIEW_SCHEMA,
  BULK_REVIEW_SCHEMA_VERSION,
  enforceBulkReviewBudget,
  removeBulkReviewPreset,
  setBulkReviewRowState,
  upsertBulkReviewPreset,
  type BulkReviewPresetView,
  type BulkReviewState,
  type BulkReviewRow,
  type BulkReviewStore,
} from './analysis/bulk-review-model.ts';
import { readBrowserLocalData, updateBrowserLocalData } from './browser-local-data-service.ts';
import { assertAnalystUndoCurrent } from './analysis/analyst-undo.ts';
import { normalizeDomain } from './analysis/case-model.ts';

export type {
  BulkReviewFilter,
  BulkReviewPreset,
  BulkReviewPresetView,
  BulkReviewRow,
  BulkReviewState,
  BulkReviewStore,
} from './analysis/bulk-review-model.ts';
export { BULK_REVIEW_STATES } from './analysis/bulk-review-model.ts';

export async function loadBulkReviewStore(): Promise<BulkReviewStore> {
  return enforceBulkReviewBudget(await readBrowserLocalData('bulk_review'));
}

export async function saveBulkReviewPreset(input: {
  id?: string;
  name: string;
  view: BulkReviewPresetView;
}): Promise<BulkReviewStore> {
  return updateBrowserLocalData('bulk_review', (current) => {
    const store = upsertBulkReviewPreset(current, input);
    return { document: store, result: store };
  });
}

export async function deleteBulkReviewPreset(id: string): Promise<BulkReviewStore> {
  return updateBrowserLocalData('bulk_review', (current) => {
    const store = removeBulkReviewPreset(current, id);
    return { document: store, result: store };
  });
}

export async function saveBulkReviewRowState(domain: string, state: BulkReviewState): Promise<BulkReviewStore> {
  return (await changeBulkReviewRowState(domain, state)).store;
}

export async function changeBulkReviewRowState(domain: string, state: BulkReviewState) {
  const target = normalizeDomain(domain);
  return updateBrowserLocalData('bulk_review', (current) => {
    const previous = current.rows.find((row) => row.domain === target) ?? null;
    const store = setBulkReviewRowState(current, target, state);
    const expectedCount = current.rows.length + (state === 'unreviewed' ? (previous ? -1 : 0) : (previous ? 0 : 1));
    if (store.rows.length !== expectedCount || store.presets.length !== current.presets.length) {
      throw new Error('Saved review storage is full. Clear an older row review state before adding this one. Existing saved work was preserved.');
    }
    const undo = {
      domain: target,
      previous: structuredClone(previous),
      expected: structuredClone(store.rows.find((row) => row.domain === target) ?? null),
    };
    return { document: store, result: { store, undo } };
  });
}

export async function restoreBulkReviewRow(undo: Readonly<{ domain: string; previous: BulkReviewRow | null; expected: BulkReviewRow | null }>): Promise<BulkReviewStore> {
  return updateBrowserLocalData('bulk_review', (current) => {
    assertAnalystUndoCurrent(current.rows.find((row) => row.domain === undo.domain) ?? null, undo.expected);
    const remaining = current.rows.filter((row) => row.domain !== undo.domain);
    const rows = undo.previous ? [undo.previous, ...remaining] : remaining;
    const store = enforceBulkReviewBudget({ ...current, rows });
    if (store.rows.length !== rows.length || store.presets.length !== current.presets.length) {
      throw new Error('Undo would exceed saved review storage. Current saved work was preserved.');
    }
    return { document: store, result: store };
  });
}

export const BULK_REVIEW_EXPORT_CONTRACT = Object.freeze({
  schema: BULK_REVIEW_SCHEMA,
  version: BULK_REVIEW_SCHEMA_VERSION,
});
