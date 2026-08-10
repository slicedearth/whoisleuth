import { compareRdapPublications, compareRegistrySources } from './registry-comparison.mts';
import { buildRegistryInsights } from './registry-insights.mts';
import { buildPortableGeneratorMetadata } from './portable-generator.mts';

export const LOOKUP_EVIDENCE_SCHEMA = 'whoisleuth.lookup-evidence';
export const LEGACY_LOOKUP_EVIDENCE_SCHEMA_VERSION = 25;
export const LOOKUP_EVIDENCE_SCHEMA_VERSION = 26;
export const SUPPORTED_LOOKUP_EVIDENCE_SCHEMA_VERSIONS = Object.freeze([
  LEGACY_LOOKUP_EVIDENCE_SCHEMA_VERSION,
  LOOKUP_EVIDENCE_SCHEMA_VERSION,
]);
export const LOOKUP_EVIDENCE_PORTABLE_MAX_BYTES = 5 * 1024 * 1024;
export const LOOKUP_EVIDENCE_PORTABLE_MAX_ENTRIES = 20_000;
export const LOOKUP_EVIDENCE_PORTABLE_MAX_DEPTH = 24;
export const LOOKUP_EVIDENCE_PORTABLE_MAX_ARRAY_ITEMS = 10_000;
export const LOOKUP_EVIDENCE_PORTABLE_MAX_KEY_LENGTH = 256;
export const LOOKUP_EVIDENCE_PORTABLE_MAX_STRING_LENGTH = 1024 * 1024;

type UnknownRecord = Record<string, unknown>;
type LookupEvidenceOptions = { generatedAt?: string; idnAnalysis?: unknown; applicationVersion?: unknown };

const REGISTRAR_RDAP_STATUSES = new Set([
  'success', 'partial', 'error', 'unsupported', 'not_found', 'skipped', 'disabled',
]);
const LOOKUP_QUERY_TYPES = new Set(['domain', 'ipv4', 'ipv6', 'asn']);
const RDAP_SOURCE_STATUSES = new Set([
  'success', 'partial', 'error', 'unsupported', 'not_found', 'skipped', 'disabled',
]);
const WHOIS_SOURCE_STATUSES = new Set([
  'complete', 'partial', 'error', 'unsupported', 'not_found', 'skipped', 'disabled',
]);
const AVAILABILITY_DIAGNOSTIC_STATUSES = new Set(['complete', 'error', 'disabled', 'not_applicable']);
const NETWORK_CONTEXT_STATUSES = new Set(['success', 'partial', 'not_found', 'unsupported', 'error']);
const NETWORK_ADDRESS_SOURCES = new Set(['tls_connection', 'dns_a', 'dns_aaaa']);
const REVERSE_DNS_STATUSES = new Set(['success', 'partial', 'not_found', 'unsupported', 'skipped', 'error']);
const SECURITY_TXT_STATES = new Set(['present', 'stale', 'partial', 'absent', 'malformed', 'unsupported', 'unavailable']);
const SSLBL_STATES = new Set(['success', 'stale', 'unavailable']);
const SSLBL_VERDICTS = new Set(['listed', 'not_listed', 'inconclusive']);
const RDAP_ATTEMPT_OUTCOMES = new Set([
  'success', 'not_found', 'no_results', 'unsupported', 'rate_limited',
  'server_error', 'client_error', 'invalid_json', 'invalid_response',
  'timeout', 'network_error',
]);
const WHOIS_QUERY_PROFILES = new Set([
  'plain-domain', 'denic-domain-ace', 'jprs-domain-english',
  'registry-domain-unicode', 'not-issued',
]);
const LOOKUP_TIMING_SOURCES = new Set([
  'rdap', 'whois', 'domain_evidence', 'reverse_dns', 'registrar_rdap',
  'network_context', 'security_txt', 'external_intelligence',
  'malware_host_intelligence', 'malware_ioc_intelligence',
]);
const LOOKUP_AVAILABILITY_ANALYSIS_KEYS = new Set([
  'applicable', 'type', 'domain', 'state', 'confidence', 'detail', 'source',
  'rdapServer', 'nameservers', 'statuses', 'registrar', 'registrant', 'abuse',
  'createdDate', 'expiryDate', 'createdDateIso', 'expiryDateIso', 'domainAgeDays',
  'expiresInDays', 'privacyProtected', 'dnssec', 'activityStatus',
  'websiteProbeStatus', 'websiteProbeDetail', 'http', 'deepScanComplete',
  'faviconHash', 'faviconPHash', 'pageTitle', 'hasPasswordField',
  'phishingLanguageMatch', 'hasExternalFormAction', 'externalAssetHosts',
  'pageIdentity', 'credentialSurfaceProfile', 'structuredDataIdentity',
  'technologyProfile', 'pageRoleProfile', 'clientBehaviorProfile',
  'securityPosture', 'dns', 'tls', 'hasMx', 'hasNullMx', 'mxHosts', 'hasSpf',
  'hasDmarc', 'bulkComparison', 'limitations',
]);
const LOOKUP_IDN_ANALYSIS_KEYS = new Set([
  'version', 'mappingVersion', 'asciiDomain', 'unicodeDomain', 'hasIdn',
  'scripts', 'labels', 'mixedScript', 'skeleton', 'referenceMatches', 'findings',
  'truncated', 'limitations',
]);
const PRIVATE_EVIDENCE_KEYS = new Set([
  'authorization', 'proxyauthorization', 'cookie', 'cookies', 'setcookie',
  'session', 'sessionid', 'sessiontoken', 'token', 'accesstoken', 'refreshtoken',
  'apikey', 'password', 'secret', 'credentials', 'requestheaders', 'responseheaders',
  'headers', 'rawbody', 'responsebody',
]);
const SAFE_EVIDENCE_KEYS = new Set([
  'credentialsurfaceprofile', 'credentialsurfaceversion', 'haspasswordfield', 'tokencount',
]);
const PORTABLE_URL_KEYS = new Set([
  'endpoint', 'url', 'uri', 'href', 'rdapserver', 'finalurl', 'requestedurl',
  'requesturl', 'officiallookupurl', 'declaredorigin', 'actionurl', 'from', 'to',
]);
const PORTABLE_ORIGIN_COLLECTION_KEYS = new Set([
  'embeddedorigins', 'externalactionorigins', 'externalorigins',
]);

