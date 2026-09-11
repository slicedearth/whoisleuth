// Bounded, framework-neutral analyst response records. These records are
// deliberately separate from collected evidence snapshots: a pin describes a
// fact selected by an analyst, a decision records analyst reasoning, and an
// action records a reviewed external or internal follow-up.

import {
  CASE_SCHEMA_VERSION,
  PUBLISHED_V2_3_CASE_SCHEMA_VERSION,
  MAX_ASSERTION_PROVENANCE_LABELS,
  MAX_ASSERTION_PROVENANCE_MARKINGS,
  MAX_CASE_ASSERTIONS,
  MAX_CASE_CHECKPOINT_FACTS,
  MAX_CASE_DECISIONS,
  MAX_CASE_EVIDENCE_PINS,
  MAX_CASE_MANUAL_TRAIL_EVENTS,
  MAX_CASE_SIGHTINGS,
  MAX_DECISION_PIN_REFERENCES,
  MAX_RESPONSE_LABEL_LENGTH,
  MAX_RESPONSE_LIMITATION_LENGTH,
  MAX_RESPONSE_RATIONALE_LENGTH,
  MAX_RESPONSE_VALUE_LENGTH,
  MAX_TRAIL_TARGET_LENGTH,
} from '../contracts/case-portability.mts';
import {
  CASE_ASSERTION_EXTERNAL_ENTITY_TYPES,
  CASE_ASSERTION_EXTERNAL_FORMATS,
  CASE_ASSERTION_KINDS,
  CASE_ASSERTION_STATES,
  CASE_DECISION_CONFIDENCE_LEVELS,
  CASE_EVIDENCE_RELATION_STANCES,
  CASE_MANUAL_TRAIL_KINDS,
  CASE_SIGHTING_CATEGORIES,
  CASE_SIGHTING_STATES,
  CASE_TRANSITION_EXPECTATIONS,
  type CaseActionRecord,
  type CaseAssertionExternalEntityType,
  type CaseAssertionExternalFormat,
  type CaseAssertionExternalProvenance,
  type CaseAssertionKind,
  type CaseAssertionRecord,
  type CaseAssertionState,
  type CaseCertificateObservation,
  type CaseClosureHistory,
  type CaseDecisionConfidence,
  type CaseDecisionRecord,
  type CaseEvidencePin,
  type CaseEvidenceRelationStance,
  type CaseInvestigationTrailItem,
  type CaseManualTrailEvent,
  type CaseManualTrailKind,
  type CaseObservedEffectHistory,
  type CasePinCompleteness,
  type CaseResponseTimestampOptions,
  type CaseSightingCategory,
  type CaseSightingRecord,
  type CaseSightingState,
  type CaseTransitionExpectation,
} from './case-response-records.mts';
import {
  COMPLETENESS,
  SAFE_ID_RE,
  compareCodeUnits,
  freshId,
  iso,
  limitations,
  optionalIso,
  record,
  safeId,
  text,
  uniqueIds,
} from './case-response-values.mts';
import { isValidAsciiHostname } from '../../lib/hostname.mts';

export * from './case-response-records.mts';
export * from './case-response-actions.mts';
export * from './case-response-outcomes.mts';

export {
  MAX_ASSERTION_PROVENANCE_LABELS,
  MAX_ASSERTION_PROVENANCE_MARKINGS,
  MAX_CASE_ACTION_BYTES,
  MAX_CASE_ACTION_EVENTS_PER_ACTION,
  MAX_CASE_ACTION_EVENTS_PER_CASE,
  MAX_CASE_ACTION_HISTORY_BYTES_PER_CASE,
  MAX_CASE_ACTIONS,
  MAX_CASE_ASSERTIONS,
  MAX_CASE_CHECKPOINT_FACTS,
  MAX_CASE_CLOSURES,
  MAX_CASE_DECISIONS,
  MAX_CASE_EVIDENCE_PINS,
  MAX_CASE_MANUAL_TRAIL_EVENTS,
  MAX_CASE_OBSERVED_EFFECT_REVIEWS,
  MAX_CASE_SIGHTINGS,
  MAX_DECISION_PIN_REFERENCES,
  MAX_RESPONSE_LABEL_LENGTH,
  MAX_RESPONSE_LIMITATION_LENGTH,
  MAX_RESPONSE_LIMITATIONS,
  MAX_RESPONSE_RATIONALE_LENGTH,
  MAX_RESPONSE_RECIPIENT_LENGTH,
  MAX_RESPONSE_REFERENCE_LENGTH,
  MAX_RESPONSE_VALUE_LENGTH,
  MAX_TRAIL_TARGET_LENGTH,
} from '../contracts/case-portability.mts';

