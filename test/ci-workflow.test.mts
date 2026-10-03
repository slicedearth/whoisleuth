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
import { buildBalancedBrowserShardPlan, readVerificationTestInventory, readVerificationTimingProfile, VERIFICATION_BROWSER_SHARD_COUNT } from '../tools/verification-timing-profile.mts';
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
  localCiRevisionRange,
  parseCiVerificationArguments,
  playwrightBrowserCacheDirectory,
  readHostedCiScriptPlan,
  runCiCommandGroup,
  selectNodeRuntimeExecutable,
} from '../tools/ci-verification.mts';
import {
  buildToolchainCompatibilityReport,
  nodeTestFiles,
  main as toolchainCompatibilityMain,
  resolveUnitTestExecutables,
  satisfiesCaretAlternatives,
  unitTestExecutableEnvironment,
} from '../tools/toolchain-compatibility.mts';
import { runFunctionalRuns, localBrowserJobs } from '../tools/playwright-balanced-suite.mts';
import { captureVisualEvidenceEnabled, browserBuildAssetPath } from '../tools/playwright-execution-contract.mts';
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
  concurrency?: { 'cancel-in-progress'?: boolean };
  jobs: Record<string, {
    if?: string;
    needs?: string[];
    permissions?: Record<string, string>;
    env?: Record<string, string>;
    strategy?: { 'fail-fast'?: boolean; matrix?: { browser?: string[] } };
    'timeout-minutes'?: number;
    'continue-on-error'?: boolean;
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
  return workflowSteps(parse(workflow) as WorkflowFixture).flatMap(step => {
    if (!step.uses) return [];
    const [action, revision] = step.uses.split('@');
    return [{ action: requiredValue(action), revision: requiredValue(revision) }];
  });
}

function workflowSteps(workflow: WorkflowFixture) {
  return Object.values(workflow.jobs).flatMap(job => job.steps);
}

function workflowCommands(workflow: WorkflowFixture): string {
  return workflowSteps(workflow).flatMap(step => step.run ? [step.run] : []).join('\n');
}

function scheduledWorkflow(source: string, cron: string): WorkflowFixture {
  const workflow = parse(source) as WorkflowFixture;
  assert.deepEqual(Object.keys(workflow.on).sort(), ['schedule', 'workflow_dispatch']);
  assert.deepEqual(workflow.on.schedule, [{ cron }]);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.concurrency?.['cancel-in-progress'], false);
  for (const job of Object.values(workflow.jobs)) {
    assert.ok(Number.isInteger(job['timeout-minutes']) && job['timeout-minutes']! > 0 && job['timeout-minutes']! <= 60);
    assert.notEqual(job['continue-on-error'], true);
    if (job.permissions) assert.ok(Object.values(job.permissions).every(value => value === 'read' || value === 'none'));
    for (const step of job.steps) assert.notEqual(step['continue-on-error'], true);
  }
  for (const { revision } of pinnedActions(source)) assert.match(revision, /^[a-f0-9]{40}$/u);
  const checkouts = workflowSteps(workflow).filter(step => step.uses?.startsWith('actions/checkout@'));
  assert.ok(checkouts.length > 0);
  for (const checkout of checkouts) assert.equal(checkout.with?.['persist-credentials'], false);
  return workflow;
}