// Availability is assembled from a finite set of versioned, bounded analysis
// models. Portable exports retain only their declared output vocabulary rather
// than recursively copying arbitrary browser-local extensions. This set is
// intentionally exact and case-sensitive; new model fields must be reviewed at
// this privacy boundary before they can enter a portable artefact.
const LOOKUP_AVAILABILITY_PORTABLE_NESTED_KEYS = new Set([
  // Shared observation and summary fields.
  'version', 'profileVersion', 'status', 'state', 'source', 'observedAt',
  'scanMode', 'durationMs', 'complete', 'truncated', 'limitations',
  'diagnostics', 'detail', 'error', 'count', 'total', 'discarded', 'summary',
  'findings', 'id', 'label', 'tone', 'category', 'confidence', 'evidence',
  'value', 'values', 'name', 'type', 'types', 'mode', 'owner', 'target',
  'url', 'uri', 'href',
  'priority', 'ttl', 'records',

  // HTTP observation and retained response metadata.
  'requestUrl', 'finalUrl', 'transportSecurity', 'redirectCount',
  'redirectLimitReached', 'redirects', 'crossOriginRedirect', 'httpsDowngrade',
  'attempts', 'response', 'contentType', 'contentLanguage', 'server',
  'declaredContentLength', 'capturedBodyBytes', 'bodyInspected', 'bodyTruncated',
  'bodyHash', 'securityHeaders', 'strictTransportSecurity',
  'contentSecurityPolicy', 'xFrameOptions', 'xContentTypeOptions',
  'referrerPolicy', 'algorithm', 'scope', 'bytes', 'from', 'to',
  'queryOmitted', 'pathTruncated', 'outcome', 'httpStatus', 'attemptCount',

  // DNS observation, effective CAA, and HTTPS/SVCB parameter summaries.
  'a', 'aaaa', 'caa', 'cname', 'dmarc', 'https', 'mx', 'ns', 'ptr', 'soa',
  'spf', 'delegation', 'caaPolicy', 'policyVersion', 'queryLimit',
  'queriedOwners', 'effectiveOwner', 'inherited', 'tree', 'registryEvidence',
  'exchange', 'nsname', 'hostmaster', 'serial', 'refresh', 'retry', 'expire', 'minttl',
  'tag', 'critical', 'parameters', 'parametersIgnored', 'mandatory', 'alpn',
  'noDefaultAlpn', 'port', 'ipv4hint', 'ipv6hint', 'opaque', 'key', 'length',
  'unknownKeys', 'unsupportedMandatoryKeys', 'targetIsOwner',
  'serviceUnavailable', 'compatible', 'effectiveOwner', 'queriedOwners',

  // TLS profile, certificate, extension, and connection summaries. Runtime
  // authorisation objects are deliberately absent from this portable set.
  'connectedAddress', 'connectedFamily', 'sniHost', 'protocol', 'alpnProtocol',
  'cipher', 'ephemeralKey', 'hostname', 'matches', 'validity', 'certificate',
  'chain', 'chainTruncated', 'standardName', 'size', 'subject', 'issuer',
  'serialNumber', 'validFrom', 'validTo', 'fingerprintSha1',
  'fingerprintSha256', 'isCertificateAuthority', 'subjectAltNames',
  'dnsNames', 'ipAddresses', 'otherNames', 'publicKey', 'bits', 'curve',
  'signature', 'oid', 'extendedKeyUsage', 'authorityInformationAccess',
  'ocsp', 'caIssuers', 'unknownMethods', 'extensionProfile', 'parsed', 'partial',
  'certificatePolicies', 'crlDistributionPoints', 'commonNames',
  'organizations', 'organizationalUnits', 'countries', 'localities', 'states',
  'connectionAttempts', 'resolvedAddressCount', 'discardedFields',

  // Page identity, relationships, and bounded fingerprints.
  'identityVersion', 'documentLanguage', 'canonical', 'metaRefresh',
  'openGraph', 'title', 'siteName', 'generator', 'forms', 'postCount',
  'insecureActionCount', 'externalActionOrigins', 'resources', 'byType',
  'image', 'script', 'stylesheet', 'link', 'frame', 'media', 'object',
  'externalOrigins', 'embeddedOrigins', 'contactDomains', 'downloads',
  'explicitCount', 'riskyCount', 'riskyFileTypes', 'trackingIdentifiers',
  'fingerprints', 'fingerprintVersion', 'exact', 'normalizedHtml',
  'visibleText', 'domStructure', 'formStructure', 'resourceHosts',
  'identifiers', 'featureCount', 'nodeCount', 'formCount', 'controlCount',
  'parser', 'tokenCount', 'tagsExamined', 'discardedUrls', 'formsObserved',
  'relationshipTagsExamined', 'relationshipUrlsDiscarded',
  'trackingIdentifiersTruncated',

  // Credential, structured identity, role, behaviour, technology, and posture
  // projections. Only fixed categories/counts and bounded descriptions enter.
  'credentialSurfaceVersion', 'methods', 'actions', 'missing', 'get', 'post',
  'dialog', 'other', 'sameOrigin', 'external', 'cleartext', 'unclassified',
  'inputs', 'classifiedCount', 'categories', 'password', 'email', 'username',
  'one_time_code', 'payment', 'inputsObserved', 'classifiedInputs',
  'unclassifiedActions', 'structuredDataVersion', 'scriptsObserved',
  'scriptsExamined', 'charactersExamined', 'documentsParsed', 'malformedScripts',
  'externalScriptsSkipped', 'objectsExamined', 'arrayItemsExamined',
  'discardedProperties', 'entities', 'declaredOrigin', 'sameAsHosts',
  'pageRoleProfileVersion', 'primaryRole', 'role', 'rolesObserved',
  'clientBehaviorProfileVersion', 'scriptSummary', 'elementsObserved',
  'referencedScripts', 'inlineScripts', 'moduleScripts', 'indicators',
  'evidenceClass', 'occurrences', 'explanation', 'indicatorsObserved',
  'scriptElementsExamined', 'inlineCharactersExamined', 'technologyProfile',
  'browserLibraryProfile', 'catalog', 'knownExploitedCatalog', 'releasedAt',
  'sourceRevision', 'apparentVersion', 'detectionMethods', 'advisoryCount',
  'highestSeverity', 'advisoryIdentifiers', 'knownExploitedCount',
  'knownExploitedIdentifiers', 'weaknessClasses', 'htmlEvaluated',
  'generatorEvaluated', 'serverEvaluated', 'resourceOriginsEvaluated',
  'passiveHeadersEvaluated', 'tagLimitReached', 'referencesExamined',
  'inlineScriptsExamined', 'inlineSignatureCharactersExamined',
  'inlineSignatureTimedOut', 'inlineSignatureUnavailable', 'catalogComponents',
  'advisoryMatches', 'knownExploitedMatches', 'postureVersion',
  'potentialExposure', 'observedAbsence', 'unavailable',

  // Bounded cross-row comparison evidence.
  'bulkComparison', 'technology', 'tls', 'ids', 'issuerLabel', 'spkiSha256',
]);

