// Pure Brand Profile normalization and storage model. The browser wrapper owns
// persistence and downloads; this module owns schema migration, semantic field
// bounds, import merging, and exact serialized-byte accounting.

import { normalizeDomain } from '../cases/case-model.mts';
import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';
import { canonicalDomainControlRecords, normalizeDeclaredDomainControlRecordModes, normalizeDomainControlRecordModes } from '../evidence/domain-control-runtime.mts';
import { DOMAIN_CONTROL_RECORD_LIST_FIELDS, type DomainControlRecordModes } from '../contracts/domain-control-manifest.mts';
import { latestObservationCohort } from '../evidence/latest-observations.mts';
import { MAX_IDENTITY_DIGEST_BYTES, sha256IdentityHex } from '../evidence/record-identity.mts';
import { DOMAIN_POSTURE_COMPARISON_VERSION, MAX_POSTURE_CHECKS, MAX_POSTURE_CHECK_RECORDS, MAX_POSTURE_RECORD_LENGTH, normalizeDomainPostureSourceContext, normalizeDomainPostureProfileContext, type DomainPostureProfileContext, type DomainPostureSourceContext } from '../evidence/domain-posture-context.mts';
import { normalizeOpaqueReferenceId } from '../cases/opaque-reference-id.mts';
import { normalizePageBaseline } from './page-baseline.mts';
import type { PageBaseline } from './page-baseline.mts';
import { isInformativePerceptualHash as isInformativeFaviconHash } from '../../lib/perceptual-hash-comparison.mts';
import { assertWorkspaceDeclaredVersion, assertWorkspaceInputGraph, assertWorkspacePortableVersion, ordinaryWorkspaceRecord } from './hostile-input.mts';
import {
  BRAND_PROFILE_SCHEMA,
  BRAND_PROFILE_SCHEMA_VERSION,
  MAX_DESIRED_POSTURE_BASELINES,
  MAX_DESIRED_POSTURE_CHANGE_WINDOWS,
  MAX_DESIRED_POSTURE_OBSERVATIONS,
  MAX_DESIRED_POSTURE_RECORDS,
  MAX_DESIRED_POSTURE_SUPPRESSIONS,
  MAX_DKIM_SELECTOR_LENGTH,
  MAX_DKIM_SELECTORS,
  MAX_OFFICIAL_CHANNELS,
  MAX_PROFILES,
  MAX_PROFILE_DOMAIN_LENGTH,
  MAX_PROFILE_NAME_LENGTH,
  MAX_PROFILE_STORE_BYTES,
  MAX_PROFILE_TEXT_LENGTH,
  MAX_PROFILE_TLD_LENGTH,
  MAX_PROFILE_URL_LENGTH,
  MAX_PROFILE_VALUE_INPUTS,
  MAX_PROFILE_VALUES,
  MAX_PROTECTION_ATTESTATIONS,
  MAX_RIGHTS_REFERENCES,
  SUPPORTED_BRAND_PROFILE_SCHEMA_VERSIONS,
} from '../contracts/workspace-portability.mts';

export {
  BRAND_PROFILE_SCHEMA,
  BRAND_PROFILE_SCHEMA_VERSION,
  MAX_DESIRED_POSTURE_BASELINES,
  MAX_DESIRED_POSTURE_CHANGE_WINDOWS,
  MAX_DESIRED_POSTURE_OBSERVATIONS,
  MAX_DESIRED_POSTURE_RECORDS,
  MAX_DESIRED_POSTURE_SUPPRESSIONS,
  MAX_DKIM_SELECTOR_LENGTH,
  MAX_DKIM_SELECTORS,
  MAX_OFFICIAL_CHANNELS,
  MAX_PROFILES,
  MAX_PROFILE_DOMAIN_LENGTH,
  MAX_PROFILE_NAME_LENGTH,
  MAX_PROFILE_STORE_BYTES,
  MAX_PROFILE_TEXT_LENGTH,
  MAX_PROFILE_TLD_LENGTH,
  MAX_PROFILE_URL_LENGTH,
  MAX_PROFILE_VALUE_INPUTS,
  MAX_PROFILE_VALUES,
  MAX_PROTECTION_ATTESTATIONS,
  MAX_RIGHTS_REFERENCES,
  SUPPORTED_BRAND_PROFILE_SCHEMA_VERSIONS,
} from '../contracts/workspace-portability.mts';

const SHA256_RE = /^[a-f0-9]{64}$/i;
const CONTROL_RE = /[\x00-\x1f\x7f]/;
const DNS_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const MAIL_PROFILES = new Set(['standard', 'defensive_no_mail', 'parked']);
export const PROTECTION_ATTESTATION_CONTROLS = Object.freeze([
  'registrar_mfa',
  'recovery_email_separation',
  'registry_lock',
  'emergency_contacts',
  'account_audit_logging',
  'zone_backups',
] as const);
const PROTECTION_ATTESTATION_CONTROL_SET = new Set<string>(PROTECTION_ATTESTATION_CONTROLS);
const PROTECTION_ATTESTATION_STATES = new Set([
  'observed',
  'not_observed',
  'needs_confirmation',
  'unavailable',
  'not_applicable',
]);
export const DESIRED_POSTURE_SUPPRESSION_FIELDS = Object.freeze([
  'nameservers',
  'ds',
  'mx',
  'caa',
  'tls_issuer',
  'tls_san_patterns',
  'tls_spki',
  'registrar_lock',
  'renewal_review',
] as const);
const DESIRED_POSTURE_FIELDS = new Set<string>(DESIRED_POSTURE_SUPPRESSION_FIELDS);
const POSTURE_CHECK_STATUSES = new Set(['danger', 'info', 'pass', 'warning']);

