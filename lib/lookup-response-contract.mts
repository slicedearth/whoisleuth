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
  MAX_OBSERVATION_DIAGNOSTICS,
  MAX_OBSERVATION_LIMITATIONS,
  MAX_OBSERVATION_LIMITATION_LENGTH,
} from './observation.mts';
import { assertBoundedJsonStructure } from './bounded-json.mts';
import {
  MAX_LOOKUP_DNS_RECORDS_PER_TYPE,
  MAX_LOOKUP_REVERSE_DNS_PTR_RECORDS,
  MAX_LOOKUP_TLS_ALT_NAMES,
  MAX_LOOKUP_TLS_CERTIFICATE_POLICIES,
  MAX_LOOKUP_TLS_CHAIN_CERTIFICATES,
  MAX_LOOKUP_TLS_FINDINGS,
  MAX_LOOKUP_TLS_NAME_VALUES,
} from './lookup-network-evidence-bounds.mts';
import { MAX_SECURITY_POSTURE_FINDINGS } from './website-security-posture.mts';
import {
  validHttpDeliveryMetadata,
  validPagePublicationMetadata,
} from './homepage-metadata-contract.mts';

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
  readonly httpDeliveryMetadata: JsonObject;
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
  readonly pagePublicationMetadata: JsonObject;
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
const MAX_LOOKUP_RESPONSE_CONTAINER_ITEMS = 500;
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

function validObservationLimitations(value: unknown): boolean {
  return value === undefined || Array.isArray(value)
    && value.length <= MAX_OBSERVATION_LIMITATIONS
    && value.every((item) => typeof item === 'string'
      && Boolean(item)
      && item.length <= MAX_OBSERVATION_LIMITATION_LENGTH
      && !CONTROL_CHAR_RE.test(item));
}

function validObservationDiagnosticValue(value: unknown, depth = 0): boolean {
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') {
    return value.length <= 240 && !CONTROL_CHAR_RE.test(value);
  }
  if (!isJsonObject(value) || depth >= 2) return false;
  const keys = Object.keys(value);
  return keys.length <= 6
    && keys.every((key) => ['status', 'error', 'detail', 'truncated', 'discarded', 'count'].includes(key))
    && keys.every((key) => validObservationDiagnosticValue(value[key], depth + 1));
}

function validObservationDiagnostics(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isJsonObject(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= MAX_OBSERVATION_DIAGNOSTICS
    && entries.every(([key, item]) => (
      Boolean(key)
      && key.length <= 40
      && /^[a-z0-9_-]+$/iu.test(key)
      && validObservationDiagnosticValue(item)
    ));
}

function validObservationFields(value: unknown): value is JsonObject {
  if (!isJsonObject(value)) return false;
  return optionalBoundedText(value.status, 40)
    && optionalBoundedText(value.source, 40)
    && optionalBoundedText(value.observedAt, 64)
    && (value.scanMode === undefined || value.scanMode === null
      || typeof value.scanMode === 'string' && ['fast', 'deep'].includes(value.scanMode))
    && (value.durationMs === undefined || value.durationMs === null
      || Number.isFinite(value.durationMs) && Number(value.durationMs) >= 0
        && Number(value.durationMs) <= 120_000)
    && (value.complete === undefined || typeof value.complete === 'boolean')
    && (value.truncated === undefined || typeof value.truncated === 'boolean')
    && validObservationLimitations(value.limitations)
    && validObservationDiagnostics(value.diagnostics);
}

function validSourceStatus(value: unknown): value is JsonObject {
  if (!isJsonObject(value)) return false;
  return optionalBoundedText(value.status, 40)
    && (value.error === undefined || value.error === null || optionalBoundedText(value.error, 240))
    && (value.endpoint === undefined || value.endpoint === null || optionalBoundedText(value.endpoint, 2_048))
    && (value.detail === undefined || value.detail === null || optionalBoundedText(value.detail, 500))
    && (value.fetchedAt === undefined || value.fetchedAt === null || optionalBoundedText(value.fetchedAt, 64))
    && (value.queriedAt === undefined || value.queriedAt === null || optionalBoundedText(value.queriedAt, 64))
    && (value.attempts === undefined || Array.isArray(value.attempts)
      && value.attempts.length <= 3
      && value.attempts.every((item) => isJsonObject(item)
        && optionalBoundedText(item.outcome, 40)));
}

function validNormalizedHttpEvidence(value: unknown): boolean {
  if (!validObservationFields(value)
    || !validOptionalHttpUrl(value.requestUrl)
    || !validOptionalHttpUrl(value.finalUrl)
    || !validObservationLimitations(value.limitations)) return false;

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
    if (!isJsonObject(value.response)
      || !validOptionalHttpStatus(value.response.status)
      || value.response.deliveryMetadata !== undefined
        && (!['success', 'partial'].includes(String(value.status))
          || !validHttpDeliveryMetadata(value.response.deliveryMetadata))) return false;
  }
  return true;
}