function recordOrNull(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function normalizedEvidenceKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/gu, '');
}

function privateEvidenceKey(value: string, item: unknown): boolean {
  const normalized = normalizedEvidenceKey(value);
  if (SAFE_EVIDENCE_KEYS.has(normalized)) return false;
  if (normalized === 'password' && (typeof item === 'number' || typeof item === 'boolean')) return false;
  return PRIVATE_EVIDENCE_KEYS.has(normalized)
    || normalized.includes('authorization')
    || normalized.includes('authheader')
    || normalized.includes('cookie')
    || normalized.includes('apikey')
    || normalized.includes('secret')
    || normalized.includes('sessionkey')
    || normalized.includes('passwordvalue')
    || normalized.endsWith('password')
    || /(?:access|auth|bearer|csrf|refresh|session)token$/u.test(normalized)
    || /(?:request|response|authorization|proxy)headers?$/u.test(normalized)
    || (normalized.includes('credential') && !normalized.startsWith('credentialsurface'));
}

function portableUri(value: unknown): string | null {
  const text = boundedString(value, 2048);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (!['http:', 'https:', 'mailto:', 'tel:', 'dns:', 'openpgp4fpr:'].includes(url.protocol)
      || url.username
      || url.password) return null;
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      url.search = '';
      url.hash = '';
    }
    return url.toString().slice(0, 2048);
  } catch {
    return null;
  }
}

function portableOrigin(value: unknown): string | null {
  const text = boundedString(value, 2048);
  if (!text) return null;
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

/**
 * Copy an already-normalised evidence tree without carrying request/session
 * material or credential-bearing URL components across the portable boundary.
 * This is deliberately recursive because imported browser-local records are
 * untrusted even when their top-level source envelope is recognised.
 */
export function projectLookupEvidencePrivacySafeTree<T>(value: T): T {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    const sanitized = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, ' ');
    return (sanitized.length <= LOOKUP_EVIDENCE_PORTABLE_MAX_STRING_LENGTH
      ? sanitized
      : sanitized.slice(0, LOOKUP_EVIDENCE_PORTABLE_MAX_STRING_LENGTH)) as T;
  }
  if (Array.isArray(value)) {
    return value.slice(0, LOOKUP_EVIDENCE_PORTABLE_MAX_ARRAY_ITEMS)
      .map((item) => projectLookupEvidencePrivacySafeTree(item)) as T;
  }
  const source = recordOrNull(value);
  if (!source) return null as T;
  const output: UnknownRecord = {};
  for (const [key, item] of Object.entries(source).slice(0, LOOKUP_EVIDENCE_PORTABLE_MAX_ARRAY_ITEMS)) {
    const normalized = normalizedEvidenceKey(key);
    if (privateEvidenceKey(normalized, item)) continue;
    if (typeof item === 'string' && PORTABLE_URL_KEYS.has(normalized)) {
      output[key] = portableUri(item);
      continue;
    }
    output[key] = projectLookupEvidencePrivacySafeTree(item);
  }
  return output as T;
}

function projectLookupEvidenceAvailabilityValue(value: unknown, parentKey: string | null): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    const normalizedParent = normalizedEvidenceKey(parentKey || '');
    if (PORTABLE_URL_KEYS.has(normalizedParent)) return portableUri(value);
    if (PORTABLE_ORIGIN_COLLECTION_KEYS.has(normalizedParent)) return portableOrigin(value);
    return projectLookupEvidencePrivacySafeTree(value);
  }
  if (Array.isArray(value)) {
    return value.slice(0, LOOKUP_EVIDENCE_PORTABLE_MAX_ARRAY_ITEMS)
      .map((item) => projectLookupEvidenceAvailabilityValue(item, parentKey));
  }
  const source = recordOrNull(value);
  if (!source) return null;
  const output: UnknownRecord = {};
  for (const [key, item] of Object.entries(source).slice(0, LOOKUP_EVIDENCE_PORTABLE_MAX_ARRAY_ITEMS)) {
    if (!LOOKUP_AVAILABILITY_PORTABLE_NESTED_KEYS.has(key)
      || privateEvidenceKey(key, item)) continue;
    output[key] = projectLookupEvidenceAvailabilityValue(item, key);
  }
  return output;
}

/**
 * Canonical portable projection for the bounded Lookup availability models.
 * The root and every nested record are positive allowlists, so an imported
 * extension cannot become authenticated evidence merely by avoiding a
 * credential-key denylist.
 */
export function projectLookupEvidenceAvailability(value: unknown): UnknownRecord | null {
  const source = recordOrNull(value);
  if (!source) return null;
  const output: UnknownRecord = {};
  for (const key of LOOKUP_AVAILABILITY_ANALYSIS_KEYS) {
    if (!Object.hasOwn(source, key)) continue;
    const item = source[key];
    if (privateEvidenceKey(key, item)) continue;
    output[key] = projectLookupEvidenceAvailabilityValue(item, key);
  }
  return output;
}

export function assertLookupEvidencePrivacySafeTree(value: unknown): void {
  const pending: unknown[] = [value];
  while (pending.length) {
    const current = pending.pop();
    if (typeof current === 'string') {
      if (projectLookupEvidencePrivacySafeTree(current) !== current) {
        throw new TypeError('Lookup evidence contains a non-portable string value.');
      }
      continue;
    }
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    const source = recordOrNull(current);
    if (!source) continue;
    for (const [key, item] of Object.entries(source)) {
      const normalized = normalizedEvidenceKey(key);
      if (privateEvidenceKey(normalized, item)) {
        throw new TypeError('Lookup evidence contains excluded private request or session material.');
      }
      if (typeof item === 'string' && PORTABLE_URL_KEYS.has(normalized) && portableUri(item) !== item) {
        throw new TypeError('Lookup evidence contains a credential-bearing or non-portable URL.');
      }
      pending.push(item);
    }
  }
}

function projectedKnownRecord(value: unknown, keys: ReadonlySet<string>): UnknownRecord | null {
  const source = recordOrNull(value);
  if (!source) return null;
  const output: UnknownRecord = {};
  for (const key of keys) {
    if (Object.hasOwn(source, key)) output[key] = projectLookupEvidencePrivacySafeTree(source[key]);
  }
  return output;
}

