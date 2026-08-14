// Pure, framework-neutral analyst-case records, evidence histories, bounded
// record normalization, and analyst updates.

import {
  appendCaseAction,
  appendCaseAssertion,
  appendCaseDecision,
  appendCaseEvidencePin,
  appendCaseEvidencePins,
  appendCaseManualTrailEvent,
  appendCaseSighting,
  normalizeCaseActions,
  normalizeCaseAssertions,
  normalizeCaseDecisions,
  normalizeCaseEvidencePins,
  normalizeCaseManualTrail,
  normalizeCaseSightings,
  updateCaseAction,
  updateCaseAssertion,
} from './case-response-model.ts';
import {
  CASE_SCHEMA_VERSION,
  MAX_CASES,
  MAX_NOTES_PER_CASE,
  type CaseEvidenceSnapshot,
  type CaseInput,
  type CasePatch,
  type CaseRecord,
} from './case-record-contracts.ts';
import {
  DEFAULT_EVIDENCE_SOURCE,
  EVIDENCE_SOURCE_SET,
  caseTimestampOrNull,
  deterministicId,
  makeId,
  normalizeDisposition,
  normalizeDomain,
  normalizeNoteBody,
  normalizeReviewReasonCode,
  normalizeNotes,
  normalizeSource,
  normalizeStatus,
  normalizeTags,
  objectRecord,
  safeId,
} from './case-record-core.ts';
import {
  assertCaseBrandProfileIds,
  normalizeCaseBrandProfileIds,
} from './case-brand-profile-references.ts';
import {
  normalizeEvidenceHistory,
} from './case-evidence-model.ts';
import {
  appendCaseInvestigationBranch,
  caseInvestigationBranchReferences,
  normalizeCaseInvestigationBranches,
  updateCaseInvestigationBranch,
} from './case-investigation-branch-model.ts';

// ---------------------------------------------------------------------------
// Case normalization
// ---------------------------------------------------------------------------

// A case's own source maps onto snapshot provenance for newly captured
// evidence. A hand-opened ('manual') case has no scan provenance.
function inferCaptureSource(caseSource: unknown): string {
  return typeof caseSource === 'string' && EVIDENCE_SOURCE_SET.has(caseSource) && caseSource !== 'import'
    ? caseSource
    : DEFAULT_EVIDENCE_SOURCE;
}

// Builds a case's bounded current-schema evidence history. Uses a lenient
// local fallback timestamp so recoverable current data always loads.
function normalizeCaseEvidence(
  record: Record<string, unknown>,
  createdAt: string,
  updatedAt: string,
  now: string,
  sourceVersion?: number | null,
): CaseEvidenceSnapshot[] {
  const localFallback = updatedAt || createdAt || now;
  if (Array.isArray(record.evidenceHistory)) {
    return normalizeEvidenceHistory(record.evidenceHistory, {
      source: DEFAULT_EVIDENCE_SOURCE,
      fallback: localFallback,
      ...(sourceVersion === undefined ? {} : { sourceVersion }),
    });
  }
  return [];
}

/**
 * Validates a single case field-by-field for LOCAL recovery: missing scalars
 * and timestamps are defaulted so our own stored data always loads. Returns
 * null when the record has no usable domain. An `existing` record preserves
 * stable identity/timestamps across an update. Import validation is separate
 * (see mergeCases) so a defaulted value can never win over local data.
 * @param {unknown} raw
 * @param {CaseRecord} [existing]
 * @param {string} [nowIso]
 * @returns {CaseRecord | null}
 */
export function normalizeCase(
  raw: unknown,
  existing?: CaseRecord,
  nowIso?: string,
  sourceVersion?: number | null,
): CaseRecord | null {
  const now = caseTimestampOrNull(nowIso) || new Date().toISOString();
  const record = objectRecord(raw);
  const domain = normalizeDomain(existing ? existing.domain : record.domain);
  if (!domain) return null;
  const createdAt = existing ? existing.createdAt : caseTimestampOrNull(record.createdAt, sourceVersion) || now;
  const updatedAt = caseTimestampOrNull(record.updatedAt, sourceVersion) || createdAt;
  const timestampOptions = { legacyTimestamps: sourceVersion != null && sourceVersion < CASE_SCHEMA_VERSION };
  const evidencePins = normalizeCaseEvidencePins(record.evidencePins, updatedAt, timestampOptions);
  const pinIds = new Set(evidencePins.map((item) => item.id));
  const actions = normalizeCaseActions(record.actions, updatedAt, timestampOptions);
  const assertions = normalizeCaseAssertions(record.assertions, updatedAt, pinIds, timestampOptions);
  const branchReferences = caseInvestigationBranchReferences({ evidencePins, actions, assertions });
  return {
    id: existing ? existing.id : safeId(record.id) || deterministicId(domain),
    domain,
    status: normalizeStatus(record.status),
    disposition: normalizeDisposition(record.disposition),
    reviewReasonCode: normalizeReviewReasonCode(record.reviewReasonCode),
    brandProfileIds: normalizeCaseBrandProfileIds(record.brandProfileIds),
    tags: normalizeTags(record.tags),
    notes: normalizeNotes(record.notes, now, sourceVersion),
    source: normalizeSource(record.source),
    evidenceHistory: normalizeCaseEvidence(record, createdAt, updatedAt, now, sourceVersion),
    evidencePins,
    decisions: normalizeCaseDecisions(record.decisions, updatedAt, pinIds, timestampOptions),
    actions,
    assertions,
    manualTrail: normalizeCaseManualTrail(record.manualTrail, updatedAt, timestampOptions),
    sightings: normalizeCaseSightings(record.sightings, updatedAt, pinIds, timestampOptions),
    branches: normalizeCaseInvestigationBranches(record.branches, updatedAt, branchReferences, timestampOptions),
    createdAt,
    updatedAt,
  };
}

