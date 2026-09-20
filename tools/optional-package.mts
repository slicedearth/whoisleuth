import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { MAX_CLI_PACKAGE_PROCESSING_ITEMS, validatePackedCliFiles } from './cli-package.mts';
import { boundedSafeRelativePath, requireJsonRecord as object } from './maintainer-tool-helpers.mts';
import { buildThirdPartyNotices, productionDependencyInstallPaths } from './third-party-notices.mts';
import { readBoundedRegularFileWithin } from '../lib/bounded-file.mts';

const MAX_BUNDLED_FILE_BYTES = 16 * 1024 * 1024;
const MAX_BUNDLED_TOTAL_BYTES = 320 * 1024 * 1024;
type PackageFileIdentity = Readonly<{ bytes: number; sha256: string }>;

/** Both bundled companions install with --omit=optional on every platform. */
export function buildOptionalPackageNotices(root: string, dependencies: readonly string[], scopeLabel: string, lockfileValue: unknown): Promise<string> {
  return buildThirdPartyNotices(root, { directDependencyNames: dependencies, scopeLabel, lockfileValue, omitOptionalDependencies: true });
}

/** Shared closure mechanics; each optional package retains its own entry points and policy. */
export function optionalPackageInputs(value: unknown, policy: Readonly<{
  requiredSources: readonly string[]; acceptsSource: (source: string) => boolean; dependencies: readonly string[];
}>) {
  const graph = object(value, 'Package graph');
  if (!Array.isArray(graph.modules) || !graph.modules.length || graph.modules.length > MAX_CLI_PACKAGE_PROCESSING_ITEMS) throw new Error('Package graph exceeds its processing bound.');
  const sources = new Set<string>(), dependencies = new Set<string>();
  function dependency(source: string) {
    const parts = source.split('/'), name = parts[1]?.startsWith('@') ? parts.slice(1, 3).join('/') : parts[1]!;
    if (!policy.dependencies.includes(name)) throw new Error(`Unreviewed runtime dependency: ${name}.`);
    dependencies.add(name);
  }
  for (const value of graph.modules) {
    const module = object(value, 'Package module');
    if (!Array.isArray(module.dependencies) || module.dependencies.length > 512) throw new Error('Invalid package dependency list.');
    for (const value of module.dependencies) {
      const edge = object(value, 'Package dependency');
      if (edge.couldNotResolve) throw new Error('A package dependency could not be resolved.');
      if (typeof edge.resolved === 'string' && edge.resolved.startsWith('node_modules/')) dependency(edge.resolved);
    }
    if (module.coreModule === true) continue;
    const source = boundedSafeRelativePath(module.source, 'Package module');
    if (source.startsWith('node_modules/')) dependency(source);
    else if (policy.acceptsSource(source)) sources.add(source);
    else throw new Error(`Package contains an unexpected source: ${source}.`);
  }
  for (const source of policy.requiredSources) if (!sources.has(source)) throw new Error(`Package graph is missing ${source}.`);
  return Object.freeze({ sources: [...sources].sort(), dependencies: [...dependencies].sort() });
}

export function assertInstalledPackageDependencies(installedValue: unknown, reviewedValue: unknown, direct: readonly string[], packageName: string): number {
  const installed = object(object(installedValue, 'Installed lockfile').packages, 'Installed packages');
  const reviewed = object(object(reviewedValue, 'Reviewed lockfile').packages, 'Reviewed packages');
  const allowed = new Set(productionDependencyInstallPaths(reviewedValue, direct).map(location => {
    const entry = object(reviewed[location], 'Reviewed dependency');
    return JSON.stringify([location.split('node_modules/').at(-1), entry.version, entry.integrity]);
  }));
  const entries = Object.entries(installed);
  if (entries.length > MAX_CLI_PACKAGE_PROCESSING_ITEMS) throw new Error('Installed package dependencies exceed their processing bound.');
  let count = 0;
  for (const [location, value] of entries) {
    if (!location || location === `node_modules/${packageName}`) continue;
    boundedSafeRelativePath(location, 'Installed dependency');
    const entry = object(value, 'Installed dependency');
    const name = location.split('node_modules/').at(-1)!;
    if (!allowed.has(JSON.stringify([name, entry.version, entry.integrity]))) {
      throw new Error(`Installed dependency ${name}@${String(entry.version).slice(0, 80)} differs from the reviewed lockfile (version or integrity).`);
    }
    count++;
  }
  for (const name of direct) if (!installed[`node_modules/${name}`]) throw new Error('An installed package dependency is missing.');
  return count;
}

