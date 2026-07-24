// Pure, read-only projection over existing normalized analyst stores and
// transient relationship observations. It introduces no persistence or
// network work: entities and edges remain traceable to bounded source records.

import {
  CASE_SCHEMA_VERSION,
  MAX_CASES,
  normalizeCaseStore,
  normalizeDomain,
} from './case-model.js';
import {
  BRAND_PROFILE_SCHEMA_VERSION,
  MAX_PROFILES,
  normalizeBrandProfileStore,
} from './brand-profile-model.js';
import {
  CAMPAIGN_SCHEMA_VERSION,
  MAX_CAMPAIGNS,
  normalizeCampaignStore,
} from './campaign-model.js';
import {
  MAX_NAMESERVERS_PER_ROW,
  MAX_RELATIONSHIP_ROWS,
  RELATIONSHIP_EVIDENCE_VERSION,
} from './relationship-evidence.js';
import {
  MAX_RELATIONSHIP_OBSERVATIONS,
  RELATIONSHIP_OBSERVATION_SCHEMA_VERSION,
  normalizeRelationshipObservationStore,
  type RelationshipObservation,
  type RelationshipObservationType,
} from './relationship-observation-model.ts';

export const INVESTIGATION_PROJECTION_SCHEMA = 'whoisleuth.investigation-projection';
export const INVESTIGATION_PROJECTION_VERSION = 1;
export const MAX_PROJECTION_ENTITIES = 6000;
export const MAX_PROJECTION_OBSERVATIONS = 4000;
export const MAX_PROJECTION_RELATIONSHIPS = 10000;
export const MAX_PROJECTION_REFERENCES = 100;
export const MAX_PROJECTION_LIMITATIONS = 20;

export type InvestigationEntityType =
  | 'domain'
  | 'nameserver_set'
  | 'http_origin'
  | 'favicon'
  | 'certificate'
  | 'ip_address'
  | 'tracking_identifier'
  | 'favicon_cluster'
  | 'official_asset_host'
  | 'brand'
  | 'case'
  | 'campaign';

export type InvestigationScanDepth = 'fast' | 'deep' | 'unknown';
export type InvestigationSourceState = 'absent' | 'invalid' | 'unsupported' | 'supported';
export type InvestigationObservationStatus = 'success' | 'partial';
export type InvestigationObservationKind =
  | 'case_evidence'
  | 'case_record'
  | 'brand_profile'
  | 'brand_page_baseline'
  | 'campaign_record'
  | 'scan_relationship_evidence'
  | 'retained_relationship_observation';
export type InvestigationStoreName = 'cases' | 'campaigns' | 'brandProfiles' | 'relationshipRows' | 'relationshipObservations';
export type InvestigationRelationshipType =
  | 'domain_uses_nameserver_set'
  | 'domain_reached_http_origin'
  | 'case_documents_domain'
  | 'brand_declares_official_domain'
  | 'brand_declares_official_favicon'
  | 'domain_observed_favicon'
  | 'campaign_contains_domain'
  | 'campaign_contains_case'
  | 'domain_presented_certificate'
  | 'domain_resolved_to_ip'
  | 'domain_exposed_tracking_identifier'
  | 'domain_related_by_favicon'
  | 'domain_loaded_official_asset';
export type InvestigationRelationshipClassification = 'direct' | 'normalized' | 'derived';

export interface InvestigationProjectionInput {
  cases?: unknown;
  campaigns?: unknown;
  brandProfiles?: unknown;
  relationshipRows?: unknown;
  relationshipObservations?: unknown;
}

export interface InvestigationProjectionOptions {
  generatedAt?: unknown;
}

export interface InvestigationSchemaVersions {
  case?: number | null;
  riskModel?: number | null;
  httpSummary?: number | null;
  brandProfile?: number | null;
  pageBaseline?: number | null;
  pageIdentity?: number | null;
  pageFingerprint?: number | null;
  campaign?: number | null;
  relationshipEvidence?: number | null;
  relationshipObservation?: number | null;
}

export interface InvestigationEntity {
  id: string;
  type: InvestigationEntityType;
  canonical: string;
  label: string;
  properties: Record<string, unknown>;
  observationIds: string[];
  observationsTruncated: boolean;
}

export interface InvestigationObservation {
  id: string;
  kind: InvestigationObservationKind;
  entityIds: string[];
  entityReferencesTruncated: boolean;
  store: InvestigationStoreName;
  recordId: string;
  source: string;
  observedAt: string;
  firstObservedAt: string;
  scanDepth: InvestigationScanDepth | null;
  status: InvestigationObservationStatus;
  complete: boolean | null;
  truncated: boolean | null;
  schemaVersions: InvestigationSchemaVersions;
  limitations: string[];
}

