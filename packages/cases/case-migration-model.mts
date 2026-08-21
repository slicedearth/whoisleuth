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
  caseTimestampOrNull,
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
} from './case-record-model.mts';
import {
  caseReportVersionMatchesCase,
  CASE_REPORT_SCHEMA,
  CLI_CASE_PACK_CURRENT_REDACTION_KEYS,
  CLI_CASE_PACK_INTEGRITY_KEYS,
  CLI_CASE_PACK_LEGACY_REDACTION_KEYS,
  CLI_CASE_PACK_LIMITATIONS,
  CLI_CASE_PACK_PACKET_KEYS,
  CLI_CASE_PACK_REPORT_KEYS,
  CLI_CASE_PACK_ROOT_KEYS,
  CLI_CASE_PACK_SCHEMA,
  CLI_CASE_PACK_VERSION,
  LEGACY_CLI_CASE_PACK_VERSION,
} from '../contracts/case-portability.mts';
import { canonicalArtifactJsonV2 } from '../evidence/artifact-integrity.mts';
import {
  inspectCaseBrandProfileIds,
  unionCaseBrandProfileIds,
} from './case-brand-profile-references.mts';
import {
  caseInvestigationBranchReferences,
  mergeCaseInvestigationBranches,
  normalizeCaseInvestigationBranches,
  type CaseInvestigationBranch,
} from './case-investigation-branch-model.mts';
import {
  buildCaseClosureLinkContext,
  mergeCaseActions,
  mergeCaseAssertions,
  mergeCaseClosureHistories,
  mergeCaseDecisions,
  mergeCaseEvidencePins,
  mergeCaseManualTrail,
  mergeCaseObservedEffectHistories,
  mergeCaseSightings,
  normalizeCaseActions,
  normalizeCaseAssertions,
  normalizeCaseClosureHistory,
  normalizeCaseDecisions,
  normalizeCaseEvidencePins,
  normalizeCaseManualTrail,
  normalizeCaseObservedEffectHistory,
  normalizeCaseSightings,
  type CaseActionRecord,
  type CaseAssertionRecord,
  type CaseClosureHistory,
  type CaseDecisionRecord,
  type CaseEvidencePin,
  type CaseManualTrailEvent,
  type CaseObservedEffectHistory,
  type CaseSightingRecord,
} from './case-response-model.mts';

const STATUS_VALUES = new Set(CASE_STATUSES.map((item) => item.value));
const DISPOSITION_VALUES = new Set(
  CASE_DISPOSITIONS.map((item) => item.value),
);
const SOURCE_VALUES = new Set(CASE_SOURCES.map((item) => item.value));
export const MAX_CASE_INPUT_RECORDS = 2_000;

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

type ImportPatch = {
  domain: string;
  rawId: string | null;
  status: string | undefined;
  disposition: string | undefined;
  reviewReasonCode: string | null | undefined;
  brandProfileIds: string[];
  brandProfileReferencesOmitted: number;
  source: string | undefined;
  evidenceHistory: CaseEvidenceSnapshot[];
  evidencePins: CaseEvidencePin[];
  decisions: CaseDecisionRecord[];
  actions: CaseActionRecord[];
  assertions: CaseAssertionRecord[];
  manualTrail: CaseManualTrailEvent[];
  sightings: CaseSightingRecord[];
  observedEffects: CaseObservedEffectHistory;
  closures: CaseClosureHistory;
  branches: CaseInvestigationBranch[];
  tags: string[];
  notes: CaseNote[];
  createdAt: string | null;
  updatedAt: string | null;
};

