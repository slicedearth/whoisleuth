// Bounded cross-case comparison over evidence already retained in the
// browser-local case store. These relationships are investigation pivots, not
// ownership, coordination, intent, or maliciousness conclusions. No network
// request, aggregate score, or new persisted record is produced here.

import {
  type CaseEvidenceSnapshot,
  MAX_CASES,
  MAX_EVIDENCE_SNAPSHOTS_PER_CASE,
  normalizeDomain,
  normalizeSnapshot,
} from './case-model.ts';
import {
  INVESTIGATION_PROJECTION_SCHEMA,
  INVESTIGATION_PROJECTION_VERSION,
  MAX_PROJECTION_ENTITIES,
  MAX_PROJECTION_LIMITATIONS,
  MAX_PROJECTION_OBSERVATIONS,
  MAX_PROJECTION_RELATIONSHIPS,
} from './investigation-projection.ts';

export const CASE_RELATIONSHIP_VERSION = 1;
export const MAX_RELATIONSHIP_CASES = MAX_CASES;
export const MAX_CASE_RELATIONSHIP_GROUPS = 100;
export const MAX_CASES_PER_RELATIONSHIP = 50;
export const INVESTIGATION_CASE_RELATIONSHIP_VERSION = 1;
export const MAX_RELATIONSHIP_PROVENANCE_OBSERVATIONS = 100;
export const MAX_RELATIONSHIP_SCOPE_OPTIONS = 100;
export const MAX_RELATIONSHIP_SOURCE_OPTIONS = 100;
export const MAX_RELATIONSHIP_METHODS = 4;
export const MAX_RELATIONSHIP_CLASSIFICATIONS = 4;

const SAFE_CASE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const PROJECTION_RELATIONSHIP_TYPES = new Map([
  ['domain_uses_nameserver_set', {
    type: 'nameserver_set',
    label: 'Shared nameserver set',
    description: 'Retained observations connect these cases to the same exact normalized nameserver set. Shared DNS providers are common.',
  }],
  ['domain_reached_http_origin', {
    type: 'http_final_origin',
    label: 'Shared final website origin',
    description: 'Retained comparable deep observations connect these cases to the same normalized website origin. Redirectors, parking services, CDNs, and shared platforms are common.',
  }],
  ['domain_resolved_to_ip', {
    type: 'ip_address',
    label: 'Shared IP address',
    description: 'An analyst-retained Bulk observation connects these cases to the same normalized IP address. Shared hosting, CDNs, and managed platforms are common.',
  }],
  ['domain_presented_certificate', {
    type: 'certificate',
    label: 'Shared TLS certificate',
    description: 'An analyst-retained observation connects these cases to the same exact leaf-certificate SHA-256. Multi-domain certificates and shared infrastructure are common.',
  }],
  ['domain_exposed_tracking_identifier', {
    type: 'tracking_identifier',
    label: 'Shared tracking identifier',
    description: 'An analyst-retained observation connects these cases to the same recognized public page identifier.',
  }],
  ['domain_related_by_favicon', {
    type: 'favicon',
    label: 'Similar favicon',
    description: 'An analyst-retained observation records an exact or bounded perceptual favicon comparison between these cases.',
  }],
  ['domain_loaded_official_asset', {
    type: 'official_asset',
    label: 'Official asset relationship',
    description: 'An analyst-retained observation records that these cases loaded an asset from the same configured official domain or subdomain.',
  }],
]);
const PROJECTION_FILTER_TYPES = new Set(['all', ...[...PROJECTION_RELATIONSHIP_TYPES.values()].map((value) => value.type)]);
const PROJECTION_FILTER_PERIODS = new Set(['all', '7d', '30d', '365d']);
const PROJECTION_FILTER_COMPLETENESS = new Set(['all', 'complete', 'partial', 'unknown']);
const PERIOD_MILLISECONDS = new Map([['7d', 7 * 86400000], ['30d', 30 * 86400000], ['365d', 365 * 86400000]]);
const PROJECTION_SCHEMA_VERSION_FIELDS = ['case', 'riskModel', 'httpSummary', 'brandProfile', 'pageBaseline', 'pageIdentity', 'pageFingerprint', 'campaign', 'relationshipEvidence', 'relationshipObservation'];

export interface CaseRelationshipMember {
  id: string;
  domain: string;
  entityId?: string;
}

