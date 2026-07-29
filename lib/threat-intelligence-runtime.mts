// Provider-neutral contracts for optional external threat-intelligence sources
// and curated discovery or enrichment connectors. This module performs no
// network requests and contains no provider credentials. Adapters added later
// must declare exact input exposure, reviewed terms, and bounded request and
// output budgets before producing separately attributed normalized evidence.

import { classifyQuery } from './classify.mts';
import { createObservation } from './observation.mts';
import type { Observation, ObservationStatus } from './observation.mts';
import {
  assertCuratedConnectorDefinition,
  assertThreatIntelligenceProvider,
} from './threat-intelligence-definition-registry.mts';
import {
  boundedHttpsUrl,
  boundedInteger,
  boundedString,
  enumValue,
  exactKeys,
  isRecord,
  isoTimestamp,
  strictBoundedString,
} from './bounded-contract-normalizers.mts';

type ThreatIntelligenceTargetType = 'domain' | 'url';
type ThreatIntelligenceTargetExposure = 'registrable_domain' | 'hostname' | 'origin' | 'full_url';
type ThreatIntelligenceCapability = 'domain_lookup' | 'url_lookup' | 'indicator_search';
type ThreatIntelligenceCategory = 'phishing' | 'malware' | 'spam' | 'suspicious' | 'abuse' | 'unknown';
type ThreatIntelligenceSeverity = 'critical' | 'high' | 'medium' | 'low' | 'unknown';
type ThreatIntelligenceConfidence = 'high' | 'medium' | 'low' | 'unknown';
type ThreatIntelligenceCommercialUse = 'allowed' | 'restricted' | 'unknown';
type ThreatIntelligenceAttribution = 'required' | 'not_required' | 'unknown';
type ThreatIntelligenceCaching = 'prohibited' | 'transient' | 'bounded' | 'provider_defined' | 'unknown';
type ThreatIntelligenceQueryRetention = 'none' | 'limited' | 'provider_defined' | 'unknown';
type ThreatIntelligenceRedistribution = 'allowed' | 'restricted' | 'prohibited' | 'unknown';
type ThreatIntelligenceResultState =
  | 'success'
  | 'partial'
  | 'not_found'
  | 'unsupported'
  | 'skipped'
  | 'rate_limited'
  | 'unavailable'
  | 'error';

type ThreatIntelligenceProviderTargets = Readonly<{
  domain?: 'registrable_domain';
  url?: ThreatIntelligenceTargetExposure;
}>;

type ThreatIntelligenceProviderTerms = Readonly<{
  reviewedAt: string;
  termsUrl: string;
  privacyUrl: string | null;
  commercialUse: ThreatIntelligenceCommercialUse;
  attribution: ThreatIntelligenceAttribution;
  caching: ThreatIntelligenceCaching;
  queryRetention: ThreatIntelligenceQueryRetention;
  redistribution: ThreatIntelligenceRedistribution;
}>;

type ThreatIntelligenceProviderLimits = Readonly<{
  timeoutMs: number;
  maxResponseBytes: number;
  cacheTtlMs: number;
  concurrency: number;
  dailyRequests: number;
  monthlyRequests: number;
}>;

type ThreatIntelligenceProviderDefinition = Readonly<{
  version: number;
  id: string;
  label: string;
  capabilities: readonly ThreatIntelligenceCapability[];
  targets: ThreatIntelligenceProviderTargets;
  interaction: 'lookup_only';
  terms: ThreatIntelligenceProviderTerms;
  limits: ThreatIntelligenceProviderLimits;
}>;

type ThreatIntelligenceTarget = Readonly<{
  type: ThreatIntelligenceTargetType;
  value: string;
  exposure: ThreatIntelligenceTargetExposure;
}>;

type ThreatIntelligenceFinding = {
  id: string | null;
  category: ThreatIntelligenceCategory;
  severity: ThreatIntelligenceSeverity;
  confidence: ThreatIntelligenceConfidence;
  providerVerdict: string | null;
  detail: string | null;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  referenceUrl: string | null;
  tags: string[];
};

type ThreatIntelligenceResult = {
  schema: string;
  version: number;
  provider: { id: string; label: string };
  target: ThreatIntelligenceTarget;
  state: ThreatIntelligenceResultState;
  detail: string | null;
  upstreamStatus: number | null;
  retryAfterSeconds: number | null;
  findings: ThreatIntelligenceFinding[];
  observation: Observation;
};

type ThreatIntelligenceProviderMatrixEntry = {
  id: string;
  label: string;
  capabilities: ThreatIntelligenceCapability[];
  targets: { domain?: 'registrable_domain'; url?: ThreatIntelligenceTargetExposure };
  interaction: 'lookup_only';
  terms: ThreatIntelligenceProviderTerms;
  limits: ThreatIntelligenceProviderLimits;
};

type CuratedConnectorKind = 'discovery' | 'enrichment';
type CuratedConnectorCollection = 'passive' | 'active' | 'third_party';
type CuratedConnectorCredentialMode = 'none' | 'optional' | 'required';
type CuratedConnectorEntityType =
  | 'domain'
  | 'hostname'
  | 'url'
  | 'ipv4'
  | 'ipv6'
  | 'asn'
  | 'certificate';
type CuratedConnectorTargetExposure =
  | 'registrable_domain'
  | 'hostname'
  | 'origin'
  | 'full_url'
  | 'ip_address'
  | 'asn'
  | 'certificate_fingerprint';
type CuratedConnectorRelationshipType =
  | 'domain_resolves_to_ip'
  | 'domain_uses_nameserver'
  | 'domain_uses_mail_server'
  | 'domain_presented_certificate'
  | 'certificate_names_domain'
  | 'ip_hosts_domain'
  | 'domain_related_to_domain';
type CuratedConnectorRelationshipClassification = 'direct' | 'normalized' | 'derived';

type CuratedConnectorInput = Readonly<{
  type: CuratedConnectorEntityType;
  exposure: CuratedConnectorTargetExposure;
}>;

