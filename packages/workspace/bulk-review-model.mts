import { normalizeDomain } from '../cases/case-model.mts';
import { normalizeBulkPresentationSortKey } from './bulk-sort.mts';
import type { BulkSortDirection, BulkSortKey } from './bulk-sort.mts';
import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';
import { assertWorkspaceDeclaredVersion, assertWorkspaceInputGraph, assertWorkspacePortableVersion, ordinaryWorkspaceRecord } from './hostile-input.mts';
import {
  BULK_REVIEW_SCHEMA,
  BULK_REVIEW_SCHEMA_VERSION,
  MAX_BULK_REVIEW_NAME_LENGTH,
  MAX_BULK_REVIEW_PRESETS,
  MAX_BULK_REVIEW_ROWS,
  MAX_BULK_REVIEW_STORE_BYTES,
} from '../contracts/workspace-portability.mts';

export {
  BULK_REVIEW_SCHEMA,
  BULK_REVIEW_SCHEMA_VERSION,
  MAX_BULK_REVIEW_NAME_LENGTH,
  MAX_BULK_REVIEW_PRESETS,
  MAX_BULK_REVIEW_ROWS,
  MAX_BULK_REVIEW_STORE_BYTES,
} from '../contracts/workspace-portability.mts';

export const BULK_REVIEW_STATES = ['unreviewed', 'reviewing', 'reviewed', 'deferred'] as const;
export type BulkReviewState = typeof BULK_REVIEW_STATES[number];
export type BulkReviewFilter = '' | BulkReviewState;

export type BulkReviewPresetView = {
  primaryFilter: string;
  mutationFilter: string;
  signalFilters: string[];
  sourceFilter: string;
  lifecycleFilter: string;
  ageFilter: string;
  mailFilter: string;
  registrarFilter: string;
  caseDispositionFilter: string;
  reviewStateFilter: BulkReviewFilter;
  groupBy: string;
  sortKey: BulkSortKey;
  sortDirection: BulkSortDirection;
};

export type BulkReviewPreset = {
  kind: 'preset';
  id: string;
  name: string;
  view: BulkReviewPresetView;
  createdAt: string;
  updatedAt: string;
};

export type BulkReviewRow = {
  kind: 'row';
  id: string;
  domain: string;
  state: BulkReviewState;
  updatedAt: string;
};

export type BulkReviewRecord = BulkReviewPreset | BulkReviewRow;
export type BulkReviewStore = {
  schema: typeof BULK_REVIEW_SCHEMA;
  version: typeof BULK_REVIEW_SCHEMA_VERSION;
  presets: BulkReviewPreset[];
  rows: BulkReviewRow[];
};

const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/u;
const PRIMARY_FILTERS = new Set(['all', 'available', 'registered', 'high_risk', 'trusted', 'profile_unevaluated', 'errors']);
const SOURCE_FILTERS = new Set(['', 'complete', 'limited', 'failed']);
const LIFECYCLE_FILTERS = new Set(['', 'new', 'expiring', 'aged', 'unknown']);
const AGE_FILTERS = new Set(['', '7d', '30d', '90d', '365d', 'older', 'unknown']);
const MAIL_FILTERS = new Set(['', 'mx', 'no_mx', 'spf_missing', 'dmarc_missing', 'unknown']);
const GROUPS = new Set(['', 'registrar', 'nameserver', 'source_state', 'lifecycle', 'mail']);
const SORT_KEYS = new Set<BulkSortKey>(['domain', 'availability', 'risk', 'opportunity', 'activity', 'registrar', 'mutation']);
const REVIEW_STATES = new Set<string>(BULK_REVIEW_STATES);
const CASE_DISPOSITIONS = new Set(['', 'untracked', 'unreviewed', 'suspicious', 'confirmed_abuse', 'false_positive', 'expected', 'closed_no_action']);
const SIGNAL_FILTERS = new Set(['favicon', 'password', 'phishing', 'asset_reuse', 'idn']);

function record(value: unknown): Record<string, unknown> {
  return ordinaryWorkspaceRecord(value, 'Bulk-review input') ?? {};
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || CONTROL_RE.test(value)) return '';
  return value.trim().slice(0, maximum);
}

function timestamp(value: unknown, fallback: string): string {
  return normalizeExplicitIsoTimestamp(value) ?? fallback;
}

function safeId(value: unknown): string {
  return typeof value === 'string' && SAFE_ID_RE.test(value) ? value : '';
}