export function optionalPackageLock(manifest: Record<string, unknown>, lockfile: unknown) {
  const dependencies = object(manifest.dependencies, 'Package dependencies');
  const reviewed = object(object(lockfile, 'Reviewed lockfile').packages, 'Reviewed packages');
  const packages: Record<string, unknown> = { '': {
    name: manifest.name, version: manifest.version, license: manifest.license, dependencies, engines: manifest.engines,
    ...(manifest.bundleDependencies ? { bundleDependencies: manifest.bundleDependencies } : {}),
  } };
  for (const location of productionDependencyInstallPaths(lockfile, Object.keys(dependencies))) {
    const entry = object(reviewed[location], 'Reviewed dependency');
    if (typeof entry.resolved !== 'string' || !entry.resolved.startsWith('https://registry.npmjs.org/')
      || typeof entry.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(entry.integrity) || entry.link) throw new Error('Optional package dependency lacks reviewed registry integrity.');
    const { dev: _dev, devOptional: _devOptional, ...retained } = entry;
    packages[location] = retained;
  }
  return { name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true, packages };
}

export async function emittedPackageFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  let entries = 0;
  async function visit(relative: string, depth: number) {
    if (depth > 20) throw new Error('Package output nesting exceeds its bound.');
    for (const item of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      if (++entries > MAX_CLI_PACKAGE_PROCESSING_ITEMS * 2) throw new Error('Package output inventory exceeds its processing bound.');
      const name = boundedSafeRelativePath(path.posix.join(relative, item.name), 'Package output');
      // npm owns these installation-only files; neither belongs in an archive.
      if (name === 'package-lock.json' || name === 'node_modules/.package-lock.json' || name === 'node_modules/.bin') continue;
      if (item.isDirectory()) await visit(name, depth + 1);
      else if (item.isFile()) files.push(name);
      else throw new Error('Package contains a non-regular output.');
      if (files.length > MAX_CLI_PACKAGE_PROCESSING_ITEMS) throw new Error('Package exceeds its file-processing bound.');
    }
  }
  await visit('', 0);
  return files.sort();
}

/** Preserve vendor files as distributed, while application output stays compiled. */
export function validateOptionalPackageFiles(pack: Record<string, unknown>, expected: readonly string[]): readonly string[] {
  if (!Array.isArray(pack.files) || !pack.files.length || pack.files.length > MAX_CLI_PACKAGE_PROCESSING_ITEMS) throw new Error('Optional package inventory exceeds its processing bound.');
  const files = pack.files.map(value => boundedSafeRelativePath(object(value, 'Packed optional entry').path, 'Packed optional path'));
  if (new Set(files).size !== files.length || JSON.stringify([...files].sort()) !== JSON.stringify([...expected].sort())) throw new Error('The optional archive differs from its reviewed file inventory.');
  validatePackedCliFiles({ ...pack, files: pack.files.filter(value => !String(object(value, 'Packed entry').path).startsWith('node_modules/')) }, expected.filter(file => !file.startsWith('node_modules/')));
  return files;
}

export async function captureOptionalPackageFiles(directory: string, files?: readonly string[]): Promise<ReadonlyMap<string, PackageFileIdentity>> {
  const result = new Map<string, PackageFileIdentity>();
  let total = 0;
  for (const file of files ?? await emittedPackageFiles(directory)) {
    const bytes = await readBoundedRegularFileWithin(directory, file, { maximumBytes: MAX_BUNDLED_FILE_BYTES, label: 'Optional package file' });
    if ((total += bytes.byteLength) > MAX_BUNDLED_TOTAL_BYTES) throw new Error('Optional package files exceed their total byte bound.');
    result.set(file, { bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  return result;
}

/** Bundled dependencies need byte verification: npm omits their registry integrity. */
export async function assertInstalledOptionalPackage(directory: string, expected: ReadonlyMap<string, PackageFileIdentity>, installedValue: unknown, reviewedValue: unknown, direct: readonly string[], packageName: string): Promise<number> {
  const actual = await captureOptionalPackageFiles(directory);
  if (actual.size !== expected.size || [...expected].some(([file, value]) => actual.get(file)?.bytes !== value.bytes || actual.get(file)?.sha256 !== value.sha256)) throw new Error('Installed optional package bytes differ from the reviewed archive inputs.');
  const reviewed = object(object(reviewedValue, 'Reviewed lockfile').packages, 'Reviewed packages');
  const prefix = `node_modules/${packageName}/`;
  const required = new Map(productionDependencyInstallPaths(reviewedValue, direct)
    .filter(location => expected.has(`${location}/package.json`)).map(location => [location, object(reviewed[location], 'Reviewed dependency')]));
  const seen = new Set<string>();
  const installed = Object.entries(object(object(installedValue, 'Installed lockfile').packages, 'Installed packages'));
  if (installed.length > MAX_CLI_PACKAGE_PROCESSING_ITEMS) throw new Error('Installed optional dependency inventory exceeds its bound.');
  for (const [location, value] of installed) {
    if (!location || location === `node_modules/${packageName}`) continue;
    const relative = location.startsWith(prefix) ? location.slice(prefix.length) : '';
    const before = required.get(relative), entry = object(value, 'Installed dependency');
    if (!before || entry.inBundle !== true || entry.version !== before.version || entry.integrity !== undefined && entry.integrity !== before.integrity) throw new Error('An installed dependency is outside the verified bundle.');
    seen.add(relative);
  }
  if (seen.size !== required.size || direct.some(name => !seen.has(`node_modules/${name}`))) throw new Error('A bundled runtime dependency is missing.');
  return seen.size;
}
