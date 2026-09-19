import { requiredValue } from './value-assertions.mts';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse, stringify } from 'yaml';
import ts from 'typescript';

import {
  isPlaywrightFunctionalSpec,
  PERFORMANCE_TIMING_POLICY,
  PLAYWRIGHT_PERFORMANCE_AUTHORITY_PROJECT,
  PLAYWRIGHT_PERFORMANCE_AUTHORITY_SPEC_PATTERN,
  PLAYWRIGHT_PERFORMANCE_AUTHORITY_SPECS,
  installNavigationReadinessMark,
  performanceMeasurementContext,
  performanceSampleMedian,
  summarizePerformanceTimings,
  resetPerformanceSampleState,
  resolvePlaywrightExecutionContract,
} from '../tools/playwright-execution-contract.mts';
import { buildBalancedBrowserShardPlan, readVerificationTestInventory, readVerificationTimingProfile } from '../tools/verification-timing-profile.mts';
import {
  CI_BROWSER_HEALTH_SCRIPTS,
  CI_BROWSER_BUILD_SCRIPTS,
  CI_COMMAND_GROUPS,
  CI_CLI_RUNTIME_NODE_MAJOR,
  CI_CLI_RUNTIME_SCRIPTS,
  CI_FRONTEND_BUILD_ARTIFACT_NAME,
  CI_HOSTED_ONLY_BROWSER_SCRIPTS,
  CI_PREFLIGHT_SCRIPTS,
  CI_QUALITY_SCRIPTS,
  CI_UNIT_SCRIPTS,
  assertHostedCiParity,
  assertLocalCiRuntime,
  assertPlaywrightBrowserCacheWritable,
  ciCommandGroupScripts,
  expectedHostedCiScriptPlan,
  formatLocalCiPlan,
  parseCiVerificationArguments,
  playwrightBrowserCacheDirectory,
  readHostedCiScriptPlan,
  runCiCommandGroup,
  selectNodeRuntimeExecutable,
} from '../tools/ci-verification.mts';
import {
  buildToolchainCompatibilityReport,
  main as toolchainCompatibilityMain,
  resolveUnitTestExecutables,
  satisfiesCaretAlternatives,
  unitTestExecutableEnvironment,
} from '../tools/toolchain-compatibility.mts';
import { runFunctionalRunsSerially } from '../tools/playwright-balanced-suite.mts';
import { environmentWithoutV8Coverage } from './helpers/subprocess-environment.mts';
import { assertAppliedBrowserSafety } from '../tools/analyst-journey-assurance.mts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW_PATH = path.join(__dirname, '..', '.github', 'workflows', 'ci.yml');
const WORKFLOW = fs.readFileSync(WORKFLOW_PATH, 'utf8');
const STRESS_WORKFLOW = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'e2e-stress.yml'),
  'utf8',
);
const TEST_HEALTH_WORKFLOW = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'test-health.yml'),
  'utf8',
);
const PRODUCTION_DEPENDENCY_AUDIT_WORKFLOW = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'dependency-audit.yml'),
  'utf8',
);
const E2E_DIRECTORY = path.join(__dirname, '..', 'e2e');
const E2E_SOURCES = fs.readdirSync(E2E_DIRECTORY)
  .filter((entry) => entry.endsWith('.ts'))
  .map((entry) => ({
    entry,
    source: fs.readFileSync(path.join(E2E_DIRECTORY, entry), 'utf8'),
  }));
const PACKAGE_MANIFEST = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'package.json'),
  'utf8',
)) as { scripts?: Record<string, string> };
const FRONTEND_PACKAGE_MANIFEST = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'package.json'),
  'utf8',
)) as { scripts?: Record<string, string> };

type WorkflowFixture = {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: Record<string, {
    if?: string;
    needs?: string[];
    steps: Array<{
      name?: string;
      uses?: string;
      run?: string;
      if?: string | boolean;
      env?: Record<string, string>;
      with?: Record<string, unknown>;
      'continue-on-error'?: boolean;
    }>;
  }>;
};

function workflowFixture(): WorkflowFixture {
  return parse(WORKFLOW) as WorkflowFixture;
}

function fixtureJob(workflow: WorkflowFixture, name: string) {
  return requiredValue(workflow.jobs[name]);
}

function toolchainManifests() {
  return {
    packageManifest: { devDependencies: { '@types/node': '^24.13.3', typescript: '^6.0.3' } },
    frontendManifest: { devDependencies: { typescript: '^6.0.3' } },
    lockfile: {
      packages: {
        'node_modules/@types/node': { version: '24.13.3' },
        'node_modules/typescript': { version: '6.0.3' },
        'node_modules/@sveltejs/kit': { peerDependencies: { typescript: '^5.3.3 || ^6.0.0' } },
        'node_modules/svelte-check': { peerDependencies: { typescript: '^5.0.0 || ^6.0.0' } },
      },
    },
  };
}

