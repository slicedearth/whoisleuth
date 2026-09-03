import { isDeepStrictEqual } from 'node:util';

import {
  assertLookupEvidencePrivacySafeTree,
  assertLookupEvidencePortableTree,
  LOOKUP_EVIDENCE_SCHEMA,
  LOOKUP_EVIDENCE_SCHEMA_VERSION,
  PRIVACY_MINIMIZED_LOOKUP_EVIDENCE_SCHEMA_VERSION,
  V1_PUBLIC_LOOKUP_EVIDENCE_SCHEMA_VERSION,
  projectLookupEvidenceAvailability,
  projectLookupEvidenceAvailabilityPublic,
  projectLookupEvidenceQuery,
  projectLookupEvidenceRdapPublication,
  projectLookupEvidenceRegistryInsights,
  projectLookupEvidenceWhoisPublication,
  SUPPORTED_LOOKUP_EVIDENCE_SCHEMA_VERSIONS,
} from '../../lib/evidence-export.mts';
import {
  registrarStandingObservedBy,
  resolveRegistrarIanaId,
  validRegistrarStanding,
} from '../../lib/registrar-standing-contract.mts';
import { compareRegistrySources } from '../../lib/registry-comparison.mts';
import { buildRegistryInsights } from '../../lib/registry-insights.mts';
import { WHOISLEUTH_SOURCE_REPOSITORY_URL } from '../../lib/project-metadata.mts';
import {
  validHttpDeliveryMetadata,
  validPagePublicationMetadata,
} from '../../lib/homepage-metadata-contract.mts';
import {
  HEX_DIGEST_RE,
  SEMANTIC_VERSION_RE,
  absoluteUrl,
  array,
  boolean,
  domain,
  enumeration,
  exact,
  exactOptional,
  fail,
  integer,
  iso,
  nullableRecord,
  optionalText,
  record,
  strings,
  text,
  type UnknownRecord,
} from './structure-primitives.mts';

type LookupEvidenceDiagnosticStates = Readonly<{
  rdap: string;
  whois: string;
  reverseDns: Readonly<{ status: string; complete: boolean; truncated: boolean }> | null;
  network: string | null;
}>;

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

