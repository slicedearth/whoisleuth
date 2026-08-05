// Pure Brand Profile normalization and storage model. The browser wrapper owns
// persistence and downloads; this module owns schema migration, semantic field
// bounds, import merging, and exact serialized-byte accounting.

import { normalizeDomain } from './case-model.ts';
import { normalizePageBaseline } from './page-baseline.ts';
import type { PageBaseline } from './page-baseline.ts';
import { isInformativeFaviconHash } from './utils.ts';

export const BRAND_PROFILE_SCHEMA = 'whoisleuth.brand-profiles';
export const BRAND_PROFILE_SCHEMA_VERSION = 6;
export const MAX_PROFILES = 100;
export const MAX_PROFILE_VALUES = 200;
export const MAX_PROFILE_VALUE_INPUTS = MAX_PROFILE_VALUES * 4;
// Profiles share the origin's browser-storage quota with cases, campaigns,
// watchlists, and CT history. Fail at a predictable one-megabyte boundary.
export const MAX_PROFILE_STORE_BYTES = 1024 * 1024;
export const MAX_PROFILE_NAME_LENGTH = 100;
export const MAX_PROFILE_TEXT_LENGTH = 200;
export const MAX_PROFILE_DOMAIN_LENGTH = 253;
export const MAX_PROFILE_TLD_LENGTH = 63;
export const MAX_DKIM_SELECTOR_LENGTH = 253;
export const MAX_DKIM_SELECTORS = 10;
export const MAX_PROTECTION_ATTESTATIONS = 6;
export const MAX_DESIRED_POSTURE_BASELINES = 20;
export const MAX_DESIRED_POSTURE_RECORDS = 32;
export const MAX_DESIRED_POSTURE_SUPPRESSIONS = 12;
export const MAX_DESIRED_POSTURE_OBSERVATIONS = 12;
export const MAX_DESIRED_POSTURE_CHANGE_WINDOWS = 8;

const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
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
const DESIRED_POSTURE_FIELDS = new Set([
  'nameservers',
  'ds',
  'mx',
  'caa',
  'tls_issuer',
  'tls_san_patterns',
  'tls_spki',
  'registrar_lock',
  'renewal_review',
]);
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
  checks: Array<{
    id: string;
    status: 'danger' | 'info' | 'pass' | 'warning';
    records: string[];
  }>;
};
export type DesiredPostureChangeWindow = {
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

export type BrandProfile = {
  id: string;
  name: string;
  officialDomains: string[];
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
  officialFaviconHash: string;
  officialFaviconPHash: string;
  pageBaseline: PageBaseline | null;
  createdAt: string;
  updatedAt: string;
};

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
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function boundedText(value: unknown, maximum: number = MAX_PROFILE_TEXT_LENGTH): string {
  if (typeof value !== 'string' || CONTROL_RE.test(value)) return '';
  return value.slice(0, maximum * 4).replace(/\s+/g, ' ').trim().slice(0, maximum).trim();
}

function safeId(value: unknown): string | null {
  return typeof value === 'string' && SAFE_ID_RE.test(value) ? value : null;
}

function timestamp<T extends string | null>(value: unknown, fallback: T): string | T {
  if (typeof value === 'string' && value.length <= 64 && !CONTROL_RE.test(value)) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return fallback;
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
      expiresAt: timestamp(candidate.expiresAt, null),
      note: boundedText(candidate.note),
    });
    if (output.length >= MAX_PROTECTION_ATTESTATIONS) break;
  }
  return output;
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
  const observedAt = timestamp(candidate.observedAt, null);
  if (!observedAt || !Array.isArray(candidate.checks)) return null;
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
    checks.push({
      id,
      status: check.status as DesiredPostureObservation['checks'][number]['status'],
      records: normalizeDesiredPostureRecords(check.records),
    });
    if (checks.length >= 32) break;
  }
  return checks.length ? { observedAt, checks } : null;
}

function normalizeDesiredPostureObservationHistory(
  value: unknown,
  previous: DesiredPostureObservation | null,
): DesiredPostureObservation[] {
  const candidates = Array.isArray(value) ? value : previous ? [previous] : [];
  const byTime = new Map<string, DesiredPostureObservation>();
  for (const item of candidates.slice(0, MAX_DESIRED_POSTURE_OBSERVATIONS * 4)) {
    const normalized = normalizeDesiredPostureObservation(item);
    if (normalized) byTime.set(normalized.observedAt, normalized);
  }
  return [...byTime.values()]
    .sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt))
    .slice(-MAX_DESIRED_POSTURE_OBSERVATIONS);
}