const TRANSITION_EXPECTATIONS = new Set<string>(CASE_TRANSITION_EXPECTATIONS);

const DECISION_CONFIDENCE_LEVELS = new Set<string>(CASE_DECISION_CONFIDENCE_LEVELS);

const ASSERTION_KINDS = new Set<string>(CASE_ASSERTION_KINDS);

const ASSERTION_STATES = new Set<string>(CASE_ASSERTION_STATES);

const EVIDENCE_RELATION_STANCES = new Set<string>(CASE_EVIDENCE_RELATION_STANCES);

const ASSERTION_EXTERNAL_FORMATS = new Set<string>(CASE_ASSERTION_EXTERNAL_FORMATS);

const ASSERTION_EXTERNAL_ENTITY_TYPES = new Set<string>(CASE_ASSERTION_EXTERNAL_ENTITY_TYPES);

const TRAIL_KINDS = new Set<string>(CASE_MANUAL_TRAIL_KINDS);

const SIGHTING_STATES = new Set<string>(CASE_SIGHTING_STATES);

const SIGHTING_CATEGORIES = new Set<string>(CASE_SIGHTING_CATEGORIES);

const SHA256_RE = /^[a-f0-9]{64}$/u;

type CaseEvidencePinNormalizationOptions = CaseResponseTimestampOptions & Readonly<{
  allowCertificateObservation?: boolean;
}>;

function sourceSchema(value: unknown): CaseEvidencePin['sourceSchema'] {
  const item = record(value);
  const collection = text(item.collection, 80);
  const schema = text(item.schema, 120);
  const version = typeof item.version === 'number'
    && Number.isSafeInteger(item.version)
    && item.version > 0
    && item.version <= 10_000
    ? item.version
    : null;
  return collection && schema && version !== null ? { collection, schema, version } : null;
}

function certificateObservation(
  value: unknown,
  pin: Readonly<{ field: string | null; value: string; sourceSchema: CaseEvidencePin['sourceSchema'] }>,
  options: CaseResponseTimestampOptions = {},
): CaseCertificateObservation | null {
  const item = record(value);
  if (!Object.keys(item).length) return null;
  const keys = new Set([
    'eventId',
    'logId',
    'certificateSha256',
    'issuer',
    'notAfter',
    'dnsNameCount',
    'namesComplete',
  ]);
  if (Object.keys(item).some((key) => !keys.has(key))) return null;
  if (
    pin.sourceSchema?.collection !== 'external_observations'
    || pin.sourceSchema.schema !== 'whoisleuth.certificate-observation-rows'
    || (pin.field !== 'certificateSha256' && pin.field !== 'fingerprintSha256')
  ) return null;
  const eventId = text(item.eventId, 64);
  const logId = text(item.logId, 200);
  const certificateSha256 = text(item.certificateSha256, 64).toLowerCase();
  const issuer = item.issuer === null ? null : text(item.issuer, 160) || null;
  const notAfter = item.notAfter === null ? null : optionalIso(item.notAfter, options);
  const dnsNameCount = typeof item.dnsNameCount === 'number'
    && Number.isSafeInteger(item.dnsNameCount)
    && item.dnsNameCount >= 1
    && item.dnsNameCount <= 100
    ? item.dnsNameCount
    : null;
  if (
    !SAFE_ID_RE.test(eventId)
    || !logId
    || !SHA256_RE.test(certificateSha256)
    || certificateSha256 !== pin.value.toLowerCase()
    || dnsNameCount === null
    || typeof item.namesComplete !== 'boolean'
    || (item.notAfter !== null && notAfter === null)
  ) return null;
  return {
    eventId,
    logId,
    certificateSha256,
    issuer,
    notAfter,
    dnsNameCount,
    namesComplete: item.namesComplete,
  };
}

