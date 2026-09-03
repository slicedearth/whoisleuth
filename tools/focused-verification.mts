#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createConnection } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLAYWRIGHT_FUNCTIONAL_PROJECT } from './playwright-execution-contract.mts';
import { readBoundedRegularTextFile } from '../lib/bounded-file.mts';
import { playwrightRunArtifacts } from './playwright-run-artifacts.mts';
import {
  renderPlaywrightResultSummary,
  summarizePlaywrightResults,
} from './playwright-results-summary.mts';
import { inspectVerificationArtifacts } from './verification-artifact-status.mts';
import {
  buildVerificationOwnershipPlan,
  type SpecialisedCheck,
  type VerificationOwnershipPlan,
} from './verification-ownership.mts';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAYWRIGHT_CLI = path.join(REPOSITORY_ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
const DEFAULT_PLAYWRIGHT_PORT = 4180;
const MAX_PORT_SEARCH = 100;
const MAX_GIT_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_PLAYWRIGHT_RESULTS_BYTES = 64 * 1024 * 1024;

type FocusedCommand = Readonly<{
  id: string;
  executable: string;
  args: readonly string[];
}>;

export type FocusedVerificationOptions = Readonly<{
  list: boolean;
  changed: boolean;
  paths: readonly string[];
}>;

export type FocusedVerificationExecution = Readonly<{
  commands: readonly FocusedCommand[];
  browserSpecs: readonly string[];
  cleanupBrowserArtifacts: boolean;
  deferredSpecialisedChecks: readonly SpecialisedCheck[];
}>;

const SPECIALISED_SCRIPTS: Readonly<Partial<Record<SpecialisedCheck, string>>> = Object.freeze({
  architecture: 'architecture:check',
  'capability-catalogue': 'capabilities:check',
  'privacy-catalogue': 'privacy:check',
  'schema-inventory': 'schema:inventory',
  'cli-package': 'cli:package:check',
  'release-contract': 'release:check',
  licences: 'licenses:check',
  'production-dependency-audit': 'dependencies:audit',
  'browser-timing-plan': 'verification:timing:check',
  'analyst-journey-assurance': 'verification:journeys:check',
  'critical-mutation': 'test:mutation',
  'critical-io-coverage': 'test:coverage',
});

const SPECIALISED_COVERED_BY_FOCUSED_TESTS = new Set<SpecialisedCheck>([
  'documentation',
  'workflow-closure',
]);

const SPECIALISED_DELIVERY_ONLY = new Set<SpecialisedCheck>([
  // The staged scanner deliberately reads only staged or committed additions.
  // A dirty-tree iteration cannot honestly claim this delivery gate.
  'staged-security',
]);

function commandName(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function npmCommand(script: string): FocusedCommand {
  return Object.freeze({ id: script, executable: commandName(), args: Object.freeze(['run', script]) });
}

export function parseFocusedVerificationOptions(args: readonly string[]): FocusedVerificationOptions {
  const listCount = args.filter((value) => value === '--list').length;
  const changedCount = args.filter((value) => value === '--changed').length;
  const paths = args.filter((value) => value !== '--list' && value !== '--changed');
  if (listCount > 1 || changedCount > 1 || paths.some((value) => value.startsWith('-'))
    || (changedCount > 0 && paths.length > 0)) {
    throw new TypeError('Usage: node tools/focused-verification.mts [--list] [--changed | <changed-path> ...]');
  }
  return Object.freeze({
    list: listCount === 1,
    changed: changedCount === 1 || paths.length === 0,
    paths: Object.freeze(paths),
  });
}

function gitOutput(args: readonly string[]): string {
  const child = spawnSync('git', args, {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(`Git changed-path discovery failed: ${child.stderr.trim() || `exit ${child.status ?? 2}`}.`);
  return child.stdout;
}

function nulPaths(value: string): readonly string[] {
  return Object.freeze(value.split('\0').filter(Boolean));
}

export function discoverFocusedVerificationPaths(): readonly string[] {
  const tracked = nulPaths(gitOutput([
    '-c', 'core.quotePath=false', 'diff', '--name-only', '-z', '--diff-filter=ACMRTD', 'HEAD', '--',
  ]));
  const untracked = nulPaths(gitOutput([
    '-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard', '-z', '--',
  ]));
  const paths = [...new Set([...tracked, ...untracked])].sort();
  if (!paths.length) throw new Error('Focused verification found no changed paths.');
  return Object.freeze(paths);
}

export function buildFocusedVerificationExecution(
  plan: VerificationOwnershipPlan,
): FocusedVerificationExecution {
  const commands: FocusedCommand[] = [];
  if (plan.focusedUnitChecks.length) {
    commands.push(Object.freeze({
      id: 'focused-unit',
      executable: process.execPath,
      args: Object.freeze([
        '--test',
        '--test-concurrency=4',
        ...plan.focusedUnitChecks,
      ]),
    }));
  }

  const frontendChanged = plan.changedPaths.some((value) => value.startsWith('frontend/'));
  if (frontendChanged) {
    commands.push(npmCommand('typecheck'), npmCommand('check'));
  }

  const deferred = new Set<SpecialisedCheck>();
  for (const check of plan.mandatorySpecialisedChecks) {
    if (SPECIALISED_COVERED_BY_FOCUSED_TESTS.has(check)) continue;
    if (SPECIALISED_DELIVERY_ONLY.has(check)) {
      deferred.add(check);
      continue;
    }
    const script = SPECIALISED_SCRIPTS[check];
    if (!script) throw new TypeError(`Focused verification has no execution owner for ${check}.`);
    if (!commands.some((command) => command.id === script)) commands.push(npmCommand(script));
  }

  const browserSpecs = Object.freeze([...plan.focusedBrowserChecks]);
  if (browserSpecs.length) commands.push(npmCommand('build'));
  commands.push(Object.freeze({ id: 'diff-whitespace', executable: 'git', args: Object.freeze(['diff', '--check']) }));

  return Object.freeze({
    commands: Object.freeze(commands),
    browserSpecs,
    cleanupBrowserArtifacts: frontendChanged || browserSpecs.length > 0,
    deferredSpecialisedChecks: Object.freeze([...deferred].sort()),
  });
}

function renderExecutionPlan(
  plan: VerificationOwnershipPlan,
  execution: FocusedVerificationExecution,
): string {
  const lines = [
    `Focused verification map v${plan.mapVersion}: ${plan.changedPaths.length} changed path(s) across ${plan.ownershipAreas.length} area(s).`,
    `Focused unit files: ${plan.focusedUnitChecks.length}.`,
    ...execution.commands.map((command) => `Run: ${command.id}`),
    `Focused browser specs: ${execution.browserSpecs.length}${execution.browserSpecs.length ? ` (${execution.browserSpecs.join(', ')})` : ''}.`,
    ...(execution.deferredSpecialisedChecks.length
      ? [`Delivery-only checks deferred: ${execution.deferredSpecialisedChecks.join(', ')}.`]
      : []),
    'This is an iteration boundary. Run npm run verification:ci from the clean commit before push.',
  ];
  return `${lines.join('\n')}\n`;
}

function runCommand(command: FocusedCommand): void {
  process.stdout.write(`\n> ${command.id}\n`);
  const child = spawnSync(command.executable, command.args, {
    cwd: REPOSITORY_ROOT,
    env: process.env,
    stdio: 'inherit',
  });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(`${command.id} failed with exit code ${child.status ?? 2}.`);
}

async function portIsFree(port: number): Promise<boolean> {
  return await new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Port ${port} status check timed out.`));
    }, 1_000);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });
    socket.once('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      socket.destroy();
      if (error.code === 'ECONNREFUSED') resolve(true);
      else reject(error);
    });
  });
}

async function selectPlaywrightPort(): Promise<number> {
  const configured = process.env.WHOISLEUTH_E2E_FOCUSED_BASE_PORT?.trim();
  const first = configured ? Number(configured) : DEFAULT_PLAYWRIGHT_PORT;
  if (!Number.isSafeInteger(first) || first < 1024 || first > 65_000) {
    throw new TypeError('WHOISLEUTH_E2E_FOCUSED_BASE_PORT must be an integer from 1024 through 65000.');
  }
  for (let offset = 0; offset <= MAX_PORT_SEARCH && first + offset <= 65_535; offset += 1) {
    if (await portIsFree(first + offset)) return first + offset;
  }
  throw new Error(`Could not find a free local Playwright port from ${first}.`);
}

async function runBrowserSpecs(specs: readonly string[]): Promise<void> {
  const port = await selectPlaywrightPort();
  const environment = {
    ...process.env,
    CI: '1',
    WHOISLEUTH_E2E_USE_BUILD: '1',
    WHOISLEUTH_E2E_PORT: String(port),
    WHOISLEUTH_PLAYWRIGHT_RUN_LABEL: 'focused iteration',
  };
  process.stdout.write(`\n> focused-browser (${specs.length} spec file(s), port ${port})\n`);
  const child = spawn(process.execPath, [
    PLAYWRIGHT_CLI,
    'test',
    ...specs,
    `--project=${PLAYWRIGHT_FUNCTIONAL_PROJECT}`,
    '--workers=1',
    '--retries=0',
  ], {
    cwd: REPOSITORY_ROOT,
    env: environment,
    stdio: 'inherit',
  });
  let requestedSignal: NodeJS.Signals | null = null;
  const stop = (signal: NodeJS.Signals) => {
    requestedSignal = signal;
    try { child.kill('SIGTERM'); } catch { /* Port verification below remains authoritative. */ }
  };
  const onInterrupt = () => stop('SIGINT');
  const onTerminate = () => stop('SIGTERM');
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onTerminate);

  let exitCode: number | null = null;
  let exitSignal: NodeJS.Signals | null = null;
  let failure: unknown;
  try {
    const completion = await new Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    exitCode = completion.code;
    exitSignal = completion.signal;
    if (requestedSignal) throw new Error(`Focused browser verification was interrupted by ${requestedSignal}.`);

    const resultPath = path.join(REPOSITORY_ROOT, playwrightRunArtifacts(environment).jsonResults);
    if (!existsSync(resultPath)) throw new Error('Focused Playwright results were not written.');
    const source = await readBoundedRegularTextFile(resultPath, {
      maximumBytes: MAX_PLAYWRIGHT_RESULTS_BYTES,
      minimumBytes: 1,
      label: 'focused Playwright result data',
    });
    const summary = summarizePlaywrightResults(JSON.parse(source) as unknown, 'focused iteration');
    process.stdout.write(renderPlaywrightResultSummary(summary));
    if (exitCode !== 0 || summary.failed || summary.flaky || summary.retried) {
      throw new Error(
        `Focused browser verification was not clean: ${summary.failed} failed, ${summary.flaky} flaky, ${summary.retried} retried.`,
      );
    }
  } catch (error) {
    failure = error;
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
  }
  if (!(await portIsFree(port))) {
    failure ??= new Error(`Focused Playwright left port ${port} occupied.`);
  }
  if (failure) throw failure;
  if (exitSignal) throw new Error(`Focused browser verification stopped with ${exitSignal}.`);
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  let cleanupBrowserArtifacts = false;
  let failure: unknown;
  try {
    const options = parseFocusedVerificationOptions(args);
    const paths = options.changed ? discoverFocusedVerificationPaths() : options.paths;
    const plan = buildVerificationOwnershipPlan(paths);
    const execution = buildFocusedVerificationExecution(plan);
    process.stdout.write(renderExecutionPlan(plan, execution));
    if (options.list) return 0;
    for (const command of execution.commands) {
      runCommand(command);
      if (execution.cleanupBrowserArtifacts
        && (command.id === 'typecheck' || command.id === 'check' || command.id === 'build')) {
        cleanupBrowserArtifacts = true;
      }
    }
    if (execution.browserSpecs.length) await runBrowserSpecs(execution.browserSpecs);
  } catch (error) {
    failure = error;
  }

  if (cleanupBrowserArtifacts) {
    try {
      const cleanup = await inspectVerificationArtifacts('browser', false);
      process.stdout.write(`Focused verification cleanup removed ${cleanup.removed.length} generated path(s).\n`);
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) {
    process.stderr.write(`${failure instanceof Error ? failure.message : 'Focused verification failed.'}\n`);
    return 2;
  }
  process.stdout.write('\nFocused verification passed. The clean-commit CI boundary remains outstanding.\n');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
