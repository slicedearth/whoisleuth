// Stable analyst-facing Case metadata built on the existing Case v14 fields.
// Types are namespaced tags and incident targets are structured assertions, so
// deployed Case, report, packet and workspace schemas do not gain duplicate
// identity or compatibility surfaces.

import {
  MAX_RESPONSE_RATIONALE_LENGTH,
  type CaseAssertionRecord,
} from './case-response-model.mts';
import {
  MAX_TAGS_PER_CASE,
  type CaseRecord,
} from './case-record-contracts.mts';
import { caseInvestigationContext } from './case-record-operations.mts';
import { normalizeTags } from './case-record-core.mts';

export const CASE_TYPE_TAG_PREFIX = 'case-type:';
export const INCIDENT_TARGET_STATEMENT_PREFIX = 'Incident target URL: ';
export const MAX_CASE_INCIDENT_TARGETS = 20;

export const CASE_TYPES = Object.freeze([
  Object.freeze({ id: 'phishing', label: 'Phishing', description: 'Deceptive content or messages intended to obtain credentials or other sensitive information.' }),
  Object.freeze({ id: 'impersonation', label: 'Impersonation', description: 'A domain, account or page presenting itself as another person or organisation.' }),
  Object.freeze({ id: 'lookalike_cybersquatting', label: 'Lookalike or cybersquatting', description: 'A domain or account selected for review because it resembles or may exploit another name, brand or identifier.' }),
  Object.freeze({ id: 'trademark_infringement', label: 'Trademark infringement', description: 'Potential unauthorised trademark use that may cause confusion about source or affiliation.' }),
  Object.freeze({ id: 'copyright_infringement', label: 'Copyright infringement', description: 'Potential unauthorised copying or distribution of protected material.' }),
  Object.freeze({ id: 'counterfeit_goods', label: 'Counterfeit goods', description: 'Promotion or sale of goods presented as genuine branded products.' }),
  Object.freeze({ id: 'scam_fraud', label: 'Scam or fraud', description: 'Deceptive activity intended to obtain money, property or another benefit.' }),
  Object.freeze({ id: 'malware_distribution', label: 'Malware distribution', description: 'Delivery, hosting or promotion of malicious software.' }),
  Object.freeze({ id: 'credential_theft', label: 'Credential theft', description: 'Collection, sale or misuse of account credentials.' }),
  Object.freeze({ id: 'spam_platform_abuse', label: 'Spam or platform abuse', description: 'Unsolicited or abusive platform activity that does not fit a narrower type.' }),
  Object.freeze({ id: 'privacy_personal_data', label: 'Privacy or personal data', description: 'Potential exposure or misuse of personal information.' }),
  Object.freeze({ id: 'account_compromise', label: 'Account compromise', description: 'Suspected unauthorised control or use of an account.' }),
  Object.freeze({ id: 'other', label: 'Other', description: 'A reviewed type not covered by the current taxonomy.' }),
] as const);

export type CaseTypeId = typeof CASE_TYPES[number]['id'];
const CASE_TYPE_IDS = new Set<string>(CASE_TYPES.map((item) => item.id));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CASE_REFERENCE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function caseTypeIds(tags: readonly string[]): CaseTypeId[] {
  const selected = new Set<string>();
  for (const tag of tags) {
    const id = tag.toLowerCase().startsWith(CASE_TYPE_TAG_PREFIX)
      ? tag.slice(CASE_TYPE_TAG_PREFIX.length).toLowerCase()
      : '';
    if (CASE_TYPE_IDS.has(id)) selected.add(id);
  }
  return CASE_TYPES.map((item) => item.id).filter((id) => selected.has(id));
}

export function caseTypeRecords(tags: readonly string[]) {
  const selected = new Set(caseTypeIds(tags));
  return CASE_TYPES.filter((item) => selected.has(item.id));
}

export function caseFreeformTags(tags: readonly string[]): string[] {
  return tags.filter((tag) => {
    const lower = tag.toLowerCase();
    if (!lower.startsWith(CASE_TYPE_TAG_PREFIX)) return true;
    return !CASE_TYPE_IDS.has(lower.slice(CASE_TYPE_TAG_PREFIX.length));
  });
}

export function caseTagsWithTypes(tags: readonly string[], typeIds: readonly string[]): string[] {
  const selected = new Set(typeIds.filter((id) => CASE_TYPE_IDS.has(id)));
  const typeTags = CASE_TYPES
    .filter((item) => selected.has(item.id))
    .map((item) => `${CASE_TYPE_TAG_PREFIX}${item.id}`);
  const freeformTags = caseFreeformTags(tags);
  const unique = new Map<string, string>();
  for (const tag of [...typeTags, ...freeformTags]) {
    const normalized = normalizeTags([tag])[0];
    if (normalized && !unique.has(normalized.toLowerCase())) unique.set(normalized.toLowerCase(), normalized);
  }
  if (unique.size > MAX_TAGS_PER_CASE) {
    throw new RangeError(`Case types and additional tags are limited to ${MAX_TAGS_PER_CASE} combined values.`);
  }
  return [...unique.values()];
}

