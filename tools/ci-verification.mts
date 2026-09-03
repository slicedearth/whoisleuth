#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FULL_SHA = /^[a-f0-9]{40}$/u;

export const CI_QUALITY_SCRIPTS = Object.freeze([
  'toolchain:check',
  'release:check',
  'verification:timing:check',
  'verification:ownership:check',
  'verification:journeys:check',
  'capabilities:check',
  'privacy:check',
  'schema:inventory',
  'test:mutation',
  'licenses:check',
  'providers:policy-check',
  'technology:coverage-check',
  'cli:package:check',
  'architecture:check',
  'dependencies:audit',
  'typecheck',
  'check',
] as const);

export const CI_UNIT_SCRIPTS = Object.freeze([
  'test:coverage',
] as const);

export const CI_BROWSER_PREREQUISITE_SCRIPTS = Object.freeze([
  'build',
  'frontend:loading-report',
  'security:retire',
] as const);

export const CI_HOSTED_ONLY_BROWSER_SCRIPTS = Object.freeze([
  'test:e2e:install',
  'test:e2e:shard',
  'frontend:authenticated-loading-report',
  'test:e2e:summary',
  'verification:artifacts',
] as const);

export const CI_BROWSER_HEALTH_SCRIPTS = Object.freeze([
  'test:e2e:aggregate',
  'test:e2e:aggregate',
  'verification:timing:update-candidate',
] as const);

export const CI_CLI_RUNTIME_NODE_MAJOR = 26;
export const CI_CLI_RUNTIME_SCRIPTS = Object.freeze([
  'cli:package:check',
] as const);

export type HostedCiScriptPlan = Readonly<{
  quality: readonly string[];
  unit: readonly string[];
  browser: readonly string[];
  browserHealth: readonly string[];
  cliRuntime: readonly string[];
}>;

