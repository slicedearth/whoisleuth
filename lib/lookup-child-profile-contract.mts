// Browser-safe version and collection boundaries shared by Lookup child
// profile producers and the client response trust boundary.

import {
  MAX_OBSERVATION_LIMITATIONS,
  MAX_OBSERVATION_LIMITATION_LENGTH,
  OBSERVATION_VERSION,
  normalizeExplicitIsoTimestamp,
} from '../packages/evidence/observation.mts';
import {
  PAGE_FINGERPRINT_VERSION,
  PAGE_IDENTITY_VERSION,
} from '../packages/contracts/workspace-portability.mts';
import { validPagePublicationMetadata } from './homepage-metadata-contract.mts';
import {
  MAX_LOOKUP_TLS_ALT_NAMES,
  MAX_LOOKUP_TLS_CERTIFICATE_POLICIES,
  MAX_LOOKUP_TLS_CHAIN_CERTIFICATES,
  MAX_LOOKUP_TLS_FINDINGS,
  MAX_LOOKUP_TLS_NAME_VALUES,
  TLS_PROFILE_VERSION,
} from './lookup-network-evidence-bounds.mts';
import {
  isJsonObject,
  normalizedDomain,
  validBoundedString,
  validHttpProvenanceUrl,
  validObservationDiagnostics,
  validOptionalNullableText,
  validStringArray,
  validUint,
  type JsonObject,
  type JsonValue,
} from './lookup-contract-primitives.mts';
import { TECHNOLOGY_EVIDENCE_ROLE_ORDER } from './technology-evidence-role.mts';

export const TECHNOLOGY_PROFILE_VERSION = 11;
export const SUPPORTED_TECHNOLOGY_PROFILE_VERSIONS = Object.freeze([10, TECHNOLOGY_PROFILE_VERSION]);
export const MAX_TECHNOLOGY_FINDINGS = 24;
export const MAX_EVIDENCE_PER_TECHNOLOGY = 4;
export const MAX_TECHNOLOGY_EVIDENCE_DESCRIPTION_LENGTH = 180;

export const BROWSER_LIBRARY_PROFILE_VERSION = 2;
export const MAX_LIBRARY_FINDINGS = 16;

export const WEBSITE_SECURITY_POSTURE_VERSION = 2;
export const MAX_SECURITY_POSTURE_FINDINGS = 32;

export const CREDENTIAL_SURFACE_PROFILE_VERSION = 1;

export const STRUCTURED_DATA_IDENTITY_VERSION = 1;
export const MAX_STRUCTURED_DATA_ENTITIES = 16;
export const MAX_STRUCTURED_DATA_SAME_AS_HOSTS = 12;

export const PAGE_ROLE_PROFILE_VERSION = 1;
export const MAX_PAGE_ROLE_FINDINGS = 4;
export const MAX_PAGE_ROLE_EVIDENCE = 4;

export const CLIENT_BEHAVIOR_PROFILE_VERSION = 1;
export const MAX_CLIENT_BEHAVIOR_INDICATORS = 12;

type ChildContractState = 'supported' | 'unsupported' | 'invalid';
type LookupChildProfileEnvelope = JsonObject & { readonly availability: JsonObject };

const OBSERVATION_FIELDS = Object.freeze([
  'version', 'status', 'observedAt', 'scanMode', 'source', 'durationMs',
  'complete', 'truncated', 'limitations', 'diagnostics',
]);
const TECHNOLOGY_CATEGORIES = new Set([
  'application runtime', 'content management', 'commerce', 'site builder',
  'web framework', 'static site generator', 'web server', 'delivery platform',
]);
const TECHNOLOGY_CONFIDENCE = new Set(['high', 'medium']);
const TECHNOLOGY_EVIDENCE_SOURCES = new Set([
  'generator metadata', 'static HTML', 'resource origin', 'HTTP server header',
  'passive response header',
]);
const TECHNOLOGY_EVIDENCE_ROLES = new Set([
  'application_platform', 'embedded_dependency', 'framework_runtime', 'observed_edge',
]);
const TECHNOLOGY_ID_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/u;
const SECURITY_POSTURE_CATEGORIES = new Set([
  'transport', 'response headers', 'forms and resources', 'certificate', 'domain controls',
]);
const STRUCTURED_DATA_TYPES = new Set([
  'Brand', 'Corporation', 'EducationalOrganization', 'GovernmentOrganization',
  'LocalBusiness', 'NewsMediaOrganization', 'NGO', 'OnlineBusiness', 'Organization',
  'PerformingGroup', 'Project', 'SportsOrganization', 'WebPage', 'WebSite',
]);
const PAGE_ROLE_VALUES = new Set([
  'access_challenge', 'authentication', 'commerce', 'support_contact',
  'parked_sale', 'content', 'unknown',
]);
const CLIENT_BEHAVIOR_IDS = new Set([
  'inline_event_handlers', 'client_navigation', 'form_interception',
  'service_worker', 'browser_storage', 'clipboard_access',
  'dynamic_code_evaluation', 'browser_fingerprinting', 'persistent_connection',
]);
const SHA1_RE = /^[a-f0-9]{40}$/u;
const SHA256_RE = /^[a-f0-9]{64}$/u;
const SIMHASH64_RE = /^[a-f0-9]{16}$/u;
const OID_RE = /^\d{1,10}(?:\.\d{1,10}){1,31}$/u;
const CREDENTIAL_METHOD_KEYS = Object.freeze(['missing', 'get', 'post', 'dialog', 'other']);
const CREDENTIAL_ACTION_KEYS = Object.freeze(['sameOrigin', 'external', 'missing', 'cleartext', 'unclassified']);
const CREDENTIAL_CATEGORY_KEYS = Object.freeze(['password', 'email', 'username', 'one_time_code', 'payment']);
const TLS_NAME_KEYS = Object.freeze([
  'commonNames', 'organizations', 'organizationalUnits', 'countries', 'localities', 'states',
]);
const TLS_SAN_CLASS_KEYS = Object.freeze([
  'dns', 'ip', 'email', 'uri', 'directoryName', 'registeredId', 'otherName', 'unclassified',
]);

function hasOnlyKeys(value: JsonObject, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  const allowedKeys = new Set(allowed);
  return keys.length <= allowed.length && keys.every((key) => allowedKeys.has(key));
}

