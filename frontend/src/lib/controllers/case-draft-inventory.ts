import type { CaseDraftRecord, CaseDraftStore } from '../../../../packages/contracts/case-drafts.mts';
import type { CaseRecord } from '../../../../packages/cases/case-record-contracts.mts';

type InventoryInput = Readonly<{
  case_drafts: CaseDraftStore;
  cases: readonly Pick<CaseRecord, 'id' | 'domain' | 'title'>[];
}>;
export type CaseDraftInventoryState = Readonly<{
  state: 'idle' | 'loading' | 'ready' | 'unavailable';
  entries: readonly Readonly<{ draft: CaseDraftRecord; caseLabel: string | null }>[];
}>;

/** Explicit, read-only inspection. A retained copy cannot resolve an unknown write. */
export function createCaseDraftInventory(
  read: () => Promise<InventoryInput>,
  changed: (state: CaseDraftInventoryState) => void,
) {
  let generation = 0, requested = false, disposed = false;
  async function refresh() {
    if (disposed) return;
    requested = true;
    const current = ++generation;
    changed({ state: 'loading', entries: [] });
    try {
      const input = await read();
      if (disposed || current !== generation) return;
      const cases = new Map(input.cases.map(record => [record.id, record]));
      const entries = input.case_drafts.records.map(draft => {
        const record = cases.get(draft.caseId);
        return { draft, caseLabel: record ? record.title || record.domain : null };
      }).sort((left, right) => Date.parse(right.draft.updatedAt) - Date.parse(left.draft.updatedAt)
        || (left.draft.id < right.draft.id ? -1 : left.draft.id > right.draft.id ? 1 : 0));
      changed({ state: 'ready', entries });
    } catch {
      if (!disposed && current === generation) changed({ state: 'unavailable', entries: [] });
    }
  }
  return {
    refresh,
    refreshIfRequested: () => { if (requested) void refresh(); },
    dispose: () => { disposed = true; generation++; },
  };
}
