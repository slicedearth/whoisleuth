import { constants as fsConstants } from 'node:fs';
import { open, realpath, type FileHandle } from 'node:fs/promises';
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
import { Worker, isMainThread, parentPort, workerData, type WorkerOptions } from 'node:worker_threads';

import { Reader, type Response } from 'maxmind';

import { formatIpPrefix, parseIpPrefix } from '../lib/ip-prefix.mts';
import { CliUsageError } from './errors.mts';
import { normalizeExplicitIsoTimestamp } from '../packages/evidence/observation.mts';
import { canonicalPublicIpAddress } from '../packages/evidence/public-address-policy.mts';

export const LOCAL_MMDB_QUERY_SCHEMA = 'whoisleuth.local-mmdb-query';
export const LOCAL_MMDB_QUERY_VERSION = 2;
export const LOCAL_MMDB_REVIEW_SCHEMA = 'whoisleuth.local-mmdb-review';
export const LOCAL_MMDB_REVIEW_VERSION = 1;
export const MAX_LOCAL_MMDB_BYTES = 512 * 1024 * 1024;
export const LOCAL_MMDB_REVIEW_DEADLINE_MS = 10_000;
export const MAX_LOCAL_MMDB_REVIEW_BYTES = 8 * 1024;
const DAY_MS = 86_400_000;
const LOCAL_MMDB_WORKER_KIND = 'local-mmdb-review';
const SUPPORTED_DATABASE_TYPES = new Set(['GeoIP2-City', 'GeoLite2-City', 'GeoIP2-Country', 'GeoLite2-Country',
  'GeoIP2-ASN', 'GeoLite2-ASN', 'GeoIP2-ISP', 'GeoIP2-Enterprise']);

type FreshnessPolicy = Readonly<{ maxAgeDays: number; rationale: string }>;
type PreparedQuery = Readonly<{ version: 1 | 2; address: string; sourceLabel: string; databaseVersion: string; license: string;
  checkedAt: string | null; freshnessPolicy: FreshnessPolicy | null }>;
type IntrinsicMetadata = Readonly<{ databaseType: string; builtAt: string;
  binaryFormat: Readonly<{ major: number; minor: number }>; ipVersion: 4 | 6 }>;
type AdmissionReason = 'admitted' | 'invalid_metadata' | 'unsupported_database' | 'unsupported_format' | 'future_database' | 'stale_database';
type MetadataAdmission = Readonly<{ metadata: IntrinsicMetadata | null; ageDays: number | null; reason: AdmissionReason }>;
type Match = Readonly<{ network: string | null; countryCode: string | null; region: string | null; city: string | null; asn: number | null; asName: string | null }>;
type CurrentResult = Readonly<{ schema: typeof LOCAL_MMDB_REVIEW_SCHEMA; version: typeof LOCAL_MMDB_REVIEW_VERSION;
  state: 'matched' | 'partial' | 'unavailable'; reason: string; completeness: 'complete' | 'partial' | 'unavailable';
  address: string; match: Match | null; source: Readonly<{ label: string; version: string; license: string }>;
  database: Readonly<{ sha256: string; byteLength: number; metadata: IntrinsicMetadata | null }>;
  freshness: Readonly<{ state: 'current' | 'stale' | 'unknown'; checkedAt: string; ageDays: number | null; policy: FreshnessPolicy }>;
  limitations: readonly string[] }>;
type ReviewDependencies = Readonly<{ openFile?: typeof open; createWorker?: (options: WorkerOptions) => Worker; deadlineMs?: number; signal?: AbortSignal }>;

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

