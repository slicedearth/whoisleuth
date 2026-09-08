import { normalizeExplicitIsoTimestamp } from '../../../../packages/evidence/observation.mts';

/** Retain a source's timestamp; missing, invalid or future times have no usable age. */
export function readLookupObservationTime(value: unknown, now: unknown): Readonly<{
  observedAt: string | null;
  ageDays: number | null;
}> {
  const observedAt = normalizeExplicitIsoTimestamp(value);
  const reviewedAt = normalizeExplicitIsoTimestamp(now);
  const elapsed = observedAt && reviewedAt
    ? Date.parse(reviewedAt) - Date.parse(observedAt)
    : Number.NaN;
  return {
    observedAt,
    ageDays: Number.isFinite(elapsed) && elapsed >= 0 ? Math.floor(elapsed / 86_400_000) : null,
  };
}