type CuratedConnectorOutputs = Readonly<{
  entities: readonly CuratedConnectorEntityType[];
  relationships: readonly CuratedConnectorRelationshipType[];
}>;

type CuratedConnectorCredentials = Readonly<{
  mode: CuratedConnectorCredentialMode;
  scopes: readonly string[];
}>;

type CuratedConnectorLimits = ThreatIntelligenceProviderLimits & Readonly<{
  maxEntities: number;
  maxRelationships: number;
}>;

type CuratedConnectorDefinition = Readonly<{
  version: number;
  id: string;
  label: string;
  kinds: readonly CuratedConnectorKind[];
  inputs: readonly CuratedConnectorInput[];
  outputs: CuratedConnectorOutputs;
  collection: CuratedConnectorCollection;
  credentials: CuratedConnectorCredentials;
  terms: ThreatIntelligenceProviderTerms;
  limits: CuratedConnectorLimits;
  enabledByDefault: false;
}>;

type CuratedConnectorTarget = Readonly<{
  type: CuratedConnectorEntityType;
  value: string;
  exposure: CuratedConnectorTargetExposure;
}>;

type CuratedConnectorEntity = {
  id: string;
  type: CuratedConnectorEntityType;
  canonical: string;
  label: string;
  attributes: Record<string, string | number | boolean>;
};

type CuratedConnectorRelationship = {
  id: string;
  type: CuratedConnectorRelationshipType;
  from: string;
  to: string;
  classification: CuratedConnectorRelationshipClassification;
  method: string;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  complete: boolean | null;
  truncated: boolean | null;
  limitations: string[];
};

type CuratedConnectorResult = {
  schema: string;
  version: number;
  connector: {
    id: string;
    label: string;
    kinds: CuratedConnectorKind[];
    collection: CuratedConnectorCollection;
  };
  target: CuratedConnectorTarget;
  state: ThreatIntelligenceResultState;
  detail: string | null;
  upstreamStatus: number | null;
  retryAfterSeconds: number | null;
  entities: CuratedConnectorEntity[];
  relationships: CuratedConnectorRelationship[];
  observation: Observation;
};

type CuratedConnectorMatrixEntry = {
  id: string;
  label: string;
  kinds: CuratedConnectorKind[];
  inputs: CuratedConnectorInput[];
  outputs: { entities: CuratedConnectorEntityType[]; relationships: CuratedConnectorRelationshipType[] };
  collection: CuratedConnectorCollection;
  credentials: { mode: CuratedConnectorCredentialMode; scopes: string[] };
  terms: ThreatIntelligenceProviderTerms;
  limits: CuratedConnectorLimits;
  enabledByDefault: false;
};

const THREAT_INTELLIGENCE_CONTRACT_VERSION = 1;
const THREAT_INTELLIGENCE_SCHEMA = 'whoisleuth.threat-intelligence-result';
const CURATED_CONNECTOR_CONTRACT_VERSION = 1;
const CURATED_CONNECTOR_RESULT_SCHEMA = 'whoisleuth.curated-connector-result';
const RESULT_STATES = new Set<ThreatIntelligenceResultState>([
  'success',
  'partial',
  'not_found',
  'unsupported',
  'skipped',
  'rate_limited',
  'unavailable',
  'error',
]);
const TERMINAL_STATES_WITHOUT_FINDINGS = new Set<ThreatIntelligenceResultState>([
  'not_found',
  'unsupported',
  'skipped',
  'rate_limited',
  'unavailable',
  'error',
]);
const TARGET_EXPOSURES: Readonly<Record<ThreatIntelligenceTargetType, ReadonlySet<ThreatIntelligenceTargetExposure>>> = Object.freeze({
  domain: new Set<ThreatIntelligenceTargetExposure>(['registrable_domain']),
  url: new Set<ThreatIntelligenceTargetExposure>(['registrable_domain', 'hostname', 'origin', 'full_url']),
});
const CAPABILITIES = new Set<ThreatIntelligenceCapability>(['domain_lookup', 'url_lookup', 'indicator_search']);
const CATEGORIES = new Set<ThreatIntelligenceCategory>(['phishing', 'malware', 'spam', 'suspicious', 'abuse', 'unknown']);
const SEVERITIES = new Set<ThreatIntelligenceSeverity>(['critical', 'high', 'medium', 'low', 'unknown']);
const CONFIDENCES = new Set<ThreatIntelligenceConfidence>(['high', 'medium', 'low', 'unknown']);
const COMMERCIAL_USE = new Set<ThreatIntelligenceCommercialUse>(['allowed', 'restricted', 'unknown']);
const ATTRIBUTION = new Set<ThreatIntelligenceAttribution>(['required', 'not_required', 'unknown']);
const CACHING = new Set<ThreatIntelligenceCaching>(['prohibited', 'transient', 'bounded', 'provider_defined', 'unknown']);
const QUERY_RETENTION = new Set<ThreatIntelligenceQueryRetention>(['none', 'limited', 'provider_defined', 'unknown']);
const REDISTRIBUTION = new Set<ThreatIntelligenceRedistribution>(['allowed', 'restricted', 'prohibited', 'unknown']);
const CONNECTOR_KINDS = new Set<CuratedConnectorKind>(['discovery', 'enrichment']);
const CONNECTOR_COLLECTIONS = new Set<CuratedConnectorCollection>(['passive', 'active', 'third_party']);
const CONNECTOR_CREDENTIAL_MODES = new Set<CuratedConnectorCredentialMode>(['none', 'optional', 'required']);
const CONNECTOR_ENTITY_TYPES = new Set<CuratedConnectorEntityType>([
  'domain',
  'hostname',
  'url',
  'ipv4',
  'ipv6',
  'asn',
  'certificate',
]);
const CONNECTOR_RELATIONSHIP_TYPES = new Set<CuratedConnectorRelationshipType>([
  'domain_resolves_to_ip',
  'domain_uses_nameserver',
  'domain_uses_mail_server',
  'domain_presented_certificate',
  'certificate_names_domain',
  'ip_hosts_domain',
  'domain_related_to_domain',
]);
const CONNECTOR_RELATIONSHIP_CLASSIFICATIONS = new Set<CuratedConnectorRelationshipClassification>([
  'direct',
  'normalized',
  'derived',
]);
const CONNECTOR_RELATIONSHIP_ENDPOINTS: Readonly<Record<
  CuratedConnectorRelationshipType,
  Readonly<{
    from: ReadonlySet<CuratedConnectorEntityType>;
    to: ReadonlySet<CuratedConnectorEntityType>;
  }>
