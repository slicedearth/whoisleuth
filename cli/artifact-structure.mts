import {
  ACQUISITION_DECISIONS,
  ACQUISITION_MANUAL_CHECKS,
  ACQUISITION_DECISION_PACKET_SCHEMA,
  ACQUISITION_DECISION_PACKET_VERSION,
} from '../frontend/src/lib/analysis/acquisition-decision-packet.ts';
import {
  BULK_DOMAIN_COMPARISON_EXPORT_VERSION,
  BULK_DOMAIN_COMPARISON_SCHEMA,
} from '../frontend/src/lib/analysis/bulk-domain-comparison.ts';
import {
  BULK_MAIL_EXPOSURE_EXPORT_VERSION,
  BULK_MAIL_EXPOSURE_SCHEMA,
  MAX_BULK_MAIL_EXPOSURE_ROWS,
} from '../frontend/src/lib/analysis/bulk-mail-exposure.ts';
import {
  BULK_REVIEW_MANIFEST_SCHEMA,
  BULK_REVIEW_MANIFEST_VERSION,
} from '../frontend/src/lib/analysis/bulk-review-export.ts';
import {
  CASE_RESPONSE_PACKET_SCHEMA,
  CASE_RESPONSE_PACKET_VERSION,
  LEGACY_CASE_RESPONSE_PACKET_VERSION,
  MAX_ABUSIVE_URLS,
  MAX_RESPONSE_ACTION_HISTORY,
  MAX_RESPONSE_CONTACTS,
  RESPONSE_PACKET_PROFILES,
  RESPONSE_CONTACT_KINDS,
  RESPONSE_PACKET_PROFILE_IDS,
} from '../frontend/src/lib/analysis/case-response-packet.ts';
import {
  CASE_ACTION_STATES,
  CASE_ACTION_TYPES,
  MAX_DECISION_PIN_REFERENCES,
  MAX_CASE_ACTIONS,
  MAX_CASE_ASSERTIONS,
  MAX_CASE_DECISIONS,
  MAX_CASE_EVIDENCE_PINS,
  MAX_RESPONSE_LABEL_LENGTH,
  MAX_RESPONSE_LIMITATION_LENGTH,
  MAX_RESPONSE_LIMITATIONS,
  MAX_RESPONSE_RECIPIENT_LENGTH,
} from '../frontend/src/lib/analysis/case-response-model.ts';
import {
  INVESTIGATION_CAPSULE_ANALYST_RECORDS_SCHEMA,
  INVESTIGATION_CAPSULE_ANALYST_RECORDS_VERSION,
  INVESTIGATION_CAPSULE_SCHEMA,
  INVESTIGATION_CAPSULE_VERSION,
  LEGACY_INVESTIGATION_CAPSULE_VERSION,
  PREVIOUS_INVESTIGATION_CAPSULE_VERSION,
} from '../frontend/src/lib/analysis/investigation-capsule.ts';
import {
  LOOKUP_ASSET_GRAPH_SCHEMA,
  LOOKUP_ASSET_GRAPH_VERSION,
} from '../frontend/src/lib/analysis/lookup-asset-graph.ts';
import {
  LEGACY_LOOKUP_INVESTIGATION_BRIEF_VERSION,
  LOOKUP_INVESTIGATION_BRIEF_SCHEMA,
  LOOKUP_INVESTIGATION_BRIEF_VERSION,
  MAX_LOOKUP_INVESTIGATION_BRIEF_BYTES,
} from '../frontend/src/lib/analysis/lookup-investigation-brief.ts';
import {
  DECISION_FACT_CONSISTENCY_STATES,
  DECISION_FACT_EVIDENCE_STATES,
  DECISION_FACT_FRESHNESS_STATES,
  DECISION_FACT_PROVENANCE_STATES,
  DECISION_FACT_PROJECTION_VERSION,
  DECISION_FACT_VERSION,
  MAX_DECISION_FACT_CONTRIBUTORS,
  MAX_DECISION_FACT_CONTRADICTIONS,
  MAX_DECISION_FACT_LIMITATIONS,
  MAX_DECISION_FACT_NEXT_ACTIONS,
  MAX_DECISION_FACT_PROJECTION_CONTRADICTIONS,
  MAX_DECISION_FACT_PROJECTION_BYTES,
  MAX_DECISION_FACT_PROJECTION_FACTS,
  MAX_DECISION_FACT_PROJECTION_LIMITATIONS,
  MAX_DECISION_FACT_PROJECTION_NEXT_ACTIONS,
  MAX_DECISION_FACT_PROJECTION_REFERENCES,
  MAX_DECISION_FACT_PROJECTION_SOURCES,
  MAX_DECISION_FACT_PROJECTION_SOURCE_LIMITATIONS,
  MAX_DECISION_FACT_PROJECTION_SOURCE_REFERENCES,
  MAX_DECISION_FACT_REFERENCES,
  MAX_DECISION_FACTS,
  decisionFactCompleteness,
} from '../packages/evidence/decision-fact.mts';
import {
  LOOKUP_CLAIM_PASSPORT_SCHEMA,
  LOOKUP_CLAIM_PASSPORT_TARGET_TYPES,
  LOOKUP_CLAIM_PASSPORT_VERSION,
  MAX_LOOKUP_CLAIM_PASSPORT_LIMITATIONS,
  MAX_LOOKUP_CLAIM_PASSPORT_REQUIREMENTS,
} from '../frontend/src/lib/analysis/lookup-claim-passport.ts';
import {
  LOOKUP_CLAIM_IDS,
  LOOKUP_CLAIM_READINESS_VERSION,
  LOOKUP_CLAIM_REQUIREMENT_IDS,
} from '../frontend/src/lib/analysis/lookup-claim-readiness.ts';
import { normalizeDomainControlManifestDocument } from '../packages/evidence/domain-control-runtime.mts';
import { DOMAIN_CHANGE_PACKET_SCHEMA, DOMAIN_CHANGE_PACKET_VERSION } from '../lib/domain-change-packet.mts';
import { DOMAIN_CONTROL_MANIFEST_SCHEMA } from '../lib/domain-control-manifest.mts';
import {
  INVESTIGATION_MANIFEST_SCHEMA,
  INVESTIGATION_MANIFEST_VERSION,
  MAX_INVESTIGATION_MANIFEST_ARTIFACTS,
  MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES,
} from './investigation-manifest.mts';
import {
  assertLookupEvidencePrivacySafeTree,
  assertLookupEvidencePortableTree,
  HOMEPAGE_LOOKUP_EVIDENCE_SCHEMA_VERSION,
  LEGACY_LOOKUP_EVIDENCE_SCHEMA_VERSION,
  LOOKUP_EVIDENCE_SCHEMA,
  LOOKUP_EVIDENCE_SCHEMA_VERSION,
  projectLookupEvidenceAvailability,
  projectLookupEvidenceAvailabilityLegacy,
  projectLookupEvidenceQuery,
  projectLookupEvidenceRdapPublication,
  projectLookupEvidenceRegistryInsights,
  projectLookupEvidenceWhoisPublication,
  SUPPORTED_LOOKUP_EVIDENCE_SCHEMA_VERSIONS,
} from '../lib/evidence-export.mts';
import { compareRegistrySources } from '../lib/registry-comparison.mts';
import { buildRegistryInsights } from '../lib/registry-insights.mts';
import { WHOISLEUTH_SOURCE_REPOSITORY_URL } from '../lib/project-metadata.mts';
import {
  validHttpDeliveryMetadata,
  validPagePublicationMetadata,
} from '../lib/homepage-metadata-contract.mts';
import { isDeepStrictEqual } from 'node:util';

type UnknownRecord = Record<string, unknown>;

const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/u;
const HEX_DIGEST_RE = /^[a-f0-9]{64}$/u;
const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const SEMANTIC_VERSION_RE = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

function fail(label: string): never {
  throw new TypeError(`${label} has an unsupported or malformed structure.`);
}

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label);
  return value as UnknownRecord;
}

function exact(value: unknown, keys: readonly string[], label: string): UnknownRecord {
  const source = record(value, label);
  const actual = Object.keys(source);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) fail(label);
  return source;
}

function exactOptional(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): UnknownRecord {
  const source = record(value, label);
  const actual = Object.keys(source);
  if (required.some((key) => !actual.includes(key))
    || actual.some((key) => !required.includes(key) && !optional.includes(key))) fail(label);
  return source;
}

function text(value: unknown, label: string, maximum = 2_000, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maximum || CONTROL_RE.test(value) || (!allowEmpty && !value)) fail(label);
  return value;
}

function optionalText(value: unknown, label: string, maximum = 2_000): void {
  if (value !== null) text(value, label, maximum);
}

function iso(value: unknown, label: string, nullable = false): void {
  if (nullable && value === null) return;
  const candidate = text(value, label, 64);
  const parsed = Date.parse(candidate);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== candidate) fail(label);
}

function integer(value: unknown, label: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) fail(label);
  return Number(value);
}

function boolean(value: unknown, label: string): void {
  if (typeof value !== 'boolean') fail(label);
}

function enumeration<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail(label);
  return value as T;
}

function array(value: unknown, label: string, maximum: number, minimum = 0): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) fail(label);
  return value;
}

function strings(value: unknown, label: string, maximum: number, textMaximum = 2_000): string[] {
  const values = array(value, label, maximum);
  for (const item of values) text(item, label, textMaximum);
  return values as string[];
}

function digest(value: unknown, label: string): void {
  if (typeof value !== 'string' || !DIGEST_RE.test(value)) fail(label);
}

