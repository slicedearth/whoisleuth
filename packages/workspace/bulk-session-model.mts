// Pure, bounded persistence model for analyst-saved Bulk investigations.
// Sessions retain compact derived rows and source states, never raw registry,
// WHOIS, HTTP, TLS, page, or provider payloads.

import { normalizeDomain } from '../cases/case-model.mts';
import { normalizeCaaCritical } from './dns-record-normalization.mts';
import { normalizeExplicitIsoTimestamp, normalizeLegacyIsoTimestamp } from '../evidence/observation.mts';
import { assertWorkspaceDeclaredVersion, assertWorkspaceInputGraph, assertWorkspacePortableVersion, ordinaryWorkspaceRecord } from './hostile-input.mts';
import {
  BULK_SESSION_SCHEMA,
  BULK_SESSION_SCHEMA_VERSION,
  MAX_BULK_PROFILE_CONTEXT_LIMITATION_LENGTH,
  MAX_BULK_SESSIONS,
  MAX_BULK_SESSION_ARRAY_VALUES,
  MAX_BULK_SESSION_NAME_LENGTH,
  MAX_BULK_SESSION_ROWS,
  MAX_BULK_SESSION_SOURCES,
  MAX_BULK_SESSION_STORE_BYTES,
  MAX_BULK_SESSION_TEXT_LENGTH,
  SUPPORTED_BULK_SESSION_SCHEMA_VERSIONS,
} from '../contracts/workspace-portability.mts';

export {
  BULK_SESSION_SCHEMA,
  BULK_SESSION_SCHEMA_VERSION,
  MAX_BULK_PROFILE_CONTEXT_LIMITATION_LENGTH,
  MAX_BULK_SESSIONS,
  MAX_BULK_SESSION_ARRAY_VALUES,
  MAX_BULK_SESSION_NAME_LENGTH,
  MAX_BULK_SESSION_ROWS,
  MAX_BULK_SESSION_SOURCES,
  MAX_BULK_SESSION_STORE_BYTES,
  MAX_BULK_SESSION_TEXT_LENGTH,
  SUPPORTED_BULK_SESSION_SCHEMA_VERSIONS,
} from '../contracts/workspace-portability.mts';
export const BULK_PROFILE_CONTEXT_UNAVAILABLE_LIMITATION = 'Brand Profile context was unavailable when this row was evaluated. Trust, profile matches, and the profile-dependent Risk assessment remain inconclusive.';
export const BULK_PROFILE_CONTEXT_LEGACY_LIMITATION = 'This legacy Bulk row did not retain profile-context provenance. Trust, profile matches, and the potentially profile-influenced Risk assessment are withheld until the domain is rescanned.';
export const BULK_PROFILE_CONTEXT_MISMATCH_LIMITATION = 'This saved Bulk row was evaluated with a different or unreadable Brand Profile context. Profile-derived conclusions and the Risk assessment are withheld until the domain is rescanned.';
export const BULK_PROFILE_CONTEXT_IMPORTED_LIMITATION = 'This row came from a portable import whose claimed Brand Profile identity and revision cannot authenticate profile-derived conclusions. Trust, profile matches, and the potentially profile-influenced Risk assessment are withheld until the domain is rescanned locally.';

const CONTROL_RE = /[\x00-\x1f\x7f]/u;
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/u;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;
const HASH_64_RE = /^[a-f0-9]{64}$/iu;
const PHASH_RE = /^[a-f0-9]{16}$/iu;
const SOURCE_RE = /^[a-z][a-z0-9_-]{0,39}$/u;
const TECHNOLOGY_ID_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/u;
const TRACKING_IDENTIFIER_RE = /^[a-z-]{1,40}:[A-Z0-9-]{1,64}$/u;
const SESSION_STATES = new Set(['complete', 'partial', 'cancelled']);
const RESULT_STATES = new Set(['complete', 'error']);
const MODES = new Set(['fast', 'deep']);
const SOURCE_STATES = new Set([
  'complete',
  'partial',
  'skipped',
  'unavailable',
  'unsupported',
  'not_found',
  'error',
]);
const TRUST_STATES = new Set(['official', 'partner', 'allowlisted']);
const COMPARISON_STATES = new Set(['error', 'not_found', 'partial', 'success', 'unavailable']);

type UnknownRecord = Record<string, unknown>;

export type BulkSessionMode = 'deep' | 'fast';
export type BulkSessionState = 'cancelled' | 'complete' | 'partial';
export type BulkSessionSourceState =
  | 'complete'
  | 'error'
  | 'not_found'
  | 'partial'
  | 'skipped'
  | 'unavailable'
  | 'unsupported';

export type BulkSessionSourceCoverage = {
  source: string;
  state: BulkSessionSourceState;
};

export type BulkSessionRiskFactor = {
  label: string;
  points: number;
};