>> = Object.freeze({
  domain_resolves_to_ip: {
    from: new Set<CuratedConnectorEntityType>(['domain', 'hostname']),
    to: new Set<CuratedConnectorEntityType>(['ipv4', 'ipv6']),
  },
  domain_uses_nameserver: {
    from: new Set<CuratedConnectorEntityType>(['domain']),
    to: new Set<CuratedConnectorEntityType>(['hostname']),
  },
  domain_uses_mail_server: {
    from: new Set<CuratedConnectorEntityType>(['domain']),
    to: new Set<CuratedConnectorEntityType>(['hostname']),
  },
  domain_presented_certificate: {
    from: new Set<CuratedConnectorEntityType>(['domain', 'hostname']),
    to: new Set<CuratedConnectorEntityType>(['certificate']),
  },
  certificate_names_domain: {
    from: new Set<CuratedConnectorEntityType>(['certificate']),
    to: new Set<CuratedConnectorEntityType>(['domain', 'hostname']),
  },
  ip_hosts_domain: {
    from: new Set<CuratedConnectorEntityType>(['ipv4', 'ipv6']),
    to: new Set<CuratedConnectorEntityType>(['domain', 'hostname']),
  },
  domain_related_to_domain: {
    from: new Set<CuratedConnectorEntityType>(['domain', 'hostname']),
    to: new Set<CuratedConnectorEntityType>(['domain', 'hostname']),
  },
});
const CONNECTOR_TARGET_EXPOSURES: Readonly<Record<CuratedConnectorEntityType, ReadonlySet<CuratedConnectorTargetExposure>>> = Object.freeze({
  domain: new Set<CuratedConnectorTargetExposure>(['registrable_domain']),
  hostname: new Set<CuratedConnectorTargetExposure>(['hostname']),
  url: new Set<CuratedConnectorTargetExposure>(['registrable_domain', 'hostname', 'origin', 'full_url']),
  ipv4: new Set<CuratedConnectorTargetExposure>(['ip_address']),
  ipv6: new Set<CuratedConnectorTargetExposure>(['ip_address']),
  asn: new Set<CuratedConnectorTargetExposure>(['asn']),
  certificate: new Set<CuratedConnectorTargetExposure>(['certificate_fingerprint']),
});

// createObservation() retains at most 40 source characters, so provider IDs use
// the same ceiling and can never be truncated at the provenance boundary.
const MAX_PROVIDER_ID_LENGTH = 40;
const MAX_PROVIDER_LABEL_LENGTH = 100;
const MAX_URL_LENGTH = 2048;
const MAX_DETAIL_LENGTH = 500;
const MAX_FINDING_ID_LENGTH = 160;
const MAX_VERDICT_LENGTH = 160;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 64;
// Match the shared observation envelope so the contract never promises more
// limitations than createObservation() can retain.
const MAX_LIMITATIONS = 10;
const MAX_FINDINGS = 100;
const MAX_INPUT_FINDINGS = 500;
const MAX_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_REQUEST_BUDGET = 1_000_000;
const MAX_CONNECTOR_ENTITIES = 200;
const MAX_CONNECTOR_RELATIONSHIPS = 400;
const MAX_CONNECTOR_INPUT_ENTITIES = 800;
const MAX_CONNECTOR_INPUT_RELATIONSHIPS = 1_600;
const MAX_CONNECTOR_ATTRIBUTES = 20;
const MAX_CONNECTOR_ATTRIBUTE_LENGTH = 300;
const MAX_CONNECTOR_SCOPES = 20;
const MAX_CONNECTOR_SCOPE_LENGTH = 80;
const MAX_CONNECTOR_METHOD_LENGTH = 160;
const MAX_CONNECTOR_KEY_LENGTH = 80;

const BASE_LIMITATION = 'External provider observations are attributed context, not proof that a target is safe, malicious, active, or controlled by any party.';
const NO_MATCH_LIMITATION = 'No matching provider record is not evidence that the target is safe.';
const CONNECTOR_BASE_LIMITATION = 'Connector observations and relationships are attributed investigation pivots, not proof of ownership, coordination, activity, safety, or maliciousness.';
const CONNECTOR_NO_MATCH_LIMITATION = 'No matching connector output is not evidence that an entity or relationship is absent or safe.';

function httpsUrl(value: unknown): string | null {
  return boundedHttpsUrl(value, MAX_URL_LENGTH);
}

function normalizeCertificateFingerprint(value: unknown): string | null {
  const raw = strictBoundedString(value, 128);
  if (!raw || !/^[0-9a-f:]+$/iu.test(raw)) return null;
  const canonical = raw.replace(/:/gu, '').toLowerCase();
  return /^[0-9a-f]{64}$/u.test(canonical) ? canonical : null;
}

