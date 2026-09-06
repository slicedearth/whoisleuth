#!/usr/bin/env node

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { accessSync, constants as fsConstants } from 'node:fs';
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
export type UnitTestExecutable = 'bash' | 'zsh' | 'pwsh';
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
  pwsh: Object.freeze({
    environmentVariable: 'WHOISLEUTH_VERIFICATION_PWSH',
    probeArguments: Object.freeze(['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'exit 0']),
  }),
});

export const UNIT_TEST_EXECUTABLES = Object.freeze(
  Object.keys(UNIT_TEST_EXECUTABLE_REQUIREMENTS) as UnitTestExecutable[],
);

export const MAX_TOOLCHAIN_INPUT_BYTES = 2 * 1024 * 1024;
const EXECUTABLE_PROBE_TIMEOUT_MS = 5_000;
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
): readonly string[] {
  const requirement = UNIT_TEST_EXECUTABLE_REQUIREMENTS[executable];
  const configured = environment[requirement.environmentVariable]?.trim();
  if (configured) return Object.freeze([path.resolve(configured)]);
  const filename = platform === 'win32' ? `${executable}.exe` : executable;
  return Object.freeze((environment.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
    .map((directory) => path.resolve(directory, filename)));
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
  const canExecute = options.canExecute ?? ((candidate: string) => {
    try {
      accessSync(candidate, fsConstants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
  const resolved = new Map<UnitTestExecutable, string>();
  const failures: string[] = [];

  for (const executable of [...new Set(requested)]) {
    const requirement = UNIT_TEST_EXECUTABLE_REQUIREMENTS[executable];
    if (!requirement) throw new TypeError(`Unsupported unit-test executable ${String(executable)}.`);
    const candidates = executableCandidates(executable, environment, platform);
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
    });
    if (child.error) {
      failures.push(`${executable}: failed to launch (${child.error.message.slice(0, 240)})`);
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
  const resolved = resolveUnitTestExecutables([executable], { environment });
  return resolved.get(executable)!;
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