export type MailProtectionProfile = 'defensive_no_mail' | 'parked' | 'standard';
export type ProtectionAttestationControl = typeof PROTECTION_ATTESTATION_CONTROLS[number];
export type ProtectionAttestationState =
  | 'needs_confirmation'
  | 'not_applicable'
  | 'not_observed'
  | 'observed'
  | 'unavailable';
export type ProtectionAttestation = {
  control: ProtectionAttestationControl;
  state: ProtectionAttestationState;
  assertedAt: string;
  expiresAt: string | null;
  note: string;
};
export type DesiredPostureSuppression = {
  field: string;
  reason: string;
  expiresAt: string | null;
};
export type DesiredPostureObservation = {
  observedAt: string;
  context?: DomainPostureProfileContext;
  checks: Array<{
    id: string;
    status: 'danger' | 'info' | 'pass' | 'warning';
    records: string[];
    sourceContext?: DomainPostureSourceContext;
  }>;
  omittedChecks?: number;
};
export type DesiredPostureChangeWindow = {
  id: string;
  startsAt: string;
  endsAt: string;
  summary: string;
};
export type DesiredPostureBaseline = {
  version: 1;
  domain: string;
  nameservers: string[];
  ds: string[];
  mx: string[];
  caa: string[];
  recordModes?: Readonly<Partial<DomainControlRecordModes>>;
  tlsIssuer: string;
  tlsSanPatterns: string[];
  tlsSpkiSha256: string;
  registrarLock: 'required' | 'not_required' | 'unconfigured';
  renewalReviewAt: string | null;
  zoneIntent: 'active_service' | 'defensive_registration' | 'no_service' | 'parked' | 'redirect_only' | 'unconfigured';
  lifecycle: 'active' | 'change_planned' | 'retired' | 'retiring';
  recoveryDependency: string;
  approvedChangeWindows: DesiredPostureChangeWindow[];
  suppressions: DesiredPostureSuppression[];
  note: string;
  previousObservation: DesiredPostureObservation | null;
  observationHistory?: DesiredPostureObservation[];
  updatedAt: string;
};

export const OFFICIAL_CHANNEL_PLATFORMS = [
  'facebook',
  'instagram',
  'linkedin',
  'telegram',
  'tiktok',
  'x',
  'youtube',
  'other',
] as const;
export type OfficialChannelPlatform = typeof OFFICIAL_CHANNEL_PLATFORMS[number];
export type OfficialChannel = {
  platform: OfficialChannelPlatform;
  url: string;
  handle: string;
  role: string;
  reviewedAt: string | null;
};

export const RIGHTS_REFERENCE_KINDS = ['trademark', 'copyright', 'design', 'other'] as const;
export type RightsReferenceKind = typeof RIGHTS_REFERENCE_KINDS[number];
export type RightsReference = {
  kind: RightsReferenceKind;
  owner: string;
  identifier: string;
  jurisdiction: string;
  sourceUrl: string;
  reviewedAt: string | null;
  note: string;
};

export type BrandProfile = {
  id: string;
  name: string;
  officialDomains: string[];
  officialChannels: OfficialChannel[];
  productNames: string[];
  tlds: string[];
  approvedPartnerDomains: string[];
  allowlistedDomains: string[];
  allowlistedRegistrars: string[];
  dkimSelectors: string[];
  retiredDkimSelectors: string[];
  mailProtectionProfile: MailProtectionProfile;
  protectionAttestations: ProtectionAttestation[];
  desiredPostureBaselines: DesiredPostureBaseline[];
  trademarkOwner: string;
  trademarkRegistration: string;
  rightsReferences: RightsReference[];
  officialFaviconHash: string;
  officialFaviconPHash: string;
  pageBaseline: PageBaseline | null;
  createdAt: string;
  updatedAt: string;
};

export type BrandProfileFieldPatch = Partial<Pick<BrandProfile,
  | 'allowlistedDomains'
  | 'allowlistedRegistrars'
  | 'desiredPostureBaselines'
  | 'protectionAttestations'
>>;

export type BrandProfileStore = {
  version: typeof BRAND_PROFILE_SCHEMA_VERSION;
  profiles: BrandProfile[];
};

export type NormalizeBrandProfileOptions = {
  existing?: unknown;
  nowIso?: unknown;
  makeId?: unknown;
  touch?: unknown;
};

function record(value: unknown): Record<string, unknown> {
  return ordinaryWorkspaceRecord(value, 'Brand Profile input') ?? {};
}

function boundedText(value: unknown, maximum: number = MAX_PROFILE_TEXT_LENGTH): string {
  if (typeof value !== 'string' || CONTROL_RE.test(value)) return '';
  return value.slice(0, maximum * 4).replace(/\s+/g, ' ').trim().slice(0, maximum).trim();
}

export function normalizeBrandProfileId(value: unknown): string | null {
  return normalizeOpaqueReferenceId(value);
}

function timestamp<T extends string | null>(value: unknown, fallback: T): string | T {
  return normalizeExplicitIsoTimestamp(value) ?? fallback;
}

function calendarTimestamp<T extends string | null>(value: unknown, fallback: T): string | T {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return normalizeExplicitIsoTimestamp(`${value}T00:00:00Z`) ?? fallback;
  }
  return timestamp(value, fallback);
}

function normalizeTld(value: unknown): string {
  if (typeof value !== 'string' || CONTROL_RE.test(value)) return '';
  const tld = value.trim().toLowerCase().replace(/^\./, '');
  if (!tld || tld.length > MAX_PROFILE_TLD_LENGTH || !DNS_LABEL_RE.test(tld)) return '';
  return tld;
}

