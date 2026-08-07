import { sha256ArtifactDigest } from './artifact-integrity.ts';
import {
  buildUnsignedDomainControlPassport,
  DOMAIN_CONTROL_PASSPORT_INPUT_SCHEMA,
  DOMAIN_CONTROL_PASSPORT_VERSION,
  normalizeDomainControlPassportDocument,
  type DomainControlPassport,
  type DomainControlPassportEntry,
} from './domain-control-manifest-core.ts';
import {
  MAX_DESIRED_POSTURE_BASELINES,
  normalizeDesiredPostureBaselines,
  type BrandProfile,
  type DesiredPostureBaseline,
} from './brand-profile-model.ts';

export const MAX_DOMAIN_CONTROL_PASSPORT_BYTES = 256 * 1024;
export const DOMAIN_CONTROL_PASSPORT_FIELDS = Object.freeze([
  'nameservers',
  'ds',
  'mx',
  'caa',
  'tlsIssuer',
  'tlsSpkiSha256',
  'registrarLock',
  'renewalReviewAt',
] as const);

export type DomainControlPassportField = typeof DOMAIN_CONTROL_PASSPORT_FIELDS[number];
export type DomainControlPassportImportChoice = Readonly<{
  domain: string;
  addOfficialDomain: boolean;
  fields: readonly DomainControlPassportField[];
}>;

function passportEntry(baseline: DesiredPostureBaseline): DomainControlPassportEntry {
  return {
    domain: baseline.domain,
    nameservers: baseline.nameservers,
    ds: baseline.ds,
    mx: baseline.mx,
    caa: baseline.caa,
    tlsIssuer: baseline.tlsIssuer || null,
    tlsSpkiSha256: baseline.tlsSpkiSha256 || null,
    registrarLock: baseline.registrarLock === 'unconfigured' ? null : baseline.registrarLock,
    renewalReviewAt: baseline.renewalReviewAt,
    note: null,
  };
}

export function buildBrandProfilePassportInput(
  profile: BrandProfile,
  selectedDomains: readonly string[],
  expiresAt: string,
): Readonly<{
  schema: typeof DOMAIN_CONTROL_PASSPORT_INPUT_SCHEMA;
  version: typeof DOMAIN_CONTROL_PASSPORT_VERSION;
  expiresAt: string;
  entries: readonly DomainControlPassportEntry[];
}> {
  const selected = [...new Set(selectedDomains)].slice(0, MAX_DESIRED_POSTURE_BASELINES);
  if (!selected.length) throw new TypeError('Select at least one configured official-domain baseline.');
  const official = new Set(profile.officialDomains);
  const baselines = new Map(profile.desiredPostureBaselines.map((item) => [item.domain, item]));
  const entries = selected.map((domain) => {
    const baseline = baselines.get(domain);
    if (!official.has(domain) || !baseline) {
      throw new TypeError(`A selected domain does not have an official-domain baseline: ${domain}.`);
    }
    return passportEntry(baseline);
  });
  return Object.freeze({
    schema: DOMAIN_CONTROL_PASSPORT_INPUT_SCHEMA,
    version: DOMAIN_CONTROL_PASSPORT_VERSION,
    expiresAt,
    entries: Object.freeze(entries),
  });
}

export async function buildDomainControlPassport(
  input: unknown,
  generatedAt = new Date().toISOString(),
): Promise<DomainControlPassport> {
  const unsigned = buildUnsignedDomainControlPassport(input, generatedAt);
  return Object.freeze({
    ...unsigned,
    integrity: Object.freeze({
      algorithm: 'SHA-256',
      canonicalization: 'sorted-json-v1',
      digestSha256: await sha256ArtifactDigest(unsigned),
    }),
  });
}

export async function verifyDomainControlPassport(
  value: unknown,
  now = new Date().toISOString(),
): Promise<DomainControlPassport> {
  const normalized = normalizeDomainControlPassportDocument(value);
  if (await sha256ArtifactDigest(normalized.unsigned) !== normalized.manifest.integrity.digestSha256) {
    throw new TypeError('Domain control manifest failed its SHA-256 integrity check.');
  }
  const checkedAt = Date.parse(now);
  if (!Number.isFinite(checkedAt)) throw new TypeError('Passport verification time is invalid.');
  if (Date.parse(normalized.manifest.expiresAt) <= checkedAt) {
    throw new TypeError('Domain control passport has expired.');
  }
  return normalized.manifest;
}

function emptyBaseline(domain: string, updatedAt: string): DesiredPostureBaseline {
  return {
    version: 1,
    domain,
    nameservers: [],
    ds: [],
    mx: [],
    caa: [],
    tlsIssuer: '',
    tlsSanPatterns: [],
    tlsSpkiSha256: '',
    registrarLock: 'unconfigured',
    renewalReviewAt: null,
    zoneIntent: 'unconfigured',
    lifecycle: 'active',
    recoveryDependency: '',
    approvedChangeWindows: [],
    suppressions: [],
    note: '',
    previousObservation: null,
    observationHistory: [],
    updatedAt,
  };
}

function configured(entry: DomainControlPassportEntry, field: DomainControlPassportField): boolean {
  const value = entry[field];
  return Array.isArray(value) ? value.length > 0 : value !== null;
}

export function applyDomainControlPassport(
  profile: BrandProfile,
  passport: DomainControlPassport,
  choices: readonly DomainControlPassportImportChoice[],
  importedAt = new Date().toISOString(),
): BrandProfile {
  const choiceMap = new Map(choices.slice(0, MAX_DESIRED_POSTURE_BASELINES).map((item) => [item.domain, item]));
  const officialDomains = [...profile.officialDomains];
  const baselines = new Map(profile.desiredPostureBaselines.map((item) => [item.domain, item]));
  for (const entry of passport.entries) {
    const choice = choiceMap.get(entry.domain);
    if (!choice) continue;
    const isOfficial = officialDomains.includes(entry.domain);
    if (!isOfficial) {
      if (!choice.addOfficialDomain || officialDomains.length >= MAX_DESIRED_POSTURE_BASELINES) continue;
      officialDomains.push(entry.domain);
    }
    const selectedFields = new Set(choice.fields.filter((field) => DOMAIN_CONTROL_PASSPORT_FIELDS.includes(field)));
    const existing = baselines.get(entry.domain) ?? emptyBaseline(entry.domain, importedAt);
    let changed = false;
    const next = { ...existing };
    for (const field of DOMAIN_CONTROL_PASSPORT_FIELDS) {
      if (!selectedFields.has(field) || !configured(entry, field)) continue;
      changed = true;
      if (field === 'registrarLock') next.registrarLock = entry.registrarLock ?? 'unconfigured';
      else if (field === 'tlsIssuer') next.tlsIssuer = entry.tlsIssuer ?? '';
      else if (field === 'tlsSpkiSha256') next.tlsSpkiSha256 = entry.tlsSpkiSha256 ?? '';
      else if (field === 'renewalReviewAt') next.renewalReviewAt = entry.renewalReviewAt;
      else next[field] = [...entry[field]];
    }
    if (changed) baselines.set(entry.domain, { ...next, updatedAt: importedAt });
  }
  const normalizedBaselines = normalizeDesiredPostureBaselines([...baselines.values()], officialDomains, importedAt);
  return {
    ...profile,
    officialDomains,
    desiredPostureBaselines: normalizedBaselines,
    updatedAt: importedAt,
  };
}

export function passportConfiguredFields(entry: DomainControlPassportEntry): DomainControlPassportField[] {
  return DOMAIN_CONTROL_PASSPORT_FIELDS.filter((field) => configured(entry, field));
}
