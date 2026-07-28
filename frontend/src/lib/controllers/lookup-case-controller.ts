import {
  addCaseNote,
  editCase,
  getCaseByDomain,
  openCase,
  type CaseRecord,
} from '../cases.ts';
import type { ResolvedAbuseRecipient } from '../analysis/abuse-recipient-resolver.ts';

type CaseEvidenceInput = Record<string, unknown>;

type LookupCaseApi = Readonly<{
  getByDomain: typeof getCaseByDomain;
  open: typeof openCase;
  addNote: typeof addCaseNote;
  edit: typeof editCase;
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
};

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
      return {
        record,
        status: `${
          created
            ? `Opened a new case for ${record.domain}.`
            : `Opened the existing case for ${record.domain}.`
        }${pruneSuffix(pruned)}`,
      };
    } catch (cause) {
      return {
        record: null,
        status:
          cause instanceof Error ? cause.message : 'Could not open the case.',
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
          contactLimitations: [...route.limitations],
          state: 'planned',
        },
      });
      return {
        record: updated.record,
        status: `Recorded the ${route.kind.replaceAll('_', ' ')} route as a planned, human-reviewed action.${pruneSuffix(updated.pruned)}`,
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
}

export type {
  CaseEvidenceInput,
  LookupCaseActionResult,
  LookupCaseApi,
};
