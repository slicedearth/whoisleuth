import type { CaseViewFilters, CaseViewsStore, SavedCaseView } from '../../../packages/contracts/case-views-contract.mts';
import { emptyCaseViewsStore, normalizeCaseViewsStore } from '../../../packages/workspace/case-views.mts';
import { readBrowserLocalData, updateBrowserLocalData } from './browser-local-data-service.ts';
import { assertLocalRecordCurrent } from './local-mutation-outcome.ts';

export async function loadCaseViews(): Promise<CaseViewsStore> {
  return normalizeCaseViewsStore(await readBrowserLocalData('case_views'));
}

export async function saveCaseView(input: Readonly<{ name: string; filters: CaseViewFilters }>, expected: SavedCaseView | null = null) {
  // Detach the submitted values before provider initialisation or another async operation.
  const prior = expected ? normalizeCaseViewsStore({ ...emptyCaseViewsStore(), views: [expected] }).views[0]! : null;
  const now = new Date().toISOString();
  const view = normalizeCaseViewsStore({ ...emptyCaseViewsStore(), views: [{
    id: prior?.id ?? crypto.randomUUID(), name: input.name, filters: input.filters,
    createdAt: prior?.createdAt ?? now, updatedAt: now,
  }] }).views[0]!;
  return updateBrowserLocalData('case_views', current => {
    const existing = current.views.find(item => item.id === view.id);
    assertLocalRecordCurrent(existing, prior, 'saved Case view');
    if (!prior && existing) throw new Error('That saved Case view identity already exists. No view was overwritten.');
    const store = normalizeCaseViewsStore({ ...current, views: [...current.views.filter(item => item.id !== view.id), view] });
    return { document: store, result: { store, view } };
  });
}

export async function deleteCaseView(expected: SavedCaseView): Promise<CaseViewsStore> {
  const prior = normalizeCaseViewsStore({ ...emptyCaseViewsStore(), views: [expected] }).views[0]!;
  return updateBrowserLocalData('case_views', current => {
    assertLocalRecordCurrent(current.views.find(item => item.id === prior.id), prior, 'saved Case view');
    const store = normalizeCaseViewsStore({ ...current, views: current.views.filter(item => item.id !== prior.id) });
    return { document: store, result: store };
  });
}
