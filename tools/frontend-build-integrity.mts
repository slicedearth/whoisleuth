#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { parseBoundedJsonObject } from '../lib/bounded-json.mts';
import {
  boundedSafeRelativePath,
  compareCodeUnits,
  hasMaintainerUnsafeCharacters,
  readBoundedStableRegularFileSync,
  sha256Bytes,
} from './maintainer-tool-helpers.mts';

export const FRONTEND_BUILD_INTEGRITY_FORMAT = 'frontend-build-identity';
export const FRONTEND_BUILD_INTEGRITY_VERSION = 2 as const;
export const FRONTEND_BUILD_INTEGRITY_MARKER = 'frontend/build-identity.json';
export const FRONTEND_BROWSER_ARTIFACT_PATHS = Object.freeze([
  'frontend/build',
  FRONTEND_BUILD_INTEGRITY_MARKER,
] as const);

// Playwright currently transpiles its TypeScript configuration through a
// CommonJS loader. Keep this module importable from that boundary by avoiding
// import.meta while still resolving a direct maintainer invocation from the
// tool's own path rather than the caller's working directory.
const DIRECT_INVOCATION_PATH = process.argv[1] ? path.resolve(process.argv[1]) : '';
const DIRECT_INVOCATION = path.basename(DIRECT_INVOCATION_PATH) === 'frontend-build-integrity.mts'
  && path.basename(path.dirname(DIRECT_INVOCATION_PATH)) === 'tools';
const DEFAULT_REPOSITORY_ROOT = DIRECT_INVOCATION
  ? path.resolve(path.dirname(DIRECT_INVOCATION_PATH), '..')
  : path.resolve(process.cwd());

const SOURCE_DIRECTORIES = Object.freeze([
  'cli',
  'frontend/src',
  'frontend/static',
  'lib',
  'packages',
] as const);
const SOURCE_FILES = Object.freeze([
  '.nvmrc',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'frontend/package.json',
  'frontend/svelte.config.ts',
  'frontend/tsconfig.json',
  'frontend/vite.config.ts',
] as const);
const MAX_FILES = 4_096;
const MAX_INVENTORY_ENTRIES = MAX_FILES * 2;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_HTML_BYTES = 4 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_MARKER_BYTES = 2 * 1024 * 1024;
const MAX_PATH_LENGTH = 1_024;
const MAX_MANIFEST_ENTRIES = 4_096;
const MAX_REFERENCES = 65_536;

type FileIdentity = Readonly<{
  path: string;
  bytes: number;
  sha256: string;
}>;

type TreeIdentity = Readonly<{
  digestSha256: string;
  fileCount: number;
  totalBytes: number;
  files: readonly FileIdentity[];
}>;

export type FrontendBrowserModuleChunk = Readonly<{
  source: string;
  output: string;
  bytes: number;
  sha256: string;
}>;

type FrontendBrowserTestSupport = Readonly<{
  digestSha256: string;
  modules: readonly FrontendBrowserModuleChunk[];
}>;

type PlannedFile = Readonly<{
  filename: string;
  path: string;
  bytes: number;
}>;

type InventoryBudget = {
  entries: number;
  files: number;
  totalBytes: number;
};

export type FrontendBuildIntegritySnapshot = Readonly<{
  format: typeof FRONTEND_BUILD_INTEGRITY_FORMAT;
  version: typeof FRONTEND_BUILD_INTEGRITY_VERSION;
  runtime: Readonly<{
    node: string;
    platform: NodeJS.Platform;
    architecture: string;
    revision: string;
  }>;
  source: TreeIdentity;
  served: TreeIdentity;
  viteManifestSha256: string;
  manifestOutputs: readonly string[];
  browserTestSupport: FrontendBrowserTestSupport;
  htmlDocuments: number;
  immutableReferences: number;
}>;

type InventoryOptions = Readonly<{
  repositoryRelative: boolean;
  omit?: ReadonlySet<string>;
}>;

function inventoryBudget(): InventoryBudget {
  return { entries: 0, files: 0, totalBytes: 0 };
}

