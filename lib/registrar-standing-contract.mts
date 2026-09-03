// Browser-safe contract for the registrar accreditation and compliance context
// attached to a Lookup response. The source catalogue and maintenance tooling
// remain server-side; this module validates only the small, attributed
// projection that crosses the HTTP and evidence-export boundaries.

import {
  isJsonObject,
  validBoundedString,
  type JsonObject,
} from './lookup-contract-primitives.mts';
import {
  ICANN_COMPLIANCE_SOURCE_URL,
  IANA_REGISTRAR_SOURCE_URL,
  registrarStandingOfficialSourceUrl,
} from './registrar-standing-catalogue-contract.mts';
import { defineSchemaCompatibility } from '../packages/contracts/schema-compatibility.mts';

export const REGISTRAR_STANDING_SCHEMA = 'whoisleuth.registrar-standing';
export const REGISTRAR_STANDING_VERSION = 1;
export const MAX_REGISTRAR_STANDING_BYTES = 32 * 1024;
export const MAX_REGISTRAR_COMPLIANCE_ACTIONS = 5;
export const MAX_REGISTRAR_STANDING_LIMITATIONS = 4;
export const MAX_REGISTRAR_STANDING_NEXT_ACTIONS = 4;
export const MAX_REGISTRAR_STANDING_TEXT_LENGTH = 360;

export const REGISTRAR_STANDING_COMPATIBILITY = defineSchemaCompatibility({
  id: 'derived.registrar-standing',
  kind: 'derived',
  schema: REGISTRAR_STANDING_SCHEMA,
  currentVersion: REGISTRAR_STANDING_VERSION,
  supportedVersions: [REGISTRAR_STANDING_VERSION],
  acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'reject',
  migration: 'exact_current_only',
  writeSemantics: 'read_only',
  byteBudget: MAX_REGISTRAR_STANDING_BYTES,
  owner: 'lib/registrar-standing-contract.mts',
  note: 'Bounded zero-request projection keeping official registrar accreditation, compliance actions, source health and limitations separately attributed.',
});

export const REGISTRAR_ACCREDITATION_STATES = Object.freeze([
  'accredited',
  'terminated',
  'reserved',
  'unknown',
] as const);
export const REGISTRAR_COMPLIANCE_ACTION_TYPES = Object.freeze([
  'breach',
  'suspension',
  'termination',
  'non_renewal',
] as const);
export const REGISTRAR_COMPLIANCE_STATES = Object.freeze([
  'matching_actions',
  'reviewed_no_match',
  'stale',
  'unavailable',
  'not_applicable',
] as const);
export const REGISTRAR_STANDING_ASSESSMENT_STATES = Object.freeze([
  'accredited',
  'notice_present',
  'terminated',
  'reserved',
  'unknown',
] as const);
export const REGISTRAR_STANDING_SOURCE_HEALTH_STATES = Object.freeze([
  'current',
  'stale',
  'unavailable',
] as const);

export type RegistrarAccreditationState = typeof REGISTRAR_ACCREDITATION_STATES[number];
export type RegistrarComplianceActionType = typeof REGISTRAR_COMPLIANCE_ACTION_TYPES[number];
export type RegistrarComplianceState = typeof REGISTRAR_COMPLIANCE_STATES[number];
export type RegistrarStandingAssessmentState = typeof REGISTRAR_STANDING_ASSESSMENT_STATES[number];
export type RegistrarStandingSourceHealthState = typeof REGISTRAR_STANDING_SOURCE_HEALTH_STATES[number];

export type RegistrarComplianceAction = Readonly<{
  noticeId: string;
  type: RegistrarComplianceActionType;
  issuedOn: string;
  sourceUrl: string;
  indexOutcome: string | null;
}>;

