import { normalizeDomain } from './case-model.js';
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
type DomainPostureHttpResponse = JsonRecord & {
  domain: string;
  checkedAt: string;
  dkimSelectors: string[];
  summary: Record<PostureStatus, number>;
  checks: DomainPostureCheck[];
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
const MAX_POSTURE_TOP_LEVEL_KEYS = 8;
const MAX_POSTURE_CHECKS = 32;
const MAX_POSTURE_CHECK_KEYS = 8;
const MAX_POSTURE_RECORDS = 64;
const MAX_POSTURE_RECORD_LENGTH = 4096;
const MAX_POSTURE_DETAIL_LENGTH = 2000;
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
    || !isRecord(value.summary)
    || !Array.isArray(value.checks)
    || value.checks.length === 0
    || value.checks.length > MAX_POSTURE_CHECKS
    || !value.checks.every(validPostureCheck)
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
  ClientResponseParseResult,
  DomainPostureCheck,
  DomainPostureHttpResponse,
  PostureStatus,
};
