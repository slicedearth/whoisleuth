// Certificate Transparency search - finds hostnames that have ever had a
// publicly-issued TLS certificate containing a given keyword, via crt.sh's
// public JSON API. This catches lookalike domains the typosquat generator's
// fixed permutation algorithms would never guess (arbitrary misspellings,
// unrelated TLDs, subdomain tricks) - almost every phishing site gets a
// free certificate within minutes of going live, so CT logs are often the
// earliest public signal a new lookalike exists at all. Shared by the
// Express server and the Netlify Functions.

const { readTextCapped } = require('./safe-fetch');
const { parse } = require('tldts');
const { createObservation } = require('./observation');

const CRT_SH_TIMEOUT_MS = 20000;
const MAX_RESULTS = 500;
// crt.sh's response size scales with how many certificates ever matched the
// keyword, not with MAX_RESULTS - a broad single-word keyword can have
// millions of matching certificates, and unlike the domain-homepage fetch in
// lib/availability.js (fine to scan a truncated prefix for a text match),
// this response has to be complete, valid JSON to parse at all. Capped so a
// broad keyword fails with a clear "narrow your search" error instead of
// buffering an arbitrarily large body in memory first.
const CRT_SH_MAX_BYTES = 5 * 1024 * 1024;

// crt.sh is a free, volunteer-run service backed by a Postgres database
// that gets hammered constantly - broad search terms in particular can make
// it time out or briefly 502/503 under load, even though the same query
// often succeeds a few seconds later. Worth a couple of retries before
// giving up, rather than failing a whole search on a single transient blip.
const RETRYABLE_STATUSES = new Set([502, 503, 504]);
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;
// Separate, smaller budget for timeouts specifically - each retry here
// already costs a full CRT_SH_TIMEOUT_MS wait (unlike the cheap ~1.5-3s
// delay before a status-code retry above), so this caps the worst case at
// two attempts (~40s) instead of stacking on top of MAX_RETRIES.
const MAX_TIMEOUT_RETRIES = 1;

// Row-count defense: a hostile or malformed response could fit a very large
// number of tiny rows into the 5 MB byte cap and impose excessive
// iteration/set overhead after parsing. Legitimate responses under the byte
// cap stay well within this limit.
const MAX_CT_ROWS = 50_000;

// Structured-match bounds.
const MAX_MATCHES = MAX_RESULTS; // 500
const MAX_HOSTNAMES_PER_MATCH = 50;

const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

// Maximum length for a digit-only certificate ID string before it is
// rejected as overlong. Bounds decimal crt.sh record identifiers before
// BigInt canonicalisation.
const MAX_ID_DIGITS = 32;

// Maximum length for a serial_number string before it is rejected.
const MAX_SERIAL_LENGTH = 128;

// Maximum length for an entry_timestamp string before it is rejected.
const MAX_TIMESTAMP_LENGTH = 64;

