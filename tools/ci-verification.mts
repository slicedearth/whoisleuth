#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FRONTEND_BROWSER_ARTIFACT_PATHS } from './frontend-build-integrity.mts';
import { npmExecutableName } from './maintainer-tool-helpers.mts';
import {
  resolveUnitTestExecutables,
  unitTestExecutableEnvironment,
} from './toolchain-compatibility.mts';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FULL_SHA = /^[a-f0-9]{40}$/u;
export const CI_FRONTEND_BUILD_ARTIFACT_NAME = 'frontend-build-${{ github.sha }}-${{ github.run_attempt }}';

export const CI_QUALITY_SCRIPTS = Object.freeze([
  'toolchain:check',
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
  'capture:package:check',
  'architecture:check',
  'typecheck',
  'check',
] as const);

export const CI_PREFLIGHT_SCRIPTS = Object.freeze([
  'release:check',
] as const);

export const CI_UNIT_SCRIPTS = Object.freeze([
  'test:coverage',
] as const);

export const CI_BROWSER_BUILD_SCRIPTS = Object.freeze([
  'build',
  'frontend:loading-report',
  'security:retire',
  'frontend:build:integrity',
] as const);

export const CI_HOSTED_ONLY_BROWSER_SCRIPTS = Object.freeze([
  'frontend:build:integrity',
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
  'capture:package:check',
] as const);
export const CI_COMMAND_GROUPS = Object.freeze([
  'preflight',
  'quality',
  'unit',
  'browser-build',
  'cli-runtime',
] as const);
export type CiCommandGroup = typeof CI_COMMAND_GROUPS[number];

export type HostedCiScriptPlan = Readonly<{
  quality: readonly string[];
  unit: readonly string[];
  browserBuild: readonly string[];
  browser: readonly string[];
  browserHealth: readonly string[];
  cliRuntime: readonly string[];
}>;

export function assertLocalCiRuntime(
  actual = process.versions.node,
  expected = readFileSync(path.join(REPOSITORY_ROOT, '.nvmrc'), 'utf8').trim(),
): void {
  if (!/^\d+\.\d+\.\d+$/u.test(expected) || actual !== expected) {
    throw new Error(`Local CI requires Node.js ${expected || 'from .nvmrc'}; running ${actual}.`);
  }
}

export function playwrightBrowserCacheDirectory(
  environment: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
  home = homedir(),
  cwd = REPOSITORY_ROOT,
): string {
  const configured = environment.PLAYWRIGHT_BROWSERS_PATH;
  if (configured === '0') return path.join(cwd, 'node_modules', 'playwright-core', '.local-browsers');
  if (configured) return path.resolve(environment.INIT_CWD || cwd, configured);
  if (platform === 'darwin') return path.join(home, 'Library', 'Caches', 'ms-playwright');
  if (platform === 'linux') return path.join(environment.XDG_CACHE_HOME || path.join(home, '.cache'), 'ms-playwright');
  if (platform === 'win32') {
    return path.join(environment.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'ms-playwright');
  }
  throw new Error(`Local CI does not support Playwright cache discovery on ${platform}.`);
}

