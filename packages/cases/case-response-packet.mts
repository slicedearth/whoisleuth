// Pure abuse-evidence packet builder. It creates local review artifacts only:
// no network requests, mailto links, submissions, or provider side effects.

import {
  assertBoundedJsonStructure,
} from '../../lib/bounded-json.mts';
import {
  CASE_RESPONSE_PACKET_SCHEMA,
  CASE_RESPONSE_PACKET_VERSION,
  CASE_RESPONSE_REVIEW_INPUTS_SCHEMA,
  CASE_RESPONSE_REVIEW_INPUTS_VERSION,
  MAX_ABUSE_CATEGORY_LENGTH,
  MAX_ABUSIVE_URLS,
  MAX_AFFECTED_PARTY_LENGTH,
  MAX_EXACT_URL_LENGTH,
  MAX_RESPONSE_ACTION_HISTORY,
  MAX_RESPONSE_ARTEFACT_REFERENCES,
  MAX_RESPONSE_AUTHORISATION_CLOCK_SKEW_MS,
  MAX_RESPONSE_CONTRADICTIONS,
  MAX_RESPONSE_HARM_LENGTH,
  MAX_RESPONSE_SELECTED_EVIDENCE,
  SUPPORTED_CASE_RESPONSE_PACKET_VERSIONS,
} from '../contracts/case-portability.mts';
import {
  SORTED_JSON_V2,
  canonicalArtifactJsonV2,
} from '../evidence/artifact-integrity.mts';
import {
  normalizeExplicitIsoTimestamp,
} from '../evidence/observation.mts';
import {
  latestCaseEvidence,
} from './case-evidence-model.mts';
import {
  type CaseRecord,
} from './case-model.mts';
import {
  caseDispositionSupportsDefensiveResponse,
} from './case-record-operations.mts';
import {
  buildCaseActionOutcomeSummary,
  buildCaseResponseLifecycleSummary,
  type CaseObservedEffectState,
} from './case-response-model.mts';
import {
  RESPONSE_AUTHORISATION_CONFIRMATION_IDS,
  RESPONSE_CONTACT_KINDS,
  RESPONSE_PACKET_PROFILE_IDS,
  RESPONSE_READINESS_ROW_IDS,
  RESPONSE_READINESS_STATES,
  type ResponseReadinessState,
} from './case-response-packet-vocabulary.mts';
import {
  validateCaseResponseReviewInputs,
} from './case-response-review-inputs.mts';
import {
  responseRouteFreshness,
} from './response-route-freshness.mts';

export * from './case-response-packet-vocabulary.mts';

export {
  validateCaseResponseReviewInputs,
} from './case-response-review-inputs.mts';

export {
  CASE_RESPONSE_PACKET_SCHEMA,
  CASE_RESPONSE_PACKET_VERSION,
  PUBLISHED_V2_2_CASE_RESPONSE_PACKET_VERSION,
  PUBLISHED_V2_3_CASE_RESPONSE_PACKET_VERSION,
  PUBLIC_CASE_RESPONSE_PACKET_VERSION,
  PUBLISHED_V2_CASE_RESPONSE_PACKET_VERSION,
  CASE_RESPONSE_REVIEW_INPUTS_SCHEMA,
  CASE_RESPONSE_REVIEW_INPUTS_VERSION,
  PUBLISHED_V2_2_CASE_RESPONSE_REVIEW_INPUTS_VERSION,
  PUBLISHED_V2_3_CASE_RESPONSE_REVIEW_INPUTS_VERSION,
  PUBLISHED_V2_CASE_RESPONSE_REVIEW_INPUTS_VERSION,
  MAX_ABUSE_CATEGORY_LENGTH,
  MAX_ABUSIVE_URLS,
  MAX_AFFECTED_PARTY_LENGTH,
  MAX_EXACT_URL_LENGTH,
  MAX_RESPONSE_ACTION_HISTORY,
  MAX_RESPONSE_ARTEFACT_REFERENCES,
  MAX_RESPONSE_AUTHORISATION_CLOCK_SKEW_MS,
  MAX_RESPONSE_CONTACTS,
  MAX_RESPONSE_CONTRADICTIONS,
  MAX_RESPONSE_HARM_LENGTH,
  MAX_RESPONSE_SELECTED_EVIDENCE,
  RESPONSE_ROUTE_STALE_AFTER_DAYS,
  SUPPORTED_CASE_RESPONSE_PACKET_VERSIONS,
} from '../contracts/case-portability.mts';

export {
  LATEST_PUBLIC_CASE_RESPONSE_PACKET_VERSION,
  LATEST_PUBLIC_CASE_RESPONSE_REVIEW_INPUTS_VERSION,
} from '../contracts/case-portability.mts';

export const CASE_RESPONSE_PREFLIGHT_EVIDENCE_SCOPE = Object.freeze({
  version: 1 as const,
  owner: 'case' as const,
  inputs: Object.freeze([
    'incident_fields',
    'evidence_pins',
    'analyst_decisions',
    'analyst_assertions',
    'recipient_routes',
    'case_disposition',
    'case_actions',
  ] as const),
  lookupDecisionFacts: 'unavailable' as const,
  limitation: 'Lookup Decision Facts are transient and are not copied into browser-local cases. Case-response preflight evaluates only explicit case-owned records and analyst-entered incident context; it does not reconstruct Decision Facts from weaker saved fields.',
});

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

