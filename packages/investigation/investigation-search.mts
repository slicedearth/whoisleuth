// Pure, bounded search and pivot navigation over investigation projection v1.
// This module does not read browser storage, make network requests, or infer
// absence from a missing result. It indexes only known projection fields.

import {
  INVESTIGATION_OBSERVATION_KINDS,
  type InvestigationEntityType,
  type InvestigationObservationKind,
  type InvestigationSourceState,
  type InvestigationStoreName,
} from './investigation-projection.mts';
import { readBoundedInvestigationProjection } from './investigation-projection-reader.mts';
import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';
import { MAX_CASE_OBJECTIVE_LENGTH } from '../contracts/case-portability.mts';
import {
  INVESTIGATION_SEARCH_SCHEMA,
  INVESTIGATION_SEARCH_VERSION,
} from '../contracts/investigation-projections.mts';

export {
  INVESTIGATION_SEARCH_SCHEMA,
  INVESTIGATION_SEARCH_VERSION,
} from '../contracts/investigation-projections.mts';

export const MAX_INVESTIGATION_SEARCH_QUERY_LENGTH = 200;
export const MAX_INVESTIGATION_SEARCH_TOKENS = 8;
export const MAX_INVESTIGATION_SEARCH_RESULTS = 50;
export const MAX_INVESTIGATION_SEARCH_ENTITIES = 6000;
export const MAX_INVESTIGATION_SEARCH_TERMS_PER_ENTITY = 32;
export const MAX_INVESTIGATION_SEARCH_TERMS = MAX_INVESTIGATION_SEARCH_ENTITIES * MAX_INVESTIGATION_SEARCH_TERMS_PER_ENTITY;
export const MAX_INVESTIGATION_SEARCH_TERM_BYTES = 8 * 1024 * 1024;
export const MAX_INVESTIGATION_SEARCH_LIMITATIONS = 20;
export const MAX_RECENT_INVESTIGATION_RESULTS = 6;

export type InvestigationSearchIndexState = 'ready' | 'invalid' | 'unsupported';
export type InvestigationSearchState = 'idle' | 'invalid' | 'no_matches' | 'results';
export type InvestigationSearchSourceState = InvestigationSourceState | 'unavailable';
export type InvestigationSearchField = 'canonical' | 'label' | 'domain' | 'name' | 'nameserver' | 'origin' | 'sha256' | 'ip' | 'identifier' | 'value';

export interface InvestigationSearchSourceSummary {
  state: InvestigationSearchSourceState;
  version: number | null;
  records: number;
  truncated: boolean;
}

export interface InvestigationSearchTerm {
  field: InvestigationSearchField;
  value: string;
  normalized: string;
}

export interface InvestigationSearchEntry {
  entityId: string;
  entityType: InvestigationEntityType;
  label: string;
  canonical: string;
  terms: InvestigationSearchTerm[];
  termsTruncated: boolean;
  sourceStore: InvestigationStoreName;
  source: string;
  classification: 'derived' | 'normalized' | null;
  observedAt: string;
  complete: boolean | null;
  truncated: boolean | null;
  limitations: string[];
  href: string;
  action: string;
}

export interface InvestigationSearchIndex {
  schema: typeof INVESTIGATION_SEARCH_SCHEMA;
  version: typeof INVESTIGATION_SEARCH_VERSION;
  state: InvestigationSearchIndexState;
  generatedAt: string | null;
  projectionVersion: number | null;
  sources: Record<InvestigationStoreName, InvestigationSearchSourceSummary>;
  entries: InvestigationSearchEntry[];
  entityCount: number;
  termCount: number;
  truncated: boolean;
  limitations: string[];
}

export interface InvestigationSearchResult extends Omit<InvestigationSearchEntry, 'terms' | 'termsTruncated'> {
  matchedField: InvestigationSearchField;
  matchedValue: string;
  score: number;
}

export interface InvestigationSearchResponse {
  state: InvestigationSearchState;
  query: string;
  results: InvestigationSearchResult[];
  totalMatches: number;
  truncated: boolean;
  detail: string;
}

type UnknownRecord = Record<string, unknown>;

interface IndexedObservation {
  id: string;
  kind: InvestigationObservationKind;
  store: InvestigationStoreName;
  recordId: string;
  source: string;
  observedAt: string;
  complete: boolean | null;
  truncated: boolean | null;
  limitations: string[];
}

