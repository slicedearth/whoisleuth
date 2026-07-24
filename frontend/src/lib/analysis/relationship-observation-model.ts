import { normalizeDomain } from './case-model.js';

export const RELATIONSHIP_OBSERVATION_SCHEMA = 'whoisleuth.relationship-observations';
export const RELATIONSHIP_OBSERVATION_SCHEMA_VERSION = 1;
export const MAX_RELATIONSHIP_OBSERVATIONS = 300;
export const MAX_RELATIONSHIP_OBSERVATION_INPUTS = 1_200;
export const MAX_RELATIONSHIP_OBSERVATION_DOMAINS = 50;
export const MAX_RELATIONSHIP_OBSERVATION_LIMITATIONS = 8;
export const MAX_RELATIONSHIP_OBSERVATION_VALUE_LENGTH = 20_000;
export const MAX_RELATIONSHIP_OBSERVATION_STORE_BYTES = 768 * 1024;

export const RELATIONSHIP_OBSERVATION_TYPES = Object.freeze([
  'nameserver_set',
  'ip_address',
  'certificate',
  'tracking_identifier',
  'favicon',
  'official_asset',
] as const);

export type RelationshipObservationType = typeof RELATIONSHIP_OBSERVATION_TYPES[number];

export interface RelationshipObservation {
  id: string;
  type: RelationshipObservationType;
  label: string;
  method: string;
  normalizedValue: string;
  displayValue: string;
  domains: string[];
  description: string;
  classification: 'derived';
  source: 'bulk_relationship_analysis';
  sourceVersion: number;
  observedAt: string;
  retainedAt: string;
  complete: boolean;
  truncated: boolean;
  limitations: string[];
}

export interface RelationshipObservationStore {
  version: typeof RELATIONSHIP_OBSERVATION_SCHEMA_VERSION;
  observations: RelationshipObservation[];
}

export interface RelationshipObservationInput {
  type?: unknown;
  label?: unknown;
  method?: unknown;
  normalizedValue?: unknown;
  value?: unknown;
  domains?: unknown;
  description?: unknown;
}

type UnknownRecord = Record<string, unknown>;

const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const SAFE_ID_RE = /^relationship-[a-z0-9]{1,16}-[a-z0-9]{1,16}$/u;
const SHA256_RE = /^[a-f0-9]{64}$/iu;
const DHASH_RE = /^[a-f0-9]{16}$/iu;
const TRACKING_IDENTIFIER_RE = /^[a-z-]{1,40}:[A-Z0-9-]{1,64}$/u;
const TYPES = new Set<string>(RELATIONSHIP_OBSERVATION_TYPES);
const TYPE_METADATA: Record<RelationshipObservationType, {
  label: string;
  method: string;
  description: string;
}> = Object.freeze({
  nameserver_set: Object.freeze({
    label: 'Shared nameserver set',
    method: 'Exact normalized set',
    description: 'These domains reported the same normalized nameserver set. Shared DNS providers are common.',
  }),
  ip_address: Object.freeze({
    label: 'Shared IP address',
    method: 'Exact normalized address',
    description: 'These domains resolved to the same IP address. Shared hosting, CDNs, and managed platforms are common.',
  }),
  certificate: Object.freeze({
    label: 'Shared TLS certificate',
    method: 'Exact leaf-certificate SHA-256',
    description: 'These domains presented the same leaf certificate. Multi-domain certificates, shared hosting, CDNs, and managed platforms are common.',
  }),
  tracking_identifier: Object.freeze({
    label: 'Shared tracking identifier',
    method: 'Exact public identifier',
    description: 'These pages exposed the same recognized public tracking identifier in bounded static HTML.',
  }),
  favicon: Object.freeze({
    label: 'Similar favicon',
    method: 'Exact SHA-256 or perceptual dHash distance ≤ 6',
    description: 'These domains used an identical or perceptually similar favicon in the retained scan.',
  }),
  official_asset: Object.freeze({
    label: 'Official asset relationship',
    method: 'Configured-domain host match',
    description: 'One or more pages loaded an asset from this configured official domain or its subdomain.',
  }),
});
const FIXED_LIMITATIONS = Object.freeze([
  'This is analyst-selected derived evidence from bounded Bulk observations, not a complete infrastructure history.',
  'A shared observation does not prove ownership, coordination, intent, or maliciousness.',
]);

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum * 4 || CONTROL_RE.test(value)) return '';
  return value.replace(/\s+/gu, ' ').trim().slice(0, maximum).trim();
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || value.length > 64 || CONTROL_RE.test(value)) return '';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 1_000
    ? value
    : null;
}

function hashString(value: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36);
}

function observationId(canonical: string): string {
  return `relationship-${hashString(canonical, 2166136261)}-${hashString(canonical, 3339675911)}`;
}

