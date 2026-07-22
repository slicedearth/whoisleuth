import { hammingDistanceHex, isInformativeFaviconHash } from './analysis/utils.js';
import {
  buildBrandProfileExport,
  mergeBrandProfiles,
  normalizeBrandProfile,
  serializeBrandProfileStore,
  MAX_PROFILES,
  MAX_PROFILE_VALUES,
} from './analysis/brand-profile-model.js';
import { normalizePageBaseline } from './analysis/page-baseline.js';
import { browserLocalDataProvider } from './browser-local-data-service.js';
import { LEGACY_PROFILES_KEY, PROFILES_COLLECTION } from './browser-local-data-definitions.js';

export const PROFILES_KEY = LEGACY_PROFILES_KEY;
export const ACTIVE_PROFILE_KEY = 'whois-rdap-active-brand-profile-v1';
export const MAX_PROFILE_IMPORT_BYTES = 2 * 1024 * 1024;

export type PageBaseline = ReturnType<typeof normalizePageBaseline>;
export interface BrandProfile {
  id: string;
  name: string;
  officialDomains: string[];
  productNames: string[];
  tlds: string[];
  approvedPartnerDomains: string[];
  allowlistedDomains: string[];
  allowlistedRegistrars: string[];
  dkimSelectors: string[];
  trademarkOwner: string;
  trademarkRegistration: string;
  officialFaviconHash: string;
  officialFaviconPHash: string;
  pageBaseline: PageBaseline;
  createdAt: string;
  updatedAt: string;
}

const id = () => crypto.randomUUID ? crypto.randomUUID() : `bp-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function normalizeProfile(raw: any, existing?: BrandProfile, touch = false): BrandProfile {
  const profile = normalizeBrandProfile(raw, { existing, touch, makeId: id });
  if (!profile) throw new Error('Enter a brand name.');
  return profile as BrandProfile;
}

export async function loadProfiles(): Promise<BrandProfile[]> {
  return (await browserLocalDataProvider()).read(PROFILES_COLLECTION) as Promise<BrandProfile[]>;
}

function boundedProfiles(profiles: BrandProfile[]): BrandProfile[] {
  return JSON.parse(serializeBrandProfileStore(profiles)).profiles as BrandProfile[];
}

export async function writeProfiles(profiles: BrandProfile[]): Promise<void> {
  await (await browserLocalDataProvider()).update(PROFILES_COLLECTION, () => ({ document: boundedProfiles(profiles), result: undefined }));
}

export function activeProfileId() {
  return localStorage.getItem(ACTIVE_PROFILE_KEY) || '';
}

export function setActiveProfile(profileId: string) {
  try {
    if (profileId) localStorage.setItem(ACTIVE_PROFILE_KEY, profileId);
    else localStorage.removeItem(ACTIVE_PROFILE_KEY);
  } catch {
    throw new Error('Could not set the active profile. Browser storage may be full or unavailable.');
  }
}

export async function activeProfile(): Promise<BrandProfile | null> {
  const active = activeProfileId();
  return (await loadProfiles()).find((profile) => profile.id === active) || null;
}

export function profileDomainKind(domain: string, profile: BrandProfile | null = null): 'official' | 'partner' | 'allowlisted' | null {
  if (!profile || !domain) return null;
  const target = domain.trim().toLowerCase().replace(/\.$/, '');
  if (profile.officialDomains.some((value) => value.toLowerCase().replace(/\.$/, '') === target)) return 'official';
  if (profile.approvedPartnerDomains.some((value) => value.toLowerCase().replace(/\.$/, '') === target)) return 'partner';
  if (profile.allowlistedDomains.some((value) => value.toLowerCase().replace(/\.$/, '') === target)) return 'allowlisted';
  return null;
}

export function isDomainAllowlisted(domain: string, profile: BrandProfile | null = null) {
  return profileDomainKind(domain, profile) !== null;
}

export function profileSignals(domain: string, evidence: Record<string, any>, profile: BrandProfile | null = null) {
  const trusted = profileDomainKind(domain, profile);
  if (!profile || trusted) return { trusted, faviconMatch: false, faviconNearMatch: false, reusesOfficialAssets: false };
  const exact = Boolean(evidence.faviconHash && profile.officialFaviconHash && evidence.faviconHash === profile.officialFaviconHash);
  const left = evidence.faviconPHash;
  const right = profile.officialFaviconPHash;
  const distance = isInformativeFaviconHash(left) && isInformativeFaviconHash(right) ? hammingDistanceHex(left, right) : null;
  const official = new Set(profile.officialDomains.map((value) => value.toLowerCase().replace(/\.$/, '')));
  const reused = Array.isArray(evidence.externalAssetHosts)
    && evidence.externalAssetHosts.some((host: string) => official.has(String(host).toLowerCase().replace(/\.$/, '')));
  return { trusted: null, faviconMatch: exact, faviconNearMatch: !exact && distance !== null && distance <= 8, reusesOfficialAssets: reused };
}

export async function upsertProfile(raw: any, editingId = ''): Promise<BrandProfile> {
  const profile = await (await browserLocalDataProvider()).update(PROFILES_COLLECTION, (current) => {
    const profiles = [...current] as BrandProfile[];
    const index = editingId ? profiles.findIndex((item) => item.id === editingId) : -1;
    const existing = index >= 0 ? profiles[index] : undefined;
    const normalized = normalizeProfile(raw, existing, true);
    if (!normalized.name) throw new Error('Enter a brand name.');
    if (index >= 0) profiles[index] = normalized;
    else {
      if (profiles.length >= MAX_PROFILES) throw new Error(`Profiles are limited to ${MAX_PROFILES}.`);
      profiles.push(normalized);
    }
    return { document: boundedProfiles(profiles), result: normalized };
  });
  setActiveProfile(profile.id);
  return profile;
}

export async function deleteProfile(profileId: string): Promise<void> {
  await (await browserLocalDataProvider()).update(PROFILES_COLLECTION, (current) => ({
    document: boundedProfiles((current as BrandProfile[]).filter((profile) => profile.id !== profileId)),
    result: undefined,
  }));
  if (activeProfileId() === profileId) setActiveProfile('');
}

export async function importProfiles(value: unknown) {
  return (await browserLocalDataProvider()).update(PROFILES_COLLECTION, (current) => {
    const result = mergeBrandProfiles(current, value, { makeId: id });
    return {
      document: boundedProfiles(result.profiles as BrandProfile[]),
      result: { added: result.added, updated: result.updated, skipped: result.skipped },
    };
  });
}

export async function exportProfiles() {
  const blob = new Blob([JSON.stringify(buildBrandProfileExport(await loadProfiles()), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `whoisleuth-brand-profiles-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function parseList(raw: string, lower = false) {
  return [...new Set(raw.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean).map((value) => lower ? value.toLowerCase() : value))].slice(0, MAX_PROFILE_VALUES);
}
