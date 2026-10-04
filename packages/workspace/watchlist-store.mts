// Pure browser-local watchlist collection model. Watchlist history owns the
// evidence shape and diff semantics; this module owns collection names, schema
// migration, import merging, and exact serialized-byte accounting.

import { MAX_WATCHLIST_DOMAINS, normalizeWatchlistEntry, compactWatchlistResults, appendWatchlistScan, mergeWatchlistBaseline, type WatchlistComparableRecord } from './watchlist-history.mts';
import { mergeWatchDomainMetadata } from './brand-candidate-workflow.mts';
import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';
import { assertWorkspaceDeclaredVersion, assertWorkspaceInputGraph, assertWorkspacePortableVersion, ordinaryWorkspaceRecord } from './hostile-input.mts';
import {
  MAX_WATCHLIST_INPUTS,
  MAX_WATCHLIST_NAME_LENGTH,
  MAX_WATCHLISTS,
  MAX_WATCHLIST_STORE_BYTES,
  WATCHLIST_SCHEMA,
  WATCHLIST_SCHEMA_VERSION,
  WATCHLIST_BROWSER_SUPPORTED_VERSIONS,
  WATCHLIST_EXPORT_SUPPORTED_VERSIONS,
} from '../contracts/workspace-portability.mts';

export {
  MAX_WATCHLIST_INPUTS,
  MAX_WATCHLIST_NAME_LENGTH,
  MAX_WATCHLISTS,
  MAX_WATCHLIST_STORE_BYTES,
  WATCHLIST_SCHEMA,
  WATCHLIST_SCHEMA_VERSION,
} from '../contracts/workspace-portability.mts';

const BLOCKED_NAMES = new Set(['__proto__', 'prototype', 'constructor']);
const CONTROL_RE = /[\x00-\x1f\x7f]/;

export type WatchlistEntry = ReturnType<typeof normalizeWatchlistEntry>;
export type WatchlistCollection = Record<string, WatchlistEntry>;
export type WatchlistStore = {
  schema: typeof WATCHLIST_SCHEMA;
  version: typeof WATCHLIST_SCHEMA_VERSION;
  watchlists: WatchlistCollection;
};

export type WatchlistUpdatePreview = Readonly<{
  name: string;
  operation: 'merge' | 'replace';
  mode: 'fast' | 'deep';
  retained: readonly string[];
  added: readonly string[];
  removed: readonly string[];
  previous: WatchlistEntry | null;
  input: readonly WatchlistComparableRecord[];
}>;

export function resolveWatchlistMutationTarget(current: WatchlistCollection, requestedName: string): { name: string; previous: WatchlistEntry | null } {
  const existingName = Object.keys(current).find(candidate => candidate.toLowerCase() === requestedName.toLowerCase());
  const previous = existingName ? current[existingName] ?? null : null;
  if (!previous && Object.keys(current).length >= MAX_WATCHLISTS) throw new Error('Watchlist storage is full. Export and remove a watchlist before saving more.');
  return { name: existingName || requestedName, previous };
}

function freezePreview<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezePreview(child);
    Object.freeze(value);
  }
  return value;
}

/** Review current membership and the exact compact submitted evidence together. */
export function planWatchlistUpdate(current: WatchlistCollection, name: string, input: readonly WatchlistComparableRecord[], mode: 'fast' | 'deep', operation: 'merge' | 'replace'): WatchlistUpdatePreview {
  const normalizedName = normalizeWatchlistName(name);
  if (!normalizedName) throw new Error('Watchlist names must be 1–100 characters and use a safe name.');
  if (!Array.isArray(input) || input.length > MAX_WATCHLIST_DOMAINS) throw new Error(`Watchlists are limited to ${MAX_WATCHLIST_DOMAINS} domains.`);
  if (!['fast', 'deep'].includes(mode) || !['merge', 'replace'].includes(operation)) throw new Error('Choose a supported Monitor update operation.');
  const target = resolveWatchlistMutationTarget(normalizeWatchlistStore(current).watchlists, normalizedName);
  const submitted = compactWatchlistResults(input);
  if (!submitted.length || submitted.length !== input.length) throw new Error('The selected Monitor results contain invalid or repeated domains. Nothing was saved.');
  const before = new Set(target.previous?.results.map(record => record.domain) ?? []);
  const after = new Set([...(operation === 'merge' ? before : []), ...submitted.map(record => record.domain)]);
  if (after.size > MAX_WATCHLIST_DOMAINS) throw new Error(`The merged watchlist exceeds its ${MAX_WATCHLIST_DOMAINS}-domain limit. Existing members were preserved.`);
  return freezePreview(structuredClone({ name: target.name, operation, mode, previous: target.previous, input: submitted,
    retained: [...before].filter(domain => after.has(domain)).sort(),
    added: [...after].filter(domain => !before.has(domain)).sort(),
    removed: [...before].filter(domain => !after.has(domain)).sort() }));
}

