// Optional RFC 9116 disclosure-contact collection for a single deep Lookup.
// The request is deliberately separate from homepage analysis: it uses the
// exact queried hostname, HTTPS only, and never contributes to availability or
// Risk. Published contact and policy values are normalized into a small,
// bounded record; the response body itself is discarded after parsing.

import { safeFetchDetailed, readTextCapped } from './safe-fetch.mts';
import { createObservation } from './observation.mts';

type SecurityTxtState = 'present' | 'stale' | 'partial' | 'absent' | 'malformed' | 'unsupported' | 'unavailable';
type SecurityTxtFetch = typeof safeFetchDetailed;
type SecurityTxtReader = typeof readTextCapped;
type SecurityTxtDependencies = {
  fetchDetailed?: SecurityTxtFetch;
  readResponse?: SecurityTxtReader;
  now?: () => number;
};
type ParseOptions = {
  finalUrl?: string;
  truncated?: boolean;
  now?: number;
};

const SECURITY_TXT_VERSION = 1;
const SECURITY_TXT_PATH = '/.well-known/security.txt';
const SECURITY_TXT_TIMEOUT_MS = 6_000;
const MAX_SECURITY_TXT_BYTES = 64 * 1024;
const MAX_SECURITY_TXT_REDIRECTS = 3;
const MAX_SECURITY_TXT_LINES = 256;
const MAX_SECURITY_TXT_LINE_LENGTH = 2_048;
const MAX_SECURITY_TXT_VALUES = 10;
const MAX_SECURITY_TXT_URL_LENGTH = 2_048;
const CONTROL_CHARACTER_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const URI_CONTROL_CHARACTER_RE = /[\u0000-\u001f\u007f]/u;
const FIELD_RE = /^([A-Za-z][A-Za-z-]*):[ \t]*(.*)$/u;
const LANGUAGE_RE = /^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/iu;
const RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const CONTACT_PROTOCOLS = new Set(['https:', 'mailto:', 'tel:']);
const HTTPS_PROTOCOLS = new Set(['https:']);
const ENCRYPTION_PROTOCOLS = new Set(['https:', 'dns:', 'openpgp4fpr:']);

function boundedDetail(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  return value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 240) || fallback;
}

function canonicalHostname(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > 253 || URI_CONTROL_CHARACTER_RE.test(value)) return null;
  const raw = value.trim().toLowerCase();
  if (!/^[a-z0-9.-]+$/iu.test(raw) || raw.startsWith('.') || raw.endsWith('.') || raw.includes('..')) return null;
  try {
    const url = new URL(`https://${raw}`);
    return url.hostname === raw && url.hostname.includes('.') ? url.hostname : null;
  } catch {
    return null;
  }
}

function normalizedPublishedUri(value: string, schemes: Set<string>): string | null {
  if (!value || value.length > MAX_SECURITY_TXT_URL_LENGTH || URI_CONTROL_CHARACTER_RE.test(value)) return null;
  try {
    const url = new URL(value.trim());
    if (!schemes.has(url.protocol) || url.username || url.password) return null;
    if (url.protocol === 'https:' && !url.hostname) return null;
    url.search = '';
    url.hash = '';
    return url.toString().slice(0, MAX_SECURITY_TXT_URL_LENGTH);
  } catch {
    return null;
  }
}

function normalizedHttpsUrl(value: string): string | null {
  return normalizedPublishedUri(value, HTTPS_PROTOCOLS);
}

function eligibleHttpsFetchUrl(value: string): string | null {
  if (!value || value.length > MAX_SECURITY_TXT_URL_LENGTH || URI_CONTROL_CHARACTER_RE.test(value)) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.port) return null;
    url.hash = '';
    return url.toString().slice(0, MAX_SECURITY_TXT_URL_LENGTH);
  } catch {
    return null;
  }
}

function uniqueBounded(values: string[]): { values: string[]; truncated: boolean } {
  const unique = [...new Set(values)];
  return { values: unique.slice(0, MAX_SECURITY_TXT_VALUES), truncated: unique.length > MAX_SECURITY_TXT_VALUES };
}