export interface CaseRelationshipCampaign {
  id: string;
  label: string;
  entityId: string;
}

export interface CaseRelationshipObservation {
  id: string;
  source: string;
  store: string;
  observedAt: string;
  firstObservedAt: string;
  scanDepth: string;
  status: string;
  complete: boolean | null;
  truncated: boolean | null;
  schemaVersions: Record<string, number>;
  limitations: string[];
}

export interface CaseRelationshipGroup {
  type: string;
  label: string;
  method: string;
  value: string;
  cases: CaseRelationshipMember[];
  description: string;
  methods?: string[];
  classifications?: string[];
  campaigns?: CaseRelationshipCampaign[];
  sources?: string[];
  scanDepths?: string[];
  firstObservedAt?: string;
  lastObservedAt?: string;
  complete?: boolean | null;
  truncated?: boolean;
  observations?: CaseRelationshipObservation[];
  omittedObservations?: number;
  limitations?: string[];
}

export interface CaseRelationshipScopeOption {
  value: string;
  kind: 'case' | 'campaign';
  label: string;
}

export interface CaseRelationshipSummary {
  version: number;
  groups: CaseRelationshipGroup[];
  truncated: boolean;
  limitations: string[];
  projectionVersion?: number | null;
  state?: string;
  generatedAt?: string;
  sources?: string[];
  scopeOptions?: CaseRelationshipScopeOption[];
  filterOptionsTruncated?: boolean;
}

export interface CaseRelationshipFilterOptions {
  type?: unknown;
  source?: unknown;
  period?: unknown;
  completeness?: unknown;
  scope?: unknown;
  [key: string]: unknown;
}

interface ProjectionDefinition {
  type: string;
  label: string;
  description: string;
}

interface ProjectionEntity {
  id: string;
  type: string;
  canonical: unknown;
  label: unknown;
  properties: Record<string, unknown>;
}

interface ProjectionCaseMember extends CaseRelationshipMember {
  entityId: string;
}

interface ProjectionBucket {
  type: string;
  label: string;
  value: string;
  description: string;
  cases: Map<string, ProjectionCaseMember>;
  campaigns: Map<string, CaseRelationshipCampaign>;
  methods: Set<string>;
  classifications: Set<string>;
  observations: Map<string, CaseRelationshipObservation>;
  limitations: unknown[];
  firstObservedAt: string;
  lastObservedAt: string;
  complete: boolean | null;
  truncated: boolean;
}

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeCaseId(value: unknown): string {
  return typeof value === 'string' && SAFE_CASE_ID_RE.test(value) ? value : '';
}

function normalizedOrigin(value: unknown): string {
  if (typeof value !== 'string' || value.length > 300 || /[\x00-\x1f\x7f]/.test(value)) return '';
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password
      || parsed.pathname !== '/' || parsed.search || parsed.hash) return '';
    return parsed.origin.toLowerCase();
  } catch {
    return '';
  }
}

function latestNormalizedSnapshot(value: unknown): CaseEvidenceSnapshot | null {
  if (!Array.isArray(value)) return null;
  let latest: CaseEvidenceSnapshot | null = null;
  for (const candidate of value.slice(0, MAX_EVIDENCE_SNAPSHOTS_PER_CASE)) {
    const snapshot = normalizeSnapshot(candidate);
    if (!snapshot) continue;
    if (!latest || Date.parse(snapshot.capturedAt) > Date.parse(latest.capturedAt)) latest = snapshot;
  }
  return latest;
}

function addBucket(
  buckets: Map<string, Map<string, string>>,
  value: string,
  id: string,
  domain: string,
): void {
  if (!value) return;
  if (!buckets.has(value)) buckets.set(value, new Map());
  buckets.get(value)?.set(id, domain);
}

/**
 * @param {string} type
 * @param {string} label
 * @param {string} method
 * @param {string} value
 * @param {Array<{id:string,domain:string}>} cases
 * @param {string} description
 */
function group(
  type: string,
  label: string,
  method: string,
  value: string,
  cases: CaseRelationshipMember[],
  description: string,
): CaseRelationshipGroup {
  return { type, label, method, value, cases, description };
}

