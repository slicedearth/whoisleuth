#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeSemanticVersion } from './release-version-check.mts';
import {
  WHOISLEUTH_PROJECT_URL,
  WHOISLEUTH_SOURCE_ISSUES_URL,
  WHOISLEUTH_SOURCE_REPOSITORY_GIT_URL,
} from '../lib/project-metadata.mts';
import {
  CLI_PACKAGE_REPORT_SCHEMA,
  CLI_PACKAGE_REPORT_VERSION,
  MAX_CLI_PACKAGE_ENTRIES,
  MAX_CLI_PACKAGE_MODULES,
  MAX_CLI_PACKAGE_PACKED_BYTES,
  MAX_CLI_PACKAGE_UNPACKED_BYTES,
  type CliPackageReport,
} from './cli-package.mts';
import {
  boundedPositiveInteger as boundedInteger,
  sha256Bytes as sha256,
} from './maintainer-tool-helpers.mts';

type JsonRecord = Record<string, unknown>;
type WritableLike = { write(value: string): unknown };
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type CheckOptions = Readonly<{ fetcher?: Fetcher; requestTimeoutMs?: number }>;
type MainOptions = Readonly<{ stdout?: WritableLike; stderr?: WritableLike; fetcher?: Fetcher }>;

type PublishedCliReport = Readonly<{
  schema: typeof REPORT_SCHEMA;
  version: typeof REPORT_VERSION;
  packageName: typeof PACKAGE_NAME;
  packageVersion: string;
  registry: typeof PUBLIC_REGISTRY;
  candidateArchiveSha256: string;
  registryIntegrity: string;
  registryShasum: string;
  packedBytes: number;
  fileCount: number;
  unpackedBytes: number;
  runtimeDependencies: Readonly<Record<string, string>>;
  provenancePredicate: typeof PROVENANCE_PREDICATE;
  registrySignatureMetadataCount: number;
  checks: readonly string[];
  limitations: readonly string[];
}>;

const PACKAGE_NAME = '@slicedearth/whoisleuth-cli';
const PACKAGE_AUTHOR = 'slicedearth';
const PUBLIC_REGISTRY = 'https://registry.npmjs.org';
const SOURCE_REPOSITORY = WHOISLEUTH_SOURCE_REPOSITORY_GIT_URL;
const PACKAGE_HOMEPAGE = WHOISLEUTH_PROJECT_URL;
const PACKAGE_ISSUES = WHOISLEUTH_SOURCE_ISSUES_URL;
const PROVENANCE_PREDICATE = 'https://slsa.dev/provenance/v1';
const REPORT_SCHEMA = 'whoisleuth.published-cli-check';
const REPORT_VERSION = 2;
const MAX_METADATA_BYTES = 512 * 1024;
const MAX_CANDIDATE_REPORT_BYTES = 64 * 1024;
const MAX_ERROR_LENGTH = 512;
export const PUBLISHED_CLI_REQUEST_TIMEOUT_MS = 120_000;
const RUNTIME_DEPENDENCIES = Object.freeze([
  '@peculiar/x509',
  'maxmind',
  'parse5',
  'reflect-metadata',
  'tldts',
  'undici',
]);

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be a JSON object.`);
  return value as JsonRecord;
}

function exactKeys(value: JsonRecord, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label} does not match the reviewed field contract.`);
  }
}