function clearSignedPayload(text: string): { text: string; signed: boolean } {
  if (!text.startsWith('-----BEGIN PGP SIGNED MESSAGE-----')) return { text, signed: false };
  const lines = text.replace(/\r\n?/gu, '\n').split('\n');
  const bodyStart = lines.findIndex((line, index) => index > 0 && line === '');
  const signatureStart = lines.findIndex((line) => line === '-----BEGIN PGP SIGNATURE-----');
  if (bodyStart < 0 || signatureStart <= bodyStart) return { text: '', signed: true };
  return {
    text: lines.slice(bodyStart + 1, signatureStart).map((line) => line.startsWith('- ') ? line.slice(2) : line).join('\n'),
    signed: true,
  };
}

function parseSecurityTxt(text: unknown, options: ParseOptions = {}) {
  const observedAt = new Date(options.now ?? Date.now()).toISOString();
  if (typeof text !== 'string' || text.includes('\ufffd') || CONTROL_CHARACTER_RE.test(text)) {
    return {
      securityTxtVersion: SECURITY_TXT_VERSION,
      state: 'malformed' as SecurityTxtState,
      detail: 'The response was not valid bounded UTF-8 text.',
      contacts: [], policies: [], encryption: [], canonical: [], preferredLanguages: [],
      expiresAt: null, signed: false, canonicalMatches: null,
      ...createObservation({ status: 'error', observedAt, scanMode: 'deep', source: 'security_txt', complete: false }),
    };
  }

  const signedPayload = clearSignedPayload(text);
  const lines = signedPayload.text.replace(/\r\n?/gu, '\n').split('\n');
  let malformedCount = 0;
  let ignoredCount = 0;
  let valuesTruncated = options.truncated === true || lines.length > MAX_SECURITY_TXT_LINES;
  const contacts: string[] = [];
  const policies: string[] = [];
  const encryption: string[] = [];
  const canonical: string[] = [];
  const preferredLanguages: string[] = [];
  const expires: string[] = [];

  for (const rawLine of lines.slice(0, MAX_SECURITY_TXT_LINES)) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) continue;
    if (rawLine.length > MAX_SECURITY_TXT_LINE_LENGTH) {
      malformedCount += 1;
      continue;
    }
    const match = rawLine.match(FIELD_RE);
    if (!match) {
      malformedCount += 1;
      continue;
    }
    const field = match[1].toLowerCase();
    const value = match[2].trim();
    let normalized: string | null = null;
    if (field === 'contact') {
      normalized = normalizedPublishedUri(value, CONTACT_PROTOCOLS);
      if (normalized) contacts.push(normalized); else malformedCount += 1;
    } else if (field === 'policy') {
      normalized = normalizedHttpsUrl(value);
      if (normalized) policies.push(normalized); else malformedCount += 1;
    } else if (field === 'encryption') {
      normalized = normalizedPublishedUri(value, ENCRYPTION_PROTOCOLS);
      if (normalized) encryption.push(normalized); else malformedCount += 1;
    } else if (field === 'canonical') {
      normalized = normalizedHttpsUrl(value);
      if (normalized) canonical.push(normalized); else malformedCount += 1;
    } else if (field === 'preferred-languages') {
      const languages = value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
      const valid = languages.filter((item) => LANGUAGE_RE.test(item));
      preferredLanguages.push(...valid);
      malformedCount += languages.length - valid.length;
    } else if (field === 'expires') {
      if (RFC3339_RE.test(value) && Number.isFinite(Date.parse(value))) expires.push(new Date(value).toISOString());
      else malformedCount += 1;
    } else {
      ignoredCount += 1;
    }
  }

  const boundedContacts = uniqueBounded(contacts);
  const boundedPolicies = uniqueBounded(policies);
  const boundedEncryption = uniqueBounded(encryption);
  const boundedCanonical = uniqueBounded(canonical);
  const boundedLanguages = uniqueBounded(preferredLanguages);
  valuesTruncated ||= [boundedContacts, boundedPolicies, boundedEncryption, boundedCanonical, boundedLanguages]
    .some((entry) => entry.truncated);
  const expiresAt = expires.length === 1 ? expires[0] : null;
  const finalUrl = options.finalUrl ? normalizedHttpsUrl(options.finalUrl) : null;
  const canonicalMatches = boundedCanonical.values.length && finalUrl
    ? boundedCanonical.values.some((value) => value.toLowerCase() === finalUrl.toLowerCase())
    : null;
  const stale = Boolean(expiresAt && Date.parse(expiresAt) <= (options.now ?? Date.now()));
  const requiredMalformed = boundedContacts.values.length === 0 || expires.length !== 1;
  let state: SecurityTxtState = 'present';
  if (requiredMalformed && !valuesTruncated) state = 'malformed';
  else if (stale) state = 'stale';
  else if (valuesTruncated || requiredMalformed || malformedCount > 0 || canonicalMatches === false) state = 'partial';

  const limitations = [
    ...(signedPayload.signed ? ['A cleartext signature was present but was not cryptographically verified.'] : []),
    ...(canonicalMatches === false ? ['The fetched URL was not listed by the file as a Canonical location.'] : []),
    ...(valuesTruncated ? ['The response or normalized field set exceeded a collection bound.'] : []),
  ];
  const detail = state === 'malformed'
    ? 'The file did not contain at least one valid Contact field and exactly one valid Expires field.'
    : state === 'stale'
      ? 'The published disclosure file has expired and may be stale.'
      : state === 'partial'
        ? 'Disclosure fields were retained, but part of the publication was invalid, truncated, or inconsistent.'
        : 'A current security disclosure file was published for this hostname.';

  return {
    securityTxtVersion: SECURITY_TXT_VERSION,
    state,
    detail,
    contacts: boundedContacts.values,
    policies: boundedPolicies.values,
    encryption: boundedEncryption.values,
    canonical: boundedCanonical.values,
    preferredLanguages: boundedLanguages.values,
    expiresAt,
    signed: signedPayload.signed,
    canonicalMatches,
    ...createObservation({
      status: state === 'present' ? 'success' : state === 'malformed' ? 'error' : 'partial',
      observedAt,
      scanMode: 'deep',
      source: 'security_txt',
      complete: state === 'present',
      truncated: valuesTruncated,
      limitations,
      diagnostics: { malformedCount, ignoredCount },
    }),
  };
}

