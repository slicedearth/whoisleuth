import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';

import type { BulkLookupResult } from './bulk.mts';
import { availabilityState, bulkDnsSummary } from './bulk-output.mts';
import { CliUsageError } from './errors.mts';
import { writePrivateFile } from './output-file.mts';

export const CLI_DISCOVERY_OBSERVATION_SCHEMA = 'whoisleuth.cli.discovery-observation-snapshot';
export const CLI_DISCOVERY_OBSERVATION_VERSION = 1;
export const MAX_DISCOVERY_OBSERVATION_BYTES = 8 * 1024 * 1024;
const MAX_DISCOVERY_OBSERVATIONS = 500;

type Candidate = { domain: unknown };
type Observation = {
  domain: string;
  observedAt: string;
  latestAttemptAt: string;
  latestAttemptState: 'error' | 'success';
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
  if (!domain || domain.length > 253 || !domain.includes('.') || /[\u0000-\u0020\u007f]/u.test(domain)) {
    throw new CliUsageError('Discovery observation snapshot contains an invalid domain.');
  }
  return domain;
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
  if (typeof dns.status !== 'string' || dns.status.length > 40) return null;
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

function normalizeObservation(value: unknown): Observation | null {
  const item = record(value);
  const dns = normalizeDns(item.dns);
  if (!dns || typeof item.observedAt !== 'string' || !Number.isFinite(Date.parse(item.observedAt))
    || typeof item.latestAttemptAt !== 'string' || !Number.isFinite(Date.parse(item.latestAttemptAt))
    || !['error', 'success'].includes(String(item.latestAttemptState))
    || typeof item.availabilityState !== 'string' || item.availabilityState.length > 40
    || typeof item.confidence !== 'string' || item.confidence.length > 40) return null;
  return {
    domain: domainValue(item.domain),
    observedAt: new Date(item.observedAt).toISOString(),
    latestAttemptAt: new Date(item.latestAttemptAt).toISOString(),
    latestAttemptState: item.latestAttemptState as Observation['latestAttemptState'],
    availabilityState: item.availabilityState,
    confidence: item.confidence,
    dns,
  };
}

function parseObservationSnapshot(text: string, expectedDigest: string): SnapshotDocument {
  if (Buffer.byteLength(text, 'utf8') > MAX_DISCOVERY_OBSERVATION_BYTES) {
    throw new CliUsageError(`Discovery observation snapshots are limited to ${MAX_DISCOVERY_OBSERVATION_BYTES} bytes.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/u, ''));
  } catch {
    throw new CliUsageError('Discovery observation snapshot must be valid JSON.');
  }
  const document = record(parsed);
  if (document.schema !== CLI_DISCOVERY_OBSERVATION_SCHEMA || document.version !== CLI_DISCOVERY_OBSERVATION_VERSION) {
    throw new CliUsageError(`Discovery observation snapshot must use ${CLI_DISCOVERY_OBSERVATION_SCHEMA} version ${CLI_DISCOVERY_OBSERVATION_VERSION}.`);
  }
  if (document.configurationDigestSha256 !== expectedDigest) {
    throw new CliUsageError('Discovery observation snapshot does not match this candidate set, scan mode, or resolver selection.');
  }
  if (typeof document.generatedAt !== 'string' || !Number.isFinite(Date.parse(document.generatedAt))
    || !Array.isArray(document.observations) || document.observations.length > MAX_DISCOVERY_OBSERVATIONS) {
    throw new CliUsageError('Discovery observation snapshot metadata is invalid.');
  }
  const observations = document.observations.map(normalizeObservation);
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
    generatedAt: new Date(document.generatedAt).toISOString(),
    configurationDigestSha256: expectedDigest,
    observationCount: normalized.length,
    observations: normalized,
  };
}

async function readExisting(path: string): Promise<string | null> {
  try {
    const handle = await open(path, 'r');
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size > MAX_DISCOVERY_OBSERVATION_BYTES) {
        throw new CliUsageError(`Discovery observation snapshots are limited to ${MAX_DISCOVERY_OBSERVATION_BYTES} bytes.`);
      }
      return await handle.readFile({ encoding: 'utf8' });
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function currentObservation(domain: string, item: BulkLookupResult, generatedAt: string): Observation | null {
  if (!item.ok) return null;
  const availability = record(record(item.result).availability);
  return {
    domain,
    observedAt: generatedAt,
    latestAttemptAt: generatedAt,
    latestAttemptState: 'success',
    availabilityState: availabilityState(item) || 'unknown',
    confidence: typeof availability.confidence === 'string' ? availability.confidence.slice(0, 40) : 'unknown',
    dns: bulkDnsSummary(item),
  };
}

function comparableDns(dns: Observation['dns']): boolean {
  return !['error', 'skipped', 'unavailable'].includes(dns.status);
}

function materialChanges(previous: Observation, current: Observation) {
  const changes: Array<{ field: string; before: unknown; after: unknown }> = [];
  const compare = (field: string, before: unknown, after: unknown) => {
    if (JSON.stringify(before) !== JSON.stringify(after)) changes.push({ field, before, after });
  };
  compare('availabilityState', previous.availabilityState, current.availabilityState);
  compare('confidence', previous.confidence, current.confidence);
  if (comparableDns(previous.dns) && comparableDns(current.dns)) {
    for (const field of ['a', 'aaaa', 'ns', 'mx', 'hasNullMx', 'hasSpf', 'hasDmarc'] as const) {
      compare(`dns.${field}`, previous.dns[field], current.dns[field]);
    }
  }
  compare('dns.status', previous.dns.status, current.dns.status);
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
  const domains = candidates.map((candidate) => domainValue(candidate.domain));
  const digest = snapshotConfigurationDigest({ domains, ...configuration });
  const priorText = await readExisting(path);
  const prior = priorText === null ? null : parseObservationSnapshot(priorText, digest);
  const priorByDomain = new Map((prior?.observations || []).map((item) => [item.domain, item]));
  const observations: Observation[] = [];
  const changed: Array<{ domain: string; changes: ReturnType<typeof materialChanges> }> = [];
  const unavailable: string[] = [];
  for (let index = 0; index < domains.length; index++) {
    const domain = domains[index];
    const item = items[index];
    if (!domain || !item) throw new CliUsageError('Discovery observation snapshot alignment failed.');
    const previous = priorByDomain.get(domain);
    const current = currentObservation(domain, item, generatedAt);
    if (!current) {
      unavailable.push(domain);
      if (previous) observations.push({ ...previous, latestAttemptAt: generatedAt, latestAttemptState: 'error' });
      else observations.push({
        domain, observedAt: generatedAt, latestAttemptAt: generatedAt, latestAttemptState: 'error',
        availabilityState: 'unknown', confidence: 'unknown', dns: bulkDnsSummary(item),
      });
      continue;
    }
    observations.push(current);
    if (previous) {
      const changes = materialChanges(previous, current);
      if (changes.length) changed.push({ domain, changes });
    }
  }
  const document: SnapshotDocument = {
    schema: CLI_DISCOVERY_OBSERVATION_SCHEMA,
    version: CLI_DISCOVERY_OBSERVATION_VERSION,
    generatedAt,
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
    currentGeneratedAt: generatedAt,
    changed,
    unavailable,
    unchanged: prior === null ? 0 : observations.length - changed.length - unavailable.length,
    limitations: [
      'Only bounded registration-state and DNS summaries are retained; raw registry records, contacts, page contents, and request details are excluded.',
      'A failed collection attempt preserves the previous observation and is reported as unavailable rather than as a removal or negative finding.',
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