function normalizeSelector(value: unknown): string {
  if (typeof value !== 'string' || CONTROL_RE.test(value)) return '';
  const selector = value.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  if (!selector || selector.length > MAX_DKIM_SELECTOR_LENGTH) return '';
  return selector.split('.').every((label) => DNS_LABEL_RE.test(label)) ? selector : '';
}

function normalizeList(value: unknown, normalize: (item: unknown) => string): string[] {
  if (!Array.isArray(value)) return [];
  const values: string[] = [];
  const seen = new Set<string>();
  for (const item of value.slice(0, MAX_PROFILE_VALUE_INPUTS)) {
    const normalized = normalize(item);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(normalized);
    if (values.length >= MAX_PROFILE_VALUES) break;
  }
  return values;
}

export function normalizeProfileDomains(value: unknown): string[] {
  return normalizeList(value, (item) => {
    if (typeof item !== 'string' || item.length > MAX_PROFILE_DOMAIN_LENGTH) return '';
    return normalizeDomain(item);
  });
}

export function normalizeProfileTextValues(value: unknown): string[] {
  return normalizeList(value, (item) => boundedText(item));
}

export const MAX_ALLOWLIST_DRAFT_CHARACTERS = (MAX_PROFILE_DOMAIN_LENGTH + 2) * MAX_PROFILE_VALUE_INPUTS;

/** Admit the complete submitted list or leave the draft unchanged. */
export function addBrandAllowlistValues(
  profile: Pick<BrandProfile, 'officialDomains' | 'approvedPartnerDomains'>,
  kind: 'domains' | 'registrars',
  current: readonly string[],
  raw: string,
): string[] {
  if (raw.length > MAX_ALLOWLIST_DRAFT_CHARACTERS) throw new RangeError('The submitted allowlist text is too large.');
  const inputs = raw.split(/[\n,]+/u).map((item) => item.trim()).filter(Boolean);
  if (inputs.length > MAX_PROFILE_VALUE_INPUTS) throw new RangeError(`Review at most ${MAX_PROFILE_VALUE_INPUTS} entries at a time.`);
  const next = new Map(current.map((value) => [value.toLowerCase(), value]));
  const trusted = new Set([...profile.officialDomains, ...profile.approvedPartnerDomains]);
  for (const [index, input] of inputs.entries()) {
    const value = kind === 'domains' ? normalizeProfileDomains([input])[0] : normalizeProfileTextValues([input])[0];
    if (!value || (kind === 'registrars' && input.replace(/\s+/gu, ' ').length > MAX_PROFILE_TEXT_LENGTH)) {
      throw new TypeError(`Allowlist entry ${index + 1} is invalid or too long. No entries were added.`);
    }
    if (kind === 'domains' && trusted.has(value)) continue;
    if (!next.has(value.toLowerCase())) next.set(value.toLowerCase(), value);
  }
  if (next.size > MAX_PROFILE_VALUES) throw new RangeError(`This list would contain ${next.size} entries; the current profile supports ${MAX_PROFILE_VALUES}. No entries were added.`);
  if (next.size === current.length) throw new TypeError('No new entries remain after excluding existing and trusted values.');
  return [...next.values()];
}

export function normalizeProfileTlds(value: unknown): string[] {
  return normalizeList(value, normalizeTld);
}

export function normalizeDkimSelectors(value: unknown): string[] {
  return normalizeList(value, normalizeSelector).slice(0, MAX_DKIM_SELECTORS);
}

function normalizeMailProtectionProfile(value: unknown): MailProtectionProfile {
  return typeof value === 'string' && MAIL_PROFILES.has(value)
    ? value as MailProtectionProfile
    : 'standard';
}

export function normalizeProtectionAttestations(value: unknown): ProtectionAttestation[] {
  if (!Array.isArray(value)) return [];
  const output: ProtectionAttestation[] = [];
  const seen = new Set<string>();
  for (const item of value.slice(0, MAX_PROTECTION_ATTESTATIONS * 4)) {
    const candidate = record(item);
    if (
      typeof candidate.control !== 'string'
      || !PROTECTION_ATTESTATION_CONTROL_SET.has(candidate.control)
      || seen.has(candidate.control)
      || typeof candidate.state !== 'string'
      || !PROTECTION_ATTESTATION_STATES.has(candidate.state)
    ) {
      continue;
    }
    const assertedAt = timestamp(candidate.assertedAt, null);
    if (!assertedAt) continue;
    seen.add(candidate.control);
    output.push({
      control: candidate.control as ProtectionAttestationControl,
      state: candidate.state as ProtectionAttestationState,
      assertedAt,
      expiresAt: calendarTimestamp(candidate.expiresAt, null),
      note: boundedText(candidate.note),
    });
    if (output.length >= MAX_PROTECTION_ATTESTATIONS) break;
  }
  return output;
}

export type ProtectionAttestationReview = Omit<ProtectionAttestation, 'assertedAt'>;

/** Only submitted, validated reviews acquire a new analyst-review clock. */
export function reviewProtectionAttestations(
  existing: readonly ProtectionAttestation[],
  reviews: readonly ProtectionAttestationReview[],
  nowIso: string,
): ProtectionAttestation[] {
  const assertedAt = timestamp(nowIso, null);
  if (!assertedAt) throw new TypeError('The account-control review time is invalid.');
  if (reviews.length > MAX_PROTECTION_ATTESTATIONS) throw new RangeError('Too many account-control reviews were submitted.');
  const next = new Map(existing.map((item) => [item.control, { ...item }]));
  const seen = new Set<string>();
  for (const review of reviews) {
    if (!PROTECTION_ATTESTATION_CONTROL_SET.has(review.control) || seen.has(review.control)
      || !PROTECTION_ATTESTATION_STATES.has(review.state)) throw new TypeError('An account-control review is invalid or repeated.');
    const expiresAt = review.expiresAt === null ? null : timestamp(review.expiresAt, null);
    if (review.expiresAt !== null && !expiresAt) throw new TypeError('Enter a valid account-control expiry date.');
    if (typeof review.note !== 'string' || CONTROL_RE.test(review.note)
      || review.note.replace(/\s+/gu, ' ').trim().length > MAX_PROFILE_TEXT_LENGTH) throw new TypeError(`Account-control notes must contain at most ${MAX_PROFILE_TEXT_LENGTH} characters and no control characters.`);
    seen.add(review.control);
    next.set(review.control, { control: review.control, state: review.state, assertedAt, expiresAt, note: boundedText(review.note) });
  }
  return [...next.values()];
}

