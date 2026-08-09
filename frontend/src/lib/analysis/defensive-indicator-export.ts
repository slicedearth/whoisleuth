// Pure defensive-domain export formatting for filtered Bulk findings. These
// files are generated locally and never submitted or applied automatically.

import { normalizeDomain } from './case-model.ts';

export const DEFENSIVE_INDICATOR_EXPORT_VERSION = 2;
export const MAX_DEFENSIVE_INDICATORS = 2000;
export const MAX_DEFENSIVE_INDICATOR_INPUTS = MAX_DEFENSIVE_INDICATORS * 4;
export const DEFENSIVE_INDICATOR_FORMATS = Object.freeze(['domains', 'hosts', 'dnsmasq', 'rpz'] as const);
export type DefensiveIndicatorFormat = typeof DEFENSIVE_INDICATOR_FORMATS[number];

const REGISTERED_STATES = new Set(['registered', 'for_sale', 'expiring']);
const MINIMUM_RISK_SCORE = 70;
const CONTROL_RE = /[\x00-\x1f\x7f]/;

type DefensiveIndicatorEntry = {
  domain: string;
  source: Record<string, unknown>;
};

type DefensiveIndicatorExportOptions = {
  format?: unknown;
  generatedAt?: unknown;
  selectedDomains?: unknown;
  allowlistedDomains?: unknown;
  officialDomains?: unknown;
  commonInfrastructureDomains?: unknown;
  includeWildcards?: unknown;
  expiryDays?: unknown;
};

export type DefensiveIndicatorExclusionReason =
  | 'not_selected'
  | 'profile_context_unavailable'
  | 'not_eligible'
  | 'unreviewed_disposition'
  | 'official_domain'
  | 'allowlisted_domain'
  | 'common_infrastructure';

export type DefensiveIndicatorPreflight = {
  entries: DefensiveIndicatorEntry[];
  domains: string[];
  exclusions: Array<{ domain: string; reason: DefensiveIndicatorExclusionReason }>;
  truncated: boolean;
  explicitSelection: boolean;
};

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function riskScore(record: Record<string, unknown>): number | null {
  const value = record.risk ?? record.riskScore;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizedDomainSet(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.slice(0, MAX_DEFENSIVE_INDICATOR_INPUTS)
    .map((item) => normalizeDomain(item))
    .filter((item): item is string => Boolean(item)));
}

function analystDisposition(record: Record<string, unknown>): string {
  return typeof record.analystDisposition === 'string'
    ? record.analystDisposition
    : typeof record.disposition === 'string'
      ? record.disposition
      : '';
}

function hasReadyProfileContext(record: Record<string, unknown>): boolean {
  const saved = plainRecord(record.saved);
  const profileContext = plainRecord(saved?.profileContext ?? record.profileContext);
  return profileContext?.sourceState === 'ready';
}

export function isDefensiveIndicatorCandidate(value: unknown): boolean {
  const record = plainRecord(value);
  if (
    !record
    || !hasReadyProfileContext(record)
    || record.trusted
    || record.status === 'error'
    || typeof record.availability !== 'string'
    || !REGISTERED_STATES.has(record.availability)
  ) return false;
  return Boolean(normalizeDomain(record.domain)) && (riskScore(record) ?? -1) >= MINIMUM_RISK_SCORE;
}

export function collectDefensiveIndicatorCandidates(
  records: unknown,
  limit: number = MAX_DEFENSIVE_INDICATORS,
): {
  entries: DefensiveIndicatorEntry[];
  domains: string[];
  truncated: boolean;
} {
  if (!Array.isArray(records)) throw new TypeError('Defensive indicator export requires an array of Bulk results.');
  const retainedLimit = Number.isSafeInteger(limit) && limit > 0
    ? Math.min(limit, MAX_DEFENSIVE_INDICATORS)
    : MAX_DEFENSIVE_INDICATORS;
  const byDomain = new Map<string, Record<string, unknown>>();
  for (const item of records.slice(0, MAX_DEFENSIVE_INDICATOR_INPUTS)) {
    if (!isDefensiveIndicatorCandidate(item)) continue;
    const record = plainRecord(item);
    const domain = normalizeDomain(record?.domain);
    if (record && domain && !byDomain.has(domain)) byDomain.set(domain, record);
  }
  const candidates = [...byDomain.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([domain, source]) => ({ domain, source }));
  const entries = candidates.slice(0, retainedLimit);
  return {
    entries,
    domains: entries.map((entry) => entry.domain),
    truncated: records.length > MAX_DEFENSIVE_INDICATOR_INPUTS || candidates.length > retainedLimit,
  };
}