function optionalStringArrayWithin(value: JsonValue | undefined, maximum: number): boolean {
  return value === undefined || Array.isArray(value)
    && value.length <= maximum
    && value.every((item) => typeof item === 'string');
}

function optionalRecordArrayWithin(value: JsonValue | undefined, maximum: number): boolean {
  return value === undefined || Array.isArray(value)
    && value.length <= maximum
    && value.every(isJsonObject);
}

function validBoundedString(value: unknown, maximum: number, allowEmpty = false): boolean {
  return typeof value === 'string'
    && (allowEmpty || Boolean(value))
    && value.length <= maximum
    && !CONTROL_CHAR_RE.test(value);
}

function validUint(value: unknown, maximum: number): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum;
}

function validDnsMxRecord(value: unknown): boolean {
  return isJsonObject(value)
    && validUint(value.priority, 0xffff)
    && validBoundedString(value.exchange, 253, true);
}

function validDnsCaaRecord(value: unknown): boolean {
  return isJsonObject(value)
    && validUint(value.critical, 0xff)
    && typeof value.tag === 'string'
    && /^[a-z0-9-]{1,15}$/u.test(value.tag)
    && validBoundedString(value.value, 1_024);
}

function validDnsSoaRecord(value: unknown): boolean {
  return isJsonObject(value)
    && validBoundedString(value.nsname, 253)
    && validBoundedString(value.hostmaster, 253)
    && ['serial', 'refresh', 'retry', 'expire', 'minttl']
      .every((key) => validUint(value[key], 0xffff_ffff));
}

function validUintArray(value: unknown, maximumItems: number): boolean {
  return Array.isArray(value)
    && value.length <= maximumItems
    && value.every((item) => validUint(item, 0xffff));
}

function validStringArray(value: unknown, maximumItems: number, maximumLength: number): boolean {
  return Array.isArray(value)
    && value.length <= maximumItems
    && value.every((item) => validBoundedString(item, maximumLength));
}

function validDnsHttpsRecord(value: unknown): boolean {
  if (!isJsonObject(value)
    || value.type !== 'HTTPS'
    || !validBoundedString(value.owner, 253)
    || !validUint(value.ttl, 0xffff_ffff)
    || !validUint(value.priority, 0xffff)
    || typeof value.mode !== 'string'
    || !['alias', 'service'].includes(value.mode)
    || !(value.target === null || validBoundedString(value.target, 253))
    || typeof value.targetIsOwner !== 'boolean'
    || typeof value.serviceUnavailable !== 'boolean'
    || typeof value.compatible !== 'boolean'
    || typeof value.parametersIgnored !== 'boolean'
    || !isJsonObject(value.parameters)) return false;
  const parameters = value.parameters;
  if (Object.keys(parameters).length > 24
    || !validUintArray(parameters.mandatory, 24)
    || !validStringArray(parameters.alpn, 16, 132)
    || typeof parameters.noDefaultAlpn !== 'boolean'
    || !(parameters.port === null || validUint(parameters.port, 0xffff))
    || !validStringArray(parameters.ipv4hint, 8, 64)
    || !validStringArray(parameters.ipv6hint, 8, 64)
    || !validUintArray(parameters.unknownKeys, 24)
    || !validUintArray(parameters.unsupportedMandatoryKeys, 24)
    || !Array.isArray(parameters.opaque)
    || parameters.opaque.length > 24) return false;
  return parameters.opaque.every((item) => isJsonObject(item)
    && validUint(item.key, 0xffff)
    && (item.name === null || typeof item.name === 'string' && /^[a-z0-9-]{1,63}$/u.test(item.name))
    && validUint(item.length, 0xffff));
}

