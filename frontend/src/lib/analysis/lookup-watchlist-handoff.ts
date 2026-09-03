import { hashString, normalizeEvidenceDomain } from './case-model.ts';
import type { WatchlistComparableRecord } from './watchlist-history.ts';
import {
  MAX_WATCHLIST_NAME_LENGTH,
  type WatchlistCollection,
} from './watchlist-store.ts';

const NAME_PREFIX = 'Monitor · ';
const COMPARABLE_FIELDS = Object.freeze([
  'availability',
  'nameservers',
  'createdDate',
  'expiryDate',
  'privacyProtected',
  'hasMx',
  'hasSpf',
  'hasDmarc',
  'activityStatus',
  'pageTitle',
  'httpSummaryVersion',
  'httpEvidenceStatus',
  'httpFinalOrigin',
  'httpResponseStatus',
  'httpTransportSecurity',
  'httpRedirectCount',
  'httpCrossOriginRedirect',
  'httpHttpsDowngrade',
  'httpContentType',
  'httpSecurityHeaders',
  'faviconHash',
  'faviconMatch',
  'faviconNearMatch',
  'hasPasswordField',
  'phishingLanguageMatch',
  'reusesOfficialAssets',
  'riskModelVersion',
  'riskScore',
] as const);

function plainRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function defaultLookupWatchlistName(target: unknown): string {
  const domain = normalizeEvidenceDomain(target);
  if (!domain) return '';
  const complete = `${NAME_PREFIX}${domain}`;
  if (complete.length <= MAX_WATCHLIST_NAME_LENGTH) return complete;
  const suffix = `…${hashString(domain)}`;
  const visibleLength = MAX_WATCHLIST_NAME_LENGTH - NAME_PREFIX.length - suffix.length;
  return `${NAME_PREFIX}${domain.slice(0, Math.max(1, visibleLength))}${suffix}`;
}

export function buildLookupWatchlistRecord(
  target: unknown,
  evidenceRaw: unknown,
  scanDepth: 'fast' | 'deep',
): WatchlistComparableRecord | null {
  const domain = normalizeEvidenceDomain(target);
  if (!domain) return null;
  const evidence = plainRecord(evidenceRaw);
  const record: WatchlistComparableRecord = {
    domain,
    scanDepth,
    registrarName: evidence.registrar,
  };
  for (const field of COMPARABLE_FIELDS) {
    if (!Object.hasOwn(evidence, field)) continue;
    if (field === 'riskModelVersion' || field === 'riskScore') {
      const value = evidence[field];
      record[field] = typeof value === 'number' && Number.isFinite(value) ? value : null;
      continue;
    }
    record[field] = evidence[field];
  }
  return record;
}

export function lookupWatchlistsForDomain(
  watchlists: WatchlistCollection,
  target: unknown,
): string[] {
  const domain = normalizeEvidenceDomain(target);
  if (!domain) return [];
  return Object.entries(watchlists)
    .filter(([, entry]) => entry.results.some((record) => record.domain === domain))
    .map(([name]) => name)
    .sort((left, right) => left.localeCompare(right));
}
