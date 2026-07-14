// Framework-neutral, storage-agnostic core of the Discover -> Bulk candidate
// handoff. No sessionStorage, DOM, Svelte, or network access lives here so the
// full normalization contract is directly testable under Node.
// candidate-handoff.ts is a thin sessionStorage wrapper around buildHandoff /
// parseHandoff.

import { normalizeDomain } from './analysis/case-model.js';
import { normalizeCtProvenance } from './analysis/ct-results.js';

export const HANDOFF_KEY = 'whoisleuth:candidate-handoff:v1';
export const HANDOFF_VERSION = 1;
export const MAX_HANDOFF_CANDIDATES = 2000;
export const MAX_GENERATED_CONTEXT = 5000;
export const MAX_MUTATION_TYPES = 30;
export const MAX_MUTATION_TYPE_LENGTH = 80;
export const MAX_SOURCE_LENGTH = 253;

export const HANDOFF_SOURCES = ['typosquat', 'keyword', 'certificate-transparency', 'watchlist', 'manual'];

/** @param {unknown} value */
export function isHandoffSource(value) {
  return HANDOFF_SOURCES.includes(/** @type {string} */ (value));
}

/**
 * Normalizes one untrusted candidate. The domain is put through the project's
 * strict, canonical hostname normalization (the same one cases use): scheme/
 * path/port stripping, IDNA/punycode, LDH label validation, and rejection of
 * whitespace, control characters, IPs, and undotted names. A candidate whose
 * domain cannot be normalized is dropped (returns null). Optional CT provenance
 * is revalidated and bounded; malformed provenance is discarded without losing
 * the candidate.
 * @param {any} value
 * @returns {{ domain: string, source: string, mutationTypes: string[], certificateTransparency?: object } | null}
 */
export function normalizeCandidate(value) {
  const domain = normalizeDomain(value == null ? '' : value.domain);
  if (!domain) return null;
  const rawTypes = Array.isArray(value?.mutationTypes)
    ? value.mutationTypes.slice(0, MAX_MUTATION_TYPES).map((item) => String(item).slice(0, MAX_MUTATION_TYPE_LENGTH))
    : [];
  const candidate = {
    domain,
    source: String(value?.source || '').slice(0, MAX_SOURCE_LENGTH),
    mutationTypes: [...new Set(rawTypes)],
  };
  const ct = normalizeCtProvenance(value?.certificateTransparency);
  if (ct) candidate.certificateTransparency = ct;
  return candidate;
}

/**
 * Bounds the input array (slice caps processing, not just output) then
 * normalizes and drops malformed entries.
 * @param {unknown} values
 * @param {number} limit
 */
export function normalizeCandidates(values, limit) {
  if (!Array.isArray(values)) return [];
  const out = [];
  for (const value of values.slice(0, limit)) {
    const candidate = normalizeCandidate(value);
    if (candidate) out.push(candidate);
  }
  return out;
}

/**
 * Builds the serializable handoff envelope from live candidates. Pure - the
 * caller persists the returned object. `createdAt` is injected so this stays
 * deterministic and testable.
 * @param {string} source
 * @param {Array<object>} candidates
 * @param {Array<object>} [generatedCandidates]
 * @param {string} [createdAt]
 */
export function buildHandoff(source, candidates, generatedCandidates, createdAt) {
  return {
    version: HANDOFF_VERSION,
    createdAt: createdAt || new Date().toISOString(),
    source,
    candidates: normalizeCandidates(candidates, MAX_HANDOFF_CANDIDATES),
    ...(generatedCandidates
      ? { generatedCandidates: normalizeCandidates(generatedCandidates, MAX_GENERATED_CONTEXT) }
      : {}),
  };
}

/**
 * Validates and re-normalizes an already-parsed handoff value (e.g. from
 * sessionStorage). Returns null for anything that is not a version-1 handoff
 * with a known source and a candidate array, so a malicious or corrupt store is
 * ignored rather than trusted.
 * @param {unknown} parsed
 */
export function parseHandoff(parsed) {
  const value = /** @type {any} */ (parsed);
  if (!value || value.version !== HANDOFF_VERSION || !Array.isArray(value.candidates) || !isHandoffSource(value.source)) {
    return null;
  }
  return {
    version: HANDOFF_VERSION,
    createdAt: String(value.createdAt || ''),
    source: value.source,
    candidates: normalizeCandidates(value.candidates, MAX_HANDOFF_CANDIDATES),
    ...(value.generatedCandidates
      ? { generatedCandidates: normalizeCandidates(value.generatedCandidates, MAX_GENERATED_CONTEXT) }
      : {}),
  };
}