function validTlsFinding(value: unknown): boolean {
  return isJsonObject(value)
    && validBoundedString(value.id, 80)
    && validBoundedString(value.tone, 32)
    && validBoundedString(value.label, 160)
    && validBoundedString(value.detail, 500);
}

function validTlsChainCertificate(value: unknown): boolean {
  if (!isJsonObject(value)) return false;
  return (value.fingerprintSha256 === undefined
      || value.fingerprintSha256 === null
      || validBoundedString(value.fingerprintSha256, 64))
    && optionalTlsNameWithin(value.subject);
}

function validSecurityPostureFinding(value: unknown): boolean {
  return isJsonObject(value)
    && validBoundedString(value.id, 80)
    && validBoundedString(value.category, 80)
    && typeof value.state === 'string'
    && ['observed', 'potential_exposure', 'observed_absence', 'unavailable'].includes(value.state)
    && typeof value.tone === 'string'
    && ['configured', 'review', 'neutral'].includes(value.tone)
    && validBoundedString(value.label, 160)
    && validBoundedString(value.detail, 300)
    && validStringArray(value.evidence, 4, 120);
}

function validOptionalStringArray(
  value: unknown,
  maximumItems: number,
  maximumLength: number,
): boolean {
  return value === undefined || validStringArray(value, maximumItems, maximumLength);
}

function validOptionalRecordArray(
  value: unknown,
  maximumItems: number,
  validate: (item: unknown) => boolean,
): boolean {
  return value === undefined || Array.isArray(value)
    && value.length <= maximumItems
    && value.every(validate);
}

function validOptionalNullableText(value: unknown, maximumLength: number): boolean {
  return value === undefined || value === null || validBoundedString(value, maximumLength);
}

function validRdapLink(value: unknown): boolean {
  return isJsonObject(value)
    && validBoundedString(value.href, 2_048)
    && validOptionalNullableText(value.rel, 100)
    && validOptionalNullableText(value.type, 160)
    && validOptionalNullableText(value.title, 300);
}

function validRdapContact(value: unknown): boolean {
  if (!isJsonObject(value)) return false;
  return validOptionalNullableText(value.handle, 200)
    && validOptionalNullableText(value.name, 300)
    && validOptionalNullableText(value.org, 300)
    && validOptionalNullableText(value.email, 320)
    && validOptionalNullableText(value.phone, 100)
    && validOptionalNullableText(value.address, 1_000)
    && validOptionalStringArray(value.roles, 12, 80)
    && validOptionalStringArray(value.names, 8, 300)
    && validOptionalStringArray(value.organizations, 8, 300)
    && validOptionalStringArray(value.emails, 8, 320)
    && validOptionalStringArray(value.phones, 8, 100)
    && validOptionalStringArray(value.addresses, 8, 1_000)
    && validOptionalRecordArray(value.publicIds, 20, (item) => isJsonObject(item)
      && validBoundedString(item.type, 160)
      && validBoundedString(item.identifier, 300))
    && validOptionalRecordArray(value.links, 10, validRdapLink);
}

function validRdapTextBlock(value: unknown): boolean {
  return isJsonObject(value)
    && validBoundedString(value.title, 160)
    && validOptionalNullableText(value.type, 160)
    && validStringArray(value.descriptions, 6, 800);
}