/** Reconcile consent inside the transaction, then retain only bounded history. */
export function applyReviewedWatchlistUpdate(current: WatchlistCollection, reviewed: WatchlistUpdatePreview, checkedAt = new Date().toISOString()) {
  const fresh = planWatchlistUpdate(current, reviewed.name, reviewed.input, reviewed.mode, reviewed.operation);
  if (JSON.stringify(fresh) !== JSON.stringify(reviewed)) throw new Error('The watchlist changed after review. Preview its membership again; nothing was overwritten.');
  const appended = appendWatchlistScan(fresh.previous, fresh.input, { mode: fresh.mode, checkedAt });
  let entry = appended.entry;
  if (fresh.operation === 'merge' && fresh.previous) {
    const records = new Map(fresh.previous.results.map(record => [record.domain, record]));
    for (const record of fresh.input) records.set(record.domain, record);
    const results = [...records.values()];
    entry = normalizeWatchlistEntry({ ...entry, results,
      baseline: mergeWatchlistBaseline(fresh.previous.baseline, results),
      domainMetadata: fresh.previous.domainMetadata });
  }
  const all = { ...current };
  Object.defineProperty(all, fresh.name, { value: entry, enumerable: true, writable: true, configurable: true });
  return { watchlists: assertWatchlistStoreBudget(all).watchlists, changes: appended.changes };
}

function plainRecord(value: unknown): Record<string, unknown> | null {
  return ordinaryWorkspaceRecord(value, 'Watchlist input');
}

function isEnvelope(value: Record<string, unknown>): boolean {
  return Boolean(value && value.schema === WATCHLIST_SCHEMA && plainRecord(value.watchlists));
}

export function normalizeWatchlistName(value: unknown): string {
  if (typeof value !== 'string' || CONTROL_RE.test(value)) return '';
  const name = value.trim();
  if (name.length > MAX_WATCHLIST_NAME_LENGTH) return '';
  return name && !BLOCKED_NAMES.has(name.toLowerCase()) ? name : '';
}

function watchlistMap(raw: unknown): Record<string, unknown> | null {
  const value = plainRecord(raw);
  if (!value) return null;
  return isEnvelope(value) ? plainRecord(value.watchlists) : value;
}

export function watchlistStoreVersion(raw: unknown): number | null {
  const value = plainRecord(raw);
  if (!value) return null;
  if (!isEnvelope(value)) return WATCHLIST_SCHEMA_VERSION;
  return typeof value.version === 'number' && Number.isFinite(value.version) && value.version > 0 ? value.version : null;
}

function defineEntry(
  target: WatchlistCollection,
  name: string,
  entry: WatchlistEntry,
): void {
  Object.defineProperty(target, name, { value: entry, writable: true, enumerable: true, configurable: true });
}

function assertHistoricalQuality(entry: Record<string, unknown>, version: number | null): void {
  if (version !== null && version < 5 && Object.hasOwn(entry, 'domainMetadata')) {
    throw new TypeError('Domain watch metadata requires Watchlist schema 5; historical evidence was not reinterpreted.');
  }
  if (version !== null && version < 5) {
    const values = [entry.results, entry.baseline, ...((Array.isArray(entry.history) ? entry.history : []).map(event => plainRecord(event)?.changes))];
    if (values.some(rows => Array.isArray(rows) && rows.some(value => {
      const row = plainRecord(value);
      return row && (Object.hasOwn(row, 'hasExternalPasswordForm') || row.field === 'hasExternalPasswordForm');
    }))) throw new TypeError('Password-form attribution requires Watchlist schema 5; historical evidence was not reinterpreted.');
  }
  if (version !== 2) return;
  for (const values of [entry.results, entry.baseline]) {
    if (Array.isArray(values) && values.some(value => plainRecord(value)?.webCollectionQuality !== undefined)) {
      throw new TypeError('Web collection quality requires Watchlist schema 3 or later; historical evidence was not reinterpreted.');
    }
  }
}