function normalizeCuratedConnectorTarget(
  input: unknown,
  exposure: unknown,
): CuratedConnectorTarget {
  exactKeys(input, new Set(['type', 'value']), 'Connector target');
  const type = enumValue(input.type, CONNECTOR_ENTITY_TYPES, 'Connector target type');
  const normalizedExposure = enumValue(exposure, CONNECTOR_TARGET_EXPOSURES[type], 'Connector target exposure');

  if (type === 'url') {
    const normalized = normalizeThreatIntelligenceTarget({ type: 'url', value: input.value }, normalizedExposure);
    return Object.freeze({ type, value: normalized.value, exposure: normalizedExposure });
  }
  if (type === 'certificate') {
    const value = normalizeCertificateFingerprint(input.value);
    if (!value) throw new TypeError('Connector certificate target is invalid');
    return Object.freeze({ type, value, exposure: normalizedExposure });
  }

  const raw = strictBoundedString(input.value, MAX_URL_LENGTH);
  if (!raw) throw new TypeError('Connector target value is invalid');
  let classified;
  try {
    classified = classifyQuery(raw);
  } catch {
    classified = null;
  }
  if (!classified) throw new TypeError('Connector target value is invalid');
  if (type === 'domain' && classified.type === 'domain') {
    return Object.freeze({ type, value: classified.registrableDomain, exposure: normalizedExposure });
  }
  if (type === 'hostname' && classified.type === 'domain') {
    return Object.freeze({ type, value: classified.inputHostname, exposure: normalizedExposure });
  }
  if ((type === 'ipv4' || type === 'ipv6') && classified.type === type) {
    return Object.freeze({ type, value: classified.value, exposure: normalizedExposure });
  }
  if (type === 'asn' && classified.type === 'asn') {
    return Object.freeze({ type, value: classified.value, exposure: normalizedExposure });
  }
  throw new TypeError('Connector target type and value are incompatible');
}

function normalizeThreatIntelligenceTarget(input: unknown, exposure: unknown): ThreatIntelligenceTarget {
  exactKeys(input, new Set(['type', 'value']), 'Threat-intelligence target');
  const type = input.type;
  if ((type !== 'domain' && type !== 'url')
    || typeof exposure !== 'string'
    || !TARGET_EXPOSURES[type].has(exposure as ThreatIntelligenceTargetExposure)) {
    throw new TypeError('Threat-intelligence target exposure is invalid');
  }
  if (type === 'domain') {
    const classified = classifyQuery(String(input.value ?? ''));
    if (classified.type !== 'domain') throw new TypeError('Threat-intelligence domain target is invalid');
    return Object.freeze({
      type: 'domain',
      value: classified.registrableDomain,
      exposure: exposure as ThreatIntelligenceTargetExposure,
    });
  }

  const raw = strictBoundedString(input.value, MAX_URL_LENGTH);
  let parsed;
  try {
    parsed = raw ? new URL(raw) : null;
  } catch {
    parsed = null;
  }
  if (!parsed || !['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new TypeError('Threat-intelligence URL target is invalid');
  }
  const classified = classifyQuery(parsed.hostname);
  if (classified.type !== 'domain') throw new TypeError('Threat-intelligence URL target must use a registrable domain');
  const registrableDomain = classified.registrableDomain || classified.value;
  const inputHostname = classified.inputHostname || parsed.hostname.toLowerCase();
  parsed.hash = '';
  let value = parsed.toString();
  if (exposure === 'registrable_domain') value = registrableDomain;
  else if (exposure === 'hostname') value = inputHostname;
  else if (exposure === 'origin') value = parsed.origin;
  if (value.length > MAX_URL_LENGTH) throw new TypeError('Threat-intelligence URL target exceeds the canonical length limit');
  return Object.freeze({
    type: 'url',
    value,
    exposure: exposure as ThreatIntelligenceTargetExposure,
  });
}

function connectorEntityExposure(type: CuratedConnectorEntityType): CuratedConnectorTargetExposure {
  if (type === 'domain') return 'registrable_domain';
  if (type === 'hostname') return 'hostname';
  if (type === 'url') return 'full_url';
  if (type === 'ipv4' || type === 'ipv6') return 'ip_address';
  if (type === 'asn') return 'asn';
  return 'certificate_fingerprint';
}

function stableHash(value: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36);
}

