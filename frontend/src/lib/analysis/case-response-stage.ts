import type { CasePatch, CaseRecord } from './case-model.ts';
import type { CaseDraftReceipt } from '../../../../packages/contracts/case-drafts.mts';

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
export type CaseResponsePresentation = 'quick' | 'advanced';

export const CASE_WORKSPACE_SECTIONS = Object.freeze([
  { id: 'summary', label: 'Summary' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'assessment', label: 'Assessment' },
  { id: 'response', label: 'Response' },
  { id: 'history', label: 'History' },
] as const);
export type CaseWorkspaceSection = typeof CASE_WORKSPACE_SECTIONS[number]['id'];

export const CASE_STAGE_SECTION: Readonly<Record<CaseResponseStageId, CaseWorkspaceSection>> = {
  observation: 'evidence',
  assessment: 'assessment',
  response_decision: 'response',
  evidence_handoff: 'response',
  outcome_tracking: 'response',
};

export function caseWorkspaceSection(url: URL): CaseWorkspaceSection {
  const section = url.searchParams.get('section');
  const recognised = CASE_WORKSPACE_SECTIONS.find((item) => item.id === section);
  if (recognised) return recognised.id;
  if (url.hash.startsWith('#case-response-observation-')) return 'evidence';
  if (url.hash.startsWith('#case-response-assessment-')) return 'assessment';
  return url.searchParams.get('response') === '1' || url.hash.startsWith('#case-response-') ? 'response' : 'summary';
}

export function caseWorkspaceHref(id: string, section: CaseWorkspaceSection = 'summary'): string {
  const params = new URLSearchParams({ case: id });
  if (section !== 'summary') params.set('section', section);
  return `/cases?${params}`;
}

export type PersistCaseResponse = (
  patch: CasePatch,
  success: string,
  focusFallback?: (() => HTMLElement | null) | null,
  draft?: CaseDraftReceipt,
) => Promise<boolean>;

export type PersistCaseOperation = (
  operation: () => Promise<{ record: CaseRecord; cases: CaseRecord[]; pruned: number }>,
  success: string,
  focusFallback: (() => HTMLElement | null) | null,
) => Promise<boolean>;