function validRdapParsed(value: unknown): boolean {
  if (!isJsonObject(value)) return false;
  if (!validOptionalStringArray(value.statuses, 100, 160)
    || !validOptionalStringArray(value.nameservers, 200, 253)
    || !validOptionalStringArray(value.conformance, 50, 160)
    || !validOptionalStringArray(value.serverTruncationReasons, 8, 160)
    || !validOptionalStringArray(value.truncatedEntityRoles, 11, 80)
    || !validOptionalRecordArray(value.events, 100, (item) => isJsonObject(item)
      && validOptionalNullableText(item.action, 160)
      && validOptionalNullableText(item.date, 64))
    || !validOptionalRecordArray(value.links, 20, validRdapLink)
    || !validOptionalRecordArray(value.nameserverDetails, 200, (item) => isJsonObject(item)
      && validBoundedString(item.name, 253)
      && validStringArray(item.addresses, 20, 80))
    || !validOptionalRecordArray(value.dsData, 50, (item) => isJsonObject(item)
      && validUint(item.keyTag, 0xffff)
      && validUint(item.algorithm, 0xff)
      && validUint(item.digestType, 0xff)
      && validBoundedString(item.digest, 512))
    || !validOptionalRecordArray(value.notices, 12, validRdapTextBlock)
    || !validOptionalRecordArray(value.remarks, 12, validRdapTextBlock)
    || !validOptionalRecordArray(value.redactions, 100, (item) => isJsonObject(item)
      && ['name', 'method', 'reason'].every((key) => validOptionalNullableText(item[key], 500))
      && ['prePath', 'postPath', 'replacementPath']
        .every((key) => validOptionalNullableText(item[key], 512)))
    || !validOptionalRecordArray(value.variants, 20, (group) => isJsonObject(group)
      && validOptionalNullableText(group.idnTable, 300)
      && validOptionalStringArray(group.relation, 20, 100)
      && validOptionalRecordArray(group.variantNames, 50, (name) => isJsonObject(name)
        && validOptionalNullableText(name.ldhName, 253)
        && validOptionalNullableText(name.unicodeName, 253)))) return false;
  const entitiesByRole = value.entitiesByRole;
  if (entitiesByRole !== undefined) {
    if (!isJsonObject(entitiesByRole) || Object.keys(entitiesByRole).length > 11) return false;
    for (const [role, contacts] of Object.entries(entitiesByRole)) {
      if (!['registrar', 'registrant', 'administrative', 'technical', 'billing', 'abuse', 'noc', 'reseller', 'sponsor', 'proxy', 'notifications'].includes(role)
        || !Array.isArray(contacts)
        || contacts.length > 5
        || !contacts.every(validRdapContact)) return false;
    }
  }
  return true;
}

function validWhoisParsed(value: unknown): boolean {
  if (!isJsonObject(value)
    || !validOptionalStringArray(value.statuses, 100, 160)
    || !validOptionalStringArray(value.nameservers, 200, 253)
    || !validOptionalStringArray(value.fieldsTruncated, 64, 80)) return false;
  const contactsByRole = value.contactsByRole;
  if (contactsByRole !== undefined) {
    if (!isJsonObject(contactsByRole) || Object.keys(contactsByRole).length > 5) return false;
    for (const contacts of Object.values(contactsByRole)) {
      if (!Array.isArray(contacts) || contacts.length > 1 || !contacts.every(validRdapContact)) return false;
    }
  }
  return true;
}

function validRegistrationEvidence(value: LookupHttpResponse): boolean {
  const rdap = value.rdap;
  const whois = value.whois;
  if (!validSourceStatus(rdap) || !validSourceStatus(whois)) return false;
  if (rdap.parsed !== undefined && rdap.parsed !== null && !validRdapParsed(rdap.parsed)) return false;
  if (whois.parsed !== undefined && whois.parsed !== null && !validWhoisParsed(whois.parsed)) return false;
  const registrar = rdap.registrarRdap;
  return registrar === undefined || registrar === null || validSourceStatus(registrar)
    && (registrar.parsed === undefined || registrar.parsed === null || validRdapParsed(registrar.parsed));
}

