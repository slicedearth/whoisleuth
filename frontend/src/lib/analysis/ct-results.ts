// Framework-neutral normalization of the Certificate Transparency search API
// response (see lib/ct-search.mts for the backend contract). No DOM, Svelte,
// IndexedDB, sessionStorage, or network access lives here so the module is
// node --test-able and safe to import from both the Discover route and the
// candidate-handoff serializer.
//
// The response is treated as untrusted even though it comes from the project's
// own backend: every field is revalidated, bounded, and rebuilt into fresh
// objects. Prompt 5A already resolves each match's canonical registrable
// domain via the public-suffix list on the server, so this module never
// re-derives registrable domains in the browser - it only normalizes and
// bounds what the server sent.

import { normalizeDomain } from './case-model.ts';
import { MAX_CANDIDATE_SOURCE_LENGTH } from '../../../../lib/candidate-provenance-bounds.mts';
import {
  MAX_CT_RESPONSE_CERTIFICATE_GROUPS,
  MAX_CT_RESPONSE_DOMAINS_PER_GROUP,
  MAX_CT_RESPONSE_HOSTNAMES_PER_GROUP,
  MAX_CT_RESPONSE_HOSTNAMES_PER_MATCH,
  MAX_CT_RESPONSE_RESULTS,
  MAX_CT_RESPONSE_TIMESTAMP_LENGTH,
} from '../../../../lib/ct-response-bounds.mts';

// The stable mutation/source token every CT-derived candidate carries so Bulk,
// coverage, and the handoff can recognise its provenance.
export const CERTIFICATE_TRANSPARENCY_MUTATION = 'certificate_transparency';

// Shared response bounds come from the backend contract so a
// well-formed response is never clipped, while a hostile or malformed one can
// never impose unbounded work or storage.
export const MAX_CT_CANDIDATES = MAX_CT_RESPONSE_RESULTS;
export const MAX_CT_HOSTNAMES = MAX_CT_RESPONSE_HOSTNAMES_PER_MATCH;
export const MAX_CT_HOSTNAME_LENGTH = 253; // a DNS name can never exceed this
export const MAX_CT_TIMESTAMP_LENGTH = MAX_CT_RESPONSE_TIMESTAMP_LENGTH;
export const MAX_CT_CERTIFICATE_COUNT = 1_000_000; // clamp for the deduped count
export const MAX_CT_SOURCE_LENGTH = MAX_CANDIDATE_SOURCE_LENGTH;
export const MAX_CT_CERTIFICATE_GROUPS = MAX_CT_RESPONSE_CERTIFICATE_GROUPS;
export const MAX_CT_GROUP_DOMAINS = MAX_CT_RESPONSE_DOMAINS_PER_GROUP;
export const MAX_CT_GROUP_HOSTNAMES = MAX_CT_RESPONSE_HOSTNAMES_PER_GROUP;
export const MAX_CT_GROUP_INPUT_ITEMS = 500;

// Input-processing caps. A well-formed backend response stays far below these
// (matches <= 500, hostnames <= 50 per match), but the response is untrusted:
// these bound how many array elements we ever *iterate*, not just how many we
// keep, so a hostile or buggy payload can never impose O(millions) of work.
// Set above the output bounds so legitimate de-duplication is never starved.
export const MAX_CT_INPUT_MATCHES = 2000;
export const MAX_CT_INPUT_HOSTNAMES = 500;

export type CtProvenance = {
  hostnames: string[];
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  certificateCount: number;
};

export type CtCandidate = {
  domain: string;
  source: string;
  mutationTypes: string[];
  certificateTransparency: CtProvenance | null;
};

export type CtCertificateGroup = {
  certificateKey: string;
  domains: string[];
  hostnames: string[];
  observedAt: string | null;
  wildcardObserved: boolean;
};

export type CtNormalizationResult = {
  candidates: CtCandidate[];
  certificateGroups: CtCertificateGroup[];
  certificateGroupsTruncated: boolean;
  certCount: number;
  truncated: boolean;
};

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * A canonical, bounded certificate-count. Accepts only finite non-negative
 * numbers, floors and clamps them; anything else becomes 0.
 */
function normalizeCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.floor(value), MAX_CT_CERTIFICATE_COUNT);
}

/**
 * Validates a CT observation timestamp. Only bounded, control-character-free
 * strings that parse to a finite instant are accepted; the result is
 * canonicalised to an ISO-8601 string so ordering and de-duplication are
 * deterministic. CT observation timestamps are public-log provenance - they do
 * not prove registration, site activation, exact issuance time, or abuse.
 */