function normalizeDesiredPostureRecords(value: unknown, normalizer?: (value: unknown) => string): string[] {
  if (!Array.isArray(value)) return [];
  const output = new Set<string>();
  for (const item of value.slice(0, MAX_DESIRED_POSTURE_RECORDS * 4)) {
    const candidate = normalizer
      ? normalizer(item)
      : boundedText(item, 500);
    if (candidate) output.add(candidate);
    if (output.size >= MAX_DESIRED_POSTURE_RECORDS) break;
  }
  return [...output].sort();
}

function normalizeDesiredPostureObservation(value: unknown): DesiredPostureObservation | null {
  const candidate = record(value);
  const observedAt = normalizeExplicitIsoTimestamp(candidate.observedAt) ?? '';
  if (!Array.isArray(candidate.checks)) return null;
  const context = normalizeDomainPostureProfileContext(candidate.context);
  const checks: DesiredPostureObservation['checks'] = [];
  const seen = new Set<string>();
  for (const item of candidate.checks.slice(0, 64)) {
    const check = record(item);
    const id = boundedText(check.id, 64);
    if (
      !id
      || seen.has(id)
      || typeof check.status !== 'string'
      || !POSTURE_CHECK_STATUSES.has(check.status)
    ) continue;
    seen.add(id);
    if (check.sourceContext !== undefined && !Array.isArray(check.records)) throw new TypeError('Source-qualified posture records must be an array.');
    const inputRecords = Array.isArray(check.records) ? check.records : [];
    const records: string[] = [];
    for (const item of inputRecords.slice(0, MAX_POSTURE_CHECK_RECORDS)) {
      if (typeof item === 'string' && item.length <= MAX_POSTURE_RECORD_LENGTH && !CONTROL_RE.test(item)) records.push(item);
    }
    const omitted = Math.max(0, inputRecords.length - records.length);
    const source = normalizeDomainPostureSourceContext(check.sourceContext);
    const sourceContext = source && omitted ? {
      ...source,
      state: source.state === 'unavailable' ? 'unavailable' as const : 'partial' as const,
      omittedRecords: source.omittedRecords === null ? null : Math.min(Number.MAX_SAFE_INTEGER, source.omittedRecords + omitted),
    } : source;
    checks.push({
      id,
      status: check.status as DesiredPostureObservation['checks'][number]['status'],
      records,
      ...(sourceContext ? { sourceContext } : {}),
    });
    if (checks.length >= MAX_POSTURE_CHECKS) break;
  }
  const omittedChecks = Math.max(0, candidate.checks.length - checks.length)
    + (Number.isSafeInteger(candidate.omittedChecks) && Number(candidate.omittedChecks) > 0 ? Number(candidate.omittedChecks) : 0);
  return checks.length ? { observedAt, ...(context ? { context } : {}), checks, ...(omittedChecks ? { omittedChecks: Math.min(Number.MAX_SAFE_INTEGER, omittedChecks) } : {}) } : null;
}

export function normalizeDesiredPostureObservationHistory(
  value: unknown,
  previous: DesiredPostureObservation | null,
): DesiredPostureObservation[] {
  const candidates = Array.isArray(value) ? value : previous ? [previous] : [];
  const byTime = new Map<string, DesiredPostureObservation[]>();
  for (const item of candidates.slice(0, MAX_DESIRED_POSTURE_OBSERVATIONS * 4)) {
    const normalized = normalizeDesiredPostureObservation(item);
    if (!normalized) continue;
    if (new TextEncoder().encode(JSON.stringify(normalized)).byteLength > MAX_IDENTITY_DIGEST_BYTES) {
      throw new RangeError('Record identity exceeds its byte limit.');
    }
    const cohort = byTime.get(normalized.observedAt) ?? [];
    cohort.push(normalized);
    byTime.set(normalized.observedAt, cohort);
  }
  return [...byTime.entries()]
    .sort(([left], [right]) => !left ? 1 : !right ? -1 : Date.parse(left) - Date.parse(right))
    .flatMap(([, cohort]) => {
      // Different capture times already distinguish observations. Digest-based
      // deduplication and ordering remain necessary only within a tied cohort.
      if (cohort.length === 1) return cohort;
      const byIdentity = new Map(cohort.map((observation) => [desiredPostureObservationIdentity(observation), observation]));
      return [...byIdentity.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([, observation]) => observation);
    })
    .slice(-MAX_DESIRED_POSTURE_OBSERVATIONS);
}

export function desiredPostureObservationIdentity(observation: DesiredPostureObservation): string {
  return sha256IdentityHex(new TextEncoder().encode(JSON.stringify(observation)));
}

export function desiredPostureObservations(baseline: Pick<DesiredPostureBaseline, 'observationHistory' | 'previousObservation'>): readonly DesiredPostureObservation[] {
  return baseline.observationHistory?.length ? baseline.observationHistory : baseline.previousObservation ? [baseline.previousObservation] : [];
}

