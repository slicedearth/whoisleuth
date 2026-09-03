#!/usr/bin/env node

import { readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
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
  inspectIdentity?: typeof inspectReleaseVersionIdentity;
}>;

export type ReleaseVersionIdentity = Readonly<{
  state: 'unreleased' | 'tagged_current_sources';
  checkedPaths: number;
}>;

export const RELEASE_VERSION_CHECK_SCHEMA = 'whoisleuth.release-version-check';
export const RELEASE_VERSION_CHECK_VERSION = 2;
export const MAX_RELEASE_VERSION_LENGTH = MAX_SEMANTIC_VERSION_LENGTH;
export const MAX_RELEASE_MANIFEST_BYTES = 2 * 1024 * 1024;
export const RELEASE_IDENTITY_PATHS = Object.freeze([
  '.nvmrc',
  'DISCLOSURE',
  'LICENSE',
  'LICENSES/Retire.js-Apache-2.0.txt',
  'NOTICE',
  'SECURITY.md',
  'TRADEMARKS.md',
  'bin',
  'cli',
  'docs/cli-reference.md',
  'docs/cli.md',
  'frontend/package.json',
  'frontend/src',
  'frontend/static',
  'frontend/svelte.config.ts',
  'frontend/vite.config.ts',
  'lib',
  'netlify/functions',
  'netlify.toml',
  'package-lock.json',
  'package.json',
  'packages',
  'server.mts',
] as const);

const FULL_SHA = /^[a-f0-9]{40}$/u;
const MAX_GIT_OUTPUT_BYTES = 1024 * 1024;

export function normalizeSemanticVersion(value: unknown): string {
  return normalizeBoundedSemanticVersion(value, 'Release');
}

export function buildReleaseVersionReport(
  packageManifestValue: unknown,
  lockfileValue: unknown,
  identity: ReleaseVersionIdentity = Object.freeze({
    state: 'unreleased',
    checkedPaths: RELEASE_IDENTITY_PATHS.length,
  }),
) {
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
    releaseIdentity: identity,
  });
}

function git(
  repositoryRoot: string,
  args: readonly string[],
): Readonly<{ status: number | null; stdout: string }> {
  const child = spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
  });
  if (child.error) throw new Error('Release identity could not invoke Git.');
  return Object.freeze({ status: child.status, stdout: child.stdout });
}

function requireSuccessfulGit(
  result: ReturnType<typeof git>,
  message: string,
): string {
  if (result.status !== 0) throw new Error(message);
  return result.stdout.trim();
}

export function inspectReleaseVersionIdentity(
  repositoryRoot: string,
  expectedTag: string,
): ReleaseVersionIdentity {
  if (!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(expectedTag)) {
    throw new TypeError('Release identity requires the exact semantic-version tag.');
  }
  const shallow = requireSuccessfulGit(
    git(repositoryRoot, ['rev-parse', '--is-shallow-repository']),
    'Release identity requires a Git checkout with complete local tag history.',
  );
  if (shallow !== 'false') {
    throw new Error('Release identity requires a non-shallow Git checkout with complete local tag history.');
  }

  const tag = git(repositoryRoot, ['rev-parse', '--verify', '--quiet', `refs/tags/${expectedTag}^{commit}`]);
  if (tag.status === 1) {
    return Object.freeze({ state: 'unreleased', checkedPaths: RELEASE_IDENTITY_PATHS.length });
  }
  const tagCommit = requireSuccessfulGit(tag, 'Release identity could not inspect the existing semantic-version tag.');
  if (!FULL_SHA.test(tagCommit)) throw new Error('Release identity received an invalid tag commit.');

  const committed = git(repositoryRoot, [
    'diff', '--quiet', tagCommit, 'HEAD', '--', ...RELEASE_IDENTITY_PATHS,
  ]);
  const working = git(repositoryRoot, [
    'status', '--porcelain=v1', '--untracked-files=all', '--', ...RELEASE_IDENTITY_PATHS,
  ]);
  if ((committed.status !== 0 && committed.status !== 1) || working.status !== 0) {
    throw new Error('Release identity could not compare the current release inputs with the existing tag.');
  }
  if (committed.status === 1 || working.stdout.trim()) {
    throw new Error(
      `Release version ${expectedTag.slice(1)} already identifies different release inputs; choose a new semantic version before merging or releasing these changes.`,
    );
  }
  return Object.freeze({ state: 'tagged_current_sources', checkedPaths: RELEASE_IDENTITY_PATHS.length });
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
    report.releaseIdentity.state === 'unreleased'
      ? `Release identity: untagged version; ${report.releaseIdentity.checkedPaths} release-input paths checked`
      : `Release identity: existing tag matches ${report.releaseIdentity.checkedPaths} release-input paths`,
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
    const manifestReport = buildReleaseVersionReport(packageManifest, lockfile);
    const identity = (options.inspectIdentity || inspectReleaseVersionIdentity)(
      repositoryRoot,
      manifestReport.expectedTag,
    );
    stdout.write(`${formatReleaseVersionReport(buildReleaseVersionReport(packageManifest, lockfile, identity))}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : 'Release version check failed.'}\n`);
    return 2;
  }
}

const invokedAsScript = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedAsScript) process.exitCode = await main();
