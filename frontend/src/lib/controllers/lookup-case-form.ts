import type { LookupConclusionEvidenceSelection } from './lookup-case-controller.ts';
import type { LookupCaseState } from './lookup-case-workspace.ts';
import type { caseInvestigationContext } from '../../../../packages/cases/case-incident-context.mts';

/** Temporary form values only. These never enter session recovery or exports. */
export function createLookupCaseDraft() {
  return {
    conclusionRationale: '',
    conclusionEvidence: [] as LookupConclusionEvidenceSelection[],
    contextObjective: '',
    retainExactIncidentUrl: false,
    appliedContextKey: '',
    incidentTitle: '',
    recheckDraftEdited: false,
  };
}
export type LookupCaseDraft = ReturnType<typeof createLookupCaseDraft>;

/** Selecting a Case clears its form, but keeps the independent new-incident title. */
export function resetLookupCaseDraft(draft: LookupCaseDraft): LookupCaseDraft {
  return { ...createLookupCaseDraft(), incidentTitle: draft.incidentTitle };
}

export function hasLookupCaseDraftEdits(
  draft: LookupCaseDraft,
  state: Pick<LookupCaseState, 'note' | 'record' | 'disposition' | 'reviewReason'>,
  retained: ReturnType<typeof caseInvestigationContext>,
): boolean {
  return Boolean(
    state.note ||
    draft.conclusionRationale ||
    draft.conclusionEvidence.length ||
    draft.recheckDraftEdited ||
    draft.contextObjective !== (retained?.objective ?? '') ||
    draft.retainExactIncidentUrl !== (retained?.urlRetention === 'exact') ||
    (state.record &&
      (state.disposition !== state.record.disposition ||
        state.reviewReason !== (state.record.reviewReasonCode ?? ''))),
  );
}
