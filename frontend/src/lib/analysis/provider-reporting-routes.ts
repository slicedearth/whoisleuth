import { TECHNOLOGY_PROFILE_VERSION } from '../../../../lib/lookup-child-profile-contract.mts';

export type ProviderReportingRole = 'application_platform' | 'observed_edge';
export type ProviderReportingChannel = 'email' | 'url';

export type ProviderReportingRoute = Readonly<{
  id: string;
  providerId: string;
  providerLabel: string;
  role: ProviderReportingRole;
  channel: ProviderReportingChannel;
  contact: string;
  officialSourceUrl: string;
  reviewedAt: string;
  reviewAfter: string;
  observedAt: string;
  confidence: 'high' | 'medium';
  limitations: readonly string[];
}>;

export type ProviderReportingCoverage = Readonly<{
  role: ProviderReportingRole;
  state: 'found' | 'not_collected' | 'stale' | 'unavailable';
  detail: string;
}>;

export type ProviderReportingRouteResolution = Readonly<{
  routes: readonly ProviderReportingRoute[];
  coverage: readonly ProviderReportingCoverage[];
}>;

type CatalogueEntry = Readonly<{
  providerId: string;
  providerLabel: string;
  role: ProviderReportingRole;
  channel: ProviderReportingChannel;
  contact: string;
  officialSourceUrl: string;
  reviewedAt: string;
  reviewAfter: string;
  limitation: string;
}>;

const REVIEWED_AT = '2026-09-04';
const REVIEW_AFTER = '2027-03-04';
const ROLES: readonly ProviderReportingRole[] = Object.freeze(['application_platform', 'observed_edge']);

/**
 * Small, explicitly reviewed catalogue of official provider-published routes.
 * It is deliberately not a provider-name lookup table: a route is exposed only
 * when a current technology profile contains the exact provider identifier and
 * the required evidence role. Entries expire closed and are then withheld.
 */
