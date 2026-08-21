#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

import { writePrivateFile } from '../cli/output-file.mts';
import { readBoundedRegularTextFile } from '../lib/bounded-file.mts';

type JsonRecord = Record<string, unknown>;
type WritableLike = { write(value: string): unknown };
type SourceDefinition = Readonly<{
  id: string;
  label: string;
  category: 'cdn_edge' | 'cloud_platform';
  list: string;
}>;
type SourceSnapshot = Readonly<{
  id: string;
  label: string;
  category: 'cdn_edge' | 'cloud_platform' | 'public_resolver';
  type: 'cidr';
  sourcePath: string;
  sourceVersion: number;
  sourceDate: string;
  sourceDigestSha256: string;
  values: readonly string[];
}>;
type ParsedSource = Readonly<{
  snapshot: SourceSnapshot;
  ageDays: number;
}>;
type Snapshot = Readonly<{
  schema: typeof COMMON_INFRASTRUCTURE_SCHEMA;
  version: typeof COMMON_INFRASTRUCTURE_VERSION;
  generatedAt: string;
  source: Readonly<{
    project: 'MISP warning-lists';
    repository: 'https://github.com/MISP/misp-warninglists';
    commit: string;
    licence: 'CC0-1.0 OR BSD-2-Clause';
  }>;
  freshnessDays: number;
  maximumEntries: number;
  entryCount: number;
  sources: readonly SourceSnapshot[];
  excludedSources: readonly Readonly<{
    id: string;
    reason: string;
  }>[];
  limitations: readonly string[];
}>;
type MainOptions = Readonly<{
  repositoryRoot?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  stdout?: WritableLike;
  stderr?: WritableLike;
}>;

export const SNAPSHOT_PATH = 'packages/relationships/common-infrastructure-snapshot.json';
export const COMMON_INFRASTRUCTURE_SCHEMA = 'whoisleuth.common-infrastructure';
export const COMMON_INFRASTRUCTURE_VERSION = 1;
export const DEFAULT_UPSTREAM_COMMIT = '950282a018f0552d99f156412b650d31e7ff4688';
export const MAX_SOURCE_BYTES = 1024 * 1024;
export const MAX_SNAPSHOT_BYTES = 1024 * 1024;
export const MAX_SNAPSHOT_ENTRIES = 20_000;
export const FRESHNESS_DAYS = 30;
export const REVIEWED_PUBLIC_RESOLVERS_SOURCE_DATE = '2026-08-10';
export const SOURCE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'amazon-aws',
    label: 'Amazon Web Services',
    category: 'cloud_platform',
    list: 'amazon-aws',
  }),
  Object.freeze({
    id: 'cloudflare',
    label: 'Cloudflare shared edge',
    category: 'cdn_edge',
    list: 'cloudflare',
  }),
  Object.freeze({
    id: 'google-gcp',
    label: 'Google Cloud Platform',
    category: 'cloud_platform',
    list: 'google-gcp',
  }),
] satisfies readonly SourceDefinition[]);
export const REVIEWED_PUBLIC_RESOLVERS = Object.freeze([
  '8.8.4.4/32',
  '8.8.8.8/32',
  '195.46.39.39/32',
  '195.46.39.40/32',
  '208.67.220.220/32',
  '208.67.222.222/32',
] as const);

const COMMIT_RE = /^[0-9a-f]{40}$/u;
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as JsonRecord;
}

function retainedComparisonValue(value: JsonRecord): JsonRecord {
  const generatedAt = value.generatedAt;
  if (typeof generatedAt !== 'string'
    || generatedAt.length > 64
    || Number.isNaN(Date.parse(generatedAt))
    || new Date(generatedAt).toISOString() !== generatedAt) {
    throw new TypeError('Retained Common-infrastructure snapshot generatedAt must be canonical.');
  }
  const { generatedAt: _ignoredGeneratedAt, ...contract } = value;
  return contract;
}

function sourceDate(value: unknown): string {
  const version = Number(value);
  const text = String(version);
  if (!Number.isSafeInteger(version) || !/^\d{8}$/u.test(text)) {
    throw new TypeError('Warning-list version must be a YYYYMMDD integer.');
  }
  const date = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new TypeError('Warning-list version is not a valid date.');
  }
  return date;
}