export type BulkProfileContextSourceState = 'mixed' | 'ready' | 'unavailable';
export type BulkProfileContextProvenance = {
  sourceState: BulkProfileContextSourceState;
  activeProfileId: string | null;
  profileUpdatedAt: string | null;
  limitation: string;
};

export type BulkSessionRelationship = {
  version: 2;
  nameservers: string[];
  ipAddresses: string[];
  trackingIdentifiers: string[];
  officialAssetHosts: string[];
  faviconHash: string | null;
  faviconPHash: string | null;
  certificateFingerprint: string | null;
  truncated: boolean;
};

export type BulkSessionDnsEvidence = {
  status: string | null;
  records: {
    a: string[];
    aaaa: string[];
    cname: string[];
    caa: Array<{ critical: number; tag: string; value: string }>;
  };
};

export type BulkSessionComparisonEvidence = {
  version: 1;
  technology: {
    state: 'error' | 'not_found' | 'partial' | 'success' | 'unavailable';
    ids: string[];
    truncated: boolean;
  };
  tls: {
    state: 'error' | 'not_found' | 'partial' | 'success' | 'unavailable';
    issuerLabel: string | null;
    spkiSha256: string | null;
  };
};

export type BulkSessionResult = {
  domain: string;
  status: 'complete' | 'error';
  availability: string;
  confidence: string;
  registrar: string;
  activity: string;
  risk: number | null;
  opportunity: number | null;
  mutationTypes: string[];
  trusted: 'allowlisted' | 'official' | 'partner' | null;
  error: string;
  scanDepth: BulkSessionMode;
  createdDate: string | null;
  expiryDate: string | null;
  privacyProtected?: boolean | null;
  nameservers: string[];
  hasMx: boolean | null;
  hasNullMx: boolean | null;
  hasSpf: boolean | null;
  hasDmarc: boolean | null;
  activityStatus: string | null;
  pageTitle: string | null;
  faviconHash: string | null;
  faviconPHash: string | null;
  faviconMatch: boolean | null;
  faviconNearMatch: boolean | null;
  reusesOfficialAssets: boolean | null;
  hasPasswordField: boolean;
  hasExternalFormAction: boolean | null;
  phishingLanguageMatch: string | null;
  idnReferenceMatch?: boolean | null;
  pageBaselineMatch?: boolean | null;
  hasActiveBrandProfile?: boolean | null;
  riskModelVersion: number | null;
  opportunityModelVersion?: number | null;
  riskFactors: BulkSessionRiskFactor[];
  dns: BulkSessionDnsEvidence | null;
  dnssec: string | null;
  comparisonEvidence?: BulkSessionComparisonEvidence | null;
  relationship: BulkSessionRelationship;
  sourceCoverage: BulkSessionSourceCoverage[];
  profileContext: BulkProfileContextProvenance;
};

export type BulkSession = {
  id: string;
  name: string;
  mode: BulkSessionMode;
  state: BulkSessionState;
  inputDigest: string;
  domains: string[];
  results: BulkSessionResult[];
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  profileContext: BulkProfileContextProvenance;
};

export type BulkSessionStore = {
  schema: typeof BULK_SESSION_SCHEMA;
  version: typeof BULK_SESSION_SCHEMA_VERSION;
  sessions: BulkSession[];
};

export type BulkSessionComparisonRow = {
  domain: string;
  changes: string[];
};

export type BulkSessionComparison = {
  baselineId: string;
  currentId: string;
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  rows: BulkSessionComparisonRow[];
  limitations: string[];
};

function record(value: unknown): UnknownRecord | null {
  return ordinaryWorkspaceRecord(value, 'Bulk-session input');
}

function boundedText(value: unknown, maximum = MAX_BULK_SESSION_TEXT_LENGTH): string {
  return typeof value === 'string' && value.length <= maximum && !CONTROL_RE.test(value)
    ? value.trim()
    : '';
}

function timestamp(value: unknown, fallback: string | null = null, legacy = false): string | null {
  const normalized = normalizeExplicitIsoTimestamp(value);
  if (normalized) return normalized;
  return (legacy ? normalizeLegacyIsoTimestamp(value) : null) ?? fallback;
}

function profileContextLimitation(value: unknown, fallback: string): string {
  return boundedText(value, MAX_BULK_PROFILE_CONTEXT_LIMITATION_LENGTH) || fallback;
}

export function unavailableBulkProfileContext(
  limitation = BULK_PROFILE_CONTEXT_UNAVAILABLE_LIMITATION,
): BulkProfileContextProvenance {
  return {
    sourceState: 'unavailable',
    activeProfileId: null,
    profileUpdatedAt: null,
    limitation: profileContextLimitation(limitation, BULK_PROFILE_CONTEXT_UNAVAILABLE_LIMITATION),
  };
}

