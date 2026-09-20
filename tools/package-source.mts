// Frozen source admission and compilation shared by all executable packages.
// Package owners supply their entry points and admitted source policy.

import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, realpath, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { readBoundedRegularFileWithin } from '../lib/bounded-file.mts';
import { boundedSafeRelativePath, requireJsonRecord as record } from './maintainer-tool-helpers.mts';
import { MAX_PACKAGE_PROCESSING_ITEMS, MAX_PACKAGE_GRAPH_BYTES, MAX_PACKAGE_SOURCE_BYTES, MAX_PACKAGE_FILE_BYTES, MAX_PACKAGE_COMPILER_CONTEXT_BYTES, MAX_PACKAGE_COMPILER_CONTEXT_FILE_BYTES, PACKAGE_PROCESS_TIMEOUT_MS } from './package-resource-bounds.mts';

const execFile = promisify(execFileCallback);
type JsonRecord = Record<string, unknown>;

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

type PackageSourceIdentity = Readonly<{ bytes: Buffer; digestSha256: string }>;

export type PackageSourceSnapshot = ReadonlyMap<string, PackageSourceIdentity>;

export type PackageSnapshotState = {
  totalBytes: number;
  maximumBytes?: number;
  maximumFileBytes?: number;
};

type PackageCompilerClosure = Readonly<{
  sources: readonly string[];
  contextFiles: readonly string[];
}>;

const COMPILABLE_SOURCE_PATTERN = /\.(?:mts|ts)$/u;

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

export function isPackageCompilerInputPath(relativePath: string): boolean {
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

export function packageProcessEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const environment = { ...process.env, ...overrides };
  delete environment.NODE_OPTIONS;
  delete environment.NODE_PATH;
  return environment;
}

export async function copyPackageFile(stagingRoot: string, destination: string, bytes: Buffer): Promise<void> {
  const safeDestination = safeRelativePath(destination, 'Package destination');
  const destinationPath = path.join(stagingRoot, safeDestination);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await writeFile(destinationPath, bytes, { flag: 'wx', mode: 0o644 });
}

export async function capturePackageSourceSnapshot(
  repositoryRoot: string,
  sources: readonly string[],
  state?: PackageSnapshotState,
): Promise<PackageSourceSnapshot> {
  const snapshot = new Map<string, PackageSourceIdentity>();
  const maximumFileBytes = state?.maximumFileBytes ?? MAX_PACKAGE_FILE_BYTES;
  const maximumBytes = state?.maximumBytes ?? MAX_PACKAGE_SOURCE_BYTES;
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
        throw new TypeError('Package sources exceed the aggregate byte limit.');
      }
    }
    snapshot.set(safeSource, Object.freeze({
      bytes,
      digestSha256: createHash('sha256').update(bytes).digest('hex'),
    }));
  }
  return snapshot;
}

export async function assertPackageSourceSnapshot(
  repositoryRoot: string,
  snapshot: PackageSourceSnapshot,
  maximumFileBytes = MAX_PACKAGE_FILE_BYTES,
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
      throw new TypeError(`${source} changed during Package assembly.`, { cause });
    }
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== identity.digestSha256) {
      throw new TypeError(`${source} changed during Package assembly.`);
    }
  }
}

