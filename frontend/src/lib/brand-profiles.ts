import { hammingDistanceHex, isInformativeFaviconHash } from './analysis/utils.ts';
import {
  buildBrandProfileExport,
  mergeBrandProfiles,
  normalizeBrandProfile,
  serializeBrandProfileStore,
  MAX_PROFILES,
  MAX_PROFILE_VALUES,
  normalizeBrandProfileId,
} from './analysis/brand-profile-model.ts';
import type {
  DesiredPostureBaseline,
  MailProtectionProfile,
  ProtectionAttestation,
} from './analysis/brand-profile-model.ts';
import { normalizePageBaseline } from './analysis/page-baseline.ts';
import { readBrowserLocalData, updateBrowserLocalData } from './browser-local-data-service.ts';
import { BrowserLocalDataError } from './browser-local-data.ts';
import { LEGACY_PROFILES_KEY } from './browser-local-data-contract.ts';
import { serialiseWorkspacePortableJson } from '../../../packages/contracts/workspace-portability.mts';
export { MAX_PROFILE_IMPORT_BYTES } from '../../../packages/contracts/workspace-portability.mts';

export const PROFILES_KEY = LEGACY_PROFILES_KEY;
export const ACTIVE_PROFILE_KEY = 'whois-rdap-active-brand-profile-v1';
export type ActiveBrandProfileSourceState = 'loading' | 'ready' | 'unavailable';

export class BrandProfileMutationCommittedError extends BrowserLocalDataError {
  readonly operation: 'delete' | 'save';
  readonly profile: BrandProfile | null;
  readonly profiles: readonly BrandProfile[];

  constructor(operation: 'delete' | 'save', profile: BrandProfile | null, profiles: readonly BrandProfile[], cause: unknown) {
    super(
      'LOCAL_DATA_POST_COMMIT_FAILED',
      operation === 'save'
        ? 'The Brand Profile was saved, but its active-profile preference could not be updated.'
        : 'The Brand Profile was deleted, but its active-profile preference could not be checked or cleared.',
      { cause },
    );
    this.name = 'BrandProfileMutationCommittedError';
    this.operation = operation;
    this.profile = profile;
    this.profiles = profiles;
  }
}

export function isBrandProfileMutationCommittedError(cause: unknown): cause is BrandProfileMutationCommittedError {
  return cause instanceof BrandProfileMutationCommittedError;
}

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
  retiredDkimSelectors: string[];
  mailProtectionProfile: MailProtectionProfile;
  protectionAttestations: ProtectionAttestation[];
  desiredPostureBaselines: DesiredPostureBaseline[];
  trademarkOwner: string;
  trademarkRegistration: string;
  officialFaviconHash: string;
  officialFaviconPHash: string;
  pageBaseline: PageBaseline;
  createdAt: string;
  updatedAt: string;
}

const id = () => crypto.randomUUID ? crypto.randomUUID() : `bp-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function normalizeProfile(raw: unknown, existing?: BrandProfile, touch = false): BrandProfile {
  const profile = normalizeBrandProfile(raw, { existing, touch, makeId: id });
  if (!profile) throw new Error('Enter a brand name.');
  return profile as BrandProfile;
}

export async function loadProfiles(): Promise<BrandProfile[]> {
  return readBrowserLocalData('brand_profiles');
}

function boundedProfiles(profiles: BrandProfile[]): BrandProfile[] {
  return JSON.parse(serializeBrandProfileStore(profiles)).profiles as BrandProfile[];
}

export async function writeProfiles(profiles: BrandProfile[]): Promise<void> {
  await updateBrowserLocalData('brand_profiles', () => ({ document: boundedProfiles(profiles), result: undefined }));
}

export function activeProfileId() {
  try {
    return normalizeBrandProfileId(localStorage.getItem(ACTIVE_PROFILE_KEY)) || '';
  } catch (cause) {
    throw new BrowserLocalDataError('LOCAL_DATA_READ_FAILED', 'Could not read the active-profile preference. Browser storage may be unavailable.', { cause });
  }
}

export function setActiveProfile(profileId: string) {
  try {
    const normalized = normalizeBrandProfileId(profileId);
    if (profileId && !normalized) throw new Error('Active profile identifier is invalid.');
    if (normalized) localStorage.setItem(ACTIVE_PROFILE_KEY, normalized);
    else localStorage.removeItem(ACTIVE_PROFILE_KEY);
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'Active profile identifier is invalid.') throw cause;
    throw new BrowserLocalDataError('LOCAL_DATA_WRITE_FAILED', 'Could not set the active profile. Browser storage may be full or unavailable.', { cause });
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

export function profileSignals(domain: string, evidence: Record<string, unknown>, profile: BrandProfile | null = null) {
  const trusted = profileDomainKind(domain, profile);
  if (!profile || trusted) return { trusted, faviconMatch: false, faviconNearMatch: false, reusesOfficialAssets: false };
  const exact = Boolean(evidence.faviconHash && profile.officialFaviconHash && evidence.faviconHash === profile.officialFaviconHash);
  const left = evidence.faviconPHash;
  const right = profile.officialFaviconPHash;
  const distance = isInformativeFaviconHash(left) && isInformativeFaviconHash(right) ? hammingDistanceHex(left, right) : null;
  const official = new Set(profile.officialDomains.map((value) => value.toLowerCase().replace(/\.$/, '')));
  const reused = Array.isArray(evidence.externalAssetHosts)
    && evidence.externalAssetHosts.some((host: unknown) => official.has(String(host).toLowerCase().replace(/\.$/, '')));
  return { trusted: null, faviconMatch: exact, faviconNearMatch: !exact && distance !== null && distance <= 8, reusesOfficialAssets: reused };
}

export async function upsertProfile(raw: unknown, editingId = ''): Promise<BrandProfile> {
  const committed = await updateBrowserLocalData('brand_profiles', (current) => {
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
    const document = boundedProfiles(profiles);
    const profile = document.find((item) => item.id === normalized.id) ?? normalized;
    return { document, result: { profile, profiles: document } };
  });
  try { setActiveProfile(committed.profile.id); }
  catch (cause) { throw new BrandProfileMutationCommittedError('save', committed.profile, committed.profiles, cause); }
  return committed.profile;
}

export async function deleteProfile(profileId: string): Promise<void> {
  const committed = await updateBrowserLocalData('brand_profiles', (current) => {
    const document = boundedProfiles((current as BrandProfile[]).filter((profile) => profile.id !== profileId));
    return { document, result: document };
  });
  try {
    if (activeProfileId() === profileId) setActiveProfile('');
  } catch (cause) {
    throw new BrandProfileMutationCommittedError('delete', null, committed, cause);
  }
}

export async function importProfiles(value: unknown) {
  return updateBrowserLocalData('brand_profiles', (current) => {
    const result = mergeBrandProfiles(current, value, { makeId: id });
    return {
      document: boundedProfiles(result.profiles as BrandProfile[]),
      result: { added: result.added, updated: result.updated, skipped: result.skipped },
    };
  });
}

export async function exportProfiles() {
  const blob = new Blob([serialiseWorkspacePortableJson(buildBrandProfileExport(await loadProfiles()))], { type: 'application/json' });
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
