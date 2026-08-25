// Bounded, framework-neutral analyst response records. These records are
// deliberately separate from collected evidence snapshots: a pin describes a
// fact selected by an analyst, a decision records analyst reasoning, and an
// action records a reviewed external or internal follow-up.

import {
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
import { normalizeExplicitIsoTimestamp, normalizeLegacyIsoTimestamp } from '../evidence/observation.mts';

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
};
export const CASE_EVIDENCE_RELATION_STANCES = ['supports', 'contradicts', 'unresolved'] as const;
export type CaseEvidenceRelationStance = typeof CASE_EVIDENCE_RELATION_STANCES[number];

export const CASE_PIN_COMPLETENESS = ['complete', 'partial', 'inconclusive', 'unknown'] as const;
export type CasePinCompleteness = typeof CASE_PIN_COMPLETENESS[number];

export const CASE_TRANSITION_EXPECTATIONS = ['preserve', 'change', 'review'] as const;
export type CaseTransitionExpectation = typeof CASE_TRANSITION_EXPECTATIONS[number];

export const CASE_ACTION_TYPES = [
  'registrar_report',
  'registry_report',
  'network_hosting_report',
  'security_contact_report',
  'defensive_control',
  'internal_review',
] as const;
export type CaseActionType = typeof CASE_ACTION_TYPES[number];

export const CASE_ACTION_STATES = [
  'drafting',
  'ready_for_review',
  'reviewed',
  'authorised',
  'submitted',
  'acknowledged',
  'terminal',
] as const;
export type CaseActionState = typeof CASE_ACTION_STATES[number];

export const CASE_PROVIDER_OUTCOMES = [
  'accepted_for_review',
  'more_information_requested',
  'referred_elsewhere',
  'rejected_outside_policy_scope',
  'no_response',
  'partially_remediated',
  'provider_reports_resolved',
  'withdrawn',
  'duplicate',
] as const;
export type CaseProviderOutcome = typeof CASE_PROVIDER_OUTCOMES[number];

export const CASE_ACTION_EVENT_SOURCE_CLASSES = [
  'analyst',
  'provider',
  'browser_local',
  'import',
  'migration',
] as const;
export type CaseActionEventSourceClass = typeof CASE_ACTION_EVENT_SOURCE_CLASSES[number];

export const CASE_OBSERVED_EFFECT_STATES = [
  'not_checked',
  'still_observed',
  'changed',
  'not_reproduced',
  'unavailable',
] as const;
export type CaseObservedEffectState = typeof CASE_OBSERVED_EFFECT_STATES[number];

export const CASE_OBSERVED_EFFECT_SOURCE_CLASSES = ['deployment', 'analyst', 'import'] as const;
export type CaseObservedEffectSourceClass = typeof CASE_OBSERVED_EFFECT_SOURCE_CLASSES[number];

export const CASE_CLOSURE_REASONS = [
  'independently_not_reproduced',
  'infrastructure_changed',
  'provider_reported_resolution_not_independently_checked',
  'risk_accepted',
  'false_positive',
  'duplicate',
  'unable_to_proceed',
  'monitoring_transferred',
] as const;
export type CaseClosureReason = typeof CASE_CLOSURE_REASONS[number];

export const CASE_ASSERTION_KINDS = [
  'verified_fact',
  'hypothesis',
  'unknown',
  'contradiction',
  'next_step',
] as const;
export type CaseAssertionKind = typeof CASE_ASSERTION_KINDS[number];

export const CASE_ASSERTION_STATES = ['open', 'resolved'] as const;
export type CaseAssertionState = typeof CASE_ASSERTION_STATES[number];

export const CASE_ASSERTION_EXTERNAL_FORMATS = ['stix', 'misp'] as const;
export type CaseAssertionExternalFormat = typeof CASE_ASSERTION_EXTERNAL_FORMATS[number];

export const CASE_ASSERTION_EXTERNAL_ENTITY_TYPES = [
  'asn',
  'certificate',
  'domain',
  'hostname',
  'ipv4',
  'ipv6',
  'url',
] as const;
export type CaseAssertionExternalEntityType = typeof CASE_ASSERTION_EXTERNAL_ENTITY_TYPES[number];

export type CaseAssertionExternalProvenance = {
  origin: 'external_import';
  format: CaseAssertionExternalFormat;
  sourceName: string;
  sourceDigestSha256: string;
  publisher: string | null;
  externalId: string | null;
  entityType: CaseAssertionExternalEntityType;
  entityValue: string;
  observedAt: string | null;
  createdAt: string | null;
  modifiedAt: string | null;
  confidence: number | null;
  labels: string[];
  markings: string[];
};

export const CASE_MANUAL_TRAIL_KINDS = ['pivot', 'review', 'handoff'] as const;
export type CaseManualTrailKind = typeof CASE_MANUAL_TRAIL_KINDS[number];

export const CASE_SIGHTING_STATES = [
  'observed_by_deployment',
  'reported_by_provider',
  'analyst_confirmed',
  'not_reproduced',
  'expired',
] as const;
export type CaseSightingState = typeof CASE_SIGHTING_STATES[number];

export const CASE_SIGHTING_CATEGORIES = [
  'registration',
  'delegation',
  'certificate',
  'mail',
  'website',
  'infrastructure',
  'other',
] as const;
export type CaseSightingCategory = typeof CASE_SIGHTING_CATEGORIES[number];

export type CaseSightingRecord = {
  id: string;
  state: CaseSightingState;
  sourceClass: 'deployment' | 'provider' | 'analyst';
  category: CaseSightingCategory;
  source: string;
  observedAt: string;
  completeness: CasePinCompleteness;
  evidencePinId: string | null;
  limitations: string[];
  createdAt: string;
};

export type CaseEvidencePin = {
  id: string;
  checkpointId: string | null;
  field: string | null;
  category: string | null;
  label: string;
  value: string;
  source: string;
  sourceState: string | null;
  sourceSchema: {
    collection: string;
    schema: string;
    version: number;
  } | null;
  certificateObservation?: CaseCertificateObservation | null;
  observedAt: string;
  collectionDepth: 'deep' | 'fast' | 'unknown';
  completeness: CasePinCompleteness;
  truncated: boolean | null;
  transitionExpectation: CaseTransitionExpectation | null;
  limitations: string[];
  createdAt: string;
};

export type CaseCertificateObservation = {
  eventId: string;
  logId: string;
  certificateSha256: string;
  issuer: string | null;
  notAfter: string | null;
  dnsNameCount: number;
  namesComplete: boolean;
};

export type CaseDecisionRecord = {
  id: string;
  summary: string;
  rationale: string;
  evidencePinIds: string[];
  createdAt: string;
};

export type CaseActionTransitionEvent = {
  id: string;
  previousState: CaseActionState | null;
  nextState: CaseActionState;
  occurredAt: string;
  sourceClass: CaseActionEventSourceClass;
  provenance: string;
  reference: string | null;
  evidencePinId: string | null;
  limitations: string[];
  providerOutcome: CaseProviderOutcome | null;
  outcomeDetail: string | null;
  originActionId: string | null;
  applied: boolean;
};

export type CaseActionRecord = {
  id: string;
  type: CaseActionType;
  recipient: string;
  contactSource: string;
  contactLimitations: string[];
  dueAt: string | null;
  state: CaseActionState;
  reference: string | null;
  followUpAt: string | null;
  providerOutcome: CaseProviderOutcome | null;
  outcome: string | null;
  originActionId: string | null;
  history: CaseActionTransitionEvent[];
  historyOmitted: number;
  historyLimitations: string[];
  createdAt: string;
  metadataUpdatedAt: string;
  updatedAt: string;
};

export type CaseObservedEffectReview = {
  id: string;
  state: CaseObservedEffectState;
  observedAt: string;
  sourceClass: CaseObservedEffectSourceClass;
  source: string;
  completeness: CasePinCompleteness;
  limitations: string[];
  evidencePinId: string | null;
  sightingId: string | null;
  followUpAt: string | null;
  createdAt: string;
};

export type CaseObservedEffectHistory = {
  reviews: CaseObservedEffectReview[];
  omitted: number;
  preV13HistoryUnavailable: boolean;
  limitations: string[];
};

export type CaseClosureRecord = {
  id: string;
  reason: CaseClosureReason;
  summary: string;
  observedEffectReviewId: string | null;
  actionId: string | null;
  limitations: string[];
  createdAt: string;
};

