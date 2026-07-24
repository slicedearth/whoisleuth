// Pure, bounded search and pivot navigation over investigation projection v1.
// This module does not read browser storage, make network requests, or infer
// absence from a missing result. It indexes only known projection fields.

import {
  INVESTIGATION_PROJECTION_SCHEMA,
  INVESTIGATION_PROJECTION_VERSION,
  MAX_PROJECTION_OBSERVATIONS,
  type InvestigationEntityType,
  type InvestigationObservationKind,
  type InvestigationSourceState,
  type InvestigationStoreName,
} from './investigation-projection.ts';

export const INVESTIGATION_SEARCH_SCHEMA = 'whoisleuth.investigation-search-index';
export const INVESTIGATION_SEARCH_VERSION = 1;
export const MAX_INVESTIGATION_SEARCH_QUERY_LENGTH = 200;
export const MAX_INVESTIGATION_SEARCH_TOKENS = 8;
export const MAX_INVESTIGATION_SEARCH_RESULTS = 50;
export const MAX_INVESTIGATION_SEARCH_ENTITIES = 6000;
export const MAX_INVESTIGATION_SEARCH_TERMS = 24000;
export const MAX_INVESTIGATION_SEARCH_TERMS_PER_ENTITY = 24;
export const MAX_INVESTIGATION_SEARCH_LIMITATIONS = 20;

export type InvestigationSearchIndexState = 'ready' | 'invalid' | 'unsupported';
export type InvestigationSearchState = 'idle' | 'invalid' | 'no_matches' | 'results';
export type InvestigationSearchField = 'canonical' | 'label' | 'domain' | 'name' | 'nameserver' | 'origin' | 'sha256' | 'ip' | 'identifier' | 'value';

