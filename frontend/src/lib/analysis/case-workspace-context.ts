import type { CaseRecord } from './case-model.ts';
import { latestObservationCohort } from '../../../../packages/evidence/latest-observations.mts';
import { normalizeExplicitIsoTimestamp } from '../../../../packages/evidence/observation.mts';

export type CaseContextFollowUp = Readonly<{
  id: string;
  at: string;
  label: string;
}>;

/** Read-only context from one admitted Case; no collection or new retention. */
export function caseWorkspaceContext(record: CaseRecord) {
  const decisions = latestObservationCohort(record.decisions, (decision) => decision.createdAt);
  const reviews = latestObservationCohort(record.observedEffects.reviews, (review) => review.observedAt);
  const followUps: CaseContextFollowUp[] = [];
  function add(id: string, raw: string | null, label: string) {
    const at = normalizeExplicitIsoTimestamp(raw);
    if (at) followUps.push({ id, at, label });
  }
  for (const action of record.actions) {
    if (action.state === 'terminal') continue;
    add(`due:${action.id}`, action.dueAt, `Action due: ${action.recipient}`);
    if (action.followUpAt !== action.dueAt) add(`follow-up:${action.id}`, action.followUpAt, `Follow up: ${action.recipient}`);
  }
  for (const review of [...reviews.latest, ...reviews.undated]) {
    add(`effect:${review.id}`, review.followUpAt, 'Independent effect review');
  }
  followUps.sort((left, right) => Date.parse(left.at) - Date.parse(right.at) || left.id.localeCompare(right.id));
  return {
    hypotheses: record.assertions.filter((assertion) => assertion.kind === 'hypothesis' && assertion.state === 'open'),
    decisions: [...decisions.latest, ...decisions.undated],
    decisionTime: decisions.observedAt,
    undatedDecisions: decisions.undated.length,
    earlierDecisions: decisions.superseded,
    followUps,
  };
}