function emptyResult(
  state: Exclude<SecurityTxtState, 'present' | 'stale' | 'partial' | 'malformed'>,
  detail: string,
  input: { observedAt: string; requestedUrl: string; finalUrl?: string | null; httpStatus?: number | null; durationMs?: number | null },
) {
  const status = state === 'absent' ? 'not_found' : state === 'unsupported' ? 'unsupported' : 'error';
  return {
    securityTxtVersion: SECURITY_TXT_VERSION,
    state,
    detail,
    requestedUrl: input.requestedUrl,
    finalUrl: input.finalUrl ? normalizedHttpsUrl(input.finalUrl) : null,
    httpStatus: input.httpStatus ?? null,
    contacts: [], policies: [], encryption: [], canonical: [], preferredLanguages: [],
    expiresAt: null, signed: false, canonicalMatches: null,
    ...createObservation({
      status,
      observedAt: input.observedAt,
      scanMode: 'deep',
      source: 'security_txt',
      durationMs: input.durationMs,
      complete: state === 'absent',
    }),
  };
}

function securityTxtUnavailable(hostname: unknown, error: unknown, timestamp = Date.now()) {
  const normalizedHostname = canonicalHostname(hostname);
  if (!normalizedHostname) throw new Error('A valid domain hostname is required for security.txt collection.');
  const observedAt = new Date(Number.isFinite(timestamp) ? timestamp : Date.now()).toISOString();
  return emptyResult('unavailable', boundedDetail(error instanceof Error ? error.message : error, 'The disclosure request failed.'), {
    observedAt,
    requestedUrl: `https://${normalizedHostname}${SECURITY_TXT_PATH}`,
  });
}

