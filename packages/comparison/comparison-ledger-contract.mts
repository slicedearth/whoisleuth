import {
  safeComparisonLedgerHref,
  stableComparisonLedgerId,
} from './comparison-ledger-serialization.mts';
import { projectComparisonLedgerJson } from './comparison-ledger-json.mts';

export { stableComparisonLedgerJson } from './comparison-ledger-json.mts';
export { safeComparisonLedgerHref, stableComparisonLedgerId } from './comparison-ledger-serialization.mts';

export const COMPARISON_LEDGER_MODES = Object.freeze([
  'publication',
  'entity',
  'temporal',
  'expectation',
  'membership',
  'reconciliation',
] as const);

export const COMPARISON_LEDGER_STATES = Object.freeze([
  'equivalent',
  'added',
  'removed',
  'different',
  'conflict',
  'collection_changed',
  'model_changed',
  'incomplete',
  'unavailable',
  'unsupported',
  'not_compared',
] as const);

export const MAX_COMPARISON_LEDGER_INDEX_ITEMS = 2_000;
export const MAX_COMPARISON_LEDGER_ENTITIES_PER_REQUEST = 20;
export const MAX_COMPARISON_LEDGER_DETAIL_ROWS = 256;
export const MAX_COMPARISON_LEDGER_LIMITATIONS = 8;
export const MAX_COMPARISON_LEDGER_STRING_LENGTH = 500;
export const MAX_COMPARISON_LEDGER_ID_LENGTH = 128;
export const MAX_COMPARISON_LEDGER_BULK_PAIRS = MAX_COMPARISON_LEDGER_INDEX_ITEMS;

const MAX_LABEL_LENGTH = 160;
const MAX_FIELD_LENGTH = 120;
const MAX_SOURCE_LENGTH = 120;
const MAX_LIMITATION_SCAN = MAX_COMPARISON_LEDGER_LIMITATIONS * 4;
const CONTROL_RE = /[\u0000-\u001f\u007f]/gu;
const CONTROL_TEST_RE = /[\u0000-\u001f\u007f]/u;

export type ComparisonLedgerMode = typeof COMPARISON_LEDGER_MODES[number];
export type ComparisonLedgerState = typeof COMPARISON_LEDGER_STATES[number];
export type ComparisonLedgerCompleteness = 'complete' | 'partial' | 'unavailable' | 'not_reported';
export type ComparisonLedgerOwnerType = 'case' | 'website_snapshot' | 'watchlist' | 'bulk_session_pair' | 'retained_artifact_pair';

export type ComparisonLedgerSide = Readonly<{
  source: string;
  sourceState: string;
  value: string | null;
  observedAt: string | null;
  publishedAt: string | null;
  retainedAt: string | null;
}>;

export type ComparisonLedgerRow = Readonly<{
  id: string;
  ownerId: string;
  entityId: string;
  mode: ComparisonLedgerMode;
  state: ComparisonLedgerState;
  field: string;
  family: string;
  earlier: ComparisonLedgerSide;
  later: ComparisonLedgerSide;
  completeness: ComparisonLedgerCompleteness;
  truncated: boolean;
  limitations: readonly string[];
  omittedLimitations: number;
}>;

export type ComparisonLedgerIndexSide = Readonly<Omit<ComparisonLedgerSide, 'value'>>;

export type ComparisonLedgerIndexItem = Readonly<{
  id: string;
  ownerType: ComparisonLedgerOwnerType;
  ownerId: string;
  entityId: string;
  label: string;
  mode: ComparisonLedgerMode;
  earlier: ComparisonLedgerIndexSide;
  later: ComparisonLedgerIndexSide;
  completeness: ComparisonLedgerCompleteness;
  truncated: boolean;
  limitations: readonly string[];
  omittedLimitations: number;
  sourceOmittedRows: number;
  ownerHref: string;
}>;

export type ComparisonLedgerIndex = Readonly<{
  items: readonly ComparisonLedgerIndexItem[];
  counts: Readonly<{
    candidates: number;
    retained: number;
  }>;
  omissions: Readonly<{
    inputRecords: number;
    inputScanTruncations: number;
    invalidRecords: number;
    duplicateRecords: number;
    indexItems: number;
    limitations: number;
    truncatedStrings: number;
  }>;
  truncated: boolean;
}>;