export function assertLookupEvidencePortableTree(value: unknown): void {
  const pending: Array<Readonly<{ value: unknown; depth: number }>> = [{ value, depth: 0 }];
  let entries = 0;
  while (pending.length) {
    const current = pending.pop();
    if (!current) break;
    entries += 1;
    if (entries > LOOKUP_EVIDENCE_PORTABLE_MAX_ENTRIES) {
      throw new TypeError(`Lookup evidence exceeds the ${LOOKUP_EVIDENCE_PORTABLE_MAX_ENTRIES.toLocaleString('en')}-entry portable limit.`);
    }
    if (current.depth > LOOKUP_EVIDENCE_PORTABLE_MAX_DEPTH) {
      throw new TypeError(`Lookup evidence exceeds the ${LOOKUP_EVIDENCE_PORTABLE_MAX_DEPTH}-level portable nesting limit.`);
    }
    if (typeof current.value === 'string') {
      if (current.value.length > LOOKUP_EVIDENCE_PORTABLE_MAX_STRING_LENGTH) {
        throw new TypeError('Lookup evidence contains an over-bound string.');
      }
      continue;
    }
    if (Array.isArray(current.value)) {
      if (current.value.length > LOOKUP_EVIDENCE_PORTABLE_MAX_ARRAY_ITEMS) {
        throw new TypeError('Lookup evidence contains an over-bound array.');
      }
      for (const item of current.value) pending.push({ value: item, depth: current.depth + 1 });
      continue;
    }
    if (current.value && typeof current.value === 'object') {
      const source = current.value as UnknownRecord;
      const keys = Object.keys(source);
      if (keys.length > LOOKUP_EVIDENCE_PORTABLE_MAX_ARRAY_ITEMS
        || keys.some((key) => key.length > LOOKUP_EVIDENCE_PORTABLE_MAX_KEY_LENGTH
          || /[\u0000-\u001f\u007f]/u.test(key))) {
        throw new TypeError('Lookup evidence contains an over-bound object.');
      }
      for (const item of Object.values(source)) pending.push({ value: item, depth: current.depth + 1 });
    }
  }
}

export function serializeLookupEvidence(value: unknown, pretty = false): string {
  assertLookupEvidencePortableTree(value);
  let output: string;
  try {
    output = JSON.stringify(value, null, pretty ? 2 : 0);
  } catch {
    throw new TypeError('Lookup evidence could not be serialized as JSON.');
  }
  if (new TextEncoder().encode(output).byteLength > LOOKUP_EVIDENCE_PORTABLE_MAX_BYTES) {
    throw new TypeError('Lookup evidence exceeds the 5 MiB portable file limit.');
  }
  return output;
}

function boundedString(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value.replace(/\s+/g, ' ').trim() || null;
}

function boundedInteger(value: unknown, maximum: number): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum ? Number(value) : null;
}

function boundedHttpStatus(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) >= 100 && Number(value) <= 599 ? Number(value) : null;
}

function boundedTimestamp(value: unknown): string | null {
  const text = boundedString(value, 64);
  if (!text) return null;
  const time = Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function boundedEndpoint(value: unknown): string | null {
  const text = boundedString(value, 2048);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    url.search = '';
    url.hash = '';
    return url.toString().slice(0, 2048);
  } catch {
    return null;
  }
}

function boundedStringList(value: unknown, count: number, length: number): string[] {
  return [...new Set((Array.isArray(value) ? value : [])
    .slice(0, count)
    .map((item) => boundedString(item, length))
    .filter((item): item is string => item !== null))];
}

function boundedHostname(value: unknown): string | null {
  const text = boundedString(value, 253)?.toLowerCase().replace(/\.+$/u, '') || null;
  if (!text || !text.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(label))) {
    return null;
  }
  return text;
}

function canonicalIpv4(value: unknown): string | null {
  const text = boundedString(value, 64);
  if (!text || !/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(text)) return null;
  const octets = text.split('.').map(Number);
  if (octets.some((octet) => octet > 255)) return null;
  return octets.join('.');
}

function canonicalIpv6(value: unknown): string | null {
  const text = boundedString(value, 64)?.toLowerCase();
  if (!text || !text.includes(':') || text.includes('%')) return null;
  try {
    const hostname = new URL(`http://[${text}]/`).hostname;
    return hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1).toLowerCase()
      : null;
  } catch {
    return null;
  }
}

function canonicalAsn(value: unknown): string | null {
  const text = boundedString(value, 32);
  const match = text?.match(/^(?:AS)?(\d+)$/iu);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isInteger(number) && number >= 0 && number <= 4_294_967_295
    ? `AS${number}`
    : null;
}

export function projectLookupEvidenceQuery(value: unknown) {
  const source = recordOrNull(value) || {};
  const type = typeof source.type === 'string' && LOOKUP_QUERY_TYPES.has(source.type)
    ? source.type
    : 'domain';
  if (type === 'domain') {
    const inputHostname = [source.inputHostname, source.registrableDomain, source.submitted, source.query]
      .map(boundedHostname)
      .find((item): item is string => Boolean(item)) || 'unknown.invalid';
    const suppliedRegistrableDomain = boundedHostname(source.registrableDomain);
    const registrableDomain = suppliedRegistrableDomain
      && (inputHostname === suppliedRegistrableDomain || inputHostname.endsWith(`.${suppliedRegistrableDomain}`))
      ? suppliedRegistrableDomain
      : inputHostname;
    return {
      submitted: inputHostname,
      type,
      inputHostname,
      registrableDomain,
      isSubdomain: inputHostname !== registrableDomain,
    };
  }
  const candidate = source.submitted ?? source.query;
  const submitted = type === 'ipv4'
    ? canonicalIpv4(candidate)
    : type === 'ipv6'
      ? canonicalIpv6(candidate)
      : canonicalAsn(candidate);
  if (!submitted) throw new TypeError(`Lookup evidence contains an invalid ${type} query.`);
  return { submitted, type, inputHostname: null, registrableDomain: null, isSubdomain: false };
}

function completeTerminalObservation(status: unknown, truncated: unknown): boolean {
  return truncated !== true && (status === 'success' || status === 'not_found');
}

function boundedPublishedUri(value: unknown, protocols: string[]): string | null {
  const text = boundedString(value, 2048);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (!protocols.includes(url.protocol) || url.username || url.password) return null;
    url.search = '';
    url.hash = '';
    return url.toString().slice(0, 2048);
  } catch {
    return null;
  }
}

