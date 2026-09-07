import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';
import { MAX_RESPONSE_AUTHORISATION_CLOCK_SKEW_MS, RESPONSE_ROUTE_STALE_AFTER_DAYS } from '../contracts/case-portability.mts';

/** Source freshness is independent of action deadlines and analyst follow-up. */
export function responseRouteFreshness(
  observedAt: string | null,
  reviewAfter: string | null,
  evaluatedAt: string,
): 'current' | 'stale' | 'unknown' {
  const observation = normalizeExplicitIsoTimestamp(observedAt);
  const evaluation = normalizeExplicitIsoTimestamp(evaluatedAt);
  const deadline = normalizeExplicitIsoTimestamp(reviewAfter);
  if (!observation || !evaluation || (reviewAfter !== null && !deadline)) return 'unknown';
  const age = Date.parse(evaluation) - Date.parse(observation);
  return age < -MAX_RESPONSE_AUTHORISATION_CLOCK_SKEW_MS
    || (deadline !== null && Date.parse(evaluation) >= Date.parse(deadline))
    || (deadline === null && age > RESPONSE_ROUTE_STALE_AFTER_DAYS * 86_400_000)
    ? 'stale'
    : 'current';
}
