// Only the source metadata needed to qualify an observed relationship crosses
// this boundary. Collection and retention times are never source-time fallbacks.
import { normalizeDomain } from '../cases/case-model.mts';
import { normalizeExplicitIsoTimestamp, readObservationEnvelope, type ObservationStatus } from '../evidence/observation.mts';

export const RELATIONSHIP_TYPES = Object.freeze([
  'nameserver_set', 'ip_address', 'certificate', 'tracking_identifier', 'favicon', 'official_asset',
] as const);
export type RelationshipType = typeof RELATIONSHIP_TYPES[number];
const SOURCES = ['dns', 'tls', 'http', 'page_identity', 'favicon', 'registration_or_dns', 'unknown'] as const;
type RelationshipSource = typeof SOURCES[number];
const SOURCES_BY_TYPE: Readonly<Record<RelationshipType, readonly RelationshipSource[]>> = {
  nameserver_set: ['dns', 'registration_or_dns'], ip_address: ['dns'], certificate: ['tls'],
  tracking_identifier: ['http', 'page_identity'], favicon: ['favicon'], official_asset: ['http'],
};
const STATUSES = ['success', 'partial', 'not_found', 'skipped', 'error', 'unsupported', 'not_applicable', 'unknown'] as const;
export const MAX_RELATIONSHIP_SOURCES_PER_DOMAIN = 3;
export const MAX_RELATIONSHIP_SOURCE_DOMAINS = 50;

export type RelationshipSourceEvidence = Readonly<{
  source: RelationshipSource;
  status: ObservationStatus | 'unknown';
  observedAt: string | null;
  complete: boolean;
  truncated: boolean | null;
}>;
export type RelationshipSourceProjection = Partial<Record<RelationshipType, readonly RelationshipSourceEvidence[]>>;
export type RelationshipContribution = RelationshipSourceEvidence & Readonly<{ domain: string }>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function unknownRelationshipSource(source: RelationshipSource = 'unknown'): RelationshipSourceEvidence {
  return { source, status: 'unknown', observedAt: null, complete: false, truncated: null };
}

export function relationshipSourceEvidence(source: RelationshipSource, raw: unknown): RelationshipSourceEvidence {
  const result = readObservationEnvelope(raw);
  if (result.state !== 'supported' || result.observation.source !== source) {
    return { ...unknownRelationshipSource(source), status: result.state === 'unsupported' ? 'unsupported' : 'unknown' };
  }
  return normalizeSource({ ...result.observation, truncated: record(raw).truncated });
}

function normalizeSource(raw: unknown, type?: RelationshipType): RelationshipSourceEvidence {
  const value = record(raw);
  const source = SOURCES.find((candidate) => candidate === value.source) ?? 'unknown';
  if (type && source !== 'unknown' && !SOURCES_BY_TYPE[type].includes(source)) return unknownRelationshipSource();
  const status = STATUSES.find((candidate) => candidate === value.status) ?? 'unknown';
  const observedAt = normalizeExplicitIsoTimestamp(value.observedAt);
  const truncated = typeof value.truncated === 'boolean' ? value.truncated : null;
  return {
    source, status, observedAt, truncated,
    complete: source !== 'unknown' && source !== 'registration_or_dns' && status === 'success'
      && value.complete === true && truncated === false && observedAt !== null,
  };
}

export function normalizeRelationshipSourceProjection(raw: unknown): RelationshipSourceProjection {
  const value = record(raw);
  const output: RelationshipSourceProjection = {};
  for (const type of RELATIONSHIP_TYPES) {
    if (!Array.isArray(value[type])) continue;
    const candidates = value[type] as unknown[];
    output[type] = candidates.slice(0, MAX_RELATIONSHIP_SOURCES_PER_DOMAIN).map((candidate) => {
      const source = normalizeSource(candidate, type);
      return candidates.length > MAX_RELATIONSHIP_SOURCES_PER_DOMAIN ? { ...source, complete: false, truncated: true } : source;
    });
  }
  return output;
}

/** Missing, malformed or omitted contributors cannot make a group complete. */
export function qualifyRelationshipSources(raw: unknown, rawDomains: readonly string[], options: Readonly<{ truncated?: boolean | undefined; type?: RelationshipType | undefined }> = {}): Readonly<{
  sourceEvidence: RelationshipContribution[];
  observedAt: string | null;
  complete: boolean;
  truncated: boolean;
}> {
  const domains = [...new Set(rawDomains.slice(0, MAX_RELATIONSHIP_SOURCE_DOMAINS * 2).map(normalizeDomain).filter(Boolean))].slice(0, MAX_RELATIONSHIP_SOURCE_DOMAINS);
  const allowed = new Set(domains);
  const candidates = Array.isArray(raw) ? raw : [];
  const maximum = MAX_RELATIONSHIP_SOURCE_DOMAINS * MAX_RELATIONSHIP_SOURCES_PER_DOMAIN;
  const byDomain = new Map<string, Map<string, RelationshipContribution>>();
  let omitted = options.truncated === true || rawDomains.length > MAX_RELATIONSHIP_SOURCE_DOMAINS || candidates.length > maximum;
  for (const candidate of candidates.slice(0, maximum)) {
    const value = record(candidate);
    const domain = normalizeDomain(value.domain);
    if (!domain || !allowed.has(domain)) { omitted = true; continue; }
    const contribution = { domain, ...normalizeSource(value, options.type) };
    const entries = byDomain.get(domain) ?? new Map<string, RelationshipContribution>();
    const key = JSON.stringify(contribution);
    if (!entries.has(key) && entries.size >= MAX_RELATIONSHIP_SOURCES_PER_DOMAIN) omitted = true;
    else entries.set(key, contribution);
    byDomain.set(domain, entries);
  }
  const sourceEvidence = domains.sort().flatMap((domain) => {
    const entries = byDomain.get(domain);
    return entries?.size ? [...entries.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      : [{ domain, ...unknownRelationshipSource() }];
  });
  const observedAt = sourceEvidence.length && sourceEvidence.every((entry) => entry.observedAt !== null)
    ? sourceEvidence.map((entry) => entry.observedAt as string).sort().at(-1) ?? null : null;
  return {
    sourceEvidence, observedAt,
    complete: sourceEvidence.length > 0 && !omitted && sourceEvidence.every((entry) => entry.complete),
    truncated: omitted || sourceEvidence.some((entry) => entry.truncated === true),
  };
}