export function assertPlaywrightBrowserCacheWritable(cacheDirectory = playwrightBrowserCacheDirectory()): void {
  let probeDirectory = '';
  try {
    mkdirSync(cacheDirectory, { recursive: true });
    probeDirectory = mkdtempSync(path.join(cacheDirectory, '.whoisleuth-write-check-'));
    rmSync(probeDirectory, { recursive: true });
  } catch (cause) {
    if (probeDirectory) {
      try {
        rmSync(probeDirectory, { recursive: true, force: true });
      } catch {
        // Preserve the original writability failure.
      }
    }
    const detail = cause instanceof Error ? ` ${cause.message}` : '';
    throw new Error(
      `Local CI requires write access to the Playwright browser cache at ${cacheDirectory}.${detail}`,
    );
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

function npmRun(
  script: string,
  extra: readonly string[] = [],
  environment: NodeJS.ProcessEnv = process.env,
): void {
  run(npmExecutableName(), ['run', script, ...extra], environment);
}

export function ciCommandGroupScripts(group: CiCommandGroup): readonly string[] {
  if (group === 'preflight') return CI_PREFLIGHT_SCRIPTS;
  if (group === 'quality') return CI_QUALITY_SCRIPTS;
  if (group === 'unit') return CI_UNIT_SCRIPTS;
  if (group === 'browser-build') return CI_BROWSER_BUILD_SCRIPTS;
  return CI_CLI_RUNTIME_SCRIPTS;
}

export function runCiCommandGroup(
  group: CiCommandGroup,
  execute: (script: string, args: readonly string[]) => void = (script, args) => npmRun(script, args),
): void {
  for (const script of ciCommandGroupScripts(group)) execute(script, []);
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
  run(executable, [path.join(REPOSITORY_ROOT, 'tools', 'ci-verification.mts'), '--group=cli-runtime'], {
    ...process.env,
    PATH: runtimePath,
  });
}

function assertCliRuntime(actual = process.versions.node): void {
  const match = /^(\d+)\.\d+\.\d+$/u.exec(actual);
  if (match?.[1] !== String(CI_CLI_RUNTIME_NODE_MAJOR)) {
    throw new Error(`CLI compatibility CI group requires Node.js ${CI_CLI_RUNTIME_NODE_MAJOR}; running ${actual}.`);
  }
}

type WorkflowStep = {
  uses?: string;
  run?: string;
  if?: string | boolean;
  'continue-on-error'?: boolean | string;
  with?: Record<string, unknown>;
};
type WorkflowJob = {
  steps: WorkflowStep[];
  needs?: string | string[];
  if?: string | boolean;
  'continue-on-error'?: boolean | string;
  permissions?: unknown;
};
type Workflow = { jobs: Record<string, WorkflowJob>; permissions?: unknown };

function parseWorkflow(source: string): Workflow {
  if (Buffer.byteLength(source, 'utf8') > 512 * 1024) throw new TypeError('Hosted CI workflow exceeds the parsing bound.');
  // Pre-install release checks and --list remain dependency-free.
  const { parseDocument } = createRequire(import.meta.url)('yaml') as typeof import('yaml');
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length) throw new TypeError('Hosted CI workflow is not valid YAML.');
  const value: unknown = document.toJS({ maxAliasCount: 0 });
  if (!value || typeof value !== 'object' || !('jobs' in value)
    || !value.jobs || typeof value.jobs !== 'object' || Array.isArray(value.jobs)) {
    throw new TypeError('Hosted CI workflow must declare jobs.');
  }
  return value as Workflow;
}

function workflowJob(workflow: Workflow, name: string): WorkflowJob {
  const job = workflow.jobs[name];
  if (!job || !Array.isArray(job.steps)) throw new TypeError(`Hosted CI workflow is missing the ${name} job.`);
  return job;
}

function condition(value: unknown): string {
  return String(value ?? '').replace(/^\s*\$\{\{\s*|\s*\}\}\s*$/gu, '').trim();
}

function dependencies(job: WorkflowJob): readonly string[] {
  return typeof job.needs === 'string' ? [job.needs] : job.needs ?? [];
}

function stepScripts(step: WorkflowStep): readonly string[] {
  if (typeof step.run !== 'string') return [];
  const command = step.run.replace(/\\\r?\n/gu, ' ').trim();
  const match = /^npm run (?:--silent\s+)?([a-z0-9:.-]+)(?:\s|$)/u.exec(command);
  if (!match) return [];
  // Required gates are direct commands, not shell programmes whose control flow
  // this policy would have to interpret. Redirection of reports remains allowed.
  if (/[\n;&|]/u.test(command)) throw new Error('Required CI commands must run directly without swallowed failures or shell control flow.');
  const script = match[1] as string;
  if (script !== 'verification:ci') return [script];
  const group = /^npm run verification:ci -- --group[= ]([a-z-]+)$/u.exec(command)?.[1];
  if (!CI_COMMAND_GROUPS.includes(group as CiCommandGroup)) throw new Error('Hosted CI uses an unknown verification group.');
  return ciCommandGroupScripts(group as CiCommandGroup);
}

function npmScripts(job: WorkflowJob): readonly string[] {
  return Object.freeze(job.steps.flatMap(stepScripts));
}

function scriptPlan(workflow: Workflow): HostedCiScriptPlan {
  return Object.freeze({
    quality: npmScripts(workflowJob(workflow, 'quality')),
    unit: npmScripts(workflowJob(workflow, 'unit')),
    browserBuild: npmScripts(workflowJob(workflow, 'browser-build')),
    browser: npmScripts(workflowJob(workflow, 'browser')),
    browserHealth: npmScripts(workflowJob(workflow, 'browser-health')),
    cliRuntime: npmScripts(workflowJob(workflow, 'cli-runtime')),
  });
}

export function readHostedCiScriptPlan(workflow: string): HostedCiScriptPlan {
  return scriptPlan(parseWorkflow(workflow));
}

function assertFrontendBuildArtifactFlow(workflow: Workflow): void {
  const build = workflowJob(workflow, 'browser-build');
  const browser = workflowJob(workflow, 'browser');
  const upload = build.steps.find((step) => step.uses?.startsWith('actions/upload-artifact@')
    && step.with?.name === CI_FRONTEND_BUILD_ARTIFACT_NAME);
  const download = browser.steps.find((step) => step.uses?.startsWith('actions/download-artifact@')
    && step.with?.name === CI_FRONTEND_BUILD_ARTIFACT_NAME);
  const paths = String(upload?.with?.path ?? '').trim().split(/\r?\n/u).map((value) => value.trim()).sort();
  if (!upload || condition(upload.if) || upload.with?.['if-no-files-found'] !== 'error'
    || JSON.stringify(paths) !== JSON.stringify([...FRONTEND_BROWSER_ARTIFACT_PATHS].sort())) {
    throw new Error('Hosted browser-build artifact publication must contain the served build and its identity only.');
  }
  if (!download || condition(download.if) || download.with?.path !== 'frontend'
    || download.with?.pattern !== undefined || download.with?.['merge-multiple'] !== undefined
    || !dependencies(browser).includes('browser-build')) {
    throw new Error('Hosted browser build download must use the exact verified build artifact.');
  }
  const buildVerification = build.steps.findIndex((step) => stepScripts(step).includes('frontend:build:integrity'));
  const integrity = browser.steps.findIndex((step) => stepScripts(step).includes('frontend:build:integrity'));
  const consumers = browser.steps.flatMap((step, index) => stepScripts(step).some((script) =>
    ['test:e2e:shard', 'frontend:authenticated-loading-report'].includes(script)) ? [index] : []);
  if (buildVerification < 0 || buildVerification >= build.steps.indexOf(upload)
    || integrity <= browser.steps.indexOf(download) || consumers.some((index) => index <= integrity)
    || npmScripts(browser).includes('build')) {
    throw new Error('Browser tests must consume the downloaded, verified build without rebuilding it.');
  }
}

function assertReadOnlyPermissions(value: unknown): void {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.values(value).some((permission) => permission !== 'read' && permission !== 'none')) {
    throw new Error('CI permissions must remain explicitly read-only.');
  }
}

