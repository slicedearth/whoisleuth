import {
  CT_HISTORY_SCHEMA_VERSION,
  deleteCtHistoryEntry,
  emptyCtHistoryStore,
  enforceCtHistoryBudget,
  normalizeCtHistoryStore,
  recordCtHistorySearch,
  ctHistoryStoreVersion,
} from './analysis/ct-history.js';

export const CT_HISTORY_KEY = 'whoisleuth:ct-search-history:v1';

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

function readRaw(): unknown {
  const raw = localStorage.getItem(CT_HISTORY_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function loadCtHistory(): CtHistoryStore {
  try { return normalizeCtHistoryStore(readRaw()) as CtHistoryStore; }
  catch { return emptyCtHistoryStore() as CtHistoryStore; }
}

function persistCtHistory(store: CtHistoryStore): CtHistoryStore {
  try {
    let version: number | null = null;
    try { version = ctHistoryStoreVersion(readRaw()); } catch { /* corrupt JSON is safely replaced */ }
    if (version !== null && version > CT_HISTORY_SCHEMA_VERSION) {
      throw new Error('Certificate search history was created by a newer app version.');
    }
    const normalized = enforceCtHistoryBudget(store) as CtHistoryStore;
    localStorage.setItem(CT_HISTORY_KEY, JSON.stringify(normalized));
    return normalized;
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('newer app version')) throw cause;
    throw new Error('Could not save Certificate Transparency history. Browser storage may be full or unavailable.');
  }
}

export function saveCtHistorySearch(query: string, domains: string[], options: { certificateCount: number; truncated: boolean; checkedAt?: string }): { store: CtHistoryStore; comparison: CtHistoryComparison } {
  const result = recordCtHistorySearch(loadCtHistory(), query, domains, options) as { store: CtHistoryStore; comparison: CtHistoryComparison };
  return { ...result, store: persistCtHistory(result.store) };
}

export function removeCtHistory(query: string): CtHistoryStore {
  return persistCtHistory(deleteCtHistoryEntry(loadCtHistory(), query) as CtHistoryStore);
}

export function clearCtHistory(): CtHistoryStore {
  try {
    localStorage.removeItem(CT_HISTORY_KEY);
    return emptyCtHistoryStore() as CtHistoryStore;
  } catch {
    throw new Error('Could not clear Certificate Transparency history. Browser storage may be unavailable.');
  }
}
