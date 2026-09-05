#!/usr/bin/env node

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { playwrightPerformanceAuthorityArguments } from './playwright-execution-contract.mts';
import { createHostedBrowserWorkspace, type HostedBrowserWorkspace } from './hosted-browser-workspace.mts';
import { localPortIsFree, npmExecutableName } from './maintainer-tool-helpers.mts';
import {
  aggregatePlaywrightShardTimings,
  renderBrowserShardTimingSummary,
} from './playwright-shard-aggregate.mts';
import { summarizePlaywrightResults, type PlaywrightResultSummary } from './playwright-results-summary.mts';
import { playwrightRunArtifacts } from './playwright-run-artifacts.mts';
import {
  buildBalancedBrowserShardPlan,
  buildVerificationTimingUpdateCandidate,
  readVerificationTimingProfile,
} from './verification-timing-profile.mts';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BASE_PORT = 4180;
const MAX_PORT_SEARCH = 100;
const activeChildren = new Set<ChildProcess>();
let interruptionRequested = false;

type SuiteOptions = Readonly<{ useBuild: boolean }>;

type FunctionalRun = Readonly<{
  label: string;
  environment: NodeJS.ProcessEnv;
  port: number;
  args: readonly string[];
}>;

type FunctionalRunDependencies = Readonly<{
  execute: (run: FunctionalRun) => Promise<number>;
  verifyPortFree: (run: FunctionalRun) => Promise<void>;
  isInterrupted: () => boolean;
}>;

function parseOptions(args: readonly string[]): SuiteOptions {
  if (args.length > 1 || args.some((value) => value !== '--use-build')) {
    throw new TypeError('Usage: node tools/playwright-balanced-suite.mts [--use-build]');
  }
  return Object.freeze({ useBuild: args.includes('--use-build') });
}

function configuredBasePort(): number {
  const configured = process.env.WHOISLEUTH_E2E_PARALLEL_BASE_PORT?.trim();
  if (!configured) return DEFAULT_BASE_PORT;
  const value = Number(configured);
  if (!Number.isSafeInteger(value) || value < 1024 || value > 65_000) {
    throw new TypeError('WHOISLEUTH_E2E_PARALLEL_BASE_PORT must be an integer from 1024 through 65000.');
  }
  return value;
}

async function selectPortRange(count: number): Promise<readonly number[]> {
  const preferred = configuredBasePort();
  for (let offset = 0; offset <= MAX_PORT_SEARCH; offset += count) {
    const ports = Array.from({ length: count }, (_, index) => preferred + offset + index);
    if (ports.at(-1)! > 65_535) break;
    if ((await Promise.all(ports.map((port) => localPortIsFree(port)))).every(Boolean)) return Object.freeze(ports);
  }
  throw new Error(`Could not find ${count} consecutive free local ports from ${preferred}.`);
}

async function requirePortRangeFree(ports: readonly number[]): Promise<void> {
  const occupied = (await Promise.all(ports.map(async (port) => ({ port, free: await localPortIsFree(port) }))))
    .filter((item) => !item.free)
    .map((item) => item.port);
  if (occupied.length) throw new Error(`Playwright left local test ports occupied: ${occupied.join(', ')}.`);
}

function runBuild(): void {
  const child = spawnSync(npmExecutableName(), ['run', 'build'], {
    cwd: REPOSITORY_ROOT,
    env: process.env,
    stdio: 'inherit',
  });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(`Frontend build failed with exit code ${child.status ?? 2}.`);
}

function runProcess(
  executionRoot: string,
  label: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<number> {
  return new Promise((resolve, reject) => {
    process.stdout.write(`Starting ${label}.\n`);
    const child = spawn(process.execPath, args, {
      cwd: executionRoot,
      env: environment,
      stdio: 'inherit',
    });
    activeChildren.add(child);
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      activeChildren.delete(child);
      if (signal) {
        process.stderr.write(`${label} stopped by ${signal}.\n`);
        resolve(2);
      } else {
        process.stdout.write(`${label} finished with exit code ${code ?? 2}.\n`);
        resolve(code ?? 2);
      }
    });
  });
}

function runEnvironment(
  port: number,
  kind: 'functional' | 'performance',
  revision: string,
  shard?: string,
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CI: '1',
    WHOISLEUTH_E2E_USE_BUILD: '1',
    WHOISLEUTH_BUILD_REVISION: revision,
    WHOISLEUTH_E2E_PORT: String(port),
    WHOISLEUTH_PLAYWRIGHT_RUN_KIND: kind,
    ...(shard ? { WHOISLEUTH_PLAYWRIGHT_SHARD: shard } : {}),
    ...(kind === 'performance' ? { WHOISLEUTH_E2E_PERFORMANCE_FIRST: '1' } : {}),
  };
}

function resultData(executionRoot: string, environment: NodeJS.ProcessEnv): unknown {
  const filename = path.join(executionRoot, playwrightRunArtifacts(environment).jsonResults);
  return JSON.parse(readFileSync(filename, 'utf8')) as unknown;
}

function resultSummary(environment: NodeJS.ProcessEnv, parsed: unknown): PlaywrightResultSummary {
  return summarizePlaywrightResults(parsed, playwrightRunArtifacts(environment).identity);
}