function normalizeDesiredPostureChangeWindows(value: unknown): DesiredPostureChangeWindow[] {
  if (!Array.isArray(value)) return [];
  const output: DesiredPostureChangeWindow[] = [];
  for (const item of value.slice(0, MAX_DESIRED_POSTURE_CHANGE_WINDOWS * 4)) {
    const candidate = record(item);
    const startsAt = timestamp(candidate.startsAt, null);
    const endsAt = timestamp(candidate.endsAt, null);
    const summary = boundedText(candidate.summary, 300);
    if (!startsAt || !endsAt || Date.parse(endsAt) <= Date.parse(startsAt) || !summary) continue;
    output.push({ startsAt, endsAt, summary });
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

export function normalizeDesiredPostureBaselines(
  value: unknown,
  officialDomains: readonly string[],
  fallbackNow: unknown = new Date().toISOString(),
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
        expiresAt: timestamp(suppression.expiresAt, null),
      });
      if (suppressions.length >= MAX_DESIRED_POSTURE_SUPPRESSIONS) break;
    }
    seen.add(domain);
    const previousObservation = normalizeDesiredPostureObservation(candidate.previousObservation);
    const observationHistory = normalizeDesiredPostureObservationHistory(candidate.observationHistory, previousObservation);
    output.push({
      version: 1,
      domain,
      nameservers: normalizeDesiredPostureRecords(candidate.nameservers, (entry) => normalizeDomain(entry)),
      ds: normalizeDesiredPostureRecords(candidate.ds),
      mx: normalizeDesiredPostureRecords(candidate.mx),
      caa: normalizeDesiredPostureRecords(candidate.caa),
      tlsIssuer: boundedText(candidate.tlsIssuer, MAX_PROFILE_TEXT_LENGTH),
      tlsSanPatterns: normalizeTlsSanPatterns(candidate.tlsSanPatterns),
      tlsSpkiSha256: typeof candidate.tlsSpkiSha256 === 'string' && SHA256_RE.test(candidate.tlsSpkiSha256)
        ? candidate.tlsSpkiSha256.toLowerCase()
        : '',
      registrarLock: ['required', 'not_required'].includes(String(candidate.registrarLock))
        ? candidate.registrarLock as DesiredPostureBaseline['registrarLock']
        : 'unconfigured',
      renewalReviewAt: timestamp(candidate.renewalReviewAt, null),
      zoneIntent: ['active_service', 'defensive_registration', 'no_service', 'parked', 'redirect_only'].includes(String(candidate.zoneIntent))
        ? candidate.zoneIntent as DesiredPostureBaseline['zoneIntent']
        : 'unconfigured',
      lifecycle: ['active', 'change_planned', 'retiring', 'retired'].includes(String(candidate.lifecycle))
        ? candidate.lifecycle as DesiredPostureBaseline['lifecycle']
        : 'active',
      recoveryDependency: boundedText(candidate.recoveryDependency, 200),
      approvedChangeWindows: normalizeDesiredPostureChangeWindows(candidate.approvedChangeWindows),
      suppressions,
      note: boundedText(candidate.note, MAX_PROFILE_TEXT_LENGTH),
      previousObservation: observationHistory.at(-1) ?? previousObservation,
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
  const candidateBaseline = Object.prototype.hasOwnProperty.call(value, 'pageBaseline')
    ? normalizePageBaseline(value.pageBaseline)
    : normalizePageBaseline(existing?.pageBaseline);
  const pageBaseline = candidateBaseline && officialDomains.includes(candidateBaseline.domain)
    ? candidateBaseline
    : null;
  const profileId = safeId(existing?.id) || safeId(value.id) || (typeof options.makeId === 'function' ? safeId(options.makeId()) : null);
  const name = boundedText(value.name, MAX_PROFILE_NAME_LENGTH);
  if (!profileId || !name) return null;
  const createdAt = timestamp(existing?.createdAt, null) || timestamp(value.createdAt, now);
  return {
    id: profileId,
    name,
    officialDomains,
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
    ),
    trademarkOwner: boundedText(value.trademarkOwner),
    trademarkRegistration: boundedText(value.trademarkRegistration),
    officialFaviconHash: normalizeFaviconHash(value.officialFaviconHash),
    officialFaviconPHash: normalizeFaviconPHash(value.officialFaviconPHash),
    pageBaseline,
    createdAt,
    updatedAt: options.touch === true ? now : timestamp(value.updatedAt, createdAt),
  };
}

function profileList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const value = record(raw);
  return Array.isArray(value.profiles) ? value.profiles : [];
}

export function brandProfileStoreVersion(raw: unknown): number | null {
  if (Array.isArray(raw)) return 1;
  const value = record(raw);
  return typeof value.version === 'number' && Number.isFinite(value.version) && value.version > 0 ? value.version : null;
}

/** Normalize an internal profile collection or current stored envelope. */
export function normalizeBrandProfileStore(raw: unknown): BrandProfileStore {
  const byId = new Map<string, BrandProfile>();
  for (const item of profileList(raw).slice(0, MAX_PROFILES * 4)) {
    const profile = normalizeBrandProfile(item);
    if (!profile) continue;
    const previous = byId.get(profile.id);
    if (!previous || profile.updatedAt > previous.updatedAt) byId.set(profile.id, profile);
    if (byId.size >= MAX_PROFILES) break;
  }
  return { version: BRAND_PROFILE_SCHEMA_VERSION, profiles: [...byId.values()] };
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
  if (![2, 3, 4, 5, BRAND_PROFILE_SCHEMA_VERSION].includes(importedVersion ?? 0)) {
    throw new Error(`Expected a WHOISleuth Brand Profile export using schema 2, 3, 4, 5, or ${BRAND_PROFILE_SCHEMA_VERSION}.`);
  }
  const local = normalizeBrandProfileStore(localRaw).profiles;
  const byName = new Map(local.map((profile) => [profile.name.toLowerCase(), profile]));
  const input = profileList(importedRaw);
  let added = 0;
  let updated = 0;
  let skipped = Math.max(0, input.length - MAX_PROFILES * 4);
  for (const item of input.slice(0, MAX_PROFILES * 4)) {
    const rawName = boundedText(record(item).name, MAX_PROFILE_NAME_LENGTH);
    const existing = rawName ? byName.get(rawName.toLowerCase()) : null;
    const profile = normalizeBrandProfile(item, {
      existing,
      touch: true,
      nowIso: options.nowIso,
      makeId: options.makeId,
    });
    if (!profile) { skipped++; continue; }
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