function id(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function setValue(value: unknown, values: ReadonlySet<string>, fallback = ''): string {
  return typeof value === 'string' && values.has(value) ? value : fallback;
}

function normalizeView(raw: unknown): BulkReviewPresetView {
  const value = record(raw);
  const signalFilters = Array.isArray(value.signalFilters)
    ? [...new Set(value.signalFilters.filter((item): item is string => typeof item === 'string' && SIGNAL_FILTERS.has(item)))].slice(0, SIGNAL_FILTERS.size)
    : [];
  const sortKey = typeof value.sortKey === 'string' && SORT_KEYS.has(value.sortKey as BulkSortKey)
    ? normalizeBulkPresentationSortKey(value.sortKey as BulkSortKey)
    : 'risk';
  return {
    primaryFilter: setValue(value.primaryFilter, PRIMARY_FILTERS, 'all'),
    mutationFilter: text(value.mutationFilter, 60),
    signalFilters,
    sourceFilter: setValue(value.sourceFilter, SOURCE_FILTERS),
    lifecycleFilter: setValue(value.lifecycleFilter, LIFECYCLE_FILTERS),
    ageFilter: setValue(value.ageFilter, AGE_FILTERS),
    mailFilter: setValue(value.mailFilter, MAIL_FILTERS),
    registrarFilter: text(value.registrarFilter, 200),
    caseDispositionFilter: setValue(value.caseDispositionFilter, CASE_DISPOSITIONS),
    reviewStateFilter: setValue(value.reviewStateFilter, new Set(['', ...BULK_REVIEW_STATES])) as BulkReviewFilter,
    groupBy: setValue(value.groupBy, GROUPS),
    sortKey,
    sortDirection: value.sortDirection === 1 ? 1 : -1,
  };
}

function normalizePreset(raw: unknown, fallback: string): BulkReviewPreset | null {
  const value = record(raw);
  const name = text(value.name, MAX_BULK_REVIEW_NAME_LENGTH);
  if (!name) return null;
  const createdAt = timestamp(value.createdAt, fallback);
  return {
    kind: 'preset',
    id: safeId(value.id) || id('bulk-view'),
    name,
    view: normalizeView(value.view),
    createdAt,
    updatedAt: timestamp(value.updatedAt, createdAt),
  };
}

function normalizeRow(raw: unknown, fallback: string): BulkReviewRow | null {
  const value = record(raw);
  const domain = normalizeDomain(value.domain);
  if (!domain) return null;
  return {
    kind: 'row',
    id: `d-${domain}`,
    domain,
    state: setValue(value.state, REVIEW_STATES, 'unreviewed') as BulkReviewState,
    updatedAt: timestamp(value.updatedAt, fallback),
  };
}

function sourceLists(raw: unknown): { presets: unknown[]; rows: unknown[] } {
  if (Array.isArray(raw)) {
    return {
      presets: raw.filter((item) => record(item).kind === 'preset'),
      rows: raw.filter((item) => record(item).kind === 'row'),
    };
  }
  const value = record(raw);
  return {
    presets: Array.isArray(value.presets) ? value.presets : [],
    rows: Array.isArray(value.rows) ? value.rows : [],
  };
}

export function normalizeBulkReviewStore(raw: unknown): BulkReviewStore {
  assertWorkspaceInputGraph(raw, 'Bulk-review store');
  assertWorkspaceDeclaredVersion(raw, 'Bulk-review store');
  const fallback = new Date(0).toISOString();
  const source = sourceLists(raw);
  const presets = new Map<string, BulkReviewPreset>();
  for (const candidate of source.presets.slice(0, MAX_BULK_REVIEW_PRESETS * 4)) {
    const normalized = normalizePreset(candidate, fallback);
    if (!normalized) continue;
    const existing = presets.get(normalized.id);
    if (!existing || normalized.updatedAt >= existing.updatedAt) presets.set(normalized.id, normalized);
  }
  const rows = new Map<string, BulkReviewRow>();
  for (const candidate of source.rows.slice(0, MAX_BULK_REVIEW_ROWS * 2)) {
    const normalized = normalizeRow(candidate, fallback);
    if (!normalized) continue;
    const existing = rows.get(normalized.domain);
    if (!existing || normalized.updatedAt >= existing.updatedAt) rows.set(normalized.domain, normalized);
  }
  return {
    schema: BULK_REVIEW_SCHEMA,
    version: BULK_REVIEW_SCHEMA_VERSION,
    presets: [...presets.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
      .slice(0, MAX_BULK_REVIEW_PRESETS),
    rows: [...rows.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.domain.localeCompare(right.domain))
      .slice(0, MAX_BULK_REVIEW_ROWS),
  };
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function enforceBulkReviewBudget(raw: unknown): BulkReviewStore {
  const store = normalizeBulkReviewStore(raw);
  while (byteLength(JSON.stringify(store)) > MAX_BULK_REVIEW_STORE_BYTES && store.rows.length) store.rows.pop();
  while (byteLength(JSON.stringify(store)) > MAX_BULK_REVIEW_STORE_BYTES && store.presets.length > 1) store.presets.pop();
  if (byteLength(JSON.stringify(store)) > MAX_BULK_REVIEW_STORE_BYTES) {
    throw new Error('Bulk review preferences exceed the browser-local storage limit.');
  }
  return store;
}

export function bulkReviewStoreVersion(raw: unknown): number | null {
  const value = record(raw);
  return typeof value.version === 'number' && Number.isSafeInteger(value.version) && value.version > 0
    ? value.version
    : Array.isArray(raw) ? 1 : null;
}

export function serializeBulkReviewStore(raw: unknown): string {
  return JSON.stringify(enforceBulkReviewBudget(raw));
}

export function upsertBulkReviewPreset(raw: unknown, input: unknown, now = new Date().toISOString()): BulkReviewStore {
  const store = normalizeBulkReviewStore(raw);
  const candidate = normalizePreset({ ...record(input), updatedAt: now }, now);
  if (!candidate) throw new Error('Enter a name before saving the Bulk review view.');
  const existing = store.presets.find((item) => item.id === candidate.id);
  candidate.createdAt = existing?.createdAt ?? candidate.createdAt;
  return enforceBulkReviewBudget({
    ...store,
    presets: [candidate, ...store.presets.filter((item) => item.id !== candidate.id)],
  });
}

export function removeBulkReviewPreset(raw: unknown, presetId: string): BulkReviewStore {
  const store = normalizeBulkReviewStore(raw);
  return { ...store, presets: store.presets.filter((item) => item.id !== presetId) };
}

export function setBulkReviewRowState(
  raw: unknown,
  domain: unknown,
  state: unknown,
  now = new Date().toISOString(),
): BulkReviewStore {
  const store = normalizeBulkReviewStore(raw);
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedDomain || typeof state !== 'string' || !REVIEW_STATES.has(state)) {
    throw new Error('Choose a valid domain review state.');
  }
  const row = normalizeRow({ domain: normalizedDomain, state, updatedAt: now }, now);
  if (!row) throw new Error('Choose a valid domain review state.');
  return enforceBulkReviewBudget({
    ...store,
    rows: state === 'unreviewed'
      ? store.rows.filter((item) => item.domain !== normalizedDomain)
      : [row, ...store.rows.filter((item) => item.domain !== normalizedDomain)],
  });
}

export function bulkReviewRecords(raw: unknown): BulkReviewRecord[] {
  const store = normalizeBulkReviewStore(raw);
  return [...store.presets, ...store.rows];
}

export function bulkReviewStoreFromRecords(records: readonly unknown[]): BulkReviewStore {
  return normalizeBulkReviewStore(records);
}

export function buildBulkReviewExport(raw: unknown): BulkReviewStore {
  return enforceBulkReviewBudget(raw);
}

export function mergeBulkReviewStores(
  localRaw: unknown,
  importedRaw: unknown,
): { store: BulkReviewStore; added: number; updated: number; skipped: number } {
  assertWorkspaceInputGraph(localRaw, 'Local Bulk-review store');
  assertWorkspaceInputGraph(importedRaw, 'Imported Bulk-review document');
  assertWorkspacePortableVersion(importedRaw, BULK_REVIEW_SCHEMA_VERSION, 'Imported Bulk-review document');
  const importedRecord = record(importedRaw);
  if (importedRecord.schema !== BULK_REVIEW_SCHEMA) {
    throw new Error('This file is not a WHOISleuth Bulk review export.');
  }
  if (importedRecord.version !== BULK_REVIEW_SCHEMA_VERSION) {
    if (typeof importedRecord.version === 'number' && importedRecord.version > BULK_REVIEW_SCHEMA_VERSION) {
      throw new Error(`This Bulk review export uses newer schema ${importedRecord.version}. Update the app before importing it.`);
    }
    throw new Error(`Expected Bulk review schema ${BULK_REVIEW_SCHEMA_VERSION}.`);
  }

  const local = normalizeBulkReviewStore(localRaw);
  const imported = normalizeBulkReviewStore(importedRaw);
  const presets = new Map(local.presets.map((item) => [item.id, item]));
  const rows = new Map(local.rows.map((item) => [item.domain, item]));
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const candidate of imported.presets) {
    const existing = presets.get(candidate.id);
    if (!existing) {
      presets.set(candidate.id, candidate);
      added += 1;
    } else if (candidate.updatedAt > existing.updatedAt) {
      presets.set(candidate.id, candidate);
      updated += 1;
    } else {
      skipped += 1;
    }
  }
  for (const candidate of imported.rows) {
    const existing = rows.get(candidate.domain);
    if (!existing) {
      rows.set(candidate.domain, candidate);
      added += 1;
    } else if (candidate.updatedAt > existing.updatedAt) {
      rows.set(candidate.domain, candidate);
      updated += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    store: enforceBulkReviewBudget({
      schema: BULK_REVIEW_SCHEMA,
      version: BULK_REVIEW_SCHEMA_VERSION,
      presets: [...presets.values()],
      rows: [...rows.values()],
    }),
    added,
    updated,
    skipped,
  };
}
