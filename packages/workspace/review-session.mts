import {
  ANALYST_REVIEW_AGES, ANALYST_REVIEW_DISPOSITIONS, ANALYST_REVIEW_EVIDENCE_FAMILIES, ANALYST_REVIEW_KINDS, MAX_ANALYST_REVIEW_ITEMS, MAX_ANALYST_REVIEW_RATIONALE_LENGTH,
  ANALYST_REVIEW_LIFECYCLE_STATES, ANALYST_REVIEW_NEXT_ACTIONS, ANALYST_REVIEW_PRIORITIES, ANALYST_REVIEW_QUEUE_OPTIONS,
} from '../contracts/analyst-review-state-contract.mts';
import { MAX_REVIEW_SESSION_BYTES, REVIEW_SESSION_SCHEMA, REVIEW_SESSION_VERSION, type ReviewFormDraft, type ReviewSessionFilters, type ReviewSessionPosition, type ReviewSessionRecord, type ReviewSessionStore } from '../contracts/review-session-contract.mts';
import { assertWorkspaceInputGraph, ordinaryWorkspaceRecord } from './hostile-input.mts';
import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';

function object(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  const value = ordinaryWorkspaceRecord(raw, 'Review position');
  if (!value || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw new Error('Review position has missing or unsupported fields.');
  return value;
}
function text(raw: unknown, maximum = 512): string {
  if (typeof raw !== 'string' || raw.length > maximum || /[\u0000-\u001f\u007f]/u.test(raw)) throw new Error('Review position contains invalid or over-bound text.');
  return raw;
}
function option<T extends string>(raw: unknown, choices: readonly T[]): T {
  const value = choices.find(item => item === raw);
  if (value === undefined) throw new Error('Review position contains an unsupported filter.');
  return value;
}
function filters(raw: unknown): ReviewSessionFilters {
  const value = object(raw, ['queue', 'attentionOnly', 'focusedCaseId', 'kind', 'source', 'age', 'caseQuery', 'priority', 'nextAction', 'evidenceFamily', 'lifecycle']);
  if (typeof value.attentionOnly !== 'boolean') throw new Error('Review attention filter must be a boolean.');
  return {
    queue: option(value.queue, ANALYST_REVIEW_QUEUE_OPTIONS.map(item => item.value)), attentionOnly: value.attentionOnly,
    focusedCaseId: text(value.focusedCaseId, 128), kind: option(value.kind, ['', ...ANALYST_REVIEW_KINDS]),
    source: text(value.source), age: option(value.age, ['', ...ANALYST_REVIEW_AGES]), caseQuery: text(value.caseQuery, 253),
    priority: option(value.priority, ['', ...ANALYST_REVIEW_PRIORITIES]), nextAction: option(value.nextAction, ['', ...ANALYST_REVIEW_NEXT_ACTIONS]),
    evidenceFamily: option(value.evidenceFamily, ['', ...ANALYST_REVIEW_EVIDENCE_FAMILIES]), lifecycle: option(value.lifecycle, ['', ...ANALYST_REVIEW_LIFECYCLE_STATES]),
  };
}
export function normalizeReviewSessionPosition(raw: unknown): ReviewSessionPosition {
  assertWorkspaceInputGraph(raw, 'Review position', { maximumBytes: MAX_REVIEW_SESSION_BYTES });
  const value = object(raw, ['filters', 'selected', 'drafts']);
  let selected: ReviewSessionPosition['selected'] = null;
  if (value.selected !== null) {
    const item = object(value.selected, ['id', 'subjectKey', 'materialFingerprint', 'caseId']);
    selected = { id: text(item.id), subjectKey: text(item.subjectKey), materialFingerprint: text(item.materialFingerprint), caseId: item.caseId === null ? null : text(item.caseId, 128) };
    if (!selected.id || !selected.subjectKey || !selected.materialFingerprint) throw new Error('The selected review identity is incomplete.');
  }
  if (!Array.isArray(value.drafts) || value.drafts.length > MAX_ANALYST_REVIEW_ITEMS) throw new Error('Review drafts exceed the admitted queue size.');
  const ids = new Set<string>();
  const drafts = value.drafts.map(rawDraft => {
    const draft = normalizeReviewFormDraft(rawDraft);
    if (ids.has(draft.id)) throw new Error('Review position contains duplicate form drafts.');
    ids.add(draft.id);
    return draft;
  });
  return { filters: filters(value.filters), selected, drafts };
}
export function normalizeReviewFormDraft(raw: unknown): ReviewFormDraft {
  const value = object(raw, ['id', 'subjectKey', 'materialFingerprint', 'disposition', 'rationale', 'expiresAt', 'reviewDueAt', 'uncertain']);
  const id = text(value.id), subjectKey = text(value.subjectKey), materialFingerprint = text(value.materialFingerprint);
  if (!id || !subjectKey || !materialFingerprint || typeof value.uncertain !== 'boolean') throw new Error('Review draft identity or write state is invalid.');
  if (typeof value.rationale !== 'string' || value.rationale.length > MAX_ANALYST_REVIEW_RATIONALE_LENGTH || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value.rationale)) throw new Error('Review rationale is invalid or over bound.');
  return { id, subjectKey, materialFingerprint, disposition: option(value.disposition, ['', ...ANALYST_REVIEW_DISPOSITIONS]),
    rationale: value.rationale, expiresAt: text(value.expiresAt, 32), reviewDueAt: text(value.reviewDueAt, 32), uncertain: value.uncertain };
}
export function emptyReviewSessionStore(): ReviewSessionStore {
  return { schema: REVIEW_SESSION_SCHEMA, version: REVIEW_SESSION_VERSION, records: [] };
}
export function reviewSessionStoreVersion(raw: unknown): number | null {
  const value = ordinaryWorkspaceRecord(raw, 'Review session');
  return value?.schema === REVIEW_SESSION_SCHEMA && Number.isSafeInteger(value.version) ? value.version as number : null;
}
export function normalizeReviewSessionStore(raw: unknown): ReviewSessionStore {
  if (raw === null || raw === undefined) return emptyReviewSessionStore();
  assertWorkspaceInputGraph(raw, 'Review session', { maximumBytes: MAX_REVIEW_SESSION_BYTES });
  const root = object(raw, ['schema', 'version', 'records']);
  if (root.schema !== REVIEW_SESSION_SCHEMA || root.version !== REVIEW_SESSION_VERSION) throw new Error('Unsupported review session format. Saved positions were not changed.');
  if (!Array.isArray(root.records) || root.records.length > 1) throw new Error('The review session keeps one explicitly saved inbox position.');
  const records: ReviewSessionRecord[] = root.records.map(rawRecord => {
    const record = object(rawRecord, ['id', 'revision', 'updatedAt', 'filters', 'selected', 'drafts']);
    const updatedAt = normalizeExplicitIsoTimestamp(record.updatedAt);
    if (record.id !== 'inbox' || typeof record.revision !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(record.revision) || !updatedAt) throw new Error('Review session identity or time is invalid.');
    return { id: 'inbox', revision: record.revision, updatedAt, ...normalizeReviewSessionPosition({ filters: record.filters, selected: record.selected, drafts: record.drafts }) };
  });
  return { ...emptyReviewSessionStore(), records };
}
export function serializeReviewSessionStore(raw: unknown): string {
  return JSON.stringify(normalizeReviewSessionStore(raw));
}

/** Position is re-evaluated against current admitted results, never a retained queue copy. */
export function resolveReviewSessionSelection<T extends { id: string; subjectKey: string; materialFingerprint: string }>(position: ReviewSessionPosition, items: readonly T[]) {
  if (!position.selected) return { state: 'no_selection' as const, index: -1 };
  const exact = items.findIndex(item => item.id === position.selected!.id && item.subjectKey === position.selected!.subjectKey);
  const candidates = exact >= 0 ? [exact] : items.flatMap((item, index) => item.subjectKey === position.selected!.subjectKey ? [index] : []);
  if (candidates.length !== 1) return { state: candidates.length ? 'ambiguous' as const : 'unavailable' as const, index: -1 };
  const index = candidates[0]!;
  return { state: items[index]!.materialFingerprint === position.selected.materialFingerprint ? 'unchanged' as const : 'changed' as const, index };
}
