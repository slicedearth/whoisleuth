import { createHash } from 'node:crypto';

import type { BulkLookupResult } from './bulk.mts';
import { availabilityState, bulkDnsSummary } from './bulk-output.mts';
import { boundedCliInputError, CliUsageError } from './errors.mts';
import { writePrivateFile } from './output-file.mts';
import { isValidAsciiDomainName } from '../lib/hostname.mts';
import { readBoundedRegularTextFile } from '../lib/bounded-file.mts';
import { scanBoundedJson } from '../lib/bounded-json.mts';
import { normalizeExplicitIsoTimestamp, normalizeLegacyIsoTimestamp } from '../lib/observation.mts';

export const CLI_DISCOVERY_OBSERVATION_SCHEMA = 'whoisleuth.cli.discovery-observation-snapshot';
export const CLI_DISCOVERY_OBSERVATION_VERSION = 2;
export const MAX_DISCOVERY_OBSERVATION_BYTES = 8 * 1024 * 1024;
const MAX_DISCOVERY_OBSERVATIONS = 500;
const SUPPORTED_DISCOVERY_OBSERVATION_VERSIONS = new Set([1, CLI_DISCOVERY_OBSERVATION_VERSION]);

type Candidate = { domain: unknown };
type Observation = {
  domain: string;
  observedAt: string | null;
  registrationObservedAt: string | null;
  dnsObservedAt: string | null;
  latestAttemptAt: string;
  latestAttemptState: 'error' | 'partial' | 'success';
  latestRegistrationState: 'observed' | 'unavailable';
  latestDnsState: string;
  availabilityState: string;
  confidence: string;
  dns: ReturnType<typeof bulkDnsSummary>;
};
type SnapshotDocument = {
  schema: typeof CLI_DISCOVERY_OBSERVATION_SCHEMA;
  version: typeof CLI_DISCOVERY_OBSERVATION_VERSION;
  generatedAt: string;
  configurationDigestSha256: string;
  observationCount: number;
  observations: Observation[];
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function domainValue(value: unknown): string {
  const domain = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!isValidAsciiDomainName(domain, { requireDot: true, requireLowercase: true })) {
    throw new CliUsageError('Discovery observation snapshot contains an invalid domain.');
  }
  return domain;
}

function normalizedTimestamp(value: unknown, label: string, optional = false, legacy = false): string | null {
  if (optional && value === null) return null;
  if (typeof value !== 'string' || value.length > 64 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new CliUsageError(`${label} is invalid.`);
  }
  const normalized = normalizeExplicitIsoTimestamp(value);
  if (normalized) return normalized;
  if (legacy) {
    const legacyTimestamp = normalizeLegacyIsoTimestamp(value);
    if (legacyTimestamp) return legacyTimestamp;
  }
  throw new CliUsageError(`${label} is invalid.`);
}

function latestObservedAt(registrationObservedAt: string | null, dnsObservedAt: string | null): string | null {
  if (!registrationObservedAt) return dnsObservedAt;
  if (!dnsObservedAt) return registrationObservedAt;
  return registrationObservedAt >= dnsObservedAt ? registrationObservedAt : dnsObservedAt;
}

function snapshotConfigurationDigest(configuration: Readonly<{
  domains: readonly string[];
  deep: boolean;
  resolverServers: readonly string[];
}>): string {
  return createHash('sha256').update(JSON.stringify({
    domains: [...configuration.domains],
    mode: configuration.deep ? 'deep' : 'fast',
    resolverServers: [...configuration.resolverServers],
  })).digest('hex');
}

function normalizeDns(value: unknown): Observation['dns'] | null {
  const dns = record(value);
  const stringList = (candidate: unknown, maximum: number) => Array.isArray(candidate)
    ? candidate.flatMap((item) => typeof item === 'string' && item.length <= 500 ? [item] : []).slice(0, maximum)
    : [];
  const nullableBoolean = (candidate: unknown) => typeof candidate === 'boolean' ? candidate : null;
  if (typeof dns.status !== 'string' || !dns.status || dns.status.length > 40
    || /[\u0000-\u001f\u007f]/u.test(dns.status)) return null;
  return {
    status: dns.status,
    a: stringList(dns.a, 100),
    aaaa: stringList(dns.aaaa, 100),
    ns: stringList(dns.ns, 100),
    mx: stringList(dns.mx, 100),
    hasNullMx: nullableBoolean(dns.hasNullMx),
    hasSpf: nullableBoolean(dns.hasSpf),
    hasDmarc: nullableBoolean(dns.hasDmarc),
  };
}