export function bulkProfileContextProvenance(
  sourceState: unknown,
  profileRaw: unknown,
): BulkProfileContextProvenance {
  if (sourceState !== 'ready') return unavailableBulkProfileContext();
  if (profileRaw === null || profileRaw === undefined) {
    return { sourceState: 'ready', activeProfileId: null, profileUpdatedAt: null, limitation: '' };
  }
  const profile = record(profileRaw);
  const activeProfileId = typeof profile?.id === 'string' && SAFE_ID_RE.test(profile.id) ? profile.id : null;
  const profileUpdatedAt = timestamp(profile?.updatedAt);
  return activeProfileId && profileUpdatedAt
    ? { sourceState: 'ready', activeProfileId, profileUpdatedAt, limitation: '' }
    : unavailableBulkProfileContext('The active Brand Profile identity or revision was invalid when this row was evaluated. Profile-derived conclusions and the Risk assessment remain inconclusive.');
}

export function normalizeBulkProfileContext(
  value: unknown,
  fallbackLimitation = BULK_PROFILE_CONTEXT_UNAVAILABLE_LIMITATION,
): BulkProfileContextProvenance {
  const item = record(value);
  const sourceState = item?.sourceState;
  if (sourceState === 'ready') {
    if (item?.activeProfileId === null && item.profileUpdatedAt === null) {
      return { sourceState: 'ready', activeProfileId: null, profileUpdatedAt: null, limitation: '' };
    }
    const activeProfileId = typeof item?.activeProfileId === 'string' && SAFE_ID_RE.test(item.activeProfileId)
      ? item.activeProfileId
      : null;
    const profileUpdatedAt = timestamp(item?.profileUpdatedAt);
    if (activeProfileId && profileUpdatedAt) {
      return { sourceState: 'ready', activeProfileId, profileUpdatedAt, limitation: '' };
    }
  }
  if (sourceState === 'mixed') {
    return {
      sourceState: 'mixed',
      activeProfileId: null,
      profileUpdatedAt: null,
      limitation: profileContextLimitation(item?.limitation, 'Rows in this saved Bulk session were evaluated under more than one Brand Profile context. Review each row provenance before comparison.'),
    };
  }
  return unavailableBulkProfileContext(profileContextLimitation(item?.limitation, fallbackLimitation));
}

function sameProfileContext(left: BulkProfileContextProvenance, right: BulkProfileContextProvenance): boolean {
  return left.sourceState === right.sourceState
    && left.activeProfileId === right.activeProfileId
    && left.profileUpdatedAt === right.profileUpdatedAt
    && left.limitation === right.limitation;
}

export function summarizeBulkProfileContexts(
  rows: readonly Readonly<{ profileContext: BulkProfileContextProvenance }>[],
): BulkProfileContextProvenance {
  const first = rows[0]?.profileContext;
  if (!first) return unavailableBulkProfileContext('This saved Bulk session contains no settled row with profile-context provenance.');
  if (rows.every((row) => sameProfileContext(first, row.profileContext))) return { ...first };
  return {
    sourceState: 'mixed',
    activeProfileId: null,
    profileUpdatedAt: null,
    limitation: 'Rows in this saved Bulk session were evaluated under more than one Brand Profile context. Review each row provenance before comparison.',
  };
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function nullableScore(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? Math.round(value)
    : null;
}

function nullableVersion(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 10_000
    ? value
    : null;
}

function boundedStrings(value: unknown, maximum = MAX_BULK_SESSION_ARRAY_VALUES): string[] {
  if (!Array.isArray(value)) return [];
  const output = new Set<string>();
  for (const candidate of value.slice(0, maximum * 4)) {
    const text = boundedText(candidate, 253).toLowerCase().replace(/\.$/u, '');
    if (text) output.add(text);
    if (output.size >= maximum) break;
  }
  return [...output];
}

function boundedTrackingIdentifiers(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const output = new Set<string>();
  for (const candidate of value.slice(0, 120)) {
    const text = boundedText(candidate, 105);
    if (TRACKING_IDENTIFIER_RE.test(text)) output.add(text);
    if (output.size >= 30) break;
  }
  return [...output];
}

function domainList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const output = new Set<string>();
  for (const candidate of value.slice(0, MAX_BULK_SESSION_ROWS * 2)) {
    const normalized = typeof candidate === 'string' ? normalizeDomain(candidate) : '';
    if (normalized) output.add(normalized);
    if (output.size >= MAX_BULK_SESSION_ROWS) break;
  }
  return [...output];
}

