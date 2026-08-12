#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { opendir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  boundedSafeRelativePath,
  compareCodeUnits,
  pathIsWithin,
  requireJsonRecord as record,
} from './maintainer-tool-helpers.mts';
import { readBoundedRegularTextFile } from '../lib/bounded-file.mts';
import { parseBoundedJsonObject } from '../lib/bounded-json.mts';

type JsonRecord = Record<string, unknown>;
type WritableLike = { write(value: string): unknown };
type NoticeMode = 'check' | 'write';
type InventoryOptions = Readonly<{
  directDependencyNames?: readonly string[];
  scopeLabel?: string;
}>;
type MainOptions = Readonly<{
  repositoryRoot?: string;
  stdout?: WritableLike;
  stderr?: WritableLike;
}>;

export type ProductionPackage = Readonly<{
  name: string;
  version: string;
  license: string;
  direct: boolean;
  installPath: string;
}>;

export const THIRD_PARTY_NOTICE_PATH = 'frontend/static/third-party-notices.txt';
export const MAX_NOTICE_LOCKFILE_BYTES = 5 * 1024 * 1024;
export const MAX_NOTICE_PACKAGES = 500;
export const MAX_NOTICE_LOCKFILE_PACKAGE_ENTRIES = 20_000;
export const MAX_NOTICE_DIRECT_DEPENDENCIES = 2_000;
export const MAX_NOTICE_DOCUMENT_BYTES = 128 * 1024;
export const MAX_NOTICE_OUTPUT_BYTES = 4 * 1024 * 1024;
export const MAX_NOTICE_DIRECTORY_ENTRIES = 2048;

const LICENSE_OVERRIDES = new Map([
  ['callsite@1.0.0', 'MIT'],
]);
const NOTICE_FILENAME_RE = /^(?:licen[cs]e|copying|notice)(?:[._-].*|)$/iu;
const README_FILENAME_RE = /^readme(?:[._-].*|)$/iu;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/u;
const PACKAGE_SEGMENT_RE = /^(?:@?[a-z0-9][a-z0-9._-]{0,213})$/iu;
const REVIEWED_LICENSE_EXPRESSIONS = new Set([
  '(MIT OR CC0-1.0)',
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'MIT',
]);

function boundedToken(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || !value || value.length > maxLength || CONTROL_CHAR_RE.test(value)) {
    throw new TypeError(`${label} must be a bounded text value.`);
  }
  return value;
}

function dependencyNames(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  const names = Object.keys(record(value, label));
  if (names.length > MAX_NOTICE_DIRECT_DEPENDENCIES) {
    throw new TypeError(`${label} exceeds its dependency limit.`);
  }
  return names;
}

function reviewedLicense(value: unknown, identifier: string): string {
  const license = boundedToken(value, `${identifier} licence`, 128);
  if (!REVIEWED_LICENSE_EXPRESSIONS.has(license)) {
    throw new TypeError(`${identifier} declares unreviewed licence expression ${license}.`);
  }
  return license;
}

function packageNameFromInstallPath(installPath: string): string {
  boundedSafeRelativePath(installPath, 'Package install path', 1024);
  const segments = installPath.split('/');
  let packageName = '';
  for (let index = 0; index < segments.length;) {
    if (segments[index] !== 'node_modules') {
      throw new TypeError('Package install path must remain inside node_modules.');
    }
    const first = segments[index + 1] ?? '';
    if (!PACKAGE_SEGMENT_RE.test(first) || first === '.' || first === '..') {
      throw new TypeError('Package install path contains an invalid package segment.');
    }
    if (first.startsWith('@')) {
      const second = segments[index + 2] ?? '';
      if (!PACKAGE_SEGMENT_RE.test(second) || second.startsWith('@') || second === '.' || second === '..') {
        throw new TypeError('Scoped package install path is incomplete or invalid.');
      }
      packageName = `${first}/${second}`;
      index += 3;
    } else {
      packageName = first;
      index += 2;
    }
  }
  return boundedToken(packageName, 'Package name', 214);
}

