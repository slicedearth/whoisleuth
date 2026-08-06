// Framework-neutral, storage-agnostic core of the Discover -> Bulk candidate
// handoff. No sessionStorage, DOM, Svelte, or network access lives here so the
// full normalization contract is directly testable under Node.
// candidate-handoff.ts is a thin sessionStorage wrapper around buildHandoff /
// parseHandoff.

import { normalizeDomain } from './analysis/case-model.ts';
import { normalizeCtProvenance } from './analysis/ct-results.ts';
import type { CtProvenance } from './analysis/ct-results.ts';
import { MAX_CANDIDATE_SOURCE_LENGTH } from '../../../lib/candidate-provenance-bounds.mts';

export const HANDOFF_KEY = 'whoisleuth:candidate-handoff:v1';
export const HANDOFF_VERSION = 1;
export const MAX_HANDOFF_CANDIDATES = 2000;
export const MAX_GENERATED_CONTEXT = 5000;
export const MAX_MUTATION_TYPES = 30;
export const MAX_MUTATION_TYPE_LENGTH = 80;
export const MAX_SOURCE_LENGTH = MAX_CANDIDATE_SOURCE_LENGTH;
export const MAX_CANDIDATE_HANDOFF_SERIALIZED_BYTES = 4 * 1024 * 1024;

export const HANDOFF_SOURCES = [
  'typosquat',
  'keyword',
  'certificate-transparency',
  'nameserver',
  'watchlist',
  'manual',
] as const;

export type HandoffSource = typeof HANDOFF_SOURCES[number];

export type CertificateTransparencyProvenance = CtProvenance;

export type Candidate = {
  domain: string;
  source: string;
  mutationTypes: string[];
  certificateTransparency?: CertificateTransparencyProvenance | null;
};

export type CandidateHandoff = {
  version: typeof HANDOFF_VERSION;
  createdAt: string;
  source: HandoffSource;
  candidates: Candidate[];
  generatedCandidates?: Candidate[];
};

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function isHandoffSource(value: unknown): value is HandoffSource {
  return typeof value === 'string' && (HANDOFF_SOURCES as readonly string[]).includes(value);
}

/**
 * Normalizes one untrusted candidate. The domain is put through the project's
 * strict, canonical hostname normalization (the same one cases use): scheme/
 * path/port stripping, IDNA/punycode, LDH label validation, and rejection of
 * whitespace, control characters, IPs, and undotted names. A candidate whose
 * domain cannot be normalized is dropped (returns null). Optional CT provenance
 * is revalidated and bounded; malformed provenance is discarded without losing
 * the candidate.
 */
export function normalizeCandidate(value: unknown): Candidate | null {
  const record = plainRecord(value);
  const domain = normalizeDomain(record?.domain ?? '');
  if (!domain) return null;
  const rawTypes = Array.isArray(record?.mutationTypes)
    ? record.mutationTypes.slice(0, MAX_MUTATION_TYPES).map((item) => String(item).slice(0, MAX_MUTATION_TYPE_LENGTH))
    : [];
  const candidate: Candidate = {
    domain,
    source: String(record?.source || '').slice(0, MAX_SOURCE_LENGTH),
    mutationTypes: [...new Set(rawTypes)],
  };
  const ct = normalizeCtProvenance(record?.certificateTransparency);
  if (ct) candidate.certificateTransparency = ct;
  return candidate;
}

/**
 * Bounds the input array (slice caps processing, not just output) then
 * normalizes and drops malformed entries.
 */
export function normalizeCandidates(values: unknown, limit: number): Candidate[] {
  if (!Array.isArray(values)) return [];
  const out: Candidate[] = [];
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
 */
export function buildHandoff(
  source: HandoffSource,
  candidates: readonly unknown[],
  generatedCandidates?: readonly unknown[],
  createdAt?: string,
): CandidateHandoff {
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
 */
export function parseHandoff(parsed: unknown): CandidateHandoff | null {
  const value = plainRecord(parsed);
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

/** Applies a byte ceiling before parsing browser-controlled tab state. */
export function parseSerializedHandoff(serialized: unknown): CandidateHandoff | null {
  if (typeof serialized !== 'string' || !serialized) return null;
  if (serialized.length > MAX_CANDIDATE_HANDOFF_SERIALIZED_BYTES) return null;
  if (new TextEncoder().encode(serialized).byteLength > MAX_CANDIDATE_HANDOFF_SERIALIZED_BYTES) return null;
  try {
    return parseHandoff(JSON.parse(serialized));
  } catch {
    return null;
  }
}
