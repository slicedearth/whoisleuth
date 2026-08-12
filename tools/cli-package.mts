#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  WHOISLEUTH_PROJECT_URL,
  WHOISLEUTH_SOURCE_ISSUES_URL,
  WHOISLEUTH_SOURCE_REPOSITORY_GIT_URL,
} from '../lib/project-metadata.mts';
import { normalizeSemanticVersion } from './release-version-check.mts';
import { buildThirdPartyNotices } from './third-party-notices.mts';
import {
  boundedPositiveInteger as positiveInteger,
  requireJsonRecord as record,
} from './maintainer-tool-helpers.mts';

type JsonRecord = Record<string, unknown>;
type WritableLike = { write(value: string): unknown };
type MainOptions = Readonly<{
  repositoryRoot?: string;
  stdout?: WritableLike;
  stderr?: WritableLike;
}>;

type DependencyEntry = Readonly<{
  couldNotResolve?: unknown;
  module?: unknown;
}>;

type DependencyModule = Readonly<{
  source?: unknown;
  dependencies?: unknown;
}>;

export type CliPackageReport = Readonly<{
  schema: typeof CLI_PACKAGE_REPORT_SCHEMA;
  version: typeof CLI_PACKAGE_REPORT_VERSION;
  packageName: string;
  packageVersion: string;
  sourceModuleCount: number;
  packedEntryCount: number;
  packedBytes: number;
  unpackedBytes: number;
  runtimeDependencies: Readonly<Record<string, string>>;
  installedChecks: readonly string[];
  publicationEnabled: boolean;
  archiveFilename: string | null;
  archiveSha256: string | null;
}>;

type CliPackageOptions = Readonly<{
  publicationEnabled?: boolean;
  artifactDirectory?: string;
  expectedTag?: string;
}>;

type ParsedArguments = Readonly<{
  json: boolean;
  publicationEnabled: boolean;
  artifactDirectory?: string;
  expectedTag?: string;
}>;

const execFile = promisify(execFileCallback);

export const CLI_PACKAGE_REPORT_SCHEMA = 'whoisleuth.cli-package-check';
export const CLI_PACKAGE_REPORT_VERSION = 3;
export const MAX_CLI_PACKAGE_GRAPH_BYTES = 8 * 1024 * 1024;
// The module ceiling catches accidental graph expansion while leaving a small
// reviewed margin above the installed command surface. The retained-artifact
// ledger deliberately reuses four bounded analysis modules; byte ceilings
// remain the primary package-bloat boundary.
export const MAX_CLI_PACKAGE_MODULES = 288;
export const MAX_CLI_PACKAGE_SOURCE_BYTES = 8 * 1024 * 1024;
export const MAX_CLI_PACKAGE_FILE_BYTES = 2 * 1024 * 1024;
// Keep a modest growth margin while the packed and unpacked byte ceilings remain
// the primary package-bloat controls.
export const MAX_CLI_PACKAGE_ENTRIES = 320;
export const MAX_CLI_PACKAGE_PACKED_BYTES = 2 * 1024 * 1024;
export const MAX_CLI_PACKAGE_UNPACKED_BYTES = 6 * 1024 * 1024;
export const CLI_PACKAGE_LONG_PROCESS_TIMEOUT_MS = 120_000;
export const CLI_PACKAGE_INSTALLED_CHECK_TIMEOUT_MS = 15_000;

const LOCAL_SOURCE_PATTERN = /^(?:bin|cli|lib|frontend\/src\/lib\/analysis)\/[A-Za-z0-9._/-]+\.(?:mts|ts)$/u;
const REQUIRED_SOURCE_MODULES = Object.freeze(['bin/whoisleuth.mts', 'cli/runner.mts']);
export const CLI_RUNTIME_DEPENDENCIES = Object.freeze([
  '@peculiar/x509',
  'maxmind',
  'parse5',
  'reflect-metadata',
  'tldts',
  'undici',
]);
const SUPPORT_FILES = Object.freeze([
  ['packages/cli/README.md', 'README.md'],
  ['docs/cli.md', 'docs/cli.md'],
  ['docs/cli-reference.md', 'docs/cli-reference.md'],
  ['DISCLOSURE', 'DISCLOSURE'],
  ['LICENSE', 'LICENSE'],
  ['NOTICE', 'NOTICE'],
  ['SECURITY.md', 'SECURITY.md'],
  ['TRADEMARKS.md', 'TRADEMARKS.md'],
  ['LICENSES/Retire.js-Apache-2.0.txt', 'LICENSES/Retire.js-Apache-2.0.txt'],
] as const);

