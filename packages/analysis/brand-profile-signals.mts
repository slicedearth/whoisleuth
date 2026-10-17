import { hammingDistanceHex, isInformativePerceptualHash } from './perceptual-hash-comparison.mts';

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

export type BrandDomainMatch = Readonly<{
  kind: 'official' | 'partner' | 'allowlisted';
  matchedDomain: string;
  reason: string;
}>;
type DomainLists = Pick<BrandProfileSignalProfile, 'officialDomains' | 'approvedPartnerDomains' | 'allowlistedDomains'>;

/** Shared exact comparison and role precedence for browser and CLI consumers. */
export function profileDomainMatch(domain: string, profile: DomainLists | null = null): BrandDomainMatch | null {
  if (!profile || !domain) return null;
  const target = normalizedDomain(domain);
  const lists = [
    ['official', profile.officialDomains, 'Exact official-domain declaration'],
    ['partner', profile.approvedPartnerDomains, 'Exact approved-partner declaration'],
    ['allowlisted', profile.allowlistedDomains, 'Exact domain allowlist entry'],
  ] as const;
  for (const [kind, values, reason] of lists) {
    const matched = values.find(value => normalizedDomain(value) === target);
    if (matched !== undefined) return { kind, matchedDomain: normalizedDomain(matched), reason };
  }
  return null;
}

export function profileDomainKind(
  domain: string,
  profile: BrandProfileSignalProfile | null = null,
): 'official' | 'partner' | 'allowlisted' | null {
  return profileDomainMatch(domain, profile)?.kind ?? null;
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
  const distance = isInformativePerceptualHash(evidence.faviconPHash) && isInformativePerceptualHash(profile.officialFaviconPHash)
    ? hammingDistanceHex(evidence.faviconPHash, profile.officialFaviconPHash)
    : null;
  const official = new Set(profile.officialDomains.map(normalizedDomain));
  const reused = Array.isArray(evidence.externalAssetHosts)
    && evidence.externalAssetHosts.some((host: unknown) => typeof host === 'string' && official.has(normalizedDomain(host)));
  return {
    trusted: null,
    faviconMatch: exact,
    faviconNearMatch: !exact && distance !== null && distance <= 8,
    reusesOfficialAssets: reused,
  };
}
