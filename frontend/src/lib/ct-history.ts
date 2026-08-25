import {
  deleteCtHistoryEntry,
  emptyCtHistoryStore,
  enforceCtHistoryBudget,
  recordCtHistorySearch,
} from './analysis/ct-history.ts';
import { readBrowserLocalData, updateBrowserLocalData } from './browser-local-data-service.ts';
import { LEGACY_CT_HISTORY_KEY } from './browser-local-data-contract.ts';

export const CT_HISTORY_KEY = LEGACY_CT_HISTORY_KEY;

export interface CtHistoryEvent {
  checkedAt: string;
  resultCount: number;
  certificateCount: number;
  newCount: number;
  newDomains: string[];
  truncated: boolean;
  classificationComplete: boolean;
  firstObservedCount: number;
  firstObservedDomains: string[];
  continuingCount: number;
  reappearedCount: number;
  reappearedDomains: string[];
  historyUnknownCount: number;
}

export interface CtHistoryEntry {
  query: string;
  baselineAt: string | null;
  updatedAt: string;
  domains: string[];
  everSeenDomains: string[];
  everSeenDomainsComplete: boolean;
  history: CtHistoryEvent[];
  discardedCheckCount: number;
  discardedCheckCountKnown: boolean;
  discardedCheckCountCapped: boolean;
}

export interface CtHistoryStore { version: 3; entries: CtHistoryEntry[] }
export interface CtHistoryComparison {
  query: string;
  hasBaseline: boolean;
  previousCheckedAt: string | null;
  newDomains: string[];
  newCount: number;
  firstObservedDomains: string[];
  firstObservedCount: number;
  continuingDomains: string[];
  continuingCount: number;
  reappearedDomains: string[];
  reappearedCount: number;
  historyUnknownDomains: string[];
  historyUnknownCount: number;
  classificationComplete: boolean;
  everSeenDomainsComplete: boolean;
  baselineUpdated: boolean;
  truncated: boolean;
}

export async function loadCtHistory(): Promise<CtHistoryStore> {
  return readBrowserLocalData('ct_history') as Promise<CtHistoryStore>;
}

function boundedCtHistory(store: CtHistoryStore): CtHistoryStore {
  return enforceCtHistoryBudget(store) as CtHistoryStore;
}

export async function saveCtHistorySearch(query: string, domains: string[], options: { certificateCount: number; truncated: boolean; checkedAt?: string }): Promise<{ store: CtHistoryStore; comparison: CtHistoryComparison }> {
  return updateBrowserLocalData('ct_history', (current) => {
    const result = recordCtHistorySearch(current, query, domains, options) as { store: CtHistoryStore; comparison: CtHistoryComparison };
    const store = boundedCtHistory(result.store);
    return { document: store, result: { ...result, store } };
  });
}

export async function removeCtHistory(query: string): Promise<CtHistoryStore> {
  return updateBrowserLocalData('ct_history', (current) => {
    const store = boundedCtHistory(deleteCtHistoryEntry(current, query) as CtHistoryStore);
    return { document: store, result: store };
  });
}

export async function clearCtHistory(): Promise<CtHistoryStore> {
  const store = emptyCtHistoryStore() as CtHistoryStore;
  return updateBrowserLocalData('ct_history', () => ({ document: store, result: store }));
}
