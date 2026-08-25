// Provider-neutral types shared by threat-intelligence and curated connector
// manifests, fixture harnesses, normalizers, and result builders.

import type { Observation } from '../packages/evidence/observation.mts';

export const THREAT_INTELLIGENCE_SCHEMA = 'whoisleuth.threat-intelligence-result';
export const THREAT_INTELLIGENCE_CONTRACT_VERSION = 1;
export const THREAT_INTELLIGENCE_ENVELOPE_VERSION = 1;

export type ThreatIntelligenceTargetType = 'domain' | 'url';
export type ThreatIntelligenceTargetExposure =
  | 'registrable_domain'
  | 'hostname'
  | 'origin'
  | 'full_url';
export type ThreatIntelligenceCapability =
  | 'domain_lookup'
  | 'url_lookup'
  | 'indicator_search';
export const THREAT_INTELLIGENCE_CATEGORIES = Object.freeze([
  'phishing',
  'malware',
  'spam',
  'suspicious',
  'abuse',
  'unknown',
] as const);
export type ThreatIntelligenceCategory = (typeof THREAT_INTELLIGENCE_CATEGORIES)[number];
export type ThreatIntelligenceSeverity =
  | 'critical'
  | 'high'
  | 'medium'
  | 'low'
  | 'unknown';
export type ThreatIntelligenceConfidence =
  | 'high'
  | 'medium'
  | 'low'
  | 'unknown';
export type ThreatIntelligenceCommercialUse =
  | 'allowed'
  | 'restricted'
  | 'unknown';
export type ThreatIntelligenceAttribution =
  | 'required'
  | 'not_required'
  | 'unknown';
export type ThreatIntelligenceCaching =
  | 'prohibited'
  | 'transient'
  | 'bounded'
  | 'provider_defined'
  | 'unknown';
export type ThreatIntelligenceQueryRetention =
  | 'none'
  | 'limited'
  | 'provider_defined'
  | 'unknown';
export type ThreatIntelligenceRedistribution =
  | 'allowed'
  | 'restricted'
  | 'prohibited'
  | 'unknown';
export const THREAT_INTELLIGENCE_RESULT_STATES = Object.freeze([
  'success',
  'partial',
  'not_found',
  'unsupported',
  'skipped',
  'rate_limited',
  'unavailable',
  'error',
] as const);
export type ThreatIntelligenceResultState = (typeof THREAT_INTELLIGENCE_RESULT_STATES)[number];

export type ThreatIntelligenceProviderTargets = Readonly<{
  domain?: 'registrable_domain';
  url?: ThreatIntelligenceTargetExposure;
}>;

export type ThreatIntelligenceProviderTerms = Readonly<{
  reviewedAt: string;
  termsUrl: string;
  privacyUrl: string | null;
  commercialUse: ThreatIntelligenceCommercialUse;
  attribution: ThreatIntelligenceAttribution;
  caching: ThreatIntelligenceCaching;
  queryRetention: ThreatIntelligenceQueryRetention;
  redistribution: ThreatIntelligenceRedistribution;
}>;

export type ThreatIntelligenceProviderLimits = Readonly<{
  timeoutMs: number;
  maxResponseBytes: number;
  cacheTtlMs: number;
  concurrency: number;
  dailyRequests: number;
  monthlyRequests: number;
}>;

export type ThreatIntelligenceProviderDefinition = Readonly<{
  version: number;
  id: string;
  label: string;
  capabilities: readonly ThreatIntelligenceCapability[];
  targets: ThreatIntelligenceProviderTargets;
  interaction: 'lookup_only';
  terms: ThreatIntelligenceProviderTerms;
  limits: ThreatIntelligenceProviderLimits;
}>;

export type ThreatIntelligenceTarget = Readonly<{
  type: ThreatIntelligenceTargetType;
  value: string;
  exposure: ThreatIntelligenceTargetExposure;
}>;

