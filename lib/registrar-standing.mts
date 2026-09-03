// Offline registrar standing context keyed by the numeric IANA ID already
// published in registration evidence. This module never performs collection.
// Accreditation and compliance remain separate official-source observations;
// neither is treated as evidence that the looked-up domain is malicious.

import { createHash } from 'node:crypto';

import { REGISTRAR_STANDING_CATALOGUE } from './generated/registrar-standing-catalogue.mts';
import {
  ICANN_COMPLIANCE_SOURCE_URL,
  IANA_REGISTRAR_SOURCE_URL,
  REGISTRAR_STANDING_CATALOGUE_SCHEMA,
  REGISTRAR_STANDING_CATALOGUE_VERSION,
  REGISTRAR_STANDING_MAX_AGE_DAYS,
  REGISTRAR_STANDING_MAX_FUTURE_SKEW_MS,
  registrarStandingOfficialSourceUrl,
} from './registrar-standing-catalogue-contract.mts';
import {
  deriveRegistrarStandingAssessment,
  MAX_REGISTRAR_COMPLIANCE_ACTIONS,
  REGISTRAR_STANDING_SCHEMA,
  REGISTRAR_STANDING_VERSION,
  type RegistrarAccreditationState,
  type RegistrarComplianceAction,
  type RegistrarStanding,
  type RegistrarStandingSourceHealthState,
} from './registrar-standing-contract.mts';

type GeneratedNotice = Readonly<{
  noticeId: string;
  ianaId: number;
  type: 'breach' | 'suspension' | 'termination' | 'non_renewal';
  issuedOn: string;
  sourceUrl: string;
  indexOutcome: string | null;
}>;
type Catalogue = Readonly<{
  generatedAt: string;
  iana: Readonly<{
    sourceUrl: string;
    observedAt: string;
    normalizedSha256: string;
    rows: number;
    counts: Readonly<Record<'Accredited' | 'Reserved' | 'Terminated', number>>;
    encodedStatuses: string;
  }>;
  icann: Readonly<{
    sourceUrl: string;
    reviewedAt: string;
    catalogueYear: number;
    normalizedSha256: string;
    notices: readonly GeneratedNotice[];
  }>;
}>;
type BuildRegistrarStandingOptions = Readonly<{
  registrarIanaId: unknown;
  now?: Date;
  catalogue?: unknown;
}>;

const STATUS_BY_CODE = Object.freeze({
  A: 'accredited',
  R: 'reserved',
  T: 'terminated',
} satisfies Record<string, RegistrarAccreditationState>);
const SHA256_RE = /^[a-f0-9]{64}$/u;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
const NOTICE_ID_RE = /^notice-[1-9]\d{0,7}$/u;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f-\u009f]|\p{Default_Ignorable_Code_Point}/u;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 64
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function validDate(value: unknown): value is string {
  return typeof value === 'string'
    && ISO_DATE_RE.test(value)
    && new Date(`${value}T00:00:00.000Z`).toISOString().startsWith(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function ageDays(value: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(value)) / 86_400_000));
}

function sourceHealth(value: string, now: Date): RegistrarStandingSourceHealthState {
  return ageDays(value, now) <= REGISTRAR_STANDING_MAX_AGE_DAYS ? 'current' : 'stale';
}