function childVersionState(
  value: unknown,
  field: string,
  supportedVersions: readonly number[],
): ChildContractState {
  if (!isJsonObject(value)) return 'invalid';
  const version = value[field];
  if (Number.isSafeInteger(version) && supportedVersions.includes(Number(version))) return 'supported';
  return Number.isSafeInteger(version) && Number(version) > Math.max(...supportedVersions)
    ? 'unsupported'
    : 'invalid';
}

function validExactStringArray(
  value: unknown,
  maximumItems: number,
  maximumLength: number,
  allowed?: ReadonlySet<string>,
): boolean {
  return Array.isArray(value)
    && value.length <= maximumItems
    && value.every((item) => validBoundedString(item, maximumLength)
      && (!allowed || allowed.has(String(item))))
    && new Set(value).size === value.length;
}

function validProfileObservation(
  value: JsonObject,
  statuses: ReadonlySet<string>,
  sources: ReadonlySet<string>,
): boolean {
  if (value.version !== OBSERVATION_VERSION
    || typeof value.status !== 'string'
    || !statuses.has(value.status)
    || typeof value.source !== 'string'
    || !sources.has(value.source)
    || normalizeExplicitIsoTimestamp(value.observedAt) !== value.observedAt
    || value.scanMode !== 'deep'
    || !(value.durationMs === null
      || Number.isSafeInteger(value.durationMs)
        && Number(value.durationMs) >= 0
        && Number(value.durationMs) <= 120_000)
    || typeof value.complete !== 'boolean'
    || typeof value.truncated !== 'boolean'
    || !validExactStringArray(
      value.limitations,
      MAX_OBSERVATION_LIMITATIONS,
      MAX_OBSERVATION_LIMITATION_LENGTH,
    )
    || !isJsonObject(value.diagnostics)
    || !validObservationDiagnostics(value.diagnostics)) return false;
  if (value.status === 'success' && value.complete !== true) return false;
  if (value.status !== 'success' && value.complete !== false) return false;
  if (value.complete === true && value.truncated === true) return false;
  return true;
}

function hasExactKeys(value: JsonObject, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && hasOnlyKeys(value, expected);
}

function validNullableBoundedString(value: unknown, maximum: number): boolean {
  return value === null || validBoundedString(value, maximum);
}

function validNullableDigest(value: unknown, expression: RegExp): boolean {
  return value === null || typeof value === 'string' && expression.test(value);
}

function validNullableIsoTimestamp(value: unknown): boolean {
  return value === null || typeof value === 'string' && normalizeExplicitIsoTimestamp(value) === value;
}

function validExactUintRecord(value: unknown, keys: readonly string[], maximum: number): boolean {
  return isJsonObject(value)
    && hasExactKeys(value, keys)
    && keys.every((key) => validUint(value[key], maximum));
}

function validHttpOrigin(value: unknown): boolean {
  if (!validBoundedString(value, 2_048)) return false;
  try {
    const parsed = new URL(String(value));
    return ['http:', 'https:'].includes(parsed.protocol)
      && Boolean(parsed.hostname)
      && !parsed.username
      && !parsed.password
      && !parsed.search
      && !parsed.hash
      && parsed.pathname === '/'
      && [parsed.origin, `${parsed.origin}/`].includes(String(value));
  } catch {
    return false;
  }
}

function validHttpOriginArray(value: unknown, maximumItems: number): boolean {
  return Array.isArray(value)
    && value.length <= maximumItems
    && value.every(validHttpOrigin)
    && new Set(value).size === value.length;
}

function validFingerprintIdentifier(value: unknown): boolean {
  return isJsonObject(value)
    && hasExactKeys(value, ['type', 'value'])
    && typeof value.type === 'string'
    && /^[a-z-]{1,40}$/u.test(value.type)
    && typeof value.value === 'string'
    && /^[A-Z0-9-]{1,64}$/u.test(value.value);
}

function validPageFingerprintProfile(value: JsonObject): boolean {
  const normalizedHtml = value.normalizedHtml;
  const visibleText = value.visibleText;
  const domStructure = value.domStructure;
  const domStructureBaseKeys = ['algorithm', 'value', 'nodeCount', 'parser', 'truncated'];
  const formStructure = value.formStructure;
  const resourceHosts = value.resourceHosts;
  const identifiers = value.identifiers;
  if (!isJsonObject(normalizedHtml)
    || !hasExactKeys(normalizedHtml, ['algorithm', 'value', 'tokenCount', 'truncated'])
    || normalizedHtml.algorithm !== 'sha256'
    || typeof normalizedHtml.value !== 'string'
    || !SHA256_RE.test(normalizedHtml.value)
    || !validUint(normalizedHtml.tokenCount, 4_096)
    || typeof normalizedHtml.truncated !== 'boolean'
    || !(visibleText === null || isJsonObject(visibleText)
      && hasExactKeys(visibleText, ['algorithm', 'value', 'tokenCount', 'featureCount', 'truncated'])
      && visibleText.algorithm === 'simhash64-v1'
      && typeof visibleText.value === 'string'
      && SIMHASH64_RE.test(visibleText.value)
      && validUint(visibleText.tokenCount, 8_192)
      && validUint(visibleText.featureCount, 8_192)
      && typeof visibleText.truncated === 'boolean')
    || !isJsonObject(domStructure)
    || !hasOnlyKeys(domStructure, [...domStructureBaseKeys, 'similarity'])
    || !domStructureBaseKeys.every((key) => Object.hasOwn(domStructure, key))
    || domStructure.algorithm !== 'sha256'
    || typeof domStructure.value !== 'string'
    || !SHA256_RE.test(domStructure.value)
    || !validUint(domStructure.nodeCount, 4_096)
    || domStructure.parser !== 'static-tag-sequence-v1'
    || typeof domStructure.truncated !== 'boolean'
    || !(domStructure.similarity === undefined || domStructure.similarity === null || isJsonObject(domStructure.similarity)
      && hasExactKeys(domStructure.similarity, ['algorithm', 'value', 'tokenCount', 'featureCount', 'truncated'])
      && domStructure.similarity.algorithm === 'simhash64-v1'
      && typeof domStructure.similarity.value === 'string'
      && SIMHASH64_RE.test(domStructure.similarity.value)
      && validUint(domStructure.similarity.tokenCount, 4_096)
      && validUint(domStructure.similarity.featureCount, 4_096)
      && typeof domStructure.similarity.truncated === 'boolean')
    || !(formStructure === null || isJsonObject(formStructure)
      && hasExactKeys(formStructure, ['algorithm', 'value', 'formCount', 'controlCount', 'truncated'])
      && formStructure.algorithm === 'sha256'
      && typeof formStructure.value === 'string'
      && SHA256_RE.test(formStructure.value)
      && validUint(formStructure.formCount, 50)
      && validUint(formStructure.controlCount, 500)
      && typeof formStructure.truncated === 'boolean')
    || !isJsonObject(resourceHosts)
    || !hasExactKeys(resourceHosts, ['algorithm', 'value', 'values', 'truncated'])
    || resourceHosts.algorithm !== 'set-sha256'
    || !validNullableDigest(resourceHosts.value, SHA256_RE)
    || !validExactStringArray(resourceHosts.values, 30, 253)
    || typeof resourceHosts.truncated !== 'boolean'
    || !isJsonObject(identifiers)
    || !hasExactKeys(identifiers, ['algorithm', 'value', 'values', 'truncated'])
    || identifiers.algorithm !== 'set-sha256'
    || !validNullableDigest(identifiers.value, SHA256_RE)
    || !Array.isArray(identifiers.values)
    || identifiers.values.length > 30
    || !identifiers.values.every(validFingerprintIdentifier)
    || new Set(identifiers.values.map((item) => JSON.stringify(item))).size !== identifiers.values.length
    || typeof identifiers.truncated !== 'boolean') return false;
  if ((resourceHosts.values as JsonValue[]).length === 0 !== (resourceHosts.value === null)
    || (identifiers.values as JsonValue[]).length === 0 !== (identifiers.value === null)) return false;
  return true;
}

