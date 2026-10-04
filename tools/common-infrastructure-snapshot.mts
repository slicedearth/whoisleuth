#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

import { writePrivateFile } from '../cli/output-file.mts';
import { readBoundedRegularTextFile } from '../lib/bounded-file.mts';
import { readTextCapped, safeFetchDetailed } from '../lib/safe-fetch.mts';
import retainedSnapshot from '../packages/relationships/common-infrastructure-snapshot.json' with { type: 'json' };
import { parseCommonInfrastructureSnapshot } from '../packages/relationships/common-infrastructure.mts';
import {
  COMMON_INFRASTRUCTURE_SCHEMA,
  COMMON_INFRASTRUCTURE_VERSION,
  MAX_SNAPSHOT_BYTES,
  MAX_SNAPSHOT_ENTRIES,
} from '../packages/contracts/common-infrastructure.mts';
export {
  COMMON_INFRASTRUCTURE_SCHEMA,
  COMMON_INFRASTRUCTURE_VERSION,
  MAX_SNAPSHOT_BYTES,
  MAX_SNAPSHOT_ENTRIES,
} from '../packages/contracts/common-infrastructure.mts';

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
  verification?: Readonly<{
    observedAt: string;
    rangesSha256: string;
    sources: readonly Readonly<{ url: string; sha256: string }>[];
  }>;
}>;
type ParsedSource = Readonly<{
  snapshot: SourceSnapshot;
  ageDays: number;
}>;
export type Snapshot = Readonly<{
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
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => Date;
  stdout?: WritableLike;
  stderr?: WritableLike;
}>;

export const SNAPSHOT_PATH = 'packages/relationships/common-infrastructure-snapshot.json';
export const DEFAULT_UPSTREAM_COMMIT = retainedSnapshot.source.commit;
export const CLOUDFLARE_RANGE_URLS = Object.freeze([
  'https://www.cloudflare.com/ips-v4',
  'https://www.cloudflare.com/ips-v6',
]);
export const MAX_SOURCE_BYTES = 1024 * 1024;
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