function validatedCatalogue(value: unknown, now: Date): Catalogue | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const root = value as Record<string, unknown>;
  if (!exactKeys(root, ['schema', 'version', 'generatedAt', 'iana', 'icann'])
    || root.schema !== REGISTRAR_STANDING_CATALOGUE_SCHEMA
    || root.version !== REGISTRAR_STANDING_CATALOGUE_VERSION
    || !validTimestamp(root.generatedAt)
    || !root.iana
    || typeof root.iana !== 'object'
    || Array.isArray(root.iana)
    || !root.icann
    || typeof root.icann !== 'object'
    || Array.isArray(root.icann)) return null;
  const iana = root.iana as Record<string, unknown>;
  const icann = root.icann as Record<string, unknown>;
  if (!exactKeys(iana, ['sourceUrl', 'observedAt', 'normalizedSha256', 'rows', 'counts', 'encodedStatuses'])
    || !exactKeys(icann, ['sourceUrl', 'reviewedAt', 'catalogueYear', 'normalizedSha256', 'notices'])
    || iana.sourceUrl !== IANA_REGISTRAR_SOURCE_URL
    || !validTimestamp(iana.observedAt)
    || typeof iana.normalizedSha256 !== 'string'
    || !SHA256_RE.test(iana.normalizedSha256)
    || !Number.isInteger(iana.rows)
    || Number(iana.rows) < 1
    || Number(iana.rows) > 10_000
    || typeof iana.encodedStatuses !== 'string'
    || iana.encodedStatuses.length > 100_000
    || sha256(iana.encodedStatuses) !== iana.normalizedSha256
    || !iana.counts
    || typeof iana.counts !== 'object'
    || Array.isArray(iana.counts)
    || icann.sourceUrl !== ICANN_COMPLIANCE_SOURCE_URL
    || !validTimestamp(icann.reviewedAt)
    || icann.reviewedAt !== root.generatedAt
    || Date.parse(String(iana.observedAt)) > Date.parse(String(root.generatedAt))
    || Date.parse(String(root.generatedAt)) > now.getTime() + REGISTRAR_STANDING_MAX_FUTURE_SKEW_MS
    || !Number.isInteger(icann.catalogueYear)
    || Number(icann.catalogueYear) < 2000
    || Number(icann.catalogueYear) > 9999
    || typeof icann.normalizedSha256 !== 'string'
    || !SHA256_RE.test(icann.normalizedSha256)
    || !Array.isArray(icann.notices)
    || icann.notices.length > 500
    || sha256(JSON.stringify(icann.notices)) !== icann.normalizedSha256) return null;

  const counts = iana.counts as Record<string, unknown>;
  if (!exactKeys(counts, ['Accredited', 'Reserved', 'Terminated'])
    || Object.values(counts).some((count) => !Number.isInteger(count) || Number(count) < 0)) return null;
  const statusEntries = iana.encodedStatuses.split(',');
  if (statusEntries.length !== iana.rows) return null;
  let previousId = 0;
  const statusCounts = { Accredited: 0, Reserved: 0, Terminated: 0 };
  const registrarIds = new Set<number>();
  for (const entry of statusEntries) {
    const match = /^([1-9]\d{0,7}):([ART])$/u.exec(entry);
    if (!match || Number(match[1]) <= previousId) return null;
    previousId = Number(match[1]);
    registrarIds.add(previousId);
    if (match[2] === 'A') statusCounts.Accredited += 1;
    else if (match[2] === 'R') statusCounts.Reserved += 1;
    else statusCounts.Terminated += 1;
  }
  if (counts.Accredited !== statusCounts.Accredited
    || counts.Reserved !== statusCounts.Reserved
    || counts.Terminated !== statusCounts.Terminated) return null;
  const noticeIds = new Set<string>();
  let previousNotice: Readonly<{ issuedOn: string; noticeId: string }> | null = null;
  for (const candidate of icann.notices) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const notice = candidate as Record<string, unknown>;
    if (!exactKeys(notice, ['noticeId', 'ianaId', 'type', 'issuedOn', 'sourceUrl', 'indexOutcome'])
      || typeof notice.noticeId !== 'string'
      || !NOTICE_ID_RE.test(notice.noticeId)
      || noticeIds.has(notice.noticeId)
      || !Number.isInteger(notice.ianaId)
      || Number(notice.ianaId) < 1
      || Number(notice.ianaId) > 99_999_999
      || !registrarIds.has(Number(notice.ianaId))
      || !['breach', 'suspension', 'termination', 'non_renewal'].includes(String(notice.type))
      || !validDate(notice.issuedOn)
      || Number(notice.issuedOn.slice(0, 4)) !== Number(icann.catalogueYear)
      || Date.parse(`${String(notice.issuedOn)}T00:00:00.000Z`) > Date.parse(String(root.generatedAt))
      || registrarStandingOfficialSourceUrl(notice.sourceUrl, 'icann_notice', notice.noticeId) !== notice.sourceUrl
      || (notice.indexOutcome !== null
        && (typeof notice.indexOutcome !== 'string'
          || !notice.indexOutcome
          || notice.indexOutcome.length > 240
          || CONTROL_CHAR_RE.test(notice.indexOutcome)))) return null;
    if (previousNotice
      && (previousNotice.issuedOn < notice.issuedOn
        || (previousNotice.issuedOn === notice.issuedOn && previousNotice.noticeId < notice.noticeId))) return null;
    noticeIds.add(notice.noticeId);
    previousNotice = { issuedOn: notice.issuedOn, noticeId: notice.noticeId };
  }
  return value as Catalogue;
}

function accreditationMap(catalogue: Catalogue): Map<string, RegistrarAccreditationState> {
  const result = new Map<string, RegistrarAccreditationState>();
  for (const encoded of catalogue.iana.encodedStatuses.split(',')) {
    const [id, code] = encoded.split(':');
    const status = STATUS_BY_CODE[code as keyof typeof STATUS_BY_CODE];
    if (id && status) result.set(id, status);
  }
  return result;
}

function normalizedIanaId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) value = String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^\d{1,8}$/u.test(trimmed) && Number(trimmed) > 0 ? String(Number(trimmed)) : null;
}

function projectedActions(catalogue: Catalogue, ianaId: string): Readonly<{
  actions: readonly RegistrarComplianceAction[];
  truncated: boolean;
}> {
  const matching = catalogue.icann.notices.filter((notice) => String(notice.ianaId) === ianaId);
  const actions = matching.slice(0, MAX_REGISTRAR_COMPLIANCE_ACTIONS).map((notice): RegistrarComplianceAction => {
    return Object.freeze({
      noticeId: notice.noticeId,
      type: notice.type,
      issuedOn: notice.issuedOn,
      sourceUrl: notice.sourceUrl,
      indexOutcome: notice.indexOutcome,
    });
  });
  return Object.freeze({ actions: Object.freeze(actions), truncated: matching.length > actions.length });
}