function boundedString(value: unknown, label: string, maximum = 512): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum || value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${label} must be a non-empty bounded string.`);
  }
  return value;
}

function boundedError(value: unknown): string {
  const detail = value instanceof Error ? value.message : 'Published CLI check failed.';
  return String(detail)
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, MAX_ERROR_LENGTH) || 'Published CLI check failed.';
}

function parseJson(value: Uint8Array | string, label: string, maximumBytes: number): unknown {
  const text = typeof value === 'string' ? value : Buffer.from(value).toString('utf8');
  if (Buffer.byteLength(text, 'utf8') > maximumBytes) throw new TypeError(`${label} exceeds the byte limit.`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new TypeError(`${label} was not valid JSON.`);
  }
}

function requestTimeout(value: unknown): number {
  if (value === undefined) return PUBLISHED_CLI_REQUEST_TIMEOUT_MS;
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > PUBLISHED_CLI_REQUEST_TIMEOUT_MS) {
    throw new TypeError(`Published CLI request timeout must be between 1 and ${PUBLISHED_CLI_REQUEST_TIMEOUT_MS} ms.`);
  }
  return Number(value);
}

async function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal, label: string, timeoutMs: number): Promise<T> {
  if (signal.aborted) throw new TypeError(`${label} exceeded the ${timeoutMs} ms request deadline.`);
  let onAbort: (() => void) | null = null;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new TypeError(`${label} exceeded the ${timeoutMs} ms request deadline.`));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

async function readResponseBytes(
  response: Response,
  label: string,
  maximumBytes: number,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<Uint8Array> {
  if (!response.ok) throw new TypeError(`${label} returned HTTP ${response.status}.`);
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    void response.body?.cancel().catch(() => {});
    throw new TypeError(`${label} exceeds the byte limit.`);
  }
  if (!response.body) throw new TypeError(`${label} did not include a response body.`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await raceWithAbort(reader.read(), signal, label, timeoutMs);
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        void reader.cancel().catch(() => {});
        throw new TypeError(`${label} exceeds the byte limit.`);
      }
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    try { reader.releaseLock(); } catch { /* A cancelled pending read may retain the lock until it settles. */ }
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function fetchResponseBytes(
  fetcher: Fetcher,
  input: string,
  init: RequestInit,
  label: string,
  maximumBytes: number,
  timeoutMs: number,
): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await raceWithAbort(
      fetcher(input, { ...init, signal: controller.signal }),
      controller.signal,
      label,
      timeoutMs,
    );
    return await readResponseBytes(response, label, maximumBytes, controller.signal, timeoutMs);
  } finally {
    clearTimeout(timer);
  }
}

function validatedTarballUrl(value: unknown, version: string): string {
  const raw = boundedString(value, 'Published tarball URL', 1_024);
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new TypeError('Published tarball URL is invalid.'); }
  if (
    parsed.protocol !== 'https:'
    || parsed.hostname !== 'registry.npmjs.org'
    || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash
    || parsed.pathname !== `/@slicedearth/whoisleuth-cli/-/whoisleuth-cli-${version}.tgz`
  ) throw new TypeError('Published tarball URL is outside the expected public registry boundary.');
  return parsed.toString();
}

export function validateCandidateReport(value: unknown, expectedVersionValue: unknown): CliPackageReport {
  const expectedVersion = normalizeSemanticVersion(expectedVersionValue);
  const report = record(value, 'Reviewed candidate report');
  exactKeys(report, [
    'schema', 'version', 'packageName', 'packageVersion', 'sourceModuleCount', 'packedEntryCount',
    'packedBytes', 'unpackedBytes', 'runtimeDependencies', 'installedChecks', 'publicationEnabled',
    'archiveFilename', 'archiveSha256',
  ], 'Reviewed candidate report');
  if (report.schema !== CLI_PACKAGE_REPORT_SCHEMA || report.version !== CLI_PACKAGE_REPORT_VERSION) {
    throw new TypeError('Reviewed candidate report schema is unsupported.');
  }
  if (report.packageName !== PACKAGE_NAME || normalizeSemanticVersion(report.packageVersion) !== expectedVersion) {
    throw new TypeError('Reviewed candidate report identity does not match the selected version.');
  }
  boundedInteger(report.sourceModuleCount, 'Reviewed source module count', MAX_CLI_PACKAGE_MODULES);
  boundedInteger(report.packedEntryCount, 'Reviewed packed entry count', MAX_CLI_PACKAGE_ENTRIES);
  boundedInteger(report.packedBytes, 'Reviewed packed bytes', MAX_CLI_PACKAGE_PACKED_BYTES);
  boundedInteger(report.unpackedBytes, 'Reviewed unpacked bytes', MAX_CLI_PACKAGE_UNPACKED_BYTES);
  if (report.publicationEnabled !== true) throw new TypeError('Reviewed candidate report must be publication-enabled.');
  if (report.archiveFilename !== `whoisleuth-cli-${expectedVersion}.tgz`) throw new TypeError('Reviewed candidate archive filename is invalid.');
  if (typeof report.archiveSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(report.archiveSha256)) {
    throw new TypeError('Reviewed candidate archive SHA-256 is invalid.');
  }
  const dependencies = record(report.runtimeDependencies, 'Reviewed runtime dependencies');
  exactKeys(dependencies, RUNTIME_DEPENDENCIES, 'Reviewed runtime dependencies');
  for (const name of RUNTIME_DEPENDENCIES) normalizeSemanticVersion(dependencies[name]);
  if (!Array.isArray(report.installedChecks) || report.installedChecks.length === 0 || report.installedChecks.length > 64
    || report.installedChecks.some((item) => typeof item !== 'string' || !item || item.length > 80)) {
    throw new TypeError('Reviewed installed checks must be a bounded non-empty string array.');
  }
  return Object.freeze(report as unknown as CliPackageReport);
}

export function validatePublishedManifest(value: unknown, expectedVersionValue: unknown) {
  const expectedVersion = normalizeSemanticVersion(expectedVersionValue);
  const manifest = record(value, 'Published package metadata');
  if (manifest.name !== PACKAGE_NAME || normalizeSemanticVersion(manifest.version) !== expectedVersion) {
    throw new TypeError('Published package identity does not match the selected version.');
  }
  if (manifest.license !== 'AGPL-3.0-only' || manifest.type !== 'module' || manifest.author !== PACKAGE_AUTHOR) {
    throw new TypeError('Published package author, licence, or module type does not match the reviewed contract.');
  }
  if (Object.hasOwn(manifest, 'private') || Object.hasOwn(manifest, 'scripts')) throw new TypeError('Published package must not be private or declare lifecycle scripts.');
  const bin = record(manifest.bin, 'Published executable mapping');
  const engines = record(manifest.engines, 'Published engine requirement');
  const contentPolicy = record(manifest.contentPolicy, 'Published content policy');
  const publishConfig = record(manifest.publishConfig, 'Published publication policy');
  const repository = record(manifest.repository, 'Published source repository');
  const bugs = record(manifest.bugs, 'Published issue tracker');
  if (bin.whoisleuth !== 'bin/whoisleuth.mjs' || Object.keys(bin).length !== 1 || engines.node !== '>=24') throw new TypeError('Published executable or Node runtime boundary does not match the reviewed contract.');
  if (contentPolicy.class !== 'dual-use' || Object.keys(contentPolicy).length !== 1) throw new TypeError('Published package does not retain the dual-use content declaration.');
  if (publishConfig.access !== 'public' || publishConfig.provenance !== true) throw new TypeError('Published package does not retain the public provenance contract.');
  if (repository.type !== 'git' || repository.url !== SOURCE_REPOSITORY || manifest.homepage !== PACKAGE_HOMEPAGE || bugs.url !== PACKAGE_ISSUES) {
    throw new TypeError('Published package source and support links do not match the reviewed contract.');
  }
  const dependencies = record(manifest.dependencies, 'Published runtime dependencies');
  exactKeys(dependencies, RUNTIME_DEPENDENCIES, 'Published runtime dependencies');
  const runtimeDependencies = Object.freeze(Object.fromEntries(RUNTIME_DEPENDENCIES.map((name) => [name, normalizeSemanticVersion(dependencies[name])])));
  const dist = record(manifest.dist, 'Published distribution metadata');
  const integrity = boundedString(dist.integrity, 'Published integrity', 256);
  const shasum = boundedString(dist.shasum, 'Published shasum', 64);
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(integrity) || !/^[a-f0-9]{40}$/u.test(shasum)) throw new TypeError('Published distribution integrity metadata is invalid.');
  const tarball = validatedTarballUrl(dist.tarball, expectedVersion);
  const fileCount = boundedInteger(dist.fileCount, 'Published file count', MAX_CLI_PACKAGE_ENTRIES);
  const unpackedBytes = boundedInteger(dist.unpackedSize, 'Published unpacked bytes', MAX_CLI_PACKAGE_UNPACKED_BYTES);
  const attestations = record(dist.attestations, 'Published attestations');
  const provenance = record(attestations.provenance, 'Published provenance');
  if (provenance.predicateType !== PROVENANCE_PREDICATE) throw new TypeError('Published package does not expose the expected provenance predicate.');
  const attestationUrl = boundedString(attestations.url, 'Published attestation URL', 1_024);
  const expectedAttestation = `https://registry.npmjs.org/-/npm/v1/attestations/@slicedearth%2fwhoisleuth-cli@${expectedVersion}`;
  if (attestationUrl.toLowerCase() !== expectedAttestation) throw new TypeError('Published attestation URL is outside the public registry boundary.');
  if (!Array.isArray(dist.signatures) || dist.signatures.length < 1 || dist.signatures.length > 8) throw new TypeError('Published package must expose a bounded registry signature set.');
  for (const [index, item] of dist.signatures.entries()) {
    const signature = record(item, `Published registry signature ${index + 1}`);
    boundedString(signature.keyid, `Published registry signature ${index + 1} key`, 256);
    boundedString(signature.sig, `Published registry signature ${index + 1} value`, 2_048);
  }
  return Object.freeze({ integrity, shasum, tarball, fileCount, unpackedBytes, runtimeDependencies, registrySignatureCount: dist.signatures.length });
}