export interface InvestigationRelationship {
  id: string;
  canonical: string;
  type: InvestigationRelationshipType;
  from: string;
  to: string;
  classification: InvestigationRelationshipClassification;
  method: string;
  sourceObservationIds: string[];
  sourceObservationsTruncated: boolean;
  firstObservedAt: string;
  lastObservedAt: string;
  complete: boolean | null;
  truncated: boolean | null;
  limitations: string[];
}

export interface InvestigationSourceSummary {
  state: InvestigationSourceState;
  version: number | null;
  records: number;
  truncated: boolean;
}

export interface InvestigationProjection {
  schema: typeof INVESTIGATION_PROJECTION_SCHEMA;
  version: typeof INVESTIGATION_PROJECTION_VERSION;
  generatedAt: string;
  sources: {
    cases: InvestigationSourceSummary;
    campaigns: InvestigationSourceSummary;
    brandProfiles: InvestigationSourceSummary;
    relationshipRows: InvestigationSourceSummary;
    relationshipObservations: InvestigationSourceSummary;
  };
  entities: InvestigationEntity[];
  observations: InvestigationObservation[];
  relationships: InvestigationRelationship[];
  truncated: boolean;
  limitations: string[];
  counts: {
    entities: number;
    observations: number;
    relationships: number;
  };
}

type UnknownRecord = Record<string, unknown>;

interface StoreRead<T> {
  state: InvestigationSourceState;
  version: number | null;
  records: T[];
  truncated: boolean;
  limitation: string;
}

interface NormalizedCaseEvidenceSnapshot {
  id: string;
  capturedAt: string;
  firstCapturedAt: string;
  source: string;
  scanDepth: string;
  riskModelVersion: number | null;
  httpSummaryVersion: number | null;
  nameservers: string[];
  httpEvidenceStatus: string | null;
  httpFinalOrigin: string | null;
}

interface NormalizedCaseRecord {
  id: string;
  domain: string;
  status: string;
  disposition: string;
  source: string;
  evidenceHistory: NormalizedCaseEvidenceSnapshot[];
  updatedAt: string;
}

interface NormalizedBrandProfile {
  id: string;
  name: string;
  officialDomains: string[];
  officialFaviconHash: string;
  pageBaseline: unknown;
  updatedAt: string;
}

interface NormalizedCampaign {
  id: string;
  name: string;
  domains: string[];
  updatedAt: string;
}

interface ObservationCandidate {
  id: string;
  kind: InvestigationObservationKind;
  entityIds: string[];
  store: InvestigationStoreName;
  recordId: string;
  source: string;
  observedAt: string;
  firstObservedAt?: string | null;
  scanDepth: InvestigationScanDepth | null;
  status: InvestigationObservationStatus;
  complete: boolean | null;
  truncated: boolean | null;
  schemaVersions: InvestigationSchemaVersions;
  limitations: readonly unknown[];
}

interface RelationshipCandidate {
  type: InvestigationRelationshipType;
  from: string;
  to: string;
  classification: InvestigationRelationshipClassification;
  method: string;
}

const CONTROL_RE = /[\x00-\x1f\x7f]/;
const HASH_RE = /^[a-f0-9]{64}$/i;
const SCAN_DEPTHS = new Set<InvestigationScanDepth>(['fast', 'deep', 'unknown']);
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

const BASE_LIMITATIONS = Object.freeze([
  'This projection uses only bounded evidence already retained locally or explicitly supplied normalized scan observations. It makes no network requests.',
  'Shared infrastructure and identifiers are investigation pivots, not proof of ownership, coordination, intent, or maliciousness.',
  'Missing, unsupported, partial, or inconclusive source data does not create a negative finding or an evidence edge.',
]);

const RETAINED_RELATIONSHIP_PROJECTION = Object.freeze({
  nameserver_set: { entity: 'nameserver_set', relationship: 'domain_uses_nameserver_set' },
  ip_address: { entity: 'ip_address', relationship: 'domain_resolved_to_ip' },
  certificate: { entity: 'certificate', relationship: 'domain_presented_certificate' },
  tracking_identifier: { entity: 'tracking_identifier', relationship: 'domain_exposed_tracking_identifier' },
  favicon: { entity: 'favicon_cluster', relationship: 'domain_related_by_favicon' },
  official_asset: { entity: 'official_asset_host', relationship: 'domain_loaded_official_asset' },
} satisfies Record<RelationshipObservationType, {
  entity: InvestigationEntityType;
  relationship: InvestigationRelationshipType;
}>);

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function text(value: unknown, maximum = 300): string {
  if (typeof value !== 'string' || value.length > maximum * 4 || CONTROL_RE.test(value)) return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maximum).trim();
}

