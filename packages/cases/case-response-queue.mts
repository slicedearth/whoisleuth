import type { CaseRecord } from './case-record-contracts.mts';
import { caseRecheckQuestions } from './case-recheck-model.mts';
import { latestObservationCohort } from '../evidence/latest-observations.mts';
import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';
import { responseRouteFreshness } from './response-route-freshness.mts';

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
    independentReviews: latestObservationCohort(record.observedEffects.reviews, review => review.observedAt),
  };
}