export function currentDesiredPostureObservation(baseline: Pick<DesiredPostureBaseline, 'observationHistory' | 'previousObservation'>) {
  const history = desiredPostureObservations(baseline);
  const cohort = latestObservationCohort(history, (item) => item.observedAt);
  return {
    observation: !cohort.undated.length && cohort.latest.length === 1 ? cohort.latest[0]! : null,
    candidates: [...cohort.latest, ...cohort.undated],
    limitation: cohort.undated.length ? 'Retained observations include an unknown capture time; no unique latest review is selected.'
      : cohort.latest.length > 1 ? 'Distinct observations share the latest capture time; no unique latest review is selected.' : null,
  };
}

export function brandPostureCollectionFingerprint(profile: Pick<BrandProfile, 'id' | 'officialDomains' | 'mailProtectionProfile' | 'dkimSelectors' | 'retiredDkimSelectors'>): string {
  return sha256IdentityHex(new TextEncoder().encode(JSON.stringify([
    profile.id, [...profile.officialDomains].sort(), profile.mailProtectionProfile,
    [...profile.dkimSelectors].sort(), [...profile.retiredDkimSelectors].sort(),
  ])));
}

export function brandPostureObservationContext(profile: BrandProfile, domain: string): DomainPostureProfileContext {
  if (!profile.officialDomains.includes(domain)) throw new TypeError('Posture observation target is not an official domain of this profile.');
  return { version: DOMAIN_POSTURE_COMPARISON_VERSION, domain, profileId: profile.id, profileFingerprint: brandPostureCollectionFingerprint(profile) };
}

function deterministicChangeWindowId(seed: string): string {
  const states = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  const factors = [0x01000193, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f];
  for (let index = 0; index < seed.length; index += 1) {
    const code = seed.charCodeAt(index);
    for (let stateIndex = 0; stateIndex < states.length; stateIndex += 1) {
      const state = states[stateIndex] ?? 0;
      const mixed = state ^ (code + Math.imul(index + 1, stateIndex + 17));
      states[stateIndex] = Math.imul(mixed, factors[stateIndex] ?? 0x01000193);
    }
  }
  return `cw-${states.map((state) => (state >>> 0).toString(16).padStart(8, '0')).join('')}`;
}

function normalizeDesiredPostureChangeWindows(
  value: unknown,
  identityScope = '',
): DesiredPostureChangeWindow[] {
  if (!Array.isArray(value)) return [];
  const output: DesiredPostureChangeWindow[] = [];
  const seenIds = new Set<string>();
  const duplicateMaterial = new Map<string, number>();
  for (const item of value.slice(0, MAX_DESIRED_POSTURE_CHANGE_WINDOWS * 4)) {
    const candidate = record(item);
    const startsAt = timestamp(candidate.startsAt, null);
    const endsAt = timestamp(candidate.endsAt, null);
    const summary = boundedText(candidate.summary, 300);
    if (!startsAt || !endsAt || Date.parse(endsAt) <= Date.parse(startsAt) || !summary) continue;
    const material = `${startsAt}\u001f${endsAt}\u001f${summary}`;
    const occurrence = duplicateMaterial.get(material) ?? 0;
    duplicateMaterial.set(material, occurrence + 1);
    let id = normalizeOpaqueReferenceId(candidate.id);
    let salt = 0;
    while (!id || seenIds.has(id)) {
      id = deterministicChangeWindowId(`${identityScope}\u001f${material}\u001f${occurrence}\u001f${salt}`);
      salt += 1;
    }
    seenIds.add(id);
    output.push({ id, startsAt, endsAt, summary });
    if (output.length >= MAX_DESIRED_POSTURE_CHANGE_WINDOWS) break;
  }
  return output.sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
}

function normalizeTlsSanPatterns(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const output = new Set<string>();
  for (const item of value.slice(0, MAX_DESIRED_POSTURE_RECORDS * 4)) {
    const candidate = boundedText(item, MAX_PROFILE_DOMAIN_LENGTH).toLowerCase().replace(/\.$/u, '');
    const wildcard = candidate.startsWith('*.');
    const normalized = normalizeDomain(wildcard ? candidate.slice(2) : candidate);
    if (!normalized) continue;
    output.add(wildcard ? `*.${normalized}` : normalized);
    if (output.size >= MAX_DESIRED_POSTURE_RECORDS) break;
  }
  return [...output].sort();
}

function normalizeBaselineRecords(candidate: Record<string, unknown>) {
  const records = {
    nameservers: normalizeDesiredPostureRecords(candidate.nameservers, (entry) => normalizeDomain(entry)),
    ds: normalizeDesiredPostureRecords(candidate.ds),
    mx: normalizeDesiredPostureRecords(candidate.mx),
    caa: normalizeDesiredPostureRecords(candidate.caa),
  };
  if (!Object.hasOwn(candidate, 'recordModes')) return records;
  const recordModes = normalizeDeclaredDomainControlRecordModes(candidate.recordModes);
  for (const field of DOMAIN_CONTROL_RECORD_LIST_FIELDS) {
    if (Object.hasOwn(recordModes, field)) records[field] = canonicalDomainControlRecords(candidate[field], field);
  }
  normalizeDomainControlRecordModes(recordModes, records);
  return { ...records, recordModes };
}

