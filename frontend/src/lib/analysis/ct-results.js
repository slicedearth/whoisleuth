// Framework-neutral normalization of the Certificate Transparency search API
// response (see lib/ct-search.mts for the backend contract). No DOM, Svelte,
// localStorage, sessionStorage, or network access lives here so the module is
// node --test-able and safe to import from both the Discover route and the
// candidate-handoff serializer.
//
// The response is treated as untrusted even though it comes from the project's
// own backend: every field is revalidated, bounded, and rebuilt into fresh
// objects. Prompt 5A already resolves each match's canonical registrable
// domain via the public-suffix list on the server, so this module never
// re-derives registrable domains in the browser - it only normalizes and
// bounds what the server sent.

import { normalizeDomain } from './case-model.js';

// The stable mutation/source token every CT-derived candidate carries so Bulk,
// coverage, and the handoff can recognise its provenance.
export const CERTIFICATE_TRANSPARENCY_MUTATION = 'certificate_transparency';

// Bounds. Kept aligned with the backend's own caps (lib/ct-search.mts) so a
// well-formed response is never clipped, while a hostile or malformed one can
// never impose unbounded work or storage.
export const MAX_CT_CANDIDATES = 500; // mirrors backend MAX_MATCHES / MAX_RESULTS
export const MAX_CT_HOSTNAMES = 50; // mirrors backend MAX_HOSTNAMES_PER_MATCH
export const MAX_CT_HOSTNAME_LENGTH = 253; // a DNS name can never exceed this
export const MAX_CT_TIMESTAMP_LENGTH = 64; // mirrors backend MAX_TIMESTAMP_LENGTH
export const MAX_CT_CERTIFICATE_COUNT = 1_000_000; // clamp for the deduped count
export const MAX_CT_SOURCE_LENGTH = 253; // same bound the handoff enforces on source

// Input-processing caps. A well-formed backend response stays far below these
// (matches <= 500, hostnames <= 50 per match), but the response is untrusted:
// these bound how many array elements we ever *iterate*, not just how many we
// keep, so a hostile or buggy payload can never impose O(millions) of work.
// Set above the output bounds so legitimate de-duplication is never starved.
export const MAX_CT_INPUT_MATCHES = 2000;
export const MAX_CT_INPUT_HOSTNAMES = 500;
export const MAX_CT_INPUT_DOMAINS = 2000;

/**
 * A canonical, bounded certificate-count. Accepts only finite non-negative
 * numbers, floors and clamps them; anything else becomes 0.
 * @param {unknown} value
 * @returns {number}
 */
function normalizeCount(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.floor(value), MAX_CT_CERTIFICATE_COUNT);
}

/**
 * Validates a CT observation timestamp. Only bounded, control-character-free
 * strings that parse to a finite instant are accepted; the result is
 * canonicalised to an ISO-8601 string so ordering and de-duplication are
 * deterministic. CT observation timestamps are public-log provenance - they do
 * not prove registration, site activation, exact issuance time, or abuse.
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeTimestamp(value) {
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > MAX_CT_TIMESTAMP_LENGTH) return null;
  if (/[\x00-\x1f\x7f]/.test(value)) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

/**
 * Normalizes, deduplicates, sorts, and bounds a list of observed certificate
 * hostnames. Each hostname is validated with the project's canonical domain
 * normalization (rejecting control characters, whitespace, wildcards, and
 * non-LDH labels) and length-bounded before that.
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeHostnames(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  // Slice first so we iterate at most MAX_CT_INPUT_HOSTNAMES elements even if
  // the untrusted array is enormous.
  const input = value.length > MAX_CT_INPUT_HOSTNAMES ? value.slice(0, MAX_CT_INPUT_HOSTNAMES) : value;
  for (const raw of input) {
    if (typeof raw !== 'string' || raw.length > MAX_CT_HOSTNAME_LENGTH) continue;
    const host = normalizeDomain(raw);
    if (host) seen.add(host);
  }
  return [...seen].sort().slice(0, MAX_CT_HOSTNAMES);
}

/** The earlier of two ISO timestamps, treating null as "unknown". */
function earlier(a, b) {
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
}