export type ComparisonLedgerDetails = Readonly<{
  selectedItems: readonly ComparisonLedgerIndexItem[];
  rows: readonly ComparisonLedgerRow[];
  totalRows: number;
  limitations: readonly string[];
  omissions: Readonly<{
    inputRecords: number;
    inputScanTruncations: number;
    invalidRecords: number;
    duplicateRecords: number;
    indexItems: number;
    entityRequests: number;
    duplicateEntityRequests: number;
    invalidEntityRequests: number;
    missingEntities: number;
    duplicateDetailRows: number;
    detailRows: number;
    sourceRows: number;
    limitations: number;
    truncatedStrings: number;
  }>;
  truncated: boolean;
}>;

export type ExplicitBulkSessionPair = Readonly<{
  earlierSessionId: unknown;
  laterSessionId: unknown;
}>;

export type ComparisonLedgerInput = Readonly<{
  cases?: unknown;
  websiteSnapshots?: unknown;
  watchlists?: unknown;
  bulkSessions?: unknown;
  bulkPairs?: unknown;
}>;

export type ComparisonLedgerDetailsRequest = Readonly<{
  itemIds?: unknown;
}>;

export type MutableComparisonLedgerCounters = {
  inputRecords: number;
  inputScanTruncations: number;
  invalidRecords: number;
  duplicateRecords: number;
  limitations: number;
  truncatedStrings: number;
};

export type RawComparisonLedgerSide = Readonly<{
  source: unknown;
  sourceState?: unknown;
  value?: unknown;
  observedAt?: unknown;
  publishedAt?: unknown;
  retainedAt?: unknown;
}>;

export type RawComparisonLedgerRow = Readonly<{
  comparisonId?: unknown;
  ownerId: unknown;
  entityId: unknown;
  mode: unknown;
  state: unknown;
  field: unknown;
  family: unknown;
  earlier: RawComparisonLedgerSide;
  later: RawComparisonLedgerSide;
  completeness?: unknown;
  truncated?: unknown;
  limitations?: unknown;
}>;

export type RawComparisonLedgerProjection = Readonly<{
  rows: readonly RawComparisonLedgerRow[];
  totalRows: number;
  sourceOmittedRows: number;
}>;

export type ComparisonLedgerCandidate = Readonly<{
  item: ComparisonLedgerIndexItem;
  buildDetails: () => RawComparisonLedgerProjection;
}>;

export type ComparisonLedgerRowCollector = {
  rows: RawComparisonLedgerRow[];
  totalRows: number;
  add: (row: RawComparisonLedgerRow) => void;
};

export function freshComparisonLedgerCounters(): MutableComparisonLedgerCounters {
  return { inputRecords: 0, inputScanTruncations: 0, invalidRecords: 0, duplicateRecords: 0, limitations: 0, truncatedStrings: 0 };
}

export function comparisonLedgerRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function comparisonLedgerInputArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

export function boundedComparisonLedgerText(
  value: unknown,
  maximum: number,
  counters?: MutableComparisonLedgerCounters,
  preserveWhitespace = false,
): string {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return '';
  const raw = String(value).replace(CONTROL_RE, ' ');
  const normalised = preserveWhitespace ? raw.trim() : raw.replace(/\s+/gu, ' ').trim();
  if (normalised.length > maximum) counters && (counters.truncatedStrings += 1);
  return normalised.slice(0, maximum).trim();
}

export function boundedComparisonLedgerId(
  value: unknown,
  counters?: MutableComparisonLedgerCounters,
): string {
  const text = boundedComparisonLedgerText(value, MAX_COMPARISON_LEDGER_ID_LENGTH * 2, counters);
  const safe = text.replace(/[^A-Za-z0-9:._-]+/gu, '-').replace(/^-+|-+$/gu, '');
  if (safe.length > MAX_COMPARISON_LEDGER_ID_LENGTH) counters && (counters.truncatedStrings += 1);
  return safe.slice(0, MAX_COMPARISON_LEDGER_ID_LENGTH);
}

function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64 || CONTROL_TEST_RE.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normaliseCompleteness(value: unknown): ComparisonLedgerCompleteness {
  return value === 'complete' || value === 'partial' || value === 'unavailable' || value === 'not_reported'
    ? value
    : 'not_reported';
}