function planFile(
  filename: string,
  relative: string,
  budget: InventoryBudget,
): PlannedFile {
  const safe = boundedSafeRelativePath(relative, 'Frontend build inventory path', MAX_PATH_LENGTH);
  const stat = lstatSync(filename);
  if (stat.isSymbolicLink()) throw new TypeError(`Frontend build inventory rejects symbolic links: ${safe}.`);
  if (!stat.isFile()) throw new TypeError(`Frontend build inventory rejects special files: ${safe}.`);
  if (!Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > MAX_FILE_BYTES) {
    throw new TypeError(`Frontend build file ${safe} must be a regular file within its byte limits.`);
  }
  budget.files += 1;
  if (budget.files > MAX_FILES) throw new TypeError('Frontend build inventory exceeds its file limit.');
  budget.totalBytes += stat.size;
  if (budget.totalBytes > MAX_TOTAL_BYTES) {
    throw new TypeError('Frontend build inventory exceeds its aggregate byte limit before content is read.');
  }
  return Object.freeze({ filename, path: safe, bytes: stat.size });
}

function fileIdentity(file: PlannedFile): FileIdentity {
  const bytes = readBoundedStableRegularFileSync(
    file.filename,
    MAX_FILE_BYTES,
    `Frontend build file ${file.path}`,
    0,
  );
  if (bytes.byteLength !== file.bytes) {
    throw new TypeError(`Frontend build file ${file.path} changed after inventory admission.`);
  }
  return Object.freeze({ path: file.path, bytes: bytes.byteLength, sha256: sha256Bytes(bytes) });
}

function treeIdentity(files: readonly FileIdentity[]): TreeIdentity {
  if (files.length < 1 || files.length > MAX_FILES) {
    throw new TypeError(`Frontend build inventory must contain 1 to ${MAX_FILES} files.`);
  }
  const ordered = [...files].sort((left, right) => compareCodeUnits(left.path, right.path));
  if (new Set(ordered.map((item) => item.path)).size !== ordered.length) {
    throw new TypeError('Frontend build inventory contains a duplicate path.');
  }
  let totalBytes = 0;
  const digest = createHash('sha256');
  for (const item of ordered) {
    totalBytes += item.bytes;
    if (totalBytes > MAX_TOTAL_BYTES) throw new TypeError('Frontend build inventory exceeds its aggregate byte limit.');
    digest.update(item.path, 'utf8');
    digest.update('\0', 'utf8');
    digest.update(String(item.bytes), 'utf8');
    digest.update('\0', 'utf8');
    digest.update(item.sha256, 'ascii');
    digest.update('\n', 'utf8');
  }
  return Object.freeze({
    digestSha256: digest.digest('hex'),
    fileCount: ordered.length,
    totalBytes,
    files: Object.freeze(ordered),
  });
}

function inventoryDirectory(
  repositoryRoot: string,
  relativeRoot: string,
  options: InventoryOptions,
  budget: InventoryBudget,
): readonly PlannedFile[] {
  const safeRoot = boundedSafeRelativePath(relativeRoot, 'Frontend build inventory root', MAX_PATH_LENGTH);
  const absoluteRoot = path.join(repositoryRoot, safeRoot);
  const rootStat = lstatSync(absoluteRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new TypeError(`Frontend build inventory root must be a real directory: ${safeRoot}.`);
  }
  const files: PlannedFile[] = [];
  const visit = (absoluteDirectory: string, relativeDirectory: string): void => {
    const directoryPath = relativeDirectory ? `${safeRoot}/${relativeDirectory}` : safeRoot;
    const directoryStat = lstatSync(absoluteDirectory);
    if (directoryStat.isSymbolicLink()) {
      throw new TypeError(`Frontend build inventory rejects symbolic links: ${directoryPath}.`);
    }
    if (!directoryStat.isDirectory()) {
      throw new TypeError(`Frontend build inventory rejects non-directory traversal: ${directoryPath}.`);
    }
    const entries = readdirSync(absoluteDirectory, { withFileTypes: true })
      .sort((left, right) => compareCodeUnits(left.name, right.name));
    for (const entry of entries) {
      const childWithinRoot = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const childRepositoryPath = `${safeRoot}/${childWithinRoot}`;
      const child = path.join(absoluteDirectory, entry.name);
      boundedSafeRelativePath(childRepositoryPath, 'Frontend build inventory entry', MAX_PATH_LENGTH);
      budget.entries += 1;
      if (budget.entries > MAX_INVENTORY_ENTRIES) {
        throw new TypeError('Frontend build inventory exceeds its directory-entry limit.');
      }
      const childStat = lstatSync(child);
      if (childStat.isSymbolicLink()) throw new TypeError(`Frontend build inventory rejects symbolic links: ${childRepositoryPath}.`);
      if (childStat.isDirectory()) {
        visit(child, childWithinRoot);
        continue;
      }
      if (!childStat.isFile()) throw new TypeError(`Frontend build inventory rejects special files: ${childRepositoryPath}.`);
      const identityPath = options.repositoryRelative ? childRepositoryPath : childWithinRoot;
      if (options.omit?.has(identityPath)) continue;
      files.push(planFile(child, identityPath, budget));
    }
  };
  visit(absoluteRoot, '');
  return Object.freeze(files);
}

