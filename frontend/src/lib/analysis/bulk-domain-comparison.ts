import {
  normalizeBulkSessionResult,
  type BulkSessionDnsEvidence,
  type BulkSessionResult,
  type BulkSessionSourceState,
} from './bulk-session-model.ts';
import { SORTED_JSON_V2, sha256ArtifactDigestV2 } from './artifact-integrity.ts';
import { BULK_REVIEW_STALE_AFTER_DAYS } from './bulk-retry-plan.ts';

export const BULK_DOMAIN_COMPARISON_SCHEMA = 'whoisleuth.domain-comparison';
export const BULK_DOMAIN_COMPARISON_VERSION = 3;
export const BULK_DOMAIN_COMPARISON_EXPORT_VERSION = 4;

export type BulkDomainComparisonState =
  | 'conflicting'
  | 'different'
  | 'equal'
  | 'missing'
  | 'not_recorded'
  | 'unavailable';
export type BulkDomainComparisonCategory =
  | 'certificate'
  | 'dns'
  | 'identity'
  | 'infrastructure'
  | 'lifecycle'
  | 'mail'
  | 'registration'
  | 'source'
  | 'technology'
  | 'web';
export type BulkDomainComparisonSourceState = BulkSessionSourceState | 'not_recorded';

export type BulkDomainComparisonRow = Readonly<{
  id: string;
  category: BulkDomainComparisonCategory;
  label: string;
  left: string;
  right: string;
  state: BulkDomainComparisonState;
  method: string;
  source: string;
  leftSourceState: BulkDomainComparisonSourceState;
  rightSourceState: BulkDomainComparisonSourceState;
  observedAt: string | null;
  leftEvidenceHref: string;
  rightEvidenceHref: string;
  limitations: readonly string[];
}>;

export type BulkDomainComparison = Readonly<{
  version: 3;
  leftDomain: string;
  rightDomain: string;
  observedAt: string | null;
  freshness: Readonly<{
    state: 'current' | 'stale' | 'unknown';
    ageDays: number | null;
  }>;
  rows: readonly BulkDomainComparisonRow[];
  counts: Readonly<Record<BulkDomainComparisonState, number>>;
  limitations: readonly string[];
}>;

type ComparableValue = boolean | number | string | null | readonly string[];
type ComparisonOptions = Readonly<{
  allowSameDomain?: boolean;
  leftEvidenceHref?: unknown;
  now?: number;
  rightEvidenceHref?: unknown;
}>;

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

function sourceState(
  value: BulkSessionResult,
  sources: readonly string[],
): BulkDomainComparisonSourceState {
  if (sources.length === 0) {
    return value.sourceCoverage.length > 0 ? 'complete' : 'not_recorded';
  }
  for (const source of sources) {
    const observed = value.sourceCoverage.find((item) => item.source === source);
    if (observed) return observed.state;
  }
  return 'not_recorded';
}

function unavailableSource(state: BulkDomainComparisonSourceState): boolean {
  return ['error', 'partial', 'skipped', 'unavailable', 'unsupported'].includes(state);
}

function state(
  left: ComparableValue,
  right: ComparableValue,
  leftSourceState: BulkDomainComparisonSourceState,
  rightSourceState: BulkDomainComparisonSourceState,
  options: Readonly<{ conflicting?: boolean; retained?: boolean }> = {},
): BulkDomainComparisonState {
  if (options.retained === false) return 'not_recorded';
  if (options.conflicting) return 'conflicting';
  const leftValue = normalized(left);
  const rightValue = normalized(right);
  const leftMissing = leftValue === null || (Array.isArray(leftValue) && leftValue.length === 0);
  const rightMissing = rightValue === null || (Array.isArray(rightValue) && rightValue.length === 0);
  if (leftMissing || rightMissing) {
    if (
      (leftMissing && leftSourceState === 'not_recorded')
      || (rightMissing && rightSourceState === 'not_recorded')
    ) return 'not_recorded';
    if (
      (leftMissing && unavailableSource(leftSourceState))
      || (rightMissing && unavailableSource(rightSourceState))
    ) return 'unavailable';
    if (leftMissing && rightMissing) return 'unavailable';
    return 'missing';
  }
  return JSON.stringify(leftValue) === JSON.stringify(rightValue) ? 'equal' : 'different';
}

