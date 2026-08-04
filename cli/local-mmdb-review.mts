import { stat } from 'node:fs/promises';
import { isIP } from 'node:net';

import { open, type Response } from 'maxmind';

import { formatIpPrefix, parseIpPrefix } from '../lib/ip-prefix.mts';
import { CliUsageError } from './errors.mts';

export const LOCAL_MMDB_QUERY_SCHEMA = 'whoisleuth.local-mmdb-query';
export const MAX_LOCAL_MMDB_BYTES = 512 * 1024 * 1024;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function boundedText(value: unknown, maximum: number): string | null {
  return typeof value === 'string' && value.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(value)
    ? value.replace(/\s+/gu, ' ').trim() || null
    : null;
}

function names(value: unknown): string | null {
  const source = record(value);
  return boundedText(source.en, 120);
}

export async function reviewLocalMmdb(
  input: UnknownRecord,
  databasePath: string,
) {
  const address = boundedText(input.address, 64)?.toLowerCase() ?? '';
  const sourceLabel = boundedText(input.sourceLabel, 120);
  const databaseVersion = boundedText(input.databaseVersion, 80);
  const license = boundedText(input.license, 240);
  if (!isIP(address)) throw new CliUsageError('Local MMDB review requires one valid IP address.');
  if (!sourceLabel || !databaseVersion || !license) {
    throw new CliUsageError('Local MMDB review requires bounded sourceLabel, databaseVersion, and license metadata.');
  }
  let info;
  try { info = await stat(databasePath); } catch { throw new CliUsageError('The supplied MMDB file could not be read.'); }
  if (!info.isFile() || info.size <= 0 || info.size > MAX_LOCAL_MMDB_BYTES) {
    throw new CliUsageError(`The supplied MMDB must be a file no larger than ${MAX_LOCAL_MMDB_BYTES} bytes.`);
  }
  let reader;
  try { reader = await open<Response>(databasePath, { cache: { max: 1_000 } }); } catch {
    throw new CliUsageError('The supplied file is not a readable MaxMind DB database.');
  }
  const [rawMatch, prefixLength] = reader.getWithPrefixLength(address);
  const match = record(rawMatch);
  const traits = record(match.traits);
  const country = record(match.country);
  const registeredCountry = record(match.registered_country);
  const subdivisions = Array.isArray(match.subdivisions) ? match.subdivisions : [];
  const subdivision = record(subdivisions[0]);
  const city = record(match.city);
  const asnValue = match.autonomous_system_number ?? traits.autonomous_system_number;
  const asn = typeof asnValue === 'number' && Number.isSafeInteger(asnValue) && asnValue >= 0 ? asnValue : null;
  const prefix = parseIpPrefix(`${address}/${prefixLength}`);
  return Object.freeze({
    state: rawMatch ? 'matched' as const : 'not_found' as const,
    address,
    match: rawMatch ? Object.freeze({
      network: prefix ? formatIpPrefix(prefix) : null,
      countryCode: boundedText(country.iso_code ?? registeredCountry.iso_code, 2)?.toUpperCase() ?? null,
      region: names(subdivision.names) ?? boundedText(subdivision.iso_code, 120),
      city: names(city.names),
      asn,
      asName: boundedText(match.autonomous_system_organization ?? traits.autonomous_system_organization, 240),
    }) : null,
    source: Object.freeze({ label: sourceLabel, version: databaseVersion, license }),
    limitations: Object.freeze([
      'This CLI-only result comes from an analyst-supplied local MMDB file. WHOISleuth does not bundle, download, update, license, or transmit the database.',
      'Geolocation and network attribution are provider estimates and may be stale, coarse, shared, or incorrect.',
      'A location or ASN association does not establish the operator, owner, user, intent, safety, or maliciousness of an address.',
    ]),
  });
}
