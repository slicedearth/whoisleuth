// Bounded normalized provenance for the homepage response already collected
// by deep availability analysis. This module does not perform network work; it
// converts the shared safe-fetch trace and selected response metadata into an
// additive evidence object suitable for API responses and exports.

import { createObservation } from './observation.mts';

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

const MAX_HTTP_PROVENANCE_URL = 2048;
const MAX_HTTP_REDIRECTS = 5;
const MAX_HTTP_ATTEMPTS = 2;
const MAX_HTTP_ERROR_LENGTH = 180;
const MAX_HTTP_HEADER_LENGTH = 1024;
const MAX_CAPTURED_BODY_BYTES = 5 * 1024 * 1024;

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
    headerValue(headers, header),
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
  MAX_HTTP_PROVENANCE_URL,
  MAX_HTTP_REDIRECTS,
  MAX_HTTP_ATTEMPTS,
  normalizeProvenanceUrl,
  buildHttpObservation,
  failedHttpObservation,
  skippedHttpObservation,
};
