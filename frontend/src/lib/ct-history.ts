import {
  deleteCtHistoryEntry,
  emptyCtHistoryStore,
  enforceCtHistoryBudget,
  recordCtHistorySearch,
} from './analysis/ct-history.js';
import { browserLocalDataProvider } from './browser-local-data-service.js';
import { CT_HISTORY_COLLECTION, LEGACY_CT_HISTORY_KEY } from './browser-local-data-definitions.js';

export const CT_HISTORY_KEY = LEGACY_CT_HISTORY_KEY;

export interface CtHistoryEvent {
  checkedAt: string;
  resultCount: number;
  certificateCount: number;
  newCount: number;
  newDomains: string[];
  truncated: boolean;
}

export interface CtHistoryEntry {
  query: string;
  baselineAt: string | null;
  updatedAt: string;
  domains: string[];
  history: CtHistoryEvent[];
}

export interface CtHistoryStore { version: 1; entries: CtHistoryEntry[] }
export interface CtHistoryComparison {
  query: string;
  hasBaseline: boolean;
  previousCheckedAt: string | null;
  newDomains: string[];
  newCount: number;
  baselineUpdated: boolean;
  truncated: boolean;
}

export async function loadCtHistory(): Promise<CtHistoryStore> {
  return (await browserLocalDataProvider()).read(CT_HISTORY_COLLECTION) as Promise<CtHistoryStore>;
}

function boundedCtHistory(store: CtHistoryStore): CtHistoryStore {
  return enforceCtHistoryBudget(store) as CtHistoryStore;
}

export async function saveCtHistorySearch(query: string, domains: string[], options: { certificateCount: number; truncated: boolean; checkedAt?: string }): Promise<{ store: CtHistoryStore; comparison: CtHistoryComparison }> {
  return (await browserLocalDataProvider()).update(CT_HISTORY_COLLECTION, (current) => {
    const result = recordCtHistorySearch(current, query, domains, options) as { store: CtHistoryStore; comparison: CtHistoryComparison };
    const store = boundedCtHistory(result.store);
    return { document: store, result: { ...result, store } };
  });
}

export async function removeCtHistory(query: string): Promise<CtHistoryStore> {
  return (await browserLocalDataProvider()).update(CT_HISTORY_COLLECTION, (current) => {
    const store = boundedCtHistory(deleteCtHistoryEntry(current, query) as CtHistoryStore);
    return { document: store, result: store };
  });
}

export async function clearCtHistory(): Promise<CtHistoryStore> {
  const store = emptyCtHistoryStore() as CtHistoryStore;
  return (await browserLocalDataProvider()).update(CT_HISTORY_COLLECTION, () => ({ document: store, result: store }));
}
