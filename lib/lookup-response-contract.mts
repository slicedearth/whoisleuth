// Shared HTTP response boundary for the unified Lookup API.
//
// The backend owns the evidence collectors, but an HTTP response is still an
// untrusted value when it reaches the browser. This module keeps the response
// envelope typed and validates the small set of fields the Lookup controller
// relies on before any evidence is derived or rendered. Nested source records
// stay separately attributed and additive; their own normalizers remain the
// authority for source-specific fields.

import {
  THREAT_INTELLIGENCE_CATEGORIES,
  THREAT_INTELLIGENCE_RESULT_STATES,
  type ThreatIntelligenceResultState,
} from './threat-intelligence-types.mts';
import {
  MAX_HTTP_ATTEMPTS,
  MAX_HTTP_ERROR_LENGTH,
  MAX_HTTP_EVIDENCE_REDIRECTS,
  MAX_HTTP_PROVENANCE_URL,
} from './http-evidence-bounds.mts';
import {
  MAX_OBSERVATION_LIMITATIONS,
  MAX_OBSERVATION_LIMITATION_LENGTH,
} from './observation.mts';

type JsonPrimitive = boolean | number | string | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type JsonObject = { readonly [key: string]: JsonValue };
type LookupQueryType = 'domain' | 'ipv4' | 'ipv6' | 'asn';
type LookupTimingSource =
  | 'rdap'
  | 'whois'
  | 'domain_evidence'
  | 'reverse_dns'
  | 'registrar_rdap'
  | 'network_context'
  | 'security_txt'
  | 'external_intelligence'
  | 'malware_host_intelligence'
  | 'malware_ioc_intelligence';
type LookupTimingOutcome = 'fulfilled' | 'rejected';
type LookupTimingEntry = {
  readonly source: LookupTimingSource;
  readonly outcome: LookupTimingOutcome;
  readonly durationMs: number;
  readonly completedAfterMs: number;
};
type LookupTiming = {
  readonly version: 1;
  readonly totalMs: number;
  readonly sources: readonly LookupTimingEntry[];
};
type LookupClassifiedQuery = {
  readonly type: LookupQueryType;
  readonly inputHostname?: string;
  readonly registrableDomain?: string;
  readonly isSubdomain?: boolean;
};

type LookupHttpResponse = JsonObject & {
  readonly query: string;
  readonly type: LookupQueryType;
  readonly inputHostname?: string;
  readonly registrableDomain?: string;
  readonly isSubdomain?: boolean;
  readonly rdap: JsonObject;
  readonly whois: JsonObject;
  readonly availability: JsonObject;
  readonly diagnostics: JsonObject;
  readonly reverseDns?: JsonObject;
  readonly networkContext?: JsonObject;
  readonly securityTxt?: JsonObject;
  readonly sslbl?: JsonObject;
  readonly threatIntelligence?: JsonObject;
  readonly registryInsights?: JsonObject;
};

type CompactLookupAvailabilityState =
  | 'available'
  | 'expiring'
  | 'for_sale'
  | 'registered'
  | 'unknown';
type CompactLookupConfidence = 'high' | 'low' | 'medium';
type CompactBulkComparisonState = 'error' | 'not_found' | 'partial' | 'success' | 'unavailable';
type CompactBulkComparisonEvidence = {
  readonly version: 1;
  readonly technology: JsonObject & {
    readonly state: CompactBulkComparisonState;
    readonly ids: string[];
    readonly truncated: boolean;
  };
  readonly tls: JsonObject & {
    readonly state: CompactBulkComparisonState;
    readonly issuerLabel: string | null;
    readonly spkiSha256: string | null;
  };
};
type CompactLookupHttpResponse = JsonObject & {
  readonly query?: string;
  readonly type?: 'domain';
  readonly inputHostname?: string;
  readonly registrableDomain?: string;
  readonly isSubdomain?: boolean;
  readonly availability: JsonObject & {
    readonly applicable: true;
    readonly domain: string;
    readonly state: CompactLookupAvailabilityState;
    readonly confidence: CompactLookupConfidence;
    readonly bulkComparison?: CompactBulkComparisonEvidence;
  };
  readonly diagnostics: JsonObject & {
    readonly version: 7;
    readonly rdap: JsonObject;
    readonly whois: JsonObject;
    readonly availability: JsonObject;
  };
};

