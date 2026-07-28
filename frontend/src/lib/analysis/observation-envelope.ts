// Incremental, read-only common envelope for browser-local evidence adapters.
// Existing collection schemas remain authoritative. Adapters normalize one
// collection at a time into this disposable form for search and graph use;
// they never rewrite, delete, or silently migrate the source collection.

import { normalizeDomain } from './case-model.ts';
import {
  MAX_RELATIONSHIP_OBSERVATIONS,
  RELATIONSHIP_OBSERVATION_SCHEMA,
  RELATIONSHIP_OBSERVATION_SCHEMA_VERSION,
  normalizeRelationshipObservationStore,
  relationshipObservationStoreVersion,
  type RelationshipObservationType,
} from './relationship-observation-model.ts';

export const OBSERVATION_ENVELOPE_SCHEMA = 'whoisleuth.observation-envelope';
export const OBSERVATION_ENVELOPE_VERSION = 1;
export const RELATIONSHIP_OBSERVATION_ADAPTER_ID = 'relationship-observations-v1';
export const RELATIONSHIP_OBSERVATION_ADAPTER_VERSION = 1;
export const MAX_ENVELOPE_ENTITIES = 6_000;
export const MAX_ENVELOPE_OBSERVATIONS = 4_000;
export const MAX_ENVELOPE_RELATIONSHIPS = 10_000;
export const MAX_ENVELOPE_ARTIFACT_REFERENCES = 2_000;
export const MAX_ENVELOPE_ASSERTIONS = 2_000;
export const MAX_ENVELOPE_REFERENCES = 100;
export const MAX_ENVELOPE_LIMITATIONS = 20;
export const MAX_ENVELOPE_BYTES = 8 * 1024 * 1024;

export type ObservationEnvelopeDerivation = 'observed' | 'normalized' | 'derived' | 'analyst';
export type ObservationEnvelopeDepth = 'fast' | 'deep' | 'unknown' | null;
export type ObservationEnvelopeStatus = 'success' | 'partial';
export type ObservationEnvelopeAssertionKind =
  | 'verified_fact'
  | 'hypothesis'
  | 'unknown'
  | 'contradiction'
  | 'next_step'
  | 'decision';

export interface ObservationEnvelopeSourceSchema {
  collection: string;
  schema: string;
  version: number;
}

export interface ObservationEnvelopeEntity {
  version: 1;
  id: string;
  type: string;
  canonical: string;
  label: string;
  properties: Record<string, string | string[]>;
  sourceSchema: ObservationEnvelopeSourceSchema;
}

export interface ObservationEnvelopeObservation {
  version: 1;
  id: string;
  kind: string;
  entityIds: string[];
  sourceRecordId: string;
  source: string;
  observedAt: string;
  collectionDepth: ObservationEnvelopeDepth;
  status: ObservationEnvelopeStatus;
  complete: boolean | null;
  truncated: boolean | null;
  derivation: ObservationEnvelopeDerivation;
  sourceSchema: ObservationEnvelopeSourceSchema;
  upstreamSchemas: ObservationEnvelopeSourceSchema[];
  limitations: string[];
}

export interface ObservationEnvelopeRelationship {
  version: 1;
  id: string;
  type: string;
  from: string;
  to: string;
  method: string;
  derivation: ObservationEnvelopeDerivation;
  sourceObservationIds: string[];
  firstObservedAt: string;
  lastObservedAt: string;
  complete: boolean | null;
  truncated: boolean | null;
  limitations: string[];
}

export interface ObservationEnvelopeArtifactReference {
  version: 1;
  id: string;
  kind: string;
  sourceRecordId: string;
  observationIds: string[];
  mediaType: string | null;
  digest: string | null;
  observedAt: string;
  complete: boolean | null;
  truncated: boolean | null;
  limitations: string[];
}

export interface ObservationEnvelopeAnalystAssertion {
  version: 1;
  id: string;
  kind: ObservationEnvelopeAssertionKind;
  state: 'open' | 'resolved' | 'recorded';
  statement: string;
  rationale: string | null;
  entityIds: string[];
  artifactReferenceIds: string[];
  sourceRecordId: string;
  createdAt: string;
  updatedAt: string;
  limitations: string[];
}