function validCredentialCountRecord(
  value: unknown,
  keys: readonly string[],
  maximum: number,
): value is JsonObject {
  return validExactUintRecord(value, keys, maximum);
}

function validDistinguishedName(value: unknown): boolean {
  return isJsonObject(value)
    && hasExactKeys(value, TLS_NAME_KEYS)
    && TLS_NAME_KEYS.every((key) => validExactStringArray(value[key], MAX_LOOKUP_TLS_NAME_VALUES, 256));
}

function validTlsAltNames(value: unknown): boolean {
  return isJsonObject(value)
    && hasExactKeys(value, ['dnsNames', 'ipAddresses', 'classes', 'truncated'])
    && validExactStringArray(value.dnsNames, MAX_LOOKUP_TLS_ALT_NAMES, 253)
    && validExactStringArray(value.ipAddresses, MAX_LOOKUP_TLS_ALT_NAMES, 64)
    && (value.dnsNames as JsonValue[]).length + (value.ipAddresses as JsonValue[]).length <= MAX_LOOKUP_TLS_ALT_NAMES
    && validExactUintRecord(value.classes, TLS_SAN_CLASS_KEYS, 100)
    && typeof value.truncated === 'boolean';
}

function validTlsPublicKey(value: unknown): boolean {
  if (!isJsonObject(value) || !hasExactKeys(value, ['type', 'bits', 'curve', 'fingerprintSha256'])) return false;
  return validNullableBoundedString(value.type, 32)
    && (value.bits === null || validUint(value.bits, 32_768) && Number(value.bits) > 0)
    && validNullableBoundedString(value.curve, 64)
    && validNullableDigest(value.fingerprintSha256, SHA256_RE);
}

function validTlsSignature(value: unknown): boolean {
  return isJsonObject(value)
    && hasExactKeys(value, ['algorithm', 'oid'])
    && validNullableBoundedString(value.algorithm, 128)
    && (value.oid === null || typeof value.oid === 'string' && OID_RE.test(value.oid));
}

function validTlsPurposes(value: unknown): boolean {
  return isJsonObject(value)
    && hasExactKeys(value, ['values', 'truncated'])
    && Array.isArray(value.values)
    && value.values.length <= 16
    && value.values.every((item) => isJsonObject(item)
      && hasExactKeys(item, ['oid', 'name'])
      && typeof item.oid === 'string'
      && OID_RE.test(item.oid)
      && validBoundedString(item.name, 128))
    && typeof value.truncated === 'boolean';
}

function validAiaSummary(value: unknown): boolean {
  return isJsonObject(value)
    && hasExactKeys(value, ['total', 'http', 'https', 'other'])
    && ['total', 'http', 'https', 'other'].every((key) => validUint(value[key], 32))
    && value.total === Number(value.http) + Number(value.https) + Number(value.other);
}

function validTlsAuthorityInformationAccess(value: unknown): boolean {
  return isJsonObject(value)
    && hasExactKeys(value, ['ocsp', 'caIssuers', 'unknownMethods', 'truncated'])
    && validAiaSummary(value.ocsp)
    && validAiaSummary(value.caIssuers)
    && validUint(value.unknownMethods, 32)
    && Number((value.ocsp as JsonObject).total)
      + Number((value.caIssuers as JsonObject).total)
      + Number(value.unknownMethods) <= 32
    && typeof value.truncated === 'boolean';
}

function validTlsExtensionProfile(value: unknown): boolean {
  if (!isJsonObject(value)
    || !hasExactKeys(value, ['certificatePolicies', 'crlDistributionPoints', 'parsed', 'partial'])
    || !isJsonObject(value.certificatePolicies)
    || !hasExactKeys(value.certificatePolicies, ['oids', 'truncated'])
    || !validExactStringArray(value.certificatePolicies.oids, MAX_LOOKUP_TLS_CERTIFICATE_POLICIES, 128)
    || !(value.certificatePolicies.oids as JsonValue[]).every((oid) => typeof oid === 'string' && OID_RE.test(oid))
    || typeof value.certificatePolicies.truncated !== 'boolean'
    || !isJsonObject(value.crlDistributionPoints)
    || !hasExactKeys(value.crlDistributionPoints, ['total', 'http', 'https', 'ldap', 'other', 'truncated'])
    || !['total', 'http', 'https', 'ldap', 'other'].every((key) => validUint((value.crlDistributionPoints as JsonObject)[key], 32))
    || value.crlDistributionPoints.total !== ['http', 'https', 'ldap', 'other']
      .reduce((sum, key) => sum + Number((value.crlDistributionPoints as JsonObject)[key]), 0)
    || typeof value.crlDistributionPoints.truncated !== 'boolean'
    || typeof value.parsed !== 'boolean'
    || typeof value.partial !== 'boolean') return false;
  return true;
}

