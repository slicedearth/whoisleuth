// Portable tree bounds, private-field exclusion and availability projection.
// Source-specific publication assembly remains in evidence-export.mts.
import { isSafeJsonObjectKey } from './bounded-json.mts';
import { recordOrNull, type UnknownRecord } from './json-record.mts';
import { isUriShapedLabel } from './portable-generator.mts';
import { validHttpDeliveryMetadata, validPagePublicationMetadata } from './homepage-metadata-contract.mts';
import {
  LOOKUP_EVIDENCE_PORTABLE_MAX_BYTES, LOOKUP_EVIDENCE_PORTABLE_MAX_ENTRIES,
  LOOKUP_EVIDENCE_PORTABLE_MAX_DEPTH, LOOKUP_EVIDENCE_PORTABLE_MAX_ARRAY_ITEMS,
  LOOKUP_EVIDENCE_PORTABLE_MAX_KEY_LENGTH, LOOKUP_EVIDENCE_PORTABLE_MAX_STRING_LENGTH,
} from '../packages/contracts/lookup-evidence.mts';

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
  'registryContactsExcluded', 'observationHostname', 'webObservationMode',
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
  'description',
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
  'dnsNames', 'ipAddresses', 'otherNames', 'classes', 'dns', 'ip', 'directoryName',
  'registeredId', 'otherName', 'publicKey', 'bits', 'curve',
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
  'visibleText', 'domStructure', 'similarity', 'formStructure', 'resourceHosts',
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
const LOOKUP_AVAILABILITY_TLS_SAN_CLASS_KEYS = new Set([
  'dns', 'ip', 'email', 'uri', 'directoryName', 'registeredId', 'otherName', 'unclassified',
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

export function portableUri(value: unknown): string | null {
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
    return projectPortableString(value);
  }
  if (Array.isArray(value)) {
    return value.slice(0, LOOKUP_EVIDENCE_PORTABLE_MAX_ARRAY_ITEMS)
      .map((item) => projectLookupEvidenceAvailabilityPublicValue(item, path, state, depth + 1));
  }
  const source = recordOrNull(value);
  if (!source) return null;
  const output: UnknownRecord = {};
  for (const [key, item] of Object.entries(source).slice(0, LOOKUP_EVIDENCE_PORTABLE_MAX_ARRAY_ITEMS)) {
    if (!LOOKUP_AVAILABILITY_PORTABLE_NESTED_KEYS.has(key)
      || privateEvidenceKey(key, item)) continue;
    const parentPath = path.join('.');
    const sanClassCount = parentPath === 'tls.certificate.subjectAltNames.classes'
      && LOOKUP_AVAILABILITY_TLS_SAN_CLASS_KEYS.has(key)
      && Number.isSafeInteger(item)
      && Number(item) >= 0
      && Number(item) <= LOOKUP_EVIDENCE_PORTABLE_MAX_ARRAY_ITEMS;
    if (['dns', 'ip', 'directoryName', 'registeredId', 'otherName'].includes(key)
      && !sanClassCount) continue;
    if (parentPath === 'tls.certificate.subjectAltNames.classes'
      && LOOKUP_AVAILABILITY_TLS_SAN_CLASS_KEYS.has(key)
      && !sanClassCount) continue;
    if (key === 'classes'
      && (parentPath !== 'tls.certificate.subjectAltNames' || !recordOrNull(item))) continue;
    if (key === 'similarity'
      && (parentPath !== 'pageIdentity.fingerprints.domStructure'
        || (item !== null && !recordOrNull(item)))) continue;
    if (key === 'description'
      && (parentPath !== 'technologyProfile.findings.evidence'
        || typeof item !== 'string')) continue;
    output[key] = projectLookupEvidenceAvailabilityPublicValue(item, [...path, key], state, depth + 1);
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
    const boundedCount = Number.isSafeInteger(item)
      && Number(item) >= 0
      && Number(item) <= LOOKUP_EVIDENCE_PORTABLE_MAX_ARRAY_ITEMS;
    const credentialCategoryCount = parentPath === 'credentialSurfaceProfile.inputs.categories'
      && boundedCount;
    const sanClassCount = parentPath === 'tls.certificate.subjectAltNames.classes'
      && LOOKUP_AVAILABILITY_TLS_SAN_CLASS_KEYS.has(key)
      && boundedCount;
    if (LOOKUP_AVAILABILITY_CREDENTIAL_CATEGORY_KEYS.has(key)
      && !credentialCategoryCount
      && !sanClassCount) continue;
    if (['dns', 'ip', 'directoryName', 'registeredId', 'otherName'].includes(key)
      && !sanClassCount) continue;
    if (key === 'classes'
      && (parentPath !== 'tls.certificate.subjectAltNames' || !recordOrNull(item))) continue;
    if (key === 'similarity'
      && (parentPath !== 'pageIdentity.fingerprints.domStructure'
        || (item !== null && !recordOrNull(item)))) continue;
    if (key === 'description'
      && (parentPath !== 'technologyProfile.findings.evidence'
        || typeof item !== 'string')) continue;
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
      : projectLookupEvidenceAvailabilityPublicValue(item, [key], state, 1);
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

export function projectedKnownRecord(value: unknown, keys: ReadonlySet<string>): UnknownRecord | null {
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

export function boundedString(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value.replace(/\s+/g, ' ').trim() || null;
}
