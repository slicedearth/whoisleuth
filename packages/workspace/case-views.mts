import {
  CASE_VIEWS_SCHEMA, CASE_VIEWS_VERSION, CASE_VIEW_SORTS, MAX_CASE_VIEWS,
  MAX_CASE_VIEWS_BYTES, MAX_CASE_VIEW_NAME_LENGTH, MAX_CASE_VIEW_SEARCH_LENGTH,
  type CaseViewFilters, type CaseViewsStore, type SavedCaseView,
} from '../contracts/case-views-contract.mts';
import { isValidDisposition, isValidStatus } from '../cases/case-record-decisions.mts';
import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';
import { assertWorkspaceInputGraph, ordinaryWorkspaceRecord } from './hostile-input.mts';

const encoder = new TextEncoder();
const control = /[\u0000-\u001f\u007f]/u;
function object(raw: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  const value = ordinaryWorkspaceRecord(raw, label);
  if (!value || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw new Error(`${label} has missing or unsupported fields.`);
  return value;
}
function text(raw: unknown, maximum: number, label: string): string {
  if (typeof raw !== 'string' || raw.length > maximum || control.test(raw)) throw new Error(`${label} is invalid or exceeds ${maximum} characters.`);
  return raw;
}
function time(raw: unknown): string {
  const value = normalizeExplicitIsoTimestamp(raw);
  if (!value) throw new Error('A saved Case view has an invalid timestamp.');
  return value;
}

export function normalizeCaseViewFilters(raw: unknown): CaseViewFilters {
  const value = object(raw, ['status', 'disposition', 'search', 'sort'], 'Case filters');
  if (value.status !== '' && !isValidStatus(value.status)) throw new Error('Unsupported Case status filter.');
  if (value.disposition !== '' && !isValidDisposition(value.disposition)) throw new Error('Unsupported Case disposition filter.');
  const sort = CASE_VIEW_SORTS.find(option => option.value === value.sort)?.value;
  if (!sort) throw new Error('Unsupported Case sort order.');
  return { status: value.status, disposition: value.disposition, search: text(value.search, MAX_CASE_VIEW_SEARCH_LENGTH, 'Case search'), sort };
}

export function emptyCaseViewsStore(): CaseViewsStore {
  return { schema: CASE_VIEWS_SCHEMA, version: CASE_VIEWS_VERSION, views: [] };
}

export function caseViewsStoreVersion(raw: unknown): number | null {
  const value = ordinaryWorkspaceRecord(raw, 'Case views');
  return value?.schema === CASE_VIEWS_SCHEMA && Number.isSafeInteger(value.version) ? value.version as number : null;
}

/** Strict, lossless admission: invalid views and capacity excess never prune saved work. */
export function normalizeCaseViewsStore(raw: unknown): CaseViewsStore {
  if (raw === null || raw === undefined) return emptyCaseViewsStore();
  assertWorkspaceInputGraph(raw, 'Saved Case views', { maximumBytes: MAX_CASE_VIEWS_BYTES });
  const store = object(raw, ['schema', 'version', 'views'], 'Case views');
  if (store.schema !== CASE_VIEWS_SCHEMA || store.version !== CASE_VIEWS_VERSION) throw new Error('Unsupported saved Case view format. No views were changed.');
  if (!Array.isArray(store.views) || store.views.length > MAX_CASE_VIEWS) throw new Error(`Keep at most ${MAX_CASE_VIEWS} saved Case views. Delete unwanted views explicitly before adding more.`);
  const ids = new Set<string>();
  const views: SavedCaseView[] = [];
  let bytes = encoder.encode(JSON.stringify(emptyCaseViewsStore())).byteLength;
  for (const candidate of store.views) {
    const value = object(candidate, ['id', 'name', 'filters', 'createdAt', 'updatedAt'], 'Saved Case view');
    if (typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(value.id) || ids.has(value.id)) throw new Error('Invalid or duplicate saved Case view identity.');
    ids.add(value.id);
    const name = text(value.name, MAX_CASE_VIEW_NAME_LENGTH, 'Case view name').trim();
    if (!name) throw new Error('Name this Case view.');
    const createdAt = time(value.createdAt);
    const updatedAt = time(value.updatedAt);
    if (Date.parse(updatedAt) < Date.parse(createdAt)) throw new Error('A saved Case view update precedes its creation.');
    const view: SavedCaseView = { id: value.id, name, filters: normalizeCaseViewFilters(value.filters), createdAt, updatedAt };
    bytes += encoder.encode(JSON.stringify(view)).byteLength + (views.length ? 1 : 0);
    if (bytes > MAX_CASE_VIEWS_BYTES) throw new Error('Saved Case views exceed their storage limit. Existing views were not removed.');
    views.push(view);
  }
  return { ...emptyCaseViewsStore(), views };
}

export function serializeCaseViewsStore(raw: unknown): string {
  return JSON.stringify(normalizeCaseViewsStore(raw));
}
export function serialiseCaseViewsJson(raw: unknown): string {
  return `${JSON.stringify(normalizeCaseViewsStore(raw), null, 2)}\n`;
}

export function mergeCaseViews(local: unknown, incoming: unknown) {
  const current = normalizeCaseViewsStore(local);
  const imported = normalizeCaseViewsStore(incoming);
  const views = new Map(current.views.map(view => [view.id, view]));
  let added = 0, updated = 0, skipped = 0;
  for (const view of imported.views) {
    const existing = views.get(view.id);
    if (!existing) { views.set(view.id, view); added += 1; }
    else if (JSON.stringify(existing) === JSON.stringify(view)) continue;
    else if (Date.parse(view.updatedAt) > Date.parse(existing.updatedAt) && view.createdAt === existing.createdAt) {
      views.set(view.id, view); updated += 1;
    } else skipped += 1;
  }
  return { store: normalizeCaseViewsStore({ ...current, views: [...views.values()] }), added, updated, skipped };
}
