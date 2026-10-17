import { MAX_CASES, MAX_CASE_OBJECTIVE_LENGTH, MAX_DOMAIN_LENGTH, MAX_TAG_LENGTH, MAX_TAGS_PER_CASE } from '../contracts/case-portability.mts';
import { safeId } from './case-record-core.mts';
import { updateCase } from './case-record-operations.mts';
import { MAX_CASE_BATCH_MUTATIONS } from './case-batch-limits.mts';
import { enforceStoreBudget } from './case-storage-model.mts';
import type { CaseRecord } from './case-record-contracts.mts';

export const MAX_CASE_TAG_BATCH_TEXT_LENGTH = MAX_TAGS_PER_CASE * (MAX_TAG_LENGTH + 2);
export type CaseTagBatchIntent = Readonly<{ ids: readonly string[]; operation: 'add' | 'remove'; tags: readonly string[] }>;
export type CaseTagBatchRow = Readonly<{
  id: string; domain: string | null; title: string;
  expectedTags: readonly string[]; nextTags: readonly string[];
  state: 'changed' | 'unchanged' | 'blocked'; limitation: string | null;
}>;
export type CaseTagBatchPreview = Readonly<{ intent: CaseTagBatchIntent; rows: readonly CaseTagBatchRow[]; blockers: readonly string[]; canApply: boolean }>;

function checkedIntent(input: CaseTagBatchIntent): CaseTagBatchIntent {
  if (!input || !Array.isArray(input.ids) || input.ids.length < 1 || input.ids.length > MAX_CASE_BATCH_MUTATIONS
    || input.ids.some(id => safeId(id) !== id) || new Set(input.ids).size !== input.ids.length)
    throw new TypeError(`Select between 1 and ${MAX_CASE_BATCH_MUTATIONS} distinct retained Cases.`);
  if (input.operation !== 'add' && input.operation !== 'remove') throw new TypeError('Choose add or remove tags.');
  return { ids: [...input.ids], operation: input.operation, tags: checkedTags(input.tags) };
}

function checkedTags(input: readonly string[]): string[] {
  if (!Array.isArray(input) || !input.length || input.length > MAX_TAGS_PER_CASE)
    throw new TypeError(`Provide between 1 and ${MAX_TAGS_PER_CASE} tags.`);
  const tags = input.map(tag => {
    if (typeof tag !== 'string' || tag.length > MAX_CASE_TAG_BATCH_TEXT_LENGTH
      || !tag.trim() || tag.trim().length > MAX_TAG_LENGTH || /[\u0000-\u001f\u007f]/u.test(tag))
      throw new TypeError(`Each requested tag must contain 1–${MAX_TAG_LENGTH} characters without control characters.`);
    return tag.trim();
  });
  if (new Set(tags.map(tag => tag.toLowerCase())).size !== tags.length)
    throw new TypeError('Requested tags repeat the same case-insensitive tag. Remove the duplicates before previewing.');
  return tags;
}

export function parseCaseBatchTags(text: string): string[] {
  if (typeof text !== 'string' || text.length > MAX_CASE_TAG_BATCH_TEXT_LENGTH)
    throw new TypeError('The tag entry exceeds the bounded selection. Use a smaller set of tags.');
  return checkedTags(text.split(/[,\n]+/u).map(tag => tag.trim()).filter(Boolean));
}

function nextTags(current: readonly string[], intent: CaseTagBatchIntent): string[] {
  const requested = new Set(intent.tags.map(tag => tag.toLowerCase()));
  if (intent.operation === 'remove') return current.filter(tag => !requested.has(tag.toLowerCase()));
  const retained = new Set(current.map(tag => tag.toLowerCase()));
  return [...current, ...intent.tags.filter(tag => !retained.has(tag.toLowerCase()))];
}