interface IndexedEntity {
  id: string;
  type: InvestigationEntityType;
  canonical: string;
  label: string;
  properties: UnknownRecord;
  observationIds: string[];
  observationsTruncated: boolean;
}

const CONTROL_RE = /[\x00-\x1f\x7f]/;
const ENTITY_TYPES = new Set<InvestigationEntityType>([
  'domain',
  'nameserver_set',
  'http_origin',
  'favicon',
  'certificate',
  'ip_address',
  'tracking_identifier',
  'favicon_cluster',
  'official_asset_host',
  'brand',
  'case',
  'campaign',
]);
const OBSERVATION_KINDS = new Set<InvestigationObservationKind>(INVESTIGATION_OBSERVATION_KINDS);
const STORES = new Set<InvestigationStoreName>(['cases', 'campaigns', 'brandProfiles', 'relationshipRows', 'relationshipObservations']);
const SOURCE_STATES = new Set<InvestigationSearchSourceState>(['absent', 'invalid', 'unavailable', 'unsupported', 'supported']);
const FIELD_PRIORITY: Record<InvestigationSearchField, number> = {
  canonical: 0,
  domain: 1,
  label: 2,
  name: 3,
  nameserver: 4,
  origin: 5,
  sha256: 6,
  ip: 7,
  identifier: 8,
  value: 9,
};
const TYPE_PRIORITY: Record<InvestigationEntityType, number> = {
  domain: 0,
  case: 1,
  campaign: 2,
  brand: 3,
  nameserver_set: 4,
  http_origin: 5,
  certificate: 6,
  favicon: 7,
  ip_address: 8,
  tracking_identifier: 9,
  favicon_cluster: 10,
  official_asset_host: 11,
};
function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function boundedText(value: unknown, maximum = 300): string {
  if (typeof value !== 'string' || value.length > maximum * 4 || CONTROL_RE.test(value)) return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maximum).trim();
}

function timestamp(value: unknown): string | null {
  return normalizeExplicitIsoTimestamp(value);
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function triState(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function boundedStrings(value: unknown, maximum: number, itemMaximum = 300): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const candidate of (Array.isArray(value) ? value : []).slice(0, maximum * 4)) {
    const normalized = boundedText(candidate, itemMaximum);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= maximum) break;
  }
  return output;
}

function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function entityType(value: unknown): InvestigationEntityType | null {
  return typeof value === 'string' && ENTITY_TYPES.has(value as InvestigationEntityType)
    ? value as InvestigationEntityType
    : null;
}

function observationKind(value: unknown): InvestigationObservationKind | null {
  return typeof value === 'string' && OBSERVATION_KINDS.has(value as InvestigationObservationKind)
    ? value as InvestigationObservationKind
    : null;
}

function storeName(value: unknown): InvestigationStoreName | null {
  return typeof value === 'string' && STORES.has(value as InvestigationStoreName)
    ? value as InvestigationStoreName
    : null;
}

function sourceState(value: unknown): InvestigationSearchSourceState {
  return typeof value === 'string' && SOURCE_STATES.has(value as InvestigationSearchSourceState)
    ? value as InvestigationSearchSourceState
    : 'invalid';
}

function emptySources(): Record<InvestigationStoreName, InvestigationSearchSourceSummary> {
  return {
    cases: { state: 'invalid', version: null, records: 0, truncated: false },
    campaigns: { state: 'invalid', version: null, records: 0, truncated: false },
    brandProfiles: { state: 'invalid', version: null, records: 0, truncated: false },
    relationshipRows: { state: 'invalid', version: null, records: 0, truncated: false },
    relationshipObservations: { state: 'invalid', version: null, records: 0, truncated: false },
  };
}

function normalizeSourceSummary(value: unknown): InvestigationSearchSourceSummary {
  const source = record(value);
  return {
    state: sourceState(source?.state),
    version: positiveInteger(source?.version),
    records: typeof source?.records === 'number' && Number.isSafeInteger(source.records) && source.records >= 0
      ? source.records
      : 0,
    truncated: source?.truncated === true,
  };
}

function normalizeSources(value: unknown): Record<InvestigationStoreName, InvestigationSearchSourceSummary> {
  const sources = record(value);
  if (!sources) return emptySources();
  return {
    cases: normalizeSourceSummary(sources.cases),
    campaigns: normalizeSourceSummary(sources.campaigns),
    brandProfiles: normalizeSourceSummary(sources.brandProfiles),
    relationshipRows: normalizeSourceSummary(sources.relationshipRows),
    relationshipObservations: normalizeSourceSummary(sources.relationshipObservations),
  };
}

