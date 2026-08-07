import {
  CASE_DISPOSITIONS,
  CASE_IMPORT_VERSIONS,
  CASE_SCHEMA_VERSION,
  CASE_SOURCES,
  CASE_STATUSES,
  DEFAULT_DISPOSITION,
  DEFAULT_SOURCE,
  DEFAULT_STATUS,
  MAX_CASES,
  MAX_NOTES_PER_CASE,
  deterministicId,
  isoOrNull,
  normalizeCase,
  normalizeDomain,
  normalizeEvidenceHistory,
  normalizeNotes,
  normalizeReviewReasonCode,
  normalizeTags,
  objectRecord,
  safeId,
  type CaseEvidenceSnapshot,
  type CaseNote,
  type CaseRecord,
  type CaseStore,
} from './case-record-model.ts';
import {
  caseInvestigationBranchReferences,
  mergeCaseInvestigationBranches,
  normalizeCaseInvestigationBranches,
  type CaseInvestigationBranch,
} from './case-investigation-branch-model.ts';
import {
  mergeCaseActions,
  mergeCaseAssertions,
  mergeCaseDecisions,
  mergeCaseEvidencePins,
  mergeCaseManualTrail,
  mergeCaseSightings,
  normalizeCaseActions,
  normalizeCaseAssertions,
  normalizeCaseDecisions,
  normalizeCaseEvidencePins,
  normalizeCaseManualTrail,
  normalizeCaseSightings,
  type CaseActionRecord,
  type CaseAssertionRecord,
  type CaseDecisionRecord,
  type CaseEvidencePin,
  type CaseManualTrailEvent,
  type CaseSightingRecord,
} from './case-response-model.ts';

const STATUS_VALUES = new Set(CASE_STATUSES.map((item) => item.value));
const DISPOSITION_VALUES = new Set(
  CASE_DISPOSITIONS.map((item) => item.value),
);
const SOURCE_VALUES = new Set(CASE_SOURCES.map((item) => item.value));

type ImportPatch = {
  domain: string;
  rawId: string | null;
  status: string | undefined;
  disposition: string | undefined;
  reviewReasonCode: string | null | undefined;
  source: string | undefined;
  evidenceHistory: CaseEvidenceSnapshot[];
  evidencePins: CaseEvidencePin[];
  decisions: CaseDecisionRecord[];
  actions: CaseActionRecord[];
  assertions: CaseAssertionRecord[];
  manualTrail: CaseManualTrailEvent[];
  sightings: CaseSightingRecord[];
  branches: CaseInvestigationBranch[];
  tags: string[];
  notes: CaseNote[];
  createdAt: string | null;
  updatedAt: string | null;
};

function assignUniqueIds(cases: CaseRecord[]): void {
  const used = new Set<string>();
  for (const record of [...cases].sort((a, b) => a.domain.localeCompare(b.domain))) {
    let id = safeId(record.id) || deterministicId(record.domain);
    if (used.has(id)) {
      const base = deterministicId(record.domain);
      id = base;
      let suffix = 2;
      while (used.has(id)) id = `${base}-${suffix++}`;
    }
    used.add(id);
    record.id = id;
  }
}

/**
 * Recovers a clean, bounded store from an arbitrary parsed value. Accepts the
 * versioned envelope or a bare array, drops malformed records, keeps a single
 * case per domain (most recently updated wins), caps to MAX_CASES by recency,
 * and guarantees globally unique safe ids. Never throws.
 * @param {unknown} raw
 * @returns {CaseStore}
 */
export function normalizeCaseStore(raw: unknown): CaseStore {
  const now = new Date().toISOString();
  const byDomain = new Map<string, CaseRecord>();
  for (const item of asCaseList(raw)) {
    const normalized = normalizeCase(item, undefined, now);
    if (!normalized) continue;
    const existing = byDomain.get(normalized.domain);
    if (!existing || Date.parse(normalized.updatedAt) >= Date.parse(existing.updatedAt)) {
      byDomain.set(normalized.domain, normalized);
    }
  }
  const cases = [...byDomain.values()]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, MAX_CASES);
  assignUniqueIds(cases);
  return { version: CASE_SCHEMA_VERSION, cases };
}