export function normalizeDesiredPostureBaselines(
  value: unknown,
  officialDomains: readonly string[],
  fallbackNow: unknown = new Date().toISOString(),
  identityScope = '',
): DesiredPostureBaseline[] {
  if (!Array.isArray(value)) return [];
  const allowedDomains = new Set(officialDomains);
  const output: DesiredPostureBaseline[] = [];
  const seen = new Set<string>();
  const fallback = timestamp(fallbackNow, new Date(0).toISOString());
  for (const item of value.slice(0, MAX_DESIRED_POSTURE_BASELINES * 4)) {
    const candidate = record(item);
    const domain = normalizeDomain(candidate.domain);
    if (!domain || !allowedDomains.has(domain) || seen.has(domain)) continue;
    const suppressions: DesiredPostureSuppression[] = [];
    const suppressionFields = new Set<string>();
    for (const rawSuppression of (Array.isArray(candidate.suppressions) ? candidate.suppressions : [])
      .slice(0, MAX_DESIRED_POSTURE_SUPPRESSIONS * 4)) {
      const suppression = record(rawSuppression);
      const field = boundedText(suppression.field, 40);
      const reason = boundedText(suppression.reason, MAX_PROFILE_TEXT_LENGTH);
      if (!DESIRED_POSTURE_FIELDS.has(field) || !reason || suppressionFields.has(field)) continue;
      suppressionFields.add(field);
      suppressions.push({
        field,
        reason,
        expiresAt: calendarTimestamp(suppression.expiresAt, null),
      });
      if (suppressions.length >= MAX_DESIRED_POSTURE_SUPPRESSIONS) break;
    }
    seen.add(domain);
    const previousObservation = normalizeDesiredPostureObservation(candidate.previousObservation);
    const observationHistory = normalizeDesiredPostureObservationHistory(candidate.observationHistory, previousObservation);
    output.push({
      version: 1,
      domain,
      ...normalizeBaselineRecords(candidate),
      tlsIssuer: boundedText(candidate.tlsIssuer, MAX_PROFILE_TEXT_LENGTH),
      tlsSanPatterns: normalizeTlsSanPatterns(candidate.tlsSanPatterns),
      tlsSpkiSha256: typeof candidate.tlsSpkiSha256 === 'string' && SHA256_RE.test(candidate.tlsSpkiSha256)
        ? candidate.tlsSpkiSha256.toLowerCase()
        : '',
      registrarLock: ['required', 'not_required'].includes(String(candidate.registrarLock))
        ? candidate.registrarLock as DesiredPostureBaseline['registrarLock']
        : 'unconfigured',
      renewalReviewAt: calendarTimestamp(candidate.renewalReviewAt, null),
      zoneIntent: ['active_service', 'defensive_registration', 'no_service', 'parked', 'redirect_only'].includes(String(candidate.zoneIntent))
        ? candidate.zoneIntent as DesiredPostureBaseline['zoneIntent']
        : 'unconfigured',
      lifecycle: ['active', 'change_planned', 'retiring', 'retired'].includes(String(candidate.lifecycle))
        ? candidate.lifecycle as DesiredPostureBaseline['lifecycle']
        : 'active',
      recoveryDependency: boundedText(candidate.recoveryDependency, 200),
      approvedChangeWindows: normalizeDesiredPostureChangeWindows(
        candidate.approvedChangeWindows,
        `${identityScope}\u001f${domain}`,
      ),
      suppressions,
      note: boundedText(candidate.note, MAX_PROFILE_TEXT_LENGTH),
      previousObservation: currentDesiredPostureObservation({ observationHistory, previousObservation }).observation,
      observationHistory,
      updatedAt: timestamp(candidate.updatedAt, fallback),
    });
    if (output.length >= MAX_DESIRED_POSTURE_BASELINES) break;
  }
  return output;
}

function normalizeFaviconHash(value: unknown): string {
  return typeof value === 'string' && SHA256_RE.test(value) ? value.toLowerCase() : '';
}

function normalizeFaviconPHash(value: unknown): string {
  return typeof value === 'string' && isInformativeFaviconHash(value) ? value.toLowerCase() : '';
}

function normalizePublicUrl(value: unknown): string {
  if (typeof value !== 'string' || CONTROL_RE.test(value) || value.length > MAX_PROFILE_URL_LENGTH * 2) return '';
  try {
    const parsed = new URL(value.trim());
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return '';
    const normalized = parsed.toString();
    return normalized.length <= MAX_PROFILE_URL_LENGTH ? normalized : '';
  } catch {
    return '';
  }
}

function normalizeOfficialChannels(value: unknown): OfficialChannel[] {
  if (!Array.isArray(value)) return [];
  const output = new Map<string, OfficialChannel>();
  for (const candidate of value.slice(0, MAX_OFFICIAL_CHANNELS * 4)) {
    const item = record(candidate);
    const platform = typeof item.platform === 'string'
      && (OFFICIAL_CHANNEL_PLATFORMS as readonly string[]).includes(item.platform)
      ? item.platform as OfficialChannelPlatform
      : null;
    const url = normalizePublicUrl(item.url);
    if (!platform || !url) continue;
    const key = url.toLowerCase();
    if (output.has(key)) continue;
    output.set(key, {
      platform,
      url,
      handle: boundedText(item.handle),
      role: boundedText(item.role),
      reviewedAt: timestamp(item.reviewedAt, null),
    });
    if (output.size >= MAX_OFFICIAL_CHANNELS) break;
  }
  return [...output.values()];
}

function normalizeRightsReferences(value: unknown): RightsReference[] {
  if (!Array.isArray(value)) return [];
  const output = new Map<string, RightsReference>();
  for (const candidate of value.slice(0, MAX_RIGHTS_REFERENCES * 4)) {
    const item = record(candidate);
    const kind = typeof item.kind === 'string' && (RIGHTS_REFERENCE_KINDS as readonly string[]).includes(item.kind)
      ? item.kind as RightsReferenceKind
      : null;
    const owner = boundedText(item.owner);
    const identifier = boundedText(item.identifier);
    if (!kind || (!owner && !identifier)) continue;
    const jurisdiction = boundedText(item.jurisdiction);
    const sourceUrl = item.sourceUrl == null || item.sourceUrl === '' ? '' : normalizePublicUrl(item.sourceUrl);
    if (item.sourceUrl && !sourceUrl) continue;
    const key = `${kind}\u0000${owner.toLowerCase()}\u0000${identifier.toLowerCase()}\u0000${jurisdiction.toLowerCase()}`;
    if (output.has(key)) continue;
    output.set(key, {
      kind,
      owner,
      identifier,
      jurisdiction,
      sourceUrl,
      reviewedAt: timestamp(item.reviewedAt, null),
      note: boundedText(item.note),
    });
    if (output.size >= MAX_RIGHTS_REFERENCES) break;
  }
  return [...output.values()];
}