export type CaseClosureHistory = {
  records: CaseClosureRecord[];
  omitted: number;
  preV13HistoryUnavailable: boolean;
  limitations: string[];
};

export type CaseClosureLinkContext = Readonly<{
  reviewEvidence?: ReadonlyMap<string, Readonly<{
    state: CaseObservedEffectState;
    observedAt: string;
    createdAt: string;
  }>>;
  providerResolutionEvents?: ReadonlyMap<string, readonly Readonly<{
    eventId: string;
    occurredAt: string;
  }>[]>;
}>;

export type CaseAssertionRecord = {
  id: string;
  kind: CaseAssertionKind;
  statement: string;
  rationale: string | null;
  evidencePinIds: string[];
  evidenceRelations?: Array<{
    evidencePinId: string;
    stance: CaseEvidenceRelationStance;
  }>;
  state: CaseAssertionState;
  createdAt: string;
  updatedAt: string;
  provenance?: CaseAssertionExternalProvenance;
};

export type CaseManualTrailEvent = {
  id: string;
  kind: CaseManualTrailKind;
  summary: string;
  target: string | null;
  createdAt: string;
};

export type CaseInvestigationTrailItem = {
  id: string;
  kind: 'assertion' | 'decision' | 'action' | 'manual' | 'sighting' | 'observed_effect' | 'closure';
  label: string;
  detail: string;
  createdAt: string;
};

export type CaseActionOutcomeSummary = Readonly<{
  total: number;
  active: number;
  drafting: number;
  readyForReview: number;
  reviewed: number;
  authorised: number;
  submitted: number;
  acknowledged: number;
  terminal: number;
  overdue: number;
  followUpDue: number;
  withProviderOutcome: number;
  latestOutcomes: readonly Readonly<{
    actionId: string;
    recipient: string;
    state: CaseActionState;
    providerOutcome: CaseProviderOutcome;
    outcomeDetail: string | null;
    occurredAt: string;
  }>[];
}>;

export type CaseResponseLifecycleSummary = Readonly<{
  providerOutcomeState: 'available' | 'missing' | 'ambiguous';
  latestProviderOutcome: Readonly<{
    actionId: string;
    eventId: string;
    outcome: CaseProviderOutcome;
    occurredAt: string;
    reference: string | null;
  }> | null;
  observedChangeState: 'available' | 'missing' | 'ambiguous';
  latestObservedEffect: Readonly<{
    reviewId: string;
    state: CaseObservedEffectState;
    observedAt: string;
    sourceClass: CaseObservedEffectSourceClass;
    source: string;
  }> | null;
  latestObservedChangeAt: string | null;
  latestClosure: CaseClosureRecord | null;
}>;

const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/u;
const CONTROL_REPLACE_RE = /[\u0000-\u001f\u007f]+/gu;
const COMPLETENESS = new Set<string>(CASE_PIN_COMPLETENESS);
const TRANSITION_EXPECTATIONS = new Set<string>(CASE_TRANSITION_EXPECTATIONS);
const ACTION_TYPES = new Set<string>(CASE_ACTION_TYPES);
const ACTION_STATES = new Set<string>(CASE_ACTION_STATES);
const PROVIDER_OUTCOMES = new Set<string>(CASE_PROVIDER_OUTCOMES);
const ACTION_EVENT_SOURCE_CLASSES = new Set<string>(CASE_ACTION_EVENT_SOURCE_CLASSES);
const OBSERVED_EFFECT_STATES = new Set<string>(CASE_OBSERVED_EFFECT_STATES);
const OBSERVED_EFFECT_SOURCE_CLASSES = new Set<string>(CASE_OBSERVED_EFFECT_SOURCE_CLASSES);
const CLOSURE_REASONS = new Set<string>(CASE_CLOSURE_REASONS);
const ASSERTION_KINDS = new Set<string>(CASE_ASSERTION_KINDS);
const ASSERTION_STATES = new Set<string>(CASE_ASSERTION_STATES);
const EVIDENCE_RELATION_STANCES = new Set<string>(CASE_EVIDENCE_RELATION_STANCES);
const ASSERTION_EXTERNAL_FORMATS = new Set<string>(CASE_ASSERTION_EXTERNAL_FORMATS);
const ASSERTION_EXTERNAL_ENTITY_TYPES = new Set<string>(CASE_ASSERTION_EXTERNAL_ENTITY_TYPES);
const TRAIL_KINDS = new Set<string>(CASE_MANUAL_TRAIL_KINDS);
const SIGHTING_STATES = new Set<string>(CASE_SIGHTING_STATES);
const SIGHTING_CATEGORIES = new Set<string>(CASE_SIGHTING_CATEGORIES);
const SHA256_RE = /^[a-f0-9]{64}$/u;

export type CaseResponseTimestampOptions = Readonly<{
  legacyTimestamps?: boolean;
  sourceVersion?: number | null;
  validEvidencePinIds?: ReadonlySet<string>;
}>;

type CaseEvidencePinNormalizationOptions = CaseResponseTimestampOptions & Readonly<{
  allowCertificateObservation?: boolean;
}>;

function currentActionNormalizationOptions(
  validEvidencePinIds?: ReadonlySet<string>,
): CaseResponseTimestampOptions {
  return validEvidencePinIds
    ? { sourceVersion: 13, validEvidencePinIds }
    : { sourceVersion: 13 };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(CONTROL_REPLACE_RE, ' ').trim().slice(0, maximum);
}

function timestamp(value: unknown, options: CaseResponseTimestampOptions = {}): string | null {
  return normalizeExplicitIsoTimestamp(value)
    ?? (options.legacyTimestamps ? normalizeLegacyIsoTimestamp(value) : null);
}

function iso(value: unknown, fallback: string, options: CaseResponseTimestampOptions = {}): string {
  return timestamp(value, options) ?? fallback;
}

function optionalIso(value: unknown, options: CaseResponseTimestampOptions = {}): string | null {
  return timestamp(value, options);
}