function validTlsCertificate(value: unknown, leaf: boolean): boolean {
  if (!isJsonObject(value)) return false;
  const baseKeys = [
    'subject', 'issuer', 'serialNumber', 'validFrom', 'validTo', 'fingerprintSha1',
    'fingerprintSha256', 'isCertificateAuthority',
  ];
  const leafKeys = [
    'subjectAltNames', 'publicKey', 'signature', 'extendedKeyUsage',
    'authorityInformationAccess', 'extensionProfile',
  ];
  if (!hasOnlyKeys(value, leaf ? [...baseKeys, ...leafKeys] : baseKeys)
    || !baseKeys.every((key) => Object.hasOwn(value, key))
    || !validDistinguishedName(value.subject)
    || !validDistinguishedName(value.issuer)
    || !(value.serialNumber === null || typeof value.serialNumber === 'string'
      && /^[a-f0-9]{1,128}$/u.test(value.serialNumber))
    || !validNullableIsoTimestamp(value.validFrom)
    || !validNullableIsoTimestamp(value.validTo)
    || !validNullableDigest(value.fingerprintSha1, SHA1_RE)
    || !validNullableDigest(value.fingerprintSha256, SHA256_RE)
    || !(value.isCertificateAuthority === null || typeof value.isCertificateAuthority === 'boolean')) return false;
  if (!leaf) return hasExactKeys(value, baseKeys);
  return (value.subjectAltNames === undefined || validTlsAltNames(value.subjectAltNames))
    && (value.publicKey === undefined || validTlsPublicKey(value.publicKey))
    && (value.signature === undefined || validTlsSignature(value.signature))
    && (value.extendedKeyUsage === undefined || validTlsPurposes(value.extendedKeyUsage))
    && (value.authorityInformationAccess === undefined
      || validTlsAuthorityInformationAccess(value.authorityInformationAccess))
    && (value.extensionProfile === undefined || validTlsExtensionProfile(value.extensionProfile));
}

function validTlsCipher(value: unknown): boolean {
  return isJsonObject(value)
    && hasExactKeys(value, ['name', 'standardName', 'version'])
    && validNullableBoundedString(value.name, 128)
    && validNullableBoundedString(value.standardName, 128)
    && validNullableBoundedString(value.version, 32)
    && [value.name, value.standardName, value.version].some((item) => item !== null);
}

function validTlsEphemeralKey(value: unknown): boolean {
  return isJsonObject(value)
    && hasExactKeys(value, ['type', 'name', 'size'])
    && validNullableBoundedString(value.type, 32)
    && validNullableBoundedString(value.name, 64)
    && (value.size === null || validUint(value.size, 32_768) && Number(value.size) > 0)
    && [value.type, value.name, value.size].some((item) => item !== null);
}

function validTlsFinding(value: unknown): boolean {
  return isJsonObject(value)
    && hasExactKeys(value, ['id', 'tone', 'label', 'detail'])
    && typeof value.id === 'string'
    && /^[a-z0-9_]{1,80}$/u.test(value.id)
    && typeof value.tone === 'string'
    && ['warning', 'neutral'].includes(value.tone)
    && validBoundedString(value.label, 160)
    && validBoundedString(value.detail, 500);
}

function validTlsChainCertificate(value: unknown): boolean {
  return validTlsCertificate(value, false);
}

function validSecurityPostureFinding(value: unknown): boolean {
  return isJsonObject(value)
    && hasExactKeys(value, ['id', 'category', 'state', 'tone', 'label', 'detail', 'evidence'])
    && typeof value.id === 'string'
    && /^[a-z0-9_]{1,80}$/u.test(value.id)
    && typeof value.category === 'string'
    && SECURITY_POSTURE_CATEGORIES.has(value.category)
    && typeof value.state === 'string'
    && ['observed', 'potential_exposure', 'observed_absence', 'unavailable'].includes(value.state)
    && typeof value.tone === 'string'
    && ['configured', 'review', 'neutral'].includes(value.tone)
    && validBoundedString(value.label, 160)
    && validBoundedString(value.detail, 300)
    && validStringArray(value.evidence, 4, 120);
}

function technologyProfileContractState(value: unknown): ChildContractState {
  const versionState = childVersionState(value, 'profileVersion', SUPPORTED_TECHNOLOGY_PROFILE_VERSIONS);
  if (versionState !== 'supported') return versionState;
  const profile = value as JsonObject;
  const profileVersion = Number(profile.profileVersion);
  if (!hasOnlyKeys(profile, [...OBSERVATION_FIELDS, 'profileVersion', 'findings', 'browserLibraryProfile'])
    || !validProfileObservation(profile, new Set(['success', 'partial']), new Set(['derived']))
    || !Array.isArray(profile.findings)
    || profile.findings.length > MAX_TECHNOLOGY_FINDINGS
    || !(profile.browserLibraryProfile === null || isJsonObject(profile.browserLibraryProfile))) return 'invalid';
  const findingIds = new Set<string>();
  for (const candidate of profile.findings) {
    if (!isJsonObject(candidate)
      || !hasOnlyKeys(candidate, profileVersion >= 11
        ? ['id', 'name', 'category', 'confidence', 'roles', 'evidence']
        : ['id', 'name', 'category', 'confidence', 'evidence'])
      || typeof candidate.id !== 'string'
      || !TECHNOLOGY_ID_RE.test(candidate.id)
      || !validBoundedString(candidate.name, 120)
      || typeof candidate.category !== 'string'
      || !TECHNOLOGY_CATEGORIES.has(candidate.category)
      || typeof candidate.confidence !== 'string'
      || !TECHNOLOGY_CONFIDENCE.has(candidate.confidence)
      || !Array.isArray(candidate.evidence)
      || candidate.evidence.length < 1
      || candidate.evidence.length > MAX_EVIDENCE_PER_TECHNOLOGY) return 'invalid';
    if (findingIds.has(candidate.id as string)) return 'invalid';
    findingIds.add(candidate.id as string);
    if (profileVersion >= 11 && !validExactStringArray(candidate.roles, 4, 40, TECHNOLOGY_EVIDENCE_ROLES)) return 'invalid';
    for (const evidence of candidate.evidence) {
      if (!isJsonObject(evidence)
        || !hasOnlyKeys(evidence, profileVersion >= 11 ? ['source', 'role', 'description'] : ['source', 'description'])
        || typeof evidence.source !== 'string'
        || !TECHNOLOGY_EVIDENCE_SOURCES.has(evidence.source)
        || !validBoundedString(evidence.description, MAX_TECHNOLOGY_EVIDENCE_DESCRIPTION_LENGTH)
        || profileVersion >= 11 && (typeof evidence.role !== 'string'
          || !TECHNOLOGY_EVIDENCE_ROLES.has(evidence.role))) return 'invalid';
    }
    if (profileVersion >= 11) {
      const observedRoles = new Set((candidate.evidence as JsonObject[]).map((evidence) => String(evidence.role)));
      const expectedRoles = TECHNOLOGY_EVIDENCE_ROLE_ORDER.filter((role) => observedRoles.has(role));
      if (JSON.stringify(candidate.roles) !== JSON.stringify(expectedRoles)) return 'invalid';
    }
  }
  return 'supported';
}

