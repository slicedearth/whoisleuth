// Pure abuse-evidence packet builder. It creates local review artifacts only:
// no network requests, mailto links, submissions, or provider side effects.

import type { CaseRecord } from './case-model.mts';
import {
  buildCaseActionOutcomeSummary,
  buildCaseResponseLifecycleSummary,
  CASE_ACTION_EVENT_SOURCE_CLASSES,
  CASE_ACTION_STATES,
  CASE_ACTION_TYPES,
  CASE_ASSERTION_STATES,
  CASE_CLOSURE_REASONS,
  CASE_OBSERVED_EFFECT_SOURCE_CLASSES,
  CASE_OBSERVED_EFFECT_STATES,
  CASE_PIN_COMPLETENESS,
  CASE_PROVIDER_OUTCOMES,
  type CaseObservedEffectState,
} from './case-response-model.mts';
import { canonicalArtifactJsonV2, SORTED_JSON_V2 } from '../evidence/artifact-integrity.mts';
import { assertBoundedJsonStructure } from '../../lib/bounded-json.mts';
import {
  CASE_RESPONSE_PACKET_SCHEMA,
  CASE_RESPONSE_PACKET_VERSION,
  PUBLIC_CASE_RESPONSE_PACKET_VERSION,
  CASE_RESPONSE_REVIEW_INPUTS_SCHEMA,
  CASE_RESPONSE_REVIEW_INPUTS_VERSION,
  MAX_ABUSE_CATEGORY_LENGTH,
  MAX_ABUSIVE_URLS,
  MAX_AFFECTED_PARTY_LENGTH,
  MAX_CASE_ACTION_EVENTS_PER_ACTION,
  MAX_CASE_ACTION_EVENTS_PER_CASE,
  MAX_CASE_ACTIONS,
  MAX_EXACT_URL_LENGTH,
  MAX_RESPONSE_ACTION_HISTORY,
  MAX_RESPONSE_ARTEFACT_REFERENCES,
  MAX_RESPONSE_AUTHORISATION_CLOCK_SKEW_MS,
  MAX_RESPONSE_CONTACTS,
  MAX_RESPONSE_CONTRADICTIONS,
  MAX_RESPONSE_HARM_LENGTH,
  MAX_RESPONSE_LIMITATION_LENGTH,
  MAX_RESPONSE_LIMITATIONS,
  MAX_RESPONSE_REFERENCE_LENGTH,
  MAX_RESPONSE_SELECTED_EVIDENCE,
  MAX_RESPONSE_VALUE_LENGTH,
  RESPONSE_ROUTE_STALE_AFTER_DAYS,
  SUPPORTED_CASE_RESPONSE_PACKET_VERSIONS,
} from '../contracts/case-portability.mts';

export {
  CASE_RESPONSE_PACKET_SCHEMA,
  CASE_RESPONSE_PACKET_VERSION,
  PUBLIC_CASE_RESPONSE_PACKET_VERSION,
  CASE_RESPONSE_REVIEW_INPUTS_SCHEMA,
  CASE_RESPONSE_REVIEW_INPUTS_VERSION,
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
};
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

export const RESPONSE_CONTACT_KINDS = [
  'registrar',
  'registry',
  'network_hosting',
  'security_txt',
] as const;
export type ResponseContactKind = typeof RESPONSE_CONTACT_KINDS[number];

export const RESPONSE_PACKET_PROFILE_IDS = [
  'registrar',
  'registry',
  'network_hosting',
  'security_contact',
  'browser_blocklist',
  'internal_soc',
] as const;
export type ResponsePacketProfileId = typeof RESPONSE_PACKET_PROFILE_IDS[number];

export const RESPONSE_READINESS_STATES = ['complete', 'partial', 'stale', 'unavailable', 'not_provided'] as const;
export type ResponseReadinessState = typeof RESPONSE_READINESS_STATES[number];

export const RESPONSE_READINESS_ROW_IDS = [
  'observed_behaviour',
  'exact_url',
  'observation_time',
  'capture_provenance',
  'infrastructure_responsibility',
  'recipient_route',
  'authority_review',
  'selected_evidence',
  'contradictions',
  'source_limitations',
] as const;
export type ResponseReadinessRowId = typeof RESPONSE_READINESS_ROW_IDS[number];

