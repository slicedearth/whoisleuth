import type { CaseRecord } from './case-record-contracts.mts';
import { caseRecheckQuestions } from './case-recheck-model.mts';
import { latestObservationCohort } from '../evidence/latest-observations.mts';
import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';
import { responseRouteFreshness } from './response-route-freshness.mts';
import { evidenceRequestDelivery, latestEvidenceRequests } from './case-requested-evidence.mts';

/** Provider deadlines and preparation states are not delivery or resolution. */
export function caseRequestedEvidenceQueue(record: CaseRecord, now: string) {
  const clock = normalizeExplicitIsoTimestamp(now);
  return record.actions.flatMap(action => {
    const requests = latestEvidenceRequests(action);
    return requests.map(event => {
      const request = event.evidenceRequest;
      const deliveries = evidenceRequestDelivery(record.actions, action.id, event.id);
      const deadline = normalizeExplicitIsoTimestamp(request.dueAt);
      const concurrent = requests.filter(other => other.evidenceRequest.id === request.id).length > 1;
      const editable = ['submitted', 'acknowledged'].includes(action.state);
      return { actionId: action.id, recipient: action.recipient, eventId: event.id, request,
        deliveries, concurrent, editable, deadline,
        due: deadline && clock ? Date.parse(deadline) <= Date.parse(clock) : null,
        label: deliveries.length ? 'Delivery recorded' : concurrent ? 'Concurrent preparations need review'
          : request.state === 'prepared' ? 'Prepared; delivery not recorded'
          : request.state === 'unavailable' ? 'Cannot provide; response needs review' : 'Evidence requested',
      };
    });
  }).sort((left, right) => Number(Boolean(left.deliveries.length) || !left.editable) - Number(Boolean(right.deliveries.length) || !right.editable)
    || (left.deadline === null ? right.deadline === null ? 0 : 1 : right.deadline === null ? -1 : Date.parse(left.deadline) - Date.parse(right.deadline))
    || left.actionId.localeCompare(right.actionId) || left.eventId.localeCompare(right.eventId));
}

/** View-only work ordering. Provider replies never supply independent observations. */
export function caseResponseQueue(record: CaseRecord, now: string) {
  const nowAt = normalizeExplicitIsoTimestamp(now);
  function schedule(value: unknown) {
    const at = normalizeExplicitIsoTimestamp(value);
    return { at, due: at && nowAt ? Date.parse(at) <= Date.parse(nowAt) : null };
  }
  const actions = record.actions.map(action => {
    const due = schedule(action.dueAt), followUp = schedule(action.followUpAt);
    const nextAt = [due.at, followUp.at].filter((at): at is string => at !== null).sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
    return { action, due, followUp, nextAt,
      routeFreshness: responseRouteFreshness(action.routeObservedAt, action.routeReviewAfter, now),
      latestEvent: latestObservationCohort(action.history.filter(event => event.applied), event => event.occurredAt),
    };
  }).sort((left, right) => Number(left.action.state === 'terminal') - Number(right.action.state === 'terminal')
    || (left.nextAt === null ? right.nextAt === null ? 0 : 1 : right.nextAt === null ? -1 : Date.parse(left.nextAt) - Date.parse(right.nextAt))
    || (left.action.id < right.action.id ? -1 : left.action.id > right.action.id ? 1 : 0));
  const questions = caseRecheckQuestions(record.assertions).map(question => {
    const answers = record.observedEffects.reviews.filter(review => review.recheck?.questionId === question.id);
    return { question, answers, latest: latestObservationCohort(answers, answer => answer.observedAt) };
  });
  return {
    actions, questions,
    requestedEvidence: caseRequestedEvidenceQueue(record, now),
    independentReviews: latestObservationCohort(record.observedEffects.reviews, review => review.observedAt),
  };
}