function normalizeSourceCoverage(value: unknown): BulkSessionSourceCoverage[] {
  if (!Array.isArray(value)) return [];
  const output: BulkSessionSourceCoverage[] = [];
  const seen = new Set<string>();
  for (const candidate of value.slice(0, MAX_BULK_SESSION_SOURCES * 4)) {
    const item = record(candidate);
    const source = boundedText(item?.source, 40);
    const state = boundedText(item?.state, 20);
    if (!SOURCE_RE.test(source) || !SOURCE_STATES.has(state) || seen.has(source)) continue;
    seen.add(source);
    output.push({ source, state: state as BulkSessionSourceState });
    if (output.length >= MAX_BULK_SESSION_SOURCES) break;
  }
  return output;
}

function normalizeRiskFactors(value: unknown): BulkSessionRiskFactor[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 40).flatMap((candidate) => {
    const item = record(candidate);
    const label = boundedText(item?.label, 160);
    const points = item?.points;
    return label && typeof points === 'number' && Number.isFinite(points) && Math.abs(points) <= 100
      ? [{ label, points: Math.round(points) }]
      : [];
  });
}

function nullableHash(value: unknown, expression: RegExp): string | null {
  return typeof value === 'string' && expression.test(value) ? value.toLowerCase() : null;
}

function normalizeRelationship(value: unknown): BulkSessionRelationship {
  const item = record(value);
  return {
    version: 2,
    nameservers: boundedStrings(item?.nameservers, 20),
    ipAddresses: boundedStrings(item?.ipAddresses, 50),
    trackingIdentifiers: boundedTrackingIdentifiers(item?.trackingIdentifiers),
    officialAssetHosts: boundedStrings(item?.officialAssetHosts, 30),
    faviconHash: nullableHash(item?.faviconHash, HASH_64_RE),
    faviconPHash: nullableHash(item?.faviconPHash, PHASH_RE),
    certificateFingerprint: nullableHash(item?.certificateFingerprint, HASH_64_RE),
    truncated: item?.truncated === true,
  };
}

function normalizeDns(value: unknown): BulkSessionDnsEvidence | null {
  const item = record(value);
  const records = record(item?.records);
  if (!item || !records) return null;
  const caa = Array.isArray(records.caa)
    ? records.caa.slice(0, 100).flatMap((candidate) => {
        const caaRecord = record(candidate);
        const tag = boundedText(caaRecord?.tag, 64);
        const recordValue = boundedText(caaRecord?.value, 500);
        const critical = normalizeCaaCritical(caaRecord?.critical);
        return tag && recordValue && critical !== null
          ? [{ critical, tag, value: recordValue }]
          : [];
      })
    : [];
  return {
    status: boundedText(item.status, 40) || null,
    records: {
      a: boundedStrings(records.a),
      aaaa: boundedStrings(records.aaaa),
      cname: boundedStrings(records.cname),
      caa,
    },
  };
}

export function normalizeBulkComparisonEvidence(value: unknown): BulkSessionComparisonEvidence | null {
  const item = record(value);
  const technology = record(item?.technology);
  const tls = record(item?.tls);
  if (!item || item.version !== 1 || !technology || !tls) return null;
  const technologyState = boundedText(technology.state, 40);
  const tlsState = boundedText(tls.state, 40);
  if (!COMPARISON_STATES.has(technologyState) || !COMPARISON_STATES.has(tlsState)) return null;
  const ids = Array.isArray(technology.ids)
    ? [...new Set(technology.ids
      .slice(0, 48)
      .map((candidate) => boundedText(candidate, 80).toLowerCase())
      .filter((candidate) => TECHNOLOGY_ID_RE.test(candidate)))]
      .sort()
      .slice(0, 12)
    : [];
  const technologyUsable = ['success', 'partial'].includes(technologyState);
  const tlsUsable = ['success', 'partial'].includes(tlsState);
  return {
    version: 1,
    technology: {
      state: technologyState as BulkSessionComparisonEvidence['technology']['state'],
      ids: technologyUsable ? ids : [],
      truncated: technologyUsable && technology.truncated === true,
    },
    tls: {
      state: tlsState as BulkSessionComparisonEvidence['tls']['state'],
      issuerLabel: tlsUsable ? boundedText(tls.issuerLabel, 240) || null : null,
      spkiSha256: tlsUsable ? nullableHash(tls.spkiSha256, HASH_64_RE) : null,
    },
  };
}

