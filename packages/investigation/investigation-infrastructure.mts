// Disposable views of admitted retained evidence. No collection, persistence,
// graph-distance attribution or second entity/search index is introduced here.
import {
  INVESTIGATION_RELATIONSHIP_TYPES, MAX_PROJECTION_REFERENCES,
  type InvestigationEntityType, type InvestigationRelationshipClassification,
  type InvestigationRelationshipType, type InvestigationStoreName,
} from './investigation-projection.mts';
import {
  investigationHistoryEntry, MAX_INVESTIGATION_SEARCH_LIMITATIONS, MAX_INVESTIGATION_SEARCH_RESULTS,
  readInvestigationSearchRecords, searchInvestigationIndex,
  type IndexedEntity, type IndexedObservation, type InvestigationHistoryEntry,
  type InvestigationSearchIndex, type InvestigationSearchResult,
} from './investigation-search.mts';
import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';

export const INFRASTRUCTURE_ENTITY_TYPES = Object.freeze([
  'domain', 'ip_address', 'certificate', 'nameserver_set', 'http_origin',
  'certificate_pattern', 'provider', 'routing_asn',
] as const satisfies readonly InvestigationEntityType[]);
export type InfrastructureEntityType = typeof INFRASTRUCTURE_ENTITY_TYPES[number];
export interface InvestigationInfrastructureOptions {
  query?: string;
  type?: InfrastructureEntityType;
  store?: InvestigationStoreName;
  observedSince?: string;
  page?: number;
}
export interface InvestigationInfrastructureRow {
  entityId: string;
  type: InfrastructureEntityType;
  canonical: string;
  label: string;
  observationCount: number;
  relationshipCount: number;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  sourceStores: InvestigationStoreName[];
  partial: boolean;
  searchable: boolean;
  matchedField: InvestigationSearchResult['matchedField'] | null;
  matchedValue: string | null;
}
export interface InvestigationInfrastructure {
  state: 'ready' | 'invalid' | 'unavailable';
  rows: InvestigationInfrastructureRow[];
  admittedCount: number;
  total: number;
  page: number;
  pageCount: number;
  partial: boolean;
  limitations: string[];
  detail: string;
}
export interface InvestigationInfrastructureRelationship {
  id: string;
  relationshipId: string;
  type: InvestigationRelationshipType;
  classification: InvestigationRelationshipClassification;
  method: string;
  from: Pick<IndexedEntity, 'id' | 'type' | 'label' | 'canonical'>;
  to: Pick<IndexedEntity, 'id' | 'type' | 'label' | 'canonical'>;
  source: InvestigationHistoryEntry | null;
  sourceCount: number;
  sourcePage?: number;
  partial: boolean;
  limitations: string[];
}
export interface InvestigationInfrastructureRelationships {
  state: 'ready' | 'unavailable';
  entityId: string;
  rows: InvestigationInfrastructureRelationship[];
  relationshipCount: number;
  total: number;
  page: number;
  pageCount: number;
  partial: boolean;
  limitations: string[];
  topologyRows?: InvestigationInfrastructureRelationship[];
  topologyTotal?: number;
}

