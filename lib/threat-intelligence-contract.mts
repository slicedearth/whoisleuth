// Provider-neutral contract for optional external threat-intelligence sources.
// This module performs no network requests and contains no provider credentials.
// Adapters added later must declare exactly what target representation they send,
// their reviewed terms, and bounded request/cache budgets before they can produce
// separately attributed findings through this contract.

import { classifyQuery } from './classify.mts';
import { createObservation } from './observation.mts';
import type { Observation, ObservationStatus } from './observation.mts';

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

const THREAT_INTELLIGENCE_CONTRACT_VERSION = 1;
const THREAT_INTELLIGENCE_SCHEMA = 'whoisleuth.threat-intelligence-result';
const PROVIDER_DEFINITIONS = new WeakSet<ThreatIntelligenceProviderDefinition>();
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

const BASE_LIMITATION = 'External provider observations are attributed context, not proof that a target is safe, malicious, active, or controlled by any party.';
const NO_MATCH_LIMITATION = 'No matching provider record is not evidence that the target is safe.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  const normalized = value.trim().replace(/\s+/gu, ' ');
  return normalized ? normalized.slice(0, maxLength) : null;
}

function strictBoundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string'
    || value.length > maxLength
    || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  const normalized = value.trim().replace(/\s+/gu, ' ');
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64 || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function httpsUrl(value: unknown): string | null {
  const raw = strictBoundedString(value, MAX_URL_LENGTH);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:'
      || parsed.username
      || parsed.password) return null;
    const normalized = parsed.toString();
    return normalized.length <= MAX_URL_LENGTH ? normalized : null;
  } catch {
    return null;
  }
}

function exactKeys(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new TypeError(`${label} contains an unknown field: ${unknown}`);
}

function enumValue<T extends string>(value: unknown, allowed: ReadonlySet<T>, label: string): T {
  if (typeof value !== 'string' || !allowed.has(value as T)) throw new TypeError(`${label} is invalid`);
  return value as T;
}

function boundedInteger(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function normalizeTargets(value: unknown): ThreatIntelligenceProviderTargets {
  exactKeys(value, new Set(Object.keys(TARGET_EXPOSURES)), 'Provider targets');
  const targets: { domain?: 'registrable_domain'; url?: ThreatIntelligenceTargetExposure } = {};
  if (value.domain !== undefined) {
    targets.domain = enumValue(value.domain, new Set<'registrable_domain'>(['registrable_domain']), 'Provider domain exposure');
  }
  if (value.url !== undefined) {
    targets.url = enumValue(value.url, TARGET_EXPOSURES.url, 'Provider url exposure');
  }
  if (!Object.keys(targets).length) throw new TypeError('At least one provider target is required');
  return Object.freeze(targets);
}

function normalizeTerms(value: unknown): ThreatIntelligenceProviderTerms {
  exactKeys(value, new Set([
    'reviewedAt',
    'termsUrl',
    'privacyUrl',
    'commercialUse',
    'attribution',
    'caching',
    'queryRetention',
    'redistribution',
  ]), 'Provider terms');
  const reviewedAt = isoTimestamp(value.reviewedAt);
  const termsUrl = httpsUrl(value.termsUrl);
  const privacyUrl = value.privacyUrl === null ? null : httpsUrl(value.privacyUrl);
  if (!reviewedAt || !termsUrl || (value.privacyUrl !== null && !privacyUrl)) {
    throw new TypeError('Provider terms require a valid review timestamp and HTTPS policy URLs');
  }
  return Object.freeze({
    reviewedAt,
    termsUrl,
    privacyUrl,
    commercialUse: enumValue(value.commercialUse, COMMERCIAL_USE, 'Commercial-use policy'),
    attribution: enumValue(value.attribution, ATTRIBUTION, 'Attribution policy'),
    caching: enumValue(value.caching, CACHING, 'Caching policy'),
    queryRetention: enumValue(value.queryRetention, QUERY_RETENTION, 'Provider query-retention policy'),
    redistribution: enumValue(value.redistribution, REDISTRIBUTION, 'Redistribution policy'),
  });
}

function normalizeLimits(value: unknown, terms: ThreatIntelligenceProviderTerms): ThreatIntelligenceProviderLimits {
  exactKeys(value, new Set(['timeoutMs', 'maxResponseBytes', 'cacheTtlMs', 'concurrency', 'dailyRequests', 'monthlyRequests']), 'Provider limits');
  const limits = {
    timeoutMs: boundedInteger(value.timeoutMs, 250, MAX_TIMEOUT_MS, 'Provider timeout'),
    maxResponseBytes: boundedInteger(value.maxResponseBytes, 1024, MAX_RESPONSE_BYTES, 'Provider response cap'),
    cacheTtlMs: boundedInteger(value.cacheTtlMs, 0, MAX_CACHE_TTL_MS, 'Provider cache TTL'),
    concurrency: boundedInteger(value.concurrency, 1, 10, 'Provider concurrency'),
    dailyRequests: boundedInteger(value.dailyRequests, 1, MAX_REQUEST_BUDGET, 'Provider daily request budget'),
    monthlyRequests: boundedInteger(value.monthlyRequests, 1, MAX_REQUEST_BUDGET, 'Provider monthly request budget'),
  };
  if (limits.monthlyRequests < limits.dailyRequests) {
    throw new TypeError('Provider monthly request budget must not be lower than its daily budget');
  }
  if (['prohibited', 'unknown'].includes(terms.caching) && limits.cacheTtlMs !== 0) {
    throw new TypeError('Provider cache TTL must be zero when caching is prohibited or unknown');
  }
  return Object.freeze(limits);
}

function defineThreatIntelligenceProvider(value: unknown): ThreatIntelligenceProviderDefinition {
  exactKeys(value, new Set(['id', 'label', 'capabilities', 'targets', 'interaction', 'terms', 'limits']), 'Provider definition');
  const id = strictBoundedString(value.id, MAX_PROVIDER_ID_LENGTH);
  const label = strictBoundedString(value.label, MAX_PROVIDER_LABEL_LENGTH);
  if (!id || !/^[a-z0-9][a-z0-9_-]*$/u.test(id) || !label) {
    throw new TypeError('Provider identity is invalid');
  }
  if (value.interaction !== 'lookup_only') {
    throw new TypeError('Threat-intelligence providers must be lookup-only in contract version 1');
  }
  if (!Array.isArray(value.capabilities) || !value.capabilities.length || value.capabilities.length > CAPABILITIES.size) {
    throw new TypeError('Provider capabilities must be a non-empty bounded array');
  }
  const capabilities = [...new Set(value.capabilities.map((item: unknown) => enumValue(item, CAPABILITIES, 'Provider capability')))].sort();
  if (capabilities.length !== value.capabilities.length) throw new TypeError('Provider capabilities must be unique');
  const targets = normalizeTargets(value.targets);
  if (capabilities.includes('domain_lookup') && !targets.domain) throw new TypeError('Domain lookup capability requires a domain target');
  if (capabilities.includes('url_lookup') && !targets.url) throw new TypeError('URL lookup capability requires a URL target');
  if (targets.domain && !capabilities.some((item) => ['domain_lookup', 'indicator_search'].includes(item))) {
    throw new TypeError('Domain targets require a compatible lookup capability');
  }
  if (targets.url && !capabilities.some((item) => ['url_lookup', 'indicator_search'].includes(item))) {
    throw new TypeError('URL targets require a compatible lookup capability');
  }
  const terms = normalizeTerms(value.terms);
  const definition = Object.freeze({
    version: THREAT_INTELLIGENCE_CONTRACT_VERSION,
    id,
    label,
    capabilities: Object.freeze(capabilities),
    targets,
    interaction: 'lookup_only',
    terms,
    limits: normalizeLimits(value.limits, terms),
  });
  PROVIDER_DEFINITIONS.add(definition);
  return definition;
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
  if (!provider || !PROVIDER_DEFINITIONS.has(provider)) {
    throw new TypeError('A versioned threat-intelligence provider definition is required');
  }
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
  if (TERMINAL_STATES_WITHOUT_FINDINGS.has(state) && findings.length) state = 'partial';
  if (state === 'success' && findings.length === 0) state = 'error';
  if (discarded > 0 && !['error', 'unavailable', 'rate_limited'].includes(state)) state = 'partial';
  const limitations = normalizeLimitations(resultInput.limitations);
  if (state === 'not_found') limitations.unshift(NO_MATCH_LIMITATION);
  if (discarded > 0) limitations.unshift(`${discarded} invalid or over-limit provider finding${discarded === 1 ? ' was' : 's were'} omitted.`);
  limitations.unshift(BASE_LIMITATION);
  const boundedLimitations = [...new Set(limitations)].slice(0, MAX_LIMITATIONS);
  const complete = ['success', 'not_found'].includes(state) && discarded === 0;
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
      truncated: discarded > 0,
      limitations: boundedLimitations,
      diagnostics: { discarded },
    }),
  };
}

