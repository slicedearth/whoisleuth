// Bounded normalized provenance for the homepage response already collected
// by deep availability analysis. This module does not perform network work; it
// converts the shared safe-fetch trace and selected response metadata into an
// additive evidence object suitable for API responses and exports.

import { createObservation } from './observation.mts';
import {
  MAX_HTTP_ATTEMPTS,
  MAX_HTTP_ERROR_LENGTH,
  MAX_HTTP_EVIDENCE_REDIRECTS,
  MAX_HTTP_PROVENANCE_URL,
} from './http-evidence-bounds.mts';
import {
  HTTP_DELIVERY_LIMITATIONS,
  HTTP_DELIVERY_METADATA_VERSION,
  MAX_HTTP_CACHE_SECONDS,
  MAX_HTTP_DELIVERY_HEADER_BYTES,
  MAX_HTTP_DELIVERY_TOKENS,
} from './homepage-metadata-contract.mts';

type UnknownRecord = Record<string, unknown>;
type HeaderReader = { get(name: string): string | null };
type NormalizedProvenanceUrl = { url: string; queryOmitted: boolean; pathTruncated: boolean };
type HttpAttempt = { url: string | null; queryOmitted: boolean; outcome: string; httpStatus: number | null; error: string | null };
type HttpRedirect = { from: string; to: string; status: number | null; durationMs: number | null; queryOmitted: boolean };
type HttpDetail = {
  response?: { status?: unknown; headers?: HeaderReader | null } | null;
  requestedUrl?: unknown;
  finalUrl?: unknown;
  redirectLimitReached?: unknown;
  hops?: unknown;
  durationMs?: unknown;
};
type HttpObservationOptions = {
  bodyTruncated?: boolean;
  capturedBodyBytes?: number;
  bodyInspected?: boolean;
  bodySha256?: unknown;
  previousAttempts?: unknown[];
  observedAt?: string;
  durationMs?: number;
};

const MAX_HTTP_REDIRECTS = MAX_HTTP_EVIDENCE_REDIRECTS;
const MAX_HTTP_HEADER_LENGTH = 1024;
const MAX_HTTP_DELIVERY_HEADER_LENGTH = MAX_HTTP_DELIVERY_HEADER_BYTES;
const MAX_CAPTURED_BODY_BYTES = 5 * 1024 * 1024;
const OBSERVED_HEADER_MARKER = 'observed';
const HTTP_TOKEN_RE = /^[!#$%&'*+.^_`|~0-9a-z-]+$/u;

const SECURITY_HEADERS = Object.freeze({
  'strict-transport-security': 'strictTransportSecurity',
  'content-security-policy': 'contentSecurityPolicy',
  'x-frame-options': 'xFrameOptions',
  'x-content-type-options': 'xContentTypeOptions',
  'referrer-policy': 'referrerPolicy',
});

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f]/g, ' ');
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeProvenanceUrl(value: unknown): NormalizedProvenanceUrl | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return null;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname) return null;
    const queryOmitted = Boolean(parsed.search);
    parsed.search = '';
    parsed.hash = '';
    let url = parsed.toString();
    let pathTruncated = false;
    if (url.length > MAX_HTTP_PROVENANCE_URL) {
      parsed.pathname = '/';
      url = parsed.toString();
      pathTruncated = true;
    }
    return { url, queryOmitted, pathTruncated };
  } catch {
    return null;
  }
}

function boundedDuration(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(120_000, Math.round(number))) : null;
}

function boundedHttpStatus(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number >= 100 && number <= 599 ? number : null;
}

function headerValue(headers: HeaderReader | null | undefined, name: string, maxLength = MAX_HTTP_HEADER_LENGTH): string | null {
  if (!headers || typeof headers.get !== 'function') return null;
  return boundedString(headers.get(name), maxLength);
}

type DeliverySourceState = 'observed' | 'not_observed' | 'partial' | 'malformed';
type DeliveryHeader = { state: DeliverySourceState; value: string | null };

