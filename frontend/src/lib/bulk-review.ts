import {
  BULK_REVIEW_SCHEMA,
  BULK_REVIEW_SCHEMA_VERSION,
  enforceBulkReviewBudget,
  removeBulkReviewPreset,
  setBulkReviewRowState,
  upsertBulkReviewPreset,
  type BulkReviewPresetView,
  type BulkReviewState,
  type BulkReviewStore,
} from './analysis/bulk-review-model.ts';
import { BULK_REVIEW_COLLECTION } from './browser-local-data-definitions.ts';
import { browserLocalDataProvider } from './browser-local-data-service.ts';

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
  return enforceBulkReviewBudget(await (await browserLocalDataProvider()).read(BULK_REVIEW_COLLECTION));
}

export async function saveBulkReviewPreset(input: {
  id?: string;
  name: string;
  view: BulkReviewPresetView;
}): Promise<BulkReviewStore> {
  return (await browserLocalDataProvider()).update(BULK_REVIEW_COLLECTION, (current) => {
    const store = upsertBulkReviewPreset(current, input);
    return { document: store, result: store };
  });
}

export async function deleteBulkReviewPreset(id: string): Promise<BulkReviewStore> {
  return (await browserLocalDataProvider()).update(BULK_REVIEW_COLLECTION, (current) => {
    const store = removeBulkReviewPreset(current, id);
    return { document: store, result: store };
  });
}

export async function saveBulkReviewRowState(domain: string, state: BulkReviewState): Promise<BulkReviewStore> {
  return (await browserLocalDataProvider()).update(BULK_REVIEW_COLLECTION, (current) => {
    const store = setBulkReviewRowState(current, domain, state);
    return { document: store, result: store };
  });
}

export const BULK_REVIEW_EXPORT_CONTRACT = Object.freeze({
  schema: BULK_REVIEW_SCHEMA,
  version: BULK_REVIEW_SCHEMA_VERSION,
});