export function parseSource(
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

async function fetchSource(url: string, init?: RequestInit): Promise<Response> {
  return (await safeFetchDetailed(url, init, { maxRedirects: 0 })).response;
}

export async function verifyCloudflareRanges(
  values: readonly string[],
  now: Date,
  fetchImpl: (url: string, init: RequestInit) => Promise<Response> = fetchSource,
): Promise<NonNullable<SourceSnapshot['verification']>> {
  const official: string[] = [];
  const sources = [];
  for (const [index, url] of CLOUDFLARE_RANGE_URLS.entries()) {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(10_000), headers: { accept: 'text/plain' } });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Official range verification returned HTTP ${response.status}.`);
    }
    const body = await readTextCapped(response, 16 * 1024, { fatalUtf8: true });
    if (body.truncated) throw new RangeError('Official ranges exceeded their response byte limit.');
    const rows = body.text.trim().split(/\s+/u);
    if (!rows.length || rows.length > MAX_SNAPSHOT_ENTRIES
      || rows.some(value => normalizedCidr(value) !== value || isIP(value.split('/')[0]!) !== (index === 0 ? 4 : 6))) {
      throw new TypeError('Official ranges contain malformed entries.');
    }
    official.push(...rows);
    sources.push({ url, sha256: createHash('sha256').update(body.text).digest('hex') });
  }
  const sorted = [...official].sort((left, right) => left.localeCompare(right));
  if (new Set(sorted).size !== sorted.length) throw new TypeError('Official ranges contain duplicate entries.');
  if (!isDeepStrictEqual(sorted, [...values])) {
    throw new OfficialRangeMismatchError('Retained edge ranges differ from the official source; review the pinned warning list before refreshing.');
  }
  return Object.freeze({
    observedAt: now.toISOString(),
    rangesSha256: createHash('sha256').update(JSON.stringify(sorted)).digest('hex'),
    sources: Object.freeze(sources),
  });
}

export class OfficialRangeMismatchError extends Error {}

export function commonInfrastructureHealth(now = new Date(), value: unknown = retainedSnapshot) {
  const admitted = parseCommonInfrastructureSnapshot(value);
  const raw = record(value, 'Retained infrastructure');
  const sources = raw.sources as SourceSnapshot[];
  const ages: number[] = [];
  const sourceAges: { id: string; ageDays: number }[] = [];
  for (const source of sources) {
    if (source.id === 'public-dns-core') continue;
    const proof = source.verification;
    if (proof && (source.id !== 'cloudflare'
      || !Array.isArray(proof.sources) || proof.sources.length !== CLOUDFLARE_RANGE_URLS.length
      || !proof.sources.every((item, index) => item.url === CLOUDFLARE_RANGE_URLS[index] && /^[a-f0-9]{64}$/u.test(item.sha256))
      || proof.rangesSha256 !== createHash('sha256').update(JSON.stringify(source.values)).digest('hex')
      || !Number.isFinite(Date.parse(proof.observedAt))
      || new Date(proof.observedAt).toISOString() !== proof.observedAt
      || Date.parse(proof.observedAt) > Date.parse(admitted.generatedAt)
      || Date.parse(proof.observedAt) < Date.parse(source.sourceDate))) {
      throw new TypeError('Retained range verification has invalid provenance.');
    }
    const age = Math.floor((now.getTime() - Date.parse(proof?.observedAt ?? source.sourceDate)) / 86_400_000);
    ages.push(age);
    sourceAges.push({ id: source.id, ageDays: age });
  }
  const ageDays = ages.length ? Math.max(...ages) : null;
  const state = !Number.isFinite(now.getTime()) || Date.parse(admitted.generatedAt) > now.getTime()
    || ages.some(age => age < 0) || !ages.length
    ? 'unavailable' as const
    : admitted.excludedSources.length || (ageDays ?? 0) > FRESHNESS_DAYS ? 'stale' as const : 'current' as const;
  return Object.freeze({ state, ageDays: state === 'unavailable' ? null : ageDays,
    observedAt: admitted.generatedAt, itemCount: admitted.entryCount, excludedCount: admitted.excludedSources.length,
    sourceAges: Object.freeze(sourceAges) });
}

export async function buildCommonInfrastructureSnapshot(
  commit: string,
  options: MainOptions = {},
): Promise<Snapshot> {
  if (!COMMIT_RE.test(commit)) throw new TypeError('Upstream commit must be a full lowercase SHA-1.');
  const fetchImpl = options.fetchImpl ?? fetchSource;
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
    if (parsed.ageDays > FRESHNESS_DAYS && definition.id === 'cloudflare') {
      // Unchanged allocations are not stale merely because their publisher has
      // not changed the list. Preserve that date and independently record a
      // digest-bound observation against both official address-family lists.
      const verification = await verifyCloudflareRanges(parsed.snapshot.values, now, fetchImpl);
      sources.push(Object.freeze({ ...parsed.snapshot, verification }));
    } else if (parsed.ageDays > FRESHNESS_DAYS) {
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
      'An older warning list is excluded unless its complete range set is independently verified against the recorded official provider sources. Publisher change dates and verification times remain distinct.',
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
    const now = options.now?.() ?? new Date();
    const outputPath = path.join(root, SNAPSHOT_PATH);
    let retainedSnapshot: JsonRecord | null = null;
    if (checkOnly) {
      const retained = await readBoundedRegularTextFile(outputPath, {
        maximumBytes: MAX_SNAPSHOT_BYTES,
        minimumBytes: 1,
        label: 'Retained Common-infrastructure snapshot',
      });
      retainedSnapshot = record(JSON.parse(retained), 'Retained Common-infrastructure snapshot');
      retainedComparisonValue(retainedSnapshot);
      if (Date.parse(String(retainedSnapshot.generatedAt)) > now.getTime()) {
        throw new TypeError('Retained Common-infrastructure snapshot generatedAt is in the future.');
      }
    }
    // Reproduce content admission at the retained observation time. Elapsed
    // source age is checked separately and must not masquerade as content drift.
    const snapshot = await buildCommonInfrastructureSnapshot(commit, {
      ...options,
      now: () => retainedSnapshot ? new Date(String(retainedSnapshot.generatedAt)) : now,
    });
    const output = `${JSON.stringify(snapshot, null, 2)}\n`;
    if (Buffer.byteLength(output, 'utf8') > MAX_SNAPSHOT_BYTES) {
      throw new TypeError('Generated Common-infrastructure snapshot exceeds its byte limit.');
    }
    if (retainedSnapshot) {
      const expectedSnapshot = record(snapshot, 'Generated Common-infrastructure snapshot');
      if (!isDeepStrictEqual(
        retainedComparisonValue(retainedSnapshot),
        retainedComparisonValue(expectedSnapshot),
      )) {
        throw new TypeError('Retained Common-infrastructure snapshot differs from the fully validated source set.');
      }
      stdout.write(`Validated retained content: ${snapshot.entryCount} Common-infrastructure entries and ${snapshot.excludedSources.length} excluded sources; no snapshot replaced.\n`);
      const staleSources = snapshot.sources.filter(source => source.id !== 'public-dns-core'
        && Math.floor((now.getTime() - Date.parse(source.verification?.observedAt ?? `${source.sourceDate}T00:00:00.000Z`)) / 86_400_000) > FRESHNESS_DAYS);
      if (staleSources.length) {
        stderr.write(`Freshness review required: retained upstream sources exceed ${FRESHNESS_DAYS} days: ${staleSources.map(source => source.id).join(', ')}. Content is unchanged; refresh from reviewed upstream sources.\n`);
        return 1;
      }
      stdout.write('Retained upstream source ages remain within the freshness window. Manually reviewed resolver provenance is unchanged.\n');
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