function sourceIdentity(repositoryRoot: string): TreeIdentity {
  const budget = inventoryBudget();
  const planned: PlannedFile[] = SOURCE_DIRECTORIES.flatMap((directory) => (
    inventoryDirectory(repositoryRoot, directory, { repositoryRelative: true }, budget)
  ));
  for (const relative of SOURCE_FILES) {
    planned.push(planFile(path.join(repositoryRoot, relative), relative, budget));
  }
  return treeIdentity(planned.map(fileIdentity));
}

function outputIdentity(repositoryRoot: string, relativeRoot: string): TreeIdentity {
  const planned = inventoryDirectory(
    repositoryRoot,
    relativeRoot,
    { repositoryRelative: false },
    inventoryBudget(),
  );
  return treeIdentity(planned.map(fileIdentity));
}

function relatedOutputIdentities(
  repositoryRoot: string,
  relativeRoots: readonly string[],
): readonly TreeIdentity[] {
  const budget = inventoryBudget();
  const plans = relativeRoots.map((relativeRoot) => inventoryDirectory(
    repositoryRoot,
    relativeRoot,
    { repositoryRelative: false },
    budget,
  ));
  return Object.freeze(plans.map((planned) => treeIdentity(planned.map(fileIdentity))));
}

function resolvedBuildRevision(repositoryRoot: string, environment: NodeJS.ProcessEnv): string {
  for (const candidate of [
    environment.WHOISLEUTH_BUILD_REVISION,
    environment.COMMIT_REF,
    environment.DEPLOY_COMMIT_REF,
    environment.GITHUB_SHA,
  ]) {
    const value = String(candidate ?? '').trim().toLowerCase();
    if (/^[a-f0-9]{7,64}$/u.test(value)) return value;
  }
  const child = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const value = child.status === 0 ? child.stdout.trim().toLowerCase() : '';
  return /^[a-f0-9]{7,64}$/u.test(value) ? value : 'local';
}

type FrontendManifestIdentity = Readonly<{
  outputs: ReadonlySet<string>;
  browserModules: readonly Readonly<{ source: string; output: string }>[];
}>;