type LookupViewModel = {
  readonly availability: JsonObject;
  readonly rdap: JsonObject;
  readonly registrarRdap: JsonObject;
  readonly registrarRdapParsed: JsonObject;
  readonly whois: JsonObject;
  readonly rdapParsed: JsonObject;
  readonly whoisParsed: JsonObject;
  readonly diagnostics: JsonObject;
  readonly timing: LookupTiming | null;
  readonly registryAccess: JsonObject;
  readonly registryInsights: JsonObject;
  readonly reverseDns: JsonObject;
  readonly reverseDnsRecords: JsonObject;
  readonly observedNetworkContext: JsonObject;
  readonly observedNetworkEndpoint: JsonObject;
  readonly observedNetworkRdap: JsonObject;
  readonly observedNetwork: JsonObject;
  readonly securityTxt: JsonObject;
  readonly sslbl: JsonObject;
  readonly threatIntelligence: JsonObject;
  readonly threatIntelligenceProviders: JsonObject[];
  readonly dnsEvidence: JsonObject;
  readonly dnsRecords: JsonObject;
  readonly httpEvidence: JsonObject;
  readonly httpResponse: JsonObject;
  readonly httpSecurityHeaders: JsonObject;
  readonly tlsEvidence: JsonObject;
  readonly tlsCertificate: JsonObject;
  readonly tlsSubject: JsonObject;
  readonly tlsIssuer: JsonObject;
  readonly tlsAltNames: JsonObject;
  readonly tlsPublicKey: JsonObject;
  readonly tlsCipher: JsonObject;
  readonly tlsAuthorization: JsonObject;
  readonly tlsHostname: JsonObject;
  readonly tlsValidity: JsonObject;
  readonly tlsDiagnostics: JsonObject;
  readonly pageIdentity: JsonObject;
  readonly pageCanonical: JsonObject;
  readonly pageMetaRefresh: JsonObject;
  readonly pageOpenGraph: JsonObject;
  readonly pageOpenGraphUrl: JsonObject;
  readonly pageForms: JsonObject;
  readonly pageResources: JsonObject;
  readonly pageResourceTypes: JsonObject;
  readonly pageDownloads: JsonObject;
  readonly pageFingerprints: JsonObject;
  readonly credentialSurfaceProfile: JsonObject;
  readonly structuredDataIdentity: JsonObject;
  readonly technologyProfile: JsonObject;
  readonly pageRoleProfile: JsonObject;
  readonly clientBehaviorProfile: JsonObject;
  readonly securityPosture: JsonObject;
  readonly securityPostureSummary: JsonObject;
};

type LookupResponseParseResult =
  | { readonly ok: true; readonly value: LookupHttpResponse }
  | { readonly ok: false; readonly errorCode: typeof INVALID_LOOKUP_RESPONSE; readonly error: string };
type CompactLookupResponseParseResult =
  | { readonly ok: true; readonly value: CompactLookupHttpResponse }
  | {
      readonly ok: false;
      readonly errorCode: typeof INVALID_COMPACT_LOOKUP_RESPONSE;
      readonly error: string;
    };

