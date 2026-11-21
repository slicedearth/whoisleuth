// Local, exact CIDR qualification for relationship-review evidence. The
// catalogue is maintenance-time data and never causes a browser or server
// request. Matches qualify shared infrastructure but never establish control,
// ownership, intent, safety, or maliciousness.

import snapshotValue from './common-infrastructure-snapshot.json' with { type: 'json' };
import { COMMON_INFRASTRUCTURE_SCHEMA, COMMON_INFRASTRUCTURE_VERSION, MAX_SNAPSHOT_ENTRIES, OFFICIAL_CLOUD_RANGE_URLS } from '../contracts/common-infrastructure.mts';
import { addressValue, compileCidr, inCompiledCidr, type CompiledCidr } from '../contracts/ip-address.mts';
export { compileCidr, inCompiledCidr } from '../contracts/ip-address.mts';

type JsonRecord = Record<string, unknown>;

export type CommonInfrastructureCategory = 'cdn_edge' | 'cloud_platform' | 'public_resolver';

export type CommonInfrastructureMatch = Readonly<{
  sourceId: string;
  sourceLabel: string;
  category: CommonInfrastructureCategory;
  cidr: string;
  sourceDate: string;
  sourceDigestSha256: string;
  snapshotGeneratedAt: string;
  provenance: string;
  limitation: string;
}>;

type Source = Readonly<{
  id: string;
  label: string;
  category: CommonInfrastructureCategory;
  sourceDate: string;
  sourceDigestSha256: string;
  sourcePath?: string;
  values: readonly string[];
}>;

type Snapshot = Readonly<{
  schema: typeof COMMON_INFRASTRUCTURE_SCHEMA;
  version: typeof COMMON_INFRASTRUCTURE_VERSION;
  generatedAt: string;
  source: Readonly<{
    project: string;
    repository: string;
    commit: string;
    licence: string;
  }>;
  entryCount: number;
  sources: readonly Source[];
  excludedSources: readonly Readonly<{ id: string; reason: string }>[];
  limitations: readonly string[];
}>;
export type CommonInfrastructureSnapshot = Snapshot;

type CompiledSource = readonly CompiledCidr[];

// Only snapshots admitted and frozen here are cached. Mutable caller-supplied
// snapshots are evaluated afresh, so changing their contents cannot reuse stale ranges.
const compiledSnapshots = new WeakMap<Snapshot, readonly CompiledSource[]>();

