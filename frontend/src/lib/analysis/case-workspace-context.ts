import type { CaseRecord } from './case-model.ts';
import { latestObservationCohort } from '../../../../packages/evidence/latest-observations.mts';
import { normalizeExplicitIsoTimestamp } from '../../../../packages/evidence/observation.mts';
import { caseFollowUpSources } from '../../../../packages/cases/case-follow-ups.mts';

export type CaseContextFollowUp = Readonly<{
  id: string;
  at: string;
  label: string;
}>;

/** Read-only context from one admitted Case; no collection or new retention. */
export function caseWorkspaceContext(record: CaseRecord) {
  const decisions = latestObservationCohort(record.decisions, (decision) => decision.createdAt);
  const followUpSources = caseFollowUpSources(record);
  const followUps: CaseContextFollowUp[] = [];
  function add(id: string, raw: string | null, label: string) {
    const at = normalizeExplicitIsoTimestamp(raw);
    if (at) followUps.push({ id, at, label });
  }
  for (const action of followUpSources.actions) {
    add(`due:${action.id}`, action.dueAt, `Action due: ${action.recipient}`);
    if (action.followUpAt !== action.dueAt) add(`follow-up:${action.id}`, action.followUpAt, `Follow up: ${action.recipient}`);
  }
  for (const review of followUpSources.reviews) {
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