async function readStableMmdb(databasePath: string, openFile = open, signal?: AbortSignal): Promise<Buffer> {
  let handle: FileHandle | null = null;
  let database: Buffer | null = null;
  try {
    signal?.throwIfAborted();
    const resolvedPath = await realpath(databasePath);
    signal?.throwIfAborted();
    handle = await openFile(
      resolvedPath,
      fsConstants.O_RDONLY | fsConstants.O_NONBLOCK | fsConstants.O_NOFOLLOW,
    );
    signal?.throwIfAborted();
    const before = await handle.stat();
    signal?.throwIfAborted();
    if (!before.isFile() || before.size <= 0 || before.size > MAX_LOCAL_MMDB_BYTES) {
      throw new CliUsageError(`The supplied MMDB must be a file no larger than ${MAX_LOCAL_MMDB_BYTES} bytes.`);
    }
    // Dedicated backing storage can be transferred without copying a pooled
    // buffer or exposing bytes outside the stable file's exact length.
    database = Buffer.allocUnsafeSlow(before.size);
    let offset = 0;
    while (offset < database.length) {
      const { bytesRead } = await handle.read(database, offset, database.length - offset, offset);
      signal?.throwIfAborted();
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const after = await handle.stat();
    signal?.throwIfAborted();
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
    database?.fill(0);
    signal?.throwIfAborted();
    if (cause instanceof CliUsageError) throw cause;
    throw new CliUsageError('The supplied MMDB file could not be read.');
  } finally {
    await handle?.close().catch(() => {});
  }
}

function prepareQuery(input: UnknownRecord, checkedAt: string): PreparedQuery {
  const address = boundedText(input.address, 64)?.toLowerCase() ?? '';
  const sourceLabel = boundedText(input.sourceLabel, 120);
  const databaseVersion = boundedText(input.databaseVersion, 80);
  const license = boundedText(input.license, 240);
  if (!isIP(address)) throw new CliUsageError('Local MMDB review requires one valid IP address.');
  if (!sourceLabel || !databaseVersion || !license) {
    throw new CliUsageError('Local MMDB review requires bounded sourceLabel, databaseVersion, and licence metadata.');
  }
  if (input.version !== undefined && input.version !== 1 && input.version !== LOCAL_MMDB_QUERY_VERSION) {
    throw new CliUsageError('Local MMDB review requires a supported query version.');
  }
  if (input.version !== LOCAL_MMDB_QUERY_VERSION) return { version: 1, address, sourceLabel, databaseVersion, license, checkedAt: null, freshnessPolicy: null };
  const policy = record(input.freshnessPolicy);
  const rationale = boundedText(policy.rationale, 240);
  const reviewedAt = normalizeExplicitIsoTimestamp(checkedAt);
  if (!reviewedAt || !rationale || /[\u0080-\u009f]/u.test(String(policy.rationale)) || !Number.isSafeInteger(policy.maxAgeDays) || Number(policy.maxAgeDays) <= 0
    || Number(policy.maxAgeDays) > Math.floor(Number.MAX_SAFE_INTEGER / DAY_MS)) {
    throw new CliUsageError('Current MMDB review requires an explicit review time and freshnessPolicy with positive whole maxAgeDays and a bounded plain-text rationale.');
  }
  return { version: 2, address, sourceLabel, databaseVersion, license, checkedAt: reviewedAt,
    freshnessPolicy: { maxAgeDays: Number(policy.maxAgeDays), rationale } };
}

/** Intrinsic metadata is separate from the analyst's declared version/licence.
 * The policy admits age for this review, not accuracy or an update guarantee. */
export function inspectLocalMmdbMetadata(value: unknown, byteLength: number, checkedAt: string, policy: FreshnessPolicy): MetadataAdmission {
  const metadata = record(value);
  const databaseType = boundedText(metadata.databaseType, 120);
  const buildMs = metadata.buildEpoch instanceof Date ? metadata.buildEpoch.getTime() : NaN;
  const reviewMs = Date.parse(normalizeExplicitIsoTimestamp(checkedAt) ?? '');
  const integer = (candidate: unknown): candidate is number => typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 0;
  if (!databaseType || metadata.databaseType !== databaseType || !Number.isSafeInteger(buildMs) || buildMs < 0 || buildMs % 1000 !== 0 || !Number.isFinite(reviewMs)
    || !integer(metadata.binaryFormatMajorVersion) || !integer(metadata.binaryFormatMinorVersion)
    || ![4, 6].includes(Number(metadata.ipVersion)) || typeof metadata.ipVersion !== 'number'
    || !integer(metadata.nodeCount) || metadata.nodeCount < 1 || ![24, 28, 32].includes(Number(metadata.recordSize))
    || typeof metadata.recordSize !== 'number' || !integer(metadata.searchTreeSize)
    || metadata.searchTreeSize !== metadata.nodeCount * metadata.recordSize / 4 || metadata.searchTreeSize + 16 >= byteLength) {
    return { metadata: null, ageDays: null, reason: 'invalid_metadata' };
  }
  const intrinsic: IntrinsicMetadata = { databaseType, builtAt: new Date(buildMs).toISOString(),
    binaryFormat: { major: metadata.binaryFormatMajorVersion, minor: metadata.binaryFormatMinorVersion }, ipVersion: metadata.ipVersion as 4 | 6 };
  const ageDays = (reviewMs - buildMs) / DAY_MS;
  const reason = metadata.binaryFormatMajorVersion !== 2 || metadata.binaryFormatMinorVersion !== 0 ? 'unsupported_format'
    : !SUPPORTED_DATABASE_TYPES.has(databaseType) ? 'unsupported_database'
    : ageDays < 0 ? 'future_database' : ageDays > policy.maxAgeDays ? 'stale_database' : 'admitted';
  return { metadata: intrinsic, ageDays, reason };
}

const LIMITATIONS = Object.freeze([
  'This CLI-only result comes from an analyst-supplied local MMDB file. WHOISleuth does not bundle, download, update, license, or transmit the database.',
  'Geolocation and network attribution are provider estimates and may be stale, coarse, shared, or incorrect.',
  'A location or ASN association does not establish the operator, owner, user, intent, safety, or maliciousness of an address.',
]);

function currentResult(query: PreparedQuery, identity: { sha256: string; byteLength: number }, admission: MetadataAdmission,
  reason: string, match: Match | null = null): CurrentResult {
  const state = match ? reason === 'matched' ? 'matched' : 'partial' : 'unavailable';
  return { schema: LOCAL_MMDB_REVIEW_SCHEMA, version: LOCAL_MMDB_REVIEW_VERSION, state, reason,
    completeness: state === 'matched' ? 'complete' : state === 'partial' ? 'partial' : 'unavailable',
    address: query.address, match, source: { label: query.sourceLabel, version: query.databaseVersion, license: query.license },
    database: { ...identity, metadata: admission.metadata },
    freshness: { state: admission.reason === 'stale_database' ? 'stale' : admission.reason === 'admitted' ? 'current' : 'unknown',
      checkedAt: query.checkedAt!, ageDays: admission.ageDays, policy: query.freshnessPolicy! },
    limitations: [...LIMITATIONS, 'Declared source, version and licence labels are analyst claims; intrinsic metadata and digest do not authenticate the database or verify licensing.',
      'Freshness is checked against the explicitly justified age policy. A miss, rejected or stale database is unavailable context, not evidence of location or absence.'] };
}

function reviewBytes(query: PreparedQuery, database: Buffer, identity: { sha256: string; byteLength: number }) {
  let reader;
  try { reader = new Reader<Response>(database); } catch {
    if (query.version === 2) return currentResult(query, identity, { metadata: null, ageDays: null, reason: 'invalid_metadata' }, 'invalid_database');
    throw new CliUsageError('The supplied file is not a readable MaxMind DB database.');
  }
  const admission = query.version === 2 ? inspectLocalMmdbMetadata(reader.metadata, database.length, query.checkedAt!, query.freshnessPolicy!) : null;
  if (admission && admission.reason !== 'admitted') return currentResult(query, identity, admission, admission.reason);
  if (admission && !canonicalPublicIpAddress(query.address)) return currentResult(query, identity, admission, 'unsupported_address');
  if (admission && isIP(query.address) === 6 && admission.metadata?.ipVersion === 4) return currentResult(query, identity, admission, 'unsupported_address_family');
  const address = query.address;
  const [rawMatch, prefixLength] = reader.getWithPrefixLength(address);
  const match = record(rawMatch);
  const traits = record(match.traits);
  const country = record(match.country);
  const registeredCountry = record(match.registered_country);
  const subdivisions = Array.isArray(match.subdivisions) ? match.subdivisions : [];
  const subdivision = record(subdivisions[0]);
  const city = record(match.city);
  const asnValue = match.autonomous_system_number ?? traits.autonomous_system_number;
  const asn = typeof asnValue === 'number' && Number.isSafeInteger(asnValue) && asnValue >= 0
    && (query.version === 1 || asnValue <= 4_294_967_295) ? asnValue : null;
  const prefix = parseIpPrefix(`${address}/${prefixLength}`);
  const result = Object.freeze({
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
    source: Object.freeze({ label: query.sourceLabel, version: query.databaseVersion, license: query.license }),
    limitations: LIMITATIONS,
  });
  if (!admission) return result;
  if (!rawMatch) return currentResult(query, identity, admission, 'no_match');
  if (!result.match || !prefix || !rawMatch || typeof rawMatch !== 'object' || Array.isArray(rawMatch)) return currentResult(query, identity, admission, 'invalid_record');
  const rawCountry = country.iso_code;
  const countryCode = boundedText(rawCountry, 2)?.toUpperCase() ?? null;
  const projected = { ...result.match, countryCode: countryCode && /^[A-Z]{2}$/u.test(countryCode) ? countryCode : null };
  if (![projected.countryCode, projected.region, projected.city, projected.asn, projected.asName].some(value => value !== null)) {
    return currentResult(query, identity, admission, 'no_useful_record');
  }
  const invalid = rawCountry !== undefined && projected.countryCode === null
    || asnValue !== undefined && asn === null
    || match.country !== undefined && (!match.country || typeof match.country !== 'object' || Array.isArray(match.country))
    || match.city !== undefined && (!match.city || typeof match.city !== 'object' || Array.isArray(match.city))
    || match.subdivisions !== undefined && !Array.isArray(match.subdivisions)
    || subdivision.names !== undefined && projected.region === null
    || subdivision.iso_code !== undefined && projected.region === null
    || city.names !== undefined && projected.city === null
    || (match.autonomous_system_organization ?? traits.autonomous_system_organization) !== undefined && projected.asName === null;
  return currentResult(query, identity, admission, invalid ? 'incomplete_record' : 'matched', projected);
}

type WorkerRequest = Readonly<{ kind: typeof LOCAL_MMDB_WORKER_KIND; query: PreparedQuery; bytes: Uint8Array; identity: { sha256: string; byteLength: number } }>;
type WorkerReply = Readonly<{ result: ReturnType<typeof reviewBytes> }> | Readonly<{ error: true }>;

function freezeResult(result: ReturnType<typeof reviewBytes>): ReturnType<typeof reviewBytes> {
  if (result.match) Object.freeze(result.match);
  Object.freeze(result.source); Object.freeze(result.limitations);
  if ('database' in result) {
    if (result.database.metadata) {
      Object.freeze(result.database.metadata.binaryFormat); Object.freeze(result.database.metadata);
    }
    Object.freeze(result.database); Object.freeze(result.freshness.policy); Object.freeze(result.freshness);
  }
  return Object.freeze(result);
}

if (!isMainThread && parentPort && record(workerData).kind === LOCAL_MMDB_WORKER_KIND) {
  const port = parentPort, request = workerData as WorkerRequest;
  try {
    const bytes = Buffer.from(request.bytes.buffer, request.bytes.byteOffset, request.bytes.byteLength);
    const result = reviewBytes(request.query, bytes, request.identity);
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_LOCAL_MMDB_REVIEW_BYTES) throw new TypeError('Local result exceeds its output bound.');
    port.postMessage({ result } satisfies WorkerReply);
  } catch { port.postMessage({ error: true } satisfies WorkerReply); }
  finally { request.bytes.fill(0); port.close(); }
}