function connectorStableId(prefix: 'entity' | 'relationship', canonical: string): string {
  return `${prefix}:${stableHash(canonical, 2166136261)}-${stableHash(canonical, 3339675911)}`;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function normalizeConnectorAttributes(value: unknown): {
  values: Record<string, string | number | boolean>;
  discarded: number;
} {
  if (value == null) return { values: {}, discarded: 0 };
  if (!isRecord(value)) return { values: {}, discarded: 1 };
  const output: Record<string, string | number | boolean> = {};
  const inputKeys = Object.keys(value).sort();
  let discarded = Math.max(0, inputKeys.length - MAX_CONNECTOR_ATTRIBUTES * 2);
  for (const key of inputKeys.slice(0, MAX_CONNECTOR_ATTRIBUTES * 2)) {
    if (Object.keys(output).length >= MAX_CONNECTOR_ATTRIBUTES
      || key.length > 40
      || !/^[a-z0-9][a-z0-9_-]*$/iu.test(key)) {
      discarded += 1;
      continue;
    }
    const raw = value[key];
    if (typeof raw === 'boolean') output[key] = raw;
    else if (typeof raw === 'number' && Number.isFinite(raw)) output[key] = raw;
    else {
      const normalized = strictBoundedString(raw, MAX_CONNECTOR_ATTRIBUTE_LENGTH);
      if (normalized !== null) output[key] = normalized;
      else discarded += 1;
    }
  }
  return { values: output, discarded };
}

type ConnectorEntityCandidate = {
  key: string;
  canonicalKey: string;
  entity: CuratedConnectorEntity;
  discardedAttributes: number;
};

function normalizeConnectorEntity(
  value: unknown,
  allowedTypes: ReadonlySet<CuratedConnectorEntityType>,
): ConnectorEntityCandidate | null {
  if (!isRecord(value)
    || !hasOnlyKeys(value, new Set(['key', 'type', 'value', 'label', 'attributes']))) return null;
  const key = strictBoundedString(value.key, MAX_CONNECTOR_KEY_LENGTH);
  const type = typeof value.type === 'string' && CONNECTOR_ENTITY_TYPES.has(value.type as CuratedConnectorEntityType)
    ? value.type as CuratedConnectorEntityType
    : null;
  if (!key || !/^[a-z0-9][a-z0-9._:-]*$/iu.test(key) || !type || !allowedTypes.has(type)) return null;
  let normalized;
  try {
    normalized = normalizeCuratedConnectorTarget(
      { type, value: value.value },
      connectorEntityExposure(type),
    );
  } catch {
    return null;
  }
  const canonicalKey = `${type}:${normalized.value}`;
  const attributes = normalizeConnectorAttributes(value.attributes);
  return {
    key,
    canonicalKey,
    discardedAttributes: attributes.discarded,
    entity: {
      id: connectorStableId('entity', canonicalKey),
      type,
      canonical: normalized.value,
      label: boundedString(value.label, MAX_PROVIDER_LABEL_LENGTH) || normalized.value,
      attributes: attributes.values,
    },
  };
}

function compareConnectorEntities(left: ConnectorEntityCandidate, right: ConnectorEntityCandidate): number {
  return left.entity.id.localeCompare(right.entity.id)
    || left.key.localeCompare(right.key)
    || JSON.stringify(left.entity).localeCompare(JSON.stringify(right.entity));
}

type ConnectorRelationshipCandidate = {
  canonical: string;
  relationship: CuratedConnectorRelationship;
  discardedMetadata: number;
};

function normalizeConnectorLimitations(value: unknown): { values: string[]; discarded: number } {
  if (value == null) return { values: [], discarded: 0 };
  if (!Array.isArray(value)) return { values: [], discarded: 1 };
  const seen = new Set<string>();
  let discarded = Math.max(0, value.length - MAX_LIMITATIONS * 2);
  for (const item of value.slice(0, MAX_LIMITATIONS * 2)) {
    const normalized = strictBoundedString(item, MAX_DETAIL_LENGTH);
    if (!normalized) {
      discarded += 1;
      continue;
    }
    if (seen.has(normalized)) continue;
    if (seen.size >= MAX_LIMITATIONS) {
      discarded += 1;
      continue;
    }
    seen.add(normalized);
  }
  return { values: [...seen], discarded };
}

function normalizeConnectorRelationship(
  value: unknown,
  allowedTypes: ReadonlySet<CuratedConnectorRelationshipType>,
  entitiesByKey: ReadonlyMap<string, Readonly<{ id: string; type: CuratedConnectorEntityType }>>,
): ConnectorRelationshipCandidate | null {
  if (!isRecord(value)
    || !hasOnlyKeys(value, new Set([
      'type',
      'fromKey',
      'toKey',
      'classification',
      'method',
      'firstObservedAt',
      'lastObservedAt',
      'complete',
      'truncated',
      'limitations',
    ]))) return null;
  const type = typeof value.type === 'string'
    && CONNECTOR_RELATIONSHIP_TYPES.has(value.type as CuratedConnectorRelationshipType)
    && allowedTypes.has(value.type as CuratedConnectorRelationshipType)
    ? value.type as CuratedConnectorRelationshipType
    : null;
  const fromKey = strictBoundedString(value.fromKey, MAX_CONNECTOR_KEY_LENGTH);
  const toKey = strictBoundedString(value.toKey, MAX_CONNECTOR_KEY_LENGTH);
  const fromEntity = fromKey ? entitiesByKey.get(fromKey) : null;
  const toEntity = toKey ? entitiesByKey.get(toKey) : null;
  const classification = typeof value.classification === 'string'
    && CONNECTOR_RELATIONSHIP_CLASSIFICATIONS.has(value.classification as CuratedConnectorRelationshipClassification)
    ? value.classification as CuratedConnectorRelationshipClassification
    : null;
  const method = strictBoundedString(value.method, MAX_CONNECTOR_METHOD_LENGTH);
  const firstObservedAt = value.firstObservedAt == null ? null : isoTimestamp(value.firstObservedAt);
  const lastObservedAt = value.lastObservedAt == null ? null : isoTimestamp(value.lastObservedAt);
  const endpoints = type ? CONNECTOR_RELATIONSHIP_ENDPOINTS[type] : null;
  if (!type || !fromEntity || !toEntity || fromEntity.id === toEntity.id
    || !endpoints?.from.has(fromEntity.type) || !endpoints.to.has(toEntity.type)
    || !classification || !method
    || (value.firstObservedAt != null && !firstObservedAt)
    || (value.lastObservedAt != null && !lastObservedAt)
    || (firstObservedAt && lastObservedAt && firstObservedAt > lastObservedAt)
    || (value.complete != null && typeof value.complete !== 'boolean')
    || (value.truncated != null && typeof value.truncated !== 'boolean')) return null;
  const canonical = JSON.stringify([type, fromEntity.id, toEntity.id, classification, method]);
  const limitations = normalizeConnectorLimitations(value.limitations);
  return {
    canonical,
    discardedMetadata: limitations.discarded,
    relationship: {
      id: connectorStableId('relationship', canonical),
      type,
      from: fromEntity.id,
      to: toEntity.id,
      classification,
      method,
      firstObservedAt,
      lastObservedAt,
      complete: typeof value.complete === 'boolean' ? value.complete : null,
      truncated: typeof value.truncated === 'boolean' ? value.truncated : null,
      limitations: limitations.values,
    },
  };
}

function compareConnectorRelationships(
  left: ConnectorRelationshipCandidate,
  right: ConnectorRelationshipCandidate,
): number {
  return left.relationship.type.localeCompare(right.relationship.type)
    || left.relationship.from.localeCompare(right.relationship.from)
    || left.relationship.to.localeCompare(right.relationship.to)
    || left.relationship.id.localeCompare(right.relationship.id)
    || JSON.stringify(left.relationship).localeCompare(JSON.stringify(right.relationship));
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .slice(0, MAX_TAGS * 2)
    .map((item) => boundedString(item, MAX_TAG_LENGTH))
    .filter((item): item is string => item !== null))]
    .sort()
    .slice(0, MAX_TAGS);
}

