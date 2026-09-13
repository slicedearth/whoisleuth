import type { CASE_RESPONSE_PACKET_SCHEMA, CASE_RESPONSE_PACKET_VERSION } from '../contracts/case-portability.mts';
import type { SORTED_JSON_V2 } from '../evidence/artifact-integrity.mts';
import type { CaseRecord } from './case-model.mts';
import type { buildCaseActionOutcomeSummary, CaseObservedEffectState } from './case-response-model.mts';
import type {
  RESPONSE_CONTACT_KINDS, RESPONSE_PACKET_PROFILE_IDS, RESPONSE_READINESS_ROW_IDS,
  RESPONSE_AUTHORISATION_CONFIRMATION_IDS, ResponseReadinessState,
} from './case-response-packet-vocabulary.mts';

export type ResponseContactKind = typeof RESPONSE_CONTACT_KINDS[number];

export type ResponsePacketProfileId = typeof RESPONSE_PACKET_PROFILE_IDS[number];

export type ResponseReadinessRowId = typeof RESPONSE_READINESS_ROW_IDS[number];

export type ResponseAuthorisationConfirmationId = typeof RESPONSE_AUTHORISATION_CONFIRMATION_IDS[number];

export type ResponseReadinessInput = Readonly<{
  infrastructureResponsibility?: unknown;
  authorityReview?: unknown;
  contradictionsReview?: unknown;
  sourceLimitations?: unknown;
}>;

export type ResponseArtefactReferenceInput = Readonly<{
  id?: unknown;
  label?: unknown;
  mediaType?: unknown;
  capturedAt?: unknown;
  source?: unknown;
  digestSha256?: unknown;
  byteLength?: unknown;
  limitations?: unknown;
}>;

export type ResponseAuthorisationInput = Readonly<{
  reviewedInputDigestSha256?: unknown;
  confirmedAt?: unknown;
  confirmations?: unknown;
}>;

export type ResponsePacketProfile = Readonly<{
  id: ResponsePacketProfileId;
  label: string;
  audience: string;
  subjectPrefix: string;
  requiredContactKind: ResponseContactKind | null;
  checklist: readonly string[];
  evidenceOrder: readonly string[];
  includedEvidence: readonly string[];
  excludedEvidence: readonly string[];
  redactions: readonly string[];
  attachments: readonly string[];
  followUpFields: readonly string[];
}>;

export type ResponseContactInput = {
  kind?: unknown;
  contact?: unknown;
  source?: unknown;
  observedAt?: unknown;
  limitations?: unknown;
};

export type CaseResponsePacketInput = {
  profile?: unknown;
  category?: unknown;
  affectedParty?: unknown;
  abusiveUrls?: unknown;
  observedHarm?: unknown;
  observedAt?: unknown;
  contacts?: unknown;
  actionId?: unknown;
  selectedEvidencePinIds?: unknown;
  readiness?: ResponseReadinessInput | unknown;
  artefactReferences?: readonly ResponseArtefactReferenceInput[] | unknown;
  authorisation?: ResponseAuthorisationInput | unknown;
};

export type CaseResponsePreflightCheck = Readonly<{
  id: string;
  label: string;
  state: 'block' | 'caution' | 'pass';
  detail: string;
}>;

export type CaseResponsePreflight = Readonly<{
  version: 3;
  status: 'needs_input' | 'ready_for_review' | 'review_cautions';
  canExport: boolean;
  counts: Readonly<{ block: number; caution: number; pass: number }>;
  checks: readonly CaseResponsePreflightCheck[];
  actionSummary: ReturnType<typeof buildCaseActionOutcomeSummary>;
}>;

export type CaseResponseReadinessRow = Readonly<{
  id: ResponseReadinessRowId;
  label: string;
  state: ResponseReadinessState;
  detail: string;
  requiredForAuthorisation: boolean;
  limitations: readonly string[];
}>;

export type CaseResponseAuthorisation = Readonly<{
  status: 'draft' | 'authorised';
  reviewedInputDigestSha256: string;
  suppliedReviewDigestSha256: string | null;
  digestMatches: boolean;
  confirmedAt: string | null;
  confirmations: Readonly<Record<ResponseAuthorisationConfirmationId, boolean>>;
  missingConfirmations: readonly ResponseAuthorisationConfirmationId[];
  limitations: readonly string[];
}>;