export async function materializePackageSourceSnapshot(
  sourceRoot: string,
  snapshot: PackageSourceSnapshot,
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

export async function discoverPackageCompilerClosure(
  inputRoot: string,
  temporaryRoot: string,
  entrySources: readonly string[],
  options: Readonly<{ acceptsSource: (source: string) => boolean; contextFiles?: readonly string[] }>,
): Promise<PackageCompilerClosure> {
  const canonicalInputRoot = await realpath(inputRoot);
  const acceptsSource = options.acceptsSource;
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
      timeout: PACKAGE_PROCESS_TIMEOUT_MS,
      killSignal: 'SIGTERM',
      maxBuffer: MAX_PACKAGE_GRAPH_BYTES,
      env: packageProcessEnvironment({ NODE_ENV: 'production' }),
    }));
  } catch (error) {
    const commandError = error && typeof error === 'object' ? error as { stderr?: unknown; stdout?: unknown } : {};
    const output = [commandError.stderr, commandError.stdout]
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
      ?.trim()
      .slice(0, 4_000);
    throw new TypeError(`Package TypeScript source-closure discovery failed${output ? `: ${output}` : '.'}`);
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
      throw new TypeError(`Package compiler source closure escaped its configured input root at ${path.basename(line.trim()).slice(0, 160)}.`);
    }
    if (acceptsSource(relative)) {
      selected.add(relative);
      continue;
    }
    if ((options.contextFiles ?? []).includes(relative) || relative === 'package.json') continue;
    if (!isPackageCompilerInputPath(relative)) {
      throw new TypeError(`Package compiler source closure contains unsupported input ${relative}.`);
    }
    contextFiles.add(relative);
    for (const manifest of compilerPackageManifests(relative)) contextFiles.add(manifest);
  }
  if (selected.size > MAX_PACKAGE_PROCESSING_ITEMS) {
    throw new TypeError(`Package compiler source closure exceeds the ${MAX_PACKAGE_PROCESSING_ITEMS}-item processing limit.`);
  }
  return Object.freeze({
    sources: Object.freeze([...selected].sort()),
    contextFiles: Object.freeze([...contextFiles].sort()),
  });
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
      timeout: PACKAGE_PROCESS_TIMEOUT_MS,
      killSignal: 'SIGTERM',
      maxBuffer: 4 * 1024 * 1024,
      env: packageProcessEnvironment({ NODE_ENV: 'production' }),
    });
  } catch (error) {
    const commandError = error && typeof error === 'object' ? error as { stderr?: unknown; stdout?: unknown } : {};
    const output = [commandError.stderr, commandError.stdout]
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
      ?.trim()
      .slice(0, 4_000);
    throw new TypeError(`Package TypeScript compilation failed${output ? `: ${output}` : '.'}`);
  }
}

export async function emittedPackageFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  let entries = 0;
  async function visit(relative: string, depth: number) {
    if (depth > 20) throw new Error('Package output nesting exceeds its bound.');
    for (const item of await readdir(path.join(directory, relative), { withFileTypes: true })) {
      if (++entries > MAX_PACKAGE_PROCESSING_ITEMS * 2) throw new Error('Package output inventory exceeds its processing bound.');
      const name = boundedSafeRelativePath(path.posix.join(relative, item.name), 'Package output');
      // npm owns these installation-only files; neither belongs in an archive.
      if (name === 'package-lock.json' || name === 'node_modules/.package-lock.json' || name === 'node_modules/.bin') continue;
      if (item.isDirectory()) await visit(name, depth + 1);
      else if (item.isFile()) files.push(name);
      else throw new Error('Package contains a non-regular output.');
      if (files.length > MAX_PACKAGE_PROCESSING_ITEMS) throw new Error('Package exceeds its file-processing bound.');
    }
  }
  await visit('', 0);
  return files.sort();
}

export function validateCompiledPackageFiles(
  packResult: JsonRecord,
  requiredEntries: readonly string[] = [],
  options: Readonly<{ exact?: boolean }> = {},
): readonly string[] {
  if (!Array.isArray(packResult.files) || packResult.files.length === 0 || packResult.files.length > MAX_PACKAGE_PROCESSING_ITEMS) {
    const observed = Array.isArray(packResult.files) ? packResult.files.length : 0;
    throw new TypeError(`Packed package contains ${observed} entries; expected between 1 and ${MAX_PACKAGE_PROCESSING_ITEMS}.`);
  }
  const entries = Object.freeze(packResult.files.map((entry, index) => (
    safeRelativePath(record(entry, `Packed entry ${index + 1}`).path, `Packed entry ${index + 1} path`)
  )));
  if (new Set(entries).size !== entries.length || options.exact && entries.length !== requiredEntries.length) {
    throw new TypeError('Packed package differs from its complete compiled output inventory.');
  }
  for (const required of requiredEntries) {
    if (!entries.includes(required)) throw new TypeError(`Packed package is missing ${required}.`);
  }
  if (entries.some((entry) => /^(?:e2e|netlify|test|tools|frontend\/src\/routes)(?:\/|$)/u.test(entry))) {
    throw new TypeError('Packed package contains an excluded application or test path.');
  }
  if (entries.some((entry) => /\.(?:[cm]?ts|svelte|map)$/u.test(entry))) {
    throw new TypeError('Packed package contains source or source-map files instead of compiled runtime files.');
  }
  return entries;
}
