import { DEFAULT_DISPOSITION, isReviewedCaseDisposition } from '../../../../packages/cases/case-record-decisions.mts';
import type { CaseRecord } from '../../../../packages/cases/case-record-contracts.mts';
import type { LocalMutationOutcome } from '../local-mutation-outcome.ts';
import type { LookupCaseActionResult, LookupCaseController, LookupRecheckComparison } from './lookup-case-controller.ts';
import { latestCaseEvidence } from '../../../../packages/cases/case-evidence-model.mts';
import { compareLookupRecheck } from '../analysis/lookup-recheck-comparison.ts';
import type { LookupOperation } from './lookup-request-controller.ts';

type LookupCaseState = Readonly<{
  record: CaseRecord | null;
  candidates: readonly CaseRecord[];
  sourceState: 'loading' | 'ready' | 'unavailable';
  note: string;
  status: string;
  disposition: string;
  reviewReason: string;
  comparison: LookupRecheckComparison | null;
  busy: boolean;
}>;

function emptyCaseState(): LookupCaseState {
  return {
    record: null,
    candidates: [],
    sourceState: 'loading',
    note: '',
    status: '',
    disposition: DEFAULT_DISPOSITION,
    reviewReason: '',
    comparison: null,
    busy: false,
  };
}

type LookupCaseWorkspaceOptions = Readonly<{
  controller: Pick<LookupCaseController, 'refresh'>;
  context: () => Readonly<{ domain: string; revision: number }>;
  publish: (state: LookupCaseState) => void;
  select: (id: string) => void;
}>;

/** Owns the current Lookup's Case draft and publication lifecycle, not storage. */
export class LookupCaseWorkspace {
  readonly #options: LookupCaseWorkspaceOptions;
  #state = emptyCaseState();
  #actionGeneration = 0;
  #readGeneration = 0;
  #disposed = false;

  constructor(options: LookupCaseWorkspaceOptions) {
    this.#options = options;
  }

  get state(): LookupCaseState { return this.#state; }

  #publish(next: LookupCaseState): void {
    this.#state = next;
    this.#options.publish(next);
  }

  #update(patch: Partial<LookupCaseState>): void {
    this.#publish({ ...this.#state, ...patch });
  }

  invalidate(): void {
    this.#actionGeneration += 1;
    this.#readGeneration += 1;
    this.#update({ busy: false });
  }

  reset(): void {
    this.invalidate();
    this.#publish(emptyCaseState());
  }

  dispose(): void {
    this.#disposed = true;
    this.invalidate();
  }

  setNote(note: string): void { this.#update({ note }); }
  setReviewReason(reviewReason: string): void { this.#update({ reviewReason }); }
  setComparison(comparison: LookupRecheckComparison | null): void { this.#update({ comparison }); }

  async recheck(collect: () => Promise<LookupOperation | undefined>): Promise<void> {
    if (this.#disposed) return;
    const caseId = this.#state.record?.id;
    const before = latestCaseEvidence(this.#state.record);
    this.setComparison(null);
    const operation = await collect();
    if (!operation?.current() || this.#disposed || (caseId && caseId !== this.#state.record?.id)) return;
    this.setComparison(compareLookupRecheck(before, latestCaseEvidence(this.#state.record)));
  }

  setDisposition(disposition: string): void {
    this.#update({ disposition, reviewReason: isReviewedCaseDisposition(disposition) ? this.#state.reviewReason : '' });
  }

  synchroniseDecision(record: CaseRecord | null): void {
    this.#update({ disposition: record?.disposition ?? DEFAULT_DISPOSITION, reviewReason: record?.reviewReasonCode ?? '' });
  }

  async refresh(selectedId = ''): Promise<void> {
    if (this.#disposed || this.#state.busy) return;
    const context = this.#options.context();
    const read = ++this.#readGeneration;
    const action = this.#actionGeneration;
    this.#update({ sourceState: 'loading' });
    const next = await this.#options.controller.refresh(context.domain, selectedId);
    const current = this.#options.context();
    if (this.#disposed || read !== this.#readGeneration || action !== this.#actionGeneration
      || context.revision !== current.revision || context.domain !== current.domain) return;
    this.#update({
      record: next.record,
      candidates: next.records,
      status: next.status,
      sourceState: next.sourceState,
      disposition: next.record?.disposition ?? DEFAULT_DISPOSITION,
      reviewReason: next.record?.reviewReasonCode ?? '',
    });
  }

  select(id: string): void {
    if (this.#disposed || this.#state.busy) return;
    const record = this.#state.candidates.find(candidate => candidate.id === id);
    if (!record) return;
    this.invalidate();
    this.#update({
      record,
      note: '',
      status: '',
      comparison: null,
      disposition: record.disposition,
      reviewReason: record.reviewReasonCode ?? '',
    });
    this.#options.select(record.id);
  }

  async perform(
    action: () => Promise<LookupCaseActionResult>,
    afterPublish: (next: LookupCaseActionResult) => void = () => {},
  ): Promise<LocalMutationOutcome> {
    if (this.#disposed || this.#state.busy) return 'stale';
    if (this.#state.sourceState !== 'ready') return 'rejected';
    const generation = ++this.#actionGeneration;
    this.#readGeneration += 1;
    const context = this.#options.context();
    const recordId = this.#state.record?.id ?? '';
    this.#update({ busy: true });
    try {
      const next = await action();
      const current = this.#options.context();
      if (this.#disposed || generation !== this.#actionGeneration
        || context.revision !== current.revision || context.domain !== current.domain
        || (this.#state.record?.id ?? '') !== recordId) return 'stale';
      this.#update({
        ...(next.record ? { record: next.record,
          candidates: [...this.#state.candidates.filter(record => record.id !== next.record!.id), next.record] } : {}),
        status: next.status,
        sourceState: next.sourceState ?? (next.record ? 'ready' : this.#state.sourceState),
      });
      afterPublish(next);
      if (next.mutationOutcome === 'committed' && next.record) this.#options.select(next.record.id);
      return next.mutationOutcome;
    } finally {
      if (generation === this.#actionGeneration) this.#update({ busy: false });
    }
  }
}

export type { LookupCaseState };
