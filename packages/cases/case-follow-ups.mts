import type { CaseRecord } from './case-record-model.mts';
import { latestObservationCohort } from '../evidence/latest-observations.mts';

/** Active work and independent review cohorts; historical inclusion is an explicit read-only choice. */
export function caseFollowUpSources(record: CaseRecord, includeHistorical = false) {
  const reviews = latestObservationCohort(record.observedEffects.reviews, (review) => review.observedAt);
  return {
    actions: includeHistorical ? record.actions : record.actions.filter((action) => action.state !== 'terminal'),
    reviews: includeHistorical ? record.observedEffects.reviews : [...reviews.latest, ...reviews.undated],
  };
}
