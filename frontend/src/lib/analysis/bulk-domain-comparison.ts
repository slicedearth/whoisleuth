import {
  normalizeBulkSessionResult,
  type BulkSessionResult,
} from './bulk-session-model.ts';
import { sha256ArtifactDigest } from './artifact-integrity.ts';

export const BULK_DOMAIN_COMPARISON_SCHEMA = 'whoisleuth.domain-comparison';
export const BULK_DOMAIN_COMPARISON_VERSION = 1;

export type BulkDomainComparisonState = 'different' | 'equal' | 'missing' | 'unavailable';
export type BulkDomainComparisonCategory =
  | 'identity'
  | 'infrastructure'
  | 'mail'
  | 'registration'
  | 'source'
  | 'web';

export type BulkDomainComparisonRow = Readonly<{
  id: string;
  category: BulkDomainComparisonCategory;
  label: string;
  left: string;
  right: string;
  state: BulkDomainComparisonState;
  method: string;
  limitations: readonly string[];
}>;

export type BulkDomainComparison = Readonly<{
  version: 1;
  leftDomain: string;
  rightDomain: string;
  observedAt: string | null;
  rows: readonly BulkDomainComparisonRow[];
  counts: Readonly<Record<BulkDomainComparisonState, number>>;
  limitations: readonly string[];
}>;

type ComparableValue = boolean | number | string | null | readonly string[];

function text(value: unknown, maximum = 500): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, maximum)
    : '';
}

function timestamp(value: unknown): string | null {
  const normalized = text(value, 64);
  return normalized && Number.isFinite(Date.parse(normalized))
    ? new Date(normalized).toISOString()
    : null;
}

function list(value: readonly string[]): string[] {
  return [...new Set(value.map((item) => text(item, 253).toLowerCase()).filter(Boolean))]
    .sort()
    .slice(0, 100);
}

function normalized(value: ComparableValue): string | number | boolean | null | string[] {
  if (typeof value === 'string') {
    const normalizedText = text(value).toLowerCase();
    return normalizedText && normalizedText !== '—' ? normalizedText : null;
  }
  if (typeof value === 'boolean' || typeof value === 'number' || value === null) return value;
  return list(value);
}