/**
 * @param {{ domain: unknown, status?: unknown, disposition?: unknown, source?: unknown, tags?: unknown, evidence?: unknown, note?: unknown }} input
 * @param {string} [nowIso]
 * @returns {CaseRecord}
 */
export function createCase(input: CaseInput, nowIso?: string): CaseRecord {
  const now = caseTimestampOrNull(nowIso) || new Date().toISOString();
  const domain = normalizeDomain(input.domain);
  if (!domain) throw new Error('A valid domain is required to open a case.');
  const noteBody = normalizeNoteBody(input.note);
  const source = normalizeSource(input.source);
  const evidencePins = input.evidencePins !== undefined
    ? appendCaseEvidencePins([], input.evidencePins, now)
    : input.evidencePin !== undefined
      ? appendCaseEvidencePin([], input.evidencePin, now)
      : [];
  const pinIds = new Set(evidencePins.map((item) => item.id));
  const actions = input.action !== undefined
    ? appendCaseAction([], input.action, now)
    : [];
  const assertions = input.assertion !== undefined
    ? appendCaseAssertion([], input.assertion, now)
    : [];
  const branchReferences = caseInvestigationBranchReferences({ evidencePins, actions, assertions });
  return {
    id: makeId(),
    domain,
    status: normalizeStatus(input.status),
    disposition: normalizeDisposition(input.disposition),
    reviewReasonCode: normalizeReviewReasonCode(input.reviewReasonCode),
    brandProfileIds: input.brandProfileIds === undefined ? [] : assertCaseBrandProfileIds(input.brandProfileIds),
    tags: normalizeTags(input.tags),
    notes: noteBody ? [{ id: makeId(), body: noteBody, createdAt: now }] : [],
    source,
    evidenceHistory: normalizeEvidenceHistory(input.evidence ? [input.evidence] : [], {
      source: inferCaptureSource(source),
      fallback: now,
    }),
    evidencePins,
    decisions: input.decision !== undefined
      ? appendCaseDecision([], input.decision, now)
      : [],
    actions,
    assertions,
    manualTrail: input.trailEvent !== undefined
      ? appendCaseManualTrailEvent([], input.trailEvent, now)
      : [],
    sightings: input.sighting !== undefined
      ? appendCaseSighting([], input.sighting, now, pinIds)
      : [],
    branches: input.branch !== undefined
      ? appendCaseInvestigationBranch([], input.branch, now, branchReferences)
      : [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Opens the existing case for a domain, or creates one. Returns a new array
 * (callers persist it) plus the resolved record and whether it was created.
 * @param {CaseRecord[]} cases
 * @param {{ domain: unknown, status?: unknown, disposition?: unknown, source?: unknown, tags?: unknown, evidence?: unknown, note?: unknown }} input
 * @param {string} [nowIso]
 * @returns {{ cases: CaseRecord[], record: CaseRecord, created: boolean }}
 */
export function openOrCreateCase(
  cases: CaseRecord[],
  input: CaseInput,
  nowIso?: string,
): { cases: CaseRecord[]; record: CaseRecord; created: boolean } {
  const domain = normalizeDomain(input.domain);
  if (!domain) throw new Error('A valid domain is required to open a case.');
  const existing = cases.find((item) => item.domain === domain);
  if (existing) return { cases, record: existing, created: false };
  if (cases.length >= MAX_CASES) throw new Error(`Cases are limited to ${MAX_CASES}. Delete or export some first.`);
  const record = createCase({ ...input, domain }, nowIso);
  return { cases: [record, ...cases], record, created: true };
}

/**
 * Applies a partial update to one case by id, bumping updatedAt. A `note` in
 * the patch is appended (respecting the per-case note bound); a `tags` array
 * replaces the tag set; an `evidence` value appends a new snapshot to the
 * history (deduplicated, so a materially identical re-capture only advances the
 * latest observation time). Returns a new array and the updated record.
 * @param {CaseRecord[]} cases
 * @param {string} id
 * @param {{ status?: unknown, disposition?: unknown, tags?: unknown, source?: unknown, evidence?: unknown, note?: unknown }} patch
 * @param {string} [nowIso]
 * @returns {{ cases: CaseRecord[], record: CaseRecord }}
 */
export function updateCase(
  cases: CaseRecord[],
  id: string,
  patch: CasePatch,
  nowIso?: string,
): { cases: CaseRecord[]; record: CaseRecord } {
  const now = caseTimestampOrNull(nowIso) || new Date().toISOString();
  const index = cases.findIndex((item) => item.id === id);
  if (index < 0) throw new Error('That case no longer exists.');
  const current = cases[index];
  if (!current) throw new Error('That case no longer exists.');
  let notes = current.notes;
  if (patch.note !== undefined) {
    const body = normalizeNoteBody(patch.note);
    if (!body) throw new Error('A note cannot be empty.');
    if (notes.length >= MAX_NOTES_PER_CASE) {
      throw new Error(`Each case is limited to ${MAX_NOTES_PER_CASE} notes.`);
    }
    notes = [...notes, { id: makeId(), body, createdAt: now }];
  }
  const source = patch.source !== undefined ? normalizeSource(patch.source) : current.source;
  let evidenceHistory = current.evidenceHistory;
  if (patch.evidence !== undefined) {
    evidenceHistory = normalizeEvidenceHistory(
      [...current.evidenceHistory, ...(patch.evidence ? [patch.evidence] : [])],
      { source: inferCaptureSource(source), fallback: now },
    );
  }
  let evidencePins = current.evidencePins;
  if (patch.evidencePins !== undefined) {
    evidencePins = appendCaseEvidencePins(evidencePins, patch.evidencePins, now);
  }
  if (patch.evidencePin !== undefined) {
    evidencePins = appendCaseEvidencePin(evidencePins, patch.evidencePin, now);
  }
  const pinIds = new Set(evidencePins.map((item) => item.id));
  let decisions = current.decisions;
  if (patch.decision !== undefined) {
    decisions = appendCaseDecision(current.decisions, patch.decision, now, pinIds);
  }
  let actions = current.actions;
  if (patch.action !== undefined) {
    actions = appendCaseAction(current.actions, patch.action, now);
  }
  if (patch.actionUpdate !== undefined) {
    actions = updateCaseAction(actions, patch.actionUpdate, now);
  }
  let assertions = current.assertions;
  if (patch.assertion !== undefined) {
    assertions = appendCaseAssertion(current.assertions, patch.assertion, now, pinIds);
  }
  if (patch.assertionUpdate !== undefined) {
    assertions = updateCaseAssertion(assertions, patch.assertionUpdate, now, pinIds);
  }
  const branchReferences = caseInvestigationBranchReferences({ evidencePins, actions, assertions });
  let branches = normalizeCaseInvestigationBranches(current.branches ?? [], current.updatedAt, branchReferences);
  if (patch.branch !== undefined) {
    branches = appendCaseInvestigationBranch(branches, patch.branch, now, branchReferences);
  }
  if (patch.branchUpdate !== undefined) {
    branches = updateCaseInvestigationBranch(branches, patch.branchUpdate, now, branchReferences);
  }
  let manualTrail = current.manualTrail;
  if (patch.trailEvent !== undefined) {
    manualTrail = appendCaseManualTrailEvent(current.manualTrail, patch.trailEvent, now);
  }
  let sightings = current.sightings;
  if (patch.sighting !== undefined) {
    sightings = appendCaseSighting(current.sightings, patch.sighting, now, pinIds);
  }
  const record: CaseRecord = {
    ...current,
    status: patch.status !== undefined ? normalizeStatus(patch.status) : current.status,
    disposition: patch.disposition !== undefined ? normalizeDisposition(patch.disposition) : current.disposition,
    reviewReasonCode: patch.reviewReasonCode !== undefined
      ? normalizeReviewReasonCode(patch.reviewReasonCode)
      : current.reviewReasonCode ?? null,
    brandProfileIds: patch.brandProfileIds !== undefined
      ? assertCaseBrandProfileIds(patch.brandProfileIds)
      : current.brandProfileIds,
    tags: patch.tags !== undefined ? normalizeTags(patch.tags) : current.tags,
    source,
    evidenceHistory,
    evidencePins,
    decisions,
    actions,
    assertions,
    manualTrail,
    sightings,
    branches,
    notes,
    updatedAt: now,
  };
  const next = [...cases];
  next[index] = record;
  return { cases: next, record };
}
