import { normalizeDomain } from './case-model.ts';
import { PAGE_FINGERPRINT_VERSION, PAGE_IDENTITY_VERSION } from './page-baseline.ts';

type JsonRecord = Record<string, unknown>;
type CaptureAvailabilityState = 'available' | 'expiring' | 'for_sale' | 'registered' | 'unknown';
type CaptureConfidence = 'high' | 'low' | 'medium';
type AvailabilityCaptureResponse = JsonRecord & {
  applicable: true;
  domain: string;
  state: CaptureAvailabilityState;
  confidence: CaptureConfidence;
  inputHostname?: string;
  registrableDomain?: string;
  pageIdentity?: JsonRecord | null;
  faviconHash?: string | null;
  faviconPHash?: string | null;
};
type PostureStatus = 'danger' | 'info' | 'pass' | 'warning';
type DomainPostureCheck = {
  id: string;
  label: string;
  status: PostureStatus;
  summary: string;
  detail: string;
  records: string[];
  remediation: string;
};
type SpfExpansionBranch = {
  domain: string;
  parent: string | null;
  relation: 'include' | 'redirect' | 'root';
  depth: number;
  state: 'cycle' | 'invalid' | 'limit' | 'not_found' | 'success' | 'unavailable';
  terminalPolicy: string | null;
  dnsLookupTerms: number;
  issues: string[];
};
type SpfExpansion = {
  version: 1;
  state: 'complete' | 'invalid' | 'partial' | 'unavailable';
  lookupLimit: number;
  lookupsUsed: number;
  voidLookupLimit: number;
  voidLookups: number;
  maxDepth: number;
  dnsLookupTerms: number;
  branches: SpfExpansionBranch[];
  issues: string[];
};
type DmarcExternalAuthorization = {
  destination: string;
  reportType: 'aggregate' | 'failure';
  recordName: string | null;
  state: 'authorized' | 'invalid_destination' | 'not_found' | 'self' | 'unavailable';
  error: string | null;
};
type DomainPostureExternalDependency = {
  kind: 'dmarc_reporting' | 'mail_exchange' | 'nameserver' | 'spf_include' | 'spf_redirect';
  target: string;
  source: string;
  scope: 'external' | 'same_registrable_domain' | 'unknown';
  state: 'observed' | 'unavailable';
  limitation: string;
};
type DomainPostureHttpResponse = JsonRecord & {
  domain: string;
  checkedAt: string;
  dkimSelectors: string[];
  retiredDkimSelectors: string[];
  mailProtectionProfile: 'defensive_no_mail' | 'parked' | 'standard';
  summary: Record<PostureStatus, number>;
  checks: DomainPostureCheck[];
  spfExpansion: SpfExpansion;
  dmarcAuthorizations: DmarcExternalAuthorization[];
  externalDependencies: DomainPostureExternalDependency[];
};
type ClientResponseParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

const INVALID_AVAILABILITY_CAPTURE_RESPONSE = 'Official-site capture returned an invalid response.';
const INVALID_DOMAIN_POSTURE_RESPONSE = 'Official-domain audit returned an invalid response.';
const MAX_CLIENT_ERROR_LENGTH = 240;
const MAX_AVAILABILITY_KEYS = 128;
const MAX_PAGE_IDENTITY_KEYS = 32;
const MAX_PAGE_FINGERPRINT_KEYS = 16;
const MAX_POSTURE_TOP_LEVEL_KEYS = 10;
const MAX_POSTURE_CHECKS = 32;
const MAX_POSTURE_CHECK_KEYS = 8;
const MAX_POSTURE_RECORDS = 64;
const MAX_POSTURE_RECORD_LENGTH = 4096;
const MAX_POSTURE_DETAIL_LENGTH = 2000;
const MAX_POSTURE_ANALYSIS_TEXT_LENGTH = 512;
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const SHA256_RE = /^[a-f0-9]{64}$/iu;
const PHASH_RE = /^[a-f0-9]{16}$/iu;
const CAPTURE_STATES = new Set<CaptureAvailabilityState>([
  'available',
  'expiring',
  'for_sale',
  'registered',
  'unknown',
]);
const CAPTURE_CONFIDENCE = new Set<CaptureConfidence>(['high', 'low', 'medium']);
const POSTURE_STATUSES = new Set<PostureStatus>(['danger', 'info', 'pass', 'warning']);
const SPF_EXPANSION_STATES = new Set(['complete', 'invalid', 'partial', 'unavailable']);
const SPF_BRANCH_STATES = new Set(['cycle', 'invalid', 'limit', 'not_found', 'success', 'unavailable']);
const SPF_BRANCH_RELATIONS = new Set(['include', 'redirect', 'root']);
const DMARC_AUTHORIZATION_STATES = new Set(['authorized', 'invalid_destination', 'not_found', 'self', 'unavailable']);
const POSTURE_DEPENDENCY_KINDS = new Set(['dmarc_reporting', 'mail_exchange', 'nameserver', 'spf_include', 'spf_redirect']);

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function boundedText(value: unknown, maximum: number, allowEmpty = false): value is string {
  return typeof value === 'string'
    && value.length <= maximum
    && !CONTROL_RE.test(value)
    && (allowEmpty || Boolean(value.trim()));
}

