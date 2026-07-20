#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REGISTRY_CAPABILITIES_VERSION,
  registryCompatibilityMatrix,
  registryStandardsCoverageSnapshot,
  type RegistryCompatibilityRow,
  type RegistryStandardsCoverageSnapshot,
} from '../lib/registry-capabilities.mts';
import { readTextCapped, safeFetchDetailed } from '../lib/safe-fetch.mts';

type AuditStatus = 'current' | 'drift' | 'inconclusive';
type SourceId = 'root_zone' | 'rdap_bootstrap';
type FetchSource = (url: string, init: RequestInit) => Promise<Response>;
type RootZoneObservation = Readonly<{
  version: string;
  lastUpdatedAt: string;
  tlds: readonly string[];
}>;
type RdapBootstrapObservation = Readonly<{
  publication: string;
  version: string;
  serviceGroupCount: number;
  httpsServiceGroupCount: number;
  httpOnlyServiceGroupCount: number;
  suffixes: readonly string[];
}>;
type SourceObservation<T> = Readonly<{
  id: SourceId;
  url: string;
  status: number | null;
  bytesRead: number;
  error: string | null;
  value: T | null;
}>;
type AuditCheck = Readonly<{
  id: string;
  label: string;
  status: AuditStatus;
  baseline: string | number | null;
  observed: string | number | null;
  detail: string;
  suffixes?: readonly string[];
  truncated?: boolean;
}>;
type RegistryDriftAuditOptions = Readonly<{
  fetchSource?: FetchSource;
  now?: () => Date;
  requestTimeoutMs?: number;
  totalTimeoutMs?: number;
  snapshot?: RegistryStandardsCoverageSnapshot;
  capabilities?: readonly RegistryCompatibilityRow[];
}>;
type WritableLike = { write(value: string): unknown };
type RegistryDriftAuditMainOptions = RegistryDriftAuditOptions & Readonly<{
  stdout?: WritableLike;
  stderr?: WritableLike;
}>;

const REGISTRY_DRIFT_AUDIT_SCHEMA = 'whoisleuth.registry-drift-audit';
const REGISTRY_DRIFT_AUDIT_VERSION = 1;
const ROOT_ZONE_URL = 'https://data.iana.org/TLD/tlds-alpha-by-domain.txt';
const RDAP_BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';
const MAX_ROOT_ZONE_BYTES = 256 * 1024;
const MAX_RDAP_BOOTSTRAP_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_RECORDS = 5000;
const MAX_CAPABILITY_ROWS = 2000;
const MAX_RDAP_SERVICE_GROUPS = 2000;
const MAX_ENDPOINTS_PER_SERVICE = 20;
const MAX_REPORTED_SUFFIXES = 200;
const MAX_AUDIT_DETAIL_LENGTH = 320;
const REGISTRY_AUDIT_REQUEST_TIMEOUT_MS = 7000;
const REGISTRY_AUDIT_TOTAL_TIMEOUT_MS = 15_000;
const SOURCE_DEFINITIONS = Object.freeze([
  Object.freeze({ id: 'root_zone' as const, url: ROOT_ZONE_URL, maxBytes: MAX_ROOT_ZONE_BYTES }),
  Object.freeze({ id: 'rdap_bootstrap' as const, url: RDAP_BOOTSTRAP_URL, maxBytes: MAX_RDAP_BOOTSTRAP_BYTES }),
]);

function boundedText(value: unknown, fallback: string, maximum = MAX_AUDIT_DETAIL_LENGTH): string {
  const text = typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim()
    : '';
  return (text || fallback).slice(0, maximum);
}

function boundedTimeout(value: unknown, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function canonicalTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || value.length > 64 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${label} must be a bounded timestamp.`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError(`${label} must be a valid timestamp.`);
  return new Date(parsed).toISOString();
}

function canonicalSuffix(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > 63 || /[\u0000-\u0020\u007f]/u.test(value)) return null;
  const suffix = value.toLowerCase();
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(suffix) && /[a-z]/u.test(suffix)
    ? suffix
    : null;
}

function boundedSourceText(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be text.`);
  if (Buffer.byteLength(value, 'utf8') > maximum) throw new RangeError(`${label} exceeded ${maximum} bytes.`);
  if (value.includes('\u0000')) throw new TypeError(`${label} contained a NUL byte.`);
  return value;
}

