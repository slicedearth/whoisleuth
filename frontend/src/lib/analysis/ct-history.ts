// Pure, framework-neutral browser-history model for structured Certificate
// Transparency searches. Browser storage access lives in ../ct-history.ts;
// this module owns validation, comparison, retention, and schema shaping so it
// can be exercised under node --test.

import { normalizeDomain } from './case-model.ts';

export const CT_HISTORY_SCHEMA_VERSION = 3;
export const MAX_CT_HISTORY_SEARCHES = 30;
export const MAX_CT_HISTORY_EVENTS = 20;
export const MAX_CT_HISTORY_DISCARDED_CHECKS = 1_000_000;
export const MAX_CT_HISTORY_DOMAINS = 500;
export const MAX_CT_HISTORY_NEW_DOMAINS = 100;
export const MAX_CT_HISTORY_EVER_SEEN_DOMAINS = 1_000;
export const MAX_CT_HISTORY_QUERY_LENGTH = 200;
export const MAX_CT_HISTORY_STORE_BYTES = 1024 * 1024;

const CONTROL_RE = /[\x00-\x1f\x7f]/;

export type CtHistoryObservationState =
  | 'continuing'
  | 'first_observed'
  | 'history_unknown'
  | 'reappeared'
  | 'unclassified_partial';

export type CtHistoryEvent = {
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
};

