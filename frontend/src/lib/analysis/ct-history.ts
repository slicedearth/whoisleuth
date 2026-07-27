// Pure, framework-neutral browser-history model for structured Certificate
// Transparency searches. Browser storage access lives in ../ct-history.ts;
// this module owns validation, comparison, retention, and schema shaping so it
// can be exercised under node --test.

import { normalizeDomain } from './case-model.ts';

export const CT_HISTORY_SCHEMA_VERSION = 1;
export const MAX_CT_HISTORY_SEARCHES = 30;
export const MAX_CT_HISTORY_EVENTS = 20;
export const MAX_CT_HISTORY_DOMAINS = 500;
export const MAX_CT_HISTORY_NEW_DOMAINS = 100;
export const MAX_CT_HISTORY_QUERY_LENGTH = 200;
export const MAX_CT_HISTORY_STORE_BYTES = 1024 * 1024;

const CONTROL_RE = /[\x00-\x1f\x7f]/;

export type CtHistoryEvent = {
  checkedAt: string;
  resultCount: number;
  certificateCount: number;
  newCount: number;
  newDomains: string[];
  truncated: boolean;
};

export type CtHistoryEntry = {
  query: string;
  baselineAt: string | null;
  updatedAt: string;
  domains: string[];
  history: CtHistoryEvent[];
};

export type CtHistoryStore = {
  version: typeof CT_HISTORY_SCHEMA_VERSION;
  entries: CtHistoryEntry[];
};

export type RecordCtHistoryOptions = {
  checkedAt?: unknown;
  certificateCount?: unknown;
  truncated?: unknown;
};

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function normalizeCtHistoryQuery(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_CT_HISTORY_QUERY_LENGTH || CONTROL_RE.test(value)) return '';
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64 || CONTROL_RE.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeCount(value: unknown, maximum: number = Number.MAX_SAFE_INTEGER): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(Math.floor(value), maximum)
    : 0;
}

function normalizeDomains(values: unknown, limit: number): string[] {
  if (!Array.isArray(values)) return [];
  const domains = new Set<string>();
  for (const value of values.slice(0, limit * 4)) {
    const domain = normalizeDomain(value);
    if (domain) domains.add(domain);
    if (domains.size >= limit) break;
  }
  return [...domains].sort();
}

function normalizeEvent(raw: unknown): CtHistoryEvent | null {
  const event = plainRecord(raw);
  if (!event) return null;
  const checkedAt = normalizeTimestamp(event.checkedAt);
  if (!checkedAt) return null;
  const newDomains = normalizeDomains(event.newDomains, MAX_CT_HISTORY_NEW_DOMAINS);
  return {
    checkedAt,
    resultCount: normalizeCount(event.resultCount, MAX_CT_HISTORY_DOMAINS),
    certificateCount: normalizeCount(event.certificateCount, 1_000_000),
    newCount: Math.max(normalizeCount(event.newCount, MAX_CT_HISTORY_DOMAINS), newDomains.length),
    newDomains,
    truncated: event.truncated === true,
  };
}

function normalizeEntry(raw: unknown): CtHistoryEntry | null {
  const entry = plainRecord(raw);
  if (!entry) return null;
  const query = normalizeCtHistoryQuery(entry.query);
  if (!query) return null;
  const baselineAt = normalizeTimestamp(entry.baselineAt);
  const domains = baselineAt ? normalizeDomains(entry.domains, MAX_CT_HISTORY_DOMAINS) : [];
  const history = Array.isArray(entry.history)
    ? entry.history.map(normalizeEvent).filter((event) => event !== null).sort((a, b) => a.checkedAt.localeCompare(b.checkedAt)).slice(-MAX_CT_HISTORY_EVENTS)
    : [];
  const updatedAt = normalizeTimestamp(entry.updatedAt) || history.at(-1)?.checkedAt || baselineAt;
  if (!updatedAt) return null;
  return { query, baselineAt, updatedAt, domains, history };
}

/**
 * Normalizes a persisted store, discarding unknown fields and malformed
 * entries. Duplicate query keys are resolved deterministically in favour of
 * the most recently updated entry.
 * @param {unknown} raw
 */
export function normalizeCtHistoryStore(raw: unknown): CtHistoryStore {
  const value = plainRecord(raw) || {};
  const entries = Array.isArray(value.entries) ? value.entries.slice(0, MAX_CT_HISTORY_SEARCHES * 4) : [];
  const byQuery = new Map<string, CtHistoryEntry>();
  for (const candidate of entries) {
    const entry = normalizeEntry(candidate);
    if (!entry) continue;
    const existing = byQuery.get(entry.query);
    if (!existing || entry.updatedAt > existing.updatedAt) byQuery.set(entry.query, entry);
  }
  return {
    version: CT_HISTORY_SCHEMA_VERSION,
    entries: [...byQuery.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.query.localeCompare(b.query))
      .slice(0, MAX_CT_HISTORY_SEARCHES),
  };
}

