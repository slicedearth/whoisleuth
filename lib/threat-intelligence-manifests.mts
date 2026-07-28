import {
  registerCuratedConnector,
  registerThreatIntelligenceProvider,
  isCuratedConnectorDefinition,
  isThreatIntelligenceProvider,
} from './threat-intelligence-definition-registry.mts';
import {
  CURATED_CONNECTOR_CONTRACT_VERSION,
  MAX_CACHE_TTL_MS,
  MAX_CONNECTOR_ENTITIES,
  MAX_CONNECTOR_RELATIONSHIPS,
  MAX_RESPONSE_BYTES,
  MAX_TIMEOUT_MS,
  THREAT_INTELLIGENCE_CONTRACT_VERSION,
} from './threat-intelligence-runtime.mts';
import type {
  CuratedConnectorCollection,
  CuratedConnectorCredentialMode,
  CuratedConnectorCredentials,
  CuratedConnectorDefinition,
  CuratedConnectorEntityType,
  CuratedConnectorInput,
  CuratedConnectorKind,
  CuratedConnectorLimits,
  CuratedConnectorMatrixEntry,
  CuratedConnectorOutputs,
  CuratedConnectorRelationshipType,
  CuratedConnectorTargetExposure,
  ThreatIntelligenceCapability,
  ThreatIntelligenceProviderDefinition,
  ThreatIntelligenceProviderLimits,
  ThreatIntelligenceProviderMatrixEntry,
  ThreatIntelligenceProviderTargets,
  ThreatIntelligenceProviderTerms,
  ThreatIntelligenceTargetExposure,
} from './threat-intelligence-runtime.mts';

const MAX_PROVIDER_ID_LENGTH = 40;
const MAX_PROVIDER_LABEL_LENGTH = 100;
const MAX_URL_LENGTH = 2_048;
const MAX_REQUEST_BUDGET = 1_000_000;
const MAX_CONNECTOR_SCOPES = 20;
const MAX_CONNECTOR_SCOPE_LENGTH = 80;

const CAPABILITIES = new Set<ThreatIntelligenceCapability>([
  'domain_lookup',
  'url_lookup',
  'indicator_search',
]);
const URL_EXPOSURES = new Set<ThreatIntelligenceTargetExposure>([
  'registrable_domain',
  'hostname',
  'origin',
  'full_url',
]);
const COMMERCIAL_USE = new Set(['allowed', 'restricted', 'unknown'] as const);
const ATTRIBUTION = new Set(['required', 'not_required', 'unknown'] as const);
const CACHING = new Set([
  'prohibited',
  'transient',
  'bounded',
  'provider_defined',
  'unknown',
] as const);
const QUERY_RETENTION = new Set([
  'none',
  'limited',
  'provider_defined',
  'unknown',
] as const);
const REDISTRIBUTION = new Set([
  'allowed',
  'restricted',
  'prohibited',
  'unknown',
] as const);
const CONNECTOR_KINDS = new Set<CuratedConnectorKind>([
  'discovery',
  'enrichment',
]);
const CONNECTOR_COLLECTIONS = new Set<CuratedConnectorCollection>([
  'passive',
  'active',
  'third_party',
]);
const CONNECTOR_CREDENTIAL_MODES = new Set<CuratedConnectorCredentialMode>([
  'none',
  'optional',
  'required',
]);
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
const CONNECTOR_TARGET_EXPOSURES: Readonly<
  Record<CuratedConnectorEntityType, ReadonlySet<CuratedConnectorTargetExposure>>
> = Object.freeze({
  domain: new Set<CuratedConnectorTargetExposure>(['registrable_domain']),
  hostname: new Set<CuratedConnectorTargetExposure>(['hostname']),
  url: new Set<CuratedConnectorTargetExposure>([
    'registrable_domain',
    'hostname',
    'origin',
    'full_url',
  ]),
  ipv4: new Set<CuratedConnectorTargetExposure>(['ip_address']),
  ipv6: new Set<CuratedConnectorTargetExposure>(['ip_address']),
  asn: new Set<CuratedConnectorTargetExposure>(['asn']),
  certificate: new Set<CuratedConnectorTargetExposure>([
    'certificate_fingerprint',
  ]),
});
const CONNECTOR_RELATIONSHIP_ENDPOINTS: Readonly<
  Record<
    CuratedConnectorRelationshipType,
    Readonly<{
      from: ReadonlySet<CuratedConnectorEntityType>;
      to: ReadonlySet<CuratedConnectorEntityType>;
    }>
  >
