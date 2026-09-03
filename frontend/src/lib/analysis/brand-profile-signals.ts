import { MAX_PROFILE_VALUES } from './brand-profile-model.ts';
import { hammingDistanceHex, isInformativeFaviconHash } from './utils.ts';

export type BrandProfileSignalProfile = Readonly<{
  officialDomains: readonly string[];
  approvedPartnerDomains: readonly string[];
  allowlistedDomains: readonly string[];
  officialFaviconHash: string;
  officialFaviconPHash: string;
}>;

function normalizedDomain(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/u, '');
}

export function profileDomainKind(
  domain: string,
  profile: BrandProfileSignalProfile | null = null,
): 'official' | 'partner' | 'allowlisted' | null {
  if (!profile || !domain) return null;
  const target = normalizedDomain(domain);
  if (profile.officialDomains.some((value) => normalizedDomain(value) === target)) return 'official';
  if (profile.approvedPartnerDomains.some((value) => normalizedDomain(value) === target)) return 'partner';
  if (profile.allowlistedDomains.some((value) => normalizedDomain(value) === target)) return 'allowlisted';
  return null;
}

export function profileSignals(
  domain: string,
  evidence: Record<string, unknown>,
  profile: BrandProfileSignalProfile | null = null,
): Readonly<{
  trusted: 'official' | 'partner' | 'allowlisted' | null;
  faviconMatch: boolean;
  faviconNearMatch: boolean;
  reusesOfficialAssets: boolean;
}> {
  const trusted = profileDomainKind(domain, profile);
  if (!profile || trusted) return { trusted, faviconMatch: false, faviconNearMatch: false, reusesOfficialAssets: false };
  const exact = Boolean(evidence.faviconHash && profile.officialFaviconHash && evidence.faviconHash === profile.officialFaviconHash);
  const distance = isInformativeFaviconHash(evidence.faviconPHash) && isInformativeFaviconHash(profile.officialFaviconPHash)
    ? hammingDistanceHex(evidence.faviconPHash, profile.officialFaviconPHash)
    : null;
  const official = new Set(profile.officialDomains.map(normalizedDomain));
  const reused = Array.isArray(evidence.externalAssetHosts)
    && evidence.externalAssetHosts.some((host: unknown) => official.has(normalizedDomain(String(host))));
  return {
    trusted: null,
    faviconMatch: exact,
    faviconNearMatch: !exact && distance !== null && distance <= 8,
    reusesOfficialAssets: reused,
  };
}

export function parseProfileList(raw: string, lower = false): string[] {
  return [...new Set(
    raw.split(/[\n,]+/u)
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => lower ? value.toLowerCase() : value),
  )].slice(0, MAX_PROFILE_VALUES);
}