function normalizedDomains(value: unknown): string[] {
  const output = new Set<string>();
  const input = Array.isArray(value) ? value : [];
  for (const candidate of input.slice(0, MAX_RELATIONSHIP_OBSERVATION_DOMAINS * 4)) {
    const domain = normalizeDomain(candidate);
    if (domain) output.add(domain);
    if (output.size >= MAX_RELATIONSHIP_OBSERVATION_DOMAINS) break;
  }
  return [...output].sort();
}

function normalizedLimitations(value: unknown): string[] {
  const output = new Set<string>();
  const input = Array.isArray(value) ? value : [];
  for (const candidate of input.slice(0, MAX_RELATIONSHIP_OBSERVATION_LIMITATIONS * 4)) {
    const limitation = text(candidate, 400);
    if (limitation) output.add(limitation);
    if (output.size >= MAX_RELATIONSHIP_OBSERVATION_LIMITATIONS) break;
  }
  return [...output];
}

function ipv4(value: string): string {
  const parts = value.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/u.test(part) || Number(part) > 255)) return '';
  return parts.map((part) => String(Number(part))).join('.');
}

function ipv6(value: string): string {
  if (!value.includes(':') || value.length > 45 || !/^[0-9a-f:.]+$/iu.test(value)) return '';
  try {
    const hostname = new URL(`http://[${value}]/`).hostname.toLowerCase();
    return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : '';
  } catch {
    return '';
  }
}

function normalizedNameserverSet(value: string): string {
  const candidates = value.split(/\s*·\s*/u);
  if (!candidates.length || candidates.length > 80) return '';
  const nameservers = new Set<string>();
  for (const candidate of candidates) {
    const hostname = normalizeDomain(candidate.replace(/\.$/u, ''));
    if (!hostname) return '';
    nameservers.add(hostname);
    if (nameservers.size > 20) return '';
  }
  return [...nameservers].sort().join(' · ');
}

function normalizedFaviconEvidence(value: string, domains: readonly string[]): string {
  const allowedDomains = new Set(domains);
  const byDomain = new Map<string, string[]>();
  for (const entry of value.split('|').slice(0, MAX_RELATIONSHIP_OBSERVATION_DOMAINS * 4)) {
    const separator = entry.indexOf('=');
    if (separator < 1) return '';
    const domain = normalizeDomain(entry.slice(0, separator));
    if (!domain || !allowedDomains.has(domain) || byDomain.has(domain)) return '';
    const evidence = new Set<string>();
    for (const token of entry.slice(separator + 1).split(',').slice(0, 4)) {
      const [kind, digest, ...extra] = token.split(':');
      if (extra.length || !digest) return '';
      if (kind === 'sha256' && SHA256_RE.test(digest)) evidence.add(`sha256:${digest.toLowerCase()}`);
      else if (kind === 'dhash' && DHASH_RE.test(digest)) evidence.add(`dhash:${digest.toLowerCase()}`);
      else return '';
    }
    if (!evidence.size) return '';
    byDomain.set(domain, [...evidence].sort());
  }
  if (byDomain.size !== allowedDomains.size) return '';
  return [...byDomain.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([domain, evidence]) => `${domain}=${evidence.join(',')}`)
    .join('|');
}

function normalizedRelationshipValue(
  type: RelationshipObservationType,
  raw: unknown,
  domains: readonly string[],
): string {
  const value = text(raw, MAX_RELATIONSHIP_OBSERVATION_VALUE_LENGTH);
  if (!value) return '';
  if (type === 'nameserver_set') return normalizedNameserverSet(value);
  if (type === 'ip_address') return ipv4(value) || ipv6(value);
  if (type === 'certificate') return SHA256_RE.test(value) ? value.toLowerCase() : '';
  if (type === 'tracking_identifier') return TRACKING_IDENTIFIER_RE.test(value) ? value : '';
  if (type === 'official_asset') return normalizeDomain(value.replace(/\.$/u, ''));
  return normalizedFaviconEvidence(value, domains);
}

function observationLimitations(value: unknown): string[] {
  return normalizedLimitations([...FIXED_LIMITATIONS, ...(Array.isArray(value) ? value : [])]);
}

function canonicalIdentity(
  type: RelationshipObservationType,
  normalizedValue: string,
  domains: readonly string[],
): string {
  return `${type}\u0000${normalizedValue}\u0000${domains.join('\u0000')}`;
}

export function relationshipObservationId(raw: RelationshipObservationInput): string {
  const type = typeof raw.type === 'string' && TYPES.has(raw.type)
    ? raw.type as RelationshipObservationType
    : null;
  const domains = normalizedDomains(raw.domains);
  const normalizedValue = type
    ? normalizedRelationshipValue(type, raw.normalizedValue ?? raw.value, domains)
    : '';
  return type && domains.length && normalizedValue
    ? observationId(canonicalIdentity(type, normalizedValue, domains))
    : '';
}