function hash(value: string): string {
  let result = 2166136261 >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function deterministicId(prefix: string, value: unknown): string {
  return `${prefix}-${hash(JSON.stringify(value))}`;
}

function freshId(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function safeId(value: unknown, prefix: string, raw: unknown): string {
  return typeof value === 'string' && SAFE_ID_RE.test(value)
    ? value
    : deterministicId(prefix, raw);
}

function limitations(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const item of value.slice(0, MAX_RESPONSE_LIMITATIONS * 2)) {
    const normalized = text(item, MAX_RESPONSE_LIMITATION_LENGTH);
    if (normalized) unique.add(normalized);
    if (unique.size >= MAX_RESPONSE_LIMITATIONS) break;
  }
  return [...unique];
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function lifecycleLimitations(value: unknown): string[] {
  return limitations(value).sort(compareCodeUnits);
}

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

function uniqueIds(value: unknown, validIds?: ReadonlySet<string>): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const item of value.slice(0, MAX_DECISION_PIN_REFERENCES * 2)) {
    if (typeof item !== 'string' || !SAFE_ID_RE.test(item) || (validIds && !validIds.has(item))) continue;
    unique.add(item);
    if (unique.size >= MAX_DECISION_PIN_REFERENCES) break;
  }
  return [...unique];
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
    observedAt: iso(item.observedAt, createdAt, options),
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
  return {
    id: safeId(item.id, 'decision', { summary, rationale, createdAt }),
    summary,
    rationale,
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
  const item = record(raw);
  const created = normalizeDecision({ ...item, id: freshId('decision'), createdAt: now }, now, validPinIds);
  if (!created) throw new Error('A decision requires a summary and rationale.');
  return normalizeCaseDecisions([...current, created], now, validPinIds);
}

const LEGACY_ACTION_STATE_MAP: Readonly<Record<string, CaseActionState>> = Object.freeze({
  planned: 'drafting',
  ready_for_review: 'ready_for_review',
  submitted: 'submitted',
  acknowledged: 'acknowledged',
  resolved: 'terminal',
  closed: 'terminal',
});

const ACTION_TRANSITIONS: Readonly<Record<CaseActionState, ReadonlySet<CaseActionState>>> = Object.freeze({
  drafting: new Set<CaseActionState>(['ready_for_review', 'terminal']),
  ready_for_review: new Set<CaseActionState>(['drafting', 'reviewed', 'terminal']),
  reviewed: new Set<CaseActionState>(['drafting', 'authorised', 'terminal']),
  authorised: new Set<CaseActionState>(['drafting', 'submitted', 'terminal']),
  submitted: new Set<CaseActionState>(['submitted', 'acknowledged', 'terminal']),
  acknowledged: new Set<CaseActionState>(['acknowledged', 'terminal']),
  terminal: new Set<CaseActionState>(),
});

function boundedCounter(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? Math.min(value, 1_000_000)
    : 0;
}

function bytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function isLegalCaseActionTransition(
  previousState: CaseActionState | null,
  nextState: CaseActionState,
  sourceClass: CaseActionEventSourceClass = 'analyst',
): boolean {
  if (previousState === null) {
    return sourceClass === 'migration'
      || nextState === 'drafting' && (sourceClass === 'analyst' || sourceClass === 'browser_local');
  }
  if (!ACTION_TRANSITIONS[previousState].has(nextState)) return false;
  if (sourceClass === 'provider' || sourceClass === 'import') {
    return (previousState === 'submitted' || previousState === 'acknowledged')
      && (nextState === 'submitted' || nextState === 'acknowledged' || nextState === 'terminal');
  }
  if (sourceClass === 'browser_local') {
    return nextState === 'drafting' && ['ready_for_review', 'reviewed', 'authorised'].includes(previousState);
  }
  return sourceClass === 'analyst';
}

function normalizeActionEvent(
  raw: unknown,
  actionId: string,
  options: CaseResponseTimestampOptions = {},
): CaseActionTransitionEvent | null {
  const item = record(raw);
  const previousState = item.previousState === null
    ? null
    : typeof item.previousState === 'string' && ACTION_STATES.has(item.previousState)
      ? item.previousState as CaseActionState
      : undefined;
  const nextState = typeof item.nextState === 'string' && ACTION_STATES.has(item.nextState)
    ? item.nextState as CaseActionState
    : null;
  const sourceClass = typeof item.sourceClass === 'string' && ACTION_EVENT_SOURCE_CLASSES.has(item.sourceClass)
    ? item.sourceClass as CaseActionEventSourceClass
    : null;
  const occurredAt = optionalIso(item.occurredAt, options);
  if (previousState === undefined || !nextState || !sourceClass || !occurredAt
    || !isLegalCaseActionTransition(previousState, nextState, sourceClass)) {
    return null;
  }
  const migrationSnapshot = sourceClass === 'migration' && previousState === null;
  if (['ready_for_review', 'reviewed', 'authorised', 'submitted'].includes(nextState)
    && sourceClass !== 'analyst' && !migrationSnapshot) return null;
  const provenance = text(item.provenance, MAX_RESPONSE_LABEL_LENGTH) || `${sourceClass}_record`;
  const providerOutcome = typeof item.providerOutcome === 'string' && PROVIDER_OUTCOMES.has(item.providerOutcome)
    ? item.providerOutcome as CaseProviderOutcome
    : null;
  if (providerOutcome && !['submitted', 'acknowledged', 'terminal'].includes(nextState) && sourceClass !== 'migration') {
    return null;
  }
  if (providerOutcome && previousState === 'authorised' && nextState === 'submitted' && !migrationSnapshot) {
    return null;
  }
  if (providerOutcome === 'no_response' && sourceClass === 'provider') return null;
  if (nextState === 'terminal' && previousState !== null
    && ['drafting', 'ready_for_review', 'reviewed', 'authorised'].includes(previousState)
    && (sourceClass !== 'analyst' || providerOutcome !== 'withdrawn')) {
    return null;
  }
  if (providerOutcome === 'withdrawn'
    && (nextState !== 'terminal' || (sourceClass !== 'analyst' && !migrationSnapshot))) return null;
  const candidateEvidencePinId = typeof item.evidencePinId === 'string' && SAFE_ID_RE.test(item.evidencePinId)
    ? item.evidencePinId
    : null;
  const evidencePinId = candidateEvidencePinId
    && (!options.validEvidencePinIds || options.validEvidencePinIds.has(candidateEvidencePinId))
    ? candidateEvidencePinId
    : null;
  const eventMaterial = {
    previousState,
    nextState,
    occurredAt,
    sourceClass,
    provenance,
    reference: text(item.reference, MAX_RESPONSE_REFERENCE_LENGTH) || null,
    evidencePinId,
    limitations: limitations([
      ...(item.evidencePinId != null && !evidencePinId ? ['A malformed or dangling evidence-pin reference was omitted from this transition.'] : []),
      ...limitations(item.limitations),
    ]),
    providerOutcome,
    outcomeDetail: text(item.outcomeDetail, MAX_RESPONSE_RATIONALE_LENGTH) || null,
    originActionId: typeof item.originActionId === 'string' && SAFE_ID_RE.test(item.originActionId) && item.originActionId !== actionId
      ? item.originActionId
      : null,
  };
  return {
    id: safeId(item.id, 'action-event', { actionId, ...eventMaterial }),
    ...eventMaterial,
    applied: false,
  };
}

function legacyActionState(value: unknown): CaseActionState {
  if (typeof value === 'string' && ACTION_STATES.has(value)) return value as CaseActionState;
  if (typeof value === 'string' && LEGACY_ACTION_STATE_MAP[value]) return LEGACY_ACTION_STATE_MAP[value]!;
  return 'drafting';
}

function legacyActionEvent(
  item: Record<string, unknown>,
  actionId: string,
  createdAt: string,
  fallback: string,
  options: CaseResponseTimestampOptions,
): CaseActionTransitionEvent {
  const nextState = legacyActionState(item.state);
  const occurredAt = iso(item.updatedAt, createdAt || fallback, options);
  const sourceVersion = options.sourceVersion;
  const provenance = sourceVersion !== null && sourceVersion !== undefined && sourceVersion <= 12
    ? 'case_v12_legacy_snapshot'
    : 'legacy_action_snapshot';
  const legacyState = typeof item.state === 'string' ? item.state : 'planned';
  const migrationLimitation = sourceVersion !== null && sourceVersion !== undefined && sourceVersion <= 12
    ? `Migrated from the Case v12 current state "${text(legacyState, 40)}"; pre-v13 transition history is unavailable.`
    : 'Recovered a legacy current-state action; earlier transition history is unavailable.';
  const eventMaterial = {
    previousState: null,
    nextState,
    occurredAt,
    sourceClass: 'migration' as const,
    provenance,
    reference: text(item.reference, MAX_RESPONSE_REFERENCE_LENGTH) || null,
    evidencePinId: null,
    limitations: limitations([migrationLimitation, ...limitations(item.contactLimitations)]),
    providerOutcome: !(sourceVersion !== null && sourceVersion !== undefined && sourceVersion <= 12)
      && typeof item.providerOutcome === 'string' && PROVIDER_OUTCOMES.has(item.providerOutcome)
      ? item.providerOutcome as CaseProviderOutcome
      : null,
    outcomeDetail: text(item.outcome, MAX_RESPONSE_RATIONALE_LENGTH) || null,
    originActionId: typeof item.originActionId === 'string' && SAFE_ID_RE.test(item.originActionId) && item.originActionId !== actionId
      ? item.originActionId
      : null,
  };
  return {
    id: deterministicId('action-event', { actionId, ...eventMaterial }),
    ...eventMaterial,
    applied: true,
  };
}

function currentActionRecoveryEvent(
  actionId: string,
  createdAt: string,
): CaseActionTransitionEvent {
  const eventMaterial = {
    previousState: null,
    nextState: 'drafting' as const,
    occurredAt: createdAt,
    sourceClass: 'browser_local' as const,
    provenance: 'case_v13_history_recovery',
    reference: null,
    evidencePinId: null,
    limitations: ['The v13 action had no valid transition history. Mutable state, reference, and outcome projections were ignored.'],
    providerOutcome: null,
    outcomeDetail: null,
    originActionId: null,
  };
  return {
    id: deterministicId('action-event', { actionId, ...eventMaterial }),
    ...eventMaterial,
    applied: true,
  };
}

function actionEventContent(event: CaseActionTransitionEvent): string {
  const { applied: _applied, ...material } = event;
  return JSON.stringify(material);
}

function projectActionHistory(
  source: readonly CaseActionTransitionEvent[],
  omitted: number,
): { history: CaseActionTransitionEvent[]; state: CaseActionState; conflicts: number } {
  let state: CaseActionState | null = null;
  let conflicts = 0;
  const history = source.map((event, index) => {
    if (state === null && omitted > 0 && index === 0 && event.previousState !== null) state = event.previousState;
    const applied = event.previousState === state
      && isLegalCaseActionTransition(event.previousState, event.nextState, event.sourceClass);
    if (applied) state = event.nextState;
    else conflicts += 1;
    return { ...event, applied };
  });
  return { history, state: state ?? 'drafting', conflicts };
}

function normalizeActionHistory(
  raw: unknown,
  item: Record<string, unknown>,
  actionId: string,
  createdAt: string,
  fallback: string,
  options: CaseResponseTimestampOptions,
): { history: CaseActionTransitionEvent[]; state: CaseActionState; omitted: number; historyLimitations: string[] } {
  const source = Array.isArray(raw) ? raw : [];
  let omitted = boundedCounter(item.historyOmitted);
  let invalid = 0;
  let duplicateConflict = 0;
  const byId = new Map<string, CaseActionTransitionEvent>();
  for (const candidate of source.slice(0, MAX_CASE_ACTION_EVENTS_PER_ACTION * 4)) {
    const event = normalizeActionEvent(candidate, actionId, options);
    if (!event) {
      invalid += 1;
      continue;
    }
    const existing = byId.get(event.id);
    if (!existing) byId.set(event.id, event);
    else if (actionEventContent(existing) !== actionEventContent(event)) {
      duplicateConflict += 1;
      if (actionEventContent(event) < actionEventContent(existing)) byId.set(event.id, event);
    }
  }
  invalid += Math.max(0, source.length - MAX_CASE_ACTION_EVENTS_PER_ACTION * 4);
  if (!byId.size) {
    const recovered = options.sourceVersion != null && options.sourceVersion <= 12
      ? legacyActionEvent(item, actionId, createdAt, fallback, options)
      : currentActionRecoveryEvent(actionId, createdAt);
    byId.set(recovered.id, recovered);
  }
  let history = [...byId.values()].sort((left, right) =>
    Date.parse(left.occurredAt) - Date.parse(right.occurredAt) || compareCodeUnits(left.id, right.id));
  if (history.length > MAX_CASE_ACTION_EVENTS_PER_ACTION) {
    omitted += history.length - MAX_CASE_ACTION_EVENTS_PER_ACTION;
    history = history.slice(-MAX_CASE_ACTION_EVENTS_PER_ACTION);
  }
  while (history.length > 1 && bytes(history) > MAX_CASE_ACTION_BYTES) {
    history.shift();
    omitted += 1;
  }
  const totalOmitted = omitted + invalid + duplicateConflict;
  const projected = projectActionHistory(history, totalOmitted);
  const retainedLimitations = limitations(item.historyLimitations).filter((item) =>
    !/^\d+ earlier action transition events? omitted by bounded retention\.$/u.test(item));
  const historyLimitations = lifecycleLimitations([
    ...(totalOmitted ? [`${totalOmitted} earlier action transition event${totalOmitted === 1 ? '' : 's'} omitted by bounded retention.`] : []),
    ...(invalid ? [`${invalid} malformed or illegal action transition event${invalid === 1 ? '' : 's'} omitted during normalisation.`] : []),
    ...(duplicateConflict ? [`${duplicateConflict} conflicting duplicate event identit${duplicateConflict === 1 ? 'y was' : 'ies were'} reconciled deterministically.`] : []),
    ...(projected.conflicts ? [`${projected.conflicts} retained concurrent transition${projected.conflicts === 1 ? ' is' : 's are'} not applied to the current-state projection.`] : []),
    ...retainedLimitations,
  ]);
  return {
    history: projected.history,
    state: projected.state,
    omitted: totalOmitted,
    historyLimitations,
  };
}

function normalizeAction(
  raw: unknown,
  fallback: string,
  options: CaseResponseTimestampOptions = {},
): CaseActionRecord | null {
  const item = record(raw);
  const recipient = text(item.recipient, MAX_RESPONSE_RECIPIENT_LENGTH);
  if (!recipient) return null;
  const createdAt = iso(item.createdAt, fallback, options);
  const actionId = safeId(item.id, 'action', { recipient, createdAt });
  const history = normalizeActionHistory(item.history, item, actionId, createdAt, fallback, options);
  const applied = history.history.filter((event) => event.applied);
  const latestReference = [...applied].reverse().find((event) => event.reference)?.reference ?? null;
  const latestProviderOutcome = [...applied].reverse().find((event) => event.providerOutcome) ?? null;
  const latestOutcomeDetail = [...applied].reverse().find((event) => event.outcomeDetail) ?? null;
  const latestEventAt = applied.at(-1)?.occurredAt ?? createdAt;
  const metadataUpdatedAt = iso(item.metadataUpdatedAt ?? item.updatedAt, createdAt, options);
  const updatedAt = Date.parse(latestEventAt) > Date.parse(metadataUpdatedAt) ? latestEventAt : metadataUpdatedAt;
  return {
    id: actionId,
    type: typeof item.type === 'string' && ACTION_TYPES.has(item.type)
      ? item.type as CaseActionType
      : 'internal_review',
    recipient,
    contactSource: text(item.contactSource, MAX_RESPONSE_LABEL_LENGTH) || 'analyst_supplied',
    contactLimitations: limitations(item.contactLimitations),
    dueAt: optionalIso(item.dueAt, options),
    state: history.state,
    reference: latestReference,
    followUpAt: optionalIso(item.followUpAt, options),
    providerOutcome: latestProviderOutcome?.providerOutcome ?? null,
    outcome: latestProviderOutcome?.outcomeDetail ?? latestOutcomeDetail?.outcomeDetail ?? null,
    originActionId: typeof item.originActionId === 'string' && SAFE_ID_RE.test(item.originActionId) && item.originActionId !== actionId
      ? item.originActionId
      : null,
    history: history.history,
    historyOmitted: history.omitted,
    historyLimitations: history.historyLimitations,
    createdAt,
    metadataUpdatedAt,
    updatedAt,
  };
}

function mergeNormalizedActions(left: CaseActionRecord, right: CaseActionRecord, fallback: string): CaseActionRecord {
  const metadataWinner = Date.parse(left.metadataUpdatedAt) > Date.parse(right.metadataUpdatedAt)
    ? left
    : Date.parse(right.metadataUpdatedAt) > Date.parse(left.metadataUpdatedAt)
      ? right
      : JSON.stringify(left) <= JSON.stringify(right) ? left : right;
  return normalizeAction({
    ...metadataWinner,
    id: left.id,
    createdAt: Date.parse(left.createdAt) <= Date.parse(right.createdAt) ? left.createdAt : right.createdAt,
    history: [...left.history, ...right.history],
    historyOmitted: Math.max(left.historyOmitted, right.historyOmitted),
    historyLimitations: [...left.historyLimitations, ...right.historyLimitations],
  }, fallback, { sourceVersion: 13 })!;
}

function boundActionCollection(actions: CaseActionRecord[], fallback: string): CaseActionRecord[] {
  const keep = new Set<string>();
  for (const action of actions) {
    const latest = action.history.at(-1);
    if (latest) keep.add(`${action.id}\u0000${latest.id}`);
  }
  const all = actions.flatMap((action) => action.history.map((event) => ({ action, event })))
    .sort((left, right) => Date.parse(right.event.occurredAt) - Date.parse(left.event.occurredAt)
      || compareCodeUnits(right.event.id, left.event.id));
  for (const item of all) {
    if (keep.size >= MAX_CASE_ACTION_EVENTS_PER_CASE) break;
    keep.add(`${item.action.id}\u0000${item.event.id}`);
  }
  let bounded = actions.map((action) => {
    const history = action.history.filter((event) => keep.has(`${action.id}\u0000${event.id}`));
    const omitted = action.historyOmitted + action.history.length - history.length;
    return normalizeAction({ ...action, history, historyOmitted: omitted }, fallback, { sourceVersion: 13 })!;
  });
  while (bytes(bounded) > MAX_CASE_ACTION_HISTORY_BYTES_PER_CASE) {
    const candidate = bounded
      .flatMap((action) => action.history.slice(0, -1).map((event) => ({ action, event })))
      .sort((left, right) => Date.parse(left.event.occurredAt) - Date.parse(right.event.occurredAt)
        || compareCodeUnits(left.event.id, right.event.id))[0];
    if (!candidate) break;
    bounded = bounded.map((action) => action.id !== candidate.action.id
      ? action
      : normalizeAction({
          ...action,
          history: action.history.filter((event) => event.id !== candidate.event.id),
          historyOmitted: action.historyOmitted + 1,
        }, fallback, { sourceVersion: 13 })!);
  }
  if (bytes(bounded) > MAX_CASE_ACTION_HISTORY_BYTES_PER_CASE && bounded.length > 1) {
    const byteOmissionPattern = /^(\d+) earlier response actions? omitted by the per-Case response-history byte bound\.$/u;
    const previouslyOmitted = bounded.reduce((maximum, action) => {
      const retainedCount = action.historyLimitations.reduce((count, item) => {
        const match = byteOmissionPattern.exec(item);
        return match ? Math.max(count, Number(match[1])) : count;
      }, 0);
      return Math.max(maximum, retainedCount);
    }, 0);
    bounded = bounded.map((action) => ({
      ...action,
      historyLimitations: action.historyLimitations.filter((item) => !byteOmissionPattern.test(item)),
    }));
    let omittedActions = 0;
    while (bounded.length > 1) {
      bounded = bounded.slice(1);
      omittedActions += 1;
      const first = bounded[0]!;
      const totalOmitted = previouslyOmitted + omittedActions;
      bounded = [{
        ...first,
        historyLimitations: lifecycleLimitations([
          `${totalOmitted} earlier response action${totalOmitted === 1 ? '' : 's'} omitted by the per-Case response-history byte bound.`,
          ...first.historyLimitations,
        ]),
      }, ...bounded.slice(1)];
      if (bytes(bounded) <= MAX_CASE_ACTION_HISTORY_BYTES_PER_CASE) return bounded;
    }
  }
  return bounded;
}

export function normalizeCaseActions(
  raw: unknown,
  fallback: string,
  options: CaseResponseTimestampOptions = {},
): CaseActionRecord[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, CaseActionRecord>();
  const inspected = raw.slice(0, MAX_CASE_ACTIONS * 2);
  let invalid = 0;
  for (const item of inspected) {
    const normalized = normalizeAction(item, fallback, options);
    if (!normalized) {
      invalid += 1;
      continue;
    }
    const existing = byId.get(normalized.id);
    byId.set(normalized.id, existing ? mergeNormalizedActions(existing, normalized, fallback) : normalized);
  }
  const normalizedActions = [...byId.values()]
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || compareCodeUnits(left.id, right.id));
  const uninspected = Math.max(0, raw.length - inspected.length);
  const omitted = Math.max(0, normalizedActions.length - MAX_CASE_ACTIONS);
  const actions = normalizedActions.slice(-MAX_CASE_ACTIONS);
  if (actions.length && (invalid || uninspected || omitted)) {
    const first = actions[0]!;
    actions[0] = {
      ...first,
      historyLimitations: lifecycleLimitations([
        ...(invalid ? [`${invalid} malformed response-action candidate${invalid === 1 ? '' : 's'} omitted during normalisation.`] : []),
        ...(uninspected ? [`${uninspected} response-action candidate${uninspected === 1 ? '' : 's'} beyond the bounded inspection window were not traversed.`] : []),
        ...(omitted ? [`${omitted} earlier response action${omitted === 1 ? '' : 's'} omitted by the per-Case action bound.`] : []),
        ...first.historyLimitations,
      ]),
    };
  }
  const actionIds = new Set(actions.map((action) => action.id));
  const linked = actions.map((action) => {
    const originActionId = action.originActionId && actionIds.has(action.originActionId) && action.originActionId !== action.id
      ? action.originActionId
      : null;
    const invalidOrigins = action.history.filter((event) => event.originActionId
      && (!actionIds.has(event.originActionId) || event.originActionId === action.id)).length;
    return {
      ...action,
      originActionId,
      history: action.history.map((event) => ({
        ...event,
        originActionId: event.originActionId && actionIds.has(event.originActionId) && event.originActionId !== action.id
          ? event.originActionId
          : null,
      })),
      historyLimitations: lifecycleLimitations([
        ...action.historyLimitations,
        ...(invalidOrigins || (action.originActionId && !originActionId)
          ? ['One or more dangling or self-referential origin-action links were omitted.']
          : []),
      ]),
    };
  });
  return boundActionCollection(linked, fallback);
}