export type RegistrarStanding = Readonly<{
  schema: typeof REGISTRAR_STANDING_SCHEMA;
  version: typeof REGISTRAR_STANDING_VERSION;
  ianaId: string | null;
  accreditation: Readonly<{
    state: RegistrarAccreditationState;
    sourceUrl: string;
    observedAt: string | null;
    sourceHealth: RegistrarStandingSourceHealthState;
  }>;
  compliance: Readonly<{
    state: RegistrarComplianceState;
    sourceUrl: string;
    reviewedAt: string | null;
    catalogueYear: number | null;
    sourceHealth: RegistrarStandingSourceHealthState;
    actions: readonly RegistrarComplianceAction[];
    truncated: boolean;
  }>;
  assessment: Readonly<{
    state: RegistrarStandingAssessmentState;
    label: string;
    detail: string;
  }>;
  limitations: readonly string[];
  nextActions: readonly string[];
}>;

const ACCREDITATION_STATES = new Set<string>(REGISTRAR_ACCREDITATION_STATES);
const COMPLIANCE_ACTION_TYPES = new Set<string>(REGISTRAR_COMPLIANCE_ACTION_TYPES);
const COMPLIANCE_STATES = new Set<string>(REGISTRAR_COMPLIANCE_STATES);
const SOURCE_HEALTH_STATES = new Set<string>(REGISTRAR_STANDING_SOURCE_HEALTH_STATES);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
const NOTICE_ID_RE = /^notice-[1-9]\d{0,7}$/u;
const IANA_ID_RE = /^[1-9]\d{0,7}$/u;

function normalizedRegistrarIanaId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) value = String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^\d{1,8}$/u.test(trimmed) && Number(trimmed) > 0 ? String(Number(trimmed)) : null;
}

export function registrarIanaIds(...publications: readonly unknown[]): readonly string[] {
  const identifiers = new Set<string>();
  for (const publication of publications) {
    if (!isJsonObject(publication)) continue;
    const identifier = normalizedRegistrarIanaId(publication.registrarIanaId);
    if (identifier) identifiers.add(identifier);
  }
  return Object.freeze([...identifiers].sort((left, right) => Number(left) - Number(right)));
}

export function resolveRegistrarIanaId(...publications: readonly unknown[]): string | null {
  const identifiers = registrarIanaIds(...publications);
  return identifiers.length === 1 ? identifiers[0] ?? null : null;
}