function display(value: ComparableValue): string {
  if (value === null) return 'Not observed';
  if (typeof value === 'string') {
    const displayText = text(value);
    return displayText && displayText !== '—' ? displayText : 'Not observed';
  }
  if (typeof value === 'boolean') return value ? 'Observed' : 'Not observed';
  if (typeof value === 'number') return String(value);
  const values = [...new Set(value.map((item) => text(item, 253)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 100);
  return values.join(', ') || 'Not observed';
}

function state(left: ComparableValue, right: ComparableValue): BulkDomainComparisonState {
  const leftValue = normalized(left);
  const rightValue = normalized(right);
  const leftMissing = leftValue === null || (Array.isArray(leftValue) && leftValue.length === 0);
  const rightMissing = rightValue === null || (Array.isArray(rightValue) && rightValue.length === 0);
  if (leftMissing && rightMissing) return 'unavailable';
  if (leftMissing || rightMissing) return 'missing';
  return JSON.stringify(leftValue) === JSON.stringify(rightValue) ? 'equal' : 'different';
}

function row(
  id: string,
  category: BulkDomainComparisonCategory,
  label: string,
  left: ComparableValue,
  right: ComparableValue,
  method: string,
  limitations: readonly string[] = [],
): BulkDomainComparisonRow {
  return {
    id,
    category,
    label,
    left: display(left),
    right: display(right),
    state: state(left, right),
    method: text(method, 320),
    limitations: limitations.map((item) => text(item, 320)).filter(Boolean).slice(0, 6),
  };
}

function sourceSummary(value: BulkSessionResult): string[] {
  return value.sourceCoverage
    .map((item) => `${item.source}:${item.state}`)
    .sort()
    .slice(0, 20);
}

export function buildBulkDomainComparison(
  leftRaw: unknown,
  rightRaw: unknown,
  observedAtRaw: unknown = null,
): BulkDomainComparison | null {
  const left = normalizeBulkSessionResult(leftRaw);
  const right = normalizeBulkSessionResult(rightRaw);
  if (!left || !right || left.domain === right.domain) return null;
  const rows = [
    row('registration', 'registration', 'Registration', left.availability, right.availability, 'Stable compact availability state'),
    row('registrar', 'registration', 'Registrar', left.registrar, right.registrar, 'Normalized registrar display identity'),
    row('created', 'registration', 'Created', left.createdDate, right.createdDate, 'Source-reported lifecycle date'),
    row('expires', 'registration', 'Expires', left.expiryDate, right.expiryDate, 'Source-reported lifecycle date'),
    row('nameservers', 'infrastructure', 'Nameservers', left.nameservers, right.nameservers, 'Normalized exact set comparison'),
    row('ip-addresses', 'infrastructure', 'Observed IP addresses', left.relationship.ipAddresses, right.relationship.ipAddresses, 'Normalized exact set comparison', ['Shared hosting and CDNs are common and do not prove common control.']),
    row('certificate', 'infrastructure', 'Leaf certificate fingerprint', left.relationship.certificateFingerprint, right.relationship.certificateFingerprint, 'Exact SHA-256 comparison', ['Multi-domain certificates and managed hosting are common.']),
    row('mail', 'mail', 'MX observed', left.hasMx, right.hasMx, 'Compact Deep DNS observation'),
    row('spf', 'mail', 'SPF observed', left.hasSpf, right.hasSpf, 'Compact Deep DNS observation'),
    row('dmarc', 'mail', 'DMARC observed', left.hasDmarc, right.hasDmarc, 'Compact Deep DNS observation'),
    row('website', 'web', 'Website activity', left.activityStatus, right.activityStatus, 'Bounded homepage observation'),
    row('page-title', 'identity', 'Page title', left.pageTitle, right.pageTitle, 'Normalized bounded title equality'),
    row('favicon', 'identity', 'Favicon fingerprint', left.faviconHash, right.faviconHash, 'Exact SHA-256 comparison'),
    row('tracking', 'identity', 'Tracking identifiers', left.relationship.trackingIdentifiers, right.relationship.trackingIdentifiers, 'Normalized exact set comparison', ['Shared identifiers are an investigative lead, not proof of ownership.']),
    row('source-health', 'source', 'Recorded source coverage', sourceSummary(left), sourceSummary(right), 'Source-by-source compact state comparison', ['A source-state difference can reflect collection conditions rather than a domain change.']),
  ];
  const counts: Record<BulkDomainComparisonState, number> = {
    different: 0,
    equal: 0,
    missing: 0,
    unavailable: 0,
  };
  for (const comparisonRow of rows) counts[comparisonRow.state] += 1;
  return {
    version: BULK_DOMAIN_COMPARISON_VERSION,
    leftDomain: left.domain,
    rightDomain: right.domain,
    observedAt: timestamp(observedAtRaw),
    rows,
    counts,
    limitations: [
      'This compares compact settled evidence already present in Bulk and makes no new request.',
      'Missing, unavailable, and differently collected evidence remain distinct from an observed difference.',
      'Equality does not establish common ownership, infrastructure control, intent, safety, or maliciousness.',
    ],
  };
}

export async function buildBulkDomainComparisonExport(
  comparisonRaw: unknown,
  generatedAtRaw: unknown = new Date().toISOString(),
) {
  const comparison = comparisonRaw as BulkDomainComparison | null;
  if (!comparison || comparison.version !== BULK_DOMAIN_COMPARISON_VERSION) {
    throw new Error('Choose two settled domain results before exporting a comparison.');
  }
  const generatedAt = timestamp(generatedAtRaw) || new Date().toISOString();
  const unsigned = {
    schema: BULK_DOMAIN_COMPARISON_SCHEMA,
    version: BULK_DOMAIN_COMPARISON_VERSION,
    generatedAt,
    comparison,
  };
  const digestSha256 = await sha256ArtifactDigest(unsigned);
  const document = {
    ...unsigned,
    integrity: { algorithm: 'SHA-256' as const, digestSha256 },
  };
  return {
    document,
    content: `${JSON.stringify(document, null, 2)}\n`,
    filename: `whoisleuth-domain-comparison-${comparison.leftDomain}-and-${comparison.rightDomain}.json`,
  };
}