export function normalizeBulkSessionResult(
  value: unknown,
  sourceVersion = BULK_SESSION_SCHEMA_VERSION,
): BulkSessionResult | null {
  const item = record(value);
  const domain = normalizeDomain(item?.domain);
  const status = boundedText(item?.status, 20);
  const scanDepth = boundedText(item?.scanDepth, 10);
  if (!item || !domain || !RESULT_STATES.has(status) || !MODES.has(scanDepth)) return null;
  const rawProfileContext = record(item.profileContext);
  if (
    sourceVersion >= 4
    && (!rawProfileContext || !['ready', 'unavailable'].includes(String(rawProfileContext.sourceState)))
  ) return null;
  const profileContext = sourceVersion >= 4
    ? normalizeBulkProfileContext(rawProfileContext)
    : unavailableBulkProfileContext(BULK_PROFILE_CONTEXT_LEGACY_LIMITATION);
  if (sourceVersion >= 4 && rawProfileContext?.sourceState === 'ready' && profileContext.sourceState !== 'ready') return null;
  const profileContextReady = profileContext.sourceState === 'ready';
  const trusted = boundedText(item.trusted, 20);
  const relationship = normalizeRelationship(item.relationship);
  const readyWithoutActiveProfile = profileContextReady && profileContext.activeProfileId === null;
  const impossibleNoProfileClaim = readyWithoutActiveProfile && (
    TRUST_STATES.has(trusted)
    || item.faviconMatch === true
    || item.faviconNearMatch === true
    || item.reusesOfficialAssets === true
    || item.idnReferenceMatch === true
    || item.pageBaselineMatch === true
    || item.hasActiveBrandProfile === true
    || relationship.officialAssetHosts.length > 0
  );
  const profileClaimsUsable = profileContextReady && !impossibleNoProfileClaim;
  if (!profileClaimsUsable || readyWithoutActiveProfile) relationship.officialAssetHosts = [];
  return {
    domain,
    status: status as BulkSessionResult['status'],
    availability: boundedText(item.availability, 40) || 'unknown',
    confidence: boundedText(item.confidence, 40) || 'unknown',
    registrar: boundedText(item.registrar, 300) || '—',
    activity: boundedText(item.activity, 300) || '—',
    risk: profileClaimsUsable ? nullableScore(item.risk) : null,
    opportunity: nullableScore(item.opportunity),
    mutationTypes: boundedStrings(item.mutationTypes, 40),
    trusted: profileClaimsUsable && !readyWithoutActiveProfile && TRUST_STATES.has(trusted) ? trusted as BulkSessionResult['trusted'] : null,
    error: boundedText(item.error),
    scanDepth: scanDepth as BulkSessionMode,
    createdDate: boundedText(item.createdDate, 64) || null,
    expiryDate: boundedText(item.expiryDate, 64) || null,
    privacyProtected: nullableBoolean(item.privacyProtected),
    nameservers: boundedStrings(item.nameservers, 20),
    hasMx: nullableBoolean(item.hasMx),
    hasNullMx: nullableBoolean(item.hasNullMx),
    hasSpf: nullableBoolean(item.hasSpf),
    hasDmarc: nullableBoolean(item.hasDmarc),
    activityStatus: boundedText(item.activityStatus, 40) || null,
    pageTitle: boundedText(item.pageTitle, 300) || null,
    faviconHash: nullableHash(item.faviconHash, HASH_64_RE),
    faviconPHash: nullableHash(item.faviconPHash, PHASH_RE),
    faviconMatch: profileClaimsUsable ? nullableBoolean(item.faviconMatch) : null,
    faviconNearMatch: profileClaimsUsable ? nullableBoolean(item.faviconNearMatch) : null,
    reusesOfficialAssets: profileClaimsUsable ? nullableBoolean(item.reusesOfficialAssets) : null,
    hasPasswordField: item.hasPasswordField === true,
    hasExternalFormAction: nullableBoolean(item.hasExternalFormAction),
    phishingLanguageMatch: boundedText(item.phishingLanguageMatch, 300) || null,
    idnReferenceMatch: profileClaimsUsable ? nullableBoolean(item.idnReferenceMatch) : null,
    pageBaselineMatch: profileClaimsUsable ? nullableBoolean(item.pageBaselineMatch) : null,
    hasActiveBrandProfile: profileClaimsUsable ? nullableBoolean(item.hasActiveBrandProfile) : null,
    riskModelVersion: profileClaimsUsable ? nullableVersion(item.riskModelVersion) : null,
    opportunityModelVersion: nullableVersion(item.opportunityModelVersion),
    riskFactors: profileClaimsUsable ? normalizeRiskFactors(item.riskFactors) : [],
    dns: normalizeDns(item.dns),
    dnssec: boundedText(item.dnssec, 40) || null,
    comparisonEvidence: normalizeBulkComparisonEvidence(item.comparisonEvidence),
    relationship,
    sourceCoverage: normalizeSourceCoverage(item.sourceCoverage),
    profileContext,
  };
}