function exactKeys(value: JsonObject, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validNullableTimestamp(value: unknown): boolean {
  return value === null || (typeof value === 'string'
    && value.length <= 64
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value);
}

function validNullableDate(value: unknown): boolean {
  return value === null || (typeof value === 'string'
    && ISO_DATE_RE.test(value)
    && new Date(`${value}T00:00:00.000Z`).toISOString().startsWith(value));
}

function validNullableText(value: unknown, maximum = MAX_REGISTRAR_STANDING_TEXT_LENGTH): boolean {
  return value === null || validBoundedString(value, maximum);
}

function validStringList(value: unknown, maximum: number): value is string[] {
  return Array.isArray(value)
    && value.length <= maximum
    && value.every((item) => validBoundedString(item, MAX_REGISTRAR_STANDING_TEXT_LENGTH))
    && new Set(value).size === value.length;
}

function validRegistrarComplianceAction(value: unknown): value is RegistrarComplianceAction {
  if (!isJsonObject(value) || !exactKeys(value, [
    'noticeId',
    'type',
    'issuedOn',
    'sourceUrl',
    'indexOutcome',
  ])) return false;
  if (typeof value.noticeId !== 'string') return false;
  return NOTICE_ID_RE.test(value.noticeId)
    && typeof value.type === 'string'
    && COMPLIANCE_ACTION_TYPES.has(value.type)
    && validNullableDate(value.issuedOn)
    && value.issuedOn !== null
    && registrarStandingOfficialSourceUrl(value.sourceUrl, 'icann_notice', value.noticeId) === value.sourceUrl
    && validNullableText(value.indexOutcome);
}

function sourceTimestampMatchesHealth(value: unknown, health: string): boolean {
  return health === 'unavailable' ? value === null : value !== null;
}

export function deriveRegistrarStandingAssessment(
  accreditationState: RegistrarAccreditationState,
  actions: readonly RegistrarComplianceAction[],
  health: RegistrarStandingSourceHealthState,
): RegistrarStanding['assessment'] {
  const termination = actions.find((action) => action.type === 'termination');
  if (health !== 'current') return Object.freeze({
    state: 'unknown',
    label: 'Current standing unavailable',
    detail: health === 'stale'
      ? 'The checked-in official-source catalogue is beyond its review age, so a current standing conclusion is unavailable.'
      : 'The checked-in official-source catalogue could not be validated, so a current standing conclusion is unavailable.',
  });
  if (accreditationState === 'reserved') return Object.freeze({
    state: 'reserved',
    label: 'Reserved IANA identifier',
    detail: 'IANA records this identifier as reserved rather than as an accredited registrar.',
  });
  if (accreditationState === 'terminated') return Object.freeze({
    state: 'terminated',
    label: 'Accreditation terminated',
    detail: termination
      ? 'IANA records the registrar as terminated and the current-year ICANN catalogue contains a termination notice.'
      : 'IANA records the registrar as terminated; the reviewed current-year notice catalogue may not contain the historical action.',
  });
  if (actions.length) return Object.freeze({
    state: 'notice_present',
    label: termination ? 'Official termination notice found' : 'Official compliance notice found',
    detail: termination && accreditationState === 'accredited'
      ? 'The reviewed IANA catalogue records the registrar as accredited while the current-year ICANN index contains a termination notice. Review the notice dates, scope and current outcome.'
      : `The reviewed ${new Set(actions.map((action) => action.type)).size === 1 ? actions[0]?.type.replaceAll('_', '-') : 'compliance'} notice catalogue contains ${actions.length} matching current-year action${actions.length === 1 ? '' : 's'}.`,
  });
  if (accreditationState === 'accredited') return Object.freeze({
    state: 'accredited',
    label: 'Accredited in reviewed catalogue',
    detail: 'IANA records the registrar as accredited, with no matching action in the reviewed current-year ICANN notice catalogue.',
  });
  return Object.freeze({
    state: 'unknown',
    label: 'Current standing unavailable',
    detail: 'The published registrar identifier could not be matched to the checked-in official-source catalogue.',
  });
}

export function validRegistrarStanding(value: unknown): value is RegistrarStanding {
  if (!isJsonObject(value) || !exactKeys(value, [
    'schema',
    'version',
    'ianaId',
    'accreditation',
    'compliance',
    'assessment',
    'limitations',
    'nextActions',
  ])) return false;
  if (value.schema !== REGISTRAR_STANDING_SCHEMA
    || value.version !== REGISTRAR_STANDING_VERSION
    || (value.ianaId !== null && (typeof value.ianaId !== 'string' || !IANA_ID_RE.test(value.ianaId)))
    || !isJsonObject(value.accreditation)
    || !isJsonObject(value.compliance)
    || !isJsonObject(value.assessment)) return false;

  const accreditation = value.accreditation;
  if (!exactKeys(accreditation, ['state', 'sourceUrl', 'observedAt', 'sourceHealth'])
    || typeof accreditation.state !== 'string'
    || !ACCREDITATION_STATES.has(accreditation.state)
    || accreditation.sourceUrl !== IANA_REGISTRAR_SOURCE_URL
    || !validNullableTimestamp(accreditation.observedAt)
    || typeof accreditation.sourceHealth !== 'string'
    || !SOURCE_HEALTH_STATES.has(accreditation.sourceHealth)) return false;

  const compliance = value.compliance;
  if (!exactKeys(compliance, [
    'state',
    'sourceUrl',
    'reviewedAt',
    'catalogueYear',
    'sourceHealth',
    'actions',
    'truncated',
  ])
    || typeof compliance.state !== 'string'
    || !COMPLIANCE_STATES.has(compliance.state)
    || compliance.sourceUrl !== ICANN_COMPLIANCE_SOURCE_URL
    || !validNullableTimestamp(compliance.reviewedAt)
    || (compliance.catalogueYear !== null
      && (!Number.isInteger(compliance.catalogueYear) || Number(compliance.catalogueYear) < 2000 || Number(compliance.catalogueYear) > 9999))
    || typeof compliance.sourceHealth !== 'string'
    || !SOURCE_HEALTH_STATES.has(compliance.sourceHealth)
    || !Array.isArray(compliance.actions)
    || compliance.actions.length > MAX_REGISTRAR_COMPLIANCE_ACTIONS
    || !compliance.actions.every(validRegistrarComplianceAction)
    || typeof compliance.truncated !== 'boolean') return false;

  const actions = compliance.actions as RegistrarComplianceAction[];
  const noticeIds = actions.map((action) => action.noticeId);
  const catalogueYear = compliance.catalogueYear as number | null;
  const actionsInOrder = actions.every((action, index) => {
    const previous = actions[index - 1];
    return !previous
      || previous.issuedOn > action.issuedOn
      || (previous.issuedOn === action.issuedOn && previous.noticeId > action.noticeId);
  });
  if (!sourceTimestampMatchesHealth(accreditation.observedAt, String(accreditation.sourceHealth))
    || !sourceTimestampMatchesHealth(compliance.reviewedAt, String(compliance.sourceHealth))
    || (compliance.sourceHealth === 'unavailable') !== (catalogueYear === null)
    || (accreditation.sourceHealth === 'unavailable' && accreditation.state !== 'unknown')
    || new Set(noticeIds).size !== noticeIds.length
    || !actionsInOrder
    || actions.some((action) => catalogueYear === null || Number(action.issuedOn.slice(0, 4)) !== catalogueYear)
    || actions.some((action) => compliance.reviewedAt !== null
      && Date.parse(`${action.issuedOn}T00:00:00.000Z`) > Date.parse(compliance.reviewedAt as string))
    || (compliance.truncated && actions.length !== MAX_REGISTRAR_COMPLIANCE_ACTIONS)) return false;

  if (value.ianaId === null) {
    if (accreditation.state !== 'unknown'
      || compliance.state !== 'not_applicable'
      || actions.length !== 0
      || compliance.truncated) return false;
  } else if (compliance.sourceHealth === 'unavailable') {
    if (compliance.state !== 'unavailable' || actions.length !== 0 || compliance.truncated) return false;
  } else if (actions.length > 0) {
    if (compliance.state !== 'matching_actions') return false;
  } else if (compliance.sourceHealth === 'stale') {
    if (compliance.state !== 'stale') return false;
  } else if (compliance.state !== 'reviewed_no_match') return false;

  const assessment = value.assessment;
  if (!validStringList(value.limitations, MAX_REGISTRAR_STANDING_LIMITATIONS)
    || !validStringList(value.nextActions, MAX_REGISTRAR_STANDING_NEXT_ACTIONS)
    || (actions.length === 0) !== (value.nextActions.length === 0)) return false;
  const combinedHealth: RegistrarStandingSourceHealthState = accreditation.sourceHealth === 'unavailable'
    || compliance.sourceHealth === 'unavailable'
    ? 'unavailable'
    : accreditation.sourceHealth === 'stale' || compliance.sourceHealth === 'stale'
      ? 'stale'
      : 'current';
  const expectedAssessment = deriveRegistrarStandingAssessment(
    accreditation.state as RegistrarAccreditationState,
    actions,
    combinedHealth,
  );
  return exactKeys(assessment, ['state', 'label', 'detail'])
    && assessment.state === expectedAssessment.state
    && assessment.label === expectedAssessment.label
    && assessment.detail === expectedAssessment.detail;
}

export function registrarStandingObservedBy(value: unknown, boundary: unknown): value is RegistrarStanding {
  if (!validRegistrarStanding(value)
    || typeof boundary !== 'string'
    || boundary.length > 64
    || !Number.isFinite(Date.parse(boundary))
    || new Date(boundary).toISOString() !== boundary) return false;
  const maximum = Date.parse(boundary);
  return [value.accreditation.observedAt, value.compliance.reviewedAt]
    .every((timestamp) => timestamp === null || Date.parse(timestamp) <= maximum);
}