export function buildRegistrarStanding(options: BuildRegistrarStandingOptions): RegistrarStanding {
  const now = options.now ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError('Registrar standing time must be valid.');
  const catalogue = validatedCatalogue(options.catalogue ?? REGISTRAR_STANDING_CATALOGUE, now);
  const ianaId = normalizedIanaId(options.registrarIanaId);
  const ianaHealth = catalogue ? sourceHealth(catalogue.iana.observedAt, now) : 'unavailable';
  const icannHealth = catalogue ? sourceHealth(catalogue.icann.reviewedAt, now) : 'unavailable';
  const accreditation = catalogue && ianaId
    ? accreditationMap(catalogue).get(ianaId) ?? 'unknown'
    : 'unknown';
  const projected = catalogue && ianaId
    ? projectedActions(catalogue, ianaId)
    : Object.freeze({ actions: Object.freeze([]), truncated: false });
  const combinedHealth: RegistrarStandingSourceHealthState = ianaHealth === 'unavailable' || icannHealth === 'unavailable'
    ? 'unavailable'
    : ianaHealth === 'stale' || icannHealth === 'stale'
      ? 'stale'
      : 'current';
  const assessment = deriveRegistrarStandingAssessment(accreditation, projected.actions, combinedHealth);
  const hasAction = projected.actions.length > 0;
  const limitations = [
    'Registrar standing describes the provider, not whether this domain is malicious, safe, owned, or controlled.',
    catalogue
      ? `The reviewed ${catalogue.icann.catalogueYear} ICANN index is not a complete enforcement history and excludes third-party allegations.`
      : 'The checked-in official-source catalogue could not be validated, so registrar standing is unavailable.',
    ...(!ianaId ? ['No single numeric registrar IANA ID was available across the registration evidence, so no registrar match was attempted.'] : []),
    ...(combinedHealth === 'stale' ? ['The catalogue is past its review-age threshold; current absence and accreditation conclusions require a refresh.'] : []),
  ].slice(0, 4);
  const nextActions = hasAction ? [
    'Open the official notice and verify its dates, scope, and current outcome before acting.',
    'Preserve current registration, transfer-status, delegation, and account-control evidence.',
    'Review authenticated registrar notifications and account activity through the provider control plane.',
    'Recheck the registrar IANA ID and domain transfer status during follow-up.',
  ] : [];
  return Object.freeze({
    schema: REGISTRAR_STANDING_SCHEMA,
    version: REGISTRAR_STANDING_VERSION,
    ianaId,
    accreditation: Object.freeze({
      state: accreditation,
      sourceUrl: IANA_REGISTRAR_SOURCE_URL,
      observedAt: catalogue?.iana.observedAt ?? null,
      sourceHealth: ianaHealth,
    }),
    compliance: Object.freeze({
      state: !ianaId
        ? 'not_applicable'
        : !catalogue
          ? 'unavailable'
          : projected.actions.length
            ? 'matching_actions'
            : icannHealth === 'stale'
              ? 'stale'
              : 'reviewed_no_match',
      sourceUrl: ICANN_COMPLIANCE_SOURCE_URL,
      reviewedAt: catalogue?.icann.reviewedAt ?? null,
      catalogueYear: catalogue?.icann.catalogueYear ?? null,
      sourceHealth: icannHealth,
      actions: projected.actions,
      truncated: projected.truncated,
    }),
    assessment,
    limitations: Object.freeze(limitations),
    nextActions: Object.freeze(nextActions),
  });
}

export function registrarStandingCatalogueHealth(now = new Date(), value: unknown = REGISTRAR_STANDING_CATALOGUE) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError('Registrar standing health time must be valid.');
  const catalogue = validatedCatalogue(value, now);
  if (!catalogue) return Object.freeze({
    state: 'unavailable' as const,
    sourceObservedAt: null,
    ageDays: null,
    itemCount: null,
    detail: 'The checked-in registrar standing catalogue failed its schema or digest checks.',
  });
  const age = Math.max(ageDays(catalogue.iana.observedAt, now), ageDays(catalogue.icann.reviewedAt, now));
  return Object.freeze({
    state: age <= REGISTRAR_STANDING_MAX_AGE_DAYS ? 'current' as const : 'stale' as const,
    sourceObservedAt: [catalogue.iana.observedAt, catalogue.icann.reviewedAt]
      .sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null,
    ageDays: age,
    itemCount: catalogue.iana.rows + catalogue.icann.notices.length,
    detail: `${catalogue.iana.rows.toLocaleString('en')} IANA registrar IDs and ${catalogue.icann.notices.length} ${catalogue.icann.catalogueYear} ICANN notices passed local digest and shape checks.`,
  });
}
