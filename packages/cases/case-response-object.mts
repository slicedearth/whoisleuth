// Explicit object scope, not ownership, collection or proof of remediation.
import { isValidAsciiHostname } from '../contracts/domain-name.mts';
import { OBJECT_RESPONSE_CASE_SCHEMA_VERSION } from '../contracts/case-portability.mts';
import { array, enumeration, exact, text } from '../evidence/artifact-structure.mts';
import type { CaseRecord } from './case-record-contracts.mts';

export const CASE_RESPONSE_OBJECT_KINDS = ['domain', 'hostname', 'page', 'redirect', 'advertisement', 'social_account', 'social_post', 'messaging', 'storefront', 'app', 'other'] as const;
export type CaseResponseObjectKind = typeof CASE_RESPONSE_OBJECT_KINDS[number];
export const CASE_RESPONSE_OBJECT_OUTCOMES = ['removed', 'restricted', 'suspended', 'delisted', 'warning', 'transferred', 'restored', 'disputed'] as const;
export type CaseResponseObjectOutcome = typeof CASE_RESPONSE_OBJECT_OUTCOMES[number];
export const MAX_CASE_RESPONSE_OBJECT_IDENTIFIER = 1_979;
export type CaseResponseObject = Readonly<{
  kind: CaseResponseObjectKind;
  identifier: string;
  incidentTargetId: string | null;
}>;

export function readCaseResponseObjects(value: unknown, sourceVersion?: number | null): readonly CaseResponseObject[] | undefined {
  if (value === undefined) return undefined;
  if (sourceVersion != null && sourceVersion < OBJECT_RESPONSE_CASE_SCHEMA_VERSION) throw new TypeError('Object-specific response scope requires Case schema 18 or later.');
  const objects = array(value, 'Response objects', 20).map(item => readCaseResponseObject(item, sourceVersion)!);
  const keyed = objects.map(object => [JSON.stringify(object), object] as const);
  if (new Set(keyed.map(([key]) => key)).size !== keyed.length) throw new TypeError('Response objects must be unique.');
  return Object.freeze(keyed.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([, object]) => object));
}