function commandName(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

export function assertLocalCiRuntime(
  actual = process.versions.node,
  expected = readFileSync(path.join(REPOSITORY_ROOT, '.nvmrc'), 'utf8').trim(),
): void {
  if (!/^\d+\.\d+\.\d+$/u.test(expected) || actual !== expected) {
    throw new Error(`Local CI requires Node.js ${expected || 'from .nvmrc'}; running ${actual}.`);
  }
}

function gitOutput(args: readonly string[]): string {
  const child = spawnSync('git', args, {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (child.error) throw child.error;
  if (child.status !== 0) {
    throw new Error(`Git preflight failed: ${child.stderr.trim() || `exit ${child.status ?? 2}`}.`);
  }
  return child.stdout.trim();
}

export function localCiRevisionRange(): string {
  const head = gitOutput(['rev-parse', '--verify', 'HEAD']);
  const base = gitOutput(['merge-base', 'HEAD', 'refs/remotes/origin/main']);
  if (!FULL_SHA.test(base) || !FULL_SHA.test(head)) throw new TypeError('Local CI requires full Git revision identities.');
  return `${base}..${head}`;
}

function run(command: string, args: readonly string[], environment: NodeJS.ProcessEnv = process.env): void {
  process.stdout.write(`\n> ${command} ${args.join(' ')}\n`);
  const child = spawnSync(command, args, {
    cwd: REPOSITORY_ROOT,
    env: { ...environment, CI: '1' },
    stdio: 'inherit',
  });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(`Local CI command failed with exit code ${child.status ?? 2}.`);
}

function npmRun(script: string, extra: readonly string[] = []): void {
  run(commandName(), ['run', script, ...extra]);
}

function nodeVersion(executable: string): string | null {
  const child = spawnSync(executable, ['--version'], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (child.error || child.status !== 0) return null;
  const match = /^v(\d+)\.\d+\.\d+$/u.exec(child.stdout.trim());
  return match ? match[1] as string : null;
}

export function selectNodeRuntimeExecutable(
  expectedMajor: number,
  candidates: readonly string[],
  readMajor: (candidate: string) => string | null = nodeVersion,
): string {
  if (!Number.isSafeInteger(expectedMajor) || expectedMajor < 1) {
    throw new TypeError('CLI compatibility runtime major must be a positive integer.');
  }
  const unique = [...new Set(candidates.filter(Boolean).map((candidate) => path.resolve(candidate)))];
  const selected = unique.find((candidate) => readMajor(candidate) === String(expectedMajor));
  if (!selected) {
    throw new Error(
      `Local CI requires a Node.js ${expectedMajor} executable for the hosted CLI compatibility lane. `
      + `Install that runtime or set WHOISLEUTH_CLI_RUNTIME_NODE to its absolute path.`,
    );
  }
  return selected;
}

function cliRuntimeExecutable(): string {
  const executableName = process.platform === 'win32' ? 'node.exe' : 'node';
  const pathCandidates = (process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
    .map((directory) => path.join(directory, executableName));
  return selectNodeRuntimeExecutable(CI_CLI_RUNTIME_NODE_MAJOR, [
    process.env.WHOISLEUTH_CLI_RUNTIME_NODE || '',
    process.execPath,
    ...pathCandidates,
  ]);
}

function runCliRuntimeCheck(executable: string): void {
  const runtimePath = [path.dirname(executable), process.env.PATH].filter(Boolean).join(path.delimiter);
  run(executable, [path.join(REPOSITORY_ROOT, 'tools', 'cli-package.mts')], {
    ...process.env,
    PATH: runtimePath,
  });
}

function workflowJob(workflow: string, job: string): string {
  const match = new RegExp(`\\n  ${job}:\\n([\\s\\S]*?)(?=\\n  [a-zA-Z0-9_-]+:\\n|$)`, 'u').exec(workflow);
  if (!match?.[1]) throw new TypeError(`Hosted CI workflow is missing the ${job} job.`);
  return match[1];
}

function npmScripts(job: string): readonly string[] {
  return Object.freeze([...job.matchAll(/^\s+(?:run:\s+)?npm run (?:--silent\s+)?([a-z0-9:.-]+)(?:\s|$)/gmu)]
    .map((match) => match[1] as string));
}

export function readHostedCiScriptPlan(workflow: string): HostedCiScriptPlan {
  if (Buffer.byteLength(workflow, 'utf8') > 512 * 1024) throw new TypeError('Hosted CI workflow exceeds the maintained parsing bound.');
  return Object.freeze({
    quality: npmScripts(workflowJob(workflow, 'quality')),
    unit: npmScripts(workflowJob(workflow, 'unit')),
    browser: npmScripts(workflowJob(workflow, 'browser')),
    browserHealth: npmScripts(workflowJob(workflow, 'browser-health')),
    cliRuntime: npmScripts(workflowJob(workflow, 'cli-runtime')),
  });
}

export function expectedHostedCiScriptPlan(): HostedCiScriptPlan {
  return Object.freeze({
    quality: Object.freeze(['security:staged', ...CI_QUALITY_SCRIPTS]),
    unit: Object.freeze([...CI_UNIT_SCRIPTS, 'verification:artifacts']),
    browser: Object.freeze([...CI_BROWSER_PREREQUISITE_SCRIPTS, ...CI_HOSTED_ONLY_BROWSER_SCRIPTS]),
    browserHealth: CI_BROWSER_HEALTH_SCRIPTS,
    cliRuntime: CI_CLI_RUNTIME_SCRIPTS,
  });
}

export function assertHostedCiParity(
  workflow = readFileSync(path.join(REPOSITORY_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'),
): void {
  const actual = readHostedCiScriptPlan(workflow);
  const expected = expectedHostedCiScriptPlan();
  for (const lane of ['quality', 'unit', 'browser', 'browserHealth', 'cliRuntime'] as const) {
    if (JSON.stringify(actual[lane]) !== JSON.stringify(expected[lane])) {
      throw new Error(
        `Hosted ${lane} scripts have drifted from the maintained local CI contract.\n`
        + `Expected: ${expected[lane].join(', ')}\nActual: ${actual[lane].join(', ')}`,
      );
    }
  }
}

export function formatLocalCiPlan(): string {
  return [
    'changed-line secret scan',
    'locked install',
    ...CI_QUALITY_SCRIPTS,
    ...CI_UNIT_SCRIPTS,
    ...CI_BROWSER_PREREQUISITE_SCRIPTS,
    'test:e2e:install',
    'test:e2e:built (performance, functional shards, browser-health aggregation and timing candidate)',
    `cli:package:check (Node ${CI_CLI_RUNTIME_NODE_MAJOR} compatibility runtime)`,
    'verification:artifacts cleanup=all',
  ].join('\n');
}

export function main(args = process.argv.slice(2)): number {
  let cleanup = false;
  let failure: unknown;
  try {
    assertHostedCiParity();
    if (args.length === 1 && args[0] === '--list') {
      process.stdout.write(`${formatLocalCiPlan()}\n`);
      return 0;
    }
    if (args.length) throw new TypeError('Usage: node tools/ci-verification.mts [--list]');
    assertLocalCiRuntime();
    if (gitOutput(['status', '--porcelain=v1', '--untracked-files=all'])) {
      throw new Error('Local CI requires a clean worktree so it verifies the exact commit that would be pushed.');
    }
    cleanup = true;
    const cliRuntime = cliRuntimeExecutable();
    const range = localCiRevisionRange();
    npmRun('security:staged', ['--', '--range', range]);
    run(commandName(), ['ci', '--include=optional', '--ignore-scripts']);
    for (const script of CI_QUALITY_SCRIPTS) npmRun(script);
    for (const script of CI_UNIT_SCRIPTS) npmRun(script);
    for (const script of CI_BROWSER_PREREQUISITE_SCRIPTS) npmRun(script);
    npmRun('test:e2e:install');
    npmRun('test:e2e:built');
    runCliRuntimeCheck(cliRuntime);
  } catch (error) {
    failure = error;
  }
  if (cleanup) {
    try {
      npmRun('verification:artifacts', ['--', '--cleanup=all', '--skip-port-check']);
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) {
    process.stderr.write(`${failure instanceof Error ? failure.message : 'Local CI verification failed.'}\n`);
    return 2;
  }
  process.stdout.write('\nLocal CI matched every maintained quality, unit and browser gate.\n');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