export interface ObservationEnvelopeDocument {
  schema: typeof OBSERVATION_ENVELOPE_SCHEMA;
  version: typeof OBSERVATION_ENVELOPE_VERSION;
  generatedAt: string;
  adapter: {
    id: typeof RELATIONSHIP_OBSERVATION_ADAPTER_ID;
    version: typeof RELATIONSHIP_OBSERVATION_ADAPTER_VERSION;
    source: ObservationEnvelopeSourceSchema;
  };
  entities: ObservationEnvelopeEntity[];
  observations: ObservationEnvelopeObservation[];
  relationships: ObservationEnvelopeRelationship[];
  artifactReferences: ObservationEnvelopeArtifactReference[];
  assertions: ObservationEnvelopeAnalystAssertion[];
  quota: {
    records: number;
    maximumRecords: number;
    bytes: number;
    maximumBytes: number;
    truncated: boolean;
  };
  rollback: {
    authoritativeCollection: 'relationship_observations';
    writesPerformed: false;
    detail: string;
  };
  limitations: string[];
}

export type ObservationEnvelopeReadResult =
  | Readonly<{ state: 'absent' | 'invalid' | 'unsupported'; version: number | null; document: null; detail: string }>
  | Readonly<{ state: 'ready'; version: 1; document: ObservationEnvelopeDocument; detail: '' }>;

export type RelationshipObservationAdapterResult =
  | Readonly<{ state: 'invalid' | 'unsupported'; sourceVersion: number | null; document: null; detail: string }>
  | Readonly<{ state: 'ready'; sourceVersion: number; document: ObservationEnvelopeDocument; detail: '' }>;

type UnknownRecord = Record<string, unknown>;
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const SOURCE_SCHEMA: ObservationEnvelopeSourceSchema = Object.freeze({
  collection: 'relationship_observations',
  schema: RELATIONSHIP_OBSERVATION_SCHEMA,
  version: RELATIONSHIP_OBSERVATION_SCHEMA_VERSION,
});
const RELATIONSHIP_MAPPING = Object.freeze({
  nameserver_set: { entity: 'nameserver_set', relationship: 'domain_uses_nameserver_set' },
  ip_address: { entity: 'ip_address', relationship: 'domain_resolved_to_ip' },
  certificate: { entity: 'certificate', relationship: 'domain_presented_certificate' },
  tracking_identifier: { entity: 'tracking_identifier', relationship: 'domain_exposed_tracking_identifier' },
  favicon: { entity: 'favicon_cluster', relationship: 'domain_related_by_favicon' },
  official_asset: { entity: 'official_asset_host', relationship: 'domain_loaded_official_asset' },
} satisfies Record<RelationshipObservationType, { entity: string; relationship: string }>);
const BASE_LIMITATIONS = Object.freeze([
  'This disposable envelope is derived from the current bounded retained-relationship collection and makes no network request.',
  'The source IndexedDB collection remains authoritative and is neither rewritten nor deleted by this adapter.',
  'Shared infrastructure and identifiers are investigation pivots, not proof of ownership, coordination, intent, or maliciousness.',
]);

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function text(value: unknown, maximum = 300): string {
  if (typeof value !== 'string' || value.length > maximum * 4 || CONTROL_RE.test(value)) return '';
  return value.replace(/\s+/gu, ' ').trim().slice(0, maximum).trim();
}

function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64 || CONTROL_RE.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function byteLength(value: unknown): number | null {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === 'string'
      ? new TextEncoder().encode(serialized).byteLength
      : null;
  } catch {
    return null;
  }
}

function hashString(value: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36);
}

export function observationEnvelopeId(prefix: string, canonical: string): string {
  const safePrefix = text(prefix, 40).toLowerCase().replace(/[^a-z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'record';
  return `${safePrefix}:${hashString(canonical, 2166136261)}-${hashString(canonical, 3339675911)}`;
}

function boundedLimitations(value: unknown): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const candidate of (Array.isArray(value) ? value : []).slice(0, MAX_ENVELOPE_LIMITATIONS * 4)) {
    const limitation = text(candidate, 300);
    if (!limitation || seen.has(limitation)) continue;
    seen.add(limitation);
    output.push(limitation);
    if (output.length >= MAX_ENVELOPE_LIMITATIONS) break;
  }
  return output;
}

function entityCanonical(type: RelationshipObservationType, value: string, sourceRecordId: string): string {
  return value.length <= 300 ? value : sourceRecordId;
}