function validPageEvidence(value: LookupHttpResponse): boolean {
  const availability = value.availability;
  const page = availability.pageIdentity;
  if (page !== undefined && page !== null) {
    if (!validObservationFields(page)
      || page.publicationMetadata !== undefined
        && (!['success', 'partial'].includes(String(page.status))
          || !validPagePublicationMetadata(page.publicationMetadata))
      || !validOptionalStringArray(page.embeddedOrigins, 20, 2_048)
      || !validOptionalStringArray(page.contactDomains, 20, 253)
      || !validOptionalRecordArray(page.trackingIdentifiers, 30, (item) => isJsonObject(item)
        && validBoundedString(item.type, 80)
        && validBoundedString(item.value, 240))) return false;
    if (page.forms !== undefined && (!isJsonObject(page.forms)
      || !validOptionalStringArray(page.forms.externalActionOrigins, 10, 2_048))) return false;
    if (page.resources !== undefined && (!isJsonObject(page.resources)
      || !validOptionalStringArray(page.resources.externalOrigins, 30, 2_048))) return false;
    if (page.downloads !== undefined && (!isJsonObject(page.downloads)
      || !validOptionalStringArray(page.downloads.riskyFileTypes, 20, 80)
      || !validOptionalStringArray(page.downloads.externalOrigins, 20, 2_048))) return false;
  }

  const technology = availability.technologyProfile;
  if (technology !== undefined && technology !== null) {
    if (!validObservationFields(technology)
      || !validOptionalRecordArray(technology.findings, 24, (finding) => isJsonObject(finding)
        && validOptionalRecordArray(finding.evidence, 4, (item) => isJsonObject(item)
          && validBoundedString(item.source, 80)
          && validBoundedString(item.description, 180)))) return false;
    const libraries = technology.browserLibraryProfile;
    if (libraries !== undefined && libraries !== null && (!validObservationFields(libraries)
      || !validOptionalRecordArray(libraries.findings, 16, (item) => isJsonObject(item)))) return false;
  }

  const structured = availability.structuredDataIdentity;
  if (structured !== undefined && structured !== null && (!validObservationFields(structured)
    || !validOptionalRecordArray(structured.entities, 16, (entity) => isJsonObject(entity)
      && validOptionalStringArray(entity.types, 8, 160)
      && validOptionalStringArray(entity.sameAsHosts, 12, 253)))) return false;

  const roles = availability.pageRoleProfile;
  if (roles !== undefined && roles !== null && (!validObservationFields(roles)
    || !validOptionalRecordArray(roles.findings, 4, (finding) => isJsonObject(finding)
      && validOptionalStringArray(finding.evidence, 4, 300)))) return false;

  const behavior = availability.clientBehaviorProfile;
  if (behavior !== undefined && behavior !== null && (!validObservationFields(behavior)
    || !validOptionalRecordArray(behavior.indicators, 12, (item) => isJsonObject(item)))) return false;

  const credential = availability.credentialSurfaceProfile;
  return credential === undefined || credential === null || validObservationFields(credential);
}

function validAvailabilityScalars(value: JsonObject): boolean {
  return (value.applicable === undefined || typeof value.applicable === 'boolean')
    && validOptionalNullableText(value.domain, MAX_LOOKUP_RESPONSE_HOST_LENGTH)
    && validOptionalNullableText(value.state, 40)
    && validOptionalNullableText(value.confidence, 40)
    && validOptionalNullableText(value.activityStatus, 40)
    && validOptionalNullableText(value.websiteProbeDetail, 500)
    && validOptionalNullableText(value.dnssec, 40)
    && (value.deepScanComplete === undefined || typeof value.deepScanComplete === 'boolean')
    && (value.hasMx === undefined || value.hasMx === null || typeof value.hasMx === 'boolean')
    && (value.hasNullMx === undefined || value.hasNullMx === null || typeof value.hasNullMx === 'boolean')
    && (value.hasSpf === undefined || value.hasSpf === null || typeof value.hasSpf === 'boolean')
    && (value.hasDmarc === undefined || value.hasDmarc === null || typeof value.hasDmarc === 'boolean')
    && validOptionalStringArray(value.mxHosts, MAX_LOOKUP_DNS_RECORDS_PER_TYPE, 253);
}

function optionalTlsNameWithin(value: JsonValue | undefined): boolean {
  if (value === undefined || value === null) return true;
  if (!isJsonObject(value)) return false;
  return optionalStringArrayWithin(value.commonNames, MAX_LOOKUP_TLS_NAME_VALUES)
    && (!Array.isArray(value.commonNames)
      || value.commonNames.every((item) => validBoundedString(item, 256)))
    && optionalStringArrayWithin(value.organizations, MAX_LOOKUP_TLS_NAME_VALUES)
    && (!Array.isArray(value.organizations)
      || value.organizations.every((item) => validBoundedString(item, 256)));
}