function boundedUriList(value: unknown, protocols: string[]): string[] {
  return [...new Set((Array.isArray(value) ? value : [])
    .slice(0, 10)
    .map((item) => boundedPublishedUri(item, protocols))
    .filter((item): item is string => item !== null))];
}

function boundedSslblReferenceUrl(
  value: unknown,
  fingerprint: string | null,
  verdict: string,
): string | null {
  if (!fingerprint || verdict !== 'listed') return null;
  const text = boundedString(value, 2048);
  if (!text) return null;
  const expectedPath = `/ssl-certificates/sha1/${fingerprint}/`;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:'
      || url.hostname !== 'sslbl.abuse.ch'
      || url.port
      || url.username
      || url.password
      || url.pathname !== expectedPath) {
      return null;
    }
    return `https://sslbl.abuse.ch${expectedPath}`;
  } catch {
    return null;
  }
}

function securityTxtSource(value: unknown) {
  const source = recordOrNull(value);
  if (
    !source
    || source.securityTxtVersion !== 1
    || typeof source.state !== 'string'
    || !SECURITY_TXT_STATES.has(source.state)
  ) return null;
  return {
    securityTxtVersion: 1,
    version: source.version === 1 ? 1 : null,
    state: source.state,
    status: boundedString(source.status, 40),
    observedAt: boundedTimestamp(source.observedAt),
    scanMode: source.scanMode === 'deep' ? 'deep' : null,
    source: source.source === 'security_txt' ? 'security_txt' : null,
    durationMs: boundedInteger(source.durationMs, 120_000),
    complete: source.complete === true,
    truncated: source.truncated === true,
    limitations: boundedStringList(source.limitations, 10, 300),
    detail: boundedString(source.detail, 300),
    requestedUrl: boundedPublishedUri(source.requestedUrl, ['https:']),
    finalUrl: boundedPublishedUri(source.finalUrl, ['https:']),
    httpStatus: boundedHttpStatus(source.httpStatus),
    redirectCount: boundedInteger(source.redirectCount, 3),
    expiresAt: boundedTimestamp(source.expiresAt),
    signed: source.signed === true,
    canonicalMatches: typeof source.canonicalMatches === 'boolean' ? source.canonicalMatches : null,
    contacts: boundedUriList(source.contacts, ['https:', 'mailto:', 'tel:']),
    policies: boundedUriList(source.policies, ['https:']),
    encryption: boundedUriList(source.encryption, ['https:', 'dns:', 'openpgp4fpr:']),
    canonical: boundedUriList(source.canonical, ['https:']),
    preferredLanguages: boundedStringList(source.preferredLanguages, 10, 40),
  };
}

function sslblSource(value: unknown) {
  const source = recordOrNull(value);
  if (!source
    || source.sslblVersion !== 1
    || source.source !== 'sslbl'
    || typeof source.status !== 'string'
    || !SSLBL_STATES.has(source.status)
    || typeof source.verdict !== 'string'
    || !SSLBL_VERDICTS.has(source.verdict)) {
    return null;
  }
  const snapshot = recordOrNull(source.snapshot);
  const rawFingerprint = boundedString(source.fingerprintSha1, 40);
  const fingerprint = rawFingerprint && /^[a-f0-9]{40}$/u.test(rawFingerprint)
    ? rawFingerprint
    : null;
  const validState = (source.verdict === 'not_listed'
    && source.status === 'success'
    && source.complete === true)
    || (source.verdict === 'listed'
      && (source.status === 'success' || source.status === 'stale')
      && source.complete === (source.status === 'success'))
    || (source.verdict === 'inconclusive'
      && (source.status === 'stale' || source.status === 'unavailable')
      && source.complete === false);
  if (!validState) return null;
  return {
    sslblVersion: 1,
    source: 'sslbl',
    status: source.status,
    verdict: source.verdict,
    complete: source.complete === true,
    observedAt: boundedTimestamp(source.observedAt),
    fingerprintSha1: fingerprint,
    referenceUrl: boundedSslblReferenceUrl(source.referenceUrl, fingerprint, source.verdict),
    snapshot: snapshot ? {
      sourceUpdatedAt: boundedTimestamp(snapshot.sourceUpdatedAt),
      generatedAt: boundedTimestamp(snapshot.generatedAt),
      ageSeconds: boundedInteger(snapshot.ageSeconds, 31_536_000),
      entryCount: boundedInteger(snapshot.entryCount, 50_000),
      digestSha256: /^[a-f0-9]{64}$/u.test(String(snapshot.digestSha256 || ''))
        ? snapshot.digestSha256
        : null,
    } : null,
    detail: boundedString(source.detail, 300),
    limitations: boundedStringList(source.limitations, 10, 300),
  };
}

function rdapAttempt(value: unknown) {
  const attempt = recordOrNull(value) || {};
  const endpoint = boundedEndpoint(attempt.endpoint);
  return {
    endpoint,
    transportSecurity: endpoint ? endpoint.startsWith('https:') ? 'https' : 'http' : null,
    status: boundedHttpStatus(attempt.status),
    outcome: typeof attempt.outcome === 'string' && RDAP_ATTEMPT_OUTCOMES.has(attempt.outcome)
      ? attempt.outcome
      : 'unknown',
    detail: boundedString(attempt.detail, 240),
    selected: attempt.selected === true,
  };
}

function boundedRdapAttempts(value: unknown, maximum: number) {
  return (Array.isArray(value) ? value : [])
    .slice(0, maximum)
    .map(rdapAttempt);
}

function whoisChainHop(value: unknown) {
  const hop = recordOrNull(value) || {};
  const queryProfile = typeof hop.queryProfile === 'string' && WHOIS_QUERY_PROFILES.has(hop.queryProfile)
    ? hop.queryProfile
    : null;
  const error = boundedString(hop.error, 240);
  return {
    server: boundedHostname(hop.server),
    address: boundedString(hop.address, 64),
    queriedAt: boundedTimestamp(hop.queriedAt),
    queryProfile,
    responseEncoding: hop.responseEncoding === 'utf-8' ? 'utf-8' : null,
    status: queryProfile === 'not-issued'
      ? 'not_issued'
      : error
        ? 'error'
        : typeof hop.response === 'string'
          ? 'success'
          : 'unknown',
    detail: error,
  };
}

function boundedWhoisChain(value: unknown) {
  return (Array.isArray(value) ? value : [])
    .slice(0, 16)
    .map(whoisChainHop);
}