function pinnedActions(workflow: string): ReadonlyArray<Readonly<{ action: string; revision: string }>> {
  return [...workflow.matchAll(/^\s+uses: ([^@\s]+)@([^\s#]+)/gmu)]
    .map((match) => ({
      action: requiredValue(match[1]),
      revision: requiredValue(match[2]),
    }));
}

function occurrences(value: string, pattern: RegExp): number {
  return [...value.matchAll(pattern)].length;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

describe('continuous integration workflow', () => {
  test('keeps deliberately interrupted subprocesses outside the parent coverage collector', (context) => {
    const source = { PATH: '/fixture/bin', NODE_V8_COVERAGE: '/fixture/coverage' };
    assert.deepEqual(environmentWithoutV8Coverage(source), { PATH: '/fixture/bin', NODE_V8_COVERAGE: undefined });
    assert.equal(source.NODE_V8_COVERAGE, '/fixture/coverage');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'whoisleuth-coverage-inheritance-'));
    context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const previous = process.env.NODE_V8_COVERAGE;
    const probe = (environment: NodeJS.ProcessEnv) => {
      const child = spawnSync(process.execPath, ['-p', 'JSON.stringify(process.env.NODE_V8_COVERAGE ?? null)'], {
        env: environment, encoding: 'utf8', timeout: 5_000, maxBuffer: 64 * 1024,
      });
      assert.ifError(child.error);
      assert.equal(child.status, 0, child.stderr);
      return JSON.parse(child.stdout) as string | null;
    };
    try {
      process.env.NODE_V8_COVERAGE = directory;
      assert.equal(probe(environmentWithoutV8Coverage()), null);
      assert.deepEqual(fs.readdirSync(directory), []);
      const omitted = { ...process.env };
      delete omitted.NODE_V8_COVERAGE;
      assert.equal(probe(omitted), directory, 'omission re-enables the parent collector');
      assert.ok(fs.readdirSync(directory).some(file => /^coverage-.*\.json$/u.test(file)));
    } finally {
      if (previous === undefined) delete process.env.NODE_V8_COVERAGE;
      else process.env.NODE_V8_COVERAGE = previous;
    }
  });

  test('runs required checks for pull requests and main without write permissions', () => {
    const workflow = workflowFixture();
    assert.deepEqual(workflow.on.push, { branches: ['main'] });
    assert.ok(Object.hasOwn(workflow.on, 'pull_request'));
    assert.doesNotThrow(() => assertHostedCiParity(WORKFLOW));
    const actual = readHostedCiScriptPlan(WORKFLOW);
    for (const [lane, scripts] of Object.entries(expectedHostedCiScriptPlan())) {
      assert.deepEqual([...actual[lane as keyof typeof actual]].sort(), [...scripts].sort());
    }
  });

  test('accepts renamed steps, YAML formatting, action updates and independent preparation order', () => {
    const workflow = workflowFixture();
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps) {
        step.name = 'A different descriptive name';
        if (step.uses) step.uses = step.uses.replace(/@[a-f0-9]{40}$/u, `@${'a'.repeat(40)}`);
      }
    }
    const build = fixtureJob(workflow, 'browser-build');
    const upload = requiredValue(build.steps.find((step) => step.with?.name === CI_FRONTEND_BUILD_ARTIFACT_NAME));
    upload.with!['compression-level'] = 0;
    upload.with!['retention-days'] = 2;
    const browser = fixtureJob(workflow, 'browser');
    const installIndex = browser.steps.findIndex((step) => step.run === 'npm run test:e2e:install');
    const [install] = browser.steps.splice(installIndex, 1);
    const downloadIndex = browser.steps.findIndex((step) => step.uses?.startsWith('actions/download-artifact@'));
    browser.steps.splice(downloadIndex, 0, requiredValue(install));
    assert.doesNotThrow(() => assertHostedCiParity(stringify(workflow, { indent: 4 })));
  });

  test('rejects missing checks, ignored errors, mutable actions and an unverified build', () => {
    const candidates: Array<(workflow: WorkflowFixture) => void> = [
      (workflow) => { delete workflow.jobs['browser-build']; },
      (workflow) => { fixtureJob(workflow, 'quality').steps.pop(); },
      (workflow) => { fixtureJob(workflow, 'quality').steps.at(-1)!.if = false; },
      (workflow) => { fixtureJob(workflow, 'quality').steps.at(-1)!['continue-on-error'] = true; },
      (workflow) => { fixtureJob(workflow, 'quality').steps.at(-1)!.run += ' || true'; },
      (workflow) => { fixtureJob(workflow, 'quality').steps.at(-1)!.run = 'if false; then npm run verification:ci -- --group=quality; fi'; },
      (workflow) => { fixtureJob(workflow, 'quality').if = 'false'; },
      (workflow) => { workflow.permissions.contents = 'write'; },
      (workflow) => { fixtureJob(workflow, 'unit').steps[0]!.uses = 'actions/checkout@main'; },
      (workflow) => { fixtureJob(workflow, 'unit').steps[0]!.with!['persist-credentials'] = true; },
      (workflow) => { fixtureJob(workflow, 'browser-build').steps.at(-1)!.with!.path = 'frontend/build'; },
      (workflow) => { fixtureJob(workflow, 'browser-build').steps.at(-1)!.with!.name = 'different-build'; },
      (workflow) => {
        const browser = fixtureJob(workflow, 'browser');
        const integrity = browser.steps.findIndex((step) => step.run === 'npm run frontend:build:integrity');
        browser.steps.push(requiredValue(browser.steps.splice(integrity, 1)[0]));
      },
      (workflow) => { fixtureJob(workflow, 'browser').steps.push({ run: 'npm run build' }); },
      (workflow) => { fixtureJob(workflow, 'cli-runtime').steps = fixtureJob(workflow, 'cli-runtime').steps.filter(step => !step.uses?.startsWith('actions/download-artifact@')); },
      (workflow) => { fixtureJob(workflow, 'cli-runtime').needs = []; },
      (workflow) => { delete workflow.jobs['critical-browser']; },
      (workflow) => { fixtureJob(workflow, 'critical-browser').steps = fixtureJob(workflow, 'critical-browser').steps.filter(step => step.run !== 'npm run test:e2e:critical'); },
      (workflow) => { fixtureJob(workflow, 'critical-browser').steps = fixtureJob(workflow, 'critical-browser').steps.filter(step => step.run !== 'npm run frontend:build:integrity'); },
      (workflow) => { fixtureJob(workflow, 'critical-browser').steps.find(step => step.run === 'npm run test:e2e:critical')!['continue-on-error'] = true; },
      (workflow) => { fixtureJob(workflow, 'verify').needs = ['quality']; },
      (workflow) => { fixtureJob(workflow, 'verify').if = 'success()'; },
    ];
    for (const mutate of candidates) {
      const workflow = workflowFixture();
      mutate(workflow);
      assert.throws(() => assertHostedCiParity(stringify(workflow)));
    }
    assert.throws(() => assertHostedCiParity('jobs: {}\njobs: {}'), /valid YAML/u);
    assert.throws(() => assertHostedCiParity('x'.repeat(512 * 1024 + 1)), /bound/u);
  });

  test('executes the final gate against every result, including newly added lanes', () => {
    const workflow = workflowFixture();
    const verify = fixtureJob(workflow, 'verify');
    const gate = requiredValue(verify.steps.find((step) => step.env?.NEEDS_RESULTS));
    assert.equal(gate.env?.NEEDS_RESULTS, '${{ toJSON(needs) }}');
    const successes = Object.fromEntries(requiredValue(verify.needs).map((name) => [name, { result: 'success' }]));
    const execute = (results: unknown) => spawnSync('bash', ['-e', '-o', 'pipefail', '-c', requiredValue(gate.run)], {
      env: { ...process.env, NEEDS_RESULTS: JSON.stringify(results) }, encoding: 'utf8', timeout: 5000,
    }).status;
    assert.equal(execute(successes), 0);
    assert.notEqual(execute({}), 0);
    for (const name of [...Object.keys(successes), 'future-verification']) {
      for (const result of ['failure', 'cancelled', 'skipped', null]) {
        assert.notEqual(execute({ ...successes, [name]: { result } }), 0, `${name}: ${result}`);
      }
    }
  });

  test('can inspect and run pre-install checks without loading the development parser', () => {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import Module from 'node:module';
      const load = Module._load;
      Module._load = function (id, ...args) {
        if (id === 'yaml') throw new Error('development dependencies are not installed');
        return load.call(this, id, ...args);
      };
      const { main, runCiCommandGroup } = await import('./tools/ci-verification.mts');
      if (main(['--list']) !== 0) process.exit(2);
      const scripts = [];
      runCiCommandGroup('preflight', (script) => scripts.push(script));
      if (!scripts.includes('release:check')) process.exit(3);
    `], { cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 5000 });
    assert.equal(child.status, 0, child.stderr);
  });

  test('executes canonical local groups and stops at the first failed command', () => {
    const shardPlan = buildBalancedBrowserShardPlan(readVerificationTimingProfile());
    const assigned = shardPlan.shards.flatMap((shard) => shard.files);
    assert.equal(shardPlan.shards.length, 4);
    assert.equal(new Set(assigned).size, assigned.length);
    assert.deepEqual(assigned.sort(), readVerificationTestInventory().filter(isPlaywrightFunctionalSpec).sort());
    assert.equal(PACKAGE_MANIFEST.scripts?.['verification:ci'], 'node tools/ci-verification.mts');
    assert.deepEqual(CI_COMMAND_GROUPS, ['preflight', 'quality', 'unit', 'browser-build', 'cli-runtime']);
    assert.deepEqual(parseCiVerificationArguments([]), { mode: 'full' });
    assert.deepEqual(parseCiVerificationArguments(['--list']), { mode: 'list' });
    assert.deepEqual(parseCiVerificationArguments(['--group=quality']), { mode: 'group', group: 'quality' });
    assert.deepEqual(parseCiVerificationArguments(['--group', 'browser-build']), { mode: 'group', group: 'browser-build' });
    assert.throws(() => parseCiVerificationArguments(['--group=unknown']), /Usage/u);
    const dispatched: Array<Readonly<{ script: string; args: readonly string[] }>> = [];
    runCiCommandGroup('quality', (script, args) => dispatched.push({ script, args }));
    assert.deepEqual(dispatched, CI_QUALITY_SCRIPTS.map((script) => ({ script, args: [] })));
    const stopped: string[] = [];
    assert.throws(() => runCiCommandGroup('quality', (script) => {
      stopped.push(script);
      if (stopped.length === 2) throw new Error('fixture command failure');
    }), /fixture command failure/u);
    assert.deepEqual(stopped, CI_QUALITY_SCRIPTS.slice(0, 2));
    assert.deepEqual(ciCommandGroupScripts('browser-build'), CI_BROWSER_BUILD_SCRIPTS);
    const localPlan = formatLocalCiPlan();
    for (const script of [...CI_PREFLIGHT_SCRIPTS, ...CI_QUALITY_SCRIPTS, ...CI_UNIT_SCRIPTS, ...CI_BROWSER_BUILD_SCRIPTS]) {
      assert.match(localPlan, new RegExp(`^${escapeRegExp(script)}$`, 'mu'));
    }
    assert.match(localPlan, /^test:e2e:built \(performance, functional shards, browser-health aggregation and timing candidate\)$/mu);
    assert.match(localPlan, /^verification:artifacts cleanup=all$/mu);
    assert.match(localPlan, /^test:e2e:critical:install$/mu);
    assert.doesNotMatch(localPlan, /^test:e2e:install$/mu);
    assert.ok(localPlan.indexOf('changed-line secret scan') < localPlan.indexOf('release:check'));
    assert.ok(localPlan.indexOf('release:check') < localPlan.indexOf('locked install'));
    assert.ok(localPlan.indexOf('locked install') < localPlan.indexOf('toolchain:check'));
    assert.match(localPlan, /locked install \(install-time audit disabled; scheduled and release audits are separate\)/u);
    assert.deepEqual(CI_HOSTED_ONLY_BROWSER_SCRIPTS, [
      'frontend:build:integrity',
      'test:e2e:install',
      'test:e2e:shard',
      'frontend:authenticated-loading-report',
      'test:e2e:summary',
      'verification:artifacts',
    ]);
    assert.deepEqual(CI_BROWSER_HEALTH_SCRIPTS, [
      'test:e2e:aggregate',
      'test:e2e:aggregate',
      'verification:timing:update-candidate',
    ]);
    assert.equal(CI_CLI_RUNTIME_NODE_MAJOR, 26);
    assert.ok(CI_CLI_RUNTIME_SCRIPTS.includes('cli:package:check'));
    assert.ok(CI_CLI_RUNTIME_SCRIPTS.includes('capture:package:check'));
    assert.match(localPlan, /^cli:package:check \(Node 26 compatibility runtime\)$/mu);
    assert.equal(
      selectNodeRuntimeExecutable(26, ['/fixture/node-24', '/fixture/node-26'], (candidate) => (
        candidate.endsWith('node-26') ? '26' : '24'
      )),
      '/fixture/node-26',
    );
    assert.throws(
      () => selectNodeRuntimeExecutable(26, ['/fixture/node-24'], () => '24'),
      /requires a Node\.js 26 executable/u,
    );
    assert.doesNotThrow(() => assertLocalCiRuntime('24.19.0', '24.19.0'));
    assert.throws(() => assertLocalCiRuntime('26.0.0', '24.19.0'), /requires Node\.js 24\.19\.0/u);
  });

  test('fails before expensive local work when the Playwright browser cache is not writable', (context) => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'whoisleuth-browser-cache-test-'));
    context.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

    assert.equal(
      playwrightBrowserCacheDirectory({}, 'darwin', '/fixture/home', '/fixture/repository'),
      '/fixture/home/Library/Caches/ms-playwright',
    );
    assert.equal(
      playwrightBrowserCacheDirectory(
        { XDG_CACHE_HOME: '/fixture/cache' },
        'linux',
        '/fixture/home',
        '/fixture/repository',
      ),
      '/fixture/cache/ms-playwright',
    );
    assert.equal(
      playwrightBrowserCacheDirectory(
        { PLAYWRIGHT_BROWSERS_PATH: 'browser-cache', INIT_CWD: '/fixture/project' },
        'linux',
        '/fixture/home',
        '/fixture/repository',
      ),
      '/fixture/project/browser-cache',
    );
    assert.equal(
      playwrightBrowserCacheDirectory(
        { PLAYWRIGHT_BROWSERS_PATH: '0' },
        'linux',
        '/fixture/home',
        '/fixture/repository',
      ),
      '/fixture/repository/node_modules/playwright-core/.local-browsers',
    );

    const writableCache = path.join(temporaryRoot, 'cache');
    assert.doesNotThrow(() => assertPlaywrightBrowserCacheWritable(writableCache));
    assert.deepEqual(fs.readdirSync(writableCache), []);

    const blockingFile = path.join(temporaryRoot, 'not-a-directory');
    fs.writeFileSync(blockingFile, 'fixture', 'utf8');
    assert.throws(
      () => assertPlaywrightBrowserCacheWritable(path.join(blockingFile, 'cache')),
      /requires write access to the Playwright browser cache/u,
    );
  });

  test('preflights every unit-shell executable and preserves resolved paths with spaces', (context) => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'whoisleuth-shell-preflight-'));
    const executableDirectory = path.join(temporaryRoot, 'bin with spaces');
    fs.mkdirSync(executableDirectory);
    context.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

    assert.throws(() => resolveUnitTestExecutables(['zsh', 'fish', 'pwsh'], {
      environment: { PATH: path.join(temporaryRoot, 'missing') },
      cwd: temporaryRoot,
    }), (error) => error instanceof Error
      && error.message.includes('zsh: not found')
      && error.message.includes('fish: not found')
      && error.message.includes('pwsh: not found'));

    const failing = path.join(executableDirectory, 'zsh');
    fs.writeFileSync(failing, '#!/bin/sh\necho fixture-failure >&2\nexit 7\n', { mode: 0o755 });
    assert.throws(() => resolveUnitTestExecutables(['zsh'], {
      environment: { PATH: executableDirectory },
      cwd: temporaryRoot,
    }), /zsh: probe exited 7 \(fixture-failure\)/u);

    assert.throws(() => resolveUnitTestExecutables(['zsh'], {
      environment: { PATH: executableDirectory },
      cwd: temporaryRoot,
      probe: () => ({
        error: new Error('fixture launch failure'),
        signal: null,
        status: null,
        stderr: '',
      }),
    }), /zsh: failed to launch \(fixture launch failure\)/u);

    for (const executable of ['bash', 'zsh', 'fish', 'pwsh']) {
      fs.writeFileSync(path.join(executableDirectory, executable), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    }
    const sourceEnvironment = { PATH: executableDirectory, PRESERVED_VALUE: 'yes' };
    const resolved = resolveUnitTestExecutables(undefined, {
      environment: sourceEnvironment,
      cwd: temporaryRoot,
    });
    assert.deepEqual([...resolved], [
      ['bash', path.join(executableDirectory, 'bash')],
      ['zsh', path.join(executableDirectory, 'zsh')],
      ['fish', path.join(executableDirectory, 'fish')],
      ['pwsh', path.join(executableDirectory, 'pwsh')],
    ]);
    const executionEnvironment = unitTestExecutableEnvironment(resolved, sourceEnvironment);
    assert.equal(executionEnvironment.PATH, executableDirectory);
    assert.equal(executionEnvironment.PRESERVED_VALUE, 'yes');
    assert.equal(executionEnvironment.WHOISLEUTH_VERIFICATION_BASH, path.join(executableDirectory, 'bash'));
    assert.equal(executionEnvironment.WHOISLEUTH_VERIFICATION_ZSH, path.join(executableDirectory, 'zsh'));
    assert.equal(executionEnvironment.WHOISLEUTH_VERIFICATION_FISH, path.join(executableDirectory, 'fish'));
    assert.equal(executionEnvironment.WHOISLEUTH_VERIFICATION_PWSH, path.join(executableDirectory, 'pwsh'));
  });

  test('keeps the live production audit outside required per-push verification', () => {
    assert.match(PRODUCTION_DEPENDENCY_AUDIT_WORKFLOW, /^on:\s*\n\s{2}schedule:\s*\n\s{4}- cron: '29 3 \* \* 2'\s*\n\s{2}workflow_dispatch:$/mu);
    assert.match(PRODUCTION_DEPENDENCY_AUDIT_WORKFLOW, /^permissions:\s*\n\s{2}contents: read$/mu);
    assert.match(PRODUCTION_DEPENDENCY_AUDIT_WORKFLOW, /^\s{2}cancel-in-progress: false$/mu);
    assert.match(PRODUCTION_DEPENDENCY_AUDIT_WORKFLOW, /^\s{4}timeout-minutes: 10$/mu);
    assert.match(PRODUCTION_DEPENDENCY_AUDIT_WORKFLOW, /^\s+run: npm run dependencies:audit$/mu);
    assert.doesNotMatch(PRODUCTION_DEPENDENCY_AUDIT_WORKFLOW, /npm (?:ci|install)|continue-on-error|write\b/iu);
    const actions = pinnedActions(PRODUCTION_DEPENDENCY_AUDIT_WORKFLOW);
    assert.deepEqual(actions.map(({ action }) => action), ['actions/checkout', 'actions/setup-node']);
    for (const { revision } of actions) assert.match(requiredValue(revision), /^[a-f0-9]{40}$/u);
    assert.match(PRODUCTION_DEPENDENCY_AUDIT_WORKFLOW, /^\s{10}persist-credentials: false$/mu);
    assert.match(PRODUCTION_DEPENDENCY_AUDIT_WORKFLOW, /^\s{10}package-manager-cache: false$/mu);
  });

  test('resolves the same safe Playwright contract across local, hosted and performance lanes', () => {
    const assertSafeConfiguration = (configuration: Readonly<{
      forbidOnly: boolean;
      failOnFlakyTests: boolean;
      retries: number;
      workers: number;
      trace: string;
      screenshot: string;
    }>) => {
      if (configuration.forbidOnly !== true || configuration.failOnFlakyTests !== true
        || configuration.retries !== 0 || configuration.workers !== 1
        || configuration.trace !== 'retain-on-failure'
        || configuration.screenshot !== 'only-on-failure') {
        throw new TypeError('Resolved Playwright configuration weakened the maintained execution contract.');
      }
    };
    const local = resolvePlaywrightExecutionContract({});
    assert.doesNotThrow(() => assertSafeConfiguration(local));
    assert.equal(local.hosted, false);
    assert.equal(local.useExistingBuild, false);
    assert.equal(local.includePerformanceAuthority, false);

    const hosted = resolvePlaywrightExecutionContract({ CI: '1' });
    assertSafeConfiguration(hosted);
    assert.equal(hosted.hosted, true);
    assert.equal(hosted.useExistingBuild, true);

    const performance = resolvePlaywrightExecutionContract({
      WHOISLEUTH_E2E_PERFORMANCE_FIRST: '1',
      WHOISLEUTH_PLAYWRIGHT_RUN_KIND: 'performance',
    });
    assertSafeConfiguration(performance);
    assert.equal(performance.includePerformanceAuthority, true);
    assert.equal(performance.functionalProject.excludedSpecs, PLAYWRIGHT_PERFORMANCE_AUTHORITY_SPEC_PATTERN);
    assert.equal(performance.performanceProject.matchedSpecs, PLAYWRIGHT_PERFORMANCE_AUTHORITY_SPEC_PATTERN);
    assert.deepEqual(performance.performanceProject.dependencies, ['setup']);
    assert.equal(performance.performanceProject.workers, 1);
    assert.equal(performance.performanceProject.fullyParallel, false);
    assert.equal(performance.performanceProject.retries, 0);

    assert.throws(
      () => assertSafeConfiguration({ ...local, retries: 1 }),
      /weakened the maintained execution contract/u,
    );
  });

  test('verifies the applied configuration and automatic fixture instead of only their declarations', (context) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'whoisleuth-browser-contract-controls-'));
    context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    assert.doesNotThrow(() => assertAppliedBrowserSafety());

    const configuration = path.join(__dirname, '..', 'playwright.config.ts');
    const weakenedConfiguration = path.join(directory, 'weakened.config.cjs');
    fs.writeFileSync(weakenedConfiguration, `
      const imported = require(${JSON.stringify(configuration)});
      const configuration = imported.default ?? imported;
      module.exports = { ...configuration, testDir: ${JSON.stringify(E2E_DIRECTORY)}, forbidOnly: false };
    `);
    assert.throws(() => assertAppliedBrowserSafety({ configurationFile: weakenedConfiguration }), /Applied Playwright configuration weakened/u);

    for (const patch of [
      "webServer: { ...configuration.webServer, command: 'node server.mts' }",
      'globalTeardown: undefined',
    ]) {
      fs.writeFileSync(weakenedConfiguration, `
        const imported = require(${JSON.stringify(configuration)});
        const configuration = imported.default ?? imported;
        module.exports = { ...configuration, testDir: ${JSON.stringify(E2E_DIRECTORY)}, ${patch} };
      `);
      assert.throws(() => assertAppliedBrowserSafety({ configurationFile: weakenedConfiguration }), /independent server egress guard/u);
    }

    const fixtures = pathToFileURL(path.join(E2E_DIRECTORY, 'fixtures.ts')).href;
    for (const auto of [false, true]) {
      const disconnectedFixture = path.join(directory, `disconnected-${auto}.mts`);
      fs.writeFileSync(disconnectedFixture, `
        import { test as original, expect } from ${JSON.stringify(fixtures)};
        export { expect };
        export const test = original.extend({
          networkAndConsoleGuard: [async ({}, use) => { await use(); }, { auto: ${auto} }]
        });
      `);
      assert.throws(() => assertAppliedBrowserSafety({ fixtureFile: disconnectedFixture }), /applied automatic network fixture/u);
    }
  });

  test('discovers critical storage and native navigation behaviours in both secondary engines', () => {
    const root = path.join(__dirname, '..');
    const environment = environmentWithoutV8Coverage();
    // Listing never starts a browser or server. Keep this pre-build inspection
    // independent of the caller's execution mode and report-output settings.
    // Real browser execution still requires the verified build in CI.
    for (const name of ['CI', 'WHOISLEUTH_E2E_USE_BUILD', 'PLAYWRIGHT_JSON_OUTPUT_NAME', 'PLAYWRIGHT_JSON_OUTPUT_FILE', 'PLAYWRIGHT_JSON_OUTPUT_DIR']) {
      delete environment[name];
    }
    const child = spawnSync(process.execPath, [
      path.join(root, 'node_modules/@playwright/test/cli.js'), 'test',
      '--config=e2e/cross-browser.config.ts', '--grep=@cross-browser-critical', '--list', '--reporter=json',
    ], {
      cwd: root, encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
      env: { ...environment, WHOISLEUTH_PLAYWRIGHT_SHARD: '' },
    });
    assert.equal(child.status, 0, child.stderr || child.error?.message);
    type Suite = { suites?: Suite[]; specs?: { title: string; tests: { projectName: string; expectedStatus: string }[] }[] };
    const report = JSON.parse(child.stdout) as { suites: Suite[]; errors: unknown[] };
    assert.deepEqual(report.errors, []);
    const specifications = (suites: Suite[]): NonNullable<Suite['specs']> => suites.flatMap(suite => [
      ...(suite.specs ?? []), ...specifications(suite.suites ?? []),
    ]);
    const specs = specifications(report.suites);
    for (const engine of ['firefox', 'webkit']) {
      for (const behaviour of [
        /drafts recover.*clear atomically/u,
        /cancellation.*manual lock/u,
        /cancellation.*idle lock/u,
        /encrypted.*backup round trip/u,
        /open-in-new-tab activation/u,
        /committed restore.*not a second restore/u,
      ]) {
        assert.ok(specs.some(spec => behaviour.test(spec.title)
          && spec.tests.some(test => test.projectName === engine && test.expectedStatus === 'passed')),
        `${engine} must execute ${behaviour}`);
      }
    }
  });

  test('keeps performance reporting in CI with isolated samples and functional readiness checks', async () => {
    const performance = requiredValue(fixtureJob(workflowFixture(), 'browser').steps.find(
      (step) => step.run === 'npm run frontend:authenticated-loading-report',
    ));
    assert.equal(performance.if, "${{ matrix.kind == 'performance' }}");
    assert.equal(
      PACKAGE_MANIFEST.scripts?.['test:e2e'],
      'node tools/playwright-balanced-suite.mts',
    );
    assert.equal(
      PACKAGE_MANIFEST.scripts?.['test:e2e:built'],
      'node tools/playwright-balanced-suite.mts --use-build',
    );
    assert.equal(
      PACKAGE_MANIFEST.scripts?.['frontend:authenticated-loading-report'],
      'node tools/playwright-performance-authority.mts',
    );
    assert.equal(PLAYWRIGHT_PERFORMANCE_AUTHORITY_PROJECT, 'performance-measurement');
    assert.deepEqual(PLAYWRIGHT_PERFORMANCE_AUTHORITY_SPECS, [
      'e2e/console-loading.spec.ts',
      'e2e/deferred-interactions.spec.ts',
    ]);
    assert.equal(PERFORMANCE_TIMING_POLICY, 'observational');
    assert.equal(performanceSampleMedian([30, 10, 20]), 20);
    assert.throws(() => performanceSampleMedian([10, 20]), /exactly 3/u);

    const operations: string[] = [];
    const page = {
      url: () => 'http://127.0.0.1:4173/lookup',
      evaluate: async () => { operations.push('clear-session-storage'); },
      goto: async (url: string) => { operations.push(`goto:${url}`); },
      context: () => ({
        newCDPSession: async () => ({
          send: async (method: string) => { operations.push(method); },
          detach: async () => { operations.push('detach'); },
        }),
      }),
    };
    await resetPerformanceSampleState(page as never, 'http://127.0.0.1:4173');
    assert.deepEqual(operations, [
      'clear-session-storage',
      'goto:about:blank',
      'Network.enable',
      'Network.clearBrowserCache',
      'Storage.clearDataForOrigin',
      'detach',
    ]);

    const installedTargets: unknown[] = [];
    await installNavigationReadinessMark({
      addInitScript: async (_callback: unknown, targets: unknown) => { installedTargets.push(targets); },
    } as never, [{ selector: '#ready', requireEnabled: true, visibility: 'attached' }]);
    assert.deepEqual(installedTargets, [[{ selector: '#ready', requireEnabled: true, visibility: 'attached' }]]);
    await assert.rejects(
      installNavigationReadinessMark({ addInitScript: async () => undefined } as never, []),
      /between one and four/u,
    );
  });

  test('retains slow observations without promoting machine speed into an acceptance limit', () => {
    const samples = [
      { usableMs: 2_500, longTaskTotalMs: 1_500 },
      { usableMs: 120, longTaskTotalMs: 0 },
      { usableMs: 700, longTaskTotalMs: 60 },
    ];
    const expected = {
      usableMsMedian: 700,
      usableMsMaximum: 2_500,
      longTaskTotalMsMedian: 60,
      longTaskTotalMsMaximum: 1_500,
    };
    assert.deepEqual(summarizePerformanceTimings(samples), expected);
    assert.deepEqual(summarizePerformanceTimings(samples.map((sample) => ({
      usableMs: sample.usableMs * 10,
      longTaskTotalMs: sample.longTaskTotalMs * 10,
    }))), Object.fromEntries(Object.entries(expected).map(([key, value]) => [key, value * 10])));
    assert.throws(() => summarizePerformanceTimings(samples.slice(1)), /exactly 3/u);
    for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      for (const field of ['usableMs', 'longTaskTotalMs'] as const) {
        assert.throws(
          () => summarizePerformanceTimings([{ ...samples[0]!, [field]: invalid }, ...samples.slice(1)]),
          /finite non-negative/u,
        );
      }
    }
  });

  test('records execution context without assuming a particular operating system or browser', () => {
    const context = performanceMeasurementContext({
      context: () => ({ browser: () => ({
        browserType: () => ({ name: () => 'chromium' }),
        version: () => '123.0.0.0',
      }) }),
      viewportSize: () => ({ width: 1280, height: 720 }),
    } as never, {
      project: { name: PLAYWRIGHT_PERFORMANCE_AUTHORITY_PROJECT },
      config: { workers: 1 },
    } as never);
    assert.deepEqual(context, {
      hostPlatform: process.platform,
      hostArchitecture: process.arch,
      nodeVersion: process.versions.node,
      browserName: 'chromium',
      browserVersion: '123.0.0.0',
      viewport: { width: 1280, height: 720 },
      project: PLAYWRIGHT_PERFORMANCE_AUTHORITY_PROJECT,
      configuredWorkers: 1,
    });
    const unavailable = performanceMeasurementContext({
      context: () => ({ browser: () => null }),
      viewportSize: () => null,
    } as never, { project: { name: 'unavailable-browser' }, config: { workers: 1 } } as never);
    assert.equal(unavailable.browserName, null);
    assert.equal(unavailable.browserVersion, null);
    assert.equal(unavailable.viewport, null);
  });

  test('stops serial local browser shards after an interruption without hiding ordinary failures', async () => {
    const runs = ['1/4', '2/4', '3/4'].map((identity, index) => ({
      label: `functional shard ${identity}`,
      environment: {},
      port: 4_180 + index,
      args: ['runner', `--run=${identity}`],
    }));
    const interruptedLaunches: string[] = [];
    const verifiedPorts: number[] = [];
    let interrupted = false;
    const interruptedResult = await runFunctionalRunsSerially(runs, {
      execute: async (run) => {
        interruptedLaunches.push(run.label);
        interrupted = true;
        return 2;
      },
      verifyPortFree: async (run) => {
        verifiedPorts.push(run.port);
      },
      readResult: (run) => run.label,
      isInterrupted: () => interrupted,
    });
    assert.deepEqual(interruptedLaunches, ['functional shard 1/4']);
    assert.deepEqual(verifiedPorts, [4_180]);
    assert.deepEqual(interruptedResult, { exits: [2], reports: [], interrupted: true });

    const ordinaryLaunches: string[] = [];
    let liveResult = '';
    const ordinaryResult = await runFunctionalRunsSerially(runs, {
      execute: async (run) => {
        ordinaryLaunches.push(run.label);
        liveResult = `${run.label} report`;
        return run.label.endsWith('2/4') ? 2 : 0;
      },
      verifyPortFree: async () => undefined,
      readResult: () => liveResult,
      isInterrupted: () => false,
    });
    assert.deepEqual(ordinaryLaunches, runs.map((run) => run.label));
    assert.deepEqual(ordinaryResult, {
      exits: [0, 2, 0],
      reports: ['functional shard 1/4 report', 'functional shard 3/4 report'],
      interrupted: false,
    });

    const launchesBeforeMissingReport: string[] = [];
    await assert.rejects(
      runFunctionalRunsSerially(runs, {
        execute: async (run) => {
          launchesBeforeMissingReport.push(run.label);
          return 0;
        },
        verifyPortFree: async () => undefined,
        readResult: () => {
          throw new Error('Functional shard report is missing.');
        },
        isInterrupted: () => false,
      }),
      /Functional shard report is missing/u,
    );
    assert.deepEqual(launchesBeforeMissingReport, ['functional shard 1/4']);
  });

  test('browser tests synchronize on observable state instead of fixed delays', () => {
    function fixedDelays(source: string): string[] {
      const found: string[] = [];
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
          const expression = node.expression;
          const name = ts.isIdentifier(expression) ? expression.text : ts.isPropertyAccessExpression(expression) ? expression.name.text : '';
          const testDeadline = ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)
            && ['test', 'testInfo'].includes(expression.expression.text) && name === 'setTimeout';
          if (['setTimeout', 'waitForTimeout'].includes(name) && !testDeadline) found.push(name);
        }
        ts.forEachChild(node, visit);
      };
      visit(ts.createSourceFile('browser-test.ts', source, ts.ScriptTarget.Latest, true));
      return found;
    }
    assert.deepEqual(fixedDelays('test.setTimeout(90_000); testInfo.setTimeout(90_000); // setTimeout(20)'), []);
    assert.deepEqual(fixedDelays('await page.waitForTimeout(10); window.setTimeout(done, 10); setTimeout(done, 10);'), ['waitForTimeout', 'setTimeout', 'setTimeout']);
    for (const { entry, source } of E2E_SOURCES) {
      assert.deepEqual(fixedDelays(source), [], `${entry} uses a fixed delay rather than observable state`);
      assert.doesNotMatch(
        source,
        /frontend\/\.svelte-kit\/output/u,
        `${entry} reads undeclared frontend builder output`,
      );
    }
  });

  test('repeats timing-sensitive browser workflows without retries on a bounded schedule', () => {
    assert.match(STRESS_WORKFLOW, /^\s{2}schedule:\s*\n\s{4}- cron: '17 3 \* \* 1'\s*\n\s{2}workflow_dispatch:$/mu);
    assert.match(STRESS_WORKFLOW, /^permissions:\s*\n\s{2}contents: read$/mu);
    assert.doesNotMatch(STRESS_WORKFLOW, /\b(?:contents|issues|pull-requests|actions): write\b/u);
    assert.match(STRESS_WORKFLOW, /^\s+run: npm run test:e2e:stress$/mu);
    assert.match(STRESS_WORKFLOW, /^\s+run: npm ci --include=optional --ignore-scripts --audit=false$/mu);
    assert.match(STRESS_WORKFLOW, /^\s+run: npm run test:e2e:summary$/mu);
    assert.equal(
      PACKAGE_MANIFEST.scripts?.['test:e2e:stress'],
      'playwright test --grep @timing-sensitive --workers=1 --retries=0 --repeat-each=10',
    );
    assert.equal(occurrences(STRESS_WORKFLOW, /^\s{10}persist-credentials: false$/gmu), 1);
    const actions = pinnedActions(STRESS_WORKFLOW);
    assert.deepEqual(actions.map(({ action }) => action), [
      'actions/checkout',
      'actions/setup-node',
      'actions/upload-artifact',
      'actions/upload-artifact',
    ]);
    for (const { revision } of actions) assert.match(revision, /^[a-f0-9]{40}$/u);
  });

  test('runs expanded property checks and duration profiling on a bounded schedule', () => {
    assert.match(TEST_HEALTH_WORKFLOW, /^\s{2}schedule:\s*\n\s{4}- cron: '43 3 \* \* 3'\s*\n\s{2}workflow_dispatch:$/mu);
    assert.match(TEST_HEALTH_WORKFLOW, /^permissions:\s*\n\s{2}contents: read$/mu);
    assert.doesNotMatch(TEST_HEALTH_WORKFLOW, /\b(?:contents|issues|pull-requests|actions): write\b/u);
    assert.match(TEST_HEALTH_WORKFLOW, /^\s+run: npm ci --include=optional --ignore-scripts --audit=false$/mu);
    assert.match(TEST_HEALTH_WORKFLOW, /^\s{10}WHOISLEUTH_FAST_CHECK_RUN_MULTIPLIER: '10'$/mu);
    assert.match(TEST_HEALTH_WORKFLOW, /^\s{10}WHOISLEUTH_FAST_CHECK_SEED: \$\{\{ github\.run_number \}\}$/mu);
    assert.match(TEST_HEALTH_WORKFLOW, /^\s+run: npm run test:properties$/mu);
    assert.match(TEST_HEALTH_WORKFLOW, /^\s+run: npm run verification:timing:check$/mu);
    assert.match(TEST_HEALTH_WORKFLOW, /npm run sources:health \| tee "\$RUNNER_TEMP\/source-health-report\.txt"/u);
    assert.match(TEST_HEALTH_WORKFLOW, /^\s+npm run sources:health -- --github-annotations$/mu);
    assert.match(TEST_HEALTH_WORKFLOW, /## Offline retained source health/u);
    assert.match(TEST_HEALTH_WORKFLOW, />> "\$GITHUB_STEP_SUMMARY"/u);
    assert.match(TEST_HEALTH_WORKFLOW, /apt-get install[^\n]*\bzsh\b/u);
    assert.match(TEST_HEALTH_WORKFLOW, /for run in 1 2 3; do\s+npm run test:profile > "\$RUNNER_TEMP\/test-duration-report-\$run\.txt"\s+done/u);
    assert.match(TEST_HEALTH_WORKFLOW, /npm run test:duration-health --/u);
    for (const run of [1, 2, 3]) {
      assert.match(TEST_HEALTH_WORKFLOW, new RegExp(`--report="\\$RUNNER_TEMP/test-duration-report-${run}\\.txt"`, 'u'));
    }
    assert.match(TEST_HEALTH_WORKFLOW, /cat "\$RUNNER_TEMP\/test-duration-health\.md" >> "\$GITHUB_STEP_SUMMARY"/u);
    assert.match(TEST_HEALTH_WORKFLOW, /--provenance-id="unit-ci-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}"/u);
    assert.match(TEST_HEALTH_WORKFLOW, /npm run --silent verification:timing:update-candidate --/u);
    assert.equal(occurrences(TEST_HEALTH_WORKFLOW, /--report="\$RUNNER_TEMP\/test-duration-report-[123]\.txt"/gu), 6);
    assert.doesNotMatch(TEST_HEALTH_WORKFLOW, /--sample-count=/u);
    assert.match(TEST_HEALTH_WORKFLOW, /^\s{12}\$\{\{ runner\.temp \}\}\/test-duration-report-\*\.txt$/mu);
    assert.match(TEST_HEALTH_WORKFLOW, /^\s{12}\$\{\{ runner\.temp \}\}\/test-duration-health\.md$/mu);
    assert.match(TEST_HEALTH_WORKFLOW, /^\s{12}\$\{\{ runner\.temp \}\}\/verification-timing-unit-candidate\.json$/mu);
    assert.doesNotMatch(TEST_HEALTH_WORKFLOW, /^\s{10}path: test-duration-report/mu);
    assert.equal(occurrences(TEST_HEALTH_WORKFLOW, /^\s{10}persist-credentials: false$/gmu), 1);
    const actions = pinnedActions(TEST_HEALTH_WORKFLOW);
    assert.deepEqual(actions.map(({ action }) => action), [
      'actions/checkout',
      'actions/setup-node',
      'actions/upload-artifact',
    ]);
    for (const { revision } of actions) assert.match(revision, /^[a-f0-9]{40}$/u);
    assert.match(PACKAGE_MANIFEST.scripts?.['test:properties'] ?? '', /verification-state-machines\.test\.mts/u);
    assert.match(PACKAGE_MANIFEST.scripts?.['test:properties:stress'] ?? '', /WHOISLEUTH_FAST_CHECK_RUN_MULTIPLIER=10/u);
    assert.match(PACKAGE_MANIFEST.scripts?.['test:properties:stress'] ?? '', /WHOISLEUTH_FAST_CHECK_SEED=334462/u);
    assert.equal(PACKAGE_MANIFEST.scripts?.['test:duration-health'], 'node tools/test-duration-health.mts');
  });
});

describe('development toolchain compatibility', () => {
  test('binds the exact runtime to matching Node.js types and supported TypeScript peers', () => {
    const report = buildToolchainCompatibilityReport({
      nvmrc: '24.19.0\n',
      runtimeVersion: '24.19.0',
      ...toolchainManifests(),
    });
    assert.deepEqual(report, {
      node: '24.19.0',
      nodeTypes: '24.13.3',
      typeScript: '6.0.3',
      typeScriptPeerRanges: [
        { installPath: 'node_modules/@sveltejs/kit', range: '^5.3.3 || ^6.0.0' },
        { installPath: 'node_modules/svelte-check', range: '^5.0.0 || ^6.0.0' },
      ],
    });
    assert.equal(satisfiesCaretAlternatives('6.0.3', '^5.3.3 || ^6.0.0'), true);
    assert.equal(satisfiesCaretAlternatives('7.0.2', '^5.3.3 || ^6.0.0'), false);
    assert.equal(satisfiesCaretAlternatives('6.0.3', '>=5'), false);
  });

  test('rejects runtime, Node.js types, TypeScript declaration and peer drift', () => {
    assert.throws(() => buildToolchainCompatibilityReport({
      nvmrc: '24.19.0', runtimeVersion: '26.4.0', ...toolchainManifests(),
    }), /does not match/);

    const nodeTypes = toolchainManifests();
    nodeTypes.packageManifest.devDependencies['@types/node'] = '^26.4.0';
    assert.throws(() => buildToolchainCompatibilityReport({
      nvmrc: '24.19.0', runtimeVersion: '24.19.0', ...nodeTypes,
    }), /must remain on/);

    const declaration = toolchainManifests();
    declaration.frontendManifest.devDependencies.typescript = '^7.0.2';
    assert.throws(() => buildToolchainCompatibilityReport({
      nvmrc: '24.19.0', runtimeVersion: '24.19.0', ...declaration,
    }), /must match exactly/);

    const peers = toolchainManifests();
    peers.lockfile.packages['node_modules/typescript'].version = '7.0.2';
    peers.packageManifest.devDependencies.typescript = '^7.0.2';
    peers.frontendManifest.devDependencies.typescript = '^7.0.2';
    assert.throws(() => buildToolchainCompatibilityReport({
      nvmrc: '24.19.0', runtimeVersion: '24.19.0', ...peers,
    }), /outside .* peer range/);
  });

  test('checks repository files and reports malformed input without exposing it', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'whoisleuth-toolchain-check-'));
    const values = toolchainManifests();
    try {
      await fs.promises.mkdir(path.join(directory, 'frontend'));
      await Promise.all([
        fs.promises.writeFile(path.join(directory, '.nvmrc'), '24.19.0\n', 'utf8'),
        fs.promises.writeFile(path.join(directory, 'package.json'), JSON.stringify(values.packageManifest), 'utf8'),
        fs.promises.writeFile(path.join(directory, 'frontend/package.json'), JSON.stringify(values.frontendManifest), 'utf8'),
        fs.promises.writeFile(path.join(directory, 'package-lock.json'), JSON.stringify(values.lockfile), 'utf8'),
      ]);
      const stdout: string[] = [];
      const stderr: string[] = [];
      assert.equal(await toolchainCompatibilityMain([], {
        repositoryRoot: directory,
        runtimeVersion: '24.19.0',
        stdout: { write: (value) => stdout.push(value) },
        stderr: { write: (value) => stderr.push(value) },
      }), 0);
      assert.match(stdout.join(''), /Node\.js: 24\.19\.0/);
      assert.equal(stderr.join(''), '');

      await fs.promises.writeFile(path.join(directory, 'package.json'), '{"private":"secret"', 'utf8');
      const failure: string[] = [];
      assert.equal(await toolchainCompatibilityMain([], {
        repositoryRoot: directory,
        runtimeVersion: '24.19.0',
        stderr: { write: (value) => failure.push(value) },
      }), 2);
      assert.match(failure.join(''), /package\.json is not valid JSON/);
      assert.doesNotMatch(failure.join(''), /secret/);
    } finally {
      await fs.promises.rm(directory, { recursive: true, force: true });
    }
  });
});
