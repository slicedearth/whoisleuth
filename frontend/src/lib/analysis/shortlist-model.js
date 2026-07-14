// Pure browser-local shortlist model. The browser wrapper owns localStorage
// and downloads; this module owns schema migration, record normalization,
// import merging, and exact serialized-byte accounting.

import { compactWatchlistResults } from './watchlist-history.js';
import { normalizeRiskModelVersion } from './scoring.js';

export const SHORTLIST_SCHEMA = 'whoisleuth.shortlist';
export const SHORTLIST_SCHEMA_VERSION = 2;
export const MAX_SHORTLIST_ENTRIES = 500;
export const MAX_SHORTLIST_INPUTS = MAX_SHORTLIST_ENTRIES * 4;
export const MAX_SHORTLIST_STORE_BYTES = 1024 * 1024;
export const MAX_SHORTLIST_FACTORS = 20;

const MAX_FACTOR_LABEL_LENGTH = 200;
const MAX_TIMESTAMP_LENGTH = 64;
const CONTROL_RE = /[\x00-\x1f\x7f]/;
const EPOCH = new Date(0).toISOString();

function plainRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function isEnvelope(value) {
  return Boolean(value && value.schema === SHORTLIST_SCHEMA && Array.isArray(value.entries));
}

function entryList(raw) {
  if (Array.isArray(raw)) return raw;
  const value = plainRecord(raw);
  return isEnvelope(value) ? value.entries : null;
}

export function shortlistStoreVersion(raw) {
  if (Array.isArray(raw)) return 1;
  const value = plainRecord(raw);
  if (!value || !isEnvelope(value)) return null;
  return typeof value.version === 'number' && Number.isFinite(value.version) && value.version > 0
    ? value.version
    : null;
}

function score(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : null;
}

function timestamp(value, fallback = EPOCH) {
  if (typeof value !== 'string' || value.length > MAX_TIMESTAMP_LENGTH || CONTROL_RE.test(value)) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function factors(value) {
  if (!Array.isArray(value)) return [];
  const normalized = [];
  for (const item of value.slice(0, MAX_SHORTLIST_FACTORS * 4)) {
    const factor = plainRecord(item);
    if (!factor || typeof factor.label !== 'string' || CONTROL_RE.test(factor.label)) continue;
    const label = factor.label.slice(0, MAX_FACTOR_LABEL_LENGTH * 4).replace(/\s+/g, ' ').trim().slice(0, MAX_FACTOR_LABEL_LENGTH).trim();
    const points = typeof factor.points === 'number' && Number.isFinite(factor.points)
      ? Math.max(-100, Math.min(100, Math.round(factor.points)))
      : null;
    if (!label || points === null) continue;
    normalized.push({ label, points });
    if (normalized.length >= MAX_SHORTLIST_FACTORS) break;
  }
  return normalized;
}

/** Normalize one shortlist record while retaining only known compact fields. */
export function normalizeShortlistRecord(raw, options = {}) {
  const value = plainRecord(raw);
  if (!value) return null;
  const compact = compactWatchlistResults([value])[0];
  if (!compact) return null;
  const riskScore = score(value.riskScore);
  return {
    ...compact,
    availability: compact.availability ?? 'unknown',
    riskModelVersion: riskScore === null ? null : normalizeRiskModelVersion(value.riskModelVersion),
    riskScore,
    riskFactors: factors(value.riskFactors),
    opportunityScore: score(value.opportunityScore),
    savedAt: timestamp(value.savedAt, timestamp(options.fallbackTimestamp, EPOCH)),
  };
}

/** Legacy arrays remain readable but are not rewritten merely by loading them. */
export function normalizeShortlistStore(raw) {
  const source = entryList(raw);
  const byDomain = new Map();
  if (source) {
    for (const item of source.slice(0, MAX_SHORTLIST_INPUTS)) {
      const record = normalizeShortlistRecord(item);
      if (!record) continue;
      byDomain.set(record.domain, record);
      if (byDomain.size >= MAX_SHORTLIST_ENTRIES) break;
    }
  }
  return { schema: SHORTLIST_SCHEMA, version: SHORTLIST_SCHEMA_VERSION, entries: [...byDomain.values()] };
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

export function assertShortlistStoreBudget(records) {
  const store = normalizeShortlistStore(Array.isArray(records) ? records : entryList(records));
  if (byteLength(JSON.stringify(store)) > MAX_SHORTLIST_STORE_BYTES) {
    throw new Error('Shortlist storage is full. Export and remove entries before saving more.');
  }
  return store;
}

export function serializeShortlistStore(records) {
  return JSON.stringify(assertShortlistStoreBudget(records));
}

function validateImport(raw) {
  if (Array.isArray(raw)) return;
  const value = plainRecord(raw);
  if (!value || value.schema !== SHORTLIST_SCHEMA || !Array.isArray(value.entries)) {
    throw new Error('Expected a shortlist export or a legacy JSON array.');
  }
}

export function mergeShortlistStores(localRaw, importedRaw) {
  validateImport(importedRaw);
  const importedVersion = shortlistStoreVersion(importedRaw);
  if (importedVersion !== null && importedVersion > SHORTLIST_SCHEMA_VERSION) {
    throw new Error(`This shortlist file uses newer schema ${importedVersion}. Update the app before importing it.`);
  }
  const local = normalizeShortlistStore(localRaw).entries;
  const byDomain = new Map(local.map((record) => [record.domain, record]));
  const input = entryList(importedRaw) || [];
  const imported = new Map();
  let skipped = Math.max(0, input.length - MAX_SHORTLIST_INPUTS);
  for (const item of input.slice(0, MAX_SHORTLIST_INPUTS)) {
    const record = normalizeShortlistRecord(item);
    if (!record) { skipped++; continue; }
    if (imported.has(record.domain)) skipped++;
    imported.set(record.domain, record);
  }
  let added = 0;
  let updated = 0;
  for (const record of imported.values()) {
    if (byDomain.has(record.domain)) updated++;
    else if (byDomain.size >= MAX_SHORTLIST_ENTRIES) { skipped++; continue; }
    else added++;
    byDomain.set(record.domain, record);
  }
  return { entries: [...byDomain.values()], added, updated, skipped };
}

export function buildShortlistExport(records, nowIso = new Date().toISOString()) {
  return {
    ...normalizeShortlistStore(records),
    exportedAt: timestamp(nowIso, new Date().toISOString()),
  };
}