export function normalizeWatchlistStore(raw: unknown): WatchlistStore {
  assertWorkspaceInputGraph(raw, 'Watchlist store');
  const root = plainRecord(raw);
  if (root?.schema === WATCHLIST_SCHEMA) assertWorkspaceDeclaredVersion(raw, 'Watchlist store');
  if (root?.schema === WATCHLIST_SCHEMA && !WATCHLIST_BROWSER_SUPPORTED_VERSIONS.includes(Number(watchlistStoreVersion(root)))) {
    throw new Error(`Watchlist schema ${String(root.version)} is unsupported; no data was changed.`);
  }
  const source = watchlistMap(raw);
  const watchlists: WatchlistCollection = {};
  if (!source) return { schema: WATCHLIST_SCHEMA, version: WATCHLIST_SCHEMA_VERSION, watchlists };
  for (const [rawName, rawEntry] of Object.entries(source).slice(0, MAX_WATCHLIST_INPUTS)) {
    const name = normalizeWatchlistName(rawName);
    const entry = plainRecord(rawEntry);
    if (!name || !entry || !Array.isArray(entry.results) || entry.results.length > MAX_WATCHLIST_DOMAINS) continue;
    assertHistoricalQuality(entry, root?.schema === WATCHLIST_SCHEMA ? watchlistStoreVersion(root) : null);
    defineEntry(watchlists, name, normalizeWatchlistEntry(entry));
    if (Object.keys(watchlists).length >= MAX_WATCHLISTS) break;
  }
  return { schema: WATCHLIST_SCHEMA, version: WATCHLIST_SCHEMA_VERSION, watchlists };
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function assertWatchlistStoreBudget(watchlists: unknown): WatchlistStore {
  const store = normalizeWatchlistStore(watchlists);
  if (byteLength(JSON.stringify(store)) > MAX_WATCHLIST_STORE_BYTES) {
    throw new Error('Watchlist storage is full. Export and remove a watchlist before saving more.');
  }
  return store;
}

export function serializeWatchlistStore(watchlists: unknown): string {
  return JSON.stringify(assertWatchlistStoreBudget(watchlists));
}

function validateImportShape(raw: unknown): void {
  const value = plainRecord(raw);
  if (!value || value.schema !== WATCHLIST_SCHEMA) {
    throw new Error('This JSON file is not a WHOISleuth watchlist export.');
  }
  if (!plainRecord(value.watchlists)) {
    throw new Error('Expected a current WHOISleuth watchlist export.');
  }
}

export function mergeWatchlistStores(localRaw: unknown, importedRaw: unknown) {
  assertWorkspaceInputGraph(localRaw, 'Local watchlist store');
  assertWorkspaceInputGraph(importedRaw, 'Imported watchlist document');
  assertWorkspacePortableVersion(importedRaw, WATCHLIST_SCHEMA_VERSION, 'Imported watchlist document');
  validateImportShape(importedRaw);
  const importedVersion = watchlistStoreVersion(importedRaw);
  if (importedVersion !== null && importedVersion > WATCHLIST_SCHEMA_VERSION) {
    throw new Error(`This watchlist file uses newer schema ${importedVersion}. Update the app before importing it.`);
  }
  if (!WATCHLIST_EXPORT_SUPPORTED_VERSIONS.includes(Number(importedVersion))) {
    throw new Error('Expected a supported WHOISleuth watchlist export.');
  }
  const local = normalizeWatchlistStore(localRaw).watchlists;
  const source = watchlistMap(importedRaw) || {};
  const entries = Object.entries(source);
  let added = 0;
  let updated = 0;
  let skipped = Math.max(0, entries.length - MAX_WATCHLIST_INPUTS);
  for (const [rawName, rawEntry] of entries.slice(0, MAX_WATCHLIST_INPUTS)) {
    const name = normalizeWatchlistName(rawName);
    const entry = plainRecord(rawEntry);
    if (!name || !entry || !Array.isArray(entry.results) || entry.results.length > MAX_WATCHLIST_DOMAINS) {
      skipped++;
      continue;
    }
    assertHistoricalQuality(entry, importedVersion);
    const normalized = normalizeWatchlistEntry(entry);
    if (Object.prototype.hasOwnProperty.call(local, name)) {
      const localTime = local[name]!.updatedAt;
      const previous = local[name]!;
      const domainMetadata = mergeWatchDomainMetadata(previous.domainMetadata, Object.hasOwn(entry, 'domainMetadata') ? normalized.domainMetadata : []);
      if (!normalized.updatedAt || !localTime || normalized.updatedAt <= localTime) {
        if (JSON.stringify(domainMetadata) !== JSON.stringify(previous.domainMetadata)) { defineEntry(local, name, { ...previous, domainMetadata }); updated++; }
        else skipped++;
        continue;
      }
      normalized.domainMetadata = domainMetadata;
      updated++;
    }
    else if (Object.keys(local).length >= MAX_WATCHLISTS) { skipped++; continue; }
    else added++;
    defineEntry(local, name, normalized);
  }
  return { watchlists: local, added, updated, skipped };
}

export function buildWatchlistExport(
  watchlists: unknown,
  nowIso: unknown = new Date().toISOString(),
) {
  const exportedAt = normalizeExplicitIsoTimestamp(nowIso);
  if (!exportedAt) throw new Error('Watchlist export time must use an explicit timezone.');
  return {
    schema: WATCHLIST_SCHEMA,
    version: WATCHLIST_SCHEMA_VERSION,
    exportedAt,
    watchlists: normalizeWatchlistStore(watchlists).watchlists,
  };
}
