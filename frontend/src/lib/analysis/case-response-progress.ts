import type { CaseRecord } from './case-model.ts';
import {
  buildCaseActionOutcomeSummary,
  caseActionCompletesResponseDecision,
  countEvidenceLinkedCaseDecisions,
} from '../../../../packages/cases/case-response-model.mts';
import { CASE_RESPONSE_STAGE_DEFINITIONS, type CaseResponseStage } from './case-response-stage.ts';

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Read-only progress; packet review and the save coordinator retain their own state. */
export function buildCaseResponseProgress(
  record: CaseRecord,
  evidenceHandoffStage: CaseResponseStage,
  reviewNow: string,
) {
  const evidenceLinkedDecisionCount = countEvidenceLinkedCaseDecisions(record.decisions, record.evidencePins);
  const actionSummary = buildCaseActionOutcomeSummary(record.actions, reviewNow);
  const stages: CaseResponseStage[] = [
    {
      id: 'observation', ...CASE_RESPONSE_STAGE_DEFINITIONS.observation,
      status: record.evidencePins.length || record.sightings.length ? 'complete' : 'not_started',
      summary: `${countLabel(record.evidencePins.length, 'retained evidence pin')} and ${countLabel(record.sightings.length, 'source-qualified sighting')}.`,
      nextRequirement: record.evidencePins.length || record.sightings.length
        ? 'Review the retained observation, its source, completeness, and limitations before assessment.'
        : 'Pin an observed fact or record a source-qualified sighting with completeness and limitations.',
    },
    {
      id: 'assessment', ...CASE_RESPONSE_STAGE_DEFINITIONS.assessment,
      status: evidenceLinkedDecisionCount ? 'complete' : record.decisions.length || record.assertions.length || record.manualTrail.length ? 'in_progress' : 'not_started',
      summary: `${countLabel(record.decisions.length, 'decision')} (${evidenceLinkedDecisionCount} linked to retained evidence), ${countLabel(record.assertions.length, 'optional assertion')}, and ${countLabel(record.branches?.length ?? 0, 'investigation branch', 'investigation branches')}.`,
      nextRequirement: !record.decisions.length
        ? 'Record a bounded analyst decision and rationale linked to retained evidence.'
        : !evidenceLinkedDecisionCount
          ? 'Link at least one analyst decision to a retained evidence pin.'
          : 'Review the decision rationale and any unresolved assertions or branches.',
    },
    {
      id: 'response_decision', ...CASE_RESPONSE_STAGE_DEFINITIONS.response_decision,
      status: record.actions.some((action) => caseActionCompletesResponseDecision(action.state)) ? 'complete' : record.actions.length ? 'in_progress' : 'not_started',
      summary: `${countLabel(record.actions.length, 'append-only response action')}; ${actionSummary.overdue} overdue and ${actionSummary.followUpDue} follow-up due.`,
      nextRequirement: !record.actions.length ? 'Create a drafting action with recipient provenance and due dates.' : 'Review the next legal action transition without rewriting earlier events.',
    },
    evidenceHandoffStage,
    {
      id: 'outcome_tracking', ...CASE_RESPONSE_STAGE_DEFINITIONS.outcome_tracking,
      status: record.closures.records.length ? 'complete' : record.observedEffects.reviews.length || record.actions.some((action) => ['submitted', 'acknowledged', 'terminal'].includes(action.state)) ? 'in_progress' : 'not_started',
      summary: `${countLabel(record.observedEffects.reviews.length, 'independent effect review')} and ${countLabel(record.closures.records.length, 'deliberate closure')}.`,
      nextRequirement: !record.observedEffects.reviews.length ? 'Keep provider outcomes separate and record an independently observed effect when reviewed.' : !record.closures.records.length ? 'Review follow-up and, when justified, record a deliberate closure reason.' : 'Review whether follow-up remains due.',
    },
  ];
  return {
    stages,
    currentStage: stages.find((stage) => stage.status !== 'complete') ?? stages.at(-1),
    evidenceLinkedDecisionCount,
    actionSummary,
  };
}
