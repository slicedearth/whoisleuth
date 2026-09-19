import type { CaseRecord } from './case-record-contracts.mts';
import { latestObservationCohort } from '../evidence/latest-observations.mts';
import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';
import { caseFollowUpSources } from './case-follow-ups.mts';

/** Read-only projection of bounded Case records. A link is not an inferred verdict. */
export function buildCaseDecisionOverview(record: CaseRecord, now: string) {
  const pins = new Map(record.evidencePins.map(pin => [pin.id, pin]));
  const references = (ids: readonly string[]) => [...new Set(ids)].map(id => ({ id, pin: pins.get(id) ?? null }));
  const conclusions = latestObservationCohort(record.decisions, decision => decision.createdAt);
  const latestEvidence = latestObservationCohort([
    ...record.evidencePins.map(pin => pin.createdAt),
    ...record.evidenceHistory.map(snapshot => snapshot.capturedAt),
    ...record.sightings.map(sighting => sighting.createdAt),
  ], value => value).observedAt;
  const claims = record.assertions.filter(assertion => assertion.state === 'open' && assertion.kind !== 'next_step').map(assertion => {
    const stances = new Map(assertion.evidenceRelations?.map(relation => [relation.evidencePinId, relation.stance]) ?? []);
    return { assertion, references: references([...assertion.evidencePinIds, ...stances.keys()]).map(reference => ({
      ...reference, stance: stances.get(reference.id) ?? null,
    })) };
  });
  const sources = caseFollowUpSources(record);
  const nowAt = normalizeExplicitIsoTimestamp(now);
  const reviews = [
    ...sources.actions.flatMap(action => [
      { id: `action:${action.id}:due`, kind: 'action' as const, at: action.dueAt, label: action.recipient },
      { id: `action:${action.id}:follow-up`, kind: 'follow_up' as const, at: action.followUpAt, label: action.recipient },
    ]),
    ...sources.reviews.map(review => ({ id: `effect:${review.id}`, kind: 'recheck' as const, at: review.followUpAt, label: review.source })),
  ].flatMap(review => {
    const at = normalizeExplicitIsoTimestamp(review.at);
    return at ? [{ ...review, at, due: nowAt === null ? null : Date.parse(at) <= Date.parse(nowAt) }] : [];
  }).sort((left, right) => Date.parse(left.at) - Date.parse(right.at) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return {
    claims,
    conclusions: [...conclusions.latest, ...conclusions.undated].map(decision => ({
      decision, references: references(decision.evidencePinIds),
      evidenceAddedLater: latestEvidence !== null && normalizeExplicitIsoTimestamp(decision.createdAt) !== null
        && Date.parse(latestEvidence) > Date.parse(decision.createdAt),
    })),
    earlierConclusions: conclusions.superseded,
    evidenceGaps: record.evidencePins.filter(pin => pin.completeness !== 'complete' || pin.truncated === true
      || !normalizeExplicitIsoTimestamp(pin.observedAt)
      || !['complete', 'success', 'reviewed', 'not_found'].includes(pin.sourceState ?? '')),
    reviews,
  };
}