export type CtHistoryEntry = {
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

function normalizeEvent(raw: unknown, sourceVersion: number | null): CtHistoryEvent | null {
  const event = plainRecord(raw);
  if (!event) return null;
  const checkedAt = normalizeTimestamp(event.checkedAt);
  if (!checkedAt) return null;
  const newDomains = normalizeDomains(event.newDomains, MAX_CT_HISTORY_NEW_DOMAINS);
  const resultCount = normalizeCount(event.resultCount, MAX_CT_HISTORY_DOMAINS);
  const truncated = event.truncated === true;
  const firstObservedDomains = normalizeDomains(event.firstObservedDomains, MAX_CT_HISTORY_NEW_DOMAINS);
  const reappearedDomains = normalizeDomains(event.reappearedDomains, MAX_CT_HISTORY_NEW_DOMAINS);
  const firstObservedCount = Math.max(normalizeCount(event.firstObservedCount, MAX_CT_HISTORY_DOMAINS), firstObservedDomains.length);
  const continuingCount = normalizeCount(event.continuingCount, MAX_CT_HISTORY_DOMAINS);
  const reappearedCount = Math.max(normalizeCount(event.reappearedCount, MAX_CT_HISTORY_DOMAINS), reappearedDomains.length);
  const historyUnknownCount = normalizeCount(event.historyUnknownCount, MAX_CT_HISTORY_DOMAINS);
  const classifiedCount = firstObservedCount + continuingCount + reappearedCount + historyUnknownCount;
  const classificationComplete = sourceVersion === CT_HISTORY_SCHEMA_VERSION
    && !truncated
    && event.classificationComplete === true
    && classifiedCount === resultCount;
  return {
    checkedAt,
    resultCount,
    certificateCount: normalizeCount(event.certificateCount, 1_000_000),
    newCount: Math.max(normalizeCount(event.newCount, MAX_CT_HISTORY_DOMAINS), newDomains.length),
    newDomains,
    truncated,
    classificationComplete,
    firstObservedCount: classificationComplete ? firstObservedCount : 0,
    firstObservedDomains: classificationComplete ? firstObservedDomains : [],
    continuingCount: classificationComplete ? continuingCount : 0,
    reappearedCount: classificationComplete ? reappearedCount : 0,
    reappearedDomains: classificationComplete ? reappearedDomains : [],
    historyUnknownCount: classificationComplete ? historyUnknownCount : 0,
  };
}

type CtHistoryRetention = Pick<
  CtHistoryEntry,
  'discardedCheckCount' | 'discardedCheckCountKnown' | 'discardedCheckCountCapped'
>;

function normalizedRetention(entry: Record<string, unknown>, sourceVersion: number | null): CtHistoryRetention {
  const rawCount = entry.discardedCheckCount;
  const validCount = typeof rawCount === 'number' && Number.isFinite(rawCount) && rawCount >= 0
    ? Math.floor(rawCount)
    : 0;
  return {
    discardedCheckCount: Math.min(validCount, MAX_CT_HISTORY_DISCARDED_CHECKS),
    // Schema 1 had no pruning provenance. Preserve that uncertainty instead
    // of silently treating a full legacy array as proof that nothing was lost.
    discardedCheckCountKnown: (sourceVersion === 2 || sourceVersion === CT_HISTORY_SCHEMA_VERSION)
      && entry.discardedCheckCountKnown === true,
    discardedCheckCountCapped: entry.discardedCheckCountCapped === true
      || validCount > MAX_CT_HISTORY_DISCARDED_CHECKS,
  };
}

function addDiscardedChecks(retention: CtHistoryRetention, count: number): CtHistoryRetention {
  const increment = Math.max(0, Math.floor(count));
  const next = retention.discardedCheckCount + increment;
  return {
    discardedCheckCount: Math.min(next, MAX_CT_HISTORY_DISCARDED_CHECKS),
    discardedCheckCountKnown: retention.discardedCheckCountKnown,
    discardedCheckCountCapped: retention.discardedCheckCountCapped
      || next > MAX_CT_HISTORY_DISCARDED_CHECKS,
  };
}

function normalizeEntry(raw: unknown, sourceVersion: number | null): CtHistoryEntry | null {
  const entry = plainRecord(raw);
  if (!entry) return null;
  const query = normalizeCtHistoryQuery(entry.query);
  if (!query) return null;
  const baselineAt = normalizeTimestamp(entry.baselineAt);
  const domains = baselineAt ? normalizeDomains(entry.domains, MAX_CT_HISTORY_DOMAINS) : [];
  const rawEverSeen = Array.isArray(entry.everSeenDomains) ? entry.everSeenDomains : [];
  const normalizedEverSeen = normalizeDomains(rawEverSeen, MAX_CT_HISTORY_EVER_SEEN_DOMAINS);
  const normalizedEverSeenSet = new Set(normalizedEverSeen);
  const baselineMissingFromEverSeen = domains.some((domain) => !normalizedEverSeenSet.has(domain));
  let combinedEverSeen = [
    ...domains,
    ...normalizedEverSeen.filter((domain) => !domains.includes(domain)),
  ].slice(0, MAX_CT_HISTORY_EVER_SEEN_DOMAINS).sort();
  const scannedEverSeen = rawEverSeen.slice(0, MAX_CT_HISTORY_EVER_SEEN_DOMAINS * 4);
  const malformedEverSeen = scannedEverSeen.some((value) => !normalizeDomain(value));
  const everSeenDomainsComplete = sourceVersion === CT_HISTORY_SCHEMA_VERSION
    && entry.everSeenDomainsComplete === true
    && rawEverSeen.length <= MAX_CT_HISTORY_EVER_SEEN_DOMAINS * 4
    && !malformedEverSeen
    && !baselineMissingFromEverSeen
    && new Set([...domains, ...normalizedEverSeen]).size <= MAX_CT_HISTORY_EVER_SEEN_DOMAINS;
  const rawHistory = Array.isArray(entry.history) ? entry.history : [];
  const historyInputs = rawHistory.slice(-MAX_CT_HISTORY_EVENTS * 4);
  const normalizedHistory = historyInputs
    .map((event) => normalizeEvent(event, sourceVersion))
    .filter((event) => event !== null)
    .sort((a, b) => a.checkedAt.localeCompare(b.checkedAt));
  const history = normalizedHistory.slice(-MAX_CT_HISTORY_EVENTS);
  if (sourceVersion !== CT_HISTORY_SCHEMA_VERSION) {
    const retainedLegacyEvidence = history.flatMap((event) => event.newDomains);
    combinedEverSeen = [
      ...domains,
      ...[...new Set(retainedLegacyEvidence)].sort().filter((domain) => !domains.includes(domain)),
    ].slice(0, MAX_CT_HISTORY_EVER_SEEN_DOMAINS).sort();
  }
  const discardedDuringNormalization = Math.max(0, rawHistory.length - historyInputs.length)
    + Math.max(0, normalizedHistory.length - history.length);
  const retention = addDiscardedChecks(
    normalizedRetention(entry, sourceVersion),
    discardedDuringNormalization,
  );
  const updatedAt = normalizeTimestamp(entry.updatedAt) || history.at(-1)?.checkedAt || baselineAt;
  if (!updatedAt) return null;
  return {
    query,
    baselineAt,
    updatedAt,
    domains,
    everSeenDomains: combinedEverSeen,
    everSeenDomainsComplete,
    history,
    ...retention,
  };
}

/**
 * Normalizes a persisted store, discarding unknown fields and malformed
 * entries. Duplicate query keys are resolved deterministically in favour of
 * the most recently updated entry.
 * @param {unknown} raw
 */
export function normalizeCtHistoryStore(raw: unknown): CtHistoryStore {
  const value = plainRecord(raw) || {};
  const sourceVersion = ctHistoryStoreVersion(value);
  const entries = Array.isArray(value.entries) ? value.entries.slice(0, MAX_CT_HISTORY_SEARCHES * 4) : [];
  const byQuery = new Map<string, CtHistoryEntry>();
  for (const candidate of entries) {
    const entry = normalizeEntry(candidate, sourceVersion);
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

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * Keeps the CT history under a dedicated 1 MB budget so it leaves headroom for
 * cases, watchlists, profiles, and shortlists on the same origin. It first
 * removes verbose per-event domain samples from the oldest searches (retaining
 * their counts), then old check events, then entire least-recently-used
 * searches. Current baselines are the last data discarded.
 * @param {unknown} rawStore
 */
function enforceNormalizedCtHistoryBudget(store: CtHistoryStore): CtHistoryStore {
  let storeBytes = serializedBytes(store);
  while (storeBytes > MAX_CT_HISTORY_STORE_BYTES) {
    let changed = false;
    for (let entryIndex = store.entries.length - 1; entryIndex >= 0 && !changed; entryIndex--) {
      const entry = store.entries[entryIndex];
      if (!entry) continue;
      for (const event of entry.history) {
        for (const field of ['newDomains', 'firstObservedDomains', 'reappearedDomains'] as const) {
          if (event[field].length) {
            storeBytes -= serializedBytes(event[field]) - serializedBytes([]);
            event[field] = [];
            changed = true;
            break;
          }
        }
        if (changed) break;
      }
    }
    if (changed) continue;
    for (let entryIndex = store.entries.length - 1; entryIndex >= 0 && !changed; entryIndex--) {
      const entry = store.entries[entryIndex];
      if (entry && entry.history.length > 1) {
        const removed = entry.history[0];
        if (!removed) continue;
        entry.history.shift();
        Object.assign(entry, addDiscardedChecks(entry, 1));
        // The persisted discard counter can grow by a digit as the event is
        // removed, so remeasure this already-bounded store instead of relying
        // on subtraction that would omit the provenance metadata change.
        storeBytes = serializedBytes(store);
        changed = true;
      }
    }
    if (changed) continue;
    if (store.entries.length > 1) {
      const removed = store.entries.at(-1);
      if (!removed) break;
      storeBytes -= serializedBytes(removed) + 1;
      store.entries.pop();
      continue;
    }
    // One maximally-sized normalized baseline is well below the budget. This
    // guard only prevents an accidental infinite loop if the schema changes.
    break;
  }
  // Keep one final measurement as a defensive check around the incremental
  // accounting. This fallback is bounded by the 30-entry retention ceiling.
  let measuredBytes = serializedBytes(store);
  while (measuredBytes > MAX_CT_HISTORY_STORE_BYTES && store.entries.length > 1) {
    store.entries.pop();
    measuredBytes = serializedBytes(store);
  }
  return store;
}

export function enforceCtHistoryBudget(rawStore: unknown): CtHistoryStore {
  return enforceNormalizedCtHistoryBudget(normalizeCtHistoryStore(rawStore));
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
  const retainedEverSeen = new Set(existing?.everSeenDomains ?? []);
  const continuingDomains = !truncated && hasBaseline
    ? currentDomains.filter((domain) => previousDomains.has(domain))
    : [];
  const reappearedDomains = !truncated && hasBaseline
    ? allNewDomains.filter((domain) => retainedEverSeen.has(domain))
    : [];
  const firstObservedDomains = !truncated
    ? currentDomains.filter((domain) => (
      !previousDomains.has(domain)
      && !retainedEverSeen.has(domain)
      && (existing?.everSeenDomainsComplete ?? true)
    ))
    : [];
  const historyUnknownDomains = !truncated
    ? currentDomains.filter((domain) => (
      !previousDomains.has(domain)
      && !retainedEverSeen.has(domain)
      && !(existing?.everSeenDomainsComplete ?? true)
    ))
    : [];
  const classificationComplete = !truncated;
  const event = {
    checkedAt,
    resultCount: currentDomains.length,
    certificateCount: normalizeCount(options.certificateCount, 1_000_000),
    newCount: allNewDomains.length,
    newDomains: allNewDomains.slice(0, MAX_CT_HISTORY_NEW_DOMAINS),
    truncated,
    classificationComplete,
    firstObservedCount: firstObservedDomains.length,
    firstObservedDomains: firstObservedDomains.slice(0, MAX_CT_HISTORY_NEW_DOMAINS),
    continuingCount: continuingDomains.length,
    reappearedCount: reappearedDomains.length,
    reappearedDomains: reappearedDomains.slice(0, MAX_CT_HISTORY_NEW_DOMAINS),
    historyUnknownCount: historyUnknownDomains.length,
  };
  const combinedHistory = [...(existing?.history || []), event];
  const discardedByEventLimit = Math.max(0, combinedHistory.length - MAX_CT_HISTORY_EVENTS);
  const retention = addDiscardedChecks(existing ?? {
    discardedCheckCount: 0,
    discardedCheckCountKnown: true,
    discardedCheckCountCapped: false,
  }, discardedByEventLimit);
  const priorEverSeen = existing?.everSeenDomains ?? [];
  const historicalEverSeen = priorEverSeen.filter((domain) => !currentDomains.includes(domain));
  const nextEverSeen = truncated
    ? priorEverSeen
    : [...currentDomains, ...historicalEverSeen.slice(0, MAX_CT_HISTORY_EVER_SEEN_DOMAINS - currentDomains.length)].sort();
  const everSeenDomainsComplete = truncated
    ? existing?.everSeenDomainsComplete ?? false
    : (existing?.everSeenDomainsComplete ?? true)
      && currentDomains.length + historicalEverSeen.length <= MAX_CT_HISTORY_EVER_SEEN_DOMAINS;
  const entry = {
    query,
    baselineAt: truncated ? existing?.baselineAt || null : checkedAt,
    updatedAt: checkedAt,
    domains: truncated ? existing?.domains || [] : currentDomains,
    everSeenDomains: nextEverSeen,
    everSeenDomainsComplete,
    history: combinedHistory.slice(-MAX_CT_HISTORY_EVENTS),
    ...retention,
  };
  const nextStore = enforceNormalizedCtHistoryBudget({
    version: CT_HISTORY_SCHEMA_VERSION,
    entries: [entry, ...store.entries.filter((item) => item.query !== query)]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.query.localeCompare(right.query))
      .slice(0, MAX_CT_HISTORY_SEARCHES),
  });

  return {
    store: nextStore,
    comparison: {
      query,
      hasBaseline,
      previousCheckedAt: existing?.baselineAt || null,
      newDomains: allNewDomains,
      newCount: allNewDomains.length,
      firstObservedDomains,
      firstObservedCount: firstObservedDomains.length,
      continuingDomains,
      continuingCount: continuingDomains.length,
      reappearedDomains,
      reappearedCount: reappearedDomains.length,
      historyUnknownDomains,
      historyUnknownCount: historyUnknownDomains.length,
      classificationComplete,
      everSeenDomainsComplete,
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
