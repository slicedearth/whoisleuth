#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLAYWRIGHT_FUNCTIONAL_PROJECT, PLAYWRIGHT_PERFORMANCE_AUTHORITY_PROJECT,
  isPlaywrightFunctionalSpec, isPlaywrightPerformanceAuthoritySpec } from './playwright-execution-contract.mts';
import { runPlaywrightProcess } from './playwright-process.mts';
import { createHostedBrowserWorkspace, runHostedBrowserWorkspace } from './hosted-browser-workspace.mts';
import { playwrightRunArtifacts } from './playwright-run-artifacts.mts';
import {
  readPlaywrightResultData,
  MAX_PLAYWRIGHT_RESULTS_BYTES,
  playwrightReportedSpecFiles,
  renderPlaywrightResultSummary,
  summarizePlaywrightResults,
} from './playwright-results-summary.mts';
import { inspectVerificationArtifacts } from './verification-artifact-status.mts';
import { localPortIsFree, npmExecutableName } from './maintainer-tool-helpers.mts';
import {
  createVerificationOwnershipPlan,
  type SpecialisedCheck,
  type VerificationOwnershipPlan,
} from './verification-ownership.mts';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAYWRIGHT_CLI = path.join(REPOSITORY_ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
const DEFAULT_PLAYWRIGHT_PORT = 4180;
const MAX_PORT_SEARCH = 100;
const MAX_GIT_OUTPUT_BYTES = 2 * 1024 * 1024;

type FocusedCommand = Readonly<{
  id: string;
  executable: string;
  args: readonly string[];
  environment?: Readonly<Record<string, string>>;
}>;

export type FocusedVerificationOptions = Readonly<{
  list: boolean;
  changed: boolean;
  paths: readonly string[];
  since?: string;
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
  'capture-package': 'capture:package:check',
  'local-package': 'local:package:check',
  'release-contract': 'release:check',
  licences: 'licenses:check',
  'production-dependency-audit': 'dependencies:audit',
  'browser-build': 'build',
  'browser-loading-report': 'frontend:loading-report',
  'browser-timing-plan': 'verification:timing:check',
  'analyst-journey-assurance': 'verification:journeys:check',
  'critical-mutation': 'test:mutation',
  'critical-io-coverage': 'test:coverage',
  'workflow-closure': 'workflow:check',
});

const SPECIALISED_COVERED_BY_FOCUSED_TESTS = new Set<SpecialisedCheck>([
  'documentation',
]);

const SPECIALISED_DELIVERY_ONLY = new Set<SpecialisedCheck>([
  // The staged scanner deliberately reads only staged or committed additions.
  // A dirty-tree iteration cannot honestly claim this delivery gate.
  'staged-security',
]);

function npmCommand(script: string): FocusedCommand {
  return Object.freeze({ id: script, executable: npmExecutableName(), args: Object.freeze(['run', script]) });
}

export function focusedBrowserLanes(specs: readonly string[]) {
  if (new Set(specs).size !== specs.length || specs.some(spec => !isPlaywrightFunctionalSpec(spec) && !isPlaywrightPerformanceAuthoritySpec(spec))) {
    throw new TypeError('Focused browser selection must contain unique maintained specifications.');
  }
  return [
    { kind: 'performance', project: PLAYWRIGHT_PERFORMANCE_AUTHORITY_PROJECT, specs: specs.filter(isPlaywrightPerformanceAuthoritySpec) },
    { kind: 'functional', project: PLAYWRIGHT_FUNCTIONAL_PROJECT, specs: specs.filter(isPlaywrightFunctionalSpec) },
  ].filter(lane => lane.specs.length > 0);
}

export function assertFocusedBrowserCoverage(specs: readonly string[], report: unknown): void {
  const actual = playwrightReportedSpecFiles(report);
  const missing = specs.filter(spec => !actual.includes(spec));
  const unexpected = actual.filter(spec => !specs.includes(spec));
  if (!specs.length || missing.length || unexpected.length) {
    throw new Error(`Focused browser inventory differs from its plan. Missing: ${missing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'}.`);
  }
}