function resolveInstalledDependency(
  packages: JsonRecord,
  fromInstallPath: string,
  dependencyName: string,
): string | null {
  boundedToken(dependencyName, 'Dependency name', 214);
  const validUnscoped = /^[a-z0-9][a-z0-9._-]{0,213}$/iu.test(dependencyName);
  const validScoped = /^@[a-z0-9][a-z0-9._-]{0,100}\/[a-z0-9][a-z0-9._-]{0,100}$/iu.test(dependencyName);
  if (!validUnscoped && !validScoped) throw new TypeError(`Dependency name ${dependencyName} is invalid.`);
  let cursor = fromInstallPath;
  while (cursor && cursor !== '.') {
    const nested = `${cursor}/node_modules/${dependencyName}`;
    if (Object.hasOwn(packages, nested)) return nested;
    cursor = path.posix.dirname(cursor);
  }
  const rootCandidate = `node_modules/${dependencyName}`;
  return Object.hasOwn(packages, rootCandidate) ? rootCandidate : null;
}

function dependencyClosure(packages: JsonRecord, directDependencyNames: readonly string[]): Set<string> {
  if (!directDependencyNames.length || directDependencyNames.length > MAX_NOTICE_DIRECT_DEPENDENCIES) {
    throw new TypeError('Scoped production inventory must name a bounded non-empty direct dependency set.');
  }
  const selected = new Set<string>();
  const queue: string[] = [];
  for (const dependencyName of directDependencyNames) {
    const installPath = resolveInstalledDependency(packages, '', dependencyName);
    if (!installPath) throw new TypeError(`Scoped production dependency ${dependencyName} is not installed.`);
    queue.push(installPath);
  }
  while (queue.length) {
    const installPath = queue.shift();
    if (!installPath || selected.has(installPath)) continue;
    if (selected.size >= MAX_NOTICE_PACKAGES) throw new TypeError('Scoped production dependency closure exceeds its package limit.');
    selected.add(installPath);
    const packageEntry = record(packages[installPath], `package-lock.json package ${installPath}`);
    for (const dependencyName of [
      ...dependencyNames(packageEntry.dependencies, `${installPath} dependencies`),
      ...dependencyNames(packageEntry.optionalDependencies, `${installPath} optional dependencies`),
      ...dependencyNames(packageEntry.peerDependencies, `${installPath} peer dependencies`),
    ]) {
      const dependencyPath = resolveInstalledDependency(packages, installPath, dependencyName);
      if (dependencyPath && !selected.has(dependencyPath)) queue.push(dependencyPath);
    }
  }
  return selected;
}

export function collectProductionPackages(
  lockfileValue: unknown,
  options: InventoryOptions = {},
): ProductionPackage[] {
  const lockfile = record(lockfileValue, 'package-lock.json');
  if (lockfile.lockfileVersion !== 3) {
    throw new TypeError('package-lock.json must use lockfileVersion 3.');
  }
  const packages = record(lockfile.packages, 'package-lock.json packages');
  if (Object.keys(packages).length > MAX_NOTICE_LOCKFILE_PACKAGE_ENTRIES) {
    throw new TypeError('package-lock.json exceeds its package-entry limit.');
  }
  const root = record(packages[''], 'package-lock.json root package');
  const frontend = packages.frontend === undefined
    ? {}
    : record(packages.frontend, 'package-lock.json frontend workspace');
  const requestedDirectNames = options.directDependencyNames;
  const directNames = new Set(requestedDirectNames ?? [
      ...dependencyNames(root.dependencies, 'root dependencies'),
      ...dependencyNames(root.optionalDependencies, 'root optional dependencies'),
      ...dependencyNames(frontend.dependencies, 'frontend dependencies'),
      ...dependencyNames(frontend.optionalDependencies, 'frontend optional dependencies'),
    ]);
  const selectedPaths = requestedDirectNames ? dependencyClosure(packages, requestedDirectNames) : null;
  const collected = new Map<string, ProductionPackage>();

  for (const [installPath, rawPackage] of Object.entries(packages)) {
    if (!installPath.startsWith('node_modules/') || (selectedPaths && !selectedPaths.has(installPath))) continue;
    const packageEntry = record(rawPackage, `package-lock.json package ${installPath}`);
    if (packageEntry.dev === true || packageEntry.link === true) continue;
    const name = packageNameFromInstallPath(installPath);
    const version = boundedToken(packageEntry.version, `${name} version`, 128);
    const identifier = `${name}@${version}`;
    const declaredLicense = packageEntry.license ?? LICENSE_OVERRIDES.get(identifier);
    const license = reviewedLicense(declaredLicense, identifier);
    const existing = collected.get(identifier);
    const candidate = Object.freeze({
      name,
      version,
      license,
      direct: directNames.has(name),
      installPath,
    });
    if (!existing || (!existing.direct && candidate.direct) || compareCodeUnits(installPath, existing.installPath) < 0) {
      collected.set(identifier, candidate);
    }
  }

  if (collected.size === 0 || collected.size > MAX_NOTICE_PACKAGES) {
    throw new TypeError('Production dependency inventory is empty or exceeds its package limit.');
  }
  return [...collected.values()]
    .sort((left, right) => compareCodeUnits(left.name, right.name) || compareCodeUnits(left.version, right.version));
}

