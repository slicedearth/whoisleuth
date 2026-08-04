#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { normalizeSemanticVersion } from './release-version-check.mts';
import {
  WHOISLEUTH_PROJECT_URL,
  WHOISLEUTH_SOURCE_ISSUES_URL,
  WHOISLEUTH_SOURCE_REPOSITORY_GIT_URL,
} from '../lib/project-metadata.mts';

type JsonRecord = Record<string, unknown>;
type WritableLike = { write(value: string): unknown };
type CommandResult = Readonly<{ stdout: string; stderr: string }>;
type ExecuteCommand = (
  executable: string,
  args: readonly string[],
  options: Readonly<{ cwd: string; env: NodeJS.ProcessEnv }>,
) => Promise<CommandResult>;
type CheckOptions = Readonly<{
  execute?: ExecuteCommand;
  environment?: NodeJS.ProcessEnv;
}>;
type MainOptions = Readonly<{
  stdout?: WritableLike;
  stderr?: WritableLike;
  execute?: ExecuteCommand;
  environment?: NodeJS.ProcessEnv;
}>;

type PublishedCliReport = Readonly<{
  schema: typeof REPORT_SCHEMA;
  version: typeof REPORT_VERSION;
  packageName: typeof PACKAGE_NAME;
  packageVersion: string;
  registry: typeof PUBLIC_REGISTRY;
  integrity: string;
  shasum: string;
  fileCount: number;
  unpackedBytes: number;
  runtimeDependencies: Readonly<Record<string, string>>;
  provenancePredicate: typeof PROVENANCE_PREDICATE;
  registrySignatureCount: number;
  checks: readonly string[];
}>;

const defaultExecFile = promisify(execFileCallback);

const PACKAGE_NAME = '@slicedearth/whoisleuth-cli';
const PACKAGE_AUTHOR = 'slicedearth';
const PUBLIC_REGISTRY = 'https://registry.npmjs.org';
const SOURCE_REPOSITORY = WHOISLEUTH_SOURCE_REPOSITORY_GIT_URL;
const PACKAGE_HOMEPAGE = WHOISLEUTH_PROJECT_URL;
const PACKAGE_ISSUES = WHOISLEUTH_SOURCE_ISSUES_URL;
const PROVENANCE_PREDICATE = 'https://slsa.dev/provenance/v1';
const REPORT_SCHEMA = 'whoisleuth.published-cli-check';
const REPORT_VERSION = 1;
const RUNTIME_DEPENDENCIES = Object.freeze(['parse5', 'tldts', 'undici']);
const MAX_METADATA_BYTES = 512 * 1024;
const MAX_PACKAGE_FILES = 220;
const MAX_UNPACKED_BYTES = 6 * 1024 * 1024;
const MAX_ERROR_LENGTH = 512;
const OVERRIDDEN_NPM_ENVIRONMENT_KEYS = new Set([
  'npm_config_always_auth',
  'npm_config_audit',
  'npm_config_cache',
  'npm_config_cert',
  'npm_config_fund',
  'npm_config_globalconfig',
  'npm_config_ignore_scripts',
  'npm_config_key',
  'npm_config_loglevel',
  'npm_config_registry',
  'npm_config_update_notifier',
  'npm_config_userconfig',
]);

function shouldRemoveInheritedNpmEnvironmentKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (normalized === 'node_auth_token' || normalized === 'npm_token') return true;
  if (OVERRIDDEN_NPM_ENVIRONMENT_KEYS.has(normalized)) return true;
  return normalized.startsWith('npm_config_')
    && /(?:auth|token|password|username|email|otp)/u.test(normalized);
}