/**
 * The schema version declared by a stored/parsed value, or null. The storage
 * wrapper uses this to refuse overwriting data written by a newer, unsupported
 * version instead of silently downgrading it.
 * @param {unknown} raw
 * @returns {number | null}
 */
export function parseStoreVersion(raw: unknown): number | null {
  const value = objectRecord(raw).version;
  return typeof value === 'number' ? value : null;
}

/** @param {unknown} raw @returns {unknown[]} */
function asCaseList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const cases = objectRecord(raw).cases;
  if (Array.isArray(cases)) return cases;
  return [];
}

/**
 * @param {{ domain: unknown, status?: unknown, disposition?: unknown, source?: unknown, tags?: unknown, evidence?: unknown, note?: unknown }} input
 * @param {string} [nowIso]
 * @returns {CaseRecord}
 */

function importScalar(value: unknown, valid: Set<string>): string | undefined {
  return typeof value === 'string' && valid.has(value) ? value : undefined;
}

/**
 * Validates one imported record into a patch. Unlike normalizeCase, absent or
 * invalid scalar fields stay `undefined` (never defaulted) and a missing/invalid
 * updatedAt stays `null` (treated as older than any real local timestamp), so an
 * incomplete import can never win a merge over valid local data. Imported
 * evidence is normalized additively; a snapshot with no captured time falls back
 * only to the imported record's own (older) timestamps, never to "now".
 * @param {unknown} raw
 * @returns {ImportPatch | null}
 */
function extractImportPatch(raw: unknown, importedVersion: number): ImportPatch | null {
  const record = objectRecord(raw);
  const domain = normalizeDomain(record.domain);
  if (!domain) return null;
  const importFallback = isoOrNull(record.updatedAt) || isoOrNull(record.createdAt) || null;
  const normalizedFallback = importFallback || '1970-01-01T00:00:00.000Z';
  const rawEvidence = Array.isArray(record.evidenceHistory) ? record.evidenceHistory : [];
  const evidencePins = normalizeCaseEvidencePins(record.evidencePins, normalizedFallback, {
    allowCertificateObservation: importedVersion >= 11,
  });
  const pinIds = new Set(evidencePins.map((item) => item.id));
  const actions = normalizeCaseActions(record.actions, normalizedFallback);
  const assertions = normalizeCaseAssertions(record.assertions, normalizedFallback, pinIds);
  const branchReferences = caseInvestigationBranchReferences({ evidencePins, actions, assertions });
  return {
    domain,
    rawId: typeof record.id === 'string' ? record.id : null,
    status: importScalar(record.status, STATUS_VALUES),
    disposition: importScalar(record.disposition, DISPOSITION_VALUES),
    reviewReasonCode: Object.hasOwn(record, 'reviewReasonCode')
      ? normalizeReviewReasonCode(record.reviewReasonCode)
      : undefined,
    source: importScalar(record.source, SOURCE_VALUES),
    evidenceHistory: normalizeEvidenceHistory(rawEvidence, { source: 'import', fallback: importFallback }),
    evidencePins,
    decisions: normalizeCaseDecisions(record.decisions, normalizedFallback, pinIds),
    actions,
    assertions,
    manualTrail: normalizeCaseManualTrail(record.manualTrail, normalizedFallback),
    sightings: normalizeCaseSightings(record.sightings, normalizedFallback, pinIds),
    branches: importedVersion >= 11
      ? normalizeCaseInvestigationBranches(record.branches, normalizedFallback, branchReferences)
      : [],
    tags: normalizeTags(record.tags),
    // Imported notes fall back only to the imported record's own timestamps
    // (never "now"), so a timestamp-less note gets a stable, deterministic time
    // and id, and re-importing the same file cannot manufacture a duplicate or a
    // spuriously-newer note.
    notes: normalizeNotes(record.notes, importFallback),
    createdAt: isoOrNull(record.createdAt),
    updatedAt: isoOrNull(record.updatedAt),
  };
}