function occurrences(value: string, pattern: RegExp): number {
  return [...value.matchAll(pattern)].length;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

describe('continuous integration workflow', () => {
  test('discovers disjoint unit and integration lanes without a maintained file list', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whoisleuth-test-lanes-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, 'test'));
    for (const name of ['ordinary.test.mts', 'new-owner.integration.test.mts', 'helper.mts']) fs.writeFileSync(path.join(root, 'test', name), '');
    assert.deepEqual(nodeTestFiles('unit', root), ['test/ordinary.test.mts']);
    assert.deepEqual(nodeTestFiles('integration', root), ['test/new-owner.integration.test.mts']);
    assert.deepEqual([...nodeTestFiles('unit', root), ...nodeTestFiles('integration', root)].sort(), nodeTestFiles('all', root));
    assert.ok(CI_UNIT_SCRIPTS.includes('test:integration'));
  });
  test('audits the full locked dependency set through the shared quality group', () => {
    assert.ok(CI_QUALITY_SCRIPTS.includes('dependencies:review'));
    const args = PACKAGE_MANIFEST.scripts?.['dependencies:review']?.split(/\s+/u) ?? [];
    assert.deepEqual(args.slice(0, 2), ['npm', 'audit']);
    for (const flag of ['--package-lock-only', '--include=dev', '--include=optional', '--audit-level=moderate', '--registry=https://registry.npmjs.org']) {
      assert.ok(args.includes(flag), `The shared dependency gate requires ${flag}.`);
    }
    assert.equal(args.some(arg => arg.startsWith('--omit=')), false);
  });

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

  test('produces separate machine and human browser-health reports', () => {
    const commands = fixtureJob(workflowFixture(), 'browser-health').steps
      .flatMap(step => step.run?.includes('test:e2e:aggregate') ? [step.run] : []);
    assert.equal(commands.length, 2);
    assert.deepEqual(commands.map(command => /(?:^|\s)--summary(?:\s|$)/u.test(command)).sort(), [false, true]);
  });

  test('rejects stale shard and report bindings while allowing harmless command quoting', () => {
    const mutations: Array<(workflow: WorkflowFixture) => void> = [
      workflow => {
        const step = fixtureJob(workflow, 'browser').steps.find(step => step.run?.includes('test:e2e:shard'))!;
        step.run = 'npm run test:e2e:shard -- --run=1/4';
      },
      workflow => {
        const step = fixtureJob(workflow, 'browser').steps.find(step => step.run?.includes('test:e2e:shard'))!;
        step.run += ' --run=1/4';
      },
      workflow => { fixtureJob(workflow, 'browser').env!.WHOISLEUTH_PLAYWRIGHT_RUN_KIND = 'functional'; },
      workflow => {
        const step = fixtureJob(workflow, 'browser').steps.find(step => step.run === 'npm run test:e2e:summary')!;
        step.env!.WHOISLEUTH_PLAYWRIGHT_SHARD = '1/4';
      },
      workflow => {
        const step = fixtureJob(workflow, 'browser').steps.find(step => step.run === 'npm run test:e2e:summary')!;
        step.env!.WHOISLEUTH_PLAYWRIGHT_RUN_LABEL = 'same-label';
      },
      workflow => {
        for (const step of fixtureJob(workflow, 'browser-health').steps) {
          if (step.run?.includes('test:e2e:aggregate')) step.run = step.run.replace('--summary', '');
        }
      },
    ];
    for (const mutate of mutations) {
      const workflow = workflowFixture();
      mutate(workflow);
      assert.throws(() => assertHostedCiParity(stringify(workflow)), /matrix|machine inventory/u);
    }
    const workflow = workflowFixture();
    const shard = fixtureJob(workflow, 'browser').steps.find(step => step.run?.includes('test:e2e:shard'))!;
    shard.run = 'npm run test:e2e:shard -- --run "${{matrix.shard}}"';
    assert.doesNotThrow(() => assertHostedCiParity(stringify(workflow)));
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
      if (!scripts.includes('version:check') || scripts.includes('release:check')) process.exit(3);
    `], { cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 5000 });
    assert.equal(child.status, 0, child.stderr);
  });

  test('resolves an explicit ancestor without a remote and never falls back from an invalid base', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-base-'));
    const git = (...args: string[]) => {
      const result = spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], {
        cwd: directory, encoding: 'utf8', input: '', timeout: 5_000,
        env: { ...process.env, GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.test',
          GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.test' },
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    try {
      git('init', '--quiet');
      const tree = git('hash-object', '-w', '-t', 'tree', '--stdin');
      const base = git('commit-tree', tree, '-m', 'Base fixture');
      const head = git('commit-tree', tree, '-p', base, '-m', 'Head fixture');
      const sibling = git('commit-tree', tree, '-p', base, '-m', 'Sibling fixture');
      git('update-ref', 'HEAD', head);
      // An unchanged tree can still have a legitimate commit-range comparison.
      assert.equal(localCiRevisionRange(base, directory), `${base}..${head}`);
      assert.throws(() => localCiRevisionRange(undefined, directory), /Git preflight/u);
      git('update-ref', 'refs/remotes/origin/main', base);
      assert.equal(localCiRevisionRange(undefined, directory), `${base}..${head}`);
      for (const invalid of ['HEAD', base.slice(0, 8), '0'.repeat(40), tree, head, sibling]) {
        assert.throws(() => localCiRevisionRange(invalid, directory), invalid);
      }
      git('tag', '-a', 'fixture-base', '-m', 'Annotated fixture', base);
      assert.throws(() => localCiRevisionRange(git('rev-parse', 'fixture-base'), directory), /strictly before HEAD/u);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('executes canonical local groups and stops at the first failed command', () => {
    const shardPlan = buildBalancedBrowserShardPlan(readVerificationTimingProfile());
    const assigned = shardPlan.shards.flatMap((shard) => shard.files);
    assert.equal(shardPlan.shards.length, VERIFICATION_BROWSER_SHARD_COUNT);
    assert.equal(new Set(assigned).size, assigned.length);
    assert.deepEqual(assigned.sort(), readVerificationTestInventory().filter(isPlaywrightFunctionalSpec).sort());
    assert.equal(PACKAGE_MANIFEST.scripts?.['verification:ci'], 'node tools/ci-verification.mts');
    assert.deepEqual(CI_COMMAND_GROUPS, ['preflight', 'quality', 'unit', 'browser-build', 'cli-runtime']);
    assert.deepEqual(parseCiVerificationArguments([]), { mode: 'full' });
    assert.deepEqual(parseCiVerificationArguments([`--base=${'a'.repeat(40)}`]), { mode: 'full', base: 'a'.repeat(40) });
    for (const args of [['--base=HEAD'], ['--base=abc'], [`--base=${'A'.repeat(40)}`],
      [`--base=${'a'.repeat(40)}`, '--list'], [`--base=${'a'.repeat(40)}`, '--group=unit']]) {
      assert.throws(() => parseCiVerificationArguments(args), /Usage/u);
    }
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
    assert.match(localPlan, /security:codeql \(application and workflow analyses; no upload\)/);
    for (const script of [...CI_PREFLIGHT_SCRIPTS, ...CI_QUALITY_SCRIPTS, ...CI_UNIT_SCRIPTS, ...CI_BROWSER_BUILD_SCRIPTS]) {
      assert.match(localPlan, new RegExp(`^${escapeRegExp(script)}$`, 'mu'));
    }
    assert.match(localPlan, /^test:e2e:built \(performance, functional shards, browser-health aggregation and timing candidate\)$/mu);
    assert.match(localPlan, /^verification:artifacts cleanup=all$/mu);
    assert.match(localPlan, /^test:e2e:critical:install$/mu);
    assert.doesNotMatch(localPlan, /^test:e2e:install$/mu);
    assert.ok(localPlan.indexOf('changed-line secret scan') < localPlan.indexOf('version:check'));
    assert.ok(localPlan.indexOf('version:check') < localPlan.indexOf('locked install'));
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
    assert.match(localPlan, /^cli:package:check \(one assembly; primary and Node 26 installations\)$/mu);
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
    const workflow = scheduledWorkflow(PRODUCTION_DEPENDENCY_AUDIT_WORKFLOW, '29 3 * * 2');
    assert.match(workflowCommands(workflow), /^npm run dependencies:audit$/mu);
    assert.doesNotMatch(workflowCommands(workflow), /npm (?:ci|install)/u);
    const actions = pinnedActions(PRODUCTION_DEPENDENCY_AUDIT_WORKFLOW);
    assert.deepEqual(actions.map(({ action }) => action), ['actions/checkout', 'actions/setup-node']);
    for (const { revision } of actions) assert.match(requiredValue(revision), /^[a-f0-9]{40}$/u);
    assert.equal(requiredValue(workflowSteps(workflow).find(step => step.uses?.startsWith('actions/setup-node@'))).with?.['package-manager-cache'], false);
  });

  test('scheduled policy ignores presentation but rejects ignored failures and elevated permissions', () => {
    const workflow = parse(TEST_HEALTH_WORKFLOW) as WorkflowFixture;
    for (const step of workflowSteps(workflow)) step.name = 'Descriptive step label';
    scheduledWorkflow(stringify(workflow, { indent: 4, defaultStringType: 'QUOTE_DOUBLE' }), '43 3 * * 3');
    requiredValue(workflowSteps(workflow)[0])['continue-on-error'] = true;
    assert.throws(() => scheduledWorkflow(stringify(workflow), '43 3 * * 3'));
    delete requiredValue(workflowSteps(workflow)[0])['continue-on-error'];
    workflow.permissions.contents = 'write';
    assert.throws(() => scheduledWorkflow(stringify(workflow), '43 3 * * 3'));
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
    assert.equal(hosted.testTimeoutMs, local.testTimeoutMs);
    assert.equal(hosted.assertionTimeoutMs, local.assertionTimeoutMs);
    assert.ok(Number.isSafeInteger(local.assertionTimeoutMs) && local.assertionTimeoutMs > 0);
    assert.ok(local.testTimeoutMs > local.assertionTimeoutMs && local.testTimeoutMs <= 120_000);

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
      // This loads the complete critical-specification import graph. Bound a
      // stalled inventory process without making cold discovery speed a gate.
      cwd: root, encoding: 'utf8', timeout: 3 * 60_000, maxBuffer: 4 * 1024 * 1024,
      env: { ...environment, WHOISLEUTH_PLAYWRIGHT_SHARD: '' },
    });
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stderr);
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

  test('stops queued local browser shards after interruption, failure or missing evidence', async () => {
    const runs = ['1/4', '2/4', '3/4'].map((identity, index) => ({
      label: `functional shard ${identity}`,
      environment: {},
      port: 4_180 + index,
      args: ['runner', `--run=${identity}`],
    }));
    const interruptedLaunches: string[] = [];
    const verifiedPorts: number[] = [];
    let interrupted = false;
    const interruptedResult = await runFunctionalRuns(runs, {
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
    const ordinaryResult = await runFunctionalRuns(runs, {
      execute: async (run) => {
        ordinaryLaunches.push(run.label);
        liveResult = `${run.label} report`;
        return run.label.endsWith('2/4') ? 2 : 0;
      },
      verifyPortFree: async () => undefined,
      readResult: () => liveResult,
      isInterrupted: () => false,
    });
    assert.deepEqual(ordinaryLaunches, runs.slice(0, 2).map((run) => run.label));
    assert.deepEqual(ordinaryResult, {
      exits: [0, 2],
      reports: ['functional shard 1/4 report'],
      interrupted: false,
    });

    const launchesBeforeMissingReport: string[] = [];
    await assert.rejects(
      runFunctionalRuns(runs, {
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

  test('bounds concurrent shards, keeps report order and drains active work after failure', async () => {
    const runs = Array.from({ length: 4 }, (_, index) => ({ label: String(index), environment: {}, port: 4180 + index, args: [] }));
    const pending = new Map<string, (code: number) => void>();
    const started: string[] = [];
    const completed: string[] = [];
    const running = runFunctionalRuns(runs, {
      execute: run => new Promise(resolve => { started.push(run.label); pending.set(run.label, resolve); }),
      verifyPortFree: async run => { completed.push(run.label); },
      readResult: run => run.label,
      isInterrupted: () => false,
    }, 2);
    assert.deepEqual(started, ['0', '1']);
    pending.get('1')!(2);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(started, ['0', '1']);
    pending.get('0')!(0);
    const result = await running;
    assert.deepEqual(result.exits, [0, 2]);
    assert.deepEqual(result.reports, ['0']);
    assert.deepEqual(completed, ['1', '0']);
    const success = await runFunctionalRuns(runs, {
      execute: async () => 0, verifyPortFree: async () => undefined,
      readResult: run => run.label, isInterrupted: () => false,
    }, 2);
    assert.deepEqual(success.reports, ['0', '1', '2', '3']);
    assert.equal(localBrowserJobs({}), 1);
    assert.equal(localBrowserJobs({ WHOISLEUTH_E2E_LOCAL_JOBS: '2' }), 2);
    assert.throws(() => localBrowserJobs({ WHOISLEUTH_E2E_LOCAL_JOBS: '8' }), /1 or 2/u);
  });

  test('makes passing visual galleries explicit without disabling failure evidence', () => {
    assert.equal(captureVisualEvidenceEnabled({}), false);
    assert.equal(captureVisualEvidenceEnabled({ WHOISLEUTH_E2E_VISUAL_EVIDENCE: '1' }), true);
    assert.equal(captureVisualEvidenceEnabled({ WHOISLEUTH_E2E_VISUAL_EVIDENCE: '0' }), false);
    assert.throws(() => captureVisualEvidenceEnabled({ WHOISLEUTH_E2E_VISUAL_EVIDENCE: 'yes' }), /0 or 1/u);
  });

  test('asset diagnostics exclude query values, target requests and external origins', () => {
    const origin = 'http://127.0.0.1:4173', asset = '/_app/immutable/chunks/example.A.js';
    assert.equal(browserBuildAssetPath(origin + asset + '?private=sentinel#secret', origin), asset);
    for (const value of [origin + '/api/lookup?target=example.test', 'https://example.test' + asset,
      'malformed', 'http://user:password@127.0.0.1:4173' + asset]) assert.equal(browserBuildAssetPath(value, origin), null);
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
    scheduledWorkflow(STRESS_WORKFLOW, '17 3 * * 1');
    // Native shell integration checks the executed commands and stress arguments.
  });

  test('runs expanded property checks and duration profiling on a bounded schedule', () => {
    const workflow = scheduledWorkflow(TEST_HEALTH_WORKFLOW, '43 3 * * 3');
    const properties = requiredValue(workflowSteps(workflow).find(step => step.env?.WHOISLEUTH_FAST_CHECK_RUN_MULTIPLIER));
    assert.equal(properties.env?.WHOISLEUTH_FAST_CHECK_RUN_MULTIPLIER, '10');
    assert.equal(properties.env?.WHOISLEUTH_FAST_CHECK_SEED, '${{ github.run_number }}');
    const candidate = requiredValue(workflowSteps(workflow).find(step => step.env?.PROFILE_PROVENANCE));
    assert.equal(candidate.env?.PROFILE_PROVENANCE, 'unit-ci-${{ github.run_id }}-${{ github.run_attempt }}');
    const uploads = workflowSteps(workflow).filter(step => step.uses?.startsWith('actions/upload-artifact@'));
    assert.ok(uploads.length > 0);
    for (const upload of uploads) {
      assert.equal(upload.if, 'always()');
      assert.equal(upload.with?.['retention-days'], 14);
    }
    assert.ok(workflowSteps(workflow).some(step => step.run === 'npm run test:mutation'));
    const browserJob = requiredValue(Object.values(workflow.jobs).find(job =>
      job.steps.some(step => step.run?.startsWith('npm run test:e2e:cross-browser'))));
    assert.equal(browserJob.env?.WHOISLEUTH_E2E_USE_BUILD, '1');
    assert.deepEqual(browserJob.strategy?.matrix?.browser, ['firefox', 'webkit']);
    assert.equal(browserJob.strategy?.['fail-fast'], false);
    assert.equal(browserJob.env?.WHOISLEUTH_CROSS_BROWSER_PROJECT, '${{ matrix.browser }}');
    const engines = requiredValue(browserJob.strategy?.matrix?.browser);
    const label = requiredValue(browserJob.env?.WHOISLEUTH_PLAYWRIGHT_RUN_LABEL);
    const upload = requiredValue(browserJob.steps.find(step => step.uses?.startsWith('actions/upload-artifact@')));
    for (const template of [label, String(upload.with?.name)]) {
      assert.equal(new Set(engines.map(engine => template.replaceAll('${{ matrix.browser }}', engine))).size, engines.length,
        'each engine must retain separately identifiable evidence');
    }
    const commands = browserJob.steps.flatMap(step => step.run ? [step.run] : []);
    const suite = commands.findIndex(command => command.startsWith('npm run test:e2e:cross-browser'));
    const build = commands.indexOf('npm run verification:ci -- --group=browser-build');
    const browsers = commands.indexOf('npm run test:e2e:critical:install');
    assert.ok(build >= 0 && build < suite, 'verify the production build before browser execution');
    assert.ok(browsers >= 0 && browsers < suite, 'install the declared engines before browser execution');
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