export function appendCaseAction(
  current: readonly CaseActionRecord[],
  raw: unknown,
  now: string,
): CaseActionRecord[] {
  if (current.length >= MAX_CASE_ACTIONS) {
    throw new Error(`A Case can retain at most ${MAX_CASE_ACTIONS} response actions. No additional action was retained.`);
  }
  const item = record(raw);
  const id = freshId('action');
  const originActionId = typeof item.originActionId === 'string' && current.some((action) => action.id === item.originActionId)
    ? item.originActionId
    : null;
  if (item.originActionId != null && !originActionId) throw new Error('A follow-on action requires an existing originating action.');
  const history = [{
    id: freshId('action-event'),
    previousState: null,
    nextState: 'drafting',
    occurredAt: now,
    sourceClass: 'analyst',
    provenance: 'browser_local_action_creation',
    reference: null,
    evidencePinId: null,
    limitations: [],
    providerOutcome: null,
    outcomeDetail: null,
    originActionId,
  }];
  const created = normalizeAction({
    ...item,
    id,
    originActionId,
    history,
    historyOmitted: 0,
    createdAt: now,
    metadataUpdatedAt: now,
  }, now, { sourceVersion: 13 });
  if (!created) throw new Error('An action requires a recipient or internal owner.');
  return normalizeCaseActions([...current, created], now, { sourceVersion: 13 });
}

