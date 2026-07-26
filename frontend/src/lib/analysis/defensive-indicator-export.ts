// Pure defensive-domain export formatting for filtered Bulk findings. These
// files are generated locally and never submitted or applied automatically.

import { normalizeDomain } from './case-model.js';

export const DEFENSIVE_INDICATOR_EXPORT_VERSION = 1;
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

export function isDefensiveIndicatorCandidate(value: unknown): boolean {
  const record = plainRecord(value);
  if (
    !record
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

function formatRpz(domains: readonly string[], generatedAt: string): string {
  const serial = Math.floor(Date.parse(generatedAt) / 1000) >>> 0;
  return [
    ...header(';', generatedAt, domains.length),
    '$TTL 60',
    `@ IN SOA localhost. root.localhost. (${serial} 60 60 60 60)`,
    '@ IN NS localhost.',
    ...domains.flatMap((domain) => [`${domain}. CNAME .`, `*.${domain}. CNAME .`]),
  ].join('\n');
}

function contentFor(format: DefensiveIndicatorFormat, domains: readonly string[], generatedAt: string): string {
  if (format === 'hosts') return formatHosts(domains, generatedAt);
  if (format === 'dnsmasq') return formatDnsmasq(domains, generatedAt);
  if (format === 'rpz') return formatRpz(domains, generatedAt);
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
  const collected = collectDefensiveIndicatorCandidates(records);
  return {
    version: DEFENSIVE_INDICATOR_EXPORT_VERSION,
    format,
    generatedAt,
    domains: collected.domains,
    truncated: collected.truncated,
    filename: `whoisleuth-defensive-domains-${generatedAt.slice(0, 10)}.${format === 'rpz' ? 'zone' : 'txt'}`,
    mimeType: 'text/plain;charset=utf-8',
    content: `${contentFor(format, collected.domains, generatedAt)}\n`,
  };
}