export function relationshipObservationStoreVersion(raw: unknown): number | null {
  const value = record(raw);
  return positiveInteger(value?.version);
}

function observationList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const value = record(raw);
  return Array.isArray(value?.observations) ? value.observations : [];
}

export function normalizeRelationshipObservation(raw: unknown): RelationshipObservation | null {
  const value = record(raw);
  if (!value || typeof value.type !== 'string' || !TYPES.has(value.type)) return null;
  const type = value.type as RelationshipObservationType;
  const domains = normalizedDomains(value.domains);
  const normalizedValue = normalizedRelationshipValue(type, value.normalizedValue, domains);
  if (domains.length < 1 || !normalizedValue) return null;
  const metadata = TYPE_METADATA[type];
  const canonical = canonicalIdentity(type, normalizedValue, domains);
  // Imported identifiers are untrusted. Re-derive the identity from the
  // normalized relationship value and members so an archive cannot alias one
  // observation onto a different pivot.
  const id = observationId(canonical);
  const observedAt = timestamp(value.observedAt);
  const retainedAt = timestamp(value.retainedAt);
  if (!observedAt || !retainedAt) return null;
  return {
    id,
    type,
    label: metadata.label,
    method: metadata.method,
    normalizedValue,
    displayValue: type === 'favicon' ? '' : normalizedValue,
    domains,
    description: metadata.description,
    classification: 'derived',
    source: 'bulk_relationship_analysis',
    sourceVersion: positiveInteger(value.sourceVersion) || 1,
    observedAt,
    retainedAt,
    complete: value.complete === true,
    truncated: value.truncated === true
      || (Array.isArray(value.domains) && value.domains.length > MAX_RELATIONSHIP_OBSERVATION_DOMAINS),
    limitations: observationLimitations(value.limitations),
  };
}

export function normalizeRelationshipObservationStore(raw: unknown): RelationshipObservationStore {
  const byId = new Map<string, RelationshipObservation>();
  for (const candidate of observationList(raw).slice(0, MAX_RELATIONSHIP_OBSERVATION_INPUTS)) {
    const observation = normalizeRelationshipObservation(candidate);
    if (!observation) continue;
    const existing = byId.get(observation.id);
    if (!existing || observation.retainedAt > existing.retainedAt) byId.set(observation.id, observation);
  }
  return {
    version: RELATIONSHIP_OBSERVATION_SCHEMA_VERSION,
    observations: [...byId.values()]
      .sort((left, right) => right.retainedAt.localeCompare(left.retainedAt) || left.id.localeCompare(right.id))
      .slice(0, MAX_RELATIONSHIP_OBSERVATIONS),
  };
}

