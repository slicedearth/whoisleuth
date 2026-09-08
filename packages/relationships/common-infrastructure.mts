// Local, exact CIDR qualification for relationship-review evidence. The
// catalogue is maintenance-time data and never causes a browser or server
// request. Matches qualify shared infrastructure but never establish control,
// ownership, intent, safety, or maliciousness.

import snapshotValue from './common-infrastructure-snapshot.json' with { type: 'json' };
import { COMMON_INFRASTRUCTURE_SCHEMA, COMMON_INFRASTRUCTURE_VERSION, MAX_SNAPSHOT_ENTRIES } from '../contracts/common-infrastructure.mts';

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

type AddressValue = Readonly<{ family: 4; value: number } | { family: 6; value: bigint }>;
type CompiledCidr = Readonly<{ cidr: string } & (
  { family: 4; mask: number; network: number }
  | { family: 6; mask: bigint; network: bigint }
)>;
type CompiledSource = readonly CompiledCidr[];

// Only snapshots admitted and frozen here are cached. Mutable caller-supplied
// snapshots are evaluated afresh, so changing their contents cannot reuse stale ranges.
const compiledSnapshots = new WeakMap<Snapshot, readonly CompiledSource[]>();

const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/u;
const IPV6_RE = /^[0-9a-f:.]+$/iu;
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

function canonicalIpv4(value: unknown): string | null {
  if (typeof value !== 'string' || !IPV4_RE.test(value)) return null;
  const octets = value.split('.').map(Number);
  return octets.length === 4
    && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    ? octets.join('.')
    : null;
}

function canonicalIpv6(value: unknown): string | null {
  if (typeof value !== 'string' || !value.includes(':') || value.includes('%') || !IPV6_RE.test(value)) return null;
  try {
    const hostname = new URL(`https://[${value}]/`).hostname;
    return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1).toLowerCase() : null;
  } catch {
    return null;
  }
}

function ipv4Long(value: string): number {
  return value.split('.').reduce((total, octet) => (total << 8) + Number(octet), 0) >>> 0;
}

function expandedIpv6(value: string): string[] | null {
  const embeddedIpv4 = value.includes('.');
  if (embeddedIpv4) return null;
  const pieces = value.split('::');
  if (pieces.length > 2) return null;
  const left = pieces[0] ? pieces[0].split(':') : [];
  const right = pieces[1] ? pieces[1].split(':') : [];
  if (left.some((part) => !/^[0-9a-f]{1,4}$/iu.test(part))
    || right.some((part) => !/^[0-9a-f]{1,4}$/iu.test(part))) return null;
  const missing = 8 - left.length - right.length;
  if ((pieces.length === 1 && missing !== 0) || (pieces.length === 2 && missing < 1)) return null;
  return [...left, ...Array.from({ length: Math.max(0, missing) }, () => '0'), ...right]
    .map((part) => part.padStart(4, '0'));
}

function ipv6BigInt(value: string): bigint | null {
  const parts = expandedIpv6(value);
  if (!parts) return null;
  return parts.reduce((total, part) => (total << 16n) + BigInt(`0x${part}`), 0n);
}

function addressValue(value: unknown): AddressValue | null {
  const ipv4 = canonicalIpv4(value);
  if (ipv4) return { family: 4, value: ipv4Long(ipv4) };
  const ipv6 = canonicalIpv6(value);
  const numeric = ipv6 ? ipv6BigInt(ipv6) : null;
  return numeric === null ? null : { family: 6, value: numeric };
}

function compileCidr(value: unknown): CompiledCidr | null {
  if (typeof value !== 'string' || value.length > 96) return null;
  const [rangeText, prefixText, ...rest] = value.split('/');
  if (rest.length || !rangeText || !prefixText || !/^\d{1,3}$/u.test(prefixText)) return null;
  const prefix = Number(prefixText);
  const range = addressValue(rangeText);
  if (range?.family === 4 && prefix <= 32) {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return { cidr: value, family: 4, mask, network: (range.value & mask) >>> 0 };
  }
  if (range?.family !== 6 || prefix > 128) return null;
  const full = (1n << 128n) - 1n;
  const mask = prefix === 0 ? 0n : (full << BigInt(128 - prefix)) & full;
  return { cidr: value, family: 6, mask, network: range.value & mask };
}

function inCompiledCidr(address: AddressValue, range: CompiledCidr): boolean {
  if (address.family === 4 && range.family === 4) return ((address.value & range.mask) >>> 0) === range.network;
  return address.family === 6 && range.family === 6 && (address.value & range.mask) === range.network;
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
      provenance: `${snapshot.source.project} at ${snapshot.source.commit}`,
      limitation: 'This exact range match identifies shared infrastructure, not an origin host, tenant, account, operator, ownership, intent, safety, or maliciousness.',
    }));
    if (matches.length >= 4) break;
  }
  return matches;
}
