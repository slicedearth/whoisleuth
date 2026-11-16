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
import { addressValue, canonicalIpAddress } from '../packages/contracts/ip-address.mts';
import { CLOUDFLARE_RANGE_URLS, FRESHNESS_DAYS } from '../packages/relationships/common-infrastructure-health.mts';
export { CLOUDFLARE_RANGE_URLS, FRESHNESS_DAYS, commonInfrastructureHealth } from '../packages/relationships/common-infrastructure-health.mts';
import {
  COMMON_INFRASTRUCTURE_SCHEMA,
  COMMON_INFRASTRUCTURE_VERSION,
  MAX_SNAPSHOT_BYTES,
  MAX_SNAPSHOT_ENTRIES,
  OFFICIAL_CLOUD_RANGE_URLS,
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
  url?: string;
  maximumBytes: number;
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
export const MAX_SOURCE_BYTES = 6 * 1024 * 1024;
export const REVIEWED_PUBLIC_RESOLVERS_SOURCE_DATE = '2026-08-10';
export const SOURCE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'amazon-aws',
    label: 'Amazon Web Services',
    category: 'cloud_platform',
    list: 'amazon-aws',
    url: OFFICIAL_CLOUD_RANGE_URLS['amazon-aws'],
    maximumBytes: MAX_SOURCE_BYTES,
  }),
  Object.freeze({
    id: 'cloudflare',
    label: 'Cloudflare shared edge',
    category: 'cdn_edge',
    list: 'cloudflare',
    maximumBytes: 1024 * 1024,
  }),
  Object.freeze({
    id: 'google-gcp',
    label: 'Google Cloud Platform',
    category: 'cloud_platform',
    list: 'google-gcp',
    url: OFFICIAL_CLOUD_RANGE_URLS['google-gcp'],
    maximumBytes: 1024 * 1024,
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
  if (Buffer.byteLength(rawText, 'utf8') > definition.maximumBytes) {
    throw new TypeError('Upstream range response exceeds its byte limit.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new TypeError(`${definition.id} warning list is not valid JSON.`);
  }
  const data = record(parsed, `${definition.id} warning list`);
  if (definition.url) return parseOfficialCloudSource(definition, data, rawText, now);
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

// The publisher can list overlapping service ranges. Preserve their exact
// union, as the warning-list projection did, rather than shipping duplicates
// or expanding the runtime catalogue when the source representation changes.
function compactRanges(values: ReadonlySet<string>): string[] {
  const ranges = [...values].map(cidr => {
    const [text, prefixText] = cidr.split('/');
    const address = addressValue(text)!;
    const prefix = Number(prefixText);
    const size = 1n << BigInt((address.family === 4 ? 32 : 128) - prefix);
    return { family: address.family, prefix, size, network: BigInt(address.value) & ~(size - 1n) };
  }).sort((a, b) => a.family - b.family || (a.network < b.network ? -1 : a.network > b.network ? 1 : a.prefix - b.prefix));
  const compact: typeof ranges = [];
  for (let range of ranges) {
    let last = compact.at(-1);
    if (last?.family === range.family && last.network + last.size >= range.network + range.size) continue;
    while (last?.family === range.family && range.prefix > 0 && last.prefix === range.prefix
      && last.network + range.size === range.network && last.network % (range.size * 2n) === 0n) {
      compact.pop();
      range = { ...range, prefix: range.prefix - 1, size: range.size * 2n, network: last.network };
      last = compact.at(-1);
    }
    compact.push(range);
  }
  return compact.map(range => {
    const address = range.family === 4
      ? [24, 16, 8, 0].map(shift => String((range.network >> BigInt(shift)) & 255n)).join('.')
      : canonicalIpAddress(Array.from({ length: 8 }, (_, index) =>
        ((range.network >> BigInt((7 - index) * 16)) & 0xffffn).toString(16)).join(':'))!;
    return `${address}/${range.prefix}`;
  }).sort((left, right) => left.localeCompare(right));
}

function parseOfficialCloudSource(definition: SourceDefinition, data: JsonRecord, text: string, now: Date): ParsedSource {
  const aws = definition.id === 'amazon-aws';
  const published = aws ? data.createDate : data.creationTime;
  const datePattern = aws ? /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/u
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})?$/u;
  if (typeof published !== 'string' || !datePattern.test(published)
    || typeof data.syncToken !== 'string' || !/^\d{1,20}$/u.test(data.syncToken)) {
    throw new TypeError('Official cloud ranges have invalid publication metadata.');
  }
  const date = sourceDate(Number(published.slice(0, 10).replaceAll('-', '')));
  const clock = published.slice(11).split(aws ? '-' : ':');
  if (Number(clock[0]) > 23 || Number(clock[1]) > 59 || Number(clock[2]?.slice(0, 2)) > 59) {
    throw new TypeError('Official cloud ranges have invalid publication metadata.');
  }
  const groups = aws ? [data.prefixes, data.ipv6_prefixes] : [data.prefixes];
  let count = 0;
  for (const group of groups) {
    if (!Array.isArray(group) || !group.length || group.length > MAX_SNAPSHOT_ENTRIES - count) {
      throw new TypeError('Official cloud range count is outside the accepted bounds.');
    }
    count += group.length;
  }
  const values = new Set<string>();
  for (const [index, group] of groups.entries()) {
    for (const raw of group as unknown[]) {
      const entry = record(raw, 'Official cloud range');
      const cidr = aws ? entry[index === 0 ? 'ip_prefix' : 'ipv6_prefix'] : entry.ipv4Prefix ?? entry.ipv6Prefix;
      const expectedFamily = aws ? index === 0 ? 4 : 6 : entry.ipv4Prefix !== undefined ? 4 : 6;
      if ((!aws && entry.ipv4Prefix !== undefined && entry.ipv6Prefix !== undefined)
        || typeof cidr !== 'string' || normalizedCidr(cidr) !== cidr || isIP(cidr.split('/')[0]!) !== expectedFamily) {
        throw new TypeError('Official cloud ranges contain malformed entries.');
      }
      // A provider may repeat a prefix for several services. Keep its exact
      // address coverage once, without turning service labels into attribution.
      values.add(cidr);
    }
  }
  const ageDays = Math.floor((now.getTime() - Date.parse(`${date}T00:00:00.000Z`)) / 86_400_000);
  if (ageDays < 0) throw new TypeError('Official cloud range publication date is in the future.');
  return Object.freeze({ ageDays, snapshot: Object.freeze({
    id: definition.id, label: definition.label, category: definition.category, type: 'cidr',
    sourcePath: definition.url!, sourceVersion: Number(date.replaceAll('-', '')), sourceDate: date,
    sourceDigestSha256: createHash('sha256').update(text).digest('hex'),
    values: Object.freeze(compactRanges(values)),
  }) });
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
    const url = 'url' in definition ? definition.url
      : `https://raw.githubusercontent.com/MISP/misp-warninglists/${commit}/lists/${definition.list}/list.json`;
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json', 'user-agent': 'WHOISleuth catalogue maintenance' },
      signal: AbortSignal.timeout(10_000),
    });
    const text = await boundedResponseText(response, definition.maximumBytes);
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
      'Cloud ranges come directly from the recorded official publisher URLs. The warning-list revision and licence describe the separately retained edge list, not those publisher feeds.',
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