const TYPES = new Set<string>(INFRASTRUCTURE_ENTITY_TYPES);
const RELATIONSHIPS = new Set<string>(INVESTIGATION_RELATIONSHIP_TYPES);
const STORES = new Set<string>(['cases', 'campaigns', 'brandProfiles', 'relationshipRows', 'relationshipObservations']);
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function text(value: unknown, maximum = 300): string {
  return typeof value === 'string' && value.length <= maximum && !/[\x00-\x1f\x7f]/u.test(value)
    ? value.trim() : '';
}
function identity(value: unknown): string {
  const result = text(value, 200);
  return result === value ? result : '';
}
function limitations(values: readonly string[]): string[] {
  return [...new Set(values)].slice(0, MAX_INVESTIGATION_SEARCH_LIMITATIONS);
}
function paging(total: number, requested: unknown) {
  const pageCount = Math.max(1, Math.ceil(total / MAX_INVESTIGATION_SEARCH_RESULTS));
  const page = typeof requested === 'number' && Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, pageCount) : 1;
  return { page, pageCount, start: (page - 1) * MAX_INVESTIGATION_SEARCH_RESULTS };
}
type Records = ReturnType<typeof readInvestigationSearchRecords>;
type Edge = Omit<InvestigationInfrastructureRelationship, 'id' | 'source' | 'sourceCount'> & {
  observations: IndexedObservation[]; missingSources: number;
};
function endpoint(entity: IndexedEntity) {
  return { id: entity.id, type: entity.type, label: entity.label, canonical: entity.canonical };
}
function admittedEdges(records: Records) {
  const seen = new Set<string>(), duplicates = new Set<string>();
  for (const raw of records.projection.relationships) {
    const id = identity(object(raw)?.id);
    if (id && seen.has(id)) duplicates.add(id);
    if (id) seen.add(id);
  }
  const edges: Edge[] = [];
  let withheld = 0;
  for (const raw of records.projection.relationships) {
    const row = object(raw), id = identity(row?.id);
    const from = records.entities.get(identity(row?.from)), to = records.entities.get(identity(row?.to));
    const type = text(row?.type), classification = text(row?.classification);
    if (!row || !id || duplicates.has(id) || !from || !to || !RELATIONSHIPS.has(type)
      || !['direct', 'normalized', 'derived'].includes(classification)) { withheld++; continue; }
    const refs = Array.isArray(row.sourceObservationIds) ? row.sourceObservationIds : [];
    const ids = [...new Set(refs.slice(0, MAX_PROJECTION_REFERENCES).map(identity).filter(Boolean))];
    const observations = ids.map(value => records.observations.get(value)).filter((value): value is IndexedObservation => Boolean(value))
      .sort((a, b) => b.observedAt.localeCompare(a.observedAt) || a.id.localeCompare(b.id));
    const missingSources = ids.length - observations.length;
    const referenceLimited = row.sourceObservationsTruncated === true || refs.length > MAX_PROJECTION_REFERENCES
      || refs.slice(0, MAX_PROJECTION_REFERENCES).some(value => !identity(value));
    edges.push({ relationshipId: id, type: type as InvestigationRelationshipType,
      classification: classification as InvestigationRelationshipClassification,
      method: text(row.method, 500) || 'Method not retained', from: endpoint(from), to: endpoint(to), observations, missingSources,
      partial: referenceLimited || missingSources > 0 || !observations.length || !text(row.method, 500)
        || row.complete !== true || row.truncated === true,
      limitations: limitations([
        ...(referenceLimited ? ['Supporting source references are incomplete; no additional sources are inferred from nearby entities.'] : []),
        ...(missingSources || !observations.length ? ['At least one supporting source is unavailable, malformed, undated or ambiguous.'] : []),
        ...(Array.isArray(row.limitations) ? row.limitations.slice(0, MAX_INVESTIGATION_SEARCH_LIMITATIONS).map(value => text(value)).filter(Boolean) : []),
      ]),
    });
  }
  edges.sort((a, b) => a.type.localeCompare(b.type) || a.from.canonical.localeCompare(b.from.canonical)
    || a.to.canonical.localeCompare(b.to.canonical) || a.relationshipId.localeCompare(b.relationshipId));
  return { edges, withheld };
}
function admissionLimitations(records: Records, withheld: number, extra: readonly string[] = []): string[] {
  return limitations([
    'Counts describe admitted retained evidence, not organisation-wide coverage or current resolution.',
    'Retained dates do not establish creation, disappearance or contemporaneous co-location. Shared infrastructure is not common control.',
    'Provider roles, routing ASN and independently observed origins are present only when a source-qualified snapshot explicitly retains them; legacy sources do not acquire them.',
    'Imported DNS relationships can use the Case domain when the queried owner was not retained; no more precise hostname is inferred.',
    'Certificate wildcard patterns are separate pattern identities, not enumerated hosts. Legacy observations do not acquire complete collection snapshots or removal findings.',
    ...(records.invalidEntities || records.duplicateEntities || records.invalidObservations || records.duplicateObservations || withheld
      ? [`Admission withheld ${records.invalidEntities} malformed and ${records.duplicateEntities} ambiguous entity rows, ${records.invalidObservations} malformed or undated and ${records.duplicateObservations} ambiguous observation rows, and ${withheld} unsupported, malformed or ambiguous relationships.`] : []),
    ...(records.entities.size && [...records.entities.values()].some(value => value.observationsTruncated)
      ? ['Entity source-reference lists may be capped. Explicit reverse observation membership recovers admitted sources; other omissions remain unknown.'] : []),
    ...extra,
    ...(Array.isArray(records.projection.limitations) ? records.projection.limitations.map(value => text(value)).filter(Boolean) : []),
  ]);
}
function incomplete(records: Records, withheld: number): boolean {
  return records.projection.truncated || withheld > 0 || records.invalidEntities > 0 || records.duplicateEntities > 0
    || records.invalidObservations > 0 || records.duplicateObservations > 0;
}

