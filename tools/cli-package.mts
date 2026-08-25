#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  WHOISLEUTH_PROJECT_URL,
  WHOISLEUTH_SOURCE_ISSUES_URL,
  WHOISLEUTH_SOURCE_REPOSITORY_GIT_URL,
} from '../lib/project-metadata.mts';
import { scanBoundedJson } from '../lib/bounded-json.mts';
import {
  readBoundedRegularFile,
  readBoundedRegularFileWithin,
} from '../lib/bounded-file.mts';
import { normalizeSemanticVersion } from './release-version-check.mts';
import { buildThirdPartyNotices } from './third-party-notices.mts';
import {
  boundedPositiveInteger as positiveInteger,
  requireJsonRecord as record,
} from './maintainer-tool-helpers.mts';
import {
  CLI_COMMAND_REGISTRY,
  CLI_COMMANDS,
  type CliHandlerOwner,
} from '../cli/command-reference.mts';

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
type CliPackageSourceIdentity = Readonly<{ bytes: Buffer; digestSha256: string }>;
export type CliPackageSourceSnapshot = ReadonlyMap<string, CliPackageSourceIdentity>;
type CliPackageSnapshotState = {
  totalBytes: number;
  maximumBytes?: number;
  maximumFileBytes?: number;
};
type CliPackageCompilerClosure = Readonly<{
  sources: readonly string[];
  contextFiles: readonly string[];
}>;

const execFile = promisify(execFileCallback);

export const CLI_PACKAGE_REPORT_SCHEMA = 'whoisleuth.cli-package-check';
export const CLI_PACKAGE_REPORT_VERSION = 3;
export const MAX_CLI_PACKAGE_GRAPH_BYTES = 8 * 1024 * 1024;
// The executable dependency graph remains independently capped with bounded
// headroom for canonical domain owners. Two browser-safe domain-control paths
// remain explicit package roots because released CLI archives permitted those
// deep imports.
export const MAX_CLI_RUNTIME_MODULES = 320;
export const MAX_CLI_PACKAGE_MODULES = 322;
// Type-only and JSON compiler inputs are captured in addition to the runtime
// dependency graph. They may emit no runtime code, but they remain bounded
// because TypeScript reads them while producing the candidate.
export const MAX_CLI_PACKAGE_COMPILER_SOURCES = 312;
export const MAX_CLI_PACKAGE_SOURCE_BYTES = 8 * 1024 * 1024;
export const MAX_CLI_PACKAGE_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_CLI_PACKAGE_COMPILER_CONTEXT_BYTES = 32 * 1024 * 1024;
export const MAX_CLI_PACKAGE_COMPILER_CONTEXT_FILE_BYTES = 8 * 1024 * 1024;
// Keep the reviewed shared-domain package closure exact; packed and unpacked
// byte ceilings remain independent controls.
export const MAX_CLI_PACKAGE_ENTRIES = 320;
export const MAX_CLI_PACKAGE_PACKED_BYTES = 2 * 1024 * 1024;
export const MAX_CLI_PACKAGE_UNPACKED_BYTES = 6 * 1024 * 1024;
export const MAX_CLI_PACKAGE_INSTALLED_CHECKS = 80;
export const CLI_PACKAGE_LONG_PROCESS_TIMEOUT_MS = 120_000;
export const CLI_PACKAGE_INSTALLED_CHECK_TIMEOUT_MS = 15_000;

