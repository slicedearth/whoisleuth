import {
  MAX_CASE_BRAND_PROFILE_ID_CANDIDATES,
  MAX_CASE_BRAND_PROFILE_IDS,
} from './case-record-contracts.ts';
import { normalizeOpaqueReferenceId } from './opaque-reference-id.ts';

export type InspectedCaseBrandProfileIds = Readonly<{
  ids: string[];
  omitted: number;
}>;

/**
 * Reads an untrusted stored or imported reference list without repairing any
 * identifier. At most 32 candidates are inspected and at most eight unique,
 * exact identifiers are retained.
 */
export function inspectCaseBrandProfileIds(value: unknown): InspectedCaseBrandProfileIds {
  if (!Array.isArray(value)) return { ids: [], omitted: 0 };
  const ids: string[] = [];
  const seen = new Set<string>();
  let omitted = Math.max(0, value.length - MAX_CASE_BRAND_PROFILE_ID_CANDIDATES);
  for (const candidate of value.slice(0, MAX_CASE_BRAND_PROFILE_ID_CANDIDATES)) {
    const id = normalizeOpaqueReferenceId(candidate);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (ids.length < MAX_CASE_BRAND_PROFILE_IDS) ids.push(id);
    else omitted += 1;
  }
  return { ids, omitted };
}

/** Current-store recovery is bounded and lenient, but never repairs ids. */
export function normalizeCaseBrandProfileIds(value: unknown): string[] {
  return inspectCaseBrandProfileIds(value).ids;
}

/** Explicit analyst edits replace the complete set and fail closed. */
export function assertCaseBrandProfileIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error('Brand Profile associations must be an array of opaque identifiers.');
  }
  if (value.length > MAX_CASE_BRAND_PROFILE_IDS) {
    throw new Error(`Each case is limited to ${MAX_CASE_BRAND_PROFILE_IDS} Brand Profile associations.`);
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    const id = normalizeOpaqueReferenceId(candidate);
    if (!id) throw new Error('A Brand Profile association identifier is invalid.');
    if (seen.has(id)) throw new Error('Brand Profile association identifiers must be unique.');
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** Add one exact association without accepting a stale whole-list snapshot. */
export function addCaseBrandProfileId(value: unknown, profileId: unknown): string[] {
  const ids = assertCaseBrandProfileIds(value);
  const [id] = assertCaseBrandProfileIds([profileId]);
  if (!id || ids.includes(id)) return [...ids];
  if (ids.length >= MAX_CASE_BRAND_PROFILE_IDS) {
    throw new Error(`Each case is limited to ${MAX_CASE_BRAND_PROFILE_IDS} Brand Profile associations.`);
  }
  return [...ids, id];
}

/** Remove one exact association while preserving every unrelated reference. */
export function removeCaseBrandProfileId(value: unknown, profileId: unknown): string[] {
  const ids = assertCaseBrandProfileIds(value);
  const [id] = assertCaseBrandProfileIds([profileId]);
  return id ? ids.filter((candidate) => candidate !== id) : [...ids];
}

/** Import unions are existing-first so omission can never clear a local ref. */
export function unionCaseBrandProfileIds(
  existingValue: unknown,
  importedValue: unknown,
): InspectedCaseBrandProfileIds {
  const existing = normalizeCaseBrandProfileIds(existingValue);
  const imported = normalizeCaseBrandProfileIds(importedValue);
  const ids = [...existing];
  const seen = new Set(ids);
  let omitted = 0;
  for (const id of imported) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (ids.length < MAX_CASE_BRAND_PROFILE_IDS) ids.push(id);
    else omitted += 1;
  }
  return { ids, omitted };
}
