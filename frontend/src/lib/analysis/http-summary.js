// Pure, browser-storage-safe HTTP summary normalization. Rich Lookup HTTP
// observations retain bounded URLs, selected header values, redirect hops, and
// connection attempts. Bulk/watchlist/case records deliberately keep only this
// smaller derived shape: no paths, queries, header values, attempt errors, or
// redirect inventories.

export const HTTP_SUMMARY_VERSION = 1;
export const MAX_HTTP_SUMMARY_ORIGIN_LENGTH = 300;
export const MAX_HTTP_SUMMARY_CONTENT_TYPE_LENGTH = 100;
export const MAX_HTTP_SUMMARY_REDIRECTS = 5;
export const MAX_HTTP_SECURITY_HEADER_INPUTS = 20;

export const HTTP_SECURITY_HEADER_TOKENS = Object.freeze([
  'content-security-policy',
  'content-type-protection',
  'frame-protection',
  'hsts',
  'referrer-policy',
]);

const EVIDENCE_STATUSES = new Set(['success', 'partial']);
const SECURITY_HEADER_TOKEN_SET = new Set(HTTP_SECURITY_HEADER_TOKENS);
const MIME_TOKEN_RE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;

/**
 * @typedef {{ httpSummaryVersion: number, httpEvidenceStatus: string, httpFinalOrigin: string | null, httpResponseStatus: number, httpTransportSecurity: string | null, httpRedirectCount: number | null, httpCrossOriginRedirect: boolean | null, httpHttpsDowngrade: boolean | null, httpContentType: string | null, httpSecurityHeaders: string[] | null }} CompactHttpSummary
 */

function plainRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function status(value) {
  return typeof value === 'string' && EVIDENCE_STATUSES.has(value) ? value : null;
}

function httpStatus(value) {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

function redirectCount(value) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_HTTP_SUMMARY_REDIRECTS ? value : null;
}

function boolOrNull(value) {
  return typeof value === 'boolean' ? value : null;
}

function transport(value) {
  return value === 'https' || value === 'http' ? value : null;
}

function finalOrigin(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname) return null;
    return parsed.origin.length <= MAX_HTTP_SUMMARY_ORIGIN_LENGTH ? parsed.origin : null;
  } catch {
    return null;
  }
}

function contentType(value) {
  if (typeof value !== 'string' || value.length > 300 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const mime = value.split(';', 1)[0].trim().toLowerCase();
  return mime.length <= MAX_HTTP_SUMMARY_CONTENT_TYPE_LENGTH && MIME_TOKEN_RE.test(mime) ? mime : null;
}

function securityHeaderTokens(value) {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.slice(0, MAX_HTTP_SECURITY_HEADER_INPUTS)
    .filter((token) => typeof token === 'string' && SECURITY_HEADER_TOKEN_SET.has(token)))]
    .sort();
}

function presentHeaderValue(value) {
  return typeof value === 'string'
    && value.length <= 300
    && !/[\u0000-\u001f\u007f]/.test(value)
    && value.trim().length > 0;
}

function tokensFromRichHeaders(value) {
  const headers = plainRecord(value);
  if (!headers) return null;
  const tokens = [];
  if (presentHeaderValue(headers.strictTransportSecurity)) tokens.push('hsts');
  if (presentHeaderValue(headers.contentSecurityPolicy)) tokens.push('content-security-policy');
  if (presentHeaderValue(headers.xFrameOptions)) tokens.push('frame-protection');
  if (presentHeaderValue(headers.xContentTypeOptions)) tokens.push('content-type-protection');
  if (presentHeaderValue(headers.referrerPolicy)) tokens.push('referrer-policy');
  return tokens.sort();
}

/**
 * Derives the compact browser-local form from a rich HTTP observation.
 * Failed/skipped observations and observations without a terminal response do
 * not produce a summary: they cannot prove the domain's HTTP state.
 * @param {unknown} value
 * @returns {CompactHttpSummary | null}
 */
export function compactHttpObservation(value) {
  const observation = plainRecord(value);
  const response = plainRecord(observation?.response);
  const evidenceStatus = status(observation?.status);
  const responseStatus = httpStatus(response?.status);
  if (!observation || !response || !evidenceStatus || responseStatus === null) return null;

  const origin = finalOrigin(observation.finalUrl) || finalOrigin(observation.requestUrl);
  // The retained origin is the canonical transport source. This prevents a
  // malformed rich observation from storing internally contradictory facts.
  const observedTransport = origin
    ? transport(new URL(origin).protocol.slice(0, -1))
    : transport(observation.transportSecurity);

  return {
    httpSummaryVersion: HTTP_SUMMARY_VERSION,
    httpEvidenceStatus: evidenceStatus,
    httpFinalOrigin: origin,
    httpResponseStatus: responseStatus,
    httpTransportSecurity: observedTransport,
    httpRedirectCount: redirectCount(observation.redirectCount),
    httpCrossOriginRedirect: boolOrNull(observation.crossOriginRedirect),
    httpHttpsDowngrade: boolOrNull(observation.httpsDowngrade),
    httpContentType: contentType(response.contentType),
    httpSecurityHeaders: tokensFromRichHeaders(response.securityHeaders),
  };
}

/**
 * Revalidates an already-compact summary (or a record containing its fields)
 * at every local-storage/import boundary. Unknown keys are discarded.
 * @param {unknown} value
 * @returns {CompactHttpSummary | null}
 */
export function normalizeHttpSummary(value) {
  const record = plainRecord(value);
  if (record?.httpSummaryVersion !== HTTP_SUMMARY_VERSION) return null;
  const evidenceStatus = status(record?.httpEvidenceStatus);
  const responseStatus = httpStatus(record?.httpResponseStatus);
  if (!record || !evidenceStatus || responseStatus === null) return null;
  const origin = finalOrigin(record.httpFinalOrigin);
  return {
    httpSummaryVersion: HTTP_SUMMARY_VERSION,
    httpEvidenceStatus: evidenceStatus,
    httpFinalOrigin: origin,
    httpResponseStatus: responseStatus,
    httpTransportSecurity: origin
      ? transport(new URL(origin).protocol.slice(0, -1))
      : transport(record.httpTransportSecurity),
    httpRedirectCount: redirectCount(record.httpRedirectCount),
    httpCrossOriginRedirect: boolOrNull(record.httpCrossOriginRedirect),
    httpHttpsDowngrade: boolOrNull(record.httpHttpsDowngrade),
    httpContentType: contentType(record.httpContentType),
    httpSecurityHeaders: securityHeaderTokens(record.httpSecurityHeaders),
  };
}

export function httpSecurityHeaderLabel(token) {
  return ({
    'content-security-policy': 'Content Security Policy',
    'content-type-protection': 'Content-type protection',
    'frame-protection': 'Frame protection',
    hsts: 'HSTS',
    'referrer-policy': 'Referrer policy',
  })[token] || token;
}
