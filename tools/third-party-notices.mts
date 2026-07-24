#!/usr/bin/env node

import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type JsonRecord = Record<string, unknown>;
type WritableLike = { write(value: string): unknown };
type NoticeMode = 'check' | 'write';
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
export const MAX_NOTICE_DOCUMENT_BYTES = 128 * 1024;
export const MAX_NOTICE_OUTPUT_BYTES = 4 * 1024 * 1024;

const LICENSE_OVERRIDES = new Map([
  ['callsite@1.0.0', 'MIT'],
]);
const NOTICE_FILENAME_RE = /^(?:licen[cs]e|copying|notice)(?:[._-].*|)$/iu;
const README_FILENAME_RE = /^readme(?:[._-].*|)$/iu;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/u;

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }
  return value as JsonRecord;
}

function boundedToken(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || !value || value.length > maxLength || CONTROL_CHAR_RE.test(value)) {
    throw new TypeError(`${label} must be a bounded text value.`);
  }
  return value;
}

function dependencyNames(value: unknown): string[] {
  if (value === undefined) return [];
  return Object.keys(record(value, 'dependency map'));
}

function packageNameFromInstallPath(installPath: string): string {
  const name = installPath.split('/node_modules/').at(-1)?.replace(/^node_modules\//u, '') || '';
  return boundedToken(name, 'Package name', 214);
}

export function collectProductionPackages(lockfileValue: unknown): ProductionPackage[] {
  const lockfile = record(lockfileValue, 'package-lock.json');
  const packages = record(lockfile.packages, 'package-lock.json packages');
  const root = record(packages[''], 'package-lock.json root package');
  const frontend = packages.frontend === undefined
    ? {}
    : record(packages.frontend, 'package-lock.json frontend workspace');
  const directNames = new Set([
    ...dependencyNames(root.dependencies),
    ...dependencyNames(root.optionalDependencies),
    ...dependencyNames(frontend.dependencies),
    ...dependencyNames(frontend.optionalDependencies),
  ]);
  const collected = new Map<string, ProductionPackage>();

  for (const [installPath, rawPackage] of Object.entries(packages)) {
    if (!installPath.startsWith('node_modules/')) continue;
    const packageEntry = record(rawPackage, `package-lock.json package ${installPath}`);
    if (packageEntry.dev === true || packageEntry.link === true) continue;
    const name = packageNameFromInstallPath(installPath);
    const version = boundedToken(packageEntry.version, `${name} version`, 128);
    const identifier = `${name}@${version}`;
    const declaredLicense = packageEntry.license ?? LICENSE_OVERRIDES.get(identifier);
    const license = boundedToken(declaredLicense, `${identifier} licence`, 128);
    const existing = collected.get(identifier);
    const candidate = Object.freeze({
      name,
      version,
      license,
      direct: directNames.has(name),
      installPath,
    });
    if (!existing || (!existing.direct && candidate.direct) || installPath.localeCompare(existing.installPath) < 0) {
      collected.set(identifier, candidate);
    }
  }

  if (collected.size === 0 || collected.size > MAX_NOTICE_PACKAGES) {
    throw new TypeError('Production dependency inventory is empty or exceeds its package limit.');
  }
  return [...collected.values()]
    .sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
}

async function readBoundedText(filename: string, maxBytes: number): Promise<string> {
  const metadata = await stat(filename);
  if (!metadata.isFile() || metadata.size > maxBytes) {
    throw new TypeError(`${path.basename(filename)} is missing or exceeds its byte limit.`);
  }
  return readFile(filename, 'utf8');
}

async function readBoundedJson(filename: string): Promise<unknown> {
  const source = await readBoundedText(filename, MAX_NOTICE_LOCKFILE_BYTES);
  try {
    return JSON.parse(source);
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

async function packageNoticeDocuments(repositoryRoot: string, packageEntry: ProductionPackage) {
  const directory = path.join(repositoryRoot, packageEntry.installPath);
  const filenames = (await readdir(directory))
    .filter((filename) => NOTICE_FILENAME_RE.test(filename))
    .sort((left, right) => left.localeCompare(right))
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

  const readme = (await readdir(directory))
    .filter((filename) => README_FILENAME_RE.test(filename))
    .sort((left, right) => left.localeCompare(right))[0];
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

export async function buildThirdPartyNotices(repositoryRoot: string): Promise<string> {
  const lockfile = await readBoundedJson(path.join(repositoryRoot, 'package-lock.json'));
  const packages = collectProductionPackages(lockfile);
  const blocks: string[] = [];
  for (const packageEntry of packages) {
    const documents = await packageNoticeDocuments(repositoryRoot, packageEntry);
    blocks.push([
      '='.repeat(80),
      `${packageEntry.name}@${packageEntry.version}`,
      `Relationship: ${packageEntry.direct ? 'direct production dependency' : 'transitive production dependency'}`,
      `Declared licence: ${packageEntry.license}`,
      ...documents.flatMap((document) => [
        `Licence source: ${document.source}`,
        '',
        document.text,
      ]),
    ].join('\n'));
  }
  const output = [
    'WHOISleuth third-party production dependency notices',
    '',
    'Generated deterministically from package-lock.json and the installed production',
    'dependency packages. Do not edit this file directly; run npm run licenses:update.',
    'The inventory includes exact locked versions and excludes development-only packages.',
    '',
    `Package count: ${packages.length}`,
    '',
    ...blocks,
    '',
  ].join('\n');
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
    const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
    const output = await buildThirdPartyNotices(repositoryRoot);
    const outputPath = path.join(repositoryRoot, THIRD_PARTY_NOTICE_PATH);
    if (mode === 'write') {
      await writeFile(outputPath, output, 'utf8');
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