> = Object.freeze({
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function exactKeys(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) {
    throw new TypeError(`${label} contains an unknown field: ${unknown}`);
  }
}

function strictBoundedString(value: unknown, maximum: number): string | null {
  if (
    typeof value !== 'string' ||
    value.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return null;
  }
  const normalized = value.trim().replace(/\s+/gu, ' ');
  return normalized && normalized.length <= maximum ? normalized : null;
}

function isoTimestamp(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    value.length > 64 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function httpsUrl(value: unknown): string | null {
  const raw = strictBoundedString(value, MAX_URL_LENGTH);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      return null;
    }
    const normalized = parsed.toString();
    return normalized.length <= MAX_URL_LENGTH ? normalized : null;
  } catch {
    return null;
  }
}

function enumValue<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  label: string,
): T {
  if (typeof value !== 'string' || !allowed.has(value as T)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as T;
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError(
      `${label} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

function normalizeTargets(value: unknown): ThreatIntelligenceProviderTargets {
  exactKeys(value, new Set(['domain', 'url']), 'Provider targets');
  const targets: {
    domain?: 'registrable_domain';
    url?: ThreatIntelligenceTargetExposure;
  } = {};
  if (value.domain !== undefined) {
    targets.domain = enumValue(
      value.domain,
      new Set<'registrable_domain'>(['registrable_domain']),
      'Provider domain exposure',
    );
  }
  if (value.url !== undefined) {
    targets.url = enumValue(value.url, URL_EXPOSURES, 'Provider url exposure');
  }
  if (!Object.keys(targets).length) {
    throw new TypeError('At least one provider target is required');
  }
  return Object.freeze(targets);
}

function normalizeTerms(value: unknown): ThreatIntelligenceProviderTerms {
  exactKeys(
    value,
    new Set([
      'reviewedAt',
      'termsUrl',
      'privacyUrl',
      'commercialUse',
      'attribution',
      'caching',
      'queryRetention',
      'redistribution',
    ]),
    'Provider terms',
  );
  const reviewedAt = isoTimestamp(value.reviewedAt);
  const termsUrl = httpsUrl(value.termsUrl);
  const privacyUrl = value.privacyUrl === null ? null : httpsUrl(value.privacyUrl);
  if (!reviewedAt || !termsUrl || (value.privacyUrl !== null && !privacyUrl)) {
    throw new TypeError(
      'Provider terms require a valid review timestamp and HTTPS policy URLs',
    );
  }
  return Object.freeze({
    reviewedAt,
    termsUrl,
    privacyUrl,
    commercialUse: enumValue(
      value.commercialUse,
      COMMERCIAL_USE,
      'Commercial-use policy',
    ),
    attribution: enumValue(
      value.attribution,
      ATTRIBUTION,
      'Attribution policy',
    ),
    caching: enumValue(value.caching, CACHING, 'Caching policy'),
    queryRetention: enumValue(
      value.queryRetention,
      QUERY_RETENTION,
      'Provider query-retention policy',
    ),
    redistribution: enumValue(
      value.redistribution,
      REDISTRIBUTION,
      'Redistribution policy',
    ),
  });
}

function normalizeLimits(
  value: unknown,
  terms: ThreatIntelligenceProviderTerms,
): ThreatIntelligenceProviderLimits {
  exactKeys(
    value,
    new Set([
      'timeoutMs',
      'maxResponseBytes',
      'cacheTtlMs',
      'concurrency',
      'dailyRequests',
      'monthlyRequests',
    ]),
    'Provider limits',
  );
  const limits = {
    timeoutMs: boundedInteger(
      value.timeoutMs,
      250,
      MAX_TIMEOUT_MS,
      'Provider timeout',
    ),
    maxResponseBytes: boundedInteger(
      value.maxResponseBytes,
      1_024,
      MAX_RESPONSE_BYTES,
      'Provider response cap',
    ),
    cacheTtlMs: boundedInteger(
      value.cacheTtlMs,
      0,
      MAX_CACHE_TTL_MS,
      'Provider cache TTL',
    ),
    concurrency: boundedInteger(
      value.concurrency,
      1,
      10,
      'Provider concurrency',
    ),
    dailyRequests: boundedInteger(
      value.dailyRequests,
      1,
      MAX_REQUEST_BUDGET,
      'Provider daily request budget',
    ),
    monthlyRequests: boundedInteger(
      value.monthlyRequests,
      1,
      MAX_REQUEST_BUDGET,
      'Provider monthly request budget',
    ),
  };
  if (limits.monthlyRequests < limits.dailyRequests) {
    throw new TypeError(
      'Provider monthly request budget must not be lower than its daily budget',
    );
  }
  if (
    ['prohibited', 'unknown'].includes(terms.caching) &&
    limits.cacheTtlMs !== 0
  ) {
    throw new TypeError(
      'Provider cache TTL must be zero when caching is prohibited or unknown',
    );
  }
  return Object.freeze(limits);
}

export function defineThreatIntelligenceProvider(
  value: unknown,
): ThreatIntelligenceProviderDefinition {
  exactKeys(
    value,
    new Set([
      'id',
      'label',
      'capabilities',
      'targets',
      'interaction',
      'terms',
      'limits',
    ]),
    'Provider definition',
  );
  const id = strictBoundedString(value.id, MAX_PROVIDER_ID_LENGTH);
  const label = strictBoundedString(value.label, MAX_PROVIDER_LABEL_LENGTH);
  if (!id || !/^[a-z0-9][a-z0-9_-]*$/u.test(id) || !label) {
    throw new TypeError('Provider identity is invalid');
  }
  if (value.interaction !== 'lookup_only') {
    throw new TypeError(
      'Threat-intelligence providers must be lookup-only in contract version 1',
    );
  }
  if (
    !Array.isArray(value.capabilities) ||
    !value.capabilities.length ||
    value.capabilities.length > CAPABILITIES.size
  ) {
    throw new TypeError(
      'Provider capabilities must be a non-empty bounded array',
    );
  }
  const capabilities = [
    ...new Set(
      value.capabilities.map((item: unknown) =>
        enumValue(item, CAPABILITIES, 'Provider capability'),
      ),
    ),
  ].sort();
  if (capabilities.length !== value.capabilities.length) {
    throw new TypeError('Provider capabilities must be unique');
  }
  const targets = normalizeTargets(value.targets);
  if (capabilities.includes('domain_lookup') && !targets.domain) {
    throw new TypeError('Domain lookup capability requires a domain target');
  }
  if (capabilities.includes('url_lookup') && !targets.url) {
    throw new TypeError('URL lookup capability requires a URL target');
  }
  if (
    targets.domain &&
    !capabilities.some((item) =>
      ['domain_lookup', 'indicator_search'].includes(item),
    )
  ) {
    throw new TypeError(
      'Domain targets require a compatible lookup capability',
    );
  }
  if (
    targets.url &&
    !capabilities.some((item) =>
      ['url_lookup', 'indicator_search'].includes(item),
    )
  ) {
    throw new TypeError('URL targets require a compatible lookup capability');
  }
  const terms = normalizeTerms(value.terms);
  return registerThreatIntelligenceProvider(
    Object.freeze({
      version: THREAT_INTELLIGENCE_CONTRACT_VERSION,
      id,
      label,
      capabilities: Object.freeze(capabilities),
      targets,
      interaction: 'lookup_only' as const,
      terms,
      limits: normalizeLimits(value.limits, terms),
    }),
  );
}

function normalizeConnectorCredentials(
  value: unknown,
): CuratedConnectorCredentials {
  exactKeys(value, new Set(['mode', 'scopes']), 'Connector credentials');
  const mode = enumValue(
    value.mode,
    CONNECTOR_CREDENTIAL_MODES,
    'Connector credential mode',
  );
  if (!Array.isArray(value.scopes) || value.scopes.length > MAX_CONNECTOR_SCOPES) {
    throw new TypeError(
      'Connector credential scopes must be a bounded array',
    );
  }
  const scopes = value.scopes.map((item: unknown) =>
    strictBoundedString(item, MAX_CONNECTOR_SCOPE_LENGTH),
  );
  if (
    scopes.some((item) => !item || !/^[a-z0-9][a-z0-9:_-]*$/iu.test(item))
  ) {
    throw new TypeError('Connector credential scopes are invalid');
  }
  const unique = [...new Set(scopes as string[])].sort();
  if (
    unique.length !== scopes.length ||
    (mode === 'none' && unique.length !== 0) ||
    (mode !== 'none' && unique.length === 0)
  ) {
    throw new TypeError('Connector credential mode and scopes are inconsistent');
  }
  return Object.freeze({ mode, scopes: Object.freeze(unique) });
}

function normalizeConnectorInputs(value: unknown): readonly CuratedConnectorInput[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > CONNECTOR_ENTITY_TYPES.size
  ) {
    throw new TypeError('Connector inputs must be a non-empty bounded array');
  }
  const seen = new Set<CuratedConnectorEntityType>();
  const inputs = value.map((item: unknown) => {
    exactKeys(item, new Set(['type', 'exposure']), 'Connector input');
    const type = enumValue(
      item.type,
      CONNECTOR_ENTITY_TYPES,
      'Connector input type',
    );
    const exposure = enumValue(
      item.exposure,
      CONNECTOR_TARGET_EXPOSURES[type],
      'Connector input exposure',
    );
    if (seen.has(type)) {
      throw new TypeError('Connector input types must be unique');
    }
    seen.add(type);
    return Object.freeze({ type, exposure });
  });
  return Object.freeze(
    inputs.sort((left, right) => left.type.localeCompare(right.type)),
  );
}

function normalizeConnectorOutputs(value: unknown): CuratedConnectorOutputs {
  exactKeys(value, new Set(['entities', 'relationships']), 'Connector outputs');
  if (
    !Array.isArray(value.entities) ||
    !Array.isArray(value.relationships) ||
    value.entities.length > CONNECTOR_ENTITY_TYPES.size ||
    value.relationships.length > CONNECTOR_RELATIONSHIP_TYPES.size
  ) {
    throw new TypeError('Connector outputs must use bounded arrays');
  }
  const entities = value.entities.map((item: unknown) =>
    enumValue(item, CONNECTOR_ENTITY_TYPES, 'Connector output entity'),
  );
  const relationships = value.relationships.map((item: unknown) =>
    enumValue(
      item,
      CONNECTOR_RELATIONSHIP_TYPES,
      'Connector output relationship',
    ),
  );
  if (
    new Set(entities).size !== entities.length ||
    new Set(relationships).size !== relationships.length
  ) {
    throw new TypeError('Connector outputs must be unique');
  }
  if (!entities.length) {
    throw new TypeError(
      'Connector outputs require at least one normalized entity type',
    );
  }
  const entityTypes = new Set(entities);
  for (const relationship of relationships) {
    const endpoints = CONNECTOR_RELATIONSHIP_ENDPOINTS[relationship];
    if (
      ![...endpoints.from].some((type) => entityTypes.has(type)) ||
      ![...endpoints.to].some((type) => entityTypes.has(type))
    ) {
      throw new TypeError(
        `Connector relationship output ${relationship} lacks compatible entity outputs`,
      );
    }
  }
  return Object.freeze({
    entities: Object.freeze(entities.sort()),
    relationships: Object.freeze(relationships.sort()),
  });
}

function normalizeConnectorLimits(
  value: unknown,
  terms: ThreatIntelligenceProviderTerms,
): CuratedConnectorLimits {
  exactKeys(
    value,
    new Set([
      'timeoutMs',
      'maxResponseBytes',
      'cacheTtlMs',
      'concurrency',
      'dailyRequests',
      'monthlyRequests',
      'maxEntities',
      'maxRelationships',
    ]),
    'Connector limits',
  );
  const limits = {
    timeoutMs: boundedInteger(
      value.timeoutMs,
      250,
      MAX_TIMEOUT_MS,
      'Connector timeout',
    ),
    maxResponseBytes: boundedInteger(
      value.maxResponseBytes,
      1_024,
      MAX_RESPONSE_BYTES,
      'Connector response cap',
    ),
    cacheTtlMs: boundedInteger(
      value.cacheTtlMs,
      0,
      MAX_CACHE_TTL_MS,
      'Connector cache TTL',
    ),
    concurrency: boundedInteger(
      value.concurrency,
      1,
      10,
      'Connector concurrency',
    ),
    dailyRequests: boundedInteger(
      value.dailyRequests,
      1,
      MAX_REQUEST_BUDGET,
      'Connector daily request budget',
    ),
    monthlyRequests: boundedInteger(
      value.monthlyRequests,
      1,
      MAX_REQUEST_BUDGET,
      'Connector monthly request budget',
    ),
    maxEntities: boundedInteger(
      value.maxEntities,
      1,
      MAX_CONNECTOR_ENTITIES,
      'Connector entity cap',
    ),
    maxRelationships: boundedInteger(
      value.maxRelationships,
      0,
      MAX_CONNECTOR_RELATIONSHIPS,
      'Connector relationship cap',
    ),
  };
  if (limits.monthlyRequests < limits.dailyRequests) {
    throw new TypeError(
      'Connector monthly request budget must not be lower than its daily budget',
    );
  }
  if (
    ['prohibited', 'unknown'].includes(terms.caching) &&
    limits.cacheTtlMs !== 0
  ) {
    throw new TypeError(
      'Connector cache TTL must be zero when caching is prohibited or unknown',
    );
  }
  return Object.freeze(limits);
}

export function defineCuratedConnector(
  value: unknown,
): CuratedConnectorDefinition {
  exactKeys(
    value,
    new Set([
      'id',
      'label',
      'kinds',
      'inputs',
      'outputs',
      'collection',
      'credentials',
      'terms',
      'limits',
      'enabledByDefault',
    ]),
    'Connector definition',
  );
  const id = strictBoundedString(value.id, MAX_PROVIDER_ID_LENGTH);
  const label = strictBoundedString(value.label, MAX_PROVIDER_LABEL_LENGTH);
  if (!id || !/^[a-z0-9][a-z0-9_-]*$/u.test(id) || !label) {
    throw new TypeError('Connector identity is invalid');
  }
  if (
    !Array.isArray(value.kinds) ||
    !value.kinds.length ||
    value.kinds.length > CONNECTOR_KINDS.size
  ) {
    throw new TypeError('Connector kinds must be a non-empty bounded array');
  }
  const kinds = value.kinds.map((item: unknown) =>
    enumValue(item, CONNECTOR_KINDS, 'Connector kind'),
  );
  if (new Set(kinds).size !== kinds.length) {
    throw new TypeError('Connector kinds must be unique');
  }
  if (value.enabledByDefault !== false) {
    throw new TypeError('Curated connectors must be disabled by default');
  }
  const terms = normalizeTerms(value.terms);
  const outputs = normalizeConnectorOutputs(value.outputs);
  const limits = normalizeConnectorLimits(value.limits, terms);
  if (outputs.relationships.length > 0 && limits.maxRelationships === 0) {
    throw new TypeError(
      'Connector relationship outputs require a positive relationship cap',
    );
  }
  return registerCuratedConnector(
    Object.freeze({
      version: CURATED_CONNECTOR_CONTRACT_VERSION,
      id,
      label,
      kinds: Object.freeze(kinds.sort()),
      inputs: normalizeConnectorInputs(value.inputs),
      outputs,
      collection: enumValue(
        value.collection,
        CONNECTOR_COLLECTIONS,
        'Connector collection mode',
      ),
      credentials: normalizeConnectorCredentials(value.credentials),
      terms,
      limits,
      enabledByDefault: false as const,
    }),
  );
}

export function buildThreatIntelligenceProviderMatrix(
  providers: unknown,
): ThreatIntelligenceProviderMatrixEntry[] {
  if (!Array.isArray(providers) || providers.length > 100) {
    throw new TypeError('Provider matrix input must be a bounded array');
  }
  const seen = new Set<string>();
  return providers
    .map((provider) => {
      if (
        !isRecord(provider) ||
        !isThreatIntelligenceProvider(provider) ||
        typeof provider.id !== 'string' ||
        seen.has(provider.id)
      ) {
        throw new TypeError(
          'Provider matrix requires unique versioned definitions',
        );
      }
      const definition = provider as ThreatIntelligenceProviderDefinition;
      seen.add(definition.id);
      return {
        id: definition.id,
        label: definition.label,
        capabilities: [...definition.capabilities],
        targets: { ...definition.targets },
        interaction: definition.interaction,
        terms: { ...definition.terms },
        limits: { ...definition.limits },
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function buildCuratedConnectorMatrix(
  connectors: unknown,
): CuratedConnectorMatrixEntry[] {
  if (!Array.isArray(connectors) || connectors.length > 100) {
    throw new TypeError('Connector matrix input must be a bounded array');
  }
  const seen = new Set<string>();
  return connectors
    .map((connector) => {
      if (
        !isRecord(connector) ||
        !isCuratedConnectorDefinition(connector) ||
        typeof connector.id !== 'string' ||
        seen.has(connector.id)
      ) {
        throw new TypeError(
          'Connector matrix requires unique versioned definitions',
        );
      }
      const definition = connector as CuratedConnectorDefinition;
      seen.add(definition.id);
      return {
        id: definition.id,
        label: definition.label,
        kinds: [...definition.kinds],
        inputs: definition.inputs.map((item) => ({ ...item })),
        outputs: {
          entities: [...definition.outputs.entities],
          relationships: [...definition.outputs.relationships],
        },
        collection: definition.collection,
        credentials: {
          mode: definition.credentials.mode,
          scopes: [...definition.credentials.scopes],
        },
        terms: { ...definition.terms },
        limits: { ...definition.limits },
        enabledByDefault: false as const,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}