const INVALID_LOOKUP_RESPONSE = 'INVALID_LOOKUP_RESPONSE';
const INVALID_LOOKUP_RESPONSE_MESSAGE = 'Lookup returned an invalid response.';
const INVALID_COMPACT_LOOKUP_RESPONSE = 'INVALID_COMPACT_LOOKUP_RESPONSE';
const INVALID_COMPACT_LOOKUP_RESPONSE_MESSAGE = 'Bulk lookup returned an invalid response.';
const MAX_LOOKUP_RESPONSE_QUERY_LENGTH = 4096;
const MAX_LOOKUP_RESPONSE_HOST_LENGTH = 253;
const MAX_LOOKUP_RESPONSE_TOP_LEVEL_KEYS = 32;
const MAX_LOOKUP_RESPONSE_ERROR_LENGTH = 240;
const MAX_COMPACT_LOOKUP_RESPONSE_TOP_LEVEL_KEYS = 8;
const MAX_COMPACT_LOOKUP_AVAILABILITY_KEYS = 128;
const MAX_COMPACT_LOOKUP_DIAGNOSTIC_KEYS = 16;
const MAX_COMPACT_BULK_TECHNOLOGY_IDS = 12;
const MAX_THREAT_INTELLIGENCE_PROVIDERS = 10;
const MAX_THREAT_INTELLIGENCE_FINDINGS = 100;
const MAX_THREAT_INTELLIGENCE_LIMITATIONS = 10;
const MAX_THREAT_INTELLIGENCE_TEXT_LENGTH = 500;
const MAX_LOOKUP_TIMING_MS = 120_000;
const MAX_LOOKUP_TIMING_SOURCES = 10;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/u;
const QUERY_TYPES = new Set<LookupQueryType>(['domain', 'ipv4', 'ipv6', 'asn']);
const COMPACT_AVAILABILITY_STATES = new Set<CompactLookupAvailabilityState>([
  'available',
  'expiring',
  'for_sale',
  'registered',
  'unknown',
]);
const COMPACT_CONFIDENCE_LEVELS = new Set<CompactLookupConfidence>(['high', 'low', 'medium']);
const COMPACT_AVAILABILITY_DIAGNOSTIC_STATES = new Set(['complete', 'disabled', 'error']);
const COMPACT_BULK_COMPARISON_STATES = new Set<CompactBulkComparisonState>([
  'error',
  'not_found',
  'partial',
  'success',
  'unavailable',
]);
const COMPACT_BULK_TECHNOLOGY_ID_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/u;
const SHA256_RE = /^[a-f0-9]{64}$/u;
const THREAT_INTELLIGENCE_PROVIDERS: Readonly<Record<string, Readonly<{ label: string; host: string }>>> = Object.freeze({
  urlscan_search: Object.freeze({ label: 'URLscan archived verdicts', host: 'urlscan.io' }),
  urlhaus_host: Object.freeze({ label: 'URLhaus malware-host records', host: 'urlhaus.abuse.ch' }),
  threatfox_domain_ioc: Object.freeze({ label: 'ThreatFox malware IOCs', host: 'threatfox.abuse.ch' }),
});
const THREAT_INTELLIGENCE_STATES = new Set<ThreatIntelligenceResultState>(THREAT_INTELLIGENCE_RESULT_STATES);
const THREAT_INTELLIGENCE_CATEGORY_SET = new Set<string>(THREAT_INTELLIGENCE_CATEGORIES);
const LOOKUP_TIMING_SOURCES = new Set<LookupTimingSource>([
  'rdap',
  'whois',
  'domain_evidence',
  'reverse_dns',
  'registrar_rdap',
  'network_context',
  'security_txt',
  'external_intelligence',
  'malware_host_intelligence',
  'malware_ioc_intelligence',
]);
const LOOKUP_TIMING_OUTCOMES = new Set<LookupTimingOutcome>(['fulfilled', 'rejected']);
const EMPTY_RECORD: JsonObject = Object.freeze({});

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown): JsonObject {
  return isJsonObject(value) ? value : EMPTY_RECORD;
}

function boundedThreatText(value: unknown, maximum = MAX_THREAT_INTELLIGENCE_TEXT_LENGTH): string | null {
  if (typeof value !== 'string' || CONTROL_CHAR_RE.test(value)) return null;
  const text = value.slice(0, maximum * 2).trim();
  return text ? text.slice(0, maximum) : null;
}

function threatTimestamp(value: unknown): string | null {
  const text = boundedThreatText(value, 40);
  if (!text) return null;
  const epoch = Date.parse(text);
  return Number.isFinite(epoch) ? new Date(epoch).toISOString() : null;
}