function boundedString(value: unknown, label: string, maxLength = 240): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength || value.trim() !== value) {
    throw new TypeError(`${label} must be a non-empty bounded string.`);
  }
  return value;
}

function safeRelativePath(value: unknown, label: string): string {
  const candidate = boundedString(value, label, 512);
  if (path.isAbsolute(candidate) || candidate.includes('\\') || candidate.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new TypeError(`${label} is not a safe repository-relative path.`);
  }
  return candidate;
}

function dependencies(value: unknown): readonly DependencyEntry[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 512) throw new TypeError('Dependency graph entries must be a bounded array.');
  return value.map((entry, index) => record(entry, `Dependency ${index + 1}`));
}

export function selectCliPackageSources(graphValue: unknown): readonly string[] {
  const graph = record(graphValue, 'Dependency graph');
  if (!Array.isArray(graph.modules) || graph.modules.length === 0 || graph.modules.length > MAX_CLI_PACKAGE_MODULES) {
    throw new TypeError(`Dependency graph must contain between 1 and ${MAX_CLI_PACKAGE_MODULES} modules.`);
  }

  const selected = new Set<string>();
  for (const [index, moduleValue] of graph.modules.entries()) {
    const module = record(moduleValue, `Dependency module ${index + 1}`) as DependencyModule;
    const source = safeRelativePath(module.source, `Dependency module ${index + 1} source`);
    for (const [dependencyIndex, dependency] of dependencies(module.dependencies).entries()) {
      if (dependency.couldNotResolve === true) {
        const unresolved = typeof dependency.module === 'string' ? dependency.module.slice(0, 160) : 'unknown';
        throw new TypeError(`CLI dependency ${source} -> ${unresolved} could not be resolved (${dependencyIndex + 1}).`);
      }
    }
    if (LOCAL_SOURCE_PATTERN.test(source)) selected.add(source);
  }

  for (const required of REQUIRED_SOURCE_MODULES) {
    if (!selected.has(required)) throw new TypeError(`Dependency graph is missing required CLI source ${required}.`);
  }
  return Object.freeze([...selected].sort());
}