export function createRelationshipObservation(
  raw: RelationshipObservationInput,
  options: {
    observedAt?: unknown;
    retainedAt?: unknown;
    complete?: unknown;
    truncated?: unknown;
    limitations?: unknown;
    sourceVersion?: unknown;
  } = {},
): RelationshipObservation {
  const type = typeof raw.type === 'string' && TYPES.has(raw.type)
    ? raw.type as RelationshipObservationType
    : null;
  const domains = normalizedDomains(raw.domains);
  const normalizedValue = type
    ? normalizedRelationshipValue(type, raw.normalizedValue ?? raw.value, domains)
    : '';
  if (!type || domains.length < 1 || !normalizedValue) {
    throw new Error('That relationship does not contain a supported bounded value and at least one valid domain.');
  }
  const now = new Date().toISOString();
  const observedAt = timestamp(options.observedAt) || now;
  const retainedAt = timestamp(options.retainedAt) || now;
  const canonical = canonicalIdentity(type, normalizedValue, domains);
  const metadata = TYPE_METADATA[type];
  return {
    id: observationId(canonical),
    type,
    label: metadata.label,
    method: metadata.method,
    normalizedValue,
    displayValue: type === 'favicon' ? '' : normalizedValue,
    domains,
    description: metadata.description,
    classification: 'derived',
    source: 'bulk_relationship_analysis',
    sourceVersion: positiveInteger(options.sourceVersion) || 1,
    observedAt,
    retainedAt,
    complete: options.complete === true,
    truncated: options.truncated === true
      || (Array.isArray(raw.domains) && raw.domains.length > MAX_RELATIONSHIP_OBSERVATION_DOMAINS),
    limitations: observationLimitations(options.limitations),
  };
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function serializeRelationshipObservationStore(raw: unknown): string {
  const normalized = normalizeRelationshipObservationStore(raw);
  const serialized = JSON.stringify({
    schema: RELATIONSHIP_OBSERVATION_SCHEMA,
    version: RELATIONSHIP_OBSERVATION_SCHEMA_VERSION,
    observations: normalized.observations,
  });
  if (byteLength(serialized) > MAX_RELATIONSHIP_OBSERVATION_STORE_BYTES) {
    throw new Error('Retained relationship observations exceed the 768 KiB browser-storage limit. Delete or export older observations first.');
  }
  return serialized;
}

export function upsertRelationshipObservation(
  rawStore: unknown,
  observationRaw: unknown,
): { observations: RelationshipObservation[]; record: RelationshipObservation; added: boolean; pruned: number } {
  const observation = normalizeRelationshipObservation(observationRaw);
  if (!observation) throw new Error('That retained relationship observation is malformed.');
  const current = normalizeRelationshipObservationStore(rawStore).observations;
  const added = !current.some((item) => item.id === observation.id);
  const merged = [observation, ...current.filter((item) => item.id !== observation.id)];
  const normalized = normalizeRelationshipObservationStore(merged).observations;
  let pruned = Math.max(0, merged.length - normalized.length);
  let bounded = normalized;
  while (bounded.length) {
    try {
      serializeRelationshipObservationStore(bounded);
      break;
    } catch {
      bounded = bounded.slice(0, -1);
      pruned += 1;
    }
  }
  if (!bounded.some((item) => item.id === observation.id)) {
    throw new Error('That relationship observation is too large for the bounded browser store.');
  }
  return { observations: bounded, record: observation, added, pruned };
}

export function deleteRelationshipObservation(rawStore: unknown, id: unknown): RelationshipObservation[] {
  const safeId = typeof id === 'string' && SAFE_ID_RE.test(id) ? id : '';
  if (!safeId) throw new Error('That retained relationship observation is invalid.');
  return normalizeRelationshipObservationStore(rawStore).observations.filter((item) => item.id !== safeId);
}

export function mergeRelationshipObservations(
  localRaw: unknown,
  importedRaw: unknown,
): { observations: RelationshipObservation[]; added: number; updated: number; skipped: number; pruned: number } {
  const importedRecord = record(importedRaw);
  if (importedRecord?.schema !== undefined && importedRecord.schema !== RELATIONSHIP_OBSERVATION_SCHEMA) {
    throw new Error('This JSON section is not a WHOISleuth relationship-observation export.');
  }
  const importedVersion = relationshipObservationStoreVersion(importedRaw);
  if (importedVersion !== null && importedVersion > RELATIONSHIP_OBSERVATION_SCHEMA_VERSION) {
    throw new Error(`This relationship-observation section uses newer schema ${importedVersion}. Update the app before importing it.`);
  }
  const local = normalizeRelationshipObservationStore(localRaw).observations;
  const importedInput = observationList(importedRaw);
  const byId = new Map(local.map((item) => [item.id, item]));
  let added = 0;
  let updated = 0;
  let skipped = Math.max(0, importedInput.length - MAX_RELATIONSHIP_OBSERVATION_INPUTS);
  for (const candidate of importedInput.slice(0, MAX_RELATIONSHIP_OBSERVATION_INPUTS)) {
    const observation = normalizeRelationshipObservation(candidate);
    if (!observation) { skipped += 1; continue; }
    const existing = byId.get(observation.id);
    if (existing && existing.retainedAt >= observation.retainedAt) {
      skipped += 1;
      continue;
    }
    if (existing) updated += 1;
    else added += 1;
    byId.set(observation.id, observation);
  }
  const mergedInput = [...byId.values()];
  const normalized = normalizeRelationshipObservationStore(mergedInput).observations;
  let pruned = Math.max(0, mergedInput.length - normalized.length);
  let bounded = normalized;
  while (bounded.length) {
    try {
      serializeRelationshipObservationStore(bounded);
      break;
    } catch {
      bounded = bounded.slice(0, -1);
      pruned += 1;
    }
  }
  return { observations: bounded, added, updated, skipped, pruned };
}

export function buildRelationshipObservationExport(
  raw: unknown,
  generatedAt = new Date().toISOString(),
): UnknownRecord {
  const normalized = normalizeRelationshipObservationStore(raw);
  return {
    schema: RELATIONSHIP_OBSERVATION_SCHEMA,
    version: RELATIONSHIP_OBSERVATION_SCHEMA_VERSION,
    generatedAt: timestamp(generatedAt) || new Date().toISOString(),
    observations: normalized.observations,
    limitations: [
      'These are analyst-selected derived pivots, not proof of ownership, coordination, intent, or maliciousness.',
      'The export excludes the originating raw lookup responses and complete Bulk scan.',
    ],
  };
}