function attributedThreatUrl(value: unknown, providerId: string): string | null {
  const expectedHost = THREAT_INTELLIGENCE_PROVIDERS[providerId]?.host;
  if (!expectedHost || typeof value !== 'string' || value.length > 1_024 || CONTROL_CHAR_RE.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && url.hostname === expectedHost
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function normalizeThreatFinding(value: unknown, providerId: string): JsonObject | null {
  const input = record(value);
  const category = boundedThreatText(input.category, 32);
  if (!category || !THREAT_INTELLIGENCE_CATEGORY_SET.has(category)) return null;
  const referenceUrl = attributedThreatUrl(input.referenceUrl, providerId);
  const tags = Array.isArray(input.tags)
    ? [...new Set(input.tags.slice(0, 40).map((tag) => boundedThreatText(tag, 80)).filter((tag): tag is string => tag !== null))].slice(0, 20)
    : [];
  return {
    id: boundedThreatText(input.id, 160),
    category,
    providerVerdict: boundedThreatText(input.providerVerdict, 120),
    detail: boundedThreatText(input.detail),
    firstObservedAt: threatTimestamp(input.firstObservedAt),
    lastObservedAt: threatTimestamp(input.lastObservedAt),
    referenceUrl,
    tags,
  };
}

function normalizeThreatProvider(value: unknown): JsonObject | null {
  const input = record(value);
  const identity = record(input.provider);
  const providerId = boundedThreatText(identity.id, 80);
  const providerDefinition = providerId ? THREAT_INTELLIGENCE_PROVIDERS[providerId] : null;
  if (!providerId || !providerDefinition) return null;
  const state = boundedThreatText(input.state, 32);
  if (!state || !THREAT_INTELLIGENCE_STATES.has(state as ThreatIntelligenceResultState)) return null;
  const observationInput = record(input.observation);
  const limitations = Array.isArray(observationInput.limitations)
    ? observationInput.limitations
        .slice(0, MAX_THREAT_INTELLIGENCE_LIMITATIONS * 2)
        .map((limitation) => boundedThreatText(limitation))
        .filter((limitation): limitation is string => limitation !== null)
        .slice(0, MAX_THREAT_INTELLIGENCE_LIMITATIONS)
    : [];
  const findings = Array.isArray(input.findings)
    ? input.findings
        .slice(0, MAX_THREAT_INTELLIGENCE_FINDINGS * 2)
        .map((finding) => normalizeThreatFinding(finding, providerId))
        .filter((finding): finding is JsonObject => finding !== null)
        .slice(0, MAX_THREAT_INTELLIGENCE_FINDINGS)
    : [];
  return {
    provider: {
      id: providerId,
      label: providerDefinition.label,
    },
    state,
    detail: boundedThreatText(input.detail),
    findings,
    observation: {
      observedAt: threatTimestamp(observationInput.observedAt),
      limitations,
      complete: typeof observationInput.complete === 'boolean' ? observationInput.complete : null,
      truncated: typeof observationInput.truncated === 'boolean' ? observationInput.truncated : null,
    },
  };
}

function optionalBoundedText(value: unknown, maxLength: number): boolean {
  return value === undefined || (
    typeof value === 'string'
    && value.length <= maxLength
    && !CONTROL_CHAR_RE.test(value)
  );
}

function normalizedDomain(value: unknown): string | null {
  if (
    typeof value !== 'string'
    || !value.trim()
    || value.length > MAX_LOOKUP_RESPONSE_HOST_LENGTH
    || CONTROL_CHAR_RE.test(value)
    || /[\s/?#@\\:]/u.test(value)
  ) {
    return null;
  }
  try {
    const parsed = new URL(`https://${value.trim().replace(/\.$/u, '')}/`);
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/u, '');
    const labels = hostname.split('.');
    return labels.length >= 2
      && hostname.length <= MAX_LOOKUP_RESPONSE_HOST_LENGTH
      && labels.every((label) => (
        label.length <= 63
        && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label)
      ))
      ? hostname
      : null;
  } catch {
    return null;
  }
}

function compactDomainMatches(value: unknown, expectedDomain: unknown): boolean {
  const domain = normalizedDomain(value);
  const expected = normalizedDomain(expectedDomain);
  return Boolean(domain && expected && (domain === expected || expected.endsWith(`.${domain}`)));
}

function validCompactBulkComparison(value: unknown): value is CompactBulkComparisonEvidence {
  if (!isJsonObject(value)
    || Object.keys(value).length > 3
    || value.version !== 1
    || !isJsonObject(value.technology)
    || Object.keys(value.technology).length > 3
    || typeof value.technology.state !== 'string'
    || !COMPACT_BULK_COMPARISON_STATES.has(value.technology.state as CompactBulkComparisonState)
    || !Array.isArray(value.technology.ids)
    || value.technology.ids.length > MAX_COMPACT_BULK_TECHNOLOGY_IDS
    || typeof value.technology.truncated !== 'boolean'
    || !isJsonObject(value.tls)
    || Object.keys(value.tls).length > 3
    || typeof value.tls.state !== 'string'
    || !COMPACT_BULK_COMPARISON_STATES.has(value.tls.state as CompactBulkComparisonState)
    || (value.tls.issuerLabel !== null && !optionalBoundedText(value.tls.issuerLabel, 240))
    || (value.tls.spkiSha256 !== null
      && (typeof value.tls.spkiSha256 !== 'string' || !SHA256_RE.test(value.tls.spkiSha256)))) {
    return false;
  }
  const ids = value.technology.ids;
  return ids.every((id) => typeof id === 'string' && COMPACT_BULK_TECHNOLOGY_ID_RE.test(id))
    && new Set(ids).size === ids.length;
}

function invalidLookupResponse(): LookupResponseParseResult {
  return {
    ok: false,
    errorCode: INVALID_LOOKUP_RESPONSE,
    error: INVALID_LOOKUP_RESPONSE_MESSAGE,
  };
}

function invalidCompactLookupResponse(): CompactLookupResponseParseResult {
  return {
    ok: false,
    errorCode: INVALID_COMPACT_LOOKUP_RESPONSE,
    error: INVALID_COMPACT_LOOKUP_RESPONSE_MESSAGE,
  };
}

function validHttpProvenanceUrl(value: unknown): boolean {
  if (typeof value !== 'string'
    || !value
    || value.length > MAX_HTTP_PROVENANCE_URL
    || CONTROL_CHAR_RE.test(value)) return false;
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol)
      && Boolean(parsed.hostname)
      && !parsed.username
      && !parsed.password
      && !parsed.search
      && !parsed.hash
      && parsed.href === value;
  } catch {
    return false;
  }
}