function browserLibraryProfileContractState(value: unknown): ChildContractState {
  const versionState = childVersionState(value, 'profileVersion', [BROWSER_LIBRARY_PROFILE_VERSION]);
  if (versionState !== 'supported') return versionState;
  const profile = value as JsonObject;
  const catalog = profile.catalog;
  const knownExploitedCatalog = profile.knownExploitedCatalog;
  if (!hasOnlyKeys(profile, [...OBSERVATION_FIELDS, 'profileVersion', 'catalog', 'knownExploitedCatalog', 'findings'])
    || !validProfileObservation(profile, new Set(['success', 'partial']), new Set(['derived']))
    || !isJsonObject(catalog)
    || !hasOnlyKeys(catalog, ['name', 'version', 'sourceRevision'])
    || !['name', 'version', 'sourceRevision'].every((field) => validBoundedString(catalog[field], 160))
    || !isJsonObject(knownExploitedCatalog)
    || !hasOnlyKeys(knownExploitedCatalog, ['name', 'version', 'releasedAt'])
    || !['name', 'version', 'releasedAt'].every((field) => validBoundedString(knownExploitedCatalog[field], 160))
    || normalizeExplicitIsoTimestamp(knownExploitedCatalog.releasedAt) !== knownExploitedCatalog.releasedAt
    || !Array.isArray(profile.findings)
    || profile.findings.length > MAX_LIBRARY_FINDINGS) return 'invalid';
  const methods = new Set(['script URL', 'script filename', 'inline signature', 'inline hash']);
  const severities = new Set(['none', 'low', 'medium', 'high', 'critical']);
  const findingIds = new Set<string>();
  for (const candidate of profile.findings) {
    if (!isJsonObject(candidate)
      || !hasOnlyKeys(candidate, [
        'id', 'name', 'apparentVersion', 'detectionMethods', 'advisoryCount',
        'highestSeverity', 'advisoryIdentifiers', 'knownExploitedCount',
        'knownExploitedIdentifiers', 'weaknessClasses',
      ])
      || typeof candidate.id !== 'string'
      || !/^[a-z0-9._-]{1,80}$/iu.test(candidate.id)
      || !validBoundedString(candidate.name, 120)
      || !/^[0-9][0-9.a-z_-]{0,63}$/iu.test(String(candidate.apparentVersion))
      || !validExactStringArray(candidate.detectionMethods, 4, 40, methods)
      || !validUint(candidate.advisoryCount, 10_000)
      || !(candidate.highestSeverity === null
        || typeof candidate.highestSeverity === 'string' && severities.has(candidate.highestSeverity))
      || !validExactStringArray(candidate.advisoryIdentifiers, 16, 80)
      || !validUint(candidate.knownExploitedCount, 10_000)
      || !validExactStringArray(candidate.knownExploitedIdentifiers, 16, 80)
      || !validExactStringArray(candidate.weaknessClasses, 12, 80)) return 'invalid';
    if (findingIds.has(candidate.id as string)
      || !(candidate.advisoryIdentifiers as JsonValue[]).every((identifier) => typeof identifier === 'string'
        && /^(?:CVE-[0-9X-]+|GHSA-[A-Z0-9-]+)$/u.test(identifier))
      || !(candidate.knownExploitedIdentifiers as JsonValue[]).every((identifier) => typeof identifier === 'string'
        && /^CVE-[0-9X-]+$/u.test(identifier))
      || !(candidate.weaknessClasses as JsonValue[]).every((identifier) => typeof identifier === 'string'
        && /^CWE-[0-9]+$/u.test(identifier))
      || Number(candidate.advisoryCount) < (candidate.advisoryIdentifiers as JsonValue[]).length
      || Number(candidate.knownExploitedCount) < (candidate.knownExploitedIdentifiers as JsonValue[]).length) return 'invalid';
    findingIds.add(candidate.id as string);
  }
  return 'supported';
}

function pageFingerprintContractState(value: unknown): ChildContractState {
  const versionState = childVersionState(value, 'fingerprintVersion', [PAGE_FINGERPRINT_VERSION]);
  if (versionState !== 'supported') return versionState;
  const profile = value as JsonObject;
  if (!hasExactKeys(profile, [
    'fingerprintVersion', 'exact', 'normalizedHtml', 'visibleText', 'domStructure',
    'formStructure', 'resourceHosts', 'identifiers', 'complete', 'truncated', 'limitations',
  ])
    || typeof profile.complete !== 'boolean'
    || typeof profile.truncated !== 'boolean'
    || !validExactStringArray(profile.limitations, MAX_OBSERVATION_LIMITATIONS, MAX_OBSERVATION_LIMITATION_LENGTH)
    || !isJsonObject(profile.exact)
    || !hasExactKeys(profile.exact, ['algorithm', 'value', 'scope', 'bytes', 'source'])
    || profile.exact.algorithm !== 'sha256'
    || typeof profile.exact.value !== 'string'
    || !SHA256_RE.test(profile.exact.value)
    || !['complete-body', 'captured-prefix'].includes(String(profile.exact.scope))
    || !validUint(profile.exact.bytes, 300_000)
    || !['captured-response-bytes', 'decoded-markup'].includes(String(profile.exact.source))
    || !validPageFingerprintProfile(profile)
    || profile.complete !== (profile.truncated !== true)) return 'invalid';
  return 'supported';
}

function validIdentityUrl(value: unknown): boolean {
  return isJsonObject(value)
    && hasOnlyKeys(value, ['url', 'queryOmitted', 'pathTruncated'])
    && validHttpProvenanceUrl(value.url)
    && typeof value.queryOmitted === 'boolean'
    && typeof value.pathTruncated === 'boolean';
}

function validNullableIdentityUrl(value: unknown): boolean {
  return value === null || validIdentityUrl(value);
}