function optionalDomain(value: unknown): boolean {
  return value === undefined || (
    boundedText(value, 253)
    && normalizeDomain(value) === value.trim().toLowerCase().replace(/\.$/u, '')
  );
}

function captureDomainMatches(value: JsonRecord, expectedDomain: string): boolean {
  const expected = normalizeDomain(expectedDomain);
  const domain = normalizeDomain(value.domain);
  const inputHostname = normalizeDomain(value.inputHostname);
  return Boolean(expected && domain && (expected === domain || expected === inputHostname));
}

function optionalHash(value: unknown, expression: RegExp): boolean {
  return value === undefined || value === null || value === '' || (
    typeof value === 'string' && expression.test(value)
  );
}

function validPageIdentity(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (
    !isRecord(value)
    || Object.keys(value).length > MAX_PAGE_IDENTITY_KEYS
    || value.identityVersion !== PAGE_IDENTITY_VERSION
    || value.source !== 'html'
    || !['partial', 'success'].includes(String(value.status))
    || !boundedText(value.observedAt, 64)
    || !Number.isFinite(Date.parse(value.observedAt))
    || !isRecord(value.fingerprints)
    || Object.keys(value.fingerprints).length > MAX_PAGE_FINGERPRINT_KEYS
    || value.fingerprints.fingerprintVersion !== PAGE_FINGERPRINT_VERSION
  ) {
    return false;
  }
  return true;
}

function parseAvailabilityCaptureResponse(
  value: unknown,
  expectedDomain: string,
): ClientResponseParseResult<AvailabilityCaptureResponse> {
  if (
    !isRecord(value)
    || Object.keys(value).length > MAX_AVAILABILITY_KEYS
    || value.applicable !== true
    || !boundedText(value.domain, 253)
    || !captureDomainMatches(value, expectedDomain)
    || typeof value.state !== 'string'
    || !CAPTURE_STATES.has(value.state as CaptureAvailabilityState)
    || typeof value.confidence !== 'string'
    || !CAPTURE_CONFIDENCE.has(value.confidence as CaptureConfidence)
    || !optionalDomain(value.inputHostname)
    || !optionalDomain(value.registrableDomain)
    || !validPageIdentity(value.pageIdentity)
    || !optionalHash(value.faviconHash, SHA256_RE)
    || !optionalHash(value.faviconPHash, PHASH_RE)
  ) {
    return { ok: false, error: INVALID_AVAILABILITY_CAPTURE_RESPONSE };
  }
  return { ok: true, value: value as AvailabilityCaptureResponse };
}

function validPostureCheck(value: unknown): value is DomainPostureCheck {
  if (!isRecord(value) || Object.keys(value).length > MAX_POSTURE_CHECK_KEYS) return false;
  return boundedText(value.id, 64)
    && boundedText(value.label, 120)
    && typeof value.status === 'string'
    && POSTURE_STATUSES.has(value.status as PostureStatus)
    && boundedText(value.summary, 400)
    && boundedText(value.detail, MAX_POSTURE_DETAIL_LENGTH, true)
    && boundedText(value.remediation, MAX_POSTURE_DETAIL_LENGTH, true)
    && Array.isArray(value.records)
    && value.records.length <= MAX_POSTURE_RECORDS
    && value.records.every((record) => boundedText(record, MAX_POSTURE_RECORD_LENGTH, true));
}

function boundedInteger(value: unknown, maximum: number): boolean {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= maximum;
}

function validSpfExpansion(value: unknown): value is SpfExpansion {
  if (
    !isRecord(value)
    || Object.keys(value).length !== 10
    || value.version !== 1
    || typeof value.state !== 'string'
    || !SPF_EXPANSION_STATES.has(value.state)
    || !boundedInteger(value.lookupLimit, 20)
    || !boundedInteger(value.lookupsUsed, 20)
    || !boundedInteger(value.voidLookupLimit, 10)
    || !boundedInteger(value.voidLookups, 20)
    || !boundedInteger(value.maxDepth, 10)
    || !boundedInteger(value.dnsLookupTerms, 100)
    || !Array.isArray(value.branches)
    || value.branches.length > 32
    || !Array.isArray(value.issues)
    || value.issues.length > 12
    || !value.issues.every((issue) => boundedText(issue, MAX_POSTURE_ANALYSIS_TEXT_LENGTH, true))
  ) {
    return false;
  }
  return value.branches.every((branch) => (
    isRecord(branch)
    && Object.keys(branch).length === 8
    && boundedText(branch.domain, 253, true)
    && (branch.parent === null || boundedText(branch.parent, 253))
    && typeof branch.relation === 'string'
    && SPF_BRANCH_RELATIONS.has(branch.relation)
    && boundedInteger(branch.depth, 10)
    && typeof branch.state === 'string'
    && SPF_BRANCH_STATES.has(branch.state)
    && (branch.terminalPolicy === null || boundedText(branch.terminalPolicy, 32))
    && boundedInteger(branch.dnsLookupTerms, 100)
    && Array.isArray(branch.issues)
    && branch.issues.length <= 12
    && branch.issues.every((issue) => boundedText(issue, MAX_POSTURE_ANALYSIS_TEXT_LENGTH, true))
  ));
}

