// Bounded normalized provenance for the homepage response already collected
// by deep availability analysis. This module does not perform network work; it
// converts the shared safe-fetch trace and selected response metadata into an
// additive evidence object suitable for API responses and exports.

const { createObservation } = require('./observation');

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

function boundedString(value, maxLength) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f]/g, ' ');
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeProvenanceUrl(value) {
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

function boundedDuration(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(120_000, Math.round(number))) : null;
}

function boundedHttpStatus(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 100 && number <= 599 ? number : null;
}

function headerValue(headers, name, maxLength = MAX_HTTP_HEADER_LENGTH) {
  if (!headers || typeof headers.get !== 'function') return null;
  return boundedString(headers.get(name), maxLength);
}

function declaredContentLength(headers) {
  const raw = headerValue(headers, 'content-length', 32);
  if (!raw || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function normalizeAttempts(attempts) {
  return (Array.isArray(attempts) ? attempts : []).slice(0, MAX_HTTP_ATTEMPTS).map((attempt) => {
    const url = normalizeProvenanceUrl(attempt && attempt.url);
    const error = boundedString(attempt && attempt.error, MAX_HTTP_ERROR_LENGTH);
    const httpStatus = boundedHttpStatus(attempt && attempt.httpStatus);
    return {
      url: url ? url.url : null,
      queryOmitted: url ? url.queryOmitted : false,
      outcome: error ? 'error' : httpStatus !== null ? 'response' : 'unknown',
      httpStatus,
      error,
    };
  });
}

function normalizeRedirects(hops) {
  return (Array.isArray(hops) ? hops : [])
    .filter((hop) => hop && hop.location)
    .slice(0, MAX_HTTP_REDIRECTS)
    .map((hop) => {
      const from = normalizeProvenanceUrl(hop.url);
      const to = normalizeProvenanceUrl(hop.location);
      if (!from || !to) return null;
      return {
        from: from.url,
        to: to.url,
        status: boundedHttpStatus(hop.status),
        durationMs: boundedDuration(hop.durationMs),
        queryOmitted: from.queryOmitted || to.queryOmitted,
      };
    })
    .filter((item) => item !== null);
}

function securityHeaders(headers) {
  return Object.fromEntries(Object.entries(SECURITY_HEADERS).map(([header, field]) => [
    field,
    headerValue(headers, header),
  ]));
}

function buildHttpObservation(detail, options = {}) {
  const response = detail && detail.response;
  const requested = normalizeProvenanceUrl(detail && detail.requestedUrl);
  const final = normalizeProvenanceUrl(detail && detail.finalUrl);
  const redirects = normalizeRedirects(detail && detail.hops);
  const bodyTruncated = options.bodyTruncated === true;
  const redirectLimitReached = detail && detail.redirectLimitReached === true;
  const capturedBodyBytes = Number.isFinite(Number(options.capturedBodyBytes))
    ? Math.max(0, Math.min(MAX_CAPTURED_BODY_BYTES, Math.round(Number(options.capturedBodyBytes))))
    : 0;
  const limitations = [];
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
      bodyInspected: options.bodyInspected === true,
      bodyTruncated,
      securityHeaders: securityHeaders(response && response.headers),
    },
  };
}

function failedHttpObservation(attempts, options = {}) {
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

module.exports = {
  MAX_HTTP_PROVENANCE_URL,
  MAX_HTTP_REDIRECTS,
  MAX_HTTP_ATTEMPTS,
  normalizeProvenanceUrl,
  buildHttpObservation,
  failedHttpObservation,
  skippedHttpObservation,
};