export const RESPONSE_PACKET_PROFILES: readonly ResponsePacketProfile[] = Object.freeze([
  {
    id: 'registrar',
    label: 'Registrar review',
    audience: 'Domain registrar abuse or compliance team',
    subjectPrefix: 'Reviewed domain abuse report',
    requiredContactKind: 'registrar',
    checklist: ['Confirm registrar of record', 'Include exact URLs and observation time', 'Review registrant-data necessity before sharing'],
    evidenceOrder: ['Incident facts', 'Registration evidence', 'Selected observations', 'Action history'],
    includedEvidence: ['Exact URLs', 'Observation time', 'Case disposition', 'Selected evidence pins', 'Registrar contact provenance'],
    excludedEvidence: ['Raw WHOIS or RDAP payloads', 'Unselected contacts', 'Provider secrets', 'Unrelated analyst notes'],
    redactions: ['Remove unnecessary personal registration data', 'Credential-bearing URLs are rejected; review query strings and fragments for secrets before sharing'],
    attachments: ['Reviewed response packet', 'Optional normalised case report'],
    followUpFields: ['Registrar reference', 'Acknowledgement time', 'Resolution or transfer outcome'],
  },
  {
    id: 'registry',
    label: 'Registry review',
    audience: 'Domain registry abuse or compliance team',
    subjectPrefix: 'Reviewed registry abuse report',
    requiredContactKind: 'registry',
    checklist: ['Confirm the registry is an appropriate escalation route', 'Include registrar response or reference when available', 'Disclose contradictory evidence'],
    evidenceOrder: ['Incident facts', 'Registry publication', 'Prior escalation', 'Selected observations'],
    includedEvidence: ['Exact URLs', 'Observation time', 'Registry contact provenance', 'Selected evidence pins', 'Prior action references'],
    excludedEvidence: ['Raw registry payloads', 'Unselected contacts', 'Secrets', 'Unsupported ownership claims'],
    redactions: ['Remove unnecessary personal registration data', 'Credential-bearing URLs are rejected; review query strings and fragments for secrets before sharing'],
    attachments: ['Reviewed response packet', 'Optional normalised case report', 'Optional registrar reference'],
    followUpFields: ['Registry reference', 'Registrar referral', 'Delegation or status outcome'],
  },
  {
    id: 'network_hosting',
    label: 'Hosting or network review',
    audience: 'Hosting provider, CDN, network, or infrastructure operator',
    subjectPrefix: 'Reviewed hosted-content abuse report',
    requiredContactKind: 'network_hosting',
    checklist: ['Confirm the observed endpoint and collection time', 'Avoid claiming the observed edge is the origin', 'Include exact affected URLs'],
    evidenceOrder: ['Incident facts', 'Observed endpoint context', 'Selected web evidence', 'Action history'],
    includedEvidence: ['Exact URLs', 'Observation time', 'Selected HTTP, TLS, DNS, or page-identity pins', 'Contact provenance'],
    excludedEvidence: ['Raw response bodies', 'Cookies', 'Secrets', 'Unproven origin-host claims'],
    redactions: ['Credential-bearing URLs are rejected; review query strings, fragments, cookies, and unrelated contacts before sharing'],
    attachments: ['Reviewed response packet', 'Optional normalised case report'],
    followUpFields: ['Provider ticket', 'Content status', 'Infrastructure change outcome'],
  },
  {
    id: 'security_contact',
    label: 'Security contact review',
    audience: 'Published security contact or affected service security team',
    subjectPrefix: 'Reviewed security finding',
    requiredContactKind: 'security_txt',
    checklist: ['Confirm the contact policy covers this report', 'Respect the published communication policy', 'Separate observed facts from hypotheses'],
    evidenceOrder: ['Incident facts', 'Selected observations', 'Analyst reasoning', 'Action history'],
    includedEvidence: ['Exact URLs', 'Observation time', 'Selected evidence pins', 'Contact source and limitations'],
    excludedEvidence: ['Raw upstream payloads', 'Secrets', 'Unselected case notes', 'Legal conclusions'],
    redactions: ['Credential-bearing URLs are rejected; review query strings, fragments, tokens, personal data, and unrelated identifiers before sharing'],
    attachments: ['Reviewed response packet', 'Optional normalised case report'],
    followUpFields: ['Security reference', 'Triage acknowledgement', 'Remediation outcome'],
  },
  {
    id: 'application_platform',
    label: 'Platform report review',
    audience: 'Application-platform safety, impersonation, commerce, or rights team',
    subjectPrefix: 'Reviewed platform report',
    requiredContactKind: 'application_platform',
    checklist: ['Confirm the exact account or content URL', 'Choose the route matching the evidence and reporter authority', 'Review the provider notice before sharing identity or rights-owner details'],
    evidenceOrder: ['Incident facts', 'Exact platform URLs', 'Selected observations', 'Rights or authority evidence', 'Action history'],
    includedEvidence: ['Exact URLs', 'Observation time', 'Selected evidence pins', 'Route provenance and review deadline', 'Relevant rights or authority context'],
    excludedEvidence: ['Raw upstream payloads', 'Secrets', 'Unselected personal data', 'Unsupported policy or legal conclusions'],
    redactions: ['Credential-bearing URLs are rejected; review query strings, fragments, tokens, identity documents, and unrelated personal data before sharing'],
    attachments: ['Reviewed response packet', 'Optional normalised case report'],
    followUpFields: ['Provider reference', 'Acknowledgement time', 'Policy response', 'Independent observed effect'],
  },
  {
    id: 'browser_blocklist',
    label: 'Browser or blocklist review',
    audience: 'Browser-safety, reputation, or blocklist reviewer',
    subjectPrefix: 'Reviewed unsafe-site report',
    requiredContactKind: null,
    checklist: ['Use the recipient submission form or documented route manually', 'Include exact URLs and current observation time', 'Disclose source gaps and false-positive context'],
    evidenceOrder: ['Exact URLs', 'Observed behaviour', 'Selected corroborating evidence', 'Limitations'],
    includedEvidence: ['Exact URLs', 'Observation time', 'Observed harm', 'Selected evidence pins', 'Contradictions and cautions'],
    excludedEvidence: ['Raw provider payloads', 'Secrets', 'Unselected personal data', 'Automated maliciousness claims'],
    redactions: ['Credential-bearing URLs are rejected; review query strings, fragments, tokens, and unrelated contacts before sharing'],
    attachments: ['Reviewed response packet', 'Optional normalised case report'],
    followUpFields: ['Submission reference', 'Review state', 'Listing or delisting outcome'],
  },
  {
    id: 'internal_soc',
    label: 'Internal SOC handoff',
    audience: 'Internal security operations or incident-response team',
    subjectPrefix: 'Reviewed domain investigation handoff',
    requiredContactKind: null,
    checklist: ['Identify the internal owner', 'Separate verified facts, hypotheses, unknowns, and contradictions', 'Record the next reviewed action'],
    evidenceOrder: ['Decision packet', 'Selected evidence', 'Incident facts', 'Action and investigation trail'],
    includedEvidence: ['Case disposition', 'Selected evidence pins', 'Analyst decisions and assertions', 'Action history', 'Exact URLs when relevant'],
    excludedEvidence: ['Raw upstream payloads', 'Secrets', 'Unselected personal data', 'Unsupported attribution'],
    redactions: ['Credential-bearing URLs are rejected; review query strings, fragments, tokens, and unnecessary personal data before sharing'],
    attachments: ['Reviewed response packet', 'Normalised case report when required by internal policy'],
    followUpFields: ['Internal owner', 'Due date', 'Decision', 'Control or escalation outcome'],
  },
]);

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

const RESPONSE_PROFILE_IDS = new Set<string>(RESPONSE_PACKET_PROFILE_IDS);

const CONTROL_RE = /[\u0000-\u001f\u007f]/u;

const CONTROL_REPLACE_RE = /[\u0000-\u001f\u007f]+/gu;

function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(CONTROL_REPLACE_RE, ' ').trim().slice(0, maximum);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function timestamp(value: unknown): string | null {
  return normalizeExplicitIsoTimestamp(value);
}

function normalizeExactUrl(value: unknown, rejectOverlong: boolean): string | null {
  if (typeof value !== 'string' || CONTROL_RE.test(value)) return null;
  const candidate = value.trim();
  if (!candidate) return null;
  if (candidate.length > MAX_EXACT_URL_LENGTH) {
    if (rejectOverlong) throw new Error(`Each exact HTTP(S) URL is limited to ${MAX_EXACT_URL_LENGTH} characters; shorten or remove the overlong URL before continuing.`);
    return null;
  }
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeUrls(value: unknown, rejectOverlong = false): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/\r?\n/u)
      : [];
  const unique = new Set<string>();
  for (const item of source.slice(0, MAX_ABUSIVE_URLS * 2)) {
    const normalized = normalizeExactUrl(item, rejectOverlong);
    if (normalized) unique.add(normalized);
    if (unique.size >= MAX_ABUSIVE_URLS) break;
  }
  return [...unique];
}

function normalizeLimitations(value: unknown): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/\r?\n/u)
      : [];
  const unique = new Set<string>();
  for (const item of source.slice(0, 16)) {
    const normalized = text(item, 240);
    if (normalized) unique.add(normalized);
    if (unique.size >= 8) break;
  }
  return [...unique];
}

function actionContactKind(type: string): ResponseContactKind | 'manual' {
  if (type === 'registrar_report') return 'registrar';
  if (type === 'registry_report') return 'registry';
  if (type === 'network_hosting_report') return 'network_hosting';
  if (type === 'security_contact_report') return 'security_txt';
  if (type === 'platform_report') return 'application_platform';
  return 'manual';
}

function selectedPacketAction(caseRecord: CaseRecord, input: CaseResponsePacketInput) {
  const actionId = typeof input.actionId === 'string' && /^[A-Za-z0-9_-]{1,64}$/u.test(input.actionId)
    ? input.actionId
    : null;
  return actionId ? caseRecord.actions.find((action) => action.id === actionId) ?? null : null;
}

function packetActionLineage(caseRecord: CaseRecord, input: CaseResponsePacketInput) {
  const selected = selectedPacketAction(caseRecord, input);
  if (!selected) return { selected: null, actions: [], ids: [], complete: true } as const;
  const byId = new Map(caseRecord.actions.map((action) => [action.id, action]));
  const ids: string[] = [];
  const seen = new Set<string>();
  let current: typeof selected | undefined = selected;
  while (current && ids.length < MAX_RESPONSE_ACTION_HISTORY && !seen.has(current.id)) {
    ids.push(current.id);
    seen.add(current.id);
    current = current.originActionId ? byId.get(current.originActionId) : undefined;
  }
  const complete = !current;
  return {
    selected,
    actions: ids.map((id) => byId.get(id)!).filter(Boolean),
    ids,
    complete,
  } as const;
}