export function prepareDefensiveIndicatorExport(
  records: unknown,
  options: DefensiveIndicatorExportOptions = {},
  limit: number = MAX_DEFENSIVE_INDICATORS,
): DefensiveIndicatorPreflight {
  if (!Array.isArray(records)) throw new TypeError('Defensive indicator export requires an array of Bulk results.');
  const explicitSelection = Array.isArray(options.selectedDomains);
  const selected = normalizedDomainSet(options.selectedDomains);
  const official = normalizedDomainSet(options.officialDomains);
  const allowlisted = normalizedDomainSet(options.allowlistedDomains);
  const common = normalizedDomainSet(options.commonInfrastructureDomains);
  const retainedLimit = Number.isSafeInteger(limit) && limit > 0
    ? Math.min(limit, MAX_DEFENSIVE_INDICATORS)
    : MAX_DEFENSIVE_INDICATORS;
  const exclusions: DefensiveIndicatorPreflight['exclusions'] = [];
  const seenExclusions = new Set<string>();
  const accepted = new Map<string, Record<string, unknown>>();

  const exclude = (domain: string, reason: DefensiveIndicatorExclusionReason) => {
    const key = `${domain}\u0000${reason}`;
    if (!seenExclusions.has(key)) {
      exclusions.push({ domain, reason });
      seenExclusions.add(key);
    }
  };

  for (const item of records.slice(0, MAX_DEFENSIVE_INDICATOR_INPUTS)) {
    const source = plainRecord(item);
    const domain = normalizeDomain(source?.domain);
    if (!source || !domain) continue;
    if (explicitSelection && !selected.has(domain)) {
      exclude(domain, 'not_selected');
      continue;
    }
    if (!hasReadyProfileContext(source)) {
      exclude(domain, 'profile_context_unavailable');
      continue;
    }
    if (official.has(domain)) {
      exclude(domain, 'official_domain');
      continue;
    }
    if (allowlisted.has(domain)) {
      exclude(domain, 'allowlisted_domain');
      continue;
    }
    if (common.has(domain) || source.commonInfrastructure === true) {
      exclude(domain, 'common_infrastructure');
      continue;
    }
    if (!isDefensiveIndicatorCandidate(source)) {
      exclude(domain, 'not_eligible');
      continue;
    }
    const disposition = analystDisposition(source);
    if (explicitSelection && !['suspicious', 'confirmed_abuse'].includes(disposition)) {
      exclude(domain, 'unreviewed_disposition');
      continue;
    }
    if (!accepted.has(domain)) accepted.set(domain, source);
  }

  const candidates = [...accepted.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([domain, source]) => ({ domain, source }));
  const entries = candidates.slice(0, retainedLimit);
  return {
    entries,
    domains: entries.map((entry) => entry.domain),
    exclusions: exclusions.sort((left, right) => left.domain.localeCompare(right.domain) || left.reason.localeCompare(right.reason)),
    truncated: records.length > MAX_DEFENSIVE_INDICATOR_INPUTS || candidates.length > retainedLimit,
    explicitSelection,
  };
}

function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64 || CONTROL_RE.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function header(prefix: string, generatedAt: string, count: number): string[] {
  return [
    `${prefix} WHOISleuth defensive domain indicators v${DEFENSIVE_INDICATOR_EXPORT_VERSION}`,
    `${prefix} Generated ${generatedAt}`,
    `${prefix} ${count} high-risk registered domain${count === 1 ? '' : 's'}`,
    `${prefix} Review before use. Heuristic findings can include false positives.`,
  ];
}

function formatDomains(domains: readonly string[], generatedAt: string): string {
  return [...header('#', generatedAt, domains.length), ...domains].join('\n');
}

function formatHosts(domains: readonly string[], generatedAt: string): string {
  return [...header('#', generatedAt, domains.length), ...domains.map((domain) => `0.0.0.0 ${domain}`)].join('\n');
}

