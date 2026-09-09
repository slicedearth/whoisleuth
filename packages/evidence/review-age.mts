import { normalizeExplicitIsoTimestamp } from './observation.mts';
import type { AnalystReviewAge } from '../contracts/analyst-review-state-contract.mts';

export const ANALYST_REVIEW_AGING_AFTER_DAYS = 7;
export const ANALYST_REVIEW_STALE_AFTER_DAYS = 30;

export function analystReviewAgeAt(observedAt: unknown, now: unknown): AnalystReviewAge {
  const observed = normalizeExplicitIsoTimestamp(observedAt);
  const reviewed = normalizeExplicitIsoTimestamp(now);
  if (!observed || !reviewed) return 'unknown';
  const age = Date.parse(reviewed) - Date.parse(observed);
  if (age < 0) return 'unknown';
  const days = age / 86_400_000;
  return days > ANALYST_REVIEW_STALE_AFTER_DAYS ? 'stale' : days > ANALYST_REVIEW_AGING_AFTER_DAYS ? 'aging' : 'current';
}
