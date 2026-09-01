#!/usr/bin/env node

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { summarizePlaywrightResults } from './playwright-results-summary.mts';
import { playwrightRunArtifacts } from './playwright-run-artifacts.mts';
import { buildBalancedBrowserShardPlan, readVerificationTimingProfile } from './verification-timing-profile.mts';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAYWRIGHT_CLI = path.join(REPOSITORY_ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
const SHARD_RUNNER = path.join(REPOSITORY_ROOT, 'tools', 'playwright-balanced-shard.mts');
const DEFAULT_BASE_PORT = 4180;
const MAX_PORT_SEARCH = 100;
const activeChildren = new Set<ChildProcess>();

type SuiteOptions = Readonly<{ useBuild: boolean }>;

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

async function selectPortRange(count: number): Promise<readonly number[]> {
  const preferred = configuredBasePort();
  for (let offset = 0; offset <= MAX_PORT_SEARCH; offset += count) {
    const ports = Array.from({ length: count }, (_, index) => preferred + offset + index);
    if (ports.at(-1)! > 65_535) break;
    if ((await Promise.all(ports.map(portIsFree))).every(Boolean)) return Object.freeze(ports);
  }
  throw new Error(`Could not find ${count} consecutive free local ports from ${preferred}.`);
}

async function requirePortRangeFree(ports: readonly number[]): Promise<void> {
  const occupied = (await Promise.all(ports.map(async (port) => ({ port, free: await portIsFree(port) }))))
    .filter((item) => !item.free)
    .map((item) => item.port);
  if (occupied.length) throw new Error(`Playwright left local test ports occupied: ${occupied.join(', ')}.`);
}

function runBuild(): void {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = spawnSync(command, ['run', 'build'], {
    cwd: REPOSITORY_ROOT,
    env: process.env,
    stdio: 'inherit',
  });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(`Frontend build failed with exit code ${child.status ?? 2}.`);
}

function requireBuild(): void {
  for (const required of [
    'frontend/build/index.html',
    'frontend/.svelte-kit/output/client/.vite/manifest.json',
  ]) {
    if (!existsSync(path.join(REPOSITORY_ROOT, required))) {
      throw new Error(`The reusable production build is missing ${required}. Run npm run build first.`);
    }
  }
}

function runProcess(label: string, args: readonly string[], environment: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    process.stdout.write(`Starting ${label}.\n`);
    const child = spawn(process.execPath, args, {
      cwd: REPOSITORY_ROOT,
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

function runEnvironment(port: number, kind: 'functional' | 'performance', shard?: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CI: '1',
    WHOISLEUTH_E2E_USE_BUILD: '1',
    WHOISLEUTH_E2E_PORT: String(port),
    WHOISLEUTH_PLAYWRIGHT_RUN_KIND: kind,
    ...(shard ? { WHOISLEUTH_PLAYWRIGHT_SHARD: shard } : {}),
    ...(kind === 'performance' ? { WHOISLEUTH_E2E_PERFORMANCE_FIRST: '1' } : {}),
  };
}

function resultSummary(environment: NodeJS.ProcessEnv) {
  const filename = path.join(REPOSITORY_ROOT, playwrightRunArtifacts(environment).jsonResults);
  const parsed: unknown = JSON.parse(readFileSync(filename, 'utf8')) as unknown;
  return summarizePlaywrightResults(parsed, playwrightRunArtifacts(environment).identity);
}

function stopChildren(): void {
  for (const child of activeChildren) child.kill('SIGTERM');
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    const options = parseOptions(args);
    if (options.useBuild) requireBuild();
    else runBuild();

    const plan = buildBalancedBrowserShardPlan(readVerificationTimingProfile());
    const ports = await selectPortRange(plan.shardCount + 1);
    const performanceEnvironment = runEnvironment(ports[plan.shardCount]!, 'performance');
    const performanceExit = await runProcess('isolated performance authority', [
      PLAYWRIGHT_CLI,
      'test',
      'e2e/console-loading.spec.ts',
      'e2e/deferred-interactions.spec.ts',
      '--project=performance-authority',
      '--workers=1',
      '--retries=0',
    ], performanceEnvironment);
    if (performanceExit !== 0) {
      await requirePortRangeFree(ports);
      return performanceExit;
    }

    const functionalRuns = plan.shards.map((shard, index) => {
      const identity = `${shard.shard}/${plan.shardCount}`;
      const environment = runEnvironment(ports[index]!, 'functional', identity);
      return Object.freeze({
        label: `functional shard ${identity}`,
        environment,
        promise: runProcess(`functional shard ${identity}`, [SHARD_RUNNER, `--run=${identity}`], environment),
      });
    });
    const exits = await Promise.all(functionalRuns.map((run) => run.promise));
    await requirePortRangeFree(ports);
    if (exits.some((code) => code !== 0)) return 2;

    const summaries = [
      resultSummary(performanceEnvironment),
      ...functionalRuns.map((run) => resultSummary(run.environment)),
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
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Balanced Playwright suite failed.'}\n`);
    return 2;
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    stopChildren();
    process.exitCode = 130;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