/** Normalize one profile while retaining only known, bounded fields. */
export function normalizeBrandProfile(
  raw: unknown,
  options: NormalizeBrandProfileOptions = {},
): BrandProfile | null {
  const value = record(raw);
  const existing = options.existing ? record(options.existing) : null;
  const now = timestamp(options.nowIso, new Date().toISOString());
  const officialDomains = normalizeProfileDomains(value.officialDomains);
  const dkimSelectors = normalizeDkimSelectors(value.dkimSelectors);
  const suppliedBaseline = Object.prototype.hasOwnProperty.call(value, 'pageBaseline');
  const candidateBaseline = suppliedBaseline
    ? normalizePageBaseline(value.pageBaseline)
    : normalizePageBaseline(existing?.pageBaseline);
  const baselineDomainMismatch = suppliedBaseline && candidateBaseline !== null
    && !officialDomains.includes(candidateBaseline.domain);
  const pageBaseline = candidateBaseline && officialDomains.includes(candidateBaseline.domain)
    ? candidateBaseline
    : null;
  const profileId = normalizeBrandProfileId(existing?.id)
    || normalizeBrandProfileId(value.id)
    || (typeof options.makeId === 'function' ? normalizeBrandProfileId(options.makeId()) : null);
  const name = boundedText(value.name, MAX_PROFILE_NAME_LENGTH);
  if (!profileId || !name) return null;
  const createdAt = timestamp(existing?.createdAt, null) || timestamp(value.createdAt, now);
  return {
    id: profileId,
    name,
    officialDomains,
    officialChannels: normalizeOfficialChannels(value.officialChannels),
    productNames: normalizeProfileTextValues(value.productNames),
    tlds: normalizeProfileTlds(value.tlds),
    approvedPartnerDomains: normalizeProfileDomains(value.approvedPartnerDomains),
    allowlistedDomains: normalizeProfileDomains(value.allowlistedDomains),
    allowlistedRegistrars: normalizeProfileTextValues(value.allowlistedRegistrars),
    dkimSelectors,
    retiredDkimSelectors: normalizeDkimSelectors(value.retiredDkimSelectors)
      .filter((selector) => !dkimSelectors.includes(selector)),
    mailProtectionProfile: normalizeMailProtectionProfile(value.mailProtectionProfile),
    protectionAttestations: normalizeProtectionAttestations(value.protectionAttestations),
    desiredPostureBaselines: normalizeDesiredPostureBaselines(
      value.desiredPostureBaselines,
      officialDomains,
      now,
      profileId,
    ),
    trademarkOwner: boundedText(value.trademarkOwner),
    trademarkRegistration: boundedText(value.trademarkRegistration),
    rightsReferences: normalizeRightsReferences(value.rightsReferences),
    officialFaviconHash: baselineDomainMismatch ? '' : normalizeFaviconHash(value.officialFaviconHash),
    officialFaviconPHash: baselineDomainMismatch ? '' : normalizeFaviconPHash(value.officialFaviconPHash),
    pageBaseline,
    createdAt,
    updatedAt: options.touch === true ? now : timestamp(value.updatedAt, createdAt),
  };
}

const BRAND_PROFILE_FIELD_PATCH_KEYS = Object.freeze([
  'allowlistedDomains',
  'allowlistedRegistrars',
  'desiredPostureBaselines',
  'protectionAttestations',
] as const satisfies readonly (keyof BrandProfileFieldPatch)[]);

/**
 * Applies one field-owned edit to the transaction-current profile. Identity,
 * timestamps, and every field outside the explicit patch remain owned by that
 * current record rather than by the caller's potentially stale snapshot.
 */
export function applyBrandProfileFieldPatch(
  existing: BrandProfile,
  patch: BrandProfileFieldPatch,
  options: Pick<NormalizeBrandProfileOptions, 'nowIso'> = {},
): BrandProfile {
  const merged: Record<string, unknown> = { ...existing };
  const supplied = patch as Record<string, unknown>;
  for (const key of BRAND_PROFILE_FIELD_PATCH_KEYS) {
    if (Object.hasOwn(supplied, key)) merged[key] = supplied[key];
  }
  const normalized = normalizeBrandProfile(merged, {
    existing,
    nowIso: options.nowIso,
    touch: true,
  });
  if (!normalized) throw new Error('The Brand Profile field update is invalid.');
  return normalized;
}

function profileList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const value = record(raw);
  return Array.isArray(value.profiles) ? value.profiles : [];
}

export function brandProfileStoreVersion(raw: unknown): number | null {
  if (Array.isArray(raw)) return BRAND_PROFILE_SCHEMA_VERSION;
  const value = record(raw);
  return typeof value.version === 'number' && Number.isFinite(value.version) && value.version > 0 ? value.version : null;
}

