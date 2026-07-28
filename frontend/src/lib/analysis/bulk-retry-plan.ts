import {
  normalizeBulkSessionResult,
  type BulkSessionResult,
  type BulkSessionSourceState,
} from './bulk-session-model.ts';

export const MAX_BULK_RETRY_ROWS = 200;
export const BULK_REVIEW_STALE_AFTER_DAYS = 7;

export type BulkRetryReason = 'error' | 'limited_source' | 'stale';
export type BulkRetryPlanRow = Readonly<{
  domain: string;
  reasons: readonly BulkRetryReason[];
  limitedSources: readonly string[];
}>;

export type BulkRetryFreshness = Readonly<{
  observedAt: string | null;
  ageDays: number | null;
  state: 'current' | 'stale' | 'unknown';
}>;

export type BulkRetryPlan = Readonly<{
  mode: 'deep' | 'fast';
  lookupRequests: number;
  rows: readonly BulkRetryPlanRow[];
  destinations: readonly string[];
  capped: boolean;
  freshness: BulkRetryFreshness;
  limitations: readonly string[];
}>;

const LIMITED_STATES = new Set<BulkSessionSourceState>([
  'error',
  'partial',
  'skipped',
  'unavailable',
  'unsupported',
]);

function freshness(value: unknown, now = Date.now()): BulkRetryFreshness {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    return { observedAt: null, ageDays: null, state: 'unknown' };
  }
  const observedAt = new Date(value).toISOString();
  const ageDays = Math.max(0, Math.floor((now - Date.parse(observedAt)) / 86_400_000));
  return {
    observedAt,
    ageDays,
    state: ageDays >= BULK_REVIEW_STALE_AFTER_DAYS ? 'stale' : 'current',
  };
}

function retryRow(value: BulkSessionResult, isStale: boolean): BulkRetryPlanRow | null {
  const limitedSources = value.sourceCoverage
    .filter((item) => LIMITED_STATES.has(item.state))
    .map((item) => item.source)
    .sort()
    .slice(0, 12);
  const reasons: BulkRetryReason[] = [];
  if (value.status === 'error') reasons.push('error');
  if (limitedSources.length) reasons.push('limited_source');
  if (isStale) reasons.push('stale');
  return reasons.length ? { domain: value.domain, reasons, limitedSources } : null;
}

export function buildBulkRetryPlan(
  values: readonly unknown[],
  mode: 'deep' | 'fast',
  observedAtRaw: unknown = null,
  now = Date.now(),
): BulkRetryPlan {
  const observationFreshness = freshness(observedAtRaw, now);
  const candidates = values
    .map(normalizeBulkSessionResult)
    .filter((value): value is BulkSessionResult => Boolean(value))
    .map((value) => retryRow(value, observationFreshness.state === 'stale'))
    .filter((value): value is BulkRetryPlanRow => Boolean(value));
  const rows = candidates.slice(0, MAX_BULK_RETRY_ROWS);
  return {
    mode,
    lookupRequests: rows.length,
    rows,
    destinations: mode === 'deep'
      ? ['registry RDAP', 'registrar RDAP when advertised', 'WHOIS', 'DNS resolvers', 'target HTTP(S)', 'target TLS']
      : ['registry RDAP', 'authoritative DNS delegation when registration sources are inconclusive'],
    capped: candidates.length > rows.length,
    freshness: observationFreshness,
    limitations: [
      'This repeats the selected lookup profile; the current API does not request only one upstream source.',
      `Evidence is marked stale after ${BULK_REVIEW_STALE_AFTER_DAYS} days for review purposes; this is a local observation age, not an upstream record age.`,
      'Optional third-party intelligence providers are not contacted by Bulk.',
      'A retry can remain partial or fail and does not convert unavailable evidence into absence.',
    ],
  };
}

export function preservePriorBulkResult(
  previousRaw: unknown,
  currentRaw: unknown,
): { preserve: boolean; reason: string } {
  const previous = normalizeBulkSessionResult(previousRaw);
  const current = normalizeBulkSessionResult(currentRaw);
  if (!previous || !current || previous.domain !== current.domain || previous.status !== 'complete') {
    return { preserve: false, reason: '' };
  }
  if (current.status === 'error') {
    return { preserve: true, reason: 'The retry failed, so the prior settled result was retained.' };
  }
  if (previous.scanDepth === 'deep' && current.scanDepth === 'fast') {
    return { preserve: true, reason: 'The retry returned only Fast evidence, so the prior Deep result was retained.' };
  }
  const currentSources = new Map(current.sourceCoverage.map((item) => [item.source, item.state]));
  const regressed = previous.sourceCoverage
    .filter((item) => item.state === 'complete')
    .map((item) => item.source)
    .filter((source) => currentSources.get(source) !== 'complete');
  return regressed.length
    ? {
        preserve: true,
        reason: `The retry reduced complete coverage for ${regressed.slice(0, 6).join(', ')}, so the prior settled result was retained.`,
      }
    : { preserve: false, reason: '' };
}