function pageIdentityContractState(value: unknown): ChildContractState {
  const versionState = childVersionState(value, 'identityVersion', [PAGE_IDENTITY_VERSION]);
  if (versionState !== 'supported') return versionState;
  const profile = value as JsonObject;
  if (!hasOnlyKeys(profile, [
    ...OBSERVATION_FIELDS, 'identityVersion', 'documentLanguage', 'canonical',
    'metaRefresh', 'openGraph', 'generator', 'forms', 'resources',
    'embeddedOrigins', 'contactDomains', 'downloads', 'trackingIdentifiers',
    'fingerprints', 'publicationMetadata',
  ])
    || !validProfileObservation(profile, new Set(['success', 'partial']), new Set(['html']))
    || !(profile.documentLanguage === null || validBoundedString(profile.documentLanguage, 80))
    || !(profile.generator === null || validBoundedString(profile.generator, 120))
    || !validNullableIdentityUrl(profile.canonical)
    || !validNullableIdentityUrl(profile.metaRefresh)
    || !isJsonObject(profile.openGraph)
    || !hasOnlyKeys(profile.openGraph, ['title', 'siteName', 'url'])
    || !validOptionalNullableText(profile.openGraph.title, 200)
    || !validOptionalNullableText(profile.openGraph.siteName, 200)
    || !validNullableIdentityUrl(profile.openGraph.url)
    || !isJsonObject(profile.forms)
    || !hasOnlyKeys(profile.forms, ['count', 'postCount', 'insecureActionCount', 'externalActionOrigins', 'truncated'])
    || !validUint(profile.forms.count, 50)
    || !validUint(profile.forms.postCount, 50)
    || !validUint(profile.forms.insecureActionCount, 50)
    || Number(profile.forms.postCount) > Number(profile.forms.count)
    || Number(profile.forms.insecureActionCount) > Number(profile.forms.count)
    || !validHttpOriginArray(profile.forms.externalActionOrigins, 10)
    || typeof profile.forms.truncated !== 'boolean'
    || !isJsonObject(profile.resources)
    || !hasOnlyKeys(profile.resources, ['count', 'byType', 'externalOrigins', 'truncated'])
    || !validUint(profile.resources.count, 1_024)
    || !isJsonObject(profile.resources.byType)
    || !hasOnlyKeys(profile.resources.byType, ['image', 'script', 'stylesheet', 'link', 'frame', 'media', 'object'])
    || !Object.values(profile.resources.byType).every((count) => validUint(count, 1_024))
    || Object.values(profile.resources.byType).reduce<number>((sum, count) => sum + Number(count), 0) !== profile.resources.count
    || !validHttpOriginArray(profile.resources.externalOrigins, 30)
    || typeof profile.resources.truncated !== 'boolean'
    || !isJsonObject(profile.downloads)
    || !hasOnlyKeys(profile.downloads, ['count', 'explicitCount', 'riskyCount', 'externalOrigins', 'riskyFileTypes', 'truncated'])
    || !validUint(profile.downloads.count, 1_024)
    || !validUint(profile.downloads.explicitCount, 1_024)
    || !validUint(profile.downloads.riskyCount, 1_024)
    || Number(profile.downloads.explicitCount) > Number(profile.downloads.count)
    || Number(profile.downloads.riskyCount) > Number(profile.downloads.count)
    || !validHttpOriginArray(profile.downloads.externalOrigins, 20)
    || !validExactStringArray(profile.downloads.riskyFileTypes, 20, 80)
    || typeof profile.downloads.truncated !== 'boolean'
    || !validHttpOriginArray(profile.embeddedOrigins, 20)
    || !validExactStringArray(profile.contactDomains, 20, 253)
    || !(profile.contactDomains as JsonValue[]).every((domain) => typeof domain === 'string'
      && normalizedDomain(domain) === domain)
    || !Array.isArray(profile.trackingIdentifiers)
    || profile.trackingIdentifiers.length > 30
    || !profile.trackingIdentifiers.every(validFingerprintIdentifier)
    || new Set(profile.trackingIdentifiers.map((item) => JSON.stringify(item))).size !== profile.trackingIdentifiers.length
    || !isJsonObject(profile.fingerprints)
    || profile.publicationMetadata !== undefined
      && !validPagePublicationMetadata(profile.publicationMetadata)) return 'invalid';
  return 'supported';
}

function tlsProfileContractState(value: unknown): ChildContractState {
  const versionState = childVersionState(value, 'profileVersion', [TLS_PROFILE_VERSION]);
  if (versionState !== 'supported') return versionState;
  const profile = value as JsonObject;
  if (!hasExactKeys(profile, [
    ...OBSERVATION_FIELDS, 'profileVersion', 'connectedAddress', 'connectedFamily',
    'port', 'sniHost', 'protocol', 'alpnProtocol', 'cipher', 'ephemeralKey',
    'authorization', 'hostname', 'validity', 'certificate', 'chain',
    'chainTruncated', 'findings',
  ])
    || !validProfileObservation(profile, new Set(['success', 'partial', 'error', 'skipped']), new Set(['tls']))
    || !(profile.connectedAddress === null || typeof profile.connectedAddress === 'string'
      && /^[0-9a-f:.]{2,64}$/iu.test(profile.connectedAddress))
    || !(profile.connectedFamily === null || typeof profile.connectedFamily === 'number'
      && [4, 6].includes(profile.connectedFamily))
    || (profile.connectedAddress === null) !== (profile.connectedFamily === null)
    || profile.port !== 443
    || !(profile.sniHost === null || typeof profile.sniHost === 'string'
      && normalizedDomain(profile.sniHost) === profile.sniHost)
    || !(profile.protocol === null || validBoundedString(profile.protocol, 32))
    || !(profile.alpnProtocol === null || validBoundedString(profile.alpnProtocol, 32))
    || !(profile.cipher === null || validTlsCipher(profile.cipher))
    || !(profile.ephemeralKey === null || validTlsEphemeralKey(profile.ephemeralKey))
    || !isJsonObject(profile.authorization)
    || !hasOnlyKeys(profile.authorization, ['authorized', 'error'])
    || !(profile.authorization.authorized === null || typeof profile.authorization.authorized === 'boolean')
    || !validOptionalNullableText(profile.authorization.error, 240)
    || !isJsonObject(profile.hostname)
    || !hasOnlyKeys(profile.hostname, ['matches', 'error'])
    || !(profile.hostname.matches === null || typeof profile.hostname.matches === 'boolean')
    || !validOptionalNullableText(profile.hostname.error, 240)
    || !isJsonObject(profile.validity)
    || !hasOnlyKeys(profile.validity, ['status'])
    || !['valid', 'expired', 'not_yet_valid', 'unknown'].includes(String(profile.validity.status))
    || !(profile.certificate === null || validTlsCertificate(profile.certificate, true))
    || !Array.isArray(profile.chain)
    || profile.chain.length > MAX_LOOKUP_TLS_CHAIN_CERTIFICATES
    || !profile.chain.every((certificate) => validTlsCertificate(certificate, false))
    || typeof profile.chainTruncated !== 'boolean'
    || !Array.isArray(profile.findings)
    || profile.findings.length > MAX_LOOKUP_TLS_FINDINGS
    || !profile.findings.every(validTlsFinding)) return 'invalid';
  return 'supported';
}