/** Filters the complete admitted set before asking the existing search owner to page matches. */
export function investigationInfrastructure(
  rawProjection: unknown, index: InvestigationSearchIndex, options: InvestigationInfrastructureOptions = {},
): InvestigationInfrastructure {
  const records = readInvestigationSearchRecords(rawProjection);
  const empty: InvestigationInfrastructure = { state: 'unavailable', rows: [], admittedCount: 0, total: 0,
    page: 1, pageCount: 1, partial: true, limitations: [], detail: 'Retained infrastructure is unavailable.' };
  if (records.projection.state !== 'ready' || index.state !== 'ready') return empty;
  const since = options.observedSince ? normalizeExplicitIsoTimestamp(options.observedSince) : null;
  if ((options.type !== undefined && !TYPES.has(options.type)) || (options.store !== undefined && !STORES.has(options.store))
    || (options.observedSince !== undefined && !since)) return { ...empty, state: 'invalid', detail: 'Choose a supported infrastructure type, source and observation date.' };
  const { edges, withheld } = admittedEdges(records);
  const relationshipCounts = new Map<string, number>();
  for (const edge of edges) for (const id of new Set([edge.from.id, edge.to.id])) relationshipCounts.set(id, (relationshipCounts.get(id) ?? 0) + 1);
  const searchable = new Set(index.entries.map(entry => entry.entityId));
  const admitted = [...records.entities.values()].filter(entity => TYPES.has(entity.type));
  const selected = admitted.filter(entity => {
    if (options.type && entity.type !== options.type) return false;
    if (!options.store && !since) return true;
    return [...records.membership.get(entity.id)!].some(id => {
      const observation = records.observations.get(id)!;
      return (!options.store || observation.store === options.store) && (!since || observation.observedAt >= since);
    });
  });
  const selectedIds = new Set(selected.map(entity => entity.id));
  const query = options.query ?? '';
  const search = searchInvestigationIndex({ ...index, entries: index.entries.filter(entry => selectedIds.has(entry.entityId)) }, query,
    options.page === undefined ? {} : { page: options.page });
  if (search.state === 'invalid') return { ...empty, state: 'invalid', admittedCount: admitted.length, detail: search.detail };
  const browsing = search.state === 'idle';
  const sorted = browsing ? selected.sort((a, b) => INFRASTRUCTURE_ENTITY_TYPES.indexOf(a.type as InfrastructureEntityType)
    - INFRASTRUCTURE_ENTITY_TYPES.indexOf(b.type as InfrastructureEntityType) || a.canonical.localeCompare(b.canonical) || a.id.localeCompare(b.id)) : [];
  const total = browsing ? sorted.length : search.totalMatches;
  const { page, pageCount, start } = paging(total, options.page);
  const matches = new Map(search.results.map(result => [result.entityId, result]));
  const entities = browsing ? sorted.slice(start, start + MAX_INVESTIGATION_SEARCH_RESULTS)
    : search.results.map(result => records.entities.get(result.entityId)!);
  return { state: 'ready', admittedCount: admitted.length, total, page, pageCount,
    partial: incomplete(records, withheld) || index.truncated,
    rows: entities.map(entity => {
      const observations = [...records.membership.get(entity.id)!].map(id => records.observations.get(id)!)
        .sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.id.localeCompare(b.id));
      return { entityId: entity.id, type: entity.type as InfrastructureEntityType, canonical: entity.canonical, label: entity.label,
        observationCount: observations.length, relationshipCount: relationshipCounts.get(entity.id) ?? 0,
        firstObservedAt: observations[0]?.observedAt ?? null, lastObservedAt: observations.at(-1)?.observedAt ?? null,
        sourceStores: [...new Set(observations.map(observation => observation.store))],
        partial: !observations.length || entity.observationsTruncated || entity.observationIds.some(id => !records.observations.has(id))
          || observations.some(observation => observation.complete !== true || observation.truncated === true || observation.entityReferencesTruncated),
        searchable: searchable.has(entity.id), matchedField: matches.get(entity.id)?.matchedField ?? null,
        matchedValue: matches.get(entity.id)?.matchedValue ?? null };
    }),
    limitations: admissionLimitations(records, withheld, index.limitations),
    detail: total ? `Showing ${start + 1}–${Math.min(total, start + MAX_INVESTIGATION_SEARCH_RESULTS)} of ${total} admitted retained infrastructure matches.`
      : 'No admitted retained infrastructure matched these filters. This does not establish absence elsewhere.',
  };
}

