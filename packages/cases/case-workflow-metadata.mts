// Typed analyst metadata; ordinary tags and assertions are always literal.
import { MAX_CASE_ASSERTIONS, MAX_RESPONSE_RATIONALE_LENGTH, MAX_CASE_OBJECTIVE_LENGTH } from '../contracts/case-portability.mts';
import type { CaseRecord, CasePatch } from './case-record-contracts.mts';
import { caseInvestigationContext, prepareCaseInvestigationContext, parseIncidentUrlContext, normalizeCaseObjective, type CaseInvestigationContext } from './case-incident-context.mts';
import { safeId, makeId } from './case-record-core.mts';
import { array, enumeration, exact, iso, text } from '../evidence/artifact-structure.mts';
import { assertWorkspaceInputGraph } from '../workspace/hostile-input.mts';

// Preserve the maximum URL previously admitted inside a 21-character label.
export const MAX_CASE_INCIDENT_TARGET_URL_LENGTH = MAX_RESPONSE_RATIONALE_LENGTH - 21;
export const MAX_CASE_INCIDENT_TARGETS = 20;
export const MAX_CASE_INCIDENT_TARGET_HISTORY = MAX_CASE_ASSERTIONS;

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

export function readCaseTypes(value: unknown): CaseTypeId[] {
  assertWorkspaceInputGraph(value, 'Case types');
  const selected = array(value, 'Case types', CASE_TYPES.length).map(id => {
    if (typeof id !== 'string' || !CASE_TYPE_IDS.has(id)) throw new TypeError('Unknown Case type.');
    return id as CaseTypeId;
  });
  if (new Set(selected).size !== selected.length) throw new TypeError('Case types must be unique.');
  return CASE_TYPES.map(item => item.id).filter(id => selected.includes(id));
}

export function caseTypeIds(record: Pick<CaseRecord, 'workflowMetadata'>): CaseTypeId[] {
  return [...(record.workflowMetadata?.types ?? [])];
}

export function caseTypeRecords(record: Pick<CaseRecord, 'workflowMetadata'>) {
  const selected = new Set(caseTypeIds(record));
  return CASE_TYPES.filter((item) => selected.has(item.id));
}

export function caseTypeSummary(record: Pick<CaseRecord, 'workflowMetadata'>): string {
  const labels = caseTypeRecords(record).map((item) => item.label);
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
  if (typeof value !== 'string' || value.length > MAX_CASE_INCIDENT_TARGET_URL_LENGTH || !value.trim()) return null;
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) return null;
  const normalized = parsed.toString();
  return normalized.length <= MAX_CASE_INCIDENT_TARGET_URL_LENGTH ? normalized : null;
}

export type CaseIncidentTarget = Readonly<{
  id: string;
  url: string;
  state: 'open' | 'resolved';
  createdAt: string;
  updatedAt: string;
}>;

/** Local review only: analyst link state is not independent observed coverage. */
export function buildCaseIncidentCoverage(record: Pick<CaseRecord, 'workflowMetadata'>): readonly Readonly<{
  target: CaseIncidentTarget;
  hostname: string;
  actionCoverage: 'unknown';
  observationCoverage: 'unknown';
}>[] {
  return caseIncidentTargets(record, { includeResolved: true }).map(target => ({
    target,
    hostname: new URL(target.url).hostname,
    actionCoverage: 'unknown',
    observationCoverage: 'unknown',
  }));
}

export type CaseWorkflowMetadata = {
  types: CaseTypeId[];
  incidentTargets: CaseIncidentTarget[];
  investigationContext: CaseInvestigationContext | null;
};

export function emptyCaseWorkflowMetadata(): CaseWorkflowMetadata {
  return { types: [], incidentTargets: [], investigationContext: null };
}

function identifier(value: unknown): string {
  const id = safeId(value);
  if (!id || id !== value) throw new TypeError('Case metadata identity is invalid.');
  return id;
}

/** Strict admission before persistence; no inferred defaults for typed fields. */
export function readCaseWorkflowMetadata(value: unknown, domain: string): CaseWorkflowMetadata | undefined {
  if (value === undefined) return undefined;
  assertWorkspaceInputGraph(value, 'Case workflow metadata');
  const row = exact(value, ['types', 'incidentTargets', 'investigationContext'], 'Case workflow metadata');
  const types = readCaseTypes(row.types);
  const incidentTargets = array(row.incidentTargets, 'Incident target history', MAX_CASE_INCIDENT_TARGET_HISTORY).map(raw => {
    const item = exact(raw, ['id', 'url', 'state', 'createdAt', 'updatedAt'], 'Incident target');
    const url = normalizeCaseIncidentTargetUrl(item.url);
    if (!url || url !== item.url) throw new TypeError('Incident target URL is invalid.');
    iso(item.createdAt, 'Incident target creation time');
    iso(item.updatedAt, 'Incident target update time');
    if (Date.parse(item.updatedAt as string) < Date.parse(item.createdAt as string)) throw new TypeError('Incident target update precedes creation.');
    return { id: identifier(item.id), url, state: enumeration(item.state, ['open', 'resolved'] as const, 'Incident target state'),
      createdAt: item.createdAt as string, updatedAt: item.updatedAt as string };
  });
  if (new Set(incidentTargets.map(item => item.id)).size !== incidentTargets.length) throw new TypeError('Incident target identities must be unique.');
  let investigationContext: CaseInvestigationContext | null = null;
  if (row.investigationContext !== null) {
    const item = exact(row.investigationContext, ['id', 'objective', 'incidentUrl', 'urlRetention', 'updatedAt'], 'Incident context');
    const objective = text(item.objective, 'Investigation objective', MAX_CASE_OBJECTIVE_LENGTH);
    if (!objective || normalizeCaseObjective(objective) !== objective) throw new TypeError('Investigation objective is invalid.');
    const parsed = parseIncidentUrlContext(item.incidentUrl);
    const urlRetention = enumeration(item.urlRetention, ['exact', 'origin_only'] as const, 'Incident URL retention');
    if (!parsed || parsed.registrableDomain !== domain
      || item.incidentUrl !== (urlRetention === 'exact' ? parsed.exactUrl : parsed.originUrl)) {
      throw new TypeError('Incident context URL does not match its Case domain or retention choice.');
    }
    iso(item.updatedAt, 'Incident context update time');
    investigationContext = { id: identifier(item.id), objective, incidentUrl: item.incidentUrl as string,
      urlRetention, updatedAt: item.updatedAt as string };
  }
  return { types, incidentTargets, investigationContext };
}