/**
 * Builds deterministic relationships from the latest valid evidence snapshot
 * in each case. Nameserver comparison uses the bounded retained normalized set;
 * final-origin comparison requires a deep HTTP observation.
 * @param {unknown} rawCases
 */
export function buildCaseRelationships(rawCases: unknown): CaseRelationshipSummary {
  const input = Array.isArray(rawCases) ? rawCases : [];
  let truncated = input.length > MAX_RELATIONSHIP_CASES;
  const nameserverSets = new Map<string, Map<string, string>>();
  const finalOrigins = new Map<string, Map<string, string>>();
  const seenIds = new Set<string>();
  const seenDomains = new Set<string>();

  for (const raw of input.slice(0, MAX_RELATIONSHIP_CASES)) {
    const item = plainRecord(raw);
    if (!item) continue;
    const id = safeCaseId(item.id);
    const domain = normalizeDomain(item.domain);
    if (!id || !domain || seenIds.has(id) || seenDomains.has(domain)) {
      if (id && domain) truncated = true;
      continue;
    }
    if (!Array.isArray(item.evidenceHistory)
      || item.evidenceHistory.length > MAX_EVIDENCE_SNAPSHOTS_PER_CASE) {
      if (Array.isArray(item.evidenceHistory)) truncated = true;
      continue;
    }
    const snapshot = latestNormalizedSnapshot(item.evidenceHistory);
    if (!snapshot) continue;
    seenIds.add(id);
    seenDomains.add(domain);

    if (snapshot.nameservers.length) {
      addBucket(nameserverSets, snapshot.nameservers.join(' · '), id, domain);
    }
    if (snapshot.scanDepth === 'deep'
      && (snapshot.httpEvidenceStatus === 'success' || snapshot.httpEvidenceStatus === 'partial')) {
      addBucket(finalOrigins, normalizedOrigin(snapshot.httpFinalOrigin), id, domain);
    }
  }

  const output: CaseRelationshipGroup[] = [];
  for (const [value, records] of nameserverSets) {
    if (records.size < 2) continue;
    output.push(group(
      'nameserver_set',
      'Shared nameserver set',
      'Exact retained normalized set',
      value,
      [...records].map(([id, domain]) => ({ id, domain })).sort((a, b) => a.domain.localeCompare(b.domain)),
      'The latest retained evidence for these cases contains the same bounded normalized nameserver set. Shared DNS providers are common.',
    ));
  }
  for (const [value, records] of finalOrigins) {
    if (records.size < 2) continue;
    output.push(group(
      'http_final_origin',
      'Shared final website origin',
      'Exact normalized HTTP(S) origin',
      value,
      [...records].map(([id, domain]) => ({ id, domain })).sort((a, b) => a.domain.localeCompare(b.domain)),
      'The latest retained deep evidence for these cases ended at the same website origin. Redirectors, parking services, CDNs, and shared platforms are common.',
    ));
  }

  const order = new Map<string, number>([
    'nameserver_set',
    'http_final_origin',
    'ip_address',
    'certificate',
    'tracking_identifier',
    'favicon',
    'official_asset',
  ].map((value, index) => [value, index]));
  output.sort((left, right) => (Number(order.get(left.type)) - Number(order.get(right.type)))
    || left.value.localeCompare(right.value)
    || left.cases.map((item) => item.domain).join('|').localeCompare(right.cases.map((item) => item.domain).join('|')));
  if (output.length > MAX_CASE_RELATIONSHIP_GROUPS) truncated = true;
  const groups = output.slice(0, MAX_CASE_RELATIONSHIP_GROUPS).map((item) => {
    if (item.cases.length <= MAX_CASES_PER_RELATIONSHIP) return item;
    truncated = true;
    return { ...item, cases: item.cases.slice(0, MAX_CASES_PER_RELATIONSHIP) };
  });

  return {
    version: CASE_RELATIONSHIP_VERSION,
    groups,
    truncated,
    limitations: [
      'Cross-case relationships compare only the latest compact evidence already stored in this browser and make no new network requests.',
      'Shared infrastructure or destinations are investigation pivots, not proof of common ownership, coordination, intent, or maliciousness.',
      'Older evidence snapshots may contain different observations; this comparison is not a historical campaign reconstruction.',
    ],
  };
}

function safeProjectionText(value: unknown, maximum = 300): string {
  if (typeof value !== 'string' || value.length > maximum * 4 || /[\x00-\x1f\x7f]/.test(value)) return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maximum).trim();
}