function frontendManifestIdentity(source: Buffer): FrontendManifestIdentity {
  const manifest = parseBoundedJsonObject(source.toString('utf8'), {
    label: 'Frontend Vite manifest',
    maximumBytes: MAX_MANIFEST_BYTES,
  });
  const entries = Object.entries(manifest);
  if (entries.length < 1 || entries.length > MAX_MANIFEST_ENTRIES) {
    throw new TypeError('Frontend Vite manifest has an invalid entry count.');
  }
  const outputs = new Set<string>();
  const browserModules: Array<Readonly<{ source: string; output: string }>> = [];
  for (const [key, raw] of entries) {
    if (!key || key.length > MAX_PATH_LENGTH || hasMaintainerUnsafeCharacters(key)
      || !raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new TypeError('Frontend Vite manifest contains a malformed entry.');
    }
    const entry = raw as Record<string, unknown>;
    const candidates: unknown[] = [entry.file];
    for (const field of ['css', 'assets'] as const) {
      const values = entry[field];
      if (values === undefined) continue;
      if (!Array.isArray(values) || values.length > MAX_FILES) {
        throw new TypeError(`Frontend Vite manifest ${field} list is malformed.`);
      }
      candidates.push(...values);
    }
    for (const candidate of candidates) {
      const output = boundedSafeRelativePath(candidate, 'Frontend Vite manifest output', MAX_PATH_LENGTH);
      if (!output.startsWith('_app/immutable/')) {
        throw new TypeError(`Frontend Vite manifest output is outside the immutable asset tree: ${output}.`);
      }
      outputs.add(output);
      if (outputs.size > MAX_FILES) throw new TypeError('Frontend Vite manifest exceeds its output limit.');
    }
    if (key.startsWith('src/')) {
      const moduleSource = boundedSafeRelativePath(key, 'Frontend Vite source module', MAX_PATH_LENGTH);
      const output = boundedSafeRelativePath(entry.file, `Frontend Vite module ${moduleSource} output`, MAX_PATH_LENGTH);
      if (!output.startsWith('_app/immutable/') || !output.endsWith('.js')) {
        throw new TypeError(`Frontend Vite source module does not resolve to an immutable JavaScript chunk: ${moduleSource}.`);
      }
      browserModules.push(Object.freeze({ source: moduleSource, output }));
    }
  }
  browserModules.sort((left, right) => compareCodeUnits(left.source, right.source));
  if (browserModules.length < 1 || browserModules.length > MAX_MANIFEST_ENTRIES
    || new Set(browserModules.map((item) => item.source)).size !== browserModules.length) {
    throw new TypeError('Frontend Vite browser-module inventory is empty, duplicated, or exceeds its bound.');
  }
  return Object.freeze({ outputs, browserModules: Object.freeze(browserModules) });
}

function browserTestSupport(
  viteManifestSha256: string,
  modules: readonly Readonly<{ source: string; output: string }>[],
  served: TreeIdentity,
): FrontendBrowserTestSupport {
  const servedByPath = new Map(served.files.map((item) => [item.path, item]));
  const digest = createHash('sha256');
  digest.update(viteManifestSha256, 'ascii');
  digest.update('\n', 'ascii');
  const retained = modules.map((module) => {
    const file = servedByPath.get(module.output);
    if (!file) {
      throw new TypeError(`Frontend browser-test module is absent from the served build: ${module.source}.`);
    }
    const item = Object.freeze({
      source: module.source,
      output: module.output,
      bytes: file.bytes,
      sha256: file.sha256,
    });
    digest.update(item.source, 'utf8');
    digest.update('\0', 'ascii');
    digest.update(item.output, 'utf8');
    digest.update('\0', 'ascii');
    digest.update(String(item.bytes), 'ascii');
    digest.update('\0', 'ascii');
    digest.update(item.sha256, 'ascii');
    digest.update('\n', 'ascii');
    return item;
  });
  return Object.freeze({ digestSha256: digest.digest('hex'), modules: Object.freeze(retained) });
}

function exactFileSet(label: string, actual: readonly FileIdentity[], expected: readonly FileIdentity[]): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const actualPaths = new Set(actual.map((item) => item.path));
    const expectedPaths = new Set(expected.map((item) => item.path));
    const missing = expected.find((item) => !actualPaths.has(item.path));
    const unexpected = actual.find((item) => !expectedPaths.has(item.path));
    const changed = actual.find((item) => {
      const counterpart = expected.find((candidate) => candidate.path === item.path);
      return counterpart && (counterpart.bytes !== item.bytes || counterpart.sha256 !== item.sha256);
    });
    const detail = missing ? `missing ${missing.path}` : unexpected ? `unexpected ${unexpected.path}` : changed ? `changed ${changed.path}` : 'different ordering';
    throw new TypeError(`${label} does not match the current SvelteKit output (${detail}).`);
  }
}

