import type { CaseInput, CaseRecord } from '../cases.ts';
import type { ScanResult } from '../analysis/bulk-result-model.ts';
import { normalizeHttpSummary } from '../analysis/http-summary.ts';
import { failedLocalMutationOutcome, summarizeLocalMutationOutcomes, type LocalMutationOutcome } from '../local-mutation-outcome.ts';

type CasesApi = Pick<typeof import('../cases.ts'), 'openCase' | 'editCase' | 'loadCases' | 'setCaseDispositions' | 'dispositionLabel'>
  & Readonly<{ MAX_CASE_BATCH_MUTATIONS: number }>;
export type BulkCaseContext = Readonly<{ api: CasesApi; selected: ReadonlyMap<string, CaseRecord> }>;
export type BulkCaseActionState = Readonly<{ busy: boolean; status: string }>;
type Dependencies = Readonly<{
  context: () => Promise<BulkCaseContext | null>;
  publish: (cases: CaseRecord[]) => void;
  changed: (state: BulkCaseActionState) => void;
  confirm: (message: string) => boolean;
}>;

// Case creation is a sequence of individually committed writes, not one transaction.
const MAX_CASE_CREATIONS = 50;
const REFRESH_WARNING = ' The change was saved, but Cases could not be reread. The complete committed Case snapshot is shown locally; reload to retry the workspace read.';
const prunedNote = (count: number) => count ? ` (pruned ${count} old evidence snapshot${count === 1 ? '' : 's'} to stay within storage)` : '';

/** The explicit Bulk-to-Case projection excludes contacts and unreviewed response fields. */
export function bulkCaseInput(row: ScanResult) {
  const saved = row.saved;
  return { domain: row.domain, source: 'bulk', evidence: {
    scanDepth: saved.scanDepth, availability: saved.availability, confidence: row.confidence,
    riskModelVersion: saved.riskModelVersion, riskScore: row.risk, riskFactors: saved.riskFactors,
    opportunityModelVersion: saved.opportunityModelVersion, opportunityScore: row.opportunity,
    registrar: row.registrar && row.registrar !== '—' ? row.registrar : null,
    createdDate: saved.createdDate, expiryDate: saved.expiryDate, nameservers: saved.nameservers,
    hasMx: saved.hasMx, hasSpf: saved.hasSpf, hasDmarc: saved.hasDmarc,
    activityStatus: saved.activityStatus, pageTitle: saved.pageTitle,
    ...(saved.webCollectionQuality ? { webCollectionQuality: saved.webCollectionQuality } : {}),
    ...(normalizeHttpSummary(saved) || {}),
    faviconMatch: saved.faviconMatch, faviconNearMatch: saved.faviconNearMatch,
    reusesOfficialAssets: saved.reusesOfficialAssets, hasPasswordField: saved.hasPasswordField,
    hasExternalFormAction: saved.hasExternalFormAction, phishingLanguageMatch: saved.phishingLanguageMatch,
    privacyProtected: saved.privacyProtected, idnReferenceMatch: saved.idnReferenceMatch,
    pageBaselineMatch: saved.pageBaselineMatch, hasActiveBrandProfile: saved.hasActiveBrandProfile,
    profileContextState: saved.profileContext.sourceState === 'ready' ? 'ready' : 'unavailable',
    profileContextLimitation: saved.profileContext.limitation || null, mutationTypes: saved.mutationTypes,
  } } satisfies CaseInput;
}

/** Owns action state; all writes still pass through the existing Case service. */
export class BulkCaseActions {
  state: BulkCaseActionState = { busy: false, status: '' };
  #refreshFailed = false;
  private readonly dependencies: Dependencies;
  constructor(dependencies: Dependencies) { this.dependencies = dependencies; }

