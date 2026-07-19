// Bounded cross-case comparison over evidence already retained in the
// browser-local case store. These relationships are investigation pivots, not
// ownership, coordination, intent, or maliciousness conclusions. No network
// request, aggregate score, or new persisted record is produced here.

import {
  MAX_CASES,
  MAX_EVIDENCE_SNAPSHOTS_PER_CASE,
  normalizeDomain,
  normalizeSnapshot,
} from './case-model.js';
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
]);
const PROJECTION_FILTER_TYPES = new Set(['all', ...[...PROJECTION_RELATIONSHIP_TYPES.values()].map((value) => value.type)]);
const PROJECTION_FILTER_PERIODS = new Set(['all', '7d', '30d', '365d']);
const PROJECTION_FILTER_COMPLETENESS = new Set(['all', 'complete', 'partial', 'unknown']);
const PERIOD_MILLISECONDS = new Map([['7d', 7 * 86400000], ['30d', 30 * 86400000], ['365d', 365 * 86400000]]);
const PROJECTION_SCHEMA_VERSION_FIELDS = ['case', 'riskModel', 'httpSummary', 'brandProfile', 'pageBaseline', 'pageIdentity', 'pageFingerprint', 'campaign', 'relationshipEvidence'];

/** @param {unknown} value */
function safeCaseId(value) {
  return typeof value === 'string' && SAFE_CASE_ID_RE.test(value) ? value : '';
}