function evidenceHref(value: unknown): string {
  return typeof value === 'string' && /^#bulk-result-\d{1,4}$/u.test(value) ? value : '';
}

function row(
  id: string,
  category: BulkDomainComparisonCategory,
  label: string,
  left: ComparableValue,
  right: ComparableValue,
  method: string,
  context: Readonly<{
    leftEvidenceHref: string;
    leftSourceState: BulkDomainComparisonSourceState;
    observedAt: string | null;
    rightEvidenceHref: string;
    rightSourceState: BulkDomainComparisonSourceState;
    source: string;
  }>,
  limitations: readonly string[] = [],
  options: Readonly<{ conflicting?: boolean; retained?: boolean }> = {},
): BulkDomainComparisonRow {
  return {
    id,
    category,
    label,
    left: options.retained === false ? 'Not recorded in compact Bulk evidence' : display(left),
    right: options.retained === false ? 'Not recorded in compact Bulk evidence' : display(right),
    state: state(left, right, context.leftSourceState, context.rightSourceState, options),
    method: text(method, 320),
    source: text(context.source, 80),
    leftSourceState: context.leftSourceState,
    rightSourceState: context.rightSourceState,
    observedAt: context.observedAt,
    leftEvidenceHref: context.leftEvidenceHref,
    rightEvidenceHref: context.rightEvidenceHref,
    limitations: limitations.map((item) => text(item, 320)).filter(Boolean).slice(0, 6),
  };
}

function sourceSummary(value: BulkSessionResult): string[] {
  return value.sourceCoverage
    .map((item) => `${item.source}:${item.state}`)
    .sort()
    .slice(0, 20);
}

function dnsValues(value: BulkSessionResult, type: keyof BulkSessionDnsEvidence['records']): string[] {
  if (!value.dns) return [];
  const records = value.dns.records[type];
  return type === 'caa'
    ? (records as Array<{ critical: number; tag: string; value: string }>)
      .map((item) => `${item.critical} ${item.tag} ${item.value}`)
    : records as string[];
}

function context(
  left: BulkSessionResult,
  right: BulkSessionResult,
  source: string,
  sources: readonly string[],
  observedAt: string | null,
  options: ComparisonOptions,
) {
  return {
    source,
    leftSourceState: sourceState(left, sources),
    rightSourceState: sourceState(right, sources),
    observedAt,
    leftEvidenceHref: evidenceHref(options.leftEvidenceHref),
    rightEvidenceHref: evidenceHref(options.rightEvidenceHref),
  };
}

function comparisonEvidenceContext(
  left: BulkSessionResult,
  right: BulkSessionResult,
  family: 'technology' | 'tls',
  base: ReturnType<typeof context>,
) {
  const stateFor = (value: BulkSessionResult): BulkDomainComparisonSourceState => {
    const state = value.comparisonEvidence?.[family].state;
    if (!state) return 'not_recorded';
    return state === 'success' ? 'complete' : state;
  };
  return {
    ...base,
    leftSourceState: stateFor(left),
    rightSourceState: stateFor(right),
  };
}

function freshness(
  observedAt: string | null,
  now: number,
): BulkDomainComparison['freshness'] {
  if (!observedAt) return { state: 'unknown', ageDays: null };
  const ageDays = Math.max(0, Math.floor((now - Date.parse(observedAt)) / 86_400_000));
  return {
    state: ageDays >= BULK_REVIEW_STALE_AFTER_DAYS ? 'stale' : 'current',
    ageDays,
  };
}

