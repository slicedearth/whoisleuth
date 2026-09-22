#!/usr/bin/env node

import {
  packageProcessEnvironment, copyPackageFile, capturePackageSourceSnapshot,
  assertPackageSourceSnapshot, materializePackageSourceSnapshot,
  discoverPackageCompilerClosure, compilePackageSources, emittedPackageFiles, validateCompiledPackageFiles,
  type PackageSourceSnapshot, type PackageSnapshotState,
} from './package-source.mts';
import {
  MAX_PACKAGE_GRAPH_BYTES, MAX_PACKAGE_SOURCE_BYTES, MAX_PACKAGE_FILE_BYTES,
  MAX_PACKAGE_COMPILER_CONTEXT_BYTES, MAX_PACKAGE_COMPILER_CONTEXT_FILE_BYTES,
  PACKAGE_PROCESS_TIMEOUT_MS,
} from './package-resource-bounds.mts';
import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  WHOISLEUTH_PROJECT_URL,
  WHOISLEUTH_SOURCE_ISSUES_URL,
  WHOISLEUTH_SOURCE_REPOSITORY_GIT_URL,
} from '../packages/analysis/project-metadata.mts';
import { scanBoundedJson } from '../packages/analysis/bounded-json.mts';
import {
  readBoundedRegularFile,
  readBoundedRegularFileWithin,
} from '../lib/bounded-file.mts';
import { normalizeSemanticVersion } from './release-version-check.mts';
import { buildThirdPartyNotices } from './third-party-notices.mts';
import { checkInstalledSigningTrust } from './cli-signing-package-check.mts';
import { checkInstalledCaseFiles } from './cli-case-package-check.mts';
import { createInstalledCliRunner } from './installed-cli-check.mts';
import { checkInstalledCliDiscovery } from './cli-discovery-package-check.mts';
import { checkInstalledCliEvidence } from './cli-evidence-package-check.mts';
import { checkInstalledCliWorkflows } from './cli-workflow-package-check.mts';
import { checkInstalledCliIncidents } from './cli-incident-package-check.mts';
import { installedDependencyEvidence } from './installed-dependency-evidence.mts';
import { validateCandidateReport } from './published-cli-check.mts';
import {
  CLI_PACKAGE_REPORT_SCHEMA,
  CLI_PACKAGE_REPORT_VERSION,
  MAX_CLI_PACKAGE_PROCESSING_ITEMS,
  MAX_CLI_PACKAGE_PACKED_BYTES,
  MAX_CLI_PACKAGE_UNPACKED_BYTES,
  type CliPackageReport,
} from './cli-package-contract.mts';
export {
  CLI_PACKAGE_REPORT_SCHEMA,
  CLI_PACKAGE_REPORT_VERSION,
  MAX_CLI_PACKAGE_PROCESSING_ITEMS,
  MAX_CLI_PACKAGE_PACKED_BYTES,
  MAX_CLI_PACKAGE_UNPACKED_BYTES,
  type CliPackageReport,
} from './cli-package-contract.mts';
import {
  boundedPositiveInteger as positiveInteger,
  boundedUnpaddedText as boundedString,
  boundedSafeRelativePath as safeRelativePath,
  requireJsonRecord as record,
} from './maintainer-tool-helpers.mts';
import {
  CLI_COMMAND_REGISTRY,
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

export type CliPackageInventory = Readonly<{
  runtimeGraphModuleCount: number;
  packageGraphModuleCount: number;
  compilerSourceCount: number;
  packedEntryCount: number;
}>;

type CliPackageOptions = Readonly<{
  publicationEnabled?: boolean;
  artifactDirectory?: string;
  expectedTag?: string;
  observeInventory?: (inventory: CliPackageInventory) => void;
}>;

type ParsedArguments = Readonly<{
  json: boolean;
  publicationEnabled: boolean;
  artifactDirectory?: string;
  expectedTag?: string;
}>;

const execFile = promisify(execFileCallback);
export { CLI_PACKAGE_INSTALLED_CHECK_TIMEOUT_MS } from './installed-cli-check.mts';

const LOCAL_SOURCE_PATTERN = /^(?:bin|cli|lib|frontend\/src\/lib|packages\/(?!(?:web-capture|local-application)\/)[A-Za-z0-9._-]+)\/[A-Za-z0-9._/-]+\.(?:mts|ts|json)$/u;
const CLI_RUNTIME_ENTRY_MODULES = Object.freeze(['bin/whoisleuth.mts', 'cli/runner.mts']);
// Released deep imports remain entry points independently of current consumers.
const CLI_COMPATIBILITY_ENTRY_MODULES = Object.freeze([
  'frontend/src/lib/analysis/domain-control-manifest-core.ts',
  'frontend/src/lib/analysis/domain-control-records.ts',
  'lib/analyst-taxonomy.mts',
  'lib/bounded-json.mts',
  'lib/candidate-provenance-bounds.mts',
  'lib/ct-query.mts',
  'lib/ct-response-bounds.mts',
  'lib/external-intelligence-risk.mts',
  'lib/http-evidence-bounds.mts',
  'lib/opportunity-scoring.mts',
  'lib/perceptual-hash-comparison.mts',
  'lib/portable-generator.mts',
  'lib/project-metadata.mts',
  'lib/registrable-domain.mts',
  'lib/risk-calibration-summary.mts',
  'lib/risk-scoring.mts',
  'lib/scoring-evidence-quality.mts',
  'lib/semantic-version.mts',
  'lib/threat-intelligence-types.mts',
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
const INSTALLED_INLINE_FAMILY_MODULES = Object.freeze([
  Object.freeze({ source: 'cli/support-command-runner.mjs', exportName: 'runSupportCommand', label: 'support-family-handler' }),
  Object.freeze({ source: 'cli/review-command-runner.mjs', exportName: 'runReviewCommand', label: 'review-family-handler' }),
  Object.freeze({ source: 'cli/assurance-command-runner.mjs', exportName: 'runAssuranceCommand', label: 'assurance-family-handler' }),
  Object.freeze({ source: 'cli/workflow-command-runner.mjs', exportName: 'runWorkflowCommand', label: 'workflow-family-handler' }),
  Object.freeze({ source: 'cli/history-command-runner.mjs', exportName: 'runHistoryCommand', label: 'history-family-handler' }),
]);
export const CLI_RUNTIME_DEPENDENCIES = Object.freeze([
  '@nuintun/qrcode',
  '@peculiar/x509',
  'fast-png',
  'fflate',
  'maxmind',
  'parse5',
  'postal-mime',
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

function dependencies(value: unknown): readonly DependencyEntry[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 512) throw new TypeError('Dependency graph entries must be a bounded array.');
  return value.map((entry, index) => record(entry, `Dependency ${index + 1}`));
}

export function selectPackageSources(
  graphValue: unknown,
  options: Readonly<{
    maximumModules?: number;
    requiredSources?: readonly string[];
  }> = {},
): readonly string[] {
  const graph = record(graphValue, 'Dependency graph');
  const maximumModules = options.maximumModules ?? MAX_CLI_PACKAGE_PROCESSING_ITEMS;
  const requiredSources = options.requiredSources ?? CLI_RUNTIME_ENTRY_MODULES;
  if (!Number.isSafeInteger(maximumModules) || maximumModules < 1 || maximumModules > MAX_CLI_PACKAGE_PROCESSING_ITEMS) {
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

function dependencyGraphModuleCount(graphValue: unknown): number {
  const graph = record(graphValue, 'Dependency graph');
  if (!Array.isArray(graph.modules)) throw new TypeError('Dependency graph modules must be an array.');
  return graph.modules.length;
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
      'packages/**/*.mjs',
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

async function readBoundedJson(filename: string, maxBytes = MAX_PACKAGE_GRAPH_BYTES): Promise<unknown> {
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
    timeout: PACKAGE_PROCESS_TIMEOUT_MS,
    killSignal: 'SIGTERM',
    maxBuffer: MAX_PACKAGE_GRAPH_BYTES,
    env: packageProcessEnvironment({ NODE_ENV: 'production' }),
  });
  try {
    scanBoundedJson(stdout);
    return JSON.parse(stdout);
  } catch {
    throw new TypeError('CLI dependency graph is not valid JSON.');
  }
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

function snapshotBytes(snapshot: PackageSourceSnapshot, source: string): Buffer {
  const identity = snapshot.get(source);
  if (!identity) throw new TypeError(`CLI package snapshot is missing ${source}.`);
  return identity.bytes;
}

export function selectMaterializedPackageSources(
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

function parsePackResult(value: unknown): JsonRecord {
  if (!Array.isArray(value) || value.length !== 1) throw new TypeError('npm pack must return exactly one package result.');
  return record(value[0], 'npm pack result');
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
    const executableSources = selectPackageSources(runtimeGraph, {
      maximumModules: MAX_CLI_PACKAGE_PROCESSING_ITEMS,
      requiredSources: CLI_RUNTIME_ENTRY_MODULES,
    });
    const runtimeSources = selectPackageSources(packageGraph, {
      maximumModules: MAX_CLI_PACKAGE_PROCESSING_ITEMS,
      requiredSources: CLI_PACKAGE_ENTRY_MODULES,
    });
    const runtimeGraphModuleCount = dependencyGraphModuleCount(runtimeGraph);
    const packageGraphModuleCount = dependencyGraphModuleCount(packageGraph);
    if (executableSources.some((source) => !runtimeSources.includes(source))) {
      throw new TypeError('CLI package roots do not preserve the complete executable dependency graph.');
    }
    // Live graph/compiler discovery is admission-only. Every byte it names is
    // captured before a second trusted closure pass runs from the private
    // materialized tree; an ephemeral extra root can therefore only cause a
    // rejection, never an emitted package module.
    const liveClosure = await discoverPackageCompilerClosure(repositoryRoot, temporaryRoot, runtimeSources, { acceptsSource: source => LOCAL_SOURCE_PATTERN.test(source), contextFiles: CLI_PACKAGE_COMPILER_CONTEXT_FILES });
    const copyState = { totalBytes: 0 };
    const compilerState: PackageSnapshotState = {
      totalBytes: 0,
      maximumBytes: MAX_PACKAGE_COMPILER_CONTEXT_BYTES,
      maximumFileBytes: MAX_PACKAGE_COMPILER_CONTEXT_FILE_BYTES,
    };
    const [sourceSnapshot, supportSnapshot, manifestSnapshot, compilerSnapshot] = await Promise.all([
      capturePackageSourceSnapshot(repositoryRoot, liveClosure.sources, copyState),
      capturePackageSourceSnapshot(repositoryRoot, CLI_PACKAGE_SUPPORT_FILES.map(([source]) => source), copyState),
      capturePackageSourceSnapshot(repositoryRoot, [
        'package.json',
        ...CLI_PACKAGE_COMPILER_CONTEXT_FILES,
        'packages/cli/package.template.json',
        'package-lock.json',
      ], copyState),
      capturePackageSourceSnapshot(repositoryRoot, liveClosure.contextFiles, compilerState),
    ]);
    const rootManifest = parseBoundedJsonBytes(snapshotBytes(manifestSnapshot, 'package.json'), 'package.json');
    const templateManifest = parseBoundedJsonBytes(
      snapshotBytes(manifestSnapshot, 'packages/cli/package.template.json'),
      'package.template.json',
    );
    const lockfile = parseBoundedJsonBytes(snapshotBytes(manifestSnapshot, 'package-lock.json'), 'package-lock.json');
    const manifest = buildCliPackageManifest(rootManifest, templateManifest, lockfile, { publicationEnabled });
    await materializePackageSourceSnapshot(sourceRoot, sourceSnapshot);
    await materializePackageSourceSnapshot(sourceRoot, manifestSnapshot);
    await materializePackageSourceSnapshot(sourceRoot, compilerSnapshot);
    const materializedClosure = await discoverPackageCompilerClosure(
      sourceRoot,
      temporaryRoot,
      CLI_PACKAGE_ENTRY_MODULES,
      { acceptsSource: source => LOCAL_SOURCE_PATTERN.test(source), contextFiles: CLI_PACKAGE_COMPILER_CONTEXT_FILES },
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
    const sources = selectMaterializedPackageSources(runtimeSources, materializedClosure.sources);
    await compilePackageSources(
      repositoryRoot,
      temporaryRoot,
      stagingRoot,
      sourceRoot,
      CLI_PACKAGE_ENTRY_MODULES,
      { compilerRoot: sourceRoot, dependencyRoot: sourceRoot },
    );
    await chmod(path.join(stagingRoot, 'bin', 'whoisleuth.mjs'), 0o755);
    await Promise.all([
      assertPackageSourceSnapshot(repositoryRoot, sourceSnapshot),
      assertPackageSourceSnapshot(
        repositoryRoot,
        compilerSnapshot,
        MAX_PACKAGE_COMPILER_CONTEXT_FILE_BYTES,
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
      assertPackageSourceSnapshot(repositoryRoot, sourceSnapshot),
      assertPackageSourceSnapshot(repositoryRoot, supportSnapshot),
      assertPackageSourceSnapshot(repositoryRoot, manifestSnapshot),
      assertPackageSourceSnapshot(
        repositoryRoot,
        compilerSnapshot,
        MAX_PACKAGE_COMPILER_CONTEXT_FILE_BYTES,
      ),
    ]);
    if (await buildThirdPartyNotices(repositoryRoot, noticeOptions) !== cliNotices) {
      throw new TypeError('CLI third-party notice inputs changed during package assembly.');
    }
    const cliNoticeBytes = Buffer.byteLength(cliNotices, 'utf8');
    if (cliNoticeBytes > MAX_PACKAGE_FILE_BYTES || copyState.totalBytes + cliNoticeBytes > MAX_PACKAGE_SOURCE_BYTES) {
      throw new TypeError('Generated CLI third-party notices exceed the package source boundary.');
    }
    copyState.totalBytes += cliNoticeBytes;
    await writeFile(path.join(stagingRoot, 'third-party-notices.txt'), cliNotices, { encoding: 'utf8', mode: 0o644 });
    await writeFile(path.join(stagingRoot, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o644 });

    const expectedEntries = await emittedPackageFiles(stagingRoot);
    const npmCache = path.join(temporaryRoot, 'npm-cache');
    const commonEnvironment = packageProcessEnvironment({
      npm_config_audit: 'false',
      npm_config_cache: npmCache,
      npm_config_fund: 'false',
      npm_config_ignore_scripts: 'true',
    });
    const { stdout: packOutput } = await execFile('npm', ['pack', '--json', '--pack-destination', artifactsRoot], {
      cwd: stagingRoot,
      encoding: 'utf8',
      timeout: PACKAGE_PROCESS_TIMEOUT_MS,
      killSignal: 'SIGTERM',
      maxBuffer: 4 * 1024 * 1024,
      env: commonEnvironment,
    });
    const packResult = parsePackResult(JSON.parse(packOutput));
    const entries = validateCompiledPackageFiles(packResult, expectedEntries, { exact: true });
    const packedBytes = positiveInteger(packResult.size, 'Packed CLI bytes', MAX_CLI_PACKAGE_PACKED_BYTES);
    const unpackedBytes = positiveInteger(packResult.unpackedSize, 'Unpacked CLI bytes', MAX_CLI_PACKAGE_UNPACKED_BYTES);
    const filename = safeRelativePath(packResult.filename, 'Packed CLI filename');
    const tarball = path.join(artifactsRoot, filename);
    await Promise.all([
      assertPackageSourceSnapshot(repositoryRoot, sourceSnapshot),
      assertPackageSourceSnapshot(repositoryRoot, supportSnapshot),
      assertPackageSourceSnapshot(repositoryRoot, manifestSnapshot),
      assertPackageSourceSnapshot(
        repositoryRoot,
        compilerSnapshot,
        MAX_PACKAGE_COMPILER_CONTEXT_FILE_BYTES,
      ),
    ]);
    if (await buildThirdPartyNotices(repositoryRoot, noticeOptions) !== cliNotices) {
      throw new TypeError('CLI third-party notice inputs changed during package assembly.');
    }

    await writeFile(path.join(installRoot, 'package.json'), '{"private":true}\n', 'utf8');
    await execFile('npm', ['install', '--package-lock=true', '--ignore-scripts', '--no-audit', '--no-fund', tarball], {
      cwd: installRoot,
      encoding: 'utf8',
      timeout: PACKAGE_PROCESS_TIMEOUT_MS,
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
    for (const handler of INSTALLED_INLINE_FAMILY_MODULES) {
      const handlerModule = await import(pathToFileURL(path.join(installedPackageRoot, handler.source)).href);
      if (typeof handlerModule[handler.exportName] !== 'function') {
        throw new TypeError(`Installed CLI command family does not export ${handler.exportName}.`);
      }
      installedHandlerChecks.push(handler.label);
    }
    if (publicationEnabled) {
      const publishConfig = record(installedManifest.publishConfig, 'Installed package publishConfig');
      if (Object.hasOwn(installedManifest, 'private') || publishConfig.access !== 'public' || publishConfig.provenance !== true) {
        throw new TypeError('Installed release candidate does not retain the public provenance contract.');
      }
    } else if (installedManifest.private !== true || Object.hasOwn(installedManifest, 'publishConfig')) {
      throw new TypeError('Installed package check does not retain its private publication boundary.');
    }
    const installed = createInstalledCliRunner(executable);
    await checkInstalledCliDiscovery(temporaryRoot, packageVersion, installed.run);
    await checkInstalledCliEvidence(repositoryRoot, temporaryRoot, installed.run);
    await checkInstalledSigningTrust(repositoryRoot, temporaryRoot, installed.run);
    await checkInstalledCliWorkflows(repositoryRoot, temporaryRoot, installed.run);
    await checkInstalledCaseFiles(temporaryRoot, installed.run);
    await checkInstalledCliIncidents(repositoryRoot, temporaryRoot, packageVersion, installed.run);

    let archiveFilename: string | null = null;
    let archiveSha256: string | null = null;
    const candidateDigest = createHash('sha256').update(await readFile(tarball)).digest('hex');
    const dependencies = await installedDependencyEvidence(installRoot, packageName, candidateDigest);
    if (publicationEnabled) {
      const artifactDirectory = path.resolve(options.artifactDirectory as string);
      await mkdir(artifactDirectory, { recursive: true });
      archiveFilename = `whoisleuth-cli-${packageVersion}.tgz`;
      const archivePath = path.join(artifactDirectory, archiveFilename);
      await copyFile(tarball, archivePath, fsConstants.COPYFILE_EXCL);
      archiveSha256 = candidateDigest;
      await writeFile(path.join(artifactDirectory, `${archiveFilename}.sha256`), `${archiveSha256}  ${archiveFilename}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o644 });
    }

    const installedChecks = Object.freeze([
      'installed-transitive-dependency-identities',
      'domain-control-deep-imports',
      ...installedHandlerChecks,
      ...installed.completed(),
    ]);
    if (installedChecks.length === 0 || installedChecks.length > MAX_CLI_PACKAGE_PROCESSING_ITEMS) {
      throw new TypeError('Installed CLI checks exceed the package processing bound.');
    }

    const inventory = Object.freeze({
      runtimeGraphModuleCount,
      packageGraphModuleCount,
      compilerSourceCount: sources.length,
      packedEntryCount: entries.length,
    });
    options.observeInventory?.(inventory);
    const report = Object.freeze({
      schema: CLI_PACKAGE_REPORT_SCHEMA,
      version: CLI_PACKAGE_REPORT_VERSION,
      packageName,
      packageVersion,
      sourceModuleCount: inventory.compilerSourceCount,
      packedEntryCount: inventory.packedEntryCount,
      packedBytes,
      unpackedBytes,
      runtimeDependencies,
      installedChecks,
      publicationEnabled,
      archiveFilename,
      archiveSha256,
    });
    if (publicationEnabled) {
      validateCandidateReport(report, packageVersion);
      const artifactDirectory = path.resolve(options.artifactDirectory as string);
      await writeFile(path.join(artifactDirectory, 'cli-package-report.json'), `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o644 });
      await writeFile(path.join(artifactDirectory, 'installed-dependencies.json'), `${JSON.stringify(dependencies, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o644 });
    }
    return report;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

export function formatCliPackageReport(
  report: CliPackageReport,
  inventory?: CliPackageInventory,
): string {
  return [
    'WHOISleuth scoped CLI package check',
    `Package: ${report.packageName}@${report.packageVersion}`,
    ...(inventory
      ? [
          `Runtime dependency graph: ${inventory.runtimeGraphModuleCount} modules`,
          `Package dependency graph: ${inventory.packageGraphModuleCount} modules`,
        ]
      : []),
    `Compiler source closure: ${report.sourceModuleCount} sources`,
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
    let inventory: CliPackageInventory | undefined;
    const report = await checkCliPackage(repositoryRoot, {
      publicationEnabled: parsed.publicationEnabled,
      ...(parsed.artifactDirectory ? { artifactDirectory: parsed.artifactDirectory } : {}),
      ...(parsed.expectedTag ? { expectedTag: parsed.expectedTag } : {}),
      observeInventory: (measured) => { inventory = measured; },
    });
    stdout.write(`${parsed.json ? JSON.stringify(report, null, 2) : formatCliPackageReport(report, inventory)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : 'CLI package check failed.'}\n`);
    return 2;
  }
}

const invokedAsScript = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedAsScript) process.exitCode = await main();