export async function checkPublishedCli(
  expectedVersionValue: unknown,
  candidateReportPath: string,
  candidateArchivePath: string,
  options: CheckOptions = {},
): Promise<PublishedCliReport> {
  const expectedVersion = normalizeSemanticVersion(expectedVersionValue);
  const reportInfo = await stat(candidateReportPath);
  const archiveInfo = await stat(candidateArchivePath);
  if (!reportInfo.isFile() || reportInfo.size > MAX_CANDIDATE_REPORT_BYTES) throw new TypeError('Reviewed candidate report is not a bounded regular file.');
  if (!archiveInfo.isFile() || archiveInfo.size < 1 || archiveInfo.size > MAX_CLI_PACKAGE_PACKED_BYTES) throw new TypeError('Reviewed candidate archive is not a bounded regular file.');
  const [reportBytes, archiveBytes] = await Promise.all([readFile(candidateReportPath), readFile(candidateArchivePath)]);
  const candidate = validateCandidateReport(parseJson(reportBytes, 'Reviewed candidate report', MAX_CANDIDATE_REPORT_BYTES), expectedVersion);
  if (path.basename(candidateArchivePath) !== candidate.archiveFilename) throw new TypeError('Selected candidate archive filename does not match the reviewed report.');
  if (archiveBytes.byteLength !== candidate.packedBytes || sha256(archiveBytes) !== candidate.archiveSha256) {
    throw new TypeError('Selected candidate archive bytes do not match the reviewed report.');
  }

  const fetcher = options.fetcher || fetch;
  const timeoutMs = requestTimeout(options.requestTimeoutMs);
  const metadataUrl = `${PUBLIC_REGISTRY}/@slicedearth%2Fwhoisleuth-cli/${expectedVersion}`;
  const metadataBytes = await fetchResponseBytes(
    fetcher,
    metadataUrl,
    { redirect: 'error', headers: { accept: 'application/json' } },
    'Published package metadata',
    MAX_METADATA_BYTES,
    timeoutMs,
  );
  const published = validatePublishedManifest(parseJson(metadataBytes, 'Published package metadata', MAX_METADATA_BYTES), expectedVersion);
  const publishedArchive = await fetchResponseBytes(
    fetcher,
    published.tarball,
    { redirect: 'error', headers: { accept: 'application/octet-stream' } },
    'Published package archive',
    MAX_CLI_PACKAGE_PACKED_BYTES,
    timeoutMs,
  );
  const publishedIntegrity = `sha512-${createHash('sha512').update(publishedArchive).digest('base64')}`;
  const publishedShasum = createHash('sha1').update(publishedArchive).digest('hex');
  if (publishedIntegrity !== published.integrity || publishedShasum !== published.shasum) throw new TypeError('Published archive bytes do not match registry integrity metadata.');
  if (publishedArchive.byteLength !== candidate.packedBytes || sha256(publishedArchive) !== candidate.archiveSha256 || !Buffer.from(publishedArchive).equals(archiveBytes)) {
    throw new TypeError('Published archive is not byte-identical to the reviewed candidate.');
  }
  if (published.fileCount !== candidate.packedEntryCount || published.unpackedBytes !== candidate.unpackedBytes) throw new TypeError('Published archive measurements do not match the reviewed candidate.');
  if (RUNTIME_DEPENDENCIES.some((name) => published.runtimeDependencies[name] !== candidate.runtimeDependencies[name])) {
    throw new TypeError('Published runtime dependencies do not match the reviewed candidate.');
  }

  return Object.freeze({
    schema: REPORT_SCHEMA,
    version: REPORT_VERSION,
    packageName: PACKAGE_NAME,
    packageVersion: expectedVersion,
    registry: PUBLIC_REGISTRY,
    candidateArchiveSha256: candidate.archiveSha256,
    registryIntegrity: published.integrity,
    registryShasum: published.shasum,
    packedBytes: candidate.packedBytes,
    fileCount: published.fileCount,
    unpackedBytes: published.unpackedBytes,
    runtimeDependencies: published.runtimeDependencies,
    provenancePredicate: PROVENANCE_PREDICATE,
    registrySignatureMetadataCount: published.registrySignatureCount,
    checks: Object.freeze(['metadata', 'registry-content-integrity', 'candidate-byte-identity', 'archive-measurements', 'runtime-dependencies']),
    limitations: Object.freeze([
      'Registry signature and OIDC provenance records are observed metadata; this check does not cryptographically verify those attestations.',
      'The published package is not installed or executed by this verification workflow.',
    ]),
  });
}