function bindPacketRoute(
  caseRecord: CaseRecord,
  input: CaseResponsePacketInput,
  generatedAt: string,
): Readonly<{
  actionBinding: CaseResponsePacket['actionBinding'];
  recipientRoute: CaseResponsePacket['recipientRoute'];
  contacts: CaseResponsePacket['contacts'];
}> {
  const profile = responsePacketProfile(input.profile);
  const lineage = packetActionLineage(caseRecord, input);
  const action = lineage.selected;
  if (!action) {
    return {
      actionBinding: {
        state: 'not_selected', selectedActionId: null, lineageActionIds: [],
        limitations: ['No retained Case action is selected for this packet.'],
      },
      recipientRoute: null,
      contacts: [],
    };
  }
  const kind = actionContactKind(action.type);
  const compatible = profile.requiredContactKind
    ? kind === profile.requiredContactKind
    : profile.id === 'browser_blocklist'
      ? kind === 'manual'
      : true;
  if (!compatible) {
    return {
      actionBinding: {
        state: 'selected', selectedActionId: action.id, lineageActionIds: [...lineage.ids],
        limitations: [`The selected action does not match the ${profile.label.toLowerCase()} route requirement.`],
      },
      recipientRoute: null,
      contacts: [],
    };
  }
  const observedAt = timestamp(action.routeObservedAt);
  const reviewAfter = timestamp(action.routeReviewAfter);
  const recipientRoute: NonNullable<CaseResponsePacket['recipientRoute']> = {
    actionId: action.id,
    kind,
    contact: text(action.recipient, 320),
    source: text(action.contactSource, 120) || 'analyst supplied',
    observedAt,
    reviewAfter,
    freshness: responseRouteFreshness(observedAt, reviewAfter, generatedAt),
    limitations: normalizeLimitations(action.contactLimitations),
  };
  const contacts: CaseResponsePacket['contacts'] = kind === 'manual' ? [] : [{
    kind,
    contact: recipientRoute.contact,
    source: recipientRoute.source,
    observedAt,
    reviewAfter,
    freshness: recipientRoute.freshness,
    limitations: [...recipientRoute.limitations],
  }];
  return {
    actionBinding: {
      state: 'selected', selectedActionId: action.id, lineageActionIds: [...lineage.ids],
      limitations: lineage.complete ? [] : ['The origin-action lineage exceeded the packet action bound or contained a cycle.'],
    },
    recipientRoute,
    contacts,
  };
}

function normalizeSelectedEvidence(caseRecord: CaseRecord, value: unknown): CaseResponsePacket['selectedEvidence'] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  for (const candidate of value.slice(0, MAX_RESPONSE_SELECTED_EVIDENCE * 2)) {
    if (typeof candidate === 'string' && /^[A-Za-z0-9_-]{1,64}$/u.test(candidate)) ids.add(candidate);
    if (ids.size >= MAX_RESPONSE_SELECTED_EVIDENCE) break;
  }
  return caseRecord.evidencePins
    .filter((pin) => ids.has(pin.id))
    .slice(0, MAX_RESPONSE_SELECTED_EVIDENCE)
    .map((pin) => ({
      id: pin.id,
      label: text(pin.label, 80),
      source: text(pin.source, 120),
      ...(pin.observationHostname ? { observationHostname: pin.observationHostname } : {}),
      observedAt: timestamp(pin.observedAt),
      completeness: text(pin.completeness, 40),
      limitations: normalizeLimitations(pin.limitations),
    }));
}

function normalizeContradictions(caseRecord: CaseRecord): CaseResponsePacket['contradictions'] {
  return caseRecord.assertions
    .filter((assertion) => assertion.kind === 'contradiction')
    .slice(-MAX_RESPONSE_CONTRADICTIONS)
    .map((assertion) => ({
      id: assertion.id,
      statement: text(assertion.statement, 2_000),
      state: text(assertion.state, 40),
      limitations: normalizeLimitations(assertion.rationale ? [assertion.rationale] : []),
    }));
}

function readinessOverride(value: unknown, key: keyof ResponseReadinessInput): Readonly<{
  state: ResponseReadinessState;
  detail: string;
  limitations: string[];
}> | null {
  const root = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const candidate = root[key];
  const item = candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? candidate as Record<string, unknown>
    : {};
  if (typeof item.state !== 'string' || !(RESPONSE_READINESS_STATES as readonly string[]).includes(item.state)) return null;
  const detail = text(item.detail, 500);
  if (!detail && !['unavailable', 'not_provided'].includes(item.state)) return null;
  return {
    state: item.state as ResponseReadinessState,
    detail,
    limitations: normalizeLimitations(item.limitations),
  };
}

function buildResponseReadiness(
  input: CaseResponsePacketInput,
  generatedAt: string,
  contacts: CaseResponsePacket['contacts'],
  recipientRoute: CaseResponsePacket['recipientRoute'],
  selectedEvidence: CaseResponsePacket['selectedEvidence'],
  contradictions: CaseResponsePacket['contradictions'],
): CaseResponsePacket['readiness'] {
  const profile = responsePacketProfile(input.profile);
  const urls = normalizeUrls(input.abusiveUrls);
  const observedAt = timestamp(input.observedAt);
  const age = observedAt ? observationAge(observedAt, generatedAt) : null;
  const infrastructure = readinessOverride(input.readiness, 'infrastructureResponsibility');
  const authority = readinessOverride(input.readiness, 'authorityReview');
  const contradictionReview = readinessOverride(input.readiness, 'contradictionsReview');
  const sourceLimits = readinessOverride(input.readiness, 'sourceLimitations');
  const external = profile.id !== 'internal_soc';
  const responsibilityRequired = ['registrar', 'registry', 'network_hosting'].includes(profile.id);
  const rows: CaseResponseReadinessRow[] = [
    {
      id: 'observed_behaviour', label: 'Observed behaviour',
      state: text(input.observedHarm, MAX_RESPONSE_HARM_LENGTH) ? 'complete' : 'not_provided',
      detail: text(input.observedHarm, MAX_RESPONSE_HARM_LENGTH) ? 'A bounded observed-behaviour description is present.' : 'No observed-behaviour description is present.',
      requiredForAuthorisation: true, limitations: [],
    },
    {
      id: 'exact_url', label: 'Exact URL',
      state: urls.length ? 'complete' : 'not_provided',
      detail: urls.length ? `${urls.length} exact HTTP(S) URL${urls.length === 1 ? ' is' : 's are'} selected.` : 'No exact HTTP(S) URL is selected.',
      requiredForAuthorisation: true, limitations: [],
    },
    {
      id: 'observation_time', label: 'Observation time',
      state: !observedAt ? 'not_provided' : age?.refreshRecommended ? 'stale' : 'complete',
      detail: !observedAt ? 'No observation time is available.' : age?.refreshRecommended ? `The observation is ${age.band.replaceAll('_', ' ')}.` : `The observation is ${age?.band.replaceAll('_', ' ')}.`,
      requiredForAuthorisation: true,
      limitations: age?.refreshRecommended ? ['Freshness requires deliberate analyst review before external use.'] : [],
    },
    {
      id: 'capture_provenance', label: 'Capture provenance',
      state: !selectedEvidence.length ? 'unavailable' : selectedEvidence.every((item) => item.source && item.observedAt) ? 'complete' : 'partial',
      detail: !selectedEvidence.length ? 'No selected evidence is available for capture-provenance review.'
        : selectedEvidence.every((item) => item.source && item.observedAt)
          ? 'Selected evidence retains source and observation metadata.'
          : 'Selected evidence is retained, but some source or observation-time metadata is unavailable.',
      requiredForAuthorisation: true,
      limitations: selectedEvidence.flatMap((item) => item.limitations).slice(0, 8),
    },
    {
      id: 'infrastructure_responsibility', label: 'Infrastructure-responsibility evidence',
      state: infrastructure?.state ?? 'not_provided',
      detail: infrastructure?.detail || 'Responsibility has not been asserted from retained evidence.',
      requiredForAuthorisation: responsibilityRequired,
      limitations: infrastructure?.limitations ?? ['Observed infrastructure does not by itself prove provider responsibility, ownership, or control.'],
    },
    {
      id: 'recipient_route', label: 'Recipient-route provenance and freshness',
      state: !recipientRoute ? 'not_provided' : recipientRoute.freshness === 'stale' ? 'stale' : recipientRoute.freshness === 'current' && recipientRoute.source ? 'complete' : 'partial',
      detail: !recipientRoute ? 'No profile-appropriate recipient route is selected.' : `The selected route provenance is ${recipientRoute.source}; freshness is ${recipientRoute.freshness}.`,
      requiredForAuthorisation: external,
      limitations: recipientRoute?.limitations ?? [],
    },
    {
      id: 'authority_review', label: 'Authority review',
      state: authority?.state ?? 'not_provided',
      detail: authority?.detail || 'Analyst authority has not been recorded for this exact response scope.',
      requiredForAuthorisation: true,
      limitations: authority?.limitations ?? [],
    },
    {
      id: 'selected_evidence', label: 'Selected evidence',
      state: !selectedEvidence.length ? 'not_provided' : selectedEvidence.every((item) => item.completeness === 'complete') ? 'complete' : 'partial',
      detail: selectedEvidence.length ? `${selectedEvidence.length} evidence pin${selectedEvidence.length === 1 ? ' is' : 's are'} explicitly selected.` : 'No evidence pin is explicitly selected.',
      requiredForAuthorisation: true,
      limitations: selectedEvidence.flatMap((item) => item.limitations).slice(0, 8),
    },
    {
      id: 'contradictions', label: 'Contradictions',
      state: contradictions.some((item) => item.state === 'open')
        ? 'partial'
        : contradictions.length ? 'complete' : contradictionReview?.state ?? 'not_provided',
      detail: contradictions.some((item) => item.state === 'open')
        ? 'Open contradictions remain and must be disclosed or resolved.'
        : contradictions.length
          ? 'Every retained contradiction assertion is resolved.'
          : contradictionReview?.detail || 'No explicit contradiction review is retained for this exact packet.',
      requiredForAuthorisation: true,
      limitations: contradictions.length
        ? contradictions.filter((item) => item.state === 'open').flatMap((item) => item.limitations).slice(0, 8)
        : contradictionReview?.limitations ?? ['The absence of a retained contradiction assertion does not establish that contradictory evidence was reviewed or absent.'],
    },
    {
      id: 'source_limitations', label: 'Source limitations',
      state: sourceLimits?.state ?? (selectedEvidence.some((item) => item.limitations.length) || contacts.some((contact) => contact.limitations.length) ? 'partial' : 'not_provided'),
      detail: sourceLimits?.detail || (selectedEvidence.some((item) => item.limitations.length) || contacts.some((contact) => contact.limitations.length) ? 'Source limitations are retained for review.' : 'No additional source limitation was supplied.'),
      requiredForAuthorisation: true,
      limitations: sourceLimits?.limitations ?? [...selectedEvidence.flatMap((item) => item.limitations), ...contacts.flatMap((contact) => contact.limitations)].slice(0, 8),
    },
  ];
  const counts = Object.fromEntries(RESPONSE_READINESS_STATES.map((state) => [state, rows.filter((row) => row.state === state).length])) as Record<ResponseReadinessState, number>;
  return {
    profileId: profile.id,
    rows,
    counts,
    limitations: [
      'Readiness describes the exact local draft inputs. It does not authorise or submit a response and does not promise a provider outcome.',
      'Partial, stale, unavailable, and not-provided rows remain explicit and never become completeness by inference.',
    ],
  };
}