function targetProperties(
  type: RelationshipObservationType,
  value: string,
  sourceRecordId: string,
): Record<string, string | string[]> {
  const properties: Record<string, string | string[]> = {
    observationId: sourceRecordId,
    relationshipType: type,
    value: value.length <= 300 ? value : '',
  };
  if (type === 'nameserver_set') {
    properties.nameservers = value.split(' · ').map(normalizeDomain).filter(Boolean).slice(0, 20);
    return properties;
  }
  if (type === 'certificate') properties.sha256 = value;
  if (type === 'ip_address') properties.ipAddress = value;
  if (type === 'tracking_identifier') properties.identifier = value;
  if (type === 'official_asset') properties.domain = normalizeDomain(value);
  return properties;
}

function documentBytes(document: ObservationEnvelopeDocument): number | null {
  let candidate = document.quota.bytes;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const measured = byteLength({ ...document, quota: { ...document.quota, bytes: candidate } });
    if (measured === null) return null;
    if (measured === candidate) return measured;
    candidate = measured;
  }
  return candidate;
}

export function adaptRelationshipObservationsToEnvelope(
  raw: unknown,
  options: Readonly<{ generatedAt?: unknown }> = {},
): RelationshipObservationAdapterResult {
  const input = record(raw);
  const declaredVersion = relationshipObservationStoreVersion(raw);
  if (input && Object.prototype.hasOwnProperty.call(input, 'version') && declaredVersion === null) {
    return {
      state: 'invalid',
      sourceVersion: null,
      document: null,
      detail: 'The retained-relationship collection declared an invalid schema version and was not adapted.',
    };
  }
  if (declaredVersion !== null && declaredVersion > RELATIONSHIP_OBSERVATION_SCHEMA_VERSION) {
    return {
      state: 'unsupported',
      sourceVersion: declaredVersion,
      document: null,
      detail: `Retained-relationship schema ${declaredVersion} is newer than supported schema ${RELATIONSHIP_OBSERVATION_SCHEMA_VERSION}; it was not adapted.`,
    };
  }
  if (!Array.isArray(raw) && (!input || !Array.isArray(input.observations))) {
    return {
      state: 'invalid',
      sourceVersion: declaredVersion,
      document: null,
      detail: 'The retained-relationship collection was malformed and was not adapted.',
    };
  }

  const normalized = normalizeRelationshipObservationStore(raw);
  const entities = new Map<string, ObservationEnvelopeEntity>();
  const observations: ObservationEnvelopeObservation[] = [];
  const relationships: ObservationEnvelopeRelationship[] = [];
  let truncated = false;

  function addEntity(type: string, canonical: string, label: string, properties: Record<string, string | string[]>): ObservationEnvelopeEntity | null {
    const id = observationEnvelopeId(type, canonical);
    const existing = entities.get(id);
    if (existing) return existing.canonical === canonical ? existing : null;
    if (entities.size >= MAX_ENVELOPE_ENTITIES) {
      truncated = true;
      return null;
    }
    const entity: ObservationEnvelopeEntity = {
      version: 1,
      id,
      type,
      canonical,
      label: text(label, 300) || type,
      properties,
      sourceSchema: SOURCE_SCHEMA,
    };
    entities.set(id, entity);
    return entity;
  }

  for (const retained of normalized.observations.slice(0, MAX_RELATIONSHIP_OBSERVATIONS)) {
    if (observations.length >= MAX_ENVELOPE_OBSERVATIONS) {
      truncated = true;
      break;
    }
    const definition = RELATIONSHIP_MAPPING[retained.type];
    const target = addEntity(
      definition.entity,
      entityCanonical(retained.type, retained.normalizedValue, retained.id),
      retained.displayValue || retained.label,
      targetProperties(retained.type, retained.normalizedValue, retained.id),
    );
    const domains = retained.domains
      .map((domain) => addEntity('domain', domain, domain, { domain }))
      .filter((entity): entity is ObservationEnvelopeEntity => entity !== null);
    if (!target || !domains.length) continue;
    const observedAt = timestamp(retained.observedAt);
    if (!observedAt) continue;
    const observationId = observationEnvelopeId('observation', `retained-relationship|${retained.id}|${observedAt}`);
    const entityIds = [target.id, ...domains.map((entity) => entity.id)].slice(0, MAX_ENVELOPE_REFERENCES);
    if (entityIds.length < domains.length + 1) truncated = true;
    const limitations = boundedLimitations([
      ...retained.limitations,
      'This relationship was retained by an explicit analyst action after Bulk derived it from bounded observations.',
    ]);
    const observation: ObservationEnvelopeObservation = {
      version: 1,
      id: observationId,
      kind: 'retained_relationship_observation',
      entityIds,
      sourceRecordId: retained.id,
      source: retained.source,
      observedAt,
      collectionDepth: null,
      status: retained.complete && !retained.truncated ? 'success' : 'partial',
      complete: retained.complete,
      truncated: retained.truncated,
      derivation: 'derived',
      sourceSchema: {
        ...SOURCE_SCHEMA,
        version: declaredVersion ?? RELATIONSHIP_OBSERVATION_SCHEMA_VERSION,
      },
      upstreamSchemas: [{
        collection: 'bulk_relationship_evidence',
        schema: 'whoisleuth.relationship-evidence',
        version: retained.sourceVersion,
      }],
      limitations,
    };
    observations.push(observation);
    for (const domain of domains) {
      if (relationships.length >= MAX_ENVELOPE_RELATIONSHIPS) {
        truncated = true;
        break;
      }
      relationships.push({
        version: 1,
        id: observationEnvelopeId('relationship', `${definition.relationship}|${domain.id}|${target.id}|${retained.method}`),
        type: definition.relationship,
        from: domain.id,
        to: target.id,
        method: text(retained.method, 200),
        derivation: 'derived',
        sourceObservationIds: [observation.id],
        firstObservedAt: observedAt,
        lastObservedAt: observedAt,
        complete: retained.complete,
        truncated: retained.truncated,
        limitations,
      });
    }
  }

  const entityList = [...entities.values()].sort((left, right) => left.id.localeCompare(right.id));
  observations.sort((left, right) => left.observedAt.localeCompare(right.observedAt) || left.id.localeCompare(right.id));
  relationships.sort((left, right) => left.id.localeCompare(right.id));
  const maximumRecords = MAX_ENVELOPE_ENTITIES
    + MAX_ENVELOPE_OBSERVATIONS
    + MAX_ENVELOPE_RELATIONSHIPS
    + MAX_ENVELOPE_ARTIFACT_REFERENCES
    + MAX_ENVELOPE_ASSERTIONS;
  const records = entityList.length + observations.length + relationships.length;
  const generatedAt = timestamp(options.generatedAt) || new Date().toISOString();
  const document: ObservationEnvelopeDocument = {
    schema: OBSERVATION_ENVELOPE_SCHEMA,
    version: OBSERVATION_ENVELOPE_VERSION,
    generatedAt,
    adapter: {
      id: RELATIONSHIP_OBSERVATION_ADAPTER_ID,
      version: RELATIONSHIP_OBSERVATION_ADAPTER_VERSION,
      source: {
        ...SOURCE_SCHEMA,
        version: declaredVersion ?? RELATIONSHIP_OBSERVATION_SCHEMA_VERSION,
      },
    },
    entities: entityList,
    observations,
    relationships,
    artifactReferences: [],
    assertions: [],
    quota: {
      records,
      maximumRecords,
      bytes: 0,
      maximumBytes: MAX_ENVELOPE_BYTES,
      truncated,
    },
    rollback: {
      authoritativeCollection: 'relationship_observations',
      writesPerformed: false,
      detail: 'Discard this disposable envelope to roll back; the source collection and workspace archive remain unchanged.',
    },
    limitations: boundedLimitations([
      ...BASE_LIMITATIONS,
      ...(truncated ? ['The common envelope reached an entity, observation, relationship, or reference cap and is partial.'] : []),
    ]),
  };
  const bytes = documentBytes(document);
  if (bytes === null || bytes > MAX_ENVELOPE_BYTES) {
    return {
      state: 'invalid',
      sourceVersion: declaredVersion ?? RELATIONSHIP_OBSERVATION_SCHEMA_VERSION,
      document: null,
      detail: `The derived common envelope exceeded its ${MAX_ENVELOPE_BYTES}-byte quota and was not exposed.`,
    };
  }
  document.quota.bytes = bytes;
  return {
    state: 'ready',
    sourceVersion: declaredVersion ?? RELATIONSHIP_OBSERVATION_SCHEMA_VERSION,
    document,
    detail: '',
  };
}