/** One disposable worker pre-empts the existing synchronous reader. It is not
 * a sandbox and never receives a database path or inherited environment. */
export async function reviewLocalMmdb(input: UnknownRecord, databasePath: string,
  checkedAt = new Date().toISOString(), dependencies: ReviewDependencies = {}) {
  const { signal } = dependencies;
  signal?.throwIfAborted();
  const query = prepareQuery(input, checkedAt);
  const deadlineMs = dependencies.deadlineMs ?? LOCAL_MMDB_REVIEW_DEADLINE_MS;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0 || deadlineMs > LOCAL_MMDB_REVIEW_DEADLINE_MS) throw new CliUsageError('Invalid local database processing deadline.');
  const database = await readStableMmdb(databasePath, dependencies.openFile, signal);
  if (signal?.aborted) { database.fill(0); signal.throwIfAborted(); }
  const identity = { sha256: createHash('sha256').update(database).digest('hex'), byteLength: database.length };
  const options: WorkerOptions = { workerData: { kind: LOCAL_MMDB_WORKER_KIND, query, bytes: database, identity } satisfies WorkerRequest,
    transferList: [database.buffer as ArrayBuffer], env: {}, execArgv: [], stdout: true, stderr: true,
    resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 } };
  let worker: Worker;
  try { worker = dependencies.createWorker ? dependencies.createWorker(options) : new Worker(new URL(import.meta.url), options); }
  catch {
    if (database.byteLength) database.fill(0);
    signal?.throwIfAborted();
    if (query.version === 2) return freezeResult(currentResult(query, identity, { metadata: null, ageDays: null, reason: 'invalid_metadata' }, 'processing_unavailable'));
    throw new CliUsageError('The supplied database could not be reviewed within its format and processing bounds.');
  }
  worker.stdout?.resume(); worker.stderr?.resume();
  try {
    return await new Promise<ReturnType<typeof reviewBytes>>((resolve, reject) => {
      let settled = false;
      const finish = (result?: ReturnType<typeof reviewBytes>, reason = 'processing_unavailable') => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        if (signal?.aborted) reject(signal.reason);
        else if (result) resolve(freezeResult(result));
        else if (query.version === 2) resolve(freezeResult(currentResult(query, identity, { metadata: null, ageDays: null, reason: 'invalid_metadata' }, reason)));
        else reject(new CliUsageError('The supplied database could not be reviewed within its format and processing bounds.'));
      };
      const onAbort = () => finish();
      const timer = setTimeout(() => finish(undefined, 'processing_deadline'), deadlineMs);
      worker.once('message', (reply: WorkerReply) => reply && 'result' in reply ? finish(reply.result) : finish());
      worker.once('error', () => finish()); worker.once('exit', () => finish());
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  } finally { await worker.terminate(); }
}