function verifyHostedBrowserHealth(reports: readonly unknown[]): string {
  const result = aggregatePlaywrightShardTimings(reports);
  const directory = mkdtempSync(path.join(tmpdir(), 'whoisleuth-browser-health-'));
  const aggregatePath = path.join(directory, 'playwright-browser-aggregate.json');
  try {
    writeFileSync(aggregatePath, `${JSON.stringify(result.aggregate, null, 2)}\n`, 'utf8');
    const candidate = buildVerificationTimingUpdateCandidate([
      '--update-candidate',
      '--lane=browser',
      `--report=${aggregatePath}`,
      `--provenance-id=browser-local-parity-${process.pid}-${Date.now()}`,
      `--environment=${process.platform}-${process.arch}-node${process.versions.node.split('.')[0]}-serial-shards`,
      '--sample-basis=complete-four-shard-functional-run',
    ]);
    if (candidate.inventoryFingerprint !== result.aggregate.inventoryFingerprint) {
      throw new TypeError('Local browser timing candidate does not match the executed test inventory.');
    }
    return renderBrowserShardTimingSummary(result.summary);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function stopChildren(): void {
  for (const child of activeChildren) child.kill('SIGTERM');
}

export async function runFunctionalRunsSerially(
  runs: readonly FunctionalRun[],
  dependencies: FunctionalRunDependencies,
): Promise<Readonly<{ exits: readonly number[]; interrupted: boolean }>> {
  const exits: number[] = [];
  for (const run of runs) {
    if (dependencies.isInterrupted()) {
      return Object.freeze({ exits: Object.freeze(exits), interrupted: true });
    }
    exits.push(await dependencies.execute(run));
    await dependencies.verifyPortFree(run);
    if (dependencies.isInterrupted()) {
      return Object.freeze({ exits: Object.freeze(exits), interrupted: true });
    }
  }
  return Object.freeze({ exits: Object.freeze(exits), interrupted: false });
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  let workspace: HostedBrowserWorkspace | null = null;
  try {
    const options = parseOptions(args);
    if (!options.useBuild) runBuild();
    workspace = createHostedBrowserWorkspace(REPOSITORY_ROOT);
    const executionRoot = workspace.root;
    const playwrightCli = path.join(executionRoot, 'node_modules', '@playwright', 'test', 'cli.js');
    const shardRunner = path.join(executionRoot, 'tools', 'playwright-balanced-shard.mts');

    if (interruptionRequested) return 130;

    const plan = buildBalancedBrowserShardPlan(readVerificationTimingProfile());
    const ports = await selectPortRange(plan.shardCount + 1);
    try {
      if (interruptionRequested) return 130;
      const performanceEnvironment = runEnvironment(
        ports[plan.shardCount]!,
        'performance',
        workspace.revision,
      );
      const performanceExit = await runProcess(
        executionRoot,
        'isolated performance authority',
        playwrightPerformanceAuthorityArguments(playwrightCli),
        performanceEnvironment,
      );
      if (interruptionRequested) return 130;
      if (performanceExit !== 0) return performanceExit;

      const functionalRuns = plan.shards.map((shard, index) => {
        const identity = `${shard.shard}/${plan.shardCount}`;
        const environment = runEnvironment(ports[index]!, 'functional', workspace!.revision, identity);
        return Object.freeze({
          label: `functional shard ${identity}`,
          environment,
          port: ports[index]!,
          args: Object.freeze([shardRunner, `--run=${identity}`]),
        });
      });
      // Hosted CI assigns each shard its own runner. Launching all four on one
      // local host creates contention that the hosted topology does not have and
      // can turn bounded deferred-module deadlines into false product failures.
      // Preserve the exact shard plan and reports, but give each local shard the
      // same isolated execution opportunity as its hosted counterpart.
      const functionalResult = await runFunctionalRunsSerially(functionalRuns, {
        execute: (run) => runProcess(executionRoot, run.label, run.args, run.environment),
        verifyPortFree: (run) => requirePortRangeFree([run.port]),
        isInterrupted: () => interruptionRequested,
      });
      if (functionalResult.interrupted) return 130;
      if (functionalResult.exits.some((code) => code !== 0)) return 2;

      const performanceResult = resultData(executionRoot, performanceEnvironment);
      const functionalResults = functionalRuns.map((run) => resultData(executionRoot, run.environment));
      process.stdout.write(verifyHostedBrowserHealth(functionalResults));
      const summaries = [
        resultSummary(performanceEnvironment, performanceResult),
        ...functionalRuns.map((run, index) => resultSummary(run.environment, functionalResults[index])),
      ];
      const totals = summaries.reduce((summary, item) => ({
        total: summary.total + item.total,
        passed: summary.passed + item.passed,
        failed: summary.failed + item.failed,
        flaky: summary.flaky + item.flaky,
        skipped: summary.skipped + item.skipped,
        retried: summary.retried + item.retried,
      }), { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0, retried: 0 });
      process.stdout.write(
        `Accepted Playwright suite: ${totals.passed}/${totals.total} passed; `
        + `${totals.failed} failed, ${totals.flaky} flaky, ${totals.retried} retried, ${totals.skipped} skipped.\n`,
      );
      return totals.failed || totals.flaky || totals.retried ? 2 : 0;
    } finally {
      await requirePortRangeFree(ports);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Balanced Playwright suite failed.'}\n`);
    return interruptionRequested ? 130 : 2;
  } finally {
    workspace?.dispose();
  }
}

function installSignalHandlers(): void {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      interruptionRequested = true;
      stopChildren();
      process.exitCode = 130;
    });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  installSignalHandlers();
  process.exitCode = await main();
}