function deliveryHeader(
  headers: HeaderReader | null | undefined,
  name: string,
  maximum = MAX_HTTP_DELIVERY_HEADER_LENGTH,
): DeliveryHeader {
  if (!headers || typeof headers.get !== 'function') return { state: 'not_observed', value: null };
  let raw: string | null;
  try {
    raw = headers.get(name);
  } catch {
    return { state: 'malformed', value: null };
  }
  if (raw === null) return { state: 'not_observed', value: null };
  if (typeof raw !== 'string' || /[\u0000-\u001f\u007f-\u009f]/u.test(raw)) return { state: 'malformed', value: null };
  if (raw.length > maximum || Buffer.byteLength(raw, 'utf8') > maximum) return { state: 'partial', value: null };
  const value = raw.trim();
  return value ? { state: 'observed', value } : { state: 'malformed', value: null };
}

function parseContentEncoding(headers: HeaderReader | null | undefined) {
  const header = deliveryHeader(headers, 'content-encoding');
  if (header.state !== 'observed' || !header.value) {
    return { status: header.state, codings: [], encoded: null, unknownCodingCount: 0 };
  }
  const supplied = header.value.split(',').map((item) => item.trim().toLowerCase());
  const malformed = supplied.some((item) => !item || !HTTP_TOKEN_RE.test(item));
  const truncated = supplied.length > MAX_HTTP_DELIVERY_TOKENS;
  if (malformed) return { status: 'malformed' as const, codings: [], encoded: null, unknownCodingCount: 0 };
  if (truncated) return { status: 'partial' as const, codings: [], encoded: null, unknownCodingCount: 0 };
  const unknownCodingCount = supplied.filter((coding) => !['gzip', 'br', 'deflate', 'zstd', 'identity'].includes(coding)).length;
  const codings = [...new Set(supplied.map((coding) => (
    ['gzip', 'br', 'deflate', 'zstd', 'identity'].includes(coding) ? coding : 'other'
  )))].sort();
  if (codings.includes('identity') && codings.length > 1) {
    return { status: 'malformed' as const, codings: [], encoded: null, unknownCodingCount: 0 };
  }
  return {
    status: 'observed' as const,
    codings,
    encoded: codings.some((coding) => coding !== 'identity'),
    unknownCodingCount,
  };
}

