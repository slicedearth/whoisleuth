import { compareRdapPublications, compareRegistrySources } from './registry-comparison.mts';
import { buildRegistryInsights } from './registry-insights.mts';
import { buildPortableGeneratorMetadata, isUriShapedLabel } from './portable-generator.mts';
import { assertBoundedJsonStructure, isSafeJsonObjectKey } from './bounded-json.mts';
import {
  validHttpDeliveryMetadata,
  validPagePublicationMetadata,
} from './homepage-metadata-contract.mts';
import { normalizeExplicitIsoTimestamp } from '../packages/evidence/observation.mts';
import { defineSchemaCompatibility } from '../packages/contracts/schema-compatibility.mts';
import { isValidAsciiHostname } from './hostname.mts';
import {
  REGISTRAR_STANDING_SCHEMA,
  REGISTRAR_STANDING_VERSION,
  registrarIanaIds,
  registrarStandingObservedBy,
  resolveRegistrarIanaId,
  validRegistrarStanding,
} from './registrar-standing-contract.mts';

export const LOOKUP_EVIDENCE_SCHEMA = 'whoisleuth.lookup-evidence';
export const V1_PUBLIC_LOOKUP_EVIDENCE_SCHEMA_VERSION = 26;
export const PUBLISHED_V2_LOOKUP_EVIDENCE_SCHEMA_VERSION = 27;
export const LATEST_PUBLIC_LOOKUP_EVIDENCE_SCHEMA_VERSION = 28;
export const PRIVACY_MINIMIZED_LOOKUP_EVIDENCE_SCHEMA_VERSION = PUBLISHED_V2_LOOKUP_EVIDENCE_SCHEMA_VERSION;
export const LOOKUP_EVIDENCE_SCHEMA_VERSION = LATEST_PUBLIC_LOOKUP_EVIDENCE_SCHEMA_VERSION;
export const SUPPORTED_LOOKUP_EVIDENCE_SCHEMA_VERSIONS = Object.freeze([
  V1_PUBLIC_LOOKUP_EVIDENCE_SCHEMA_VERSION,
  PUBLISHED_V2_LOOKUP_EVIDENCE_SCHEMA_VERSION,
  LOOKUP_EVIDENCE_SCHEMA_VERSION,
]);
export const LOOKUP_EVIDENCE_PORTABLE_MAX_BYTES = 5 * 1024 * 1024;
export const LOOKUP_EVIDENCE_PORTABLE_MAX_ENTRIES = 20_000;
export const LOOKUP_EVIDENCE_PORTABLE_MAX_DEPTH = 24;
export const LOOKUP_EVIDENCE_PORTABLE_MAX_ARRAY_ITEMS = 10_000;
export const LOOKUP_EVIDENCE_PORTABLE_MAX_KEY_LENGTH = 256;
export const LOOKUP_EVIDENCE_PORTABLE_MAX_STRING_LENGTH = 1024 * 1024;

