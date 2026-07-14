import { hammingDistanceHex, isInformativeFaviconHash } from './analysis/utils.js';
import {
  BRAND_PROFILE_SCHEMA_VERSION,
  brandProfileStoreVersion,
  buildBrandProfileExport,
  mergeBrandProfiles,
  normalizeBrandProfile,
  normalizeBrandProfileStore,
  serializeBrandProfileStore,
  MAX_PROFILES,
  MAX_PROFILE_VALUES,
} from './analysis/brand-profile-model.js';
import { normalizePageBaseline } from './analysis/page-baseline.js';

export const PROFILES_KEY = 'whois-rdap-brand-profiles-v1';
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

function readRaw(): unknown {
  const raw = localStorage.getItem(PROFILES_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function loadProfiles(): BrandProfile[] {
  try {
    return normalizeBrandProfileStore(readRaw()).profiles as BrandProfile[];
  } catch {
    return [];
  }
}

export function writeProfiles(profiles: BrandProfile[]) {
  let version: number | null = null;
  try { version = brandProfileStoreVersion(readRaw()); } catch { /* corrupt data can be replaced safely */ }
  if (version !== null && version > BRAND_PROFILE_SCHEMA_VERSION) {
    throw new Error('Brand profiles were created by a newer app version. Update the app before saving.');
  }
  const serialized = serializeBrandProfileStore(profiles);
  try { localStorage.setItem(PROFILES_KEY, serialized); }
  catch (cause) {
    if (cause instanceof Error && cause.message.startsWith('Brand profile storage is full')) throw cause;
    throw new Error('Could not save brand profiles. Browser storage may be full or unavailable.');
  }
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

export function activeProfile() {
  const active = activeProfileId();
  return loadProfiles().find((profile) => profile.id === active) || null;
}

export function profileDomainKind(domain: string, profile = activeProfile()): 'official' | 'partner' | 'allowlisted' | null {
  if (!profile || !domain) return null;
  const target = domain.trim().toLowerCase().replace(/\.$/, '');
  if (profile.officialDomains.some((value) => value.toLowerCase().replace(/\.$/, '') === target)) return 'official';
  if (profile.approvedPartnerDomains.some((value) => value.toLowerCase().replace(/\.$/, '') === target)) return 'partner';
  if (profile.allowlistedDomains.some((value) => value.toLowerCase().replace(/\.$/, '') === target)) return 'allowlisted';
  return null;
}

export function isDomainAllowlisted(domain: string, profile = activeProfile()) {
  return profileDomainKind(domain, profile) !== null;
}

export function profileSignals(domain: string, evidence: Record<string, any>, profile = activeProfile()) {
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

export function upsertProfile(raw: any, editingId = '') {
  const profiles = loadProfiles();
  const index = editingId ? profiles.findIndex((profile) => profile.id === editingId) : -1;
  const existing = index >= 0 ? profiles[index] : undefined;
  const profile = normalizeProfile(raw, existing, true);
  if (!profile.name) throw new Error('Enter a brand name.');
  if (index >= 0) profiles[index] = profile;
  else {
    if (profiles.length >= MAX_PROFILES) throw new Error(`Profiles are limited to ${MAX_PROFILES}.`);
    profiles.push(profile);
  }
  writeProfiles(profiles);
  setActiveProfile(profile.id);
  return profile;
}

export function deleteProfile(profileId: string) {
  writeProfiles(loadProfiles().filter((profile) => profile.id !== profileId));
  if (activeProfileId() === profileId) setActiveProfile('');
}

export function importProfiles(value: unknown) {
  const result = mergeBrandProfiles(loadProfiles(), value, { makeId: id });
  writeProfiles(result.profiles as BrandProfile[]);
  return { added: result.added, updated: result.updated, skipped: result.skipped };
}

export function exportProfiles() {
  let version: number | null = null;
  try { version = brandProfileStoreVersion(readRaw()); } catch { /* export normalized recovery */ }
  if (version !== null && version > BRAND_PROFILE_SCHEMA_VERSION) {
    throw new Error('Brand profiles were created by a newer app version. Update the app before exporting.');
  }
  const blob = new Blob([JSON.stringify(buildBrandProfileExport(loadProfiles()), null, 2)], { type: 'application/json' });
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