/** Mutations use the existing Case save coordinator and compare-and-swap rules. */
export function updateCaseWorkflowMetadata(current: CaseWorkflowMetadata, patch: CasePatch, domain: string, now: string): CaseWorkflowMetadata {
  const next = structuredClone(current);
  if (patch.caseTypes !== undefined) {
    if (patch.expectedCaseTypes !== undefined && JSON.stringify(readCaseTypes(patch.expectedCaseTypes)) !== JSON.stringify(current.types)) {
      throw new Error('The Case types changed after this edit was started. Reopen the Case before saving; your draft was not applied.');
    }
    next.types = readCaseTypes(patch.caseTypes);
  }
  if (patch.incidentTarget !== undefined) {
    const url = normalizeCaseIncidentTargetUrl(patch.incidentTarget);
    if (!url) throw new TypeError('Enter an exact HTTP(S) incident URL without embedded credentials.');
    if (next.incidentTargets.some(target => target.state === 'open' && target.url === url)) throw new Error('That exact incident URL is already active in this Case.');
    if (next.incidentTargets.filter(target => target.state === 'open').length >= MAX_CASE_INCIDENT_TARGETS) throw new Error(`A Case can retain at most ${MAX_CASE_INCIDENT_TARGETS} active incident links. Resolve one before adding another.`);
    if (next.incidentTargets.length >= MAX_CASE_INCIDENT_TARGET_HISTORY) throw new Error(`The retained incident link history is full (${MAX_CASE_INCIDENT_TARGET_HISTORY}). Export this Case and open another; no history was removed.`);
    next.incidentTargets.push({ id: makeId(), url, state: 'open', createdAt: now, updatedAt: now });
  }
  if (patch.incidentTargetResolution !== undefined) {
    const id = identifier(patch.incidentTargetResolution);
    const target = next.incidentTargets.find(item => item.id === id);
    if (!target || target.state !== 'open') throw new Error('That incident target is missing or already resolved. Refresh the Case before continuing.');
    next.incidentTargets = next.incidentTargets.map(item => item.id === id ? { ...item, state: 'resolved', updatedAt: now } : item);
  }
  if (patch.investigationContext !== undefined) {
    assertWorkspaceInputGraph(patch.investigationContext, 'New incident context');
    const raw = exact(patch.investigationContext, ['objective', 'incidentUrl', 'retainExactUrl'], 'New incident context');
    if (typeof raw.retainExactUrl !== 'boolean') throw new TypeError('Choose whether to retain the exact incident URL.');
    next.investigationContext = { ...prepareCaseInvestigationContext({ objective: raw.objective, incidentUrl: raw.incidentUrl, retainExactUrl: raw.retainExactUrl }),
      id: current.investigationContext?.id ?? makeId(), updatedAt: now };
  }
  return readCaseWorkflowMetadata(next, domain)!;
}

/** Add missing targets, retaining the newer state for an existing identity. */
export function mergeCaseWorkflowMetadata(local: CaseWorkflowMetadata, incoming: CaseWorkflowMetadata, importNewer: boolean, domain: string): CaseWorkflowMetadata {
  const targets = new Map(local.incidentTargets.map(target => [target.id, target]));
  for (const target of incoming.incidentTargets) {
    const existing = targets.get(target.id);
    if (existing && (existing.url !== target.url || existing.createdAt !== target.createdAt)) throw new TypeError('Imported incident target identity conflicts with retained history. No data was changed.');
    if (!existing || Date.parse(target.updatedAt) > Date.parse(existing.updatedAt)) targets.set(target.id, target);
  }
  const left = local.investigationContext, right = incoming.investigationContext;
  const investigationContext = right && (!left || Date.parse(right.updatedAt) > Date.parse(left.updatedAt)) ? right : left;
  return readCaseWorkflowMetadata({ types: importNewer ? incoming.types : local.types,
    incidentTargets: [...targets.values()], investigationContext }, domain)!;
}

export function caseIncidentTargets(
  record: Pick<CaseRecord, 'workflowMetadata'>,
  options: Readonly<{ includeResolved?: boolean }> = {},
): CaseIncidentTarget[] {
  return (record.workflowMetadata?.incidentTargets ?? [])
    .filter(target => options.includeResolved || target.state === 'open').map(target => ({ ...target }));
}

export function caseResponseIncidentUrls(record: CaseRecord): string[] {
  const urls = new Set(caseIncidentTargets(record).map((target) => target.url));
  const context = caseInvestigationContext(record);
  if (context?.urlRetention === 'exact') urls.add(context.incidentUrl);
  return [...urls].slice(0, MAX_CASE_INCIDENT_TARGETS);
}