function normalizedCidr(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 96 || CONTROL_RE.test(value)) return null;
  const [address, prefixText, ...rest] = value.trim().toLowerCase().split('/');
  const family = address ? isIP(address) : 0;
  if (rest.length || !address || !prefixText || !family || !/^\d{1,3}$/u.test(prefixText)) return null;
  const prefix = Number(prefixText);
  if (prefix > (family === 4 ? 32 : 128)) return null;
  return `${address}/${prefix}`;
}

async function boundedResponseText(response: Response, maximum: number): Promise<string> {
  if (!response.ok) throw new TypeError(`Upstream warning-list request failed with HTTP ${response.status}.`);
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximum) {
    throw new TypeError('Upstream warning-list response exceeds its byte limit.');
  }
  if (!response.body) throw new TypeError('Upstream warning-list response had no body.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > maximum) {
      await reader.cancel();
      throw new TypeError('Upstream warning-list response exceeds its byte limit.');
    }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function parseSource(
  definition: SourceDefinition,
  rawText: string,
  now: Date,
): ParsedSource {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new TypeError(`${definition.id} warning list is not valid JSON.`);
  }
  const data = record(parsed, `${definition.id} warning list`);
  if (data.type !== 'cidr') throw new TypeError(`${definition.id} must use exact CIDR matching.`);
  const date = sourceDate(data.version);
  const rawValues = Array.isArray(data.list) ? data.list : [];
  if (!rawValues.length || rawValues.length > MAX_SNAPSHOT_ENTRIES) {
    throw new TypeError(`${definition.id} source entry count is outside the accepted bounds.`);
  }
  const values = [...new Set(rawValues.map(normalizedCidr).filter((value): value is string => value !== null))]
    .sort((left, right) => left.localeCompare(right));
  if (values.length !== rawValues.length) {
    throw new TypeError(`${definition.id} contains malformed or duplicate CIDR entries.`);
  }
  const snapshot = Object.freeze({
    id: definition.id,
    label: definition.label,
    category: definition.category,
    type: 'cidr',
    sourcePath: `lists/${definition.list}/list.json`,
    sourceVersion: Number(data.version),
    sourceDate: date,
    sourceDigestSha256: createHash('sha256').update(rawText).digest('hex'),
    values,
  });
  const ageDays = Math.floor((now.getTime() - Date.parse(`${date}T00:00:00.000Z`)) / 86_400_000);
  if (ageDays < 0) {
    throw new TypeError(`${definition.id} source date is in the future.`);
  }
  return Object.freeze({ snapshot, ageDays });
}

export async function buildCommonInfrastructureSnapshot(
  commit: string,
  options: MainOptions = {},
): Promise<Snapshot> {
  if (!COMMIT_RE.test(commit)) throw new TypeError('Upstream commit must be a full lowercase SHA-1.');
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now?.() ?? new Date();
  const sources: SourceSnapshot[] = [];
  const excludedSources: Array<Readonly<{ id: string; reason: string }>> = [];

  for (const definition of SOURCE_DEFINITIONS) {
    const url = `https://raw.githubusercontent.com/MISP/misp-warninglists/${commit}/lists/${definition.list}/list.json`;
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json', 'user-agent': 'WHOISleuth catalogue maintenance' },
      signal: AbortSignal.timeout(10_000),
    });
    const text = await boundedResponseText(response, MAX_SOURCE_BYTES);
    const parsed = parseSource(definition, text, now);
    if (parsed.ageDays > FRESHNESS_DAYS) {
      excludedSources.push(Object.freeze({
        id: definition.id,
        reason: 'stale',
      }));
    } else {
      sources.push(parsed.snapshot);
    }
  }

  const publicResolverProjection = JSON.stringify(REVIEWED_PUBLIC_RESOLVERS);
  sources.push(Object.freeze({
    id: 'public-dns-core',
    label: 'Reviewed public DNS resolvers',
    category: 'public_resolver',
    type: 'cidr',
    sourcePath: 'https://misp.github.io/misp-warninglists/#format-of-a-warning-list',
    sourceVersion: 1,
    sourceDate: REVIEWED_PUBLIC_RESOLVERS_SOURCE_DATE,
    sourceDigestSha256: createHash('sha256').update(publicResolverProjection).digest('hex'),
    values: REVIEWED_PUBLIC_RESOLVERS,
  }));

  const entryCount = sources.reduce((total, source) => total + source.values.length, 0);
  if (!entryCount || entryCount > MAX_SNAPSHOT_ENTRIES) {
    throw new TypeError('Validated Common-infrastructure entries are empty or exceed the snapshot limit.');
  }
  return Object.freeze({
    schema: COMMON_INFRASTRUCTURE_SCHEMA,
    version: COMMON_INFRASTRUCTURE_VERSION,
    generatedAt: now.toISOString(),
    source: Object.freeze({
      project: 'MISP warning-lists',
      repository: 'https://github.com/MISP/misp-warninglists',
      commit,
      licence: 'CC0-1.0 OR BSD-2-Clause',
    }),
    freshnessDays: FRESHNESS_DAYS,
    maximumEntries: MAX_SNAPSHOT_ENTRIES,
    entryCount,
    sources: Object.freeze(sources),
    excludedSources: Object.freeze(excludedSources),
    limitations: Object.freeze([
      'A match identifies an address range published as shared cloud or delivery infrastructure. It does not identify the origin host, tenant, account, operator, ownership, intent, safety, or maliciousness.',
      'Non-matches are inconclusive because the catalogue is deliberately bounded and does not cover every provider, product, address, hosting service, resolver, or historical allocation.',
      'The snapshot is used locally and never causes a provider request during Lookup, Bulk, Monitor, cases, or graph review.',
      'A fully validated source older than the reviewed freshness window is listed as excluded and contributes no active ranges until its publisher refreshes it.',
    ]),
  });
}

