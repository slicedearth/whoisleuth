// Pure defensive-domain export formatting for filtered Bulk findings. These
// files are generated locally and never submitted or applied automatically.

import { normalizeDomain } from './case-model.js';

export const DEFENSIVE_INDICATOR_EXPORT_VERSION = 1;
export const MAX_DEFENSIVE_INDICATORS = 2000;
export const MAX_DEFENSIVE_INDICATOR_INPUTS = MAX_DEFENSIVE_INDICATORS * 4;
export const DEFENSIVE_INDICATOR_FORMATS = Object.freeze(['domains', 'hosts', 'dnsmasq', 'rpz']);

const REGISTERED_STATES = new Set(['registered', 'for_sale', 'expiring']);
const MINIMUM_RISK_SCORE = 70;
const CONTROL_RE = /[\x00-\x1f\x7f]/;

function plainRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function riskScore(record) {
  const value = record.risk ?? record.riskScore;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function isDefensiveIndicatorCandidate(value) {
  const record = plainRecord(value);
  if (!record || record.trusted || record.status === 'error' || !REGISTERED_STATES.has(record.availability)) return false;
  return Boolean(normalizeDomain(record.domain)) && (riskScore(record) ?? -1) >= MINIMUM_RISK_SCORE;
}

function timestamp(value) {
  if (typeof value !== 'string' || value.length > 64 || CONTROL_RE.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function header(prefix, generatedAt, count) {
  return [
    `${prefix} WHOISleuth defensive domain indicators v${DEFENSIVE_INDICATOR_EXPORT_VERSION}`,
    `${prefix} Generated ${generatedAt}`,
    `${prefix} ${count} high-risk registered domain${count === 1 ? '' : 's'}`,
    `${prefix} Review before use. Heuristic findings can include false positives.`,
  ];
}

function formatDomains(domains, generatedAt) {
  return [...header('#', generatedAt, domains.length), ...domains].join('\n');
}

function formatHosts(domains, generatedAt) {
  return [...header('#', generatedAt, domains.length), ...domains.map((domain) => `0.0.0.0 ${domain}`)].join('\n');
}

function formatDnsmasq(domains, generatedAt) {
  return [...header('#', generatedAt, domains.length), ...domains.map((domain) => `address=/${domain}/0.0.0.0`)].join('\n');
}

function formatRpz(domains, generatedAt) {
  const serial = Math.floor(Date.parse(generatedAt) / 1000) >>> 0;
  return [
    ...header(';', generatedAt, domains.length),
    '$TTL 60',
    `@ IN SOA localhost. root.localhost. (${serial} 60 60 60 60)`,
    '@ IN NS localhost.',
    ...domains.flatMap((domain) => [`${domain}. CNAME .`, `*.${domain}. CNAME .`]),
  ].join('\n');
}

function contentFor(format, domains, generatedAt) {
  if (format === 'hosts') return formatHosts(domains, generatedAt);
  if (format === 'dnsmasq') return formatDnsmasq(domains, generatedAt);
  if (format === 'rpz') return formatRpz(domains, generatedAt);
  return formatDomains(domains, generatedAt);
}

export function buildDefensiveIndicatorExport(records, options = {}) {
  if (!Array.isArray(records)) throw new TypeError('Defensive indicator export requires an array of Bulk results.');
  const format = DEFENSIVE_INDICATOR_FORMATS.includes(options.format) ? options.format : 'domains';
  const generatedAt = timestamp(options.generatedAt) || new Date().toISOString();
  const domains = new Set();
  const input = records.slice(0, MAX_DEFENSIVE_INDICATOR_INPUTS);
  for (const item of input) {
    if (!isDefensiveIndicatorCandidate(item)) continue;
    domains.add(normalizeDomain(item.domain));
  }
  const sorted = [...domains].sort().slice(0, MAX_DEFENSIVE_INDICATORS);
  const truncated = records.length > MAX_DEFENSIVE_INDICATOR_INPUTS || domains.size > MAX_DEFENSIVE_INDICATORS;
  return {
    version: DEFENSIVE_INDICATOR_EXPORT_VERSION,
    format,
    generatedAt,
    domains: sorted,
    truncated,
    filename: `whoisleuth-defensive-domains-${generatedAt.slice(0, 10)}.${format === 'rpz' ? 'zone' : 'txt'}`,
    mimeType: 'text/plain;charset=utf-8',
    content: `${contentFor(format, sorted, generatedAt)}\n`,
  };
}