export function appendCaseActionTransition(
  current: readonly CaseActionRecord[],
  actionId: string,
  raw: unknown,
  now: string,
  validPinIds?: ReadonlySet<string>,
): CaseActionRecord[] {
  const action = current.find((item) => item.id === actionId);
  if (!action) throw new Error('That case action no longer exists.');
  const item = record(raw);
  const nextState = typeof item.nextState === 'string' && ACTION_STATES.has(item.nextState)
    ? item.nextState as CaseActionState
    : null;
  const sourceClass = typeof item.sourceClass === 'string' && ACTION_EVENT_SOURCE_CLASSES.has(item.sourceClass)
    ? item.sourceClass as CaseActionEventSourceClass
    : 'analyst';
  if (!nextState || !isLegalCaseActionTransition(action.state, nextState, sourceClass)) {
    throw new Error(`The transition from ${action.state.replaceAll('_', ' ')} to ${String(item.nextState || 'that state').replaceAll('_', ' ')} is not permitted.`);
  }
  if (['ready_for_review', 'reviewed', 'authorised', 'submitted'].includes(nextState) && sourceClass !== 'analyst') {
    throw new Error('Readiness, review, authorisation, and submission require an explicit analyst transition.');
  }
  const originActionId = typeof item.originActionId === 'string'
    && item.originActionId !== action.id
    && current.some((candidate) => candidate.id === item.originActionId)
    ? item.originActionId
    : action.originActionId;
  if (item.originActionId != null && originActionId !== item.originActionId) {
    throw new Error('A referral or follow-on transition requires a distinct existing originating action.');
  }
  if (item.evidencePinId != null && (typeof item.evidencePinId !== 'string'
    || !SAFE_ID_RE.test(item.evidencePinId) || (validPinIds && !validPinIds.has(item.evidencePinId)))) {
    throw new Error('An action transition evidence pin must reference a retained Case evidence pin.');
  }
  const occurredAt = optionalIso(item.occurredAt) ?? now;
  const event = normalizeActionEvent({
    ...item,
    id: freshId('action-event'),
    previousState: action.state,
    nextState,
    occurredAt,
    sourceClass,
    provenance: text(item.provenance, MAX_RESPONSE_LABEL_LENGTH) || 'browser_local_explicit_transition',
    originActionId,
  }, action.id, currentActionNormalizationOptions(validPinIds));
  if (!event) throw new Error('The action transition contains an invalid time, provider outcome, or provenance field.');
  const updated = normalizeAction({
    ...action,
    history: [...action.history, event],
    historyOmitted: action.historyOmitted,
  }, now, currentActionNormalizationOptions(validPinIds));
  return normalizeCaseActions(
    current.map((candidate) => candidate.id === actionId ? updated : candidate),
    now,
    currentActionNormalizationOptions(validPinIds),
  );
}

