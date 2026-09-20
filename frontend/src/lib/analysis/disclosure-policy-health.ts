import { normalizeExplicitIsoTimestamp } from '../../../../packages/evidence/observation.mts';

export const DISCLOSURE_POLICY_HEALTH_VERSION = 1;

export type DisclosurePolicyHealth = Readonly<{
  version: typeof DISCLOSURE_POLICY_HEALTH_VERSION;
  state: 'current' | 'expired' | 'expiring' | 'partial' | 'unavailable';
  expiryDays: number | null;
  coverage: Readonly<{
    contacts: number;
    policies: number;
    encryption: number;
    languages: number;
  }>;
  review: readonly string[];
  limitations: readonly string[];
}>;

function count(value: unknown, maximum = 10): number {
  return Array.isArray(value) ? Math.min(value.length, maximum) : 0;
}

export function buildDisclosurePolicyHealth(
  input: Readonly<{
    state?: unknown;
    expiresAt?: unknown;
    contacts?: unknown;
    policies?: unknown;
    encryption?: unknown;
    languages?: unknown;
  }>,
  now: unknown = new Date().toISOString(),
): DisclosurePolicyHealth {
  const sourceState = typeof input.state === 'string' ? input.state : 'unavailable';
  const evaluatedAt = normalizeExplicitIsoTimestamp(now);
  const expiresAt = normalizeExplicitIsoTimestamp(input.expiresAt);
  const delta = evaluatedAt && expiresAt ? Date.parse(expiresAt) - Date.parse(evaluatedAt) : null;
  const expired = delta !== null && delta <= 0;
  const expiryDays = delta === null ? null : Math.ceil(delta / 86_400_000) || 0;
  const coverage = {
    contacts: count(input.contacts),
    policies: count(input.policies),
    encryption: count(input.encryption),
    languages: count(input.languages),
  };
  const review: string[] = [];
  if (coverage.contacts === 0) review.push('No supported disclosure contact was retained.');
  if (coverage.policies === 0) review.push('No supported disclosure policy reference was retained.');
  if (expiryDays === null) review.push('No valid expiry time was retained.');
  else if (expired) review.push('The published disclosure policy is expired.');
  else if (expiryDays <= 30) review.push(`The published disclosure policy expires in ${expiryDays} day${expiryDays === 1 ? '' : 's'}.`);
  const unavailable = !['present', 'stale'].includes(sourceState);
  const state = unavailable
    ? 'unavailable'
    : expired
      ? 'expired'
      : expiryDays !== null && expiryDays <= 30
        ? 'expiring'
        : sourceState === 'stale' || coverage.contacts === 0 || expiryDays === null
          ? 'partial'
          : 'current';
  return {
    version: DISCLOSURE_POLICY_HEALTH_VERSION,
    state,
    expiryDays,
    coverage,
    review: review.slice(0, 6),
    limitations: [
      'Health summarises the selected security.txt observation only. It performs no reachability check and does not prove that a contact is monitored.',
      'Missing, malformed, stale, or unavailable disclosure evidence is not evidence that no reporting route exists.',
    ],
  };
}