/** The later of two ISO timestamps, treating null as "unknown". */
function later(a, b) {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

/**
 * @typedef {{ hostnames: string[], firstObservedAt: string | null, lastObservedAt: string | null, certificateCount: number }} CtProvenance
 */

/**
 * Validates an arbitrary value into a bounded CT provenance object, or null.
 * Unknown nested fields are discarded and malformed optional fields fall back
 * to empty/null rather than discarding the whole object. Returns null when the
 * input is not an object, or when nothing usable survives (so a caller can drop
 * the metadata without dropping an otherwise-valid candidate). Does not mutate
 * the input.
 * @param {unknown} raw
 * @returns {CtProvenance | null}
 */
export function normalizeCtProvenance(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const record = /** @type {Record<string, unknown>} */ (raw);
  const provenance = {
    hostnames: normalizeHostnames(record.hostnames),
    firstObservedAt: normalizeTimestamp(record.firstObservedAt),
    lastObservedAt: normalizeTimestamp(record.lastObservedAt),
    certificateCount: normalizeCount(record.certificateCount),
  };
  // A first observation later than the last one is contradictory; order them.
  if (
    provenance.firstObservedAt !== null &&
    provenance.lastObservedAt !== null &&
    provenance.firstObservedAt > provenance.lastObservedAt
  ) {
    const swap = provenance.firstObservedAt;
    provenance.firstObservedAt = provenance.lastObservedAt;
    provenance.lastObservedAt = swap;
  }
  if (
    provenance.hostnames.length === 0 &&
    provenance.firstObservedAt === null &&
    provenance.lastObservedAt === null &&
    provenance.certificateCount === 0
  ) {
    return null;
  }
  return provenance;
}

/**
 * Deterministically merges two CT provenance objects for the same canonical
 * domain: hostnames union (re-bounded), earliest valid first observation,
 * latest valid last observation, and the highest certificate count (never a
 * sum of duplicate representations of the same group).
 * @param {CtProvenance | null} a
 * @param {CtProvenance | null} b
 * @returns {CtProvenance | null}
 */
export function mergeCtProvenance(a, b) {
  if (!a) return b;
  if (!b) return a;
  return {
    hostnames: [...new Set([...a.hostnames, ...b.hostnames])].sort().slice(0, MAX_CT_HOSTNAMES),
    firstObservedAt: earlier(a.firstObservedAt, b.firstObservedAt),
    lastObservedAt: later(a.lastObservedAt, b.lastObservedAt),
    certificateCount: Math.max(a.certificateCount, b.certificateCount),
  };
}

/** Bounded source label; matches the handoff's own source bound. */
function boundedSource(label) {
  return typeof label === 'string' ? label.slice(0, MAX_CT_SOURCE_LENGTH) : '';
}

/**
 * Does a candidate match a free-text filter, searching both its canonical
 * domain and any observed CT hostnames? A pure helper so Discover's filter and
 * the tests share one definition. An empty filter matches everything.
 * @param {{ domain: string, certificateTransparency?: CtProvenance | null }} candidate
 * @param {string} filter
 * @returns {boolean}
 */
export function ctCandidateMatchesFilter(candidate, filter) {
  const needle = String(filter == null ? '' : filter).trim().toLowerCase();
  if (!needle) return true;
  if (candidate.domain.includes(needle)) return true;
  const hostnames = candidate.certificateTransparency ? candidate.certificateTransparency.hostnames : [];
  return hostnames.some((host) => host.includes(needle));
}

/**
 * Builds one deduplicated, sorted candidate per canonical registrable domain
 * from the structured `matches` array. Malformed match domains are skipped;
 * malformed optional metadata degrades gracefully. Duplicate domains merge
 * deterministically. Sorted newest-observation first, nulls last, then domain.
 */
function buildStructuredCandidates(matches, source) {
  // Slice first so processing is bounded regardless of the untrusted length.
  let truncated = matches.length > MAX_CT_INPUT_MATCHES;
  const input = truncated ? matches.slice(0, MAX_CT_INPUT_MATCHES) : matches;
  /** @type {Map<string, { domain: string, source: string, mutationTypes: string[], certificateTransparency: CtProvenance | null }>} */
  const byDomain = new Map();
  for (const match of input) {
    if (!match || typeof match !== 'object') continue;
    const domain = normalizeDomain(/** @type {Record<string, unknown>} */ (match).domain);
    if (!domain) continue;
    const rawHostnames = /** @type {Record<string, unknown>} */ (match).hostnames;
    if (Array.isArray(rawHostnames) && rawHostnames.length > MAX_CT_INPUT_HOSTNAMES) truncated = true;
    const provenance = normalizeCtProvenance(match);
    const existing = byDomain.get(domain);
    if (existing) {
      existing.certificateTransparency = mergeCtProvenance(existing.certificateTransparency, provenance);
    } else {
      byDomain.set(domain, {
        domain,
        source,
        mutationTypes: [CERTIFICATE_TRANSPARENCY_MUTATION],
        certificateTransparency: provenance,
      });
    }
  }
  const candidates = [...byDomain.values()];
  if (candidates.length > MAX_CT_CANDIDATES) truncated = true;
  candidates.sort((a, b) => {
    const aLast = a.certificateTransparency ? a.certificateTransparency.lastObservedAt : null;
    const bLast = b.certificateTransparency ? b.certificateTransparency.lastObservedAt : null;
    if (aLast && bLast) {
      if (aLast !== bLast) return bLast.localeCompare(aLast);
    } else if (aLast) {
      return -1;
    } else if (bLast) {
      return 1;
    }
    return a.domain.localeCompare(b.domain);
  });
  return { candidates: candidates.slice(0, MAX_CT_CANDIDATES), truncated };
}

/**
 * Preserves the legacy hostname-candidate behaviour for an older backend that
 * only returns the `domains` array. These hostnames are NOT canonical
 * registrable domains and carry no invented CT metadata - only the mutation
 * provenance token, deduplicated and lightly bounded.
 */
function buildLegacyCandidates(domains, source) {
  if (!Array.isArray(domains)) return { candidates: [], truncated: false };
  // Slice first so a huge invalid array cannot be scanned in full.
  let truncated = domains.length > MAX_CT_INPUT_DOMAINS;
  const input = truncated ? domains.slice(0, MAX_CT_INPUT_DOMAINS) : domains;
  const seen = new Set();
  const out = [];
  for (const raw of input) {
    if (typeof raw !== 'string' || raw.length > MAX_CT_HOSTNAME_LENGTH) continue;
    const domain = normalizeDomain(raw);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    out.push({ domain, source, mutationTypes: [CERTIFICATE_TRANSPARENCY_MUTATION] });
    if (out.length >= MAX_CT_CANDIDATES) {
      truncated = truncated || out.length < input.length;
      break;
    }
  }
  return { candidates: out, truncated };
}

/**
 * @typedef {{ candidates: Array<{ domain: string, source: string, mutationTypes: string[], certificateTransparency?: CtProvenance | null }>, usedStructuredMatches: boolean, certCount: number, truncated: boolean }} CtNormalizationResult
 */

/**
 * Normalizes the entire untrusted CT search response into a bounded, ordered
 * candidate set plus display metadata.
 *
 * When `matches` is present it is authoritative even if empty; a present-but-
 * non-array `matches` is a malformation and throws rather than silently
 * trusting it or falling back to legacy. When `matches` is absent, the legacy
 * `domains` array is used. Structured matches and legacy domains never mix.
 *
 * @param {unknown} response - the entire CT API response
 * @param {string} sourceLabel - bounded provenance label for each candidate
 * @returns {CtNormalizationResult}
 */
export function normalizeCtResponse(response, sourceLabel) {
  const source = boundedSource(sourceLabel);
  const res = response && typeof response === 'object' ? /** @type {Record<string, unknown>} */ (response) : {};
  const certCount = normalizeCount(res.certCount);
  const truncated = res.truncated === true;

  const hasMatches = Object.prototype.hasOwnProperty.call(res, 'matches') && res.matches !== undefined;
  if (hasMatches) {
    if (!Array.isArray(res.matches)) {
      throw new Error('Certificate Transparency results were malformed (expected a matches array).');
    }
    const built = buildStructuredCandidates(res.matches, source);
    return {
      candidates: built.candidates,
      usedStructuredMatches: true,
      certCount,
      truncated: truncated || built.truncated,
    };
  }

  const legacy = buildLegacyCandidates(res.domains, source);
  return {
    candidates: legacy.candidates,
    usedStructuredMatches: false,
    certCount,
    truncated: truncated || legacy.truncated,
  };
}