export function formatPublishedCliReport(report: PublishedCliReport): string {
  return [
    'WHOISleuth published CLI check',
    `Package: ${report.packageName}@${report.packageVersion}`,
    `Registry: ${report.registry}`,
    `Candidate SHA-256: ${report.candidateArchiveSha256}`,
    `Archive: ${report.fileCount} files / ${report.packedBytes} packed bytes / ${report.unpackedBytes} unpacked bytes`,
    `Runtime dependencies: ${Object.entries(report.runtimeDependencies).map(([name, version]) => `${name}@${version}`).join(', ')}`,
    `Provenance metadata: ${report.provenancePredicate}`,
    `Registry signature metadata records: ${report.registrySignatureMetadataCount}`,
    `Checks: ${report.checks.join(', ')}`,
    ...report.limitations.map((limitation) => `Limitation: ${limitation}`),
    'Result: PASS',
  ].join('\n');
}

export function parseArguments(args: readonly string[]): Readonly<{ version: string; candidateReport: string; candidateArchive: string; json: boolean }> {
  const json = args.includes('--json');
  const values = args.filter((argument) => argument !== '--json');
  const reportIndex = values.indexOf('--candidate-report');
  const archiveIndex = values.indexOf('--candidate-archive');
  if (values.length !== 5 || reportIndex !== 1 || archiveIndex !== 3 || !values[2] || !values[4] || args.filter((argument) => argument === '--json').length > 1) {
    throw new TypeError('Usage: node tools/published-cli-check.mts <version> --candidate-report <report.json> --candidate-archive <archive.tgz> [--json]');
  }
  return { version: normalizeSemanticVersion(values[0]), candidateReport: values[2], candidateArchive: values[4], json };
}

export async function main(args = process.argv.slice(2), options: MainOptions = {}): Promise<number> {
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;
  try {
    const parsed = parseArguments(args);
    const report = await checkPublishedCli(parsed.version, parsed.candidateReport, parsed.candidateArchive, options.fetcher ? { fetcher: options.fetcher } : {});
    stdout.write(`${parsed.json ? JSON.stringify(report, null, 2) : formatPublishedCliReport(report)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${boundedError(error)}\n`);
    return 2;
  }
}

const invokedAsScript = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedAsScript) process.exitCode = await main();

export type { Fetcher, PublishedCliReport };
