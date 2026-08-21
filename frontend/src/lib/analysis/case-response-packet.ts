// Pure abuse-evidence packet builder. It creates local review artifacts only:
// no network requests, mailto links, submissions, or provider side effects.

import type { CaseRecord } from './case-model.ts';
import { buildCaseActionOutcomeSummary } from './case-response-model.ts';
import { canonicalArtifactJsonV2, SORTED_JSON_V2 } from './artifact-integrity.ts';

export const CASE_RESPONSE_PACKET_SCHEMA = 'whoisleuth.case-response-packet';
export const CASE_RESPONSE_PACKET_VERSION = 6;
export const LEGACY_CASE_RESPONSE_PACKET_VERSION = 5;
export const MAX_ABUSIVE_URLS = 20;
export const MAX_RESPONSE_CONTACTS = 12;
export const MAX_RESPONSE_ACTION_HISTORY = 20;
export const MAX_RESPONSE_HARM_LENGTH = 2000;
export const MAX_AFFECTED_PARTY_LENGTH = 200;
export const MAX_ABUSE_CATEGORY_LENGTH = 80;
export const MAX_EXACT_URL_LENGTH = 2048;
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
};

export type CaseResponsePreflightCheck = Readonly<{
  id: string;
  label: string;
  state: 'block' | 'caution' | 'pass';
  detail: string;
}>;

export type CaseResponsePreflight = Readonly<{
  version: 1;
  status: 'needs_input' | 'ready_for_review' | 'review_cautions';
  canExport: boolean;
  counts: Readonly<{ block: number; caution: number; pass: number }>;
  checks: readonly CaseResponsePreflightCheck[];
  actionSummary: ReturnType<typeof buildCaseActionOutcomeSummary>;
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
    limitations: string[];
  }>;
  preflight: CaseResponsePreflight;
  escalationHistory: Array<{
    type: string;
    recipient: string;
    contactSource: string;
    state: string;
    reference: string | null;
    outcome: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
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

function normalizeContacts(value: unknown): CaseResponsePacket['contacts'] {
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
    contacts.push({
      kind,
      contact,
      source: text(item.source, 120) || 'analyst supplied',
      limitations: normalizeLimitations(item.limitations),
    });
    if (contacts.length >= MAX_RESPONSE_CONTACTS) break;
  }
  return contacts;
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
    ...(!caseRecord.evidencePins.length ? ['Analyst-selected evidence pin'] : []),
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
  const contacts = normalizeContacts(input.contacts);
  const urls = normalizeUrls(input.abusiveUrls);
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
      state: caseRecord.evidencePins.length ? 'pass' : 'caution',
      detail: caseRecord.evidencePins.length
        ? `${caseRecord.evidencePins.length} analyst-selected evidence pin${caseRecord.evidencePins.length === 1 ? '' : 's'} will remain separately attributable.`
        : 'No precise evidence pin is recorded; the packet can be drafted, but its support is less reviewable.',
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
    version: 1,
    status: counts.block ? 'needs_input' : counts.caution ? 'review_cautions' : 'ready_for_review',
    canExport: counts.block === 0,
    counts,
    checks,
    actionSummary,
  };
}

function normalizeActionHistory(caseRecord: CaseRecord): CaseResponsePacket['escalationHistory'] {
  return caseRecord.actions
    .slice(-MAX_RESPONSE_ACTION_HISTORY)
    .map((action) => ({
      type: text(action.type, 80),
      recipient: text(action.recipient, 320),
      contactSource: text(action.contactSource, 120),
      state: text(action.state, 80),
      reference: text(action.reference, 500) || null,
      outcome: text(action.outcome, 2000) || null,
      createdAt: timestamp(action.createdAt) ?? caseRecord.createdAt,
      updatedAt: timestamp(action.updatedAt) ?? caseRecord.updatedAt,
    }));
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

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`).join(',')}}`;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyCaseResponsePacketIntegrity(packet: Readonly<{
  schemaVersion: number;
  integrity: Readonly<{
    algorithm: unknown;
    canonicalization: unknown;
    scope: unknown;
    digestSha256: unknown;
  }>;
  [key: string]: unknown;
}>): Promise<boolean> {
  const { integrity, ...unsigned } = packet;
  const canonicalization = packet.schemaVersion === LEGACY_CASE_RESPONSE_PACKET_VERSION
    && integrity.canonicalization === 'sorted-json-v1'
    ? canonicalJson
    : packet.schemaVersion === CASE_RESPONSE_PACKET_VERSION
      && integrity.canonicalization === SORTED_JSON_V2
      ? canonicalArtifactJsonV2
      : null;
  if (
    integrity.algorithm !== 'SHA-256'
    || !canonicalization
    || integrity.scope !== 'packet excluding integrity'
    || typeof integrity.digestSha256 !== 'string'
    || !/^[a-f0-9]{64}$/u.test(integrity.digestSha256)
  ) {
    return false;
  }
  return integrity.digestSha256 === await sha256(canonicalization(unsigned));
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
  const contacts = normalizeContacts(input.contacts);
  const escalationHistory = normalizeActionHistory(caseRecord);
  const age = observationAge(observedAt, normalizedGeneratedAt);
  const preflight = buildCaseResponsePreflight(caseRecord, input, normalizedGeneratedAt);
  const profile = buildResponsePacketProfilePreview(caseRecord, input);
  const limitations = [
    'This packet contains analyst-selected facts and must be reviewed before submission.',
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
    preflight,
    escalationHistory,
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
          ...(action.outcome ? [`  - Outcome: ${escapeMarkdown(action.outcome)}`] : []),
        ])
      : ['No reviewed case actions were recorded.']),
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
    'Please review this report under the applicable abuse and acceptable-use policies.',
    '',
    'This draft was prepared for human review and was not submitted automatically.',
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
