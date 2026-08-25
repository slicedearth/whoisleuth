// Local, exact CIDR qualification for relationship-review evidence. The
// catalogue is maintenance-time data and never causes a browser or server
// request. Matches qualify shared infrastructure but never establish control,
// ownership, intent, safety, or maliciousness.

import snapshotValue from './common-infrastructure-snapshot.json' with { type: 'json' };

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
  schema: 'whoisleuth.common-infrastructure';
  version: 1;
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

function inCidr(address: string, cidr: string): boolean {
  const [rangeText, prefixText, ...rest] = cidr.split('/');
  if (rest.length || !rangeText || !prefixText || !/^\d{1,3}$/u.test(prefixText)) return false;
  const prefix = Number(prefixText);
  const ipv4 = canonicalIpv4(address);
  const range4 = canonicalIpv4(rangeText);
  if (ipv4 && range4 && prefix <= 32) {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (ipv4Long(ipv4) & mask) === (ipv4Long(range4) & mask);
  }
  const ipv6 = canonicalIpv6(address);
  const range6 = canonicalIpv6(rangeText);
  if (!ipv6 || !range6 || prefix > 128) return false;
  const addressValue = ipv6BigInt(ipv6);
  const rangeValue = ipv6BigInt(range6);
  if (addressValue === null || rangeValue === null) return false;
  const full = (1n << 128n) - 1n;
  const mask = prefix === 0 ? 0n : (full << BigInt(128 - prefix)) & full;
  return (addressValue & mask) === (rangeValue & mask);
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validCidr(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 96) return false;
  const [address, prefixText, ...rest] = value.split('/');
  if (rest.length || !address || !prefixText || !/^\d{1,3}$/u.test(prefixText)) return false;
  const prefix = Number(prefixText);
  return canonicalIpv4(address) !== null
    ? prefix <= 32
    : canonicalIpv6(address) !== null && prefix <= 128;
}

export function parseCommonInfrastructureSnapshot(value: unknown): Snapshot {
  const source = record(value);
  const sourceMeta = record(source?.source);
  const sourceCommit = typeof sourceMeta?.commit === 'string' ? sourceMeta.commit : '';
  if (source?.schema !== 'whoisleuth.common-infrastructure'
    || source.version !== 1
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
      || item.values.length > 20_000
      || !item.values.every(validCidr)
      || new Set(item.values).size !== item.values.length) {
      throw new TypeError('Common-infrastructure source has an invalid contract.');
    }
    seenSourceIds.add(id);
    sources.push({
      id,
      label: item.label,
      category: expectedCategory,
      sourceDate: item.sourceDate,
      sourceDigestSha256: digest,
      values: item.values,
    });
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
    excludedSources.push({ id, reason });
  }
  if (seenSourceIds.size !== EXPECTED_SOURCES.size
    || !sources.some((item) => item.id === 'public-dns-core')
    || entryCount !== source.entryCount
    || entryCount > 20_000) {
    throw new TypeError('Common-infrastructure snapshot entry count is inconsistent.');
  }
  return {
    schema: 'whoisleuth.common-infrastructure',
    version: 1,
    generatedAt: source.generatedAt,
    source: {
      project: sourceMeta.project,
      repository: sourceMeta.repository,
      commit: sourceCommit,
      licence: sourceMeta.licence,
    },
    entryCount,
    sources,
    excludedSources,
    limitations: Array.isArray(source.limitations)
      ? source.limitations.filter((item): item is string => typeof item === 'string').slice(0, 8)
      : [],
  };
}

export const COMMON_INFRASTRUCTURE_SNAPSHOT = Object.freeze(parseCommonInfrastructureSnapshot(snapshotValue));

export function classifyCommonInfrastructureAddress(
  value: unknown,
  snapshot: Snapshot = COMMON_INFRASTRUCTURE_SNAPSHOT,
): CommonInfrastructureMatch[] {
  const address = canonicalIpv4(value) ?? canonicalIpv6(value);
  if (!address) return [];
  const matches: CommonInfrastructureMatch[] = [];
  for (const source of snapshot.sources) {
    const cidr = source.values.find((entry) => inCidr(address, entry));
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