const LOCAL_SOURCE_PATTERN = /^(?:bin|cli|lib|frontend\/src\/lib|packages\/(?:cases|comparison|contracts|evidence|interchange|investigation|monitoring|workspace))\/[A-Za-z0-9._/-]+\.(?:mts|ts|json)$/u;
const COMPILABLE_SOURCE_PATTERN = /\.(?:mts|ts)$/u;
const CLI_RUNTIME_ENTRY_MODULES = Object.freeze(['bin/whoisleuth.mts', 'cli/runner.mts']);
const CLI_COMPATIBILITY_ENTRY_MODULES = Object.freeze([
  'frontend/src/lib/analysis/domain-control-manifest-core.ts',
  'frontend/src/lib/analysis/domain-control-records.ts',
]);
const INSTALLED_COMPATIBILITY_FACADES = Object.freeze([
  Object.freeze({
    path: 'frontend/src/lib/analysis/domain-control-manifest-core.js',
    owner: '../../../../packages/evidence/domain-control-runtime.mjs',
    exports: Object.freeze([
      'DOMAIN_CONTROL_MANIFEST_VERSION',
      'DOMAIN_CONTROL_PASSPORT_INPUT_SCHEMA',
      'DOMAIN_CONTROL_PASSPORT_LIMITATIONS',
      'DOMAIN_CONTROL_PASSPORT_SCHEMA',
      'DOMAIN_CONTROL_PASSPORT_VERSION',
      'MAX_DOMAIN_CONTROL_MANIFEST_BYTES',
      'MAX_DOMAIN_CONTROL_PASSPORT_BYTES',
      'MAX_DOMAIN_CONTROL_PASSPORT_ENTRIES',
      'assertDomainControlPassportByteBudget',
      'buildUnsignedDomainControlPassport',
      'domainControlPassportSerialisedBytes',
      'normalizeDomainControlPassportDocument',
    ]),
  }),
  Object.freeze({
    path: 'frontend/src/lib/analysis/domain-control-records.js',
    owner: '../../../../packages/evidence/domain-control-runtime.mjs',
    exports: Object.freeze([
      'MAX_CANONICAL_DOMAIN_CONTROL_RECORDS',
      'canonicalCaaRecord',
      'canonicalDomainControlRecordList',
      'canonicalDsRecord',
      'canonicalMxRecord',
    ]),
  }),
]);
const CLI_PACKAGE_ENTRY_MODULES = Object.freeze([
  ...CLI_RUNTIME_ENTRY_MODULES,
  ...CLI_COMPATIBILITY_ENTRY_MODULES,
]);
const INSTALLED_HANDLER_MODULES: Readonly<Record<Exclude<CliHandlerOwner, 'inline'>, Readonly<{
  source: string;
  exportName: string;
}>>> = Object.freeze({
  bulk: Object.freeze({ source: 'cli/bulk-command-runner.mjs', exportName: 'runBulkCommand' }),
  discovery: Object.freeze({ source: 'cli/discovery-command-runner.mjs', exportName: 'runDiscoveryCommand' }),
  discovery_scan: Object.freeze({ source: 'cli/discovery-scan-command-runner.mjs', exportName: 'runDiscoveryScanCommand' }),
  evidence: Object.freeze({ source: 'cli/evidence-command-runner.mjs', exportName: 'runEvidenceCommand' }),
  lookup: Object.freeze({ source: 'cli/lookup-command-runner.mjs', exportName: 'runLookupCommand' }),
  network: Object.freeze({ source: 'cli/network-command-runner.mjs', exportName: 'runNetworkCommand' }),
});
const TYPESCRIPT_COMPILER_SOURCE = 'node_modules/typescript/lib/_tsc.js';
const NODE_MODULE_COMPILER_INPUT_SEGMENT_PATTERN = /^@?[A-Za-z0-9._-]+$/u;
const NODE_MODULE_COMPILER_INPUT_SUFFIXES = Object.freeze([
  '.d.cts',
  '.d.mts',
  '.d.ts',
  '.cts',
  '.mts',
  '.ts',
  '.json',
]);
const MAX_NODE_MODULE_COMPILER_INPUT_PATH_LENGTH = 4_096;
export const CLI_RUNTIME_DEPENDENCIES = Object.freeze([
  '@peculiar/x509',
  'maxmind',
  'parse5',
  'reflect-metadata',
  'tldts',
  'undici',
]);
export const CLI_PACKAGE_SUPPORT_FILES = Object.freeze([
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
const CLI_PACKAGE_COMPILER_CONTEXT_FILES = Object.freeze([
  'frontend/package.json',
]);

export function isCliPackageCompilerInputPath(relativePath: string): boolean {
  if (
    relativePath.length === 0
    || relativePath.length > MAX_NODE_MODULE_COMPILER_INPUT_PATH_LENGTH
    || !relativePath.startsWith('node_modules/')
  ) return false;
  const segments = relativePath.split('/');
  if (segments.length < 3 || segments[0] !== 'node_modules') return false;
  for (const segment of segments.slice(1)) {
    if (
      segment.length === 0
      || segment.length > 255
      || segment === '.'
      || segment === '..'
      || !NODE_MODULE_COMPILER_INPUT_SEGMENT_PATTERN.test(segment)
    ) return false;
  }
  const fileName = segments.at(-1) ?? '';
  return NODE_MODULE_COMPILER_INPUT_SUFFIXES.some((suffix) => (
    fileName.length > suffix.length && fileName.endsWith(suffix)
  ));
}

function cliPackageProcessEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const environment = { ...process.env, ...overrides };
  delete environment.NODE_OPTIONS;
  delete environment.NODE_PATH;
  return environment;
}

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

export function selectCliPackageSources(
  graphValue: unknown,
  options: Readonly<{
    maximumModules?: number;
    requiredSources?: readonly string[];
  }> = {},
): readonly string[] {
  const graph = record(graphValue, 'Dependency graph');
  const maximumModules = options.maximumModules ?? MAX_CLI_RUNTIME_MODULES;
  const requiredSources = options.requiredSources ?? CLI_RUNTIME_ENTRY_MODULES;
  if (!Number.isSafeInteger(maximumModules) || maximumModules < 1 || maximumModules > MAX_CLI_PACKAGE_MODULES) {
    throw new TypeError('Dependency graph module ceiling is invalid.');
  }
  if (!Array.isArray(graph.modules) || graph.modules.length === 0 || graph.modules.length > maximumModules) {
    throw new TypeError(`Dependency graph must contain between 1 and ${maximumModules} modules.`);
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

  for (const required of requiredSources) {
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
      'frontend/src/lib/**/*.js',
      'packages/cases/**/*.mjs',
      'packages/comparison/**/*.mjs',
      'packages/contracts/**/*.mjs',
      'packages/evidence/**/*.mjs',
      'packages/interchange/**/*.mjs',
      'packages/investigation/**/*.mjs',
      'packages/monitoring/**/*.mjs',
      'packages/workspace/**/*.mjs',
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

function parseBoundedJsonBytes(bytes: Buffer, label: string): unknown {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new TypeError(`${label} is not valid UTF-8 JSON.`);
  }
  try {
    scanBoundedJson(text);
    return JSON.parse(text);
  } catch {
    throw new TypeError(`${label} is not valid bounded JSON.`);
  }
}

async function readBoundedJson(filename: string, maxBytes = MAX_CLI_PACKAGE_GRAPH_BYTES): Promise<unknown> {
  const bytes = await readBoundedRegularFile(filename, {
    maximumBytes: maxBytes,
    minimumBytes: 1,
    label: path.basename(filename),
  });
  return parseBoundedJsonBytes(bytes, path.basename(filename));
}

async function dependencyGraph(repositoryRoot: string, entrySources: readonly string[]): Promise<unknown> {
  const executable = path.join(repositoryRoot, 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruise.mjs');
  const { stdout } = await execFile(process.execPath, [
    executable,
    '--config',
    path.join(repositoryRoot, '.dependency-cruiser.json'),
    '--output-type',
    'json',
    ...entrySources,
  ], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: CLI_PACKAGE_LONG_PROCESS_TIMEOUT_MS,
    killSignal: 'SIGTERM',
    maxBuffer: MAX_CLI_PACKAGE_GRAPH_BYTES,
    env: cliPackageProcessEnvironment({ NODE_ENV: 'production' }),
  });
  try {
    scanBoundedJson(stdout);
    return JSON.parse(stdout);
  } catch {
    throw new TypeError('CLI dependency graph is not valid JSON.');
  }
}

async function copyPackageFile(stagingRoot: string, destination: string, bytes: Buffer): Promise<void> {
  const safeDestination = safeRelativePath(destination, 'Package destination');
  const destinationPath = path.join(stagingRoot, safeDestination);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await writeFile(destinationPath, bytes, { flag: 'wx', mode: 0o644 });
}

async function assertInstalledCompatibilityFacade(
  installedPackageRoot: string,
  contract: typeof INSTALLED_COMPATIBILITY_FACADES[number],
): Promise<void> {
  const bytes = await readBoundedRegularFileWithin(installedPackageRoot, contract.path, {
    maximumBytes: 16 * 1024,
    minimumBytes: 1,
    label: contract.path,
  });
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new TypeError(`Installed compatibility facade ${contract.path} is not valid UTF-8.`);
  }
  const ts = (await import('typescript')).default;
  const sourceFile = ts.createSourceFile(contract.path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const statement = sourceFile.statements.length === 1 ? sourceFile.statements[0] : null;
  if (!statement
    || !ts.isExportDeclaration(statement)
    || statement.isTypeOnly
    || !statement.exportClause
    || !ts.isNamedExports(statement.exportClause)
    || !statement.moduleSpecifier
    || !ts.isStringLiteral(statement.moduleSpecifier)
    || statement.moduleSpecifier.text !== contract.owner) {
    throw new TypeError(`Installed compatibility facade ${contract.path} must be one pure named re-export from its canonical owner.`);
  }
  const exported = statement.exportClause.elements.map((element) => {
    if (element.isTypeOnly || element.propertyName) {
      throw new TypeError(`Installed compatibility facade ${contract.path} must not rename or type-erase runtime exports.`);
    }
    return element.name.text;
  }).sort();
  if (exported.length !== contract.exports.length
    || exported.some((name, index) => name !== [...contract.exports].sort()[index])) {
    throw new TypeError(`Installed compatibility facade ${contract.path} changed its released runtime exports.`);
  }
}

export async function captureCliPackageSourceSnapshot(
  repositoryRoot: string,
  sources: readonly string[],
  state?: CliPackageSnapshotState,
): Promise<CliPackageSourceSnapshot> {
  const snapshot = new Map<string, CliPackageSourceIdentity>();
  const maximumFileBytes = state?.maximumFileBytes ?? MAX_CLI_PACKAGE_FILE_BYTES;
  const maximumBytes = state?.maximumBytes ?? MAX_CLI_PACKAGE_SOURCE_BYTES;
  for (const source of sources) {
    const safeSource = safeRelativePath(source, 'Package source');
    const bytes = await readBoundedRegularFileWithin(repositoryRoot, safeSource, {
      maximumBytes: maximumFileBytes,
      minimumBytes: 1,
      label: safeSource,
    });
    if (state) {
      state.totalBytes += bytes.byteLength;
      if (state.totalBytes > maximumBytes) {
        throw new TypeError('CLI package sources exceed the aggregate byte limit.');
      }
    }
    snapshot.set(safeSource, Object.freeze({
      bytes,
      digestSha256: createHash('sha256').update(bytes).digest('hex'),
    }));
  }
  return snapshot;
}

export async function assertCliPackageSourceSnapshot(
  repositoryRoot: string,
  snapshot: CliPackageSourceSnapshot,
  maximumFileBytes = MAX_CLI_PACKAGE_FILE_BYTES,
): Promise<void> {
  for (const [source, identity] of snapshot) {
    let bytes: Buffer;
    try {
      bytes = await readBoundedRegularFileWithin(repositoryRoot, source, {
        maximumBytes: maximumFileBytes,
        minimumBytes: 1,
        expectedBytes: identity.bytes.byteLength,
        label: source,
      });
    } catch (cause) {
      throw new TypeError(`${source} changed during CLI package assembly.`, { cause });
    }
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== identity.digestSha256) {
      throw new TypeError(`${source} changed during CLI package assembly.`);
    }
  }
}

function snapshotBytes(snapshot: CliPackageSourceSnapshot, source: string): Buffer {
  const identity = snapshot.get(source);
  if (!identity) throw new TypeError(`CLI package snapshot is missing ${source}.`);
  return identity.bytes;
}

export async function materializeCliPackageSourceSnapshot(
  sourceRoot: string,
  snapshot: CliPackageSourceSnapshot,
): Promise<void> {
  for (const [source, identity] of snapshot) {
    await copyPackageFile(sourceRoot, source, identity.bytes);
  }
}

function packageCompilerOptions(repositoryRoot: string, rootDirectory: string, outputDirectory: string) {
  return {
    target: 'ES2022',
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    resolveJsonModule: true,
    rootDir: rootDirectory,
    outDir: outputDirectory,
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
  };
}

function compilerPackageManifests(relativePath: string): readonly string[] {
  const segments = relativePath.split('/');
  const manifests = new Set<string>();
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (segments[index] !== 'node_modules') continue;
    const first = segments[index + 1];
    if (!first) continue;
    const packageEnd = first.startsWith('@') ? index + 3 : index + 2;
    if (packageEnd > segments.length - 1) continue;
    manifests.add(`${segments.slice(0, packageEnd).join('/')}/package.json`);
  }
  return Object.freeze([...manifests].sort());
}

async function cliPackageCompilerSourceClosure(
  inputRoot: string,
  temporaryRoot: string,
  entrySources: readonly string[],
): Promise<CliPackageCompilerClosure> {
  const canonicalInputRoot = await realpath(inputRoot);
  const configurationPath = path.join(temporaryRoot, 'tsconfig.cli-package-closure.json');
  const configuration = {
    compilerOptions: packageCompilerOptions(
      canonicalInputRoot,
      canonicalInputRoot,
      path.join(temporaryRoot, 'closure-output'),
    ),
    files: entrySources
      .filter((source) => COMPILABLE_SOURCE_PATTERN.test(source))
      .map((source) => path.join(canonicalInputRoot, source)),
  };
  await writeFile(configurationPath, `${JSON.stringify(configuration, null, 2)}\n`, 'utf8');
  const compiler = path.join(canonicalInputRoot, TYPESCRIPT_COMPILER_SOURCE);
  let stdout = '';
  try {
    ({ stdout } = await execFile(process.execPath, [
      compiler,
      '--project',
      configurationPath,
      '--listFilesOnly',
      '--pretty',
      'false',
    ], {
      cwd: canonicalInputRoot,
      encoding: 'utf8',
      timeout: CLI_PACKAGE_LONG_PROCESS_TIMEOUT_MS,
      killSignal: 'SIGTERM',
      maxBuffer: MAX_CLI_PACKAGE_GRAPH_BYTES,
      env: cliPackageProcessEnvironment({ NODE_ENV: 'production' }),
    }));
  } catch (error) {
    const commandError = error && typeof error === 'object' ? error as { stderr?: unknown; stdout?: unknown } : {};
    const output = [commandError.stderr, commandError.stdout]
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
      ?.trim()
      .slice(0, 4_000);
    throw new TypeError(`CLI TypeScript source-closure discovery failed${output ? `: ${output}` : '.'}`);
  }
  const selected = new Set(entrySources);
  const contextFiles = new Set<string>([
    TYPESCRIPT_COMPILER_SOURCE,
    'node_modules/typescript/package.json',
  ]);
  for (const line of stdout.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    const relative = path.relative(canonicalInputRoot, path.resolve(canonicalInputRoot, line.trim())).split(path.sep).join('/');
    if (!relative || relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) {
      throw new TypeError(`CLI compiler source closure escaped its configured input root at ${path.basename(line.trim()).slice(0, 160)}.`);
    }
    if (LOCAL_SOURCE_PATTERN.test(relative)) {
      selected.add(relative);
      continue;
    }
    if (CLI_PACKAGE_COMPILER_CONTEXT_FILES.includes(relative as never) || relative === 'package.json') continue;
    if (!isCliPackageCompilerInputPath(relative)) {
      throw new TypeError(`CLI compiler source closure contains unsupported input ${relative}.`);
    }
    contextFiles.add(relative);
    for (const manifest of compilerPackageManifests(relative)) contextFiles.add(manifest);
  }
  if (selected.size > MAX_CLI_PACKAGE_COMPILER_SOURCES) {
    throw new TypeError(`CLI compiler source closure contains ${selected.size} modules; expected at most ${MAX_CLI_PACKAGE_COMPILER_SOURCES}.`);
  }
  return Object.freeze({
    sources: Object.freeze([...selected].sort()),
    contextFiles: Object.freeze([...contextFiles].sort()),
  });
}

export function selectMaterializedCliPackageSources(
  runtimeSources: readonly string[],
  materializedSources: readonly string[],
): readonly string[] {
  const selected = new Set(materializedSources);
  for (const source of runtimeSources) {
    if (!selected.has(source)) {
      throw new TypeError(`CLI dependency graph source ${source} is not reachable from the materialized entrypoint closure.`);
    }
  }
  return Object.freeze([...selected].sort());
}

export async function compilePackageSources(
  repositoryRoot: string,
  temporaryRoot: string,
  stagingRoot: string,
  sourceRoot: string,
  entrySources: readonly string[],
  options: Readonly<{ compilerRoot?: string; dependencyRoot?: string }> = {},
): Promise<void> {
  const compilerRoot = options.compilerRoot ?? repositoryRoot;
  const dependencyRoot = options.dependencyRoot ?? repositoryRoot;
  if (dependencyRoot !== sourceRoot) {
    const dependencyLink = path.join(sourceRoot, 'node_modules');
    try {
      await symlink(
        path.join(dependencyRoot, 'node_modules'),
        dependencyLink,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  const configurationPath = path.join(temporaryRoot, 'tsconfig.cli-package.json');
  const configuration = {
    compilerOptions: packageCompilerOptions(dependencyRoot, sourceRoot, stagingRoot),
    files: entrySources
      .filter((source) => COMPILABLE_SOURCE_PATTERN.test(source))
      .map((source) => path.join(sourceRoot, source)),
  };
  await writeFile(configurationPath, `${JSON.stringify(configuration, null, 2)}\n`, 'utf8');
  const compiler = path.join(compilerRoot, TYPESCRIPT_COMPILER_SOURCE);
  try {
    await execFile(process.execPath, [compiler, '--project', configurationPath], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      timeout: CLI_PACKAGE_LONG_PROCESS_TIMEOUT_MS,
      killSignal: 'SIGTERM',
      maxBuffer: 4 * 1024 * 1024,
      env: cliPackageProcessEnvironment({ NODE_ENV: 'production' }),
    });
  } catch (error) {
    const commandError = error && typeof error === 'object' ? error as { stderr?: unknown; stdout?: unknown } : {};
    const output = [commandError.stderr, commandError.stdout]
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
      ?.trim()
      .slice(0, 4_000);
    throw new TypeError(`CLI TypeScript compilation failed${output ? `: ${output}` : '.'}`);
  }
  if (entrySources.includes('bin/whoisleuth.mts')) {
    await chmod(path.join(stagingRoot, 'bin', 'whoisleuth.mjs'), 0o755);
  }
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
    env: cliPackageProcessEnvironment({ FORCE_COLOR: '0', NO_COLOR: '1' }),
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
  const sourceRoot = path.join(temporaryRoot, 'source');
  const artifactsRoot = path.join(temporaryRoot, 'artifacts');
  const installRoot = path.join(temporaryRoot, 'install');
  try {
    await Promise.all([
      mkdir(stagingRoot, { recursive: true }),
      mkdir(sourceRoot, { recursive: true }),
      mkdir(artifactsRoot, { recursive: true }),
      mkdir(installRoot, { recursive: true }),
    ]);
    const [runtimeGraph, packageGraph] = await Promise.all([
      dependencyGraph(repositoryRoot, CLI_RUNTIME_ENTRY_MODULES),
      dependencyGraph(repositoryRoot, CLI_PACKAGE_ENTRY_MODULES),
    ]);
    const executableSources = selectCliPackageSources(runtimeGraph, {
      maximumModules: MAX_CLI_RUNTIME_MODULES,
      requiredSources: CLI_RUNTIME_ENTRY_MODULES,
    });
    const runtimeSources = selectCliPackageSources(packageGraph, {
      maximumModules: MAX_CLI_PACKAGE_MODULES,
      requiredSources: CLI_PACKAGE_ENTRY_MODULES,
    });
    if (executableSources.some((source) => !runtimeSources.includes(source))) {
      throw new TypeError('CLI package roots do not preserve the complete executable dependency graph.');
    }
    // Live graph/compiler discovery is admission-only. Every byte it names is
    // captured before a second trusted closure pass runs from the private
    // materialized tree; an ephemeral extra root can therefore only cause a
    // rejection, never an emitted package module.
    const liveClosure = await cliPackageCompilerSourceClosure(repositoryRoot, temporaryRoot, runtimeSources);
    const copyState = { totalBytes: 0 };
    const compilerState: CliPackageSnapshotState = {
      totalBytes: 0,
      maximumBytes: MAX_CLI_PACKAGE_COMPILER_CONTEXT_BYTES,
      maximumFileBytes: MAX_CLI_PACKAGE_COMPILER_CONTEXT_FILE_BYTES,
    };
    const [sourceSnapshot, supportSnapshot, manifestSnapshot, compilerSnapshot] = await Promise.all([
      captureCliPackageSourceSnapshot(repositoryRoot, liveClosure.sources, copyState),
      captureCliPackageSourceSnapshot(repositoryRoot, CLI_PACKAGE_SUPPORT_FILES.map(([source]) => source), copyState),
      captureCliPackageSourceSnapshot(repositoryRoot, [
        'package.json',
        ...CLI_PACKAGE_COMPILER_CONTEXT_FILES,
        'packages/cli/package.template.json',
        'package-lock.json',
      ], copyState),
      captureCliPackageSourceSnapshot(repositoryRoot, liveClosure.contextFiles, compilerState),
    ]);
    const rootManifest = parseBoundedJsonBytes(snapshotBytes(manifestSnapshot, 'package.json'), 'package.json');
    const templateManifest = parseBoundedJsonBytes(
      snapshotBytes(manifestSnapshot, 'packages/cli/package.template.json'),
      'package.template.json',
    );
    const lockfile = parseBoundedJsonBytes(snapshotBytes(manifestSnapshot, 'package-lock.json'), 'package-lock.json');
    const expectedCommands = CLI_COMMANDS;
    const manifest = buildCliPackageManifest(rootManifest, templateManifest, lockfile, { publicationEnabled });
    await materializeCliPackageSourceSnapshot(sourceRoot, sourceSnapshot);
    await materializeCliPackageSourceSnapshot(sourceRoot, manifestSnapshot);
    await materializeCliPackageSourceSnapshot(sourceRoot, compilerSnapshot);
    const materializedClosure = await cliPackageCompilerSourceClosure(
      sourceRoot,
      temporaryRoot,
      CLI_PACKAGE_ENTRY_MODULES,
    );
    for (const source of materializedClosure.sources) {
      if (!sourceSnapshot.has(source)) {
        throw new TypeError(`Materialized CLI compiler closure requires uncaptured source ${source}.`);
      }
    }
    for (const contextFile of materializedClosure.contextFiles) {
      if (!compilerSnapshot.has(contextFile)) {
        throw new TypeError(`Materialized CLI compiler closure requires uncaptured context ${contextFile}.`);
      }
    }
    const sources = selectMaterializedCliPackageSources(runtimeSources, materializedClosure.sources);
    await compilePackageSources(
      repositoryRoot,
      temporaryRoot,
      stagingRoot,
      sourceRoot,
      CLI_PACKAGE_ENTRY_MODULES,
      { compilerRoot: sourceRoot, dependencyRoot: sourceRoot },
    );
    await Promise.all([
      assertCliPackageSourceSnapshot(repositoryRoot, sourceSnapshot),
      assertCliPackageSourceSnapshot(
        repositoryRoot,
        compilerSnapshot,
        MAX_CLI_PACKAGE_COMPILER_CONTEXT_FILE_BYTES,
      ),
    ]);
    for (const [source, destination] of CLI_PACKAGE_SUPPORT_FILES) {
      await copyPackageFile(stagingRoot, destination, snapshotBytes(supportSnapshot, source));
    }
    const noticeOptions = {
      directDependencyNames: CLI_RUNTIME_DEPENDENCIES,
      scopeLabel: 'CLI',
      lockfileValue: lockfile,
    } as const;
    const cliNotices = await buildThirdPartyNotices(repositoryRoot, noticeOptions);
    await Promise.all([
      assertCliPackageSourceSnapshot(repositoryRoot, sourceSnapshot),
      assertCliPackageSourceSnapshot(repositoryRoot, supportSnapshot),
      assertCliPackageSourceSnapshot(repositoryRoot, manifestSnapshot),
      assertCliPackageSourceSnapshot(
        repositoryRoot,
        compilerSnapshot,
        MAX_CLI_PACKAGE_COMPILER_CONTEXT_FILE_BYTES,
      ),
    ]);
    if (await buildThirdPartyNotices(repositoryRoot, noticeOptions) !== cliNotices) {
      throw new TypeError('CLI third-party notice inputs changed during package assembly.');
    }
    const cliNoticeBytes = Buffer.byteLength(cliNotices, 'utf8');
    if (cliNoticeBytes > MAX_CLI_PACKAGE_FILE_BYTES || copyState.totalBytes + cliNoticeBytes > MAX_CLI_PACKAGE_SOURCE_BYTES) {
      throw new TypeError('Generated CLI third-party notices exceed the package source boundary.');
    }
    copyState.totalBytes += cliNoticeBytes;
    await writeFile(path.join(stagingRoot, 'third-party-notices.txt'), cliNotices, { encoding: 'utf8', mode: 0o644 });
    await writeFile(path.join(stagingRoot, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o644 });

    const npmCache = path.join(temporaryRoot, 'npm-cache');
    const commonEnvironment = cliPackageProcessEnvironment({
      npm_config_audit: 'false',
      npm_config_cache: npmCache,
      npm_config_fund: 'false',
      npm_config_ignore_scripts: 'true',
    });
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
      'frontend/src/lib/analysis/domain-control-manifest-core.js',
      'frontend/src/lib/analysis/domain-control-records.js',
      'packages/cases/case-model.mjs',
      'packages/comparison/page-similarity.mjs',
      'packages/evidence/domain-control-runtime.mjs',
      'packages/evidence/domain-name.mjs',
      'packages/interchange/external-findings-import.mjs',
      'packages/investigation/investigation-capsule.mjs',
      'packages/workspace/bulk-session-model.mjs',
      'packages/workspace/workspace-archive.mjs',
      'package.json',
      'third-party-notices.txt',
      ...CLI_PACKAGE_SUPPORT_FILES.map(([, destination]) => destination),
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
    await Promise.all([
      assertCliPackageSourceSnapshot(repositoryRoot, sourceSnapshot),
      assertCliPackageSourceSnapshot(repositoryRoot, supportSnapshot),
      assertCliPackageSourceSnapshot(repositoryRoot, manifestSnapshot),
      assertCliPackageSourceSnapshot(
        repositoryRoot,
        compilerSnapshot,
        MAX_CLI_PACKAGE_COMPILER_CONTEXT_FILE_BYTES,
      ),
    ]);
    if (await buildThirdPartyNotices(repositoryRoot, noticeOptions) !== cliNotices) {
      throw new TypeError('CLI third-party notice inputs changed during package assembly.');
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
    const installedPackageRoot = path.dirname(path.dirname(executable));
    await Promise.all(INSTALLED_COMPATIBILITY_FACADES.map((contract) => (
      assertInstalledCompatibilityFacade(installedPackageRoot, contract)
    )));
    const [installedDomainControlRuntime, installedDomainName] = await Promise.all([
      import(pathToFileURL(path.join(installedPackageRoot, 'packages/evidence/domain-control-runtime.mjs')).href),
      import(pathToFileURL(path.join(installedPackageRoot, 'packages/evidence/domain-name.mjs')).href),
    ]);
    if (typeof installedDomainControlRuntime.serializeDomainControlManifest !== 'function'
      || installedDomainName.normalizeDomain('EXAMPLE.TEST.') !== 'example.test') {
      throw new TypeError('Installed canonical domain-control modules did not retain their reviewed runtime contract.');
    }
    const installedHandlerChecks: string[] = [];
    const handlerOwners = new Set(CLI_COMMAND_REGISTRY.map((definition) => definition.execution.handlerOwner));
    for (const owner of handlerOwners) {
      if (owner === 'inline') continue;
      const handler = INSTALLED_HANDLER_MODULES[owner];
      const handlerModule = await import(pathToFileURL(path.join(installedPackageRoot, handler.source)).href);
      if (typeof handlerModule[handler.exportName] !== 'function') {
        throw new TypeError(`Installed CLI handler ${owner} does not export ${handler.exportName}.`);
      }
      installedHandlerChecks.push(`${owner}-handler`);
    }
    if (publicationEnabled) {
      const publishConfig = record(installedManifest.publishConfig, 'Installed package publishConfig');
      if (Object.hasOwn(installedManifest, 'private') || publishConfig.access !== 'public' || publishConfig.provenance !== true) {
        throw new TypeError('Installed release candidate does not retain the public provenance contract.');
      }
    } else if (installedManifest.private !== true || Object.hasOwn(installedManifest, 'publishConfig')) {
      throw new TypeError('Installed package check does not retain its private publication boundary.');
    }
    const help = await runInstalledCheck(executable, ['--help'], 'help');
    if (!help.startsWith('WHOISleuth CLI\n')
      || !help.includes('Fast lookup is the default; deep collection')
      || !help.includes('eligible interactive terminal opens a bounded launcher')) {
      throw new TypeError('Installed CLI help contract failed.');
    }
    const zeroArgumentHelp = await runInstalledCheck(executable, [], 'zero-argument redirected help');
    if (zeroArgumentHelp !== help) throw new TypeError('Installed CLI zero-argument redirected invocation did not preserve static help.');
    const shortHelp = await runInstalledCheck(executable, ['-h'], 'short help');
    if (shortHelp !== help) throw new TypeError('Installed CLI short help alias did not preserve static help.');
    const version = await runInstalledCheck(executable, ['--version'], 'version');
    if (version !== `${packageVersion}\n`) throw new TypeError('Installed CLI version does not match the generated package manifest.');
    const shortVersion = await runInstalledCheck(executable, ['-V'], 'short version');
    if (shortVersion !== version) throw new TypeError('Installed CLI short version alias did not preserve the package version.');
    const doctor = await runInstalledCheck(executable, ['doctor', '--json'], 'doctor');
    const doctorDocument = record(JSON.parse(doctor), 'Installed doctor output');
    if (doctorDocument.schema !== 'whoisleuth.cli.doctor' || doctorDocument.networkRequested !== false) {
      throw new TypeError('Installed offline doctor command returned the wrong contract.');
    }
    const commands = await runInstalledCheck(executable, ['commands', '--json'], 'commands');
    const commandCatalogue = record(JSON.parse(commands), 'Installed command catalogue');
    if (commandCatalogue.schema !== 'whoisleuth.cli.command-catalogue'
      || commandCatalogue.version !== 1
      || !Array.isArray(commandCatalogue.commands)
      || Object.keys(commandCatalogue).sort().join(',') !== 'commands,packageVersion,schema,version') {
      throw new TypeError('Installed command catalogue returned the wrong contract.');
    }
    const lookupPlan = await runInstalledCheck(executable, ['lookup', 'example.test', '--deep', '--plan', '--json'], 'lookup plan');
    const lookupPlanDocument = record(JSON.parse(lookupPlan), 'Installed Lookup plan');
    if (lookupPlanDocument.schema !== 'whoisleuth.cli.lookup-plan'
      || record(lookupPlanDocument.planning, 'Installed Lookup plan collection').networkRequestsMade !== false) {
      throw new TypeError('Installed offline Lookup plan returned the wrong contract.');
    }
    const directLookupPlan = await runInstalledCheck(executable, ['example.test', '--deep', '--plan', '--json'], 'direct Lookup plan');
    const directLookupPlanDocument = record(JSON.parse(directLookupPlan), 'Installed direct Lookup plan');
    if (directLookupPlanDocument.schema !== 'whoisleuth.cli.lookup-plan'
      || record(directLookupPlanDocument.planning, 'Installed direct Lookup plan collection').networkRequestsMade !== false
      || directLookupPlanDocument.query !== lookupPlanDocument.query
      || directLookupPlanDocument.mode !== lookupPlanDocument.mode) {
      throw new TypeError('Installed direct target did not preserve the offline Lookup plan contract.');
    }
    const completionChecks = [
      ['bash', 'complete -F _whoisleuth_completion whoisleuth', '--palette', '--save-lookup'],
      ['zsh', '#compdef whoisleuth', '--palette', '--save-lookup'],
      ['fish', 'complete -c whoisleuth', '-l palette', '-l save-lookup'],
      ['powershell', 'Register-ArgumentCompleter -Native -CommandName whoisleuth', '--palette', '--save-lookup'],
    ] as const;
    for (const [shell, marker, paletteMarker, saveLookupMarker] of completionChecks) {
      const completion = await runInstalledCheck(executable, ['completion', shell], `${shell} completion`);
      if (!completion.includes(marker) || !completion.includes(paletteMarker) || !completion.includes(saveLookupMarker)) {
        throw new TypeError(`Installed ${shell} completion command returned the wrong script.`);
      }
    }
    const manual = await runInstalledCheck(executable, ['manual'], 'manual');
    if (!manual.startsWith('.TH WHOISLEUTH 1')
      || !manual.includes('.SS diff')
      || !manual.includes('\\-\\-save\\-lookup')
      || !manual.includes('--palette')) {
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
    if (catalogueCommands.length !== expectedCommands.length
      || catalogueCommands.some((command, index) => command !== expectedCommands[index])) {
      throw new TypeError('Installed command catalogue must match the canonical command registry and order.');
    }
    for (const [index, entry] of commandCatalogue.commands.entries()) {
      if (Object.keys(record(entry, `Installed command catalogue entry ${index + 1}`)).sort().join(',')
        !== 'boundary,collection,command,description,example,usage') {
        throw new TypeError(`Installed command catalogue entry ${index + 1} has an unsupported shape.`);
      }
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

    const installedChecks = Object.freeze([
      'help',
      'short-help',
      'zero-argument-help',
      'version',
      'short-version',
      'doctor',
      'commands',
      'lookup-plan',
      'direct-lookup-plan',
      ...completionChecks.map(([shell]) => `${shell}-completion`),
      'manual',
      'registry-support',
      'discover',
      'discover-scan-network-boundary',
      'domain-control-deep-imports',
      ...installedHandlerChecks,
      ...commandHelpChecks,
    ]);
    if (installedChecks.length === 0 || installedChecks.length > MAX_CLI_PACKAGE_INSTALLED_CHECKS) {
      throw new TypeError(`Installed CLI checks exceed the reviewed ${MAX_CLI_PACKAGE_INSTALLED_CHECKS}-check ceiling.`);
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
      installedChecks,
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