export function updateCaseAction(
  current: readonly CaseActionRecord[],
  raw: unknown,
  now: string,
  validPinIds?: ReadonlySet<string>,
): CaseActionRecord[] {
  const patch = record(raw);
  const id = typeof patch.id === 'string' && SAFE_ID_RE.test(patch.id) ? patch.id : '';
  const existing = current.find((item) => item.id === id);
  if (!existing) throw new Error('That case action no longer exists.');
  if (Object.hasOwn(patch, 'state') || Object.hasOwn(patch, 'outcome') || Object.hasOwn(patch, 'providerOutcome') || Object.hasOwn(patch, 'reference')) {
    throw new Error('State, reference, and provider outcomes must be recorded as an append-only action transition.');
  }
  const metadata = {
    ...existing,
    type: Object.hasOwn(patch, 'type') ? patch.type : existing.type,
    recipient: Object.hasOwn(patch, 'recipient') ? patch.recipient : existing.recipient,
    contactSource: Object.hasOwn(patch, 'contactSource') ? patch.contactSource : existing.contactSource,
    contactLimitations: Object.hasOwn(patch, 'contactLimitations') ? patch.contactLimitations : existing.contactLimitations,
    dueAt: Object.hasOwn(patch, 'dueAt') ? patch.dueAt : existing.dueAt,
    followUpAt: Object.hasOwn(patch, 'followUpAt') ? patch.followUpAt : existing.followUpAt,
    originActionId: Object.hasOwn(patch, 'originActionId') ? patch.originActionId : existing.originActionId,
    metadataUpdatedAt: now,
  };
  if (Object.hasOwn(patch, 'originActionId') && patch.originActionId !== null
    && (typeof patch.originActionId !== 'string' || patch.originActionId === id || !current.some((item) => item.id === patch.originActionId))) {
    throw new Error('A follow-on action requires a distinct existing originating action.');
  }
  let updated = normalizeAction(metadata, now, currentActionNormalizationOptions(validPinIds));
  if (!updated) throw new Error('An action requires a recipient or internal owner.');
  const materialChanged = ['type', 'recipient', 'contactSource', 'contactLimitations', 'originActionId']
    .some((key) => Object.hasOwn(patch, key) && JSON.stringify(record(existing)[key]) !== JSON.stringify(record(updated)[key]));
  if (materialChanged && ['submitted', 'acknowledged', 'terminal'].includes(existing.state)) {
    throw new Error('Submitted or terminal action identity and recipient metadata cannot be rewritten; create a linked follow-on action instead.');
  }
  if (materialChanged && ['ready_for_review', 'reviewed', 'authorised'].includes(existing.state)) {
    const invalidated = normalizeAction({
      ...updated,
      history: [...updated.history, {
        id: freshId('action-event'),
        previousState: existing.state,
        nextState: 'drafting',
        occurredAt: now,
        sourceClass: 'browser_local',
        provenance: 'material_action_change',
        reference: null,
        evidencePinId: null,
        limitations: ['Material action inputs changed after review; prior readiness, review, or authorisation no longer applies.'],
        providerOutcome: null,
        outcomeDetail: null,
        originActionId: updated.originActionId,
      }],
    }, now, currentActionNormalizationOptions(validPinIds));
    if (!invalidated) throw new Error('The material action change could not be retained safely.');
    updated = invalidated;
  }
  const interim = current.map((item) => item.id === id ? updated : item);
  return patch.transition !== undefined
    ? appendCaseActionTransition(interim, id, patch.transition, now, validPinIds)
    : normalizeCaseActions(interim, now, currentActionNormalizationOptions(validPinIds));
}

export function buildCaseActionOutcomeSummary(
  actions: readonly CaseActionRecord[],
  nowRaw: unknown = new Date().toISOString(),
): CaseActionOutcomeSummary {
  const now = optionalIso(nowRaw) ?? new Date().toISOString();
  const nowTime = Date.parse(now);
  const active = actions.filter((item) => item.state !== 'terminal');
  const latestOutcomes = actions
    .flatMap((action) => action.history.filter((event) => event.applied && event.providerOutcome).map((event) => ({ action, event })))
    .sort((left, right) => Date.parse(right.event.occurredAt) - Date.parse(left.event.occurredAt) || compareCodeUnits(right.event.id, left.event.id))
    .slice(0, 5)
    .map(({ action, event }) => ({
      actionId: action.id,
      recipient: action.recipient,
      state: action.state,
      providerOutcome: event.providerOutcome!,
      outcomeDetail: event.outcomeDetail,
      occurredAt: event.occurredAt,
    }));
  return {
    total: actions.length,
    active: active.length,
    drafting: actions.filter((item) => item.state === 'drafting').length,
    readyForReview: actions.filter((item) => item.state === 'ready_for_review').length,
    reviewed: actions.filter((item) => item.state === 'reviewed').length,
    authorised: actions.filter((item) => item.state === 'authorised').length,
    submitted: actions.filter((item) => item.state === 'submitted').length,
    acknowledged: actions.filter((item) => item.state === 'acknowledged').length,
    terminal: actions.filter((item) => item.state === 'terminal').length,
    overdue: active.filter((item) => item.dueAt && Date.parse(item.dueAt) < nowTime).length,
    followUpDue: active.filter((item) => item.followUpAt && Date.parse(item.followUpAt) <= nowTime).length,
    withProviderOutcome: actions.filter((item) => item.providerOutcome !== null).length,
    latestOutcomes,
  };
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

export function mergeCaseActions(
  local: readonly CaseActionRecord[],
  imported: readonly CaseActionRecord[],
  fallback: string,
  validPinIds?: ReadonlySet<string>,
): CaseActionRecord[] {
  return normalizeCaseActions([...local, ...imported], fallback, currentActionNormalizationOptions(validPinIds));
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
    observedAt: iso(item.observedAt, createdAt, options),
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
    .sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt) || compareCodeUnits(left.id, right.id))
    .slice(-MAX_CASE_SIGHTINGS);
}