const PUBLIC_LOOKUP_AVAILABILITY_ANALYSIS_KEYS = [
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

const LOOKUP_AVAILABILITY_ANALYSIS_KEYS = PUBLIC_LOOKUP_AVAILABILITY_ANALYSIS_KEYS.filter(
  (key) => !['registrar', 'registrant', 'abuse'].includes(key),
);

const LOOKUP_IDN_ANALYSIS_KEYS = [
  'version', 'mappingVersion', 'asciiDomain', 'unicodeDomain', 'hasIdn',
  'scripts', 'labels', 'mixedScript', 'skeleton', 'referenceMatches', 'findings',
  'truncated', 'limitations',
] as const;

const LOOKUP_REGISTRAR_COMPARISON_STATUSES = [
  'equivalent', 'conflict', 'registry_only', 'registrar_only',
  'registry_redacted', 'registrar_redacted', 'registry_unavailable',
  'registrar_unavailable', 'registry_incomplete', 'registrar_incomplete',
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
  if (version < PRIVACY_MINIMIZED_LOOKUP_EVIDENCE_SCHEMA_VERSION && (publicationPresent || deliveryPresent)) {
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
      validateLookupEvidenceRdapAttempt(item, `Lookup evidence RDAP attempt ${index + 1}`);
    });
    return 'error';
  }
  const complete = exact(source, version >= PRIVACY_MINIMIZED_LOOKUP_EVIDENCE_SCHEMA_VERSION
    ? ['status', 'endpoint', 'transportSecurity', 'httpStatus', 'fetchedAt', 'attempts', 'parsed']
    : ['status', 'endpoint', 'transportSecurity', 'httpStatus', 'fetchedAt', 'attempts', 'parsed', 'raw'], 'Lookup evidence RDAP source');
  const status = enumeration(complete.status, ['success', 'partial', 'not_found', 'unsupported', 'skipped', 'disabled'], 'Lookup evidence RDAP status');
  let endpoint: URL | null = null;
  if (complete.endpoint !== null) endpoint = absoluteUrl(complete.endpoint, 'Lookup evidence RDAP endpoint', ['http:', 'https:']);
  if (complete.transportSecurity !== null) enumeration(complete.transportSecurity, ['http', 'https'], 'Lookup evidence RDAP transport');
  if (endpoint && complete.transportSecurity !== endpoint.protocol.slice(0, -1)) fail('Lookup evidence RDAP transport');
  if (!endpoint && complete.transportSecurity !== null) fail('Lookup evidence RDAP transport');
  if (complete.httpStatus !== null) integer(complete.httpStatus, 'Lookup evidence RDAP HTTP status', 100, 599);
  iso(complete.fetchedAt, 'Lookup evidence RDAP fetchedAt', true);
  array(complete.attempts, 'Lookup evidence RDAP attempts', 16).forEach((item, index) => {
    validateLookupEvidenceRdapAttempt(item, `Lookup evidence RDAP attempt ${index + 1}`);
  });
  nullableRecord(complete.parsed, 'Lookup evidence RDAP parsed data');
  if (version < PRIVACY_MINIMIZED_LOOKUP_EVIDENCE_SCHEMA_VERSION) nullableRecord(complete.raw, 'Lookup evidence RDAP raw data');
  if (version >= PRIVACY_MINIMIZED_LOOKUP_EVIDENCE_SCHEMA_VERSION
    && !isDeepStrictEqual(complete.parsed, projectLookupEvidenceRdapPublication(complete.parsed))) {
    fail('Lookup evidence RDAP portable publication');
  }
  if (status === 'success' && complete.parsed === null) fail('Lookup evidence RDAP publication');
  if (!['success', 'partial'].includes(status)
    && (complete.parsed !== null || (version < PRIVACY_MINIMIZED_LOOKUP_EVIDENCE_SCHEMA_VERSION && complete.raw !== null))) fail('Lookup evidence RDAP unavailable publication');
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
  const status = enumeration(complete.status, ['complete', 'partial', 'not_found', 'unsupported', 'skipped', 'disabled'], 'Lookup evidence WHOIS status');
  iso(complete.queriedAt, 'Lookup evidence WHOIS queriedAt', true);
  optionalText(complete.authoritativeHop, 'Lookup evidence WHOIS authoritative hop', 253);
  optionalText(complete.failedHop, 'Lookup evidence WHOIS failed hop', 253);
  optionalText(complete.conflictingHop, 'Lookup evidence WHOIS conflicting hop', 253);
  nullableRecord(complete.parsed, 'Lookup evidence WHOIS parsed data');
  if (version >= PRIVACY_MINIMIZED_LOOKUP_EVIDENCE_SCHEMA_VERSION
    && !isDeepStrictEqual(complete.parsed, projectLookupEvidenceWhoisPublication(complete.parsed))) {
    fail('Lookup evidence WHOIS portable publication');
  }
  array(complete.chain, 'Lookup evidence WHOIS chain', 16).forEach((item, index) => {
    validateLookupEvidenceWhoisHop(item, `Lookup evidence WHOIS chain item ${index + 1}`);
  });
  if (status === 'complete' && complete.parsed === null) fail('Lookup evidence WHOIS publication');
  if (!['complete', 'partial'].includes(status)
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
  const version = integer(root.schemaVersion, 'Lookup evidence version', V1_PUBLIC_LOOKUP_EVIDENCE_SCHEMA_VERSION, LOOKUP_EVIDENCE_SCHEMA_VERSION);
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
  if (!isDeepStrictEqual(query, projectLookupEvidenceQuery(query))) fail('Lookup evidence query');

  let diagnostics: UnknownRecord;
  let rdapDiagnosticStatus: string;
  let whoisDiagnosticStatus: string;
  diagnostics = record(root.diagnostics, 'Lookup evidence diagnostics');
  const currentDiagnosticStates: LookupEvidenceDiagnosticStates = validateLookupEvidenceCurrentDiagnostics(diagnostics);
  rdapDiagnosticStatus = currentDiagnosticStates.rdap;
  whoisDiagnosticStatus = currentDiagnosticStates.whois;

  const sources = exact(root.sources, ['rdap', 'whois', 'reverseDns', 'network', 'securityTxt', 'sslbl'], 'Lookup evidence sources');
  const rdapSourceStatus = validateLookupEvidenceRdap(sources.rdap, version);
  const whoisSourceStatus = validateLookupEvidenceWhois(sources.whois, version);
  if (rdapSourceStatus !== rdapDiagnosticStatus) fail('Lookup evidence RDAP source state');
  if (whoisSourceStatus !== whoisDiagnosticStatus) fail('Lookup evidence WHOIS source state');
  const reverseDnsState = validateLookupEvidenceReverseDns(sources.reverseDns);
  const networkState = validateLookupEvidenceNetwork(sources.network);
  if (currentDiagnosticStates.reverseDns
    && !isDeepStrictEqual(reverseDnsState, currentDiagnosticStates.reverseDns)) {
    fail('Lookup evidence reverse DNS source state');
  }
  if (currentDiagnosticStates.network !== null
    && (networkState?.status ?? null) !== currentDiagnosticStates.network) {
    fail('Lookup evidence network source state');
  }
  validateLookupEvidenceSecurityTxt(sources.securityTxt);
  validateLookupEvidenceSslbl(sources.sslbl);

  const analysis = exact(root.analysis, version >= LOOKUP_EVIDENCE_SCHEMA_VERSION
    ? ['availability', 'idn', 'registryInsights', 'registryComparison', 'registrarPublicationComparison', 'registrarStanding']
    : ['availability', 'idn', 'registryInsights', 'registryComparison', 'registrarPublicationComparison'], 'Lookup evidence analysis');
  if (version >= LOOKUP_EVIDENCE_SCHEMA_VERSION
    && analysis.registrarStanding !== null
    && !validRegistrarStanding(analysis.registrarStanding)) fail('Lookup evidence registrar standing');
  if (version >= LOOKUP_EVIDENCE_SCHEMA_VERSION
    && analysis.registrarStanding !== null
    && !registrarStandingObservedBy(analysis.registrarStanding, root.generatedAt)) {
    fail('Lookup evidence registrar standing observation time');
  }
  if (analysis.availability !== null) {
    const currentAvailability = version >= PRIVACY_MINIMIZED_LOOKUP_EVIDENCE_SCHEMA_VERSION;
    const availability = exactOptional(
      analysis.availability,
      currentAvailability ? ['registryContactsExcluded'] : [],
      currentAvailability ? LOOKUP_AVAILABILITY_ANALYSIS_KEYS : PUBLIC_LOOKUP_AVAILABILITY_ANALYSIS_KEYS,
      'Lookup evidence availability analysis',
    );
    if (currentAvailability && availability.registryContactsExcluded !== true) {
      fail('Lookup evidence availability contact exclusion');
    }
    validateLookupEvidenceHomepageMetadata(availability, version);
    if (!isDeepStrictEqual(
        analysis.availability,
        currentAvailability
          ? projectLookupEvidenceAvailability(analysis.availability)
          : projectLookupEvidenceAvailabilityPublic(analysis.availability),
      )) fail('Lookup evidence availability analysis');
  }
  if (analysis.idn !== null) {
    exactOptional(analysis.idn, [], LOOKUP_IDN_ANALYSIS_KEYS, 'Lookup evidence IDN analysis');
  }
  const registryInsights = record(analysis.registryInsights, 'Lookup evidence registry insights');
  const registryComparison = record(analysis.registryComparison, 'Lookup evidence registry comparison');
  validateLookupEvidenceRegistrarComparison(analysis.registrarPublicationComparison);
  {
    const rdap = record(sources.rdap, 'Lookup evidence RDAP source');
    const whois = record(sources.whois, 'Lookup evidence WHOIS source');
    const rdapParsed = ['success', 'partial'].includes(rdapDiagnosticStatus) ? rdap.parsed : null;
    const whoisParsed = ['complete', 'partial'].includes(whoisDiagnosticStatus) ? whois.parsed : null;
    if (version >= LOOKUP_EVIDENCE_SCHEMA_VERSION
      && validRegistrarStanding(analysis.registrarStanding)
      && analysis.registrarStanding.ianaId !== resolveRegistrarIanaId(rdapParsed, whoisParsed)) {
      fail('Lookup evidence registrar standing source binding');
    }
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
    const expectedInsights = version >= PRIVACY_MINIMIZED_LOOKUP_EVIDENCE_SCHEMA_VERSION
      ? projectLookupEvidenceRegistryInsights(rebuiltInsights)
      : rebuiltInsights;
    if (!isDeepStrictEqual(registryInsights, expectedInsights)) fail('Lookup evidence registry insight derivation');
    try { assertLookupEvidencePrivacySafeTree(root); } catch { fail('Lookup evidence privacy boundary'); }
  }
}
