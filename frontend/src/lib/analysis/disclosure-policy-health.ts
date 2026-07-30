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
  const nowMs = Number.isFinite(Date.parse(String(now))) ? Date.parse(String(now)) : 0;
  const expiryMs = typeof input.expiresAt === 'string' && Number.isFinite(Date.parse(input.expiresAt))
    ? Date.parse(input.expiresAt)
    : null;
  const expiryDays = expiryMs === null ? null : Math.ceil((expiryMs - nowMs) / 86_400_000);
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
  else if (expiryDays < 0) review.push('The published disclosure policy is expired.');
  else if (expiryDays <= 30) review.push(`The published disclosure policy expires in ${expiryDays} day${expiryDays === 1 ? '' : 's'}.`);
  const unavailable = !['present', 'stale'].includes(sourceState);
  const state = unavailable
    ? 'unavailable'
    : expiryDays !== null && expiryDays < 0
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
      'Health summarizes the selected security.txt observation only. It performs no reachability check and does not prove that a contact is monitored.',
      'Missing, malformed, stale, or unavailable disclosure evidence is not evidence that no reporting route exists.',
    ],
  };
}
