import { isIP } from 'node:net';

import { formatIpPrefix, parseIpPrefix, prefixContains, type IpPrefix } from './ip-prefix.mts';

const LOCAL_GEOIP_SCHEMA = 'whoisleuth.local-geoip-evidence';
const LOCAL_GEOIP_VERSION = 1;
const MAX_GEOIP_RECORDS = 100_000;

type GeoIpEntry = Readonly<{
  network: string;
  parsedNetwork: IpPrefix;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  asn: number | null;
  asName: string | null;
}>;

type LocalGeoIpDatabase = Readonly<{
  sourceLabel: string;
  databaseVersion: string;
  license: string;
  records: readonly GeoIpEntry[];
  rejectedCount: number;
  truncated: boolean;
}>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedText(value: unknown, maximum: number): string | null {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) return null;
  return value.replace(/\s+/gu, ' ').trim() || null;
}

function normalizeGeoIpEntry(value: unknown): GeoIpEntry | null {
  const source = record(value);
  const parsedNetwork = parseIpPrefix(source?.network ?? source?.cidr);
  if (!source || !parsedNetwork) return null;
  const country = boundedText(source.countryCode ?? source.country, 2)?.toUpperCase() ?? null;
  if (country !== null && !/^[A-Z]{2}$/u.test(country)) return null;
  const asnValue = source.asn === null || source.asn === undefined ? null : Number(String(source.asn).replace(/^AS/iu, ''));
  if (asnValue !== null && (!Number.isInteger(asnValue) || asnValue < 0 || asnValue > 4_294_967_295)) return null;
  return Object.freeze({
    network: formatIpPrefix(parsedNetwork),
    parsedNetwork,
    countryCode: country,
    region: boundedText(source.region, 120),
    city: boundedText(source.city, 120),
    asn: asnValue,
    asName: boundedText(source.asName ?? source.organization, 240),
  });
}

function buildLocalGeoIpDatabase(value: unknown): LocalGeoIpDatabase {
  const source = record(value);
  const sourceLabel = boundedText(source?.sourceLabel, 120);
  const databaseVersion = boundedText(source?.databaseVersion, 80);
  const license = boundedText(source?.license, 240);
  const rows = Array.isArray(source?.records) ? source.records : null;
  if (!sourceLabel || !databaseVersion || !license || !rows) {
    throw new TypeError('A local GeoIP database requires bounded source, version, licence, and record fields.');
  }
  const truncated = rows.length > MAX_GEOIP_RECORDS;
  const normalized = rows.slice(0, MAX_GEOIP_RECORDS).map(normalizeGeoIpEntry);
  const records = normalized.filter((item): item is GeoIpEntry => item !== null)
    .sort((left, right) => right.parsedNetwork.length - left.parsedNetwork.length);
  return Object.freeze({
    sourceLabel,
    databaseVersion,
    license,
    records: Object.freeze(records),
    rejectedCount: normalized.length - records.length + Math.max(0, rows.length - MAX_GEOIP_RECORDS),
    truncated,
  });
}

function lookupLocalGeoIp(database: LocalGeoIpDatabase, address: unknown) {
  const normalized = typeof address === 'string' ? address.trim().toLowerCase() : '';
  const family = isIP(normalized);
  const target = family === 4 || family === 6 ? parseIpPrefix(normalized) : null;
  if (!target) {
    return Object.freeze({ state: 'invalid' as const, address: null, match: null, source: null, limitations: Object.freeze([]) });
  }
  const match = database.records.find((item) => prefixContains(item.parsedNetwork, target)) ?? null;
  return Object.freeze({
    state: match ? database.truncated || database.rejectedCount > 0 ? 'partial' as const : 'matched' as const : 'not_found' as const,
    address: normalized,
    match: match ? Object.freeze({
      network: match.network,
      countryCode: match.countryCode,
      region: match.region,
      city: match.city,
      asn: match.asn,
      asName: match.asName,
    }) : null,
    source: Object.freeze({
      label: database.sourceLabel,
      version: database.databaseVersion,
      license: database.license,
    }),
    limitations: Object.freeze([
      'Geolocation and network attribution are provider estimates and may be stale, coarse, shared, or incorrect.',
      'A location or ASN association does not establish the operator, owner, user, intent, safety, or maliciousness of an address.',
    ]),
  });
}

export {
  LOCAL_GEOIP_SCHEMA,
  LOCAL_GEOIP_VERSION,
  MAX_GEOIP_RECORDS,
  buildLocalGeoIpDatabase,
  lookupLocalGeoIp,
};
export type { GeoIpEntry, LocalGeoIpDatabase };