export function caseTypeSummary(tags: readonly string[]): string {
  const labels = caseTypeRecords(tags).map((item) => item.label);
  if (!labels.length) return '';
  if (labels.length <= 2) return labels.join(' and ');
  return `${labels.slice(0, 2).join(', ')} and ${labels.length - 2} more`;
}

function encodeCaseReference(value: bigint, minimumLength: number): string {
  let remainder = value;
  let encoded = '';
  do {
    encoded = CASE_REFERENCE_ALPHABET[Number(remainder % 32n)] + encoded;
    remainder /= 32n;
  } while (remainder > 0n);
  return encoded.padStart(minimumLength, '0');
}

/**
 * Returns an unambiguous reference derived injectively from the immutable Case
 * id. UUIDs use their complete 128-bit value. Legacy ids use every UTF-8 byte,
 * its encoded length and a distinct namespace, so no shared counter or server
 * is needed and imports retain the same reference.
 */
export function caseNumber(caseId: unknown): string {
  const id = typeof caseId === 'string' && caseId ? caseId : 'unknown';
  if (UUID_RE.test(id)) {
    return `WS-${encodeCaseReference(BigInt(`0x${id.replaceAll('-', '')}`), 26)}`;
  }
  const bytes = new TextEncoder().encode(id);
  let encoded = 0n;
  for (const byte of bytes) encoded = encoded * 256n + BigInt(byte);
  return `WS-L${encodeCaseReference(BigInt(bytes.length), 2)}-${encodeCaseReference(encoded, Math.ceil(bytes.length * 8 / 5))}`;
}

export function formattedCaseNumber(caseId: unknown): string {
  const value = caseNumber(caseId);
  if (value.startsWith('WS-L')) return value;
  const separator = value.indexOf('-');
  const prefix = value.slice(0, separator + 1);
  const body = value.slice(separator + 1);
  return `${prefix}${body.match(/.{1,5}/gu)?.join('-') ?? body}`;
}

export function normalizeCaseIncidentTargetUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) return null;
  const normalized = parsed.toString();
  const maximum = MAX_RESPONSE_RATIONALE_LENGTH - INCIDENT_TARGET_STATEMENT_PREFIX.length;
  return normalized.length <= maximum ? normalized : null;
}

export type CaseIncidentTarget = Readonly<{
  assertionId: string;
  url: string;
  state: CaseAssertionRecord['state'];
  createdAt: string;
  updatedAt: string;
}>;

export function caseIncidentTargets(
  record: Pick<CaseRecord, 'assertions'>,
  options: Readonly<{ includeResolved?: boolean }> = {},
): CaseIncidentTarget[] {
  const seen = new Set<string>();
  const targets: CaseIncidentTarget[] = [];
  for (const assertion of record.assertions) {
    if (!assertion.statement.startsWith(INCIDENT_TARGET_STATEMENT_PREFIX)) continue;
    if (!options.includeResolved && assertion.state !== 'open') continue;
    const url = normalizeCaseIncidentTargetUrl(assertion.statement.slice(INCIDENT_TARGET_STATEMENT_PREFIX.length));
    if (!url || seen.has(`${assertion.state}\u0000${url}`)) continue;
    seen.add(`${assertion.state}\u0000${url}`);
    targets.push({
      assertionId: assertion.id,
      url,
      state: assertion.state,
      createdAt: assertion.createdAt,
      updatedAt: assertion.updatedAt,
    });
    if (targets.length >= MAX_CASE_INCIDENT_TARGETS) break;
  }
  return targets;
}

export function caseIncidentTargetAssertion(value: unknown) {
  const url = normalizeCaseIncidentTargetUrl(value);
  if (!url) throw new Error('Enter an exact HTTP(S) incident URL without embedded credentials.');
  return {
    kind: 'unknown' as const,
    statement: `${INCIDENT_TARGET_STATEMENT_PREFIX}${url}`,
    rationale: 'Analyst-retained incident target for review and possible reporting. The URL alone does not establish infringement, abuse, ownership or platform responsibility.',
    evidenceRelations: [],
    state: 'open' as const,
  };
}

export function caseResponseIncidentUrls(record: CaseRecord): string[] {
  const urls = new Set(caseIncidentTargets(record).map((target) => target.url));
  const context = caseInvestigationContext(record);
  if (context?.urlRetention === 'exact') urls.add(context.incidentUrl);
  return [...urls].slice(0, MAX_CASE_INCIDENT_TARGETS);
}