function validOptionalHttpUrl(value: unknown): boolean {
  return value === undefined || value === null || validHttpProvenanceUrl(value);
}

function validOptionalHttpStatus(value: unknown): boolean {
  return value === undefined || value === null
    || Number.isInteger(value) && Number(value) >= 100 && Number(value) <= 599;
}

function validHttpLimitations(value: unknown): boolean {
  return value === undefined || Array.isArray(value)
    && value.length <= MAX_OBSERVATION_LIMITATIONS
    && value.every((item) => typeof item === 'string'
      && Boolean(item)
      && item.length <= MAX_OBSERVATION_LIMITATION_LENGTH
      && !CONTROL_CHAR_RE.test(item));
}

function validNormalizedHttpEvidence(value: unknown): boolean {
  if (!isJsonObject(value)
    || !validOptionalHttpUrl(value.requestUrl)
    || !validOptionalHttpUrl(value.finalUrl)
    || !validHttpLimitations(value.limitations)) return false;

  const redirects = value.redirects;
  if (redirects !== undefined && (!Array.isArray(redirects)
    || redirects.length > MAX_HTTP_EVIDENCE_REDIRECTS
    || !redirects.every((item) => isJsonObject(item)
      && validHttpProvenanceUrl(item.from)
      && validHttpProvenanceUrl(item.to)
      && validOptionalHttpStatus(item.status)
      && (item.queryOmitted === undefined || typeof item.queryOmitted === 'boolean')))) return false;

  const attempts = value.attempts;
  if (attempts !== undefined && (!Array.isArray(attempts)
    || attempts.length > MAX_HTTP_ATTEMPTS
    || !attempts.every((item) => isJsonObject(item)
      && validOptionalHttpUrl(item.url)
      && validOptionalHttpStatus(item.httpStatus)
      && (item.queryOmitted === undefined || typeof item.queryOmitted === 'boolean')
      && (item.outcome === undefined || typeof item.outcome === 'string'
        && ['error', 'response', 'unknown'].includes(item.outcome))
      && (item.error === undefined || item.error === null || typeof item.error === 'string'
        && item.error.length <= MAX_HTTP_ERROR_LENGTH && !CONTROL_CHAR_RE.test(item.error))))) return false;

  if (value.redirectCount !== undefined
    && (!Number.isInteger(value.redirectCount)
      || Number(value.redirectCount) < 0
      || Number(value.redirectCount) > MAX_HTTP_EVIDENCE_REDIRECTS)) return false;
  if (Array.isArray(redirects) && value.redirectCount !== undefined
    && value.redirectCount !== redirects.length) return false;
  if (value.response !== undefined && value.response !== null) {
    if (!isJsonObject(value.response) || !validOptionalHttpStatus(value.response.status)) return false;
  }
  return true;
}