/** Pages edge/source pairs without accumulating a potentially large cross-product. */
export function investigationInfrastructureRelationships(rawProjection: unknown, entityId: unknown, requestedPage = 1, topologyQuery = ''): InvestigationInfrastructureRelationships {
  const records = readInvestigationSearchRecords(rawProjection), id = identity(entityId);
  const empty: InvestigationInfrastructureRelationships = { state: 'unavailable', entityId: '', rows: [], relationshipCount: 0,
    total: 0, page: 1, pageCount: 1, partial: true, limitations: ['The selected retained identity is unavailable or ambiguous.'] };
  if (records.projection.state !== 'ready' || !records.entities.has(id)) return empty;
  const admitted = admittedEdges(records);
  const edges = admitted.edges.filter(edge => edge.from.id === id || edge.to.id === id);
  const sourcePages = new Map<string, number>();
  let sourceOffset = 0;
  for (const edge of edges) {
    sourcePages.set(edge.relationshipId, Math.floor(sourceOffset / MAX_INVESTIGATION_SEARCH_RESULTS) + 1);
    sourceOffset += edge.observations.length + (edge.missingSources || !edge.observations.length ? 1 : 0);
  }
  const query = text(topologyQuery, 200).toLowerCase();
  const topologyEdges = edges.filter(edge => !query || [edge.from.canonical, edge.to.canonical, edge.type, edge.method,
    ...edge.observations.map(observation => `${observation.source} ${observation.observedAt}`)].some(value => value.toLowerCase().includes(query)));
  const topologyRows = topologyEdges.slice(0, MAX_INVESTIGATION_SEARCH_RESULTS).map(edge => {
    const { observations, missingSources: _missing, ...value } = edge;
    return { ...value, id: edge.relationshipId, source: observations[0] ? investigationHistoryEntry(observations[0]) : null, sourceCount: observations.length, sourcePage: sourcePages.get(edge.relationshipId)! };
  });
  const total = edges.reduce((count, edge) => count + edge.observations.length + (edge.missingSources || !edge.observations.length ? 1 : 0), 0);
  const { page, pageCount, start } = paging(total, requestedPage);
  const rows: InvestigationInfrastructureRelationship[] = [];
  let offset = 0;
  for (const edge of edges) {
    const count = edge.observations.length + (edge.missingSources || !edge.observations.length ? 1 : 0);
    if (offset + count <= start) { offset += count; continue; }
    for (let position = Math.max(0, start - offset); position < count && rows.length < MAX_INVESTIGATION_SEARCH_RESULTS; position++) {
      const observation = edge.observations[position], { observations: _observations, missingSources: _missing, ...value } = edge;
      rows.push({ ...value, id: JSON.stringify([edge.relationshipId, observation?.id ?? null]),
        source: observation ? investigationHistoryEntry(observation) : null, sourceCount: edge.observations.length,
        partial: edge.partial || !observation || observation.complete !== true || observation.truncated === true });
    }
    offset += count;
    if (rows.length >= MAX_INVESTIGATION_SEARCH_RESULTS) break;
  }
  return { state: 'ready', entityId: id, rows, relationshipCount: edges.length, total, page, pageCount,
    partial: incomplete(records, admitted.withheld) || edges.some(edge => edge.partial),
    limitations: admissionLimitations(records, admitted.withheld), topologyRows, topologyTotal: topologyEdges.length };
}