function normalizeEvidenceRelations(
  value: unknown,
  legacyIds: readonly string[],
  validIds?: ReadonlySet<string>,
): NonNullable<CaseAssertionRecord['evidenceRelations']> {
  const output = new Map<string, CaseEvidenceRelationStance>();
  if (Array.isArray(value)) {
    for (const raw of value.slice(0, MAX_DECISION_PIN_REFERENCES * 2)) {
      const item = record(raw);
      const evidencePinId = typeof item.evidencePinId === 'string' && SAFE_ID_RE.test(item.evidencePinId)
        ? item.evidencePinId
        : '';
      if (!evidencePinId || (validIds && !validIds.has(evidencePinId))) continue;
      if (typeof item.stance !== 'string' || !EVIDENCE_RELATION_STANCES.has(item.stance)) continue;
      if (!output.has(evidencePinId)) output.set(evidencePinId, item.stance as CaseEvidenceRelationStance);
      if (output.size >= MAX_DECISION_PIN_REFERENCES) break;
    }
  }
  if (!output.size) {
    for (const evidencePinId of legacyIds) output.set(evidencePinId, 'supports');
  }
  return [...output].map(([evidencePinId, stance]) => ({ evidencePinId, stance }));
}

function normalizePin(
  raw: unknown,
  fallback: string,
  options: CaseEvidencePinNormalizationOptions = {},
): CaseEvidencePin | null {
  const item = record(raw);
  const label = text(item.label, MAX_RESPONSE_LABEL_LENGTH);
  const value = text(item.value, MAX_RESPONSE_VALUE_LENGTH);
  if (!label || !value) return null;
  const createdAt = iso(item.createdAt, fallback, options);
  const normalizedSourceSchema = sourceSchema(item.sourceSchema);
  const normalizedField = text(item.field, 120) || null;
  const normalized: CaseEvidencePin = {
    id: safeId(item.id, 'pin', { label, value, createdAt }),
    checkpointId: typeof item.checkpointId === 'string' && SAFE_ID_RE.test(item.checkpointId)
      ? item.checkpointId
      : null,
    field: normalizedField,
    category: text(item.category, 80) || null,
    label,
    value,
    source: text(item.source, MAX_RESPONSE_LABEL_LENGTH) || 'analyst_selected',
    sourceState: text(item.sourceState, 40) || null,
    sourceSchema: normalizedSourceSchema,
    observedAt: optionalIso(item.observedAt, options),
    collectionDepth: item.collectionDepth === 'deep' || item.collectionDepth === 'fast'
      ? item.collectionDepth
      : 'unknown',
    completeness: typeof item.completeness === 'string' && COMPLETENESS.has(item.completeness)
      ? item.completeness as CasePinCompleteness
      : 'unknown',
    truncated: typeof item.truncated === 'boolean' ? item.truncated : null,
    transitionExpectation: typeof item.transitionExpectation === 'string'
      && TRANSITION_EXPECTATIONS.has(item.transitionExpectation)
      ? item.transitionExpectation as CaseTransitionExpectation
      : null,
    limitations: limitations(item.limitations),
    createdAt,
  };
  normalized.certificateObservation = options.allowCertificateObservation === false
    ? null
    : certificateObservation(item.certificateObservation, {
        field: normalizedField,
        value,
        sourceSchema: normalizedSourceSchema,
      }, options);
  if ((options.sourceVersion ?? CASE_SCHEMA_VERSION) > PUBLISHED_V2_3_CASE_SCHEMA_VERSION
    && item.observationHostname !== undefined) {
    if (typeof item.observationHostname !== 'string' || !isValidAsciiHostname(item.observationHostname)
      || item.observationHostname !== item.observationHostname.toLowerCase()) return null;
    normalized.observationHostname = item.observationHostname;
  }
  // Introduced in Case 15. Older public records must not acquire an identity
  // merely because an unrecognised input field resembles a digest.
  if ((options.sourceVersion ?? CASE_SCHEMA_VERSION) >= 15
    && typeof item.importContentSha256 === 'string' && SHA256_RE.test(item.importContentSha256)) {
    normalized.importContentSha256 = item.importContentSha256;
  }
  return normalized;
}