export function normalizeBulkSession(
  value: unknown,
  sourceVersion = BULK_SESSION_SCHEMA_VERSION,
): BulkSession | null {
  const item = record(value);
  const id = boundedText(item?.id, 128);
  const name = boundedText(item?.name, MAX_BULK_SESSION_NAME_LENGTH);
  const mode = boundedText(item?.mode, 10);
  const state = boundedText(item?.state, 20);
  const inputDigest = boundedText(item?.inputDigest, 80);
  const legacyTimestamps = sourceVersion < BULK_SESSION_SCHEMA_VERSION;
  const startedAt = timestamp(item?.startedAt, null, legacyTimestamps);
  const updatedAt = timestamp(item?.updatedAt, null, legacyTimestamps);
  const completedAt = item?.completedAt === null ? null : timestamp(item?.completedAt, null, legacyTimestamps);
  if (
    !item
    || !SAFE_ID_RE.test(id)
    || !name
    || !MODES.has(mode)
    || !SESSION_STATES.has(state)
    || !DIGEST_RE.test(inputDigest)
    || !startedAt
    || !updatedAt
  ) return null;
  const domains = domainList(item.domains);
  if (!domains.length) return null;
  if (sourceVersion >= 4 && !Array.isArray(item.results)) return null;
  const allowed = new Set(domains);
  const results: BulkSessionResult[] = [];
  const seen = new Set<string>();
  for (const candidate of Array.isArray(item.results) ? item.results.slice(0, MAX_BULK_SESSION_ROWS * 2) : []) {
    const result = normalizeBulkSessionResult(candidate, sourceVersion);
    if (!result || !allowed.has(result.domain) || seen.has(result.domain)) {
      if (sourceVersion >= 4) return null;
      continue;
    }
    seen.add(result.domain);
    results.push(result);
    if (sourceVersion < 4 && results.length >= MAX_BULK_SESSION_ROWS) break;
  }
  if (sourceVersion >= 4 && ((state === 'complete') !== (results.length === domains.length))) return null;
  const profileContext = summarizeBulkProfileContexts(results);
  if (sourceVersion >= 4) {
    if (!record(item.profileContext)) return null;
    const declaredProfileContext = normalizeBulkProfileContext(item.profileContext);
    if (!sameProfileContext(declaredProfileContext, profileContext)) return null;
  }
  return {
    id,
    name,
    mode: mode as BulkSessionMode,
    state: state as BulkSessionState,
    inputDigest,
    domains,
    results,
    startedAt,
    updatedAt,
    completedAt,
    profileContext,
  };
}

export function bulkSessionStoreVersion(raw: unknown): number | null {
  const value = record(raw);
  return typeof value?.version === 'number' && Number.isSafeInteger(value.version) && value.version > 0
    ? value.version
    : null;
}