export function buildCaseResponseReadiness(
  caseRecord: CaseRecord,
  input: CaseResponsePacketInput,
  generatedAt: string = new Date().toISOString(),
): CaseResponsePacket['readiness'] {
  const normalizedGeneratedAt = timestamp(generatedAt) || new Date().toISOString();
  const binding = bindPacketRoute(caseRecord, input, normalizedGeneratedAt);
  const selectedEvidence = normalizeSelectedEvidence(caseRecord, input.selectedEvidencePinIds);
  return buildResponseReadiness(
    input,
    normalizedGeneratedAt,
    binding.contacts,
    binding.recipientRoute,
    selectedEvidence,
    normalizeContradictions(caseRecord),
  );
}

function normalizeArtefactReferences(value: unknown): CaseResponsePacket['artefactReferences'] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, CaseResponsePacket['artefactReferences'][number]>();
  for (const candidate of value.slice(0, MAX_RESPONSE_ARTEFACT_REFERENCES * 2)) {
    const item = candidate && typeof candidate === 'object' && !Array.isArray(candidate)
      ? candidate as Record<string, unknown>
      : {};
    const label = text(item.label, 120);
    const mediaType = text(item.mediaType, 120).toLowerCase();
    const capturedAt = timestamp(item.capturedAt);
    const source = text(item.source, 120);
    const digestSha256 = text(item.digestSha256, 64).toLowerCase();
    if (!label || !mediaType || !capturedAt || !source || !/^[a-f0-9]{64}$/u.test(digestSha256)) continue;
    const id = typeof item.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/u.test(item.id)
      ? item.id
      : `artefact-${digestSha256.slice(0, 20)}`;
    const byteLength = typeof item.byteLength === 'number' && Number.isSafeInteger(item.byteLength) && item.byteLength >= 0 && item.byteLength <= 100 * 1024 * 1024
      ? item.byteLength
      : null;
    const normalized = { id, label, mediaType, capturedAt, source, digestSha256, byteLength, limitations: normalizeLimitations(item.limitations) };
    const existing = byId.get(id);
    if (!existing || JSON.stringify(normalized) < JSON.stringify(existing)) byId.set(id, normalized);
  }
  return [...byId.values()]
    .sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt) || compareCodeUnits(left.id, right.id))
    .slice(0, MAX_RESPONSE_ARTEFACT_REFERENCES);
}

function normalizeConfirmations(value: unknown): Record<ResponseAuthorisationConfirmationId, boolean> {
  const item = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return Object.fromEntries(RESPONSE_AUTHORISATION_CONFIRMATION_IDS.map((id) => [id, item[id] === true])) as Record<ResponseAuthorisationConfirmationId, boolean>;
}

export function responsePacketProfile(value: unknown): ResponsePacketProfile {
  const id = typeof value === 'string' && RESPONSE_PROFILE_IDS.has(value)
    ? value as ResponsePacketProfileId
    : 'internal_soc';
  return RESPONSE_PACKET_PROFILES.find((profile) => profile.id === id) ?? RESPONSE_PACKET_PROFILES.at(-1)!;
}

export function buildResponsePacketProfilePreview(
  caseRecord: CaseRecord,
  input: CaseResponsePacketInput,
): CaseResponsePacket['profile'] & { missingEvidence: string[] } {
  const profile = responsePacketProfile(input.profile);
  const binding = bindPacketRoute(caseRecord, input, caseRecord.updatedAt);
  const missingEvidence = [
    ...(!normalizeUrls(input.abusiveUrls).length ? ['At least one exact HTTP(S) URL'] : []),
    ...(!timestamp(input.observedAt) ? ['Observation time'] : []),
    ...(!normalizeSelectedEvidence(caseRecord, input.selectedEvidencePinIds).length ? ['Explicitly selected evidence pin'] : []),
    ...(profile.id !== 'internal_soc' && binding.actionBinding.state !== 'selected'
      ? ['Selected retained Case action']
      : []),
    ...(profile.id !== 'internal_soc' && !binding.recipientRoute
      ? [`${profile.requiredContactKind ? contactLabel(profile.requiredContactKind) : 'Manual submission'} contact route`]
      : []),
  ];
  const category = text(input.category, MAX_ABUSE_CATEGORY_LENGTH) || 'domain activity';
  return {
    id: profile.id,
    label: profile.label,
    audience: profile.audience,
    subject: `${profile.subjectPrefix}: ${caseRecord.domain} (${category})`,
    checklist: [...profile.checklist],
    evidenceOrder: [...profile.evidenceOrder],
    includedEvidence: [...profile.includedEvidence],
    excludedEvidence: [...profile.excludedEvidence],
    redactions: [...profile.redactions],
    attachments: [...profile.attachments],
    followUpFields: [...profile.followUpFields],
    missingEvidence,
  };
}