export function normalizeCaseEvidencePins(
  raw: unknown,
  fallback: string,
  options: CaseEvidencePinNormalizationOptions = {},
): CaseEvidencePin[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, CaseEvidencePin>();
  for (const item of raw.slice(0, MAX_CASE_EVIDENCE_PINS * 2)) {
    const normalized = normalizePin(item, fallback, options);
    if (normalized && !byId.has(normalized.id)) byId.set(normalized.id, normalized);
  }
  return [...byId.values()]
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    .slice(-MAX_CASE_EVIDENCE_PINS);
}

export function appendCaseEvidencePin(
  current: readonly CaseEvidencePin[],
  raw: unknown,
  now: string,
): CaseEvidencePin[] {
  if (current.length >= MAX_CASE_EVIDENCE_PINS) {
    throw new Error(`A Case can retain at most ${MAX_CASE_EVIDENCE_PINS} evidence pins. No existing evidence was removed.`);
  }
  const item = record(raw);
  const created = normalizePin({ ...item, id: freshId('pin'), createdAt: now }, now);
  if (!created) throw new Error('An evidence pin requires a label and value.');
  return normalizeCaseEvidencePins([...current, created], now);
}

export function appendCaseEvidencePins(
  current: readonly CaseEvidencePin[],
  raw: unknown,
  now: string,
): CaseEvidencePin[] {
  if (!Array.isArray(raw) || !raw.length) throw new Error('An evidence checkpoint requires at least one selected fact.');
  let output = [...current];
  let added = 0;
  for (const item of raw.slice(0, MAX_CASE_CHECKPOINT_FACTS)) {
    output = appendCaseEvidencePin(output, item, now);
    added += 1;
  }
  if (!added) throw new Error('An evidence checkpoint requires at least one valid selected fact.');
  return output;
}

function normalizeDecision(
  raw: unknown,
  fallback: string,
  validPinIds?: ReadonlySet<string>,
  options: CaseResponseTimestampOptions = {},
): CaseDecisionRecord | null {
  const item = record(raw);
  const summary = text(item.summary, MAX_RESPONSE_LABEL_LENGTH);
  const rationale = text(item.rationale, MAX_RESPONSE_RATIONALE_LENGTH);
  if (!summary || !rationale) return null;
  const createdAt = iso(item.createdAt, fallback, options);
  const currentConfidence = typeof item.confidence === 'string' && DECISION_CONFIDENCE_LEVELS.has(item.confidence)
    ? item.confidence as CaseDecisionConfidence
    : 'unknown';
  return {
    id: safeId(item.id, 'decision', { summary, rationale, createdAt }),
    summary,
    rationale,
    confidence: options.sourceVersion != null && options.sourceVersion < 15 ? 'unknown' : currentConfidence,
    confidenceBasis: options.sourceVersion != null && options.sourceVersion < 15
      ? ''
      : text(item.confidenceBasis, MAX_RESPONSE_RATIONALE_LENGTH),
    evidencePinIds: uniqueIds(item.evidencePinIds, validPinIds),
    createdAt,
  };
}

export function normalizeCaseDecisions(
  raw: unknown,
  fallback: string,
  validPinIds?: ReadonlySet<string>,
  options: CaseResponseTimestampOptions = {},
): CaseDecisionRecord[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, CaseDecisionRecord>();
  for (const item of raw.slice(0, MAX_CASE_DECISIONS * 2)) {
    const normalized = normalizeDecision(item, fallback, validPinIds, options);
    if (normalized && !byId.has(normalized.id)) byId.set(normalized.id, normalized);
  }
  return [...byId.values()]
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    .slice(-MAX_CASE_DECISIONS);
}