function securityPostureContractState(value: unknown): ChildContractState {
  const versionState = childVersionState(value, 'postureVersion', [WEBSITE_SECURITY_POSTURE_VERSION]);
  if (versionState !== 'supported') return versionState;
  const profile = value as JsonObject;
  if (!hasOnlyKeys(profile, [...OBSERVATION_FIELDS, 'postureVersion', 'summary', 'findings'])
    || !validProfileObservation(profile, new Set(['success', 'partial']), new Set(['derived']))
    || !isJsonObject(profile.summary)
    || !hasOnlyKeys(profile.summary, ['observed', 'potentialExposure', 'observedAbsence', 'unavailable'])
    || !Object.values(profile.summary).every((count) => validUint(count, MAX_SECURITY_POSTURE_FINDINGS))
    || !Array.isArray(profile.findings)
    || profile.findings.length > MAX_SECURITY_POSTURE_FINDINGS
    || !profile.findings.every(validSecurityPostureFinding)
    || new Set(profile.findings.map((finding) => (finding as JsonObject).id)).size !== profile.findings.length
    || ['observed', 'potentialExposure', 'observedAbsence', 'unavailable']
      .reduce((sum, key) => sum + Number((profile.summary as JsonObject)[key]), 0) !== profile.findings.length
    || Number((profile.summary as JsonObject).observed) !== profile.findings
      .filter((finding) => (finding as JsonObject).state === 'observed').length
    || Number((profile.summary as JsonObject).potentialExposure) !== profile.findings
      .filter((finding) => (finding as JsonObject).state === 'potential_exposure').length
    || Number((profile.summary as JsonObject).observedAbsence) !== profile.findings
      .filter((finding) => (finding as JsonObject).state === 'observed_absence').length
    || Number((profile.summary as JsonObject).unavailable) !== profile.findings
      .filter((finding) => (finding as JsonObject).state === 'unavailable').length) return 'invalid';
  return 'supported';
}

function credentialSurfaceContractState(value: unknown): ChildContractState {
  const versionState = childVersionState(value, 'credentialSurfaceVersion', [CREDENTIAL_SURFACE_PROFILE_VERSION]);
  if (versionState !== 'supported') return versionState;
  const profile = value as JsonObject;
  const forms = profile.forms;
  const inputs = profile.inputs;
  if (!hasExactKeys(profile, [...OBSERVATION_FIELDS, 'credentialSurfaceVersion', 'forms', 'inputs'])
    || !validProfileObservation(profile, new Set(['success', 'partial']), new Set(['html']))
    || !isJsonObject(forms)
    || !hasExactKeys(forms, ['count', 'methods', 'actions'])
    || !validUint(forms.count, 50)
    || !validCredentialCountRecord(forms.methods, CREDENTIAL_METHOD_KEYS, 50)
    || !validCredentialCountRecord(forms.actions, CREDENTIAL_ACTION_KEYS, 50)
    || CREDENTIAL_METHOD_KEYS.reduce((sum, key) => sum + Number((forms.methods as JsonObject)[key]), 0) !== forms.count
    || CREDENTIAL_ACTION_KEYS.reduce((sum, key) => sum + Number((forms.actions as JsonObject)[key]), 0) !== forms.count
    || !isJsonObject(inputs)
    || !hasExactKeys(inputs, ['count', 'classifiedCount', 'categories'])
    || !validUint(inputs.count, 500)
    || !validUint(inputs.classifiedCount, 500)
    || Number(inputs.classifiedCount) > Number(inputs.count)
    || !validCredentialCountRecord(inputs.categories, CREDENTIAL_CATEGORY_KEYS, 500)) return 'invalid';
  return 'supported';
}

function structuredDataContractState(value: unknown): ChildContractState {
  const versionState = childVersionState(value, 'structuredDataVersion', [STRUCTURED_DATA_IDENTITY_VERSION]);
  if (versionState !== 'supported') return versionState;
  const profile = value as JsonObject;
  if (!hasOnlyKeys(profile, [...OBSERVATION_FIELDS, 'structuredDataVersion', 'entities'])
    || !validProfileObservation(profile, new Set(['success', 'partial']), new Set(['html']))
    || !Array.isArray(profile.entities)
    || profile.entities.length > MAX_STRUCTURED_DATA_ENTITIES) return 'invalid';
  return profile.entities.every((entity) => isJsonObject(entity)
    && hasOnlyKeys(entity, ['types', 'name', 'declaredOrigin', 'sameAsHosts'])
    && validExactStringArray(entity.types, 8, 160, STRUCTURED_DATA_TYPES)
    && (entity.name === null || validBoundedString(entity.name, 160))
    && (entity.declaredOrigin === null || validHttpOrigin(entity.declaredOrigin))
    && validExactStringArray(entity.sameAsHosts, MAX_STRUCTURED_DATA_SAME_AS_HOSTS, 253)
    && (entity.sameAsHosts as JsonValue[]).every((host) => typeof host === 'string'
      && normalizedDomain(host) === host))
    ? 'supported'
    : 'invalid';
}

