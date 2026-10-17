import type { CaseRecord } from './case-record-contracts.mts';
import { latestObservationCohort } from '../evidence/latest-observations.mts';
import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';
import { caseFollowUpSources } from './case-follow-ups.mts';
import { casePinHasCompleteObservation } from './case-evidence-quality.mts';
import { caseIncidentObjects } from './case-object-coverage.mts';
import { caseRequestedEvidenceQueue } from './case-response-queue.mts';
import { caseAssertionEvidenceReferences, caseEvidenceReferenceResolver } from './case-evidence-references.mts';

/** Recording clocks only; an observation, edit or scheduled follow-up is not a review. */
export function latestRetainedCaseReview(record: Pick<CaseRecord, 'decisions' | 'observedEffects'>) {
  const cohort = latestObservationCohort([
    ...record.decisions.map(decision => decision.createdAt),
    ...record.observedEffects.reviews.map(review => review.createdAt),
  ], value => value);
  return {
    recordedAt: cohort.observedAt,
    tiedRecords: cohort.latest.length,
    undatedRecords: cohort.undated.length,
    historyLimited: record.observedEffects.omitted > 0 || record.observedEffects.preV13HistoryUnavailable,
  };
}

/** Read-only projection of bounded Case records. A link is not an inferred verdict. */
export function buildCaseDecisionOverview(record: CaseRecord, now: string) {
  const references = caseEvidenceReferenceResolver(record.evidencePins);
  const conclusions = latestObservationCohort(record.decisions, decision => decision.createdAt);
  const latestEvidence = latestObservationCohort([
    ...record.evidencePins.map(pin => pin.createdAt),
    ...record.evidenceHistory.map(snapshot => snapshot.capturedAt),
    ...record.sightings.map(sighting => sighting.createdAt),
  ], value => value).observedAt;
  const claims = record.assertions.filter(assertion => assertion.state === 'open' && assertion.kind !== 'next_step')
    .map(assertion => ({ assertion, references: caseAssertionEvidenceReferences(assertion, references) }));
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
    evidenceGaps: record.evidencePins.filter(pin => !casePinHasCompleteObservation(pin)
      || !normalizeExplicitIsoTimestamp(pin.observedAt)),
    reviews,
  };
}

/** Advisory only: recorded object state and remaining work do not decide closure. */
export function buildCaseCompletionReview(record: CaseRecord, now: string) {
  const overview = buildCaseDecisionOverview(record, now);
  const objects = caseIncidentObjects(record);
  return {
    openObjects: objects.filter(row => row.targetRetained && row.target.state === 'open'),
    otherObjects: objects.filter(row => !row.targetRetained),
    opposingClaims: overview.claims.map(claim => ({ ...claim,
      references: claim.references.filter(reference => reference.stance === 'contradicts' || reference.stance === 'unresolved'),
    })).filter(claim => claim.references.length),
    evidenceGaps: overview.evidenceGaps,
    reviews: overview.reviews,
    requests: caseRequestedEvidenceQueue(record, now).filter(item => item.editable && !item.deliveries.length),
  };
}

export type CaseCompletionReviewTarget = 'claims' | 'gaps' | 'requests' | 'reviews' | 'objects' | 'files';
type CaseCompletionAction = Readonly<{
  id: CaseCompletionReviewTarget; label: string; reason: string;
  expectedOutcome: string; prerequisite: string; limitation: string;
}>;

