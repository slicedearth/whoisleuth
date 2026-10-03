import { DEFAULT_BULK_RESULT_COLUMNS } from '../../../../packages/workspace/bulk-columns.mts';
import type { BulkReviewPresetView } from '../../../../packages/workspace/bulk-review-model.mts';
import { normalizeBulkPresentationSortKey } from '../../../../packages/workspace/bulk-sort.mts';
import type { BulkPrimaryFilter } from '../analysis/bulk-route-model.ts';

export type BulkViewState = Omit<BulkReviewPresetView, 'primaryFilter' | 'signalFilters' | 'columns'> & {
  filter: BulkPrimaryFilter;
  signalFilters: Set<string>;
  resultColumns: BulkReviewPresetView['columns'];
  page: number;
};

export function createBulkViewState(): BulkViewState {
  return {
    filter: 'all', mutationFilter: '', signalFilters: new Set(), sourceFilter: '', lifecycleFilter: '',
    ageFilter: '', mailFilter: '', registrarFilter: '', caseDispositionFilter: '', reviewStateFilter: '',
    groupBy: '', sortKey: 'risk', sortDirection: -1, resultColumns: [...DEFAULT_BULK_RESULT_COLUMNS], page: 1,
  };
}

/** Clearing constraints does not discard the analyst's chosen table presentation. */
export function clearBulkViewFilters(state: BulkViewState): BulkViewState {
  return { ...createBulkViewState(), groupBy: state.groupBy, sortKey: state.sortKey,
    sortDirection: state.sortDirection, resultColumns: [...state.resultColumns] };
}

export function bulkReviewView(state: BulkViewState): BulkReviewPresetView {
  const { filter, signalFilters, resultColumns, page: _page, ...view } = state;
  return { ...view, primaryFilter: filter, signalFilters: [...signalFilters], columns: [...resultColumns] };
}

/** Presets have already passed the saved-view validator at the storage boundary. */
export function restoreBulkView(view: BulkReviewPresetView, page = 1): BulkViewState {
  const { primaryFilter, signalFilters, columns, ...filters } = view;
  return { ...filters, filter: primaryFilter as BulkPrimaryFilter, signalFilters: new Set(signalFilters),
    sortKey: normalizeBulkPresentationSortKey(view.sortKey), resultColumns: [...columns], page };
}

/** Review-state data loads independently; navigation must not restore a filter before it is available. */
export function bulkNavigationView(state: BulkViewState): BulkReviewPresetView {
  return { ...bulkReviewView(state), reviewStateFilter: '', columns: [...DEFAULT_BULK_RESULT_COLUMNS] };
}