function normalizeFinding(value: unknown): ThreatIntelligenceFinding | null {
  if (!isRecord(value)) return null;
  const category = typeof value.category === 'string' && CATEGORIES.has(value.category as ThreatIntelligenceCategory)
    ? value.category as ThreatIntelligenceCategory
    : null;
  if (!category) return null;
  const firstObservedAt = value.firstObservedAt == null ? null : isoTimestamp(value.firstObservedAt);
  const lastObservedAt = value.lastObservedAt == null ? null : isoTimestamp(value.lastObservedAt);
  if ((value.firstObservedAt != null && !firstObservedAt)
    || (value.lastObservedAt != null && !lastObservedAt)
    || (firstObservedAt && lastObservedAt && firstObservedAt > lastObservedAt)) return null;
  const referenceUrl = value.referenceUrl == null ? null : httpsUrl(value.referenceUrl);
  if (value.referenceUrl != null && !referenceUrl) return null;
  return {
    id: strictBoundedString(value.id, MAX_FINDING_ID_LENGTH),
    category,
    severity: typeof value.severity === 'string' && SEVERITIES.has(value.severity as ThreatIntelligenceSeverity)
      ? value.severity as ThreatIntelligenceSeverity
      : 'unknown',
    confidence: typeof value.confidence === 'string' && CONFIDENCES.has(value.confidence as ThreatIntelligenceConfidence)
      ? value.confidence as ThreatIntelligenceConfidence
      : 'unknown',
    providerVerdict: boundedString(value.providerVerdict, MAX_VERDICT_LENGTH),
    detail: boundedString(value.detail, MAX_DETAIL_LENGTH),
    firstObservedAt,
    lastObservedAt,
    referenceUrl,
    tags: normalizeTags(value.tags),
  };
}

function findingKey(value: ThreatIntelligenceFinding): string {
  return value.id || JSON.stringify([
    value.category,
    value.severity,
    value.providerVerdict,
    value.firstObservedAt,
    value.lastObservedAt,
    value.referenceUrl,
  ]);
}

function compareFindings(left: ThreatIntelligenceFinding, right: ThreatIntelligenceFinding): number {
  const timeOrder = (right.lastObservedAt || '').localeCompare(left.lastObservedAt || '');
  if (timeOrder) return timeOrder;
  const keyOrder = findingKey(left).localeCompare(findingKey(right));
  return keyOrder || JSON.stringify(left).localeCompare(JSON.stringify(right));
}

function normalizeLimitations(value: unknown): string[] {
  return [...new Set((Array.isArray(value) ? value : [])
    .slice(0, MAX_LIMITATIONS * 2)
    .map((item) => boundedString(item, MAX_DETAIL_LENGTH))
    .filter((item): item is string => item !== null))]
    .slice(0, MAX_LIMITATIONS);
}

function createThreatIntelligenceResult(
  provider: ThreatIntelligenceProviderDefinition,
  target: unknown,
  input: unknown = {},
  observedAt: unknown = new Date().toISOString(),
): ThreatIntelligenceResult {
  assertThreatIntelligenceProvider(provider);
  const targetType = isRecord(target) && (target.type === 'domain' || target.type === 'url')
    ? target.type
    : null;
  const exposure = targetType ? provider.targets[targetType] : undefined;
  if (!exposure) throw new TypeError('Provider does not support this target type');
  const normalizedTarget = normalizeThreatIntelligenceTarget(target, exposure);
  const resultInput = isRecord(input) ? input : {};
  const requestedState = typeof resultInput.state === 'string'
    && RESULT_STATES.has(resultInput.state as ThreatIntelligenceResultState)
    ? resultInput.state as ThreatIntelligenceResultState
    : 'error';
  const rawFindings = Array.isArray(resultInput.findings)
    ? resultInput.findings.slice(0, MAX_INPUT_FINDINGS)
    : [];
  const normalizedFindings: ThreatIntelligenceFinding[] = [];
  let discarded = Array.isArray(resultInput.findings)
    ? Math.max(0, resultInput.findings.length - MAX_INPUT_FINDINGS)
    : 0;
  for (const item of rawFindings) {
    const finding = normalizeFinding(item);
    if (!finding) {
      discarded += 1;
      continue;
    }
    normalizedFindings.push(finding);
  }
  normalizedFindings.sort(compareFindings);
  const findings: ThreatIntelligenceFinding[] = [];
  const seen = new Set<string>();
  for (const finding of normalizedFindings) {
    const key = findingKey(finding);
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push(finding);
  }
  if (findings.length > MAX_FINDINGS) {
    discarded += findings.length - MAX_FINDINGS;
    findings.length = MAX_FINDINGS;
  }

  let state = requestedState;
  const sourceTruncated = resultInput.truncated === true;
  if (TERMINAL_STATES_WITHOUT_FINDINGS.has(state) && findings.length) state = 'partial';
  if (state === 'success' && findings.length === 0) state = 'error';
  if ((discarded > 0 || sourceTruncated) && !['error', 'unavailable', 'rate_limited'].includes(state)) state = 'partial';
  const limitations = normalizeLimitations(resultInput.limitations);
  if (state === 'not_found') limitations.unshift(NO_MATCH_LIMITATION);
  if (discarded > 0) limitations.unshift(`${discarded} invalid or over-limit provider finding${discarded === 1 ? ' was' : 's were'} omitted.`);
  limitations.unshift(BASE_LIMITATION);
  const boundedLimitations = [...new Set(limitations)].slice(0, MAX_LIMITATIONS);
  const complete = ['success', 'not_found'].includes(state) && discarded === 0 && !sourceTruncated;
  const observationStatus: ObservationStatus = state === 'rate_limited' || state === 'unavailable'
    ? 'error'
    : state;
  const upstreamStatus = typeof resultInput.upstreamStatus === 'number'
    && Number.isInteger(resultInput.upstreamStatus)
    && resultInput.upstreamStatus >= 100
    && resultInput.upstreamStatus <= 599
    ? resultInput.upstreamStatus
    : null;
  const retryAfterSeconds = typeof resultInput.retryAfterSeconds === 'number'
    && Number.isInteger(resultInput.retryAfterSeconds)
    && resultInput.retryAfterSeconds >= 1
    && resultInput.retryAfterSeconds <= 86_400
    ? resultInput.retryAfterSeconds
    : null;

  return {
    schema: THREAT_INTELLIGENCE_SCHEMA,
    version: THREAT_INTELLIGENCE_CONTRACT_VERSION,
    provider: { id: provider.id, label: provider.label },
    target: normalizedTarget,
    state,
    detail: boundedString(resultInput.detail, MAX_DETAIL_LENGTH),
    upstreamStatus,
    retryAfterSeconds,
    findings,
    observation: createObservation({
      status: observationStatus,
      observedAt: isoTimestamp(observedAt) || new Date().toISOString(),
      source: provider.id,
      complete,
      truncated: discarded > 0 || sourceTruncated,
      limitations: boundedLimitations,
      diagnostics: { discarded },
    }),
  };
}