function same(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Capture only the bounded reviewed fields before a provider selection or retry. */
export function captureCaseTagBatch(preview: CaseTagBatchPreview): CaseTagBatchPreview {
  const intent = checkedIntent(preview?.intent);
  if (!preview.canApply || !Array.isArray(preview.rows) || preview.rows.length !== intent.ids.length)
    throw new TypeError('This tag batch has unresolved blockers. Prepare a new preview.');
  const rows = preview.rows.map((row, index) => {
    if (!row || row.id !== intent.ids[index] || typeof row.domain !== 'string' || row.domain.length > MAX_DOMAIN_LENGTH
      || typeof row.title !== 'string' || row.title.length > MAX_CASE_OBJECTIVE_LENGTH
      || !Array.isArray(row.expectedTags) || !Array.isArray(row.nextTags)
      || [row.expectedTags, row.nextTags].some(tags => tags.length > MAX_TAGS_PER_CASE
        || tags.some((tag: unknown) => typeof tag !== 'string' || tag.length > MAX_TAG_LENGTH)))
      throw new TypeError('The reviewed tag preview is incomplete or exceeds its record bounds.');
    return { id: row.id, domain: row.domain, title: row.title, expectedTags: [...row.expectedTags],
      nextTags: [...row.nextTags], state: row.state, limitation: null };
  });
  return { intent, rows, blockers: [], canApply: true };
}

/** Revalidate every target before changing any record; no evidence is pruned. */
export function applyCaseTagBatch(current: CaseRecord[], reviewed: CaseTagBatchPreview, now = new Date().toISOString()) {
  if (!Array.isArray(current) || current.length > MAX_CASES) throw new TypeError('The Case snapshot exceeds its supported store.');
  const preview = captureCaseTagBatch(reviewed);
  for (const row of preview.rows) {
    const records = current.filter(record => record.id === row.id), record = records[0];
    if (records.length !== 1 || !record || record.domain !== row.domain || (record.title ?? '') !== row.title
      || !same(record.tags, row.expectedTags))
      throw new TypeError('A selected Case changed or became unavailable after preview. Prepare a new preview; no tags were changed.');
    const next = nextTags(record.tags, preview.intent);
    if (next.length > MAX_TAGS_PER_CASE || !same(next, row.nextTags))
      throw new TypeError('The reviewed tag result changed or exceeds the Case tag limit. Prepare a new preview.');
  }
  let cases = current, changed = 0;
  for (const row of preview.rows) {
    if (same(row.expectedTags, row.nextTags)) continue;
    cases = updateCase(cases, row.id, { tags: [...row.nextTags], expectedTags: row.expectedTags }, now).cases;
    changed++;
  }
  if (changed) {
    const admitted = enforceStoreBudget(cases);
    if (admitted.pruned) throw new TypeError('This tag batch would remove existing evidence to fit storage. No tags were changed.');
    cases = admitted.cases;
  }
  return { cases, changed, unchanged: preview.rows.length - changed, pruned: 0 };
}

/** A temporary organisation preview, not a saved batch or Case assessment. */
export function prepareCaseTagBatch(current: CaseRecord[], input: CaseTagBatchIntent, now = new Date().toISOString()): CaseTagBatchPreview {
  if (!Array.isArray(current) || current.length > MAX_CASES) throw new TypeError('The Case snapshot exceeds its supported store.');
  const intent = checkedIntent(input);
  const rows: CaseTagBatchRow[] = intent.ids.map(id => {
    const matches = current.filter(record => record.id === id), record = matches[0];
    if (matches.length !== 1 || !record) return { id, domain: null, title: '', expectedTags: [], nextTags: [], state: 'blocked', limitation: 'The selected Case is unavailable or ambiguous.' };
    const next = nextTags(record.tags, intent), blocked = next.length > MAX_TAGS_PER_CASE;
    return { id, domain: record.domain, title: record.title ?? '', expectedTags: [...record.tags], nextTags: next,
      state: blocked ? 'blocked' : same(record.tags, next) ? 'unchanged' : 'changed',
      limitation: blocked ? `The resulting selection exceeds ${MAX_TAGS_PER_CASE} tags; no tags will be dropped.` : null };
  });
  let preview: CaseTagBatchPreview = { intent, rows, blockers: [], canApply: rows.every(row => row.state !== 'blocked') };
  if (preview.canApply) {
    try { applyCaseTagBatch(current, preview, now); }
    catch (cause) { preview = { ...preview, canApply: false, blockers: [cause instanceof Error ? cause.message : 'The tag batch could not be prepared.'] }; }
  }
  return preview;
}