  #set(status: string, busy = this.state.busy) {
    this.state = { status, busy };
    this.dependencies.changed(this.state);
  }

  async #run(operation: (context: BulkCaseContext) => Promise<void>) {
    if (this.state.busy) return;
    this.#refreshFailed = false;
    this.#set('', true);
    try {
      const context = await this.dependencies.context();
      if (!context) { this.#set('Cases are unavailable. Reload before changing Cases.'); return; }
      await operation(context);
    } catch (cause) {
      this.#set(cause instanceof Error ? cause.message : 'Could not update the selected Cases.');
    } finally {
      this.#set(this.state.status + (this.#refreshFailed ? REFRESH_WARNING : ''), false);
    }
  }

  async #reconcile(api: CasesApi, committed: { cases: CaseRecord[] }) {
    let records = committed.cases;
    try { records = await api.loadCases(); }
    catch { this.#refreshFailed = true; }
    this.dependencies.publish(records);
  }

  async #open(context: BulkCaseContext, row: ScanResult): Promise<LocalMutationOutcome> {
    try {
      const selected = context.selected.get(row.domain);
      const input = bulkCaseInput(row);
      const opened = await context.api.openCase(input, selected ? { caseId: selected.id } : {});
      const committed = opened.created ? opened : await context.api.editCase(opened.record.id, { source: 'bulk', evidence: input.evidence });
      await this.#reconcile(context.api, committed);
      this.#set(`${opened.created ? `Opened a case for ${committed.record.domain}.` : `Refreshed the retained Case evidence for ${committed.record.domain}.`}${prunedNote(committed.pruned)}`);
      return 'committed';
    } catch (cause) {
      this.#set(cause instanceof Error ? cause.message : 'Could not open the case.');
      return failedLocalMutationOutcome(cause);
    }
  }

  open(row: ScanResult) { return this.#run(async context => { await this.#open(context, row); }); }

  setDisposition(row: ScanResult, disposition: string) {
    return this.#run(async context => {
      const record = context.selected.get(row.domain);
      if (!record) { this.#set('Select an incident Case for this target before changing its disposition.'); return; }
      const committed = await context.api.editCase(record.id, { disposition });
      await this.#reconcile(context.api, committed);
      this.#set(`Marked ${row.domain} as ${context.api.dispositionLabel(disposition)}.${prunedNote(committed.pruned)}`);
    });
  }

  createSelected(selection: readonly ScanResult[]) {
    const rows = selection.slice(0, MAX_CASE_CREATIONS);
    return this.#run(async context => {
      if (!rows.length || !this.dependencies.confirm(`Create or refresh cases for ${rows.length} selected domain${rows.length === 1 ? '' : 's'}?`)) return;
      const outcomes: LocalMutationOutcome[] = [];
      for (const row of rows) {
        const outcome = await this.#open(context, row);
        outcomes.push(outcome);
        if (outcome === 'unknown') break;
      }
      const summary = summarizeLocalMutationOutcomes(outcomes);
      const unattempted = rows.length - outcomes.length;
      this.#set(`Reviewed ${outcomes.length} selected domain${outcomes.length === 1 ? '' : 's'} for case creation: ${summary.committed} committed, ${summary.rejected} rejected${summary.unknown ? `, ${summary.unknown} with unknown commit state; reload before retrying` : ''}${unattempted ? `; ${unattempted} not attempted` : ''}${selection.length > rows.length ? `; the action was capped at ${MAX_CASE_CREATIONS}` : ''}.`);
    });
  }

  setSelectedDisposition(selection: readonly ScanResult[], disposition: string) {
    const rows = [...selection];
    return this.#run(async context => {
      const limit = context.api.MAX_CASE_BATCH_MUTATIONS;
      const records = rows.map(row => context.selected.get(row.domain)).filter((record): record is CaseRecord => Boolean(record)).slice(0, limit);
      if (!records.length) { this.#set('Select an incident Case for each target before changing its disposition.'); return; }
      const committed = await context.api.setCaseDispositions(records.map(record => record.id), disposition);
      await this.#reconcile(context.api, committed);
      const omitted = rows.length - records.length;
      this.#set(`Marked ${committed.changed} selected case${committed.changed === 1 ? '' : 's'} as ${context.api.dispositionLabel(disposition)}.${omitted ? ` ${omitted} target${omitted === 1 ? ' was' : 's were'} not changed: no incident was selected, no Case exists, or the ${limit}-Case batch limit was reached.` : ''}${prunedNote(committed.pruned)}`);
    });
  }
}
