export const CASE_RESPONSE_STAGE_DEFINITIONS = Object.freeze({
  observation: Object.freeze({ number: 1, label: 'Observation' }),
  assessment: Object.freeze({ number: 2, label: 'Assessment' }),
  response_decision: Object.freeze({ number: 3, label: 'Response decision' }),
  evidence_handoff: Object.freeze({ number: 4, label: 'Evidence handoff' }),
  outcome_tracking: Object.freeze({ number: 5, label: 'Outcome tracking' }),
} as const);

export type CaseResponseStageId = keyof typeof CASE_RESPONSE_STAGE_DEFINITIONS;

export type CaseResponseStage = Readonly<{
  id: CaseResponseStageId;
  number: number;
  label: string;
  status: 'complete' | 'in_progress' | 'not_started' | 'attention';
  summary: string;
  nextRequirement: string;
}>;