/** Historical absence stays absent; a declared historical format cannot carry new fields. */
export function readCaseResponseObject(value: unknown, sourceVersion?: number | null): CaseResponseObject | undefined {
  if (value === undefined) return undefined;
  if (sourceVersion != null && sourceVersion < OBJECT_RESPONSE_CASE_SCHEMA_VERSION) throw new TypeError('Object-specific response scope requires Case schema 18 or later.');
  const item = exact(value, ['kind', 'identifier', 'incidentTargetId'], 'Response object');
  const kind = enumeration(item.kind, CASE_RESPONSE_OBJECT_KINDS, 'Response object kind');
  const identifier = text(item.identifier, 'Response object identifier', MAX_CASE_RESPONSE_OBJECT_IDENTIFIER);
  if (!identifier || identifier.trim() !== identifier || /[\u0000-\u001f\u007f]/u.test(identifier)) throw new TypeError('Response object identifier must be a bounded single-line value.');
  const incidentTargetId = item.incidentTargetId === null ? null : text(item.incidentTargetId, 'Incident object identity', 64);
  if (incidentTargetId !== null && !/^[A-Za-z0-9_-]{1,64}$/u.test(incidentTargetId)) throw new TypeError('Incident object identity is invalid.');
  if (kind === 'domain' || kind === 'hostname') {
    if (identifier !== identifier.toLowerCase() || !isValidAsciiHostname(identifier) || incidentTargetId !== null) throw new TypeError('Domain and hostname scope require a normalised hostname and no incident-link identity.');
  } else {
    let url: URL;
    try { url = new URL(identifier); } catch { throw new TypeError('Select an exact retained HTTP(S) incident link for this object.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.toString() !== identifier || !incidentTargetId) throw new TypeError('Select an exact retained HTTP(S) incident link without credentials for this object.');
  }
  return Object.freeze({ kind, identifier, incidentTargetId });
}

export function readCaseResponseObjectOutcome(value: unknown, sourceVersion?: number | null): CaseResponseObjectOutcome | undefined {
  if (value === undefined) return undefined;
  if (sourceVersion != null && sourceVersion < OBJECT_RESPONSE_CASE_SCHEMA_VERSION) throw new TypeError('Object-specific outcomes require Case schema 18 or later.');
  return enumeration(value, CASE_RESPONSE_OBJECT_OUTCOMES, 'Response object outcome');
}

export function sameCaseResponseObject(left: CaseResponseObject | undefined, right: CaseResponseObject | undefined): boolean {
  return left !== undefined && right !== undefined && left.kind === right.kind && left.identifier === right.identifier && left.incidentTargetId === right.incidentTargetId;
}

/** New writes validate against the intended Case; retained snapshots are not re-adjudicated. */
export function assertCaseResponseObject(object: CaseResponseObject | undefined, record: Pick<CaseRecord, 'domain' | 'workflowMetadata'>): void {
  if (!object) return;
  if (object.kind === 'domain') {
    if (object.identifier !== record.domain) throw new TypeError('The response domain must match this Case.');
  } else if (object.kind === 'hostname') {
    if (object.identifier !== record.domain && !object.identifier.endsWith(`.${record.domain}`)) throw new TypeError('The response hostname must belong to this Case domain.');
  } else if (!record.workflowMetadata?.incidentTargets.some(target => target.id === object.incidentTargetId && target.url === object.identifier)) {
    throw new TypeError('The selected exact incident object changed or is not retained in this Case. Refresh and review it before saving.');
  }
}

export function assertCaseObjectOutcome(outcome: CaseResponseObjectOutcome | undefined, object: CaseResponseObject | undefined): void {
  if (!outcome) return;
  if (!object) throw new TypeError('A typed object outcome requires explicit object scope.');
  if (outcome === 'suspended' && object.kind !== 'domain') throw new TypeError('Domain suspension requires domain scope.');
  if (outcome === 'restricted' && object.kind !== 'social_account' && object.kind !== 'app' && object.kind !== 'other') throw new TypeError('Account restriction requires account, app or explicitly other scope.');
}

export function caseResponseObjectChoices(record: Pick<CaseRecord, 'domain' | 'workflowMetadata'> & Partial<Pick<CaseRecord, 'evidencePins' | 'evidenceHistory'>>) {
  const objects: CaseResponseObject[] = [{ kind: 'domain', identifier: record.domain, incidentTargetId: null }];
  const hosts = new Set([...(record.evidencePins ?? []).map(pin => pin.observationHostname), ...(record.evidenceHistory ?? []).map(snapshot => snapshot.inputHostname)].filter((value): value is string => Boolean(value)));
  for (const identifier of hosts) if (identifier === record.domain || identifier.endsWith(`.${record.domain}`)) objects.push({ kind: 'hostname', identifier, incidentTargetId: null });
  for (const target of record.workflowMetadata?.incidentTargets ?? []) for (const kind of CASE_RESPONSE_OBJECT_KINDS.filter(kind => kind !== 'domain' && kind !== 'hostname')) objects.push({ kind, identifier: target.url, incidentTargetId: target.id });
  return objects.map(object => ({ value: JSON.stringify(object), label: `${object.kind.replaceAll('_', ' ')} · ${object.identifier}`, object }));
}

export function selectedCaseResponseObject(record: Parameters<typeof caseResponseObjectChoices>[0], value: string): CaseResponseObject | undefined {
  if (!value) return undefined;
  const object = caseResponseObjectChoices(record).find(choice => choice.value === value)?.object;
  if (!object) throw new TypeError('The selected incident object changed. Refresh and review it before saving.');
  return readCaseResponseObject(object);
}