function validDmarcAuthorizations(value: unknown): value is DmarcExternalAuthorization[] {
  return Array.isArray(value)
    && value.length <= 10
    && value.every((authorization) => (
      isRecord(authorization)
      && Object.keys(authorization).length === 5
      && boundedText(authorization.destination, MAX_POSTURE_ANALYSIS_TEXT_LENGTH)
      && ['aggregate', 'failure'].includes(String(authorization.reportType))
      && (authorization.recordName === null || boundedText(authorization.recordName, 512))
      && typeof authorization.state === 'string'
      && DMARC_AUTHORIZATION_STATES.has(authorization.state)
      && (authorization.error === null || boundedText(authorization.error, MAX_POSTURE_ANALYSIS_TEXT_LENGTH))
    ));
}

function validExternalDependencies(value: unknown): value is DomainPostureExternalDependency[] {
  return Array.isArray(value)
    && value.length <= 64
    && value.every((dependency) => (
      isRecord(dependency)
      && Object.keys(dependency).length === 6
      && typeof dependency.kind === 'string'
      && POSTURE_DEPENDENCY_KINDS.has(dependency.kind)
      && boundedText(dependency.target, 253)
      && boundedText(dependency.source, 120)
      && ['external', 'same_registrable_domain', 'unknown'].includes(String(dependency.scope))
      && ['observed', 'unavailable'].includes(String(dependency.state))
      && boundedText(dependency.limitation, MAX_POSTURE_DETAIL_LENGTH)
    ));
}

function parseDomainPostureHttpResponse(
  value: unknown,
  expectedDomain: string,
): ClientResponseParseResult<DomainPostureHttpResponse> {
  if (
    !isRecord(value)
    || Object.keys(value).length > MAX_POSTURE_TOP_LEVEL_KEYS
    || !boundedText(value.domain, 253)
    || normalizeDomain(value.domain) !== normalizeDomain(expectedDomain)
    || !boundedText(value.checkedAt, 64)
    || !Number.isFinite(Date.parse(value.checkedAt))
    || !Array.isArray(value.dkimSelectors)
    || value.dkimSelectors.length > 10
    || !value.dkimSelectors.every((selector) => boundedText(selector, 253))
    || !Array.isArray(value.retiredDkimSelectors)
    || value.retiredDkimSelectors.length > 10
    || !value.retiredDkimSelectors.every((selector) => boundedText(selector, 253))
    || value.dkimSelectors.length + value.retiredDkimSelectors.length > 10
    || !['defensive_no_mail', 'parked', 'standard'].includes(String(value.mailProtectionProfile))
    || !isRecord(value.summary)
    || !Array.isArray(value.checks)
    || value.checks.length === 0
    || value.checks.length > MAX_POSTURE_CHECKS
    || !value.checks.every(validPostureCheck)
    || !validSpfExpansion(value.spfExpansion)
    || !validDmarcAuthorizations(value.dmarcAuthorizations)
    || !validExternalDependencies(value.externalDependencies)
  ) {
    return { ok: false, error: INVALID_DOMAIN_POSTURE_RESPONSE };
  }

  const checks = value.checks as DomainPostureCheck[];
  const summary = value.summary as JsonRecord;
  const ids = new Set(checks.map((check) => check.id));
  const actual = { danger: 0, info: 0, pass: 0, warning: 0 };
  for (const check of checks) actual[check.status] += 1;
  if (
    ids.size !== checks.length
    || Object.keys(summary).length !== POSTURE_STATUSES.size
    || [...POSTURE_STATUSES].some((status) => (
      !Number.isInteger(summary[status])
      || summary[status] !== actual[status]
    ))
  ) {
    return { ok: false, error: INVALID_DOMAIN_POSTURE_RESPONSE };
  }

  return { ok: true, value: value as DomainPostureHttpResponse };
}

function clientHttpErrorMessage(value: unknown, status: number, fallback: string): string {
  const message = isRecord(value) && typeof value.error === 'string'
    ? value.error
        .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, MAX_CLIENT_ERROR_LENGTH)
    : '';
  return message || `${fallback} (${status})`;
}

export {
  INVALID_AVAILABILITY_CAPTURE_RESPONSE,
  INVALID_DOMAIN_POSTURE_RESPONSE,
  MAX_AVAILABILITY_KEYS,
  MAX_POSTURE_CHECKS,
  clientHttpErrorMessage,
  parseAvailabilityCaptureResponse,
  parseDomainPostureHttpResponse,
};
export type {
  AvailabilityCaptureResponse,
  CaptureAvailabilityState,
  ClientResponseParseResult,
  DomainPostureCheck,
  DomainPostureExternalDependency,
  DomainPostureHttpResponse,
  DmarcExternalAuthorization,
  PostureStatus,
  SpfExpansion,
  SpfExpansionBranch,
};