/** @param {CaseNote[]} a @param {CaseNote[]} b @returns {CaseNote[]} */
function unionNotes(a: CaseNote[], b: CaseNote[]): CaseNote[] {
  const byId = new Map<string, CaseNote>();
  for (const note of [...a, ...b]) {
    if (!byId.has(note.id)) byId.set(note.id, note);
  }
  const notes = [...byId.values()].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  return notes.slice(Math.max(0, notes.length - MAX_NOTES_PER_CASE));
}

// Additive, deduplicated union of two evidence histories. Identical material
// collapses (earliest firstCapturedAt, latest capturedAt), distinct snapshots
// are retained subject to the per-case bound, and an older import can never
// move an existing observation backwards.
function mergeEvidenceHistories(
  local: CaseEvidenceSnapshot[],
  imported: CaseEvidenceSnapshot[],
): CaseEvidenceSnapshot[] {
  return normalizeEvidenceHistory([...local, ...imported], { source: 'import', fallback: null });
}

/** @param {ImportPatch} patch @param {string} now @returns {CaseRecord} */
function caseFromPatch(patch: ImportPatch, now: string): CaseRecord {
  return {
    id: '', // assigned by mergeCases so it can guarantee uniqueness against locals
    domain: patch.domain,
    status: patch.status ?? DEFAULT_STATUS,
    disposition: patch.disposition ?? DEFAULT_DISPOSITION,
    reviewReasonCode: patch.reviewReasonCode ?? null,
    tags: patch.tags,
    notes: patch.notes,
    source: patch.source ?? DEFAULT_SOURCE,
    evidenceHistory: patch.evidenceHistory,
    evidencePins: patch.evidencePins,
    decisions: patch.decisions,
    actions: patch.actions,
    assertions: patch.assertions,
    manualTrail: patch.manualTrail,
    sightings: patch.sightings,
    branches: patch.branches,
    createdAt: patch.createdAt || patch.updatedAt || now,
    updatedAt: patch.updatedAt || patch.createdAt || now,
  };
}

/**
 * Merges an imported patch into an existing local case. Notes, tags, and
 * evidence history are merged additively (never destructive); a scalar field is
 * only overwritten when the import provided a valid value AND is strictly newer
 * than the local record. A patch with no/invalid updatedAt is never newer.
 * @param {CaseRecord} local
 * @param {ImportPatch} patch
 * @returns {CaseRecord}
 */
function applyImportPatch(local: CaseRecord, patch: ImportPatch): CaseRecord {
  const importNewer = patch.updatedAt !== null && Date.parse(patch.updatedAt) > Date.parse(local.updatedAt);
  const fallback = patch.updatedAt || local.updatedAt;
  const evidencePins = mergeCaseEvidencePins(local.evidencePins, patch.evidencePins, fallback);
  const pinIds = new Set(evidencePins.map((item) => item.id));
  const actions = mergeCaseActions(local.actions, patch.actions, fallback);
  const assertions = mergeCaseAssertions(local.assertions, patch.assertions, fallback, pinIds);
  const branchReferences = caseInvestigationBranchReferences({ evidencePins, actions, assertions });
  return {
    ...local,
    status: patch.status !== undefined && importNewer ? patch.status : local.status,
    disposition: patch.disposition !== undefined && importNewer ? patch.disposition : local.disposition,
    reviewReasonCode: patch.reviewReasonCode !== undefined && importNewer ? patch.reviewReasonCode : local.reviewReasonCode ?? null,
    source: patch.source !== undefined && importNewer ? patch.source : local.source,
    evidenceHistory: mergeEvidenceHistories(local.evidenceHistory, patch.evidenceHistory),
    evidencePins,
    decisions: mergeCaseDecisions(local.decisions, patch.decisions, fallback, pinIds),
    actions,
    assertions,
    manualTrail: mergeCaseManualTrail(local.manualTrail, patch.manualTrail, fallback),
    sightings: mergeCaseSightings(local.sightings, patch.sightings, fallback, pinIds),
    branches: mergeCaseInvestigationBranches(local.branches ?? [], patch.branches, fallback, branchReferences),
    tags: normalizeTags([...local.tags, ...patch.tags]),
    notes: unionNotes(local.notes, patch.notes),
    createdAt: patch.createdAt && Date.parse(patch.createdAt) < Date.parse(local.createdAt) ? patch.createdAt : local.createdAt,
    updatedAt: importNewer ? (patch.updatedAt ?? local.updatedAt) : local.updatedAt,
  };
}