function formatDnsmasq(domains: readonly string[], generatedAt: string): string {
  return [...header('#', generatedAt, domains.length), ...domains.map((domain) => `address=/${domain}/0.0.0.0`)].join('\n');
}

function formatRpz(domains: readonly string[], generatedAt: string, includeWildcards: boolean): string {
  const serial = Math.floor(Date.parse(generatedAt) / 1000) >>> 0;
  return [
    ...header(';', generatedAt, domains.length),
    '$TTL 60',
    `@ IN SOA localhost. root.localhost. (${serial} 60 60 60 60)`,
    '@ IN NS localhost.',
    ...domains.flatMap((domain) => [
      `${domain}. CNAME .`,
      ...(includeWildcards ? [`*.${domain}. CNAME .`] : []),
    ]),
  ].join('\n');
}

function contentFor(
  format: DefensiveIndicatorFormat,
  domains: readonly string[],
  generatedAt: string,
  includeWildcards: boolean,
): string {
  if (format === 'hosts') return formatHosts(domains, generatedAt);
  if (format === 'dnsmasq') return formatDnsmasq(domains, generatedAt);
  if (format === 'rpz') return formatRpz(domains, generatedAt, includeWildcards);
  return formatDomains(domains, generatedAt);
}

export function buildDefensiveIndicatorExport(
  records: unknown,
  options: DefensiveIndicatorExportOptions = {},
) {
  const format: DefensiveIndicatorFormat = (
    typeof options.format === 'string'
    && (DEFENSIVE_INDICATOR_FORMATS as readonly string[]).includes(options.format)
  ) ? options.format as DefensiveIndicatorFormat : 'domains';
  const generatedAt = timestamp(options.generatedAt) || new Date().toISOString();
  const includeWildcards = options.includeWildcards === true;
  const expiryDays = typeof options.expiryDays === 'number' && Number.isSafeInteger(options.expiryDays)
    ? Math.max(1, Math.min(365, options.expiryDays))
    : 30;
  const collected = prepareDefensiveIndicatorExport(records, options);
  const expiresAt = new Date(Date.parse(generatedAt) + expiryDays * 86_400_000).toISOString();
  const manifest = {
    schema: 'whoisleuth.defensive-indicator-manifest',
    version: DEFENSIVE_INDICATOR_EXPORT_VERSION,
    generatedAt,
    expiresAt,
    reviewRequired: true,
    explicitSelection: collected.explicitSelection,
    includeWildcards,
    entries: collected.entries.map(({ domain, source }) => ({
      domain,
      disposition: analystDisposition(source) || 'not_recorded',
      reason: `High-risk registered Bulk finding (risk ${riskScore(source) ?? 'unknown'}).`,
      source: 'bulk',
      generatedAt,
      expiresAt,
    })),
    exclusions: collected.exclusions,
  };
  const rollback = {
    schema: 'whoisleuth.defensive-indicator-rollback',
    version: DEFENSIVE_INDICATOR_EXPORT_VERSION,
    generatedAt,
    removes: collected.domains.map((domain) => ({
      domain,
      includeWildcard: includeWildcards,
      reason: 'Remove the indicator generated by the paired reviewed manifest.',
    })),
  };
  return {
    version: DEFENSIVE_INDICATOR_EXPORT_VERSION,
    format,
    generatedAt,
    expiresAt,
    domains: collected.domains,
    entries: collected.entries,
    exclusions: collected.exclusions,
    explicitSelection: collected.explicitSelection,
    includeWildcards,
    truncated: collected.truncated,
    filename: `whoisleuth-defensive-domains-${generatedAt.slice(0, 10)}.${format === 'rpz' ? 'zone' : 'txt'}`,
    manifestFilename: `whoisleuth-defensive-domains-${generatedAt.slice(0, 10)}.manifest.json`,
    rollbackFilename: `whoisleuth-defensive-domains-${generatedAt.slice(0, 10)}.rollback.json`,
    mimeType: 'text/plain;charset=utf-8',
    content: `${contentFor(format, collected.domains, generatedAt, includeWildcards)}\n`,
    manifestContent: `${JSON.stringify(manifest, null, 2)}\n`,
    rollbackContent: `${JSON.stringify(rollback, null, 2)}\n`,
  };
}