export const PROVIDER_REPORTING_ROUTE_CATALOGUE: readonly CatalogueEntry[] = Object.freeze([
  Object.freeze({
    providerId: 'netlify',
    providerLabel: 'Netlify',
    role: 'application_platform',
    channel: 'email',
    contact: 'fraud@netlify.com',
    officialSourceUrl: 'https://www.netlify.com/legal/terms-of-use/',
    reviewedAt: REVIEWED_AT,
    reviewAfter: REVIEW_AFTER,
    limitation: 'An application-platform indicator does not prove that the provider account serves the reviewed content or that this route covers the incident.',
  }),
  Object.freeze({
    providerId: 'vercel',
    providerLabel: 'Vercel',
    role: 'application_platform',
    channel: 'url',
    contact: 'https://vercel.com/abuse',
    officialSourceUrl: 'https://vercel.com/legal/acceptable-use-policy',
    reviewedAt: REVIEWED_AT,
    reviewAfter: REVIEW_AFTER,
    limitation: 'An application-platform indicator does not prove that the provider account serves the reviewed content or that this route covers the incident.',
  }),
  Object.freeze({
    providerId: 'cloudflare',
    providerLabel: 'Cloudflare',
    role: 'observed_edge',
    channel: 'url',
    contact: 'https://abuse.cloudflare.com/',
    officialSourceUrl: 'https://www.cloudflare.com/trust-hub/abuse-approach/',
    reviewedAt: REVIEWED_AT,
    reviewAfter: REVIEW_AFTER,
    limitation: 'The indicator describes an observed edge, proxy, CDN or security service. It does not identify the origin host or establish content responsibility.',
  }),
  Object.freeze({
    providerId: 'fastly',
    providerLabel: 'Fastly',
    role: 'observed_edge',
    channel: 'email',
    contact: 'abuse@fastly.com',
    officialSourceUrl: 'https://www.fastly.com/acceptable-use',
    reviewedAt: REVIEWED_AT,
    reviewAfter: REVIEW_AFTER,
    limitation: 'The indicator describes an observed edge, proxy, CDN or security service. It does not identify the origin host or establish content responsibility.',
  }),
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function validObservedAt(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function profileState(value: unknown): Readonly<{
  usable: boolean;
  observedAt: string | null;
  findings: readonly Record<string, unknown>[];
}> {
  const profile = record(value);
  const observedAt = validObservedAt(profile.observedAt);
  if (
    profile.profileVersion !== TECHNOLOGY_PROFILE_VERSION
    || profile.source !== 'derived'
    || !['success', 'partial'].includes(String(profile.status))
    || !observedAt
    || !Array.isArray(profile.findings)
    || profile.findings.length > 24
  ) {
    return { usable: false, observedAt: null, findings: [] };
  }
  const findings = profile.findings.filter((finding): finding is Record<string, unknown> => (
    Boolean(finding) && typeof finding === 'object' && !Array.isArray(finding)
  ));
  if (findings.length !== profile.findings.length) return { usable: false, observedAt: null, findings: [] };
  return { usable: true, observedAt, findings };
}

function matchedFinding(
  findings: readonly Record<string, unknown>[],
  entry: CatalogueEntry,
): Readonly<{ confidence: 'high' | 'medium' }> | null {
  for (const finding of findings) {
    if (finding.id !== entry.providerId) continue;
    if (!Array.isArray(finding.roles) || finding.roles.length > 4 || !finding.roles.includes(entry.role)) continue;
    if (finding.confidence !== 'high' && finding.confidence !== 'medium') continue;
    return { confidence: finding.confidence };
  }
  return null;
}

function utcDay(value: Date): number {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

export function resolveProviderReportingRoutes(
  technologyProfile: unknown,
  now: Date = new Date(),
): ProviderReportingRouteResolution {
  const profile = profileState(technologyProfile);
  if (!profile.usable || !profile.observedAt) {
    return {
      routes: [],
      coverage: ROLES.map((role) => ({
        role,
        state: 'not_collected' as const,
        detail: 'A current, source-attributed technology profile was not available for provider-route matching.',
      })),
    };
  }

  const routes: ProviderReportingRoute[] = [];
  const staleRoles = new Set<ProviderReportingRole>();
  const matchedRoles = new Set<ProviderReportingRole>();
  for (const entry of PROVIDER_REPORTING_ROUTE_CATALOGUE) {
    const finding = matchedFinding(profile.findings, entry);
    if (!finding) continue;
    matchedRoles.add(entry.role);
    const reviewDeadline = Date.parse(`${entry.reviewAfter}T00:00:00.000Z`);
    if (utcDay(now) >= reviewDeadline) {
      staleRoles.add(entry.role);
      continue;
    }
    routes.push(Object.freeze({
      id: `provider:${entry.role}:${entry.providerId}:${entry.channel}:${entry.contact.toLowerCase()}`,
      providerId: entry.providerId,
      providerLabel: entry.providerLabel,
      role: entry.role,
      channel: entry.channel,
      contact: entry.contact,
      officialSourceUrl: entry.officialSourceUrl,
      reviewedAt: entry.reviewedAt,
      reviewAfter: entry.reviewAfter,
      observedAt: profile.observedAt,
      confidence: finding.confidence,
      limitations: Object.freeze([
        entry.limitation,
        `Official reporting guidance was reviewed on ${entry.reviewedAt} and must be rechecked before ${entry.reviewAfter}.`,
        'WHOISleuth did not test this route, identify an account, or decide whether a report should be sent.',
      ]),
    }));
  }

  return {
    routes: Object.freeze(routes),
    coverage: Object.freeze(ROLES.map((role) => {
      const found = routes.filter((route) => route.role === role).length;
      if (found) return {
        role,
        state: 'found' as const,
        detail: `${found} freshness-valid official route${found === 1 ? '' : 's'} matched exact ${role.replaceAll('_', ' ')} evidence.`,
      };
      if (staleRoles.has(role)) return {
        role,
        state: 'stale' as const,
        detail: `A matching ${role.replaceAll('_', ' ')} indicator was observed, but its catalogue route reached the review date and was withheld.`,
      };
      return {
        role,
        state: 'unavailable' as const,
        detail: matchedRoles.has(role)
          ? `A matching ${role.replaceAll('_', ' ')} indicator had no usable freshness-valid route.`
          : `No exact supported ${role.replaceAll('_', ' ')} indicator was present in the current technology evidence; this does not establish absence.`,
      };
    })),
  };
}