export function boundedComparisonLedgerLimitations(
  value: unknown,
  counters: MutableComparisonLedgerCounters,
): Readonly<{ values: readonly string[]; omitted: number }> {
  const raw = Array.isArray(value) ? value : [];
  const unscanned = Math.max(0, raw.length - MAX_LIMITATION_SCAN);
  const seen = new Set<string>();
  const all: string[] = [];
  for (const item of raw.slice(0, MAX_LIMITATION_SCAN)) {
    const entry = boundedComparisonLedgerText(item, MAX_COMPARISON_LEDGER_STRING_LENGTH, counters);
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    all.push(entry);
  }
  const values = all.slice(0, MAX_COMPARISON_LEDGER_LIMITATIONS);
  const omitted = unscanned + Math.max(0, all.length - values.length);
  counters.limitations += omitted;
  return { values: Object.freeze(values), omitted };
}

function exactValue(
  value: unknown,
  counters: MutableComparisonLedgerCounters,
): Readonly<{ value: string | null; truncated: boolean }> {
  if (value === null || value === undefined) return { value: null, truncated: false };
  const traversal = typeof value === 'string'
    ? { value, truncated: false }
    : projectComparisonLedgerJson(value);
  const before = counters.truncatedStrings;
  if (traversal.truncated) counters.truncatedStrings += 1;
  const projected = boundedComparisonLedgerText(traversal.value, MAX_COMPARISON_LEDGER_STRING_LENGTH, counters, true);
  return { value: projected || null, truncated: counters.truncatedStrings > before };
}

function sourceSide(
  raw: RawComparisonLedgerSide,
  counters: MutableComparisonLedgerCounters,
): Readonly<{ side: ComparisonLedgerSide; truncated: boolean }> {
  const projected = exactValue(raw.value, counters);
  return {
    side: Object.freeze({
      source: boundedComparisonLedgerText(raw.source, MAX_SOURCE_LENGTH, counters) || 'Not recorded',
      sourceState: boundedComparisonLedgerText(raw.sourceState, 64, counters) || 'not_reported',
      value: projected.value,
      observedAt: timestamp(raw.observedAt),
      publishedAt: timestamp(raw.publishedAt),
      retainedAt: timestamp(raw.retainedAt),
    }),
    truncated: projected.truncated,
  };
}

function isMode(value: unknown): value is ComparisonLedgerMode {
  return typeof value === 'string' && (COMPARISON_LEDGER_MODES as readonly string[]).includes(value);
}

function isState(value: unknown): value is ComparisonLedgerState {
  return typeof value === 'string' && (COMPARISON_LEDGER_STATES as readonly string[]).includes(value);
}

export function normaliseComparisonLedgerRowWithCounters(
  raw: unknown,
  counters: MutableComparisonLedgerCounters,
): ComparisonLedgerRow | null {
  const item = comparisonLedgerRecord(raw);
  const earlierRaw = comparisonLedgerRecord(item?.earlier);
  const laterRaw = comparisonLedgerRecord(item?.later);
  const ownerId = boundedComparisonLedgerId(item?.ownerId, counters);
  const entityId = boundedComparisonLedgerId(item?.entityId, counters);
  const mode = item?.mode;
  const state = item?.state;
  const field = boundedComparisonLedgerText(item?.field, MAX_FIELD_LENGTH, counters);
  const family = boundedComparisonLedgerText(item?.family, MAX_FIELD_LENGTH, counters);
  if (!item || !earlierRaw || !laterRaw || !ownerId || !entityId || !isMode(mode) || !isState(state) || !field || !family) {
    return null;
  }
  const earlier = sourceSide(earlierRaw as RawComparisonLedgerSide, counters);
  const later = sourceSide(laterRaw as RawComparisonLedgerSide, counters);
  const rowLimitations = boundedComparisonLedgerLimitations(item.limitations, counters);
  const truncated = item.truncated === true || earlier.truncated || later.truncated || rowLimitations.omitted > 0;
  const completeness = normaliseCompleteness(item.completeness);
  const comparisonId = boundedComparisonLedgerId(item.comparisonId, counters);
  const id = stableComparisonLedgerId('ledger-row', [
    comparisonId, ownerId, entityId, mode, state, family, field,
    earlier.side.source, earlier.side.sourceState, earlier.side.value,
    earlier.side.observedAt, earlier.side.publishedAt, earlier.side.retainedAt,
    later.side.source, later.side.sourceState, later.side.value,
    later.side.observedAt, later.side.publishedAt, later.side.retainedAt,
    completeness, truncated, rowLimitations.omitted, ...rowLimitations.values,
  ]);
  return Object.freeze({
    id,
    ownerId,
    entityId,
    mode,
    state,
    field,
    family,
    earlier: earlier.side,
    later: later.side,
    completeness,
    truncated,
    limitations: rowLimitations.values,
    omittedLimitations: rowLimitations.omitted,
  });
}