function lookupTimingDiagnostics(value: unknown) {
  const source = recordOrNull(value);
  if (source?.version !== 1) return null;
  return {
    version: 1,
    totalMs: boundedInteger(source.totalMs, 120_000),
    sources: (Array.isArray(source.sources) ? source.sources : [])
      .slice(0, LOOKUP_TIMING_SOURCES.size)
      .flatMap((item) => {
        const entry = recordOrNull(item);
        if (!entry
          || typeof entry.source !== 'string'
          || !LOOKUP_TIMING_SOURCES.has(entry.source)
          || (entry.outcome !== 'fulfilled' && entry.outcome !== 'rejected')) return [];
        return [{
          source: entry.source,
          outcome: entry.outcome,
          durationMs: boundedInteger(entry.durationMs, 120_000),
          completedAfterMs: boundedInteger(entry.completedAfterMs, 120_000),
        }];
      }),
  };
}

function registryAccessDiagnostics(value: unknown) {
  const source = recordOrNull(value);
  if (!source) return null;
  const officialLookupUrl = portableUri(source.officialLookupUrl);
  return {
    suffix: boundedHostname(source.suffix),
    coverageState: boundedString(source.coverageState, 40),
    whoisAccessProfile: boundedString(source.whoisAccessProfile, 80),
    rdapAccessProfile: boundedString(source.rdapAccessProfile, 80),
    ...(officialLookupUrl ? { officialLookupUrl } : {}),
    limitation: boundedString(source.limitation, 500),
    authority: source.authority === 'context_only' ? 'context_only' : null,
  };
}

function registrarRdapDiagnostics(value: unknown) {
  const source = recordOrNull(value);
  if (!source) return null;
  const endpoint = boundedEndpoint(source.endpoint);
  return {
    status: sourceStatus(source.status, REGISTRAR_RDAP_STATUSES, 'error'),
    endpoint,
    transportSecurity: endpoint ? endpoint.startsWith('https:') ? 'https' : 'http' : null,
    httpStatus: boundedHttpStatus(source.httpStatus),
    fetchedAt: boundedTimestamp(source.fetchedAt),
    attempt: source.attempt === null || source.attempt === undefined ? null : rdapAttempt(source.attempt),
  };
}

function lookupDiagnostics(value: unknown) {
  const source = recordOrNull(value) || {};
  const rdap = recordOrNull(source.rdap) || {};
  const whois = recordOrNull(source.whois) || {};
  const availability = recordOrNull(source.availability) || {};
  const reverseDns = recordOrNull(source.reverseDns);
  const network = recordOrNull(source.network);
  const securityTxt = recordOrNull(source.securityTxt);
  const sslbl = recordOrNull(source.sslbl);
  const rdapEndpoint = boundedEndpoint(rdap.endpoint);
  const networkEndpoint = boundedEndpoint(network?.endpoint);
  const networkPublicationAvailable = network?.status === 'success' || network?.status === 'partial';
  const securityTxtEndpoint = boundedPublishedUri(securityTxt?.endpoint, ['https:']);
  const version = boundedInteger(source.version, 10);
  const timing = lookupTimingDiagnostics(source.timing);
  const registryAccess = registryAccessDiagnostics(source.registryAccess);
  const registrar = registrarRdapDiagnostics(rdap.registrar);
  return {
    ...(version === null ? {} : { version }),
    ...(timing ? { timing } : {}),
    ...(registryAccess ? { registryAccess } : {}),
    rdap: {
      status: sourceStatus(rdap.status, RDAP_SOURCE_STATUSES, 'error'),
      errorCode: boundedString(rdap.errorCode, 80),
      endpoint: rdapEndpoint,
      transportSecurity: rdapEndpoint ? rdapEndpoint.startsWith('https:') ? 'https' : 'http' : null,
      httpStatus: boundedHttpStatus(rdap.httpStatus),
      fetchedAt: boundedTimestamp(rdap.fetchedAt),
      attempts: boundedRdapAttempts(rdap.attempts, 16),
      ...(registrar ? { registrar } : {}),
    },
    whois: {
      status: sourceStatus(whois.status, WHOIS_SOURCE_STATUSES, 'error'),
      errorCode: boundedString(whois.errorCode, 80),
      queriedAt: boundedTimestamp(whois.queriedAt),
      authoritativeHop: boundedHostname(whois.authoritativeHop),
      failedHop: boundedHostname(whois.failedHop),
      conflictingHop: boundedHostname(whois.conflictingHop),
    },
    ...(recordOrNull(source.availability) ? { availability: {
      status: sourceStatus(availability.status, AVAILABILITY_DIAGNOSTIC_STATUSES, 'error'),
      errorCode: boundedString(availability.errorCode, 80),
      resultState: boundedString(availability.resultState, 40),
    } } : {}),
    ...(reverseDns ? { reverseDns: {
      status: sourceStatus(reverseDns.status, REVERSE_DNS_STATUSES, 'error'),
      observedAt: boundedTimestamp(reverseDns.observedAt),
      complete: completeTerminalObservation(
        sourceStatus(reverseDns.status, REVERSE_DNS_STATUSES, 'error'),
        reverseDns.truncated,
      ),
      truncated: reverseDns.truncated === true,
    } } : {}),
    ...(network ? { network: {
      status: sourceStatus(network.status, NETWORK_CONTEXT_STATUSES, 'error'),
      address: networkPublicationAvailable ? boundedString(network.address, 64) : null,
      family: networkPublicationAvailable && (network.family === 4 || network.family === 6) ? network.family : null,
      addressSource: networkPublicationAvailable && typeof network.addressSource === 'string' && NETWORK_ADDRESS_SOURCES.has(network.addressSource)
        ? network.addressSource
        : null,
      endpoint: networkPublicationAvailable ? networkEndpoint : null,
      transportSecurity: networkPublicationAvailable && networkEndpoint ? networkEndpoint.startsWith('https:') ? 'https' : 'http' : null,
      httpStatus: networkPublicationAvailable ? boundedHttpStatus(network.httpStatus) : null,
      fetchedAt: networkPublicationAvailable ? boundedTimestamp(network.fetchedAt) : null,
      attempts: networkPublicationAvailable ? boundedRdapAttempts(network.attempts, 3) : [],
    } } : {}),
    ...(securityTxt ? { securityTxt: {
      status: boundedString(securityTxt.status, 40),
      state: typeof securityTxt.state === 'string' && SECURITY_TXT_STATES.has(securityTxt.state)
        ? securityTxt.state
        : null,
      endpoint: securityTxtEndpoint,
      httpStatus: boundedHttpStatus(securityTxt.httpStatus),
      observedAt: boundedTimestamp(securityTxt.observedAt),
      complete: securityTxt.complete === true,
      truncated: securityTxt.truncated === true,
    } } : {}),
    ...(sslbl ? { sslbl: {
      status: typeof sslbl.status === 'string' && SSLBL_STATES.has(sslbl.status) ? sslbl.status : null,
      verdict: typeof sslbl.verdict === 'string' && SSLBL_VERDICTS.has(sslbl.verdict) ? sslbl.verdict : null,
      observedAt: boundedTimestamp(sslbl.observedAt),
      complete: sslbl.complete === true,
      snapshotUpdatedAt: boundedTimestamp(sslbl.snapshotUpdatedAt),
    } } : {}),
  };
}

