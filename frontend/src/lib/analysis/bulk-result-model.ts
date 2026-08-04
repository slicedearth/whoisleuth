import type { CertificateTransparencyProvenance } from '../candidate-handoff-core.ts';
import type { WatchlistComparableRecord } from './watchlist-history.ts';
import { analyzeDomainIdn } from './idn-confusables.ts';
import type { CompactLookupHttpResponse } from './lookup-response.ts';
import type { RelationshipObservation } from './relationship-evidence.ts';
import { normalizeCaaCritical } from './dns-record-normalization.ts';
import {
  type BulkSessionDnsEvidence,
  type BulkSessionComparisonEvidence,
  type BulkSessionMode,
  type BulkSessionResult,
  type BulkSessionSourceCoverage,
  type BulkSessionSourceState,
} from './bulk-session-model.ts';

const MAX_COMPACT_TEXT_LENGTH = 500;
const MAX_COMPACT_DNS_RECORDS = 100;
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;

type IdnAnalysis = ReturnType<typeof analyzeDomainIdn>;

export type ScanMode = BulkSessionMode;
export type BulkDnsEvidence = BulkSessionDnsEvidence;
export type BulkContact = {
  name: string | null;
  org: string | null;
  email: string | null;
};
export type BulkAbuseEvidence = {
  abuseEmail: string | null;
};

export interface SavedScanRecord extends WatchlistComparableRecord {
  availability: string;
  registrarName: string;
  nameservers: string[];
  createdDate?: string | null;
  expiryDate?: string | null;
  privacyProtected?: boolean | null;
  hasMx?: boolean | null;
  hasNullMx?: boolean | null;
  hasSpf?: boolean | null;
  hasDmarc?: boolean | null;
  activityStatus?: string | null;
  pageTitle?: string | null;
  faviconHash: string | null;
  faviconPHash: string | null;
  faviconMatch?: boolean;
  faviconNearMatch?: boolean;
  reusesOfficialAssets?: boolean;
  hasPasswordField?: boolean | null;
  hasExternalFormAction?: boolean | null;
  phishingLanguageMatch?: string | null;
  idnReferenceMatch?: boolean | null;
  pageBaselineMatch?: boolean | null;
  hasActiveBrandProfile?: boolean | null;
  riskFactors: Array<{ label: string; points: number }>;
  opportunityModelVersion?: number | null;
  mutationTypes: string[];
  error?: string;
}

export interface ScanResult {
  domain: string;
  status: 'complete' | 'error';
  availability: string;
  confidence: string;
  registrar: string;
  activity: string;
  risk: number | null;
  opportunity: number | null;
  mutationTypes: string[];
  trusted: 'official' | 'partner' | 'allowlisted' | null;
  error: string;
  saved: SavedScanRecord;
  nameservers: string[];
  faviconHash: string | null;
  faviconPHash: string | null;
  faviconMatch: boolean;
  faviconNearMatch: boolean;
  reusesOfficialAssets: boolean;
  hasPasswordField: boolean;
  hasExternalFormAction: boolean | null;
  phishingLanguageMatch: string | null;
  registrant: BulkContact | null;
  abuseEvidence: BulkAbuseEvidence | null;
  ct: CertificateTransparencyProvenance | null;
  idn: IdnAnalysis | null;
  dns: BulkDnsEvidence | null;
  dnssec: string | null;
  comparisonEvidence?: BulkSessionComparisonEvidence | null;
  relationship: RelationshipObservation;
  sourceCoverage: BulkSessionSourceCoverage[];
}

export function plainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function boundedText(
  value: unknown,
  maximumLength = MAX_COMPACT_TEXT_LENGTH,
): string | null {
  return typeof value === 'string'
    && value.length <= maximumLength
    && !CONTROL_RE.test(value)
    ? value
    : null;
}

export function nullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function boundedStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value
      .slice(0, MAX_COMPACT_DNS_RECORDS)
      .filter((item): item is string => (
        typeof item === 'string'
        && item.length <= MAX_COMPACT_TEXT_LENGTH
        && !CONTROL_RE.test(item)
      ))
    : [];
}

