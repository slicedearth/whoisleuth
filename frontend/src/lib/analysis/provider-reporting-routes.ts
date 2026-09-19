import { technologyProfileContractState } from '../../../../lib/lookup-child-profile-contract.mts';
import { normalizeExplicitIsoTimestamp as timestamp } from '../../../../packages/evidence/observation.mts';

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
 * Routes require an attributed profile with the exact provider identifier and
 * evidence role, within the catalogue's review window.
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

function profileState(value: unknown): Readonly<{
  state: 'usable' | 'not_collected' | 'unavailable';
  observedAt: string | null;
  findings: readonly Record<string, unknown>[];
}> {
  if (value == null) return { state: 'not_collected', observedAt: null, findings: [] };
  if (technologyProfileContractState(value) !== 'supported') {
    return { state: 'unavailable', observedAt: null, findings: [] };
  }
  const profile = record(value);
  return { state: 'usable', observedAt: timestamp(profile.observedAt), findings: profile.findings as readonly Record<string, unknown>[] };
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

export function resolveProviderReportingRoutes(
  technologyProfile: unknown,
  now: Date = new Date(),
): ProviderReportingRouteResolution {
  const profile = profileState(technologyProfile);
  if (profile.state !== 'usable' || !profile.observedAt) {
    return {
      routes: [],
      coverage: ROLES.map((role) => ({
        role,
        state: profile.state === 'not_collected' ? 'not_collected' as const : 'unavailable' as const,
        detail: profile.state === 'not_collected'
          ? 'No technology profile was supplied for provider-route matching.'
          : 'The supplied technology profile could not be matched: its version, attribution, observation time or findings were unsupported or invalid.',
      })),
    };
  }
  const evaluatedAt = now instanceof Date && Number.isFinite(now.getTime()) ? timestamp(now.toISOString()) : null;
  if (!evaluatedAt || Date.parse(profile.observedAt) > Date.parse(evaluatedAt)) return {
    routes: [],
    coverage: ROLES.map((role) => ({
      role,
      state: 'unavailable' as const,
      detail: evaluatedAt
        ? 'The technology observation is later than this review. No reporting route was selected.'
        : 'The review clock is unavailable. Reporting-route freshness could not be evaluated.',
    })),
  };
  const reviewTime = Date.parse(evaluatedAt);

  const routes: ProviderReportingRoute[] = [];
  const staleRoles = new Set<ProviderReportingRole>();
  const matchedRoles = new Set<ProviderReportingRole>();
  for (const entry of PROVIDER_REPORTING_ROUTE_CATALOGUE) {
    const finding = matchedFinding(profile.findings, entry);
    if (!finding) continue;
    matchedRoles.add(entry.role);
    const reviewedAt = timestamp(`${entry.reviewedAt}T00:00:00.000Z`);
    const reviewAfter = timestamp(`${entry.reviewAfter}T00:00:00.000Z`);
    if (!reviewedAt || !reviewAfter || Date.parse(reviewAfter) <= Date.parse(reviewedAt) || reviewTime < Date.parse(reviewedAt)) continue;
    if (reviewTime >= Date.parse(reviewAfter)) {
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
        detail: `${found} official route${found === 1 ? '' : 's'} within the catalogue review window matched retained ${role.replaceAll('_', ' ')} evidence.`,
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
          ? `A matching ${role.replaceAll('_', ' ')} indicator had no route with a valid review window at this time.`
          : `No exact supported ${role.replaceAll('_', ' ')} indicator was present in the supplied technology evidence; this does not establish absence.`,
      };
    })),
  };
}