/** One local review per category; the complete checklist remains authoritative. */
export function caseCompletionNextActions(review: ReturnType<typeof buildCaseCompletionReview>, attachmentCount: number) {
  const actions: CaseCompletionAction[] = [];
  if (review.opposingClaims.length) actions.push({
    id: 'claims', label: 'Review contrary or unresolved evidence',
    reason: `${review.opposingClaims.length} open assessment${review.opposingClaims.length === 1 ? '' : 's'} with contrary or unresolved links.`,
    expectedOutcome: 'Compare the exact linked observations before deciding whether your explanation needs to change.',
    prerequisite: 'Read each retained source and its observation time; any assessment change needs an explicit save.',
    limitation: 'Disagreement does not establish which explanation is correct.',
  });
  if (review.evidenceGaps.length) actions.push({
    id: 'gaps', label: 'Review incomplete or undated observations',
    reason: `${review.evidenceGaps.length} retained observation${review.evidenceGaps.length === 1 ? '' : 's'} with missing scope, collection quality or time.`,
    expectedOutcome: 'Identify which conclusions need to remain qualified by the retained evidence.',
    prerequisite: 'Read the source details. Further collection, if appropriate, is a separate deliberate action.',
    limitation: 'A failed or partial observation is not evidence of absence.',
  });
  if (review.requests.length) actions.push({
    id: 'requests', label: 'Review undelivered evidence requests',
    reason: `${review.requests.length} current request branch${review.requests.length === 1 ? '' : 'es'} without recorded delivery.`,
    expectedOutcome: 'Check what was requested, prepared or unavailable and which exact branch still needs attention.',
    prerequisite: 'Inspect the retained request and any preparation before recording a response.',
    limitation: 'A request or prepared packet does not prove that evidence is obtainable or delivered.',
  });
  if (review.reviews.length) actions.push({
    id: 'reviews', label: 'Review follow-up commitments',
    reason: `${review.reviews.length} dated follow-up commitment${review.reviews.length === 1 ? '' : 's'} retained.`,
    expectedOutcome: 'Review due and upcoming commitments before pausing this investigation.',
    prerequisite: 'Check each action or independent recheck in its original context.',
    limitation: 'A scheduled date is not a completed review or observation of removal.',
  });
  if (review.openObjects.length || review.otherObjects.length) actions.push({
    id: 'objects', label: 'Review remaining incident scopes',
    reason: `${review.openObjects.length} analyst-open incident objects; ${review.otherObjects.length} other retained scopes.`,
    expectedOutcome: 'Check whether each exact object has an appropriate recorded disposition.',
    prerequisite: 'Review incident-link histories and distinguish domain-wide from individual-page evidence.',
    limitation: 'Whole-Case status does not settle every object or establish removal.',
  });
  if (attachmentCount > 0) actions.push({
    id: 'files', label: 'Review referenced file availability',
    reason: `${attachmentCount} retained file reference${attachmentCount === 1 ? '' : 's'}; current bytes are checked separately.`,
    expectedOutcome: 'Locate the explicit file check before depending on original or derived files for a handoff.',
    prerequisite: 'Choose Check referenced files to read and verify bytes in the current workspace.',
    limitation: 'A reference does not establish available bytes; a matching digest does not authenticate the source.',
  });
  return { actions: actions.slice(0, 3), further: actions.slice(3) };
}

/** Suggestions refer only to the selected assertion's retained links. */
export function caseQuestionNextActions(
  overview: ReturnType<typeof buildCaseDecisionOverview>,
  assertionId: string | undefined,
) {
  const claim = overview.claims.find(item => item.assertion.id === assertionId);
  const actions: Array<Readonly<{
    id: string; label: string; reason: string; expectedOutcome: string;
    prerequisite: string; limitation: string; section: 'evidence' | 'assessment';
  }>> = [];
  if (!claim) return { actions, further: actions };
  const missing = claim.references.filter(reference => !reference.pin).length;
  if (!claim.references.length || missing) actions.push({
    id: 'links', label: 'Review evidence links', section: 'assessment',
    reason: missing ? `${missing} linked evidence reference${missing === 1 ? ' is' : 's are'} unavailable.` : 'No evidence is linked to this assessment.',
    expectedOutcome: 'Identify which retained observations support this question and review missing references.',
    prerequisite: 'Select exact retained pins in the assessment; linking evidence is a deliberate save.',
    limitation: 'A missing reference does not establish that the observation never existed.',
  });
  if (claim.references.some(reference => reference.stance === 'contradicts' || reference.stance === 'unresolved')) actions.push({
    id: 'relationships', label: 'Compare opposing or unresolved evidence', section: 'assessment',
    reason: 'This assessment has contrary or unresolved evidence relationships.',
    expectedOutcome: 'Compare source scope and observation times before revising the explanation.',
    prerequisite: 'Read the linked observations and record your reasoning explicitly.',
    limitation: 'Disagreement alone does not establish which explanation is correct.',
  });
  const gapIds = new Set(overview.evidenceGaps.map(pin => pin.id));
  const gaps = claim.references.filter(reference => reference.pin && gapIds.has(reference.id)).length;
  if (gaps) actions.push({
    id: 'observations', label: 'Inspect observation gaps', section: 'evidence',
    reason: `${gaps} linked observation${gaps === 1 ? ' is' : 's are'} incomplete or undated.`,
    expectedOutcome: 'Identify the missing scope, source state or observation time for this question.',
    prerequisite: 'Inspect the retained source details. Any further collection requires its own explicit action.',
    limitation: 'Reviewing a gap cannot recover unretained evidence or turn a failed observation into absence.',
  });
  if (claim.references.some(reference => reference.pin && reference.stance === null)) actions.push({
    id: 'classification', label: 'Classify evidence relationships', section: 'assessment',
    reason: 'Some retained links have no supporting, contrary or unresolved relationship recorded.',
    expectedOutcome: 'Make the relationship between each observation and this assessment explicit.',
    prerequisite: 'Review each linked pin before deliberately saving its relationship.',
    limitation: 'An analyst-assigned relationship is reasoning, not an independent source observation.',
  });
  return { actions: actions.slice(0, 3), further: actions.slice(3) };
}