export function buildCaseResponsePreflight(
  caseRecord: CaseRecord,
  input: CaseResponsePacketInput,
  generatedAt: string = new Date().toISOString(),
): CaseResponsePreflight {
  const observedAt = timestamp(input.observedAt);
  const normalizedGeneratedAt = timestamp(generatedAt) || new Date().toISOString();
  const binding = bindPacketRoute(caseRecord, input, normalizedGeneratedAt);
  const urls = normalizeUrls(input.abusiveUrls);
  const selectedEvidence = normalizeSelectedEvidence(caseRecord, input.selectedEvidencePinIds);
  const requiredComplete = Boolean(
    text(input.category, MAX_ABUSE_CATEGORY_LENGTH)
    && text(input.affectedParty, MAX_AFFECTED_PARTY_LENGTH)
    && urls.length
    && text(input.observedHarm, MAX_RESPONSE_HARM_LENGTH)
    && observedAt,
  );
  const age = observedAt ? observationAge(observedAt, normalizedGeneratedAt) : null;
  const openContradictions = caseRecord.assertions
    .filter((item) => item.kind === 'contradiction' && item.state === 'open')
    .length;
  const actionSummary = buildCaseActionOutcomeSummary(caseRecord.actions, normalizedGeneratedAt);
  const retainedPinIds = new Set(caseRecord.evidencePins.map((pin) => pin.id));
  const evidenceLinkedDecisionCount = caseRecord.decisions.filter((decision) =>
    decision.evidencePinIds.some((evidencePinId) => retainedPinIds.has(evidencePinId))).length;
  const responseDisposition = caseDispositionSupportsDefensiveResponse(caseRecord.disposition);
  const reviewedActionCount = caseRecord.actions.filter((action) =>
    ['reviewed', 'authorised', 'submitted', 'acknowledged', 'terminal'].includes(action.state)).length;
  const profile = responsePacketProfile(input.profile);
  const checks: CaseResponsePreflightCheck[] = [
    {
      id: 'required_incident_fields',
      label: 'Incident facts',
      state: requiredComplete ? 'pass' : 'block',
      detail: requiredComplete
        ? `${urls.length} exact HTTP(S) URL${urls.length === 1 ? '' : 's'} and the required incident context are present.`
        : 'Category, affected party, an exact HTTP(S) URL, observed harm, and observation time are required.',
    },
    {
      id: 'evidence_pins',
      label: 'Selected evidence',
      state: selectedEvidence.length ? 'pass' : 'caution',
      detail: selectedEvidence.length
        ? `${selectedEvidence.length} explicitly selected evidence pin${selectedEvidence.length === 1 ? '' : 's'} will remain separately attributable.`
        : 'No evidence pin is selected for this exact draft; export remains a draft with a caution.',
    },
    {
      id: 'analyst_decision',
      label: 'Analyst decision',
      state: evidenceLinkedDecisionCount ? 'pass' : 'caution',
      detail: evidenceLinkedDecisionCount
        ? `${evidenceLinkedDecisionCount} analyst decision${evidenceLinkedDecisionCount === 1 ? '' : 's'} cite retained evidence and record the escalation rationale.`
        : caseRecord.decisions.length
          ? 'Analyst decisions are recorded, but none cites a retained evidence pin.'
          : 'No explicit analyst decision explains why external reporting is appropriate.',
    },
    {
      id: 'recipient_route',
      label: 'Recipient route',
      state: binding.recipientRoute ? 'pass' : profile.id === 'internal_soc' ? 'caution' : 'block',
      detail: binding.recipientRoute
        ? `The selected ${contactLabel(binding.recipientRoute.kind)} route is bound to action ${binding.recipientRoute.actionId}.`
        : 'No contact route is included; identify and review the intended recipient before sending.',
    },
    {
      id: 'profile_recipient',
      label: 'Audience-specific recipient',
      state: profile.id === 'internal_soc'
        ? 'pass'
        : binding.recipientRoute ? 'pass' : 'block',
      detail: profile.requiredContactKind
        ? binding.recipientRoute?.kind === profile.requiredContactKind
          ? `The ${contactLabel(profile.requiredContactKind)} route required by the ${profile.label.toLowerCase()} is present.`
          : `The ${profile.label.toLowerCase()} expects a separately attributed ${contactLabel(profile.requiredContactKind)} route.`
        : profile.id === 'browser_blocklist'
          ? binding.recipientRoute
            ? 'A manually reviewed submission destination is bound to the selected Case action.'
            : 'The browser or blocklist profile requires a manually reviewed submission destination recorded as a Case action.'
          : `${profile.label} has no fixed external contact-kind requirement.`,
    },
    // Packet v9 retains its established machine-token wording for immutable
    // fixture compatibility; interactive Case surfaces use the canonical label.
    {
      id: 'case_disposition',
      label: 'Case disposition',
      state: responseDisposition && caseRecord.reviewReasonCode && evidenceLinkedDecisionCount ? 'pass' : 'caution',
      detail: responseDisposition && caseRecord.reviewReasonCode && evidenceLinkedDecisionCount
        ? `The case disposition is ${caseRecord.disposition.replaceAll('_', ' ')} with the reviewed reason ${caseRecord.reviewReasonCode.replaceAll('_', ' ')} and an evidence-linked decision.`
        : !responseDisposition
          ? `The case disposition is ${caseRecord.disposition.replaceAll('_', ' ')}; confirm it before external use.`
          : !caseRecord.reviewReasonCode
            ? `The case disposition is ${caseRecord.disposition.replaceAll('_', ' ')}, but no reviewed reason is recorded.`
            : 'The case disposition and reason are recorded, but no analyst decision cites retained evidence.',
    },
    {
      id: 'evidence_freshness',
      label: 'Evidence freshness',
      state: age?.refreshRecommended ? 'caution' : observedAt ? 'pass' : 'block',
      detail: age
        ? age.refreshRecommended
          ? `The selected observation is ${age.band.replaceAll('_', ' ')} and should be refreshed before submission.`
          : `The selected observation is ${age.band.replaceAll('_', ' ')}.`
        : 'A valid observation time is required.',
    },
    {
      id: 'contradictory_evidence',
      label: 'Contradictory evidence',
      state: openContradictions ? 'caution' : 'pass',
      detail: openContradictions
        ? `${openContradictions} open contradiction${openContradictions === 1 ? '' : 's'} should be addressed or disclosed.`
        : 'No open contradictory-evidence assertion is recorded.',
    },
    {
      id: 'packet_action',
      label: 'Packet action',
      state: binding.actionBinding.state === 'selected' ? 'pass' : profile.id === 'internal_soc' ? 'caution' : 'block',
      detail: binding.actionBinding.state === 'selected'
        ? `Action ${binding.actionBinding.selectedActionId} owns this packet and its retained origin lineage.`
        : 'Select the retained Case action this packet prepares or documents.',
    },
    {
      id: 'action_tracking',
      label: 'Action tracking',
      state: reviewedActionCount ? 'pass' : 'caution',
      detail: reviewedActionCount
        ? `${reviewedActionCount} reviewed or later-stage action${reviewedActionCount === 1 ? ' is' : 's are'} tracked; ${actionSummary.overdue} overdue and ${actionSummary.followUpDue} due for follow-up.`
        : actionSummary.total
          ? `${actionSummary.total} action${actionSummary.total === 1 ? ' remains' : 's remain'} before reviewed state.`
          : 'No reviewed case action is recorded for ownership, submission, or follow-up.',
    },
  ];
  const counts = {
    block: checks.filter((item) => item.state === 'block').length,
    caution: checks.filter((item) => item.state === 'caution').length,
    pass: checks.filter((item) => item.state === 'pass').length,
  };
  return {
    version: 3,
    status: counts.block ? 'needs_input' : counts.caution ? 'review_cautions' : 'ready_for_review',
    canExport: counts.block === 0,
    counts,
    checks,
    actionSummary,
  };
}

function normalizeActionHistory(caseRecord: CaseRecord, input: CaseResponsePacketInput): Readonly<{
  actions: CaseResponsePacket['escalationHistory'];
  omitted: number;
  limitations: string[];
  actionBinding: CaseResponsePacket['actionBinding'];
  lineageComplete: boolean;
}> {
  const lineage = packetActionLineage(caseRecord, input);
  const omitted = Math.max(0, caseRecord.actions.length - lineage.actions.length);
  return {
    actions: lineage.actions
    .map((action) => ({
      actionId: action.id,
      type: text(action.type, 80),
      recipient: text(action.recipient, 320),
      contactSource: text(action.contactSource, 120),
      routeObservedAt: timestamp(action.routeObservedAt),
      routeReviewAfter: timestamp(action.routeReviewAfter),
      state: text(action.state, 80),
      reference: text(action.reference, 500) || null,
      providerOutcome: text(action.providerOutcome, 80) || null,
      outcomeDetail: text(action.outcome, 2000) || null,
      originActionId: text(action.originActionId, 64) || null,
      historyOmitted: action.historyOmitted,
      historyLimitations: normalizeLimitations(action.historyLimitations),
      transitions: action.history.map((event) => ({
        id: event.id,
        previousState: event.previousState,
        nextState: event.nextState,
        occurredAt: event.occurredAt,
        sourceClass: event.sourceClass,
        provenance: event.provenance,
        reference: event.reference,
        evidencePinId: event.evidencePinId,
        limitations: [...event.limitations],
        providerOutcome: event.providerOutcome,
        outcomeDetail: event.outcomeDetail,
        originActionId: event.originActionId,
        applied: event.applied,
      })),
      createdAt: timestamp(action.createdAt) ?? caseRecord.createdAt,
      updatedAt: timestamp(action.updatedAt) ?? caseRecord.updatedAt,
    })),
    omitted,
    limitations: [
      ...(omitted ? [`${omitted} Case response action${omitted === 1 ? '' : 's'} outside the retained selected-action lineage ${omitted === 1 ? 'was' : 'were'} excluded from this packet.`] : []),
      ...(!lineage.complete ? ['The selected action origin lineage exceeded the packet bound or contained a cycle; provider-outcome time is withheld.'] : []),
    ],
    actionBinding: lineage.selected ? {
      state: 'selected',
      selectedActionId: lineage.selected.id,
      lineageActionIds: [...lineage.ids],
      limitations: lineage.complete ? [] : ['The origin-action lineage is incomplete.'],
    } : {
      state: 'not_selected', selectedActionId: null, lineageActionIds: [],
      limitations: ['No retained Case action is selected for this packet.'],
    },
    lineageComplete: lineage.complete,
  };
}

