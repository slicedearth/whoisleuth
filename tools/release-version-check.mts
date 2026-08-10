#!/usr/bin/env node

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_SEMANTIC_VERSION_LENGTH,
  normalizeBoundedSemanticVersion,
} from '../lib/semantic-version.mts';
import { requireJsonRecord as record } from './maintainer-tool-helpers.mts';

type JsonRecord = Record<string, unknown>;
type WritableLike = { write(value: string): unknown };
type MainOptions = Readonly<{
  repositoryRoot?: string;
  stdout?: WritableLike;
  stderr?: WritableLike;
}>;

export const RELEASE_VERSION_CHECK_SCHEMA = 'whoisleuth.release-version-check';
export const RELEASE_VERSION_CHECK_VERSION = 1;
export const MAX_RELEASE_VERSION_LENGTH = MAX_SEMANTIC_VERSION_LENGTH;
export const MAX_RELEASE_MANIFEST_BYTES = 2 * 1024 * 1024;

export function normalizeSemanticVersion(value: unknown): string {
  return normalizeBoundedSemanticVersion(value, 'Release');
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