export type CaseResponsePacket = {
  schema: typeof CASE_RESPONSE_PACKET_SCHEMA;
  schemaVersion: typeof CASE_RESPONSE_PACKET_VERSION;
  generatedAt: string;
  reviewRequired: true;
  submissionPerformed: false;
  profile: {
    id: ResponsePacketProfileId;
    label: string;
    audience: string;
    subject: string;
    checklist: string[];
    evidenceOrder: string[];
    includedEvidence: string[];
    excludedEvidence: string[];
    redactions: string[];
    attachments: string[];
    followUpFields: string[];
  };
  case: {
    id: string;
    domain: string;
    status: CaseRecord['status'];
    disposition: CaseRecord['disposition'];
    updatedAt: string;
  };
  incident: {
    category: string;
    affectedParty: string;
    abusiveUrls: string[];
    observedHarm: string;
    observedAt: string;
  };
  contacts: Array<{
    kind: ResponseContactKind;
    contact: string;
    source: string;
    observedAt: string | null;
    reviewAfter: string | null;
    freshness: 'current' | 'stale' | 'unknown';
    limitations: string[];
  }>;
  recipientRoute: {
    actionId: string;
    kind: ResponseContactKind | 'manual';
    contact: string;
    source: string;
    observedAt: string | null;
    reviewAfter: string | null;
    freshness: 'current' | 'stale' | 'unknown';
    limitations: string[];
  } | null;
  actionBinding: {
    state: 'selected' | 'not_selected';
    selectedActionId: string | null;
    lineageActionIds: string[];
    limitations: string[];
  };
  selectedEvidence: Array<{
    id: string;
    label: string;
    source: string;
    observationHostname?: string;
    webObservationMode?: 'selected_url';
    observedAt: string | null;
    completeness: string;
    limitations: string[];
  }>;
  contradictions: Array<{
    id: string;
    statement: string;
    state: string;
    limitations: string[];
  }>;
  readiness: {
    profileId: ResponsePacketProfileId;
    rows: CaseResponseReadinessRow[];
    counts: Record<ResponseReadinessState, number>;
    limitations: string[];
  };
  artefactReferences: Array<{
    id: string;
    label: string;
    mediaType: string;
    capturedAt: string;
    source: string;
    digestSha256: string;
    byteLength: number | null;
    limitations: string[];
  }>;
  authorisation: CaseResponseAuthorisation;
  preflight: CaseResponsePreflight;
  escalationHistory: Array<{
    actionId: string;
    type: string;
    recipient: string;
    contactSource: string;
    routeObservedAt: string | null;
    routeReviewAfter: string | null;
    state: string;
    reference: string | null;
    providerOutcome: string | null;
    outcomeDetail: string | null;
    originActionId: string | null;
    historyOmitted: number;
    historyLimitations: string[];
    transitions: Array<{
      id: string;
      previousState: string | null;
      nextState: string;
      occurredAt: string;
      sourceClass: string;
      provenance: string;
      reference: string | null;
      evidencePinId: string | null;
      limitations: string[];
      providerOutcome: string | null;
      outcomeDetail: string | null;
      originActionId: string | null;
      applied: boolean;
    }>;
    createdAt: string;
    updatedAt: string;
  }>;
  escalationHistoryOmitted: number;
  escalationHistoryLimitations: string[];
  responseLifecycle: {
    providerOutcomeState: 'available' | 'missing' | 'ambiguous';
    latestProviderOutcome: {
      actionId: string;
      eventId: string;
      outcome: string;
      occurredAt: string;
      reference: string | null;
    } | null;
    observedChangeState: 'available' | 'missing' | 'ambiguous';
    latestObservedEffect: {
      reviewId: string;
      state: CaseObservedEffectState;
      observedAt: string;
      sourceClass: string;
      source: string;
    } | null;
    latestObservedChangeAt: string | null;
    closure: {
      id: string;
      reason: string;
      createdAt: string;
      limitations: string[];
    } | null;
    limitations: string[];
  };
  provenance: {
    latestEvidenceCapturedAt: string | null;
    evidencePinCount: number;
    decisionCount: number;
    assertionCount: number;
    observationAge: {
      ageSeconds: number;
      band: 'future_or_clock_skew' | 'one_to_seven_days' | 'over_seven_days' | 'under_24_hours';
      refreshRecommended: boolean;
    };
    limitations: string[];
  };
  integrity: {
    algorithm: 'SHA-256';
    canonicalization: typeof SORTED_JSON_V2;
    scope: 'packet excluding integrity';
    digestSha256: string;
  };
};
