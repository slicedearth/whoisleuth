import {
  addCaseNote,
  dispositionLabel,
  editCase,
  getCasesByDomain,
  isReviewedCaseDisposition,
  openCase,
  recordCaseConclusion,
  recordCaseInvestigationContext,
  recordCaseRecheckOutcome,
  type CaseConclusionInput,
  type CaseRecord,
} from '../cases.ts';
import type { CaseOpenSelection } from '../analysis/case-model.ts';
import type { EvidenceChange } from '../cases.ts';
import type { CaseRecheckAnswerContext } from '../../../../packages/cases/case-recheck-model.mts';
import { CaseSelectionError } from '../../../../packages/cases/case-selection.mts';
import { MAX_CASE_OBJECTIVE_LENGTH } from '../../../../packages/contracts/case-portability.mts';
import {
  abuseRecipientKindLabel,
  type ResolvedAbuseRecipient,
} from '../analysis/abuse-recipient-resolver.ts';
import {
  checkpointPinInputs,
  type CheckpointFact,
} from '../analysis/case-evidence-checkpoint.ts';
import type { CaseTransitionExpectation } from '../analysis/case-response-model.ts';
import {
  failedLocalMutationOutcome,
  type LocalMutationOutcome,
} from '../local-mutation-outcome.ts';

type CaseEvidenceInput = Record<string, unknown>;

type LookupCaseApi = Readonly<{
  getForDomain: typeof getCasesByDomain;
  open: typeof openCase;
  addNote: typeof addCaseNote;
  edit: typeof editCase;
  conclude?: typeof recordCaseConclusion;
  recordContext?: typeof recordCaseInvestigationContext;
  recordRecheck?: typeof recordCaseRecheckOutcome;
}>;

type LookupCaseReadResult = Readonly<{
  record: CaseRecord | null;
  records: CaseRecord[];
  status: string;
  sourceState: 'ready' | 'unavailable';
}>;

type LookupCaseActionResult = Readonly<{
  record: CaseRecord | null;
  status: string;
  sourceState?: 'ready' | 'unavailable';
  clearNote?: boolean;
  mutationOutcome: Exclude<LocalMutationOutcome, 'stale'>;
}>;

const DEFAULT_CASE_API: LookupCaseApi = {
  getForDomain: getCasesByDomain,
  open: openCase,
  addNote: addCaseNote,
  edit: editCase,
  conclude: recordCaseConclusion,
  recordContext: recordCaseInvestigationContext,
  recordRecheck: recordCaseRecheckOutcome,
};

export type LookupConclusionEvidenceSelection = Readonly<{
  field: string;
  stance: 'supports' | 'contradicts' | 'unresolved';
}>;

export type LookupRecheckComparison = Readonly<{ available: boolean; changes: EvidenceChange[]; observedAt: string; detail: string }>;
export type LookupRecheckOutcomeInput = Readonly<{
  state: string; completeness: string; source: string; followUpAt: string | null;
  limitations: readonly string[]; comparisonSummary: string; recheck?: CaseRecheckAnswerContext;
}>;

function pruneSuffix(pruned: number): string {
  return pruned
    ? ` (pruned ${pruned} old evidence snapshot${pruned === 1 ? '' : 's'} to stay within storage)`
    : '';
}

export class LookupCaseController {
  readonly #api: LookupCaseApi;

  constructor(api: LookupCaseApi = DEFAULT_CASE_API) {
    this.#api = api;
  }

  async refresh(domain: string, selectedId = ''): Promise<LookupCaseReadResult> {
    if (!domain) return { record: null, records: [], status: '', sourceState: 'ready' };
    try {
      const records = await this.#api.getForDomain(domain);
      const record = selectedId ? records.find(item => item.id === selectedId) ?? null : records.length === 1 ? records[0]! : null;
      return {
        record, records,
        status: record ? '' : selectedId ? 'The selected Case is unavailable for this domain. Choose another retained incident.' : records.length > 1 ? 'Select the intended incident before retaining evidence or decisions.' : '',
        sourceState: 'ready',
      };
    } catch {
      return {
        record: null,
        records: [],
        sourceState: 'unavailable',
        status:
          'Saved Case context is unavailable. The collected lookup evidence remains available.',
      };
    }
  }

