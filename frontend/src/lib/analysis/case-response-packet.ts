// Pure abuse-evidence packet builder. It creates local review artifacts only:
// no network requests, mailto links, submissions, or provider side effects.

import type { CaseRecord } from './case-model.ts';

export const CASE_RESPONSE_PACKET_SCHEMA = 'whoisleuth.case-response-packet';
export const CASE_RESPONSE_PACKET_VERSION = 2;
export const MAX_ABUSIVE_URLS = 20;
export const MAX_RESPONSE_CONTACTS = 12;
export const MAX_RESPONSE_HARM_LENGTH = 2000;
export const MAX_AFFECTED_PARTY_LENGTH = 200;
export const MAX_ABUSE_CATEGORY_LENGTH = 80;
export const MAX_EXACT_URL_LENGTH = 2048;

export const RESPONSE_CONTACT_KINDS = [
  'registrar',
  'registry',
  'network_hosting',
  'security_txt',
] as const;
export type ResponseContactKind = typeof RESPONSE_CONTACT_KINDS[number];

export type ResponseContactInput = {
  kind?: unknown;
  contact?: unknown;
  source?: unknown;
  limitations?: unknown;
};

export type CaseResponsePacketInput = {
  category?: unknown;
  affectedParty?: unknown;
  abusiveUrls?: unknown;
  observedHarm?: unknown;
  observedAt?: unknown;
  contacts?: unknown;
};

export type CaseResponsePacket = {
  schema: typeof CASE_RESPONSE_PACKET_SCHEMA;
  schemaVersion: typeof CASE_RESPONSE_PACKET_VERSION;
  generatedAt: string;
  reviewRequired: true;
  submissionPerformed: false;
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
  provenance: {
    latestEvidenceCapturedAt: string | null;
    evidencePinCount: number;
    decisionCount: number;
    assertionCount: number;
    limitations: string[];
  };
};

const CONTACT_KINDS = new Set<string>(RESPONSE_CONTACT_KINDS);
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

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_[\]<>|])/gu, '\\$1').replace(/\r?\n/gu, ' ');
}

function contactLabel(value: ResponseContactKind): string {
  if (value === 'network_hosting') return 'Network or hosting';
  if (value === 'security_txt') return 'security.txt';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function buildCaseResponsePacket(
  caseRecord: CaseRecord,
  input: CaseResponsePacketInput,
  generatedAt: string = new Date().toISOString(),
): { json: CaseResponsePacket; markdown: string; email: string } {
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
  const limitations = [
    'This packet contains analyst-selected facts and must be reviewed before submission.',
    'WHOISleuth did not submit this packet or verify that any listed contact is monitored.',
    ...(!contacts.length ? ['No escalation contact was included.'] : []),
  ];
  const json: CaseResponsePacket = {
    schema: CASE_RESPONSE_PACKET_SCHEMA,
    schemaVersion: CASE_RESPONSE_PACKET_VERSION,
    generatedAt: normalizedGeneratedAt,
    reviewRequired: true,
    submissionPerformed: false,
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
    provenance: {
      latestEvidenceCapturedAt: latestEvidence?.capturedAt ?? null,
      evidencePinCount: caseRecord.evidencePins.length,
      decisionCount: caseRecord.decisions.length,
      assertionCount: caseRecord.assertions.length,
      limitations,
    },
  };

  const lines = [
    '# Reviewed abuse evidence packet',
    '',
    `**Domain:** ${escapeMarkdown(caseRecord.domain)}`,
    `**Category:** ${escapeMarkdown(category)}`,
    `**Affected party:** ${escapeMarkdown(affectedParty)}`,
    `**Observed at (UTC):** ${observedAt}`,
    `**Generated at (UTC):** ${normalizedGeneratedAt}`,
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
    '## Review and provenance',
    '',
    ...limitations.map((limitation) => `- ${escapeMarkdown(limitation)}`),
    `- Case evidence pins: ${caseRecord.evidencePins.length}`,
    `- Case decision records: ${caseRecord.decisions.length}`,
    `- Case structured assertions: ${caseRecord.assertions.length}`,
  ];
  const markdown = `${lines.join('\n').trim()}\n`;
  const email = [
    `Subject: Reviewed ${category} report for ${caseRecord.domain}`,
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