/** Normalize an internal profile collection or current stored envelope. */
export function normalizeBrandProfileStore(raw: unknown): BrandProfileStore {
  assertWorkspaceInputGraph(raw, 'Brand Profile store', { maximumBytes: MAX_PROFILE_STORE_BYTES });
  assertWorkspaceDeclaredVersion(raw, 'Brand Profile store');
  const sourceVersion = brandProfileStoreVersion(raw);
  if (!Array.isArray(raw) && sourceVersion !== null
    && !SUPPORTED_BRAND_PROFILE_SCHEMA_VERSIONS.includes(sourceVersion)) {
    throw new Error(`Brand Profile schema ${sourceVersion} is unsupported; no data was changed.`);
  }
  const byId = new Map<string, BrandProfile>();
  for (const item of profileList(raw).slice(0, MAX_PROFILES * 4)) {
    const profile = normalizeBrandProfile(item, {
      nowIso: new Date(0).toISOString(),
    });
    if (!profile) continue;
    const previous = byId.get(profile.id);
    if (!previous || profile.updatedAt > previous.updatedAt) byId.set(profile.id, profile);
    if (byId.size >= MAX_PROFILES) break;
  }
  return { version: BRAND_PROFILE_SCHEMA_VERSION, profiles: [...byId.values()] };
}

/** New authored/imported records receive an identity only at the mutation boundary. */
export function createBrandProfileId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `bp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function serializeBrandProfileStore(profiles: unknown): string {
  return JSON.stringify(assertBrandProfileStoreBudget(profiles));
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function assertBrandProfileStoreBudget(profiles: unknown): BrandProfileStore {
  const store = normalizeBrandProfileStore(profiles);
  if (byteLength(JSON.stringify(store)) > MAX_PROFILE_STORE_BYTES) {
    throw new Error('Brand profile storage is full. Export and remove a profile before saving more.');
  }
  return store;
}

export function mergeBrandProfiles(
  localRaw: unknown,
  importedRaw: unknown,
  options: Pick<NormalizeBrandProfileOptions, 'nowIso' | 'makeId'> = {},
) {
  const local = normalizeBrandProfileStore(localRaw).profiles;
  assertWorkspaceInputGraph(importedRaw, 'Imported Brand Profile document', { maximumBytes: MAX_PROFILE_STORE_BYTES });
  assertWorkspacePortableVersion(importedRaw, BRAND_PROFILE_SCHEMA_VERSION, 'Imported Brand Profile document');
  const imported = record(importedRaw);
  if (imported.schema !== BRAND_PROFILE_SCHEMA) {
    throw new Error('This JSON file is not a WHOISleuth Brand Profile export.');
  }
  if (!Array.isArray(imported.profiles)) {
    throw new Error('Expected a current WHOISleuth Brand Profile export.');
  }
  const importedVersion = brandProfileStoreVersion(importedRaw);
  if (importedVersion !== null && importedVersion > BRAND_PROFILE_SCHEMA_VERSION) {
    throw new Error(`This Brand Profile file uses newer schema ${importedVersion}. Update the app before importing it.`);
  }
  if (!SUPPORTED_BRAND_PROFILE_SCHEMA_VERSIONS.includes(importedVersion ?? 0)) {
    throw new Error(`Expected a WHOISleuth Brand Profile export using schema ${SUPPORTED_BRAND_PROFILE_SCHEMA_VERSIONS.join(', ').replace(/, ([^,]+)$/u, ', or $1')}.`);
  }
  const idNames = new Map<string, string>();
  const retainIdName = (id: string, name: string): void => {
    const nameKey = name.toLowerCase();
    const previous = idNames.get(id);
    if (previous !== undefined && previous !== nameKey) {
      throw new Error('Brand Profile import reuses one exact identifier for different normalised profile names. No profiles were imported.');
    }
    idNames.set(id, nameKey);
  };
  for (const item of profileList(localRaw).slice(0, MAX_PROFILES * 4)) {
    const value = record(item);
    const id = normalizeBrandProfileId(value.id);
    const name = boundedText(value.name, MAX_PROFILE_NAME_LENGTH);
    if (id && name) retainIdName(id, name);
  }
  for (const profile of local) retainIdName(profile.id, profile.name);
  const byName = new Map(local.map((profile) => [profile.name.toLowerCase(), profile]));
  const input = profileList(importedRaw);
  let added = 0;
  let updated = 0;
  let skipped = Math.max(0, input.length - MAX_PROFILES * 4);
  for (const item of input.slice(0, MAX_PROFILES * 4)) {
    const value = record(item);
    const rawName = boundedText(value.name, MAX_PROFILE_NAME_LENGTH);
    const rawId = normalizeBrandProfileId(value.id);
    if (rawId && rawName) retainIdName(rawId, rawName);
    const existing = rawName ? byName.get(rawName.toLowerCase()) : null;
    const incomingUpdatedAt = timestamp(value.updatedAt, null);
    if (existing && (!incomingUpdatedAt || incomingUpdatedAt <= existing.updatedAt)) {
      skipped++;
      continue;
    }
    const profile = normalizeBrandProfile(item, {
      existing,
      touch: false,
      nowIso: options.nowIso,
      makeId: options.makeId,
    });
    if (!profile) { skipped++; continue; }
    retainIdName(profile.id, profile.name);
    if (existing) { byName.set(profile.name.toLowerCase(), profile); updated++; }
    else if (byName.size < MAX_PROFILES) { byName.set(profile.name.toLowerCase(), profile); added++; }
    else skipped++;
  }
  return { profiles: [...byName.values()], added, updated, skipped };
}

export function buildBrandProfileExport(profiles: unknown, nowIso: unknown = new Date().toISOString()) {
  return {
    schema: BRAND_PROFILE_SCHEMA,
    version: BRAND_PROFILE_SCHEMA_VERSION,
    exportedAt: timestamp(nowIso, new Date().toISOString()),
    profiles: normalizeBrandProfileStore(profiles).profiles,
  };
}