function exactIdentity(value: unknown): string {
  const text = boundedText(value, 200);
  return text === value ? text : '';
}

function duplicateIdentities(rows: readonly unknown[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const row of rows) {
    const id = exactIdentity(record(row)?.id);
    if (!id) continue;
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return duplicates;
}

function normalizeObservation(value: unknown): IndexedObservation | null {
  const observation = record(value);
  const id = exactIdentity(observation?.id);
  const kind = observationKind(observation?.kind);
  const store = storeName(observation?.store);
  const recordId = exactIdentity(observation?.recordId);
  const observedAt = timestamp(observation?.observedAt);
  if (!observation || !id || !kind || !store || !recordId || !observedAt) return null;
  return {
    id,
    kind,
    store,
    recordId,
    source: boundedText(observation.source, 40) || 'unknown',
    observedAt,
    complete: triState(observation.complete),
    truncated: triState(observation.truncated),
    limitations: boundedStrings(observation.limitations, MAX_INVESTIGATION_SEARCH_LIMITATIONS),
  };
}

function normalizeEntity(value: unknown): IndexedEntity | null {
  const entity = record(value);
  const id = exactIdentity(entity?.id);
  const type = entityType(entity?.type);
  const canonical = boundedText(entity?.canonical, 300);
  if (!entity || !id || !type || !canonical) return null;
  const rawReferences = Array.isArray(entity.observationIds) ? entity.observationIds : [];
  const references = [...new Set(rawReferences.slice(0, 100).map(exactIdentity).filter(Boolean))];
  return {
    id,
    type,
    canonical,
    label: boundedText(entity.label, 300) || canonical,
    properties: record(entity.properties) || {},
    observationIds: references,
    observationsTruncated: entity.observationsTruncated === true || rawReferences.length > 100
      || rawReferences.slice(0, 100).some((value) => !exactIdentity(value)),
  };
}

function addTerm(
  output: Map<string, InvestigationSearchTerm>,
  field: InvestigationSearchField,
  rawValue: unknown,
  maximum = 300,
): void {
  const value = boundedText(rawValue, maximum);
  if (!value) return;
  const normalized = normalizeSearchText(value);
  const previous = output.get(normalized);
  if (!normalized || (previous && FIELD_PRIORITY[previous.field] <= FIELD_PRIORITY[field])) return;
  output.set(normalized, { field, value, normalized });
}

function searchableTerms(entity: IndexedEntity): { terms: InvestigationSearchTerm[]; eligible: number; uninspected: number } {
  const terms = new Map<string, InvestigationSearchTerm>();
  addTerm(terms, 'canonical', entity.canonical);
  addTerm(terms, 'label', entity.label);
  addTerm(terms, 'domain', entity.properties.domain);
  addTerm(terms, 'name', entity.properties.name, entity.type === 'case' ? MAX_CASE_OBJECTIVE_LENGTH : 300);
  addTerm(terms, 'origin', entity.properties.origin);
  addTerm(terms, 'sha256', entity.properties.sha256);
  addTerm(terms, 'ip', entity.properties.ipAddress);
  addTerm(terms, 'identifier', entity.properties.identifier);
  addTerm(terms, 'value', entity.properties.value);
  const nameservers = Array.isArray(entity.properties.nameservers) ? entity.properties.nameservers : [];
  for (const nameserver of nameservers.slice(0, MAX_INVESTIGATION_SEARCH_TERMS_PER_ENTITY * 2)) {
    addTerm(terms, 'nameserver', nameserver);
  }
  return {
    terms: [...terms.values()].slice(0, MAX_INVESTIGATION_SEARCH_TERMS_PER_ENTITY),
    eligible: terms.size,
    uninspected: Math.max(0, nameservers.length - MAX_INVESTIGATION_SEARCH_TERMS_PER_ENTITY * 2),
  };
}

function preferredObservationKind(type: InvestigationEntityType): InvestigationObservationKind | null {
  if (type === 'case') return 'case_record';
  if (type === 'domain') return 'case_evidence';
  if (type === 'campaign') return 'campaign_record';
  if (type === 'brand') return 'brand_profile';
  return null;
}

function selectObservation(
  entity: IndexedEntity,
  observations: Map<string, IndexedObservation>,
): IndexedObservation | null {
  const available = entity.observationIds
    .map((id) => observations.get(id))
    .filter((value): value is IndexedObservation => Boolean(value))
    .sort((left, right) => right.observedAt.localeCompare(left.observedAt) || left.id.localeCompare(right.id));
  const preferred = preferredObservationKind(entity.type);
  return (preferred ? available.find((observation) => observation.kind === preferred) : null) || available[0] || null;
}

function pivotFor(entity: IndexedEntity, observation: IndexedObservation): { href: string; action: string } {
  if (entity.type === 'case') {
    return { href: `/monitor?case=${encodeURIComponent(entity.canonical)}`, action: 'Open case' };
  }
  if (entity.type === 'campaign') {
    return { href: `/monitor?view=campaigns&campaign=${encodeURIComponent(entity.canonical)}`, action: 'Open campaign' };
  }
  if (entity.type === 'brand') {
    return { href: `/brands?profile=${encodeURIComponent(entity.canonical)}`, action: 'Open profile' };
  }
  if (observation.store === 'cases') {
    return { href: `/monitor?case=${encodeURIComponent(observation.recordId)}`, action: 'Open source case' };
  }
  if (observation.store === 'campaigns') {
    return { href: `/monitor?view=campaigns&campaign=${encodeURIComponent(observation.recordId)}`, action: 'Open source campaign' };
  }
  if (observation.store === 'brandProfiles') {
    return { href: `/brands?profile=${encodeURIComponent(observation.recordId)}`, action: 'Open source profile' };
  }
  if (observation.store === 'relationshipObservations') {
    return { href: `/monitor?view=relationships&observation=${encodeURIComponent(observation.recordId)}`, action: 'Open retained observation' };
  }
  const lookupTarget = entity.type === 'domain' ? entity.canonical : observation.recordId;
  return { href: `/lookup?q=${encodeURIComponent(lookupTarget)}`, action: 'Open Lookup' };
}

function evidenceClassification(observation: IndexedObservation): 'derived' | 'normalized' | null {
  if (observation.kind === 'retained_relationship_observation') return 'derived';
  if (observation.kind === 'scan_relationship_evidence') return 'normalized';
  return null;
}

function emptyIndex(
  state: InvestigationSearchIndexState,
  projectionVersion: number | null,
  limitation: string,
): InvestigationSearchIndex {
  return {
    schema: INVESTIGATION_SEARCH_SCHEMA,
    version: INVESTIGATION_SEARCH_VERSION,
    state,
    generatedAt: null,
    projectionVersion,
    sources: emptySources(),
    entries: [],
    entityCount: 0,
    termCount: 0,
    truncated: false,
    limitations: [limitation],
  };
}

export function unavailableInvestigationSearchIndex(limitation: string): InvestigationSearchIndex {
  return emptyIndex(
    'invalid',
    null,
    boundedText(limitation) || 'Saved-work search is unavailable.',
  );
}

export function markInvestigationSearchSourcesUnavailable(
  index: InvestigationSearchIndex,
  stores: readonly InvestigationStoreName[],
): InvestigationSearchIndex {
  const sources = { ...index.sources };
  const seen = new Set<InvestigationStoreName>();
  for (const store of stores.slice(0, 5)) {
    if (!STORES.has(store) || seen.has(store)) continue;
    seen.add(store);
    sources[store] = { state: 'unavailable', version: null, records: 0, truncated: false };
  }
  if (!seen.size) return index;
  const marked = {
    ...index, sources, truncated: true,
    limitations: boundedStrings([
      `${seen.size} saved collection${seen.size === 1 ? ' is' : 's are'} unavailable and could not be searched.`,
      ...index.limitations,
    ], MAX_INVESTIGATION_SEARCH_LIMITATIONS),
  };
  return marked;
}

/**
 * Builds one bounded in-memory index from projection v1. Runtime validation is
 * deliberate because projections can later cross export or worker boundaries.
 */
export function buildInvestigationSearchIndex(rawProjection: unknown): InvestigationSearchIndex {
  const projection = readBoundedInvestigationProjection(rawProjection);
  const projectionVersion = projection.version;
  if (projection.state !== 'ready') {
    const limitation = projection.state === 'unsupported'
      ? projection.detail.replace('was not interpreted', 'was not indexed')
      : 'The investigation projection was malformed and was not indexed.';
    return emptyIndex(projection.state === 'unsupported' ? 'unsupported' : 'invalid', projectionVersion, limitation);
  }

  const sources = normalizeSources(projection.sources);
  const observations = new Map<string, IndexedObservation>();
  const ambiguousObservationIds = duplicateIdentities(projection.observations);
  let invalidObservations = 0;
  let duplicateObservations = 0;
  for (const rawObservation of projection.observations) {
    if (ambiguousObservationIds.has(exactIdentity(record(rawObservation)?.id))) { duplicateObservations += 1; continue; }
    const observation = normalizeObservation(rawObservation);
    if (!observation) { invalidObservations += 1; continue; }
    observations.set(observation.id, observation);
  }

  const ambiguousEntityIds = duplicateIdentities(projection.entities);
  const entities = new Map<string, IndexedEntity>();
  let invalidEntities = 0;
  let duplicateEntities = 0;
  for (const rawEntity of projection.entities.slice(0, MAX_INVESTIGATION_SEARCH_ENTITIES)) {
    if (ambiguousEntityIds.has(exactIdentity(record(rawEntity)?.id))) { duplicateEntities += 1; continue; }
    const entity = normalizeEntity(rawEntity);
    if (!entity) { invalidEntities += 1; continue; }
    entities.set(entity.id, entity);
  }
  const encoder = new TextEncoder();
  const candidates: Array<{
    entity: IndexedEntity; observation: IndexedObservation;
    searchable: ReturnType<typeof searchableTerms>; bytes: number[];
  }> = [];
  let missingObservations = 0;
  let referenceLimited = 0;
  for (const entity of entities.values()) {
    const observation = selectObservation(entity, observations);
    if (!observation) { missingObservations += 1; continue; }
    const searchable = searchableTerms(entity);
    if (entity.observationsTruncated) referenceLimited += 1;
    candidates.push({ entity, observation, searchable, bytes: searchable.terms.map((term) => encoder.encode(term.normalized).byteLength) });
  }

  // Reserve canonical terms before spending the shared text budget on optional
  // fields. The aggregate term bound follows from entity and per-entity bounds.
  const admitted = new Set<string>();
  let termBytes = 0;
  for (const candidate of candidates) {
    const bytes = candidate.bytes[0] ?? 0;
    if (!bytes || termBytes + bytes > MAX_INVESTIGATION_SEARCH_TERM_BYTES) continue;
    admitted.add(candidate.entity.id);
    termBytes += bytes;
  }
  const entries: InvestigationSearchEntry[] = [];
  let termCount = 0;
  let eligibleTerms = 0;
  let uninspectedNameservers = 0;
  for (const { entity, observation, searchable, bytes } of candidates) {
    eligibleTerms += searchable.eligible;
    uninspectedNameservers += searchable.uninspected;
    if (!admitted.has(entity.id)) continue;
    const terms = searchable.terms.filter((_, index) => {
      if (index === 0) return true;
      if (termBytes + bytes[index]! > MAX_INVESTIGATION_SEARCH_TERM_BYTES) return false;
      termBytes += bytes[index]!;
      return true;
    });
    termCount += terms.length;
    const pivot = pivotFor(entity, observation);
    entries.push({
      entityId: entity.id,
      entityType: entity.type,
      label: entity.label,
      canonical: entity.canonical,
      terms,
      termsTruncated: searchable.uninspected > 0 || terms.length < searchable.eligible,
      sourceStore: observation.store,
      source: observation.source,
      classification: evidenceClassification(observation),
      observedAt: observation.observedAt,
      complete: observation.complete,
      truncated: observation.truncated,
      limitations: boundedStrings([
        ...(entity.observationsTruncated ? ['Source references were capped or invalid; additional observations may be unavailable to search.'] : []),
        ...(searchable.eligible > terms.length ? [`Search retained ${terms.length} of ${searchable.eligible} eligible terms for this item.`] : []),
        ...(searchable.uninspected ? [`${searchable.uninspected} additional nameserver values were not inspected for search.`] : []),
        ...observation.limitations,
      ], MAX_INVESTIGATION_SEARCH_LIMITATIONS),
      href: pivot.href,
      action: pivot.action,
    });
  }

  entries.sort((left, right) => TYPE_PRIORITY[left.entityType] - TYPE_PRIORITY[right.entityType]
    || left.label.localeCompare(right.label)
    || left.canonical.localeCompare(right.canonical)
    || left.entityId.localeCompare(right.entityId));
  const projectionLimitations = boundedStrings(projection.limitations, MAX_INVESTIGATION_SEARCH_LIMITATIONS);
  const incompleteSources = Object.values(sources).filter((source) => ['invalid', 'unavailable', 'unsupported'].includes(source.state) || source.truncated).length;
  const omittedTerms = eligibleTerms - termCount;
  const truncated = projection.truncated || projection.entities.length > MAX_INVESTIGATION_SEARCH_ENTITIES
    || incompleteSources > 0 || invalidEntities > 0 || duplicateEntities > 0 || missingObservations > 0
    || invalidObservations > 0 || duplicateObservations > 0 || referenceLimited > 0
    || entries.length < candidates.length || omittedTerms > 0 || uninspectedNameservers > 0;
  const limitations = boundedStrings([
    ...(truncated ? ['Search coverage is partial. Counts below describe the admitted local projection, not all possible evidence.'] : []),
    `Search inspected ${Math.min(projection.entities.length, MAX_INVESTIGATION_SEARCH_ENTITIES)} admitted entities and indexed ${entries.length}. It retained ${termCount} of ${eligibleTerms} eligible distinct terms in ${termBytes} UTF-8 bytes.`,
    ...(projection.inputCounts && projection.truncated ? [`Projection input contained ${projection.inputCounts.entities} entities, ${projection.inputCounts.observations} observations and ${projection.inputCounts.relationships} relationships; its reader admitted ${projection.entities.length}, ${projection.observations.length} and ${projection.relationships.length} respectively. Earlier source omissions may be additional.`] : []),
    ...(invalidEntities || duplicateEntities || missingObservations ? [`Entity admission: ${invalidEntities} malformed rows, ${duplicateEntities} duplicate-identity rows and ${missingObservations} entities without an unambiguous usable source observation. Duplicate identities are not arbitrarily selected.`] : []),
    ...(invalidObservations || duplicateObservations ? [`Source observation admission: ${invalidObservations} malformed or undated rows and ${duplicateObservations} duplicate-identity rows; ${observations.size} unambiguous observations retained.`] : []),
    ...(omittedTerms || uninspectedNameservers || referenceLimited ? [`Search omissions: ${omittedTerms} eligible terms, ${uninspectedNameservers} uninspected nameserver values and ${referenceLimited} entities with capped or invalid source references. The source records remain available through their links.`] : []),
    ...(incompleteSources ? [`${incompleteSources} source collections were incomplete, unavailable or unsupported for this index.`] : []),
    ...projectionLimitations,
  ], MAX_INVESTIGATION_SEARCH_LIMITATIONS);

  const index: InvestigationSearchIndex = {
    schema: INVESTIGATION_SEARCH_SCHEMA,
    version: INVESTIGATION_SEARCH_VERSION,
    state: 'ready',
    generatedAt: timestamp(projection.generatedAt),
    projectionVersion,
    sources,
    entries,
    entityCount: entries.length,
    termCount,
    truncated,
    limitations,
  };
  return index;
}

function termRank(term: InvestigationSearchTerm, query: string): number | null {
  if (term.normalized === query) return FIELD_PRIORITY[term.field];
  if (term.normalized.startsWith(query)) return 100 + FIELD_PRIORITY[term.field];
  if (!term.normalized.includes(query)) return null;
  const boundary = term.normalized.split(/[^a-z0-9]+/u).some((part) => part.startsWith(query));
  if (boundary) return 200 + FIELD_PRIORITY[term.field];
  return 300 + FIELD_PRIORITY[term.field];
}

function matchEntry(
  entry: InvestigationSearchEntry,
  query: string,
  tokens: string[],
): { score: number; term: InvestigationSearchTerm } | null {
  let best: { score: number; term: InvestigationSearchTerm } | null = null;
  for (const term of entry.terms) {
    const score = termRank(term, query);
    if (score !== null && (!best || score < best.score)) best = { score, term };
  }
  if (best || tokens.length < 2) return best;

  let score = 1000;
  let representative: InvestigationSearchTerm | null = null;
  for (const token of tokens) {
    let tokenBest: { score: number; term: InvestigationSearchTerm } | null = null;
    for (const term of entry.terms) {
      const candidate = termRank(term, token);
      if (candidate !== null && (!tokenBest || candidate < tokenBest.score)) tokenBest = { score: candidate, term };
    }
    if (!tokenBest) return null;
    score += tokenBest.score;
    representative ||= tokenBest.term;
  }
  return representative ? { score, term: representative } : null;
}

export function searchInvestigationIndex(
  index: InvestigationSearchIndex,
  rawQuery: unknown,
  options: Readonly<{ page?: number; pageSize?: number }> = {},
): InvestigationSearchResponse {
  if (index.state !== 'ready') {
    return {
      state: 'invalid',
      query: '',
      results: [],
      totalMatches: 0,
      truncated: false,
      detail: index.limitations[0] || 'The local investigation index is unavailable.',
    };
  }
  if (typeof rawQuery !== 'string') {
    return { state: 'invalid', query: '', results: [], totalMatches: 0, truncated: false, detail: 'Enter a text search query.' };
  }
  if (rawQuery.length > MAX_INVESTIGATION_SEARCH_QUERY_LENGTH || CONTROL_RE.test(rawQuery)) {
    return {
      state: 'invalid',
      query: '',
      results: [],
      totalMatches: 0,
      truncated: false,
      detail: `Search queries must be ${MAX_INVESTIGATION_SEARCH_QUERY_LENGTH} characters or fewer and contain no control characters.`,
    };
  }
  const query = normalizeSearchText(rawQuery);
  if (!query) return { state: 'idle', query: '', results: [], totalMatches: 0, truncated: false, detail: '' };
  const tokens = [...new Set(query.split(' ').filter(Boolean))];
  if (tokens.length > MAX_INVESTIGATION_SEARCH_TOKENS) {
    return {
      state: 'invalid',
      query,
      results: [],
      totalMatches: 0,
      truncated: false,
      detail: `Use ${MAX_INVESTIGATION_SEARCH_TOKENS} search terms or fewer.`,
    };
  }

  const matches: InvestigationSearchResult[] = [];
  for (const entry of index.entries) {
    const match = matchEntry(entry, query, tokens);
    if (!match) continue;
    const { terms: _terms, termsTruncated: _termsTruncated, ...result } = entry;
    matches.push({
      ...result,
      matchedField: match.term.field,
      matchedValue: match.term.value,
      score: match.score,
    });
  }
  matches.sort((left, right) => left.score - right.score
    || TYPE_PRIORITY[left.entityType] - TYPE_PRIORITY[right.entityType]
    || left.label.localeCompare(right.label)
    || left.canonical.localeCompare(right.canonical)
    || left.entityId.localeCompare(right.entityId));
  const pageSize = Number.isSafeInteger(options.pageSize) && options.pageSize! > 0
    ? Math.min(options.pageSize!, MAX_INVESTIGATION_SEARCH_RESULTS) : MAX_INVESTIGATION_SEARCH_RESULTS;
  const pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
  const page = Number.isSafeInteger(options.page) && options.page! > 0 ? Math.min(options.page!, pageCount) : 1;
  const start = (page - 1) * pageSize;
  const results = matches.slice(start, start + pageSize);
  if (!results.length) {
    return {
      state: 'no_matches',
      query,
      results: [],
      totalMatches: 0,
      truncated: index.truncated,
      detail: index.truncated ? 'No match was found in the searchable subset. Local search coverage is partial.'
        : 'No indexed saved work matched that search. This does not establish absence elsewhere.',
    };
  }
  return {
    state: 'results',
    query,
    results,
    totalMatches: matches.length,
    truncated: index.truncated || matches.length > results.length,
    detail: `${matches.length > results.length
      ? `Showing matches ${start + 1}–${start + results.length} of ${matches.length}.`
      : `${matches.length} local match${matches.length === 1 ? '' : 'es'}.`}${index.truncated ? ' Search coverage is partial.' : ''}`,
  };
}

export function recentInvestigationResults(
  index: InvestigationSearchIndex,
): InvestigationSearchResult[] {
  if (index.state !== 'ready') return [];
  return [...index.entries]
    .sort((left, right) => right.observedAt.localeCompare(left.observedAt)
      || TYPE_PRIORITY[left.entityType] - TYPE_PRIORITY[right.entityType]
      || left.label.localeCompare(right.label)
      || left.entityId.localeCompare(right.entityId))
    .slice(0, MAX_RECENT_INVESTIGATION_RESULTS)
    .map(({ terms: _terms, termsTruncated: _termsTruncated, ...entry }) => ({
      ...entry,
      matchedField: 'canonical',
      matchedValue: entry.canonical,
      score: 0,
    }));
}
