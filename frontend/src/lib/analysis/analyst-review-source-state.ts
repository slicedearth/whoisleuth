import type { BrowserLocalCollectionId } from '../browser-local-data-definitions.ts';

export const ANALYST_REVIEW_REQUIRED_COLLECTION_IDS = Object.freeze([
  'cases',
  'watchlists',
  'bulk_sessions',
  'brand_profiles',
  'detection_rules',
  'website_snapshots',
  'analyst_review_state',
] as const satisfies readonly BrowserLocalCollectionId[]);

export type AnalystReviewSourceState = 'loading' | 'ready' | 'unavailable';

export function analystReviewRequiredSourceState(
  states: Readonly<Partial<Record<(typeof ANALYST_REVIEW_REQUIRED_COLLECTION_IDS)[number], AnalystReviewSourceState>>>,
): AnalystReviewSourceState {
  if (ANALYST_REVIEW_REQUIRED_COLLECTION_IDS.some((collection) => states[collection] === 'unavailable')) {
    return 'unavailable';
  }
  return ANALYST_REVIEW_REQUIRED_COLLECTION_IDS.every((collection) => states[collection] === 'ready')
    ? 'ready'
    : 'loading';
}