export function parseFocusedVerificationOptions(args: readonly string[]): FocusedVerificationOptions {
  const listCount = args.filter((value) => value === '--list').length;
  const changedCount = args.filter((value) => value === '--changed').length;
  const sinceOptions = args.filter(value => value.startsWith('--since='));
  const since = sinceOptions[0]?.slice('--since='.length);
  const paths = args.filter((value) => value !== '--list' && value !== '--changed' && !value.startsWith('--since='));
  if (listCount > 1 || changedCount > 1 || paths.some((value) => value.startsWith('-'))
    || (changedCount > 0 && paths.length > 0) || sinceOptions.length > 1
    || (since !== undefined && (!since || since.length > 320 || /^[\s-]|[\s\0]/u.test(since) || changedCount || paths.length))) {
    throw new TypeError('Usage: node tools/focused-verification.mts [--list] [--changed | --since=<commit> | <changed-path> ...]');
  }
  return Object.freeze({
    list: listCount === 1,
    changed: changedCount === 1 || paths.length === 0,
    paths: Object.freeze(paths),
    ...(since === undefined ? {} : { since }),
  });
}

function gitOutput(args: readonly string[], repositoryRoot = REPOSITORY_ROOT): string {
  const child = spawnSync('git', args, {
    cwd: repositoryRoot,
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

export function discoverFocusedVerificationPaths(since = 'HEAD', repositoryRoot = REPOSITORY_ROOT): readonly string[] {
  const base = gitOutput(['rev-parse', '--verify', '--end-of-options', `${since}^{commit}`], repositoryRoot).trim();
  const tracked = nulPaths(gitOutput([
    '-c', 'core.quotePath=false', 'diff', '--name-only', '-z', '--diff-filter=ACMRTD', base, '--',
  ], repositoryRoot));
  const untracked = nulPaths(gitOutput([
    '-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard', '-z', '--',
  ], repositoryRoot));
  const paths = [...new Set([...tracked, ...untracked])].sort();
  if (!paths.length) throw new Error('Focused verification found no changed paths.');
  return Object.freeze(paths);
}

export function buildFocusedVerificationExecution(
  plan: VerificationOwnershipPlan,
): FocusedVerificationExecution {
  const commands: FocusedCommand[] = [];
  if (plan.focusedBrowserChecks.length) {
    // Discovery loads the real configuration and selected specifications but
    // does not start the server, setup, or a browser. A broken import should
    // fail before unit coverage, package assembly, or a production build.
    commands.push(Object.freeze({
      id: 'browser-discovery', executable: process.execPath,
      args: Object.freeze([PLAYWRIGHT_CLI, 'test', ...plan.focusedBrowserChecks,
        ...focusedBrowserLanes(plan.focusedBrowserChecks).map(lane => `--project=${lane.project}`), '--list', '--reporter=json']),
      environment: Object.freeze({ CI: '', WHOISLEUTH_E2E_USE_BUILD: '0', WHOISLEUTH_E2E_PERFORMANCE_FIRST: '1', PLAYWRIGHT_JSON_OUTPUT_FILE: '' }),
    }));
  }
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

  const typedPaths = plan.changedPaths.filter((value) => /\.(?:[cm]?ts|svelte)$/u.test(value));
  // Runtime import selection deliberately excludes erased type edges. Shared
  // source changes therefore retain compiler coverage of every consuming
  // project, even when those consumers need no behavioural test rerun.
  const sharedSourceChanged = typedPaths.some(value => !value.startsWith('frontend/src/')
    && !value.startsWith('test/') && !value.startsWith('e2e/') && value !== 'playwright.config.ts');
  const frontendChanged = typedPaths.some((value) => value.startsWith('frontend/src/'));
  // Svelte check already checks the frontend TypeScript project. Do not also
  // typecheck the server, CLI, test and browser-test projects for a UI edit.
  if (frontendChanged) commands.push(npmCommand('check'));
  const compilerProjects = new Set<string>();
  if (sharedSourceChanged) commands.push(npmCommand('typecheck'));
  for (const file of typedPaths) {
    if (sharedSourceChanged) break;
    if (file.startsWith('frontend/src/')) continue;
    if (file.startsWith('e2e/') || file === 'playwright.config.ts') compilerProjects.add('e2e/tsconfig.json');
    else if (file.startsWith('test/')) compilerProjects.add('test/tsconfig.json');
    else compilerProjects.add('tsconfig.json');
  }
  for (const project of compilerProjects) {
    commands.push(Object.freeze({
      id: `typecheck (${project})`, executable: process.execPath,
      args: Object.freeze([path.join(REPOSITORY_ROOT, 'node_modules/typescript/bin/tsc'), '--noEmit', '-p', project]),
    }));
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
    if (check === 'local-package' && !commands.some(command => command.id === 'build')) commands.push(npmCommand('build'));
    if (!commands.some((command) => command.id === script)) commands.push(npmCommand(script));
  }

  const browserSpecs = Object.freeze([...plan.focusedBrowserChecks]);
  if (browserSpecs.length && !commands.some((command) => command.id === 'build')) {
    commands.push(npmCommand('build'));
  }
  commands.push(Object.freeze({ id: 'diff-whitespace', executable: 'git', args: Object.freeze(['diff', '--check']) }));

  const producesBrowserArtifacts = frontendChanged
    || browserSpecs.length > 0
    || commands.some((command) => command.id === 'build' || command.id === 'frontend:loading-report');

  return Object.freeze({
    commands: Object.freeze(commands),
    browserSpecs,
    cleanupBrowserArtifacts: producesBrowserArtifacts,
    deferredSpecialisedChecks: Object.freeze([...deferred].sort()),
  });
}

function renderExecutionPlan(
  plan: VerificationOwnershipPlan,
  execution: FocusedVerificationExecution,
): string {
  const lines = [
    `Focused verification map v${plan.mapVersion}: ${plan.changedPaths.length} changed path(s) across ${plan.ownershipAreas.length} owner and ${plan.impactAreas.length} impact area(s).`,
    `Focused unit files: ${plan.focusedUnitChecks.length}.`,
    ...plan.assignments.map((assignment) => `Selected for ${assignment.changedPath}: ${assignment.impactAreas.join('; ')}.`),
    ...plan.interpretation.slice(-1),
    ...execution.commands.map((command) => `Run: ${command.id}`),
    `Focused browser specs: ${execution.browserSpecs.length}${execution.browserSpecs.length ? ` (${execution.browserSpecs.join(', ')})` : ''}.`,
    ...(execution.deferredSpecialisedChecks.length
      ? [`Delivery-only checks deferred: ${execution.deferredSpecialisedChecks.join(', ')}.`]
      : []),
    'This focused result covers the listed paths and checks only. Complete hosted checks are required before merge; release checks remain separate.',
  ];
  return `${lines.join('\n')}\n`;
}

function runCommand(command: FocusedCommand): void {
  process.stdout.write(`\n> ${command.id}\n`);
  const discovery = command.id === 'browser-discovery';
  const child = spawnSync(command.executable, command.args, {
    cwd: REPOSITORY_ROOT,
    env: { ...process.env, ...command.environment },
    stdio: discovery ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    maxBuffer: MAX_PLAYWRIGHT_RESULTS_BYTES,
  });
  if (child.error) throw child.error;
  if (child.status !== 0) {
    if (discovery) process.stderr.write(child.stderr || child.stdout || '');
    throw new Error(`${command.id} failed with exit code ${child.status ?? 2}.`);
  }
  if (discovery) {
    const specs = command.args.filter(arg => arg.endsWith('.spec.ts'));
    assertFocusedBrowserCoverage(specs, JSON.parse(child.stdout));
    process.stdout.write(`Discovered every selected browser specification (${specs.length}).\n`);
  }
}

async function selectPlaywrightPort(): Promise<number> {
  const configured = process.env.WHOISLEUTH_E2E_FOCUSED_BASE_PORT?.trim();
  const first = configured ? Number(configured) : DEFAULT_PLAYWRIGHT_PORT;
  if (!Number.isSafeInteger(first) || first < 1024 || first > 65_000) {
    throw new TypeError('WHOISLEUTH_E2E_FOCUSED_BASE_PORT must be an integer from 1024 through 65000.');
  }
  for (let offset = 0; offset <= MAX_PORT_SEARCH && first + offset <= 65_535; offset += 1) {
    if (await localPortIsFree(first + offset)) return first + offset;
  }
  throw new Error(`Could not find a free local Playwright port from ${first}.`);
}

export async function runFocusedBrowserSpecs(specs: readonly string[]): Promise<void> {
  const lanes = focusedBrowserLanes(specs);
  if (!lanes.length) throw new Error('Focused browser verification requires selected specifications.');
  const port = await selectPlaywrightPort();
  const workspace = createHostedBrowserWorkspace(REPOSITORY_ROOT);
  const environment = {
    ...process.env,
    CI: '1',
    WHOISLEUTH_E2E_USE_BUILD: '1',
    WHOISLEUTH_E2E_PORT: String(port),
    WHOISLEUTH_PLAYWRIGHT_RUN_LABEL: 'focused iteration',
    WHOISLEUTH_BUILD_REVISION: workspace.revision,
  };
  process.stdout.write(`\n> focused-browser (${specs.length} spec file(s), frozen checkout, port ${port})\n`);
  const interruption = new AbortController();
  let requestedSignal: NodeJS.Signals | null = null;
  const stop = (signal: NodeJS.Signals) => {
    requestedSignal = signal;
    interruption.abort();
  };
  const onInterrupt = () => stop('SIGINT');
  const onTerminate = () => stop('SIGTERM');
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);

  try {
    await runHostedBrowserWorkspace(workspace, async () => {
      for (const lane of lanes) {
        const laneEnvironment = { ...environment, WHOISLEUTH_PLAYWRIGHT_RUN_KIND: lane.kind,
          WHOISLEUTH_PLAYWRIGHT_SHARD: '', WHOISLEUTH_E2E_PERFORMANCE_FIRST: '1' };
        const exitCode = await runPlaywrightProcess([
          path.join(workspace.root, 'node_modules/@playwright/test/cli.js'),
          'test',
          ...lane.specs,
          `--project=${lane.project}`,
          '--workers=1',
          '--retries=0',
        ], {
          cwd: workspace.root,
          env: laneEnvironment,
          signal: interruption.signal,
        });
        if (requestedSignal) throw new Error(`Focused browser verification was interrupted by ${requestedSignal}.`);

        const resultPath = path.join(workspace.root, playwrightRunArtifacts(laneEnvironment).jsonResults);
        if (!existsSync(resultPath)) throw new Error('Focused Playwright results were not written.');
        const report = readPlaywrightResultData(resultPath);
        assertFocusedBrowserCoverage(lane.specs, report);
        const summary = summarizePlaywrightResults(report, `focused ${lane.kind}`);
        process.stdout.write(renderPlaywrightResultSummary(summary));
        if (exitCode !== 0 || summary.failed || summary.flaky || summary.retried || summary.skipped || summary.truncated) {
          throw new Error(
            `Focused browser verification was not clean: ${summary.failed} failed, ${summary.flaky} flaky, ${summary.retried} retried, ${summary.skipped} skipped; truncated: ${summary.truncated}.`,
          );
        }
        if (!(await localPortIsFree(port))) throw new Error(`Focused Playwright left port ${port} occupied.`);
      }
      return 0;
    }, () => requestedSignal !== null);
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onTerminate);
  }
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  let cleanupBrowserArtifacts = false;
  let failure: unknown;
  try {
    const options = parseFocusedVerificationOptions(args);
    const paths = options.changed ? discoverFocusedVerificationPaths(options.since) : options.paths;
    const plan = await createVerificationOwnershipPlan(paths);
    const execution = buildFocusedVerificationExecution(plan);
    process.stdout.write(renderExecutionPlan(plan, execution));
    if (options.list) return 0;
    for (const command of execution.commands) {
      if (execution.cleanupBrowserArtifacts
        && (command.id === 'typecheck' || command.id === 'check' || command.id === 'build')) {
        cleanupBrowserArtifacts = true;
      }
      runCommand(command);
    }
    if (execution.browserSpecs.length) await runFocusedBrowserSpecs(execution.browserSpecs);
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
  process.stdout.write('\nFocused verification passed for the listed scope. Report any checks not run when opening a pull request; complete hosted verification remains required before merge.\n');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
