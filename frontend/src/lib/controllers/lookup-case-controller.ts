import {
  addCaseNote,
  editCase,
  getCaseByDomain,
  openCase,
  recordCaseConclusion,
  recordCaseInvestigationContext,
  recordCaseRecheckOutcome,
  type CaseConclusionInput,
  type CaseRecord,
} from '../cases.ts';
import {
  abuseRecipientKindLabel,
  type ResolvedAbuseRecipient,
} from '../analysis/abuse-recipient-resolver.ts';
import {
  checkpointPinInputs,
  type CheckpointFact,
} from '../analysis/case-evidence-checkpoint.ts';
import type { CaseTransitionExpectation } from '../analysis/case-response-model.ts';

type CaseEvidenceInput = Record<string, unknown>;

type LookupCaseApi = Readonly<{
  getByDomain: typeof getCaseByDomain;
  open: typeof openCase;
  addNote: typeof addCaseNote;
  edit: typeof editCase;
  conclude?: typeof recordCaseConclusion;
  recordContext?: typeof recordCaseInvestigationContext;
  recordRecheck?: typeof recordCaseRecheckOutcome;
}>;

type LookupCaseActionResult = Readonly<{
  record: CaseRecord | null;
  status: string;
  clearNote?: boolean;
}>;

const DEFAULT_CASE_API: LookupCaseApi = {
  getByDomain: getCaseByDomain,
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

  async refresh(domain: string): Promise<LookupCaseActionResult> {
    if (!domain) return { record: null, status: '' };
    try {
      return {
        record: await this.#api.getByDomain(domain),
        status: '',
      };
    } catch {
      return {
        record: null,
        status:
          'Browser-local case context is unavailable. The collected lookup evidence remains available.',
      };
    }
  }

  async open(
    domain: string,
    evidence: CaseEvidenceInput,
    scanDepth: 'fast' | 'deep',
  ): Promise<LookupCaseActionResult> {
    if (!domain) return { record: null, status: '' };
    try {
      const { record, created, pruned } = await this.#api.open({
        domain,
        source: 'lookup',
        evidence: { ...evidence, scanDepth },
      });
      if (!created) {
        const refreshed = await this.#api.edit(record.id, {
          source: 'lookup',
          evidence: { ...evidence, scanDepth },
        });
        return {
          record: refreshed.record,
          status: `Refreshed the retained Case evidence for ${refreshed.record.domain}.${pruneSuffix(refreshed.pruned)}`,
        };
      }
      return {
        record,
        status: `Opened a new case for ${record.domain}.${pruneSuffix(pruned)}`,
      };
    } catch (cause) {
      return {
        record: null,
        status:
          cause instanceof Error ? cause.message : 'Could not open the case.',
      };
    }
  }

  async openReplay(
    domain: string,
    evidence: CaseEvidenceInput,
  ): Promise<LookupCaseActionResult> {
    if (!domain) return { record: null, status: '' };
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
      });
      if (!created) {
        const refreshed = await this.#api.edit(record.id, { evidence: importedEvidence });
        return {
          record: refreshed.record,
          status: `Added the historical replay evidence to the Case for ${refreshed.record.domain}.${pruneSuffix(refreshed.pruned)}`,
        };
      }
      return {
        record,
        status: `Created a browser-local Case for ${record.domain} from historical replay evidence.${pruneSuffix(pruned)}`,
      };
    } catch (cause) {
      return {
        record: null,
        status: cause instanceof Error ? cause.message : 'Could not save the replay evidence to a Case.',
      };
    }
  }

  async appendNote(
    record: CaseRecord | null,
    note: string,
  ): Promise<LookupCaseActionResult> {
    if (!record) return { record: null, status: '' };
    const body = note.trim();
    if (!body) {
      return { record, status: 'A note cannot be empty.' };
    }
    try {
      const updated = await this.#api.addNote(record.id, body);
      return {
        record: updated.record,
        status: `Added a note to the case.${pruneSuffix(updated.pruned)}`,
        clearNote: true,
      };
    } catch (cause) {
      return {
        record,
        status:
          cause instanceof Error ? cause.message : 'Could not add the note.',
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
      };
    }
    const reason = disposition === 'unreviewed' ? '' : reviewReasonCode;
    if (disposition !== 'unreviewed' && !reason) {
      return {
        record,
        status: 'Select the reviewed reason before saving this disposition.',
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
      };
    } catch (cause) {
      return {
        record,
        status: cause instanceof Error
          ? cause.message
          : 'Could not save the analyst classification.',
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
      };
    }
    const reviewedRationale = rationale.trim();
    if (!reviewedRationale) {
      return { record, status: 'Explain the evidence-based rationale before recording this conclusion.' };
    }
    if (!selections.length) {
      return { record, status: 'Select at least one observed fact for this conclusion.' };
    }
    const selectionByField = new Map(selections.map((item) => [item.field, item.stance]));
    if (selectionByField.size !== selections.length) {
      return { record, status: 'Each conclusion fact can be selected only once.' };
    }
    const pins = checkpointPinInputs(facts, selections.map((item) => item.field));
    if (pins.length !== selections.length) {
      return { record, status: 'One or more selected facts are no longer available in this observation.' };
    }
    const evidence: CaseConclusionInput['evidence'] = pins.map((pin) => ({
      pin,
      stance: selectionByField.get(pin.field ?? '') ?? 'unresolved',
    }));
    const summary = `Analyst conclusion: ${disposition.replaceAll('_', ' ')}`;
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
      };
    } catch (cause) {
      return {
        record,
        status: cause instanceof Error ? cause.message : 'Could not record the analyst conclusion.',
      };
    }
  }

  async recordInvestigationContext(
    record: CaseRecord | null,
    input: Readonly<{ objective: string; incidentUrl: string; retainExactUrl: boolean }>,
  ): Promise<LookupCaseActionResult> {
    if (!record) {
      return { record: null, status: 'Create or open the analyst case before retaining Incident context.' };
    }
    try {
      const save = this.#api.recordContext ?? recordCaseInvestigationContext;
      const updated = await save(record.id, input);
      return {
        record: updated.record,
        status: `${input.retainExactUrl ? 'Retained the exact Incident URL' : 'Retained only the Incident origin'} and investigation objective in this Case.${pruneSuffix(updated.pruned)}`,
      };
    } catch (cause) {
      return {
        record,
        status: cause instanceof Error ? cause.message : 'Could not retain the Incident context.',
      };
    }
  }

  async recordRecheckOutcome(
    record: CaseRecord | null,
    input: Readonly<{
      state: string;
      observedAt: string;
      completeness: string;
      comparisonSummary: string;
      source: string;
      followUpAt: string | null;
      limitations: readonly string[];
      collectionDepth: 'fast' | 'deep';
    }>,
  ): Promise<LookupCaseActionResult> {
    if (!record) return { record: null, status: 'Create or open the analyst case before recording a recheck outcome.' };
    try {
      const save = this.#api.recordRecheck ?? recordCaseRecheckOutcome;
      const updated = await save(record.id, input);
      return {
        record: updated.record,
        status: `Recorded the analyst-reviewed recheck outcome and linked comparison evidence.${pruneSuffix(updated.pruned)}`,
      };
    } catch (cause) {
      return {
        record,
        status: cause instanceof Error ? cause.message : 'Could not record the recheck outcome.',
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
      };
    }
    try {
      const updated = await this.#api.edit(record.id, {
        action: {
          type: route.actionType,
          recipient: route.contact,
          contactSource: route.source,
          routeObservedAt: route.observedAt,
          contactLimitations: [...route.limitations],
          state: 'planned',
        },
      });
      return {
        record: updated.record,
        status: `Recorded the ${abuseRecipientKindLabel(route.kind).toLowerCase()} as a planned, human-reviewed action.${pruneSuffix(updated.pruned)}`,
      };
    } catch (cause) {
      return {
        record,
        status:
          cause instanceof Error
            ? cause.message
            : 'Could not record the response route.',
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
      };
    }
    const evidencePins = checkpointPinInputs(facts, selectedFields, { transitionExpectations });
    if (!evidencePins.length) {
      return {
        record,
        status: 'Select at least one currently observed fact before saving a checkpoint.',
      };
    }
    try {
      const updated = await this.#api.edit(record.id, { evidencePins });
      return {
        record: updated.record,
        status: `Saved ${evidencePins.length} analyst-selected checkpoint fact${evidencePins.length === 1 ? '' : 's'}${evidencePins.some((pin) => pin.transitionExpectation) ? ' with a reviewed transition plan' : ''}.${pruneSuffix(updated.pruned)}`,
      };
    } catch (cause) {
      return {
        record,
        status: cause instanceof Error
          ? cause.message
          : 'Could not save the evidence checkpoint.',
      };
    }
  }

}

export type {
  CaseEvidenceInput,
  LookupCaseActionResult,
  LookupCaseApi,
};