function serializedBytes(store: CtHistoryStore): number {
  return new TextEncoder().encode(JSON.stringify(store)).length;
}

/**
 * Keeps the CT history under a dedicated 1 MB budget so it leaves headroom for
 * cases, watchlists, profiles, and shortlists on the same origin. It first
 * removes verbose per-event domain samples from the oldest searches (retaining
 * their newCount), then old check events, then entire least-recently-used
 * searches. Current baselines are the last data discarded.
 * @param {unknown} rawStore
 */
export function enforceCtHistoryBudget(rawStore: unknown): CtHistoryStore {
  const store = normalizeCtHistoryStore(rawStore);
  while (serializedBytes(store) > MAX_CT_HISTORY_STORE_BYTES) {
    let changed = false;
    for (let entryIndex = store.entries.length - 1; entryIndex >= 0 && !changed; entryIndex--) {
      const entry = store.entries[entryIndex];
      if (!entry) continue;
      for (const event of entry.history) {
        if (event.newDomains.length) {
          event.newDomains = [];
          changed = true;
          break;
        }
      }
    }
    if (changed) continue;
    for (let entryIndex = store.entries.length - 1; entryIndex >= 0 && !changed; entryIndex--) {
      const entry = store.entries[entryIndex];
      if (entry && entry.history.length > 1) {
        entry.history.shift();
        changed = true;
      }
    }
    if (changed) continue;
    if (store.entries.length > 1) {
      store.entries.pop();
      continue;
    }
    // One maximally-sized normalized baseline is well below the budget. This
    // guard only prevents an accidental infinite loop if the schema changes.
    break;
  }
  return store;
}

export function ctHistoryStoreVersion(raw: unknown): number | null {
  const value = plainRecord(raw);
  if (!value) return null;
  const version = value.version;
  return typeof version === 'number' && Number.isInteger(version) && version > 0 ? version : null;
}

export function findCtHistoryEntry(store: unknown, query: unknown): CtHistoryEntry | null {
  const key = normalizeCtHistoryQuery(query);
  if (!key) return null;
  return normalizeCtHistoryStore(store).entries.find((entry) => entry.query === key) || null;
}

/**
 * Records one structured CT search and compares it with the last complete
 * baseline for the same normalized query. The first complete search creates a
 * baseline without labelling every result as new. A truncated search is
 * retained in the check history but never replaces the last complete baseline.
 *
 */
export function recordCtHistorySearch(
  rawStore: unknown,
  rawQuery: unknown,
  rawDomains: unknown,
  options: RecordCtHistoryOptions = {},
) {
  const query = normalizeCtHistoryQuery(rawQuery);
  if (!query) throw new Error('A valid Certificate Transparency search query is required.');
  const checkedAt = normalizeTimestamp(options.checkedAt || new Date().toISOString());
  if (!checkedAt) throw new Error('A valid Certificate Transparency check timestamp is required.');

  const store = normalizeCtHistoryStore(rawStore);
  const currentDomains = normalizeDomains(rawDomains, MAX_CT_HISTORY_DOMAINS);
  const existing = store.entries.find((entry) => entry.query === query) || null;
  const hasBaseline = Boolean(existing?.baselineAt);
  const previousDomains = new Set(existing?.baselineAt ? existing.domains : []);
  const allNewDomains = hasBaseline ? currentDomains.filter((domain) => !previousDomains.has(domain)) : [];
  const truncated = options.truncated === true;
  const event = {
    checkedAt,
    resultCount: currentDomains.length,
    certificateCount: normalizeCount(options.certificateCount, 1_000_000),
    newCount: allNewDomains.length,
    newDomains: allNewDomains.slice(0, MAX_CT_HISTORY_NEW_DOMAINS),
    truncated,
  };
  const entry = {
    query,
    baselineAt: truncated ? existing?.baselineAt || null : checkedAt,
    updatedAt: checkedAt,
    domains: truncated ? existing?.domains || [] : currentDomains,
    history: [...(existing?.history || []), event].slice(-MAX_CT_HISTORY_EVENTS),
  };
  const nextStore = enforceCtHistoryBudget({
    version: CT_HISTORY_SCHEMA_VERSION,
    entries: [entry, ...store.entries.filter((item) => item.query !== query)],
  });

  return {
    store: nextStore,
    comparison: {
      query,
      hasBaseline,
      previousCheckedAt: existing?.baselineAt || null,
      newDomains: allNewDomains,
      newCount: allNewDomains.length,
      baselineUpdated: !truncated,
      truncated,
    },
  };
}

export function deleteCtHistoryEntry(rawStore: unknown, rawQuery: unknown): CtHistoryStore {
  const query = normalizeCtHistoryQuery(rawQuery);
  const store = normalizeCtHistoryStore(rawStore);
  return { version: CT_HISTORY_SCHEMA_VERSION, entries: store.entries.filter((entry) => entry.query !== query) };
}

export function emptyCtHistoryStore(): CtHistoryStore {
  return { version: CT_HISTORY_SCHEMA_VERSION, entries: [] };
}