export type ThreatIntelligenceFinding = {
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

export type ThreatIntelligenceResult = {
  schema: typeof THREAT_INTELLIGENCE_SCHEMA;
  version: typeof THREAT_INTELLIGENCE_CONTRACT_VERSION;
  provider: { id: string; label: string };
  target: ThreatIntelligenceTarget;
  state: ThreatIntelligenceResultState;
  detail: string | null;
  upstreamStatus: number | null;
  retryAfterSeconds: number | null;
  findings: ThreatIntelligenceFinding[];
  observation: Observation;
};

export type ThreatIntelligenceEnvelope = Readonly<{
  version: typeof THREAT_INTELLIGENCE_ENVELOPE_VERSION;
  providers: readonly ThreatIntelligenceResult[];
}>;

export type ThreatIntelligenceProviderMatrixEntry = {
  id: string;
  label: string;
  capabilities: ThreatIntelligenceCapability[];
  targets: {
    domain?: 'registrable_domain';
    url?: ThreatIntelligenceTargetExposure;
  };
  interaction: 'lookup_only';
  terms: ThreatIntelligenceProviderTerms;
  limits: ThreatIntelligenceProviderLimits;
};

export type CuratedConnectorKind = 'discovery' | 'enrichment';
export type CuratedConnectorCollection =
  | 'passive'
  | 'active'
  | 'third_party';
export type CuratedConnectorCredentialMode = 'none' | 'optional' | 'required';
export type CuratedConnectorEntityType =
  | 'domain'
  | 'hostname'
  | 'url'
  | 'ipv4'
  | 'ipv6'
  | 'asn'
  | 'certificate';
export type CuratedConnectorTargetExposure =
  | 'registrable_domain'
  | 'hostname'
  | 'origin'
  | 'full_url'
  | 'ip_address'
  | 'asn'
  | 'certificate_fingerprint';
export type CuratedConnectorRelationshipType =
  | 'domain_resolves_to_ip'
  | 'domain_uses_nameserver'
  | 'domain_uses_mail_server'
  | 'domain_presented_certificate'
  | 'certificate_names_domain'
  | 'ip_hosts_domain'
  | 'domain_related_to_domain';
export type CuratedConnectorRelationshipClassification =
  | 'direct'
  | 'normalized'
  | 'derived';

export type CuratedConnectorInput = Readonly<{
  type: CuratedConnectorEntityType;
  exposure: CuratedConnectorTargetExposure;
}>;

export type CuratedConnectorOutputs = Readonly<{
  entities: readonly CuratedConnectorEntityType[];
  relationships: readonly CuratedConnectorRelationshipType[];
}>;

export type CuratedConnectorCredentials = Readonly<{
  mode: CuratedConnectorCredentialMode;
  scopes: readonly string[];
}>;

export type CuratedConnectorLimits =
  ThreatIntelligenceProviderLimits
  & Readonly<{
    maxEntities: number;
    maxRelationships: number;
  }>;

export type CuratedConnectorDefinition = Readonly<{
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

export type CuratedConnectorTarget = Readonly<{
  type: CuratedConnectorEntityType;
  value: string;
  exposure: CuratedConnectorTargetExposure;
}>;

export type CuratedConnectorEntity = {
  id: string;
  type: CuratedConnectorEntityType;
  canonical: string;
  label: string;
  attributes: Record<string, string | number | boolean>;
};

export type CuratedConnectorRelationship = {
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

export type CuratedConnectorResult = {
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

export type CuratedConnectorMatrixEntry = {
  id: string;
  label: string;
  kinds: CuratedConnectorKind[];
  inputs: CuratedConnectorInput[];
  outputs: {
    entities: CuratedConnectorEntityType[];
    relationships: CuratedConnectorRelationshipType[];
  };
  collection: CuratedConnectorCollection;
  credentials: {
    mode: CuratedConnectorCredentialMode;
    scopes: string[];
  };
  terms: ThreatIntelligenceProviderTerms;
  limits: CuratedConnectorLimits;
  enabledByDefault: false;
};