function createCuratedConnectorResult(
  connector: CuratedConnectorDefinition,
  target: unknown,
  input: unknown = {},
  observedAt: unknown = new Date().toISOString(),
): CuratedConnectorResult {
  assertCuratedConnectorDefinition(connector);
  const normalizedObservedAt = isoTimestamp(observedAt);
  if (!normalizedObservedAt) throw new TypeError('Connector observation timestamp is invalid');
  const targetType = isRecord(target)
    && typeof target.type === 'string'
    && CONNECTOR_ENTITY_TYPES.has(target.type as CuratedConnectorEntityType)
    ? target.type as CuratedConnectorEntityType
    : null;
  const inputDeclaration = targetType
    ? connector.inputs.find((item) => item.type === targetType)
    : null;
  if (!inputDeclaration) throw new TypeError('Connector does not support this target type');
  const normalizedTarget = normalizeCuratedConnectorTarget(target, inputDeclaration.exposure);
  const resultInput = isRecord(input) ? input : {};
  const requestedState = typeof resultInput.state === 'string'
    && RESULT_STATES.has(resultInput.state as ThreatIntelligenceResultState)
    ? resultInput.state as ThreatIntelligenceResultState
    : 'error';

  const rawEntities = Array.isArray(resultInput.entities)
    ? resultInput.entities.slice(0, MAX_CONNECTOR_INPUT_ENTITIES)
    : [];
  let discardedEntities = Array.isArray(resultInput.entities)
    ? Math.max(0, resultInput.entities.length - MAX_CONNECTOR_INPUT_ENTITIES)
    : 0;
  let discardedAttributes = 0;
  const entityCandidates: ConnectorEntityCandidate[] = [];
  const allowedEntityTypes = new Set(connector.outputs.entities);
  for (const item of rawEntities) {
    const candidate = normalizeConnectorEntity(item, allowedEntityTypes);
    if (!candidate) {
      discardedEntities += 1;
      continue;
    }
    discardedAttributes += candidate.discardedAttributes;
    entityCandidates.push(candidate);
  }
  entityCandidates.sort(compareConnectorEntities);
  const entitiesByCanonical = new Map<string, CuratedConnectorEntity>();
  const entityCanonicalById = new Map<string, string>();
  const entitiesByKey = new Map<string, Readonly<{ id: string; type: CuratedConnectorEntityType }>>();
  const seenEntityKeys = new Set<string>();
  for (const candidate of entityCandidates) {
    if (seenEntityKeys.has(candidate.key)) {
      discardedEntities += 1;
      continue;
    }
    seenEntityKeys.add(candidate.key);
    const retained = entitiesByCanonical.get(candidate.canonicalKey);
    if (retained) {
      entitiesByKey.set(candidate.key, { id: retained.id, type: retained.type });
      if (JSON.stringify(retained) !== JSON.stringify(candidate.entity)) discardedEntities += 1;
      continue;
    }
    if (entityCanonicalById.has(candidate.entity.id)
      || entitiesByCanonical.size >= connector.limits.maxEntities) {
      discardedEntities += 1;
      continue;
    }
    entitiesByCanonical.set(candidate.canonicalKey, candidate.entity);
    entityCanonicalById.set(candidate.entity.id, candidate.canonicalKey);
    entitiesByKey.set(candidate.key, { id: candidate.entity.id, type: candidate.entity.type });
  }
  const entities = [...entitiesByCanonical.values()].sort((left, right) => left.id.localeCompare(right.id));

  const rawRelationships = Array.isArray(resultInput.relationships)
    ? resultInput.relationships.slice(0, MAX_CONNECTOR_INPUT_RELATIONSHIPS)
    : [];
  let discardedRelationships = Array.isArray(resultInput.relationships)
    ? Math.max(0, resultInput.relationships.length - MAX_CONNECTOR_INPUT_RELATIONSHIPS)
    : 0;
  const relationshipCandidates: ConnectorRelationshipCandidate[] = [];
  let discardedRelationshipMetadata = 0;
  const allowedRelationshipTypes = new Set(connector.outputs.relationships);
  for (const item of rawRelationships) {
    const relationship = normalizeConnectorRelationship(item, allowedRelationshipTypes, entitiesByKey);
    if (!relationship) {
      discardedRelationships += 1;
      continue;
    }
    discardedRelationshipMetadata += relationship.discardedMetadata;
    relationshipCandidates.push(relationship);
  }
  relationshipCandidates.sort(compareConnectorRelationships);
  const relationships: CuratedConnectorRelationship[] = [];
  const relationshipsById = new Map<string, ConnectorRelationshipCandidate>();
  for (const candidate of relationshipCandidates) {
    const { relationship } = candidate;
    const retained = relationshipsById.get(relationship.id);
    if (retained?.canonical === candidate.canonical) {
      if (JSON.stringify(retained.relationship) !== JSON.stringify(relationship)) discardedRelationships += 1;
      continue;
    }
    if (retained) {
      discardedRelationships += 1;
      continue;
    }
    if (relationships.length >= connector.limits.maxRelationships) {
      discardedRelationships += 1;
      continue;
    }
    relationshipsById.set(relationship.id, candidate);
    relationships.push(relationship);
  }

  let state = requestedState;
  const sourceTruncated = resultInput.truncated === true;
  const relationshipPartial = relationships.some((item) => item.complete === false || item.truncated === true);
  const hasOutput = entities.length > 0 || relationships.length > 0;
  if (TERMINAL_STATES_WITHOUT_FINDINGS.has(state) && hasOutput) state = 'partial';
  if (state === 'success' && !hasOutput) state = 'error';
  const resultLimitations = normalizeConnectorLimitations(resultInput.limitations);
  discardedRelationshipMetadata += resultLimitations.discarded;
  if ((discardedEntities > 0
      || discardedAttributes > 0
      || discardedRelationships > 0
      || discardedRelationshipMetadata > 0
      || sourceTruncated
      || relationshipPartial)
    && !['error', 'unavailable', 'rate_limited'].includes(state)) state = 'partial';

  const limitations = resultLimitations.values;
  if (state === 'not_found') limitations.unshift(CONNECTOR_NO_MATCH_LIMITATION);
  if (discardedRelationships > 0) {
    limitations.unshift(`${discardedRelationships} invalid, dangling, or over-limit connector relationship${discardedRelationships === 1 ? ' was' : 's were'} omitted.`);
  }
  if (discardedEntities > 0) {
    limitations.unshift(`${discardedEntities} invalid, duplicate-key, hash-colliding, or over-limit connector entit${discardedEntities === 1 ? 'y was' : 'ies were'} omitted.`);
  }
  if (discardedAttributes > 0) {
    limitations.unshift(`${discardedAttributes} invalid or over-limit connector attribute value${discardedAttributes === 1 ? ' was' : 's were'} omitted.`);
  }
  if (discardedRelationshipMetadata > 0) {
    limitations.unshift(`${discardedRelationshipMetadata} invalid or over-limit connector limitation value${discardedRelationshipMetadata === 1 ? ' was' : 's were'} omitted.`);
  }
  limitations.unshift(CONNECTOR_BASE_LIMITATION);
  const boundedLimitations = [...new Set(limitations)].slice(0, MAX_LIMITATIONS);
  const complete = ['success', 'not_found'].includes(state)
    && discardedEntities === 0
    && discardedAttributes === 0
    && discardedRelationships === 0
    && discardedRelationshipMetadata === 0
    && !sourceTruncated
    && !relationshipPartial;
  const observationStatus: ObservationStatus = state === 'rate_limited' || state === 'unavailable'
    ? 'error'
    : state;
  const upstreamStatus = typeof resultInput.upstreamStatus === 'number'
    && Number.isInteger(resultInput.upstreamStatus)
    && resultInput.upstreamStatus >= 100
    && resultInput.upstreamStatus <= 599
    ? resultInput.upstreamStatus
    : null;
  const retryAfterSeconds = typeof resultInput.retryAfterSeconds === 'number'
    && Number.isInteger(resultInput.retryAfterSeconds)
    && resultInput.retryAfterSeconds >= 1
    && resultInput.retryAfterSeconds <= 86_400
    ? resultInput.retryAfterSeconds
    : null;

  return {
    schema: CURATED_CONNECTOR_RESULT_SCHEMA,
    version: CURATED_CONNECTOR_CONTRACT_VERSION,
    connector: {
      id: connector.id,
      label: connector.label,
      kinds: [...connector.kinds],
      collection: connector.collection,
    },
    target: normalizedTarget,
    state,
    detail: boundedString(resultInput.detail, MAX_DETAIL_LENGTH),
    upstreamStatus,
    retryAfterSeconds,
    entities,
    relationships,
    observation: createObservation({
      status: observationStatus,
      observedAt: normalizedObservedAt,
      source: connector.id,
      complete,
      truncated: discardedEntities > 0
        || discardedAttributes > 0
        || discardedRelationships > 0
        || discardedRelationshipMetadata > 0
        || sourceTruncated
        || relationships.some((item) => item.truncated === true),
      limitations: boundedLimitations,
      diagnostics: {
        entities: entities.length,
        relationships: relationships.length,
        discarded_entities: discardedEntities,
        discarded_attributes: discardedAttributes,
        discarded_relationships: discardedRelationships,
        discarded_metadata: discardedRelationshipMetadata,
      },
    }),
  };
}