function networkSource(value: unknown) {
  const source = recordOrNull(value);
  if (
    !source
    || source.contextVersion !== 1
    || typeof source.status !== 'string'
    || !NETWORK_CONTEXT_STATUSES.has(source.status)
  ) return null;
  const endpoint = recordOrNull(source.endpoint);
  const rdap = recordOrNull(source.rdap);
  const network = recordOrNull(source.network);
  const diagnostics = recordOrNull(source.diagnostics);
  const rdapEndpoint = boundedEndpoint(rdap?.endpoint);
  const publicationAvailable = source.status === 'success' || source.status === 'partial';
  return {
    contextVersion: 1,
    version: source.version === 1 ? 1 : null,
    status: source.status,
    observedAt: boundedTimestamp(source.observedAt),
    scanMode: source.scanMode === 'deep' ? 'deep' : null,
    source: source.source === 'ip_rdap' ? 'ip_rdap' : null,
    durationMs: boundedInteger(source.durationMs, 120_000),
    complete: completeTerminalObservation(source.status, source.truncated),
    truncated: source.truncated === true,
    limitations: boundedStringList(source.limitations, 10, 300),
    diagnostics: diagnostics ? {
      requestCount: boundedInteger(diagnostics.requestCount, 1),
      addressSource: typeof diagnostics.addressSource === 'string'
        && NETWORK_ADDRESS_SOURCES.has(diagnostics.addressSource)
        ? diagnostics.addressSource
        : null,
      httpStatus: boundedHttpStatus(diagnostics.httpStatus),
      cidrCount: boundedInteger(diagnostics.cidrCount, 16),
    } : null,
    detail: boundedString(source.detail, 300),
    endpoint: publicationAvailable && endpoint ? {
      address: boundedString(endpoint.address, 64),
      family: endpoint.family === 4 || endpoint.family === 6 ? endpoint.family : null,
      selectedFrom: typeof endpoint.selectedFrom === 'string'
        && NETWORK_ADDRESS_SOURCES.has(endpoint.selectedFrom)
        ? endpoint.selectedFrom
        : null,
    } : null,
    rdap: publicationAvailable && rdap ? {
      endpoint: rdapEndpoint,
      transportSecurity: rdapEndpoint ? rdapEndpoint.startsWith('https:') ? 'https' : 'http' : null,
      httpStatus: boundedHttpStatus(rdap.httpStatus),
      fetchedAt: boundedTimestamp(rdap.fetchedAt),
      attempts: boundedRdapAttempts(rdap.attempts, 3),
    } : null,
    network: publicationAvailable && network ? {
      handle: boundedString(network.handle, 300),
      name: boundedString(network.name, 300),
      holder: boundedString(network.holder, 300),
      cidrs: boundedStringList(network.cidrs, 16, 96),
      startAddress: boundedString(network.startAddress, 64),
      endAddress: boundedString(network.endAddress, 64),
      country: /^[a-z]{2}$/i.test(String(network.country || '')) ? String(network.country).toUpperCase() : null,
      networkType: boundedString(network.networkType, 160),
      databaseUpdatedAt: boundedTimestamp(network.databaseUpdatedAt),
    } : null,
  };
}

function reverseDnsSource(value: unknown) {
  const source = recordOrNull(value);
  if (!source
    || source.version !== 1
    || source.source !== 'reverse_dns'
    || typeof source.status !== 'string'
    || !REVERSE_DNS_STATUSES.has(source.status)) {
    return null;
  }
  const records = recordOrNull(source.records);
  const diagnostics = recordOrNull(source.diagnostics);
  const ptrDiagnostics = recordOrNull(diagnostics?.ptr);
  const publicationAvailable = source.status === 'success' || source.status === 'partial';
  const ptr = [...new Set((publicationAvailable && Array.isArray(records?.ptr) ? records.ptr : [])
    .slice(0, 8)
    .map(boundedHostname)
    .filter((item): item is string => item !== null))].sort();
  return {
    version: 1,
    status: source.status,
    observedAt: boundedTimestamp(source.observedAt),
    scanMode: source.scanMode === 'deep' ? 'deep' : null,
    source: 'reverse_dns',
    durationMs: boundedInteger(source.durationMs, 120_000),
    complete: completeTerminalObservation(source.status, source.truncated),
    truncated: source.truncated === true,
    limitations: boundedStringList(source.limitations, 10, 300),
    diagnostics: ptrDiagnostics ? {
      ptr: {
        status: boundedString(ptrDiagnostics.status, 40),
        error: boundedString(ptrDiagnostics.error, 180),
        truncated: ptrDiagnostics.truncated === true,
        discarded: boundedInteger(ptrDiagnostics.discarded, 1000),
      },
    } : null,
    records: { ptr },
  };
}

function boundedSourceError(value: unknown, fallback: string): string {
  const normalized = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return normalized.slice(0, 10_000) || fallback;
}

function sourceStatus(value: unknown, allowed: ReadonlySet<string>, fallback: string): string {
  return typeof value === 'string' && allowed.has(value) ? value : fallback;
}

function rdapSource(rdap: unknown, diagnostics: UnknownRecord | null) {
  const source = recordOrNull(rdap) || {};
  const status = sourceStatus(diagnostics?.status, RDAP_SOURCE_STATUSES, 'error');
  const attempts = boundedRdapAttempts(source.attempts ?? diagnostics?.attempts, 16);
  if (status === 'error') return {
    status: 'error',
    error: boundedSourceError(source.error ?? diagnostics?.errorCode, 'RDAP source reported an error.'),
    attempts,
  };
  const hasPublication = status === 'success' || status === 'partial';
  return {
    status,
    endpoint: boundedEndpoint(source.rdapServer ?? diagnostics?.endpoint),
    transportSecurity: source.transportSecurity === 'http' || source.transportSecurity === 'https'
      ? source.transportSecurity
      : diagnostics?.transportSecurity === 'http' || diagnostics?.transportSecurity === 'https'
        ? diagnostics.transportSecurity
        : null,
    httpStatus: boundedHttpStatus(source.upstreamStatus ?? diagnostics?.httpStatus),
    fetchedAt: boundedTimestamp(source.fetchedAt ?? diagnostics?.fetchedAt),
    attempts,
    parsed: hasPublication ? projectLookupEvidencePrivacySafeTree(source.parsed) : null,
    raw: hasPublication ? projectLookupEvidencePrivacySafeTree(source.data) : null,
  };
}