function normalizeHostname(raw) {
  let h = raw.trim().toLowerCase();
  if (h.startsWith('*.')) h = h.slice(2);
  return HOSTNAME_RE.test(h) ? h : null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchCrtSh(keyword, attempt = 0) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CRT_SH_TIMEOUT_MS);
  try {
    let res;
    try {
      res = await fetch(`https://crt.sh/?q=${encodeURIComponent(keyword)}&output=json`, {
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; DomainStatusChecker/1.0)' },
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name !== 'AbortError') throw err;
      if (attempt < MAX_TIMEOUT_RETRIES) return fetchCrtSh(keyword, attempt + 1);
      throw new Error(
        `crt.sh took too long to respond (>${CRT_SH_TIMEOUT_MS / 1000}s per attempt, ${attempt + 1} attempts) - ` +
          "it can be slow for broad search terms or under heavy load; try a narrower keyword or try again shortly."
      );
    }

    if (!res.ok) {
      // Not reading this body - release it explicitly instead of leaving an
      // unconsumed stream (and the connection it's tied to) open until
      // undici's own idle-timeout eventually notices.
      await res.body?.cancel().catch(() => {});
      if (RETRYABLE_STATUSES.has(res.status) && attempt < MAX_RETRIES) {
        await delay(RETRY_DELAY_MS * (attempt + 1));
        return fetchCrtSh(keyword, attempt + 1);
      }
      throw new Error(
        RETRYABLE_STATUSES.has(res.status)
          ? `crt.sh is temporarily overloaded (${res.status} after ${attempt + 1} attempts) - it's a free public service that intermittently struggles under load; try again in a moment.`
          : `crt.sh returned ${res.status}`
      );
    }

    const { text, truncated } = await readTextCapped(res, CRT_SH_MAX_BYTES);
    if (truncated) {
      throw new Error(
        `crt.sh returned more than ${CRT_SH_MAX_BYTES / (1024 * 1024)}MB of results for "${keyword}" - try a narrower/more specific keyword.`
      );
    }
    const data = JSON.parse(text);
    if (!Array.isArray(data)) {
      throw new Error('crt.sh returned an unexpected response format (expected a JSON array).');
    }
    if (data.length > MAX_CT_ROWS) {
      throw new Error(
        `crt.sh returned too many rows (${data.length}) for "${keyword}" - try a narrower keyword.`
      );
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Certificate identity
// ---------------------------------------------------------------------------

/**
 * crt.sh `id` identifies a certificate record. Rows with the same usable ID
 * are counted once within a registrable-domain group. When no stable
 * certificate fields exist, the row is counted as a distinct observation
 * based on its input position.
 *
 * Identity resolution (3-tier fallback):
 *   1. Usable crt.sh `id` → `id:<canonical>`
 *   2. Usable `issuer_ca_id` + `serial_number` → `issuer-serial:<ca>:<serial>`
 *   3. Row index → `row:<index>`
 *
 * All identities are namespace-prefixed so fallback forms cannot collide.
 *
 * @param {object} row - a single crt.sh JSON row
 * @param {number} index - row position in the input array
 * @returns {string}
 */
function resolveCertId(row, index) {
  const id = canonicalCertId(row.id);
  if (id !== null) return `id:${id}`;

  const issuerId = canonicalCertId(row.issuer_ca_id);
  const serial = normalizeSerial(row.serial_number);
  if (issuerId !== null && serial !== null) {
    return `issuer-serial:${issuerId}:${serial}`;
  }

  return `row:${index}`;
}

/**
 * Canonicalises a crt.sh certificate ID field for use in identity comparison.
 * Accepts only safe positive integers or digit-only strings that can be
 * canonicalised without precision loss. Returns a normalised digit string
 * or null when the value is unusable.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
function canonicalCertId(value) {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) return null;
    return String(value);
  }

  if (typeof value === 'string') {
    if (value.length === 0 || value.length > MAX_ID_DIGITS) return null;
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    if (!/^[0-9]+$/.test(trimmed)) return null;
    // Canonicalise leading zeros via BigInt (safe for up to MAX_ID_DIGITS).
    let canonical;
    try {
      canonical = BigInt(trimmed).toString();
    } catch {
      return null;
    }
    if (canonical === '0') return null;
    return canonical;
  }

  return null;
}

/**
 * Normalises a crt.sh serial_number for use in the issuer-serial composite
 * identity. Returns null when the value is unusable.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeSerial(value) {
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > MAX_SERIAL_LENGTH) return null;
  // Reject control characters before trimming.
  if (/[\x00-\x1f\x7f]/.test(value)) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  // crt.sh serial numbers are hexadecimal.
  if (!/^[0-9a-fA-F]+$/.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

// ---------------------------------------------------------------------------
// Timestamp validation
// ---------------------------------------------------------------------------

/**
 * Validates and canonicalises a crt.sh `entry_timestamp`. Only accepts
 * strings that parse to a finite timestamp. Returns an ISO-8601 string or
 * null. CT observation timestamps are public-log metadata; they do not prove
 * registration, site activation, exact issuance time, or maliciousness.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
function validateEntryTimestamp(value) {
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > MAX_TIMESTAMP_LENGTH) return null;
  // Reject control characters and overlong strings before any parsing.
  if (/[\x00-\x1f\x7f]/.test(value)) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

// ---------------------------------------------------------------------------
// Pure summarizer
// ---------------------------------------------------------------------------

/**
 * Transforms a parsed crt.sh JSON array into a structured summary with both
 * legacy hostname list and registrable-domain-grouped provenance. Pure
 * function — no network, no side effects.
 *
 * @param {Array<object>} rows - parsed crt.sh JSON rows
 * @returns {{
 *   domains: string[],
 *   matches: Array<{
 *     domain: string,
 *     hostnames: string[],
 *     firstObservedAt: string | null,
 *     lastObservedAt: string | null,
 *     certificateCount: number
 *   }>,
 *   truncated: boolean
 * }}
 */
function summarizeCtResults(rows) {
  if (!Array.isArray(rows)) {
    throw new Error('crt.sh returned an unexpected response format (expected a JSON array).');
  }
  if (rows.length > MAX_CT_ROWS) {
    throw new Error(`crt.sh returned too many rows (${rows.length}) - try a narrower keyword.`);
  }

  // --- Legacy domains (HOSTNAME_RE only, no tldts dependency) ---
  const legacyDomains = new Set();

  // --- Structured matches ---
  // Cache public-suffix resolution because the same SANs commonly recur
  // across certificate rows.
  const registrableDomainByHostname = new Map();

  // Map<registrableDomain, { hostnames: Set, certIds: Set,
  // firstObservedAt: string|null, lastObservedAt: string|null }>
  const groupMap = new Map();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || typeof row !== 'object') continue;

    const certId = resolveCertId(row, i);

    // Collect hostnames from name_value and common_name.
    const blob = `${row.name_value || ''}\n${row.common_name || ''}`;
    const ts = validateEntryTimestamp(row.entry_timestamp);

    for (const line of blob.split('\n')) {
      const host = normalizeHostname(line);
      if (!host) continue;

      // Legacy: always add if valid hostname.
      legacyDomains.add(host);

      // Structured: resolve registrable domain.
      let regDomain;
      if (registrableDomainByHostname.has(host)) {
        regDomain = registrableDomainByHostname.get(host);
      } else {
        regDomain = parse(host).domain || null;
        registrableDomainByHostname.set(host, regDomain);
      }
      if (!regDomain) continue;

      let group = groupMap.get(regDomain);
      if (!group) {
        group = {
          hostnames: new Set(),
          certIds: new Set(),
          firstObservedAt: null,
          lastObservedAt: null,
        };
        groupMap.set(regDomain, group);
      }
      group.hostnames.add(host);
      group.certIds.add(certId);
      if (ts !== null) {
        if (group.firstObservedAt === null || ts < group.firstObservedAt) {
          group.firstObservedAt = ts;
        }
        if (group.lastObservedAt === null || ts > group.lastObservedAt) {
          group.lastObservedAt = ts;
        }
      }
    }
  }

  // --- Build legacy sorted list ---
  const sortedLegacy = [...legacyDomains].sort();
  const legacyTruncated = sortedLegacy.length > MAX_RESULTS;

  // --- Build structured matches ---
  /** @type {Array<{ domain: string, hostnames: string[], firstObservedAt: string | null, lastObservedAt: string | null, certificateCount: number }>} */
  const matches = [];

  for (const [domain, group] of groupMap) {
    const sortedHostnames = [...group.hostnames].sort();

    matches.push({
      domain,
      hostnames: sortedHostnames.slice(0, MAX_HOSTNAMES_PER_MATCH),
      firstObservedAt: group.firstObservedAt,
      lastObservedAt: group.lastObservedAt,
      certificateCount: group.certIds.size,
    });
  }

  // Sort matches: newest lastObservedAt first, then null timestamps to end,
  // then domain alphabetically.
  matches.sort((a, b) => {
    const aLast = a.lastObservedAt;
    const bLast = b.lastObservedAt;
    if (aLast && bLast) {
      const cmp = bLast.localeCompare(aLast);
      if (cmp !== 0) return cmp;
    } else if (aLast) {
      return -1;
    } else if (bLast) {
      return 1;
    }
    return a.domain.localeCompare(b.domain);
  });

  const matchTruncated = matches.length > MAX_MATCHES;
  const perMatchTruncated = matches.some(
    (m) => groupMap.get(m.domain).hostnames.size > MAX_HOSTNAMES_PER_MATCH,
  );

  return {
    domains: sortedLegacy.slice(0, MAX_RESULTS),
    matches: matches.slice(0, MAX_MATCHES),
    truncated: legacyTruncated || matchTruncated || perMatchTruncated,
  };
}