async function collectSecurityTxt(hostname: unknown, dependencies: SecurityTxtDependencies = {}) {
  const normalizedHostname = canonicalHostname(hostname);
  if (!normalizedHostname) throw new Error('A valid domain hostname is required for security.txt collection.');
  const fetchDetailed = dependencies.fetchDetailed || safeFetchDetailed;
  const readResponse = dependencies.readResponse || readTextCapped;
  const now = dependencies.now || Date.now;
  const startedAt = now();
  const observedAt = new Date(startedAt).toISOString();
  const requestedUrl = `https://${normalizedHostname}${SECURITY_TXT_PATH}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SECURITY_TXT_TIMEOUT_MS);
  let currentUrl = requestedUrl;
  let redirectCount = 0;

  try {
    while (true) {
      const result = await fetchDetailed(currentUrl, {
        headers: { accept: 'text/plain; charset=utf-8' },
        signal: controller.signal,
      }, { maxRedirects: 0 });
      const response = result.response;
      const redirectTarget = result.hops[0]?.location || null;
      if (redirectTarget) {
        await response.body?.cancel().catch(() => {});
        if (redirectCount >= MAX_SECURITY_TXT_REDIRECTS) {
          return emptyResult('unavailable', 'The disclosure file exceeded the redirect limit.', {
            observedAt, requestedUrl, finalUrl: currentUrl, httpStatus: response.status, durationMs: now() - startedAt,
          });
        }
        const next = eligibleHttpsFetchUrl(redirectTarget);
        if (!next) {
          return emptyResult('unavailable', 'The disclosure file redirected to an ineligible non-HTTPS location.', {
            observedAt, requestedUrl, finalUrl: currentUrl, httpStatus: response.status, durationMs: now() - startedAt,
          });
        }
        currentUrl = next;
        redirectCount += 1;
        continue;
      }

      const finalFetchUrl = eligibleHttpsFetchUrl(result.finalUrl);
      if (!finalFetchUrl || finalFetchUrl !== currentUrl) {
        await response.body?.cancel().catch(() => {});
        return emptyResult('unavailable', 'The disclosure response reported an ineligible final location.', {
          observedAt, requestedUrl, finalUrl: currentUrl, httpStatus: response.status, durationMs: now() - startedAt,
        });
      }

      if (response.status === 404 || response.status === 410) {
        await response.body?.cancel().catch(() => {});
        return emptyResult('absent', 'No security.txt file was published at the standardized location for this hostname.', {
          observedAt, requestedUrl, finalUrl: result.finalUrl, httpStatus: response.status, durationMs: now() - startedAt,
        });
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        return emptyResult('unavailable', `The disclosure endpoint returned HTTP ${response.status}.`, {
          observedAt, requestedUrl, finalUrl: result.finalUrl, httpStatus: response.status, durationMs: now() - startedAt,
        });
      }
      const contentType = response.headers.get('content-type') || '';
      const charset = contentType.match(/;\s*charset\s*=\s*"?([^;"\s]+)/iu)?.[1]?.toLowerCase() || null;
      if (!/^text\/plain(?:\s*;|$)/iu.test(contentType) || (charset !== null && charset !== 'utf-8')) {
        await response.body?.cancel().catch(() => {});
        return emptyResult('unsupported', 'The standardized endpoint did not return a UTF-8 text/plain security.txt document.', {
          observedAt, requestedUrl, finalUrl: result.finalUrl, httpStatus: response.status, durationMs: now() - startedAt,
        });
      }
      const body = await readResponse(response, MAX_SECURITY_TXT_BYTES);
      const parsed = parseSecurityTxt(body.text, { finalUrl: finalFetchUrl, truncated: body.truncated, now: startedAt });
      return {
        ...parsed,
        requestedUrl,
        finalUrl: normalizedHttpsUrl(finalFetchUrl),
        httpStatus: response.status,
        redirectCount,
        durationMs: Math.max(0, Math.min(120_000, Math.round(now() - startedAt))),
      };
    }
  } catch (error) {
    const timedOut = controller.signal.aborted;
    return emptyResult('unavailable', timedOut
      ? 'The disclosure request timed out.'
      : boundedDetail(error instanceof Error ? error.message : error, 'The disclosure request failed.'), {
        observedAt, requestedUrl, finalUrl: currentUrl, durationMs: now() - startedAt,
      });
  } finally {
    clearTimeout(timer);
  }
}

export {
  SECURITY_TXT_VERSION,
  SECURITY_TXT_PATH,
  SECURITY_TXT_TIMEOUT_MS,
  MAX_SECURITY_TXT_BYTES,
  MAX_SECURITY_TXT_REDIRECTS,
  parseSecurityTxt,
  collectSecurityTxt,
  securityTxtUnavailable,
};

export type { SecurityTxtDependencies, SecurityTxtState };