export function appendCaseDecision(
  current: readonly CaseDecisionRecord[],
  raw: unknown,
  now: string,
  validPinIds?: ReadonlySet<string>,
): CaseDecisionRecord[] {
  if (current.length >= MAX_CASE_DECISIONS) {
    throw new Error(`A Case can retain at most ${MAX_CASE_DECISIONS} decisions. No existing decision was removed.`);
  }
  const item = record(raw);
  const created = normalizeDecision({ ...item, id: freshId('decision'), createdAt: now }, now, validPinIds);
  if (!created) throw new Error('A decision requires a summary and rationale.');
  return normalizeCaseDecisions([...current, created], now, validPinIds);
}

export function mergeCaseEvidencePins(
  local: readonly CaseEvidencePin[],
  imported: readonly CaseEvidencePin[],
  fallback: string,
): CaseEvidencePin[] {
  return normalizeCaseEvidencePins([...local, ...imported], fallback);
}

export function mergeCaseDecisions(
  local: readonly CaseDecisionRecord[],
  imported: readonly CaseDecisionRecord[],
  fallback: string,
  validPinIds?: ReadonlySet<string>,
): CaseDecisionRecord[] {
  return normalizeCaseDecisions([...local, ...imported], fallback, validPinIds);
}

function assertionProvenanceList(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value)) return [];
  const output = new Set<string>();
  for (const item of value.slice(0, maximum * 2)) {
    const normalized = text(item, MAX_RESPONSE_LIMITATION_LENGTH);
    if (normalized) output.add(normalized);
    if (output.size >= maximum) break;
  }
  return [...output];
}

function normalizeAssertionProvenance(
  value: unknown,
  options: CaseResponseTimestampOptions = {},
): CaseAssertionExternalProvenance | null {
  const item = record(value);
  const sourceName = text(item.sourceName, 120);
  const sourceDigestSha256 = text(item.sourceDigestSha256, 64).toLowerCase();
  const entityValue = text(item.entityValue, MAX_RESPONSE_VALUE_LENGTH);
  if (
    item.origin !== 'external_import'
    || typeof item.format !== 'string'
    || !ASSERTION_EXTERNAL_FORMATS.has(item.format)
    || typeof item.entityType !== 'string'
    || !ASSERTION_EXTERNAL_ENTITY_TYPES.has(item.entityType)
    || !sourceName
    || !/^[0-9a-f]{64}$/u.test(sourceDigestSha256)
    || !entityValue
  ) {
    return null;
  }
  const confidence = typeof item.confidence === 'number'
    && Number.isInteger(item.confidence)
    && item.confidence >= 0
    && item.confidence <= 100
    ? item.confidence
    : null;
  return {
    origin: 'external_import',
    format: item.format as CaseAssertionExternalFormat,
    sourceName,
    sourceDigestSha256,
    publisher: text(item.publisher, 160) || null,
    externalId: text(item.externalId, 200) || null,
    entityType: item.entityType as CaseAssertionExternalEntityType,
    entityValue,
    observedAt: optionalIso(item.observedAt, options),
    createdAt: optionalIso(item.createdAt, options),
    modifiedAt: optionalIso(item.modifiedAt, options),
    confidence,
    labels: assertionProvenanceList(item.labels, MAX_ASSERTION_PROVENANCE_LABELS),
    markings: assertionProvenanceList(item.markings, MAX_ASSERTION_PROVENANCE_MARKINGS),
  };
}