function safeProjectionTimestamp(value: unknown): string {
  if (typeof value !== 'string' || value.length > 64 || /[\x00-\x1f\x7f]/.test(value)) return '';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function mergeProjectionComplete(left: unknown, right: unknown): boolean | null {
  if (left === false || right === false) return false;
  if (left === true && right === true) return true;
  return null;
}

function projectionLimitations(values: unknown): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const value of Array.isArray(values) ? values.slice(0, MAX_PROJECTION_LIMITATIONS * 4) : []) {
    const normalized = safeProjectionText(value, 300);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= MAX_PROJECTION_LIMITATIONS) break;
  }
  return output;
}

function projectionSchemaVersions(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return Object.fromEntries(PROJECTION_SCHEMA_VERSION_FIELDS.flatMap<[string, number]>((field) => {
    const version = record[field];
    return Number.isSafeInteger(version) && Number(version) > 0 ? [[field, Number(version)]] : [];
  }));
}

function emptyProjectionRelationships(
  state: string,
  version: number | null = null,
  limitations: unknown[] = [],
): CaseRelationshipSummary {
  return {
    version: INVESTIGATION_CASE_RELATIONSHIP_VERSION,
    projectionVersion: version,
    state,
    generatedAt: '',
    groups: [],
    sources: [],
    scopeOptions: [],
    filterOptionsTruncated: false,
    truncated: false,
    limitations: projectionLimitations([
      ...limitations,
      'Projection relationships are local investigation pivots, not proof of ownership, coordination, intent, or maliciousness.',
    ]),
  };
}

/**
 * Builds historical cross-case pivots from the current typed local projection.
 * The projection remains the evidence source; this function only groups exact
 * nameserver-set and comparable HTTP-origin relationships shared by cases.
 * @param {unknown} rawProjection
 */
