import { requiredValue } from './value-assertions.mts';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isPlaywrightFunctionalSpec,
  PLAYWRIGHT_PERFORMANCE_AUTHORITY_PROJECT,
  PLAYWRIGHT_PERFORMANCE_AUTHORITY_SPECS,
} from '../tools/playwright-execution-contract.mts';
import { buildBalancedBrowserShardPlan, readVerificationTimingProfile } from '../tools/verification-timing-profile.mts';
import {
  CI_BROWSER_HEALTH_SCRIPTS,
  CI_BROWSER_PREREQUISITE_SCRIPTS,
  CI_CLI_RUNTIME_NODE_MAJOR,
  CI_CLI_RUNTIME_SCRIPTS,
  CI_HOSTED_ONLY_BROWSER_SCRIPTS,
  CI_PREFLIGHT_SCRIPTS,
  CI_QUALITY_SCRIPTS,
  CI_UNIT_SCRIPTS,
  assertHostedCiParity,
  assertLocalCiRuntime,
  assertPlaywrightBrowserCacheWritable,
  expectedHostedCiScriptPlan,
  formatLocalCiPlan,
  playwrightBrowserCacheDirectory,
  readHostedCiScriptPlan,
  selectNodeRuntimeExecutable,
} from '../tools/ci-verification.mts';
import {
  buildToolchainCompatibilityReport,
  main as toolchainCompatibilityMain,
  satisfiesCaretAlternatives,
} from '../tools/toolchain-compatibility.mts';
import { environmentWithoutV8Coverage } from './helpers/subprocess-environment.mts';

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
const PLAYWRIGHT_CONFIG = fs.readFileSync(
  path.join(__dirname, '..', 'playwright.config.ts'),
  'utf8',
);
const BALANCED_SUITE_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'tools', 'playwright-balanced-suite.mts'),
  'utf8',
);
const PERFORMANCE_RUNNER_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'tools', 'playwright-performance-authority.mts'),
  'utf8',
);
const E2E_FIXTURES_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'e2e', 'fixtures.ts'),
  'utf8',
);
const CONSOLE_LOADING_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'e2e', 'console-loading.spec.ts'),
  'utf8',
);
const DEFERRED_INTERACTIONS_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'e2e', 'deferred-interactions.spec.ts'),
  'utf8',
);
const PERFORMANCE_SAMPLING_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'e2e', 'performance-sampling.ts'),
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
    assert.match(WORKFLOW, /^\s{2}browser:\s*$/mu);
    assert.match(WORKFLOW, /^\s{2}browser-health:\s*$/mu);
    assert.match(WORKFLOW, /^\s{2}cli-runtime:\s*$/mu);
    assert.match(WORKFLOW, /^\s{2}verify:\s*$/mu);
    assert.match(WORKFLOW, /^concurrency:\s*\n\s{2}group: ci-/mu);
    assert.match(WORKFLOW, /^\s{2}cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}$/mu);
    assert.match(WORKFLOW, /^\s{4}if: \$\{\{ always\(\) \}\}\s*\n\s{4}needs:\s*\n\s{6}- quality\s*\n\s{6}- unit\s*\n\s{6}- browser\s*\n\s{6}- browser-health\s*\n\s{6}- cli-runtime$/mu);
    assert.equal(occurrences(WORKFLOW, /^\s{10}persist-credentials: false$/gmu), 5);
    const qualityJob = requiredValue(/\n  quality:\n([\s\S]*?)\n  unit:/u.exec(WORKFLOW)?.[1]);
    const unitJob = requiredValue(/\n  unit:\n([\s\S]*?)\n  browser:/u.exec(WORKFLOW)?.[1]);
    assert.match(qualityJob, /^\s{10}fetch-depth: 0$/mu);
    assert.ok(
      qualityJob.indexOf('npm run release:check')
        < qualityJob.indexOf('npm ci --include=optional --ignore-scripts --audit=false'),
      'release-derived drift must fail before the locked install starts',
    );
    assert.match(unitJob, /^\s{6}- name: Install tested shell\s*\n\s{8}run: \|\s*\n\s{10}sudo apt-get update\s*\n\s{10}sudo apt-get install --no-install-recommends --yes zsh$/mu);
    assert.equal(occurrences(WORKFLOW, /^\s{10}fetch-depth: 0$/gmu), 1);
    assert.equal(occurrences(WORKFLOW, /^\s+run: npm ci --include=optional --ignore-scripts --audit=false$/gmu), 4);
    assert.equal(occurrences(WORKFLOW, /^\s+run: npm run dependencies:audit$/gmu), 0);
    assert.match(WORKFLOW, /^\s{10}QUALITY_RESULT: \$\{\{ needs\.quality\.result \}\}$/mu);
    assert.match(WORKFLOW, /^\s{10}UNIT_RESULT: \$\{\{ needs\.unit\.result \}\}$/mu);
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
      ...CI_PREFLIGHT_SCRIPTS.map((script) => `npm run ${script}`),
      ...CI_QUALITY_SCRIPTS.map((script) => `npm run ${script}`),
      'npm run security:staged -- --range "$SECRET_SCAN_BASE_SHA..$SECRET_SCAN_HEAD_SHA"',
      ...CI_UNIT_SCRIPTS.map((script) => `npm run ${script}`),
      ...CI_BROWSER_PREREQUISITE_SCRIPTS.map((script) => `npm run ${script}`),
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
    const workflowWithUnownedGate = WORKFLOW.replace(
      '      - name: Run type checks',
      '      - name: Unowned gate\n        run: npm run unowned:gate\n      - name: Run type checks',
    );
    assert.throws(() => assertHostedCiParity(workflowWithUnownedGate), /quality scripts have drifted/u);
    const workflowWithoutBrowserCandidate = WORKFLOW.replace('          npm run --silent verification:timing:update-candidate -- \\\n', '');
    assert.throws(() => assertHostedCiParity(workflowWithoutBrowserCandidate), /browserHealth scripts have drifted/u);
    const workflowWithoutCliRuntime = WORKFLOW.replace('        run: npm run cli:package:check\n\n  verify:', '        run: npm run unowned:cli-check\n\n  verify:');
    assert.throws(() => assertHostedCiParity(workflowWithoutCliRuntime), /cliRuntime scripts have drifted/u);
    assert.match(WORKFLOW, /^\s{10}SECRET_SCAN_BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.event\.before \}\}$/mu);
    assert.match(WORKFLOW, /^\s{10}SECRET_SCAN_HEAD_SHA: \$\{\{ github\.sha \}\}$/mu);
    assert.equal(
      PACKAGE_MANIFEST.scripts?.['dependencies:audit'],
      'node tools/production-dependency-audit.mts',
    );
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
    assert.match(WORKFLOW, /^\s+run: npm run cli:package:check$/mu);
    assert.match(WORKFLOW, /^\s{10}path: test-coverage\.lcov$/mu);
    assert.match(WORKFLOW, /^\s{10}retention-days: 7$/mu);
    assert.doesNotMatch(WORKFLOW, /continue-on-error|allow_failure|advisory/iu);
    const shardPlan = buildBalancedBrowserShardPlan(readVerificationTimingProfile());
    const assigned = shardPlan.shards.flatMap((shard) => shard.files);
    assert.equal(shardPlan.shards.length, 4);
    assert.equal(new Set(assigned).size, assigned.length);
    assert.deepEqual(assigned.sort(), readVerificationTimingProfile().files.filter((item) => isPlaywrightFunctionalSpec(item.file)).map((item) => item.file).sort());
    assert.equal(PACKAGE_MANIFEST.scripts?.['verification:ci'], 'node tools/ci-verification.mts');
    const localPlan = formatLocalCiPlan();
    for (const script of [...CI_PREFLIGHT_SCRIPTS, ...CI_QUALITY_SCRIPTS, ...CI_UNIT_SCRIPTS, ...CI_BROWSER_PREREQUISITE_SCRIPTS]) {
      assert.match(localPlan, new RegExp(`^${escapeRegExp(script)}$`, 'mu'));
    }
    assert.match(localPlan, /^test:e2e:built \(performance, functional shards, browser-health aggregation and timing candidate\)$/mu);
    assert.match(localPlan, /^verification:artifacts cleanup=all$/mu);
    assert.ok(localPlan.indexOf('changed-line secret scan') < localPlan.indexOf('release:check'));
    assert.ok(localPlan.indexOf('release:check') < localPlan.indexOf('locked install'));
    assert.ok(localPlan.indexOf('locked install') < localPlan.indexOf('toolchain:check'));
    assert.match(localPlan, /locked install \(install-time audit disabled; scheduled and release audits are separate\)/u);
    assert.deepEqual(CI_HOSTED_ONLY_BROWSER_SCRIPTS, [
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

  test('uses the same zero-retry single-worker contract locally and in CI while retaining bounded diagnostics', () => {
    assert.match(PLAYWRIGHT_CONFIG, /^\s{2}forbidOnly: true,$/mu);
    assert.match(PLAYWRIGHT_CONFIG, /^\s{2}failOnFlakyTests: true,$/mu);
    assert.match(PLAYWRIGHT_CONFIG, /^\s{2}retries: 0,$/mu);
    assert.match(PLAYWRIGHT_CONFIG, /^\s{2}workers: 1,$/mu);
    assert.match(PLAYWRIGHT_CONFIG, /\['json', \{ outputFile: artifacts\.jsonResults \}\]/u);
    assert.match(PLAYWRIGHT_CONFIG, /outputDir: artifacts\.testResults/u);
    assert.match(PLAYWRIGHT_CONFIG, /trace: 'retain-on-failure'/u);
    assert.match(PLAYWRIGHT_CONFIG, /screenshot: 'only-on-failure'/u);
  });

  test('keeps functional checks deterministic and isolates runtime ceilings in every environment', () => {
    assert.match(E2E_FIXTURES_SOURCE, /export const PERFORMANCE_AUTHORITY_PROJECT = PLAYWRIGHT_PERFORMANCE_AUTHORITY_PROJECT;/u);
    assert.match(
      E2E_FIXTURES_SOURCE,
      /export function enforcesMachineTimingBudgets\(projectName: string\): boolean \{\s+return projectName === PERFORMANCE_AUTHORITY_PROJECT;\s+\}/u,
    );
    assert.match(PLAYWRIGHT_CONFIG, /const performanceAuthority = process\.env\.WHOISLEUTH_E2E_PERFORMANCE_FIRST === '1';/u);
    assert.match(PLAYWRIGHT_CONFIG, /testIgnore: PLAYWRIGHT_PERFORMANCE_AUTHORITY_SPEC_PATTERN,/u);
    assert.match(PLAYWRIGHT_CONFIG, /dependencies: \['setup'\],/u);
    assert.match(PLAYWRIGHT_CONFIG, /name: PLAYWRIGHT_PERFORMANCE_AUTHORITY_PROJECT,[\s\S]*?testMatch: PLAYWRIGHT_PERFORMANCE_AUTHORITY_SPEC_PATTERN,[\s\S]*?dependencies: \['setup'\],[\s\S]*?workers: 1,[\s\S]*?fullyParallel: false,[\s\S]*?retries: 0,/u);
    assert.match(PLAYWRIGHT_CONFIG, /\.\.\.\(performanceAuthority \? \[performanceAuthorityProject\] : \[\]\)/u);
    assert.doesNotMatch(PLAYWRIGHT_CONFIG, /console-loading|deferred-interactions/u);
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
    assert.match(PERFORMANCE_RUNNER_SOURCE, /playwrightPerformanceAuthorityArguments\(PLAYWRIGHT_CLI\)/u);
    assert.match(BALANCED_SUITE_SOURCE, /playwrightPerformanceAuthorityArguments\(PLAYWRIGHT_CLI\)/u);
    assert.match(BALANCED_SUITE_SOURCE, /aggregatePlaywrightShardTimings\(reports\)/u);
    assert.match(BALANCED_SUITE_SOURCE, /buildVerificationTimingUpdateCandidate\(\[/u);
    assert.equal(PLAYWRIGHT_PERFORMANCE_AUTHORITY_PROJECT, 'performance-authority');
    assert.deepEqual(PLAYWRIGHT_PERFORMANCE_AUTHORITY_SPECS, [
      'e2e/console-loading.spec.ts',
      'e2e/deferred-interactions.spec.ts',
    ]);

    const consoleAuthorityBlock = requiredValue(
      /if \(enforcesMachineTimingBudgets\(testInfo\.project\.name\)\) \{([\s\S]*?)\n    \}/u.exec(CONSOLE_LOADING_SOURCE)?.[1],
    );
    for (const metric of ['usableMsMedian', 'longTaskTotalMsMedian', 'usableMsMaximum', 'longTaskTotalMsMaximum']) {
      assert.match(consoleAuthorityBlock, new RegExp(`expect\\(sampleSet\\.${metric}\\)\\.toBeLessThanOrEqual`, 'u'));
    }
    const consoleOutsideAuthority = CONSOLE_LOADING_SOURCE.replace(consoleAuthorityBlock, '');
    assert.doesNotMatch(consoleOutsideAuthority, /expect\(sampleSet\.(?:usableMsMedian|longTaskTotalMsMedian|usableMsMaximum|longTaskTotalMsMaximum)\)\.toBeLessThanOrEqual/u);
    assert.match(PERFORMANCE_SAMPLING_SOURCE, /export const PERFORMANCE_SAMPLE_COUNT = 3;/u);
    assert.match(PERFORMANCE_SAMPLING_SOURCE, /export const PERFORMANCE_TRANSIENT_OUTLIER_MULTIPLIER = 2;/u);
    assert.match(PERFORMANCE_SAMPLING_SOURCE, /Network\.clearBrowserCache/u);
    assert.match(PERFORMANCE_SAMPLING_SOURCE, /Storage\.clearDataForOrigin/u);
    assert.match(consoleOutsideAuthority, /sample <= PERFORMANCE_SAMPLE_COUNT/u);
    assert.match(consoleOutsideAuthority, /resetPerformanceSampleState\(page\)/u);
    assert.match(consoleOutsideAuthority, /expect\(measurement\.completedRequestCount[^\n]+\)\.toBeGreaterThan/u);
    assert.match(consoleOutsideAuthority, /expect\(measurement\.encodedTransferBytes\)\.toBeLessThanOrEqual/u);
    assert.match(consoleOutsideAuthority, /expect\(measurement\.layoutShiftScore\)\.toBeLessThanOrEqual/u);

    const deferredAuthorityBlock = requiredValue(
      /if \(enforcesMachineTimingBudgets\(options\.testInfo\.project\.name\)\) \{([\s\S]*?)\n    \}/u.exec(DEFERRED_INTERACTIONS_SOURCE)?.[1],
    );
    for (const metric of ['usableMsMedian', 'longTaskTotalMsMedian', 'usableMsMaximum', 'longTaskTotalMsMaximum']) {
      assert.match(deferredAuthorityBlock, new RegExp(`expect\\(sampleSet\\.${metric}\\)\\.toBeLessThanOrEqual`, 'u'));
    }
    const deferredOutsideAuthority = DEFERRED_INTERACTIONS_SOURCE.replace(deferredAuthorityBlock, '');
    assert.doesNotMatch(deferredOutsideAuthority, /expect\(sampleSet\.(?:usableMsMedian|longTaskTotalMsMedian|usableMsMaximum|longTaskTotalMsMaximum)\)\.toBeLessThanOrEqual/u);
    assert.doesNotMatch(deferredOutsideAuthority, /expect\(measurement\.(?:usableMs|longTaskTotalMs)\)\.toBeLessThanOrEqual/u);
    assert.match(deferredOutsideAuthority, /sample <= PERFORMANCE_SAMPLE_COUNT/u);
    assert.match(deferredOutsideAuthority, /resetPerformanceSampleState\(options\.page\)/u);
    assert.match(deferredOutsideAuthority, /await options\.prepare\(sample\)/u);
    assert.match(deferredOutsideAuthority, /expect\(measurement\.completedAssetRequestCount[^\n]+\)\.toBeGreaterThan/u);
    assert.match(deferredOutsideAuthority, /expect\(measurement\.assetEncodedTransferBytes\)\.toBeLessThanOrEqual/u);
    assert.match(deferredOutsideAuthority, /expect\(measurement\.layoutShiftScore\)\.toBeLessThanOrEqual/u);
    assert.match(deferredOutsideAuthority, /expect\(measurement\.residualLayoutShiftScore\)\.toBeLessThanOrEqual/u);
    assert.match(deferredOutsideAuthority, /expect\(captured\.investigationRequests[^\n]+\)\.toEqual\(\[\]\)/u);
  });

  test('browser tests synchronize on observable state instead of fixed delays', () => {
    for (const { entry, source } of E2E_SOURCES) {
      assert.doesNotMatch(source, /\bwaitForTimeout\s*\(/u, `${entry} uses a fixed Playwright delay`);
      assert.doesNotMatch(source, /\bsetTimeout\s*\(/u, `${entry} uses a fixed timer delay`);
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