function normalizeObservation(value: unknown, version: number): Observation | null {
  const item = record(value);
  const dns = normalizeDns(item.dns);
  try {
    const validAttemptStates = version === 1 ? ['error', 'success'] : ['error', 'partial', 'success'];
    if (!dns
      || !validAttemptStates.includes(String(item.latestAttemptState))
      || typeof item.availabilityState !== 'string' || !item.availabilityState || item.availabilityState.length > 40
      || /[\u0000-\u001f\u007f]/u.test(item.availabilityState)
      || typeof item.confidence !== 'string' || !item.confidence || item.confidence.length > 40
      || /[\u0000-\u001f\u007f]/u.test(item.confidence)) return null;
    const legacyObservedAt = normalizedTimestamp(item.observedAt, 'Discovery observation time', version >= 2, version === 1);
    const registrationObservedAt = version === 1
      ? item.availabilityState === 'unknown' ? null : legacyObservedAt
      : normalizedTimestamp(item.registrationObservedAt, 'Discovery registration observation time', true);
    const dnsObservedAt = version === 1
      ? ['partial', 'success'].includes(dns.status) ? legacyObservedAt : null
      : normalizedTimestamp(item.dnsObservedAt, 'Discovery DNS observation time', true);
    const observedAt = latestObservedAt(registrationObservedAt, dnsObservedAt);
    if (version >= 2 && legacyObservedAt !== observedAt) return null;
    const latestRegistrationState = version === 1
      ? registrationObservedAt ? 'observed' : 'unavailable'
      : item.latestRegistrationState;
    const latestDnsState = version === 1 ? dns.status : item.latestDnsState;
    if (!['observed', 'unavailable'].includes(String(latestRegistrationState))
      || typeof latestDnsState !== 'string' || !latestDnsState || latestDnsState.length > 40
      || /[\u0000-\u001f\u007f]/u.test(latestDnsState)) return null;
    if (latestRegistrationState === 'observed' && registrationObservedAt === null) return null;
    return {
      domain: domainValue(item.domain),
      observedAt,
      registrationObservedAt,
      dnsObservedAt,
      latestAttemptAt: normalizedTimestamp(item.latestAttemptAt, 'Discovery latest-attempt time', false, version === 1) ?? '',
      latestAttemptState: item.latestAttemptState as Observation['latestAttemptState'],
      latestRegistrationState: latestRegistrationState as Observation['latestRegistrationState'],
      latestDnsState,
      availabilityState: item.availabilityState,
      confidence: item.confidence,
      dns,
    };
  } catch {
    return null;
  }
}

function parseObservationSnapshot(text: string, expectedDigest: string): SnapshotDocument {
  if (Buffer.byteLength(text, 'utf8') > MAX_DISCOVERY_OBSERVATION_BYTES) {
    throw new CliUsageError(`Discovery observation snapshots are limited to ${MAX_DISCOVERY_OBSERVATION_BYTES} bytes.`);
  }
  const normalizedInput = text.replace(/^\uFEFF/u, '');
  let parsed: unknown;
  try {
    scanBoundedJson(normalizedInput);
    parsed = JSON.parse(normalizedInput);
  } catch {
    throw new CliUsageError('Discovery observation snapshot must be valid bounded JSON without duplicate keys.');
  }
  const document = record(parsed);
  const version = typeof document.version === 'number' && Number.isSafeInteger(document.version)
    ? document.version
    : 0;
  if (document.schema !== CLI_DISCOVERY_OBSERVATION_SCHEMA || !SUPPORTED_DISCOVERY_OBSERVATION_VERSIONS.has(version)) {
    throw new CliUsageError(`Discovery observation snapshot must use ${CLI_DISCOVERY_OBSERVATION_SCHEMA} version 1 or ${CLI_DISCOVERY_OBSERVATION_VERSION}.`);
  }
  if (document.configurationDigestSha256 !== expectedDigest) {
    throw new CliUsageError('Discovery observation snapshot does not match this candidate set, scan mode, or resolver selection.');
  }
  if (!Array.isArray(document.observations) || document.observations.length > MAX_DISCOVERY_OBSERVATIONS) {
    throw new CliUsageError('Discovery observation snapshot metadata is invalid.');
  }
  const generatedAt = normalizedTimestamp(
    document.generatedAt,
    'Discovery snapshot generation time',
    false,
    version === 1,
  ) ?? '';
  const observations = document.observations.map((item) => normalizeObservation(item, version));
  if (observations.some((item) => item === null) || document.observationCount !== observations.length) {
    throw new CliUsageError('Discovery observation snapshot contains invalid evidence.');
  }
  const normalized = observations as Observation[];
  if (new Set(normalized.map((item) => item.domain)).size !== normalized.length) {
    throw new CliUsageError('Discovery observation snapshot contains duplicate domains.');
  }
  return {
    schema: CLI_DISCOVERY_OBSERVATION_SCHEMA,
    version: CLI_DISCOVERY_OBSERVATION_VERSION,
    generatedAt,
    configurationDigestSha256: expectedDigest,
    observationCount: normalized.length,
    observations: normalized,
  };
}

