// Shared HTTP response boundary for the unified Lookup API.
//
// The backend owns the evidence collectors, but an HTTP response is still an
// untrusted value when it reaches the browser. This module keeps the response
// envelope typed and validates the small set of fields the Lookup controller
// relies on before any evidence is derived or rendered. Nested source records
// stay separately attributed and additive; their own normalizers remain the
// authority for source-specific fields.

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
  readonly threatIntelligence?: JsonObject;
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
  readonly reverseDns: JsonObject;
  readonly reverseDnsRecords: JsonObject;
  readonly observedNetworkContext: JsonObject;
  readonly observedNetworkEndpoint: JsonObject;
  readonly observedNetworkRdap: JsonObject;
  readonly observedNetwork: JsonObject;
  readonly securityTxt: JsonObject;
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
  readonly technologyProfile: JsonObject;
  readonly securityPosture: JsonObject;
  readonly securityPostureSummary: JsonObject;
};

type LookupResponseParseResult =
  | { readonly ok: true; readonly value: LookupHttpResponse }
  | { readonly ok: false; readonly errorCode: typeof INVALID_LOOKUP_RESPONSE; readonly error: string };

const INVALID_LOOKUP_RESPONSE = 'INVALID_LOOKUP_RESPONSE';
const INVALID_LOOKUP_RESPONSE_MESSAGE = 'Lookup returned an invalid response.';
const MAX_LOOKUP_RESPONSE_QUERY_LENGTH = 4096;
const MAX_LOOKUP_RESPONSE_HOST_LENGTH = 253;
const MAX_LOOKUP_RESPONSE_TOP_LEVEL_KEYS = 32;
const MAX_LOOKUP_RESPONSE_ERROR_LENGTH = 240;
const MAX_THREAT_INTELLIGENCE_PROVIDERS = 10;
const MAX_LOOKUP_TIMING_MS = 120_000;
const MAX_LOOKUP_TIMING_SOURCES = 10;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/u;
const QUERY_TYPES = new Set<LookupQueryType>(['domain', 'ipv4', 'ipv6', 'asn']);
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

function optionalBoundedText(value: unknown, maxLength: number): boolean {
  return value === undefined || (
    typeof value === 'string'
    && value.length <= maxLength
    && !CONTROL_CHAR_RE.test(value)
  );
}

function invalidLookupResponse(): LookupResponseParseResult {
  return {
    ok: false,
    errorCode: INVALID_LOOKUP_RESPONSE,
    error: INVALID_LOOKUP_RESPONSE_MESSAGE,
  };
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

  for (const key of ['reverseDns', 'networkContext', 'securityTxt', 'threatIntelligence']) {
    const section = value[key];
    if (section !== undefined && !isJsonObject(section)) return invalidLookupResponse();
  }

  return { ok: true, value: value as LookupHttpResponse };
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
  const securityTxt = record(response?.securityTxt);
  const threatIntelligence = record(response?.threatIntelligence);
  const providers = Array.isArray(threatIntelligence.providers)
    ? threatIntelligence.providers
        .filter(isJsonObject)
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
    reverseDns,
    reverseDnsRecords: record(reverseDns.records),
    observedNetworkContext,
    observedNetworkEndpoint: record(observedNetworkContext.endpoint),
    observedNetworkRdap: record(observedNetworkContext.rdap),
    observedNetwork: record(observedNetworkContext.network),
    securityTxt,
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
    technologyProfile: record(availability.technologyProfile),
    securityPosture,
    securityPostureSummary: record(securityPosture.summary),
  };
}

export {
  INVALID_LOOKUP_RESPONSE,
  INVALID_LOOKUP_RESPONSE_MESSAGE,
  MAX_LOOKUP_RESPONSE_ERROR_LENGTH,
  MAX_LOOKUP_RESPONSE_HOST_LENGTH,
  MAX_LOOKUP_RESPONSE_QUERY_LENGTH,
  MAX_LOOKUP_RESPONSE_TOP_LEVEL_KEYS,
  MAX_LOOKUP_TIMING_MS,
  MAX_LOOKUP_TIMING_SOURCES,
  MAX_THREAT_INTELLIGENCE_PROVIDERS,
  createLookupHttpResponse,
  createLookupViewModel,
  isJsonObject,
  lookupHttpErrorMessage,
  normalizeLookupTiming,
  parseLookupHttpResponse,
  record as lookupRecord,
};
export type {
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