export function expectedHostedCiScriptPlan(): HostedCiScriptPlan {
  return Object.freeze({
    quality: Object.freeze(['security:staged', ...CI_PREFLIGHT_SCRIPTS, ...CI_QUALITY_SCRIPTS]),
    unit: Object.freeze([...CI_UNIT_SCRIPTS, 'verification:artifacts']),
    browserBuild: CI_BROWSER_BUILD_SCRIPTS,
    browser: CI_HOSTED_ONLY_BROWSER_SCRIPTS,
    browserHealth: CI_BROWSER_HEALTH_SCRIPTS,
    cliRuntime: CI_CLI_RUNTIME_SCRIPTS,
  });
}

export function assertHostedCiParity(
  workflow = readFileSync(path.join(REPOSITORY_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8'),
): void {
  const parsed = parseWorkflow(workflow);
  const actual = scriptPlan(parsed);
  const expected = expectedHostedCiScriptPlan();
  for (const lane of Object.keys(expected) as Array<keyof HostedCiScriptPlan>) {
    if (JSON.stringify([...actual[lane]].sort()) !== JSON.stringify([...expected[lane]].sort())) {
      throw new Error(
        `Hosted ${lane} scripts have drifted from the maintained local CI contract.\n`
        + `Expected: ${expected[lane].join(', ')}\nActual: ${actual[lane].join(', ')}`,
      );
    }
  }
  if (parsed.permissions === undefined) throw new Error('CI permissions must be explicit.');
  assertReadOnlyPermissions(parsed.permissions);
  for (const [name, job] of Object.entries(parsed.jobs)) {
    assertReadOnlyPermissions(job.permissions);
    if (job['continue-on-error']
      || name !== 'verify' && condition(job.if)) throw new Error(`Required CI job ${name} must not be skipped or ignore failure.`);
    for (const step of job.steps) {
      if (step['continue-on-error']) throw new Error(`CI job ${name} must not ignore step failures.`);
      if (step.uses && !/^[^@\s]+@[a-f0-9]{40}$/u.test(step.uses)) throw new Error('CI actions must be pinned to immutable revisions.');
      if (step.uses?.startsWith('actions/checkout@') && step.with?.['persist-credentials'] !== false) {
        throw new Error('CI checkouts must not retain credentials.');
      }
      const scripts = stepScripts(step);
      const guard = condition(step.if);
      if (scripts.length && guard && !(
        scripts.every((script) => ['verification:artifacts', 'test:e2e:summary'].includes(script)) && guard === 'always()'
        || scripts.length === 1 && scripts[0] === 'test:e2e:shard' && guard === "matrix.kind == 'functional'"
        || scripts.length === 1 && scripts[0] === 'frontend:authenticated-loading-report' && guard === "matrix.kind == 'performance'"
      )) throw new Error(`Required CI commands in ${name} have an unsupported skip condition.`);
    }
  }
  const verify = workflowJob(parsed, 'verify');
  const lanes = Object.keys(parsed.jobs).filter((name) => name !== 'verify').sort();
  if (condition(verify.if) !== 'always()' || JSON.stringify([...dependencies(verify)].sort()) !== JSON.stringify(lanes)) {
    throw new Error('The required verify job must always account for every verification lane.');
  }
  assertFrontendBuildArtifactFlow(parsed);
}

export function formatLocalCiPlan(): string {
  return [
    'Playwright browser-cache writability',
    'changed-line secret scan',
    ...CI_PREFLIGHT_SCRIPTS,
    'locked install (install-time audit disabled; scheduled and release audits are separate)',
    ...CI_QUALITY_SCRIPTS,
    ...CI_UNIT_SCRIPTS,
    ...CI_BROWSER_BUILD_SCRIPTS,
    'test:e2e:install',
    'test:e2e:built (performance, functional shards, browser-health aggregation and timing candidate)',
    `cli:package:check (Node ${CI_CLI_RUNTIME_NODE_MAJOR} compatibility runtime)`,
    'verification:artifacts cleanup=all',
  ].join('\n');
}

export function parseCiVerificationArguments(args: readonly string[]): Readonly<{
  mode: 'full' | 'list' | 'group';
  group?: CiCommandGroup;
}> {
  if (args.length === 0) return Object.freeze({ mode: 'full' });
  if (args.length === 1 && args[0] === '--list') return Object.freeze({ mode: 'list' });
  const group = args.length === 1 && args[0]?.startsWith('--group=')
    ? args[0].slice('--group='.length)
    : args.length === 2 && args[0] === '--group'
      ? args[1]
      : null;
  if (group && CI_COMMAND_GROUPS.includes(group as CiCommandGroup)) {
    return Object.freeze({ mode: 'group', group: group as CiCommandGroup });
  }
  throw new TypeError(`Usage: node tools/ci-verification.mts [--list | --group=<${CI_COMMAND_GROUPS.join('|')}>]`);
}

export function main(args = process.argv.slice(2)): number {
  let cleanup = false;
  let failure: unknown;
  try {
    const parsed = parseCiVerificationArguments(args);
    if (parsed.mode === 'list') {
      process.stdout.write(`${formatLocalCiPlan()}\n`);
      return 0;
    }
    if (parsed.mode === 'group') {
      const group = parsed.group!;
      if (group === 'cli-runtime') assertCliRuntime();
      else assertLocalCiRuntime();
      if (group === 'quality') assertHostedCiParity();
      const environment = group === 'unit'
        ? unitTestExecutableEnvironment(resolveUnitTestExecutables())
        : process.env;
      runCiCommandGroup(group, (script, extra) => npmRun(script, extra, environment));
      return 0;
    }
    assertLocalCiRuntime();
    if (gitOutput(['status', '--porcelain=v1', '--untracked-files=all'])) {
      throw new Error('Local CI requires a clean worktree so it verifies the exact commit that would be pushed.');
    }
    cleanup = true;
    assertPlaywrightBrowserCacheWritable();
    const unitEnvironment = unitTestExecutableEnvironment(resolveUnitTestExecutables());
    const cliRuntime = cliRuntimeExecutable();
    const range = localCiRevisionRange();
    npmRun('security:staged', ['--', '--range', range]);
    runCiCommandGroup('preflight');
    run(npmExecutableName(), ['ci', '--include=optional', '--ignore-scripts', '--audit=false']);
    assertHostedCiParity();
    runCiCommandGroup('quality');
    runCiCommandGroup('unit', (script, extra) => npmRun(script, extra, unitEnvironment));
    runCiCommandGroup('browser-build');
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