function parseLookupHttpResponse(value: unknown): LookupResponseParseResult {
  if (!isJsonObject(value) || Object.keys(value).length > MAX_LOOKUP_RESPONSE_TOP_LEVEL_KEYS) {
    return invalidLookupResponse();
  }

  if (
    typeof value.query !== 'string'
    || !value.query.trim()
    || value.query.length > MAX_LOOKUP_RESPONSE_QUERY_LENGTH
    || CONTROL_CHAR_RE.test(value.query)
    || typeof value.type !== 'string'
    || !QUERY_TYPES.has(value.type as LookupQueryType)
    || !isJsonObject(value.rdap)
    || !isJsonObject(value.whois)
    || !isJsonObject(value.availability)
    || !isJsonObject(value.diagnostics)
    || !optionalBoundedText(value.inputHostname, MAX_LOOKUP_RESPONSE_HOST_LENGTH)
    || !optionalBoundedText(value.registrableDomain, MAX_LOOKUP_RESPONSE_HOST_LENGTH)
    || (value.isSubdomain !== undefined && typeof value.isSubdomain !== 'boolean')
  ) {
    return invalidLookupResponse();
  }

  for (const key of ['reverseDns', 'networkContext', 'securityTxt', 'sslbl', 'threatIntelligence', 'registryInsights']) {
    const section = value[key];
    if (section !== undefined && !isJsonObject(section)) return invalidLookupResponse();
  }
  if (value.availability.http !== undefined && !validNormalizedHttpEvidence(value.availability.http)) {
    return invalidLookupResponse();
  }

  return { ok: true, value: value as LookupHttpResponse };
}

function parseCompactLookupHttpResponse(
  value: unknown,
  expectedDomain: string,
): CompactLookupResponseParseResult {
  if (!isJsonObject(value) || Object.keys(value).length > MAX_COMPACT_LOOKUP_RESPONSE_TOP_LEVEL_KEYS) {
    return invalidCompactLookupResponse();
  }

  const availability = value.availability;
  const diagnostics = value.diagnostics;
  if (
    !isJsonObject(availability)
    || Object.keys(availability).length > MAX_COMPACT_LOOKUP_AVAILABILITY_KEYS
    || availability.applicable !== true
    || !compactDomainMatches(availability.domain, expectedDomain)
    || typeof availability.state !== 'string'
    || !COMPACT_AVAILABILITY_STATES.has(availability.state as CompactLookupAvailabilityState)
    || typeof availability.confidence !== 'string'
    || !COMPACT_CONFIDENCE_LEVELS.has(availability.confidence as CompactLookupConfidence)
    || (availability.deepScanComplete !== undefined && typeof availability.deepScanComplete !== 'boolean')
    || (availability.bulkComparison !== undefined
      && !validCompactBulkComparison(availability.bulkComparison))
    || (value.query !== undefined && !compactDomainMatches(value.query, expectedDomain))
    || (value.type !== undefined && value.type !== 'domain')
    || (value.inputHostname !== undefined && !compactDomainMatches(value.inputHostname, expectedDomain))
    || (
      value.registrableDomain !== undefined
      && normalizedDomain(value.registrableDomain) !== normalizedDomain(availability.domain)
    )
    || (value.isSubdomain !== undefined && typeof value.isSubdomain !== 'boolean')
    || !isJsonObject(diagnostics)
    || Object.keys(diagnostics).length > MAX_COMPACT_LOOKUP_DIAGNOSTIC_KEYS
    || diagnostics.version !== 7
    || !isJsonObject(diagnostics.rdap)
    || !isJsonObject(diagnostics.whois)
    || !isJsonObject(diagnostics.availability)
    || typeof diagnostics.availability.status !== 'string'
    || !COMPACT_AVAILABILITY_DIAGNOSTIC_STATES.has(diagnostics.availability.status)
  ) {
    return invalidCompactLookupResponse();
  }

  return { ok: true, value: value as CompactLookupHttpResponse };
}