function htmlIntegrity(repositoryRoot: string, served: TreeIdentity, manifestOutputs: ReadonlySet<string>): Readonly<{
  documents: number;
  immutableReferences: number;
}> {
  const html = served.files.filter((item) => item.path.endsWith('.html'));
  if (!html.length) throw new TypeError('Frontend served build contains no prerendered HTML documents.');
  let immutableReferences = 0;
  for (const item of html) {
    const source = readBoundedStableRegularFileSync(
      path.join(repositoryRoot, 'frontend/build', item.path),
      MAX_HTML_BYTES,
      `Frontend HTML ${item.path}`,
    ).toString('utf8');
    const references = [
      ...source.matchAll(/\b(?:href|src)\s*=\s*["']([^"']{1,2048})["']/gu),
      ...source.matchAll(/\bimport\(\s*["']([^"']{1,2048})["']\s*\)/gu),
    ].map((match) => match[1] as string).filter((value) => value.includes('_app/immutable/'));
    const rawOccurrences = [...source.matchAll(/_app\/immutable\//gu)].length;
    if (references.length !== rawOccurrences) {
      throw new TypeError(`Frontend HTML ${item.path} contains an unrecognised immutable asset reference.`);
    }
    for (const reference of references) {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(reference) || reference.includes('?') || reference.includes('#')) {
        throw new TypeError(`Frontend HTML ${item.path} contains a non-local immutable asset reference.`);
      }
      const resolved = reference.startsWith('/')
        ? reference.slice(1)
        : path.posix.normalize(path.posix.join(path.posix.dirname(item.path), reference));
      const safe = boundedSafeRelativePath(resolved, `Frontend HTML ${item.path} immutable reference`, MAX_PATH_LENGTH);
      if (!safe.startsWith('_app/immutable/') || !manifestOutputs.has(safe)) {
        throw new TypeError(`Frontend HTML ${item.path} references an asset absent from the current Vite manifest: ${safe}.`);
      }
      immutableReferences += 1;
      if (immutableReferences > MAX_REFERENCES) throw new TypeError('Frontend HTML exceeds its immutable-reference limit.');
    }
  }
  if (!immutableReferences) throw new TypeError('Frontend served build contains no immutable asset references.');
  return Object.freeze({ documents: html.length, immutableReferences });
}

function createSnapshotOnce(
  repositoryRoot: string,
  environment: NodeJS.ProcessEnv,
): FrontendBuildIntegritySnapshot {
  const revision = resolvedBuildRevision(repositoryRoot, environment);
  const source = sourceIdentity(repositoryRoot);
  const [client, prerendered] = relatedOutputIdentities(repositoryRoot, [
    'frontend/.svelte-kit/output/client',
    'frontend/.svelte-kit/output/prerendered/pages',
  ]);
  if (!client || !prerendered) throw new TypeError('Frontend build outputs are incomplete.');
  const served = outputIdentity(repositoryRoot, 'frontend/build');
  const manifestPath = path.join(repositoryRoot, 'frontend/.svelte-kit/output/client/.vite/manifest.json');
  const manifestSource = readBoundedStableRegularFileSync(manifestPath, MAX_MANIFEST_BYTES, 'Frontend Vite manifest');
  const manifest = frontendManifestIdentity(manifestSource);
  const manifestOutputs = manifest.outputs;
  const immutableClientFiles = client.files.filter((item) => item.path.startsWith('_app/immutable/'));
  const orderedManifestOutputs = [...manifestOutputs].sort(compareCodeUnits);
  if (JSON.stringify(immutableClientFiles.map((item) => item.path)) !== JSON.stringify(orderedManifestOutputs)) {
    throw new TypeError('Frontend immutable client assets do not exactly match the current Vite manifest.');
  }
  const expectedServed = treeIdentity([
    ...client.files.filter((item) => item.path !== '.vite/manifest.json'),
    ...prerendered.files,
  ]);
  exactFileSet('Frontend served build', served.files, expectedServed.files);
  const html = htmlIntegrity(repositoryRoot, served, manifestOutputs);
  const viteManifestSha256 = sha256Bytes(manifestSource);
  if (revision !== resolvedBuildRevision(repositoryRoot, environment)) {
    throw new TypeError('Frontend source revision changed while build integrity was measured.');
  }
  return Object.freeze({
    format: FRONTEND_BUILD_INTEGRITY_FORMAT,
    version: FRONTEND_BUILD_INTEGRITY_VERSION,
    runtime: Object.freeze({
      node: process.versions.node,
      platform: process.platform,
      architecture: process.arch,
      revision,
    }),
    source,
    served,
    viteManifestSha256,
    manifestOutputs: Object.freeze(orderedManifestOutputs),
    browserTestSupport: browserTestSupport(
      viteManifestSha256,
      manifest.browserModules,
      served,
    ),
    htmlDocuments: html.documents,
    immutableReferences: html.immutableReferences,
  });
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (JSON.stringify(Object.keys(value).sort(compareCodeUnits)) !== JSON.stringify([...keys].sort(compareCodeUnits))) {
    throw new TypeError(`${label} must use its exact fields.`);
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be an ordinary object.`);
  }
  return value as Record<string, unknown>;
}

function parseFileIdentity(value: unknown, label: string): FileIdentity {
  const item = record(value, label);
  exactKeys(item, ['path', 'bytes', 'sha256'], label);
  const safePath = boundedSafeRelativePath(item.path, `${label} path`, MAX_PATH_LENGTH);
  if (!Number.isSafeInteger(item.bytes) || Number(item.bytes) < 0 || Number(item.bytes) > MAX_FILE_BYTES
    || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(item.sha256)) {
    throw new TypeError(`${label} has invalid byte or digest metadata.`);
  }
  return Object.freeze({ path: safePath, bytes: Number(item.bytes), sha256: item.sha256 });
}

function parseTreeIdentity(value: unknown, label: string): TreeIdentity {
  const item = record(value, label);
  exactKeys(item, ['digestSha256', 'fileCount', 'totalBytes', 'files'], label);
  if (!Array.isArray(item.files) || item.files.length < 1 || item.files.length > MAX_FILES) {
    throw new TypeError(`${label} has an invalid file inventory.`);
  }
  const files = item.files.map((file, index) => parseFileIdentity(file, `${label} file ${index + 1}`));
  const rebuilt = treeIdentity(files);
  if (item.digestSha256 !== rebuilt.digestSha256
    || item.fileCount !== rebuilt.fileCount
    || item.totalBytes !== rebuilt.totalBytes
    || JSON.stringify(files) !== JSON.stringify(rebuilt.files)) {
    throw new TypeError(`${label} metadata does not match its exact sorted file inventory.`);
  }
  return rebuilt;
}

export function parseFrontendBuildIntegritySnapshot(source: string): FrontendBuildIntegritySnapshot {
  const parsed = parseBoundedJsonObject(source, {
    label: 'Frontend build-integrity marker',
    maximumBytes: MAX_MARKER_BYTES,
  });
  exactKeys(parsed, [
    'format', 'version', 'runtime', 'source', 'served', 'viteManifestSha256',
    'manifestOutputs', 'browserTestSupport', 'htmlDocuments', 'immutableReferences',
  ], 'Frontend build-integrity marker');
  if (parsed.format !== FRONTEND_BUILD_INTEGRITY_FORMAT || parsed.version !== FRONTEND_BUILD_INTEGRITY_VERSION) {
    throw new TypeError('Frontend build-integrity marker uses an unsupported format or version.');
  }
  const runtime = record(parsed.runtime, 'Frontend build-integrity runtime');
  exactKeys(runtime, ['node', 'platform', 'architecture', 'revision'], 'Frontend build-integrity runtime');
  if (typeof runtime.node !== 'string' || !/^\d+\.\d+\.\d+$/u.test(runtime.node)
    || typeof runtime.platform !== 'string' || !runtime.platform
    || typeof runtime.architecture !== 'string' || !runtime.architecture
    || typeof runtime.revision !== 'string' || !(/^[a-f0-9]{7,64}$/u.test(runtime.revision) || runtime.revision === 'local')) {
    throw new TypeError('Frontend build-integrity runtime is malformed.');
  }
  if (!Array.isArray(parsed.manifestOutputs)
    || parsed.manifestOutputs.length < 1
    || parsed.manifestOutputs.length > MAX_FILES) {
    throw new TypeError('Frontend build-integrity manifest output inventory is malformed.');
  }
  const manifestOutputs = parsed.manifestOutputs.map((value, index) => {
    const output = boundedSafeRelativePath(value, `Frontend manifest output ${index + 1}`, MAX_PATH_LENGTH);
    if (!output.startsWith('_app/immutable/')) {
      throw new TypeError('Frontend build-integrity manifest output is outside the immutable asset tree.');
    }
    return output;
  });
  if (new Set(manifestOutputs).size !== manifestOutputs.length
    || JSON.stringify(manifestOutputs) !== JSON.stringify([...manifestOutputs].sort(compareCodeUnits))) {
    throw new TypeError('Frontend build-integrity manifest outputs must be unique and sorted.');
  }
  if (typeof parsed.viteManifestSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(parsed.viteManifestSha256)
    || !Number.isSafeInteger(parsed.htmlDocuments) || Number(parsed.htmlDocuments) < 1
    || !Number.isSafeInteger(parsed.immutableReferences) || Number(parsed.immutableReferences) < 1
    || Number(parsed.immutableReferences) > MAX_REFERENCES) {
    throw new TypeError('Frontend build-integrity summary is malformed.');
  }
  const retainedSource = parseTreeIdentity(parsed.source, 'Frontend build-integrity source');
  const served = parseTreeIdentity(parsed.served, 'Frontend build-integrity served build');
  const support = record(parsed.browserTestSupport, 'Frontend build-integrity browser-test support');
  exactKeys(support, ['digestSha256', 'modules'], 'Frontend build-integrity browser-test support');
  if (!Array.isArray(support.modules) || support.modules.length < 1 || support.modules.length > MAX_MANIFEST_ENTRIES
    || typeof support.digestSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(support.digestSha256)) {
    throw new TypeError('Frontend build-integrity browser-test support is malformed.');
  }
  const servedByPath = new Map(served.files.map((item) => [item.path, item]));
  const modules = support.modules.map((value, index) => {
    const item = record(value, `Frontend browser-test module ${index + 1}`);
    exactKeys(item, ['source', 'output', 'bytes', 'sha256'], `Frontend browser-test module ${index + 1}`);
    const moduleSource = boundedSafeRelativePath(item.source, `Frontend browser-test module ${index + 1} source`, MAX_PATH_LENGTH);
    const output = boundedSafeRelativePath(item.output, `Frontend browser-test module ${index + 1} output`, MAX_PATH_LENGTH);
    const servedFile = servedByPath.get(output);
    if (!moduleSource.startsWith('src/') || !output.startsWith('_app/immutable/') || !output.endsWith('.js')
      || !manifestOutputs.includes(output) || !servedFile
      || item.bytes !== servedFile.bytes || item.sha256 !== servedFile.sha256) {
      throw new TypeError(`Frontend browser-test module ${index + 1} does not match the declared served build.`);
    }
    return Object.freeze({ source: moduleSource, output, bytes: servedFile.bytes, sha256: servedFile.sha256 });
  });
  if (new Set(modules.map((item) => item.source)).size !== modules.length
    || JSON.stringify(modules.map((item) => item.source)) !== JSON.stringify(modules.map((item) => item.source).sort(compareCodeUnits))) {
    throw new TypeError('Frontend browser-test modules must use unique sorted source identities.');
  }
  const rebuiltSupport = browserTestSupport(parsed.viteManifestSha256, modules, served);
  if (support.digestSha256 !== rebuiltSupport.digestSha256) {
    throw new TypeError('Frontend browser-test support does not match its manifest and served-build identity.');
  }
  return Object.freeze({
    format: FRONTEND_BUILD_INTEGRITY_FORMAT,
    version: FRONTEND_BUILD_INTEGRITY_VERSION,
    runtime: Object.freeze({
      node: runtime.node,
      platform: runtime.platform as NodeJS.Platform,
      architecture: runtime.architecture,
      revision: runtime.revision,
    }),
    source: retainedSource,
    served,
    viteManifestSha256: parsed.viteManifestSha256,
    manifestOutputs: Object.freeze(manifestOutputs),
    browserTestSupport: rebuiltSupport,
    htmlDocuments: Number(parsed.htmlDocuments),
    immutableReferences: Number(parsed.immutableReferences),
  });
}

export function frontendProductionChunk(
  snapshot: FrontendBuildIntegritySnapshot,
  source: string,
): string {
  const safeSource = boundedSafeRelativePath(source, 'Frontend production module source', MAX_PATH_LENGTH);
  const module = snapshot.browserTestSupport.modules.find((item) => item.source === safeSource);
  if (!module) {
    throw new TypeError(`Frontend build browser-test support does not declare a production chunk for ${safeSource}.`);
  }
  return `/${module.output}`;
}

function renderSnapshot(snapshot: FrontendBuildIntegritySnapshot): string {
  const rendered = `${JSON.stringify(snapshot, null, 2)}\n`;
  if (Buffer.byteLength(rendered, 'utf8') > MAX_MARKER_BYTES) {
    throw new TypeError('Frontend build-integrity marker exceeds its byte limit.');
  }
  return rendered;
}

export function createFrontendBuildIntegritySnapshot(
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  environment: NodeJS.ProcessEnv = process.env,
): FrontendBuildIntegritySnapshot {
  const first = createSnapshotOnce(repositoryRoot, environment);
  const second = createSnapshotOnce(repositoryRoot, environment);
  if (renderSnapshot(first) !== renderSnapshot(second)) {
    throw new TypeError('Frontend build inputs or outputs changed while integrity was measured.');
  }
  return second;
}

export function recordFrontendBuildIntegrity(
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  environment: NodeJS.ProcessEnv = process.env,
): FrontendBuildIntegritySnapshot {
  const snapshot = createFrontendBuildIntegritySnapshot(repositoryRoot, environment);
  const marker = path.join(repositoryRoot, FRONTEND_BUILD_INTEGRITY_MARKER);
  mkdirSync(path.dirname(marker), { recursive: true });
  const temporary = `${marker}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, renderSnapshot(snapshot), { encoding: 'utf8', flag: 'wx' });
    renameSync(temporary, marker);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
  return snapshot;
}

export function assertFrontendBuildIntegrity(
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  environment: NodeJS.ProcessEnv = process.env,
): FrontendBuildIntegritySnapshot {
  const marker = path.join(repositoryRoot, FRONTEND_BUILD_INTEGRITY_MARKER);
  const retained = parseFrontendBuildIntegritySnapshot(readBoundedStableRegularFileSync(
    marker,
    MAX_MARKER_BYTES,
    'Frontend build-integrity marker',
  ).toString('utf8'));
  const currentRuntime = Object.freeze({
    node: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
    revision: resolvedBuildRevision(repositoryRoot, environment),
  });
  const source = sourceIdentity(repositoryRoot);
  const served = outputIdentity(repositoryRoot, 'frontend/build');
  const html = htmlIntegrity(repositoryRoot, served, new Set(retained.manifestOutputs));
  if (JSON.stringify(retained.runtime) !== JSON.stringify(currentRuntime)
    || JSON.stringify(retained.source) !== JSON.stringify(source)
    || JSON.stringify(retained.served) !== JSON.stringify(served)
    || retained.htmlDocuments !== html.documents
    || retained.immutableReferences !== html.immutableReferences) {
    throw new TypeError('Reusable frontend build is stale or mixed. Run npm run build before using built browser checks.');
  }
  return retained;
}

export function cleanFrontendBuildArtifacts(
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
): void {
  for (const relative of [
    'frontend/build',
    'frontend/.svelte-kit/output',
    FRONTEND_BUILD_INTEGRITY_MARKER,
  ]) {
    rmSync(path.join(repositoryRoot, relative), { recursive: true, force: true });
  }
}

export function main(args = process.argv.slice(2)): number {
  try {
    if (args.length !== 1 || !['--clean', '--record', '--check'].includes(args[0]!)) {
      throw new TypeError('Usage: node tools/frontend-build-integrity.mts --clean|--record|--check');
    }
    if (args[0] === '--clean') {
      cleanFrontendBuildArtifacts();
      process.stdout.write('Previous frontend build outputs removed.\n');
      return 0;
    }
    const snapshot = args[0] === '--record'
      ? recordFrontendBuildIntegrity()
      : assertFrontendBuildIntegrity();
    process.stdout.write(
      `Frontend build integrity ${args[0] === '--record' ? 'recorded' : 'verified'}: `
      + `${snapshot.served.fileCount} served files, ${snapshot.served.totalBytes} bytes, `
      + `${snapshot.htmlDocuments} HTML documents, ${snapshot.immutableReferences} immutable references.\n`,
    );
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Frontend build-integrity check failed.'}\n`);
    return 2;
  }
}

if (DIRECT_INVOCATION) {
  process.exitCode = main();
}
