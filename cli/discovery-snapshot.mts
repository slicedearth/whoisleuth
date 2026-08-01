import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';

import { CliUsageError } from './errors.mts';
import { writePrivateFile } from './output-file.mts';

export const CLI_DISCOVERY_SNAPSHOT_SCHEMA = 'whoisleuth.cli.discovery-snapshot';
export const CLI_DISCOVERY_SNAPSHOT_VERSION = 1;
export const MAX_DISCOVERY_SNAPSHOT_BYTES = 4 * 1024 * 1024;
export const MAX_DISCOVERY_SNAPSHOT_DOMAINS = 10_000;

type SnapshotConfiguration = Readonly<{
  seed: string;
  preset: string;
  keyboardLayout: string;
  tlds: readonly string[];
  mutationFamilies: readonly string[];
  dictionaryDigestSha256: string | null;
}>;

type DiscoverySnapshotDocument = Readonly<{
  schema: typeof CLI_DISCOVERY_SNAPSHOT_SCHEMA;
  version: typeof CLI_DISCOVERY_SNAPSHOT_VERSION;
  generatedAt: string;
  configurationDigestSha256: string;
  candidateCount: number;
  candidates: readonly string[];
}>;

type DiscoverySnapshotDiff = Readonly<{
  baselineCreated: boolean;
  previousGeneratedAt: string | null;
  previousCandidateCount: number;
  currentCandidateCount: number;
  added: readonly string[];
  removed: readonly string[];
  unchanged: number;
  limitations: readonly string[];
}>;

const DOMAIN_RE = /^(?=.{1,253}$)(?:xn--[a-z0-9-]{1,59}|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:xn--[a-z0-9-]{1,59}|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))+$/u;
const SHA256_RE = /^[a-f0-9]{64}$/u;

function configurationDigest(configuration: SnapshotConfiguration): string {
  return createHash('sha256').update(JSON.stringify({
    seed: configuration.seed,
    preset: configuration.preset,
    keyboardLayout: configuration.keyboardLayout,
    tlds: [...configuration.tlds],
    mutationFamilies: [...configuration.mutationFamilies],
    dictionaryDigestSha256: configuration.dictionaryDigestSha256,
  })).digest('hex');
}

function normalizedDomains(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_DISCOVERY_SNAPSHOT_DOMAINS) {
    throw new CliUsageError(`Discovery snapshots support at most ${MAX_DISCOVERY_SNAPSHOT_DOMAINS} candidates.`);
  }
  const output = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== 'string' || !DOMAIN_RE.test(candidate) || candidate !== candidate.toLowerCase()) {
      throw new CliUsageError('Discovery snapshot contains an invalid candidate domain.');
    }
    output.add(candidate);
  }
  return [...output].sort();
}

function parseDiscoverySnapshot(text: string, expectedConfigurationDigest: string): DiscoverySnapshotDocument {
  if (Buffer.byteLength(text, 'utf8') > MAX_DISCOVERY_SNAPSHOT_BYTES) {
    throw new CliUsageError(`Discovery snapshot input is limited to ${MAX_DISCOVERY_SNAPSHOT_BYTES} bytes.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/u, ''));
  } catch {
    throw new CliUsageError('Discovery snapshot must be valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CliUsageError('Discovery snapshot must be one JSON object.');
  }
  const value = parsed as Record<string, unknown>;
  if (value.schema !== CLI_DISCOVERY_SNAPSHOT_SCHEMA || value.version !== CLI_DISCOVERY_SNAPSHOT_VERSION) {
    throw new CliUsageError(`Discovery snapshot must use ${CLI_DISCOVERY_SNAPSHOT_SCHEMA} version ${CLI_DISCOVERY_SNAPSHOT_VERSION}.`);
  }
  if (value.configurationDigestSha256 !== expectedConfigurationDigest) {
    throw new CliUsageError('Discovery snapshot configuration does not match this run. Choose another state file or restore the original discovery controls.');
  }
  if (typeof value.generatedAt !== 'string' || !Number.isFinite(Date.parse(value.generatedAt))) {
    throw new CliUsageError('Discovery snapshot collection time is invalid.');
  }
  const candidates = normalizedDomains(value.candidates);
  if (value.candidateCount !== candidates.length) throw new CliUsageError('Discovery snapshot candidate count is inconsistent.');
  return {
    schema: CLI_DISCOVERY_SNAPSHOT_SCHEMA,
    version: CLI_DISCOVERY_SNAPSHOT_VERSION,
    generatedAt: new Date(value.generatedAt).toISOString(),
    configurationDigestSha256: expectedConfigurationDigest,
    candidateCount: candidates.length,
    candidates,
  };
}

async function readExistingSnapshot(path: string): Promise<string | null> {
  try {
    const handle = await open(path, 'r');
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size > MAX_DISCOVERY_SNAPSHOT_BYTES) {
        throw new CliUsageError(`Discovery snapshot input is limited to ${MAX_DISCOVERY_SNAPSHOT_BYTES} bytes.`);
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

async function updateDiscoverySnapshot(
  path: string,
  candidatesValue: unknown,
  configuration: SnapshotConfiguration,
  generatedAt: string,
): Promise<DiscoverySnapshotDiff> {
  if (!path || path.length > 1024 || /[\u0000-\u001f\u007f]/u.test(path)) {
    throw new CliUsageError('Discovery snapshot path must be bounded text without control characters.');
  }
  const candidates = normalizedDomains(candidatesValue);
  const digest = configurationDigest(configuration);
  const existingText = await readExistingSnapshot(path);
  const previous = existingText === null ? null : parseDiscoverySnapshot(existingText, digest);
  const previousSet = new Set(previous?.candidates ?? []);
  const currentSet = new Set(candidates);
  const added = candidates.filter((domain) => !previousSet.has(domain));
  const removed = [...previousSet].filter((domain) => !currentSet.has(domain));
  const document: DiscoverySnapshotDocument = {
    schema: CLI_DISCOVERY_SNAPSHOT_SCHEMA,
    version: CLI_DISCOVERY_SNAPSHOT_VERSION,
    generatedAt: new Date(generatedAt).toISOString(),
    configurationDigestSha256: digest,
    candidateCount: candidates.length,
    candidates,
  };
  const content = `${JSON.stringify(document, null, 2)}\n`;
  if (Buffer.byteLength(content, 'utf8') > MAX_DISCOVERY_SNAPSHOT_BYTES) {
    throw new CliUsageError(`Discovery snapshot output is limited to ${MAX_DISCOVERY_SNAPSHOT_BYTES} bytes.`);
  }
  await writePrivateFile(path, content, {
    force: previous !== null,
    existingFileMessage: 'Discovery snapshot already exists and could not be replaced.',
  });
  return {
    baselineCreated: previous === null,
    previousGeneratedAt: previous?.generatedAt ?? null,
    previousCandidateCount: previous?.candidateCount ?? 0,
    currentCandidateCount: candidates.length,
    added,
    removed,
    unchanged: candidates.filter((domain) => previousSet.has(domain)).length,
    limitations: [
      'This local snapshot compares generated candidate names only and makes no network request.',
      'Added or removed candidates can reflect changed generation controls, dictionaries, or software versions rather than registration activity.',
      'The state file contains candidate domains and should be handled as analyst workspace data.',
    ],
  };
}

export { configurationDigest, parseDiscoverySnapshot, updateDiscoverySnapshot };
export type { DiscoverySnapshotDiff, SnapshotConfiguration };
