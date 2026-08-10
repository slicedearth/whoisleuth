import { constants as fsConstants } from 'node:fs';
import { open, realpath, type FileHandle } from 'node:fs/promises';
import { isIP } from 'node:net';

import { Reader, type Response } from 'maxmind';

import { formatIpPrefix, parseIpPrefix } from '../lib/ip-prefix.mts';
import { CliUsageError } from './errors.mts';

export const LOCAL_MMDB_QUERY_SCHEMA = 'whoisleuth.local-mmdb-query';
export const LOCAL_MMDB_QUERY_VERSION = 1;
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

async function readStableMmdb(databasePath: string): Promise<Buffer> {
  let handle: FileHandle | null = null;
  try {
    const resolvedPath = await realpath(databasePath);
    handle = await open(
      resolvedPath,
      fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | fsConstants.O_NOFOLLOW,
    );
    const before = await handle.stat();
    if (!before.isFile() || before.size <= 0 || before.size > MAX_LOCAL_MMDB_BYTES) {
      throw new CliUsageError(`The supplied MMDB must be a file no larger than ${MAX_LOCAL_MMDB_BYTES} bytes.`);
    }
    const database = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < database.length) {
      const { bytesRead } = await handle.read(database, offset, database.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (offset !== database.length
      || before.dev !== after.dev
      || before.ino !== after.ino
      || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs
      || before.ctimeMs !== after.ctimeMs) {
      throw new CliUsageError('The supplied MMDB changed while it was being read.');
    }
    return database;
  } catch (cause) {
    if (cause instanceof CliUsageError) throw cause;
    throw new CliUsageError('The supplied MMDB file could not be read.');
  } finally {
    await handle?.close().catch(() => {});
  }
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
    throw new CliUsageError('Local MMDB review requires bounded sourceLabel, databaseVersion, and licence metadata.');
  }
  let reader;
  try { reader = new Reader<Response>(await readStableMmdb(databasePath)); } catch (cause) {
    if (cause instanceof CliUsageError) throw cause;
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