function lookupHttpErrorMessage(value: unknown, status: number): string {
  const source = record(value);
  const message = typeof source.error === 'string'
    ? source.error
        .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, MAX_LOOKUP_RESPONSE_ERROR_LENGTH)
    : '';
  return message || `Lookup failed (${status})`;
}

function isBoundedTimingMs(value: unknown, totalMs: number): value is number {
  return Number.isInteger(value)
    && Number(value) >= 0
    && Number(value) <= totalMs
    && Number(value) <= MAX_LOOKUP_TIMING_MS;
}

function normalizeLookupTiming(value: unknown): LookupTiming | null {
  if (!isJsonObject(value)
    || value.version !== 1
    || !Number.isInteger(value.totalMs)
    || Number(value.totalMs) < 0
    || Number(value.totalMs) > MAX_LOOKUP_TIMING_MS
    || !Array.isArray(value.sources)
    || value.sources.length > MAX_LOOKUP_TIMING_SOURCES) {
    return null;
  }

  const totalMs = Number(value.totalMs);
  const seen = new Set<LookupTimingSource>();
  const sources: LookupTimingEntry[] = [];
  for (const candidate of value.sources) {
    if (!isJsonObject(candidate)
      || typeof candidate.source !== 'string'
      || !LOOKUP_TIMING_SOURCES.has(candidate.source as LookupTimingSource)
      || seen.has(candidate.source as LookupTimingSource)
      || typeof candidate.outcome !== 'string'
      || !LOOKUP_TIMING_OUTCOMES.has(candidate.outcome as LookupTimingOutcome)
      || !isBoundedTimingMs(candidate.durationMs, totalMs)
      || !isBoundedTimingMs(candidate.completedAfterMs, totalMs)
      || Number(candidate.durationMs) > Number(candidate.completedAfterMs)) {
      return null;
    }
    const source = candidate.source as LookupTimingSource;
    seen.add(source);
    sources.push({
      source,
      outcome: candidate.outcome as LookupTimingOutcome,
      durationMs: Number(candidate.durationMs),
      completedAfterMs: Number(candidate.completedAfterMs),
    });
  }

  return {
    version: 1,
    totalMs,
    sources,
  };
}

function createLookupHttpResponse(
  query: string,
  classified: LookupClassifiedQuery,
  result: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...result,
    query,
    type: classified.type,
    inputHostname: classified.inputHostname,
    registrableDomain: classified.registrableDomain,
    isSubdomain: classified.isSubdomain,
  };
}

