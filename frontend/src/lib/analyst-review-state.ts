import {
  analystReviewLifecycle,
  emptyAnalystReviewStateStore,
  setAnalystReviewDecision,
  type AnalystReviewDisposition,
  type AnalystReviewItem,
  type AnalystReviewLifecycle,
  type AnalystReviewStateStore,
} from './analysis/analyst-review-state.ts';
import { readBrowserLocalData, updateBrowserLocalData } from './browser-local-data-service.ts';

export async function loadAnalystReviewState(): Promise<AnalystReviewStateStore> {
  return readBrowserLocalData('analyst_review_state');
}

export async function saveAnalystReviewDecision(
  item: AnalystReviewItem,
  input: Readonly<{
    disposition: AnalystReviewDisposition;
    rationale: string;
    expiresAt?: string | null;
    reviewDueAt?: string | null;
    reviewedAt?: string;
  }>,
): Promise<AnalystReviewStateStore> {
  return updateBrowserLocalData('analyst_review_state', (current) => {
    const document = setAnalystReviewDecision(current, item, input);
    return { document, result: document };
  });
}

export function projectAnalystReviewLifecycle(
  item: AnalystReviewItem,
  store: AnalystReviewStateStore = emptyAnalystReviewStateStore(),
  now = new Date().toISOString(),
): AnalystReviewLifecycle {
  return analystReviewLifecycle(item, store, now);
}