function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64 || CONTROL_RE.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function schemaVersion(value: unknown): number | null {
  const item = record(value);
  return item && typeof item.version === 'number' && Number.isSafeInteger(item.version) && item.version > 0
    ? item.version
    : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function hashString(value: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36);
}

/** Deterministic compact id; the canonical value remains on the entity/edge. */
function stableId(prefix: string, value: string): string {
  return `${prefix}:${hashString(value, 2166136261)}-${hashString(value, 3339675911)}`;
}

function sha256(value: unknown): string {
  return typeof value === 'string' && HASH_RE.test(value) ? value.toLowerCase() : '';
}

function httpOrigin(value: unknown): string {
  if (typeof value !== 'string' || value.length > 300 || CONTROL_RE.test(value)) return '';
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password
      || parsed.pathname !== '/' || parsed.search || parsed.hash) return '';
    return parsed.origin.toLowerCase();
  } catch {
    return '';
  }
}

function boundedLimitations(value: unknown, maximum = MAX_PROJECTION_LIMITATIONS): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const candidate of (Array.isArray(value) ? value : []).slice(0, maximum * 4)) {
    const normalized = text(candidate, 300);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= maximum) break;
  }
  return output;
}

function scanDepth(value: unknown): InvestigationScanDepth {
  return typeof value === 'string' && SCAN_DEPTHS.has(value as InvestigationScanDepth)
    ? value as InvestigationScanDepth
    : 'unknown';
}

function readStore<T>(
  raw: unknown,
  key: string,
  supportedVersion: number,
  maximum: number,
  normalize: (value: unknown) => unknown,
): StoreRead<T> {
  if (raw === undefined || raw === null) {
    return { state: 'absent', version: null, records: [], truncated: false, limitation: '' };
  }
  const envelope = record(raw);
  const declared = schemaVersion(raw);
  if (envelope && Object.prototype.hasOwnProperty.call(envelope, 'version') && declared === null) {
    return { state: 'invalid', version: null, records: [], truncated: false, limitation: `${key} declared an invalid schema version and was not interpreted.` };
  }
  if (declared !== null && declared > supportedVersion) {
    return {
      state: 'unsupported',
      version: declared,
      records: [],
      truncated: false,
      limitation: `${key} schema ${declared} is newer than supported schema ${supportedVersion}; it was not interpreted.`,
    };
  }
  if (!Array.isArray(raw) && (!envelope || !Array.isArray(envelope[key]))) {
    return { state: 'invalid', version: declared, records: [], truncated: false, limitation: `${key} input was malformed and was not interpreted.` };
  }
  const sourceRecords = Array.isArray(raw)
    ? raw
    : (Array.isArray(envelope?.[key]) ? envelope[key] : []);
  const sourceTruncated = sourceRecords.length > maximum;
  const normalized = record(normalize(raw));
  return {
    state: 'supported',
    version: declared ?? supportedVersion,
    records: (Array.isArray(normalized?.[key]) ? normalized[key] : []) as T[],
    truncated: sourceTruncated,
    limitation: sourceTruncated ? `${key} exceeded ${maximum} retained records and was truncated.` : '',
  };
}

function readRelationshipRows(raw: unknown): StoreRead<unknown> {
  if (raw === undefined || raw === null) return { state: 'absent', version: null, records: [], truncated: false, limitation: '' };
  if (!Array.isArray(raw)) {
    return { state: 'invalid', version: null, records: [], truncated: false, limitation: 'relationshipRows input was malformed and was not interpreted.' };
  }
  return {
    state: 'supported',
    version: RELATIONSHIP_EVIDENCE_VERSION,
    records: raw.slice(0, MAX_RELATIONSHIP_ROWS),
    truncated: raw.length > MAX_RELATIONSHIP_ROWS,
    limitation: raw.length > MAX_RELATIONSHIP_ROWS
      ? `relationshipRows exceeded ${MAX_RELATIONSHIP_ROWS} records and was truncated.`
      : '',
  };
}

function mergeComplete(left: boolean | null, right: boolean | null): boolean | null {
  if (left === false || right === false) return false;
  if (left === true && right === true) return true;
  return null;
}

function mergeTruncated(left: boolean | null, right: boolean | null): boolean | null {
  if (left === true || right === true) return true;
  if (left === false && right === false) return false;
  return null;
}

/**
 * Builds a deterministic, bounded typed projection from the current local
 * case, campaign, and Brand Profile contracts plus optional scan-local
 * relationship rows and analyst-retained relationship observations. Source
 * values are normalized again at this trust boundary and are never mutated.
 */
