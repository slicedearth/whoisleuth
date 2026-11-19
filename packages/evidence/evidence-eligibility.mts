// Whether a retained value can serve as evidence for a comparison or
// inference, as distinct from whether it can be shown. A value from a failed,
// partial or unknown collection, or with contradictory dates, stays visible
// with its source state but never decides a change, an absence or an earlier
// observation. Lookup replay, key-fact inferences, prior-registration review,
// Bulk and the CLI use these rules so each surface qualifies evidence alike.

import { webCollectionAllowsComparison, type WebCollectionQuality } from './collection-quality.mts';

export type EvidenceIneligibleReason =
  | 'source_failed'
  | 'source_incomplete'
  | 'source_state_unknown'
  | 'collection_incomplete'
  | 'collection_unknown'
  | 'chronology_contradictory'
  | 'value_unusable';

export type EvidenceEligibility = Readonly<{ eligible: true; reason: null } | { eligible: false; reason: EvidenceIneligibleReason }>;

/** Short explanations shared by browser and CLI output. */
export const EVIDENCE_INELIGIBLE_LABELS: Readonly<Record<EvidenceIneligibleReason, string>> = Object.freeze({
  source_failed: 'the source failed',
  source_incomplete: 'the source was incomplete',
  source_state_unknown: 'the source state was not recorded as complete',
  collection_incomplete: 'the collection was incomplete',
  collection_unknown: 'the collection was not recorded as complete',
  chronology_contradictory: 'its first observation is later than its last',
  value_unusable: 'the value is not a usable date',
});

const ELIGIBLE: EvidenceEligibility = Object.freeze({ eligible: true, reason: null });
const ineligible = (reason: EvidenceIneligibleReason): EvidenceEligibility => Object.freeze({ eligible: false, reason });

const COMPLETE_STATES = new Set(['success', 'complete', 'provided']);
const INCOMPLETE_STATES = new Set(['partial', 'incomplete', 'truncated']);

function canonicalState(state: unknown): string {
  return typeof state === 'string' ? state.trim().toLowerCase().replace(/[\s-]+/gu, '_') : '';
}

/**
 * A source qualifies when it reports success. `requireExplicitComplete`
 * additionally demands `complete: true`, for sources whose fallback values
 * look like observations (page cues); otherwise only `complete: false` disqualifies.
 */
export function sourceEligibility(
  source: Readonly<{ state: unknown; complete: boolean | null | undefined }> | null | undefined,
  options: Readonly<{ requireExplicitComplete?: boolean }> = {},
): EvidenceEligibility {
  if (!source) return ineligible('source_state_unknown');
  const state = canonicalState(source.state);
  if (INCOMPLETE_STATES.has(state) || (COMPLETE_STATES.has(state) && source.complete === false)) return ineligible('source_incomplete');
  if (!COMPLETE_STATES.has(state)) {
    return state === '' || state === 'unknown' || state === 'reported' ? ineligible('source_state_unknown') : ineligible('source_failed');
  }
  if (options.requireExplicitComplete && source.complete !== true) return ineligible('source_state_unknown');
  return ELIGIBLE;
}

/**
 * A page-derived field qualifies from retained web collection quality when it
 * exists; an export without it qualifies only from an explicitly complete page
 * identity source.
 */
export function pageFieldEligibility(
  field: string,
  quality: WebCollectionQuality | null | undefined,
  pageSource: Readonly<{ state: unknown; complete: boolean | null | undefined }> | null | undefined,
): EvidenceEligibility {
  if (quality) {
    if (webCollectionAllowsComparison(field, quality, 'deep')) return ELIGIBLE;
    return quality.page === 'unknown' ? ineligible('collection_unknown') : ineligible('collection_incomplete');
  }
  const source = sourceEligibility(pageSource, { requireExplicitComplete: true });
  return source.eligible ? ELIGIBLE : ineligible(source.reason === 'source_failed' ? 'collection_incomplete' : 'collection_unknown');
}

/** A certificate observation's earliest date is usable only when its first and last dates agree in order. */
export function certificateChronologyEligibility(
  provenance: Readonly<{ firstObservedAt: string | null; chronologyContradicted?: boolean }> | null | undefined,
): EvidenceEligibility {
  if (!provenance?.firstObservedAt) return ineligible('value_unusable');
  return provenance.chronologyContradicted ? ineligible('chronology_contradictory') : ELIGIBLE;
}