function parseRootZoneTldList(value: unknown): RootZoneObservation {
  const text = boundedSourceText(value, MAX_ROOT_ZONE_BYTES, 'The IANA root-zone list');
  const lines = text.split(/\r?\n/u);
  const header = lines.find((line) => line.startsWith('# Version '));
  const match = /^# Version ([0-9]{8,20}), Last Updated (.{1,64})$/u.exec(header || '');
  if (!match) throw new TypeError('The IANA root-zone list did not contain the expected version header.');
  const tlds: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const suffix = canonicalSuffix(trimmed);
    if (!suffix) throw new TypeError('The IANA root-zone list contained an invalid suffix.');
    if (seen.has(suffix)) throw new TypeError(`The IANA root-zone list repeated .${suffix}.`);
    seen.add(suffix);
    tlds.push(suffix);
    if (tlds.length > MAX_SOURCE_RECORDS) {
      throw new RangeError(`The IANA root-zone list exceeded ${MAX_SOURCE_RECORDS} suffixes.`);
    }
  }
  if (!tlds.length) throw new TypeError('The IANA root-zone list contained no suffixes.');
  tlds.sort((left, right) => left.localeCompare(right));
  return Object.freeze({
    version: match[1],
    lastUpdatedAt: canonicalTimestamp(match[2], 'The IANA root-zone update time'),
    tlds: Object.freeze(tlds),
  });
}

function parseRdapBootstrap(value: unknown): RdapBootstrapObservation {
  const text = boundedSourceText(value, MAX_RDAP_BOOTSTRAP_BYTES, 'The IANA RDAP bootstrap');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TypeError('The IANA RDAP bootstrap was not valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('The IANA RDAP bootstrap did not contain an object.');
  }
  const record = parsed as Record<string, unknown>;
  const publication = canonicalTimestamp(record.publication, 'The IANA RDAP publication time');
  if (typeof record.version !== 'string' || !/^[0-9]+(?:\.[0-9]+){0,3}$/u.test(record.version) || record.version.length > 32) {
    throw new TypeError('The IANA RDAP bootstrap version was invalid.');
  }
  if (!Array.isArray(record.services) || !record.services.length || record.services.length > MAX_RDAP_SERVICE_GROUPS) {
    throw new TypeError(`The IANA RDAP bootstrap must contain 1-${MAX_RDAP_SERVICE_GROUPS} service groups.`);
  }
  const suffixes = new Set<string>();
  let httpsServiceGroupCount = 0;
  let httpOnlyServiceGroupCount = 0;
  for (const service of record.services) {
    if (!Array.isArray(service) || service.length !== 2 || !Array.isArray(service[0]) || !Array.isArray(service[1])
      || !service[0].length || !service[1].length || service[1].length > MAX_ENDPOINTS_PER_SERVICE) {
      throw new TypeError('The IANA RDAP bootstrap contained a malformed service group.');
    }
    for (const value of service[0]) {
      const suffix = canonicalSuffix(value);
      if (!suffix) throw new TypeError('The IANA RDAP bootstrap contained an invalid suffix.');
      if (suffixes.has(suffix)) throw new TypeError(`The IANA RDAP bootstrap repeated .${suffix}.`);
      suffixes.add(suffix);
      if (suffixes.size > MAX_SOURCE_RECORDS) {
        throw new RangeError(`The IANA RDAP bootstrap exceeded ${MAX_SOURCE_RECORDS} suffixes.`);
      }
    }
    let hasHttpsEndpoint = false;
    let hasHttpEndpoint = false;
    for (const value of service[1]) {
      if (typeof value !== 'string' || !value || value.length > 2048 || /[\u0000-\u001f\u007f]/u.test(value)) {
        throw new TypeError('The IANA RDAP bootstrap contained an invalid endpoint.');
      }
      let endpoint: URL;
      try {
        endpoint = new URL(value);
      } catch {
        throw new TypeError('The IANA RDAP bootstrap contained an invalid endpoint URL.');
      }
      if (endpoint.username || endpoint.password || !['http:', 'https:'].includes(endpoint.protocol)) {
        throw new TypeError('The IANA RDAP bootstrap contained an unsupported endpoint URL.');
      }
      if (endpoint.protocol === 'https:') hasHttpsEndpoint = true;
      if (endpoint.protocol === 'http:') hasHttpEndpoint = true;
    }
    if (!hasHttpsEndpoint && !hasHttpEndpoint) throw new TypeError('An IANA RDAP service group did not publish an HTTP(S) endpoint.');
    if (hasHttpsEndpoint) httpsServiceGroupCount += 1;
    else httpOnlyServiceGroupCount += 1;
  }
  return Object.freeze({
    publication,
    version: record.version,
    serviceGroupCount: record.services.length,
    httpsServiceGroupCount,
    httpOnlyServiceGroupCount,
    suffixes: Object.freeze([...suffixes].sort((left, right) => left.localeCompare(right))),
  });
}