const SHA256_RE = /^[0-9a-f]{64}$/u;
const COMMIT_RE = /^[0-9a-f]{40}$/u;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
const EXPECTED_SOURCES: ReadonlyMap<string, CommonInfrastructureCategory> = new Map([
  ['amazon-aws', 'cloud_platform'],
  ['cloudflare', 'cdn_edge'],
  ['google-gcp', 'cloud_platform'],
  ['public-dns-core', 'public_resolver'],
] as const);

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseCommonInfrastructureSnapshot(value: unknown): Snapshot {
  const source = record(value);
  const sourceMeta = record(source?.source);
  const sourceCommit = typeof sourceMeta?.commit === 'string' ? sourceMeta.commit : '';
  if (source?.schema !== COMMON_INFRASTRUCTURE_SCHEMA
    || source.version !== COMMON_INFRASTRUCTURE_VERSION
    || typeof source.generatedAt !== 'string'
    || !Array.isArray(source.sources)
    || source.sources.length < 1
    || source.sources.length > EXPECTED_SOURCES.size
    || !Array.isArray(source.excludedSources)
    || source.excludedSources.length > EXPECTED_SOURCES.size - 1
    || !Number.isSafeInteger(source.entryCount)
    || !sourceMeta
    || typeof sourceMeta.project !== 'string'
    || typeof sourceMeta.repository !== 'string'
    || !COMMIT_RE.test(sourceCommit)
    || typeof sourceMeta.licence !== 'string') {
    throw new TypeError('Common-infrastructure snapshot has an unsupported contract.');
  }
  const sources: Source[] = [];
  const compiledSources: CompiledSource[] = [];
  const seenSourceIds = new Set<string>();
  let entryCount = 0;
  for (const rawSource of source.sources) {
    const item = record(rawSource);
    const category = item?.category;
    const id = typeof item?.id === 'string' ? item.id : '';
    const expectedCategory = EXPECTED_SOURCES.get(id);
    const digest = typeof item?.sourceDigestSha256 === 'string' ? item.sourceDigestSha256 : '';
    if (!item
      || !EXPECTED_SOURCES.has(id)
      || seenSourceIds.has(id)
      || typeof item.label !== 'string'
      || expectedCategory === undefined
      || category !== expectedCategory
      || !validDate(item.sourceDate)
      || !SHA256_RE.test(digest)
      || !Array.isArray(item.values)
      || item.values.length > MAX_SNAPSHOT_ENTRIES - entryCount
      || new Set(item.values).size !== item.values.length) {
      throw new TypeError('Common-infrastructure source has an invalid contract.');
    }
    seenSourceIds.add(id);
    const officialUrl = OFFICIAL_CLOUD_RANGE_URLS[id as keyof typeof OFFICIAL_CLOUD_RANGE_URLS];
    if (typeof item.sourcePath === 'string' && /^https?:/u.test(item.sourcePath)
      && id !== 'public-dns-core' && item.sourcePath !== officialUrl) {
      throw new TypeError('Common-infrastructure publisher URL is not supported.');
    }
    const ranges = item.values.map((value) => {
      const range = compileCidr(value);
      if (!range) throw new TypeError('Common-infrastructure source has an invalid contract.');
      return range;
    });
    const admitted: Source = Object.freeze({
      id,
      label: item.label,
      category: expectedCategory,
      sourceDate: item.sourceDate,
      sourceDigestSha256: digest,
      ...(officialUrl && item.sourcePath === officialUrl ? { sourcePath: officialUrl } : {}),
      values: Object.freeze(ranges.map((range) => range.cidr)),
    });
    sources.push(admitted);
    compiledSources.push(ranges);
    entryCount += item.values.length;
  }
  const excludedSources: Array<{ id: string; reason: string }> = [];
  for (const rawExcluded of source.excludedSources) {
    const item = record(rawExcluded);
    const id = typeof item?.id === 'string' ? item.id : '';
    const reason = typeof item?.reason === 'string' ? item.reason : '';
    if (!item
      || id === 'public-dns-core'
      || !EXPECTED_SOURCES.has(id)
      || seenSourceIds.has(id)
      || reason !== 'stale') {
      throw new TypeError('Common-infrastructure excluded source has an invalid contract.');
    }
    seenSourceIds.add(id);
    excludedSources.push(Object.freeze({ id, reason }));
  }
  if (seenSourceIds.size !== EXPECTED_SOURCES.size
    || !sources.some((item) => item.id === 'public-dns-core')
    || entryCount !== source.entryCount
    || entryCount > MAX_SNAPSHOT_ENTRIES) {
    throw new TypeError('Common-infrastructure snapshot entry count is inconsistent.');
  }
  const snapshot: Snapshot = Object.freeze({
    schema: COMMON_INFRASTRUCTURE_SCHEMA,
    version: COMMON_INFRASTRUCTURE_VERSION,
    generatedAt: source.generatedAt,
    source: Object.freeze({
      project: sourceMeta.project,
      repository: sourceMeta.repository,
      commit: sourceCommit,
      licence: sourceMeta.licence,
    }),
    entryCount,
    sources: Object.freeze(sources),
    excludedSources: Object.freeze(excludedSources),
    limitations: Object.freeze(Array.isArray(source.limitations)
      ? source.limitations.filter((item): item is string => typeof item === 'string').slice(0, 8)
      : []),
  });
  compiledSnapshots.set(snapshot, compiledSources);
  return snapshot;
}

export const COMMON_INFRASTRUCTURE_SNAPSHOT = parseCommonInfrastructureSnapshot(snapshotValue);

export function classifyCommonInfrastructureAddress(
  value: unknown,
  snapshot: Snapshot = COMMON_INFRASTRUCTURE_SNAPSHOT,
): CommonInfrastructureMatch[] {
  const address = addressValue(value);
  if (!address) return [];
  const matches: CommonInfrastructureMatch[] = [];
  const prepared = compiledSnapshots.get(snapshot);
  for (const [index, source] of snapshot.sources.entries()) {
    const ranges = prepared?.[index];
    const cidr = ranges
      ? ranges.find((range) => inCompiledCidr(address, range))?.cidr
      : source.values.find((entry) => {
        const range = compileCidr(entry);
        return range !== null && inCompiledCidr(address, range);
      });
    if (!cidr) continue;
    matches.push(Object.freeze({
      sourceId: source.id,
      sourceLabel: source.label,
      category: source.category,
      cidr,
      sourceDate: source.sourceDate,
      sourceDigestSha256: source.sourceDigestSha256,
      snapshotGeneratedAt: snapshot.generatedAt,
      provenance: source.sourcePath ? `${source.label} published ranges at ${source.sourcePath}`
        : `${snapshot.source.project} at ${snapshot.source.commit}`,
      limitation: 'This exact range match identifies shared infrastructure, not an origin host, tenant, account, operator, ownership, intent, safety, or maliciousness.',
    }));
    if (matches.length >= 4) break;
  }
  return matches;
}
