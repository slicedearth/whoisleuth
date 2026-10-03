import { MAX_ALLOWLIST_DRAFT_CHARACTERS, MAX_PROFILE_VALUES, normalizeProfileDomains } from './brand-profile-model.ts';
import { hammingDistanceHex, isInformativeFaviconHash, parseDomainInput } from './utils.ts';
import { MAX_GENERATED_CONTEXT } from '../candidate-handoff-core.ts';

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
export type BrandCandidateExclusion = BrandDomainMatch | Readonly<{ kind: 'scoped_exception'; matchedDomain: string; reason: string }>;
export type BrandMatchSourceState = 'loading' | 'ready' | 'unavailable';

/** Explains the same exact comparison and role precedence used by collection consumers. */
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

/** Partition a bounded candidate set without changing its records or retaining another collection. */
export function partitionBrandCandidates<T extends Readonly<{ domain: string }>>(
  candidates: readonly T[], profile: DomainLists | null, state: BrandMatchSourceState = 'ready',
  scopedMatch?: (candidate: T) => BrandCandidateExclusion | null,
) {
  const admitted = candidates.slice(0, MAX_GENERATED_CONTEXT);
  const filtered: T[] = [], excluded: Array<{ candidate: T; match: BrandCandidateExclusion }> = [];
  for (const candidate of admitted) {
    const match = state === 'ready' ? profileDomainMatch(candidate.domain, profile) ?? scopedMatch?.(candidate) ?? null : null;
    if (match) excluded.push({ candidate, match });
    else filtered.push(candidate);
  }
  return { filtered, excluded, truncated: candidates.length > admitted.length,
    limitation: state === 'loading' ? 'Brand Profile context is still loading; no domain exclusion was applied.'
      : state === 'unavailable' ? 'Brand Profile context is unavailable; domain exclusions were not evaluated.' : '' };
}

export const MAX_BRAND_PREVIEW_DOMAINS = MAX_PROFILE_VALUES;
export type BrandDomainPreview = Readonly<{
  state: 'ready' | 'invalid' | 'unavailable';
  rows: readonly Readonly<{ domain: string; before: BrandDomainMatch | null; after: BrandDomainMatch | null;
    change: 'newly_excluded' | 'returned' | 'unchanged' }>[];
  newlyExcluded: number;
  returned: number;
  detail: string;
}>;

/** Explicit page-memory preview, using the same exact matcher as Discover. */
export function previewBrandDomainExclusions(
  input: unknown, before: DomainLists, after: DomainLists, state: BrandMatchSourceState = 'ready',
): BrandDomainPreview {
  const empty = { rows: [], newlyExcluded: 0, returned: 0 } as const;
  if (state !== 'ready') return { ...empty, state: 'unavailable', detail: state === 'loading'
    ? 'The selected Brand Profile is still loading.' : 'The selected Brand Profile is unavailable. No preview was evaluated.' };
  if (typeof input !== 'string' || input.length > MAX_ALLOWLIST_DRAFT_CHARACTERS) {
    return { ...empty, state: 'invalid', detail: 'Enter a bounded list of domains to preview.' };
  }
  const parsed = parseDomainInput(input);
  if (parsed.tooLarge || !parsed.entries.length || parsed.entries.length > MAX_BRAND_PREVIEW_DOMAINS) {
    return { ...empty, state: 'invalid', detail: `Enter 1–${MAX_BRAND_PREVIEW_DOMAINS} domains to preview.` };
  }
  const domains = new Set<string>();
  for (const value of parsed.entries) {
    // Preview accepts domain names, not URLs, credentials, paths or patterns.
    const domain = /[:/@?#\\]/u.test(value) ? '' : normalizeProfileDomains([value])[0];
    if (!domain) return { ...empty, state: 'invalid', detail: 'Every preview entry must be a valid domain name. No partial preview was evaluated.' };
    domains.add(domain);
  }
  const rows = [...domains].map(domain => {
    const previous = profileDomainMatch(domain, before), next = profileDomainMatch(domain, after);
    const change = !previous && next ? 'newly_excluded' : previous && !next ? 'returned' : 'unchanged';
    return { domain, before: previous, after: next, change } as const;
  });
  return { state: 'ready', rows, newlyExcluded: rows.filter(row => row.change === 'newly_excluded').length,
    returned: rows.filter(row => row.change === 'returned').length,
    detail: `${rows.length} selected domains evaluated against saved and draft domain lists.` };
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
