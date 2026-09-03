// Pure, framework-neutral analyst-case records, evidence histories, bounded
// record normalization, and analyst updates.

import {
  appendCaseAction,
  appendCaseAssertion,
  appendCaseClosure,
  appendCaseDecision,
  appendCaseEvidencePin,
  appendCaseEvidencePins,
  appendCaseManualTrailEvent,
  appendCaseObservedEffectReview,
  appendCaseSighting,
  buildCaseClosureLinkContext,
  normalizeCaseActions,
  normalizeCaseAssertions,
  normalizeCaseClosureHistory,
  normalizeCaseDecisions,
  normalizeCaseEvidencePins,
  normalizeCaseManualTrail,
  normalizeCaseObservedEffectHistory,
  normalizeCaseSightings,
  updateCaseAction,
  updateCaseAssertion,
  type CaseEvidenceRelationStance,
} from './case-response-model.mts';
import {
  CASE_SCHEMA_VERSION,
  MAX_CASES,
  MAX_NOTES_PER_CASE,
  type CaseEvidenceSnapshot,
  type CaseInput,
  type CasePatch,
  type CaseRecord,
} from './case-record-contracts.mts';
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
} from './case-record-core.mts';
import {
  assertCaseBrandProfileIds,
  normalizeCaseBrandProfileIds,
} from './case-brand-profile-references.mts';
import {
  normalizeEvidenceHistory,
} from './case-evidence-model.mts';
import {
  appendCaseInvestigationBranch,
  caseInvestigationBranchReferences,
  normalizeCaseInvestigationBranches,
  updateCaseInvestigationBranch,
} from './case-investigation-branch-model.mts';
import {
  caseInvestigationContext,
  caseInvestigationContextAssertion,
  parseIncidentUrlContext,
} from './case-investigation-context.mts';

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
  domain: string,
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
      caseDomain: domain,
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
  const timestampOptions = {
    legacyTimestamps: sourceVersion != null && sourceVersion < CASE_SCHEMA_VERSION,
    ...(sourceVersion === undefined ? {} : { sourceVersion }),
  };
  const evidencePins = normalizeCaseEvidencePins(record.evidencePins, updatedAt, timestampOptions);
  const pinIds = new Set(evidencePins.map((item) => item.id));
  const actions = normalizeCaseActions(record.actions, updatedAt, { ...timestampOptions, validEvidencePinIds: pinIds });
  const assertions = normalizeCaseAssertions(record.assertions, updatedAt, pinIds, timestampOptions);
  const sightings = normalizeCaseSightings(record.sightings, updatedAt, pinIds, timestampOptions);
  const sightingIds = new Set(sightings.map((item) => item.id));
  const observedEffects = normalizeCaseObservedEffectHistory(
    sourceVersion != null && sourceVersion < 13 ? undefined : record.observedEffects,
    updatedAt,
    pinIds,
    sightingIds,
    timestampOptions,
  );
  const closures = normalizeCaseClosureHistory(
    sourceVersion != null && sourceVersion < 13 ? undefined : record.closures,
    updatedAt,
    new Set(observedEffects.reviews.map((item) => item.id)),
    new Set(actions.map((item) => item.id)),
    timestampOptions,
    buildCaseClosureLinkContext(observedEffects, actions),
  );
  const normalizedStatus = normalizeStatus(record.status);
  const branchReferences = caseInvestigationBranchReferences({ evidencePins, actions, assertions });
  return {
    id: existing ? existing.id : safeId(record.id) || deterministicId(domain),
    domain,
    status: normalizedStatus === 'resolved'
      && closures.records.length === 0 && !closures.preV13HistoryUnavailable
      ? 'reviewing'
      : normalizedStatus,
    disposition: normalizeDisposition(record.disposition),
    reviewReasonCode: normalizeReviewReasonCode(record.reviewReasonCode),
    brandProfileIds: normalizeCaseBrandProfileIds(record.brandProfileIds),
    tags: normalizeTags(record.tags),
    notes: normalizeNotes(record.notes, now, sourceVersion),
    source: normalizeSource(record.source),
    evidenceHistory: normalizeCaseEvidence(record, domain, createdAt, updatedAt, now, sourceVersion),
    evidencePins,
    decisions: normalizeCaseDecisions(record.decisions, updatedAt, pinIds, timestampOptions),
    actions,
    assertions,
    manualTrail: normalizeCaseManualTrail(record.manualTrail, updatedAt, timestampOptions),
    sightings,
    observedEffects,
    closures,
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
  const sightings = input.sighting !== undefined
    ? appendCaseSighting([], input.sighting, now, pinIds)
    : [];
  const observedEffects = input.observedEffectReview !== undefined
    ? appendCaseObservedEffectReview(
        normalizeCaseObservedEffectHistory(undefined, now),
        input.observedEffectReview,
        now,
        pinIds,
        new Set(sightings.map((item) => item.id)),
      )
    : normalizeCaseObservedEffectHistory(undefined, now);
  const closures = input.closure !== undefined
    ? appendCaseClosure(normalizeCaseClosureHistory(undefined, now), input.closure, now, observedEffects, actions)
    : normalizeCaseClosureHistory(undefined, now);
  if (normalizeStatus(input.status) === 'resolved' && input.closure === undefined) {
    throw new Error('Opening a resolved case requires a deliberate closure reason and its linked review context.');
  }
  return {
    id: makeId(),
    domain,
    status: input.closure !== undefined ? 'resolved' : normalizeStatus(input.status),
    disposition: normalizeDisposition(input.disposition),
    reviewReasonCode: normalizeReviewReasonCode(input.reviewReasonCode),
    brandProfileIds: input.brandProfileIds === undefined ? [] : assertCaseBrandProfileIds(input.brandProfileIds),
    tags: normalizeTags(input.tags),
    notes: noteBody ? [{ id: makeId(), body: noteBody, createdAt: now }] : [],
    source,
    evidenceHistory: normalizeEvidenceHistory(input.evidence ? [input.evidence] : [], {
      source: inferCaptureSource(source),
      fallback: now,
      caseDomain: domain,
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
    sightings,
    observedEffects,
    closures,
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
      { source: inferCaptureSource(source), fallback: now, caseDomain: current.domain },
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
    actions = updateCaseAction(actions, patch.actionUpdate, now, pinIds);
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
  let observedEffects = normalizeCaseObservedEffectHistory(
    current.observedEffects,
    current.updatedAt,
    pinIds,
    new Set(sightings.map((item) => item.id)),
  );
  if (patch.observedEffectReview !== undefined) {
    observedEffects = appendCaseObservedEffectReview(
      observedEffects,
      patch.observedEffectReview,
      now,
      pinIds,
      new Set(sightings.map((item) => item.id)),
    );
  }
  let closures = normalizeCaseClosureHistory(
    current.closures,
    current.updatedAt,
    new Set(observedEffects.reviews.map((item) => item.id)),
    new Set(actions.map((item) => item.id)),
    {},
    buildCaseClosureLinkContext(observedEffects, actions),
  );
  if (patch.closure !== undefined) {
    closures = appendCaseClosure(closures, patch.closure, now, observedEffects, actions);
  }
  if (patch.status === 'resolved' && patch.closure === undefined) {
    throw new Error('Resolve this case through the deliberate closure review so the reason and evidence state remain explicit.');
  }
  const record: CaseRecord = {
    ...current,
    status: patch.closure !== undefined
      ? 'resolved'
      : patch.status !== undefined ? normalizeStatus(patch.status) : current.status,
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
    observedEffects,
    closures,
    branches,
    notes,
    updatedAt: now,
  };
  const next = [...cases];
  next[index] = record;
  return { cases: next, record };
}

export type CaseConclusionEvidence = Readonly<{
  pin: unknown;
  stance: CaseEvidenceRelationStance;
}>;

export type CaseConclusionInput = Readonly<{
  disposition: unknown;
  reviewReasonCode: unknown;
  summary: unknown;
  rationale: unknown;
  evidence: readonly CaseConclusionEvidence[];
}>;

/**
 * Records one reviewed conclusion as a single pure Case mutation. The selected
 * observations become bounded Case pins before the decision is created, so the
 * decision cannot point at absent evidence. Counterevidence is retained as a
 * separate resolved contradiction assertion rather than being hidden inside a
 * favourable disposition.
 */
export function recordCaseConclusion(
  cases: CaseRecord[],
  id: string,
  input: CaseConclusionInput,
  nowIso?: string,
): { cases: CaseRecord[]; record: CaseRecord } {
  const now = caseTimestampOrNull(nowIso) || new Date().toISOString();
  const disposition = normalizeDisposition(input.disposition);
  const reviewReasonCode = normalizeReviewReasonCode(input.reviewReasonCode);
  if (disposition === 'unreviewed') {
    throw new Error('Select a reviewed disposition before recording a conclusion.');
  }
  if (!reviewReasonCode) {
    throw new Error('Select the reviewed reason before recording a conclusion.');
  }
  if (!Array.isArray(input.evidence) || !input.evidence.length) {
    throw new Error('Select at least one observed fact for this conclusion.');
  }
  const invalidStance = input.evidence.find((item) => (
    !item || !['supports', 'contradicts', 'unresolved'].includes(item.stance)
  ));
  if (invalidStance) throw new Error('A conclusion evidence relationship is invalid.');
  if (!input.evidence.some((item) => item.stance === 'supports')) {
    throw new Error('A conclusion requires at least one observed fact that supports it. Record only contradictory or unresolved material as an assertion instead.');
  }

  const current = cases.find((item) => item.id === id);
  if (!current) throw new Error('That case no longer exists.');
  const existingPinIds = new Set(current.evidencePins.map((pin) => pin.id));
  const withPins = updateCase(cases, id, {
    evidencePins: input.evidence.map((item) => item.pin),
  }, now);
  const addedPins = withPins.record.evidencePins.filter((pin) => !existingPinIds.has(pin.id));
  if (addedPins.length !== input.evidence.length) {
    throw new Error('The selected conclusion evidence could not be retained completely.');
  }

  const supportingPinIds = addedPins.flatMap((pin, index) => (
    input.evidence[index]?.stance === 'supports' ? [pin.id] : []
  ));
  let concluded = updateCase(withPins.cases, id, {
    disposition,
    reviewReasonCode,
    decision: {
      summary: input.summary,
      rationale: input.rationale,
      evidencePinIds: supportingPinIds,
    },
  }, now);

  const contradictionRelations = addedPins.flatMap((pin, index) => (
    input.evidence[index]?.stance === 'contradicts'
      ? [{ evidencePinId: pin.id, stance: 'contradicts' as const }]
      : []
  ));
  if (contradictionRelations.length) {
    const retainedSummary = concluded.record.decisions.at(-1)?.summary ?? 'Analyst conclusion';
    concluded = updateCase(concluded.cases, id, {
      assertion: {
        kind: 'contradiction',
        statement: `Counterevidence considered for: ${retainedSummary}`,
        rationale: input.rationale,
        evidenceRelations: contradictionRelations,
        state: 'resolved',
      },
    }, now);
  }
  const unresolvedRelations = addedPins.flatMap((pin, index) => (
    input.evidence[index]?.stance === 'unresolved'
      ? [{ evidencePinId: pin.id, stance: 'unresolved' as const }]
      : []
  ));
  if (unresolvedRelations.length) {
    const retainedSummary = concluded.record.decisions.at(-1)?.summary ?? 'Analyst conclusion';
    concluded = updateCase(concluded.cases, id, {
      assertion: {
        kind: 'unknown',
        statement: `Unresolved evidence considered for: ${retainedSummary}`,
        rationale: input.rationale,
        evidenceRelations: unresolvedRelations,
        state: 'open',
      },
    }, now);
  }
  return concluded;
}

export function recordCaseInvestigationContext(
  cases: CaseRecord[],
  id: string,
  input: Readonly<{ objective: unknown; incidentUrl: unknown; retainExactUrl: boolean }>,
  nowIso?: string,
): { cases: CaseRecord[]; record: CaseRecord } {
  const current = cases.find((item) => item.id === id);
  if (!current) throw new Error('That case no longer exists.');
  const parsed = parseIncidentUrlContext(input.incidentUrl);
  if (!parsed || parsed.registrableDomain !== current.domain) {
    throw new Error(`The Incident URL must belong to the Case domain ${current.domain}.`);
  }
  const context = caseInvestigationContextAssertion(input);
  const existing = caseInvestigationContext(current);
  return updateCase(cases, id, existing
    ? {
        assertionUpdate: {
          id: existing.assertionId,
          statement: context.statement,
          rationale: context.rationale,
          state: 'open',
        },
      }
    : {
        assertion: {
          kind: 'next_step',
          statement: context.statement,
          rationale: context.rationale,
          evidenceRelations: [],
          state: 'open',
        },
      }, nowIso);
}

export function recordCaseRecheckOutcome(
  cases: CaseRecord[],
  id: string,
  input: Readonly<{
    state: unknown;
    observedAt: unknown;
    completeness: unknown;
    comparisonSummary: unknown;
    source: unknown;
    followUpAt?: unknown;
    limitations?: unknown;
    collectionDepth?: unknown;
  }>,
  nowIso?: string,
): { cases: CaseRecord[]; record: CaseRecord } {
  const now = caseTimestampOrNull(nowIso) || new Date().toISOString();
  const current = cases.find((item) => item.id === id);
  if (!current) throw new Error('That case no longer exists.');
  const beforePinIds = new Set(current.evidencePins.map((pin) => pin.id));
  const withPin = updateCase(cases, id, {
    evidencePin: {
      field: 'case.recheck_comparison',
      category: 'recheck',
      label: 'Recheck comparison',
      value: input.comparisonSummary,
      source: input.source,
      sourceState: 'reviewed',
      observedAt: input.observedAt,
      collectionDepth: input.collectionDepth,
      completeness: input.completeness,
      truncated: false,
      limitations: input.limitations,
    },
  }, now);
  const comparisonPin = withPin.record.evidencePins.find((pin) => !beforePinIds.has(pin.id));
  if (!comparisonPin) throw new Error('The recheck comparison could not be retained.');
  return updateCase(withPin.cases, id, {
    observedEffectReview: {
      state: input.state,
      observedAt: input.observedAt,
      sourceClass: 'analyst',
      source: input.source,
      completeness: input.completeness,
      evidencePinId: comparisonPin.id,
      followUpAt: input.followUpAt,
      limitations: input.limitations,
    },
  }, now);
}