export function compactContact(value: unknown): BulkContact | null {
  const item = plainRecord(value);
  if (!item) return null;
  return {
    name: boundedText(item.name),
    org: boundedText(item.org),
    email: boundedText(item.email, 320),
  };
}

export function compactDnsEvidence(value: unknown): BulkDnsEvidence | null {
  const dns = plainRecord(value);
  if (!dns) return null;
  const records = plainRecord(dns.records);
  const caa = Array.isArray(records?.caa)
    ? records.caa.slice(0, MAX_COMPACT_DNS_RECORDS).flatMap((value) => {
      const item = plainRecord(value);
      const tag = boundedText(item?.tag, 64);
      const recordValue = boundedText(item?.value);
      const critical = normalizeCaaCritical(item?.critical);
      return tag && recordValue && critical !== null
        ? [{ critical, tag, value: recordValue }]
        : [];
    })
    : [];
  return {
    status: boundedText(dns.status, 40),
    records: {
      a: boundedStrings(records?.a),
      aaaa: boundedStrings(records?.aaaa),
      cname: boundedStrings(records?.cname),
      caa,
    },
  };
}

function sourceState(value: unknown): BulkSessionSourceState | null {
  const normalized = boundedText(value, 40)?.toLowerCase();
  if (!normalized) return null;
  if (normalized === 'complete' || normalized === 'success') return 'complete';
  if (normalized === 'disabled' || normalized === 'skipped') return 'skipped';
  return [
    'partial',
    'unavailable',
    'unsupported',
    'not_found',
    'error',
  ].includes(normalized)
    ? normalized as BulkSessionSourceState
    : null;
}

export function compactSourceCoverage(
  body: CompactLookupHttpResponse,
  availability: Record<string, unknown>,
): BulkSessionSourceCoverage[] {
  const diagnostics = plainRecord(body.diagnostics);
  const sources: Array<[string, unknown]> = [
    ['rdap', plainRecord(diagnostics?.rdap)?.status],
    ['whois', plainRecord(diagnostics?.whois)?.status],
    ['availability', plainRecord(diagnostics?.availability)?.status],
    ['dns', plainRecord(availability.dns)?.status],
    ['http', plainRecord(availability.http)?.status],
    ['tls', plainRecord(availability.tls)?.status],
  ];
  return sources.flatMap(([source, value]) => {
    const state = sourceState(value);
    return state ? [{ source, state }] : [];
  });
}

export function toBulkSessionResult(row: ScanResult): BulkSessionResult {
  return {
    domain: row.domain,
    status: row.status,
    availability: row.availability,
    confidence: row.confidence,
    registrar: row.registrar,
    activity: row.activity,
    risk: row.risk,
    opportunity: row.opportunity,
    mutationTypes: row.mutationTypes,
    trusted: row.trusted,
    error: row.error,
    scanDepth: row.saved.scanDepth,
    createdDate: row.saved.createdDate ?? null,
    expiryDate: row.saved.expiryDate ?? null,
    privacyProtected: row.saved.privacyProtected ?? null,
    nameservers: row.nameservers,
    hasMx: row.saved.hasMx ?? null,
    hasNullMx: row.saved.hasNullMx ?? null,
    hasSpf: row.saved.hasSpf ?? null,
    hasDmarc: row.saved.hasDmarc ?? null,
    activityStatus: row.saved.activityStatus ?? null,
    pageTitle: row.saved.pageTitle ?? null,
    faviconHash: row.faviconHash,
    faviconPHash: row.faviconPHash,
    faviconMatch: row.faviconMatch,
    faviconNearMatch: row.faviconNearMatch,
    reusesOfficialAssets: row.reusesOfficialAssets,
    hasPasswordField: row.hasPasswordField,
    hasExternalFormAction: row.hasExternalFormAction,
    phishingLanguageMatch: row.phishingLanguageMatch,
    idnReferenceMatch: row.saved.idnReferenceMatch ?? null,
    pageBaselineMatch: row.saved.pageBaselineMatch ?? null,
    hasActiveBrandProfile: row.saved.hasActiveBrandProfile ?? null,
    riskModelVersion: row.saved.riskModelVersion ?? null,
    opportunityModelVersion: row.saved.opportunityModelVersion ?? null,
    riskFactors: row.saved.riskFactors,
    dns: row.dns,
    dnssec: row.dnssec,
    comparisonEvidence: row.comparisonEvidence ?? null,
    relationship: row.relationship,
    sourceCoverage: row.sourceCoverage,
  };
}

