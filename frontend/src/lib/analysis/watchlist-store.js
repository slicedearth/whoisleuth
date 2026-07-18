// Pure browser-local watchlist collection model. Watchlist-history.js owns the
// evidence shape and diff semantics; this module owns collection names, schema
// migration, import merging, and exact serialized-byte accounting.

import { MAX_WATCHLIST_DOMAINS, normalizeWatchlistEntry } from './watchlist-history.js';

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

function plainRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function isEnvelope(value) {
  return Boolean(value && value.schema === WATCHLIST_SCHEMA && plainRecord(value.watchlists));
}

export function normalizeWatchlistName(value) {
  if (typeof value !== 'string' || CONTROL_RE.test(value)) return '';
  const name = value.trim();
  if (name.length > MAX_WATCHLIST_NAME_LENGTH) return '';
  return name && !BLOCKED_NAMES.has(name.toLowerCase()) ? name : '';
}

function watchlistMap(raw) {
  const value = plainRecord(raw);
  if (!value) return null;
  return isEnvelope(value) ? plainRecord(value.watchlists) : value;
}

export function watchlistStoreVersion(raw) {
  const value = plainRecord(raw);
  if (!value || !isEnvelope(value)) return value ? 1 : null;
  return typeof value.version === 'number' && Number.isFinite(value.version) && value.version > 0 ? value.version : null;
}

function defineEntry(target, name, entry) {
  Object.defineProperty(target, name, { value: entry, writable: true, enumerable: true, configurable: true });
}

export function normalizeWatchlistStore(raw) {
  const source = watchlistMap(raw);
  const watchlists = {};
  if (!source) return { schema: WATCHLIST_SCHEMA, version: WATCHLIST_SCHEMA_VERSION, watchlists };
  for (const [rawName, rawEntry] of Object.entries(source).slice(0, MAX_WATCHLIST_INPUTS)) {
    const name = normalizeWatchlistName(rawName);
    const entry = plainRecord(rawEntry);
    if (!name || !entry || !Array.isArray(entry.results) || entry.results.length > MAX_WATCHLIST_DOMAINS) continue;
    defineEntry(watchlists, name, normalizeWatchlistEntry(entry));
    if (Object.keys(watchlists).length >= MAX_WATCHLISTS) break;
  }
  return { schema: WATCHLIST_SCHEMA, version: WATCHLIST_SCHEMA_VERSION, watchlists };
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

export function assertWatchlistStoreBudget(watchlists) {
  const store = normalizeWatchlistStore(watchlists);
  if (byteLength(JSON.stringify(store)) > MAX_WATCHLIST_STORE_BYTES) {
    throw new Error('Watchlist storage is full. Export and remove a watchlist before saving more.');
  }
  return store;
}

export function serializeWatchlistStore(watchlists) {
  return JSON.stringify(assertWatchlistStoreBudget(watchlists));
}

function validateImportShape(raw) {
  const value = plainRecord(raw);
  if (!value || value.schema !== WATCHLIST_SCHEMA) {
    throw new Error('This JSON file is not a WHOISleuth watchlist export.');
  }
  if (!plainRecord(value.watchlists)) {
    throw new Error('Expected a current WHOISleuth watchlist export.');
  }
}

export function mergeWatchlistStores(localRaw, importedRaw) {
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

export function buildWatchlistExport(watchlists, nowIso = new Date().toISOString()) {
  const parsed = typeof nowIso === 'string' ? Date.parse(nowIso) : Number.NaN;
  return {
    schema: WATCHLIST_SCHEMA,
    version: WATCHLIST_SCHEMA_VERSION,
    exportedAt: Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString(),
    watchlists: normalizeWatchlistStore(watchlists).watchlists,
  };
}