function normalizeResponseLifecycle(
  caseRecord: CaseRecord,
  actionIds: readonly string[],
  lineageComplete: boolean,
): CaseResponsePacket['responseLifecycle'] {
  const scopedIds = new Set(actionIds);
  const scopedRecord = {
    ...caseRecord,
    actions: caseRecord.actions.filter((action) => scopedIds.has(action.id)),
    closures: {
      ...caseRecord.closures,
      records: caseRecord.closures.records.filter((closure) => closure.actionId !== null && scopedIds.has(closure.actionId)),
    },
  };
  const summary = buildCaseResponseLifecycleSummary(scopedRecord);
  const providerOutcomeState = lineageComplete ? summary.providerOutcomeState : 'ambiguous';
  return {
    providerOutcomeState,
    latestProviderOutcome: lineageComplete && summary.latestProviderOutcome ? { ...summary.latestProviderOutcome } : null,
    observedChangeState: summary.observedChangeState,
    latestObservedEffect: summary.latestObservedEffect ? { ...summary.latestObservedEffect } : null,
    latestObservedChangeAt: summary.latestObservedChangeAt,
    closure: summary.latestClosure ? {
      id: summary.latestClosure.id,
      reason: summary.latestClosure.reason,
      createdAt: summary.latestClosure.createdAt,
      limitations: [...summary.latestClosure.limitations],
    } : null,
    limitations: [
      'Provider workflow outcomes and independently observed technical effects are separate point-in-time records.',
      'A provider acknowledgement, terminal state, or reported resolution never becomes independently observed remediation, absence, or safety.',
      'Times are withheld when the corresponding typed event is missing or ambiguous.',
      ...(!summary.latestObservedEffect && scopedRecord.observedEffects.reviews.length ? ['A single latest independent review cannot be selected from the retained observation times; all retained reviews remain separately attributed.'] : []),
      ...(!lineageComplete ? ['Provider-outcome time is withheld because the selected action origin lineage is incomplete.'] : []),
    ],
  };
}

function observationAge(observedAt: string, generatedAt: string): CaseResponsePacket['provenance']['observationAge'] {
  const ageSeconds = Math.floor((Date.parse(generatedAt) - Date.parse(observedAt)) / 1000);
  if (ageSeconds < -300) {
    return { ageSeconds, band: 'future_or_clock_skew', refreshRecommended: true };
  }
  if (ageSeconds < 86_400) {
    return { ageSeconds: Math.max(0, ageSeconds), band: 'under_24_hours', refreshRecommended: false };
  }
  if (ageSeconds <= 604_800) {
    return { ageSeconds, band: 'one_to_seven_days', refreshRecommended: false };
  }
  return { ageSeconds, band: 'over_seven_days', refreshRecommended: true };
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function buildCaseResponseReviewInputs(
  caseRecord: CaseRecord,
  input: CaseResponsePacketInput,
  generatedAt: string,
) {
  const profile = buildResponsePacketProfilePreview(caseRecord, input);
  const category = text(input.category, MAX_ABUSE_CATEGORY_LENGTH);
  const selectedEvidence = normalizeSelectedEvidence(caseRecord, input.selectedEvidencePinIds);
  const contradictions = normalizeContradictions(caseRecord);
  const binding = bindPacketRoute(caseRecord, input, generatedAt);
  const readiness = buildResponseReadiness(input, generatedAt, binding.contacts, binding.recipientRoute, selectedEvidence, contradictions);
  const escalation = normalizeActionHistory(caseRecord, input);
  return {
    contract: CASE_RESPONSE_REVIEW_INPUTS_SCHEMA,
    version: CASE_RESPONSE_REVIEW_INPUTS_VERSION,
    profile: {
      id: profile.id,
      label: profile.label,
      audience: profile.audience,
      subject: profile.subject,
      checklist: profile.checklist,
      includedEvidence: profile.includedEvidence,
      excludedEvidence: profile.excludedEvidence,
      redactions: profile.redactions,
    },
    case: {
      id: caseRecord.id,
      domain: caseRecord.domain,
      status: caseRecord.status,
      disposition: caseRecord.disposition,
      updatedAt: caseRecord.updatedAt,
    },
    incident: {
      category,
      affectedParty: text(input.affectedParty, MAX_AFFECTED_PARTY_LENGTH),
      abusiveUrls: normalizeUrls(input.abusiveUrls, true),
      observedHarm: text(input.observedHarm, MAX_RESPONSE_HARM_LENGTH),
      observedAt: timestamp(input.observedAt),
    },
    contacts: binding.contacts,
    recipientRoute: binding.recipientRoute,
    actionBinding: escalation.actionBinding,
    selectedEvidence,
    contradictions,
    readiness,
    artefactReferences: normalizeArtefactReferences(input.artefactReferences),
    escalationHistory: escalation.actions,
    escalationHistoryOmitted: escalation.omitted,
    escalationHistoryLimitations: escalation.limitations,
    responseLifecycle: normalizeResponseLifecycle(caseRecord, escalation.actionBinding.lineageActionIds, escalation.lineageComplete),
  };
}

export async function buildCaseResponseReviewDigest(
  caseRecord: CaseRecord,
  input: CaseResponsePacketInput,
  generatedAt: string = new Date().toISOString(),
): Promise<string> {
  const normalizedGeneratedAt = timestamp(generatedAt) || new Date().toISOString();
  return sha256(canonicalArtifactJsonV2(validateCaseResponseReviewInputs(
    buildCaseResponseReviewInputs(caseRecord, input, normalizedGeneratedAt),
  )));
}

function buildResponseAuthorisation(
  input: CaseResponsePacketInput,
  reviewedInputDigestSha256: string,
  readiness: CaseResponsePacket['readiness'],
  generatedAt: string,
): CaseResponseAuthorisation {
  const root = input.authorisation && typeof input.authorisation === 'object' && !Array.isArray(input.authorisation)
    ? input.authorisation as Record<string, unknown>
    : {};
  const suppliedReviewDigestSha256 = typeof root.reviewedInputDigestSha256 === 'string'
    && /^[a-f0-9]{64}$/u.test(root.reviewedInputDigestSha256)
    ? root.reviewedInputDigestSha256
    : null;
  const confirmations = normalizeConfirmations(root.confirmations);
  const missingConfirmations = RESPONSE_AUTHORISATION_CONFIRMATION_IDS.filter((id) => !confirmations[id]);
  const digestMatches = suppliedReviewDigestSha256 === reviewedInputDigestSha256;
  const suppliedConfirmedAt = timestamp(root.confirmedAt);
  const confirmedAt = suppliedConfirmedAt
    && Date.parse(suppliedConfirmedAt) <= Date.parse(generatedAt) + MAX_RESPONSE_AUTHORISATION_CLOCK_SKEW_MS
    ? suppliedConfirmedAt
    : null;
  const missingRequiredInputs = readiness.rows.filter((row) => row.requiredForAuthorisation
    && (row.state === 'not_provided' || row.state === 'unavailable'));
  const authorityReady = readiness.rows.find((row) => row.id === 'authority_review')?.state === 'complete';
  const authorised = digestMatches && Boolean(confirmedAt) && !missingConfirmations.length && !missingRequiredInputs.length && authorityReady;
  return {
    status: authorised ? 'authorised' : 'draft',
    reviewedInputDigestSha256,
    suppliedReviewDigestSha256,
    digestMatches,
    confirmedAt: authorised ? confirmedAt : null,
    confirmations,
    missingConfirmations,
    limitations: [
      authorised
        ? 'These confirmations apply only to the canonical reviewed-input digest in this packet. They do not submit the packet or promise any recipient or provider outcome.'
        : 'This is a draft. It is not authorised for external use by WHOISleuth.',
      ...(!digestMatches && suppliedReviewDigestSha256 ? ['Material inputs changed after review; the supplied authorisation digest is stale.'] : []),
      ...(!suppliedReviewDigestSha256 ? ['No exact reviewed-input digest is bound to the confirmations.'] : []),
      ...(!confirmedAt ? ['No valid confirmation time is bound to the reviewed inputs.'] : []),
      ...(missingRequiredInputs.length ? [`${missingRequiredInputs.length} required readiness row${missingRequiredInputs.length === 1 ? ' is' : 's are'} unavailable or not provided.`] : []),
      ...(!authorityReady ? ['Authority review must be complete before this packet can be authorised.'] : []),
    ],
  };
}

export async function verifyCaseResponsePacketIntegrity(packet: unknown): Promise<boolean> {
  try {
    assertBoundedJsonStructure(packet, 'Case-response packet');
  } catch {
    return false;
  }
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) return false;
  const root = packet as Record<string, unknown>;
  const integrityValue = root.integrity;
  if (!integrityValue || typeof integrityValue !== 'object' || Array.isArray(integrityValue)) return false;
  const integrity = integrityValue as Record<string, unknown>;
  const { integrity: _integrity, ...unsigned } = root;
  if (
    !SUPPORTED_CASE_RESPONSE_PACKET_VERSIONS.includes(root.schemaVersion as typeof SUPPORTED_CASE_RESPONSE_PACKET_VERSIONS[number])
    || integrity.algorithm !== 'SHA-256'
    || integrity.canonicalization !== SORTED_JSON_V2
    || integrity.scope !== 'packet excluding integrity'
    || typeof integrity.digestSha256 !== 'string'
    || !/^[a-f0-9]{64}$/u.test(integrity.digestSha256)
  ) {
    return false;
  }
  return integrity.digestSha256 === await sha256(canonicalArtifactJsonV2(unsigned));
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_[\]<>|])/gu, '\\$1').replace(/\r?\n/gu, ' ');
}