export function normalizeBulkSessionStore(raw: unknown): BulkSessionStore {
  assertWorkspaceInputGraph(raw, 'Bulk-session store');
  assertWorkspaceDeclaredVersion(raw, 'Bulk-session store');
  const value = record(raw);
  const sourceVersion = value?.schema === BULK_SESSION_SCHEMA
      && SUPPORTED_BULK_SESSION_SCHEMA_VERSIONS.includes(Number(value.version))
      ? Number(value.version)
      : null;
  const candidates = Array.isArray(raw)
    ? raw
    : value?.schema === BULK_SESSION_SCHEMA
      && SUPPORTED_BULK_SESSION_SCHEMA_VERSIONS.includes(Number(value.version))
      && Array.isArray(value.sessions)
      ? value.sessions
      : [];
  const byId = new Map<string, BulkSession>();
  for (const candidate of candidates.slice(0, MAX_BULK_SESSIONS * 4)) {
    const candidateRecord = record(candidate);
    const resultRecords = Array.isArray(candidateRecord?.results)
      ? candidateRecord.results.map(record).filter((item): item is UnknownRecord => Boolean(item))
      : [];
    const whollyUnversionedLegacy = Array.isArray(raw)
      && !Object.hasOwn(candidateRecord ?? {}, 'profileContext')
      && resultRecords.every((item) => !Object.hasOwn(item, 'profileContext'));
    const candidateVersion = Array.isArray(raw)
      ? whollyUnversionedLegacy ? 3 : BULK_SESSION_SCHEMA_VERSION
      : sourceVersion ?? BULK_SESSION_SCHEMA_VERSION;
    const session = normalizeBulkSession(candidate, candidateVersion);
    if (!session) continue;
    const existing = byId.get(session.id);
    if (!existing || existing.updatedAt < session.updatedAt) byId.set(session.id, session);
  }
  return {
    schema: BULK_SESSION_SCHEMA,
    version: BULK_SESSION_SCHEMA_VERSION,
    sessions: [...byId.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
      .slice(0, MAX_BULK_SESSIONS),
  };
}

export function serializeBulkSessionStore(raw: unknown): string {
  return JSON.stringify(normalizeBulkSessionStore(raw));
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function enforceBulkSessionStoreBudget(raw: unknown): { store: BulkSessionStore; pruned: number } {
  const store = normalizeBulkSessionStore(raw);
  let pruned = 0;
  while (byteLength(JSON.stringify(store)) > MAX_BULK_SESSION_STORE_BYTES && store.sessions.length > 1) {
    store.sessions.pop();
    pruned += 1;
  }
  if (byteLength(JSON.stringify(store)) > MAX_BULK_SESSION_STORE_BYTES) {
    throw new Error('This Bulk session exceeds the 4 MiB browser-local session limit.');
  }
  return { store, pruned };
}

export function upsertBulkSession(
  raw: unknown,
  sessionRaw: unknown,
): { sessions: BulkSession[]; session: BulkSession; added: boolean; pruned: number } {
  const session = normalizeBulkSession(sessionRaw);
  if (!session) throw new Error('The Bulk session is incomplete or invalid.');
  const current = normalizeBulkSessionStore(raw).sessions;
  const index = current.findIndex((candidate) => candidate.id === session.id);
  const next = index >= 0
    ? current.map((candidate, candidateIndex) => candidateIndex === index ? session : candidate)
    : [session, ...current];
  const bounded = enforceBulkSessionStoreBudget({
    schema: BULK_SESSION_SCHEMA,
    version: BULK_SESSION_SCHEMA_VERSION,
    sessions: next,
  });
  return {
    sessions: bounded.store.sessions,
    session,
    added: index < 0,
    pruned: bounded.pruned,
  };
}

export function deleteBulkSession(raw: unknown, idRaw: unknown): BulkSession[] {
  const id = boundedText(idRaw, 128);
  return normalizeBulkSessionStore({
    schema: BULK_SESSION_SCHEMA,
    version: BULK_SESSION_SCHEMA_VERSION,
    sessions: normalizeBulkSessionStore(raw).sessions.filter((session) => session.id !== id),
  }).sessions;
}

function sourceStateMap(value: BulkSessionResult): Map<string, string> {
  return new Map(value.sourceCoverage.map((item) => [item.source, item.state]));
}

function comparableRisk(previous: BulkSessionResult, current: BulkSessionResult): boolean {
  return previous.profileContext.sourceState === 'ready'
    && current.profileContext.sourceState === 'ready'
    && sameProfileContext(previous.profileContext, current.profileContext)
    && previous.risk !== null
    && current.risk !== null
    && previous.riskModelVersion !== null
    && previous.riskModelVersion === current.riskModelVersion;
}

function resultChanges(previous: BulkSessionResult, current: BulkSessionResult): string[] {
  const changes: string[] = [];
  if (previous.availability !== current.availability) changes.push(`Registration: ${previous.availability} → ${current.availability}`);
  if (comparableRisk(previous, current) && previous.risk !== current.risk) {
    changes.push(`Risk: ${previous.risk ?? 'unavailable'} → ${current.risk ?? 'unavailable'}`);
  }
  if (previous.registrar !== current.registrar) changes.push(`Registrar: ${previous.registrar} → ${current.registrar}`);
  if (previous.activity !== current.activity) changes.push(`Website: ${previous.activity} → ${current.activity}`);
  const previousComparison = previous.comparisonEvidence;
  const currentComparison = current.comparisonEvidence;
  if (JSON.stringify(previousComparison?.technology.ids ?? null)
    !== JSON.stringify(currentComparison?.technology.ids ?? null)) {
    changes.push(`Technology IDs: ${previousComparison?.technology.ids.join(', ') || 'not recorded'} → ${currentComparison?.technology.ids.join(', ') || 'not recorded'}`);
  }
  if ((previousComparison?.tls.issuerLabel ?? null) !== (currentComparison?.tls.issuerLabel ?? null)) {
    changes.push(`TLS issuer: ${previousComparison?.tls.issuerLabel || 'not recorded'} → ${currentComparison?.tls.issuerLabel || 'not recorded'}`);
  }
  if ((previousComparison?.tls.spkiSha256 ?? null) !== (currentComparison?.tls.spkiSha256 ?? null)) {
    changes.push(`TLS public key: ${previousComparison?.tls.spkiSha256 || 'not recorded'} → ${currentComparison?.tls.spkiSha256 || 'not recorded'}`);
  }
  const previousSources = sourceStateMap(previous);
  const currentSources = sourceStateMap(current);
  for (const source of [...new Set([...previousSources.keys(), ...currentSources.keys()])].sort()) {
    const before = previousSources.get(source) ?? 'not recorded';
    const after = currentSources.get(source) ?? 'not recorded';
    if (before !== after) changes.push(`${source} source: ${before} → ${after}`);
  }
  return changes.slice(0, 20);
}

export function compareBulkSessions(
  baselineRaw: unknown,
  currentRaw: unknown,
): BulkSessionComparison | null {
  const baseline = normalizeBulkSession(baselineRaw);
  const current = normalizeBulkSession(currentRaw);
  if (!baseline || !current || baseline.id === current.id) return null;
  const before = new Map(baseline.results.map((result) => [result.domain, result]));
  const after = new Map(current.results.map((result) => [result.domain, result]));
  const rows: BulkSessionComparisonRow[] = [];
  let riskIncomparable = false;
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (const domain of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const previous = before.get(domain);
    const next = after.get(domain);
    if (!previous) {
      added += 1;
      rows.push({ domain, changes: ['Added to the later settled result set.'] });
    } else if (!next) {
      removed += 1;
      rows.push({ domain, changes: ['Absent from the later settled result set.'] });
    } else {
      if (!comparableRisk(previous, next)) riskIncomparable = true;
      const changes = resultChanges(previous, next);
      if (changes.length) rows.push({ domain, changes });
      else unchanged += 1;
    }
  }
  return {
    baselineId: baseline.id,
    currentId: current.id,
    added,
    removed,
    changed: rows.length - added - removed,
    unchanged,
    rows: rows.slice(0, MAX_BULK_SESSION_ROWS),
    limitations: [
      'This compares compact saved observations, not historical provider data or raw source payloads.',
      'A source-state change may reflect collection availability rather than a change to the domain.',
      'A missing row means it was not completed in that saved session; it does not establish domain removal.',
      ...(riskIncomparable
        ? ['Risk deltas are omitted unless both rows retain the same ready Brand Profile provenance and the same versioned Risk model.']
        : []),
    ],
  };
}

export function buildBulkSessionExport(sessions: unknown, generatedAt: unknown = new Date().toISOString()) {
  const store = enforceBulkSessionStoreBudget(sessions).store;
  return {
    schema: BULK_SESSION_SCHEMA,
    version: BULK_SESSION_SCHEMA_VERSION,
    generatedAt: timestamp(generatedAt, new Date().toISOString()),
    sessions: store.sessions,
    limitations: [
      'Compact Bulk results and source states only; raw source payloads and contact records are excluded.',
      'Import is non-destructive and does not resume network collection automatically.',
    ],
  };
}

export function mergeBulkSessions(
  localRaw: unknown,
  importedRaw: unknown,
): { sessions: BulkSession[]; added: number; updated: number; skipped: number; pruned: number } {
  assertWorkspaceInputGraph(localRaw, 'Local Bulk-session store');
  assertWorkspaceInputGraph(importedRaw, 'Imported Bulk-session document');
  assertWorkspacePortableVersion(importedRaw, BULK_SESSION_SCHEMA_VERSION, 'Imported Bulk-session document');
  const imported = record(importedRaw);
  if (!imported || imported.schema !== BULK_SESSION_SCHEMA || !Array.isArray(imported.sessions)) {
    throw new Error('This file is not a WHOISleuth Bulk session export.');
  }
  if (!SUPPORTED_BULK_SESSION_SCHEMA_VERSIONS.includes(Number(imported.version))) {
    if (typeof imported.version === 'number' && imported.version > BULK_SESSION_SCHEMA_VERSION) {
      throw new Error(`This Bulk session export uses newer schema ${imported.version}. Update the app before importing it.`);
    }
    throw new Error(`Expected Bulk session schema ${BULK_SESSION_SCHEMA_VERSION}.`);
  }
  let sessions = normalizeBulkSessionStore(localRaw).sessions;
  let added = 0;
  let updated = 0;
  let skipped = 0;
  const importedVersion = Number(imported.version);
  for (const candidate of imported.sessions.slice(0, MAX_BULK_SESSIONS * 4)) {
    const normalized = normalizeBulkSession(candidate, importedVersion);
    if (!normalized) {
      skipped += 1;
      continue;
    }
    const importedProfileContext = unavailableBulkProfileContext(BULK_PROFILE_CONTEXT_IMPORTED_LIMITATION);
    const quarantinedResults = normalized.results.map((result) => ({
      ...result,
      risk: null,
      trusted: null,
      faviconMatch: null,
      faviconNearMatch: null,
      reusesOfficialAssets: null,
      idnReferenceMatch: null,
      pageBaselineMatch: null,
      hasActiveBrandProfile: null,
      riskModelVersion: null,
      riskFactors: [],
      relationship: { ...result.relationship, officialAssetHosts: [] },
      profileContext: importedProfileContext,
    }));
    const session = normalizeBulkSession({
      ...normalized,
      results: quarantinedResults,
      profileContext: summarizeBulkProfileContexts(quarantinedResults),
    });
    if (!session) {
      skipped += 1;
      continue;
    }
    const existing = sessions.find((item) => item.id === session.id);
    if (existing) {
      skipped += 1;
      continue;
    }
    added += 1;
    sessions = upsertBulkSession(sessions, session).sessions;
  }
  const bounded = enforceBulkSessionStoreBudget({
    schema: BULK_SESSION_SCHEMA,
    version: BULK_SESSION_SCHEMA_VERSION,
    sessions,
  });
  return { sessions: bounded.store.sessions, added, updated, skipped, pruned: bounded.pruned };
}
