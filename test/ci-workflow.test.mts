import { requiredValue } from './value-assertions.mts';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  enforcesMachineTimingBudgets,
  isPlaywrightFunctionalSpec,
  PLAYWRIGHT_PERFORMANCE_AUTHORITY_PROJECT,
  PLAYWRIGHT_PERFORMANCE_AUTHORITY_SPEC_PATTERN,
  PLAYWRIGHT_PERFORMANCE_AUTHORITY_SPECS,
  installNavigationReadinessMark,
  machineTimingBudgetChecks,
  performanceSampleMedian,
  resetPerformanceSampleState,
  resolvePlaywrightExecutionContract,
} from '../tools/playwright-execution-contract.mts';
import { buildBalancedBrowserShardPlan, readVerificationTimingProfile } from '../tools/verification-timing-profile.mts';
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
  test('keeps deliberately interrupted subprocesses outside the parent coverage collector', () => {
    const source = { PATH: '/fixture/bin', NODE_V8_COVERAGE: '/fixture/coverage' };
    assert.deepEqual(environmentWithoutV8Coverage(source), { PATH: '/fixture/bin' });
    assert.equal(source.NODE_V8_COVERAGE, '/fixture/coverage');
  });

  test('runs once for pull requests and again after changes reach main', () => {
    assert.match(WORKFLOW, /^on:\s*\n\s{2}push:\s*\n\s{4}branches:\s*\n\s{6}- main\s*\n\s{2}pull_request:\s*$/mu);
    assert.doesNotMatch(WORKFLOW, /^\s{6}- ['"]?\*['"]?\s*$/mu);
  });

  test('splits comprehensive checks into independent lanes behind the required verification job', () => {
    assert.match(WORKFLOW, /^permissions:\s*\n\s{2}contents: read$/mu);
    assert.doesNotMatch(WORKFLOW, /\b(?:contents|issues|pull-requests|actions): write\b/u);
    assert.match(WORKFLOW, /^\s{2}quality:\s*$/mu);
    assert.match(WORKFLOW, /^\s{2}unit:\s*$/mu);
    assert.match(WORKFLOW, /^\s{2}browser-build:\s*$/mu);
    assert.match(WORKFLOW, /^\s{2}browser:\s*$/mu);
    assert.match(WORKFLOW, /^\s{2}browser-health:\s*$/mu);
    assert.match(WORKFLOW, /^\s{2}cli-runtime:\s*$/mu);
    assert.match(WORKFLOW, /^\s{2}verify:\s*$/mu);
    assert.match(WORKFLOW, /^concurrency:\s*\n\s{2}group: ci-/mu);
    assert.match(WORKFLOW, /^\s{2}cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}$/mu);
    assert.match(WORKFLOW, /^\s{4}if: \$\{\{ always\(\) \}\}\s*\n\s{4}needs:\s*\n\s{6}- quality\s*\n\s{6}- unit\s*\n\s{6}- browser-build\s*\n\s{6}- browser\s*\n\s{6}- browser-health\s*\n\s{6}- cli-runtime$/mu);
    assert.equal(occurrences(WORKFLOW, /^\s{10}persist-credentials: false$/gmu), 6);
    const qualityJob = requiredValue(/\n  quality:\n([\s\S]*?)\n  unit:/u.exec(WORKFLOW)?.[1]);
    const unitJob = requiredValue(/\n  unit:\n([\s\S]*?)\n  browser-build:/u.exec(WORKFLOW)?.[1]);
    const browserBuildJob = requiredValue(/\n  browser-build:\n([\s\S]*?)\n  browser:/u.exec(WORKFLOW)?.[1]);
    const browserJob = requiredValue(/\n  browser:\n([\s\S]*?)\n  browser-health:/u.exec(WORKFLOW)?.[1]);
    assert.match(qualityJob, /^\s{10}fetch-depth: 0$/mu);
    assert.ok(
      qualityJob.indexOf('npm run verification:ci -- --group=preflight')
        < qualityJob.indexOf('npm ci --include=optional --ignore-scripts --audit=false'),
      'release-derived drift must fail before the locked install starts',
    );
    assert.match(unitJob, /^\s{6}- name: Install tested shell\s*\n\s{8}run: \|\s*\n\s{10}sudo apt-get update\s*\n\s{10}sudo apt-get install --no-install-recommends --yes zsh$/mu);
    assert.equal(occurrences(WORKFLOW, /^\s{10}fetch-depth: 0$/gmu), 1);
    assert.equal(occurrences(WORKFLOW, /^\s+run: npm ci --include=optional --ignore-scripts --audit=false$/gmu), 5);
    assert.equal(occurrences(WORKFLOW, /^\s+run: npm run dependencies:audit$/gmu), 0);
    assert.match(WORKFLOW, /^\s{10}QUALITY_RESULT: \$\{\{ needs\.quality\.result \}\}$/mu);
    assert.match(WORKFLOW, /^\s{10}UNIT_RESULT: \$\{\{ needs\.unit\.result \}\}$/mu);
    assert.match(WORKFLOW, /^\s{10}BROWSER_BUILD_RESULT: \$\{\{ needs\.browser-build\.result \}\}$/mu);
    assert.match(WORKFLOW, /^\s{10}BROWSER_RESULT: \$\{\{ needs\.browser\.result \}\}$/mu);
    assert.match(WORKFLOW, /^\s{10}BROWSER_HEALTH_RESULT: \$\{\{ needs\.browser-health\.result \}\}$/mu);
    assert.match(WORKFLOW, /^\s{10}CLI_RUNTIME_RESULT: \$\{\{ needs\.cli-runtime\.result \}\}$/mu);

    const actions = pinnedActions(WORKFLOW);
    assert.deepEqual(actions.map(({ action }) => action), [
      'actions/checkout',
      'actions/setup-node',
      'actions/checkout',
      'actions/setup-node',
      'actions/upload-artifact',
      'actions/checkout',
      'actions/setup-node',
      'actions/upload-artifact',
      'actions/checkout',
      'actions/setup-node',
      'actions/download-artifact',
      'actions/upload-artifact',
      'actions/upload-artifact',
      'actions/checkout',
      'actions/setup-node',
      'actions/download-artifact',
      'actions/upload-artifact',
      'actions/checkout',
      'actions/setup-node',
    ]);
    for (const { revision } of actions) assert.match(requiredValue(revision), /^[a-f0-9]{40}$/u);
    for (const command of [
      'npm run verification:ci -- --group=preflight',
      'npm run verification:ci -- --group=quality',
      'npm run verification:ci -- --group=unit',
      'npm run verification:ci -- --group=browser-build',
      'npm run verification:ci -- --group=cli-runtime',
      'npm run security:staged -- --range "$SECRET_SCAN_BASE_SHA..$SECRET_SCAN_HEAD_SHA"',
      'npm run test:e2e:install',
      'npm run test:e2e:shard -- --run=${{ matrix.shard }}',
      'npm run frontend:authenticated-loading-report',
      'npm run test:e2e:summary',
      'npm run verification:artifacts -- --cleanup=unit',
      'npm run verification:artifacts -- --cleanup=browser',
    ]) {
      assert.match(WORKFLOW, new RegExp(`^\\s+run: ${escapeRegExp(command)}$`, 'mu'));
    }
    assert.deepEqual(readHostedCiScriptPlan(WORKFLOW), expectedHostedCiScriptPlan());
    assert.doesNotThrow(() => assertHostedCiParity(WORKFLOW));
    const workflowWithoutBuildJob = WORKFLOW.replace(/\n  browser-build:\n[\s\S]*?\n  browser:/u, '\n  browser:');
    assert.throws(() => assertHostedCiParity(workflowWithoutBuildJob), /missing the browser-build job/u);
    const workflowWithAlteredArtifactName = WORKFLOW.replace(CI_FRONTEND_BUILD_ARTIFACT_NAME, 'frontend-build-altered');
    assert.throws(() => assertHostedCiParity(workflowWithAlteredArtifactName), /artifact publication has drifted/u);
    const workflowWithAlteredArtifactPath = WORKFLOW.replace('            frontend/build\n            frontend/build-identity.json', '            frontend/other');
    assert.throws(() => assertHostedCiParity(workflowWithAlteredArtifactPath), /artifact publication has drifted/u);
    const workflowWithoutBuildIntegrity = WORKFLOW.replace('--group=browser-build', '--group=unit');
    assert.throws(() => assertHostedCiParity(workflowWithoutBuildIntegrity), /browserBuild scripts have drifted/u);
    const workflowWithMatrixBuild = WORKFLOW.replace(
      '      - name: Install Playwright Chromium',
      '      - name: Rebuild unexpectedly\n        run: npm run build\n      - name: Install Playwright Chromium',
    );
    assert.throws(() => assertHostedCiParity(workflowWithMatrixBuild), /browser scripts have drifted/u);
    const workflowWithUnownedGate = WORKFLOW.replace(
      '      - name: Run maintained quality group',
      '      - name: Unowned gate\n        run: npm run unowned:gate\n      - name: Run maintained quality group',
    );
    assert.throws(() => assertHostedCiParity(workflowWithUnownedGate), /quality scripts have drifted/u);
    const workflowWithoutBrowserCandidate = WORKFLOW.replace('          npm run --silent verification:timing:update-candidate -- \\\n', '');
    assert.throws(() => assertHostedCiParity(workflowWithoutBrowserCandidate), /browserHealth scripts have drifted/u);
    const workflowWithoutCliRuntime = WORKFLOW.replace('--group=cli-runtime', '--group=quality');
    assert.throws(() => assertHostedCiParity(workflowWithoutCliRuntime), /cliRuntime scripts have drifted/u);
    assert.match(WORKFLOW, /^\s{10}SECRET_SCAN_BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.event\.before \}\}$/mu);
    assert.match(WORKFLOW, /^\s{10}SECRET_SCAN_HEAD_SHA: \$\{\{ github\.sha \}\}$/mu);
    assert.equal(
      PACKAGE_MANIFEST.scripts?.['dependencies:audit'],
      'node tools/production-dependency-audit.mts',
    );
    assert.equal(PACKAGE_MANIFEST.scripts?.['frontend:build:integrity'], 'node tools/frontend-build-integrity.mts --check');
    assert.equal(FRONTEND_PACKAGE_MANIFEST.scripts?.prebuild, 'node ../tools/frontend-build-integrity.mts --clean');
    assert.equal(FRONTEND_PACKAGE_MANIFEST.scripts?.postbuild, 'node ../tools/frontend-build-integrity.mts --record');
    assert.match(PACKAGE_MANIFEST.scripts?.['test:coverage'] ?? '', /packages\/\*\*\/\*\.mts/u);
    assert.match(PACKAGE_MANIFEST.scripts?.['test:coverage'] ?? '', /tools\/production-coverage\.mts/u);
    assert.doesNotMatch(PACKAGE_MANIFEST.scripts?.['test:coverage'] ?? '', /test:critical-io-coverage/u);
    for (const script of ['test', 'test:coverage', 'test:profile'] as const) {
      assert.match(PACKAGE_MANIFEST.scripts?.[script] ?? '', /--test-concurrency=4(?:\s|$)/u, script);
    }
    for (const shard of [1, 2, 3, 4]) {
      assert.match(WORKFLOW, new RegExp(
        `^\\s{10}- kind: functional\\s*\\n\\s{12}shard: ${shard}\\/4\\s*\\n\\s{12}label: ${shard}-of-4$`,
        'mu',
      ));
    }
    assert.match(WORKFLOW, /^\s{10}- kind: performance\s*\n\s{12}label: performance$/mu);
    assert.match(WORKFLOW, /^\s{6}WHOISLEUTH_PLAYWRIGHT_RUN_KIND: \$\{\{ matrix\.kind \}\}$/mu);
    assert.match(WORKFLOW, /^\s{10}WHOISLEUTH_PLAYWRIGHT_SHARD: \$\{\{ matrix\.shard \}\}$/mu);
    assert.match(WORKFLOW, /^\s{10}path: playwright-results\/$/mu);
    assert.match(WORKFLOW, /^\s{10}pattern: playwright-results-\*-of-4$/mu);
    assert.match(WORKFLOW, /^\s{10}merge-multiple: true$/mu);
    assert.match(WORKFLOW, /npm run --silent test:e2e:aggregate -- "\$\{reports\[@\]\}" > "\$RUNNER_TEMP\/playwright-browser-aggregate\.json"/u);
    assert.match(WORKFLOW, /npm run --silent test:e2e:aggregate -- --summary "\$\{reports\[@\]\}" \| tee/u);
    assert.equal(PACKAGE_MANIFEST.scripts?.['test:e2e:aggregate'], 'node tools/playwright-shard-aggregate.mts');
    assert.match(WORKFLOW, /npm run --silent verification:timing:update-candidate --/u);
    assert.match(WORKFLOW, /^\s{10}node-version: 26$/mu);
    assert.match(WORKFLOW, /^\s+run: npm run verification:ci -- --group=cli-runtime$/mu);
    assert.match(WORKFLOW, /^\s{10}path: test-coverage\.lcov$/mu);
    assert.match(WORKFLOW, /^\s{10}retention-days: 7$/mu);
    assert.match(browserJob, /^\s{4}needs:\s*\n\s{6}- browser-build$/mu);
    assert.equal(occurrences(browserBuildJob, /^\s+run: npm run verification:ci -- --group=browser-build$/gmu), 1);
    for (const script of CI_BROWSER_BUILD_SCRIPTS) {
      assert.doesNotMatch(browserBuildJob, new RegExp(`^\\s+run: npm run ${escapeRegExp(script)}$`, 'mu'));
    }
    assert.equal(occurrences(WORKFLOW, /^\s+run: npm run frontend:build:integrity$/gmu), 1);
    assert.match(browserBuildJob, new RegExp(`^\\s{10}name: ${escapeRegExp(CI_FRONTEND_BUILD_ARTIFACT_NAME)}$`, 'mu'));
    assert.match(browserBuildJob, /^\s{10}if-no-files-found: error$/mu);
    assert.match(browserBuildJob, /^\s{10}retention-days: 1$/mu);
    assert.match(browserBuildJob, /^\s{10}compression-level: 6$/mu);
    assert.doesNotMatch(browserBuildJob, /\.svelte-kit/u);
    assert.match(browserJob, new RegExp(`^\\s{10}name: ${escapeRegExp(CI_FRONTEND_BUILD_ARTIFACT_NAME)}$`, 'mu'));
    assert.match(browserJob, /^\s{10}path: frontend$/mu);
    assert.doesNotMatch(browserJob, /^\s{10}(?:pattern|merge-multiple):/mu);
    assert.ok(browserJob.indexOf('Download verified frontend build') < browserJob.indexOf('Verify frontend build identity'));
    assert.ok(browserJob.indexOf('Verify frontend build identity') < browserJob.indexOf('Install Playwright Chromium'));
    assert.doesNotMatch(WORKFLOW, /continue-on-error|allow_failure|advisory/iu);
    const shardPlan = buildBalancedBrowserShardPlan(readVerificationTimingProfile());
    const assigned = shardPlan.shards.flatMap((shard) => shard.files);
    assert.equal(shardPlan.shards.length, 4);
    assert.equal(new Set(assigned).size, assigned.length);
    assert.deepEqual(assigned.sort(), readVerificationTimingProfile().files.filter((item) => isPlaywrightFunctionalSpec(item.file)).map((item) => item.file).sort());
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
    assert.deepEqual(CI_CLI_RUNTIME_SCRIPTS, ['cli:package:check']);
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

    assert.throws(() => resolveUnitTestExecutables(['zsh', 'pwsh'], {
      environment: { PATH: path.join(temporaryRoot, 'missing') },
      cwd: temporaryRoot,
    }), (error) => error instanceof Error
      && error.message.includes('zsh: not found')
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

    for (const executable of ['bash', 'zsh', 'pwsh']) {
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
      ['pwsh', path.join(executableDirectory, 'pwsh')],
    ]);
    const executionEnvironment = unitTestExecutableEnvironment(resolved, sourceEnvironment);
    assert.equal(executionEnvironment.PATH, executableDirectory);
    assert.equal(executionEnvironment.PRESERVED_VALUE, 'yes');
    assert.equal(executionEnvironment.WHOISLEUTH_VERIFICATION_BASH, path.join(executableDirectory, 'bash'));
    assert.equal(executionEnvironment.WHOISLEUTH_VERIFICATION_ZSH, path.join(executableDirectory, 'zsh'));
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

  test('keeps functional checks deterministic and isolates runtime ceilings in every environment', async () => {
    assert.match(WORKFLOW, /^\s+run: npm run frontend:authenticated-loading-report$/mu);
    assert.match(WORKFLOW, /^\s+if: \$\{\{ matrix\.kind == 'performance' \}\}$/mu);
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
    assert.equal(PLAYWRIGHT_PERFORMANCE_AUTHORITY_PROJECT, 'performance-authority');
    assert.deepEqual(PLAYWRIGHT_PERFORMANCE_AUTHORITY_SPECS, [
      'e2e/console-loading.spec.ts',
      'e2e/deferred-interactions.spec.ts',
    ]);
    assert.equal(enforcesMachineTimingBudgets('chromium'), false);
    assert.equal(enforcesMachineTimingBudgets(PLAYWRIGHT_PERFORMANCE_AUTHORITY_PROJECT), true);
    const sampleSet = {
      usableMsMedian: 100,
      usableMsMaximum: 190,
      longTaskTotalMsMedian: 20,
      longTaskTotalMsMaximum: 39,
    };
    const budget = { usableMs: 100, longTaskTotalMs: 20 };
    assert.deepEqual(machineTimingBudgetChecks('chromium', sampleSet, budget), []);
    assert.deepEqual(machineTimingBudgetChecks(PLAYWRIGHT_PERFORMANCE_AUTHORITY_PROJECT, sampleSet, budget), [
      { metric: 'usableMsMedian', observed: 100, maximum: 100 },
      { metric: 'longTaskTotalMsMedian', observed: 20, maximum: 20 },
      { metric: 'usableMsMaximum', observed: 190, maximum: 200 },
      { metric: 'longTaskTotalMsMaximum', observed: 39, maximum: 40 },
    ]);
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
    for (const { entry, source } of E2E_SOURCES) {
      assert.doesNotMatch(source, /\bwaitForTimeout\s*\(/u, `${entry} uses a fixed Playwright delay`);
      assert.doesNotMatch(source, /\bsetTimeout\s*\(/u, `${entry} uses a fixed timer delay`);
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
    assert.match(TEST_HEALTH_WORKFLOW, /^\s{6}- name: Install tested shell\s*\n\s{8}run: \|\s*\n\s{10}sudo apt-get update\s*\n\s{10}sudo apt-get install --no-install-recommends --yes zsh$/mu);
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