function contactLabel(value: ResponseContactKind | 'manual'): string {
  if (value === 'network_hosting') return 'Observed endpoint network registration';
  if (value === 'security_txt') return 'security.txt';
  if (value === 'application_platform') return 'Application platform';
  if (value === 'manual') return 'Manual submission';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export async function buildCaseResponsePacket(
  caseRecord: CaseRecord,
  input: CaseResponsePacketInput,
  generatedAt: string = new Date().toISOString(),
): Promise<{ json: CaseResponsePacket; markdown: string; email: string }> {
  const category = text(input.category, MAX_ABUSE_CATEGORY_LENGTH);
  const affectedParty = text(input.affectedParty, MAX_AFFECTED_PARTY_LENGTH);
  const abusiveUrls = normalizeUrls(input.abusiveUrls, true);
  const observedHarm = text(input.observedHarm, MAX_RESPONSE_HARM_LENGTH);
  const latestEvidence = latestCaseEvidence(caseRecord);
  const observedAt = timestamp(input.observedAt);
  if (!category || !affectedParty || !abusiveUrls.length || !observedHarm || !observedAt) {
    throw new Error('Category, affected party, at least one exact HTTP(S) URL, observed harm, and an observation time are required.');
  }
  const normalizedGeneratedAt = timestamp(generatedAt) || new Date().toISOString();
  const reviewMaterial = buildCaseResponseReviewInputs(caseRecord, input, normalizedGeneratedAt);
  const contacts = reviewMaterial.contacts;
  const recipientRoute = reviewMaterial.recipientRoute;
  const actionBinding = reviewMaterial.actionBinding;
  const selectedEvidence = reviewMaterial.selectedEvidence;
  const contradictions = reviewMaterial.contradictions;
  const readiness = reviewMaterial.readiness;
  const artefactReferences = reviewMaterial.artefactReferences;
  const escalationHistory = reviewMaterial.escalationHistory;
  const escalationHistoryOmitted = reviewMaterial.escalationHistoryOmitted;
  const escalationHistoryLimitations = reviewMaterial.escalationHistoryLimitations;
  const responseLifecycle = reviewMaterial.responseLifecycle;
  const reviewedInputDigestSha256 = await sha256(canonicalArtifactJsonV2(reviewMaterial));
  const authorisation = buildResponseAuthorisation(input, reviewedInputDigestSha256, readiness, normalizedGeneratedAt);
  const age = observationAge(observedAt, normalizedGeneratedAt);
  const preflight = buildCaseResponsePreflight(caseRecord, input, normalizedGeneratedAt);
  const profile = buildResponsePacketProfilePreview(caseRecord, input);
  const limitations = [
    authorisation.status === 'authorised'
      ? 'This packet is bound to explicit confirmations for the exact reviewed-input digest. It still requires deliberate manual use.'
      : 'This packet is a local draft with cautions and is not authorised for external use by WHOISleuth.',
    'WHOISleuth did not submit this packet or verify that any listed contact is monitored.',
    ...(!contacts.length ? ['No escalation contact was included.'] : []),
    ...(age.refreshRecommended ? ['The selected observation is over seven days old or appears to be in the future. Refresh evidence before submission.'] : []),
  ];
  const unsigned: Omit<CaseResponsePacket, 'integrity'> = {
    schema: CASE_RESPONSE_PACKET_SCHEMA,
    schemaVersion: CASE_RESPONSE_PACKET_VERSION,
    generatedAt: normalizedGeneratedAt,
    reviewRequired: true,
    submissionPerformed: false,
    profile: {
      id: profile.id,
      label: profile.label,
      audience: profile.audience,
      subject: profile.subject,
      checklist: profile.checklist,
      evidenceOrder: profile.evidenceOrder,
      includedEvidence: profile.includedEvidence,
      excludedEvidence: profile.excludedEvidence,
      redactions: profile.redactions,
      attachments: profile.attachments,
      followUpFields: profile.followUpFields,
    },
    case: {
      id: caseRecord.id,
      domain: caseRecord.domain,
      status: caseRecord.status,
      disposition: caseRecord.disposition,
      updatedAt: caseRecord.updatedAt,
    },
    incident: {
      category,
      affectedParty,
      abusiveUrls,
      observedHarm,
      observedAt,
    },
    contacts,
    recipientRoute,
    actionBinding,
    selectedEvidence,
    contradictions,
    readiness,
    artefactReferences,
    authorisation,
    preflight,
    escalationHistory,
    escalationHistoryOmitted,
    escalationHistoryLimitations,
    responseLifecycle,
    provenance: {
      latestEvidenceCapturedAt: latestEvidence?.capturedAt ?? null,
      evidencePinCount: caseRecord.evidencePins.length,
      decisionCount: caseRecord.decisions.length,
      assertionCount: caseRecord.assertions.length,
      observationAge: age,
      limitations,
    },
  };
  const digestSha256 = await sha256(canonicalArtifactJsonV2(unsigned));
  const json: CaseResponsePacket = {
    ...unsigned,
    integrity: {
      algorithm: 'SHA-256',
      canonicalization: SORTED_JSON_V2,
      scope: 'packet excluding integrity',
      digestSha256,
    },
  };

  const lines = [
    `# ${escapeMarkdown(profile.label)} packet`,
    '',
    `**Domain:** ${escapeMarkdown(caseRecord.domain)}`,
    `**Category:** ${escapeMarkdown(category)}`,
    `**Affected party:** ${escapeMarkdown(affectedParty)}`,
    `**Observed at (UTC):** ${observedAt}`,
    `**Generated at (UTC):** ${normalizedGeneratedAt}`,
    `**Audience:** ${escapeMarkdown(profile.audience)}`,
    `**Suggested subject:** ${escapeMarkdown(profile.subject)}`,
    '',
    '## Observed harm',
    '',
    escapeMarkdown(observedHarm),
    '',
    '## Exact abusive URLs',
    '',
    ...abusiveUrls.map((url) => `- ${escapeMarkdown(url)}`),
    '',
    '## Selected response route',
    '',
    ...(recipientRoute
      ? [
          `### ${contactLabel(recipientRoute.kind)}`,
          '',
          `- Case action: ${escapeMarkdown(recipientRoute.actionId)}`,
          `- Contact: ${escapeMarkdown(recipientRoute.contact)}`,
          `- Source: ${escapeMarkdown(recipientRoute.source)}`,
          `- Route observed: ${recipientRoute.observedAt ?? 'Not provided'} (${recipientRoute.freshness})`,
          `- Route review after: ${recipientRoute.reviewAfter ?? 'Not provided'}`,
          `- Limitations: ${recipientRoute.limitations.length ? recipientRoute.limitations.map(escapeMarkdown).join('; ') : 'None recorded'}`,
          '',
        ]
      : ['No profile-appropriate response route was bound to this packet.', '']),
    '## Selected action lineage',
    '',
    ...(escalationHistory.length
      ? escalationHistory.flatMap((action) => [
          `- ${escapeMarkdown(action.type.replaceAll('_', ' '))} to ${escapeMarkdown(action.recipient)} · ${escapeMarkdown(action.state.replaceAll('_', ' '))} · updated ${action.updatedAt}`,
          `  - Route observed: ${action.routeObservedAt ?? 'Not provided'}`,
          ...(action.reference ? [`  - Reference: ${escapeMarkdown(action.reference)}`] : []),
          ...(action.providerOutcome ? [`  - Typed provider outcome: ${escapeMarkdown(action.providerOutcome.replaceAll('_', ' '))}`] : []),
          ...(action.outcomeDetail ? [`  - Outcome detail: ${escapeMarkdown(action.outcomeDetail)}`] : []),
          ...(action.originActionId ? [`  - Originating action: ${escapeMarkdown(action.originActionId)}`] : []),
          ...action.transitions.flatMap((event) => [
            `  - ${event.occurredAt}: ${escapeMarkdown(event.previousState ?? 'none')} → ${escapeMarkdown(event.nextState)} · ${escapeMarkdown(event.sourceClass)} · ${escapeMarkdown(event.provenance)}${event.providerOutcome ? ` · ${escapeMarkdown(event.providerOutcome.replaceAll('_', ' '))}` : ''}${event.applied ? '' : ' · retained conflict'}`,
            ...(event.reference ? [`    - Reference: ${escapeMarkdown(event.reference)}`] : []),
            ...(event.evidencePinId ? [`    - Evidence pin: ${escapeMarkdown(event.evidencePinId)}`] : []),
            ...(event.originActionId ? [`    - Originating action: ${escapeMarkdown(event.originActionId)}`] : []),
            ...event.limitations.map((limitation) => `    - Limitation: ${escapeMarkdown(limitation)}`),
          ]),
          ...(action.historyOmitted ? [`  - ${action.historyOmitted} earlier transition event${action.historyOmitted === 1 ? '' : 's'} omitted by bound.`] : []),
          ...action.historyLimitations.map((limitation) => `  - History limitation: ${escapeMarkdown(limitation)}`),
        ])
      : ['No Case action was selected.']),
    ...(escalationHistoryOmitted ? [`- Unrelated Case actions excluded from packet: ${escalationHistoryOmitted}`] : []),
    ...escalationHistoryLimitations.map((limitation) => `- Packet history limitation: ${escapeMarkdown(limitation)}`),
    '',
    '## Readiness and authorisation',
    '',
    `- Packet state: ${authorisation.status}`,
    `- Reviewed-input SHA-256: ${authorisation.reviewedInputDigestSha256}`,
    `- Supplied review digest matches: ${authorisation.digestMatches ? 'yes' : 'no'}`,
    ...RESPONSE_AUTHORISATION_CONFIRMATION_IDS.map((id) => `- Confirmation ${id}: ${authorisation.confirmations[id] ? 'yes' : 'no'}`),
    ...readiness.rows.flatMap((row) => [
      `- ${escapeMarkdown(row.label)} [${row.state}]: ${escapeMarkdown(row.detail)}`,
      ...row.limitations.map((limitation) => `  - Limitation: ${escapeMarkdown(limitation)}`),
    ]),
    ...authorisation.limitations.map((limitation) => `- ${escapeMarkdown(limitation)}`),
    '',
    '## Selected evidence and integrity references',
    '',
    ...(selectedEvidence.length ? selectedEvidence.map((item) => `- ${escapeMarkdown(item.id)} · ${escapeMarkdown(item.label)} · ${escapeMarkdown(item.source)}${item.observationHostname ? ` · ${escapeMarkdown(item.observationHostname)}` : ''} · ${item.observedAt ?? 'Observation time unavailable'} · ${escapeMarkdown(item.completeness)}`) : ['- No evidence pin was explicitly selected.']),
    ...artefactReferences.map((item) => `- ${escapeMarkdown(item.id)} · ${escapeMarkdown(item.label)} · SHA-256 ${item.digestSha256} · captured ${item.capturedAt}`),
    '',
    '## Provider outcome and independent effect',
    '',
    responseLifecycle.latestProviderOutcome
      ? `- Provider outcome time: ${responseLifecycle.latestProviderOutcome.occurredAt} (${escapeMarkdown(responseLifecycle.latestProviderOutcome.outcome.replaceAll('_', ' '))})`
      : `- Provider outcome time: Withheld because the typed event state is ${responseLifecycle.providerOutcomeState}.`,
    responseLifecycle.latestObservedChangeAt
      ? `- Independently observed change time: ${responseLifecycle.latestObservedChangeAt}`
      : `- Independently observed change time: Withheld because the independent change state is ${responseLifecycle.observedChangeState}.`,
    ...(responseLifecycle.latestObservedEffect ? [`- Latest independent review: ${escapeMarkdown(responseLifecycle.latestObservedEffect.state.replaceAll('_', ' '))} · ${responseLifecycle.latestObservedEffect.observedAt} · ${escapeMarkdown(responseLifecycle.latestObservedEffect.source)}`] : []),
    ...responseLifecycle.limitations.map((limitation) => `- ${escapeMarkdown(limitation)}`),
    '',
    '## Review and provenance',
    '',
    `- Preflight: ${preflight.status.replaceAll('_', ' ')} (${preflight.counts.pass} pass, ${preflight.counts.caution} caution, ${preflight.counts.block} block)`,
    ...preflight.checks.map((check) => `- ${escapeMarkdown(check.label)} [${check.state}]: ${escapeMarkdown(check.detail)}`),
    ...limitations.map((limitation) => `- ${escapeMarkdown(limitation)}`),
    `- Case evidence pins: ${caseRecord.evidencePins.length}`,
    `- Case decision records: ${caseRecord.decisions.length}`,
    `- Case structured assertions: ${caseRecord.assertions.length}`,
    `- Observation-age band at export: ${age.band.replaceAll('_', ' ')}`,
    `- Canonical packet SHA-256: ${digestSha256}`,
    '- Digest scope: canonical sorted JSON packet excluding the integrity object',
    '',
    '## Audience profile',
    '',
    ...profile.checklist.map((item) => `- Checklist: ${escapeMarkdown(item)}`),
    ...profile.includedEvidence.map((item) => `- Included: ${escapeMarkdown(item)}`),
    ...profile.excludedEvidence.map((item) => `- Excluded: ${escapeMarkdown(item)}`),
    ...profile.redactions.map((item) => `- Redaction to confirm: ${escapeMarkdown(item)}`),
    ...profile.attachments.map((item) => `- Attachment expectation: ${escapeMarkdown(item)}`),
    ...profile.followUpFields.map((item) => `- Follow-up field: ${escapeMarkdown(item)}`),
  ];
  const markdown = `${lines.join('\n').trim()}\n`;
  const email = [
    `Subject: ${profile.subject}`,
    '',
    'Hello,',
    '',
    `I am reporting observed ${category} activity involving ${caseRecord.domain}.`,
    `Affected party: ${affectedParty}`,
    `Observed at (UTC): ${observedAt}`,
    '',
    'Observed harm:',
    observedHarm,
    '',
    'Exact URLs:',
    ...abusiveUrls.map((url) => `- ${url}`),
    '',
    'Selected evidence:',
    ...(selectedEvidence.length
      ? selectedEvidence.map((item) => `- ${item.label} — ${item.source}${item.observationHostname ? ` for ${item.observationHostname}` : ''}, observed ${item.observedAt ?? 'time unavailable'} (${item.completeness})`)
      : ['- No Case evidence pin was selected.']),
    '',
    `Reviewed packet SHA-256: ${digestSha256}`,
    'Attach the reviewed packet (and any separately reviewed evidence files) through the recipient’s approved submission channel; this message does not embed or transmit attachments.',
    '',
    responseLifecycle.latestProviderOutcome
      ? `Provider outcome time: ${responseLifecycle.latestProviderOutcome.occurredAt} (${responseLifecycle.latestProviderOutcome.outcome.replaceAll('_', ' ')})`
      : `Provider outcome time: Withheld because the typed event state is ${responseLifecycle.providerOutcomeState}.`,
    responseLifecycle.latestObservedChangeAt
      ? `Independently observed change time: ${responseLifecycle.latestObservedChangeAt}`
      : `Independently observed change time: Withheld because the independent change state is ${responseLifecycle.observedChangeState}.`,
    '',
    'Please review this report under the applicable abuse and acceptable-use policies.',
    '',
    authorisation.status === 'authorised'
      ? 'This locally prepared packet is bound to explicit review confirmations. It was not submitted automatically and does not promise any provider outcome.'
      : 'This is an unauthorised local draft with cautions. It was not submitted automatically and does not promise any provider outcome.',
  ].join('\n');
  return { json, markdown, email: `${email}\n` };
}

export function caseResponsePacketFilename(
  domain: string,
  format: 'json' | 'md' | 'txt',
  generatedAt: string,
): string {
  const safeDomain = domain.toLowerCase().replace(/[^a-z0-9.-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80) || 'case';
  const date = (timestamp(generatedAt) || new Date().toISOString()).slice(0, 10);
  return `whoisleuth-response-${safeDomain}-${date}.${format}`;
}