export function buildCliPackageManifest(
  rootManifestValue: unknown,
  templateManifestValue: unknown,
  lockfileValue: unknown,
  options: Readonly<{ publicationEnabled?: boolean }> = {},
): JsonRecord {
  const rootManifest = record(rootManifestValue, 'Root package manifest');
  const templateManifest = record(templateManifestValue, 'CLI package template');
  const lockfile = record(lockfileValue, 'Root package lockfile');
  const rootDependencies = record(rootManifest.dependencies, 'Root package dependencies');
  const lockPackages = record(lockfile.packages, 'Root package lockfile packages');
  const lockRoot = record(lockPackages[''], 'Root package lockfile root');
  const lockRootDependencies = record(lockRoot.dependencies, 'Root package lockfile dependencies');
  const packageName = boundedString(templateManifest.name, 'CLI package name', 128);
  const packageVersion = normalizeSemanticVersion(rootManifest.version);
  const contentPolicy = record(templateManifest.contentPolicy, 'CLI package content policy');
  const repository = record(templateManifest.repository, 'CLI package repository');
  const bugs = record(templateManifest.bugs, 'CLI package issue tracker');

  if (!packageName.startsWith('@') || !packageName.includes('/')) {
    throw new TypeError('CLI package name must remain scoped.');
  }
  if (templateManifest.private !== true) {
    throw new TypeError('CLI package template must remain private until publication is explicitly approved.');
  }
  if (Object.hasOwn(templateManifest, 'publishConfig')) {
    throw new TypeError('CLI package template must not contain release-only publication configuration.');
  }
  for (const field of ['scripts', 'main', 'module', 'exports', 'dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    if (Object.hasOwn(templateManifest, field)) {
      throw new TypeError(`CLI package template must not declare ${field}.`);
    }
  }
  if (contentPolicy.class !== 'dual-use' || Object.keys(contentPolicy).length !== 1) {
    throw new TypeError('CLI package content policy must declare only the dual-use class.');
  }
  if (
    repository.type !== 'git'
    || repository.url !== WHOISLEUTH_SOURCE_REPOSITORY_GIT_URL
    || templateManifest.homepage !== WHOISLEUTH_PROJECT_URL
    || bugs.url !== WHOISLEUTH_SOURCE_ISSUES_URL
  ) {
    throw new TypeError('CLI package public links must match the shared project metadata.');
  }

  if (lockfile.lockfileVersion !== 3) throw new TypeError('Root package lockfile must use lockfile version 3.');
  if (
    lockfile.name !== rootManifest.name
    || lockRoot.name !== rootManifest.name
    || normalizeSemanticVersion(lockfile.version) !== packageVersion
    || normalizeSemanticVersion(lockRoot.version) !== packageVersion
  ) {
    throw new TypeError('Root package manifest and lockfile identity must match before CLI assembly.');
  }

  const selectedDependencies: Record<string, string> = {};
  for (const dependency of CLI_RUNTIME_DEPENDENCIES) {
    const requested = boundedString(rootDependencies[dependency], `Root dependency ${dependency}`, 128);
    if (lockRootDependencies[dependency] !== requested) {
      throw new TypeError(`Root dependency ${dependency} must match the lockfile request.`);
    }
    const lockedPackage = record(lockPackages[`node_modules/${dependency}`], `Locked dependency ${dependency}`);
    selectedDependencies[dependency] = normalizeSemanticVersion(lockedPackage.version);
  }

  const publicationEnabled = options.publicationEnabled === true;
  const generatedTemplate = { ...templateManifest };
  if (publicationEnabled) delete generatedTemplate.private;

  return {
    ...generatedTemplate,
    version: packageVersion,
    contentPolicy: { class: 'dual-use' },
    dependencies: selectedDependencies,
    files: [
      'bin/**/*.mjs',
      'cli/**/*.mjs',
      'lib/**/*.mjs',
      'frontend/src/lib/analysis/**/*.js',
      'docs/cli.md',
      'docs/cli-reference.md',
      'DISCLOSURE',
      'LICENSE',
      'LICENSES/*.txt',
      'NOTICE',
      'README.md',
      'SECURITY.md',
      'TRADEMARKS.md',
      'third-party-notices.txt',
    ],
    ...(publicationEnabled ? {
      publishConfig: {
        access: 'public',
        provenance: true,
      },
    } : {}),
  };
}

async function readBoundedJson(filename: string, maxBytes = MAX_CLI_PACKAGE_GRAPH_BYTES): Promise<unknown> {
  const metadata = await stat(filename);
  if (!metadata.isFile() || metadata.size > maxBytes) throw new TypeError(`${path.basename(filename)} is missing or exceeds its byte limit.`);
  try {
    return JSON.parse(await readFile(filename, 'utf8'));
  } catch {
    throw new TypeError(`${path.basename(filename)} is not valid JSON.`);
  }
}

async function dependencyGraph(repositoryRoot: string): Promise<unknown> {
  const executable = path.join(repositoryRoot, 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruise.mjs');
  const { stdout } = await execFile(process.execPath, [
    executable,
    '--config',
    path.join(repositoryRoot, '.dependency-cruiser.json'),
    '--output-type',
    'json',
    'bin/whoisleuth.mts',
  ], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: CLI_PACKAGE_LONG_PROCESS_TIMEOUT_MS,
    killSignal: 'SIGTERM',
    maxBuffer: MAX_CLI_PACKAGE_GRAPH_BYTES,
  });
  try {
    return JSON.parse(stdout);
  } catch {
    throw new TypeError('CLI dependency graph is not valid JSON.');
  }
}

async function copyPackageFile(repositoryRoot: string, stagingRoot: string, source: string, destination: string, state: { totalBytes: number }): Promise<void> {
  const safeSource = safeRelativePath(source, 'Package source');
  const safeDestination = safeRelativePath(destination, 'Package destination');
  const sourcePath = path.join(repositoryRoot, safeSource);
  const destinationPath = path.join(stagingRoot, safeDestination);
  const metadata = await stat(sourcePath);
  if (!metadata.isFile() || metadata.size > MAX_CLI_PACKAGE_FILE_BYTES) {
    throw new TypeError(`${safeSource} is missing or exceeds the per-file package limit.`);
  }
  state.totalBytes += metadata.size;
  if (state.totalBytes > MAX_CLI_PACKAGE_SOURCE_BYTES) throw new TypeError('CLI package sources exceed the aggregate byte limit.');
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await copyFile(sourcePath, destinationPath);
}