async function defaultFetchSource(url: string, init: RequestInit): Promise<Response> {
  return (await safeFetchDetailed(url, init, { maxRedirects: 2 })).response;
}

async function collectSource<T>(
  definition: typeof SOURCE_DEFINITIONS[number],
  fetchSource: FetchSource,
  totalDeadline: number,
  requestTimeoutMs: number,
  parser: (value: unknown) => T,
): Promise<SourceObservation<T>> {
  const remainingMs = totalDeadline - Date.now();
  if (remainingMs <= 0) {
    return Object.freeze({
      id: definition.id, url: definition.url, status: null, bytesRead: 0,
      error: 'The total registry-audit deadline was reached.', value: null,
    });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(requestTimeoutMs, remainingMs));
  try {
    const response = await fetchSource(definition.url, {
      headers: { Accept: definition.id === 'rdap_bootstrap' ? 'application/json' : 'text/plain' },
      redirect: 'manual',
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return Object.freeze({
        id: definition.id, url: definition.url, status: response.status, bytesRead: 0,
        error: `The official source returned HTTP ${response.status}.`, value: null,
      });
    }
    const captured = await readTextCapped(response, definition.maxBytes);
    if (captured.truncated) {
      return Object.freeze({
        id: definition.id, url: definition.url, status: response.status, bytesRead: captured.bytesRead,
        error: `The official source exceeded ${definition.maxBytes} bytes.`, value: null,
      });
    }
    try {
      return Object.freeze({
        id: definition.id, url: definition.url, status: response.status, bytesRead: captured.bytesRead,
        error: null, value: parser(captured.text),
      });
    } catch (error) {
      return Object.freeze({
        id: definition.id, url: definition.url, status: response.status, bytesRead: captured.bytesRead,
        error: boundedText(error instanceof Error ? error.message : error, 'The official source was malformed.'),
        value: null,
      });
    }
  } catch (error) {
    return Object.freeze({
      id: definition.id, url: definition.url, status: null, bytesRead: 0,
      error: boundedText(error instanceof Error ? error.message : error, 'The official-source request failed.'),
      value: null,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function comparisonCheck(
  id: string,
  label: string,
  baseline: string | number,
  observed: string | number | null,
  unavailableDetail: string,
): AuditCheck {
  if (observed === null) {
    return Object.freeze({ id, label, status: 'inconclusive', baseline, observed, detail: unavailableDetail });
  }
  const status = observed === baseline ? 'current' : 'drift';
  return Object.freeze({
    id,
    label,
    status,
    baseline,
    observed,
    detail: status === 'current'
      ? 'The official value matches the embedded snapshot.'
      : 'The official value differs from the embedded snapshot and requires review before the snapshot is updated.',
  });
}

function suffixCheck(
  id: string,
  label: string,
  suffixes: readonly string[] | null,
  unavailableDetail: string,
  currentDetail: string,
  driftSubject: string,
): AuditCheck {
  if (suffixes === null) {
    return Object.freeze({ id, label, status: 'inconclusive', baseline: 0, observed: null, detail: unavailableDetail });
  }
  const bounded = suffixes.slice(0, MAX_REPORTED_SUFFIXES);
  const status = suffixes.length ? 'drift' : 'current';
  return Object.freeze({
    id,
    label,
    status,
    baseline: 0,
    observed: suffixes.length,
    detail: status === 'current'
      ? currentDetail
      : `${suffixes.length} ${driftSubject}${suffixes.length === 1 ? '' : 's'} require review.`,
    suffixes: Object.freeze([...bounded]),
    truncated: suffixes.length > bounded.length,
  });
}

function evaluateRegistryDrift(
  snapshot: RegistryStandardsCoverageSnapshot,
  capabilities: readonly RegistryCompatibilityRow[],
  rootZone: SourceObservation<RootZoneObservation>,
  rdapBootstrap: SourceObservation<RdapBootstrapObservation>,
): readonly AuditCheck[] {
  const root = rootZone.value;
  const rdap = rdapBootstrap.value;
  const activeTlds = root ? new Set(root.tlds) : null;
  const rdapSuffixes = rdap ? new Set(rdap.suffixes) : null;
  const rows = [...capabilities].sort((left, right) => left.suffixes[0].localeCompare(right.suffixes[0]));
  const inactiveProfiles = activeTlds
    ? rows.map((row) => row.suffixes[0]).filter((suffix) => !activeTlds.has(suffix))
    : null;
  const rdapMismatches = rdapSuffixes
    ? rows.filter((row) => rdapSuffixes.has(row.suffixes[0]) !== (row.rdapAccessProfile === 'iana-bootstrap'))
      .map((row) => row.suffixes[0])
    : null;
  const unassignedRdapSuffixes = activeTlds && rdapSuffixes
    ? [...rdapSuffixes].filter((suffix) => !activeTlds.has(suffix))
    : null;
  return Object.freeze([
    comparisonCheck('root_zone_version', 'Root-zone version', snapshot.sources.rootZoneVersion, root?.version ?? null, rootZone.error || 'The root-zone source was unavailable.'),
    comparisonCheck('root_zone_updated_at', 'Root-zone update time', snapshot.sources.rootZoneLastUpdatedAt, root?.lastUpdatedAt ?? null, rootZone.error || 'The root-zone source was unavailable.'),
    comparisonCheck('active_tld_count', 'Active TLD count', snapshot.counts.activeTlds, root?.tlds.length ?? null, rootZone.error || 'The root-zone source was unavailable.'),
    comparisonCheck('rdap_publication', 'RDAP bootstrap publication', snapshot.sources.rdapBootstrapPublication, rdap?.publication ?? null, rdapBootstrap.error || 'The RDAP bootstrap source was unavailable.'),
    comparisonCheck('rdap_version', 'RDAP bootstrap version', snapshot.sources.rdapBootstrapVersion, rdap?.version ?? null, rdapBootstrap.error || 'The RDAP bootstrap source was unavailable.'),
    comparisonCheck('rdap_service_groups', 'RDAP service-group count', snapshot.counts.rdapBootstrapServiceGroups, rdap?.serviceGroupCount ?? null, rdapBootstrap.error || 'The RDAP bootstrap source was unavailable.'),
    suffixCheck(
      'rdap_suffix_assignments',
      'RDAP suffix assignments',
      unassignedRdapSuffixes,
      rootZone.error || rdapBootstrap.error || 'One official source was unavailable.',
      'Every RDAP bootstrap suffix is present in the current root zone.',
      'RDAP suffix assignment',
    ),
    suffixCheck(
      'explicit_suffix_assignments',
      'Explicit suffix assignments',
      inactiveProfiles,
      rootZone.error || 'The root-zone source was unavailable.',
      'Every explicit suffix profile is present in the current root zone.',
      'explicit suffix assignment',
    ),
    suffixCheck(
      'explicit_rdap_profiles',
      'Explicit RDAP access profiles',
      rdapMismatches,
      rdapBootstrap.error || 'The RDAP bootstrap source was unavailable.',
      'Every explicit RDAP access profile agrees with the current bootstrap.',
      'explicit RDAP access profile',
    ),
  ]);
}

function countStatuses(checks: readonly AuditCheck[]): Record<AuditStatus, number> {
  const counts: Record<AuditStatus, number> = { current: 0, drift: 0, inconclusive: 0 };
  for (const check of checks) counts[check.status] += 1;
  return counts;
}

function sourceProjection<T>(observation: SourceObservation<T>): Readonly<Omit<SourceObservation<T>, 'value'>> {
  return Object.freeze({
    id: observation.id,
    url: observation.url,
    status: observation.status,
    bytesRead: observation.bytesRead,
    error: observation.error,
  });
}

async function runRegistryDriftAudit(options: RegistryDriftAuditOptions = {}) {
  const snapshot = options.snapshot || registryStandardsCoverageSnapshot();
  const capabilities = options.capabilities || registryCompatibilityMatrix();
  if (!Array.isArray(capabilities) || capabilities.length > MAX_CAPABILITY_ROWS) {
    throw new RangeError(`The registry capability catalogue exceeded ${MAX_CAPABILITY_ROWS} rows.`);
  }
  const requestTimeoutMs = boundedTimeout(options.requestTimeoutMs, REGISTRY_AUDIT_REQUEST_TIMEOUT_MS, REGISTRY_AUDIT_REQUEST_TIMEOUT_MS);
  const totalTimeoutMs = boundedTimeout(options.totalTimeoutMs, REGISTRY_AUDIT_TOTAL_TIMEOUT_MS, REGISTRY_AUDIT_TOTAL_TIMEOUT_MS);
  const totalDeadline = Date.now() + totalTimeoutMs;
  const fetchSource = options.fetchSource || defaultFetchSource;
  const [rootZone, rdapBootstrap] = await Promise.all([
    collectSource(SOURCE_DEFINITIONS[0], fetchSource, totalDeadline, requestTimeoutMs, parseRootZoneTldList),
    collectSource(SOURCE_DEFINITIONS[1], fetchSource, totalDeadline, requestTimeoutMs, parseRdapBootstrap),
  ]);
  const checks = evaluateRegistryDrift(snapshot, capabilities, rootZone, rdapBootstrap);
  return Object.freeze({
    schema: REGISTRY_DRIFT_AUDIT_SCHEMA,
    version: REGISTRY_DRIFT_AUDIT_VERSION,
    generatedAt: (options.now || (() => new Date()))().toISOString(),
    baseline: Object.freeze({
      verifiedAt: snapshot.verifiedAt,
      rootZoneVersion: snapshot.sources.rootZoneVersion,
      rootZoneLastUpdatedAt: snapshot.sources.rootZoneLastUpdatedAt,
      activeTlds: snapshot.counts.activeTlds,
      rdapBootstrapPublication: snapshot.sources.rdapBootstrapPublication,
      rdapBootstrapVersion: snapshot.sources.rdapBootstrapVersion,
      rdapBootstrapServiceGroups: snapshot.counts.rdapBootstrapServiceGroups,
      catalogueVersion: REGISTRY_CAPABILITIES_VERSION,
      catalogueRows: capabilities.length,
    }),
    observed: Object.freeze({
      rootZone: rootZone.value ? Object.freeze({
        version: rootZone.value.version,
        lastUpdatedAt: rootZone.value.lastUpdatedAt,
        activeTlds: rootZone.value.tlds.length,
      }) : null,
      rdapBootstrap: rdapBootstrap.value ? Object.freeze({
        publication: rdapBootstrap.value.publication,
        version: rdapBootstrap.value.version,
        serviceGroups: rdapBootstrap.value.serviceGroupCount,
        httpsServiceGroups: rdapBootstrap.value.httpsServiceGroupCount,
        httpOnlyServiceGroups: rdapBootstrap.value.httpOnlyServiceGroupCount,
        coveredTlds: rdapBootstrap.value.suffixes.length,
      }) : null,
    }),
    sources: Object.freeze([sourceProjection(rootZone), sourceProjection(rdapBootstrap)]),
    summary: Object.freeze(countStatuses(checks)),
    bounds: Object.freeze({
      requestLimit: SOURCE_DEFINITIONS.length,
      requestCount: SOURCE_DEFINITIONS.length,
      requestTimeoutMs,
      totalTimeoutMs,
      rootZoneByteLimit: MAX_ROOT_ZONE_BYTES,
      rdapBootstrapByteLimit: MAX_RDAP_BOOTSTRAP_BYTES,
      sourceRecordLimit: MAX_SOURCE_RECORDS,
      capabilityRowLimit: MAX_CAPABILITY_ROWS,
      reportedSuffixLimit: MAX_REPORTED_SUFFIXES,
    }),
    checks,
    limitations: Object.freeze([
      'This manual audit compares two official IANA catalogue files with the embedded snapshot and explicit suffix claims.',
      'It does not query a registry, test live domain reachability, rewrite the catalogue, or decide registration, availability, ownership, safety, or maliciousness.',
      'A changed publication or version is drift requiring review, not evidence that WHOISleuth lookup behavior is defective.',
    ]),
  });
}

function formatRegistryDriftAudit(report: Awaited<ReturnType<typeof runRegistryDriftAudit>>): string {
  const lines = [
    'WHOISleuth official-registry drift audit',
    `Baseline verified: ${report.baseline.verifiedAt}`,
    `Summary: ${report.summary.current} current, ${report.summary.drift} drift, ${report.summary.inconclusive} inconclusive`,
    '',
  ];
  if (report.observed.rdapBootstrap) {
    lines.push(
      `RDAP service transport: ${report.observed.rdapBootstrap.httpsServiceGroups} HTTPS-capable, ${report.observed.rdapBootstrap.httpOnlyServiceGroups} HTTP-only`,
      '',
    );
  }
  for (const check of report.checks) {
    lines.push(`${check.status.toUpperCase().padEnd(14)} ${check.label}`);
    lines.push(`  ${check.detail}`);
    if (check.suffixes?.length) {
      lines.push(`  Suffixes: ${check.suffixes.map((suffix) => `.${suffix}`).join(', ')}${check.truncated ? ', ...' : ''}`);
    } else if (check.baseline !== null || check.observed !== null) {
      lines.push(`  Baseline: ${check.baseline ?? 'unavailable'}; observed: ${check.observed ?? 'unavailable'}`);
    }
  }
  lines.push(
    '',
    `Requests: ${report.bounds.requestCount}/${report.bounds.requestLimit}; byte caps: ${report.bounds.rootZoneByteLimit} root zone, ${report.bounds.rdapBootstrapByteLimit} RDAP`,
    'This report does not query registries or change the embedded catalogue.',
  );
  return `${lines.join('\n')}\n`;
}

function parseArguments(args: readonly string[]): { json: boolean } {
  let json = false;
  for (const arg of args) {
    if (arg === '--json') {
      if (json) throw new TypeError('--json may be supplied only once.');
      json = true;
    } else {
      throw new TypeError(`Unknown option: ${arg}`);
    }
  }
  return { json };
}

async function main(
  args = process.argv.slice(2),
  options: RegistryDriftAuditMainOptions = {},
): Promise<number> {
  try {
    const { json } = parseArguments(args);
    const report = await runRegistryDriftAudit(options);
    (options.stdout || process.stdout).write(json ? `${JSON.stringify(report, null, 2)}\n` : formatRegistryDriftAudit(report));
    if (report.summary.inconclusive > 0) return 2;
    return report.summary.drift > 0 ? 1 : 0;
  } catch (error) {
    (options.stderr || process.stderr).write(`${boundedText(error instanceof Error ? error.message : error, 'Registry drift audit failed.')}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().then((code) => { process.exitCode = code; });
}

export {
  MAX_AUDIT_DETAIL_LENGTH,
  MAX_CAPABILITY_ROWS,
  MAX_RDAP_BOOTSTRAP_BYTES,
  MAX_REPORTED_SUFFIXES,
  MAX_ROOT_ZONE_BYTES,
  MAX_SOURCE_RECORDS,
  RDAP_BOOTSTRAP_URL,
  REGISTRY_AUDIT_REQUEST_TIMEOUT_MS,
  REGISTRY_AUDIT_TOTAL_TIMEOUT_MS,
  REGISTRY_DRIFT_AUDIT_SCHEMA,
  REGISTRY_DRIFT_AUDIT_VERSION,
  ROOT_ZONE_URL,
  evaluateRegistryDrift,
  formatRegistryDriftAudit,
  main,
  parseArguments,
  parseRdapBootstrap,
  parseRootZoneTldList,
  runRegistryDriftAudit,
};
export type {
  AuditCheck,
  AuditStatus,
  FetchSource,
  RdapBootstrapObservation,
  RegistryDriftAuditOptions,
  RegistryDriftAuditMainOptions,
  RootZoneObservation,
  SourceObservation,
};