export function buildInvestigationProjection(
  rawInput: unknown,
  options: InvestigationProjectionOptions = {},
): InvestigationProjection {
  const input = record(rawInput) || {};
  const cases = readStore<NormalizedCaseRecord>(input.cases, 'cases', CASE_SCHEMA_VERSION, MAX_CASES, normalizeCaseStore);
  const campaigns = readStore<NormalizedCampaign>(input.campaigns, 'campaigns', CAMPAIGN_SCHEMA_VERSION, MAX_CAMPAIGNS, normalizeCampaignStore);
  const brands = readStore<NormalizedBrandProfile>(input.brandProfiles, 'profiles', BRAND_PROFILE_SCHEMA_VERSION, MAX_PROFILES, normalizeBrandProfileStore);
  const relationshipRows = readRelationshipRows(input.relationshipRows);
  const relationshipObservations = readStore<RelationshipObservation>(
    input.relationshipObservations,
    'observations',
    RELATIONSHIP_OBSERVATION_SCHEMA_VERSION,
    MAX_RELATIONSHIP_OBSERVATIONS,
    normalizeRelationshipObservationStore,
  );
  const sourceReads = { cases, campaigns, brandProfiles: brands, relationshipRows, relationshipObservations };

  const entities = new Map<string, InvestigationEntity>();
  const observations = new Map<string, InvestigationObservation>();
  const relationships = new Map<string, InvestigationRelationship>();
  let truncated = Object.values(sourceReads).some((source) => source.truncated);
  const projectionLimitations = [...BASE_LIMITATIONS];
  for (const source of Object.values(sourceReads)) {
    if (source.limitation) projectionLimitations.push(source.limitation);
  }

  function addEntity(
    type: InvestigationEntityType,
    canonical: string,
    label: string,
    properties: Record<string, unknown>,
  ): InvestigationEntity | null {
    if (!ENTITY_TYPES.has(type) || !canonical) return null;
    const id = stableId(type, canonical);
    const existing = entities.get(id);
    if (existing) {
      if (existing.canonical === canonical) return existing;
      truncated = true;
      return null;
    }
    if (entities.size >= MAX_PROJECTION_ENTITIES) { truncated = true; return null; }
    const entity = {
      id,
      type,
      canonical,
      label: text(label, 300) || type,
      properties,
      observationIds: [],
      observationsTruncated: false,
    };
    entities.set(id, entity);
    return entity;
  }

  function addObservation(candidate: ObservationCandidate): InvestigationObservation | null {
    const existing = observations.get(candidate.id);
    if (existing) return existing;
    if (observations.size >= MAX_PROJECTION_OBSERVATIONS) { truncated = true; return null; }
    const sourceEntityIds = [...new Set(candidate.entityIds.filter((id) => entities.has(id)))].sort();
    const entityIds = sourceEntityIds.slice(0, MAX_PROJECTION_REFERENCES);
    if (!entityIds.length) return null;
    const observation = {
      ...candidate,
      entityIds,
      entityReferencesTruncated: sourceEntityIds.length > entityIds.length,
      firstObservedAt: timestamp(candidate.firstObservedAt) || candidate.observedAt,
      limitations: boundedLimitations(candidate.limitations),
    };
    observations.set(observation.id, observation);
    for (const entityId of entityIds) {
      const entity = entities.get(entityId);
      if (!entity) continue;
      if (entity.observationIds.length < MAX_PROJECTION_REFERENCES) entity.observationIds.push(observation.id);
      else entity.observationsTruncated = true;
    }
    return observation;
  }

  function linkObservationEntity(
    observation: InvestigationObservation | null,
    entity: InvestigationEntity | null,
  ): void {
    if (!observation || !entity || observation.entityIds.includes(entity.id)) return;
    if (observation.entityIds.length < MAX_PROJECTION_REFERENCES) {
      observation.entityIds.push(entity.id);
      observation.entityIds.sort();
    } else observation.entityReferencesTruncated = true;
    if (entity.observationIds.length < MAX_PROJECTION_REFERENCES) {
      if (!entity.observationIds.includes(observation.id)) {
        entity.observationIds.push(observation.id);
        entity.observationIds.sort();
      }
    } else entity.observationsTruncated = true;
  }

  function addRelationship(
    candidate: RelationshipCandidate,
    observation: InvestigationObservation | null,
  ): InvestigationRelationship | null {
    if (!candidate?.from || !candidate?.to || !entities.has(candidate.from) || !entities.has(candidate.to)
      || !observation || !observations.has(observation.id)) return null;
    const canonical = [candidate.type, candidate.from, candidate.to, candidate.classification, candidate.method].join('|');
    const id = stableId('relationship', canonical);
    const existing = relationships.get(id);
    if (existing) {
      if (existing.canonical !== canonical) { truncated = true; return null; }
      if (!existing.sourceObservationIds.includes(observation.id)) {
        if (existing.sourceObservationIds.length < MAX_PROJECTION_REFERENCES) {
          existing.sourceObservationIds.push(observation.id);
          existing.sourceObservationIds.sort();
        } else existing.sourceObservationsTruncated = true;
      }
      if (observation.firstObservedAt < existing.firstObservedAt) existing.firstObservedAt = observation.firstObservedAt;
      if (observation.observedAt > existing.lastObservedAt) existing.lastObservedAt = observation.observedAt;
      existing.complete = mergeComplete(existing.complete, observation.complete);
      existing.truncated = mergeTruncated(existing.truncated, observation.truncated);
      existing.limitations = boundedLimitations([...existing.limitations, ...observation.limitations]);
      return existing;
    }
    if (relationships.size >= MAX_PROJECTION_RELATIONSHIPS) { truncated = true; return null; }
    const relationship = {
      id,
      canonical,
      type: candidate.type,
      from: candidate.from,
      to: candidate.to,
      classification: candidate.classification,
      method: text(candidate.method, 200),
      sourceObservationIds: [observation.id],
      sourceObservationsTruncated: false,
      firstObservedAt: observation.firstObservedAt,
      lastObservedAt: observation.observedAt,
      complete: observation.complete,
      truncated: observation.truncated,
      limitations: boundedLimitations(observation.limitations),
    };
    relationships.set(id, relationship);
    return relationship;
  }

  function projectCaseSnapshot(
    snapshot: NormalizedCaseEvidenceSnapshot,
    caseRecord: NormalizedCaseRecord,
    domainEntity: InvestigationEntity,
    caseEntity: InvestigationEntity,
  ): void {
    const observedAt = timestamp(snapshot.capturedAt);
    if (!observedAt) return;
    const observation = addObservation({
      id: stableId('observation', `case-evidence|${caseRecord.id}|${snapshot.id}|${observedAt}`),
      kind: 'case_evidence',
      entityIds: [caseEntity.id, domainEntity.id],
      store: 'cases',
      recordId: caseRecord.id,
      source: text(snapshot.source, 40) || 'unknown',
      observedAt,
      firstObservedAt: timestamp(snapshot.firstCapturedAt) || observedAt,
      scanDepth: scanDepth(snapshot.scanDepth),
      status: 'partial',
      complete: null,
      truncated: null,
      schemaVersions: {
        case: cases.version,
        riskModel: positiveInteger(snapshot.riskModelVersion),
        httpSummary: positiveInteger(snapshot.httpSummaryVersion),
      },
      limitations: [
        'Compact case evidence does not retain a complete source-health or source-truncation envelope.',
        ...(snapshot.scanDepth === 'unknown' ? ['Scan depth is unknown, so deep-only fields are not comparable.'] : []),
      ],
    });
    if (!observation) return;

    const nameservers = [...new Set(snapshot.nameservers.map(normalizeDomain).filter(Boolean))].sort();
    if (nameservers.length) {
      const value = nameservers.join('|');
      const entity = addEntity('nameserver_set', value, nameservers.join(' · '), { nameservers });
      if (entity) {
        linkObservationEntity(observation, entity);
        addRelationship({
          type: 'domain_uses_nameserver_set',
          from: domainEntity.id,
          to: entity.id,
          classification: 'normalized',
          method: 'Exact retained normalized nameserver set',
        }, observation);
      }
    }
    if (snapshot.scanDepth === 'deep' && snapshot.httpEvidenceStatus
      && ['success', 'partial'].includes(snapshot.httpEvidenceStatus)) {
      const origin = httpOrigin(snapshot.httpFinalOrigin);
      const entity = origin ? addEntity('http_origin', origin, origin, { origin }) : null;
      if (entity) {
        linkObservationEntity(observation, entity);
        addRelationship({
          type: 'domain_reached_http_origin',
          from: domainEntity.id,
          to: entity.id,
          classification: 'normalized',
          method: 'Exact normalized final HTTP(S) origin from comparable deep evidence',
        }, observation);
      }
    }
  }

  const caseByDomain = new Map<string, InvestigationEntity>();
  const orderedCases = [...cases.records].sort((left, right) => (
    String(right.updatedAt).localeCompare(String(left.updatedAt))
    || String(left.domain).localeCompare(String(right.domain))
    || String(left.id).localeCompare(String(right.id))
  ));
  for (const caseRecord of orderedCases) {
    const domain = normalizeDomain(caseRecord.domain);
    if (!domain) continue;
    const domainEntity = addEntity('domain', domain, domain, { domain });
    const caseEntity = addEntity('case', caseRecord.id, domain, {
      caseId: caseRecord.id,
      domain,
      status: text(caseRecord.status, 40),
      disposition: text(caseRecord.disposition, 40),
    });
    if (!domainEntity || !caseEntity) continue;
    caseByDomain.set(domain, caseEntity);
    const observedAt = timestamp(caseRecord.updatedAt);
    if (!observedAt) continue;
    const caseObservation = addObservation({
      id: stableId('observation', `case-record|${caseRecord.id}|${observedAt}`),
      kind: 'case_record',
      entityIds: [caseEntity.id, domainEntity.id],
      store: 'cases',
      recordId: caseRecord.id,
      source: text(caseRecord.source, 40) || 'unknown',
      observedAt,
      scanDepth: null,
      status: 'success',
      complete: true,
      truncated: false,
      schemaVersions: { case: cases.version },
      limitations: [],
    });
    addRelationship({
      type: 'case_documents_domain',
      from: caseEntity.id,
      to: domainEntity.id,
      classification: 'direct',
      method: 'Canonical domain stored on the analyst case',
    }, caseObservation);
    for (const snapshot of [...caseRecord.evidenceHistory].reverse()) {
      projectCaseSnapshot(snapshot, caseRecord, domainEntity, caseEntity);
    }
  }

  for (const profile of brands.records) {
    const brandEntity = addEntity('brand', profile.id, profile.name, { profileId: profile.id, name: profile.name });
    const observedAt = timestamp(profile.updatedAt);
    if (!brandEntity || !observedAt) continue;
    const profileObservation = addObservation({
      id: stableId('observation', `brand-profile|${profile.id}|${observedAt}`),
      kind: 'brand_profile',
      entityIds: [brandEntity.id],
      store: 'brandProfiles',
      recordId: profile.id,
      source: 'analyst_profile',
      observedAt,
      scanDepth: null,
      status: 'success',
      complete: true,
      truncated: false,
      schemaVersions: { brandProfile: brands.version },
      limitations: [],
    });
    for (const domain of profile.officialDomains) {
      const domainEntity = addEntity('domain', domain, domain, { domain });
      if (!domainEntity || !profileObservation) continue;
      linkObservationEntity(profileObservation, domainEntity);
      addRelationship({
        type: 'brand_declares_official_domain',
        from: brandEntity.id,
        to: domainEntity.id,
        classification: 'direct',
        method: 'Domain configured as official in the Brand Profile',
      }, profileObservation);
    }
    const officialFavicon = sha256(profile.officialFaviconHash);
    const faviconEntity = officialFavicon
      ? addEntity('favicon', officialFavicon, `${officialFavicon.slice(0, 12)}…`, { sha256: officialFavicon })
      : null;
    if (faviconEntity && profileObservation) {
      linkObservationEntity(profileObservation, faviconEntity);
      addRelationship({
        type: 'brand_declares_official_favicon',
        from: brandEntity.id,
        to: faviconEntity.id,
        classification: 'direct',
        method: 'Exact SHA-256 configured in the Brand Profile',
      }, profileObservation);
    }

    const baseline = record(profile.pageBaseline);
    const baselineDomain = normalizeDomain(baseline?.domain);
    const baselineObservedAt = timestamp(baseline?.observedAt);
    const baselineFavicon = sha256(baseline?.faviconHash);
    if (baseline && baselineDomain && baselineObservedAt) {
      const domainEntity = addEntity('domain', baselineDomain, baselineDomain, { domain: baselineDomain });
      const baselineFaviconEntity = baselineFavicon
        ? addEntity('favicon', baselineFavicon, `${baselineFavicon.slice(0, 12)}…`, { sha256: baselineFavicon })
        : null;
      if (!domainEntity) continue;
      const baselineObservation = addObservation({
        id: stableId('observation', `brand-baseline|${profile.id}|${baselineObservedAt}`),
        kind: 'brand_page_baseline',
        entityIds: [brandEntity.id, domainEntity.id, ...(baselineFaviconEntity ? [baselineFaviconEntity.id] : [])],
        store: 'brandProfiles',
        recordId: profile.id,
        source: 'official_site_baseline',
        observedAt: baselineObservedAt,
        scanDepth: 'deep',
        status: baseline.complete === true ? 'success' : 'partial',
        complete: baseline.complete === true,
        truncated: baseline.truncated === true,
        schemaVersions: {
          brandProfile: brands.version,
          pageBaseline: positiveInteger(baseline.baselineVersion),
          pageIdentity: positiveInteger(baseline.pageIdentityVersion),
          pageFingerprint: positiveInteger(baseline.fingerprintVersion),
        },
        limitations: baseline.complete === true ? [] : ['The retained official-site baseline is partial or truncated.'],
      });
      if (baselineFaviconEntity) addRelationship({
        type: 'domain_observed_favicon',
        from: domainEntity.id,
        to: baselineFaviconEntity.id,
        classification: 'normalized',
        method: 'Exact retained favicon SHA-256 from the official-site baseline',
      }, baselineObservation);
    }
  }

  for (const campaign of campaigns.records) {
    const campaignEntity = addEntity('campaign', campaign.id, campaign.name, { campaignId: campaign.id, name: campaign.name });
    const observedAt = timestamp(campaign.updatedAt);
    if (!campaignEntity || !observedAt) continue;
    const campaignObservation = addObservation({
      id: stableId('observation', `campaign|${campaign.id}|${observedAt}`),
      kind: 'campaign_record',
      entityIds: [campaignEntity.id],
      store: 'campaigns',
      recordId: campaign.id,
      source: 'analyst_campaign',
      observedAt,
      scanDepth: null,
      status: 'success',
      complete: true,
      truncated: false,
      schemaVersions: { campaign: campaigns.version },
      limitations: [],
    });
    for (const domain of campaign.domains) {
      const domainEntity = addEntity('domain', domain, domain, { domain });
      if (!domainEntity || !campaignObservation) continue;
      linkObservationEntity(campaignObservation, domainEntity);
      addRelationship({
        type: 'campaign_contains_domain',
        from: campaignEntity.id,
        to: domainEntity.id,
        classification: 'direct',
        method: 'Canonical domain membership stored on the analyst campaign',
      }, campaignObservation);
      const caseEntity = caseByDomain.get(domain);
      if (caseEntity) {
        linkObservationEntity(campaignObservation, caseEntity);
        addRelationship({
          type: 'campaign_contains_case',
          from: campaignEntity.id,
          to: caseEntity.id,
          classification: 'derived',
          method: 'Exact canonical-domain match between campaign membership and a local case',
        }, campaignObservation);
      }
    }
  }

  for (const row of relationshipRows.records) {
    const value = record(row);
    const domain = normalizeDomain(value?.domain);
    const observedAt = timestamp(value?.observedAt);
    const relation = record(value?.relationship);
    if (!value || !domain || !observedAt || !relation || relation.version !== RELATIONSHIP_EVIDENCE_VERSION) {
      const relationVersion = relation ? positiveInteger(relation.version) : null;
      if (relationVersion !== null && relationVersion > RELATIONSHIP_EVIDENCE_VERSION) {
        projectionLimitations.push(`A relationship observation used unsupported schema ${relationVersion} and was not interpreted.`);
      }
      continue;
    }
    const domainEntity = addEntity('domain', domain, domain, { domain });
    if (!domainEntity) continue;
    const nameserverInput = Array.isArray(relation.nameservers) ? relation.nameservers : [];
    const relationshipInputTruncated = relation.truncated === true || nameserverInput.length > MAX_NAMESERVERS_PER_ROW;
    if (relationshipInputTruncated) truncated = true;
    const nameservers = [...new Set(nameserverInput.slice(0, MAX_NAMESERVERS_PER_ROW)
      .map(normalizeDomain).filter(Boolean))].sort();
    const favicon = sha256(relation.faviconHash);
    const certificate = sha256(relation.certificateFingerprint);
    const observationIdentity = JSON.stringify({ nameservers, favicon, certificate, truncated: relationshipInputTruncated });
    const observation = addObservation({
      id: stableId('observation', `relationship-row|${domain}|${observedAt}|${observationIdentity}`),
      kind: 'scan_relationship_evidence',
      entityIds: [domainEntity.id],
      store: 'relationshipRows',
      recordId: domain,
      source: text(value.source, 40) || 'bulk',
      observedAt,
      scanDepth: scanDepth(value.scanDepth),
      status: relationshipInputTruncated ? 'partial' : 'success',
      complete: null,
      truncated: relationshipInputTruncated,
      schemaVersions: { relationshipEvidence: RELATIONSHIP_EVIDENCE_VERSION },
      limitations: ['Scan-local relationship evidence does not retain a complete source-health envelope.'],
    });
    if (!observation) continue;
    if (nameservers.length) {
      const entity = addEntity('nameserver_set', nameservers.join('|'), nameservers.join(' · '), { nameservers });
      if (entity) {
        linkObservationEntity(observation, entity);
        addRelationship({
          type: 'domain_uses_nameserver_set',
          from: domainEntity.id,
          to: entity.id,
          classification: 'normalized',
          method: 'Exact normalized nameserver set from scan-local relationship evidence',
        }, observation);
      }
    }
    const faviconEntity = favicon
      ? addEntity('favicon', favicon, `${favicon.slice(0, 12)}…`, { sha256: favicon })
      : null;
    if (faviconEntity) {
      linkObservationEntity(observation, faviconEntity);
      addRelationship({
        type: 'domain_observed_favicon',
        from: domainEntity.id,
        to: faviconEntity.id,
        classification: 'normalized',
        method: 'Exact retained favicon SHA-256 from scan-local evidence',
      }, observation);
    }
    const certificateEntity = certificate
      ? addEntity('certificate', certificate, `${certificate.slice(0, 12)}…`, { sha256: certificate })
      : null;
    if (certificateEntity) {
      linkObservationEntity(observation, certificateEntity);
      addRelationship({
        type: 'domain_presented_certificate',
        from: domainEntity.id,
        to: certificateEntity.id,
        classification: 'normalized',
        method: 'Exact native TLS leaf-certificate SHA-256 from scan-local evidence',
      }, observation);
    }
  }

  for (const retained of relationshipObservations.records) {
    const definition = RETAINED_RELATIONSHIP_PROJECTION[retained.type];
    const observedAt = timestamp(retained.observedAt);
    if (!definition || !observedAt) continue;
    const canonical = retained.normalizedValue.length <= 300 ? retained.normalizedValue : retained.id;
    const display = text(retained.displayValue, 300) || text(retained.label, 100) || retained.type.replaceAll('_', ' ');
    const properties: Record<string, unknown> = {
      observationId: retained.id,
      relationshipType: retained.type,
      value: retained.normalizedValue.length <= 300 ? retained.normalizedValue : '',
    };
    if (retained.type === 'nameserver_set') {
      properties.nameservers = retained.normalizedValue.split(' · ').map(normalizeDomain).filter(Boolean).slice(0, MAX_NAMESERVERS_PER_ROW);
    } else if (retained.type === 'certificate' && sha256(retained.normalizedValue)) {
      properties.sha256 = sha256(retained.normalizedValue);
    } else if (retained.type === 'ip_address') properties.ipAddress = retained.normalizedValue;
    else if (retained.type === 'tracking_identifier') properties.identifier = retained.normalizedValue;
    else if (retained.type === 'official_asset') properties.domain = normalizeDomain(retained.normalizedValue);
    const targetEntity = addEntity(definition.entity, canonical, display, properties);
    if (!targetEntity) continue;
    const domainEntities = retained.domains.map((domain) => addEntity('domain', domain, domain, { domain })).filter(Boolean) as InvestigationEntity[];
    if (!domainEntities.length) continue;
    const observation = addObservation({
      id: stableId('observation', `retained-relationship|${retained.id}|${observedAt}`),
      kind: 'retained_relationship_observation',
      entityIds: [targetEntity.id, ...domainEntities.map((entity) => entity.id)],
      store: 'relationshipObservations',
      recordId: retained.id,
      source: retained.source,
      observedAt,
      scanDepth: null,
      status: retained.complete && !retained.truncated ? 'success' : 'partial',
      complete: retained.complete,
      truncated: retained.truncated,
      schemaVersions: {
        relationshipEvidence: retained.sourceVersion,
        relationshipObservation: RELATIONSHIP_OBSERVATION_SCHEMA_VERSION,
      },
      limitations: [
        ...retained.limitations,
        'This relationship was retained by an explicit analyst action after Bulk derived it from bounded observations.',
      ],
    });
    for (const domainEntity of domainEntities) {
      addRelationship({
        type: definition.relationship,
        from: domainEntity.id,
        to: targetEntity.id,
        classification: 'derived',
        method: retained.method,
      }, observation);
    }
  }

  for (const entity of entities.values()) entity.observationIds.sort();
  const summarizeSource = <T>(value: StoreRead<T>): InvestigationSourceSummary => ({
    state: value.state,
    version: value.version,
    records: value.records.length,
    truncated: value.truncated,
  });
  const sourceSummary: InvestigationProjection['sources'] = {
    cases: summarizeSource(sourceReads.cases),
    campaigns: summarizeSource(sourceReads.campaigns),
    brandProfiles: summarizeSource(sourceReads.brandProfiles),
    relationshipRows: summarizeSource(sourceReads.relationshipRows),
    relationshipObservations: summarizeSource(sourceReads.relationshipObservations),
  };
  const generatedAt = timestamp(options.generatedAt) || new Date().toISOString();
  const entityList = [...entities.values()]
    .filter((entity) => entity.observationIds.length > 0)
    .sort((left, right) => left.id.localeCompare(right.id));
  const observationList = [...observations.values()].sort((left, right) => left.observedAt.localeCompare(right.observedAt)
    || left.id.localeCompare(right.id));
  const relationshipList = [...relationships.values()].sort((left, right) => left.id.localeCompare(right.id));
  return {
    schema: INVESTIGATION_PROJECTION_SCHEMA,
    version: INVESTIGATION_PROJECTION_VERSION,
    generatedAt,
    sources: sourceSummary,
    entities: entityList,
    observations: observationList,
    relationships: relationshipList,
    truncated,
    limitations: boundedLimitations(projectionLimitations),
    counts: {
      entities: entityList.length,
      observations: observationList.length,
      relationships: relationshipList.length,
    },
  };
}
