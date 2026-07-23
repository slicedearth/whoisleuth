#!/usr/bin/env node

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type JsonRecord = Record<string, unknown>;
type WritableLike = { write(value: string): unknown };
type MainOptions = Readonly<{
  repositoryRoot?: string;
  stdout?: WritableLike;
  stderr?: WritableLike;
}>;

export const RELEASE_VERSION_CHECK_SCHEMA = 'whoisleuth.release-version-check';
export const RELEASE_VERSION_CHECK_VERSION = 1;
export const MAX_RELEASE_VERSION_LENGTH = 128;
export const MAX_RELEASE_MANIFEST_BYTES = 2 * 1024 * 1024;

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }
  return value as JsonRecord;
}

function validateIdentifierList(value: string, label: string, forbidNumericLeadingZero: boolean): void {
  const identifiers = value.split('.');
  if (identifiers.some((identifier) => identifier.length === 0)) {
    throw new TypeError(`${label} contains an empty identifier.`);
  }
  for (const identifier of identifiers) {
    if (!/^[0-9A-Za-z-]+$/u.test(identifier)) {
      throw new TypeError(`${label} contains an invalid identifier.`);
    }
    if (forbidNumericLeadingZero && /^[0-9]+$/u.test(identifier) && identifier.length > 1 && identifier.startsWith('0')) {
      throw new TypeError(`${label} numeric identifiers must not contain leading zeroes.`);
    }
  }
}

export function normalizeSemanticVersion(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_RELEASE_VERSION_LENGTH || value.trim() !== value) {
    throw new TypeError('Release version must be a bounded semantic-version string.');
  }

  const buildParts = value.split('+');
  if (buildParts.length > 2) throw new TypeError('Release version contains more than one build-metadata separator.');
  const [precedence, buildMetadata] = buildParts;
  const prereleaseSeparator = precedence.indexOf('-');
  const core = prereleaseSeparator === -1 ? precedence : precedence.slice(0, prereleaseSeparator);
  const prerelease = prereleaseSeparator === -1 ? undefined : precedence.slice(prereleaseSeparator + 1);
  const coreParts = core.split('.');

  if (coreParts.length !== 3 || coreParts.some((part) => !/^(?:0|[1-9][0-9]*)$/u.test(part))) {
    throw new TypeError('Release version must contain major, minor, and patch numbers without leading zeroes.');
  }
  if (prerelease !== undefined) validateIdentifierList(prerelease, 'Release prerelease', true);
  if (buildMetadata !== undefined) validateIdentifierList(buildMetadata, 'Release build metadata', false);
  return value;
}

export function buildReleaseVersionReport(packageManifestValue: unknown, lockfileValue: unknown) {
  const packageManifest = record(packageManifestValue, 'package.json');
  const lockfile = record(lockfileValue, 'package-lock.json');
  const packages = record(lockfile.packages, 'package-lock.json packages');
  const lockRoot = record(packages[''], 'package-lock.json root package');

  if (packageManifest.name !== 'whoisleuth') throw new TypeError('package.json must retain the whoisleuth package name.');
  if (packageManifest.private !== true) throw new TypeError('package.json must remain private to prevent accidental registry publication.');

  const version = normalizeSemanticVersion(packageManifest.version);
  const lockVersion = normalizeSemanticVersion(lockfile.version);
  const lockRootVersion = normalizeSemanticVersion(lockRoot.version);
  if (lockfile.name !== packageManifest.name || lockRoot.name !== packageManifest.name) {
    throw new TypeError('Package names must match across package.json and package-lock.json.');
  }
  if (lockVersion !== version || lockRootVersion !== version) {
    throw new TypeError('Release versions must match across package.json and package-lock.json.');
  }

  return Object.freeze({
    schema: RELEASE_VERSION_CHECK_SCHEMA,
    version: RELEASE_VERSION_CHECK_VERSION,
    releaseVersion: version,
    expectedTag: `v${version}`,
    packagePublishing: 'disabled',
    manifestLockstep: true,
  });
}

async function readBoundedJson(filename: string): Promise<unknown> {
  const metadata = await stat(filename);
  if (!metadata.isFile() || metadata.size > MAX_RELEASE_MANIFEST_BYTES) {
    throw new TypeError(`${path.basename(filename)} is missing or exceeds the release-check byte limit.`);
  }
  const source = await readFile(filename, 'utf8');
  try {
    return JSON.parse(source);
  } catch {
    throw new TypeError(`${path.basename(filename)} is not valid JSON.`);
  }
}

export function formatReleaseVersionReport(report: ReturnType<typeof buildReleaseVersionReport>): string {
  return [
    'WHOISleuth release version check',
    `Version: ${report.releaseVersion}`,
    `Expected tag: ${report.expectedTag}`,
    'Manifest lockstep: pass',
    'Package publishing: disabled',
  ].join('\n');
}

export function parseArguments(args: readonly string[]): void {
  if (args.length > 0) throw new TypeError('Usage: npm run release:check');
}

export async function main(args = process.argv.slice(2), options: MainOptions = {}): Promise<number> {
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;
  try {
    parseArguments(args);
    const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
    const [packageManifest, lockfile] = await Promise.all([
      readBoundedJson(path.join(repositoryRoot, 'package.json')),
      readBoundedJson(path.join(repositoryRoot, 'package-lock.json')),
    ]);
    stdout.write(`${formatReleaseVersionReport(buildReleaseVersionReport(packageManifest, lockfile))}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : 'Release version check failed.'}\n`);
    return 2;
  }
}

const invokedAsScript = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedAsScript) process.exitCode = await main();