  async open(
    domain: string,
    evidence: CaseEvidenceInput,
    scanDepth: 'fast' | 'deep',
    selection: CaseOpenSelection = {},
    title = '',
  ): Promise<LookupCaseActionResult> {
    if (!domain) return { record: null, status: '', mutationOutcome: 'rejected' };
    if (selection.newIncident && (!title.trim() || title.trim().length > MAX_CASE_OBJECTIVE_LENGTH)) return { record: null, status: 'Enter a bounded incident title before creating a separate Case.', mutationOutcome: 'rejected' };
    try {
      const { record, created, pruned } = await this.#api.open({
        domain,
        source: 'lookup',
        ...(selection.newIncident ? { title } : {}),
        evidence: { ...evidence, scanDepth },
      }, selection);
      if (!created) {
        const refreshed = await this.#api.edit(record.id, {
          source: 'lookup',
          evidence: { ...evidence, scanDepth },
        });
        return {
          record: refreshed.record,
          status: `Refreshed the retained Case evidence for ${refreshed.record.domain}.${pruneSuffix(refreshed.pruned)}`,
          mutationOutcome: 'committed',
        };
      }
      return {
        record,
        status: `Opened a new case for ${record.domain}.${pruneSuffix(pruned)}`,
        mutationOutcome: 'committed',
      };
    } catch (cause) {
      return {
        record: null,
        status:
          cause instanceof Error ? cause.message : 'Could not open the case.',
        sourceState: cause instanceof CaseSelectionError ? 'ready' : 'unavailable',
        mutationOutcome: failedLocalMutationOutcome(cause),
      };
    }
  }

  async openReplay(
    domain: string,
    evidence: CaseEvidenceInput,
    selection: CaseOpenSelection = {},
  ): Promise<LookupCaseActionResult> {
    if (!domain) return { record: null, status: '', mutationOutcome: 'rejected' };
    const importedEvidence = {
      ...evidence,
      source: 'import',
      scanDepth: 'unknown',
    };
    try {
      const { record, created, pruned } = await this.#api.open({
        domain,
        source: 'manual',
        evidence: importedEvidence,
      }, selection);
      if (!created) {
        const refreshed = await this.#api.edit(record.id, { evidence: importedEvidence });
        return {
          record: refreshed.record,
          status: `Added the historical replay evidence to the Case for ${refreshed.record.domain}.${pruneSuffix(refreshed.pruned)}`,
          mutationOutcome: 'committed',
        };
      }
      return {
        record,
        status: `Created a Case for ${record.domain} from historical replay evidence.${pruneSuffix(pruned)}`,
        mutationOutcome: 'committed',
      };
    } catch (cause) {
      return {
        record: null,
        status: cause instanceof Error ? cause.message : 'Could not save the replay evidence to a Case.',
        sourceState: cause instanceof CaseSelectionError ? 'ready' : 'unavailable',
        mutationOutcome: failedLocalMutationOutcome(cause),
      };
    }
  }

  async appendNote(
    record: CaseRecord | null,
    note: string,
  ): Promise<LookupCaseActionResult> {
    if (!record) return { record: null, status: '', mutationOutcome: 'rejected' };
    const body = note.trim();
    if (!body) {
      return { record, status: 'A note cannot be empty.', mutationOutcome: 'rejected' };
    }
    try {
      const updated = await this.#api.addNote(record.id, body);
      return {
        record: updated.record,
        status: `Added a note to the case.${pruneSuffix(updated.pruned)}`,
        clearNote: true,
        mutationOutcome: 'committed',
      };
    } catch (cause) {
      return {
        record,
        status:
          cause instanceof Error ? cause.message : 'Could not add the note.',
        mutationOutcome: failedLocalMutationOutcome(cause),
      };
    }
  }

  async classify(
    record: CaseRecord | null,
    disposition: string,
    reviewReasonCode: string,
  ): Promise<LookupCaseActionResult> {
    if (!record) {
      return {
        record: null,
        status: 'Create or open the analyst case before recording a classification.',
        mutationOutcome: 'rejected',
      };
    }
    const reviewedDisposition = isReviewedCaseDisposition(disposition);
    const reason = reviewedDisposition ? reviewReasonCode : '';
    if (reviewedDisposition && !reason) {
      return {
        record,
        status: 'Select the reviewed reason before saving this disposition.',
        mutationOutcome: 'rejected',
      };
    }
    try {
      const updated = await this.#api.edit(record.id, {
        disposition,
        reviewReasonCode: reason,
      });
      return {
        record: updated.record,
        status: `Saved the analyst disposition and review reason.${pruneSuffix(updated.pruned)}`,
        mutationOutcome: 'committed',
      };
    } catch (cause) {
      return {
        record,
        status: cause instanceof Error
          ? cause.message
          : 'Could not save the analyst classification.',
        mutationOutcome: failedLocalMutationOutcome(cause),
      };
    }
  }

  async recordConclusion(
    record: CaseRecord | null,
    facts: readonly CheckpointFact[],
    disposition: string,
    reviewReasonCode: string,
    rationale: string,
    selections: readonly LookupConclusionEvidenceSelection[],
  ): Promise<LookupCaseActionResult> {
    if (!record) {
      return {
        record: null,
        status: 'Create or open the analyst case before recording a conclusion.',
        mutationOutcome: 'rejected',
      };
    }
    const reviewedRationale = rationale.trim();
    if (!reviewedRationale) {
      return { record, status: 'Explain the evidence-based rationale before recording this conclusion.', mutationOutcome: 'rejected' };
    }
    if (!selections.length) {
      return { record, status: 'Select at least one observed fact for this conclusion.', mutationOutcome: 'rejected' };
    }
    const selectionByField = new Map(selections.map((item) => [item.field, item.stance]));
    if (selectionByField.size !== selections.length) {
      return { record, status: 'Each conclusion fact can be selected only once.', mutationOutcome: 'rejected' };
    }
    const pins = checkpointPinInputs(facts, selections.map((item) => item.field));
    if (pins.length !== selections.length) {
      return { record, status: 'One or more selected facts are no longer available in this observation.', mutationOutcome: 'rejected' };
    }
    const evidence: CaseConclusionInput['evidence'] = pins.map((pin) => ({
      pin,
      stance: selectionByField.get(pin.field ?? '') ?? 'unresolved',
    }));
    const summary = `Analyst conclusion: ${dispositionLabel(disposition)}`;
    try {
      const conclude = this.#api.conclude ?? recordCaseConclusion;
      const updated = await conclude(record.id, {
        disposition,
        reviewReasonCode,
        summary,
        rationale: reviewedRationale,
        evidence,
      });
      return {
        record: updated.record,
        status: `Recorded an evidence-linked analyst conclusion using ${evidence.length} selected fact${evidence.length === 1 ? '' : 's'}.${pruneSuffix(updated.pruned)}`,
        mutationOutcome: 'committed',
      };
    } catch (cause) {
      return {
        record,
        status: cause instanceof Error ? cause.message : 'Could not record the analyst conclusion.',
        mutationOutcome: failedLocalMutationOutcome(cause),
      };
    }
  }

  async recordInvestigationContext(
    record: CaseRecord | null,
    input: Readonly<{ objective: string; incidentUrl: string; retainExactUrl: boolean }>,
  ): Promise<LookupCaseActionResult> {
    if (!record) {
      return { record: null, status: 'Create or open the analyst case before retaining Incident context.', mutationOutcome: 'rejected' };
    }
    try {
      const save = this.#api.recordContext ?? recordCaseInvestigationContext;
      const updated = await save(record.id, input);
      return {
        record: updated.record,
        status: `${input.retainExactUrl ? 'Retained the exact Incident URL' : 'Retained only the Incident origin'} and investigation objective in this Case.${pruneSuffix(updated.pruned)}`,
        mutationOutcome: 'committed',
      };
    } catch (cause) {
      return {
        record,
        status: cause instanceof Error ? cause.message : 'Could not retain the Incident context.',
        mutationOutcome: failedLocalMutationOutcome(cause),
      };
    }
  }

  async recordRecheckOutcome(
    record: CaseRecord | null,
    input: LookupRecheckOutcomeInput & Readonly<{ observedAt: string; collectionDepth: 'fast' | 'deep'; observationHostname?: string }>,
  ): Promise<LookupCaseActionResult> {
    if (!record) return { record: null, status: 'Create or open the analyst case before recording a recheck outcome.', mutationOutcome: 'rejected' };
    try {
      const save = this.#api.recordRecheck ?? recordCaseRecheckOutcome;
      const updated = await save(record.id, input);
      return {
        record: updated.record,
        status: `Recorded the analyst-reviewed recheck outcome and linked comparison evidence.${pruneSuffix(updated.pruned)}`,
        mutationOutcome: 'committed',
      };
    } catch (cause) {
      return {
        record,
        status: cause instanceof Error ? cause.message : 'Could not record the recheck outcome.',
        mutationOutcome: failedLocalMutationOutcome(cause),
      };
    }
  }

  async recordRecipient(
    record: CaseRecord | null,
    route: ResolvedAbuseRecipient,
  ): Promise<LookupCaseActionResult> {
    if (!record) {
      return {
        record: null,
        status:
          'Create or open the analyst case before recording a response route.',
        mutationOutcome: 'rejected',
      };
    }
    const alreadyRecorded = record.actions.some(
      (action) =>
        action.type === route.actionType &&
        action.recipient.toLowerCase() === route.contact.toLowerCase(),
    );
    if (alreadyRecorded) {
      return {
        record,
        status: 'That response route is already recorded in this case.',
        mutationOutcome: 'rejected',
      };
    }
    try {
      const updated = await this.#api.edit(record.id, {
        action: {
          type: route.actionType,
          recipient: route.contact,
          contactSource: route.source,
          routeObservedAt: route.observedAt,
          routeReviewAfter: route.reviewAfter,
          contactLimitations: [...route.limitations],
          state: 'planned',
        },
      });
      return {
        record: updated.record,
        status: `Recorded the ${abuseRecipientKindLabel(route.kind).toLowerCase()} as a planned, human-reviewed action.${pruneSuffix(updated.pruned)}`,
        mutationOutcome: 'committed',
      };
    } catch (cause) {
      return {
        record,
        status:
          cause instanceof Error
            ? cause.message
            : 'Could not record the response route.',
        mutationOutcome: failedLocalMutationOutcome(cause),
      };
    }
  }

  async recordCheckpoint(
    record: CaseRecord | null,
    facts: readonly CheckpointFact[],
    selectedFields: readonly string[],
    transitionExpectations: Readonly<Record<string, CaseTransitionExpectation>> = {},
  ): Promise<LookupCaseActionResult> {
    if (!record) {
      return {
        record: null,
        status: 'Create or open the analyst case before saving an evidence checkpoint.',
        mutationOutcome: 'rejected',
      };
    }
    const evidencePins = checkpointPinInputs(facts, selectedFields, { transitionExpectations });
    if (evidencePins.length !== new Set(selectedFields).size) {
      return { record, status: 'A selected fact or its source observation time is unavailable. Review the current selection before saving a checkpoint.', mutationOutcome: 'rejected' };
    }
    if (!evidencePins.length) {
      return {
        record,
        status: 'Select at least one currently observed fact before saving a checkpoint.',
        mutationOutcome: 'rejected',
      };
    }
    try {
      const updated = await this.#api.edit(record.id, { evidencePins });
      return {
        record: updated.record,
        status: `Saved ${evidencePins.length} analyst-selected checkpoint fact${evidencePins.length === 1 ? '' : 's'}${evidencePins.some((pin) => pin.transitionExpectation) ? ' with a reviewed transition plan' : ''}.${pruneSuffix(updated.pruned)}`,
        mutationOutcome: 'committed',
      };
    } catch (cause) {
      return {
        record,
        status: cause instanceof Error
          ? cause.message
          : 'Could not save the evidence checkpoint.',
        mutationOutcome: failedLocalMutationOutcome(cause),
      };
    }
  }

}

export type {
  CaseEvidenceInput,
  LookupCaseActionResult,
  LookupCaseApi,
};