function buildThreatIntelligenceProviderMatrix(providers: unknown): ThreatIntelligenceProviderMatrixEntry[] {
  if (!Array.isArray(providers) || providers.length > 100) throw new TypeError('Provider matrix input must be a bounded array');
  const seen = new Set<string>();
  return providers.map((provider) => {
    if (!isRecord(provider)
      || !PROVIDER_DEFINITIONS.has(provider as ThreatIntelligenceProviderDefinition)
      || typeof provider.id !== 'string'
      || seen.has(provider.id)) {
      throw new TypeError('Provider matrix requires unique versioned definitions');
    }
    const definition = provider as ThreatIntelligenceProviderDefinition;
    seen.add(definition.id);
    return {
      id: definition.id,
      label: definition.label,
      capabilities: [...definition.capabilities],
      targets: { ...definition.targets },
      interaction: definition.interaction,
      terms: {
        reviewedAt: definition.terms.reviewedAt,
        termsUrl: definition.terms.termsUrl,
        privacyUrl: definition.terms.privacyUrl,
        commercialUse: definition.terms.commercialUse,
        attribution: definition.terms.attribution,
        caching: definition.terms.caching,
        queryRetention: definition.terms.queryRetention,
        redistribution: definition.terms.redistribution,
      },
      limits: {
        timeoutMs: definition.limits.timeoutMs,
        maxResponseBytes: definition.limits.maxResponseBytes,
        cacheTtlMs: definition.limits.cacheTtlMs,
        concurrency: definition.limits.concurrency,
        dailyRequests: definition.limits.dailyRequests,
        monthlyRequests: definition.limits.monthlyRequests,
      },
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
}

export {
  THREAT_INTELLIGENCE_CONTRACT_VERSION,
  THREAT_INTELLIGENCE_SCHEMA,
  MAX_FINDINGS,
  MAX_INPUT_FINDINGS,
  MAX_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  MAX_CACHE_TTL_MS,
  defineThreatIntelligenceProvider,
  normalizeThreatIntelligenceTarget,
  createThreatIntelligenceResult,
  buildThreatIntelligenceProviderMatrix,
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
};