function splitCacheControl(value: string): { directives: string[]; truncated: boolean; malformed: boolean } {
  const directives: string[] = [];
  let current = '';
  let quoted = false;
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (quoted && character === '\\') {
      current += character;
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      current += character;
      continue;
    }
    if (character === ',' && !quoted) {
      directives.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  directives.push(current.trim());
  return {
    directives: directives.slice(0, MAX_HTTP_DELIVERY_TOKENS),
    truncated: directives.length > MAX_HTTP_DELIVERY_TOKENS,
    malformed: quoted || escaped || directives.some((item) => !item),
  };
}

function cacheSeconds(value: string | null, allowQuoted = true): number | null {
  if (value === null) return null;
  const quoted = value.startsWith('"') && value.endsWith('"');
  if (quoted && !allowQuoted) return null;
  const unquoted = quoted ? value.slice(1, -1) : value;
  if (!/^\d+$/u.test(unquoted)) return null;
  const parsed = Number(unquoted);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= MAX_HTTP_CACHE_SECONDS ? parsed : null;
}

function validCacheFieldNameList(value: string | null): boolean {
  if (value === null) return true;
  if (value.length < 3 || value[0] !== '"' || value.at(-1) !== '"') return false;
  const fields = value.slice(1, -1).split(',').map((field) => field.trim());
  return fields.length > 0 && fields.every((field) => Boolean(field) && HTTP_TOKEN_RE.test(field));
}

function headerValidity(
  header: DeliveryHeader,
  validator: (value: string) => boolean,
): { present: boolean; valid: boolean | null } {
  if (header.state === 'not_observed') return { present: false, valid: null };
  if (header.state === 'partial') return { present: true, valid: null };
  return { present: true, valid: header.state === 'observed' && Boolean(header.value && validator(header.value)) };
}

function validHttpDate(value: string): boolean {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const longWeekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const time = '([01]\\d|2[0-3]):([0-5]\\d):([0-5]\\d)';
  const imfFixdate = value.match(new RegExp(`^(${weekdays.join('|')}), (0[1-9]|[12]\\d|3[01]) (${months.join('|')}) (\\d{4}) ${time} GMT$`, 'u'));
  const rfc850 = value.match(new RegExp(`^(${longWeekdays.join('|')}), (0[1-9]|[12]\\d|3[01])-(${months.join('|')})-(\\d{2}) ${time} GMT$`, 'u'));
  const asctime = value.match(new RegExp(`^(${weekdays.join('|')}) (${months.join('|')}) ( {2}[1-9]| [12]\\d| 3[01]) ${time} (\\d{4})$`, 'u'));
  let weekday: string;
  let day: number;
  let month: number;
  let year: number;
  let hour: number;
  let minute: number;
  let second: number;
  let expectedWeekdays: string[];
  if (imfFixdate) {
    weekday = imfFixdate[1]!;
    day = Number(imfFixdate[2]);
    month = months.indexOf(imfFixdate[3]!);
    year = Number(imfFixdate[4]);
    hour = Number(imfFixdate[5]);
    minute = Number(imfFixdate[6]);
    second = Number(imfFixdate[7]);
    expectedWeekdays = weekdays;
  } else if (rfc850) {
    weekday = rfc850[1]!;
    day = Number(rfc850[2]);
    month = months.indexOf(rfc850[3]!);
    const shortYear = Number(rfc850[4]);
    year = shortYear >= 70 ? 1900 + shortYear : 2000 + shortYear;
    hour = Number(rfc850[5]);
    minute = Number(rfc850[6]);
    second = Number(rfc850[7]);
    expectedWeekdays = longWeekdays;
  } else if (asctime) {
    weekday = asctime[1]!;
    month = months.indexOf(asctime[2]!);
    day = Number(asctime[3]!.trim());
    hour = Number(asctime[4]);
    minute = Number(asctime[5]);
    second = Number(asctime[6]);
    year = Number(asctime[7]);
    expectedWeekdays = weekdays;
  } else return false;
  if (year < 1601 || month < 0) return false;
  const parsed = new Date(0);
  parsed.setUTCFullYear(year, month, day);
  parsed.setUTCHours(hour, minute, second, 0);
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month
    && parsed.getUTCDate() === day
    && expectedWeekdays[parsed.getUTCDay()] === weekday;
}

function parseCachePolicy(headers: HeaderReader | null | undefined) {
  const cacheControl = deliveryHeader(headers, 'cache-control');
  const age = deliveryHeader(headers, 'age', 64);
  const etagHeader = deliveryHeader(headers, 'etag');
  const lastModifiedHeader = deliveryHeader(headers, 'last-modified');
  const expiresHeader = deliveryHeader(headers, 'expires');
  const parsed = cacheControl.state === 'observed' && cacheControl.value
    ? splitCacheControl(cacheControl.value)
    : { directives: [], truncated: false, malformed: false };
  const flags = {
    noStore: false,
    noCache: false,
    mustRevalidate: false,
    public: false,
    private: false,
    immutable: false,
  };
  let maxAgeSeconds: number | null = null;
  let sMaxAgeSeconds: number | null = null;
  let maxAgeSeen = false;
  let sMaxAgeSeen = false;
  let maxAgeMalformed = false;
  let sMaxAgeMalformed = false;
  let unknownDirectiveCount = 0;
  let malformed = parsed.malformed;
  for (const directive of parsed.truncated ? [] : parsed.directives) {
    const separator = directive.indexOf('=');
    const name = (separator === -1 ? directive : directive.slice(0, separator)).trim().toLowerCase();
    const value = separator === -1 ? null : directive.slice(separator + 1).trim();
    if (!HTTP_TOKEN_RE.test(name)) {
      malformed = true;
      continue;
    }
    if (name === 'no-store') {
      flags.noStore = true;
      if (value !== null) malformed = true;
    } else if (name === 'no-cache') {
      flags.noCache = true;
      if (!validCacheFieldNameList(value)) malformed = true;
    } else if (name === 'must-revalidate') {
      flags.mustRevalidate = true;
      if (value !== null) malformed = true;
    } else if (name === 'public') {
      flags.public = true;
      if (value !== null) malformed = true;
    } else if (name === 'private') {
      flags.private = true;
      if (!validCacheFieldNameList(value)) malformed = true;
    } else if (name === 'immutable') {
      flags.immutable = true;
      if (value !== null) malformed = true;
    }
    else if (name === 'max-age') {
      const parsedSeconds = cacheSeconds(value);
      if (parsedSeconds === null || maxAgeSeen && parsedSeconds !== maxAgeSeconds) {
        malformed = true;
        maxAgeMalformed = true;
        maxAgeSeconds = null;
      } else if (!maxAgeMalformed) maxAgeSeconds = parsedSeconds;
      maxAgeSeen = true;
    } else if (name === 's-maxage') {
      const parsedSeconds = cacheSeconds(value);
      if (parsedSeconds === null || sMaxAgeSeen && parsedSeconds !== sMaxAgeSeconds) {
        malformed = true;
        sMaxAgeMalformed = true;
        sMaxAgeSeconds = null;
      } else if (!sMaxAgeMalformed) sMaxAgeSeconds = parsedSeconds;
      sMaxAgeSeen = true;
    } else unknownDirectiveCount += 1;
  }
  if (parsed.truncated) {
    flags.noStore = false;
    flags.noCache = false;
    flags.mustRevalidate = false;
    flags.public = false;
    flags.private = false;
    flags.immutable = false;
    maxAgeSeconds = null;
    sMaxAgeSeconds = null;
    maxAgeSeen = false;
    sMaxAgeSeen = false;
    unknownDirectiveCount = 0;
  }
  const ageSeconds = age.state === 'observed' ? cacheSeconds(age.value, false) : null;
  if (age.state === 'observed' && ageSeconds === null) malformed = true;
  const etag = headerValidity(etagHeader, (value) => /^(?:W\/)?"[\x21\x23-\x7e]*"$/u.test(value));
  const lastModified = headerValidity(lastModifiedHeader, validHttpDate);
  const expires = headerValidity(expiresHeader, validHttpDate);
  malformed = malformed || [etag, lastModified, expires].some((item) => item.present && item.valid === false);
  const headersObserved = [cacheControl, age, etagHeader, lastModifiedHeader, expiresHeader]
    .some((header) => header.state !== 'not_observed');
  const partial = parsed.truncated || [cacheControl, age, etagHeader, lastModifiedHeader, expiresHeader]
    .some((header) => header.state === 'partial');
  malformed = malformed || [cacheControl, age, etagHeader, lastModifiedHeader, expiresHeader]
    .some((header) => header.state === 'malformed');
  const status: DeliverySourceState = partial
    ? 'partial'
    : malformed
      ? 'malformed'
      : headersObserved ? 'observed' : 'not_observed';
  return {
    value: {
      status,
      ...flags,
      maxAgeSeconds,
      sMaxAgeSeconds,
      ageSeconds,
      maxAgePresent: maxAgeSeen,
      sMaxAgePresent: sMaxAgeSeen,
      agePresent: age.state !== 'not_observed',
      unknownDirectiveCount,
      etag,
      lastModified,
      expires,
    },
    malformed,
    truncated: partial,
  };
}

function buildDeliveryMetadata(headers: HeaderReader | null | undefined) {
  const contentEncoding = parseContentEncoding(headers);
  const cacheResult = parseCachePolicy(headers);
  const cachePolicy = cacheResult.value;
  const incomplete = [contentEncoding.status, cachePolicy.status].some((status) => ['partial', 'malformed'].includes(status));
  const truncated = contentEncoding.status === 'partial' || cacheResult.truncated;
  const limitations: string[] = [
    HTTP_DELIVERY_LIMITATIONS.scope,
  ];
  if (truncated) limitations.push(HTTP_DELIVERY_LIMITATIONS.bounds);
  if (contentEncoding.status === 'malformed' || cacheResult.malformed) limitations.push(HTTP_DELIVERY_LIMITATIONS.malformed);
  return {
    version: HTTP_DELIVERY_METADATA_VERSION,
    status: incomplete ? 'partial' : 'success',
    complete: !incomplete,
    truncated,
    limitations,
    contentEncoding,
    cachePolicy,
  };
}

function declaredContentLength(headers: HeaderReader | null | undefined): number | null {
  const raw = headerValue(headers, 'content-length', 32);
  if (!raw || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function normalizeAttempts(attempts: unknown): HttpAttempt[] {
  return (Array.isArray(attempts) ? attempts : []).slice(0, MAX_HTTP_ATTEMPTS).map((attempt) => {
    const record = attempt && typeof attempt === 'object' ? attempt as UnknownRecord : {};
    const url = normalizeProvenanceUrl(record.url);
    const error = boundedString(record.error, MAX_HTTP_ERROR_LENGTH);
    const httpStatus = boundedHttpStatus(record.httpStatus);
    return {
      url: url ? url.url : null,
      queryOmitted: url ? url.queryOmitted : false,
      outcome: error ? 'error' : httpStatus !== null ? 'response' : 'unknown',
      httpStatus,
      error,
    };
  });
}

function normalizeRedirects(hops: unknown): HttpRedirect[] {
  return (Array.isArray(hops) ? hops : [])
    .filter((hop) => Boolean(hop && typeof hop === 'object' && (hop as UnknownRecord).location))
    .slice(0, MAX_HTTP_REDIRECTS)
    .map((hop) => {
      const record = hop as UnknownRecord;
      const from = normalizeProvenanceUrl(record.url);
      const to = normalizeProvenanceUrl(record.location);
      if (!from || !to) return null;
      return {
        from: from.url,
        to: to.url,
        status: boundedHttpStatus(record.status),
        durationMs: boundedDuration(record.durationMs),
        queryOmitted: from.queryOmitted || to.queryOmitted,
      };
    })
    .filter((item): item is HttpRedirect => item !== null);
}

function securityHeaders(headers: HeaderReader | null | undefined): Record<string, string | null> {
  return Object.fromEntries(Object.entries(SECURITY_HEADERS).map(([header, field]) => [
    field,
    headerValue(headers, header) ? OBSERVED_HEADER_MARKER : null,
  ]));
}

function normalizedSha256(value: unknown): string | null {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value) ? value.toLowerCase() : null;
}

function buildHttpObservation(detail: HttpDetail, options: HttpObservationOptions = {}) {
  const response = detail && detail.response;
  const requested = normalizeProvenanceUrl(detail && detail.requestedUrl);
  const final = normalizeProvenanceUrl(detail && detail.finalUrl);
  const redirects = normalizeRedirects(detail && detail.hops);
  const bodyTruncated = options.bodyTruncated === true;
  const redirectLimitReached = detail && detail.redirectLimitReached === true;
  const capturedBodyBytes = Number.isFinite(Number(options.capturedBodyBytes))
    ? Math.max(0, Math.min(MAX_CAPTURED_BODY_BYTES, Math.round(Number(options.capturedBodyBytes))))
    : 0;
  const bodyInspected = options.bodyInspected === true;
  const bodySha256 = bodyInspected ? normalizedSha256(options.bodySha256) : null;
  const limitations: string[] = [];
  if (bodyTruncated) limitations.push('Homepage body capture reached its byte limit; response metadata and the retained prefix remain usable.');
  if (redirectLimitReached) limitations.push('Redirect following reached the configured hop limit; the final destination was not requested.');
  if ((requested && requested.pathTruncated) || (final && final.pathTruncated)) limitations.push('An overlong URL path was omitted from retained provenance.');
  if ((requested && requested.queryOmitted) || (final && final.queryOmitted) || redirects.some((item) => item.queryOmitted)) {
    limitations.push('URL query strings were omitted from retained provenance.');
  }
  const httpsDowngrade = redirects.some((item) => item.from.startsWith('https:') && item.to.startsWith('http:'));
  const crossOriginRedirect = redirects.some((item) => new URL(item.from).origin !== new URL(item.to).origin);
  const incomplete = bodyTruncated || redirectLimitReached;
  const status = boundedHttpStatus(response && response.status);
  const attempts = normalizeAttempts([
    ...(Array.isArray(options.previousAttempts) ? options.previousAttempts : []),
    { url: detail && detail.requestedUrl, httpStatus: status },
  ]);

  return {
    ...createObservation({
      status: incomplete ? 'partial' : 'success',
      observedAt: options.observedAt,
      scanMode: 'deep',
      source: 'http',
      durationMs: detail && detail.durationMs,
      complete: !incomplete,
      truncated: incomplete,
      limitations,
      diagnostics: {
        redirectCount: redirects.length,
        httpStatus: status,
      },
    }),
    requestUrl: requested ? requested.url : null,
    finalUrl: final ? final.url : null,
    transportSecurity: final ? final.url.split(':', 1)[0] : null,
    redirectCount: redirects.length,
    redirectLimitReached,
    redirects,
    crossOriginRedirect,
    httpsDowngrade,
    attempts,
    response: {
      status,
      contentType: headerValue(response && response.headers, 'content-type', 200),
      contentLanguage: headerValue(response && response.headers, 'content-language', 120),
      server: headerValue(response && response.headers, 'server', 200),
      declaredContentLength: declaredContentLength(response && response.headers),
      capturedBodyBytes,
      bodyInspected,
      bodyTruncated,
      bodyHash: bodySha256 ? {
        algorithm: 'sha256',
        value: bodySha256,
        scope: bodyTruncated ? 'captured-prefix' : 'complete-body',
        bytes: capturedBodyBytes,
      } : null,
      securityHeaders: securityHeaders(response && response.headers),
      deliveryMetadata: buildDeliveryMetadata(response && response.headers),
    },
  };
}

function failedHttpObservation(attempts: unknown, options: HttpObservationOptions = {}) {
  const normalizedAttempts = normalizeAttempts(attempts);
  return {
    ...createObservation({
      status: 'error',
      observedAt: options.observedAt,
      scanMode: 'deep',
      source: 'http',
      durationMs: options.durationMs,
      complete: false,
      limitations: ['HTTP activity could not be confirmed; network, DNS, TLS, timeout, and policy failures are not proof that no site exists.'],
      diagnostics: { attemptCount: normalizedAttempts.length },
    }),
    requestUrl: normalizedAttempts[0]?.url || null,
    finalUrl: null,
    transportSecurity: null,
    redirectCount: 0,
    redirectLimitReached: false,
    redirects: [],
    crossOriginRedirect: false,
    httpsDowngrade: false,
    attempts: normalizedAttempts,
    response: null,
  };
}

function skippedHttpObservation() {
  return {
    ...createObservation({
      status: 'skipped',
      scanMode: 'deep',
      source: 'http',
      complete: false,
      limitations: ['Website probing is disabled by deployment policy.'],
    }),
    requestUrl: null,
    finalUrl: null,
    transportSecurity: null,
    redirectCount: 0,
    redirectLimitReached: false,
    redirects: [],
    crossOriginRedirect: false,
    httpsDowngrade: false,
    attempts: [],
    response: null,
  };
}

export {
  MAX_HTTP_ERROR_LENGTH,
  MAX_HTTP_PROVENANCE_URL,
  MAX_HTTP_REDIRECTS,
  MAX_HTTP_ATTEMPTS,
  HTTP_DELIVERY_METADATA_VERSION,
  MAX_HTTP_DELIVERY_HEADER_LENGTH,
  MAX_HTTP_DELIVERY_TOKENS,
  normalizeProvenanceUrl,
  buildHttpObservation,
  failedHttpObservation,
  skippedHttpObservation,
};