function normalizeAssertion(
  raw: unknown,
  fallback: string,
  validPinIds?: ReadonlySet<string>,
  options: CaseResponseTimestampOptions = {},
): CaseAssertionRecord | null {
  const item = record(raw);
  const statement = text(item.statement, MAX_RESPONSE_RATIONALE_LENGTH);
  if (!statement) return null;
  const createdAt = iso(item.createdAt, fallback, options);
  const provenance = normalizeAssertionProvenance(item.provenance, options);
  const legacyIds = uniqueIds(item.evidencePinIds, validPinIds);
  const evidenceRelations = normalizeEvidenceRelations(item.evidenceRelations, legacyIds, validPinIds);
  return {
    id: safeId(item.id, 'assertion', { statement, createdAt }),
    kind: typeof item.kind === 'string' && ASSERTION_KINDS.has(item.kind)
      ? item.kind as CaseAssertionKind
      : 'hypothesis',
    statement,
    rationale: text(item.rationale, MAX_RESPONSE_RATIONALE_LENGTH) || null,
    evidencePinIds: evidenceRelations.map((relation) => relation.evidencePinId),
    evidenceRelations,
    state: typeof item.state === 'string' && ASSERTION_STATES.has(item.state)
      ? item.state as CaseAssertionState
      : 'open',
    createdAt,
    updatedAt: iso(item.updatedAt, createdAt, options),
    ...(provenance ? { provenance } : {}),
  };
}

export function normalizeCaseAssertions(
  raw: unknown,
  fallback: string,
  validPinIds?: ReadonlySet<string>,
  options: CaseResponseTimestampOptions = {},
): CaseAssertionRecord[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, CaseAssertionRecord>();
  for (const item of raw.slice(0, MAX_CASE_ASSERTIONS * 2)) {
    const normalized = normalizeAssertion(item, fallback, validPinIds, options);
    if (!normalized) continue;
    const existing = byId.get(normalized.id);
    if (!existing || Date.parse(normalized.updatedAt) >= Date.parse(existing.updatedAt)) {
      byId.set(normalized.id, normalized);
    }
  }
  return [...byId.values()]
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    .slice(-MAX_CASE_ASSERTIONS);
}

export function appendCaseAssertion(
  current: readonly CaseAssertionRecord[],
  raw: unknown,
  now: string,
  validPinIds?: ReadonlySet<string>,
): CaseAssertionRecord[] {
  if (current.length >= MAX_CASE_ASSERTIONS) {
    throw new Error(`A Case can retain at most ${MAX_CASE_ASSERTIONS} assertions. No existing assertion was removed.`);
  }
  const item = record(raw);
  const created = normalizeAssertion({
    ...item,
    id: freshId('assertion'),
    createdAt: now,
    updatedAt: now,
  }, now, validPinIds);
  if (!created) throw new Error('An analyst assertion requires a statement.');
  return normalizeCaseAssertions([...current, created], now, validPinIds);
}

export function updateCaseAssertion(
  current: readonly CaseAssertionRecord[],
  raw: unknown,
  now: string,
  validPinIds?: ReadonlySet<string>,
): CaseAssertionRecord[] {
  const patch = record(raw);
  const id = typeof patch.id === 'string' && SAFE_ID_RE.test(patch.id) ? patch.id : '';
  const existing = current.find((item) => item.id === id);
  if (!existing) throw new Error('That analyst assertion no longer exists.');
  const updated = normalizeAssertion({
    ...existing,
    ...patch,
    id,
    createdAt: existing.createdAt,
    updatedAt: now,
  }, now, validPinIds);
  if (!updated) throw new Error('An analyst assertion requires a statement.');
  return normalizeCaseAssertions(current.map((item) => item.id === id ? updated : item), now, validPinIds);
}

function normalizeManualTrailEvent(
  raw: unknown,
  fallback: string,
  options: CaseResponseTimestampOptions = {},
): CaseManualTrailEvent | null {
  const item = record(raw);
  const summary = text(item.summary, MAX_RESPONSE_RATIONALE_LENGTH);
  if (!summary) return null;
  const createdAt = iso(item.createdAt, fallback, options);
  return {
    id: safeId(item.id, 'trail', { summary, createdAt }),
    kind: typeof item.kind === 'string' && TRAIL_KINDS.has(item.kind)
      ? item.kind as CaseManualTrailKind
      : 'review',
    summary,
    target: text(item.target, MAX_TRAIL_TARGET_LENGTH) || null,
    createdAt,
  };
}

