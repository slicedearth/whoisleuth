#!/usr/bin/env node

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { accessSync, constants as fsConstants, readdirSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireJsonRecord as record } from './maintainer-tool-helpers.mts';

type JsonRecord = Record<string, unknown>;
type WritableLike = { write(value: string): unknown };
type MainOptions = Readonly<{
  repositoryRoot?: string;
  runtimeVersion?: string;
  stdout?: WritableLike;
  stderr?: WritableLike;
}>;

type Version = Readonly<{ major: number; minor: number; patch: number }>;
export type UnitTestExecutable = 'bash' | 'zsh' | 'fish' | 'pwsh';
type ExecutableProbe = (
  executable: string,
  args: readonly string[],
  options: Readonly<{
    cwd: string;
    encoding: 'utf8';
    env: NodeJS.ProcessEnv;
    input: string;
    maxBuffer: number;
    timeout: number;
    killSignal: 'SIGKILL';
  }>,
) => Pick<SpawnSyncReturns<string>, 'error' | 'signal' | 'status' | 'stderr'>;

const UNIT_TEST_EXECUTABLE_REQUIREMENTS: Readonly<Record<UnitTestExecutable, Readonly<{
  environmentVariable: string;
  probeArguments: readonly string[];
}>>> = Object.freeze({
  bash: Object.freeze({
    environmentVariable: 'WHOISLEUTH_VERIFICATION_BASH',
    probeArguments: Object.freeze(['--noprofile', '--norc', '-c', 'exit 0']),
  }),
  zsh: Object.freeze({
    environmentVariable: 'WHOISLEUTH_VERIFICATION_ZSH',
    probeArguments: Object.freeze(['-f', '-c', 'exit 0']),
  }),
  fish: Object.freeze({
    environmentVariable: 'WHOISLEUTH_VERIFICATION_FISH',
    probeArguments: Object.freeze(['--no-config', '--private', '-c', 'exit 0']),
  }),
  pwsh: Object.freeze({
    environmentVariable: 'WHOISLEUTH_VERIFICATION_PWSH',
    probeArguments: Object.freeze(['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'exit 0']),
  }),
});

export const UNIT_TEST_EXECUTABLES = Object.freeze(
  Object.keys(UNIT_TEST_EXECUTABLE_REQUIREMENTS) as UnitTestExecutable[],
);

export const MAX_TOOLCHAIN_INPUT_BYTES = 2 * 1024 * 1024;
// A startup hang guard, not a shell-performance requirement. Probe once before
// concurrent test workers start; real completion operations have their own guard.
const EXECUTABLE_PROBE_TIMEOUT_MS = 60_000;
const EXECUTABLE_PROBE_OUTPUT_BYTES = 4_096;

function defaultExecutableProbe(
  executable: string,
  args: readonly string[],
  options: Parameters<ExecutableProbe>[2],
): ReturnType<ExecutableProbe> {
  return spawnSync(executable, args, options);
}

function executableCandidates(
  executable: UnitTestExecutable,
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  cwd = process.cwd(),
): readonly string[] {
  if (!Object.hasOwn(UNIT_TEST_EXECUTABLE_REQUIREMENTS, executable)) {
    throw new TypeError(`Unsupported unit-test executable ${String(executable)}.`);
  }
  const requirement = UNIT_TEST_EXECUTABLE_REQUIREMENTS[executable];
  const configured = environment[requirement.environmentVariable]?.trim();
  if (configured) return Object.freeze([path.resolve(cwd, configured)]);
  const filename = platform === 'win32' ? `${executable}.exe` : executable;
  return Object.freeze((environment.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
    .map((directory) => path.resolve(cwd, directory, filename)));
}

function canExecuteFile(candidate: string): boolean {
  try {
    accessSync(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveUnitTestExecutables(
  requested: readonly UnitTestExecutable[] = UNIT_TEST_EXECUTABLES,
  options: Readonly<{
    environment?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    cwd?: string;
    probe?: ExecutableProbe;
    canExecute?: (candidate: string) => boolean;
  }> = {},
): ReadonlyMap<UnitTestExecutable, string> {
  const environment = options.environment ?? process.env;
  const platform = options.platform ?? process.platform;
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const probe = options.probe ?? defaultExecutableProbe;
  const canExecute = options.canExecute ?? canExecuteFile;
  const resolved = new Map<UnitTestExecutable, string>();
  const failures: string[] = [];

  for (const executable of [...new Set(requested)]) {
    const candidates = executableCandidates(executable, environment, platform, cwd);
    const requirement = UNIT_TEST_EXECUTABLE_REQUIREMENTS[executable];
    const candidate = candidates.find(canExecute);
    if (!candidate) {
      failures.push(`${executable}: not found as an executable on PATH`);
      continue;
    }
    const child = probe(candidate, requirement.probeArguments, {
      cwd,
      encoding: 'utf8',
      env: { ...environment },
      input: '',
      maxBuffer: EXECUTABLE_PROBE_OUTPUT_BYTES,
      timeout: EXECUTABLE_PROBE_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });
    if (child.error) {
      failures.push((child.error as NodeJS.ErrnoException).code === 'ETIMEDOUT'
        ? `${executable}: startup probe exceeded its ${EXECUTABLE_PROBE_TIMEOUT_MS} ms hang guard and was terminated`
        : `${executable}: failed to launch (${child.error.message.slice(0, 240)})`);
      continue;
    }
    if (child.signal || child.status !== 0) {
      const detail = typeof child.stderr === 'string' ? child.stderr.trim().slice(0, 240) : '';
      failures.push(`${executable}: probe ${child.signal ? `was terminated by ${child.signal}` : `exited ${String(child.status)}`}${detail ? ` (${detail})` : ''}`);
      continue;
    }
    resolved.set(executable, candidate);
  }
  if (failures.length > 0) {
    throw new Error(`Unit verification prerequisites are unavailable:\n${failures.map((failure) => `- ${failure}`).join('\n')}.`);
  }
  return resolved;
}

export function unitTestExecutableEnvironment(
  resolved: ReadonlyMap<UnitTestExecutable, string>,
  environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const output = { ...environment };
  for (const [executable, filename] of resolved) {
    output[UNIT_TEST_EXECUTABLE_REQUIREMENTS[executable].environmentVariable] = filename;
  }
  return output;
}

export function unitTestExecutablePath(
  executable: UnitTestExecutable,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  // The suite entry point probes usability before starting workers. Resolving
  // that selection must not launch another shell under concurrent test load.
  // Directly selected tests still exercise the real shell and check its result.
  const candidate = executableCandidates(executable, environment, process.platform).find(canExecuteFile);
  if (!candidate) throw new Error(`${executable}: not found as an executable on PATH or at its configured path.`);
  return candidate;
}

export function runUnitTests(
  nodeArguments: readonly string[],
  options: Readonly<{ cwd?: string; environment?: NodeJS.ProcessEnv; probeShells?: boolean }> = {},
): number {
  if (nodeArguments[0] !== '--test') throw new TypeError('Unit execution requires Node test-runner arguments beginning with --test.');
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const environment = options.environment ?? process.env;
  const resolved = resolveUnitTestExecutables(options.probeShells === false ? [] : undefined, { cwd, environment });
  const result = spawnSync(process.execPath, [...nodeArguments], {
    cwd,
    env: unitTestExecutableEnvironment(resolved, environment),
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Unit test runner was terminated by ${result.signal}.`);
  return result.status ?? 2;
}

/** Test names declare execution cost; ordinary files need no registration. */
export function nodeTestFiles(lane: 'unit' | 'integration' | 'all', cwd = process.cwd()): readonly string[] {
  const files = readdirSync(path.join(cwd, 'test'), { withFileTypes: true })
    .filter(entry => entry.isFile() && /^[a-zA-Z0-9._-]+\.test\.mts$/u.test(entry.name))
    .map(entry => `test/${entry.name}`)
    .filter(file => lane === 'all' || file.endsWith('.integration.test.mts') === (lane === 'integration'))
    .sort();
  if (!files.length) throw new Error(`No ${lane} tests were discovered.`);
  return Object.freeze(files);
}

function parseVersion(value: unknown, label: string): Version {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a semantic version.`);
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/u.exec(value);
  if (!match) throw new TypeError(`${label} must be an exact semantic version.`);
  return Object.freeze({ major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) });
}

function parseDeclaredMinimum(value: unknown, label: string): Version {
  if (typeof value !== 'string') throw new TypeError(`${label} must declare a semantic version.`);
  const match = /^\^(\d+\.\d+\.\d+)$/u.exec(value);
  if (!match) throw new TypeError(`${label} must use one caret-prefixed semantic version.`);
  return parseVersion(match[1], label);
}

function compareVersions(left: Version, right: Version): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

function satisfiesCaret(version: Version, minimum: Version): boolean {
  if (compareVersions(version, minimum) < 0) return false;
  if (minimum.major > 0) return version.major === minimum.major;
  if (minimum.minor > 0) return version.major === 0 && version.minor === minimum.minor;
  return version.major === 0 && version.minor === 0 && version.patch === minimum.patch;
}

export function satisfiesCaretAlternatives(versionValue: string, rangeValue: unknown): boolean {
  const version = parseVersion(versionValue, 'Resolved TypeScript');
  if (typeof rangeValue !== 'string' || rangeValue.length > 256) return false;
  const alternatives = rangeValue.split('||').map((entry) => entry.trim()).filter(Boolean);
  return alternatives.length > 0 && alternatives.every((entry) => /^\^\d+\.\d+\.\d+$/u.test(entry))
    && alternatives.some((entry) => satisfiesCaret(version, parseVersion(entry.slice(1), 'TypeScript peer range')));
}

function dependencyVersion(manifest: JsonRecord, field: string, dependency: string, label: string): string {
  const dependencies = record(manifest[field], `${label} ${field}`);
  const value = dependencies[dependency];
  if (typeof value !== 'string') throw new TypeError(`${label} must declare ${dependency}.`);
  return value;
}

function packageEntry(lockfile: JsonRecord, installPath: string): JsonRecord {
  const packages = record(lockfile.packages, 'package-lock.json packages');
  return record(packages[installPath], `package-lock.json ${installPath}`);
}

export function buildToolchainCompatibilityReport(input: Readonly<{
  nvmrc: string;
  runtimeVersion: string;
  packageManifest: unknown;
  frontendManifest: unknown;
  lockfile: unknown;
}>) {
  const expectedRuntime = input.nvmrc.trim();
  const expected = parseVersion(expectedRuntime, '.nvmrc');
  const runtime = parseVersion(input.runtimeVersion, 'Running Node.js');
  if (compareVersions(runtime, expected) !== 0) {
    throw new TypeError(`Running Node.js ${input.runtimeVersion} does not match .nvmrc ${expectedRuntime}.`);
  }

  const packageManifest = record(input.packageManifest, 'package.json');
  const frontendManifest = record(input.frontendManifest, 'frontend/package.json');
  const lockfile = record(input.lockfile, 'package-lock.json');

  const nodeTypesDeclaration = dependencyVersion(packageManifest, 'devDependencies', '@types/node', 'package.json');
  const nodeTypesMinimum = parseDeclaredMinimum(nodeTypesDeclaration, 'package.json @types/node');
  const nodeTypesVersion = packageEntry(lockfile, 'node_modules/@types/node').version;
  const resolvedNodeTypes = parseVersion(nodeTypesVersion, 'Resolved @types/node');
  if (nodeTypesMinimum.major !== expected.major || resolvedNodeTypes.major !== expected.major) {
    throw new TypeError(`@types/node must remain on the .nvmrc major (${expected.major}).`);
  }

  const rootTypeScript = dependencyVersion(packageManifest, 'devDependencies', 'typescript', 'package.json');
  const frontendTypeScript = dependencyVersion(frontendManifest, 'devDependencies', 'typescript', 'frontend/package.json');
  if (rootTypeScript !== frontendTypeScript) {
    throw new TypeError('Root and frontend TypeScript declarations must match exactly.');
  }
  const resolvedTypeScriptValue = packageEntry(lockfile, 'node_modules/typescript').version;
  const resolvedTypeScript = parseVersion(resolvedTypeScriptValue, 'Resolved TypeScript');
  const declaredTypeScript = parseDeclaredMinimum(rootTypeScript, 'TypeScript declaration');
  if (!satisfiesCaret(resolvedTypeScript, declaredTypeScript)) {
    throw new TypeError('Resolved TypeScript does not satisfy the declared root version.');
  }

  const peerOwners = ['node_modules/@sveltejs/kit', 'node_modules/svelte-check'] as const;
  const peerRanges = peerOwners.map((installPath) => {
    const peerDependencies = record(packageEntry(lockfile, installPath).peerDependencies, `${installPath} peerDependencies`);
    const range = peerDependencies.typescript;
    if (!satisfiesCaretAlternatives(String(resolvedTypeScriptValue), range)) {
      throw new TypeError(`Resolved TypeScript ${String(resolvedTypeScriptValue)} is outside ${installPath}'s peer range.`);
    }
    return Object.freeze({ installPath, range: String(range) });
  });

  return Object.freeze({
    node: expectedRuntime,
    nodeTypes: String(nodeTypesVersion),
    typeScript: String(resolvedTypeScriptValue),
    typeScriptPeerRanges: Object.freeze(peerRanges),
  });
}

async function readBounded(filename: string): Promise<string> {
  const metadata = await stat(filename);
  if (!metadata.isFile() || metadata.size > MAX_TOOLCHAIN_INPUT_BYTES) {
    throw new TypeError(`${path.basename(filename)} is missing or exceeds the toolchain-check byte limit.`);
  }
  return readFile(filename, 'utf8');
}

async function readBoundedJson(filename: string): Promise<unknown> {
  const source = await readBounded(filename);
  try {
    return JSON.parse(source);
  } catch {
    throw new TypeError(`${path.basename(filename)} is not valid JSON.`);
  }
}

export function formatToolchainCompatibilityReport(report: ReturnType<typeof buildToolchainCompatibilityReport>): string {
  return [
    'WHOISleuth toolchain compatibility check',
    `Node.js: ${report.node}`,
    `Node.js types: ${report.nodeTypes}`,
    `TypeScript: ${report.typeScript}`,
    `Svelte TypeScript peer ranges: ${report.typeScriptPeerRanges.length} compatible`,
  ].join('\n');
}

export function parseArguments(args: readonly string[]): void {
  if (args.length > 0) throw new TypeError('Usage: npm run toolchain:check');
}

export async function main(args = process.argv.slice(2), options: MainOptions = {}): Promise<number> {
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;
  try {
    if (args[0] === '--unit-tests') {
      if (args[1]?.startsWith('--lane=')) {
        const lane = args[1].slice('--lane='.length);
        if (lane !== 'unit' && lane !== 'integration' && lane !== 'all') throw new TypeError('Test lane must be unit, integration or all.');
        return runUnitTests([...args.slice(2), ...nodeTestFiles(lane, options.repositoryRoot)], {
          cwd: options.repositoryRoot ?? process.cwd(),
          probeShells: lane !== 'unit',
        });
      }
      return runUnitTests(args.slice(1), { cwd: options.repositoryRoot ?? process.cwd() });
    }
    parseArguments(args);
    const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
    const [nvmrc, packageManifest, frontendManifest, lockfile] = await Promise.all([
      readBounded(path.join(repositoryRoot, '.nvmrc')),
      readBoundedJson(path.join(repositoryRoot, 'package.json')),
      readBoundedJson(path.join(repositoryRoot, 'frontend/package.json')),
      readBoundedJson(path.join(repositoryRoot, 'package-lock.json')),
    ]);
    const report = buildToolchainCompatibilityReport({
      nvmrc,
      runtimeVersion: options.runtimeVersion || process.versions.node,
      packageManifest,
      frontendManifest,
      lockfile,
    });
    stdout.write(`${formatToolchainCompatibilityReport(report)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`${error instanceof Error ? error.message : 'Toolchain compatibility check failed.'}\n`);
    return 2;
  }
}

const invokedAsScript = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedAsScript) process.exitCode = await main();