function pickFreeId(preferred: unknown, domain: string, used: Set<string>): string {
  const wanted = safeId(preferred);
  let id = wanted && !used.has(wanted) ? wanted : deterministicId(domain);
  const base = deterministicId(domain);
  let suffix = 2;
  while (used.has(id)) id = `${base}-${suffix++}`;
  return id;
}

/**
 * Merges an imported (already parsed) value into the local cases. Predictable
 * and idempotent: unknown records are skipped, existing domains merge without
 * losing newer local decisions, and new ones are added until the store bound is
 * reached. An imported envelope that declares a schema version newer than we
 * support is rejected up front (before any local data is touched) rather than
 * reinterpreted.
 * @param {CaseRecord[]} localCases
 * @param {unknown} importedRaw
 * @returns {{ cases: CaseRecord[], added: number, updated: number, skipped: number }}
 */
export function mergeCases(
  localCases: CaseRecord[],
  importedRaw: unknown,
): { cases: CaseRecord[]; added: number; updated: number; skipped: number } {
  const importedVersion = parseStoreVersion(importedRaw);
  if (importedVersion !== null && Number.isInteger(importedVersion) && importedVersion > CASE_SCHEMA_VERSION) {
    throw new Error(`This case file was exported by a newer version of WHOISleuth (schema ${importedVersion}). Update the app before importing it.`);
  }
  if (!CASE_IMPORT_VERSIONS.includes(importedVersion as typeof CASE_IMPORT_VERSIONS[number])
    || !importedRaw || typeof importedRaw !== 'object'
    || !Array.isArray(objectRecord(importedRaw).cases)) {
    throw new Error(`Expected a WHOISleuth case export using schema ${CASE_IMPORT_VERSIONS.join(' or ')}.`);
  }
  const local = normalizeCaseStore(localCases).cases;
  const supportedImportedVersion = importedVersion ?? 0;
  const byDomain = new Map(local.map((item) => [item.domain, item]));
  const usedIds = new Set(local.map((item) => item.id));
  let added = 0;
  let updated = 0;
  let skipped = 0;
  const now = new Date().toISOString();
  for (const item of asCaseList(importedRaw)) {
    const patch = extractImportPatch(item, supportedImportedVersion);
    if (!patch) {
      skipped += 1;
      continue;
    }
    const existing = byDomain.get(patch.domain);
    if (existing) {
      byDomain.set(patch.domain, applyImportPatch(existing, patch));
      updated += 1;
    } else if (byDomain.size < MAX_CASES) {
      const record = caseFromPatch(patch, now);
      record.id = pickFreeId(patch.rawId, patch.domain, usedIds);
      usedIds.add(record.id);
      byDomain.set(patch.domain, record);
      added += 1;
    } else {
      skipped += 1;
    }
  }
  return { cases: normalizeCaseStore([...byDomain.values()]).cases, added, updated, skipped };
}