export function appendCaseSighting(
  current: readonly CaseSightingRecord[],
  raw: unknown,
  now: string,
  validPinIds?: ReadonlySet<string>,
): CaseSightingRecord[] {
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

function normalizeObservedEffectReview(
  raw: unknown,
  fallback: string,
  validPinIds?: ReadonlySet<string>,
  validSightingIds?: ReadonlySet<string>,
  options: CaseResponseTimestampOptions = {},
): CaseObservedEffectReview | null {
  const item = record(raw);
  if (typeof item.state !== 'string' || !OBSERVED_EFFECT_STATES.has(item.state)) return null;
  if (typeof item.sourceClass !== 'string' || !OBSERVED_EFFECT_SOURCE_CLASSES.has(item.sourceClass)) return null;
  const source = text(item.source, MAX_RESPONSE_LABEL_LENGTH);
  const observedAt = optionalIso(item.observedAt, options);
  if (!source || !observedAt) return null;
  const createdAt = iso(item.createdAt, observedAt || fallback, options);
  const evidencePinId = typeof item.evidencePinId === 'string'
    && SAFE_ID_RE.test(item.evidencePinId)
    && (!validPinIds || validPinIds.has(item.evidencePinId))
    ? item.evidencePinId
    : null;
  const sightingId = typeof item.sightingId === 'string'
    && SAFE_ID_RE.test(item.sightingId)
    && (!validSightingIds || validSightingIds.has(item.sightingId))
    ? item.sightingId
    : null;
  const linkLimitations = [
    ...(item.evidencePinId != null && !evidencePinId ? ['A malformed or dangling evidence-pin reference was omitted from this independent review.'] : []),
    ...(item.sightingId != null && !sightingId ? ['A malformed or dangling sighting reference was omitted from this independent review.'] : []),
  ];
  return {
    id: safeId(item.id, 'effect-review', { state: item.state, source, observedAt, createdAt }),
    state: item.state as CaseObservedEffectState,
    observedAt,
    sourceClass: item.sourceClass as CaseObservedEffectSourceClass,
    source,
    completeness: typeof item.completeness === 'string' && COMPLETENESS.has(item.completeness)
      ? item.completeness as CasePinCompleteness
      : 'unknown',
    limitations: limitations([...linkLimitations, ...limitations(item.limitations)]),
    evidencePinId,
    sightingId,
    followUpAt: optionalIso(item.followUpAt, options),
    createdAt,
  };
}

export function normalizeCaseObservedEffectHistory(
  raw: unknown,
  fallback: string,
  validPinIds?: ReadonlySet<string>,
  validSightingIds?: ReadonlySet<string>,
  options: CaseResponseTimestampOptions = {},
): CaseObservedEffectHistory {
  const root = record(raw);
  const source = Array.isArray(raw) ? raw : Array.isArray(root.reviews) ? root.reviews : [];
  const byId = new Map<string, CaseObservedEffectReview>();
  let invalid = 0;
  let duplicateConflict = 0;
  for (const item of source.slice(0, MAX_CASE_OBSERVED_EFFECT_REVIEWS * 4)) {
    const normalized = normalizeObservedEffectReview(item, fallback, validPinIds, validSightingIds, options);
    if (!normalized) {
      invalid += 1;
      continue;
    }
    const existing = byId.get(normalized.id);
    if (!existing) byId.set(normalized.id, normalized);
    else if (JSON.stringify(normalized) !== JSON.stringify(existing)) {
      duplicateConflict += 1;
      if (JSON.stringify(normalized) < JSON.stringify(existing)) byId.set(normalized.id, normalized);
    }
  }
  const all = [...byId.values()].sort((left, right) =>
    Date.parse(left.observedAt) - Date.parse(right.observedAt) || compareCodeUnits(left.id, right.id));
  invalid += Math.max(0, source.length - MAX_CASE_OBSERVED_EFFECT_REVIEWS * 4);
  const omitted = boundedCounter(root.omitted)
    + invalid
    + duplicateConflict
    + Math.max(0, all.length - MAX_CASE_OBSERVED_EFFECT_REVIEWS);
  const preV13HistoryUnavailable = options.sourceVersion != null && options.sourceVersion <= 12
    ? true
    : root.preV13HistoryUnavailable === true;
  const retainedLimitations = limitations(root.limitations).filter((item) =>
    !/^\d+ earlier observed-effect reviews? omitted by bounded retention\.$/u.test(item));
  return {
    reviews: all.slice(-MAX_CASE_OBSERVED_EFFECT_REVIEWS),
    omitted,
    preV13HistoryUnavailable,
    limitations: lifecycleLimitations([
      ...(omitted ? [`${omitted} earlier observed-effect review${omitted === 1 ? '' : 's'} omitted by bounded retention.`] : []),
      ...(invalid ? [`${invalid} malformed or unlinked observed-effect review${invalid === 1 ? '' : 's'} omitted during normalisation.`] : []),
      ...(duplicateConflict ? [`${duplicateConflict} conflicting observed-effect review identit${duplicateConflict === 1 ? 'y was' : 'ies were'} reconciled deterministically.`] : []),
      ...(preV13HistoryUnavailable ? ['Migrated from a pre-v13 Case; earlier independent observed-effect review history is unavailable.'] : []),
      'Observed-effect reviews are independent point-in-time records; provider workflow events do not create or replace them.',
      ...retainedLimitations,
    ]),
  };
}

export function appendCaseObservedEffectReview(
  current: CaseObservedEffectHistory,
  raw: unknown,
  now: string,
  validPinIds?: ReadonlySet<string>,
  validSightingIds?: ReadonlySet<string>,
): CaseObservedEffectHistory {
  const item = record(raw);
  const created = normalizeObservedEffectReview({ ...item, id: freshId('effect-review'), createdAt: now }, now, validPinIds, validSightingIds);
  if (!created) throw new Error('An independent observed-effect review requires a valid state, time, source class, and source.');
  return normalizeCaseObservedEffectHistory({
    reviews: [...current.reviews, created],
    omitted: current.omitted,
    preV13HistoryUnavailable: current.preV13HistoryUnavailable,
    limitations: current.limitations,
  }, now, validPinIds, validSightingIds);
}

export function mergeCaseObservedEffectHistories(
  local: CaseObservedEffectHistory,
  imported: CaseObservedEffectHistory,
  fallback: string,
  validPinIds?: ReadonlySet<string>,
  validSightingIds?: ReadonlySet<string>,
): CaseObservedEffectHistory {
  return normalizeCaseObservedEffectHistory({
    reviews: [...local.reviews, ...imported.reviews],
    omitted: Math.max(local.omitted, imported.omitted),
    preV13HistoryUnavailable: local.preV13HistoryUnavailable || imported.preV13HistoryUnavailable,
    limitations: [...local.limitations, ...imported.limitations],
  }, fallback, validPinIds, validSightingIds);
}

function normalizeClosure(
  raw: unknown,
  fallback: string,
  validReviewIds?: ReadonlySet<string>,
  validActionIds?: ReadonlySet<string>,
  options: CaseResponseTimestampOptions = {},
  linkContext: CaseClosureLinkContext = {},
): CaseClosureRecord | null {
  const item = record(raw);
  if (typeof item.reason !== 'string' || !CLOSURE_REASONS.has(item.reason)) return null;
  const reason = item.reason as CaseClosureReason;
  const summary = text(item.summary, MAX_RESPONSE_RATIONALE_LENGTH);
  if (!summary) return null;
  const createdAt = iso(item.createdAt, fallback, options);
  const observedEffectReviewId = typeof item.observedEffectReviewId === 'string'
    && SAFE_ID_RE.test(item.observedEffectReviewId)
    && (!validReviewIds || validReviewIds.has(item.observedEffectReviewId))
    ? item.observedEffectReviewId
    : null;
  const actionId = typeof item.actionId === 'string'
    && SAFE_ID_RE.test(item.actionId)
    && (!validActionIds || validActionIds.has(item.actionId))
    ? item.actionId
    : null;
  const linkedReview = observedEffectReviewId ? linkContext.reviewEvidence?.get(observedEffectReviewId) : undefined;
  const reviewPredatesClosure = linkedReview !== undefined
    && Date.parse(linkedReview.observedAt) <= Date.parse(createdAt)
    && Date.parse(linkedReview.createdAt) <= Date.parse(createdAt);
  if (linkContext.reviewEvidence && reason === 'independently_not_reproduced'
    && (!reviewPredatesClosure || linkedReview?.state !== 'not_reproduced')) return null;
  if (linkContext.reviewEvidence && reason === 'infrastructure_changed'
    && (!reviewPredatesClosure || linkedReview?.state !== 'changed')) return null;
  const linkedProviderEvents = actionId ? linkContext.providerResolutionEvents?.get(actionId) ?? [] : [];
  if (linkContext.providerResolutionEvents && reason === 'provider_reported_resolution_not_independently_checked'
    && !linkedProviderEvents.some((event) => Date.parse(event.occurredAt) <= Date.parse(createdAt))) return null;
  const linkLimitations = [
    ...(item.observedEffectReviewId != null && !observedEffectReviewId ? ['A malformed or dangling observed-effect review reference was omitted from this closure.'] : []),
    ...(item.actionId != null && !actionId ? ['A malformed or dangling response-action reference was omitted from this closure.'] : []),
  ];
  return {
    id: safeId(item.id, 'case-closure', { reason: item.reason, summary, createdAt }),
    reason,
    summary,
    observedEffectReviewId,
    actionId,
    limitations: limitations([...linkLimitations, ...limitations(item.limitations)]),
    createdAt,
  };
}

export function buildCaseClosureLinkContext(
  observedEffects: CaseObservedEffectHistory,
  actions: readonly CaseActionRecord[],
): CaseClosureLinkContext {
  return {
    reviewEvidence: new Map(observedEffects.reviews.map((review) => [review.id, {
      state: review.state,
      observedAt: review.observedAt,
      createdAt: review.createdAt,
    }] as const)),
    providerResolutionEvents: new Map(actions.map((action) => [action.id, action.history
      .filter((event) => event.applied && event.providerOutcome === 'provider_reports_resolved')
      .map((event) => ({ eventId: event.id, occurredAt: event.occurredAt }))] as const)),
  };
}

export function normalizeCaseClosureHistory(
  raw: unknown,
  fallback: string,
  validReviewIds?: ReadonlySet<string>,
  validActionIds?: ReadonlySet<string>,
  options: CaseResponseTimestampOptions = {},
  linkContext: CaseClosureLinkContext = {},
): CaseClosureHistory {
  const root = record(raw);
  const source = Array.isArray(raw) ? raw : Array.isArray(root.records) ? root.records : [];
  const byId = new Map<string, CaseClosureRecord>();
  let invalid = 0;
  let duplicateConflict = 0;
  for (const item of source.slice(0, MAX_CASE_CLOSURES * 4)) {
    const normalized = normalizeClosure(item, fallback, validReviewIds, validActionIds, options, linkContext);
    if (!normalized) {
      invalid += 1;
      continue;
    }
    const existing = byId.get(normalized.id);
    if (!existing) byId.set(normalized.id, normalized);
    else if (JSON.stringify(normalized) !== JSON.stringify(existing)) {
      duplicateConflict += 1;
      if (JSON.stringify(normalized) < JSON.stringify(existing)) byId.set(normalized.id, normalized);
    }
  }
  const all = [...byId.values()].sort((left, right) =>
    Date.parse(left.createdAt) - Date.parse(right.createdAt) || compareCodeUnits(left.id, right.id));
  invalid += Math.max(0, source.length - MAX_CASE_CLOSURES * 4);
  const omitted = boundedCounter(root.omitted)
    + invalid
    + duplicateConflict
    + Math.max(0, all.length - MAX_CASE_CLOSURES);
  const preV13HistoryUnavailable = options.sourceVersion != null && options.sourceVersion <= 12
    ? true
    : root.preV13HistoryUnavailable === true;
  const retainedLimitations = limitations(root.limitations).filter((item) =>
    !/^\d+ earlier closure records? omitted by bounded retention\.$/u.test(item));
  return {
    records: all.slice(-MAX_CASE_CLOSURES),
    omitted,
    preV13HistoryUnavailable,
    limitations: lifecycleLimitations([
      ...(omitted ? [`${omitted} earlier closure record${omitted === 1 ? '' : 's'} omitted by bounded retention.`] : []),
      ...(invalid ? [`${invalid} malformed, unsupported, or unlinked closure record${invalid === 1 ? '' : 's'} omitted during normalisation.`] : []),
      ...(duplicateConflict ? [`${duplicateConflict} conflicting closure record identit${duplicateConflict === 1 ? 'y was' : 'ies were'} reconciled deterministically.`] : []),
      ...(preV13HistoryUnavailable ? ['Migrated from a pre-v13 Case; earlier deliberate closure history is unavailable.'] : []),
      'Closure records are deliberate analyst actions and do not establish absence, safety, provider performance, or legal sufficiency.',
      ...retainedLimitations,
    ]),
  };
}

export function appendCaseClosure(
  current: CaseClosureHistory,
  raw: unknown,
  now: string,
  observedEffects: CaseObservedEffectHistory,
  actions: readonly CaseActionRecord[],
): CaseClosureHistory {
  const item = record(raw);
  const reason = typeof item.reason === 'string' && CLOSURE_REASONS.has(item.reason)
    ? item.reason as CaseClosureReason
    : null;
  const review = typeof item.observedEffectReviewId === 'string'
    ? observedEffects.reviews.find((candidate) => candidate.id === item.observedEffectReviewId) ?? null
    : null;
  const action = typeof item.actionId === 'string'
    ? actions.find((candidate) => candidate.id === item.actionId) ?? null
    : null;
  if (reason === 'independently_not_reproduced'
    && (review?.state !== 'not_reproduced' || Date.parse(review.observedAt) > Date.parse(now) || Date.parse(review.createdAt) > Date.parse(now))) {
    throw new Error('This closure reason requires a linked independent not-reproduced review.');
  }
  if (reason === 'infrastructure_changed'
    && (review?.state !== 'changed' || Date.parse(review.observedAt) > Date.parse(now) || Date.parse(review.createdAt) > Date.parse(now))) {
    throw new Error('This closure reason requires a linked independent changed review.');
  }
  if (reason === 'provider_reported_resolution_not_independently_checked'
    && (action?.providerOutcome !== 'provider_reports_resolved'
      || !action.history.some((event) => event.applied
        && event.providerOutcome === 'provider_reports_resolved'
        && Date.parse(event.occurredAt) <= Date.parse(now)))) {
    throw new Error('This closure reason requires a linked typed provider-reported-resolution outcome.');
  }
  const linkContext = buildCaseClosureLinkContext(observedEffects, actions);
  const created = normalizeClosure({ ...item, id: freshId('case-closure'), createdAt: now }, now,
    new Set(observedEffects.reviews.map((candidate) => candidate.id)),
    new Set(actions.map((candidate) => candidate.id)), {}, linkContext);
  if (!created || !reason) throw new Error('A deliberate closure requires a typed reason and summary.');
  return normalizeCaseClosureHistory({
    records: [...current.records, created],
    omitted: current.omitted,
    preV13HistoryUnavailable: current.preV13HistoryUnavailable,
    limitations: current.limitations,
  }, now,
  new Set(observedEffects.reviews.map((candidate) => candidate.id)),
  new Set(actions.map((candidate) => candidate.id)), {}, linkContext);
}

export function mergeCaseClosureHistories(
  local: CaseClosureHistory,
  imported: CaseClosureHistory,
  fallback: string,
  validReviewIds?: ReadonlySet<string>,
  validActionIds?: ReadonlySet<string>,
  linkContext: CaseClosureLinkContext = {},
): CaseClosureHistory {
  return normalizeCaseClosureHistory({
    records: [...local.records, ...imported.records],
    omitted: Math.max(local.omitted, imported.omitted),
    preV13HistoryUnavailable: local.preV13HistoryUnavailable || imported.preV13HistoryUnavailable,
    limitations: [...local.limitations, ...imported.limitations],
  }, fallback, validReviewIds, validActionIds, {}, linkContext);
}

export function buildCaseResponseLifecycleSummary(input: Readonly<{
  actions?: readonly CaseActionRecord[];
  observedEffects?: CaseObservedEffectHistory;
  closures?: CaseClosureHistory;
}>): CaseResponseLifecycleSummary {
  const providerEvents = (input.actions ?? []).flatMap((action) => action.history
    .filter((event) => event.providerOutcome)
    .map((event) => ({ action, event })));
  providerEvents.sort((left, right) => Date.parse(right.event.occurredAt) - Date.parse(left.event.occurredAt)
    || compareCodeUnits(right.event.id, left.event.id));
  const providerTime = providerEvents[0]?.event.occurredAt ?? null;
  const providerEventsAtLatestTime = providerTime === null
    ? []
    : providerEvents.filter(({ event }) => event.occurredAt === providerTime);
  const latestProvider = providerEventsAtLatestTime.length === 1 && providerEventsAtLatestTime[0]!.event.applied
    ? providerEventsAtLatestTime[0]!
    : null;
  const providerOutcomeState = providerEvents.length === 0
    ? 'missing' as const
    : latestProvider ? 'available' as const : 'ambiguous' as const;
  const reviews = [...(input.observedEffects?.reviews ?? [])]
    .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt) || compareCodeUnits(right.id, left.id));
  const latestObserved = reviews[0] ?? null;
  const changedReviews = reviews.filter((review) => review.state === 'changed');
  const changedTime = changedReviews[0]?.observedAt ?? null;
  const changedAtLatestTime = changedTime === null
    ? []
    : changedReviews.filter((review) => review.observedAt === changedTime);
  const latestObservedChangeAt = changedAtLatestTime.length === 1 ? changedTime : null;
  const observedChangeState = changedReviews.length === 0
    ? 'missing' as const
    : latestObservedChangeAt ? 'available' as const : 'ambiguous' as const;
  const latestClosure = [...(input.closures?.records ?? [])]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || compareCodeUnits(right.id, left.id))[0] ?? null;
  return {
    providerOutcomeState,
    latestProviderOutcome: latestProvider ? {
      actionId: latestProvider.action.id,
      eventId: latestProvider.event.id,
      outcome: latestProvider.event.providerOutcome!,
      occurredAt: latestProvider.event.occurredAt,
      reference: latestProvider.event.reference,
    } : null,
    observedChangeState,
    latestObservedEffect: latestObserved ? {
      reviewId: latestObserved.id,
      state: latestObserved.state,
      observedAt: latestObserved.observedAt,
      sourceClass: latestObserved.sourceClass,
      source: latestObserved.source,
    } : null,
    latestObservedChangeAt,
    latestClosure,
  };
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
      detail: `${item.source} · ${item.completeness}`,
      createdAt: item.observedAt,
    })),
    ...(input.observedEffects?.reviews ?? []).map((item): CaseInvestigationTrailItem => ({
      id: `observed-effect:${item.id}`,
      kind: 'observed_effect',
      label: `independent effect · ${item.state.replaceAll('_', ' ')}`,
      detail: `${item.source} · ${item.completeness}`,
      createdAt: item.observedAt,
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
