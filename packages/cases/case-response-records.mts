// Framework-neutral response record types and vocabulary.


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
  'platform_report',
  'defensive_control',
  'internal_review',
] as const;

export type CaseActionType = typeof CASE_ACTION_TYPES[number];

export const CASE_DECISION_CONFIDENCE_LEVELS = ['unknown', 'low', 'moderate', 'high'] as const;

export type CaseDecisionConfidence = typeof CASE_DECISION_CONFIDENCE_LEVELS[number];

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
  observedAt: string | null;
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
  /** Identity of a complete imported finding; not source authentication. */
  importContentSha256?: string;
  observedAt: string | null;
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
  confidence: CaseDecisionConfidence;
  confidenceBasis: string;
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
  routeObservedAt: string | null;
  routeReviewAfter: string | null;
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

export type CaseResponseTimestampOptions = Readonly<{
  legacyTimestamps?: boolean;
  sourceVersion?: number | null;
  validEvidencePinIds?: ReadonlySet<string>;
}>;