export const RESPONSE_AUTHORISATION_CONFIRMATION_IDS = [
  'selectedEvidence',
  'recipientScope',
  'privacyRedactions',
  'analystAuthority',
  'evidenceFreshness',
] as const;
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
    redactions: ['Remove unnecessary personal registration data', 'Remove credentials, tokens, and URL fragments'],
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
    redactions: ['Remove unnecessary personal registration data', 'Remove credentials, tokens, and URL fragments'],
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
    redactions: ['Remove credentials, query secrets, fragments, cookies, and unrelated contacts'],
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
    redactions: ['Remove credentials, tokens, personal data, and unrelated identifiers'],
    attachments: ['Reviewed response packet', 'Optional normalised case report'],
    followUpFields: ['Security reference', 'Triage acknowledgement', 'Remediation outcome'],
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
    redactions: ['Remove credentials, tokens, URL fragments, and unrelated contacts'],
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
    redactions: ['Remove credentials, tokens, and personal data not required for the internal decision'],
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
  version: 2;
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
    status: string;
    disposition: string;
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
    freshness: 'current' | 'stale' | 'unknown';
    limitations: string[];
  }>;
  selectedEvidence: Array<{
    id: string;
    label: string;
    source: string;
    observedAt: string;
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

const CONTACT_KINDS = new Set<string>(RESPONSE_CONTACT_KINDS);
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
  if (typeof value !== 'string' || value.length > 64 || CONTROL_RE.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizeExactUrl(value: unknown): string | null {
  const candidate = text(value, MAX_EXACT_URL_LENGTH);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeUrls(value: unknown): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/\r?\n/u)
      : [];
  const unique = new Set<string>();
  for (const item of source.slice(0, MAX_ABUSIVE_URLS * 2)) {
    const normalized = normalizeExactUrl(item);
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

function normalizeContacts(value: unknown, generatedAt?: string): CaseResponsePacket['contacts'] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const contacts: CaseResponsePacket['contacts'] = [];
  for (const raw of value.slice(0, MAX_RESPONSE_CONTACTS * 2)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const kind = typeof item.kind === 'string' && CONTACT_KINDS.has(item.kind)
      ? item.kind as ResponseContactKind
      : null;
    const contact = text(item.contact, 320);
    if (!kind || !contact) continue;
    const key = `${kind}\u0000${contact.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const observedAt = timestamp(item.observedAt);
    const routeAge = observedAt && generatedAt ? Date.parse(generatedAt) - Date.parse(observedAt) : null;
    contacts.push({
      kind,
      contact,
      source: text(item.source, 120) || 'analyst supplied',
      observedAt,
      freshness: routeAge === null
        ? 'unknown'
        : routeAge < -300_000 || routeAge > RESPONSE_ROUTE_STALE_AFTER_DAYS * 86_400_000
          ? 'stale'
          : 'current',
      limitations: normalizeLimitations(item.limitations),
    });
    if (contacts.length >= MAX_RESPONSE_CONTACTS) break;
  }
  return contacts;
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
      observedAt: timestamp(pin.observedAt) ?? caseRecord.updatedAt,
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
  caseRecord: CaseRecord,
  input: CaseResponsePacketInput,
  generatedAt: string,
  contacts: CaseResponsePacket['contacts'],
  selectedEvidence: CaseResponsePacket['selectedEvidence'],
  contradictions: CaseResponsePacket['contradictions'],
): CaseResponsePacket['readiness'] {
  const profile = responsePacketProfile(input.profile);
  const urls = normalizeUrls(input.abusiveUrls);
  const observedAt = timestamp(input.observedAt) || caseRecord.evidenceHistory.at(-1)?.capturedAt || null;
  const age = observedAt ? observationAge(observedAt, generatedAt) : null;
  const requiredContact = profile.requiredContactKind
    ? contacts.find((contact) => contact.kind === profile.requiredContactKind) ?? null
    : contacts[0] ?? null;
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
      detail: selectedEvidence.length ? 'Selected evidence retains source and observation metadata.' : 'No selected evidence is available for capture-provenance review.',
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
      state: !requiredContact ? 'not_provided' : requiredContact.freshness === 'stale' ? 'stale' : requiredContact.freshness === 'current' && requiredContact.source ? 'complete' : 'partial',
      detail: !requiredContact ? 'No profile-appropriate recipient route is selected.' : `The selected route provenance is ${requiredContact.source}; freshness is ${requiredContact.freshness}.`,
      requiredForAuthorisation: external,
      limitations: requiredContact?.limitations ?? [],
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
  const contacts = normalizeContacts(input.contacts, normalizedGeneratedAt);
  const selectedEvidence = normalizeSelectedEvidence(caseRecord, input.selectedEvidencePinIds);
  return buildResponseReadiness(
    caseRecord,
    input,
    normalizedGeneratedAt,
    contacts,
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
  const contacts = normalizeContacts(input.contacts);
  const missingEvidence = [
    ...(!normalizeUrls(input.abusiveUrls).length ? ['At least one exact HTTP(S) URL'] : []),
    ...(!timestamp(input.observedAt) && !caseRecord.evidenceHistory.at(-1)?.capturedAt ? ['Observation time'] : []),
    ...(!normalizeSelectedEvidence(caseRecord, input.selectedEvidencePinIds).length ? ['Explicitly selected evidence pin'] : []),
    ...(profile.requiredContactKind && !contacts.some((contact) => contact.kind === profile.requiredContactKind)
      ? [`${contactLabel(profile.requiredContactKind)} contact route`]
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
  const latestEvidence = caseRecord.evidenceHistory.at(-1) ?? null;
  const observedAt = timestamp(input.observedAt) || latestEvidence?.capturedAt || null;
  const normalizedGeneratedAt = timestamp(generatedAt) || new Date().toISOString();
  const contacts = normalizeContacts(input.contacts, normalizedGeneratedAt);
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
      state: caseRecord.decisions.length ? 'pass' : 'caution',
      detail: caseRecord.decisions.length
        ? `${caseRecord.decisions.length} analyst decision${caseRecord.decisions.length === 1 ? '' : 's'} record the escalation rationale.`
        : 'No explicit analyst decision explains why external reporting is appropriate.',
    },
    {
      id: 'recipient_route',
      label: 'Recipient route',
      state: contacts.length ? 'pass' : 'caution',
      detail: contacts.length
        ? `${contacts.length} separately attributed contact route${contacts.length === 1 ? ' is' : 's are'} included.`
        : 'No contact route is included; identify and review the intended recipient before sending.',
    },
    {
      id: 'profile_recipient',
      label: 'Audience-specific recipient',
      state: profile.requiredContactKind
        ? contacts.some((contact) => contact.kind === profile.requiredContactKind) ? 'pass' : 'caution'
        : 'pass',
      detail: profile.requiredContactKind
        ? contacts.some((contact) => contact.kind === profile.requiredContactKind)
          ? `The ${contactLabel(profile.requiredContactKind)} route required by the ${profile.label.toLowerCase()} is present.`
          : `The ${profile.label.toLowerCase()} expects a separately attributed ${contactLabel(profile.requiredContactKind)} route.`
        : `${profile.label} has no fixed external contact-kind requirement; confirm the intended manual destination.`,
    },
    {
      id: 'case_disposition',
      label: 'Case disposition',
      state: ['suspicious', 'confirmed_abuse'].includes(caseRecord.disposition) ? 'pass' : 'caution',
      detail: ['suspicious', 'confirmed_abuse'].includes(caseRecord.disposition)
        ? `The case disposition is ${caseRecord.disposition.replaceAll('_', ' ')}.`
        : `The case disposition is ${caseRecord.disposition.replaceAll('_', ' ')}; confirm it before external use.`,
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
      id: 'action_tracking',
      label: 'Action tracking',
      state: actionSummary.total ? 'pass' : 'caution',
      detail: actionSummary.total
        ? `${actionSummary.total} reviewed action${actionSummary.total === 1 ? ' is' : 's are'} tracked; ${actionSummary.overdue} overdue and ${actionSummary.followUpDue} due for follow-up.`
        : 'No reviewed case action is recorded for ownership, submission, or follow-up.',
    },
  ];
  const counts = {
    block: checks.filter((item) => item.state === 'block').length,
    caution: checks.filter((item) => item.state === 'caution').length,
    pass: checks.filter((item) => item.state === 'pass').length,
  };
  return {
    version: 2,
    status: counts.block ? 'needs_input' : counts.caution ? 'review_cautions' : 'ready_for_review',
    canExport: counts.block === 0,
    counts,
    checks,
    actionSummary,
  };
}

function normalizeActionHistory(caseRecord: CaseRecord): Readonly<{
  actions: CaseResponsePacket['escalationHistory'];
  omitted: number;
  limitations: string[];
}> {
  const omitted = Math.max(0, caseRecord.actions.length - MAX_RESPONSE_ACTION_HISTORY);
  return {
    actions: caseRecord.actions
    .slice(-MAX_RESPONSE_ACTION_HISTORY)
    .map((action) => ({
      actionId: action.id,
      type: text(action.type, 80),
      recipient: text(action.recipient, 320),
      contactSource: text(action.contactSource, 120),
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
    limitations: omitted ? [
      `${omitted} earlier Case response action${omitted === 1 ? '' : 's'} omitted from this bounded packet projection.`,
      'Provider-outcome time is withheld because an omitted action could contain a later or concurrent typed event.',
    ] : [],
  };
}

function normalizeResponseLifecycle(
  caseRecord: CaseRecord,
  escalationHistoryOmitted: number,
): CaseResponsePacket['responseLifecycle'] {
  const summary = buildCaseResponseLifecycleSummary(caseRecord);
  const providerOutcomeState = escalationHistoryOmitted ? 'ambiguous' : summary.providerOutcomeState;
  return {
    providerOutcomeState,
    latestProviderOutcome: !escalationHistoryOmitted && summary.latestProviderOutcome ? { ...summary.latestProviderOutcome } : null,
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
      ...(escalationHistoryOmitted ? ['Provider-outcome time is withheld because the bounded packet omits earlier response actions.'] : []),
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
  const contacts = normalizeContacts(input.contacts, generatedAt);
  const selectedEvidence = normalizeSelectedEvidence(caseRecord, input.selectedEvidencePinIds);
  const contradictions = normalizeContradictions(caseRecord);
  const readiness = buildResponseReadiness(caseRecord, input, generatedAt, contacts, selectedEvidence, contradictions);
  const escalation = normalizeActionHistory(caseRecord);
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
      abusiveUrls: normalizeUrls(input.abusiveUrls),
      observedHarm: text(input.observedHarm, MAX_RESPONSE_HARM_LENGTH),
      observedAt: timestamp(input.observedAt) || caseRecord.evidenceHistory.at(-1)?.capturedAt || null,
    },
    contacts,
    selectedEvidence,
    contradictions,
    readiness,
    artefactReferences: normalizeArtefactReferences(input.artefactReferences),
    escalationHistory: escalation.actions,
    escalationHistoryOmitted: escalation.omitted,
    escalationHistoryLimitations: escalation.limitations,
    responseLifecycle: normalizeResponseLifecycle(caseRecord, escalation.omitted),
  };
}

const CASE_RESPONSE_REVIEW_INPUT_KEYS = Object.freeze([
  'contract',
  'version',
  'profile',
  'case',
  'incident',
  'contacts',
  'selectedEvidence',
  'contradictions',
  'readiness',
  'artefactReferences',
  'escalationHistory',
  'escalationHistoryOmitted',
  'escalationHistoryLimitations',
  'responseLifecycle',
] as const);

function exactReviewRecord(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an exact object.`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length
    || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) {
    throw new TypeError(`${label} contains an undeclared field.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (keys.some((key) => !descriptors[key] || !Object.hasOwn(descriptors[key]!, 'value'))) {
    throw new TypeError(`${label} must not contain accessors.`);
  }
  return value as Record<string, unknown>;
}

function boundedReviewArray(value: unknown, maximum: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new TypeError(`${label} exceeds its declared array bound.`);
  }
  const ownKeys = Reflect.ownKeys(value).filter((key) => key !== 'length');
  if (ownKeys.length !== value.length
    || ownKeys.some((key, index) => key !== String(index))) {
    throw new TypeError(`${label} must be a dense ordinary array.`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (ownKeys.some((key) => typeof key !== 'string' || !Object.hasOwn(descriptors[key]!, 'value'))) {
    throw new TypeError(`${label} must not contain accessors.`);
  }
  return value;
}

function reviewText(value: unknown, maximum: number, label: string, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || value.length > maximum || CONTROL_RE.test(value)) {
    throw new TypeError(`${label} is not a bounded text value.`);
  }
  return value;
}

function reviewStrings(value: unknown, maximum: number, itemMaximum: number, label: string): string[] {
  const items = boundedReviewArray(value, maximum, label);
  for (const item of items) reviewText(item, itemMaximum, `${label} item`);
  return items as string[];
}

function reviewCount(value: unknown, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new TypeError(`${label} is not a bounded count.`);
  }
  return value as number;
}

function reviewEnum(value: unknown, values: readonly string[], label: string): string {
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new TypeError(`${label} contains an unsupported value.`);
  }
  return value;
}

function reviewNullableEnum(value: unknown, values: readonly string[], label: string): string | null {
  return value === null ? null : reviewEnum(value, values, label);
}

function validateReviewLifecycle(value: unknown): void {
  const lifecycle = exactReviewRecord(value, [
    'providerOutcomeState', 'latestProviderOutcome', 'observedChangeState',
    'latestObservedEffect', 'latestObservedChangeAt', 'closure', 'limitations',
  ], 'Case-response review lifecycle');
  reviewEnum(lifecycle.providerOutcomeState, ['available', 'missing', 'ambiguous'], 'Case-response provider-outcome state');
  reviewEnum(lifecycle.observedChangeState, ['available', 'missing', 'ambiguous'], 'Case-response observed-change state');
  reviewText(lifecycle.latestObservedChangeAt, 64, 'Case-response latest observed change', true);
  reviewStrings(lifecycle.limitations, MAX_RESPONSE_LIMITATIONS, MAX_RESPONSE_LIMITATION_LENGTH, 'Case-response lifecycle limitations');
  if (lifecycle.latestProviderOutcome !== null) {
    const outcome = exactReviewRecord(lifecycle.latestProviderOutcome, [
      'actionId', 'eventId', 'outcome', 'occurredAt', 'reference',
    ], 'Case-response latest provider outcome');
    reviewText(outcome.actionId, 64, 'Case-response provider action id');
    reviewText(outcome.eventId, 64, 'Case-response provider event id');
    reviewEnum(outcome.outcome, CASE_PROVIDER_OUTCOMES, 'Case-response provider outcome');
    reviewText(outcome.occurredAt, 64, 'Case-response provider outcome time');
    reviewText(outcome.reference, MAX_RESPONSE_REFERENCE_LENGTH, 'Case-response provider reference', true);
  }
  if (lifecycle.latestObservedEffect !== null) {
    const effect = exactReviewRecord(lifecycle.latestObservedEffect, [
      'reviewId', 'state', 'observedAt', 'sourceClass', 'source',
    ], 'Case-response latest observed effect');
    reviewText(effect.reviewId, 64, 'Case-response observed-effect review id');
    reviewEnum(effect.state, CASE_OBSERVED_EFFECT_STATES, 'Case-response observed-effect state');
    reviewText(effect.observedAt, 64, 'Case-response observed-effect time');
    reviewEnum(effect.sourceClass, CASE_OBSERVED_EFFECT_SOURCE_CLASSES, 'Case-response observed-effect source class');
    reviewText(effect.source, MAX_RESPONSE_VALUE_LENGTH, 'Case-response observed-effect source');
  }
  if (lifecycle.closure !== null) {
    const closure = exactReviewRecord(lifecycle.closure, [
      'id', 'reason', 'createdAt', 'limitations',
    ], 'Case-response latest closure');
    reviewText(closure.id, 64, 'Case-response closure id');
    reviewEnum(closure.reason, CASE_CLOSURE_REASONS, 'Case-response closure reason');
    reviewText(closure.createdAt, 64, 'Case-response closure time');
    reviewStrings(closure.limitations, MAX_RESPONSE_LIMITATIONS, MAX_RESPONSE_LIMITATION_LENGTH, 'Case-response closure limitations');
  }
}

function recursivelyFreezeReviewValue<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) {
    recursivelyFreezeReviewValue(child);
  }
  return Object.freeze(value);
}

export function validateCaseResponseReviewInputs(value: unknown): Readonly<Record<string, unknown>> {
  const source = exactReviewRecord(value, CASE_RESPONSE_REVIEW_INPUT_KEYS, 'Case-response review inputs');
  if (source.contract !== CASE_RESPONSE_REVIEW_INPUTS_SCHEMA
    || source.version !== CASE_RESPONSE_REVIEW_INPUTS_VERSION) {
    throw new TypeError('Case-response review inputs contain an unsupported version, shape, or bound.');
  }

  const profile = exactReviewRecord(source.profile, [
    'id', 'label', 'audience', 'subject', 'checklist', 'includedEvidence',
    'excludedEvidence', 'redactions',
  ], 'Case-response review profile');
  if (typeof profile.id !== 'string' || !RESPONSE_PROFILE_IDS.has(profile.id)) {
    throw new TypeError('Case-response review profile is unsupported.');
  }
  for (const key of ['label', 'audience', 'subject'] as const) {
    reviewText(profile[key], 500, `Case-response profile ${key}`);
  }
  for (const key of ['checklist', 'includedEvidence', 'excludedEvidence', 'redactions'] as const) {
    reviewStrings(profile[key], 32, 500, `Case-response profile ${key}`);
  }

  const caseRecord = exactReviewRecord(source.case, [
    'id', 'domain', 'status', 'disposition', 'updatedAt',
  ], 'Case-response review Case');
  reviewText(caseRecord.id, 64, 'Case-response Case id');
  reviewText(caseRecord.domain, 253, 'Case-response Case domain');
  reviewText(caseRecord.status, 64, 'Case-response Case status');
  reviewText(caseRecord.disposition, 64, 'Case-response Case disposition');
  reviewText(caseRecord.updatedAt, 64, 'Case-response Case update time');

  const incident = exactReviewRecord(source.incident, [
    'category', 'affectedParty', 'abusiveUrls', 'observedHarm', 'observedAt',
  ], 'Case-response review incident');
  reviewText(incident.category, MAX_ABUSE_CATEGORY_LENGTH, 'Case-response category');
  reviewText(incident.affectedParty, MAX_AFFECTED_PARTY_LENGTH, 'Case-response affected party');
  reviewStrings(incident.abusiveUrls, MAX_ABUSIVE_URLS, MAX_EXACT_URL_LENGTH, 'Case-response abusive URLs');
  reviewText(incident.observedHarm, MAX_RESPONSE_HARM_LENGTH, 'Case-response observed harm');
  reviewText(incident.observedAt, 64, 'Case-response observation time', true);

  for (const candidate of boundedReviewArray(source.contacts, MAX_RESPONSE_CONTACTS, 'Case-response contacts')) {
    const contact = exactReviewRecord(candidate, [
      'kind', 'contact', 'source', 'observedAt', 'freshness', 'limitations',
    ], 'Case-response contact');
    if (typeof contact.kind !== 'string' || !CONTACT_KINDS.has(contact.kind)
      || typeof contact.freshness !== 'string'
      || !['current', 'stale', 'unknown'].includes(contact.freshness)) {
      throw new TypeError('Case-response contact contains an unsupported enum.');
    }
    reviewText(contact.contact, 320, 'Case-response contact value');
    reviewText(contact.source, 120, 'Case-response contact source');
    reviewText(contact.observedAt, 64, 'Case-response contact observation time', true);
    reviewStrings(contact.limitations, MAX_RESPONSE_LIMITATIONS, MAX_RESPONSE_LIMITATION_LENGTH, 'Case-response contact limitations');
  }

  for (const candidate of boundedReviewArray(source.selectedEvidence, MAX_RESPONSE_SELECTED_EVIDENCE, 'Case-response selected evidence')) {
    const evidence = exactReviewRecord(candidate, [
      'id', 'label', 'source', 'observedAt', 'completeness', 'limitations',
    ], 'Case-response selected evidence item');
    reviewText(evidence.id, 64, 'Case-response evidence id');
    reviewText(evidence.label, 80, 'Case-response evidence label');
    reviewText(evidence.source, 120, 'Case-response evidence source');
    reviewText(evidence.observedAt, 64, 'Case-response evidence observation time');
    reviewEnum(evidence.completeness, CASE_PIN_COMPLETENESS, 'Case-response evidence completeness');
    reviewStrings(evidence.limitations, MAX_RESPONSE_LIMITATIONS, MAX_RESPONSE_LIMITATION_LENGTH, 'Case-response evidence limitations');
  }

  for (const candidate of boundedReviewArray(source.contradictions, MAX_RESPONSE_CONTRADICTIONS, 'Case-response contradictions')) {
    const contradiction = exactReviewRecord(candidate, [
      'id', 'statement', 'state', 'limitations',
    ], 'Case-response contradiction');
    reviewText(contradiction.id, 64, 'Case-response contradiction id');
    reviewText(contradiction.statement, 2_000, 'Case-response contradiction statement');
    reviewEnum(contradiction.state, CASE_ASSERTION_STATES, 'Case-response contradiction state');
    reviewStrings(contradiction.limitations, MAX_RESPONSE_LIMITATIONS, MAX_RESPONSE_LIMITATION_LENGTH, 'Case-response contradiction limitations');
  }

  const readiness = exactReviewRecord(source.readiness, [
    'profileId', 'rows', 'counts', 'limitations',
  ], 'Case-response readiness');
  if (typeof readiness.profileId !== 'string' || !RESPONSE_PROFILE_IDS.has(readiness.profileId)) {
    throw new TypeError('Case-response readiness profile is unsupported.');
  }
  const readinessRows = boundedReviewArray(readiness.rows, RESPONSE_READINESS_ROW_IDS.length, 'Case-response readiness rows');
  const readinessIds = new Set<string>();
  const readinessCounts = Object.fromEntries(RESPONSE_READINESS_STATES.map((state) => [state, 0])) as Record<ResponseReadinessState, number>;
  for (const candidate of readinessRows) {
    const row = exactReviewRecord(candidate, [
      'id', 'label', 'state', 'detail', 'requiredForAuthorisation', 'limitations',
    ], 'Case-response readiness row');
    if (typeof row.id !== 'string'
      || !(RESPONSE_READINESS_ROW_IDS as readonly string[]).includes(row.id)
      || readinessIds.has(row.id)
      || typeof row.state !== 'string'
      || !(RESPONSE_READINESS_STATES as readonly string[]).includes(row.state)
      || typeof row.requiredForAuthorisation !== 'boolean') {
      throw new TypeError('Case-response readiness row is unsupported or duplicated.');
    }
    readinessIds.add(row.id);
    readinessCounts[row.state as ResponseReadinessState] += 1;
    reviewText(row.label, 120, 'Case-response readiness label');
    reviewText(row.detail, 500, 'Case-response readiness detail');
    reviewStrings(row.limitations, MAX_RESPONSE_LIMITATIONS, MAX_RESPONSE_LIMITATION_LENGTH, 'Case-response readiness limitations');
  }
  const counts = exactReviewRecord(readiness.counts, RESPONSE_READINESS_STATES, 'Case-response readiness counts');
  for (const state of RESPONSE_READINESS_STATES) {
    if (reviewCount(counts[state], RESPONSE_READINESS_ROW_IDS.length, `Case-response readiness ${state} count`) !== readinessCounts[state]) {
      throw new TypeError('Case-response readiness counts do not match the exact rows.');
    }
  }
  reviewStrings(readiness.limitations, MAX_RESPONSE_LIMITATIONS, MAX_RESPONSE_LIMITATION_LENGTH, 'Case-response readiness limitations');

  for (const candidate of boundedReviewArray(source.artefactReferences, MAX_RESPONSE_ARTEFACT_REFERENCES, 'Case-response artefact references')) {
    const reference = exactReviewRecord(candidate, [
      'id', 'label', 'mediaType', 'capturedAt', 'source', 'digestSha256',
      'byteLength', 'limitations',
    ], 'Case-response artefact reference');
    reviewText(reference.id, 64, 'Case-response artefact id');
    reviewText(reference.label, 120, 'Case-response artefact label');
    reviewText(reference.mediaType, 120, 'Case-response artefact media type');
    reviewText(reference.capturedAt, 64, 'Case-response artefact capture time');
    reviewText(reference.source, 120, 'Case-response artefact source');
    if (typeof reference.digestSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(reference.digestSha256)) {
      throw new TypeError('Case-response artefact digest is invalid.');
    }
    if (reference.byteLength !== null) reviewCount(reference.byteLength, 100 * 1024 * 1024, 'Case-response artefact byte length');
    reviewStrings(reference.limitations, MAX_RESPONSE_LIMITATIONS, MAX_RESPONSE_LIMITATION_LENGTH, 'Case-response artefact limitations');
  }

  for (const candidate of boundedReviewArray(source.escalationHistory, MAX_RESPONSE_ACTION_HISTORY, 'Case-response escalation history')) {
    const action = exactReviewRecord(candidate, [
      'actionId', 'type', 'recipient', 'contactSource', 'state', 'reference',
      'providerOutcome', 'outcomeDetail', 'originActionId', 'historyOmitted',
      'historyLimitations', 'transitions', 'createdAt', 'updatedAt',
    ], 'Case-response escalation action');
    for (const key of ['actionId', 'recipient', 'contactSource', 'createdAt', 'updatedAt'] as const) {
      reviewText(action[key], MAX_RESPONSE_VALUE_LENGTH, `Case-response action ${key}`);
    }
    reviewEnum(action.type, CASE_ACTION_TYPES, 'Case-response action type');
    reviewEnum(action.state, CASE_ACTION_STATES, 'Case-response action state');
    for (const key of ['reference', 'outcomeDetail', 'originActionId'] as const) {
      reviewText(action[key], MAX_RESPONSE_VALUE_LENGTH, `Case-response action ${key}`, true);
    }
    reviewNullableEnum(action.providerOutcome, CASE_PROVIDER_OUTCOMES, 'Case-response action provider outcome');
    reviewCount(action.historyOmitted, MAX_CASE_ACTION_EVENTS_PER_CASE, 'Case-response omitted transition count');
    reviewStrings(action.historyLimitations, MAX_RESPONSE_LIMITATIONS, MAX_RESPONSE_LIMITATION_LENGTH, 'Case-response action history limitations');
    for (const candidateTransition of boundedReviewArray(action.transitions, MAX_CASE_ACTION_EVENTS_PER_ACTION, 'Case-response transitions')) {
      const transition = exactReviewRecord(candidateTransition, [
        'id', 'previousState', 'nextState', 'occurredAt', 'sourceClass', 'provenance',
        'reference', 'evidencePinId', 'limitations', 'providerOutcome', 'outcomeDetail',
        'originActionId', 'applied',
      ], 'Case-response transition');
      for (const key of ['id', 'occurredAt', 'provenance'] as const) {
        reviewText(transition[key], MAX_RESPONSE_VALUE_LENGTH, `Case-response transition ${key}`);
      }
      reviewNullableEnum(transition.previousState, CASE_ACTION_STATES, 'Case-response previous action state');
      reviewEnum(transition.nextState, CASE_ACTION_STATES, 'Case-response next action state');
      reviewEnum(transition.sourceClass, CASE_ACTION_EVENT_SOURCE_CLASSES, 'Case-response transition source class');
      for (const key of ['reference', 'evidencePinId', 'outcomeDetail', 'originActionId'] as const) {
        reviewText(transition[key], MAX_RESPONSE_VALUE_LENGTH, `Case-response transition ${key}`, true);
      }
      reviewNullableEnum(transition.providerOutcome, CASE_PROVIDER_OUTCOMES, 'Case-response transition provider outcome');
      if (typeof transition.applied !== 'boolean') throw new TypeError('Case-response transition applied state is invalid.');
      reviewStrings(transition.limitations, MAX_RESPONSE_LIMITATIONS, MAX_RESPONSE_LIMITATION_LENGTH, 'Case-response transition limitations');
    }
  }
  reviewCount(source.escalationHistoryOmitted, MAX_CASE_ACTIONS, 'Case-response omitted action count');
  reviewStrings(source.escalationHistoryLimitations, MAX_RESPONSE_LIMITATIONS, MAX_RESPONSE_LIMITATION_LENGTH, 'Case-response escalation limitations');
  validateReviewLifecycle(source.responseLifecycle);

  return recursivelyFreezeReviewValue(structuredClone(source));
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

function contactLabel(value: ResponseContactKind): string {
  if (value === 'network_hosting') return 'Network or hosting';
  if (value === 'security_txt') return 'security.txt';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export async function buildCaseResponsePacket(
  caseRecord: CaseRecord,
  input: CaseResponsePacketInput,
  generatedAt: string = new Date().toISOString(),
): Promise<{ json: CaseResponsePacket; markdown: string; email: string }> {
  const category = text(input.category, MAX_ABUSE_CATEGORY_LENGTH);
  const affectedParty = text(input.affectedParty, MAX_AFFECTED_PARTY_LENGTH);
  const abusiveUrls = normalizeUrls(input.abusiveUrls);
  const observedHarm = text(input.observedHarm, MAX_RESPONSE_HARM_LENGTH);
  const latestEvidence = caseRecord.evidenceHistory.at(-1) ?? null;
  const observedAt = timestamp(input.observedAt) || latestEvidence?.capturedAt || null;
  if (!category || !affectedParty || !abusiveUrls.length || !observedHarm || !observedAt) {
    throw new Error('Category, affected party, at least one exact HTTP(S) URL, observed harm, and an observation time are required.');
  }
  const normalizedGeneratedAt = timestamp(generatedAt) || new Date().toISOString();
  const reviewMaterial = buildCaseResponseReviewInputs(caseRecord, input, normalizedGeneratedAt);
  const contacts = reviewMaterial.contacts;
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
    '## Escalation contacts',
    '',
    ...(contacts.length
      ? contacts.flatMap((contact) => [
          `### ${contactLabel(contact.kind)}`,
          '',
          `- Contact: ${escapeMarkdown(contact.contact)}`,
          `- Source: ${escapeMarkdown(contact.source)}`,
          `- Route observed: ${contact.observedAt ?? 'Not provided'} (${contact.freshness})`,
          `- Limitations: ${contact.limitations.length ? contact.limitations.map(escapeMarkdown).join('; ') : 'None recorded'}`,
          '',
        ])
      : ['No escalation contact was included.', '']),
    '## Escalation history',
    '',
    ...(escalationHistory.length
      ? escalationHistory.flatMap((action) => [
          `- ${escapeMarkdown(action.type.replaceAll('_', ' '))} to ${escapeMarkdown(action.recipient)} · ${escapeMarkdown(action.state.replaceAll('_', ' '))} · updated ${action.updatedAt}`,
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
      : ['No reviewed case actions were recorded.']),
    ...(escalationHistoryOmitted ? [`- Earlier actions omitted from packet projection: ${escalationHistoryOmitted}`] : []),
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
    ...(selectedEvidence.length ? selectedEvidence.map((item) => `- ${escapeMarkdown(item.id)} · ${escapeMarkdown(item.label)} · ${escapeMarkdown(item.source)} · ${item.observedAt} · ${escapeMarkdown(item.completeness)}`) : ['- No evidence pin was explicitly selected.']),
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
    ...profile.redactions.map((item) => `- Redaction: ${escapeMarkdown(item)}`),
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