export const LOOKUP_EVIDENCE_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.lookup-evidence',
  kind: 'export',
  schema: LOOKUP_EVIDENCE_SCHEMA,
  currentVersion: LOOKUP_EVIDENCE_SCHEMA_VERSION,
  supportedVersions: SUPPORTED_LOOKUP_EVIDENCE_SCHEMA_VERSIONS,
  acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'reject',
  migration: 'read_only',
  writeSemantics: 'read_only',
  byteBudget: LOOKUP_EVIDENCE_PORTABLE_MAX_BYTES,
  owner: 'lib/evidence-export.mts',
  note: 'Exact v1.47.4 version 26, published v2.0.1 version 27, and latest-public v2.1.0 version 28 remain replayable; version 28 adds a bounded official-source registrar-standing projection.',
});

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
const PUBLIC_LOOKUP_AVAILABILITY_ANALYSIS_KEYS = new Set([
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
const LOOKUP_AVAILABILITY_ANALYSIS_KEYS = new Set([
  ...[...PUBLIC_LOOKUP_AVAILABILITY_ANALYSIS_KEYS]
    .filter((key) => !['registrar', 'registrant', 'abuse'].includes(key)),
  'registryContactsExcluded',
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
  'findings', 'id', 'label', 'tone', 'category', 'confidence', 'compatibility', 'role', 'roles', 'evidence',
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
const LOOKUP_AVAILABILITY_CREDENTIAL_CATEGORY_KEYS = new Set([
  'password', 'email', 'username', 'one_time_code', 'payment',
]);
const LOOKUP_AVAILABILITY_VALUE_PATHS = new Set([
  'dns.records.caa',
  'dns.caaPolicy.records',
  'http.response.bodyHash',
  'pageIdentity.trackingIdentifiers',
  'pageIdentity.fingerprints.exact',
  'pageIdentity.fingerprints.normalizedHtml',
  'pageIdentity.fingerprints.visibleText',
  'pageIdentity.fingerprints.domStructure',
  'pageIdentity.fingerprints.domStructure.similarity',
  'pageIdentity.fingerprints.formStructure',
  'pageIdentity.fingerprints.resourceHosts',
  'pageIdentity.fingerprints.identifiers',
  'pageIdentity.fingerprints.identifiers.values',
]);
const LOOKUP_AVAILABILITY_OWNER_PATHS = new Set([
  'dns.records.https',
  'dns.caaPolicy.queriedOwners',
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
type PortableProjectionState = { entries: number };

function consumePortableProjectionEntry(state: PortableProjectionState, depth: number): void {
  state.entries += 1;
  if (state.entries > LOOKUP_EVIDENCE_PORTABLE_MAX_ENTRIES) {
    throw new TypeError(`Lookup evidence projection exceeds the ${LOOKUP_EVIDENCE_PORTABLE_MAX_ENTRIES.toLocaleString('en')}-entry portable limit.`);
  }
  if (depth > LOOKUP_EVIDENCE_PORTABLE_MAX_DEPTH) {
    throw new TypeError(`Lookup evidence projection exceeds the ${LOOKUP_EVIDENCE_PORTABLE_MAX_DEPTH}-level portable nesting limit.`);
  }
}

function projectPortableString(value: string): string {
  const sanitized = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, ' ');
  return sanitized.length <= LOOKUP_EVIDENCE_PORTABLE_MAX_STRING_LENGTH
    ? sanitized
    : sanitized.slice(0, LOOKUP_EVIDENCE_PORTABLE_MAX_STRING_LENGTH);
}

function projectLookupEvidenceAvailabilityString(value: string): string | null {
  const sanitized = projectPortableString(value)
    .replace(/[\u0080-\u009f]/gu, ' ')
    .replace(/\p{Default_Ignorable_Code_Point}/gu, '');
  return isUriShapedLabel(value) ? null : sanitized;
}

function projectLookupEvidencePrivacySafeTreeValue<T>(
  value: T,
  state: PortableProjectionState,
  depth: number,
): T {
  consumePortableProjectionEntry(state, depth);
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return projectPortableString(value) as T;
  if (Array.isArray(value)) {
    return value.slice(0, LOOKUP_EVIDENCE_PORTABLE_MAX_ARRAY_ITEMS)
      .map((item) => projectLookupEvidencePrivacySafeTreeValue(item, state, depth + 1)) as T;
  }
  const source = recordOrNull(value);
  if (!source) return null as T;
  const output: UnknownRecord = {};
  for (const [key, item] of Object.entries(source).slice(0, LOOKUP_EVIDENCE_PORTABLE_MAX_ARRAY_ITEMS)) {
    if (!isSafeJsonObjectKey(key)) throw new TypeError('Lookup evidence projection contains an unsafe object key.');
    const normalized = normalizedEvidenceKey(key);
    if (privateEvidenceKey(normalized, item)) continue;
    if (typeof item === 'string' && PORTABLE_URL_KEYS.has(normalized)) {
      consumePortableProjectionEntry(state, depth + 1);
      output[key] = portableUri(item);
      continue;
    }
    output[key] = projectLookupEvidencePrivacySafeTreeValue(item, state, depth + 1);
  }
  return output as T;
}

export function projectLookupEvidencePrivacySafeTree<T>(value: T): T {
  return projectLookupEvidencePrivacySafeTreeValue(value, { entries: 0 }, 0);
}

function projectLookupEvidenceAvailabilityPublicValue(
  value: unknown,
  parentKey: string | null,
  state: PortableProjectionState,
  depth: number,
): unknown {
  consumePortableProjectionEntry(state, depth);
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    const normalizedParent = normalizedEvidenceKey(parentKey || '');
    if (PORTABLE_URL_KEYS.has(normalizedParent)) return portableUri(value);
    if (PORTABLE_ORIGIN_COLLECTION_KEYS.has(normalizedParent)) return portableOrigin(value);
    return projectPortableString(value);
  }
  if (Array.isArray(value)) {
    return value.slice(0, LOOKUP_EVIDENCE_PORTABLE_MAX_ARRAY_ITEMS)
      .map((item) => projectLookupEvidenceAvailabilityPublicValue(item, parentKey, state, depth + 1));
  }
  const source = recordOrNull(value);
  if (!source) return null;
  const output: UnknownRecord = {};
  for (const [key, item] of Object.entries(source).slice(0, LOOKUP_EVIDENCE_PORTABLE_MAX_ARRAY_ITEMS)) {
    if (!LOOKUP_AVAILABILITY_PORTABLE_NESTED_KEYS.has(key)
      || privateEvidenceKey(key, item)) continue;
    output[key] = projectLookupEvidenceAvailabilityPublicValue(item, key, state, depth + 1);
  }
  return output;
}

function projectLookupEvidenceAvailabilityValue(
  value: unknown,
  path: readonly string[],
  state: PortableProjectionState,
  depth: number,
): unknown {
  consumePortableProjectionEntry(state, depth);
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    const normalizedParent = normalizedEvidenceKey(path.at(-1) || '');
    if (PORTABLE_URL_KEYS.has(normalizedParent)) return portableUri(value);
    if (PORTABLE_ORIGIN_COLLECTION_KEYS.has(normalizedParent)) return portableOrigin(value);
    return projectLookupEvidenceAvailabilityString(value);
  }
  if (Array.isArray(value)) {
    return value.slice(0, LOOKUP_EVIDENCE_PORTABLE_MAX_ARRAY_ITEMS)
      .map((item) => projectLookupEvidenceAvailabilityValue(item, path, state, depth + 1));
  }
  const source = recordOrNull(value);
  if (!source) return null;
  const output: UnknownRecord = {};
  for (const [key, item] of Object.entries(source).slice(0, LOOKUP_EVIDENCE_PORTABLE_MAX_ARRAY_ITEMS)) {
    if (!LOOKUP_AVAILABILITY_PORTABLE_NESTED_KEYS.has(key)
      || privateEvidenceKey(key, item)) continue;
    const parentPath = path.join('.');
    if (LOOKUP_AVAILABILITY_CREDENTIAL_CATEGORY_KEYS.has(key)
      && (parentPath !== 'credentialSurfaceProfile.inputs.categories'
        || !Number.isSafeInteger(item)
        || Number(item) < 0
        || Number(item) > LOOKUP_EVIDENCE_PORTABLE_MAX_ARRAY_ITEMS)) continue;
    if (key === 'owner'
      && (!LOOKUP_AVAILABILITY_OWNER_PATHS.has(parentPath) || typeof item !== 'string')) continue;
    if (key === 'value'
      && (!LOOKUP_AVAILABILITY_VALUE_PATHS.has(parentPath)
        || (item !== null && typeof item !== 'string'))) continue;
    output[key] = projectLookupEvidenceAvailabilityValue(item, [...path, key], state, depth + 1);
  }
  return output;
}

/**
 * Canonical portable projection for the bounded Lookup availability models.
 * The root and every nested record are positive allowlists, so an imported
 * extension cannot become authenticated evidence merely by avoiding a
 * credential-key denylist.
 */
function projectLookupEvidenceAvailabilityWithKeys(
  value: unknown,
  rootKeys: ReadonlySet<string>,
  registryContactsExcluded: boolean,
  currentPrivacyRules: boolean,
): UnknownRecord | null {
  const source = recordOrNull(value);
  if (!source) return null;
  const state: PortableProjectionState = { entries: 0 };
  consumePortableProjectionEntry(state, 0);
  const output: UnknownRecord = {};
  for (const key of rootKeys) {
    if (!Object.hasOwn(source, key)) continue;
    const item = source[key];
    if (privateEvidenceKey(key, item)) continue;
    output[key] = currentPrivacyRules
      ? projectLookupEvidenceAvailabilityValue(item, [key], state, 1)
      : projectLookupEvidenceAvailabilityPublicValue(item, key, state, 1);
  }
  if (registryContactsExcluded) output.registryContactsExcluded = true;
  const pageIdentity = recordOrNull(source.pageIdentity);
  const publicationMetadata = pageIdentity?.publicationMetadata;
  if (publicationMetadata !== undefined) {
    if (!['success', 'partial'].includes(String(pageIdentity?.status))
      || !validPagePublicationMetadata(publicationMetadata)) {
      throw new TypeError('Lookup evidence contains invalid page publication metadata.');
    }
    const projectedPageIdentity = recordOrNull(output.pageIdentity);
    if (projectedPageIdentity) {
      projectedPageIdentity.publicationMetadata = projectLookupEvidencePrivacySafeTree(publicationMetadata);
    }
  }
  const httpResponse = recordOrNull(recordOrNull(source.http)?.response);
  const sourceHttp = recordOrNull(source.http);
  const deliveryMetadata = httpResponse?.deliveryMetadata;
  if (deliveryMetadata !== undefined) {
    if (!['success', 'partial'].includes(String(sourceHttp?.status))
      || !validHttpDeliveryMetadata(deliveryMetadata)) {
      throw new TypeError('Lookup evidence contains invalid HTTP delivery metadata.');
    }
    const projectedHttp = recordOrNull(output.http);
    const projectedResponse = recordOrNull(projectedHttp?.response);
    if (projectedResponse) {
      projectedResponse.deliveryMetadata = projectLookupEvidencePrivacySafeTree(deliveryMetadata);
    }
  }
  return output;
}

/** Exact availability projection used only to validate public schema 26. */
export function projectLookupEvidenceAvailabilityPublic(value: unknown): UnknownRecord | null {
  return projectLookupEvidenceAvailabilityWithKeys(
    value,
    PUBLIC_LOOKUP_AVAILABILITY_ANALYSIS_KEYS,
    false,
    false,
  );
}

/**
 * Current availability projection. Registry-derived registrar, registrant,
 * and abuse contact routes are deliberately excluded at the root boundary;
 * the marker prevents that privacy omission from being read as source absence.
 */
export function projectLookupEvidenceAvailability(value: unknown): UnknownRecord | null {
  return projectLookupEvidenceAvailabilityWithKeys(
    value,
    LOOKUP_AVAILABILITY_ANALYSIS_KEYS,
    true,
    true,
  );
}

export function assertLookupEvidencePrivacySafeTree(value: unknown): void {
  assertLookupEvidencePortableTree(value);
  const pending: unknown[] = [value];
  while (pending.length) {
    const current = pending.pop();
    if (current === null || typeof current === 'boolean' || typeof current === 'number') continue;
    if (typeof current === 'string') {
      if (projectLookupEvidencePrivacySafeTree(current) !== current) {
        throw new TypeError('Lookup evidence contains a non-portable string value.');
      }
      continue;
    }
    if (Array.isArray(current)) {
      for (const item of current) pending.push(item);
      continue;
    }
    const source = recordOrNull(current);
    if (!source) throw new TypeError('Lookup evidence contains a non-JSON value.');
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
    if (current.value === null || typeof current.value === 'boolean') continue;
    if (typeof current.value === 'number') {
      if (!Number.isFinite(current.value)) {
        throw new TypeError('Lookup evidence contains a non-finite number.');
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
      const prototype = Object.getPrototypeOf(source);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError('Lookup evidence contains a non-JSON object.');
      }
      const keys = Object.keys(source);
      if (keys.length > LOOKUP_EVIDENCE_PORTABLE_MAX_ARRAY_ITEMS
        || keys.some((key) => key.length > LOOKUP_EVIDENCE_PORTABLE_MAX_KEY_LENGTH
          || /[\u0000-\u001f\u007f]/u.test(key)
          || !isSafeJsonObjectKey(key))) {
        throw new TypeError('Lookup evidence contains an over-bound object.');
      }
      for (const item of Object.values(source)) pending.push({ value: item, depth: current.depth + 1 });
      continue;
    }
    throw new TypeError('Lookup evidence contains a non-JSON value.');
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
  return text ? normalizeExplicitIsoTimestamp(text) : null;
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
  const text = boundedString(value, 253)?.replace(/\.+$/u, '') || null;
  return text && isValidAsciiHostname(text, { requireDot: false }) ? text.toLowerCase() : null;
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

type ProjectedScalar = string | number | boolean | null;
type ScalarProjector = (value: unknown) => ProjectedScalar | undefined;

function nullableText(maximum: number): ScalarProjector {
  return (value) => value === null ? null : boundedString(value, maximum) ?? undefined;
}

function nullableTimestamp(value: unknown): ProjectedScalar | undefined {
  return value === null ? null : boundedTimestamp(value) ?? undefined;
}

function booleanValue(nullable = false): ScalarProjector {
  return (value) => typeof value === 'boolean' ? value : nullable && value === null ? null : undefined;
}

function nullableInteger(maximum: number): ScalarProjector {
  return (value) => value === null ? null : boundedInteger(value, maximum) ?? undefined;
}

function enumeration(values: ReadonlySet<string>, nullable = false): ScalarProjector {
  return (value) => typeof value === 'string' && values.has(value)
    ? value
    : nullable && value === null ? null : undefined;
}

const LOOKUP_RDAP_PORTABLE_SCALARS: Readonly<Record<string, ScalarProjector>> = Object.freeze({
  objectClassName: nullableText(80),
  language: nullableText(35),
  conformanceTruncated: booleanValue(),
  redactionsTruncated: booleanValue(),
  port43: nullableText(300),
  parentHandle: nullableText(300),
  linksTruncated: booleanValue(),
  noticesTruncated: booleanValue(),
  remarksTruncated: booleanValue(),
  serverTruncated: booleanValue(),
  statusesTruncated: booleanValue(),
  eventsTruncated: booleanValue(),
  domain: nullableText(253),
  unicodeDomain: nullableText(253),
  handle: nullableText(300),
  nameserversTruncated: booleanValue(),
  nameserverAddressesTruncated: booleanValue(),
  dnssec: enumeration(new Set(['Signed', 'Unsigned', 'Unknown']), true),
  zoneSigned: booleanValue(true),
  delegationSigned: booleanValue(true),
  dsDataTruncated: booleanValue(),
  variantsTruncated: booleanValue(),
  registrarIanaId: nullableText(300),
  entitiesTruncated: booleanValue(),
  name: nullableText(300),
  startAddress: nullableText(80),
  endAddress: nullableText(80),
  cidrsTruncated: booleanValue(),
  country: nullableText(2),
  networkType: nullableText(160),
  startAutnum: nullableInteger(4_294_967_295),
  endAutnum: nullableInteger(4_294_967_295),
  autnumType: nullableText(160),
});
const LOOKUP_RDAP_PORTABLE_STRING_LISTS: Readonly<Record<string, readonly [number, number]>> = Object.freeze({
  conformance: [50, 160],
  serverTruncationReasons: [8, 160],
  statuses: [100, 160],
  nameservers: [200, 253],
  truncatedEntityRoles: [11, 80],
  cidrs: [200, 160],
});
const LOOKUP_RDAP_EVENT_SCALARS: Readonly<Record<string, ScalarProjector>> = Object.freeze({
  action: nullableText(100),
  date: nullableText(64),
});
const LOOKUP_RDAP_LIFECYCLE_SCALARS: Readonly<Record<string, ScalarProjector>> = Object.freeze({
  createdDate: nullableText(64),
  reregistrationDate: nullableText(64),
  expiryDate: nullableText(64),
  updatedDate: nullableText(64),
  transferDate: nullableText(64),
  deletionDate: nullableText(64),
  reinstantiationDate: nullableText(64),
  databaseUpdatedDate: nullableText(64),
  createdDateIso: nullableTimestamp,
  reregistrationDateIso: nullableTimestamp,
  expiryDateIso: nullableTimestamp,
  updatedDateIso: nullableTimestamp,
  transferDateIso: nullableTimestamp,
  deletionDateIso: nullableTimestamp,
  reinstantiationDateIso: nullableTimestamp,
  databaseUpdatedDateIso: nullableTimestamp,
});
const LOOKUP_RDAP_REDACTION_SCALARS: Readonly<Record<string, ScalarProjector>> = Object.freeze({
  name: nullableText(300),
  reason: nullableText(300),
  method: nullableText(80),
  pathLanguage: nullableText(80),
  prePath: nullableText(512),
  postPath: nullableText(512),
  replacementPath: nullableText(512),
});
const LOOKUP_RDAP_REGISTRAR_SCALARS: Readonly<Record<string, ScalarProjector>> = Object.freeze({
  handle: nullableText(200),
  name: nullableText(300),
  org: nullableText(300),
  truncated: booleanValue(),
});
const LOOKUP_RDAP_PUBLIC_ID_SCALARS: Readonly<Record<string, ScalarProjector>> = Object.freeze({
  type: nullableText(160),
  identifier: nullableText(300),
});
const LOOKUP_RDAP_NAMESERVER_SCALARS: Readonly<Record<string, ScalarProjector>> = Object.freeze({
  name: nullableText(253),
});
const LOOKUP_RDAP_DS_SCALARS: Readonly<Record<string, ScalarProjector>> = Object.freeze({
  keyTag: nullableInteger(65_535),
  algorithm: nullableInteger(255),
  digestType: nullableInteger(255),
  digest: nullableText(512),
});
const LOOKUP_RDAP_VARIANT_SCALARS: Readonly<Record<string, ScalarProjector>> = Object.freeze({
  idnTable: nullableText(300),
});
const LOOKUP_RDAP_VARIANT_NAME_SCALARS: Readonly<Record<string, ScalarProjector>> = Object.freeze({
  ldhName: nullableText(253),
  unicodeName: nullableText(253),
});
const LOOKUP_WHOIS_PORTABLE_SCALARS: Readonly<Record<string, ScalarProjector>> = Object.freeze({
  domainName: nullableText(253),
  registryDomainId: nullableText(300),
  registrar: nullableText(300),
  registrarIanaId: nullableText(300),
  createdDate: nullableText(100),
  expiryDate: nullableText(100),
  updatedDate: nullableText(100),
  createdDateIso: nullableTimestamp,
  expiryDateIso: nullableTimestamp,
  updatedDateIso: nullableTimestamp,
  statusesTruncated: booleanValue(),
  nameserversTruncated: booleanValue(),
  dnssec: nullableText(300),
  chainStatus: enumeration(new Set(['complete', 'partial'])),
  authoritativeHop: nullableText(253),
  failedHop: nullableText(253),
  conflictingHop: nullableText(253),
});
const LOOKUP_REGISTRY_INSIGHT_PORTABLE_KEYS = new Set([
  'version', 'contactDisclosure', 'lifecycle', 'reconciliation', 'publications',
  'rdapCapabilities',
]);

function projectKnownArray(
  value: unknown,
  projectors: Readonly<Record<string, ScalarProjector>>,
  maximum: number,
): UnknownRecord[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maximum)
    .map((item) => projectedKnownScalarRecord(item, projectors))
    .filter((item): item is UnknownRecord => item !== null);
}

function projectedKnownScalarRecord(
  value: unknown,
  projectors: Readonly<Record<string, ScalarProjector>>,
): UnknownRecord | null {
  const source = recordOrNull(value);
  if (!source) return null;
  const output: UnknownRecord = {};
  for (const [key, projector] of Object.entries(projectors)) {
    if (!Object.hasOwn(source, key)) continue;
    const item = projector(source[key]);
    if (item !== undefined) output[key] = item;
  }
  return output;
}

/**
 * Positive portable projection for normalized RDAP. Contact entities, vCards,
 * entity inventories, arbitrary links/notices/remarks, and raw payloads never
 * cross this boundary. The marker prevents deliberate omission from becoming
 * an apparent source assertion that contacts were absent.
 */
export function projectLookupEvidenceRdapPublication(value: unknown): UnknownRecord | null {
  const source = recordOrNull(value);
  if (!source) return null;
  const output = projectedKnownScalarRecord(source, LOOKUP_RDAP_PORTABLE_SCALARS) || {};
  for (const [key, [count, length]] of Object.entries(LOOKUP_RDAP_PORTABLE_STRING_LISTS)) {
    if (Object.hasOwn(source, key)) output[key] = boundedStringList(source[key], count, length);
  }
  if (Object.hasOwn(source, 'events')) {
    output.events = projectKnownArray(source.events, LOOKUP_RDAP_EVENT_SCALARS, 100)
      .filter((event) => typeof event.action === 'string' || typeof event.date === 'string');
  }
  if (Object.hasOwn(source, 'lifecycle')) {
    output.lifecycle = projectedKnownScalarRecord(source.lifecycle, LOOKUP_RDAP_LIFECYCLE_SCALARS);
  }
  if (Object.hasOwn(source, 'redactions')) {
    const inputRedactions = Array.isArray(source.redactions) ? source.redactions : [];
    const redactions = projectKnownArray(inputRedactions, LOOKUP_RDAP_REDACTION_SCALARS, 100)
      .filter((redaction) => Object.values(redaction).some((item) => item !== null));
    output.redactions = redactions;
    output.redactionsTruncated = source.redactionsTruncated === true
      || !Array.isArray(source.redactions)
      || inputRedactions.length > 100
      || redactions.length < Math.min(inputRedactions.length, 100);
  }
  if (Object.hasOwn(source, 'nameserverDetails')) {
    output.nameserverDetails = (Array.isArray(source.nameserverDetails) ? source.nameserverDetails : [])
      .slice(0, 200)
      .map((item) => {
        const nameserver = projectedKnownScalarRecord(item, LOOKUP_RDAP_NAMESERVER_SCALARS);
        const original = recordOrNull(item);
        if (!nameserver || !original || typeof nameserver.name !== 'string') return null;
        nameserver.addresses = boundedStringList(original.addresses, 20, 80);
        return nameserver;
      })
      .filter((item): item is UnknownRecord => item !== null);
  }
  if (Object.hasOwn(source, 'dsData')) {
    output.dsData = projectKnownArray(source.dsData, LOOKUP_RDAP_DS_SCALARS, 50)
      .filter((item) => Number.isInteger(item.keyTag)
        && Number.isInteger(item.algorithm)
        && Number.isInteger(item.digestType)
        && typeof item.digest === 'string'
        && item.digest.length % 2 === 0
        && /^[0-9a-f]+$/iu.test(item.digest));
  }
  if (Object.hasOwn(source, 'variants') && Array.isArray(source.variants)) {
    output.variants = source.variants.slice(0, 20).map((item) => {
      const group = projectedKnownScalarRecord(item, LOOKUP_RDAP_VARIANT_SCALARS);
      if (!group) return null;
      const original = recordOrNull(item);
      const variantNames = projectKnownArray(original?.variantNames, LOOKUP_RDAP_VARIANT_NAME_SCALARS, 50)
        .filter((name) => typeof name.ldhName === 'string' || typeof name.unicodeName === 'string');
      const relation = boundedStringList(original?.relation, 20, 100);
      group.variantNames = variantNames;
      group.relation = relation;
      return typeof group.idnTable === 'string' || variantNames.length || relation.length
        ? group
        : null;
    }).filter((item): item is UnknownRecord => item !== null);
  }
  if (Object.hasOwn(source, 'registrar')) {
    const registrar = projectedKnownScalarRecord(source.registrar, LOOKUP_RDAP_REGISTRAR_SCALARS);
    if (registrar) {
      const original = recordOrNull(source.registrar);
      registrar.roles = boundedStringList(original?.roles, 12, 80);
      registrar.publicIds = projectKnownArray(original?.publicIds, LOOKUP_RDAP_PUBLIC_ID_SCALARS, 20)
        .filter((publicId) => typeof publicId.type === 'string'
          && typeof publicId.identifier === 'string');
    }
    output.registrar = registrar;
  }
  output.contactsExcluded = true;
  return output;
}

/** Positive portable projection for normalized WHOIS publication fields. */
export function projectLookupEvidenceWhoisPublication(value: unknown): UnknownRecord | null {
  const input = recordOrNull(value);
  if (!input) return null;
  const output = projectedKnownScalarRecord(input, LOOKUP_WHOIS_PORTABLE_SCALARS) || {};
  if (Object.hasOwn(input, 'lifecycle')) {
    output.lifecycle = projectedKnownScalarRecord(input.lifecycle, LOOKUP_RDAP_LIFECYCLE_SCALARS);
  }
  for (const [key, count, length] of [
    ['statuses', 100, 160],
    ['nameservers', 200, 253],
    ['fieldsTruncated', 64, 80],
  ] as const) {
    if (Object.hasOwn(input, key)) output[key] = boundedStringList(input[key], count, length);
  }
  output.contactsExcluded = true;
  return output;
}

/** Exact positive projection for one current-schema RDAP source wrapper. */
export function projectLookupEvidenceRdapSourcePublication(value: unknown): UnknownRecord | null {
  const source = recordOrNull(value);
  if (!source) return null;
  const status = sourceStatus(source.status, RDAP_SOURCE_STATUSES, 'error');
  const attempts = boundedRdapAttempts(source.attempts, 16);
  if (status === 'error') return {
    status,
    error: boundedSourceError(source.error, 'RDAP source reported an error.'),
    attempts,
  };
  const endpoint = boundedEndpoint(source.endpoint);
  const hasPublication = status === 'success' || status === 'partial';
  const parsed = hasPublication ? projectLookupEvidenceRdapPublication(source.parsed) : null;
  if (status === 'success' && parsed === null) return null;
  return {
    status,
    endpoint,
    transportSecurity: endpoint ? endpoint.startsWith('https:') ? 'https' : 'http' : null,
    httpStatus: boundedHttpStatus(source.httpStatus),
    fetchedAt: boundedTimestamp(source.fetchedAt),
    attempts,
    parsed,
  };
}

function projectedWhoisChainHop(value: unknown): UnknownRecord | null {
  const hop = recordOrNull(value);
  if (!hop) return null;
  const queryProfile = typeof hop.queryProfile === 'string' && WHOIS_QUERY_PROFILES.has(hop.queryProfile)
    ? hop.queryProfile
    : null;
  const status = typeof hop.status === 'string'
    && ['success', 'error', 'not_issued', 'unknown'].includes(hop.status)
    ? hop.status
    : 'unknown';
  return {
    server: boundedHostname(hop.server),
    address: boundedString(hop.address, 64),
    queriedAt: boundedTimestamp(hop.queriedAt),
    queryProfile,
    responseEncoding: hop.responseEncoding === 'utf-8' ? 'utf-8' : null,
    status,
    detail: boundedString(hop.detail, 240),
  };
}

/** Exact positive projection for one current-schema WHOIS source wrapper. */
export function projectLookupEvidenceWhoisSourcePublication(value: unknown): UnknownRecord | null {
  const source = recordOrNull(value);
  if (!source) return null;
  const status = sourceStatus(source.status, WHOIS_SOURCE_STATUSES, 'error');
  if (status === 'error') return {
    status,
    error: boundedSourceError(source.error, 'WHOIS source reported an error.'),
  };
  const hasPublication = status === 'complete' || status === 'partial';
  const parsed = hasPublication ? projectLookupEvidenceWhoisPublication(source.parsed) : null;
  if (status === 'complete' && parsed === null) return null;
  return {
    status,
    queriedAt: boundedTimestamp(source.queriedAt),
    authoritativeHop: boundedHostname(source.authoritativeHop),
    failedHop: boundedHostname(source.failedHop),
    conflictingHop: boundedHostname(source.conflictingHop),
    parsed,
    chain: hasPublication
      ? (Array.isArray(source.chain) ? source.chain : [])
          .slice(0, 16)
          .map(projectedWhoisChainHop)
          .filter((hop): hop is UnknownRecord => hop !== null)
      : [],
  };
}

export function projectLookupEvidenceRegistryInsights(value: unknown): UnknownRecord | null {
  return projectedKnownRecord(value, LOOKUP_REGISTRY_INSIGHT_PORTABLE_KEYS);
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
  const endpoint = boundedEndpoint(source.rdapServer ?? diagnostics?.endpoint);
  return {
    status,
    endpoint,
    transportSecurity: endpoint ? endpoint.startsWith('https:') ? 'https' : 'http' : null,
    httpStatus: boundedHttpStatus(source.upstreamStatus ?? diagnostics?.httpStatus),
    fetchedAt: boundedTimestamp(source.fetchedAt ?? diagnostics?.fetchedAt),
    attempts,
    parsed: hasPublication ? projectLookupEvidenceRdapPublication(source.parsed) : null,
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
    parsed: hasPublication ? projectLookupEvidenceWhoisPublication(parsed) : null,
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
    ? projectLookupEvidenceRdapPublication(registrar?.parsed)
    : null;
  const registrarStatus = typeof reportedStatus === 'string' && REGISTRAR_RDAP_STATUSES.has(reportedStatus)
    ? (reportedStatus === 'success' && !parsed ? 'partial' : reportedStatus)
    : 'error';
  return compareRdapPublications(registryParsed, parsed, {
    registryStatus: rdapDiagnostics?.status,
    registrarStatus,
  });
}

function projectRegistrarStanding(value: unknown, rdapParsed: unknown, whoisParsed: unknown, generatedAt: string) {
  if (value === undefined || value === null) return null;
  if (!validRegistrarStanding(value)) throw new TypeError('Lookup registrar standing is malformed or unsupported.');
  if (!registrarStandingObservedBy(value, generatedAt)) {
    throw new TypeError('Lookup registrar standing was observed after the evidence export time.');
  }
  const retainedIanaIds = registrarIanaIds(rdapParsed, whoisParsed);
  const retainedIanaId = resolveRegistrarIanaId(rdapParsed, whoisParsed);
  // A partial/error source can leave a valid response-level interpretation
  // whose identifying publication is deliberately omitted from the portable
  // export. Do not create an orphaned claim in that case. A contradictory
  // retained identifier remains a hard failure.
  if (value.ianaId !== null && retainedIanaIds.length === 0) return null;
  if (retainedIanaIds.length > 1) {
    throw new TypeError('Lookup registrar standing cannot be exported with conflicting retained registrar identifiers.');
  }
  if (value.ianaId !== retainedIanaId) {
    throw new TypeError('Lookup registrar standing does not match the retained registration sources.');
  }
  return {
    schema: REGISTRAR_STANDING_SCHEMA,
    version: REGISTRAR_STANDING_VERSION,
    ianaId: value.ianaId,
    accreditation: { ...value.accreditation },
    compliance: {
      ...value.compliance,
      actions: value.compliance.actions.map((action) => ({ ...action })),
    },
    assessment: { ...value.assessment },
    limitations: [...value.limitations],
    nextActions: [...value.nextActions],
  };
}

export function buildLookupEvidence(response: unknown, options: LookupEvidenceOptions = {}) {
  assertBoundedJsonStructure(response, 'Lookup response');
  const { generatedAt: generatedAtValue = new Date().toISOString(), idnAnalysis = null, applicationVersion = null } = options;
  const generatedAt = normalizeExplicitIsoTimestamp(generatedAtValue);
  if (!generatedAt) {
    throw new TypeError('Lookup evidence generation time must be valid and include an explicit timezone.');
  }
  const body = recordOrNull(response) || {};
  const rdap = recordOrNull(body.rdap);
  const whois = recordOrNull(body.whois);
  const diagnostics = recordOrNull(body.diagnostics);
  const projectedDiagnostics = lookupDiagnostics(diagnostics);
  const rdapDiagnostics = recordOrNull(projectedDiagnostics.rdap);
  const whoisDiagnostics = recordOrNull(projectedDiagnostics.whois);
  const projectedRdap = projectLookupEvidenceRdapSourcePublication(
    rdapSource(rdap, rdapDiagnostics),
  );
  const projectedWhois = projectLookupEvidenceWhoisSourcePublication(
    whoisSource(whois, whoisDiagnostics),
  );
  if (!projectedRdap) {
    throw new TypeError('Lookup evidence cannot publish successful RDAP without normalized publication data.');
  }
  if (!projectedWhois) {
    throw new TypeError('Lookup evidence cannot publish complete WHOIS without normalized publication data.');
  }
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
    rdapFetchedAt: projectedRdapRecord.fetchedAt,
    whoisParsed,
    whoisStatus: whoisDiagnostics?.status,
    whoisQueriedAt: projectedWhoisRecord.queriedAt,
  });
  const query = projectLookupEvidenceQuery(body);
  const availabilityAnalysis = projectLookupEvidenceAvailability(body.availability);
  const idn = projectedKnownRecord(idnAnalysis, LOOKUP_IDN_ANALYSIS_KEYS);
  const evidence = {
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
      registryInsights: projectLookupEvidenceRegistryInsights(registryInsights),
      registryComparison: projectLookupEvidencePrivacySafeTree(compareRegistrySources(rdapParsed, whoisParsed, {
        rdapStatus: rdapDiagnostics?.status,
        whoisStatus: whoisDiagnostics?.status,
      })),
      registrarPublicationComparison: projectLookupEvidencePrivacySafeTree(
        registrarPublicationComparison(body, rdapParsed),
      ),
      registrarStanding: projectRegistrarStanding(body.registrarStanding, rdapParsed, whoisParsed, generatedAt),
    },
  };
  assertLookupEvidencePortableTree(evidence);
  return evidence;
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