export function normalizeCaseManualTrail(
  raw: unknown,
  fallback: string,
  options: CaseResponseTimestampOptions = {},
): CaseManualTrailEvent[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, CaseManualTrailEvent>();
  for (const item of raw.slice(0, MAX_CASE_MANUAL_TRAIL_EVENTS * 2)) {
    const normalized = normalizeManualTrailEvent(item, fallback, options);
    if (normalized && !byId.has(normalized.id)) byId.set(normalized.id, normalized);
  }
  return [...byId.values()]
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    .slice(-MAX_CASE_MANUAL_TRAIL_EVENTS);
}

export function appendCaseManualTrailEvent(
  current: readonly CaseManualTrailEvent[],
  raw: unknown,
  now: string,
): CaseManualTrailEvent[] {
  if (current.length >= MAX_CASE_MANUAL_TRAIL_EVENTS) {
    throw new Error(`A Case can retain at most ${MAX_CASE_MANUAL_TRAIL_EVENTS} investigation-trail entries. No existing entry was removed.`);
  }
  const item = record(raw);
  const created = normalizeManualTrailEvent({ ...item, id: freshId('trail'), createdAt: now }, now);
  if (!created) throw new Error('An investigation-trail entry requires a summary.');
  return normalizeCaseManualTrail([...current, created], now);
}

export function mergeCaseAssertions(
  local: readonly CaseAssertionRecord[],
  imported: readonly CaseAssertionRecord[],
  fallback: string,
  validPinIds?: ReadonlySet<string>,
): CaseAssertionRecord[] {
  return normalizeCaseAssertions([...local, ...imported], fallback, validPinIds);
}

export function mergeCaseManualTrail(
  local: readonly CaseManualTrailEvent[],
  imported: readonly CaseManualTrailEvent[],
  fallback: string,
): CaseManualTrailEvent[] {
  return normalizeCaseManualTrail([...local, ...imported], fallback);
}

function sightingSourceClass(state: CaseSightingState): CaseSightingRecord['sourceClass'] {
  if (state === 'observed_by_deployment') return 'deployment';
  if (state === 'reported_by_provider') return 'provider';
  return 'analyst';
}

function normalizeCaseSighting(
  raw: unknown,
  fallback: string,
  validPinIds?: ReadonlySet<string>,
  options: CaseResponseTimestampOptions = {},
): CaseSightingRecord | null {
  const item = record(raw);
  if (typeof item.state !== 'string' || !SIGHTING_STATES.has(item.state)) return null;
  const state = item.state as CaseSightingState;
  const source = text(item.source, MAX_RESPONSE_LABEL_LENGTH);
  if (!source) return null;
  const createdAt = iso(item.createdAt, fallback, options);
  const evidencePinId = typeof item.evidencePinId === 'string'
    && SAFE_ID_RE.test(item.evidencePinId)
    && (!validPinIds || validPinIds.has(item.evidencePinId))
    ? item.evidencePinId
    : null;
  return {
    id: safeId(item.id, 'sighting', { state, source, createdAt }),
    state,
    sourceClass: sightingSourceClass(state),
    category: typeof item.category === 'string' && SIGHTING_CATEGORIES.has(item.category)
      ? item.category as CaseSightingCategory
      : 'other',
    source,
    observedAt: optionalIso(item.observedAt, options),
    completeness: typeof item.completeness === 'string' && COMPLETENESS.has(item.completeness)
      ? item.completeness as CasePinCompleteness
      : 'unknown',
    evidencePinId,
    limitations: limitations(item.limitations),
    createdAt,
  };
}

export function normalizeCaseSightings(
  raw: unknown,
  fallback: string,
  validPinIds?: ReadonlySet<string>,
  options: CaseResponseTimestampOptions = {},
): CaseSightingRecord[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, CaseSightingRecord>();
  for (const item of raw.slice(0, MAX_CASE_SIGHTINGS * 2)) {
    const normalized = normalizeCaseSighting(item, fallback, validPinIds, options);
    if (normalized && !byId.has(normalized.id)) byId.set(normalized.id, normalized);
  }
  return [...byId.values()]
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || compareCodeUnits(left.id, right.id))
    .slice(-MAX_CASE_SIGHTINGS);
}

