// Pure browser-local watchlist collection model. Watchlist history owns the
// evidence shape and diff semantics; this module owns collection names, schema
// migration, import merging, and exact serialized-byte accounting.

import { MAX_WATCHLIST_DOMAINS, normalizeWatchlistEntry } from './watchlist-history.ts';
import { normalizeExplicitIsoTimestamp } from '../../../../packages/evidence/observation.mts';

export const WATCHLIST_SCHEMA_VERSION = 2;
export const WATCHLIST_SCHEMA = 'whoisleuth.watchlists';
export const MAX_WATCHLISTS = 100;
export const MAX_WATCHLIST_INPUTS = MAX_WATCHLISTS * 4;
export const MAX_WATCHLIST_NAME_LENGTH = 100;
// Cases and other analyst stores share the same origin quota. A two-megabyte
// ceiling accommodates practical Bulk results while failing before the browser
// turns storage pressure into an opaque quota exception.
export const MAX_WATCHLIST_STORE_BYTES = 2 * 1024 * 1024;

const BLOCKED_NAMES = new Set(['__proto__', 'prototype', 'constructor']);
const CONTROL_RE = /[\x00-\x1f\x7f]/;

export type WatchlistEntry = ReturnType<typeof normalizeWatchlistEntry>;
export type WatchlistCollection = Record<string, WatchlistEntry>;
export type WatchlistStore = {
  schema: typeof WATCHLIST_SCHEMA;
  version: typeof WATCHLIST_SCHEMA_VERSION;
  watchlists: WatchlistCollection;
};

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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
  if (!value || !isEnvelope(value)) return value ? 1 : null;
  return typeof value.version === 'number' && Number.isFinite(value.version) && value.version > 0 ? value.version : null;
}

function defineEntry(
  target: WatchlistCollection,
  name: string,
  entry: WatchlistEntry,
): void {
  Object.defineProperty(target, name, { value: entry, writable: true, enumerable: true, configurable: true });
}

export function normalizeWatchlistStore(raw: unknown): WatchlistStore {
  const source = watchlistMap(raw);
  const legacyTimestamps = watchlistStoreVersion(raw) === 1;
  const watchlists: WatchlistCollection = {};
  if (!source) return { schema: WATCHLIST_SCHEMA, version: WATCHLIST_SCHEMA_VERSION, watchlists };
  for (const [rawName, rawEntry] of Object.entries(source).slice(0, MAX_WATCHLIST_INPUTS)) {
    const name = normalizeWatchlistName(rawName);
    const entry = plainRecord(rawEntry);
    if (!name || !entry || !Array.isArray(entry.results) || entry.results.length > MAX_WATCHLIST_DOMAINS) continue;
    defineEntry(watchlists, name, normalizeWatchlistEntry(entry, { legacyTimestamps }));
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
  validateImportShape(importedRaw);
  const importedVersion = watchlistStoreVersion(importedRaw);
  if (importedVersion !== null && importedVersion > WATCHLIST_SCHEMA_VERSION) {
    throw new Error(`This watchlist file uses newer schema ${importedVersion}. Update the app before importing it.`);
  }
  if (importedVersion !== WATCHLIST_SCHEMA_VERSION) {
    throw new Error(`Expected a WHOISleuth watchlist export using schema ${WATCHLIST_SCHEMA_VERSION}.`);
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
    if (Object.prototype.hasOwnProperty.call(local, name)) updated++;
    else if (Object.keys(local).length >= MAX_WATCHLISTS) { skipped++; continue; }
    else added++;
    defineEntry(local, name, normalizeWatchlistEntry(entry));
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