export {
  THREAT_INTELLIGENCE_CONTRACT_VERSION,
  THREAT_INTELLIGENCE_SCHEMA,
  CURATED_CONNECTOR_CONTRACT_VERSION,
  CURATED_CONNECTOR_RESULT_SCHEMA,
  MAX_FINDINGS,
  MAX_INPUT_FINDINGS,
  MAX_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  MAX_CACHE_TTL_MS,
  MAX_CONNECTOR_ENTITIES,
  MAX_CONNECTOR_RELATIONSHIPS,
  MAX_CONNECTOR_INPUT_ENTITIES,
  MAX_CONNECTOR_INPUT_RELATIONSHIPS,
  normalizeThreatIntelligenceTarget,
  normalizeCuratedConnectorTarget,
  createThreatIntelligenceResult,
  createCuratedConnectorResult,
};

export type {
  ThreatIntelligenceCapability,
  ThreatIntelligenceCategory,
  ThreatIntelligenceConfidence,
  ThreatIntelligenceFinding,
  ThreatIntelligenceProviderDefinition,
  ThreatIntelligenceProviderLimits,
  ThreatIntelligenceProviderMatrixEntry,
  ThreatIntelligenceProviderTargets,
  ThreatIntelligenceProviderTerms,
  ThreatIntelligenceResult,
  ThreatIntelligenceResultState,
  ThreatIntelligenceSeverity,
  ThreatIntelligenceTarget,
  ThreatIntelligenceTargetExposure,
  ThreatIntelligenceTargetType,
  CuratedConnectorCollection,
  CuratedConnectorCredentialMode,
  CuratedConnectorCredentials,
  CuratedConnectorDefinition,
  CuratedConnectorEntity,
  CuratedConnectorEntityType,
  CuratedConnectorInput,
  CuratedConnectorKind,
  CuratedConnectorLimits,
  CuratedConnectorMatrixEntry,
  CuratedConnectorOutputs,
  CuratedConnectorRelationship,
  CuratedConnectorRelationshipClassification,
  CuratedConnectorRelationshipType,
  CuratedConnectorResult,
  CuratedConnectorTarget,
  CuratedConnectorTargetExposure,
};