function whoisSource(whois: unknown, diagnostics: UnknownRecord | null) {
  const source = recordOrNull(whois) || {};
  const status = sourceStatus(diagnostics?.status, WHOIS_SOURCE_STATUSES, 'error');
  if (status === 'error') return {
    status: 'error',
    error: boundedSourceError(source.error ?? diagnostics?.errorCode, 'WHOIS source reported an error.'),
  };
  const parsed = recordOrNull(source.parsed);
  const hasPublication = status === 'complete' || status === 'partial';
  const chain = hasPublication ? boundedWhoisChain(source.chain) : [];
  const firstHop = recordOrNull(chain[0]);
  return {
    status,
    queriedAt: boundedTimestamp(firstHop?.queriedAt ?? diagnostics?.queriedAt),
    authoritativeHop: boundedHostname(parsed?.authoritativeHop ?? diagnostics?.authoritativeHop),
    failedHop: boundedHostname(parsed?.failedHop ?? diagnostics?.failedHop),
    conflictingHop: boundedHostname(parsed?.conflictingHop ?? diagnostics?.conflictingHop),
    parsed: hasPublication ? projectLookupEvidencePrivacySafeTree(parsed) : null,
    chain,
  };
}

function registrarPublicationComparison(body: UnknownRecord, registryParsed: UnknownRecord | null) {
  const rdap = recordOrNull(body.rdap);
  const registrar = recordOrNull(rdap?.registrarRdap);
  const diagnostics = recordOrNull(body.diagnostics);
  const rdapDiagnostics = recordOrNull(diagnostics?.rdap);
  const registrarDiagnostics = recordOrNull(rdapDiagnostics?.registrar);
  if (!registrar && !registrarDiagnostics) return null;

  const reportedStatus = registrar?.status ?? registrarDiagnostics?.status;
  const parsed = ['success', 'partial'].includes(String(reportedStatus))
    ? recordOrNull(projectLookupEvidencePrivacySafeTree(registrar?.parsed))
    : null;
  const registrarStatus = typeof reportedStatus === 'string' && REGISTRAR_RDAP_STATUSES.has(reportedStatus)
    ? (reportedStatus === 'success' && !parsed ? 'partial' : reportedStatus)
    : 'error';
  return compareRdapPublications(registryParsed, parsed, {
    registryStatus: rdapDiagnostics?.status,
    registrarStatus,
  });
}

export function buildLookupEvidence(response: unknown, options: LookupEvidenceOptions = {}) {
  const { generatedAt = new Date().toISOString(), idnAnalysis = null, applicationVersion = null } = options;
  const body = recordOrNull(response) || {};
  const rdap = recordOrNull(body.rdap);
  const whois = recordOrNull(body.whois);
  const diagnostics = recordOrNull(body.diagnostics);
  const projectedDiagnostics = lookupDiagnostics(diagnostics);
  const rdapDiagnostics = recordOrNull(projectedDiagnostics.rdap);
  const whoisDiagnostics = recordOrNull(projectedDiagnostics.whois);
  const projectedRdap = rdapSource(rdap, rdapDiagnostics);
  const projectedWhois = whoisSource(whois, whoisDiagnostics);
  const projectedRdapRecord = recordOrNull(projectedRdap) || {};
  const projectedWhoisRecord = recordOrNull(projectedWhois) || {};
  const rdapParsed = ['success', 'partial'].includes(String(projectedRdapRecord.status))
    ? recordOrNull(projectedRdapRecord.parsed)
    : null;
  const whoisParsed = ['complete', 'partial'].includes(String(projectedWhoisRecord.status))
    ? recordOrNull(projectedWhoisRecord.parsed)
    : null;
  // Rebuild the pure interpretation from bounded source fields instead of
  // trusting a supplied derived object. This adds no collection or network
  // work and lets saved or fast responses carry current source-health-aware
  // interpretation in a deliberate analyst-created export.
  const registryInsights = buildRegistryInsights({
    rdapParsed,
    rdapStatus: rdapDiagnostics?.status,
    rdapFetchedAt: rdap?.fetchedAt,
    whoisParsed,
    whoisStatus: whoisDiagnostics?.status,
    whoisQueriedAt: recordOrNull(Array.isArray(whois?.chain) ? whois.chain[0] : null)?.queriedAt,
  });
  const query = projectLookupEvidenceQuery(body);
  const availabilityAnalysis = projectLookupEvidenceAvailability(body.availability);
  const idn = projectedKnownRecord(idnAnalysis, LOOKUP_IDN_ANALYSIS_KEYS);
  return {
    schema: LOOKUP_EVIDENCE_SCHEMA,
    schemaVersion: LOOKUP_EVIDENCE_SCHEMA_VERSION,
    generatedAt,
    application: buildPortableGeneratorMetadata(applicationVersion),
    query,
    diagnostics: projectedDiagnostics,
    sources: {
      rdap: projectedRdap,
      whois: projectedWhois,
      reverseDns: reverseDnsSource(body.reverseDns),
      network: networkSource(body.networkContext),
      securityTxt: securityTxtSource(body.securityTxt),
      sslbl: sslblSource(body.sslbl),
    },
    analysis: {
      availability: availabilityAnalysis,
      idn,
      registryInsights: projectLookupEvidencePrivacySafeTree(registryInsights),
      registryComparison: projectLookupEvidencePrivacySafeTree(compareRegistrySources(rdapParsed, whoisParsed, {
        rdapStatus: rdapDiagnostics?.status,
        whoisStatus: whoisDiagnostics?.status,
      })),
      registrarPublicationComparison: projectLookupEvidencePrivacySafeTree(
        registrarPublicationComparison(body, rdapParsed),
      ),
    },
  };
}

export function evidenceFilename(response: unknown, now = Date.now()) {
  const record = recordOrNull(response);
  const rawTarget = record?.registrableDomain || record?.inputHostname || record?.query || 'lookup';
  const target = String(rawTarget)
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'lookup';
  const timestamp = new Date(now).toISOString().replace(/[:.]/g, '-');
  return `whoisleuth-evidence-${target}-${timestamp}.json`;
}