export function normaliseComparisonLedgerRow(raw: unknown): ComparisonLedgerRow | null {
  return normaliseComparisonLedgerRowWithCounters(raw, freshComparisonLedgerCounters());
}

export function comparisonLedgerCollector(): ComparisonLedgerRowCollector {
  const output: ComparisonLedgerRowCollector = {
    rows: [],
    totalRows: 0,
    add(row) {
      output.totalRows += 1;
      if (output.rows.length < MAX_COMPARISON_LEDGER_DETAIL_ROWS) output.rows.push(row);
    },
  };
  return output;
}

export function comparisonLedgerValuePresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '' && value.trim() !== '—';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export function comparisonLedgerValueState(
  before: unknown,
  after: unknown,
  removalAllowed: boolean,
): ComparisonLedgerState {
  if (!comparisonLedgerValuePresent(before) && comparisonLedgerValuePresent(after)) return 'added';
  if (comparisonLedgerValuePresent(before) && !comparisonLedgerValuePresent(after)) return removalAllowed ? 'removed' : 'incomplete';
  return 'different';
}

function indexSide(
  raw: RawComparisonLedgerSide,
  counters: MutableComparisonLedgerCounters,
): ComparisonLedgerIndexSide {
  return Object.freeze({
    source: boundedComparisonLedgerText(raw.source, MAX_SOURCE_LENGTH, counters) || 'Not recorded',
    sourceState: boundedComparisonLedgerText(raw.sourceState, 64, counters) || 'not_reported',
    observedAt: timestamp(raw.observedAt),
    publishedAt: timestamp(raw.publishedAt),
    retainedAt: timestamp(raw.retainedAt),
  });
}

export function makeComparisonLedgerCandidate(
  raw: Readonly<{
    idParts: readonly unknown[];
    ownerType: ComparisonLedgerOwnerType;
    ownerId: unknown;
    entityId: unknown;
    label: unknown;
    mode: ComparisonLedgerMode;
    earlier: RawComparisonLedgerSide;
    later: RawComparisonLedgerSide;
    completeness: ComparisonLedgerCompleteness;
    truncated: boolean;
    limitations: readonly string[];
    sourceOmittedRows?: number;
    ownerHref: unknown;
    buildDetails: () => RawComparisonLedgerProjection;
  }>,
  counters: MutableComparisonLedgerCounters,
): ComparisonLedgerCandidate | null {
  const ownerId = boundedComparisonLedgerId(raw.ownerId, counters);
  const entityId = boundedComparisonLedgerId(raw.entityId, counters);
  const label = boundedComparisonLedgerText(raw.label, MAX_LABEL_LENGTH, counters);
  if (!ownerId || !entityId || !label) return null;
  const projectedLimitations = boundedComparisonLedgerLimitations(raw.limitations, counters);
  const id = stableComparisonLedgerId(`ledger-${raw.ownerType}`, raw.idParts);
  const item: ComparisonLedgerIndexItem = Object.freeze({
    id,
    ownerType: raw.ownerType,
    ownerId,
    entityId,
    label,
    mode: raw.mode,
    earlier: indexSide(raw.earlier, counters),
    later: indexSide(raw.later, counters),
    completeness: raw.completeness,
    truncated: raw.truncated || projectedLimitations.omitted > 0,
    limitations: projectedLimitations.values,
    omittedLimitations: projectedLimitations.omitted,
    sourceOmittedRows: Math.max(0, Math.trunc(Number(raw.sourceOmittedRows) || 0)),
    ownerHref: safeComparisonLedgerHref(raw.ownerHref),
  });
  return Object.freeze({ item, buildDetails: raw.buildDetails });
}

export function validComparisonLedgerRequestId(value: unknown): boolean {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_COMPARISON_LEDGER_ID_LENGTH
    && !CONTROL_TEST_RE.test(value)
    && boundedComparisonLedgerId(value) === value;
}