function sameValues(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function domain(value: unknown, label: string): void {
  if (typeof value !== 'string' || !DOMAIN_RE.test(value)) fail(label);
}

function absoluteUrl(value: unknown, label: string, protocols: readonly string[]): URL {
  const candidate = text(value, label, 2_048);
  try {
    const parsed = new URL(candidate);
    if (!protocols.includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) fail(label);
    return parsed;
  } catch { return fail(label); }
}

function nullableRecord(value: unknown, label: string): void {
  if (value !== null) record(value, label);
}

const LOOKUP_RDAP_ATTEMPT_OUTCOMES = [
  'success', 'not_found', 'no_results', 'unsupported', 'rate_limited',
  'server_error', 'client_error', 'invalid_json', 'invalid_response',
  'timeout', 'network_error', 'unknown',
] as const;
const LOOKUP_TIMING_SOURCES = [
  'rdap', 'whois', 'domain_evidence', 'reverse_dns', 'registrar_rdap',
  'network_context', 'security_txt', 'external_intelligence',
  'malware_host_intelligence', 'malware_ioc_intelligence',
] as const;
const LEGACY_LOOKUP_AVAILABILITY_ANALYSIS_KEYS = [
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
] as const;
const LOOKUP_AVAILABILITY_ANALYSIS_KEYS = LEGACY_LOOKUP_AVAILABILITY_ANALYSIS_KEYS.filter(
  (key) => !['registrar', 'registrant', 'abuse'].includes(key),
);
const LOOKUP_IDN_ANALYSIS_KEYS = [
  'version', 'mappingVersion', 'asciiDomain', 'unicodeDomain', 'hasIdn',
  'scripts', 'labels', 'mixedScript', 'skeleton', 'referenceMatches', 'findings',
  'truncated', 'limitations',
] as const;

function validateLookupEvidenceHomepageMetadata(
  availability: UnknownRecord,
  version: number,
): void {
  const pageIdentity = availability.pageIdentity === null || availability.pageIdentity === undefined
    ? null
    : record(availability.pageIdentity, 'Lookup evidence page identity');
  const http = availability.http === null || availability.http === undefined
    ? null
    : record(availability.http, 'Lookup evidence HTTP analysis');
  const response = http?.response === null || http?.response === undefined
    ? null
    : record(http.response, 'Lookup evidence HTTP response');
  const publicationPresent = Boolean(pageIdentity && Object.hasOwn(pageIdentity, 'publicationMetadata'));
  const deliveryPresent = Boolean(response && Object.hasOwn(response, 'deliveryMetadata'));
  if (version < HOMEPAGE_LOOKUP_EVIDENCE_SCHEMA_VERSION && (publicationPresent || deliveryPresent)) {
    fail('Lookup evidence homepage metadata epoch');
  }
  if (publicationPresent && !validPagePublicationMetadata(pageIdentity?.publicationMetadata)) {
    fail('Lookup evidence page publication metadata');
  }
  if (publicationPresent && !['success', 'partial'].includes(String(pageIdentity?.status))) {
    fail('Lookup evidence page publication metadata source state');
  }
  if (deliveryPresent && !validHttpDeliveryMetadata(response?.deliveryMetadata)) {
    fail('Lookup evidence HTTP delivery metadata');
  }
  if (deliveryPresent && !['success', 'partial'].includes(String(http?.status))) {
    fail('Lookup evidence HTTP delivery metadata source state');
  }
}

function validateLookupEvidenceRdapAttempt(value: unknown, label: string): void {
  const attempt = exact(value, ['endpoint', 'transportSecurity', 'status', 'outcome', 'detail', 'selected'], label);
  let endpoint: URL | null = null;
  if (attempt.endpoint !== null) endpoint = absoluteUrl(attempt.endpoint, `${label} endpoint`, ['http:', 'https:']);
  if (attempt.transportSecurity !== null) enumeration(attempt.transportSecurity, ['http', 'https'], `${label} transport`);
  if (endpoint && attempt.transportSecurity !== endpoint.protocol.slice(0, -1)) fail(`${label} transport`);
  if (!endpoint && attempt.transportSecurity !== null) fail(`${label} transport`);
  if (attempt.status !== null) integer(attempt.status, `${label} status`, 100, 599);
  enumeration(attempt.outcome, LOOKUP_RDAP_ATTEMPT_OUTCOMES, `${label} outcome`);
  optionalText(attempt.detail, `${label} detail`, 240);
  boolean(attempt.selected, `${label} selection`);
}

function validateLookupEvidenceWhoisHop(value: unknown, label: string): void {
  const hop = exact(value, ['server', 'address', 'queriedAt', 'queryProfile', 'responseEncoding', 'status', 'detail'], label);
  optionalText(hop.server, `${label} server`, 253);
  optionalText(hop.address, `${label} address`, 64);
  iso(hop.queriedAt, `${label} queriedAt`, true);
  if (hop.queryProfile !== null) enumeration(hop.queryProfile, [
    'plain-domain', 'denic-domain-ace', 'jprs-domain-english',
    'registry-domain-unicode', 'not-issued',
  ], `${label} query profile`);
  if (hop.responseEncoding !== null) enumeration(hop.responseEncoding, ['utf-8'], `${label} response encoding`);
  enumeration(hop.status, ['success', 'error', 'not_issued', 'unknown'], `${label} status`);
  optionalText(hop.detail, `${label} detail`, 240);
}

function validateLookupEvidenceTiming(value: unknown): void {
  if (value === null) return;
  const timing = exact(value, ['version', 'totalMs', 'sources'], 'Lookup evidence timing');
  if (timing.version !== 1) fail('Lookup evidence timing');
  if (timing.totalMs !== null) integer(timing.totalMs, 'Lookup evidence total timing', 0, 120_000);
  const seen = new Set<string>();
  array(timing.sources, 'Lookup evidence timing sources', LOOKUP_TIMING_SOURCES.length)
    .forEach((item, index) => {
      const entry = exact(item, ['source', 'outcome', 'durationMs', 'completedAfterMs'], `Lookup evidence timing source ${index + 1}`);
      const source = enumeration(entry.source, LOOKUP_TIMING_SOURCES, `Lookup evidence timing source ${index + 1}`);
      if (seen.has(source)) fail('Lookup evidence timing source');
      seen.add(source);
      enumeration(entry.outcome, ['fulfilled', 'rejected'], `Lookup evidence timing outcome ${index + 1}`);
      if (entry.durationMs !== null) integer(entry.durationMs, `Lookup evidence timing duration ${index + 1}`, 0, 120_000);
      if (entry.completedAfterMs !== null) integer(entry.completedAfterMs, `Lookup evidence timing completion ${index + 1}`, 0, 120_000);
    });
}

function validateLookupEvidenceRegistryAccess(value: unknown): void {
  if (value === null) return;
  const access = exactOptional(value, [
    'suffix', 'coverageState', 'whoisAccessProfile', 'rdapAccessProfile',
    'limitation', 'authority',
  ], ['officialLookupUrl'], 'Lookup evidence registry access');
  optionalText(access.suffix, 'Lookup evidence registry suffix', 253);
  optionalText(access.coverageState, 'Lookup evidence registry coverage', 40);
  optionalText(access.whoisAccessProfile, 'Lookup evidence WHOIS access profile', 80);
  optionalText(access.rdapAccessProfile, 'Lookup evidence RDAP access profile', 80);
  if (access.officialLookupUrl !== undefined && access.officialLookupUrl !== null) absoluteUrl(access.officialLookupUrl, 'Lookup evidence official lookup URL', ['http:', 'https:']);
  optionalText(access.limitation, 'Lookup evidence registry limitation', 500);
  if (access.authority !== null) enumeration(access.authority, ['context_only'], 'Lookup evidence registry authority');
}

function validateLookupEvidenceRegistrarDiagnostic(value: unknown): void {
  if (value === null) return;
  const registrar = exact(value, ['status', 'endpoint', 'transportSecurity', 'httpStatus', 'fetchedAt', 'attempt'], 'Lookup evidence registrar diagnostic');
  enumeration(registrar.status, ['success', 'partial', 'error', 'unsupported', 'not_found', 'skipped', 'disabled'], 'Lookup evidence registrar diagnostic status');
  let endpoint: URL | null = null;
  if (registrar.endpoint !== null) endpoint = absoluteUrl(registrar.endpoint, 'Lookup evidence registrar diagnostic endpoint', ['http:', 'https:']);
  if (registrar.transportSecurity !== null) enumeration(registrar.transportSecurity, ['http', 'https'], 'Lookup evidence registrar diagnostic transport');
  if (endpoint && registrar.transportSecurity !== endpoint.protocol.slice(0, -1)) fail('Lookup evidence registrar diagnostic transport');
  if (!endpoint && registrar.transportSecurity !== null) fail('Lookup evidence registrar diagnostic transport');
  if (registrar.httpStatus !== null) integer(registrar.httpStatus, 'Lookup evidence registrar diagnostic HTTP status', 100, 599);
  iso(registrar.fetchedAt, 'Lookup evidence registrar diagnostic fetchedAt', true);
  if (registrar.attempt !== null) validateLookupEvidenceRdapAttempt(registrar.attempt, 'Lookup evidence registrar diagnostic attempt');
}

type LookupEvidenceDiagnosticStates = Readonly<{
  rdap: string;
  whois: string;
  reverseDns: Readonly<{ status: string; complete: boolean; truncated: boolean }> | null;
  network: string | null;
}>;

function validateLookupEvidenceCurrentDiagnostics(value: unknown): LookupEvidenceDiagnosticStates {
  const diagnostics = exactOptional(value, ['rdap', 'whois'], [
    'version', 'timing', 'registryAccess', 'availability', 'reverseDns',
    'network', 'securityTxt', 'sslbl',
  ], 'Lookup evidence diagnostics');
  if (diagnostics.version !== undefined) integer(diagnostics.version, 'Lookup evidence diagnostics version', 1, 10);
  if (diagnostics.timing !== undefined) validateLookupEvidenceTiming(diagnostics.timing);
  if (diagnostics.registryAccess !== undefined) validateLookupEvidenceRegistryAccess(diagnostics.registryAccess);

  const rdap = exactOptional(diagnostics.rdap, ['status', 'errorCode', 'endpoint', 'transportSecurity', 'httpStatus', 'fetchedAt', 'attempts'], ['registrar'], 'Lookup evidence RDAP diagnostics');
  const rdapStatus = enumeration(rdap.status, ['success', 'partial', 'error', 'unsupported', 'not_found', 'skipped', 'disabled'], 'Lookup evidence RDAP diagnostic status');
  optionalText(rdap.errorCode, 'Lookup evidence RDAP diagnostic error', 80);
  let rdapEndpoint: URL | null = null;
  if (rdap.endpoint !== null) rdapEndpoint = absoluteUrl(rdap.endpoint, 'Lookup evidence RDAP diagnostic endpoint', ['http:', 'https:']);
  if (rdap.transportSecurity !== null) enumeration(rdap.transportSecurity, ['http', 'https'], 'Lookup evidence RDAP diagnostic transport');
  if (rdapEndpoint && rdap.transportSecurity !== rdapEndpoint.protocol.slice(0, -1)) fail('Lookup evidence RDAP diagnostic transport');
  if (!rdapEndpoint && rdap.transportSecurity !== null) fail('Lookup evidence RDAP diagnostic transport');
  if (rdap.httpStatus !== null) integer(rdap.httpStatus, 'Lookup evidence RDAP diagnostic HTTP status', 100, 599);
  iso(rdap.fetchedAt, 'Lookup evidence RDAP diagnostic fetchedAt', true);
  array(rdap.attempts, 'Lookup evidence RDAP diagnostic attempts', 16)
    .forEach((item, index) => validateLookupEvidenceRdapAttempt(item, `Lookup evidence RDAP diagnostic attempt ${index + 1}`));
  if (rdap.registrar !== undefined) validateLookupEvidenceRegistrarDiagnostic(rdap.registrar);

  const whois = exact(diagnostics.whois, ['status', 'errorCode', 'queriedAt', 'authoritativeHop', 'failedHop', 'conflictingHop'], 'Lookup evidence WHOIS diagnostics');
  const whoisStatus = enumeration(whois.status, ['complete', 'partial', 'error', 'unsupported', 'not_found', 'skipped', 'disabled'], 'Lookup evidence WHOIS diagnostic status');
  optionalText(whois.errorCode, 'Lookup evidence WHOIS diagnostic error', 80);
  iso(whois.queriedAt, 'Lookup evidence WHOIS diagnostic queriedAt', true);
  for (const key of ['authoritativeHop', 'failedHop', 'conflictingHop'] as const) optionalText(whois[key], `Lookup evidence WHOIS diagnostic ${key}`, 253);

  if (diagnostics.availability !== undefined) {
    const availability = exact(diagnostics.availability, ['status', 'errorCode', 'resultState'], 'Lookup evidence availability diagnostics');
    enumeration(availability.status, ['complete', 'error', 'disabled', 'not_applicable'], 'Lookup evidence availability diagnostic status');
    optionalText(availability.errorCode, 'Lookup evidence availability diagnostic error', 80);
    optionalText(availability.resultState, 'Lookup evidence availability result', 40);
  }

  let reverseDnsState: LookupEvidenceDiagnosticStates['reverseDns'] = null;
  if (diagnostics.reverseDns !== undefined) {
    const reverseDns = exact(diagnostics.reverseDns, ['status', 'observedAt', 'complete', 'truncated'], 'Lookup evidence reverse DNS diagnostics');
    const status = enumeration(reverseDns.status, ['success', 'partial', 'not_found', 'unsupported', 'skipped', 'error'], 'Lookup evidence reverse DNS diagnostic status');
    iso(reverseDns.observedAt, 'Lookup evidence reverse DNS diagnostic observedAt', true);
    boolean(reverseDns.complete, 'Lookup evidence reverse DNS diagnostic completeness');
    boolean(reverseDns.truncated, 'Lookup evidence reverse DNS diagnostic truncation');
    const expectedComplete = reverseDns.truncated !== true && (status === 'success' || status === 'not_found');
    if (reverseDns.complete !== expectedComplete) fail('Lookup evidence reverse DNS diagnostic completeness');
    reverseDnsState = { status, complete: Boolean(reverseDns.complete), truncated: Boolean(reverseDns.truncated) };
  }
  let networkState: string | null = null;
  if (diagnostics.network !== undefined) {
    const network = exact(diagnostics.network, ['status', 'address', 'family', 'addressSource', 'endpoint', 'transportSecurity', 'httpStatus', 'fetchedAt', 'attempts'], 'Lookup evidence network diagnostics');
    networkState = enumeration(network.status, ['success', 'partial', 'not_found', 'unsupported', 'error'], 'Lookup evidence network diagnostic status');
    optionalText(network.address, 'Lookup evidence network diagnostic address', 64);
    if (network.family !== null && network.family !== 4 && network.family !== 6) fail('Lookup evidence network diagnostic family');
    if (network.addressSource !== null) enumeration(network.addressSource, ['tls_connection', 'dns_a', 'dns_aaaa'], 'Lookup evidence network diagnostic address source');
    let endpoint: URL | null = null;
    if (network.endpoint !== null) endpoint = absoluteUrl(network.endpoint, 'Lookup evidence network diagnostic endpoint', ['http:', 'https:']);
    if (network.transportSecurity !== null) enumeration(network.transportSecurity, ['http', 'https'], 'Lookup evidence network diagnostic transport');
    if (endpoint && network.transportSecurity !== endpoint.protocol.slice(0, -1)) fail('Lookup evidence network diagnostic transport');
    if (!endpoint && network.transportSecurity !== null) fail('Lookup evidence network diagnostic transport');
    if (network.httpStatus !== null) integer(network.httpStatus, 'Lookup evidence network diagnostic HTTP status', 100, 599);
    iso(network.fetchedAt, 'Lookup evidence network diagnostic fetchedAt', true);
    array(network.attempts, 'Lookup evidence network diagnostic attempts', 3)
      .forEach((item, index) => validateLookupEvidenceRdapAttempt(item, `Lookup evidence network diagnostic attempt ${index + 1}`));
  }
  if (diagnostics.securityTxt !== undefined) {
    const securityTxt = exact(diagnostics.securityTxt, ['status', 'state', 'endpoint', 'httpStatus', 'observedAt', 'complete', 'truncated'], 'Lookup evidence security.txt diagnostics');
    optionalText(securityTxt.status, 'Lookup evidence security.txt diagnostic status', 40);
    if (securityTxt.state !== null) enumeration(securityTxt.state, ['present', 'stale', 'partial', 'absent', 'malformed', 'unsupported', 'unavailable'], 'Lookup evidence security.txt diagnostic state');
    if (securityTxt.endpoint !== null) absoluteUrl(securityTxt.endpoint, 'Lookup evidence security.txt diagnostic endpoint', ['https:']);
    if (securityTxt.httpStatus !== null) integer(securityTxt.httpStatus, 'Lookup evidence security.txt diagnostic HTTP status', 100, 599);
    iso(securityTxt.observedAt, 'Lookup evidence security.txt diagnostic observedAt', true);
    boolean(securityTxt.complete, 'Lookup evidence security.txt diagnostic completeness');
    boolean(securityTxt.truncated, 'Lookup evidence security.txt diagnostic truncation');
  }
  if (diagnostics.sslbl !== undefined) {
    const sslbl = exact(diagnostics.sslbl, ['status', 'verdict', 'observedAt', 'complete', 'snapshotUpdatedAt'], 'Lookup evidence SSLBL diagnostics');
    if (sslbl.status !== null) enumeration(sslbl.status, ['success', 'stale', 'unavailable'], 'Lookup evidence SSLBL diagnostic status');
    if (sslbl.verdict !== null) enumeration(sslbl.verdict, ['listed', 'not_listed', 'inconclusive'], 'Lookup evidence SSLBL diagnostic verdict');
    iso(sslbl.observedAt, 'Lookup evidence SSLBL diagnostic observedAt', true);
    boolean(sslbl.complete, 'Lookup evidence SSLBL diagnostic completeness');
    iso(sslbl.snapshotUpdatedAt, 'Lookup evidence SSLBL diagnostic snapshot timestamp', true);
  }
  return { rdap: rdapStatus, whois: whoisStatus, reverseDns: reverseDnsState, network: networkState };
}

function validateLookupEvidenceTree(value: unknown): void {
  try { assertLookupEvidencePortableTree(value); } catch { fail('Lookup evidence portable bounds'); }
}

function validateLookupEvidenceRdap(value: unknown, version: number): string {
  const source = record(value, 'Lookup evidence RDAP source');
  if (source.status === 'error') {
    const error = exact(source, ['status', 'error', 'attempts'], 'Lookup evidence RDAP source');
    text(error.error, 'Lookup evidence RDAP error', 10_000);
    array(error.attempts, 'Lookup evidence RDAP attempts', 16).forEach((item, index) => {
      if (version === LEGACY_LOOKUP_EVIDENCE_SCHEMA_VERSION) record(item, `Lookup evidence legacy RDAP attempt ${index + 1}`);
      else validateLookupEvidenceRdapAttempt(item, `Lookup evidence RDAP attempt ${index + 1}`);
    });
    return 'error';
  }
  const complete = exact(source, version >= LOOKUP_EVIDENCE_SCHEMA_VERSION
    ? ['status', 'endpoint', 'transportSecurity', 'httpStatus', 'fetchedAt', 'attempts', 'parsed']
    : ['status', 'endpoint', 'transportSecurity', 'httpStatus', 'fetchedAt', 'attempts', 'parsed', 'raw'], 'Lookup evidence RDAP source');
  const status = enumeration(complete.status, version === LEGACY_LOOKUP_EVIDENCE_SCHEMA_VERSION
    ? ['success', 'not_found']
    : ['success', 'partial', 'not_found', 'unsupported', 'skipped', 'disabled'], 'Lookup evidence RDAP status');
  let endpoint: URL | null = null;
  if (complete.endpoint !== null) endpoint = absoluteUrl(complete.endpoint, 'Lookup evidence RDAP endpoint', ['http:', 'https:']);
  if (complete.transportSecurity !== null) enumeration(complete.transportSecurity, ['http', 'https'], 'Lookup evidence RDAP transport');
  if (version !== LEGACY_LOOKUP_EVIDENCE_SCHEMA_VERSION) {
    if (endpoint && complete.transportSecurity !== endpoint.protocol.slice(0, -1)) fail('Lookup evidence RDAP transport');
    if (!endpoint && complete.transportSecurity !== null) fail('Lookup evidence RDAP transport');
  }
  if (complete.httpStatus !== null) integer(complete.httpStatus, 'Lookup evidence RDAP HTTP status', 100, 599);
  iso(complete.fetchedAt, 'Lookup evidence RDAP fetchedAt', true);
  array(complete.attempts, 'Lookup evidence RDAP attempts', 16).forEach((item, index) => {
    if (version === LEGACY_LOOKUP_EVIDENCE_SCHEMA_VERSION) record(item, `Lookup evidence legacy RDAP attempt ${index + 1}`);
    else validateLookupEvidenceRdapAttempt(item, `Lookup evidence RDAP attempt ${index + 1}`);
  });
  nullableRecord(complete.parsed, 'Lookup evidence RDAP parsed data');
  if (version < LOOKUP_EVIDENCE_SCHEMA_VERSION) nullableRecord(complete.raw, 'Lookup evidence RDAP raw data');
  if (version >= LOOKUP_EVIDENCE_SCHEMA_VERSION
    && !isDeepStrictEqual(complete.parsed, projectLookupEvidenceRdapPublication(complete.parsed))) {
    fail('Lookup evidence RDAP portable publication');
  }
  if (version !== LEGACY_LOOKUP_EVIDENCE_SCHEMA_VERSION
    && status === 'success' && complete.parsed === null) fail('Lookup evidence RDAP publication');
  if (version !== LEGACY_LOOKUP_EVIDENCE_SCHEMA_VERSION
    && !['success', 'partial'].includes(status)
    && (complete.parsed !== null || (version < LOOKUP_EVIDENCE_SCHEMA_VERSION && complete.raw !== null))) fail('Lookup evidence RDAP unavailable publication');
  return status;
}

function validateLookupEvidenceWhois(value: unknown, version: number): string {
  const source = record(value, 'Lookup evidence WHOIS source');
  if (source.status === 'error') {
    const error = exact(source, ['status', 'error'], 'Lookup evidence WHOIS source');
    text(error.error, 'Lookup evidence WHOIS error', 10_000);
    return 'error';
  }
  const complete = exact(source, ['status', 'queriedAt', 'authoritativeHop', 'failedHop', 'conflictingHop', 'parsed', 'chain'], 'Lookup evidence WHOIS source');
  const status = enumeration(complete.status, version === LEGACY_LOOKUP_EVIDENCE_SCHEMA_VERSION
    ? ['complete', 'partial', 'unknown']
    : ['complete', 'partial', 'not_found', 'unsupported', 'skipped', 'disabled'], 'Lookup evidence WHOIS status');
  iso(complete.queriedAt, 'Lookup evidence WHOIS queriedAt', true);
  optionalText(complete.authoritativeHop, 'Lookup evidence WHOIS authoritative hop', 253);
  optionalText(complete.failedHop, 'Lookup evidence WHOIS failed hop', 253);
  optionalText(complete.conflictingHop, 'Lookup evidence WHOIS conflicting hop', 253);
  nullableRecord(complete.parsed, 'Lookup evidence WHOIS parsed data');
  if (version >= LOOKUP_EVIDENCE_SCHEMA_VERSION
    && !isDeepStrictEqual(complete.parsed, projectLookupEvidenceWhoisPublication(complete.parsed))) {
    fail('Lookup evidence WHOIS portable publication');
  }
  array(complete.chain, 'Lookup evidence WHOIS chain', 16).forEach((item, index) => {
    if (version === LEGACY_LOOKUP_EVIDENCE_SCHEMA_VERSION) record(item, `Lookup evidence legacy WHOIS chain item ${index + 1}`);
    else validateLookupEvidenceWhoisHop(item, `Lookup evidence WHOIS chain item ${index + 1}`);
  });
  if (status === 'complete' && complete.parsed === null) fail('Lookup evidence WHOIS publication');
  if (version !== LEGACY_LOOKUP_EVIDENCE_SCHEMA_VERSION
    && !['complete', 'partial'].includes(status)
    && (complete.parsed !== null || (complete.chain as unknown[]).length !== 0)) fail('Lookup evidence WHOIS unavailable publication');
  return status;
}

function validateLookupEvidenceReverseDns(value: unknown): Readonly<{ status: string; complete: boolean; truncated: boolean }> | null {
  if (value === null) return null;
  const source = exact(value, ['version', 'status', 'observedAt', 'scanMode', 'source', 'durationMs', 'complete', 'truncated', 'limitations', 'diagnostics', 'records'], 'Lookup evidence reverse DNS source');
  if (source.version !== 1 || source.source !== 'reverse_dns') fail('Lookup evidence reverse DNS source');
  const status = enumeration(source.status, ['success', 'partial', 'not_found', 'unsupported', 'skipped', 'error'], 'Lookup evidence reverse DNS status');
  iso(source.observedAt, 'Lookup evidence reverse DNS observedAt', true);
  if (source.scanMode !== null) enumeration(source.scanMode, ['deep'], 'Lookup evidence reverse DNS mode');
  if (source.durationMs !== null) integer(source.durationMs, 'Lookup evidence reverse DNS duration', 0, 120_000);
  boolean(source.complete, 'Lookup evidence reverse DNS completeness');
  boolean(source.truncated, 'Lookup evidence reverse DNS truncation');
  strings(source.limitations, 'Lookup evidence reverse DNS limitations', 10, 300);
  if (source.diagnostics !== null) {
    const diagnostics = exact(source.diagnostics, ['ptr'], 'Lookup evidence reverse DNS diagnostics');
    const ptr = exact(diagnostics.ptr, ['status', 'error', 'truncated', 'discarded'], 'Lookup evidence reverse DNS PTR diagnostics');
    optionalText(ptr.status, 'Lookup evidence reverse DNS PTR status', 40);
    optionalText(ptr.error, 'Lookup evidence reverse DNS PTR error', 180);
    boolean(ptr.truncated, 'Lookup evidence reverse DNS PTR truncation');
    if (ptr.discarded !== null) integer(ptr.discarded, 'Lookup evidence reverse DNS PTR discarded count', 0, 1_000);
  }
  const records = exact(source.records, ['ptr'], 'Lookup evidence reverse DNS records');
  const ptr = strings(records.ptr, 'Lookup evidence reverse DNS PTR records', 8, 253);
  if (!['success', 'partial'].includes(status) && ptr.length) fail('Lookup evidence reverse DNS unavailable records');
  const expectedComplete = source.truncated !== true && (status === 'success' || status === 'not_found');
  if (source.complete !== expectedComplete) fail('Lookup evidence reverse DNS completeness');
  return { status, complete: Boolean(source.complete), truncated: Boolean(source.truncated) };
}

function validateLookupEvidenceNetwork(value: unknown): Readonly<{ status: string; complete: boolean; truncated: boolean }> | null {
  if (value === null) return null;
  const source = exact(value, ['contextVersion', 'version', 'status', 'observedAt', 'scanMode', 'source', 'durationMs', 'complete', 'truncated', 'limitations', 'diagnostics', 'detail', 'endpoint', 'rdap', 'network'], 'Lookup evidence network source');
  if (source.contextVersion !== 1 || (source.version !== 1 && source.version !== null)) fail('Lookup evidence network source');
  const status = enumeration(source.status, ['success', 'partial', 'not_found', 'unsupported', 'error'], 'Lookup evidence network status');
  iso(source.observedAt, 'Lookup evidence network observedAt', true);
  if (source.scanMode !== null) enumeration(source.scanMode, ['deep'], 'Lookup evidence network mode');
  if (source.source !== null) enumeration(source.source, ['ip_rdap'], 'Lookup evidence network kind');
  if (source.durationMs !== null) integer(source.durationMs, 'Lookup evidence network duration', 0, 120_000);
  boolean(source.complete, 'Lookup evidence network completeness');
  boolean(source.truncated, 'Lookup evidence network truncation');
  strings(source.limitations, 'Lookup evidence network limitations', 10, 300);
  if (source.diagnostics !== null) {
    const diagnostics = exact(source.diagnostics, ['requestCount', 'addressSource', 'httpStatus', 'cidrCount'], 'Lookup evidence network diagnostics');
    if (diagnostics.requestCount !== null) integer(diagnostics.requestCount, 'Lookup evidence network request count', 0, 1);
    if (diagnostics.addressSource !== null) enumeration(diagnostics.addressSource, ['tls_connection', 'dns_a', 'dns_aaaa'], 'Lookup evidence network address source');
    if (diagnostics.httpStatus !== null) integer(diagnostics.httpStatus, 'Lookup evidence network HTTP status', 100, 599);
    if (diagnostics.cidrCount !== null) integer(diagnostics.cidrCount, 'Lookup evidence network CIDR count', 0, 16);
  }
  optionalText(source.detail, 'Lookup evidence network detail', 300);
  if (source.endpoint !== null) {
    const endpoint = exact(source.endpoint, ['address', 'family', 'selectedFrom'], 'Lookup evidence network endpoint');
    optionalText(endpoint.address, 'Lookup evidence network address', 64);
    if (endpoint.family !== null) integer(endpoint.family, 'Lookup evidence network address family', 4, 6);
    if (endpoint.family !== null && endpoint.family !== 4 && endpoint.family !== 6) fail('Lookup evidence network address family');
    if (endpoint.selectedFrom !== null) enumeration(endpoint.selectedFrom, ['tls_connection', 'dns_a', 'dns_aaaa'], 'Lookup evidence network selected source');
  }
  if (source.rdap !== null) {
    const rdap = exact(source.rdap, ['endpoint', 'transportSecurity', 'httpStatus', 'fetchedAt', 'attempts'], 'Lookup evidence network RDAP');
    if (rdap.endpoint !== null) absoluteUrl(rdap.endpoint, 'Lookup evidence network RDAP endpoint', ['http:', 'https:']);
    if (rdap.transportSecurity !== null) enumeration(rdap.transportSecurity, ['http', 'https'], 'Lookup evidence network RDAP transport');
    if (rdap.httpStatus !== null) integer(rdap.httpStatus, 'Lookup evidence network RDAP HTTP status', 100, 599);
    iso(rdap.fetchedAt, 'Lookup evidence network RDAP fetchedAt', true);
    array(rdap.attempts, 'Lookup evidence network RDAP attempts', 3).forEach((item, index) => {
      const attempt = exact(item, ['endpoint', 'transportSecurity', 'status', 'outcome', 'detail', 'selected'], `Lookup evidence network RDAP attempt ${index + 1}`);
      if (attempt.endpoint !== null) absoluteUrl(attempt.endpoint, 'Lookup evidence network RDAP attempt endpoint', ['http:', 'https:']);
      if (attempt.transportSecurity !== null) enumeration(attempt.transportSecurity, ['http', 'https'], 'Lookup evidence network RDAP attempt transport');
      if (attempt.status !== null) integer(attempt.status, 'Lookup evidence network RDAP attempt status', 100, 599);
      optionalText(attempt.outcome, 'Lookup evidence network RDAP attempt outcome', 40);
      optionalText(attempt.detail, 'Lookup evidence network RDAP attempt detail', 240);
      boolean(attempt.selected, 'Lookup evidence network RDAP attempt selection');
    });
  }
  if (source.network !== null) {
    const network = exact(source.network, ['handle', 'name', 'holder', 'cidrs', 'startAddress', 'endAddress', 'country', 'networkType', 'databaseUpdatedAt'], 'Lookup evidence network registration');
    for (const key of ['handle', 'name', 'holder'] as const) optionalText(network[key], `Lookup evidence network ${key}`, 300);
    strings(network.cidrs, 'Lookup evidence network CIDRs', 16, 96);
    optionalText(network.startAddress, 'Lookup evidence network start address', 64);
    optionalText(network.endAddress, 'Lookup evidence network end address', 64);
    if (network.country !== null && !/^[A-Z]{2}$/u.test(String(network.country))) fail('Lookup evidence network country');
    optionalText(network.networkType, 'Lookup evidence network type', 160);
    iso(network.databaseUpdatedAt, 'Lookup evidence network database timestamp', true);
  }
  if (!['success', 'partial'].includes(status)
    && (source.endpoint !== null || source.rdap !== null || source.network !== null)) {
    fail('Lookup evidence unavailable network publication');
  }
  const expectedComplete = source.truncated !== true && (status === 'success' || status === 'not_found');
  if (source.complete !== expectedComplete) fail('Lookup evidence network completeness');
  return { status, complete: Boolean(source.complete), truncated: Boolean(source.truncated) };
}

function validateLookupEvidenceSecurityTxt(value: unknown): void {
  if (value === null) return;
  const source = exact(value, ['securityTxtVersion', 'version', 'state', 'status', 'observedAt', 'scanMode', 'source', 'durationMs', 'complete', 'truncated', 'limitations', 'detail', 'requestedUrl', 'finalUrl', 'httpStatus', 'redirectCount', 'expiresAt', 'signed', 'canonicalMatches', 'contacts', 'policies', 'encryption', 'canonical', 'preferredLanguages'], 'Lookup evidence security.txt source');
  if (source.securityTxtVersion !== 1 || (source.version !== 1 && source.version !== null) || source.source !== 'security_txt') fail('Lookup evidence security.txt source');
  enumeration(source.state, ['present', 'stale', 'partial', 'absent', 'malformed', 'unsupported', 'unavailable'], 'Lookup evidence security.txt state');
  optionalText(source.status, 'Lookup evidence security.txt status', 40);
  iso(source.observedAt, 'Lookup evidence security.txt observedAt', true);
  if (source.scanMode !== null) enumeration(source.scanMode, ['deep'], 'Lookup evidence security.txt mode');
  if (source.durationMs !== null) integer(source.durationMs, 'Lookup evidence security.txt duration', 0, 120_000);
  boolean(source.complete, 'Lookup evidence security.txt completeness');
  boolean(source.truncated, 'Lookup evidence security.txt truncation');
  strings(source.limitations, 'Lookup evidence security.txt limitations', 10, 300);
  optionalText(source.detail, 'Lookup evidence security.txt detail', 300);
  optionalText(source.requestedUrl, 'Lookup evidence security.txt requested URL', 2_048);
  optionalText(source.finalUrl, 'Lookup evidence security.txt final URL', 2_048);
  if (source.httpStatus !== null) integer(source.httpStatus, 'Lookup evidence security.txt HTTP status', 100, 599);
  if (source.redirectCount !== null) integer(source.redirectCount, 'Lookup evidence security.txt redirects', 0, 3);
  iso(source.expiresAt, 'Lookup evidence security.txt expiry', true);
  boolean(source.signed, 'Lookup evidence security.txt signed state');
  if (source.canonicalMatches !== null) boolean(source.canonicalMatches, 'Lookup evidence security.txt canonical state');
  strings(source.contacts, 'Lookup evidence security.txt contacts', 10, 2_048);
  strings(source.policies, 'Lookup evidence security.txt policies', 10, 2_048);
  strings(source.encryption, 'Lookup evidence security.txt encryption', 10, 2_048);
  strings(source.canonical, 'Lookup evidence security.txt canonical URLs', 10, 2_048);
  strings(source.preferredLanguages, 'Lookup evidence security.txt languages', 10, 40);
  const expectedStatus = source.state === 'present'
    ? 'success'
    : source.state === 'absent'
      ? 'not_found'
      : source.state === 'unsupported'
        ? 'unsupported'
        : source.state === 'unavailable' || source.state === 'malformed'
          ? 'error'
          : 'partial';
  if (source.status !== expectedStatus) fail('Lookup evidence security.txt state');
  if (source.complete !== (source.state === 'present' || source.state === 'absent')) fail('Lookup evidence security.txt completeness');
}

function validateLookupEvidenceSslbl(value: unknown): void {
  if (value === null) return;
  const source = exact(value, ['sslblVersion', 'source', 'status', 'verdict', 'complete', 'observedAt', 'fingerprintSha1', 'referenceUrl', 'snapshot', 'detail', 'limitations'], 'Lookup evidence SSLBL source');
  if (source.sslblVersion !== 1 || source.source !== 'sslbl') fail('Lookup evidence SSLBL source');
  enumeration(source.status, ['success', 'stale', 'unavailable'], 'Lookup evidence SSLBL status');
  enumeration(source.verdict, ['listed', 'not_listed', 'inconclusive'], 'Lookup evidence SSLBL verdict');
  boolean(source.complete, 'Lookup evidence SSLBL completeness');
  iso(source.observedAt, 'Lookup evidence SSLBL observedAt', true);
  if (source.fingerprintSha1 !== null && !/^[a-f0-9]{40}$/u.test(String(source.fingerprintSha1))) fail('Lookup evidence SSLBL fingerprint');
  optionalText(source.referenceUrl, 'Lookup evidence SSLBL reference', 2_048);
  if (source.snapshot === null) fail('Lookup evidence SSLBL snapshot');
  const snapshot = exact(source.snapshot, ['sourceUpdatedAt', 'generatedAt', 'ageSeconds', 'entryCount', 'digestSha256'], 'Lookup evidence SSLBL snapshot');
  iso(snapshot.sourceUpdatedAt, 'Lookup evidence SSLBL source timestamp', true);
  iso(snapshot.generatedAt, 'Lookup evidence SSLBL generated timestamp', true);
  if (snapshot.ageSeconds !== null) integer(snapshot.ageSeconds, 'Lookup evidence SSLBL age', 0, 31_536_000);
  if (snapshot.entryCount !== null) integer(snapshot.entryCount, 'Lookup evidence SSLBL entry count', 0, 50_000);
  if (snapshot.digestSha256 !== null && !HEX_DIGEST_RE.test(String(snapshot.digestSha256))) fail('Lookup evidence SSLBL digest');
  optionalText(source.detail, 'Lookup evidence SSLBL detail', 300);
  strings(source.limitations, 'Lookup evidence SSLBL limitations', 10, 300);
  const validState = (source.verdict === 'not_listed' && source.status === 'success' && source.complete === true)
    || (source.verdict === 'listed'
      && (source.status === 'success' || source.status === 'stale')
      && source.complete === (source.status === 'success'))
    || (source.verdict === 'inconclusive'
      && (source.status === 'stale' || source.status === 'unavailable')
      && source.complete === false);
  if (!validState) fail('Lookup evidence SSLBL state');
  if (source.referenceUrl !== null) {
    if (source.verdict !== 'listed' || source.fingerprintSha1 === null) fail('Lookup evidence SSLBL reference');
    const reference = absoluteUrl(source.referenceUrl, 'Lookup evidence SSLBL reference', ['https:']);
    if (reference.hostname !== 'sslbl.abuse.ch'
      || reference.port
      || reference.pathname !== `/ssl-certificates/sha1/${String(source.fingerprintSha1)}/`) fail('Lookup evidence SSLBL reference');
  }
}

const LOOKUP_REGISTRAR_COMPARISON_STATUSES = [
  'equivalent', 'conflict', 'registry_only', 'registrar_only',
  'registry_redacted', 'registrar_redacted', 'registry_unavailable',
  'registrar_unavailable', 'registry_incomplete', 'registrar_incomplete',
] as const;

function lookupPublicationCondition(status: string): 'complete' | 'incomplete' | 'unavailable' {
  if (status === 'partial') return 'incomplete';
  return ['error', 'unsupported', 'not_found', 'skipped', 'disabled'].includes(status)
    ? 'unavailable'
    : 'complete';
}

function validateLookupEvidenceRegistrarComparison(value: unknown): void {
  if (value === null) return;
  const comparison = exact(value, ['fields', 'counts', 'sourceHealth'], 'Lookup evidence registrar comparison');
  const counts = exact(comparison.counts, LOOKUP_REGISTRAR_COMPARISON_STATUSES, 'Lookup evidence registrar comparison counts');
  const observedCounts = new Map<string, number>();
  const labels = new Set<string>();
  array(comparison.fields, 'Lookup evidence registrar comparison fields', 9).forEach((item, index) => {
    const field = exact(item, [
      'label', 'status', 'registryState', 'registrarState', 'registryDisplay', 'registrarDisplay',
    ], `Lookup evidence registrar comparison field ${index + 1}`);
    const label = enumeration(field.label, [
      'Domain', 'Registrar', 'Registrar IANA ID', 'Created', 'Expires',
      'Last updated', 'DNSSEC', 'Statuses', 'Name servers',
    ], `Lookup evidence registrar comparison field ${index + 1} label`);
    if (labels.has(label)) fail('Lookup evidence registrar comparison fields');
    labels.add(label);
    const status = enumeration(
      field.status,
      LOOKUP_REGISTRAR_COMPARISON_STATUSES,
      `Lookup evidence registrar comparison field ${index + 1} status`,
    );
    enumeration(field.registryState, ['absent', 'redacted', 'value', 'incomplete', 'unavailable'], `Lookup evidence registrar comparison field ${index + 1} registry state`);
    enumeration(field.registrarState, ['absent', 'redacted', 'value', 'incomplete', 'unavailable'], `Lookup evidence registrar comparison field ${index + 1} registrar state`);
    text(field.registryDisplay, `Lookup evidence registrar comparison field ${index + 1} registry display`, 2_000);
    text(field.registrarDisplay, `Lookup evidence registrar comparison field ${index + 1} registrar display`, 2_000);
    observedCounts.set(status, (observedCounts.get(status) ?? 0) + 1);
  });
  for (const status of LOOKUP_REGISTRAR_COMPARISON_STATUSES) {
    const count = integer(counts[status], `Lookup evidence registrar comparison ${status} count`, 0, 9);
    if (count !== (observedCounts.get(status) ?? 0)) fail('Lookup evidence registrar comparison counts');
  }
  const sourceHealth = exact(comparison.sourceHealth, ['registry', 'registrar'], 'Lookup evidence registrar comparison source health');
  for (const source of ['registry', 'registrar'] as const) {
    const health = exact(sourceHealth[source], ['status', 'condition'], `Lookup evidence registrar comparison ${source} health`);
    const status = enumeration(health.status, [
      'success', 'partial', 'error', 'unsupported', 'not_found', 'skipped', 'disabled',
    ], `Lookup evidence registrar comparison ${source} status`);
    if (health.condition !== lookupPublicationCondition(status)) fail(`Lookup evidence registrar comparison ${source} condition`);
  }
}

export function validateLookupEvidenceArtifactStructure(value: UnknownRecord): void {
  validateLookupEvidenceTree(value);
  const root = exact(value, ['schema', 'schemaVersion', 'generatedAt', 'application', 'query', 'diagnostics', 'sources', 'analysis'], 'Lookup evidence');
  if (root.schema !== LOOKUP_EVIDENCE_SCHEMA
    || !SUPPORTED_LOOKUP_EVIDENCE_SCHEMA_VERSIONS.includes(Number(root.schemaVersion))) fail('Lookup evidence');
  const version = integer(root.schemaVersion, 'Lookup evidence version', LEGACY_LOOKUP_EVIDENCE_SCHEMA_VERSION, LOOKUP_EVIDENCE_SCHEMA_VERSION);
  iso(root.generatedAt, 'Lookup evidence generatedAt');

  const application = exact(root.application, ['name', 'version', 'projectUrl'], 'Lookup evidence application');
  if (application.name !== 'WHOISleuth' || application.projectUrl !== WHOISLEUTH_SOURCE_REPOSITORY_URL) fail('Lookup evidence application');
  if (application.version !== null && (typeof application.version !== 'string' || !SEMANTIC_VERSION_RE.test(application.version))) fail('Lookup evidence application version');

  const query = exact(root.query, ['submitted', 'type', 'inputHostname', 'registrableDomain', 'isSubdomain'], 'Lookup evidence query');
  text(query.submitted, 'Lookup evidence submitted query', 1_024);
  const queryType = enumeration(query.type, ['domain', 'ipv4', 'ipv6', 'asn'], 'Lookup evidence query type');
  optionalText(query.inputHostname, 'Lookup evidence input hostname', 253);
  optionalText(query.registrableDomain, 'Lookup evidence registrable domain', 253);
  boolean(query.isSubdomain, 'Lookup evidence subdomain state');
  if (queryType === 'domain') {
    if (query.inputHostname !== null) domain(query.inputHostname, 'Lookup evidence input hostname');
    domain(query.registrableDomain, 'Lookup evidence registrable domain');
  } else if (query.inputHostname !== null || query.registrableDomain !== null || query.isSubdomain !== false) fail('Lookup evidence query');
  if (version !== LEGACY_LOOKUP_EVIDENCE_SCHEMA_VERSION
    && !isDeepStrictEqual(query, projectLookupEvidenceQuery(query))) fail('Lookup evidence query');

  let diagnostics: UnknownRecord;
  let rdapDiagnosticStatus: string;
  let whoisDiagnosticStatus: string;
  let currentDiagnosticStates: LookupEvidenceDiagnosticStates | null = null;
  if (version === LEGACY_LOOKUP_EVIDENCE_SCHEMA_VERSION) {
    diagnostics = exactOptional(root.diagnostics, ['rdap', 'whois'], ['version', 'availability', 'timing', 'registryAccess', 'reverseDns', 'network', 'securityTxt', 'sslbl'], 'Lookup evidence diagnostics');
    if (diagnostics.version !== undefined) integer(diagnostics.version, 'Lookup evidence diagnostics version', 1, 10);
    const rdapDiagnostics = record(diagnostics.rdap, 'Lookup evidence rdap diagnostics');
    const whoisDiagnostics = record(diagnostics.whois, 'Lookup evidence whois diagnostics');
    rdapDiagnosticStatus = enumeration(rdapDiagnostics.status, ['success', 'partial', 'error', 'unsupported', 'not_found', 'skipped', 'disabled'], 'Lookup evidence RDAP diagnostic status');
    whoisDiagnosticStatus = enumeration(whoisDiagnostics.status, ['complete', 'partial', 'error', 'unsupported', 'not_found', 'skipped', 'disabled'], 'Lookup evidence WHOIS diagnostic status');
    for (const id of ['availability', 'timing', 'registryAccess', 'reverseDns', 'network', 'securityTxt', 'sslbl'] as const) {
      if (diagnostics[id] !== undefined) record(diagnostics[id], `Lookup evidence ${id} diagnostics`);
    }
  } else {
    diagnostics = record(root.diagnostics, 'Lookup evidence diagnostics');
    currentDiagnosticStates = validateLookupEvidenceCurrentDiagnostics(diagnostics);
    rdapDiagnosticStatus = currentDiagnosticStates.rdap;
    whoisDiagnosticStatus = currentDiagnosticStates.whois;
  }

  const sources = exact(root.sources, ['rdap', 'whois', 'reverseDns', 'network', 'securityTxt', 'sslbl'], 'Lookup evidence sources');
  const rdapSourceStatus = validateLookupEvidenceRdap(sources.rdap, version);
  const whoisSourceStatus = validateLookupEvidenceWhois(sources.whois, version);
  if (version !== LEGACY_LOOKUP_EVIDENCE_SCHEMA_VERSION) {
    if (rdapSourceStatus !== rdapDiagnosticStatus) fail('Lookup evidence RDAP source state');
    if (whoisSourceStatus !== whoisDiagnosticStatus) fail('Lookup evidence WHOIS source state');
  } else {
    const rdapSource = record(sources.rdap, 'Lookup evidence legacy RDAP source');
    const whoisSource = record(sources.whois, 'Lookup evidence legacy WHOIS source');
    if (rdapDiagnosticStatus === 'success'
      && (rdapSourceStatus !== 'success' || rdapSource.parsed === null)) fail('Lookup evidence legacy RDAP source state');
    if (rdapDiagnosticStatus === 'not_found' && rdapSourceStatus !== 'not_found') fail('Lookup evidence legacy RDAP source state');
    if (rdapDiagnosticStatus === 'error' && rdapSourceStatus !== 'error') fail('Lookup evidence legacy RDAP source state');
    if (whoisDiagnosticStatus === 'complete'
      && (whoisSourceStatus !== 'complete' || whoisSource.parsed === null)) fail('Lookup evidence legacy WHOIS source state');
    if (whoisDiagnosticStatus === 'partial'
      && (whoisSourceStatus !== 'partial' || whoisSource.parsed === null)) fail('Lookup evidence legacy WHOIS source state');
    if (whoisDiagnosticStatus === 'error' && whoisSourceStatus !== 'error') fail('Lookup evidence legacy WHOIS source state');
  }
  const reverseDnsState = validateLookupEvidenceReverseDns(sources.reverseDns);
  const networkState = validateLookupEvidenceNetwork(sources.network);
  if (currentDiagnosticStates) {
    if (currentDiagnosticStates.reverseDns
      && !isDeepStrictEqual(reverseDnsState, currentDiagnosticStates.reverseDns)) {
      fail('Lookup evidence reverse DNS source state');
    }
    if (currentDiagnosticStates.network !== null
      && (networkState?.status ?? null) !== currentDiagnosticStates.network) {
      fail('Lookup evidence network source state');
    }
  }
  validateLookupEvidenceSecurityTxt(sources.securityTxt);
  validateLookupEvidenceSslbl(sources.sslbl);

  const analysis = exact(root.analysis, ['availability', 'idn', 'registryInsights', 'registryComparison', 'registrarPublicationComparison'], 'Lookup evidence analysis');
  if (analysis.availability !== null) {
    const currentAvailability = version >= LOOKUP_EVIDENCE_SCHEMA_VERSION;
    const availability = exactOptional(
      analysis.availability,
      currentAvailability ? ['registryContactsExcluded'] : [],
      currentAvailability ? LOOKUP_AVAILABILITY_ANALYSIS_KEYS : LEGACY_LOOKUP_AVAILABILITY_ANALYSIS_KEYS,
      'Lookup evidence availability analysis',
    );
    if (currentAvailability && availability.registryContactsExcluded !== true) {
      fail('Lookup evidence availability contact exclusion');
    }
    validateLookupEvidenceHomepageMetadata(availability, version);
    if (version !== LEGACY_LOOKUP_EVIDENCE_SCHEMA_VERSION
      && !isDeepStrictEqual(
        analysis.availability,
        currentAvailability
          ? projectLookupEvidenceAvailability(analysis.availability)
          : projectLookupEvidenceAvailabilityLegacy(analysis.availability),
      )) fail('Lookup evidence availability analysis');
  }
  if (analysis.idn !== null) {
    exactOptional(analysis.idn, [], LOOKUP_IDN_ANALYSIS_KEYS, 'Lookup evidence IDN analysis');
  }
  const registryInsights = record(analysis.registryInsights, 'Lookup evidence registry insights');
  const registryComparison = record(analysis.registryComparison, 'Lookup evidence registry comparison');
  validateLookupEvidenceRegistrarComparison(analysis.registrarPublicationComparison);
  if (version !== LEGACY_LOOKUP_EVIDENCE_SCHEMA_VERSION) {
    const rdap = record(sources.rdap, 'Lookup evidence RDAP source');
    const whois = record(sources.whois, 'Lookup evidence WHOIS source');
    const rdapParsed = ['success', 'partial'].includes(rdapDiagnosticStatus) ? rdap.parsed : null;
    const whoisParsed = ['complete', 'partial'].includes(whoisDiagnosticStatus) ? whois.parsed : null;
    const expectedComparison = compareRegistrySources(rdapParsed, whoisParsed, {
      rdapStatus: rdapDiagnosticStatus,
      whoisStatus: whoisDiagnosticStatus,
    });
    if (!isDeepStrictEqual(registryComparison, expectedComparison)) fail('Lookup evidence registry comparison derivation');

    const rebuiltInsights = buildRegistryInsights({
      rdapParsed,
      rdapStatus: rdapDiagnosticStatus,
      rdapFetchedAt: rdap.fetchedAt,
      whoisParsed,
      whoisStatus: whoisDiagnosticStatus,
      whoisQueriedAt: whois.queriedAt,
    });
    const expectedInsights = version >= LOOKUP_EVIDENCE_SCHEMA_VERSION
      ? projectLookupEvidenceRegistryInsights(rebuiltInsights)
      : rebuiltInsights;
    if (!isDeepStrictEqual(registryInsights, expectedInsights)) fail('Lookup evidence registry insight derivation');
    try { assertLookupEvidencePrivacySafeTree(root); } catch { fail('Lookup evidence privacy boundary'); }
  }
}

function validateIntegrity(
  value: unknown,
  label: string,
  version: unknown,
  legacyVersion: number,
  currentVersion: number,
  legacyExplicit = false,
): void {
  const explicit = version === currentVersion || (version === legacyVersion && legacyExplicit);
  if (version !== legacyVersion && version !== currentVersion) fail(label);
  const integrity = exact(value, explicit
    ? ['algorithm', 'canonicalization', 'digestSha256']
    : ['algorithm', 'digestSha256'], label);
  if (integrity.algorithm !== 'SHA-256') fail(label);
  if (explicit && integrity.canonicalization !== (version === currentVersion ? 'sorted-json-v2' : 'sorted-json-v1')) fail(label);
  digest(integrity.digestSha256, label);
}

function validateAcquisitionItem(value: unknown, label: string): string {
  const item = exact(value, ['id', 'label', 'state', 'detail', 'provenance'], label);
  const id = enumeration(item.id, ['availability', 'contacts', 'lifecycle', 'mail', 'nameservers', 'operations', 'policy_eligibility', 'policy_lifecycle', 'policy_transfer', 'tls', 'transfer', 'web'], label);
  enumeration(item.state, ['authoritative', 'observed', 'review', 'unavailable'], label);
  text(item.label, label, 200);
  text(item.detail, label, 2_000);
  text(item.provenance, label, 300);
  return id;
}

function validateAcquisition(value: UnknownRecord): void {
  const root = exact(value, ['schema', 'version', 'generatedAt', 'target', 'synthetic', 'evidenceObservedAt', 'analystReview', 'evidenceReview', 'limitations', 'integrity'], 'Acquisition decision packet');
  iso(root.generatedAt, 'Acquisition decision packet generatedAt');
  domain(root.target, 'Acquisition decision packet target');
  boolean(root.synthetic, 'Acquisition decision packet synthetic');
  iso(root.evidenceObservedAt, 'Acquisition decision packet evidenceObservedAt', true);
  const review = exact(root.analystReview, ['decision', 'rationale', 'reviewedChecks', 'outstandingChecks', 'state'], 'Acquisition analyst review');
  const decision = enumeration(review.decision, ACQUISITION_DECISIONS, 'Acquisition analyst review decision');
  text(review.rationale, 'Acquisition analyst review rationale', 2_000, true);
  const reviewed = strings(review.reviewedChecks, 'Acquisition reviewed checks', ACQUISITION_MANUAL_CHECKS.length, 40);
  const outstanding = strings(review.outstandingChecks, 'Acquisition outstanding checks', ACQUISITION_MANUAL_CHECKS.length, 40);
  const expectedReviewed = ACQUISITION_MANUAL_CHECKS.filter((item) => reviewed.includes(item));
  const expectedOutstanding = ACQUISITION_MANUAL_CHECKS.filter((item) => !reviewed.includes(item));
  if (!sameValues(reviewed, expectedReviewed) || !sameValues(outstanding, expectedOutstanding)) fail('Acquisition analyst review checks');
  const expectedState = decision === 'unresolved' || reviewed.length < ACQUISITION_MANUAL_CHECKS.length ? 'draft' : 'reviewed';
  if (review.state !== expectedState) fail('Acquisition analyst review state');
  const evidence = exact(root.evidenceReview, ['version', 'label', 'state', 'items', 'transitionDependencies', 'policyChecks', 'nextSteps', 'limitations'], 'Acquisition evidence review');
  if (evidence.version !== 2) fail('Acquisition evidence review');
  text(evidence.label, 'Acquisition evidence review label', 200);
  enumeration(evidence.state, ['incomplete', 'registered', 'review_transition', 'sale_signal', 'unregistered_observation'], 'Acquisition evidence review state');
  const expectedEvidenceIds = {
    items: ['availability', 'lifecycle', 'transfer', 'operations', 'contacts'],
    transitionDependencies: ['nameservers', 'web', 'mail', 'tls'],
    policyChecks: ['policy_eligibility', 'policy_lifecycle', 'policy_transfer'],
  } as const;
  for (const key of ['items', 'transitionDependencies', 'policyChecks'] as const) {
    const expected = expectedEvidenceIds[key];
    const values = array(evidence[key], `Acquisition evidence review ${key}`, expected.length, expected.length);
    const ids = values.map((item, index) => validateAcquisitionItem(item, `Acquisition evidence review ${key}[${index}]`));
    if (!sameValues(ids, expected)) fail(`Acquisition evidence review ${key}`);
  }
  strings(evidence.nextSteps, 'Acquisition next steps', 6, 600);
  strings(evidence.limitations, 'Acquisition evidence limitations', 12, 600);
  strings(root.limitations, 'Acquisition limitations', 8, 600);
  validateIntegrity(root.integrity, 'Acquisition integrity', root.version, 1, ACQUISITION_DECISION_PACKET_VERSION);
}

const CLAIM_PASSPORT_SOURCE_STATES = ['complete', 'not_found', 'partial', 'skipped', 'unavailable', 'unknown', 'unsupported'] as const;

function validateClaimPassportTarget(type: string, value: unknown): void {
  const candidate = text(value, 'Claim passport target', 253);
  if (type === 'domain') {
    domain(candidate, 'Claim passport target');
    return;
  }
  if (type === 'ipv4') {
    const parts = candidate.split('.');
    if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/u.test(part) || Number(part) > 255 || String(Number(part)) !== part)) fail('Claim passport target');
    return;
  }
  if (type === 'ipv6') {
    if (!candidate.includes(':') || /[\[\]%/?#@]/u.test(candidate)) fail('Claim passport target');
    try {
      const hostname = new URL(`http://[${candidate}]/`).hostname;
      const normalized = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
      if (normalized !== candidate) fail('Claim passport target');
    } catch { fail('Claim passport target'); }
    return;
  }
  if (!/^AS(?:[1-9]\d{0,9})$/u.test(candidate) || Number(candidate.slice(2)) > 4_294_967_295) fail('Claim passport target');
}

function validateLookupClaimPassport(value: UnknownRecord): void {
  const root = exact(value, ['schema', 'version', 'generatedAt', 'application', 'target', 'observation', 'claim', 'models', 'limitations', 'integrity'], 'Lookup claim passport');
  if (root.version !== LOOKUP_CLAIM_PASSPORT_VERSION) fail('Lookup claim passport');
  iso(root.generatedAt, 'Lookup claim passport generatedAt');
  const application = exact(root.application, ['name', 'version'], 'Lookup claim passport application');
  if (application.name !== 'WHOISleuth' || typeof application.version !== 'string'
    || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(application.version)) fail('Lookup claim passport application');
  const target = exact(root.target, ['type', 'value'], 'Lookup claim passport target');
  const type = enumeration(target.type, LOOKUP_CLAIM_PASSPORT_TARGET_TYPES, 'Lookup claim passport target');
  validateClaimPassportTarget(type, target.value);
  const observation = exact(root.observation, ['observedAt', 'lookupDepth'], 'Lookup claim passport observation');
  iso(observation.observedAt, 'Lookup claim passport observation', true);
  enumeration(observation.lookupDepth, ['fast', 'deep'], 'Lookup claim passport observation');
  const claim = exact(root.claim, ['id', 'label', 'state', 'conclusion', 'requiredEvidenceIds', 'missingEvidenceIds', 'requirements', 'limitations'], 'Lookup claim passport claim');
  enumeration(claim.id, LOOKUP_CLAIM_IDS, 'Lookup claim passport claim');
  text(claim.label, 'Lookup claim passport claim label', 160);
  text(claim.conclusion, 'Lookup claim passport claim conclusion', 600);
  const requirements = array(claim.requirements, 'Lookup claim passport requirements', MAX_LOOKUP_CLAIM_PASSPORT_REQUIREMENTS, 1);
  const requirementIds: string[] = [];
  const missingIds: string[] = [];
  const seen = new Set<string>();
  let observedCount = 0;
  let hasLimited = false;
  for (const [index, candidate] of requirements.entries()) {
    const item = exact(candidate, ['id', 'label', 'evidenceId', 'mode', 'state', 'observedAt', 'limitations'], `Lookup claim passport requirement ${index + 1}`);
    const id = enumeration(item.id, LOOKUP_CLAIM_REQUIREMENT_IDS, 'Lookup claim passport requirement id');
    if (seen.has(id)) fail('Lookup claim passport requirements');
    seen.add(id);
    requirementIds.push(id);
    text(item.label, 'Lookup claim passport requirement label', 160);
    if (item.evidenceId !== null && (typeof item.evidenceId !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/u.test(item.evidenceId))) fail('Lookup claim passport evidence id');
    enumeration(item.mode, ['network_collection', 'local_review'], 'Lookup claim passport requirement mode');
    const state = enumeration(item.state, CLAIM_PASSPORT_SOURCE_STATES, 'Lookup claim passport requirement state');
    if (state !== 'complete') missingIds.push(id);
    if (state !== 'skipped' && state !== 'unsupported' && state !== 'unknown') observedCount += 1;
    if (state === 'partial' || state === 'unavailable' || state === 'unknown') hasLimited = true;
    iso(item.observedAt, 'Lookup claim passport requirement observedAt', true);
    if (item.evidenceId === null && item.observedAt !== null) fail('Lookup claim passport requirement observedAt');
    strings(item.limitations, 'Lookup claim passport requirement limitations', 8, 400);
  }
  const required = strings(claim.requiredEvidenceIds, 'Lookup claim passport required evidence', MAX_LOOKUP_CLAIM_PASSPORT_REQUIREMENTS, 64);
  const missing = strings(claim.missingEvidenceIds, 'Lookup claim passport missing evidence', MAX_LOOKUP_CLAIM_PASSPORT_REQUIREMENTS, 64);
  if (!sameValues(required, requirementIds) || !sameValues(missing, missingIds)) fail('Lookup claim passport evidence identifiers');
  const expectedState = missingIds.length === 0 ? 'ready' : observedCount > 0 && hasLimited ? 'limited' : 'not_ready';
  if (claim.state !== expectedState) fail('Lookup claim passport claim state');
  strings(claim.limitations, 'Lookup claim passport claim limitations', MAX_LOOKUP_CLAIM_PASSPORT_LIMITATIONS, 400);
  const models = exact(root.models, ['claimReadiness', 'risk'], 'Lookup claim passport models');
  if (models.claimReadiness !== LOOKUP_CLAIM_READINESS_VERSION) fail('Lookup claim passport models');
  if (models.risk !== null) integer(models.risk, 'Lookup claim passport Risk model', 1, 1_000);
  strings(root.limitations, 'Lookup claim passport limitations', MAX_LOOKUP_CLAIM_PASSPORT_LIMITATIONS, 600);
  validateIntegrity(root.integrity, 'Lookup claim passport integrity', root.version, LOOKUP_CLAIM_PASSPORT_VERSION, LOOKUP_CLAIM_PASSPORT_VERSION);
}

const COMPARISON_STATES = ['conflicting', 'different', 'equal', 'missing', 'not_recorded', 'unavailable'] as const;
const SOURCE_STATES = ['complete', 'error', 'not_found', 'not_recorded', 'partial', 'skipped', 'unavailable', 'unsupported'] as const;
const DOMAIN_COMPARISON_ROW_IDS = [
  'registration', 'registrar', 'created', 'expires', 'nameservers', 'dns-a', 'dns-aaaa', 'dns-cname',
  'dns-caa', 'dnssec', 'ip-addresses', 'tls-source', 'certificate', 'tls-issuer', 'tls-spki', 'mail',
  'null-mx', 'spf', 'dmarc', 'website', 'page-title', 'favicon', 'tracking', 'password-field',
  'phishing-language', 'official-assets', 'technology', 'source-health',
] as const;

function validateDomainComparison(value: UnknownRecord): void {
  const root = exact(value, ['schema', 'version', 'generatedAt', 'comparison', 'integrity'], 'Domain comparison artefact');
  iso(root.generatedAt, 'Domain comparison generatedAt');
  const comparison = exact(root.comparison, ['version', 'leftDomain', 'rightDomain', 'observedAt', 'freshness', 'rows', 'counts', 'limitations'], 'Domain comparison');
  if (comparison.version !== 3) fail('Domain comparison');
  domain(comparison.leftDomain, 'Domain comparison left domain');
  domain(comparison.rightDomain, 'Domain comparison right domain');
  iso(comparison.observedAt, 'Domain comparison observedAt', true);
  const freshness = exact(comparison.freshness, ['state', 'ageDays'], 'Domain comparison freshness');
  enumeration(freshness.state, ['current', 'stale', 'unknown'], 'Domain comparison freshness');
  if (freshness.ageDays !== null) integer(freshness.ageDays, 'Domain comparison age', 0, 1_000_000);
  const rows = array(comparison.rows, 'Domain comparison rows', DOMAIN_COMPARISON_ROW_IDS.length, DOMAIN_COMPARISON_ROW_IDS.length);
  const counts = exact(comparison.counts, [...COMPARISON_STATES], 'Domain comparison counts');
  const actual = new Map<string, number>(COMPARISON_STATES.map((state) => [state, 0]));
  for (const [index, candidate] of rows.entries()) {
    const row = exact(candidate, ['id', 'category', 'label', 'left', 'right', 'state', 'method', 'source', 'leftSourceState', 'rightSourceState', 'observedAt', 'leftEvidenceHref', 'rightEvidenceHref', 'limitations'], `Domain comparison row ${index + 1}`);
    const id = text(row.id, 'Domain comparison row id', 80);
    if (id !== DOMAIN_COMPARISON_ROW_IDS[index]) fail('Domain comparison row order');
    enumeration(row.category, ['certificate', 'dns', 'identity', 'infrastructure', 'lifecycle', 'mail', 'registration', 'source', 'technology', 'web'], 'Domain comparison category');
    text(row.label, 'Domain comparison label', 120);
    text(row.left, 'Domain comparison left value', 2_000);
    text(row.right, 'Domain comparison right value', 2_000);
    const state = enumeration(row.state, COMPARISON_STATES, 'Domain comparison state');
    actual.set(state, (actual.get(state) ?? 0) + 1);
    text(row.method, 'Domain comparison method', 320);
    text(row.source, 'Domain comparison source', 80);
    enumeration(row.leftSourceState, SOURCE_STATES, 'Domain comparison left source state');
    enumeration(row.rightSourceState, SOURCE_STATES, 'Domain comparison right source state');
    iso(row.observedAt, 'Domain comparison row observedAt', true);
    if (row.observedAt !== comparison.observedAt) fail('Domain comparison row observedAt');
    if (typeof row.leftEvidenceHref !== 'string' || !/^(?:|#bulk-result-\d{1,4})$/u.test(row.leftEvidenceHref)) fail('Domain comparison evidence link');
    if (typeof row.rightEvidenceHref !== 'string' || !/^(?:|#bulk-result-\d{1,4})$/u.test(row.rightEvidenceHref)) fail('Domain comparison evidence link');
    strings(row.limitations, 'Domain comparison row limitations', 6, 320);
  }
  for (const state of COMPARISON_STATES) {
    if (integer(counts[state], `Domain comparison ${state} count`, 0, rows.length) !== actual.get(state)) fail('Domain comparison counts');
  }
  strings(comparison.limitations, 'Domain comparison limitations', 12, 600);
  validateIntegrity(root.integrity, 'Domain comparison integrity', root.version, 3, BULK_DOMAIN_COMPARISON_EXPORT_VERSION);
}

const MAIL_STATES = ['authenticated_mail', 'evidence_incomplete', 'mail_auth_gap', 'mail_auth_incomplete', 'no_explicit_mx', 'null_mx'] as const;

function validateSourceCoverage(value: unknown, label: string): void {
  const source = exact(value, ['source', 'state'], label);
  if (typeof source.source !== 'string' || !/^[a-z][a-z0-9_-]{0,39}$/u.test(source.source)) fail(label);
  enumeration(source.state, SOURCE_STATES.filter((state) => state !== 'not_recorded'), label);
}

function validateProfileContext(value: unknown, label: string): void {
  const context = exact(value, ['sourceState', 'activeProfileId', 'profileUpdatedAt', 'limitation'], label);
  enumeration(context.sourceState, ['mixed', 'ready', 'unavailable'], label);
  optionalText(context.activeProfileId, label, 128);
  iso(context.profileUpdatedAt, label, true);
  text(context.limitation, label, 300, true);
}

function validateMailExposure(value: UnknownRecord): void {
  const root = exact(value, ['schema', 'version', 'report', 'integrity'], 'Bulk mail exposure artefact');
  const report = exact(root.report, ['version', 'generatedAt', 'observedAt', 'baseline', 'rows', 'counts', 'profileContextUnevaluatedCount', 'limitations'], 'Bulk mail exposure report');
  if (report.version !== 1) fail('Bulk mail exposure report');
  iso(report.generatedAt, 'Bulk mail exposure generatedAt');
  iso(report.observedAt, 'Bulk mail exposure observedAt', true);
  const baseline = exact(report.baseline, ['profile', 'officialDomains', 'label', 'limitations'], 'Bulk mail exposure baseline');
  if (baseline.profile !== null) enumeration(baseline.profile, ['defensive_no_mail', 'parked', 'standard'], 'Bulk mail exposure baseline');
  const officialDomains = strings(baseline.officialDomains, 'Bulk mail exposure official domains', 20, 253);
  officialDomains.forEach((item) => domain(item, 'Bulk mail exposure official domain'));
  text(baseline.label, 'Bulk mail exposure baseline label', 200);
  strings(baseline.limitations, 'Bulk mail exposure baseline limitations', 8, 600);
  const rows = array(report.rows, 'Bulk mail exposure rows', MAX_BULK_MAIL_EXPOSURE_ROWS);
  const counts = exact(report.counts, [...MAIL_STATES], 'Bulk mail exposure counts');
  const actual = new Map<string, number>(MAIL_STATES.map((state) => [state, 0]));
  let unevaluated = 0;
  for (const [index, candidate] of rows.entries()) {
    const row = exact(candidate, ['domain', 'state', 'label', 'detail', 'baselineRelation', 'baselineDetail', 'mutationTypes', 'registration', 'sourceCoverage', 'profileContextState', 'profileContextLimitation', 'limitations'], `Bulk mail exposure row ${index + 1}`);
    domain(row.domain, 'Bulk mail exposure row domain');
    const state = enumeration(row.state, MAIL_STATES, 'Bulk mail exposure row state');
    actual.set(state, (actual.get(state) ?? 0) + 1);
    text(row.label, 'Bulk mail exposure row label', 200);
    text(row.detail, 'Bulk mail exposure row detail', 600);
    enumeration(row.baselineRelation, ['aligned', 'inconclusive', 'review'], 'Bulk mail exposure baseline relation');
    text(row.baselineDetail, 'Bulk mail exposure baseline detail', 600);
    strings(row.mutationTypes, 'Bulk mail exposure mutation types', 40, 120);
    text(row.registration, 'Bulk mail exposure registration', 160, true);
    array(row.sourceCoverage, 'Bulk mail exposure source coverage', 12).forEach((item, sourceIndex) => validateSourceCoverage(item, `Bulk mail exposure source ${sourceIndex + 1}`));
    const profileState = enumeration(row.profileContextState, ['mixed', 'ready', 'unavailable'], 'Bulk mail exposure profile context state');
    if (profileState !== 'ready') unevaluated += 1;
    text(row.profileContextLimitation, 'Bulk mail exposure profile context limitation', 300, true);
    strings(row.limitations, 'Bulk mail exposure row limitations', 6, 600);
  }
  for (const state of MAIL_STATES) {
    if (integer(counts[state], `Bulk mail exposure ${state} count`, 0, rows.length) !== actual.get(state)) fail('Bulk mail exposure counts');
  }
  const declaredUnevaluated = integer(report.profileContextUnevaluatedCount, 'Bulk mail exposure unevaluated count', 0, rows.length);
  if (declaredUnevaluated < unevaluated) fail('Bulk mail exposure unevaluated count');
  strings(report.limitations, 'Bulk mail exposure limitations', 12, 600);
  validateIntegrity(root.integrity, 'Bulk mail exposure integrity', root.version, 1, BULK_MAIL_EXPOSURE_EXPORT_VERSION);
}

function validateBulkView(value: unknown, label: string): void {
  const view = exact(value, ['primaryFilter', 'mutationFilter', 'signalFilters', 'sourceFilter', 'lifecycleFilter', 'ageFilter', 'mailFilter', 'registrarFilter', 'caseDispositionFilter', 'reviewStateFilter', 'groupBy', 'sortKey', 'sortDirection'], label);
  text(view.primaryFilter, label, 60);
  text(view.mutationFilter, label, 60, true);
  strings(view.signalFilters, label, 5, 40);
  text(view.sourceFilter, label, 60, true);
  text(view.lifecycleFilter, label, 60, true);
  text(view.ageFilter, label, 60, true);
  text(view.mailFilter, label, 60, true);
  text(view.registrarFilter, label, 200, true);
  text(view.caseDispositionFilter, label, 60, true);
  enumeration(view.reviewStateFilter, ['', 'unreviewed', 'reviewing', 'reviewed', 'deferred'], label);
  text(view.groupBy, label, 60, true);
  enumeration(view.sortKey, ['domain', 'availability', 'risk', 'opportunity', 'activity', 'registrar', 'mutation'], label);
  if (view.sortDirection !== 1 && view.sortDirection !== -1) fail(label);
}

function validateBulkReviewManifest(value: UnknownRecord): void {
  const root = exact(value, ['schema', 'version', 'generatedAt', 'observedAt', 'lookupProfile', 'selection', 'view', 'rows', 'limitations', 'integrity'], 'Bulk review manifest');
  iso(root.generatedAt, 'Bulk review manifest generatedAt');
  iso(root.observedAt, 'Bulk review manifest observedAt');
  enumeration(root.lookupProfile, ['deep', 'fast'], 'Bulk review manifest lookup profile');
  const selection = exact(root.selection, ['count', 'domains'], 'Bulk review manifest selection');
  const domains = strings(selection.domains, 'Bulk review manifest selected domains', 2_000, 253);
  domains.forEach((item) => domain(item, 'Bulk review manifest selected domain'));
  if (integer(selection.count, 'Bulk review manifest selection count', 0, 2_000) !== domains.length) fail('Bulk review manifest selection');
  validateBulkView(root.view, 'Bulk review manifest view');
  const rows = array(root.rows, 'Bulk review manifest rows', 2_000);
  for (const [index, candidate] of rows.entries()) {
    const row = exact(candidate, ['domain', 'reviewState', 'resultState', 'scanDepth', 'sourceCoverage', 'profileContext'], `Bulk review manifest row ${index + 1}`);
    domain(row.domain, 'Bulk review manifest row domain');
    enumeration(row.reviewState, ['unreviewed', 'reviewing', 'reviewed', 'deferred'], 'Bulk review manifest review state');
    enumeration(row.resultState, ['complete', 'error'], 'Bulk review manifest result state');
    enumeration(row.scanDepth, ['deep', 'fast'], 'Bulk review manifest scan depth');
    array(row.sourceCoverage, 'Bulk review manifest source coverage', 12).forEach((item, sourceIndex) => validateSourceCoverage(item, `Bulk review manifest source ${sourceIndex + 1}`));
    validateProfileContext(row.profileContext, 'Bulk review manifest profile context');
    if (domains[index] !== row.domain) fail('Bulk review manifest selection');
  }
  if (rows.length !== domains.length) fail('Bulk review manifest selection');
  strings(root.limitations, 'Bulk review manifest limitations', 8, 600);
  validateIntegrity(root.integrity, 'Bulk review manifest integrity', root.version, 1, BULK_REVIEW_MANIFEST_VERSION);
}

function validateInvestigationManifest(value: UnknownRecord): void {
  const root = exact(value, ['schema', 'version', 'generatedAt', 'application', 'workflow', 'configuration', 'artifacts', 'steps', 'summary', 'limitations', 'integrity'], 'Investigation manifest');
  iso(root.generatedAt, 'Investigation manifest generatedAt');
  const application = exact(root.application, ['name', 'version'], 'Investigation manifest application');
  if (application.name !== 'WHOISleuth CLI' || typeof application.version !== 'string'
    || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(application.version)) fail('Investigation manifest application');
  text(root.workflow, 'Investigation manifest workflow', 160);
  const configuration = exact(root.configuration, ['digestSha256'], 'Investigation manifest configuration');
  if (configuration.digestSha256 !== null) digest(configuration.digestSha256, 'Investigation manifest configuration');
  const artifacts = array(root.artifacts, 'Investigation manifest artifacts', MAX_INVESTIGATION_MANIFEST_ARTIFACTS, 1);
  const steps = array(root.steps, 'Investigation manifest steps', MAX_INVESTIGATION_MANIFEST_ARTIFACTS, 1);
  let totalBytes = 0;
  for (const [index, candidate] of artifacts.entries()) {
    const item = exact(candidate, ['sequence', 'id', 'schema', 'version', 'byteLength', 'contentDigestSha256', 'canonicalDigestSha256'], `Investigation manifest artifact ${index + 1}`);
    if (integer(item.sequence, 'Investigation manifest artifact sequence', 1, artifacts.length) !== index + 1
      || item.id !== `artifact-${index + 1}`) fail('Investigation manifest artifact order');
    if (item.schema !== null) text(item.schema, 'Investigation manifest artifact schema', 160);
    if (item.version !== null) integer(item.version, 'Investigation manifest artifact version', 1, 1_000);
    totalBytes += integer(item.byteLength, 'Investigation manifest artifact bytes', 1, 15 * 1024 * 1024);
    digest(item.contentDigestSha256, 'Investigation manifest content digest');
    digest(item.canonicalDigestSha256, 'Investigation manifest canonical digest');
    const step = exact(steps[index], ['sequence', 'artifactId', 'contentDigestSha256'], `Investigation manifest step ${index + 1}`);
    if (step.sequence !== item.sequence || step.artifactId !== item.id || step.contentDigestSha256 !== item.contentDigestSha256) fail('Investigation manifest step linkage');
  }
  const summary = exact(root.summary, ['artifactCount', 'totalBytes'], 'Investigation manifest summary');
  if (integer(summary.artifactCount, 'Investigation manifest artifact count', 1, MAX_INVESTIGATION_MANIFEST_ARTIFACTS) !== artifacts.length
    || integer(summary.totalBytes, 'Investigation manifest total bytes', 1, MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES) !== totalBytes) fail('Investigation manifest summary');
  strings(root.limitations, 'Investigation manifest limitations', 8, 600);
  validateIntegrity(root.integrity, 'Investigation manifest integrity', root.version, 1, INVESTIGATION_MANIFEST_VERSION);
}

function validateActionSummary(value: unknown, label: string): void {
  const summary = exact(value, ['total', 'active', 'submitted', 'acknowledged', 'resolved', 'closed', 'overdue', 'followUpDue', 'withOutcome', 'latestOutcomes'], label);
  const total = integer(summary.total, label, 0, MAX_CASE_ACTIONS);
  for (const key of ['active', 'submitted', 'acknowledged', 'resolved', 'closed', 'overdue', 'followUpDue', 'withOutcome'] as const) integer(summary[key], label, 0, total);
  if (Number(summary.resolved) + Number(summary.closed) + Number(summary.active) !== total) fail(label);
  const outcomes = array(summary.latestOutcomes, label, 5);
  for (const candidate of outcomes) {
    const outcome = exact(candidate, ['actionId', 'recipient', 'state', 'outcome', 'updatedAt'], label);
    text(outcome.actionId, label, 64);
    text(outcome.recipient, label, 320);
    enumeration(outcome.state, CASE_ACTION_STATES, label);
    text(outcome.outcome, label, 2_000);
    iso(outcome.updatedAt, label);
  }
}

const CASE_RESPONSE_PREFLIGHT_IDS = [
  'required_incident_fields',
  'evidence_pins',
  'analyst_decision',
  'recipient_route',
  'profile_recipient',
  'case_disposition',
  'evidence_freshness',
  'contradictory_evidence',
  'action_tracking',
] as const;

function expectedObservationAge(observedAt: string, generatedAt: string): Readonly<{
  ageSeconds: number;
  band: 'future_or_clock_skew' | 'one_to_seven_days' | 'over_seven_days' | 'under_24_hours';
  refreshRecommended: boolean;
}> {
  const ageSeconds = Math.floor((Date.parse(generatedAt) - Date.parse(observedAt)) / 1_000);
  if (ageSeconds < -300) return { ageSeconds, band: 'future_or_clock_skew', refreshRecommended: true };
  if (ageSeconds < 86_400) return { ageSeconds: Math.max(0, ageSeconds), band: 'under_24_hours', refreshRecommended: false };
  if (ageSeconds <= 604_800) return { ageSeconds, band: 'one_to_seven_days', refreshRecommended: false };
  return { ageSeconds, band: 'over_seven_days', refreshRecommended: true };
}

function validateCaseResponsePacket(value: UnknownRecord): void {
  const root = exact(value, ['schema', 'schemaVersion', 'generatedAt', 'reviewRequired', 'submissionPerformed', 'profile', 'case', 'incident', 'contacts', 'preflight', 'escalationHistory', 'provenance', 'integrity'], 'Case-response packet');
  if (root.schemaVersion !== LEGACY_CASE_RESPONSE_PACKET_VERSION && root.schemaVersion !== CASE_RESPONSE_PACKET_VERSION) fail('Case-response packet');
  iso(root.generatedAt, 'Case-response packet generatedAt');
  if (root.reviewRequired !== true || root.submissionPerformed !== false) fail('Case-response packet review state');
  const profile = exact(root.profile, ['id', 'label', 'audience', 'subject', 'checklist', 'evidenceOrder', 'includedEvidence', 'excludedEvidence', 'redactions', 'attachments', 'followUpFields'], 'Case-response profile');
  const profileId = enumeration(profile.id, RESPONSE_PACKET_PROFILE_IDS, 'Case-response profile id');
  text(profile.label, 'Case-response profile label', 200);
  text(profile.audience, 'Case-response profile audience', 300);
  text(profile.subject, 'Case-response profile subject', 500);
  for (const key of ['checklist', 'evidenceOrder', 'includedEvidence', 'excludedEvidence', 'redactions', 'attachments', 'followUpFields'] as const) strings(profile[key], `Case-response profile ${key}`, 24, 500);
  const caseRecord = exact(root.case, ['id', 'domain', 'status', 'disposition', 'updatedAt'], 'Case-response case');
  text(caseRecord.id, 'Case-response case id', 128);
  domain(caseRecord.domain, 'Case-response case domain');
  text(caseRecord.status, 'Case-response case status', 80);
  text(caseRecord.disposition, 'Case-response case disposition', 80);
  iso(caseRecord.updatedAt, 'Case-response case updatedAt');
  const incident = exact(root.incident, ['category', 'affectedParty', 'abusiveUrls', 'observedHarm', 'observedAt'], 'Case-response incident');
  text(incident.category, 'Case-response category', 80);
  text(incident.affectedParty, 'Case-response affected party', 200);
  const urls = strings(incident.abusiveUrls, 'Case-response abusive URLs', MAX_ABUSIVE_URLS, 2_048);
  if (!urls.length || urls.some((item) => { try { return !['http:', 'https:'].includes(new URL(item).protocol); } catch { return true; } })) fail('Case-response abusive URLs');
  text(incident.observedHarm, 'Case-response observed harm', 2_000);
  iso(incident.observedAt, 'Case-response observedAt');
  const selectedProfile = RESPONSE_PACKET_PROFILES.find((candidate) => candidate.id === profileId);
  if (!selectedProfile
    || profile.label !== selectedProfile.label
    || profile.audience !== selectedProfile.audience
    || profile.subject !== `${selectedProfile.subjectPrefix}: ${caseRecord.domain} (${incident.category})`
    || !sameValues(profile.checklist as unknown[], selectedProfile.checklist)
    || !sameValues(profile.evidenceOrder as unknown[], selectedProfile.evidenceOrder)
    || !sameValues(profile.includedEvidence as unknown[], selectedProfile.includedEvidence)
    || !sameValues(profile.excludedEvidence as unknown[], selectedProfile.excludedEvidence)
    || !sameValues(profile.redactions as unknown[], selectedProfile.redactions)
    || !sameValues(profile.attachments as unknown[], selectedProfile.attachments)
    || !sameValues(profile.followUpFields as unknown[], selectedProfile.followUpFields)) fail('Case-response profile');
  const canonicalUrls = urls.map((item) => {
    try {
      const parsed = new URL(item);
      return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password
        ? parsed.toString()
        : null;
    } catch { return null; }
  });
  if (canonicalUrls.some((item, index) => item === null || item !== urls[index])
    || new Set(urls).size !== urls.length) fail('Case-response abusive URLs');
  const contacts = array(root.contacts, 'Case-response contacts', MAX_RESPONSE_CONTACTS);
  const contactKeys = new Set<string>();
  for (const candidate of contacts) {
    const contact = exact(candidate, ['kind', 'contact', 'source', 'limitations'], 'Case-response contact');
    const kind = enumeration(contact.kind, RESPONSE_CONTACT_KINDS, 'Case-response contact kind');
    const contactValue = text(contact.contact, 'Case-response contact value', MAX_RESPONSE_RECIPIENT_LENGTH);
    const contactKey = `${kind}\u0000${contactValue.toLowerCase()}`;
    if (contactKeys.has(contactKey)) fail('Case-response contacts');
    contactKeys.add(contactKey);
    text(contact.source, 'Case-response contact source', MAX_RESPONSE_LABEL_LENGTH);
    strings(contact.limitations, 'Case-response contact limitations', MAX_RESPONSE_LIMITATIONS, MAX_RESPONSE_LIMITATION_LENGTH);
  }
  const preflight = exact(root.preflight, ['version', 'status', 'canExport', 'counts', 'checks', 'actionSummary'], 'Case-response preflight');
  if (preflight.version !== 1) fail('Case-response preflight');
  const checks = array(preflight.checks, 'Case-response preflight checks', CASE_RESPONSE_PREFLIGHT_IDS.length, CASE_RESPONSE_PREFLIGHT_IDS.length);
  const actualCounts = { block: 0, caution: 0, pass: 0 };
  for (const [index, candidate] of checks.entries()) {
    const check = exact(candidate, ['id', 'label', 'state', 'detail'], 'Case-response preflight check');
    const id = text(check.id, 'Case-response preflight id', 80);
    if (id !== CASE_RESPONSE_PREFLIGHT_IDS[index]) fail('Case-response preflight check order');
    text(check.label, 'Case-response preflight label', 200);
    const state = enumeration(check.state, ['block', 'caution', 'pass'], 'Case-response preflight state');
    actualCounts[state] += 1;
    text(check.detail, 'Case-response preflight detail', 1_000);
  }
  const counts = exact(preflight.counts, ['block', 'caution', 'pass'], 'Case-response preflight counts');
  for (const state of ['block', 'caution', 'pass'] as const) {
    if (integer(counts[state], 'Case-response preflight count', 0, checks.length) !== actualCounts[state]) fail('Case-response preflight counts');
  }
  const expectedStatus = actualCounts.block ? 'needs_input' : actualCounts.caution ? 'review_cautions' : 'ready_for_review';
  if (preflight.status !== expectedStatus || preflight.canExport !== (actualCounts.block === 0)) fail('Case-response preflight status');
  validateActionSummary(preflight.actionSummary, 'Case-response action summary');
  const history = array(root.escalationHistory, 'Case-response escalation history', MAX_RESPONSE_ACTION_HISTORY);
  for (const candidate of history) {
    const action = exact(candidate, ['type', 'recipient', 'contactSource', 'state', 'reference', 'outcome', 'createdAt', 'updatedAt'], 'Case-response escalation action');
    enumeration(action.type, CASE_ACTION_TYPES, 'Case-response action type');
    text(action.recipient, 'Case-response action recipient', 320, true);
    text(action.contactSource, 'Case-response action source', 120, true);
    enumeration(action.state, CASE_ACTION_STATES, 'Case-response action state');
    optionalText(action.reference, 'Case-response action reference', 500);
    optionalText(action.outcome, 'Case-response action outcome', 2_000);
    iso(action.createdAt, 'Case-response action createdAt');
    iso(action.updatedAt, 'Case-response action updatedAt');
  }
  const provenance = exact(root.provenance, ['latestEvidenceCapturedAt', 'evidencePinCount', 'decisionCount', 'assertionCount', 'observationAge', 'limitations'], 'Case-response provenance');
  iso(provenance.latestEvidenceCapturedAt, 'Case-response evidence time', true);
  integer(provenance.evidencePinCount, 'Case-response evidence pin count', 0, MAX_CASE_EVIDENCE_PINS);
  integer(provenance.decisionCount, 'Case-response decision count', 0, MAX_CASE_DECISIONS);
  integer(provenance.assertionCount, 'Case-response assertion count', 0, MAX_CASE_ASSERTIONS);
  const age = exact(provenance.observationAge, ['ageSeconds', 'band', 'refreshRecommended'], 'Case-response observation age');
  integer(age.ageSeconds, 'Case-response observation age seconds', Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  enumeration(age.band, ['future_or_clock_skew', 'one_to_seven_days', 'over_seven_days', 'under_24_hours'], 'Case-response observation age band');
  boolean(age.refreshRecommended, 'Case-response refresh recommendation');
  const expectedAge = expectedObservationAge(incident.observedAt as string, root.generatedAt as string);
  if (age.ageSeconds !== expectedAge.ageSeconds || age.band !== expectedAge.band
    || age.refreshRecommended !== expectedAge.refreshRecommended) fail('Case-response observation age');
  strings(provenance.limitations, 'Case-response limitations', 8, 600);
  const integrity = exact(root.integrity, ['algorithm', 'canonicalization', 'scope', 'digestSha256'], 'Case-response integrity');
  if (integrity.algorithm !== 'SHA-256'
    || integrity.canonicalization !== (root.schemaVersion === CASE_RESPONSE_PACKET_VERSION ? 'sorted-json-v2' : 'sorted-json-v1')
    || integrity.scope !== 'packet excluding integrity') fail('Case-response integrity');
  if (typeof integrity.digestSha256 !== 'string' || !HEX_DIGEST_RE.test(integrity.digestSha256)) fail('Case-response integrity');
}

function validateBriefFact(value: unknown, label: string): void {
  const fact = exact(value, ['label', 'value', 'detail', 'provenance'], label);
  text(fact.label, label, 320);
  text(fact.value, label, 2_000);
  text(fact.detail, label, 1_000, true);
  const provenance = exact(fact.provenance, ['sources', 'observedAt', 'fieldFamilies', 'normalization', 'completeness', 'limitations', 'conflicts', 'decisionImpact'], label);
  strings(provenance.sources, label, 8, 320);
  text(provenance.observedAt, label, 64);
  strings(provenance.fieldFamilies, label, 8, 320);
  text(provenance.normalization, label, 320);
  text(provenance.completeness, label, 320);
  strings(provenance.limitations, label, 8, 320);
  strings(provenance.conflicts, label, 8, 320);
  text(provenance.decisionImpact, label, 320);
}

function validateDecisionEntry(value: unknown, label: string): void {
  const entry = exact(value, ['id', 'state', 'importance', 'title', 'detail', 'sources', 'href'], label);
  text(entry.id, label, 80);
  enumeration(entry.state, ['conflict', 'uncertain'], label);
  enumeration(entry.importance, ['high', 'medium', 'low'], label);
  text(entry.title, label, 320);
  text(entry.detail, label, 1_000);
  strings(entry.sources, label, 12, 320);
  if (typeof entry.href !== 'string' || !/^#[^\u0000-\u001f\u007f]{1,160}$/u.test(entry.href)) fail(label);
}

function validateLegacyBrief(value: unknown): void {
  const brief = exact(value, ['schema', 'schemaVersion', 'generatedAt', 'target', 'targetType', 'task', 'taskLabel', 'question', 'summary', 'observation', 'verifiedFacts', 'contradictions', 'unknowns', 'nextActions', 'relationships', 'limitations'], 'Investigation capsule brief');
  if (brief.schema !== LOOKUP_INVESTIGATION_BRIEF_SCHEMA
    || brief.schemaVersion !== LEGACY_LOOKUP_INVESTIGATION_BRIEF_VERSION) fail('Investigation capsule brief');
  iso(brief.generatedAt, 'Investigation capsule brief generatedAt');
  text(brief.target, 'Investigation capsule brief target', 253);
  text(brief.targetType, 'Investigation capsule brief target type', 40);
  enumeration(brief.task, ['general', 'acquisition', 'brand', 'incident', 'owned'], 'Investigation capsule brief task');
  text(brief.taskLabel, 'Investigation capsule brief task label', 320);
  text(brief.question, 'Investigation capsule brief question', 320);
  text(brief.summary, 'Investigation capsule brief summary', 500);
  const observation = exact(brief.observation, ['observedAt', 'evidenceAgeDays', 'completeSources', 'limitedSources', 'freshnessPolicy'], 'Investigation capsule observation');
  iso(observation.observedAt, 'Investigation capsule observation time', true);
  if (observation.evidenceAgeDays !== null) integer(observation.evidenceAgeDays, 'Investigation capsule evidence age', 0, 1_000_000);
  integer(observation.completeSources, 'Investigation capsule complete sources', 0, 100);
  integer(observation.limitedSources, 'Investigation capsule limited sources', 0, 100);
  const policy = exact(observation.freshnessPolicy, ['version', 'id', 'task', 'thresholdsDays'], 'Investigation capsule freshness policy');
  if (policy.version !== 1) fail('Investigation capsule freshness policy');
  enumeration(policy.id, ['task-default', 'analyst-custom'], 'Investigation capsule freshness policy');
  if (policy.task !== brief.task) fail('Investigation capsule freshness policy');
  const thresholds = exact(policy.thresholdsDays, ['registration', 'network', 'web'], 'Investigation capsule freshness thresholds');
  for (const key of ['registration', 'network', 'web'] as const) integer(thresholds[key], 'Investigation capsule freshness threshold', 0, 3650);
  array(brief.verifiedFacts, 'Investigation capsule verified facts', 12).forEach((item, index) => validateBriefFact(item, `Investigation capsule fact ${index + 1}`));
  array(brief.contradictions, 'Investigation capsule contradictions', 24).forEach((item, index) => validateDecisionEntry(item, `Investigation capsule contradiction ${index + 1}`));
  array(brief.unknowns, 'Investigation capsule unknowns', 24).forEach((item, index) => validateDecisionEntry(item, `Investigation capsule unknown ${index + 1}`));
  for (const [index, candidate] of array(brief.nextActions, 'Investigation capsule next actions', 6).entries()) {
    const action = exact(candidate, ['id', 'label', 'reason', 'expectedOutcome', 'href', 'priority'], `Investigation capsule next action ${index + 1}`);
    text(action.id, 'Investigation capsule next action id', 80);
    text(action.label, 'Investigation capsule next action label', 320);
    text(action.reason, 'Investigation capsule next action reason', 500);
    text(action.expectedOutcome, 'Investigation capsule next action outcome', 500);
    if (typeof action.href !== 'string' || !/^#[^\u0000-\u001f\u007f]{1,160}$/u.test(action.href)) fail('Investigation capsule next action href');
    enumeration(action.priority, ['high', 'medium', 'low'], 'Investigation capsule next action priority');
  }
  const relationships = exact(brief.relationships, ['nodes', 'edges', 'truncated', 'kinds'], 'Investigation capsule relationship summary');
  integer(relationships.nodes, 'Investigation capsule relationship node count', 0, 72);
  integer(relationships.edges, 'Investigation capsule relationship edge count', 0, 120);
  boolean(relationships.truncated, 'Investigation capsule relationship truncation');
  strings(relationships.kinds, 'Investigation capsule relationship kinds', 12, 320);
  strings(brief.limitations, 'Investigation capsule brief limitations', 20, 320);
}

type ProjectionCollectionValidation = Readonly<{
  total: number;
  displayed: number;
  omitted: number;
  items: unknown[];
}>;

function validateProjectionCollection(
  value: unknown,
  label: string,
  totalMaximum: number,
  displayedMaximum: number,
  validateItem: (item: unknown, index: number) => void,
): ProjectionCollectionValidation {
  const collection = exact(value, ['total', 'displayed', 'omitted', 'items'], label);
  const total = integer(collection.total, `${label} total`, 0, totalMaximum);
  const displayed = integer(collection.displayed, `${label} displayed`, 0, displayedMaximum);
  const omitted = integer(collection.omitted, `${label} omitted`, 0, totalMaximum);
  const items = array(collection.items, `${label} items`, displayedMaximum);
  if (displayed > total || omitted !== total - displayed || items.length !== displayed) fail(label);
  items.forEach(validateItem);
  return { total, displayed, omitted, items };
}

function validateSortedUnique(values: readonly string[], label: string): void {
  for (let index = 0; index < values.length; index += 1) {
    if (index > 0 && values[index - 1]! >= values[index]!) fail(label);
  }
}

function validateDecisionIdentifier(value: unknown, label: string): string {
  const identifier = text(value, label, 200);
  if (!/^[a-z0-9](?:[a-z0-9._:-]{0,199})$/u.test(identifier)) fail(label);
  return identifier;
}

function validateProjectedStringCollection(
  value: unknown,
  label: string,
  totalMaximum: number,
  displayedMaximum: number,
  textMaximum: number,
): ProjectionCollectionValidation {
  const projection = validateProjectionCollection(
    value,
    label,
    totalMaximum,
    displayedMaximum,
    (item) => { text(item, `${label} item`, textMaximum); },
  );
  validateSortedUnique(projection.items as string[], label);
  return projection;
}

function validateDecisionFactSource(value: unknown, label: string): string {
  const source = exact(value, [
    'id',
    'label',
    'provenance',
    'evidenceState',
    'observedAt',
    'references',
    'limitations',
  ], label);
  const id = validateDecisionIdentifier(source.id, `${label} id`);
  text(source.label, `${label} label`, 160);
  enumeration(source.provenance, DECISION_FACT_PROVENANCE_STATES, `${label} provenance`);
  enumeration(source.evidenceState, DECISION_FACT_EVIDENCE_STATES, `${label} evidence state`);
  iso(source.observedAt, `${label} observation time`, true);
  validateProjectedStringCollection(
    source.references,
    `${label} references`,
    MAX_DECISION_FACT_REFERENCES,
    MAX_DECISION_FACT_PROJECTION_SOURCE_REFERENCES,
    200,
  );
  validateProjectedStringCollection(
    source.limitations,
    `${label} limitations`,
    MAX_DECISION_FACT_LIMITATIONS,
    MAX_DECISION_FACT_PROJECTION_SOURCE_LIMITATIONS,
    280,
  );
  return id;
}

function validateProjectedDecisionFact(value: unknown, label: string): Readonly<{
  id: string;
  consistency: string;
}> {
  const fact = exact(value, [
    'version',
    'id',
    'question',
    'conclusion',
    'importance',
    'evidenceState',
    'completeness',
    'freshness',
    'consistency',
    'dependencies',
    'sourceReferences',
    'sources',
    'contradictions',
    'limitations',
    'safeNextActions',
  ], label);
  if (fact.version !== DECISION_FACT_VERSION) fail(`${label} version`);
  const id = validateDecisionIdentifier(fact.id, `${label} id`);
  text(fact.question, `${label} question`, 320);
  text(fact.conclusion, `${label} conclusion`, 640);
  enumeration(fact.importance, ['high', 'medium', 'low'], `${label} importance`);
  const evidenceState = enumeration(fact.evidenceState, DECISION_FACT_EVIDENCE_STATES, `${label} evidence state`);
  if (fact.completeness !== decisionFactCompleteness(evidenceState)) fail(`${label} completeness`);
  enumeration(fact.freshness, DECISION_FACT_FRESHNESS_STATES, `${label} freshness`);
  const consistency = enumeration(fact.consistency, DECISION_FACT_CONSISTENCY_STATES, `${label} consistency`);
  const dependencies = validateProjectedStringCollection(
    fact.dependencies,
    `${label} dependencies`,
    MAX_DECISION_FACT_CONTRIBUTORS,
    MAX_DECISION_FACT_PROJECTION_SOURCES,
    200,
  );
  dependencies.items.forEach((item) => validateDecisionIdentifier(item, `${label} dependency`));
  validateProjectedStringCollection(
    fact.sourceReferences,
    `${label} source references`,
    MAX_DECISION_FACT_REFERENCES,
    MAX_DECISION_FACT_PROJECTION_REFERENCES,
    200,
  );
  const sourceIds: string[] = [];
  const sources = validateProjectionCollection(
    fact.sources,
    `${label} sources`,
    MAX_DECISION_FACT_CONTRIBUTORS,
    MAX_DECISION_FACT_PROJECTION_SOURCES,
    (item, index) => { sourceIds.push(validateDecisionFactSource(item, `${label} source ${index + 1}`)); },
  );
  validateSortedUnique(sourceIds, `${label} sources`);
  if (dependencies.total !== sources.total
    || dependencies.displayed !== sources.displayed
    || dependencies.omitted !== sources.omitted
    || !sameValues(dependencies.items, sourceIds)) fail(`${label} dependencies`);
  validateProjectedStringCollection(
    fact.contradictions,
    `${label} contradictions`,
    MAX_DECISION_FACT_CONTRADICTIONS,
    MAX_DECISION_FACT_PROJECTION_CONTRADICTIONS,
    640,
  );
  validateProjectedStringCollection(
    fact.limitations,
    `${label} limitations`,
    MAX_DECISION_FACT_LIMITATIONS,
    MAX_DECISION_FACT_PROJECTION_LIMITATIONS,
    280,
  );
  const actionIds: string[] = [];
  validateProjectionCollection(
    fact.safeNextActions,
    `${label} safe next actions`,
    MAX_DECISION_FACT_NEXT_ACTIONS,
    MAX_DECISION_FACT_PROJECTION_NEXT_ACTIONS,
    (candidate, index) => {
      const action = exact(candidate, ['id', 'label', 'reason', 'expectedOutcome', 'href', 'importance'], `${label} safe next action ${index + 1}`);
      actionIds.push(validateDecisionIdentifier(action.id, `${label} safe next action id`));
      text(action.label, `${label} safe next action label`, 160);
      text(action.reason, `${label} safe next action reason`, 320);
      text(action.expectedOutcome, `${label} safe next action outcome`, 320);
      if (typeof action.href !== 'string' || !/^#[a-z0-9](?:[a-z0-9._:-]{0,159})$/u.test(action.href)) fail(`${label} safe next action href`);
      enumeration(action.importance, ['high', 'medium', 'low'], `${label} safe next action importance`);
    },
  );
  validateSortedUnique(actionIds, `${label} safe next actions`);
  return { id, consistency };
}

function validateDecisionFactProjection(value: unknown): void {
  const projection = exact(value, [
    'version',
    'total',
    'displayed',
    'omitted',
    'contradictory',
    'unresolved',
    'facts',
  ], 'Investigation capsule Decision Fact projection');
  if (projection.version !== DECISION_FACT_PROJECTION_VERSION) fail('Investigation capsule Decision Fact projection');
  const total = integer(projection.total, 'Investigation capsule Decision Fact total', 0, MAX_DECISION_FACTS);
  const displayed = integer(projection.displayed, 'Investigation capsule Decision Fact displayed', 0, MAX_DECISION_FACT_PROJECTION_FACTS);
  const omitted = integer(projection.omitted, 'Investigation capsule Decision Fact omitted', 0, MAX_DECISION_FACTS);
  const contradictory = integer(projection.contradictory, 'Investigation capsule Decision Fact contradictory', 0, total);
  const unresolved = integer(projection.unresolved, 'Investigation capsule Decision Fact unresolved', 0, total);
  const facts = array(projection.facts, 'Investigation capsule Decision Facts', MAX_DECISION_FACT_PROJECTION_FACTS);
  if (displayed > total || omitted !== total - displayed || facts.length !== displayed
    || contradictory + unresolved > total) fail('Investigation capsule Decision Fact projection');
  const factIds: string[] = [];
  let displayedContradictory = 0;
  let displayedUnresolved = 0;
  for (const [index, candidate] of facts.entries()) {
    const validated = validateProjectedDecisionFact(candidate, `Investigation capsule Decision Fact ${index + 1}`);
    factIds.push(validated.id);
    if (validated.consistency === 'contradictory') displayedContradictory += 1;
    if (validated.consistency === 'unknown') displayedUnresolved += 1;
  }
  validateSortedUnique(factIds, 'Investigation capsule Decision Facts');
  if (contradictory < displayedContradictory || unresolved < displayedUnresolved
    || (omitted === 0 && (contradictory !== displayedContradictory || unresolved !== displayedUnresolved))) {
    fail('Investigation capsule Decision Fact state counts');
  }
  if (new TextEncoder().encode(JSON.stringify(projection)).byteLength > MAX_DECISION_FACT_PROJECTION_BYTES) {
    fail('Investigation capsule Decision Fact projection byte limit');
  }
}

function validateCurrentBrief(value: unknown): void {
  const brief = exact(value, ['schema', 'schemaVersion', 'generatedAt', 'target', 'targetType', 'task', 'taskLabel', 'question', 'summary', 'observation', 'decisionFacts', 'relationships', 'limitations'], 'Investigation capsule brief');
  if (brief.schema !== LOOKUP_INVESTIGATION_BRIEF_SCHEMA
    || brief.schemaVersion !== LOOKUP_INVESTIGATION_BRIEF_VERSION) fail('Investigation capsule brief');
  iso(brief.generatedAt, 'Investigation capsule brief generatedAt');
  text(brief.target, 'Investigation capsule brief target', 253);
  text(brief.targetType, 'Investigation capsule brief target type', 40);
  enumeration(brief.task, ['general', 'acquisition', 'brand', 'incident', 'owned'], 'Investigation capsule brief task');
  text(brief.taskLabel, 'Investigation capsule brief task label', 320);
  text(brief.question, 'Investigation capsule brief question', 320);
  text(brief.summary, 'Investigation capsule brief summary', 500);
  const observation = exact(brief.observation, ['observedAt', 'evidenceAgeDays', 'completeSources', 'limitedSources', 'freshnessPolicy'], 'Investigation capsule observation');
  iso(observation.observedAt, 'Investigation capsule observation time', true);
  if (observation.evidenceAgeDays !== null) integer(observation.evidenceAgeDays, 'Investigation capsule evidence age', 0, 1_000_000);
  integer(observation.completeSources, 'Investigation capsule complete sources', 0, 100);
  integer(observation.limitedSources, 'Investigation capsule limited sources', 0, 100);
  const policy = exact(observation.freshnessPolicy, ['version', 'id', 'task', 'thresholdsDays'], 'Investigation capsule freshness policy');
  if (policy.version !== 1) fail('Investigation capsule freshness policy');
  enumeration(policy.id, ['task-default', 'analyst-custom'], 'Investigation capsule freshness policy');
  if (policy.task !== brief.task) fail('Investigation capsule freshness policy');
  const thresholds = exact(policy.thresholdsDays, ['registration', 'network', 'web'], 'Investigation capsule freshness thresholds');
  for (const key of ['registration', 'network', 'web'] as const) integer(thresholds[key], 'Investigation capsule freshness threshold', 0, 3650);
  validateDecisionFactProjection(brief.decisionFacts);
  const relationships = exact(brief.relationships, ['nodes', 'edges', 'truncated', 'kinds'], 'Investigation capsule relationship summary');
  integer(relationships.nodes, 'Investigation capsule relationship node count', 0, 72);
  integer(relationships.edges, 'Investigation capsule relationship edge count', 0, 120);
  boolean(relationships.truncated, 'Investigation capsule relationship truncation');
  strings(relationships.kinds, 'Investigation capsule relationship kinds', 12, 320);
  strings(brief.limitations, 'Investigation capsule brief limitations', 20, 320);
  if (new TextEncoder().encode(JSON.stringify(brief)).byteLength > MAX_LOOKUP_INVESTIGATION_BRIEF_BYTES) {
    fail('Investigation capsule brief byte limit');
  }
}

function validateGraph(value: unknown): void {
  const graph = exact(value, ['version', 'targetId', 'nodes', 'edges', 'sources', 'truncated', 'limitations'], 'Investigation capsule graph');
  if (graph.version !== LOOKUP_ASSET_GRAPH_VERSION) fail('Investigation capsule graph');
  text(graph.targetId, 'Investigation capsule graph target', 160);
  const nodes = array(graph.nodes, 'Investigation capsule graph nodes', 72, 1);
  const nodeIds = new Set<string>();
  for (const candidate of nodes) {
    const node = exact(candidate, ['id', 'label', 'kind', 'detail'], 'Investigation capsule graph node');
    const id = text(node.id, 'Investigation capsule graph node id', 160);
    if (nodeIds.has(id)) fail('Investigation capsule graph node ids');
    nodeIds.add(id);
    text(node.label, 'Investigation capsule graph node label', 320);
    enumeration(node.kind, ['address', 'certificate', 'hostname', 'identity', 'issuer', 'key', 'network', 'observation', 'origin', 'prefix', 'registrar', 'target', 'tracker'], 'Investigation capsule graph node kind');
    text(node.detail, 'Investigation capsule graph node detail', 500, true);
  }
  if (!nodeIds.has(graph.targetId as string)) fail('Investigation capsule graph target');
  const sourceIds = new Set<string>();
  for (const candidate of array(graph.sources, 'Investigation capsule graph sources', 32)) {
    const source = exact(candidate, ['id', 'label', 'href', 'observedAt', 'completeness', 'limitations'], 'Investigation capsule graph source');
    const id = text(source.id, 'Investigation capsule graph source id', 160);
    if (sourceIds.has(id)) fail('Investigation capsule graph source ids');
    sourceIds.add(id);
    text(source.label, 'Investigation capsule graph source label', 320);
    if (typeof source.href !== 'string' || !/^#[^\u0000-\u001f\u007f]{1,160}$/u.test(source.href)) fail('Investigation capsule graph source href');
    iso(source.observedAt, 'Investigation capsule graph source observedAt', true);
    enumeration(source.completeness, ['complete', 'partial', 'unknown'], 'Investigation capsule graph source completeness');
    strings(source.limitations, 'Investigation capsule graph source limitations', 5, 320);
  }
  const edges = array(graph.edges, 'Investigation capsule graph edges', 120);
  const edgeIds = new Set<string>();
  for (const candidate of edges) {
    const edge = exactOptional(candidate, ['id', 'sourceId', 'source', 'target', 'kind', 'label', 'sourceLabel', 'observedAt', 'completeness', 'limitations', 'lenses', 'href'], ['boundary'], 'Investigation capsule graph edge');
    const id = text(edge.id, 'Investigation capsule graph edge id', 160);
    if (edgeIds.has(id)) fail('Investigation capsule graph edge ids');
    edgeIds.add(id);
    const sourceId = text(edge.sourceId, 'Investigation capsule graph edge source id', 160);
    if (!sourceIds.has(sourceId)) fail('Investigation capsule graph edge source');
    if (!nodeIds.has(edge.source as string) || !nodeIds.has(edge.target as string)) fail('Investigation capsule graph edge endpoints');
    text(edge.kind, 'Investigation capsule graph edge kind', 160);
    text(edge.label, 'Investigation capsule graph edge label', 320);
    text(edge.sourceLabel, 'Investigation capsule graph edge source label', 320);
    iso(edge.observedAt, 'Investigation capsule graph edge observedAt', true);
    enumeration(edge.completeness, ['complete', 'partial', 'unknown'], 'Investigation capsule graph edge completeness');
    strings(edge.limitations, 'Investigation capsule graph edge limitations', 5, 320);
    strings(edge.lenses, 'Investigation capsule graph edge lenses', 4, 40).forEach((lens) => enumeration(lens, ['all', 'identity', 'delegation', 'certificate'], 'Investigation capsule graph edge lens'));
    if (typeof edge.href !== 'string' || !/^#[^\u0000-\u001f\u007f]{1,160}$/u.test(edge.href)) fail('Investigation capsule graph edge href');
    if (edge.boundary !== undefined) enumeration(edge.boundary, ['external', 'reviewed_profile', 'same_origin', 'same_registrable_domain', 'unresolved'], 'Investigation capsule graph edge boundary');
  }
  boolean(graph.truncated, 'Investigation capsule graph truncation');
  strings(graph.limitations, 'Investigation capsule graph limitations', 20, 320);
}

function validateAnalystRecords(value: unknown): void {
  if (value === null) return;
  const records = exact(value, ['caseId', 'status', 'disposition', 'decisions', 'assertions'], 'Investigation capsule analyst records');
  text(records.caseId, 'Investigation capsule case id', 128);
  text(records.status, 'Investigation capsule case status', 80);
  text(records.disposition, 'Investigation capsule case disposition', 80);
  for (const candidate of array(records.decisions, 'Investigation capsule decisions', MAX_CASE_DECISIONS)) {
    const decision = exact(candidate, ['id', 'summary', 'rationale', 'evidencePinIds', 'createdAt'], 'Investigation capsule decision');
    text(decision.id, 'Investigation capsule decision id', 64);
    text(decision.summary, 'Investigation capsule decision summary', 500);
    text(decision.rationale, 'Investigation capsule decision rationale', 2_000, true);
    strings(decision.evidencePinIds, 'Investigation capsule decision evidence pins', MAX_DECISION_PIN_REFERENCES, 64);
    iso(decision.createdAt, 'Investigation capsule decision createdAt');
  }
  for (const candidate of array(records.assertions, 'Investigation capsule assertions', MAX_CASE_ASSERTIONS)) {
    const assertion = exact(candidate, ['id', 'kind', 'statement', 'rationale', 'evidencePinIds', 'state', 'createdAt', 'updatedAt'], 'Investigation capsule assertion');
    text(assertion.id, 'Investigation capsule assertion id', 64);
    text(assertion.kind, 'Investigation capsule assertion kind', 80);
    text(assertion.statement, 'Investigation capsule assertion statement', 2_000);
    optionalText(assertion.rationale, 'Investigation capsule assertion rationale', 2_000);
    strings(assertion.evidencePinIds, 'Investigation capsule assertion evidence pins', MAX_DECISION_PIN_REFERENCES, 64);
    text(assertion.state, 'Investigation capsule assertion state', 80);
    iso(assertion.createdAt, 'Investigation capsule assertion createdAt');
    iso(assertion.updatedAt, 'Investigation capsule assertion updatedAt');
  }
}

export function validateInvestigationCapsuleStructure(value: UnknownRecord): void {
  const root = exact(value, ['schema', 'schemaVersion', 'generatedAt', 'application', 'target', 'sourceContracts', 'investigationBrief', 'graphSnapshot', 'analystRecords', 'integrity', 'limitations'], 'Investigation capsule');
  if (root.schemaVersion !== LEGACY_INVESTIGATION_CAPSULE_VERSION
    && root.schemaVersion !== PREVIOUS_INVESTIGATION_CAPSULE_VERSION
    && root.schemaVersion !== INVESTIGATION_CAPSULE_VERSION) fail('Investigation capsule');
  iso(root.generatedAt, 'Investigation capsule generatedAt');
  const application = exact(root.application, ['name', 'version'], 'Investigation capsule application');
  if (application.name !== 'WHOISleuth' || typeof application.version !== 'string'
    || !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(application.version)) fail('Investigation capsule application');
  const target = exact(root.target, ['value', 'type'], 'Investigation capsule target');
  text(target.value, 'Investigation capsule target value', 253);
  text(target.type, 'Investigation capsule target type', 40);
  const contracts = array(root.sourceContracts, 'Investigation capsule source contracts', 4, 3);
  const byId = new Map<string, UnknownRecord>();
  for (const candidate of contracts) {
    const contract = exact(candidate, ['id', 'schema', 'version', 'digest', 'embedded'], 'Investigation capsule source contract');
    const id = enumeration(contract.id, ['lookup-evidence', 'investigation-brief', 'asset-graph', 'analyst-records'], 'Investigation capsule source contract id');
    if (byId.has(id)) fail('Investigation capsule source contracts');
    byId.set(id, contract);
    text(contract.schema, 'Investigation capsule source schema', 120);
    integer(contract.version, 'Investigation capsule source version', 0, 10_000);
    digest(contract.digest, 'Investigation capsule source digest');
    boolean(contract.embedded, 'Investigation capsule embedded source');
  }
  const expectedContractIds = root.analystRecords === null
    ? ['lookup-evidence', 'investigation-brief', 'asset-graph']
    : ['lookup-evidence', 'investigation-brief', 'asset-graph', 'analyst-records'];
  const expectedBriefVersion = root.schemaVersion === INVESTIGATION_CAPSULE_VERSION
    ? LOOKUP_INVESTIGATION_BRIEF_VERSION
    : LEGACY_LOOKUP_INVESTIGATION_BRIEF_VERSION;
  if (!sameValues(contracts.map((candidate) => (candidate as UnknownRecord).id), expectedContractIds)) fail('Investigation capsule source contracts');
  if (!byId.has('lookup-evidence') || !byId.has('investigation-brief') || !byId.has('asset-graph')
    || byId.get('lookup-evidence')?.embedded !== false
    || byId.get('investigation-brief')?.schema !== LOOKUP_INVESTIGATION_BRIEF_SCHEMA
    || byId.get('investigation-brief')?.version !== expectedBriefVersion
    || byId.get('investigation-brief')?.embedded !== true
    || byId.get('asset-graph')?.schema !== LOOKUP_ASSET_GRAPH_SCHEMA
    || byId.get('asset-graph')?.version !== LOOKUP_ASSET_GRAPH_VERSION
    || byId.get('asset-graph')?.embedded !== true
    || (byId.has('analyst-records') && (byId.get('analyst-records')?.schema !== INVESTIGATION_CAPSULE_ANALYST_RECORDS_SCHEMA
      || byId.get('analyst-records')?.version !== INVESTIGATION_CAPSULE_ANALYST_RECORDS_VERSION
      || byId.get('analyst-records')?.embedded !== true))) fail('Investigation capsule source contracts');
  if (root.schemaVersion === INVESTIGATION_CAPSULE_VERSION) validateCurrentBrief(root.investigationBrief);
  else validateLegacyBrief(root.investigationBrief);
  validateGraph(root.graphSnapshot);
  validateAnalystRecords(root.analystRecords);
  const brief = root.investigationBrief as UnknownRecord;
  const graph = root.graphSnapshot as UnknownRecord;
  if (target.value !== brief.target || target.type !== brief.targetType
    || graph.targetId === undefined
    || (brief.relationships as UnknownRecord).nodes !== (graph.nodes as unknown[]).length
    || (brief.relationships as UnknownRecord).edges !== (graph.edges as unknown[]).length) fail('Investigation capsule projection linkage');
  const wholeIntegrity = root.schemaVersion !== LEGACY_INVESTIGATION_CAPSULE_VERSION;
  const integrity = exact(root.integrity, wholeIntegrity
    ? ['algorithm', 'canonicalization', 'scope', 'briefDigest', 'graphDigest', 'analystRecordsDigest', 'digestSha256']
    : ['algorithm', 'briefDigest', 'graphDigest', 'analystRecordsDigest'], 'Investigation capsule integrity');
  if (integrity.algorithm !== 'SHA-256') fail('Investigation capsule integrity');
  if (wholeIntegrity) {
    if (integrity.canonicalization !== 'sorted-json-v2' || integrity.scope !== 'capsule excluding integrity') fail('Investigation capsule integrity');
    digest(integrity.digestSha256, 'Investigation capsule digest');
  }
  digest(integrity.briefDigest, 'Investigation capsule brief digest');
  digest(integrity.graphDigest, 'Investigation capsule graph digest');
  if (integrity.analystRecordsDigest !== null) digest(integrity.analystRecordsDigest, 'Investigation capsule analyst digest');
  if (byId.get('investigation-brief')?.digest !== integrity.briefDigest
    || byId.get('asset-graph')?.digest !== integrity.graphDigest
    || (root.analystRecords === null) !== (integrity.analystRecordsDigest === null)
    || (root.analystRecords === null) !== !byId.has('analyst-records')
    || (byId.get('analyst-records')?.digest ?? null) !== integrity.analystRecordsDigest) fail('Investigation capsule digest linkage');
  strings(root.limitations, 'Investigation capsule limitations', 8, 600);
}

const DNS_TYPES = ['A', 'AAAA', 'CAA', 'CDNSKEY', 'CDS', 'CNAME', 'CSYNC', 'HTTPS', 'MX', 'NS', 'SRV', 'SVCB', 'TLSA', 'TXT'] as const;

function validateReviewMatrix(value: unknown, label: string): void {
  for (const [rowIndex, candidate] of array(value, label, 500).entries()) {
    const row = exact(candidate, ['owner', 'type', 'state', 'observations'], `${label} row ${rowIndex + 1}`);
    text(row.owner, `${label} owner`, 253);
    enumeration(row.type, DNS_TYPES, `${label} type`);
    const observations = array(row.observations, `${label} observations`, 16);
    let complete = 0;
    const signatures = new Set<string>();
    for (const observationCandidate of observations) {
      const observation = exact(observationCandidate, ['label', 'source', 'state', 'values', 'ttlRange'], `${label} observation`);
      text(observation.label, `${label} observation label`, 120);
      text(observation.source, `${label} observation source`, 240);
      const state = enumeration(observation.state, ['observed', 'partial', 'unavailable'], `${label} observation state`);
      const values = strings(observation.values, `${label} observation values`, 500, 16_384);
      if (state === 'observed') { complete += 1; signatures.add(JSON.stringify(values)); }
      if (observation.ttlRange !== null) {
        const range = exact(observation.ttlRange, ['minimum', 'maximum'], `${label} TTL range`);
        const minimum = integer(range.minimum, `${label} minimum TTL`, 0, 0x7fff_ffff);
        const maximum = integer(range.maximum, `${label} maximum TTL`, minimum, 0x7fff_ffff);
        if (maximum < minimum) fail(`${label} TTL range`);
      }
    }
    const expected = complete < 2 ? 'insufficient' : signatures.size === 1 ? 'aligned' : 'different';
    if (row.state !== expected) fail(`${label} state`);
  }
}

function validateDomainChangeReview(value: unknown, label: string): UnknownRecord {
  const review = exact(value, ['schema', 'version', 'generatedAt', 'domain', 'state', 'authoritativeRecordMatrix', 'resolverDivergenceMatrix', 'dnssecAutomation', 'acmeDependencies', 'certificate', 'services', 'hsts', 'gate', 'limitations'], label);
  if (review.schema !== 'whoisleuth.domain-change.review' || review.version !== 1) fail(label);
  iso(review.generatedAt, `${label} generatedAt`);
  domain(review.domain, `${label} domain`);
  enumeration(review.state, ['ready', 'review'], `${label} state`);
  validateReviewMatrix(review.authoritativeRecordMatrix, `${label} authority matrix`);
  validateReviewMatrix(review.resolverDivergenceMatrix, `${label} resolver matrix`);
  const automation = exact(review.dnssecAutomation, ['state', 'cdsObserved', 'cdnskeyObserved', 'csyncObserved', 'conflictingTypes', 'detail'], `${label} DNSSEC automation`);
  enumeration(automation.state, ['not_observed', 'conflict', 'partial', 'review_ready'], `${label} DNSSEC automation`);
  boolean(automation.cdsObserved, `${label} CDS observed`);
  boolean(automation.cdnskeyObserved, `${label} CDNSKEY observed`);
  boolean(automation.csyncObserved, `${label} CSYNC observed`);
  strings(automation.conflictingTypes, `${label} conflicting types`, 3, 16).forEach((item) => enumeration(item, ['CDS', 'CDNSKEY', 'CSYNC'], `${label} conflicting type`));
  text(automation.detail, `${label} DNSSEC detail`, 600);
  for (const candidate of array(review.acmeDependencies, `${label} ACME dependencies`, 64)) {
    const dependency = exact(candidate, ['method', 'owner', 'target', 'provider', 'state'], `${label} ACME dependency`);
    enumeration(dependency.method, ['dns-01', 'http-01', 'tls-alpn-01'], `${label} ACME method`);
    text(dependency.owner, `${label} ACME owner`, 253);
    optionalText(dependency.target, `${label} ACME target`, 253);
    optionalText(dependency.provider, `${label} ACME provider`, 120);
    enumeration(dependency.state, ['confirmed', 'partial', 'unknown'], `${label} ACME state`);
  }
  const certificate = exact(review.certificate, ['state', 'continuity', 'findings'], `${label} certificate`);
  enumeration(certificate.state, ['not_supplied', 'observed', 'partial', 'unavailable'], `${label} certificate state`);
  enumeration(certificate.continuity, ['unknown', 'retained', 'changes'], `${label} certificate continuity`);
  strings(certificate.findings, `${label} certificate findings`, 8, 600);
  for (const candidate of array(review.services, `${label} services`, 1_000)) {
    const service = exact(candidate, ['owner', 'value', 'source', 'state', 'observedAt'], `${label} service`);
    text(service.owner, `${label} service owner`, 253);
    text(service.value, `${label} service value`, 16_384);
    text(service.source, `${label} service source`, 240);
    enumeration(service.state, ['observed', 'partial', 'unavailable'], `${label} service state`);
    iso(service.observedAt, `${label} service observedAt`);
  }
  if (review.hsts !== null) {
    const hsts = exact(review.hsts, ['state', 'observedAt', 'header', 'preloadState', 'source'], `${label} HSTS`);
    enumeration(hsts.state, ['observed', 'partial', 'unavailable'], `${label} HSTS state`);
    iso(hsts.observedAt, `${label} HSTS observedAt`);
    optionalText(hsts.header, `${label} HSTS header`, 1_024);
    enumeration(hsts.preloadState, ['listed', 'not_listed', 'unavailable'], `${label} HSTS preload`);
    text(hsts.source, `${label} HSTS source`, 240);
  }
  const gate = exact(review.gate, ['pass', 'reasons'], `${label} gate`);
  boolean(gate.pass, `${label} gate`);
  const reasons = strings(gate.reasons, `${label} gate reasons`, 2_000, 600);
  if (gate.pass !== (reasons.length === 0) || review.state !== (gate.pass ? 'ready' : 'review')) fail(`${label} gate`);
  strings(review.limitations, `${label} limitations`, 8, 600);
  return review;
}

function validatePlannedAssurance(value: unknown, label: string): UnknownRecord {
  const assurance = exact(value, ['schema', 'version', 'generatedAt', 'result', 'limitations'], label);
  if (assurance.schema !== 'whoisleuth.domain-assurance' || assurance.version !== 2) fail(label);
  iso(assurance.generatedAt, `${label} generatedAt`);
  const result = exact(assurance.result, ['kind', 'domain', 'reference', 'window', 'milestones', 'rollbackCriteria', 'postChangeChecks', 'review'], `${label} result`);
  if (result.kind !== 'planned-change') fail(`${label} result`);
  domain(result.domain, `${label} domain`);
  text(result.reference, `${label} reference`, 120);
  const window = exact(result.window, ['startsAt', 'endsAt'], `${label} window`);
  iso(window.startsAt, `${label} startsAt`);
  iso(window.endsAt, `${label} endsAt`);
  if (Date.parse(window.endsAt as string) <= Date.parse(window.startsAt as string)) fail(`${label} window`);
  const ids = new Set<string>();
  for (const candidate of array(result.milestones, `${label} milestones`, 24, 1)) {
    const item = exact(candidate, ['id', 'label', 'expectedBy', 'evidenceSource', 'state', 'observedAt', 'evidenceReference'], `${label} milestone`);
    const id = text(item.id, `${label} milestone id`, 64);
    if (ids.has(id)) fail(`${label} item ids`); ids.add(id);
    text(item.label, `${label} milestone label`, 180);
    iso(item.expectedBy, `${label} milestone expectedBy`);
    text(item.evidenceSource, `${label} milestone source`, 120);
    const state = enumeration(item.state, ['missed', 'not_checked', 'observed', 'planned'], `${label} milestone state`);
    iso(item.observedAt, `${label} milestone observedAt`, true);
    optionalText(item.evidenceReference, `${label} milestone reference`, 300);
    if (['observed', 'missed'].includes(state) !== (item.observedAt !== null && item.evidenceReference !== null)) fail(`${label} milestone evidence`);
  }
  for (const candidate of array(result.rollbackCriteria, `${label} rollback criteria`, 16, 1)) {
    const item = exact(candidate, ['id', 'condition', 'owner', 'state'], `${label} rollback criterion`);
    const id = text(item.id, `${label} rollback id`, 64);
    if (ids.has(id)) fail(`${label} item ids`); ids.add(id);
    text(item.condition, `${label} rollback condition`, 240);
    text(item.owner, `${label} rollback owner`, 120);
    enumeration(item.state, ['met', 'not_checked', 'not_met'], `${label} rollback state`);
  }
  for (const candidate of array(result.postChangeChecks, `${label} post-change checks`, 24, 1)) {
    const item = exact(candidate, ['id', 'label', 'expectedState', 'evidenceSource', 'state', 'evidenceReference'], `${label} post-change check`);
    const id = text(item.id, `${label} post-change id`, 64);
    if (ids.has(id)) fail(`${label} item ids`); ids.add(id);
    text(item.label, `${label} post-change label`, 180);
    text(item.expectedState, `${label} expected state`, 240);
    text(item.evidenceSource, `${label} post-change source`, 120);
    const state = enumeration(item.state, ['matched', 'not_checked', 'unexpected'], `${label} post-change state`);
    optionalText(item.evidenceReference, `${label} post-change reference`, 300);
    if ((state === 'not_checked') !== (item.evidenceReference === null)) fail(`${label} post-change evidence`);
  }
  const review = exact(result.review, ['state', 'reasons'], `${label} review`);
  enumeration(review.state, ['incomplete', 'needs_review', 'ready'], `${label} review state`);
  const reasons = strings(review.reasons, `${label} review reasons`, 20, 600);
  if ((review.state === 'ready') !== (reasons.length === 0)) fail(`${label} review`);
  strings(assurance.limitations, `${label} limitations`, 8, 600);
  return assurance;
}

function expectedDomainChangeSummary(
  before: UnknownRecord,
  after: UnknownRecord,
): Array<Readonly<{ owner: string; type: string; beforeValues: string[]; afterValues: string[] }>> {
  const rows = (review: UnknownRecord) => new Map(
    (review.authoritativeRecordMatrix as UnknownRecord[]).map((row) => [`${row.owner}\u0000${row.type}`, row]),
  );
  const beforeRows = rows(before);
  const afterRows = rows(after);
  const keys = [...new Set([...beforeRows.keys(), ...afterRows.keys()])].sort();
  return keys.slice(0, 500).flatMap((key) => {
    const left = beforeRows.get(key);
    const right = afterRows.get(key);
    const values = (row: UnknownRecord | undefined) => [...new Set(
      ((row?.observations as UnknownRecord[] | undefined) ?? [])
        .flatMap((observation) => observation.values as string[]),
    )].sort();
    const beforeValues = values(left);
    const afterValues = values(right);
    if (sameValues(beforeValues, afterValues)) return [];
    const [owner, type] = key.split('\u0000');
    return [{ owner: owner ?? '', type: type ?? '', beforeValues, afterValues }];
  });
}

function validateDomainChangePacket(value: UnknownRecord): void {
  const root = exact(value, ['schema', 'version', 'generatedAt', 'domain', 'reference', 'state', 'gate', 'summary', 'evidence', 'limitations', 'integrity'], 'Domain change packet');
  iso(root.generatedAt, 'Domain change packet generatedAt');
  domain(root.domain, 'Domain change packet domain');
  text(root.reference, 'Domain change packet reference', 200);
  enumeration(root.state, ['ready', 'review'], 'Domain change packet state');
  const gate = exact(root.gate, ['pass', 'reasons'], 'Domain change packet gate');
  boolean(gate.pass, 'Domain change packet gate');
  const gateReasons = strings(gate.reasons, 'Domain change packet gate reasons', 100, 700);
  if (gate.pass !== (gateReasons.length === 0) || root.state !== (gate.pass ? 'ready' : 'review')) fail('Domain change packet gate');
  const summary = exact(root.summary, ['changedAuthoritativeRecordSets', 'preChangeState', 'postChangeState', 'assuranceState'], 'Domain change packet summary');
  const changed = array(summary.changedAuthoritativeRecordSets, 'Domain change packet changes', 500);
  for (const candidate of changed) {
    const item = exact(candidate, ['owner', 'type', 'beforeValues', 'afterValues'], 'Domain change packet changed record set');
    text(item.owner, 'Domain change packet changed owner', 253);
    enumeration(item.type, DNS_TYPES, 'Domain change packet changed type');
    strings(item.beforeValues, 'Domain change packet before values', 500, 16_384);
    strings(item.afterValues, 'Domain change packet after values', 500, 16_384);
  }
  enumeration(summary.preChangeState, ['ready', 'review'], 'Domain change packet pre-change state');
  enumeration(summary.postChangeState, ['ready', 'review'], 'Domain change packet post-change state');
  enumeration(summary.assuranceState, ['incomplete', 'needs_review', 'ready'], 'Domain change packet assurance state');
  const evidence = exact(root.evidence, ['preChange', 'postChange', 'assurance'], 'Domain change packet evidence');
  const pre = validateDomainChangeReview(evidence.preChange, 'Domain change packet pre-change review');
  const post = validateDomainChangeReview(evidence.postChange, 'Domain change packet post-change review');
  const assurance = validatePlannedAssurance(evidence.assurance, 'Domain change packet assurance');
  const assuranceResult = assurance.result as UnknownRecord;
  if (pre.generatedAt !== root.generatedAt || post.generatedAt !== root.generatedAt || assurance.generatedAt !== root.generatedAt
    || pre.domain !== root.domain || post.domain !== root.domain || assuranceResult.domain !== root.domain
    || pre.state !== summary.preChangeState || post.state !== summary.postChangeState
    || (assuranceResult.review as UnknownRecord).state !== summary.assuranceState) fail('Domain change packet evidence linkage');
  const expectedReasons = [
    ...(pre.gate as UnknownRecord).reasons as string[],
  ].map((reason) => `Pre-change evidence: ${reason}`);
  expectedReasons.push(
    ...((post.gate as UnknownRecord).reasons as string[]).map((reason) => `Post-change evidence: ${reason}`),
    ...(((assuranceResult.review as UnknownRecord).reasons as string[]).map((reason) => `Change plan: ${reason}`)),
  );
  const boundedReasons = expectedReasons.slice(0, 100);
  if (!sameValues(gateReasons, boundedReasons)
    || gate.pass !== (boundedReasons.length === 0)
    || root.state !== (boundedReasons.length === 0 ? 'ready' : 'review')) fail('Domain change packet gate');
  const expectedChanges = expectedDomainChangeSummary(pre, post);
  if (changed.length !== expectedChanges.length || changed.some((candidate, index) => {
    const item = candidate as UnknownRecord;
    const expected = expectedChanges[index]!;
    return item.owner !== expected.owner || item.type !== expected.type
      || !sameValues(item.beforeValues as unknown[], expected.beforeValues)
      || !sameValues(item.afterValues as unknown[], expected.afterValues);
  })) fail('Domain change packet summary');
  strings(root.limitations, 'Domain change packet limitations', 8, 600);
  validateIntegrity(root.integrity, 'Domain change packet integrity', root.version, 1, DOMAIN_CHANGE_PACKET_VERSION);
}

export function validateSignedDigestArtifactStructure(schema: string, value: UnknownRecord): void {
  if (value.schema !== schema) fail('Signed review artefact');
  if (schema === ACQUISITION_DECISION_PACKET_SCHEMA) validateAcquisition(value);
  else if (schema === LOOKUP_CLAIM_PASSPORT_SCHEMA) validateLookupClaimPassport(value);
  else if (schema === BULK_DOMAIN_COMPARISON_SCHEMA) validateDomainComparison(value);
  else if (schema === BULK_MAIL_EXPOSURE_SCHEMA) validateMailExposure(value);
  else if (schema === BULK_REVIEW_MANIFEST_SCHEMA) validateBulkReviewManifest(value);
  else if (schema === DOMAIN_CONTROL_MANIFEST_SCHEMA) {
    try { normalizeDomainControlManifestDocument(value); } catch { fail('Domain control manifest'); }
  }
  else if (schema === DOMAIN_CHANGE_PACKET_SCHEMA) validateDomainChangePacket(value);
  else if (schema === INVESTIGATION_MANIFEST_SCHEMA) validateInvestigationManifest(value);
  else fail('Signed review artefact');
}

export function validateOfflineArtifactStructure(schema: string, value: UnknownRecord): void {
  if (schema === CASE_RESPONSE_PACKET_SCHEMA) validateCaseResponsePacket(value);
  else if (schema === INVESTIGATION_CAPSULE_SCHEMA) validateInvestigationCapsuleStructure(value);
  else if (schema === LOOKUP_EVIDENCE_SCHEMA) validateLookupEvidenceArtifactStructure(value);
  else validateSignedDigestArtifactStructure(schema, value);
}