export function buildInvestigationCaseRelationships(rawProjection: unknown): CaseRelationshipSummary {
  const projection = plainRecord(rawProjection);
  if (!projection) {
    return emptyProjectionRelationships('absent');
  }
  const projectionVersion = Number.isSafeInteger(projection.version) && Number(projection.version) > 0
    ? Number(projection.version)
    : null;
  if (projection.schema !== INVESTIGATION_PROJECTION_SCHEMA || projectionVersion === null) {
    return emptyProjectionRelationships('invalid', projectionVersion, ['The local investigation projection was malformed and was not interpreted.']);
  }
  if (projectionVersion > INVESTIGATION_PROJECTION_VERSION) {
    return emptyProjectionRelationships('unsupported', projectionVersion, [`Investigation projection schema ${projectionVersion} is newer than supported schema ${INVESTIGATION_PROJECTION_VERSION}; it was not interpreted.`]);
  }
  if (projectionVersion !== INVESTIGATION_PROJECTION_VERSION
    || !Array.isArray(projection.entities)
    || !Array.isArray(projection.observations)
    || !Array.isArray(projection.relationships)) {
    return emptyProjectionRelationships('invalid', projectionVersion, ['The local investigation projection did not match the current relationship contract.']);
  }

  const entities = new Map<string, ProjectionEntity>();
  for (const value of projection.entities.slice(0, MAX_PROJECTION_ENTITIES)) {
    const item = plainRecord(value);
    if (!item) continue;
    const id = safeProjectionText(item.id, 100);
    const type = safeProjectionText(item.type, 40);
    if (!id || !type || entities.has(id)) continue;
    entities.set(id, {
      id,
      type,
      canonical: item.canonical,
      label: item.label,
      properties: plainRecord(item.properties) || {},
    });
  }
  const observations = new Map<string, Record<string, unknown>>();
  for (const value of projection.observations.slice(0, MAX_PROJECTION_OBSERVATIONS)) {
    const item = plainRecord(value);
    if (!item) continue;
    const id = safeProjectionText(item.id, 100);
    if (id && !observations.has(id)) observations.set(id, item);
  }

  const relationships = projection.relationships.slice(0, MAX_PROJECTION_RELATIONSHIPS)
    .map(plainRecord)
    .filter((value): value is Record<string, unknown> => value !== null);
  const casesByDomain = new Map<string, Map<string, ProjectionCaseMember>>();
  const campaignsByDomain = new Map<string, Map<string, CaseRelationshipCampaign>>();
  for (const relationship of relationships) {
    const fromId = safeProjectionText(relationship.from, 100);
    const toId = safeProjectionText(relationship.to, 100);
    const from = entities.get(fromId);
    const to = entities.get(toId);
    if (!from || !to) continue;
    if (relationship.type === 'case_documents_domain' && from.type === 'case' && to.type === 'domain') {
      const id = safeCaseId(from.properties?.caseId || from.canonical);
      const domain = normalizeDomain(from.properties?.domain || to.properties?.domain || to.canonical);
      if (!id || !domain) continue;
      if (!casesByDomain.has(to.id)) casesByDomain.set(to.id, new Map());
      casesByDomain.get(to.id)?.set(id, { id, domain, entityId: from.id });
    }
    if (relationship.type === 'campaign_contains_domain' && from.type === 'campaign' && to.type === 'domain') {
      const id = safeCaseId(from.properties?.campaignId || from.canonical);
      const label = safeProjectionText(from.properties?.name || from.label, 100);
      if (!id || !label) continue;
      if (!campaignsByDomain.has(to.id)) campaignsByDomain.set(to.id, new Map());
      campaignsByDomain.get(to.id)?.set(id, { id, label, entityId: from.id });
    }
  }

  const buckets = new Map<string, ProjectionBucket>();
  let truncated = projection.truncated === true
    || projection.entities.length > MAX_PROJECTION_ENTITIES
    || projection.observations.length > MAX_PROJECTION_OBSERVATIONS
    || projection.relationships.length > relationships.length;
  for (const relationship of relationships) {
    const relationshipType = safeProjectionText(relationship.type, 80);
    const definition = PROJECTION_RELATIONSHIP_TYPES.get(relationshipType) as ProjectionDefinition | undefined;
    if (!definition) continue;
    const domainEntity = entities.get(safeProjectionText(relationship.from, 100));
    const targetEntity = entities.get(safeProjectionText(relationship.to, 100));
    if (!domainEntity || domainEntity.type !== 'domain' || !targetEntity) continue;
    const caseMap = casesByDomain.get(domainEntity.id);
    if (!caseMap?.size) continue;
    const value = safeProjectionText(targetEntity.label || targetEntity.canonical, 300);
    if (!value) continue;
    const key = `${definition.type}\u0000${targetEntity.id}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        type: definition.type,
        label: definition.label,
        value,
        description: definition.description,
        cases: new Map<string, ProjectionCaseMember>(),
        campaigns: new Map<string, CaseRelationshipCampaign>(),
        methods: new Set<string>(),
        classifications: new Set<string>(),
        observations: new Map<string, CaseRelationshipObservation>(),
        limitations: [],
        firstObservedAt: '',
        lastObservedAt: '',
        complete: true,
        truncated: false,
      });
    }
    const bucket = buckets.get(key);
    if (!bucket) continue;
    for (const [id, item] of caseMap) bucket.cases.set(id, item);
    for (const [id, item] of (campaignsByDomain.get(domainEntity.id) || new Map())) bucket.campaigns.set(id, item);
    const method = safeProjectionText(relationship.method, 200);
    const classification = safeProjectionText(relationship.classification, 40);
    if (method) bucket.methods.add(method);
    if (classification) bucket.classifications.add(classification);
    const firstObservedAt = safeProjectionTimestamp(relationship.firstObservedAt);
    const lastObservedAt = safeProjectionTimestamp(relationship.lastObservedAt);
    if (firstObservedAt && (!bucket.firstObservedAt || firstObservedAt < bucket.firstObservedAt)) bucket.firstObservedAt = firstObservedAt;
    if (lastObservedAt && lastObservedAt > bucket.lastObservedAt) bucket.lastObservedAt = lastObservedAt;
    bucket.complete = mergeProjectionComplete(bucket.complete, relationship.complete);
    bucket.truncated ||= relationship.truncated === true || relationship.sourceObservationsTruncated === true;
    bucket.limitations.push(...(Array.isArray(relationship.limitations)
      ? relationship.limitations.slice(0, MAX_PROJECTION_LIMITATIONS * 2)
      : []));
    const sourceObservationIds = Array.isArray(relationship.sourceObservationIds) ? relationship.sourceObservationIds : [];
    if (sourceObservationIds.length > MAX_RELATIONSHIP_PROVENANCE_OBSERVATIONS * 2) bucket.truncated = true;
    for (const rawId of sourceObservationIds.slice(0, MAX_RELATIONSHIP_PROVENANCE_OBSERVATIONS * 2)) {
      const id = safeProjectionText(rawId, 100);
      const observation = observations.get(id);
      if (!observation) {
        bucket.truncated = true;
        continue;
      }
      const observedAt = safeProjectionTimestamp(observation.observedAt);
      const source = safeProjectionText(observation.source, 40);
      const store = safeProjectionText(observation.store, 40);
      if (!observedAt || !source || !store) continue;
      bucket.observations.set(id, {
        id,
        source,
        store,
        observedAt,
        firstObservedAt: safeProjectionTimestamp(observation.firstObservedAt) || observedAt,
        scanDepth: safeProjectionText(observation.scanDepth, 20) || 'unknown',
        status: safeProjectionText(observation.status, 20) || 'partial',
        complete: typeof observation.complete === 'boolean' ? observation.complete : null,
        truncated: typeof observation.truncated === 'boolean' ? observation.truncated : null,
        schemaVersions: projectionSchemaVersions(observation.schemaVersions),
        limitations: projectionLimitations(observation.limitations),
      });
    }
  }

  const order = new Map<string, number>([
    'nameserver_set',
    'http_final_origin',
    'ip_address',
    'certificate',
    'tracking_identifier',
    'favicon',
    'official_asset',
  ].map((value, index) => [value, index]));
  const candidates = [...buckets.values()].filter((bucket) => bucket.cases.size >= 2).map((bucket) => {
    const allCases = [...bucket.cases.values()].sort((left, right) => left.domain.localeCompare(right.domain));
    const allCampaigns = [...bucket.campaigns.values()].sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
    const allObservations = [...bucket.observations.values()].sort((left, right) => right.observedAt.localeCompare(left.observedAt) || left.id.localeCompare(right.id));
    const allMethods = [...bucket.methods].sort();
    const allClassifications = [...bucket.classifications].sort();
    const methods = allMethods.slice(0, MAX_RELATIONSHIP_METHODS);
    const classifications = allClassifications.slice(0, MAX_RELATIONSHIP_CLASSIFICATIONS);
    const groupTruncated = bucket.truncated
      || allCases.length > MAX_CASES_PER_RELATIONSHIP
      || allCampaigns.length > MAX_RELATIONSHIP_SCOPE_OPTIONS
      || allObservations.length > MAX_RELATIONSHIP_PROVENANCE_OBSERVATIONS
      || allMethods.length > methods.length
      || allClassifications.length > classifications.length;
    if (groupTruncated) truncated = true;
    return {
      type: bucket.type,
      label: bucket.label,
      method: safeProjectionText(methods.join(' / '), 400),
      methods,
      classifications,
      value: bucket.value,
      cases: allCases.slice(0, MAX_CASES_PER_RELATIONSHIP),
      campaigns: allCampaigns.slice(0, MAX_RELATIONSHIP_SCOPE_OPTIONS),
      description: bucket.description,
      sources: [...new Set(allObservations.map((item) => item.source))].sort(),
      scanDepths: [...new Set(allObservations.map((item) => item.scanDepth))].sort(),
      firstObservedAt: bucket.firstObservedAt,
      lastObservedAt: bucket.lastObservedAt,
      complete: bucket.complete,
      truncated: groupTruncated,
      observations: allObservations.slice(0, MAX_RELATIONSHIP_PROVENANCE_OBSERVATIONS),
      omittedObservations: Math.max(0, allObservations.length - MAX_RELATIONSHIP_PROVENANCE_OBSERVATIONS),
      limitations: projectionLimitations(bucket.limitations),
    };
  }).sort((left, right) => (Number(order.get(left.type)) - Number(order.get(right.type)))
    || left.value.localeCompare(right.value)
    || left.cases.map((item) => item.domain).join('|').localeCompare(right.cases.map((item) => item.domain).join('|')));

  if (candidates.length > MAX_CASE_RELATIONSHIP_GROUPS) truncated = true;
  const groups = candidates.slice(0, MAX_CASE_RELATIONSHIP_GROUPS);
  const allSourceValues = [...new Set(groups.flatMap((group) => group.sources))].sort();
  const sourceValues = allSourceValues.slice(0, MAX_RELATIONSHIP_SOURCE_OPTIONS);
  const sourceOptionsTruncated = sourceValues.length < allSourceValues.length;
  const cases = new Map(groups.flatMap((group) => group.cases.map((item) => [item.id, item])));
  const campaigns = new Map(groups.flatMap((group) => group.campaigns.map((item) => [item.id, item])));
  const scopeOptions: CaseRelationshipScopeOption[] = [
    ...[...cases.values()].sort((left, right) => left.domain.localeCompare(right.domain)).map((item) => ({ value: `case:${item.id}`, kind: 'case' as const, label: item.domain })),
    ...[...campaigns.values()].sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id)).map((item) => ({ value: `campaign:${item.id}`, kind: 'campaign' as const, label: item.label })),
  ].slice(0, MAX_RELATIONSHIP_SCOPE_OPTIONS);
  const scopeOptionsTruncated = cases.size + campaigns.size > scopeOptions.length;
  const filterOptionsTruncated = sourceOptionsTruncated || scopeOptionsTruncated;
  return {
    version: INVESTIGATION_CASE_RELATIONSHIP_VERSION,
    projectionVersion,
    state: 'ready',
    generatedAt: safeProjectionTimestamp(projection.generatedAt),
    groups,
    sources: sourceValues,
    scopeOptions,
    filterOptionsTruncated,
    truncated,
    limitations: projectionLimitations([
      ...(Array.isArray(projection.limitations) ? projection.limitations : []),
      ...(filterOptionsTruncated ? ['Source, case, or campaign filter options were bounded; retained relationship rows remain available in the table.'] : []),
      'Relationship groups use retained observation history. Filter by observation time and inspect provenance before treating a historical pivot as current.',
      'Shared infrastructure or destinations are investigation pivots, not proof of common ownership, coordination, intent, or maliciousness.',
    ]),
  };
}

function projectionFilterOption(value: unknown, allowed: Set<string>, fallback = 'all'): string {
  return typeof value === 'string' && allowed.has(value) ? value : fallback;
}

/** Applies shared bounded provenance filters to a projection-backed summary. */
export function filterInvestigationCaseRelationships(
  summary: CaseRelationshipSummary,
  rawOptions: CaseRelationshipFilterOptions = {},
) {
  const groups = Array.isArray(summary?.groups) ? summary.groups : [];
  const type = projectionFilterOption(rawOptions.type, PROJECTION_FILTER_TYPES);
  const source = projectionFilterOption(rawOptions.source, new Set(['all', ...(Array.isArray(summary?.sources) ? summary.sources : [])]));
  const period = projectionFilterOption(rawOptions.period, PROJECTION_FILTER_PERIODS);
  const completeness = projectionFilterOption(rawOptions.completeness, PROJECTION_FILTER_COMPLETENESS);
  const scope = projectionFilterOption(rawOptions.scope, new Set(['all', ...(Array.isArray(summary?.scopeOptions) ? summary.scopeOptions.map((item) => item.value) : [])]));
  const generatedAt = safeProjectionTimestamp(summary?.generatedAt);
  const cutoff = period === 'all' || !generatedAt ? null : Date.parse(generatedAt) - Number(PERIOD_MILLISECONDS.get(period));
  const filtered = groups.filter((group) => {
    if (type !== 'all' && group.type !== type) return false;
    if (source !== 'all' && !(group.sources || []).includes(source)) return false;
    if (cutoff !== null && Date.parse(group.lastObservedAt || '') < cutoff) return false;
    if (completeness === 'complete' && !(group.complete === true && group.truncated !== true)) return false;
    if (completeness === 'partial' && !(group.complete === false || group.truncated === true)) return false;
    if (completeness === 'unknown' && !(group.complete === null && group.truncated !== true)) return false;
    if (scope.startsWith('case:') && !group.cases.some((item) => `case:${item.id}` === scope)) return false;
    if (scope.startsWith('campaign:') && !(group.campaigns || []).some((item) => `campaign:${item.id}` === scope)) return false;
    return true;
  });
  return {
    groups: filtered,
    totalRelationships: groups.length,
    matchingRelationships: filtered.length,
    filters: { type, source, period, completeness, scope },
  };
}
