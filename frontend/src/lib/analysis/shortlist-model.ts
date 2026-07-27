// Pure browser-local shortlist model. The browser wrapper owns persistence
// and downloads; this module owns schema migration, record normalization,
// import merging, and exact serialized-byte accounting.

import { compactWatchlistResults } from './watchlist-history.ts';
import { normalizeRiskModelVersion } from './scoring.ts';

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

export type ShortlistFactor = {
  label: string;
  points: number;
};
export type ShortlistRecord = {
  domain: string;
  availability: string;
  mutationTypes: string[];
  riskModelVersion: number | null;
  riskScore: number | null;
  riskFactors: ShortlistFactor[];
  opportunityScore: number | null;
  savedAt: string;
  [key: string]: unknown;
};
export type ShortlistStore = {
  schema: typeof SHORTLIST_SCHEMA;
  version: typeof SHORTLIST_SCHEMA_VERSION;
  entries: ShortlistRecord[];
};
type NormalizeShortlistOptions = {
  fallbackTimestamp?: unknown;
};

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isEnvelope(
  value: Record<string, unknown> | null,
): value is Record<string, unknown> & { entries: unknown[] } {
  return Boolean(value && value.schema === SHORTLIST_SCHEMA && Array.isArray(value.entries));
}

function entryList(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  const value = plainRecord(raw);
  return isEnvelope(value) ? value.entries : null;
}

export function shortlistStoreVersion(raw: unknown): number | null {
  if (Array.isArray(raw)) return 1;
  const value = plainRecord(raw);
  if (!value || !isEnvelope(value)) return null;
  return typeof value.version === 'number' && Number.isFinite(value.version) && value.version > 0
    ? value.version
    : null;
}

function score(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : null;
}

function timestamp(value: unknown, fallback: string = EPOCH): string {
  if (typeof value !== 'string' || value.length > MAX_TIMESTAMP_LENGTH || CONTROL_RE.test(value)) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function factors(value: unknown): ShortlistFactor[] {
  if (!Array.isArray(value)) return [];
  const normalized: ShortlistFactor[] = [];
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
export function normalizeShortlistRecord(
  raw: unknown,
  options: NormalizeShortlistOptions = {},
): ShortlistRecord | null {
  const value = plainRecord(raw);
  if (!value) return null;
  const compact = compactWatchlistResults([value])[0];
  if (!compact) return null;
  const riskScore = score(value.riskScore);
  return {
    ...compact,
    availability: typeof compact.availability === 'string' ? compact.availability : 'unknown',
    riskModelVersion: riskScore === null ? null : normalizeRiskModelVersion(value.riskModelVersion),
    riskScore,
    riskFactors: factors(value.riskFactors),
    opportunityScore: score(value.opportunityScore),
    savedAt: timestamp(value.savedAt, timestamp(options.fallbackTimestamp, EPOCH)),
  };
}

/** Normalize an internal record collection or current stored envelope. */
export function normalizeShortlistStore(raw: unknown): ShortlistStore {
  const source = entryList(raw);
  const byDomain = new Map<string, ShortlistRecord>();
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

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function assertShortlistStoreBudget(records: unknown): ShortlistStore {
  const store = normalizeShortlistStore(Array.isArray(records) ? records : entryList(records));
  if (byteLength(JSON.stringify(store)) > MAX_SHORTLIST_STORE_BYTES) {
    throw new Error('Shortlist storage is full. Export and remove entries before saving more.');
  }
  return store;
}

export function serializeShortlistStore(records: unknown): string {
  return JSON.stringify(assertShortlistStoreBudget(records));
}

function validateImport(raw: unknown): void {
  const value = plainRecord(raw);
  if (!value || value.schema !== SHORTLIST_SCHEMA || !Array.isArray(value.entries)) {
    throw new Error('Expected a current WHOISleuth shortlist export.');
  }
}

export function mergeShortlistStores(localRaw: unknown, importedRaw: unknown) {
  validateImport(importedRaw);
  const importedVersion = shortlistStoreVersion(importedRaw);
  if (importedVersion !== null && importedVersion > SHORTLIST_SCHEMA_VERSION) {
    throw new Error(`This shortlist file uses newer schema ${importedVersion}. Update the app before importing it.`);
  }
  if (importedVersion !== SHORTLIST_SCHEMA_VERSION) {
    throw new Error(`Expected a WHOISleuth shortlist export using schema ${SHORTLIST_SCHEMA_VERSION}.`);
  }
  const local = normalizeShortlistStore(localRaw).entries;
  const byDomain = new Map(local.map((record) => [record.domain, record]));
  const input = entryList(importedRaw) || [];
  const imported = new Map<string, ShortlistRecord>();
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

export function buildShortlistExport(records: unknown, nowIso: unknown = new Date().toISOString()) {
  return {
    ...normalizeShortlistStore(records),
    exportedAt: timestamp(nowIso, new Date().toISOString()),
  };
}