export function fromBulkSessionResult(
  row: BulkSessionResult,
  officialDomains: readonly string[] = [],
): ScanResult {
  const saved: SavedScanRecord = {
    domain: row.domain,
    scanDepth: row.scanDepth,
    availability: row.availability,
    registrarName: row.registrar,
    nameservers: row.nameservers,
    createdDate: row.createdDate,
    expiryDate: row.expiryDate,
    privacyProtected: row.privacyProtected ?? null,
    hasMx: row.hasMx,
    hasNullMx: row.hasNullMx,
    hasSpf: row.hasSpf,
    hasDmarc: row.hasDmarc,
    activityStatus: row.activityStatus,
    pageTitle: row.pageTitle,
    faviconHash: row.faviconHash,
    faviconPHash: row.faviconPHash,
    faviconMatch: row.faviconMatch,
    faviconNearMatch: row.faviconNearMatch,
    reusesOfficialAssets: row.reusesOfficialAssets,
    hasPasswordField: row.hasPasswordField,
    hasExternalFormAction: row.hasExternalFormAction,
    phishingLanguageMatch: row.phishingLanguageMatch,
    idnReferenceMatch: row.idnReferenceMatch ?? null,
    pageBaselineMatch: row.pageBaselineMatch ?? null,
    hasActiveBrandProfile: row.hasActiveBrandProfile ?? null,
    riskModelVersion: row.riskModelVersion,
    opportunityModelVersion: row.opportunityModelVersion ?? null,
    riskScore: row.risk,
    riskFactors: row.riskFactors,
    mutationTypes: row.mutationTypes,
    ...(row.error ? { error: row.error } : {}),
  };
  return {
    domain: row.domain,
    status: row.status,
    availability: row.availability,
    confidence: row.confidence,
    registrar: row.registrar,
    activity: row.activity,
    risk: row.risk,
    opportunity: row.opportunity,
    mutationTypes: row.mutationTypes,
    trusted: row.trusted,
    error: row.error,
    saved,
    nameservers: row.nameservers,
    faviconHash: row.faviconHash,
    faviconPHash: row.faviconPHash,
    faviconMatch: row.faviconMatch,
    faviconNearMatch: row.faviconNearMatch,
    reusesOfficialAssets: row.reusesOfficialAssets,
    hasPasswordField: row.hasPasswordField,
    hasExternalFormAction: row.hasExternalFormAction,
    phishingLanguageMatch: row.phishingLanguageMatch,
    registrant: null,
    abuseEvidence: null,
    ct: null,
    idn: analyzeDomainIdn(row.domain, officialDomains),
    dns: row.dns,
    dnssec: row.dnssec,
    comparisonEvidence: row.comparisonEvidence ?? null,
    relationship: row.relationship,
    sourceCoverage: row.sourceCoverage,
  };
}

export async function bulkSessionInputDigest(
  domains: readonly string[],
  mode: ScanMode,
): Promise<string> {
  const bytes = new TextEncoder().encode(`${mode}\u0000${domains.join('\n')}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${[...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

export function createBulkSessionId(
  options: Readonly<{
    randomUUID?: (() => string) | false;
    now?: () => number;
    random?: () => number;
  }> = {},
): string {
  const randomUUID = options.randomUUID === false
    ? null
    : options.randomUUID ?? globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUUID) return randomUUID();
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  return `bulk-${now()}-${random().toString(36).slice(2)}`;
}