async function readExisting(path: string): Promise<string | null> {
  try {
    return await readBoundedRegularTextFile(path, {
      maximumBytes: MAX_DISCOVERY_OBSERVATION_BYTES,
      label: 'Discovery observation snapshot',
      allowSymbolicLink: true,
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
    throw boundedCliInputError(error, 'Discovery observation snapshot');
  }
}

type CurrentAttempt = Readonly<{
  observation: Observation;
  registrationObserved: boolean;
  dnsComplete: boolean;
  unavailableComponents: readonly ('dns' | 'registration')[];
}>;

function currentAttempt(
  domain: string,
  item: BulkLookupResult,
  previous: Observation | undefined,
  generatedAt: string,
  deep: boolean,
): CurrentAttempt {
  const availability = item.ok ? record(record(item.result).availability) : {};
  const currentAvailabilityState = availabilityState(item) || 'unknown';
  const registrationObserved = item.ok && currentAvailabilityState !== 'unknown';
  const currentDns = bulkDnsSummary(item);
  const dnsComplete = deep && currentDns.status === 'success';
  const dnsRetainable = deep && currentDns.status === 'partial';
  const previousDnsRetainable = previous && ['partial', 'success'].includes(previous.dns.status);
  const dns = dnsComplete || (dnsRetainable && !previousDnsRetainable)
    ? currentDns
    : previousDnsRetainable ? previous.dns : currentDns;
  const registrationObservedAt = registrationObserved ? generatedAt : previous?.registrationObservedAt ?? null;
  const dnsObservedAt = dnsComplete || (dnsRetainable && !previousDnsRetainable)
    ? generatedAt
    : previous?.dnsObservedAt ?? null;
  const unavailableComponents: Array<'dns' | 'registration'> = [];
  if (!registrationObserved) unavailableComponents.push('registration');
  if (deep && !dnsComplete) unavailableComponents.push('dns');
  const attemptState: Observation['latestAttemptState'] = !item.ok
    ? 'error'
    : unavailableComponents.length ? 'partial' : 'success';
  const confidence = registrationObserved && typeof availability.confidence === 'string'
    ? availability.confidence.replace(/[\u0000-\u001f\u007f]+/gu, ' ').trim().slice(0, 40) || 'unknown'
    : previous?.confidence ?? 'unknown';
  const retainedAvailabilityState = registrationObserved
    ? currentAvailabilityState
    : previous?.availabilityState ?? 'unknown';
  return {
    registrationObserved,
    dnsComplete,
    unavailableComponents,
    observation: {
      domain,
      observedAt: latestObservedAt(registrationObservedAt, dnsObservedAt),
      registrationObservedAt,
      dnsObservedAt,
      latestAttemptAt: generatedAt,
      latestAttemptState: attemptState,
      latestRegistrationState: registrationObserved ? 'observed' : 'unavailable',
      latestDnsState: deep ? currentDns.status : 'not_requested',
      availabilityState: retainedAvailabilityState,
      confidence,
      dns,
    },
  };
}

function materialChanges(previous: Observation, current: Observation, attempt: Pick<CurrentAttempt, 'dnsComplete' | 'registrationObserved'> = {
  dnsComplete: current.latestDnsState === 'success',
  registrationObserved: current.latestRegistrationState === 'observed',
}) {
  const changes: Array<{ field: string; before: unknown; after: unknown }> = [];
  const compare = (field: string, before: unknown, after: unknown) => {
    if (JSON.stringify(before) !== JSON.stringify(after)) changes.push({ field, before, after });
  };
  if (attempt.registrationObserved) {
    compare('availabilityState', previous.availabilityState, current.availabilityState);
    compare('confidence', previous.confidence, current.confidence);
  }
  if (attempt.dnsComplete) {
    for (const field of ['a', 'aaaa', 'ns', 'mx', 'hasNullMx', 'hasSpf', 'hasDmarc'] as const) {
      compare(`dns.${field}`, previous.dns[field], current.dns[field]);
    }
    compare('dns.status', previous.dns.status, current.dns.status);
  }
  return changes;
}

async function updateDiscoveryObservationSnapshot(
  path: string,
  candidates: readonly Candidate[],
  items: readonly BulkLookupResult[],
  configuration: Readonly<{ deep: boolean; resolverServers: readonly string[] }>,
  generatedAt: string,
) {
  if (!path || path.length > 1024 || /[\u0000-\u001f\u007f]/u.test(path)) {
    throw new CliUsageError('Discovery observation snapshot path must be bounded text without control characters.');
  }
  if (candidates.length !== items.length || candidates.length > MAX_DISCOVERY_OBSERVATIONS) {
    throw new CliUsageError(`Discovery observation snapshots support at most ${MAX_DISCOVERY_OBSERVATIONS} aligned results.`);
  }
  const currentGeneratedAt = normalizedTimestamp(generatedAt, 'Discovery observation generation time') ?? '';
  const domains = candidates.map((candidate) => domainValue(candidate.domain));
  const digest = snapshotConfigurationDigest({ domains, ...configuration });
  const priorText = await readExisting(path);
  const prior = priorText === null ? null : parseObservationSnapshot(priorText, digest);
  const priorByDomain = new Map((prior?.observations || []).map((item) => [item.domain, item]));
  const observations: Observation[] = [];
  const changed: Array<{ domain: string; changes: ReturnType<typeof materialChanges> }> = [];
  const unavailable: string[] = [];
  const unavailableComponents: Array<{ domain: string; components: readonly ('dns' | 'registration')[] }> = [];
  for (let index = 0; index < domains.length; index++) {
    const domain = domains[index];
    const item = items[index];
    if (!domain || !item) throw new CliUsageError('Discovery observation snapshot alignment failed.');
    const previous = priorByDomain.get(domain);
    const attempt = currentAttempt(domain, item, previous, currentGeneratedAt, configuration.deep);
    const current = attempt.observation;
    if (attempt.unavailableComponents.length) {
      unavailable.push(domain);
      unavailableComponents.push({ domain, components: attempt.unavailableComponents });
    }
    observations.push(current);
    if (previous) {
      const changes = materialChanges(previous, current, attempt);
      if (changes.length) changed.push({ domain, changes });
    }
  }
  const document: SnapshotDocument = {
    schema: CLI_DISCOVERY_OBSERVATION_SCHEMA,
    version: CLI_DISCOVERY_OBSERVATION_VERSION,
    generatedAt: currentGeneratedAt,
    configurationDigestSha256: digest,
    observationCount: observations.length,
    observations,
  };
  const content = `${JSON.stringify(document, null, 2)}\n`;
  if (Buffer.byteLength(content, 'utf8') > MAX_DISCOVERY_OBSERVATION_BYTES) {
    throw new CliUsageError(`Discovery observation snapshots are limited to ${MAX_DISCOVERY_OBSERVATION_BYTES} bytes.`);
  }
  await writePrivateFile(path, content, {
    force: prior !== null,
    existingFileMessage: 'Discovery observation snapshot already exists and could not be replaced.',
  });
  return {
    baselineCreated: prior === null,
    previousGeneratedAt: prior?.generatedAt ?? null,
    currentGeneratedAt,
    changed,
    unavailable,
    unavailableComponents,
    unchanged: prior === null ? 0 : domains.filter((domain) =>
      !changed.some((item) => item.domain === domain) && !unavailable.includes(domain)).length,
    limitations: [
      'Only bounded registration-state and DNS summaries are retained; raw registry records, contacts, page contents, and request details are excluded.',
      'Registration and DNS retain separate observation times. A failed or partial component preserves its previous usable evidence and is reported as unavailable rather than as a removal or negative finding.',
      'Material differences are observation changes for analyst review and do not establish ownership, control, intent, safety, or maliciousness.',
    ],
  };
}

export {
  materialChanges,
  parseObservationSnapshot,
  snapshotConfigurationDigest,
  updateDiscoveryObservationSnapshot,
};