function validNormalizedNetworkEvidence(value: LookupHttpResponse): boolean {
  const availability = value.availability;
  const dns = availability.dns;
  if (dns !== undefined) {
    if (!validObservationFields(dns)) return false;
    if (dns.records !== undefined) {
      if (!isJsonObject(dns.records)) return false;
      for (const [key, maximumLength] of [
        ['a', 64], ['aaaa', 64], ['cname', 253], ['ns', 253], ['spf', 1_024], ['dmarc', 1_024],
      ] as const) {
        if (!optionalStringArrayWithin(dns.records[key], MAX_LOOKUP_DNS_RECORDS_PER_TYPE)
          || Array.isArray(dns.records[key])
            && !(dns.records[key] as JsonValue[]).every((item) => validBoundedString(item, maximumLength))) return false;
      }
      if (dns.records.mx !== undefined && (!Array.isArray(dns.records.mx)
        || dns.records.mx.length > MAX_LOOKUP_DNS_RECORDS_PER_TYPE
        || !dns.records.mx.every(validDnsMxRecord))) return false;
      if (dns.records.caa !== undefined && (!Array.isArray(dns.records.caa)
        || dns.records.caa.length > MAX_LOOKUP_DNS_RECORDS_PER_TYPE
        || !dns.records.caa.every(validDnsCaaRecord))) return false;
      if (dns.records.soa !== undefined && (!Array.isArray(dns.records.soa)
        || dns.records.soa.length > 1
        || !dns.records.soa.every(validDnsSoaRecord))) return false;
      if (dns.records.https !== undefined && (!Array.isArray(dns.records.https)
        || dns.records.https.length > MAX_LOOKUP_DNS_RECORDS_PER_TYPE
        || !dns.records.https.every(validDnsHttpsRecord))) return false;
    }
  }

  const reverseDns = value.reverseDns;
  if (reverseDns !== undefined) {
    if (!validObservationFields(reverseDns)
      || reverseDns.records !== undefined
      && (!isJsonObject(reverseDns.records)
        || !optionalStringArrayWithin(reverseDns.records.ptr, MAX_LOOKUP_REVERSE_DNS_PTR_RECORDS)
        || Array.isArray(reverseDns.records.ptr)
          && !reverseDns.records.ptr.every((item) => validBoundedString(item, 253)))) return false;
  }

  const tls = availability.tls;
  if (tls !== undefined) {
    if (!validObservationFields(tls)
      || !optionalRecordArrayWithin(tls.findings, MAX_LOOKUP_TLS_FINDINGS)
      || Array.isArray(tls.findings) && !tls.findings.every(validTlsFinding)
      || !optionalRecordArrayWithin(tls.chain, MAX_LOOKUP_TLS_CHAIN_CERTIFICATES)
      || Array.isArray(tls.chain) && !tls.chain.every(validTlsChainCertificate)) return false;
    const certificate = tls.certificate;
    if (certificate !== undefined && certificate !== null) {
      if (!isJsonObject(certificate)
        || !optionalTlsNameWithin(certificate.subject)
        || !optionalTlsNameWithin(certificate.issuer)) return false;
      const altNames = certificate.subjectAltNames;
      if (altNames !== undefined && altNames !== null) {
        if (!isJsonObject(altNames)
          || !optionalStringArrayWithin(altNames.dnsNames, MAX_LOOKUP_TLS_ALT_NAMES)
          || Array.isArray(altNames.dnsNames)
            && !altNames.dnsNames.every((item) => validBoundedString(item, 253))
          || !optionalStringArrayWithin(altNames.ipAddresses, MAX_LOOKUP_TLS_ALT_NAMES)
          || Array.isArray(altNames.ipAddresses)
            && !altNames.ipAddresses.every((item) => validBoundedString(item, 64))) return false;
        const totalAltNames = (Array.isArray(altNames.dnsNames) ? altNames.dnsNames.length : 0)
          + (Array.isArray(altNames.ipAddresses) ? altNames.ipAddresses.length : 0);
        if (totalAltNames > MAX_LOOKUP_TLS_ALT_NAMES) return false;
      }
      const extensionProfile = certificate.extensionProfile;
      if (extensionProfile !== undefined && extensionProfile !== null) {
        if (!isJsonObject(extensionProfile)) return false;
        const certificatePolicies = extensionProfile.certificatePolicies;
        if (certificatePolicies !== undefined && certificatePolicies !== null
          && (!isJsonObject(certificatePolicies)
            || !optionalStringArrayWithin(
              certificatePolicies.oids,
              MAX_LOOKUP_TLS_CERTIFICATE_POLICIES,
            )
            || Array.isArray(certificatePolicies.oids)
              && !certificatePolicies.oids.every((item) => validBoundedString(item, 128)))) return false;
      }
    }
    for (const child of [tls.authorization, tls.hostname]) {
      if (child !== undefined && child !== null && (!isJsonObject(child)
        || !validOptionalNullableText(child.error, 240))) return false;
    }
  }
  const securityPosture = availability.securityPosture;
  if (securityPosture !== undefined && securityPosture !== null) {
    if (!validObservationFields(securityPosture)
      || !optionalRecordArrayWithin(securityPosture.findings, MAX_SECURITY_POSTURE_FINDINGS)
      || Array.isArray(securityPosture.findings)
        && !securityPosture.findings.every(validSecurityPostureFinding)) return false;
  }
  return true;
}