function createLookupViewModel(response: LookupHttpResponse | null): LookupViewModel {
  const availability = record(response?.availability);
  const rdap = record(response?.rdap);
  const registrarRdap = record(rdap.registrarRdap);
  const whois = record(response?.whois);
  const diagnostics = record(response?.diagnostics);
  const reverseDns = record(response?.reverseDns);
  const observedNetworkContext = record(response?.networkContext);
  const registryInsights = record(response?.registryInsights);
  const securityTxt = record(response?.securityTxt);
  const sslbl = record(response?.sslbl);
  const threatIntelligence = record(response?.threatIntelligence);
  const seenThreatIntelligenceProviders = new Set<string>();
  const providers = Array.isArray(threatIntelligence.providers)
    ? threatIntelligence.providers
        .slice(0, MAX_THREAT_INTELLIGENCE_PROVIDERS * 2)
        .map(normalizeThreatProvider)
        .filter((provider): provider is JsonObject => provider !== null)
        .filter((provider) => {
          const providerId = String(record(provider.provider).id || '');
          if (!providerId || seenThreatIntelligenceProviders.has(providerId)) return false;
          seenThreatIntelligenceProviders.add(providerId);
          return true;
        })
        .slice(0, MAX_THREAT_INTELLIGENCE_PROVIDERS)
    : [];
  const dnsEvidence = record(availability.dns);
  const httpEvidence = record(availability.http);
  const httpResponse = record(httpEvidence.response);
  const tlsEvidence = record(availability.tls);
  const tlsCertificate = record(tlsEvidence.certificate);
  const pageIdentity = record(availability.pageIdentity);
  const pageOpenGraph = record(pageIdentity.openGraph);
  const pageResources = record(pageIdentity.resources);
  const securityPosture = record(availability.securityPosture);

  return {
    availability,
    rdap,
    registrarRdap,
    registrarRdapParsed: record(registrarRdap.parsed),
    whois,
    rdapParsed: record(rdap.parsed),
    whoisParsed: record(whois.parsed),
    diagnostics,
    timing: normalizeLookupTiming(diagnostics.timing),
    registryAccess: record(diagnostics.registryAccess),
    registryInsights,
    reverseDns,
    reverseDnsRecords: record(reverseDns.records),
    observedNetworkContext,
    observedNetworkEndpoint: record(observedNetworkContext.endpoint),
    observedNetworkRdap: record(observedNetworkContext.rdap),
    observedNetwork: record(observedNetworkContext.network),
    securityTxt,
    sslbl,
    threatIntelligence,
    threatIntelligenceProviders: providers,
    dnsEvidence,
    dnsRecords: record(dnsEvidence.records),
    httpEvidence,
    httpResponse,
    httpSecurityHeaders: record(httpResponse.securityHeaders),
    tlsEvidence,
    tlsCertificate,
    tlsSubject: record(tlsCertificate.subject),
    tlsIssuer: record(tlsCertificate.issuer),
    tlsAltNames: record(tlsCertificate.subjectAltNames),
    tlsPublicKey: record(tlsCertificate.publicKey),
    tlsCipher: record(tlsEvidence.cipher),
    tlsAuthorization: record(tlsEvidence.authorization),
    tlsHostname: record(tlsEvidence.hostname),
    tlsValidity: record(tlsEvidence.validity),
    tlsDiagnostics: record(tlsEvidence.diagnostics),
    pageIdentity,
    pageCanonical: record(pageIdentity.canonical),
    pageMetaRefresh: record(pageIdentity.metaRefresh),
    pageOpenGraph,
    pageOpenGraphUrl: record(pageOpenGraph.url),
    pageForms: record(pageIdentity.forms),
    pageResources,
    pageResourceTypes: record(pageResources.byType),
    pageDownloads: record(pageIdentity.downloads),
    pageFingerprints: record(pageIdentity.fingerprints),
    credentialSurfaceProfile: record(availability.credentialSurfaceProfile),
    structuredDataIdentity: record(availability.structuredDataIdentity),
    technologyProfile: record(availability.technologyProfile),
    pageRoleProfile: record(availability.pageRoleProfile),
    clientBehaviorProfile: record(availability.clientBehaviorProfile),
    securityPosture,
    securityPostureSummary: record(securityPosture.summary),
  };
}

export {
  INVALID_COMPACT_LOOKUP_RESPONSE,
  INVALID_COMPACT_LOOKUP_RESPONSE_MESSAGE,
  INVALID_LOOKUP_RESPONSE,
  INVALID_LOOKUP_RESPONSE_MESSAGE,
  MAX_COMPACT_LOOKUP_AVAILABILITY_KEYS,
  MAX_COMPACT_LOOKUP_DIAGNOSTIC_KEYS,
  MAX_COMPACT_LOOKUP_RESPONSE_TOP_LEVEL_KEYS,
  MAX_LOOKUP_RESPONSE_ERROR_LENGTH,
  MAX_LOOKUP_RESPONSE_HOST_LENGTH,
  MAX_LOOKUP_RESPONSE_QUERY_LENGTH,
  MAX_LOOKUP_RESPONSE_TOP_LEVEL_KEYS,
  MAX_LOOKUP_TIMING_MS,
  MAX_LOOKUP_TIMING_SOURCES,
  MAX_THREAT_INTELLIGENCE_PROVIDERS,
  MAX_THREAT_INTELLIGENCE_FINDINGS,
  MAX_THREAT_INTELLIGENCE_LIMITATIONS,
  validNormalizedHttpEvidence,
  createLookupHttpResponse,
  createLookupViewModel,
  isJsonObject,
  lookupHttpErrorMessage,
  normalizeLookupTiming,
  parseCompactLookupHttpResponse,
  parseLookupHttpResponse,
  record as lookupRecord,
};
export type {
  CompactLookupAvailabilityState,
  CompactLookupConfidence,
  CompactLookupHttpResponse,
  CompactLookupResponseParseResult,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  LookupHttpResponse,
  LookupQueryType,
  LookupResponseParseResult,
  LookupTiming,
  LookupTimingEntry,
  LookupTimingOutcome,
  LookupTimingSource,
  LookupViewModel,
};