async function validatePackageSources(repositoryRoot: string, sources: readonly string[], state: { totalBytes: number }): Promise<void> {
  for (const source of sources) {
    const metadata = await stat(path.join(repositoryRoot, safeRelativePath(source, 'Package module source')));
    if (!metadata.isFile() || metadata.size > MAX_CLI_PACKAGE_FILE_BYTES) {
      throw new TypeError(`${source} is missing or exceeds the per-file package limit.`);
    }
    state.totalBytes += metadata.size;
    if (state.totalBytes > MAX_CLI_PACKAGE_SOURCE_BYTES) throw new TypeError('CLI package sources exceed the aggregate byte limit.');
  }
}

async function compilePackageSources(repositoryRoot: string, temporaryRoot: string, stagingRoot: string, sources: readonly string[]): Promise<void> {
  const configurationPath = path.join(temporaryRoot, 'tsconfig.cli-package.json');
  const configuration = {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      resolveJsonModule: true,
      rootDir: repositoryRoot,
      outDir: stagingRoot,
      allowImportingTsExtensions: true,
      rewriteRelativeImportExtensions: true,
      erasableSyntaxOnly: true,
      verbatimModuleSyntax: true,
      moduleDetection: 'force',
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      esModuleInterop: true,
      skipLibCheck: true,
      types: ['node'],
      typeRoots: [path.join(repositoryRoot, 'node_modules', '@types')],
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      declaration: false,
      sourceMap: false,
    },
    files: sources.map((source) => path.join(repositoryRoot, source)),
  };
  await writeFile(configurationPath, `${JSON.stringify(configuration, null, 2)}\n`, 'utf8');
  const compiler = path.join(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  try {
    await execFile(process.execPath, [compiler, '--project', configurationPath], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      timeout: CLI_PACKAGE_LONG_PROCESS_TIMEOUT_MS,
      killSignal: 'SIGTERM',
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    const commandError = error && typeof error === 'object' ? error as { stderr?: unknown; stdout?: unknown } : {};
    const output = [commandError.stderr, commandError.stdout]
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
      ?.trim()
      .slice(0, 4_000);
    throw new TypeError(`CLI TypeScript compilation failed${output ? `: ${output}` : '.'}`);
  }
  await chmod(path.join(stagingRoot, 'bin', 'whoisleuth.mjs'), 0o755);
}

function parsePackResult(value: unknown): JsonRecord {
  if (!Array.isArray(value) || value.length !== 1) throw new TypeError('npm pack must return exactly one package result.');
  return record(value[0], 'npm pack result');
}

function packedFiles(packResult: JsonRecord): readonly string[] {
  if (!Array.isArray(packResult.files) || packResult.files.length === 0 || packResult.files.length > MAX_CLI_PACKAGE_ENTRIES) {
    const observed = Array.isArray(packResult.files) ? packResult.files.length : 0;
    throw new TypeError(`Packed CLI contains ${observed} entries; expected between 1 and ${MAX_CLI_PACKAGE_ENTRIES}.`);
  }
  return Object.freeze(packResult.files.map((entry, index) => safeRelativePath(record(entry, `Packed entry ${index + 1}`).path, `Packed entry ${index + 1} path`)));
}

async function runInstalledCheck(executable: string, args: readonly string[], label: string): Promise<string> {
  const { stdout, stderr } = await execFile(process.execPath, [executable, ...args], {
    encoding: 'utf8',
    timeout: CLI_PACKAGE_INSTALLED_CHECK_TIMEOUT_MS,
    killSignal: 'SIGTERM',
    maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  if (stderr) throw new TypeError(`Installed CLI ${label} wrote unexpected diagnostics.`);
  return stdout;
}

export async function checkCliPackage(repositoryRoot: string, options: CliPackageOptions = {}): Promise<CliPackageReport> {
  const publicationEnabled = options.publicationEnabled === true;
  if (publicationEnabled && (!options.artifactDirectory || !options.expectedTag)) {
    throw new TypeError('Release-candidate assembly requires an artefact directory and expected semantic tag.');
  }
  if (!publicationEnabled && (options.artifactDirectory || options.expectedTag)) {
    throw new TypeError('Artefact output and tag validation are available only for release-candidate assembly.');
  }
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'whoisleuth-cli-package-'));
  const stagingRoot = path.join(temporaryRoot, 'staging');
  const artifactsRoot = path.join(temporaryRoot, 'artifacts');
  const installRoot = path.join(temporaryRoot, 'install');
  try {
    await Promise.all([mkdir(stagingRoot, { recursive: true }), mkdir(artifactsRoot, { recursive: true }), mkdir(installRoot, { recursive: true })]);
    const [graph, rootManifest, templateManifest, lockfile] = await Promise.all([
      dependencyGraph(repositoryRoot),
      readBoundedJson(path.join(repositoryRoot, 'package.json')),
      readBoundedJson(path.join(repositoryRoot, 'packages', 'cli', 'package.template.json')),
      readBoundedJson(path.join(repositoryRoot, 'package-lock.json')),
    ]);
    const sources = selectCliPackageSources(graph);
    const manifest = buildCliPackageManifest(rootManifest, templateManifest, lockfile, { publicationEnabled });
    const copyState = { totalBytes: 0 };
    await validatePackageSources(repositoryRoot, sources, copyState);
    await compilePackageSources(repositoryRoot, temporaryRoot, stagingRoot, sources);
    for (const [source, destination] of SUPPORT_FILES) await copyPackageFile(repositoryRoot, stagingRoot, source, destination, copyState);
    const cliNotices = await buildThirdPartyNotices(repositoryRoot, {
      directDependencyNames: CLI_RUNTIME_DEPENDENCIES,
      scopeLabel: 'CLI',
    });
    const cliNoticeBytes = Buffer.byteLength(cliNotices, 'utf8');
    if (cliNoticeBytes > MAX_CLI_PACKAGE_FILE_BYTES || copyState.totalBytes + cliNoticeBytes > MAX_CLI_PACKAGE_SOURCE_BYTES) {
      throw new TypeError('Generated CLI third-party notices exceed the package source boundary.');
    }
    copyState.totalBytes += cliNoticeBytes;
    await writeFile(path.join(stagingRoot, 'third-party-notices.txt'), cliNotices, { encoding: 'utf8', mode: 0o644 });
    await writeFile(path.join(stagingRoot, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o644 });

    const npmCache = path.join(temporaryRoot, 'npm-cache');
    const commonEnvironment = {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_cache: npmCache,
      npm_config_fund: 'false',
      npm_config_ignore_scripts: 'true',
    };
    const { stdout: packOutput } = await execFile('npm', ['pack', '--json', '--pack-destination', artifactsRoot], {
      cwd: stagingRoot,
      encoding: 'utf8',
      timeout: CLI_PACKAGE_LONG_PROCESS_TIMEOUT_MS,
      killSignal: 'SIGTERM',
      maxBuffer: 4 * 1024 * 1024,
      env: commonEnvironment,
    });
    const packResult = parsePackResult(JSON.parse(packOutput));
    const entries = packedFiles(packResult);
    const packedBytes = positiveInteger(packResult.size, 'Packed CLI bytes', MAX_CLI_PACKAGE_PACKED_BYTES);
    const unpackedBytes = positiveInteger(packResult.unpackedSize, 'Unpacked CLI bytes', MAX_CLI_PACKAGE_UNPACKED_BYTES);
    const filename = safeRelativePath(packResult.filename, 'Packed CLI filename');
    const tarball = path.join(artifactsRoot, filename);
    const requiredEntries = [
      'bin/whoisleuth.mjs',
      'cli/runner.mjs',
      'package.json',
      'third-party-notices.txt',
      ...SUPPORT_FILES.map(([, destination]) => destination),
    ];
    for (const required of requiredEntries) {
      if (!entries.includes(required)) throw new TypeError(`Packed CLI is missing ${required}.`);
    }
    if (entries.some((entry) => /^(?:e2e|netlify|test|tools|frontend\/src\/routes)(?:\/|$)/u.test(entry))) {
      throw new TypeError('Packed CLI contains an excluded application or test path.');
    }
    if (entries.some((entry) => /\.(?:[cm]?ts|svelte|map)$/u.test(entry))) {
      throw new TypeError('Packed CLI contains source or source-map files instead of compiled runtime files.');
    }

    await writeFile(path.join(installRoot, 'package.json'), '{"private":true}\n', 'utf8');
    await execFile('npm', ['install', '--package-lock=false', '--ignore-scripts', '--no-audit', '--no-fund', tarball], {
      cwd: installRoot,
      encoding: 'utf8',
      timeout: CLI_PACKAGE_LONG_PROCESS_TIMEOUT_MS,
      killSignal: 'SIGTERM',
      maxBuffer: 4 * 1024 * 1024,
      env: commonEnvironment,
    });
    const packageName = boundedString(manifest.name, 'Generated package name', 128);
    const packageVersion = boundedString(manifest.version, 'Generated package version', 128);
    if (publicationEnabled && options.expectedTag !== `v${packageVersion}`) {
      throw new TypeError(`Release-candidate tag must equal v${packageVersion}.`);
    }
    const executable = path.join(installRoot, 'node_modules', ...packageName.split('/'), 'bin', 'whoisleuth.mjs');
    const installedManifest = record(await readBoundedJson(path.join(path.dirname(executable), '..', 'package.json')), 'Installed package manifest');
    if (
      installedManifest.name !== packageName
      || installedManifest.version !== packageVersion
      || installedManifest.license !== 'AGPL-3.0-only'
      || installedManifest.author !== 'slicedearth'
    ) {
      throw new TypeError('Installed CLI identity metadata does not match the reviewed package contract.');
    }
    const installedBin = record(installedManifest.bin, 'Installed CLI executable mapping');
    const installedEngines = record(installedManifest.engines, 'Installed CLI engine requirement');
    if (installedBin.whoisleuth !== 'bin/whoisleuth.mjs' || Object.keys(installedBin).length !== 1 || installedEngines.node !== '>=24') {
      throw new TypeError('Installed CLI executable or runtime boundary does not match the reviewed package contract.');
    }
    const installedContentPolicy = record(installedManifest.contentPolicy, 'Installed package content policy');
    if (installedContentPolicy.class !== 'dual-use' || Object.keys(installedContentPolicy).length !== 1) {
      throw new TypeError('Installed CLI does not retain the dual-use content declaration.');
    }
    for (const field of ['scripts', 'main', 'module', 'exports', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      if (Object.hasOwn(installedManifest, field)) throw new TypeError(`Installed CLI must not declare ${field}.`);
    }
    const installedDependencies = record(installedManifest.dependencies, 'Installed CLI dependencies');
    const generatedDependencies = record(manifest.dependencies, 'Generated CLI dependencies');
    if (Object.keys(installedDependencies).length !== CLI_RUNTIME_DEPENDENCIES.length) {
      throw new TypeError('Installed CLI must retain only the bounded runtime dependencies.');
    }
    for (const dependency of CLI_RUNTIME_DEPENDENCIES) {
      if (installedDependencies[dependency] !== generatedDependencies[dependency]) {
        throw new TypeError(`Installed CLI dependency ${dependency} does not match the generated exact version.`);
      }
    }
    const runtimeDependencies = Object.freeze(Object.fromEntries(
      CLI_RUNTIME_DEPENDENCIES.map((dependency) => [
        dependency,
        boundedString(generatedDependencies[dependency], `Generated CLI dependency ${dependency}`, 128),
      ]),
    ));
    if (publicationEnabled) {
      const publishConfig = record(installedManifest.publishConfig, 'Installed package publishConfig');
      if (Object.hasOwn(installedManifest, 'private') || publishConfig.access !== 'public' || publishConfig.provenance !== true) {
        throw new TypeError('Installed release candidate does not retain the public provenance contract.');
      }
    } else if (installedManifest.private !== true || Object.hasOwn(installedManifest, 'publishConfig')) {
      throw new TypeError('Installed package check does not retain its private publication boundary.');
    }
    const help = await runInstalledCheck(executable, ['--help'], 'help');
    if (!help.startsWith('WHOISleuth CLI\n') || !help.includes('Fast lookup is the default; deep collection')) throw new TypeError('Installed CLI help contract failed.');
    const version = await runInstalledCheck(executable, ['--version'], 'version');
    if (version !== `${packageVersion}\n`) throw new TypeError('Installed CLI version does not match the generated package manifest.');
    const doctor = await runInstalledCheck(executable, ['doctor', '--json'], 'doctor');
    const doctorDocument = record(JSON.parse(doctor), 'Installed doctor output');
    if (doctorDocument.schema !== 'whoisleuth.cli.doctor' || doctorDocument.networkRequested !== false) {
      throw new TypeError('Installed offline doctor command returned the wrong contract.');
    }
    const commands = await runInstalledCheck(executable, ['commands', '--json'], 'commands');
    const commandCatalogue = record(JSON.parse(commands), 'Installed command catalogue');
    if (commandCatalogue.schema !== 'whoisleuth.cli.command-catalogue' || !Array.isArray(commandCatalogue.commands)) {
      throw new TypeError('Installed command catalogue returned the wrong contract.');
    }
    const lookupPlan = await runInstalledCheck(executable, ['lookup', 'example.test', '--deep', '--plan', '--json'], 'lookup plan');
    const lookupPlanDocument = record(JSON.parse(lookupPlan), 'Installed Lookup plan');
    if (lookupPlanDocument.schema !== 'whoisleuth.cli.lookup-plan'
      || record(lookupPlanDocument.planning, 'Installed Lookup plan collection').networkRequestsMade !== false) {
      throw new TypeError('Installed offline Lookup plan returned the wrong contract.');
    }
    const completion = await runInstalledCheck(executable, ['completion', 'bash'], 'completion');
    if (!completion.includes('complete -F _whoisleuth_completion whoisleuth')) {
      throw new TypeError('Installed bash completion command returned the wrong script.');
    }
    const manual = await runInstalledCheck(executable, ['manual'], 'manual');
    if (!manual.startsWith('.TH WHOISLEUTH 1') || !manual.includes('.SS diff')) {
      throw new TypeError('Installed CLI manual command returned the wrong document.');
    }
    const registrySupport = await runInstalledCheck(executable, ['registry-support', 'example.test', '--json'], 'registry-support');
    const registryDocument = record(JSON.parse(registrySupport), 'Installed registry-support output');
    if (registryDocument.schema !== 'whoisleuth.cli.registry-support') throw new TypeError('Installed offline registry-support command returned the wrong schema.');
    const discovery = await runInstalledCheck(executable, [
      'discover',
      'example.test',
      '--families',
      'character_omission',
      '--tlds',
      'test',
      '--json',
    ], 'discover');
    const discoveryDocument = record(JSON.parse(discovery), 'Installed discover output');
    if (discoveryDocument.schema !== 'whoisleuth.cli.discover') throw new TypeError('Installed offline discover command returned the wrong schema.');
    if (!Array.isArray(discoveryDocument.candidates) || discoveryDocument.candidates.length === 0) {
      throw new TypeError('Installed offline discover command returned no candidates.');
    }
    const discoveryScanHelp = await runInstalledCheck(executable, ['discover-scan', '--help'], 'discover-scan help');
    if (!discoveryScanHelp.includes('whoisleuth discover-scan') || !discoveryScanHelp.includes('This command performs network collection.')) {
      throw new TypeError('Installed discover-scan help did not preserve its explicit network boundary.');
    }

    const commandHelpChecks: string[] = [];
    const catalogueCommands = commandCatalogue.commands.map((entry, index) => boundedString(
      record(entry, `Installed command catalogue entry ${index + 1}`).command,
      `Installed command catalogue entry ${index + 1} command`,
      80,
    ));
    if (!catalogueCommands.length || catalogueCommands.length > 100 || new Set(catalogueCommands).size !== catalogueCommands.length) {
      throw new TypeError('Installed command catalogue must contain a bounded unique command list.');
    }
    for (const command of catalogueCommands) {
      const commandHelp = await runInstalledCheck(executable, [command, '--help'], `${command} help`);
      if (!commandHelp.includes(`whoisleuth ${command}`)) {
        throw new TypeError(`Installed ${command} help did not preserve its command contract.`);
      }
      commandHelpChecks.push(`${command}-help`);
    }

    let archiveFilename: string | null = null;
    let archiveSha256: string | null = null;
    if (publicationEnabled) {
      const artifactDirectory = path.resolve(options.artifactDirectory as string);
      await mkdir(artifactDirectory, { recursive: true });
      archiveFilename = `whoisleuth-cli-${packageVersion}.tgz`;
      const archivePath = path.join(artifactDirectory, archiveFilename);
      await copyFile(tarball, archivePath, fsConstants.COPYFILE_EXCL);
      archiveSha256 = createHash('sha256').update(await readFile(tarball)).digest('hex');
      await writeFile(path.join(artifactDirectory, `${archiveFilename}.sha256`), `${archiveSha256}  ${archiveFilename}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o644 });
    }

    const report = Object.freeze({
      schema: CLI_PACKAGE_REPORT_SCHEMA,
      version: CLI_PACKAGE_REPORT_VERSION,
      packageName,
      packageVersion,
      sourceModuleCount: sources.length,
      packedEntryCount: entries.length,
      packedBytes,
      unpackedBytes,
      runtimeDependencies,
      installedChecks: Object.freeze([
        'help',
        'version',
        'doctor',
        'commands',
        'lookup-plan',
        'completion',
        'manual',
        'registry-support',
        'discover',
        'discover-scan-network-boundary',
        ...commandHelpChecks,
      ]),
      publicationEnabled,
      archiveFilename,
      archiveSha256,
    });
    if (publicationEnabled) {
      const artifactDirectory = path.resolve(options.artifactDirectory as string);
      await writeFile(path.join(artifactDirectory, 'cli-package-report.json'), `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o644 });
    }
    return report;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

export function formatCliPackageReport(report: CliPackageReport): string {
  return [
    'WHOISleuth scoped CLI package check',
    `Package: ${report.packageName}@${report.packageVersion}`,
    `Dependency-closure modules: ${report.sourceModuleCount}`,
    `Packed entries: ${report.packedEntryCount}`,
    `Archive bytes: ${report.packedBytes} packed / ${report.unpackedBytes} unpacked`,
    `Runtime dependencies: ${Object.entries(report.runtimeDependencies).map(([name, version]) => `${name}@${version}`).join(', ')}`,
    `Installed checks: ${report.installedChecks.join(', ')}`,
    ...(report.publicationEnabled
      ? [
          'Publication candidate: enabled',
          `Archive: ${report.archiveFilename}`,
          `SHA-256: ${report.archiveSha256}`,
          'Registry action: not performed',
        ]
      : ['Publication: disabled']),
  ].join('\n');
}

export function parseArguments(args: readonly string[]): ParsedArguments {
  if (args.length === 0) return { json: false, publicationEnabled: false };
  if (args.length === 1 && args[0] === '--json') return { json: true, publicationEnabled: false };

  let json = false;
  let artifactDirectory: string | undefined;
  let expectedTag: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--json' && !json) {
      json = true;
      continue;
    }
    if (argument === '--release-candidate' && artifactDirectory === undefined) {
      artifactDirectory = args[index + 1];
      index += 1;
      continue;
    }
    if (argument === '--tag' && expectedTag === undefined) {
      expectedTag = args[index + 1];
      index += 1;
      continue;
    }
    throw new TypeError('Usage: node tools/cli-package.mts [--json] | --release-candidate <directory> --tag <vX.Y.Z> [--json]');
  }
  if (!artifactDirectory || artifactDirectory.length > 1_024 || !expectedTag || expectedTag.length > 129) {
    throw new TypeError('Usage: node tools/cli-package.mts [--json] | --release-candidate <directory> --tag <vX.Y.Z> [--json]');
  }
  return { json, publicationEnabled: true, artifactDirectory, expectedTag };
}

export async function main(args = process.argv.slice(2), options: MainOptions = {}): Promise<number> {
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;
  try {
    const parsed = parseArguments(args);
    const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
    const report = await checkCliPackage(repositoryRoot, {
      publicationEnabled: parsed.publicationEnabled,
      ...(parsed.artifactDirectory ? { artifactDirectory: parsed.artifactDirectory } : {}),
      ...(parsed.expectedTag ? { expectedTag: parsed.expectedTag } : {}),
    });
    stdout.write(`${parsed.json ? JSON.stringify(report, null, 2) : formatCliPackageReport(report)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : 'CLI package check failed.'}\n`);
    return 2;
  }
}

const invokedAsScript = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedAsScript) process.exitCode = await main();