export function buildBulkDomainComparison(
  leftRaw: unknown,
  rightRaw: unknown,
  observedAtRaw: unknown = null,
  options: ComparisonOptions = {},
): BulkDomainComparison | null {
  const left = normalizeBulkSessionResult(leftRaw);
  const right = normalizeBulkSessionResult(rightRaw);
  if (!left || !right || (left.domain === right.domain && !options.allowSameDomain)) return null;
  const observedAt = timestamp(observedAtRaw);
  const registry = context(left, right, 'Registry and registrar evidence', ['rdap', 'availability'], observedAt, options);
  const dns = context(left, right, 'DNS evidence', ['dns'], observedAt, options);
  const http = context(left, right, 'HTTP and static page evidence', ['http'], observedAt, options);
  const tls = context(left, right, 'TLS evidence', ['tls'], observedAt, options);
  const compactTechnology = comparisonEvidenceContext(left, right, 'technology', {
    ...http,
    source: 'Bounded technology identifiers',
  });
  const compactTls = comparisonEvidenceContext(left, right, 'tls', tls);
  const source = context(left, right, 'Recorded source coverage', [], observedAt, options);
  const profileContextsComparable = left.profileContext.sourceState === 'ready'
    && right.profileContext.sourceState === 'ready'
    && left.profileContext.activeProfileId === right.profileContext.activeProfileId
    && left.profileContext.profileUpdatedAt === right.profileContext.profileUpdatedAt;
  const profileContext = {
    ...http,
    source: 'Brand Profile comparison context',
    leftSourceState: profileContextsComparable ? 'complete' as const : 'unavailable' as const,
    rightSourceState: profileContextsComparable ? 'complete' as const : 'unavailable' as const,
  };
  const profileLimitations = profileContextsComparable
    ? []
    : [
        left.profileContext.limitation,
        right.profileContext.limitation,
        'Official-asset comparison is withheld unless both rows retain the same ready Brand Profile provenance.',
      ].filter(Boolean);
  const registrationConflicting = [left.availability, right.availability]
    .some((value) => ['conflict', 'conflicting'].includes(value.toLowerCase()));
  const rows = [
    row('registration', 'registration', 'Registration', left.availability, right.availability, 'Authority-aware compact availability state', registry, [], { conflicting: registrationConflicting }),
    row('registrar', 'registration', 'Registrar', left.registrar, right.registrar, 'Normalised registrar display identity', registry),
    row('created', 'lifecycle', 'Created', left.createdDate, right.createdDate, 'Source-reported lifecycle date', registry),
    row('expires', 'lifecycle', 'Expires', left.expiryDate, right.expiryDate, 'Source-reported lifecycle date', registry),
    row('nameservers', 'infrastructure', 'Nameservers', left.nameservers, right.nameservers, 'Normalised exact set comparison', registry),
    row('dns-a', 'dns', 'A records', dnsValues(left, 'a'), dnsValues(right, 'a'), 'Normalised exact retained DNS answer set', dns),
    row('dns-aaaa', 'dns', 'AAAA records', dnsValues(left, 'aaaa'), dnsValues(right, 'aaaa'), 'Normalised exact retained DNS answer set', dns),
    row('dns-cname', 'dns', 'CNAME records', dnsValues(left, 'cname'), dnsValues(right, 'cname'), 'Normalised exact retained DNS answer set', dns),
    row('dns-caa', 'dns', 'CAA records', dnsValues(left, 'caa'), dnsValues(right, 'caa'), 'Normalised exact retained DNS answer set', dns),
    row('dnssec', 'dns', 'DNSSEC state', left.dnssec, right.dnssec, 'Separately attributed compact DNSSEC observation', dns),
    row('ip-addresses', 'infrastructure', 'Observed IP addresses', left.relationship.ipAddresses, right.relationship.ipAddresses, 'Normalised exact set comparison', dns, ['Shared hosting and CDNs are common and do not prove common control.']),
    row('tls-source', 'certificate', 'TLS collection', tls.leftSourceState, tls.rightSourceState, 'Retained compact source-state comparison', tls),
    row('certificate', 'certificate', 'Leaf certificate fingerprint', left.relationship.certificateFingerprint, right.relationship.certificateFingerprint, 'Exact SHA-256 comparison', tls, ['Multi-domain certificates and managed hosting are common.']),
    row('tls-issuer', 'certificate', 'TLS issuer label', left.comparisonEvidence?.tls.issuerLabel ?? null, right.comparisonEvidence?.tls.issuerLabel ?? null, 'Normalised retained issuer-label comparison', compactTls, ['Issuer labels are certificate metadata and do not establish common ownership or control.']),
    row('tls-spki', 'certificate', 'TLS public-key fingerprint', left.comparisonEvidence?.tls.spkiSha256 ?? null, right.comparisonEvidence?.tls.spkiSha256 ?? null, 'Exact SPKI SHA-256 comparison', compactTls, ['Public-key reuse can be an investigative lead but does not establish ownership, intent, safety, or maliciousness.']),
    row('mail', 'mail', 'MX observed', left.hasMx, right.hasMx, 'Compact Deep DNS observation', dns),
    row('null-mx', 'mail', 'Null MX observed', left.hasNullMx, right.hasNullMx, 'Compact Deep DNS observation', dns),
    row('spf', 'mail', 'SPF observed', left.hasSpf, right.hasSpf, 'Compact Deep DNS observation', dns),
    row('dmarc', 'mail', 'DMARC observed', left.hasDmarc, right.hasDmarc, 'Compact Deep DNS observation', dns),
    row('website', 'web', 'Website activity', left.activityStatus, right.activityStatus, 'Bounded homepage observation', http),
    row('page-title', 'identity', 'Page title', left.pageTitle, right.pageTitle, 'Normalised bounded title equality', http),
    row('favicon', 'identity', 'Favicon fingerprint', left.faviconHash, right.faviconHash, 'Exact SHA-256 comparison', http),
    row('tracking', 'identity', 'Tracking identifiers', left.relationship.trackingIdentifiers, right.relationship.trackingIdentifiers, 'Normalised exact set comparison', http, ['Shared identifiers are an investigative lead, not proof of ownership.']),
    row('password-field', 'identity', 'Password field', left.hasPasswordField, right.hasPasswordField, 'Bounded static form observation', http),
    row('phishing-language', 'identity', 'Phishing-language indicator', left.phishingLanguageMatch, right.phishingLanguageMatch, 'Bounded explainable page-language signal', http, ['A wording match is a review lead, not proof of malicious intent.']),
    row('official-assets', 'identity', 'Official asset reuse', profileContextsComparable ? left.reusesOfficialAssets : null, profileContextsComparable ? right.reusesOfficialAssets : null, 'Configured Brand Profile comparison', profileContext, profileLimitations),
    row('technology', 'technology', 'Technology identifiers', left.comparisonEvidence?.technology.ids ?? [], right.comparisonEvidence?.technology.ids ?? [], 'Normalised exact set comparison of at most 12 curated identifiers', compactTechnology, ['An unmatched identifier is not evidence that a technology is absent. Shared technologies do not establish common ownership or control.']),
    row('source-health', 'source', 'Recorded source coverage', sourceSummary(left), sourceSummary(right), 'Source-by-source compact state comparison', source, ['A source-state difference can reflect collection conditions rather than a domain change.']),
  ];
  const counts: Record<BulkDomainComparisonState, number> = {
    conflicting: 0,
    different: 0,
    equal: 0,
    missing: 0,
    not_recorded: 0,
    unavailable: 0,
  };
  for (const comparisonRow of rows) counts[comparisonRow.state] += 1;
  return {
    version: BULK_DOMAIN_COMPARISON_VERSION,
    leftDomain: left.domain,
    rightDomain: right.domain,
    observedAt,
    freshness: freshness(observedAt, options.now ?? Date.now()),
    rows,
    counts,
    limitations: options.allowSameDomain
      ? [
        'This compares normalised evidence already present in two saved observations for the same domain and makes no new request.',
        'Missing, unavailable, and differently collected evidence remain distinct from an observed difference.',
        'An observed difference can reflect changed collection conditions and does not by itself establish current state, ownership, intent, safety, or maliciousness.',
        ...(!profileContextsComparable ? ['Profile-derived identity comparison is unavailable because the saved Brand Profile contexts are not ready and identical.'] : []),
      ]
      : [
        'This compares compact settled evidence already present in Bulk and makes no new request.',
        'Missing, unavailable, and differently collected evidence remain distinct from an observed difference.',
        'Equality does not establish common ownership, infrastructure control, intent, safety, or maliciousness.',
        ...(!profileContextsComparable ? ['Profile-derived identity comparison is unavailable because the saved Brand Profile contexts are not ready and identical.'] : []),
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
    version: BULK_DOMAIN_COMPARISON_EXPORT_VERSION,
    generatedAt,
    comparison,
  };
  const digestSha256 = await sha256ArtifactDigestV2(unsigned);
  const document = {
    ...unsigned,
    integrity: { algorithm: 'SHA-256' as const, canonicalization: SORTED_JSON_V2, digestSha256 },
  };
  return {
    document,
    content: `${JSON.stringify(document, null, 2)}\n`,
    filename: `whoisleuth-domain-comparison-${comparison.leftDomain}-and-${comparison.rightDomain}.json`,
  };
}