function normalizeTimestamp(value: unknown): string | null {
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
 */
function normalizeHostnames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
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
function earlier(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
}

/** The later of two ISO timestamps, treating null as "unknown". */
function later(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

/**
 * Validates an arbitrary value into a bounded CT provenance object, or null.
 * Unknown nested fields are discarded and malformed optional fields fall back
 * to empty/null rather than discarding the whole object. Returns null when the
 * input is not an object, or when nothing usable survives (so a caller can drop
 * the metadata without dropping an otherwise-valid candidate). Does not mutate
 * the input.
 */
export function normalizeCtProvenance(raw: unknown): CtProvenance | null {
  const record = plainRecord(raw);
  if (!record) return null;
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
 */
export function mergeCtProvenance(
  a: CtProvenance | null,
  b: CtProvenance | null,
): CtProvenance | null {
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
function boundedSource(label: unknown): string {
  return typeof label === 'string' ? label.slice(0, MAX_CT_SOURCE_LENGTH) : '';
}

function normalizeCertificateKey(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 180) return null;
  const normalized = value.trim().toLowerCase();
  return /^(?:id:[0-9]{1,32}|issuer-serial:[0-9]{1,32}:[0-9a-f]{1,128}|row:[0-9]{1,8})$/u.test(normalized)
    ? normalized
    : null;
}

function normalizeDomainList(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value)) return [];
  const output = new Set<string>();
  for (const item of value.slice(0, MAX_CT_INPUT_HOSTNAMES)) {
    if (typeof item !== 'string' || item.length > MAX_CT_HOSTNAME_LENGTH) continue;
    const normalized = normalizeDomain(item);
    if (normalized) output.add(normalized);
    if (output.size >= maximum) break;
  }
  return [...output].sort();
}

function normalizeCertificateGroups(value: unknown): { groups: CtCertificateGroup[]; truncated: boolean } {
  if (!Array.isArray(value)) return { groups: [], truncated: false };
  let truncated = value.length > MAX_CT_GROUP_INPUT_ITEMS;
  const output = new Map<string, CtCertificateGroup>();
  for (const item of value.slice(0, MAX_CT_GROUP_INPUT_ITEMS)) {
    const group = plainRecord(item);
    if (!group) continue;
    const certificateKey = normalizeCertificateKey(group.certificateKey);
    if (!certificateKey || output.has(certificateKey)) continue;
    if (Array.isArray(group.domains) && group.domains.length > MAX_CT_GROUP_DOMAINS) truncated = true;
    if (Array.isArray(group.hostnames) && group.hostnames.length > MAX_CT_GROUP_HOSTNAMES) truncated = true;
    const domains = normalizeDomainList(group.domains, MAX_CT_GROUP_DOMAINS);
    const hostnames = normalizeHostnames(group.hostnames).slice(0, MAX_CT_GROUP_HOSTNAMES);
    if (!domains.length) continue;
    output.set(certificateKey, {
      certificateKey,
      domains,
      hostnames,
      observedAt: normalizeTimestamp(group.observedAt),
      wildcardObserved: group.wildcardObserved === true,
    });
    if (output.size >= MAX_CT_CERTIFICATE_GROUPS) {
      if (value.length > output.size) truncated = true;
      break;
    }
  }
  return { groups: [...output.values()], truncated };
}

/**
 * Does a candidate match a free-text filter, searching both its canonical
 * domain and any observed CT hostnames? A pure helper so Discover's filter and
 * the tests share one definition. An empty filter matches everything.
 */
export function ctCandidateMatchesFilter(
  candidate: Pick<CtCandidate, 'domain'> & { certificateTransparency?: CtProvenance | null },
  filter: unknown,
): boolean {
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
function buildStructuredCandidates(
  matches: unknown[],
  source: string,
): { candidates: CtCandidate[]; truncated: boolean } {
  // Slice first so processing is bounded regardless of the untrusted length.
  let truncated = matches.length > MAX_CT_INPUT_MATCHES;
  const input = truncated ? matches.slice(0, MAX_CT_INPUT_MATCHES) : matches;
  const byDomain = new Map<string, CtCandidate>();
  for (const match of input) {
    const record = plainRecord(match);
    if (!record) continue;
    const domain = normalizeDomain(record.domain);
    if (!domain) continue;
    const rawHostnames = record.hostnames;
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
 * Normalizes the entire untrusted CT search response into a bounded, ordered
 * candidate set plus display metadata.
 *
 * `matches` is required and authoritative even when empty. A missing or
 * non-array value is a malformed current response and fails explicitly.
 *
 */
export function normalizeCtResponse(response: unknown, sourceLabel: unknown): CtNormalizationResult {
  const source = boundedSource(sourceLabel);
  const res = plainRecord(response) || {};
  const certCount = normalizeCount(res.certCount);
  const truncated = res.truncated === true;

  if (!Array.isArray(res.matches)) {
    throw new Error('Certificate Transparency results were malformed (expected a matches array).');
  }
  const built = buildStructuredCandidates(res.matches, source);
  const certificateGroups = normalizeCertificateGroups(res.certificateGroups);
  return {
    candidates: built.candidates,
    certificateGroups: certificateGroups.groups,
    certificateGroupsTruncated: res.certificateGroupsTruncated === true || certificateGroups.truncated,
    certCount,
    truncated: truncated || built.truncated,
  };
}