function parseLookupHttpResponse(value: unknown): LookupResponseParseResult {
  try {
    assertBoundedJsonStructure(value, 'Lookup response', {
      maximumContainerItems: MAX_LOOKUP_RESPONSE_CONTAINER_ITEMS,
    });
  } catch {
    return invalidLookupResponse();
  }
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
  const lookupResponse = value as LookupHttpResponse;
  if (!validAvailabilityScalars(value.availability)
    || !validRegistrationEvidence(lookupResponse)) return invalidLookupResponse();
  if (value.availability.http !== undefined && !validNormalizedHttpEvidence(value.availability.http)) {
    return invalidLookupResponse();
  }
  for (const section of [value.reverseDns, value.networkContext, value.securityTxt]) {
    if (section !== undefined && !validObservationFields(section)) return invalidLookupResponse();
  }
  if (!validNormalizedNetworkEvidence(lookupResponse)
    || !validPageEvidence(lookupResponse)) return invalidLookupResponse();

  return { ok: true, value: lookupResponse };
}

function parseCompactLookupHttpResponse(
  value: unknown,
  expectedDomain: string,
): CompactLookupResponseParseResult {
  try {
    assertBoundedJsonStructure(value, 'Compact Lookup response');
  } catch {
    return invalidCompactLookupResponse();
  }
  if (!isJsonObject(value) || Object.keys(value).length > MAX_COMPACT_LOOKUP_RESPONSE_TOP_LEVEL_KEYS) {
    return invalidCompactLookupResponse();
  }

  const availability = value.availability;
  const diagnostics = value.diagnostics;
  const compactPageIdentity = isJsonObject(availability) && isJsonObject(availability.pageIdentity)
    ? availability.pageIdentity
    : null;
  const compactHttpResponse = isJsonObject(availability) && isJsonObject(availability.http)
    && isJsonObject(availability.http.response)
    ? availability.http.response
    : null;
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
    || compactPageIdentity !== null && Object.hasOwn(compactPageIdentity, 'publicationMetadata')
    || compactHttpResponse !== null && Object.hasOwn(compactHttpResponse, 'deliveryMetadata')
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
    httpDeliveryMetadata: record(httpResponse.deliveryMetadata),
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
    pagePublicationMetadata: record(pageIdentity.publicationMetadata),
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
  MAX_LOOKUP_RESPONSE_CONTAINER_ITEMS,
  MAX_LOOKUP_RESPONSE_HOST_LENGTH,
  MAX_LOOKUP_RESPONSE_QUERY_LENGTH,
  MAX_LOOKUP_RESPONSE_TOP_LEVEL_KEYS,
  MAX_LOOKUP_DNS_RECORDS_PER_TYPE,
  MAX_LOOKUP_REVERSE_DNS_PTR_RECORDS,
  MAX_LOOKUP_TLS_ALT_NAMES,
  MAX_LOOKUP_TLS_CERTIFICATE_POLICIES,
  MAX_LOOKUP_TLS_CHAIN_CERTIFICATES,
  MAX_LOOKUP_TLS_FINDINGS,
  MAX_LOOKUP_TLS_NAME_VALUES,
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