export function appendCaseSighting(
  current: readonly CaseSightingRecord[],
  raw: unknown,
  now: string,
  validPinIds?: ReadonlySet<string>,
): CaseSightingRecord[] {
  if (current.length >= MAX_CASE_SIGHTINGS) {
    throw new Error(`A Case can retain at most ${MAX_CASE_SIGHTINGS} sightings. No existing sighting was removed.`);
  }
  const item = record(raw);
  const created = normalizeCaseSighting({
    ...item,
    id: freshId('sighting'),
    createdAt: now,
  }, now, validPinIds);
  if (!created) throw new Error('A sighting requires a source and explicit source-qualified state.');
  return normalizeCaseSightings([...current, created], now, validPinIds);
}

export function mergeCaseSightings(
  local: readonly CaseSightingRecord[],
  imported: readonly CaseSightingRecord[],
  fallback: string,
  validPinIds?: ReadonlySet<string>,
): CaseSightingRecord[] {
  return normalizeCaseSightings([...local, ...imported], fallback, validPinIds);
}

export function buildCaseInvestigationTrail(
  input: Readonly<{
    assertions?: readonly CaseAssertionRecord[];
    decisions?: readonly CaseDecisionRecord[];
    actions?: readonly CaseActionRecord[];
    manualTrail?: readonly CaseManualTrailEvent[];
    sightings?: readonly CaseSightingRecord[];
    observedEffects?: CaseObservedEffectHistory;
    closures?: CaseClosureHistory;
  }>,
): CaseInvestigationTrailItem[] {
  return [
    ...(input.assertions ?? []).map((item): CaseInvestigationTrailItem => ({
      id: `assertion:${item.id}`,
      kind: 'assertion',
      label: `${item.kind.replaceAll('_', ' ')} · ${item.state}`,
      detail: item.statement,
      createdAt: item.updatedAt,
    })),
    ...(input.decisions ?? []).map((item): CaseInvestigationTrailItem => ({
      id: `decision:${item.id}`,
      kind: 'decision',
      label: 'analyst decision',
      detail: item.summary,
      createdAt: item.createdAt,
    })),
    ...(input.actions ?? []).map((item): CaseInvestigationTrailItem => ({
      id: `action:${item.id}`,
      kind: 'action',
      label: `${item.type.replaceAll('_', ' ')} · ${item.state}`,
      detail: item.recipient,
      createdAt: item.updatedAt,
    })),
    ...(input.manualTrail ?? []).map((item): CaseInvestigationTrailItem => ({
      id: `manual:${item.id}`,
      kind: 'manual',
      label: item.kind.replaceAll('_', ' '),
      detail: item.target ? `${item.summary} · ${item.target}` : item.summary,
      createdAt: item.createdAt,
    })),
    ...(input.sightings ?? []).map((item): CaseInvestigationTrailItem => ({
      id: `sighting:${item.id}`,
      kind: 'sighting',
      label: `${item.state.replaceAll('_', ' ')} · ${item.category}`,
      detail: `${item.source} · ${item.completeness} · observed ${item.observedAt ?? 'time unavailable'}`,
      createdAt: item.createdAt,
    })),
    ...(input.observedEffects?.reviews ?? []).map((item): CaseInvestigationTrailItem => ({
      id: `observed-effect:${item.id}`,
      kind: 'observed_effect',
      label: `independent effect · ${item.state.replaceAll('_', ' ')}`,
      detail: `${item.source} · ${item.completeness} · observed ${item.observedAt}`,
      createdAt: item.createdAt,
    })),
    ...(input.closures?.records ?? []).map((item): CaseInvestigationTrailItem => ({
      id: `closure:${item.id}`,
      kind: 'closure',
      label: `case closure · ${item.reason.replaceAll('_', ' ')}`,
      detail: item.summary,
      createdAt: item.createdAt,
    })),
  ].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || compareCodeUnits(left.id, right.id));
}