function assignUniqueIds(cases: CaseRecord[]): void {
  const used = new Set<string>();
  for (const record of [...cases].sort((a, b) => compareCodeUnits(a.domain, b.domain))) {
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
  const fallback = new Date(0).toISOString();
  const sourceVersion = parseStoreVersion(raw);
  const acceptsBrandProfileIds = Array.isArray(raw)
    || (sourceVersion !== null && sourceVersion >= 12 && sourceVersion <= CASE_SCHEMA_VERSION);
  const byDomain = new Map<string, CaseRecord>();
  for (const item of boundedCaseList(raw).items) {
    const normalized = normalizeCase(
      item,
      undefined,
      fallback,
      Array.isArray(raw) ? CASE_SCHEMA_VERSION : sourceVersion,
    );
    if (!normalized) continue;
    if (!acceptsBrandProfileIds) normalized.brandProfileIds = [];
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

function boundedCaseList(raw: unknown): { items: unknown[]; omitted: number } {
  const source = asCaseList(raw);
  return {
    items: source.slice(0, MAX_CASE_INPUT_RECORDS),
    omitted: Math.max(0, source.length - MAX_CASE_INPUT_RECORDS),
  };
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
  const importFallback = caseTimestampOrNull(record.updatedAt, importedVersion)
    || caseTimestampOrNull(record.createdAt, importedVersion)
    || null;
  const normalizedFallback = importFallback || '1970-01-01T00:00:00.000Z';
  const timestampOptions = {
    legacyTimestamps: importedVersion < CASE_SCHEMA_VERSION,
    sourceVersion: importedVersion,
  };
  const rawEvidence = Array.isArray(record.evidenceHistory) ? record.evidenceHistory : [];
  const evidencePins = normalizeCaseEvidencePins(record.evidencePins, normalizedFallback, {
    allowCertificateObservation: importedVersion >= 11,
    ...timestampOptions,
  });
  const pinIds = new Set(evidencePins.map((item) => item.id));
  const actions = normalizeCaseActions(record.actions, normalizedFallback, { ...timestampOptions, validEvidencePinIds: pinIds });
  const assertions = normalizeCaseAssertions(record.assertions, normalizedFallback, pinIds, timestampOptions);
  const sightings = normalizeCaseSightings(record.sightings, normalizedFallback, pinIds, timestampOptions);
  const observedEffects = normalizeCaseObservedEffectHistory(
    importedVersion >= 13 ? record.observedEffects : undefined,
    normalizedFallback,
    pinIds,
    new Set(sightings.map((item) => item.id)),
    timestampOptions,
  );
  const closures = normalizeCaseClosureHistory(
    importedVersion >= 13 ? record.closures : undefined,
    normalizedFallback,
    new Set(observedEffects.reviews.map((item) => item.id)),
    new Set(actions.map((item) => item.id)),
    timestampOptions,
    buildCaseClosureLinkContext(observedEffects, actions),
  );
  const branchReferences = caseInvestigationBranchReferences({ evidencePins, actions, assertions });
  const brandProfileReferences = importedVersion >= 12
    ? inspectCaseBrandProfileIds(record.brandProfileIds)
    : { ids: [], omitted: 0 };
  return {
    domain,
    rawId: typeof record.id === 'string' ? record.id : null,
    status: importScalar(record.status, STATUS_VALUES),
    disposition: importScalar(record.disposition, DISPOSITION_VALUES),
    reviewReasonCode: Object.hasOwn(record, 'reviewReasonCode')
      ? normalizeReviewReasonCode(record.reviewReasonCode)
      : undefined,
    brandProfileIds: brandProfileReferences.ids,
    brandProfileReferencesOmitted: brandProfileReferences.omitted,
    source: importScalar(record.source, SOURCE_VALUES),
    evidenceHistory: normalizeEvidenceHistory(rawEvidence, {
      source: 'import',
      fallback: importFallback,
      sourceVersion: importedVersion,
      caseDomain: domain,
    }),
    evidencePins,
    decisions: normalizeCaseDecisions(record.decisions, normalizedFallback, pinIds, timestampOptions),
    actions,
    assertions,
    manualTrail: normalizeCaseManualTrail(record.manualTrail, normalizedFallback, timestampOptions),
    sightings,
    observedEffects,
    closures,
    branches: importedVersion >= 11
      ? normalizeCaseInvestigationBranches(record.branches, normalizedFallback, branchReferences, timestampOptions)
      : [],
    tags: normalizeTags(record.tags),
    // Imported notes fall back only to the imported record's own timestamps
    // (never "now"), so a timestamp-less note gets a stable, deterministic time
    // and id, and re-importing the same file cannot manufacture a duplicate or a
    // spuriously-newer note.
    notes: normalizeNotes(record.notes, importFallback, importedVersion),
    createdAt: caseTimestampOrNull(record.createdAt, importedVersion),
    updatedAt: caseTimestampOrNull(record.updatedAt, importedVersion),
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
  caseDomain: string,
): CaseEvidenceSnapshot[] {
  return normalizeEvidenceHistory([...local, ...imported], { source: 'import', fallback: null, caseDomain });
}

/** @param {ImportPatch} patch @param {string} now @returns {CaseRecord} */
function caseFromPatch(patch: ImportPatch, now: string): CaseRecord {
  return {
    id: '', // assigned by mergeCases so it can guarantee uniqueness against locals
    domain: patch.domain,
    status: patch.status ?? DEFAULT_STATUS,
    disposition: patch.disposition ?? DEFAULT_DISPOSITION,
    reviewReasonCode: patch.reviewReasonCode ?? null,
    brandProfileIds: patch.brandProfileIds,
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
    observedEffects: patch.observedEffects,
    closures: patch.closures,
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
function applyImportPatch(
  local: CaseRecord,
  patch: ImportPatch,
): { record: CaseRecord; brandProfileReferencesOmitted: number } {
  const importNewer = patch.updatedAt !== null && Date.parse(patch.updatedAt) > Date.parse(local.updatedAt);
  const fallback = patch.updatedAt || local.updatedAt;
  const evidencePins = mergeCaseEvidencePins(local.evidencePins, patch.evidencePins, fallback);
  const pinIds = new Set(evidencePins.map((item) => item.id));
  const actions = mergeCaseActions(local.actions, patch.actions, fallback, pinIds);
  const assertions = mergeCaseAssertions(local.assertions, patch.assertions, fallback, pinIds);
  const branchReferences = caseInvestigationBranchReferences({ evidencePins, actions, assertions });
  const sightings = mergeCaseSightings(local.sightings, patch.sightings, fallback, pinIds);
  const sightingIds = new Set(sightings.map((item) => item.id));
  const observedEffects = mergeCaseObservedEffectHistories(
    local.observedEffects,
    patch.observedEffects,
    fallback,
    pinIds,
    sightingIds,
  );
  const closures = mergeCaseClosureHistories(
    local.closures,
    patch.closures,
    fallback,
    new Set(observedEffects.reviews.map((item) => item.id)),
    new Set(actions.map((item) => item.id)),
    buildCaseClosureLinkContext(observedEffects, actions),
  );
  const brandProfileReferences = unionCaseBrandProfileIds(local.brandProfileIds, patch.brandProfileIds);
  return { record: {
    ...local,
    status: patch.status !== undefined && importNewer ? patch.status : local.status,
    disposition: patch.disposition !== undefined && importNewer ? patch.disposition : local.disposition,
    reviewReasonCode: patch.reviewReasonCode !== undefined && importNewer ? patch.reviewReasonCode : local.reviewReasonCode ?? null,
    brandProfileIds: brandProfileReferences.ids,
    source: patch.source !== undefined && importNewer ? patch.source : local.source,
    evidenceHistory: mergeEvidenceHistories(local.evidenceHistory, patch.evidenceHistory, local.domain),
    evidencePins,
    decisions: mergeCaseDecisions(local.decisions, patch.decisions, fallback, pinIds),
    actions,
    assertions,
    manualTrail: mergeCaseManualTrail(local.manualTrail, patch.manualTrail, fallback),
    sightings,
    observedEffects,
    closures,
    branches: mergeCaseInvestigationBranches(local.branches ?? [], patch.branches, fallback, branchReferences),
    tags: normalizeTags([...local.tags, ...patch.tags]),
    notes: unionNotes(local.notes, patch.notes),
    createdAt: patch.createdAt && Date.parse(patch.createdAt) < Date.parse(local.createdAt) ? patch.createdAt : local.createdAt,
    updatedAt: importNewer ? (patch.updatedAt ?? local.updatedAt) : local.updatedAt,
  }, brandProfileReferencesOmitted: brandProfileReferences.omitted };
}

function pickFreeId(preferred: unknown, domain: string, used: Set<string>): string {
  const wanted = safeId(preferred);
  let id = wanted && !used.has(wanted) ? wanted : deterministicId(domain);
  const base = deterministicId(domain);
  let suffix = 2;
  while (used.has(id)) id = `${base}-${suffix++}`;
  return id;
}

const CASE_EXPORT_ROOT_KEYS = Object.freeze(['version', 'exportedAt', 'cases'] as const);

function assertOnlyEnvelopeKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedKeys = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new Error(`The WHOISleuth ${label} contains undeclared envelope fields.`);
  }
}

function exactStringList(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((item, index) => item === expected[index]);
}

/**
 * A CLI Case-pack remains browser-importable through its exact top-level Case
 * collection. This projection closes the known pack envelopes before dropping
 * pack-only review and integrity metadata; it does not make an integrity claim.
 * The statically bound CLI verifier remains the exact structure-and-digest
 * verifier for both retained Case-pack versions.
 */
function caseCollectionImportEnvelope(importedRaw: unknown): Record<string, unknown> {
  const root = objectRecord(importedRaw);
  const hasPackField = Object.hasOwn(root, 'packet') || Object.hasOwn(root, 'integrity');
  if (!hasPackField) {
    assertOnlyEnvelopeKeys(root, CASE_EXPORT_ROOT_KEYS, 'case export');
    return root;
  }

  assertOnlyEnvelopeKeys(root, CLI_CASE_PACK_ROOT_KEYS, 'CLI Case-pack');
  if (CLI_CASE_PACK_ROOT_KEYS.some((key) => !Object.hasOwn(root, key))) {
    throw new Error('The WHOISleuth CLI Case-pack is missing a required envelope field.');
  }
  const packet = objectRecord(root.packet);
  const integrity = objectRecord(root.integrity);
  const redactionManifest = objectRecord(packet.redactionManifest);
  assertOnlyEnvelopeKeys(packet, CLI_CASE_PACK_PACKET_KEYS, 'CLI Case-pack packet');
  assertOnlyEnvelopeKeys(integrity, CLI_CASE_PACK_INTEGRITY_KEYS, 'CLI Case-pack integrity');
  const rootVersion = root.version;
  const packVersion = packet.version;
  const currentPack = packVersion === CLI_CASE_PACK_VERSION;
  const historicalPack = packVersion === LEGACY_CLI_CASE_PACK_VERSION;
  const supportsBrandProfileReferences = typeof rootVersion === 'number' && rootVersion >= 12;
  assertOnlyEnvelopeKeys(
    redactionManifest,
    supportsBrandProfileReferences ? CLI_CASE_PACK_CURRENT_REDACTION_KEYS : CLI_CASE_PACK_LEGACY_REDACTION_KEYS,
    'CLI Case-pack redaction manifest',
  );
  const reports = packet.reports;
  const cases = root.cases;
  const audience = packet.audience;
  const expectedCanonicalization = historicalPack ? 'sorted-json-v1' : 'sorted-json-v2';
  if (packet.schema !== CLI_CASE_PACK_SCHEMA
    || (!historicalPack && !currentPack)
    || typeof rootVersion !== 'number'
    || !CASE_IMPORT_VERSIONS.includes(rootVersion as typeof CASE_IMPORT_VERSIONS[number])
    || (currentPack
      ? (rootVersion !== 13 && rootVersion !== CASE_SCHEMA_VERSION)
      : (rootVersion === 13 || rootVersion === CASE_SCHEMA_VERSION))
    || packet.reviewed !== true
    || (audience !== 'internal' && audience !== 'public' && audience !== 'trusted')
    || !Array.isArray(cases)
    || !Array.isArray(reports)
    || reports.length !== cases.length
    || !exactStringList(packet.limitations, CLI_CASE_PACK_LIMITATIONS)
    || !Number.isSafeInteger(redactionManifest.sourceCaseCount)
    || redactionManifest.sourceCaseCount !== cases.length
    || (supportsBrandProfileReferences
      && (!Number.isSafeInteger(redactionManifest.brandProfileReferencesOmitted)
        || (redactionManifest.brandProfileReferencesOmitted as number) < 0))
    || integrity.algorithm !== 'SHA-256'
    || integrity.canonicalization !== expectedCanonicalization
    || typeof integrity.digestSha256 !== 'string'
    || !/^sha256:[a-f0-9]{64}$/u.test(integrity.digestSha256)
    || typeof root.exportedAt !== 'string'
    || caseTimestampOrNull(root.exportedAt) !== root.exportedAt) {
    throw new Error('The WHOISleuth CLI Case-pack envelope is invalid.');
  }
  for (const reportValue of reports) {
    const report = objectRecord(reportValue);
    assertOnlyEnvelopeKeys(report, CLI_CASE_PACK_REPORT_KEYS, 'CLI Case-pack report');
    if (report.schema !== CASE_REPORT_SCHEMA
      || !caseReportVersionMatchesCase(rootVersion as number, report.schemaVersion)
      || report.generatedAt !== root.exportedAt) {
      throw new Error('The WHOISleuth CLI Case-pack report epoch is invalid.');
    }
  }
  if (currentPack) {
    const normalised = normalizeCaseStore(root).cases;
    const expectedCases = rootVersion === 13
      ? normalised.map((item) => ({
          ...structuredClone(item),
          evidenceHistory: item.evidenceHistory.map(({ inputHostname: _inputHostname, ...snapshot }) => snapshot),
        }))
      : normalised;
    if (normalised.length !== cases.length
      || canonicalArtifactJsonV2(cases) !== canonicalArtifactJsonV2(expectedCases)) {
      throw new Error(`The WHOISleuth CLI Case-pack contains a non-canonical schema ${rootVersion} Case collection.`);
    }
  }
  return { version: rootVersion, exportedAt: root.exportedAt, cases };
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
 * @returns {{ cases: CaseRecord[], added: number, updated: number, skipped: number, brandProfileReferencesOmitted: number }}
 */
export function mergeCases(
  localCases: CaseRecord[],
  importedRaw: unknown,
): { cases: CaseRecord[]; added: number; updated: number; skipped: number; brandProfileReferencesOmitted: number } {
  const importedEnvelope = caseCollectionImportEnvelope(importedRaw);
  const importedVersion = parseStoreVersion(importedEnvelope);
  if (importedVersion !== null && Number.isInteger(importedVersion) && importedVersion > CASE_SCHEMA_VERSION) {
    throw new Error(`This case file was exported by a newer version of WHOISleuth (schema ${importedVersion}). Update the app before importing it.`);
  }
  if (!CASE_IMPORT_VERSIONS.includes(importedVersion as typeof CASE_IMPORT_VERSIONS[number])
    || !Array.isArray(importedEnvelope.cases)) {
    throw new Error(`Expected a WHOISleuth case export using schema ${CASE_IMPORT_VERSIONS.join(' or ')}.`);
  }
  const local = normalizeCaseStore(localCases).cases;
  const supportedImportedVersion = importedVersion ?? 0;
  const byDomain = new Map(local.map((item) => [item.domain, item]));
  const usedIds = new Set(local.map((item) => item.id));
  let added = 0;
  let updated = 0;
  const imported = boundedCaseList(importedEnvelope);
  let skipped = imported.omitted;
  let brandProfileReferencesOmitted = 0;
  const fallback = new Date(0).toISOString();
  for (const item of imported.items) {
    const patch = extractImportPatch(item, supportedImportedVersion);
    if (!patch) {
      skipped += 1;
      continue;
    }
    const existing = byDomain.get(patch.domain);
    if (existing) {
      const merged = applyImportPatch(existing, patch);
      byDomain.set(patch.domain, merged.record);
      brandProfileReferencesOmitted += patch.brandProfileReferencesOmitted + merged.brandProfileReferencesOmitted;
      updated += 1;
    } else if (byDomain.size < MAX_CASES) {
      const record = caseFromPatch(patch, fallback);
      record.id = pickFreeId(patch.rawId, patch.domain, usedIds);
      usedIds.add(record.id);
      byDomain.set(patch.domain, record);
      brandProfileReferencesOmitted += patch.brandProfileReferencesOmitted;
      added += 1;
    } else {
      skipped += 1;
    }
  }
  return {
    cases: normalizeCaseStore([...byDomain.values()]).cases,
    added,
    updated,
    skipped,
    brandProfileReferencesOmitted,
  };
}