export function parseArguments(args: readonly string[]): { commit: string; checkOnly: boolean } {
  let commit = DEFAULT_UPSTREAM_COMMIT;
  let checkOnly = false;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === '--check-only') {
      checkOnly = true;
      continue;
    }
    if (value === '--commit') {
      commit = args[index + 1] ?? '';
      index += 1;
      continue;
    }
    throw new TypeError('Usage: node tools/common-infrastructure-snapshot.mts [--commit <sha>] [--check-only]');
  }
  if (!COMMIT_RE.test(commit)) throw new TypeError('Upstream commit must be a full lowercase SHA-1.');
  return { commit, checkOnly };
}

export async function main(args = process.argv.slice(2), options: MainOptions = {}): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  try {
    const { commit, checkOnly } = parseArguments(args);
    const root = path.resolve(options.repositoryRoot ?? process.cwd());
    const snapshot = await buildCommonInfrastructureSnapshot(commit, options);
    const output = `${JSON.stringify(snapshot, null, 2)}\n`;
    if (Buffer.byteLength(output, 'utf8') > MAX_SNAPSHOT_BYTES) {
      throw new TypeError('Generated Common-infrastructure snapshot exceeds its byte limit.');
    }
    const outputPath = path.join(root, SNAPSHOT_PATH);
    if (checkOnly) {
      const retained = await readBoundedRegularTextFile(outputPath, {
        maximumBytes: MAX_SNAPSHOT_BYTES,
        minimumBytes: 1,
        label: 'Retained Common-infrastructure snapshot',
      });
      const retainedSnapshot = record(JSON.parse(retained), 'Retained Common-infrastructure snapshot');
      const expectedSnapshot = record(snapshot, 'Generated Common-infrastructure snapshot');
      if (!isDeepStrictEqual(
        retainedComparisonValue(retainedSnapshot),
        retainedComparisonValue(expectedSnapshot),
      )) {
        throw new TypeError('Retained Common-infrastructure snapshot differs from the fully validated source set.');
      }
      stdout.write(`Validated ${snapshot.entryCount} current Common-infrastructure entries and ${snapshot.excludedSources.length} excluded stale sources without replacing the retained snapshot.\n`);
      return 0;
    }
    await writePrivateFile(outputPath, output, { force: true });
    stdout.write(`Updated ${SNAPSHOT_PATH} with ${snapshot.entryCount} entries from ${sourcesSummary(snapshot)}; ${snapshot.excludedSources.length} stale sources excluded.\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : 'Common-infrastructure snapshot update failed.'}\n`);
    return 1;
  }
}

function sourcesSummary(snapshot: Snapshot): string {
  return snapshot.sources.map((source) => source.id).join(', ');
}

const isEntrypoint = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (isEntrypoint) process.exitCode = await main();
