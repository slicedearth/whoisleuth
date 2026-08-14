// Framework-neutral, storage-agnostic core of the Discover -> Bulk candidate
// handoff. No sessionStorage, DOM, Svelte, or network access lives here so the
// full normalization contract is directly testable under Node.
// candidate-handoff.ts is a thin sessionStorage wrapper around buildHandoff /
// parseHandoff.

import { normalizeDomain } from './analysis/case-model.ts';
import { normalizeCtProvenance } from './analysis/ct-results.ts';
import type { CtProvenance } from './analysis/ct-results.ts';
import { MAX_CANDIDATE_SOURCE_LENGTH } from '../../../lib/candidate-provenance-bounds.mts';
import { normalizeExplicitIsoTimestamp } from '../../../lib/observation.mts';
import { parseBoundedJson } from './bounded-json.ts';

export const HANDOFF_KEY = 'whoisleuth:candidate-handoff:v2';
export const HANDOFF_VERSION = 2;
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

const DISCOVER_HANDOFF_SOURCES = new Set<HandoffSource>([
  'typosquat',
  'keyword',
  'certificate-transparency',
  'nameserver',
]);

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
  token: string;
  createdAt: string;
  source: HandoffSource;
  candidates: Candidate[];
  generatedCandidates?: Candidate[];
  generatedCandidateTotal?: number;
  generatedCandidatesTruncated?: boolean;
};

const HANDOFF_TOKEN_RE = /^[0-9a-f]{32}$/u;

export type SerializedCandidateHandoff = {
  handoff: CandidateHandoff;
  serialized: string;
};

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function isHandoffSource(value: unknown): value is HandoffSource {
  return typeof value === 'string' && (HANDOFF_SOURCES as readonly string[]).includes(value);
}

export function handoffMatchesNavigationSource(
  handoffSource: HandoffSource,
  navigationSource: string,
): boolean {
  return handoffSource === navigationSource
    || (navigationSource === 'discover' && DISCOVER_HANDOFF_SOURCES.has(handoffSource));
}

function handoffTimestamp(value: unknown): string | null {
  return normalizeExplicitIsoTimestamp(value);
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
  token?: string,
): CandidateHandoff {
  const timestamp = handoffTimestamp(createdAt ?? new Date().toISOString());
  if (!timestamp) throw new TypeError('Candidate handoff creation time must use an explicit timezone.');
  if (typeof token !== 'string' || !HANDOFF_TOKEN_RE.test(token)) {
    throw new TypeError('Candidate handoff token must be a 128-bit lower-case hexadecimal value.');
  }
  return {
    version: HANDOFF_VERSION,
    token,
    createdAt: timestamp,
    source,
    candidates: normalizeCandidates(candidates, MAX_HANDOFF_CANDIDATES),
    ...(generatedCandidates
      ? { generatedCandidates: normalizeCandidates(generatedCandidates, MAX_GENERATED_CONTEXT) }
      : {}),
  };
}

function serializeWithinHandoffLimit(handoff: CandidateHandoff): string | null {
  const serialized = JSON.stringify(handoff);
  return new TextEncoder().encode(serialized).byteLength <= MAX_CANDIDATE_HANDOFF_SERIALIZED_BYTES
    ? serialized
    : null;
}

/**
 * Produces a handoff that is guaranteed to survive the parser's byte ceiling.
 * Selected candidates are atomic: if they cannot fit, the save is refused
 * rather than silently dropping an analyst selection. Optional generated
 * coverage context is reduced deterministically from the tail and the
 * truncation is recorded in the envelope.
 */
export function serializeCandidateHandoff(
  source: HandoffSource,
  candidates: readonly unknown[],
  generatedCandidates?: readonly unknown[],
  createdAt?: string,
  token?: string,
): SerializedCandidateHandoff | null {
  const built = buildHandoff(source, candidates, generatedCandidates, createdAt, token);
  const generated = built.generatedCandidates;
  if (!generated?.length) {
    const serialized = serializeWithinHandoffLimit(built);
    return serialized ? { handoff: built, serialized } : null;
  }

  const fullSerialized = serializeWithinHandoffLimit(built);
  if (fullSerialized) return { handoff: built, serialized: fullSerialized };

  const base: CandidateHandoff = {
    version: built.version,
    token: built.token,
    createdAt: built.createdAt,
    source: built.source,
    candidates: built.candidates,
    generatedCandidateTotal: generated.length,
    generatedCandidatesTruncated: true,
  };
  if (!serializeWithinHandoffLimit({ ...base, generatedCandidates: [] })) return null;

  let lower = 0;
  let upper = generated.length;
  let best: SerializedCandidateHandoff | null = null;
  while (lower <= upper) {
    const count = Math.floor((lower + upper) / 2);
    const handoff: CandidateHandoff = {
      ...base,
      generatedCandidates: generated.slice(0, count),
    };
    const serialized = serializeWithinHandoffLimit(handoff);
    if (serialized) {
      best = { handoff, serialized };
      lower = count + 1;
    } else {
      upper = count - 1;
    }
  }
  return best;
}

/**
 * Validates and re-normalizes an already-parsed handoff value (e.g. from
 * sessionStorage). Returns null for anything that is not a current-version handoff
 * with a known source and a candidate array, so a malicious or corrupt store is
 * ignored rather than trusted. The opaque token binds the one-use browser
 * payload to the navigation that deliberately created it.
 */
export function parseHandoff(parsed: unknown): CandidateHandoff | null {
  const value = plainRecord(parsed);
  if (!value || value.version !== HANDOFF_VERSION || !Array.isArray(value.candidates) || !isHandoffSource(value.source)
    || typeof value.token !== 'string' || !HANDOFF_TOKEN_RE.test(value.token)) {
    return null;
  }
  const createdAt = handoffTimestamp(value.createdAt);
  if (!createdAt) return null;
  const generatedCandidates = value.generatedCandidates
    ? normalizeCandidates(value.generatedCandidates, MAX_GENERATED_CONTEXT)
    : undefined;
  const generatedCandidateTotal = Number.isSafeInteger(value.generatedCandidateTotal)
    ? Math.max(0, Math.min(MAX_GENERATED_CONTEXT, Number(value.generatedCandidateTotal)))
    : null;
  const generatedCandidatesTruncated = value.generatedCandidatesTruncated === true
    && generatedCandidateTotal !== null
    && generatedCandidateTotal >= (generatedCandidates?.length ?? 0);
  return {
    version: HANDOFF_VERSION,
    token: value.token,
    createdAt,
    source: value.source,
    candidates: normalizeCandidates(value.candidates, MAX_HANDOFF_CANDIDATES),
    ...(generatedCandidates ? { generatedCandidates } : {}),
    ...(generatedCandidatesTruncated
      ? { generatedCandidateTotal, generatedCandidatesTruncated: true }
      : {}),
  };
}

/** Applies a byte ceiling before parsing browser-controlled tab state. */
export function parseSerializedHandoff(serialized: unknown): CandidateHandoff | null {
  if (typeof serialized !== 'string' || !serialized) return null;
  if (serialized.length > MAX_CANDIDATE_HANDOFF_SERIALIZED_BYTES) return null;
  if (new TextEncoder().encode(serialized).byteLength > MAX_CANDIDATE_HANDOFF_SERIALIZED_BYTES) return null;
  try {
    return parseHandoff(parseBoundedJson(serialized, {
      label: 'Candidate handoff',
      maximumBytes: MAX_CANDIDATE_HANDOFF_SERIALIZED_BYTES,
    }));
  } catch {
    return null;
  }
}
