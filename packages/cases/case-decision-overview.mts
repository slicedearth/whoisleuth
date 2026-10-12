import type { CaseRecord } from './case-record-contracts.mts';
import { latestObservationCohort } from '../evidence/latest-observations.mts';
import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';
import { caseFollowUpSources } from './case-follow-ups.mts';
import { casePinHasCompleteObservation } from './case-evidence-quality.mts';
import { caseIncidentObjects } from './case-object-coverage.mts';
import { caseRequestedEvidenceQueue } from './case-response-queue.mts';
import { caseAssertionEvidenceReferences, caseEvidenceReferenceResolver } from './case-evidence-references.mts';

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
    reviews: overview.reviews,
    requests: caseRequestedEvidenceQueue(record, now).filter(item => item.editable && !item.deliveries.length),
  };
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