function pageRoleContractState(value: unknown): ChildContractState {
  const versionState = childVersionState(value, 'pageRoleProfileVersion', [PAGE_ROLE_PROFILE_VERSION]);
  if (versionState !== 'supported') return versionState;
  const profile = value as JsonObject;
  if (!hasOnlyKeys(profile, [...OBSERVATION_FIELDS, 'pageRoleProfileVersion', 'primaryRole', 'findings'])
    || !validProfileObservation(profile, new Set(['success', 'partial']), new Set(['derived']))
    || typeof profile.primaryRole !== 'string'
    || !PAGE_ROLE_VALUES.has(profile.primaryRole)
    || !Array.isArray(profile.findings)
    || profile.findings.length < 1
    || profile.findings.length > MAX_PAGE_ROLE_FINDINGS) return 'invalid';
  if (!profile.findings.every((finding) => isJsonObject(finding)
    && hasOnlyKeys(finding, ['role', 'label', 'confidence', 'evidence'])
    && typeof finding.role === 'string'
    && PAGE_ROLE_VALUES.has(finding.role)
    && validBoundedString(finding.label, 120)
    && ['high', 'medium', 'low'].includes(String(finding.confidence))
    && validExactStringArray(finding.evidence, MAX_PAGE_ROLE_EVIDENCE, 300))) return 'invalid';
  if ((profile.findings[0] as JsonObject).role !== profile.primaryRole
    || new Set(profile.findings.map((finding) => (finding as JsonObject).role)).size !== profile.findings.length) {
    return 'invalid';
  }
  return 'supported';
}

function clientBehaviorContractState(value: unknown): ChildContractState {
  const versionState = childVersionState(value, 'clientBehaviorProfileVersion', [CLIENT_BEHAVIOR_PROFILE_VERSION]);
  if (versionState !== 'supported') return versionState;
  const profile = value as JsonObject;
  if (!hasOnlyKeys(profile, [...OBSERVATION_FIELDS, 'clientBehaviorProfileVersion', 'scriptSummary', 'indicators'])
    || !validProfileObservation(profile, new Set(['success', 'partial']), new Set(['derived']))
    || !isJsonObject(profile.scriptSummary)
    || !hasOnlyKeys(profile.scriptSummary, ['elementsObserved', 'referencedScripts', 'inlineScripts', 'moduleScripts'])
    || !Object.values(profile.scriptSummary).every((count) => validUint(count, 10_000))
    || !Array.isArray(profile.indicators)
    || profile.indicators.length > MAX_CLIENT_BEHAVIOR_INDICATORS) return 'invalid';
  if (!profile.indicators.every((indicator) => isJsonObject(indicator)
    && hasOnlyKeys(indicator, ['id', 'label', 'evidenceClass', 'occurrences', 'explanation'])
    && typeof indicator.id === 'string'
    && CLIENT_BEHAVIOR_IDS.has(indicator.id)
    && validBoundedString(indicator.label, 120)
    && ['static_markup', 'inline_script'].includes(String(indicator.evidenceClass))
    && validUint(indicator.occurrences, 999)
    && Number(indicator.occurrences) > 0
    && validBoundedString(indicator.explanation, 300))) return 'invalid';
  const summary = profile.scriptSummary as JsonObject;
  if (Number(summary.referencedScripts) + Number(summary.inlineScripts) !== summary.elementsObserved
    || Number(summary.moduleScripts) > Number(summary.elementsObserved)
    || new Set(profile.indicators.map((indicator) => (indicator as JsonObject).id)).size !== profile.indicators.length) {
    return 'invalid';
  }
  return 'supported';
}

function profilePlaceholder(label: string, source: string, state: Exclude<ChildContractState, 'supported'>): JsonObject {
  return {
    status: state === 'unsupported' ? 'unsupported' : 'error',
    source,
    complete: false,
    truncated: false,
    compatibility: state === 'unsupported' ? 'unsupported_version' : 'malformed',
    limitations: [state === 'unsupported'
      ? `${label} uses a newer unsupported version; its evidence was withheld.`
      : `${label} was malformed; its evidence was withheld.`],
  };
}

function sanitizeLookupChildProfiles<T extends LookupChildProfileEnvelope>(value: T): T {
  let output = value;
  let availability = value.availability;
  const mutableAvailability = (): Record<string, JsonValue> => {
    if (output === value) {
      availability = { ...value.availability };
      output = { ...value, availability } as T;
    }
    return availability as Record<string, JsonValue>;
  };
  const replaceChild = (
    key: string,
    label: string,
    source: string,
    contract: (child: unknown) => ChildContractState,
  ) => {
    const child = availability[key];
    if (child === undefined || child === null) return;
    const state = contract(child);
    if (state !== 'supported') mutableAvailability()[key] = profilePlaceholder(label, source, state);
  };

  replaceChild('tls', 'TLS profile', 'tls', tlsProfileContractState);
  replaceChild('securityPosture', 'Security-posture profile', 'derived', securityPostureContractState);
  replaceChild('credentialSurfaceProfile', 'Credential-surface profile', 'html', credentialSurfaceContractState);
  replaceChild('structuredDataIdentity', 'Structured-data identity profile', 'html', structuredDataContractState);
  replaceChild('pageRoleProfile', 'Page-role profile', 'derived', pageRoleContractState);
  replaceChild('clientBehaviorProfile', 'Client-behaviour profile', 'derived', clientBehaviorContractState);

  const page = availability.pageIdentity;
  if (page !== undefined && page !== null) {
    const pageState = pageIdentityContractState(page);
    if (pageState !== 'supported') {
      mutableAvailability().pageIdentity = profilePlaceholder('Page-identity profile', 'html', pageState);
    } else if (isJsonObject(page) && page.fingerprints !== undefined && page.fingerprints !== null) {
      const fingerprintState = pageFingerprintContractState(page.fingerprints);
      if (fingerprintState !== 'supported') {
        const replacedPage = { ...page, fingerprints: profilePlaceholder('Page-fingerprint profile', 'derived', fingerprintState) };
        mutableAvailability().pageIdentity = replacedPage;
      }
    }
  }

  const technology = availability.technologyProfile;
  if (technology !== undefined && technology !== null) {
    const technologyState = technologyProfileContractState(technology);
    if (technologyState !== 'supported') {
      mutableAvailability().technologyProfile = {
        ...profilePlaceholder('Technology profile', 'derived', technologyState),
        findings: [],
        browserLibraryProfile: null,
      };
    } else if (isJsonObject(technology)
      && technology.browserLibraryProfile !== undefined
      && technology.browserLibraryProfile !== null) {
      const libraryState = browserLibraryProfileContractState(technology.browserLibraryProfile);
      if (libraryState !== 'supported') {
        const replacedTechnology = {
          ...technology,
          browserLibraryProfile: {
            ...profilePlaceholder('Browser-library profile', 'derived', libraryState),
            findings: [],
          },
        };
        mutableAvailability().technologyProfile = replacedTechnology;
      }
    }
  }
  return output;
}

export {
  sanitizeLookupChildProfiles,
  validSecurityPostureFinding,
  validTlsChainCertificate,
  validTlsFinding,
};

export type { ChildContractState };