function anonymousNpmEnvironment(
  input: NodeJS.ProcessEnv,
  temporaryRoot: string,
): NodeJS.ProcessEnv {
  const environment = Object.fromEntries(
    Object.entries(input).filter(([key]) => !shouldRemoveInheritedNpmEnvironmentKey(key)),
  );
  return {
    ...environment,
    npm_config_always_auth: 'false',
    npm_config_audit: 'false',
    npm_config_cache: path.join(temporaryRoot, 'npm-cache'),
    npm_config_fund: 'false',
    npm_config_globalconfig: path.join(temporaryRoot, 'global.npmrc'),
    npm_config_ignore_scripts: 'true',
    npm_config_loglevel: 'silent',
    npm_config_update_notifier: 'false',
    npm_config_userconfig: path.join(temporaryRoot, 'user.npmrc'),
  };
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be a JSON object.`);
  return value as JsonRecord;
}

function boundedString(value: unknown, label: string, maximum = 512): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maximum
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError(`${label} must be a non-empty bounded string.`);
  }
  return value;
}

function boundedInteger(value: unknown, label: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) {
    throw new TypeError(`${label} must be between 1 and ${maximum}.`);
  }
  return Number(value);
}

function boundedError(value: unknown): string {
  const detail = value instanceof Error ? value.message : 'Published CLI check failed.';
  return String(detail)
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, MAX_ERROR_LENGTH) || 'Published CLI check failed.';
}

function parseMetadataJson(value: string): JsonRecord {
  if (Buffer.byteLength(value, 'utf8') > MAX_METADATA_BYTES) throw new TypeError('Published package metadata exceeds the byte limit.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new TypeError('Published package metadata was not valid JSON.');
  }
  return record(parsed, 'Published package metadata');
}

function validatedTarballUrl(value: unknown, version: string): string {
  const raw = boundedString(value, 'Published tarball URL', 1_024);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new TypeError('Published tarball URL is invalid.');
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.hostname !== 'registry.npmjs.org'
    || parsed.username
    || parsed.password
    || parsed.port
    || parsed.search
    || parsed.hash
    || parsed.pathname !== `/@slicedearth/whoisleuth-cli/-/whoisleuth-cli-${version}.tgz`
  ) {
    throw new TypeError('Published tarball URL is outside the expected public registry boundary.');
  }
  return parsed.toString();
}

export function validatePublishedManifest(value: unknown, expectedVersionValue: unknown): Omit<PublishedCliReport, 'checks'> {
  const expectedVersion = normalizeSemanticVersion(expectedVersionValue);
  const manifest = record(value, 'Published package metadata');
  if (manifest.name !== PACKAGE_NAME || normalizeSemanticVersion(manifest.version) !== expectedVersion) {
    throw new TypeError('Published package identity does not match the selected version.');
  }
  if (manifest.license !== 'AGPL-3.0-only' || manifest.type !== 'module' || manifest.author !== PACKAGE_AUTHOR) {
    throw new TypeError('Published package author, licence, or module type does not match the reviewed contract.');
  }
  if (Object.hasOwn(manifest, 'private') || Object.hasOwn(manifest, 'scripts')) {
    throw new TypeError('Published package must not be private or declare lifecycle scripts.');
  }

  const bin = record(manifest.bin, 'Published executable mapping');
  const engines = record(manifest.engines, 'Published engine requirement');
  const contentPolicy = record(manifest.contentPolicy, 'Published content policy');
  const publishConfig = record(manifest.publishConfig, 'Published publication policy');
  const repository = record(manifest.repository, 'Published source repository');
  const bugs = record(manifest.bugs, 'Published issue tracker');
  if (bin.whoisleuth !== 'bin/whoisleuth.mjs' || Object.keys(bin).length !== 1 || engines.node !== '>=24') {
    throw new TypeError('Published executable or Node runtime boundary does not match the reviewed contract.');
  }
  if (contentPolicy.class !== 'dual-use' || Object.keys(contentPolicy).length !== 1) {
    throw new TypeError('Published package does not retain the dual-use content declaration.');
  }
  if (publishConfig.access !== 'public' || publishConfig.provenance !== true) {
    throw new TypeError('Published package does not retain the public provenance contract.');
  }
  if (
    repository.type !== 'git'
    || repository.url !== SOURCE_REPOSITORY
    || manifest.homepage !== PACKAGE_HOMEPAGE
    || bugs.url !== PACKAGE_ISSUES
  ) {
    throw new TypeError('Published package source and support links do not match the reviewed contract.');
  }

  const dependencies = record(manifest.dependencies, 'Published runtime dependencies');
  if (Object.keys(dependencies).length !== RUNTIME_DEPENDENCIES.length) {
    throw new TypeError('Published package must retain only the bounded runtime dependencies.');
  }
  const runtimeDependencies = Object.freeze(Object.fromEntries(RUNTIME_DEPENDENCIES.map((name) => [
    name,
    normalizeSemanticVersion(dependencies[name]),
  ])));

  const dist = record(manifest.dist, 'Published distribution metadata');
  const integrity = boundedString(dist.integrity, 'Published integrity', 256);
  const shasum = boundedString(dist.shasum, 'Published shasum', 64);
  if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(integrity) || !/^[a-f0-9]{40}$/u.test(shasum)) {
    throw new TypeError('Published distribution integrity metadata is invalid.');
  }
  validatedTarballUrl(dist.tarball, expectedVersion);
  const fileCount = boundedInteger(dist.fileCount, 'Published file count', MAX_PACKAGE_FILES);
  const unpackedBytes = boundedInteger(dist.unpackedSize, 'Published unpacked bytes', MAX_UNPACKED_BYTES);

  const attestations = record(dist.attestations, 'Published attestations');
  const provenance = record(attestations.provenance, 'Published provenance');
  if (provenance.predicateType !== PROVENANCE_PREDICATE) {
    throw new TypeError('Published package does not expose the expected provenance predicate.');
  }
  const attestationUrl = boundedString(attestations.url, 'Published attestation URL', 1_024);
  let parsedAttestationUrl: URL;
  try {
    parsedAttestationUrl = new URL(attestationUrl);
  } catch {
    throw new TypeError('Published attestation URL is invalid.');
  }
  if (
    parsedAttestationUrl.protocol !== 'https:'
    || parsedAttestationUrl.hostname !== 'registry.npmjs.org'
    || parsedAttestationUrl.username
    || parsedAttestationUrl.password
    || parsedAttestationUrl.port
    || parsedAttestationUrl.search
    || parsedAttestationUrl.hash
    || parsedAttestationUrl.pathname.toLowerCase() !== `/-/npm/v1/attestations/@slicedearth%2fwhoisleuth-cli@${expectedVersion}`
  ) {
    throw new TypeError('Published attestation URL is outside the public registry boundary.');
  }

  const signatures = dist.signatures;
  if (!Array.isArray(signatures) || signatures.length < 1 || signatures.length > 8) {
    throw new TypeError('Published package must expose a bounded registry signature set.');
  }
  for (const [index, signatureValue] of signatures.entries()) {
    const signature = record(signatureValue, `Published registry signature ${index + 1}`);
    boundedString(signature.keyid, `Published registry signature ${index + 1} key`, 256);
    boundedString(signature.sig, `Published registry signature ${index + 1} value`, 2_048);
  }

  return Object.freeze({
    schema: REPORT_SCHEMA,
    version: REPORT_VERSION,
    packageName: PACKAGE_NAME,
    packageVersion: expectedVersion,
    registry: PUBLIC_REGISTRY,
    integrity,
    shasum,
    fileCount,
    unpackedBytes,
    runtimeDependencies,
    provenancePredicate: PROVENANCE_PREDICATE,
    registrySignatureCount: signatures.length,
  });
}

async function defaultExecute(executable: string, args: readonly string[], options: Readonly<{ cwd: string; env: NodeJS.ProcessEnv }>): Promise<CommandResult> {
  const result = await defaultExecFile(executable, [...args], {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: MAX_METADATA_BYTES,
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

async function runNpm(
  execute: ExecuteCommand,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  label: string,
): Promise<string> {
  const result = await execute('npm', args, { cwd, env });
  if (result.stderr.trim()) throw new TypeError(`Published CLI ${label} wrote unexpected diagnostics.`);
  return result.stdout;
}

export async function checkPublishedCli(expectedVersionValue: unknown, options: CheckOptions = {}): Promise<PublishedCliReport> {
  const expectedVersion = normalizeSemanticVersion(expectedVersionValue);
  const execute = options.execute || defaultExecute;
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'whoisleuth-published-cli-'));
  try {
    await Promise.all([
      writeFile(path.join(temporaryRoot, 'global.npmrc'), '', { mode: 0o600 }),
      writeFile(path.join(temporaryRoot, 'user.npmrc'), '', { mode: 0o600 }),
    ]);
    const environment = anonymousNpmEnvironment(options.environment || process.env, temporaryRoot);
    const selector = `${PACKAGE_NAME}@${expectedVersion}`;
    const metadataOutput = await runNpm(execute, [
      'view', selector, '--json', `--registry=${PUBLIC_REGISTRY}`,
    ], temporaryRoot, environment, 'metadata check');
    const manifestReport = validatePublishedManifest(parseMetadataJson(metadataOutput), expectedVersion);

    const execPrefix = [
      'exec', '--yes', '--ignore-scripts', `--registry=${PUBLIC_REGISTRY}`, `--package=${selector}`, '--', 'whoisleuth',
    ];
    const installedVersion = await runNpm(execute, [...execPrefix, '--version'], temporaryRoot, environment, 'version check');
    if (installedVersion !== `${expectedVersion}\n`) throw new TypeError('Published CLI executable version does not match the selected version.');

    const doctorOutput = await runNpm(execute, [...execPrefix, 'doctor', '--json'], temporaryRoot, environment, 'offline doctor check');
    const doctor = parseMetadataJson(doctorOutput);
    if (
      doctor.schema !== 'whoisleuth.cli.doctor'
      || doctor.cliVersion !== expectedVersion
      || doctor.networkRequested !== false
      || doctor.state !== 'pass'
    ) {
      throw new TypeError('Published CLI offline doctor result does not match the selected version.');
    }

    return Object.freeze({
      ...manifestReport,
      checks: Object.freeze(['metadata', 'integrity', 'registry-signature', 'oidc-provenance', 'version', 'offline-doctor']),
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

export function formatPublishedCliReport(report: PublishedCliReport): string {
  return [
    'WHOISleuth published CLI check',
    `Package: ${report.packageName}@${report.packageVersion}`,
    `Registry: ${report.registry}`,
    `Archive: ${report.fileCount} files / ${report.unpackedBytes} unpacked bytes`,
    `Runtime dependencies: ${Object.entries(report.runtimeDependencies).map(([name, version]) => `${name}@${version}`).join(', ')}`,
    `Provenance: ${report.provenancePredicate}`,
    `Registry signatures: ${report.registrySignatureCount}`,
    `Checks: ${report.checks.join(', ')}`,
    'Result: PASS',
  ].join('\n');
}

export function parseArguments(args: readonly string[]): Readonly<{ version: string; json: boolean }> {
  const json = args.includes('--json');
  const values = args.filter((argument) => argument !== '--json');
  if (values.length !== 1 || args.filter((argument) => argument === '--json').length > 1) {
    throw new TypeError('Usage: node tools/published-cli-check.mts <version> [--json]');
  }
  return { version: normalizeSemanticVersion(values[0]), json };
}

export async function main(args = process.argv.slice(2), options: MainOptions = {}): Promise<number> {
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;
  try {
    const parsed = parseArguments(args);
    const report = await checkPublishedCli(parsed.version, {
      ...(options.execute ? { execute: options.execute } : {}),
      ...(options.environment ? { environment: options.environment } : {}),
    });
    stdout.write(`${parsed.json ? JSON.stringify(report, null, 2) : formatPublishedCliReport(report)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${boundedError(error)}\n`);
    return 2;
  }
}

const invokedAsScript = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedAsScript) process.exitCode = await main();

export type { ExecuteCommand, PublishedCliReport };