export function readObservationEnvelopeDocument(value: unknown): ObservationEnvelopeReadResult {
  if (value === null || value === undefined) {
    return { state: 'absent', version: null, document: null, detail: 'No common observation envelope was available.' };
  }
  const item = record(value);
  const version = positiveInteger(item?.version);
  if (!item || item.schema !== OBSERVATION_ENVELOPE_SCHEMA || version === null) {
    return { state: 'invalid', version, document: null, detail: 'The common observation envelope was malformed.' };
  }
  if (version > OBSERVATION_ENVELOPE_VERSION) {
    return {
      state: 'unsupported',
      version,
      document: null,
      detail: `Common observation envelope schema ${version} is newer than supported schema ${OBSERVATION_ENVELOPE_VERSION}; it was not interpreted.`,
    };
  }
  const serializedBytes = byteLength(item);
  const adapter = record(item.adapter);
  const adapterSource = record(adapter?.source);
  const quota = record(item.quota);
  const rollback = record(item.rollback);
  const generatedAt = timestamp(item.generatedAt);
  if (version !== OBSERVATION_ENVELOPE_VERSION
    || !generatedAt
    || adapter?.id !== RELATIONSHIP_OBSERVATION_ADAPTER_ID
    || adapter?.version !== RELATIONSHIP_OBSERVATION_ADAPTER_VERSION
    || adapterSource?.collection !== SOURCE_SCHEMA.collection
    || adapterSource?.schema !== SOURCE_SCHEMA.schema
    || positiveInteger(adapterSource?.version) === null
    || !Array.isArray(item.entities)
    || !Array.isArray(item.observations)
    || !Array.isArray(item.relationships)
    || !Array.isArray(item.artifactReferences)
    || !Array.isArray(item.assertions)
    || item.entities.length > MAX_ENVELOPE_ENTITIES
    || item.observations.length > MAX_ENVELOPE_OBSERVATIONS
    || item.relationships.length > MAX_ENVELOPE_RELATIONSHIPS
    || item.artifactReferences.length > MAX_ENVELOPE_ARTIFACT_REFERENCES
    || item.assertions.length > MAX_ENVELOPE_ASSERTIONS
    || serializedBytes === null
    || serializedBytes > MAX_ENVELOPE_BYTES
    || !quota
    || !Number.isSafeInteger(quota.records)
    || typeof quota.records !== 'number'
    || quota.records < 0
    || quota.maximumRecords !== MAX_ENVELOPE_ENTITIES + MAX_ENVELOPE_OBSERVATIONS
      + MAX_ENVELOPE_RELATIONSHIPS + MAX_ENVELOPE_ARTIFACT_REFERENCES + MAX_ENVELOPE_ASSERTIONS
    || quota.bytes !== serializedBytes
    || quota.maximumBytes !== MAX_ENVELOPE_BYTES
    || typeof quota.truncated !== 'boolean'
    || rollback?.authoritativeCollection !== 'relationship_observations'
    || rollback?.writesPerformed !== false
    || !text(rollback?.detail, 300)
    || !Array.isArray(item.limitations)) {
    return { state: 'invalid', version, document: null, detail: 'The common observation envelope exceeded its structural or byte bounds.' };
  }

  const sourceSchema = (valueToRead: unknown): ObservationEnvelopeSourceSchema | null => {
    const source = record(valueToRead);
    const sourceVersion = positiveInteger(source?.version);
    const collection = text(source?.collection, 80);
    const schema = text(source?.schema, 120);
    return collection && schema && sourceVersion
      ? { collection, schema, version: sourceVersion }
      : null;
  };
  const originalText = (valueToRead: unknown, maximum: number): string | null => {
    const normalized = text(valueToRead, maximum);
    return normalized && normalized === valueToRead ? normalized : null;
  };
  const triState = (valueToRead: unknown): boolean | null | undefined => (
    valueToRead === null || typeof valueToRead === 'boolean' ? valueToRead : undefined
  );
  const strings = (valueToRead: unknown, maximum: number, itemMaximum = 300): string[] | null => {
    if (!Array.isArray(valueToRead) || valueToRead.length > maximum) return null;
    const result: string[] = [];
    const seen = new Set<string>();
    for (const candidate of valueToRead) {
      const normalized = originalText(candidate, itemMaximum);
      if (!normalized || seen.has(normalized)) return null;
      seen.add(normalized);
      result.push(normalized);
    }
    return result;
  };
  const properties = (valueToRead: unknown): Record<string, string | string[]> | null => {
    const inputProperties = record(valueToRead);
    if (!inputProperties || Object.keys(inputProperties).length > 30) return null;
    const output: Record<string, string | string[]> = {};
    for (const [key, property] of Object.entries(inputProperties)) {
      const safeKey = originalText(key, 80);
      if (!safeKey) return null;
      if (typeof property === 'string') {
        const safeValue = originalText(property, 20_000);
        if (safeValue === null) return null;
        output[safeKey] = safeValue;
      } else {
        const safeValues = strings(property, MAX_ENVELOPE_REFERENCES, 300);
        if (!safeValues) return null;
        output[safeKey] = safeValues;
      }
    }
    return output;
  };

  const entities: ObservationEnvelopeEntity[] = [];
  for (const candidate of item.entities) {
    const valueToRead = record(candidate);
    const id = originalText(valueToRead?.id, 200);
    const type = originalText(valueToRead?.type, 80);
    const canonical = originalText(valueToRead?.canonical, 300);
    const label = originalText(valueToRead?.label, 300);
    const entityProperties = properties(valueToRead?.properties);
    const entitySource = sourceSchema(valueToRead?.sourceSchema);
    if (valueToRead?.version !== 1 || !id || !type || !canonical || !label || !entityProperties || !entitySource) {
      return { state: 'invalid', version, document: null, detail: 'The common observation envelope contained a malformed entity.' };
    }
    entities.push({ version: 1, id, type, canonical, label, properties: entityProperties, sourceSchema: entitySource });
  }
  const entityIds = new Set(entities.map((entity) => entity.id));
  if (entityIds.size !== entities.length) {
    return { state: 'invalid', version, document: null, detail: 'The common observation envelope contained duplicate entity identifiers.' };
  }

  const derivations = new Set<ObservationEnvelopeDerivation>(['observed', 'normalized', 'derived', 'analyst']);
  const statuses = new Set<ObservationEnvelopeStatus>(['success', 'partial']);
  const depths = new Set<Exclude<ObservationEnvelopeDepth, null>>(['fast', 'deep', 'unknown']);
  const observations: ObservationEnvelopeObservation[] = [];
  for (const candidate of item.observations) {
    const valueToRead = record(candidate);
    const id = originalText(valueToRead?.id, 200);
    const kind = originalText(valueToRead?.kind, 100);
    const referencedEntities = strings(valueToRead?.entityIds, MAX_ENVELOPE_REFERENCES, 200);
    const sourceRecordId = originalText(valueToRead?.sourceRecordId, 200);
    const source = originalText(valueToRead?.source, 100);
    const observedAt = timestamp(valueToRead?.observedAt);
    const depth = valueToRead?.collectionDepth;
    const status = valueToRead?.status;
    const complete = triState(valueToRead?.complete);
    const truncated = triState(valueToRead?.truncated);
    const derivation = valueToRead?.derivation;
    const observationSource = sourceSchema(valueToRead?.sourceSchema);
    const upstreamInputs = Array.isArray(valueToRead?.upstreamSchemas)
      ? valueToRead.upstreamSchemas
      : null;
    const upstreamSchemas = upstreamInputs && upstreamInputs.length <= 10
      ? upstreamInputs.map(sourceSchema)
      : null;
    const limitations = strings(valueToRead?.limitations, MAX_ENVELOPE_LIMITATIONS);
    if (valueToRead?.version !== 1 || !id || !kind || !referencedEntities?.length
      || referencedEntities.some((entityId) => !entityIds.has(entityId))
      || !sourceRecordId || !source || !observedAt
      || (depth !== null && (typeof depth !== 'string' || !depths.has(depth as Exclude<ObservationEnvelopeDepth, null>)))
      || typeof status !== 'string' || !statuses.has(status as ObservationEnvelopeStatus)
      || complete === undefined || truncated === undefined
      || typeof derivation !== 'string' || !derivations.has(derivation as ObservationEnvelopeDerivation)
      || !observationSource || !upstreamSchemas || upstreamSchemas.some((source) => source === null) || !limitations) {
      return { state: 'invalid', version, document: null, detail: 'The common observation envelope contained a malformed observation.' };
    }
    observations.push({
      version: 1,
      id,
      kind,
      entityIds: referencedEntities,
      sourceRecordId,
      source,
      observedAt,
      collectionDepth: depth as ObservationEnvelopeDepth,
      status: status as ObservationEnvelopeStatus,
      complete,
      truncated,
      derivation: derivation as ObservationEnvelopeDerivation,
      sourceSchema: observationSource,
      upstreamSchemas: upstreamSchemas as ObservationEnvelopeSourceSchema[],
      limitations,
    });
  }
  const observationIds = new Set(observations.map((observation) => observation.id));
  if (observationIds.size !== observations.length) {
    return { state: 'invalid', version, document: null, detail: 'The common observation envelope contained duplicate observation identifiers.' };
  }

  const relationships: ObservationEnvelopeRelationship[] = [];
  for (const candidate of item.relationships) {
    const valueToRead = record(candidate);
    const id = originalText(valueToRead?.id, 200);
    const type = originalText(valueToRead?.type, 100);
    const from = originalText(valueToRead?.from, 200);
    const to = originalText(valueToRead?.to, 200);
    const method = originalText(valueToRead?.method, 200);
    const derivation = valueToRead?.derivation;
    const sourceObservationIds = strings(valueToRead?.sourceObservationIds, MAX_ENVELOPE_REFERENCES, 200);
    const firstObservedAt = timestamp(valueToRead?.firstObservedAt);
    const lastObservedAt = timestamp(valueToRead?.lastObservedAt);
    const complete = triState(valueToRead?.complete);
    const truncated = triState(valueToRead?.truncated);
    const limitations = strings(valueToRead?.limitations, MAX_ENVELOPE_LIMITATIONS);
    if (valueToRead?.version !== 1 || !id || !type || !from || !to || !method
      || !entityIds.has(from) || !entityIds.has(to)
      || typeof derivation !== 'string' || !derivations.has(derivation as ObservationEnvelopeDerivation)
      || !sourceObservationIds?.length
      || sourceObservationIds.some((observationId) => !observationIds.has(observationId))
      || !firstObservedAt || !lastObservedAt || firstObservedAt > lastObservedAt
      || complete === undefined || truncated === undefined || !limitations) {
      return { state: 'invalid', version, document: null, detail: 'The common observation envelope contained a malformed relationship.' };
    }
    relationships.push({
      version: 1,
      id,
      type,
      from,
      to,
      method,
      derivation: derivation as ObservationEnvelopeDerivation,
      sourceObservationIds,
      firstObservedAt,
      lastObservedAt,
      complete,
      truncated,
      limitations,
    });
  }
  if (new Set(relationships.map((relationship) => relationship.id)).size !== relationships.length) {
    return { state: 'invalid', version, document: null, detail: 'The common observation envelope contained duplicate relationship identifiers.' };
  }

  const artifactReferences: ObservationEnvelopeArtifactReference[] = [];
  for (const candidate of item.artifactReferences) {
    const valueToRead = record(candidate);
    const id = originalText(valueToRead?.id, 200);
    const kind = originalText(valueToRead?.kind, 100);
    const sourceRecordId = originalText(valueToRead?.sourceRecordId, 200);
    const referencedObservations = strings(valueToRead?.observationIds, MAX_ENVELOPE_REFERENCES, 200);
    const mediaType = valueToRead?.mediaType === null ? null : originalText(valueToRead?.mediaType, 100);
    const digest = valueToRead?.digest === null ? null : originalText(valueToRead?.digest, 200);
    const observedAt = timestamp(valueToRead?.observedAt);
    const complete = triState(valueToRead?.complete);
    const truncated = triState(valueToRead?.truncated);
    const limitations = strings(valueToRead?.limitations, MAX_ENVELOPE_LIMITATIONS);
    if (valueToRead?.version !== 1 || !id || !kind || !sourceRecordId
      || !referencedObservations
      || referencedObservations.some((observationId) => !observationIds.has(observationId))
      || mediaType === undefined || digest === undefined || !observedAt
      || complete === undefined || truncated === undefined || !limitations) {
      return { state: 'invalid', version, document: null, detail: 'The common observation envelope contained a malformed artifact reference.' };
    }
    artifactReferences.push({
      version: 1,
      id,
      kind,
      sourceRecordId,
      observationIds: referencedObservations,
      mediaType,
      digest,
      observedAt,
      complete,
      truncated,
      limitations,
    });
  }
  const artifactIds = new Set(artifactReferences.map((artifact) => artifact.id));
  if (artifactIds.size !== artifactReferences.length) {
    return { state: 'invalid', version, document: null, detail: 'The common observation envelope contained duplicate artifact-reference identifiers.' };
  }

  const assertionKinds = new Set<ObservationEnvelopeAssertionKind>([
    'verified_fact', 'hypothesis', 'unknown', 'contradiction', 'next_step', 'decision',
  ]);
  const assertionStates = new Set<ObservationEnvelopeAnalystAssertion['state']>(['open', 'resolved', 'recorded']);
  const assertions: ObservationEnvelopeAnalystAssertion[] = [];
  for (const candidate of item.assertions) {
    const valueToRead = record(candidate);
    const id = originalText(valueToRead?.id, 200);
    const kind = valueToRead?.kind;
    const state = valueToRead?.state;
    const statement = originalText(valueToRead?.statement, 1_000);
    const rationale = valueToRead?.rationale === null ? null : originalText(valueToRead?.rationale, 1_000);
    const referencedEntities = strings(valueToRead?.entityIds, MAX_ENVELOPE_REFERENCES, 200);
    const referencedArtifacts = strings(valueToRead?.artifactReferenceIds, MAX_ENVELOPE_REFERENCES, 200);
    const sourceRecordId = originalText(valueToRead?.sourceRecordId, 200);
    const createdAt = timestamp(valueToRead?.createdAt);
    const updatedAt = timestamp(valueToRead?.updatedAt);
    const limitations = strings(valueToRead?.limitations, MAX_ENVELOPE_LIMITATIONS);
    if (valueToRead?.version !== 1 || !id
      || typeof kind !== 'string' || !assertionKinds.has(kind as ObservationEnvelopeAssertionKind)
      || typeof state !== 'string' || !assertionStates.has(state as ObservationEnvelopeAnalystAssertion['state'])
      || !statement || rationale === undefined || !referencedEntities || !referencedArtifacts
      || referencedEntities.some((entityId) => !entityIds.has(entityId))
      || referencedArtifacts.some((artifactId) => !artifactIds.has(artifactId))
      || !sourceRecordId || !createdAt || !updatedAt || createdAt > updatedAt || !limitations) {
      return { state: 'invalid', version, document: null, detail: 'The common observation envelope contained a malformed analyst assertion.' };
    }
    assertions.push({
      version: 1,
      id,
      kind: kind as ObservationEnvelopeAssertionKind,
      state: state as ObservationEnvelopeAnalystAssertion['state'],
      statement,
      rationale,
      entityIds: referencedEntities,
      artifactReferenceIds: referencedArtifacts,
      sourceRecordId,
      createdAt,
      updatedAt,
      limitations,
    });
  }
  if (new Set(assertions.map((assertion) => assertion.id)).size !== assertions.length
    || quota.records !== entities.length + observations.length + relationships.length
      + artifactReferences.length + assertions.length) {
    return { state: 'invalid', version, document: null, detail: 'The common observation envelope record accounting was inconsistent.' };
  }

  const limitations = strings(item.limitations, MAX_ENVELOPE_LIMITATIONS);
  if (!limitations) {
    return { state: 'invalid', version, document: null, detail: 'The common observation envelope limitations were malformed.' };
  }
  return {
    state: 'ready',
    version: 1,
    document: {
      schema: OBSERVATION_ENVELOPE_SCHEMA,
      version: 1,
      generatedAt,
      adapter: {
        id: RELATIONSHIP_OBSERVATION_ADAPTER_ID,
        version: RELATIONSHIP_OBSERVATION_ADAPTER_VERSION,
        source: sourceSchema(adapterSource) as ObservationEnvelopeSourceSchema,
      },
      entities,
      observations,
      relationships,
      artifactReferences,
      assertions,
      quota: {
        records: quota.records,
        maximumRecords: quota.maximumRecords as number,
        bytes: quota.bytes as number,
        maximumBytes: quota.maximumBytes as number,
        truncated: quota.truncated,
      },
      rollback: {
        authoritativeCollection: 'relationship_observations',
        writesPerformed: false,
        detail: text(rollback.detail, 300),
      },
      limitations,
    },
    detail: '',
  };
}