/** @param {unknown} value */
function normalizedOrigin(value) {
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

/** @param {unknown} value */
function latestNormalizedSnapshot(value) {
  if (!Array.isArray(value)) return null;
  let latest = null;
  for (const candidate of value.slice(0, MAX_EVIDENCE_SNAPSHOTS_PER_CASE)) {
    const snapshot = normalizeSnapshot(candidate);
    if (!snapshot) continue;
    if (!latest || Date.parse(snapshot.capturedAt) > Date.parse(latest.capturedAt)) latest = snapshot;
  }
  return latest;
}

/** @param {Map<string, Map<string, string>>} buckets @param {string} value @param {string} id @param {string} domain */
function addBucket(buckets, value, id, domain) {
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
function group(type, label, method, value, cases, description) {
  return { type, label, method, value, cases, description };
}

/**
 * Builds deterministic relationships from the latest valid evidence snapshot
 * in each case. Nameserver comparison uses the bounded retained normalized set;
 * final-origin comparison requires a deep HTTP observation.
 * @param {unknown} rawCases
 */
export function buildCaseRelationships(rawCases) {
  const input = Array.isArray(rawCases) ? rawCases : [];
  let truncated = input.length > MAX_RELATIONSHIP_CASES;
  const nameserverSets = new Map();
  const finalOrigins = new Map();
  const seenIds = new Set();
  const seenDomains = new Set();

  for (const raw of input.slice(0, MAX_RELATIONSHIP_CASES)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const id = safeCaseId(raw.id);
    const domain = normalizeDomain(raw.domain);
    if (!id || !domain || seenIds.has(id) || seenDomains.has(domain)) {
      if (id && domain) truncated = true;
      continue;
    }
    if (!Array.isArray(raw.evidenceHistory)
      || raw.evidenceHistory.length > MAX_EVIDENCE_SNAPSHOTS_PER_CASE) {
      if (Array.isArray(raw.evidenceHistory)) truncated = true;
      continue;
    }
    const snapshot = latestNormalizedSnapshot(raw.evidenceHistory);
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

  const output = [];
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

  const order = new Map(['nameserver_set', 'http_final_origin'].map((value, index) => [value, index]));
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

function safeProjectionText(value, maximum = 300) {
  if (typeof value !== 'string' || value.length > maximum * 4 || /[\x00-\x1f\x7f]/.test(value)) return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maximum).trim();
}

function safeProjectionTimestamp(value) {
  if (typeof value !== 'string' || value.length > 64 || /[\x00-\x1f\x7f]/.test(value)) return '';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

function mergeProjectionComplete(left, right) {
  if (left === false || right === false) return false;
  if (left === true && right === true) return true;
  return null;
}

function projectionLimitations(values) {
  const output = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values.slice(0, MAX_PROJECTION_LIMITATIONS * 4) : []) {
    const normalized = safeProjectionText(value, 300);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= MAX_PROJECTION_LIMITATIONS) break;
  }
  return output;
}

function projectionSchemaVersions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = /** @type {Record<string, unknown>} */ (value);
  return Object.fromEntries(PROJECTION_SCHEMA_VERSION_FIELDS.flatMap((field) => {
    const version = record[field];
    return Number.isSafeInteger(version) && Number(version) > 0 ? [[field, version]] : [];
  }));
}

function emptyProjectionRelationships(state, version = null, limitations = []) {
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
export function buildInvestigationCaseRelationships(rawProjection) {
  if (!rawProjection || typeof rawProjection !== 'object' || Array.isArray(rawProjection)) {
    return emptyProjectionRelationships('absent');
  }
  const projection = /** @type {Record<string, any>} */ (rawProjection);
  const projectionVersion = Number.isSafeInteger(projection.version) && projection.version > 0
    ? projection.version
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

  const entities = new Map();
  for (const value of projection.entities.slice(0, MAX_PROJECTION_ENTITIES)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const id = safeProjectionText(value.id, 100);
    const type = safeProjectionText(value.type, 40);
    if (!id || !type || entities.has(id)) continue;
    entities.set(id, value);
  }
  const observations = new Map();
  for (const value of projection.observations.slice(0, MAX_PROJECTION_OBSERVATIONS)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const id = safeProjectionText(value.id, 100);
    if (id && !observations.has(id)) observations.set(id, value);
  }

  const relationships = projection.relationships.slice(0, MAX_PROJECTION_RELATIONSHIPS)
    .filter((value) => value && typeof value === 'object' && !Array.isArray(value));
  const casesByDomain = new Map();
  const campaignsByDomain = new Map();
  for (const relationship of relationships) {
    const from = entities.get(relationship.from);
    const to = entities.get(relationship.to);
    if (!from || !to) continue;
    if (relationship.type === 'case_documents_domain' && from.type === 'case' && to.type === 'domain') {
      const id = safeCaseId(from.properties?.caseId || from.canonical);
      const domain = normalizeDomain(from.properties?.domain || to.properties?.domain || to.canonical);
      if (!id || !domain) continue;
      if (!casesByDomain.has(to.id)) casesByDomain.set(to.id, new Map());
      casesByDomain.get(to.id).set(id, { id, domain, entityId: from.id });
    }
    if (relationship.type === 'campaign_contains_domain' && from.type === 'campaign' && to.type === 'domain') {
      const id = safeCaseId(from.properties?.campaignId || from.canonical);
      const label = safeProjectionText(from.properties?.name || from.label, 100);
      if (!id || !label) continue;
      if (!campaignsByDomain.has(to.id)) campaignsByDomain.set(to.id, new Map());
      campaignsByDomain.get(to.id).set(id, { id, label, entityId: from.id });
    }
  }

  const buckets = new Map();
  let truncated = projection.truncated === true
    || projection.entities.length > MAX_PROJECTION_ENTITIES
    || projection.observations.length > MAX_PROJECTION_OBSERVATIONS
    || projection.relationships.length > relationships.length;
  for (const relationship of relationships) {
    const definition = PROJECTION_RELATIONSHIP_TYPES.get(relationship.type);
    if (!definition) continue;
    const domainEntity = entities.get(relationship.from);
    const targetEntity = entities.get(relationship.to);
    const caseMap = casesByDomain.get(domainEntity?.id);
    if (!domainEntity || domainEntity.type !== 'domain' || !targetEntity || !caseMap?.size) continue;
    const value = safeProjectionText(targetEntity.label || targetEntity.canonical, 300);
    if (!value) continue;
    const key = `${definition.type}\u0000${targetEntity.id}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        type: definition.type,
        label: definition.label,
        value,
        description: definition.description,
        cases: new Map(),
        campaigns: new Map(),
        methods: new Set(),
        classifications: new Set(),
        observations: new Map(),
        limitations: [],
        firstObservedAt: '',
        lastObservedAt: '',
        complete: true,
        truncated: false,
      });
    }
    const bucket = buckets.get(key);
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
    for (const id of sourceObservationIds.slice(0, MAX_RELATIONSHIP_PROVENANCE_OBSERVATIONS * 2)) {
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

  const order = new Map(['nameserver_set', 'http_final_origin'].map((value, index) => [value, index]));
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
  const scopeOptions = [
    ...[...cases.values()].sort((left, right) => left.domain.localeCompare(right.domain)).map((item) => ({ value: `case:${item.id}`, kind: 'case', label: item.domain })),
    ...[...campaigns.values()].sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id)).map((item) => ({ value: `campaign:${item.id}`, kind: 'campaign', label: item.label })),
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

function projectionFilterOption(value, allowed, fallback = 'all') {
  return typeof value === 'string' && allowed.has(value) ? value : fallback;
}

/** Applies shared bounded provenance filters to a projection-backed summary. */
export function filterInvestigationCaseRelationships(summary, rawOptions = {}) {
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
    if (source !== 'all' && !group.sources.includes(source)) return false;
    if (cutoff !== null && Date.parse(group.lastObservedAt) < cutoff) return false;
    if (completeness === 'complete' && !(group.complete === true && group.truncated !== true)) return false;
    if (completeness === 'partial' && !(group.complete === false || group.truncated === true)) return false;
    if (completeness === 'unknown' && !(group.complete === null && group.truncated !== true)) return false;
    if (scope.startsWith('case:') && !group.cases.some((item) => `case:${item.id}` === scope)) return false;
    if (scope.startsWith('campaign:') && !group.campaigns.some((item) => `campaign:${item.id}` === scope)) return false;
    return true;
  });
  return {
    groups: filtered,
    totalRelationships: groups.length,
    matchingRelationships: filtered.length,
    filters: { type, source, period, completeness, scope },
  };
}