export interface InvestigationSearchSourceSummary {
  state: InvestigationSourceState;
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
const OBSERVATION_KINDS = new Set<InvestigationObservationKind>([
  'case_evidence',
  'case_record',
  'brand_profile',
  'brand_page_baseline',
  'campaign_record',
  'scan_relationship_evidence',
  'retained_relationship_observation',
]);
const STORES = new Set<InvestigationStoreName>(['cases', 'campaigns', 'brandProfiles', 'relationshipRows', 'relationshipObservations']);
const SOURCE_STATES = new Set<InvestigationSourceState>(['absent', 'invalid', 'unsupported', 'supported']);
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
  if (typeof value !== 'string' || value.length > 64 || CONTROL_RE.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
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

function sourceState(value: unknown): InvestigationSourceState {
  return typeof value === 'string' && SOURCE_STATES.has(value as InvestigationSourceState)
    ? value as InvestigationSourceState
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
      ? Math.min(source.records, MAX_INVESTIGATION_SEARCH_ENTITIES)
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

function normalizeObservation(value: unknown): IndexedObservation | null {
  const observation = record(value);
  const id = boundedText(observation?.id, 200);
  const kind = observationKind(observation?.kind);
  const store = storeName(observation?.store);
  const recordId = boundedText(observation?.recordId, 200);
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
  const id = boundedText(entity?.id, 200);
  const type = entityType(entity?.type);
  const canonical = boundedText(entity?.canonical, 300);
  if (!entity || !id || !type || !canonical) return null;
  return {
    id,
    type,
    canonical,
    label: boundedText(entity.label, 300) || canonical,
    properties: record(entity.properties) || {},
    observationIds: boundedStrings(entity.observationIds, 100, 200),
    observationsTruncated: entity.observationsTruncated === true,
  };
}

function addTerm(
  output: InvestigationSearchTerm[],
  seen: Set<string>,
  field: InvestigationSearchField,
  rawValue: unknown,
): void {
  const value = boundedText(rawValue, 300);
  if (!value) return;
  const normalized = normalizeSearchText(value);
  const key = `${field}\u0000${normalized}`;
  if (!normalized || seen.has(key)) return;
  seen.add(key);
  if (output.length < MAX_INVESTIGATION_SEARCH_TERMS_PER_ENTITY) output.push({ field, value, normalized });
}

function searchableTerms(entity: IndexedEntity): { terms: InvestigationSearchTerm[]; truncated: boolean } {
  const terms: InvestigationSearchTerm[] = [];
  const seen = new Set<string>();
  addTerm(terms, seen, 'canonical', entity.canonical);
  addTerm(terms, seen, 'label', entity.label);
  addTerm(terms, seen, 'domain', entity.properties.domain);
  addTerm(terms, seen, 'name', entity.properties.name);
  addTerm(terms, seen, 'origin', entity.properties.origin);
  addTerm(terms, seen, 'sha256', entity.properties.sha256);
  addTerm(terms, seen, 'ip', entity.properties.ipAddress);
  addTerm(terms, seen, 'identifier', entity.properties.identifier);
  addTerm(terms, seen, 'value', entity.properties.value);
  const nameservers = Array.isArray(entity.properties.nameservers) ? entity.properties.nameservers : [];
  for (const nameserver of nameservers.slice(0, MAX_INVESTIGATION_SEARCH_TERMS_PER_ENTITY * 2)) {
    addTerm(terms, seen, 'nameserver', nameserver);
  }
  return {
    terms,
    truncated: seen.size > terms.length || nameservers.length > MAX_INVESTIGATION_SEARCH_TERMS_PER_ENTITY * 2,
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

/**
 * Builds one bounded in-memory index from projection v1. Runtime validation is
 * deliberate because projections can later cross export or worker boundaries.
 */
export function buildInvestigationSearchIndex(rawProjection: unknown): InvestigationSearchIndex {
  const projection = record(rawProjection);
  const projectionVersion = positiveInteger(projection?.version);
  if (!projection || projection.schema !== INVESTIGATION_PROJECTION_SCHEMA || projectionVersion === null) {
    return emptyIndex('invalid', projectionVersion, 'The investigation projection was malformed and was not indexed.');
  }
  if (projectionVersion > INVESTIGATION_PROJECTION_VERSION) {
    return emptyIndex('unsupported', projectionVersion, `Investigation projection schema ${projectionVersion} is newer than supported schema ${INVESTIGATION_PROJECTION_VERSION}; it was not indexed.`);
  }
  if (!Array.isArray(projection.entities) || !Array.isArray(projection.observations)) {
    return emptyIndex('invalid', projectionVersion, 'The investigation projection did not contain valid entity and observation collections.');
  }

  const sources = normalizeSources(projection.sources);
  const observations = new Map<string, IndexedObservation>();
  let truncated = projection.truncated === true || projection.entities.length > MAX_INVESTIGATION_SEARCH_ENTITIES
    || projection.observations.length > MAX_PROJECTION_OBSERVATIONS;
  for (const rawObservation of projection.observations.slice(0, MAX_PROJECTION_OBSERVATIONS)) {
    const observation = normalizeObservation(rawObservation);
    if (observation && !observations.has(observation.id)) observations.set(observation.id, observation);
  }

  const entries: InvestigationSearchEntry[] = [];
  let termCount = 0;
  for (const rawEntity of projection.entities.slice(0, MAX_INVESTIGATION_SEARCH_ENTITIES)) {
    const entity = normalizeEntity(rawEntity);
    if (!entity) continue;
    const observation = selectObservation(entity, observations);
    if (!observation) continue;
    const searchable = searchableTerms(entity);
    const remaining = Math.max(0, MAX_INVESTIGATION_SEARCH_TERMS - termCount);
    const terms = searchable.terms.slice(0, remaining);
    if (!terms.length) { truncated = true; break; }
    if (terms.length < searchable.terms.length) truncated = true;
    termCount += terms.length;
    const pivot = pivotFor(entity, observation);
    entries.push({
      entityId: entity.id,
      entityType: entity.type,
      label: entity.label,
      canonical: entity.canonical,
      terms,
      termsTruncated: searchable.truncated || terms.length < searchable.terms.length,
      sourceStore: observation.store,
      source: observation.source,
      classification: evidenceClassification(observation),
      observedAt: observation.observedAt,
      complete: observation.complete,
      truncated: observation.truncated,
      limitations: boundedStrings([
        ...observation.limitations,
        ...(entity.observationsTruncated ? ['Additional source observations were omitted by the projection reference cap.'] : []),
      ], MAX_INVESTIGATION_SEARCH_LIMITATIONS),
      href: pivot.href,
      action: pivot.action,
    });
    if (termCount >= MAX_INVESTIGATION_SEARCH_TERMS) { truncated = true; break; }
  }

  entries.sort((left, right) => TYPE_PRIORITY[left.entityType] - TYPE_PRIORITY[right.entityType]
    || left.label.localeCompare(right.label)
    || left.canonical.localeCompare(right.canonical)
    || left.entityId.localeCompare(right.entityId));
  const projectionLimitations = boundedStrings(projection.limitations, MAX_INVESTIGATION_SEARCH_LIMITATIONS);
  const limitations = boundedStrings([
    ...projectionLimitations,
    ...(truncated ? ['The local search index reached a projection, entity, observation, term, or reference cap. Results may be partial.'] : []),
  ], MAX_INVESTIGATION_SEARCH_LIMITATIONS);

  return {
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
}

function termRank(term: InvestigationSearchTerm, query: string): number | null {
  if (term.normalized === query) return FIELD_PRIORITY[term.field];
  if (term.normalized.startsWith(query)) return 100 + FIELD_PRIORITY[term.field];
  const boundary = term.normalized.split(/[^a-z0-9]+/u).some((part) => part.startsWith(query));
  if (boundary) return 200 + FIELD_PRIORITY[term.field];
  if (term.normalized.includes(query)) return 300 + FIELD_PRIORITY[term.field];
  return null;
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
  const results = matches.slice(0, MAX_INVESTIGATION_SEARCH_RESULTS);
  if (!results.length) {
    return {
      state: 'no_matches',
      query,
      results: [],
      totalMatches: 0,
      truncated: index.truncated,
      detail: 'Nothing saved in this browser matched that search. This does not mean the domain or evidence is absent elsewhere.',
    };
  }
  return {
    state: 'results',
    query,
    results,
    totalMatches: matches.length,
    truncated: index.truncated || matches.length > results.length,
    detail: matches.length > results.length
      ? `Showing the first ${results.length} of ${matches.length} deterministic matches.`
      : `${matches.length} deterministic local match${matches.length === 1 ? '' : 'es'}.`,
  };
}