// ---------------------------------------------------------------------------
// Production search
// ---------------------------------------------------------------------------

async function searchCertificateTransparency(keyword) {
  const startedAt = Date.now();
  const trimmed = (keyword || '').trim();
  if (!trimmed) {
    return {
      domains: [], certCount: 0, truncated: false, matches: [],
      observation: createObservation({
        status: 'success', observedAt: new Date().toISOString(), source: 'certificate_transparency',
        durationMs: Date.now() - startedAt, complete: true, truncated: false,
        limitations: ['Certificate Transparency observations indicate public certificate logging, not current site activity or maliciousness.'],
        diagnostics: { certificateRows: 0, matches: 0 },
      }),
    };
  }

  const data = await fetchCrtSh(trimmed);
  const summary = summarizeCtResults(data);
  return {
    certCount: data.length,
    ...summary,
    observation: createObservation({
      status: summary.truncated ? 'partial' : 'success',
      observedAt: new Date().toISOString(),
      source: 'certificate_transparency',
      durationMs: Date.now() - startedAt,
      complete: !summary.truncated,
      truncated: summary.truncated,
      limitations: ['Certificate Transparency observations indicate public certificate logging, not current site activity or maliciousness.'],
      diagnostics: { certificateRows: data.length, matches: summary.matches.length },
    }),
  };
}

module.exports = { searchCertificateTransparency, summarizeCtResults };