async function readBoundedText(filename: string, maxBytes: number): Promise<string> {
  return readBoundedRegularTextFile(filename, {
    maximumBytes: maxBytes,
    minimumBytes: 1,
    label: path.basename(filename),
  });
}

async function readBoundedJson(filename: string): Promise<unknown> {
  const source = await readBoundedText(filename, MAX_NOTICE_LOCKFILE_BYTES);
  try {
    return parseBoundedJsonObject(source, {
      label: path.basename(filename),
      maximumBytes: MAX_NOTICE_LOCKFILE_BYTES,
    });
  } catch {
    throw new TypeError(`${path.basename(filename)} is not valid JSON.`);
  }
}

function extractReadmeLicense(source: string): string {
  const normalized = source.replace(/\r\n?/gu, '\n');
  const lines = normalized.split('\n');
  const start = lines.findIndex((line) => /^#{1,6}\s+licen[cs]e\s*$/iu.test(line.trim()));
  if (start === -1) return '';
  const endOffset = lines.slice(start + 1).findIndex((line) => /^#{1,6}\s+/u.test(line.trim()));
  const end = endOffset === -1 ? lines.length : start + 1 + endOffset;
  return lines.slice(start, end).join('\n').trim().slice(0, MAX_NOTICE_DOCUMENT_BYTES);
}

async function directoryNames(directory: string): Promise<string[]> {
  const names: string[] = [];
  const handle = await opendir(directory);
  for await (const entry of handle) {
    names.push(entry.name);
    if (names.length > MAX_NOTICE_DIRECTORY_ENTRIES) {
      throw new TypeError('Package directory exceeds its entry limit.');
    }
  }
  return names;
}

async function packageNoticeDocuments(
  repositoryRoot: string,
  nodeModulesRoot: string,
  packageEntry: ProductionPackage,
) {
  const requestedDirectory = path.resolve(repositoryRoot, packageEntry.installPath);
  const directory = await realpath(requestedDirectory);
  if (!pathIsWithin(nodeModulesRoot, directory)) {
    throw new TypeError(`${packageEntry.name} resolves outside the repository node_modules directory.`);
  }
  const directoryEntries = await directoryNames(directory);
  const filenames = directoryEntries
    .filter((filename) => NOTICE_FILENAME_RE.test(filename))
    .sort(compareCodeUnits)
    .slice(0, 8);
  const documents: Array<{ source: string; text: string }> = [];
  for (const filename of filenames) {
    const text = (await readBoundedText(path.join(directory, filename), MAX_NOTICE_DOCUMENT_BYTES))
      .replace(/\r\n?/gu, '\n')
      .replace(/[ \t]+$/gmu, '')
      .trim();
    if (text) documents.push({ source: filename, text });
  }
  if (documents.length) return documents;

  const readme = directoryEntries
    .filter((filename) => README_FILENAME_RE.test(filename))
    .sort(compareCodeUnits)[0];
  if (readme) {
    const source = await readBoundedText(path.join(directory, readme), MAX_NOTICE_DOCUMENT_BYTES);
    const text = extractReadmeLicense(source);
    if (text) return [{ source: `${readme} licence section`, text }];
  }
  return [{
    source: 'package metadata',
    text: `The installed package declares ${packageEntry.license}. It does not include a standalone licence document.`,
  }];
}

export async function buildThirdPartyNotices(
  repositoryRoot: string,
  options: InventoryOptions = {},
): Promise<string> {
  const realRepositoryRoot = await realpath(repositoryRoot);
  const lockfile = await readBoundedJson(path.join(realRepositoryRoot, 'package-lock.json'));
  const packages = collectProductionPackages(lockfile, options);
  const nodeModulesRoot = await realpath(path.join(realRepositoryRoot, 'node_modules'));
  if (!pathIsWithin(realRepositoryRoot, nodeModulesRoot)) {
    throw new TypeError('node_modules resolves outside the repository root.');
  }
  const prefix = [
    `WHOISleuth ${options.scopeLabel ?? 'website'} third-party production dependency notices`,
    '',
    'Generated deterministically from package-lock.json and the installed production',
    'dependency packages. Do not edit this file directly; run npm run licenses:update.',
    options.directDependencyNames
      ? 'The inventory is the exact transitive closure of the packaged CLI runtime dependencies.'
      : 'The inventory includes exact locked versions and excludes development-only packages.',
    '',
    `Package count: ${packages.length}`,
    '',
    '',
  ].join('\n');
  const blocks: string[] = [];
  let retainedBytes = Buffer.byteLength(prefix, 'utf8');
  for (const packageEntry of packages) {
    const documents = await packageNoticeDocuments(realRepositoryRoot, nodeModulesRoot, packageEntry);
    const block = [
      '='.repeat(80),
      `${packageEntry.name}@${packageEntry.version}`,
      `Relationship: ${packageEntry.direct ? 'direct production dependency' : 'transitive production dependency'}`,
      `Declared licence: ${packageEntry.license}`,
      ...documents.flatMap((document) => [
        `Licence source: ${document.source}`,
        '',
        document.text,
      ]),
    ].join('\n');
    const separatorBytes = blocks.length ? 1 : 0;
    const prospectiveBytes = retainedBytes + separatorBytes + Buffer.byteLength(block, 'utf8') + 1;
    if (prospectiveBytes > MAX_NOTICE_OUTPUT_BYTES) {
      throw new TypeError('Third-party notice output exceeds its byte limit.');
    }
    blocks.push(block);
    retainedBytes = prospectiveBytes - 1;
  }
  const output = `${prefix}${blocks.join('\n')}\n`;
  if (Buffer.byteLength(output, 'utf8') > MAX_NOTICE_OUTPUT_BYTES) {
    throw new TypeError('Third-party notice output exceeds its byte limit.');
  }
  return output;
}

export function parseArguments(args: readonly string[]): NoticeMode {
  if (args.length !== 1 || (args[0] !== '--check' && args[0] !== '--write')) {
    throw new TypeError('Usage: node tools/third-party-notices.mts --check|--write');
  }
  return args[0] === '--write' ? 'write' : 'check';
}

export async function main(args = process.argv.slice(2), options: MainOptions = {}): Promise<number> {
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;
  try {
    const mode = parseArguments(args);
    const repositoryRoot = await realpath(path.resolve(options.repositoryRoot || process.cwd()));
    const output = await buildThirdPartyNotices(repositoryRoot);
    const outputParent = await realpath(path.dirname(path.join(repositoryRoot, THIRD_PARTY_NOTICE_PATH)));
    if (!pathIsWithin(repositoryRoot, outputParent)) {
      throw new TypeError('Third-party notice output directory resolves outside the repository root.');
    }
    const outputPath = path.join(outputParent, path.basename(THIRD_PARTY_NOTICE_PATH));
    if (mode === 'write') {
      const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporaryPath, output, { encoding: 'utf8', flag: 'wx' });
        await rename(temporaryPath, outputPath);
      } finally {
        await rm(temporaryPath, { force: true });
      }
      stdout.write(`Updated ${THIRD_PARTY_NOTICE_PATH} with the production dependency notices.\n`);
      return 0;
    }
    const retained = await readBoundedText(outputPath, MAX_NOTICE_OUTPUT_BYTES);
    if (retained !== output) {
      throw new TypeError(`Production dependency notices are stale. Run npm run licenses:update.`);
    }
    stdout.write(`Production dependency notices: pass (${collectProductionPackages(await readBoundedJson(path.join(repositoryRoot, 'package-lock.json'))).length} packages)\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : 'Third-party notice check failed.'}\n`);
    return 2;
  }
}

const invokedAsScript = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedAsScript) process.exitCode = await main();
