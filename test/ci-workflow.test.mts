import { requiredValue } from './value-assertions.mts';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildBalancedBrowserShardPlan, readVerificationTimingProfile } from '../tools/verification-timing-profile.mts';

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
const PLAYWRIGHT_CONFIG = fs.readFileSync(
  path.join(__dirname, '..', 'playwright.config.ts'),
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
    assert.match(WORKFLOW, /^\s{2}verify:\s*$/mu);
    assert.match(WORKFLOW, /^concurrency:\s*\n\s{2}group: ci-/mu);
    assert.match(WORKFLOW, /^\s{2}cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}$/mu);
    assert.match(WORKFLOW, /^\s{4}if: \$\{\{ always\(\) \}\}\s*\n\s{4}needs:\s*\n\s{6}- quality\s*\n\s{6}- unit\s*\n\s{6}- browser$/mu);
    assert.equal(occurrences(WORKFLOW, /^\s{10}persist-credentials: false$/gmu), 3);
    const qualityJob = requiredValue(/\n  quality:\n([\s\S]*?)\n  unit:/u.exec(WORKFLOW)?.[1]);
    const unitJob = requiredValue(/\n  unit:\n([\s\S]*?)\n  browser:/u.exec(WORKFLOW)?.[1]);
    assert.match(qualityJob, /^\s{10}fetch-depth: 0$/mu);
    assert.match(unitJob, /^\s{6}- name: Install tested shell\s*\n\s{8}run: \|\s*\n\s{10}sudo apt-get update\s*\n\s{10}sudo apt-get install --no-install-recommends --yes zsh$/mu);
    assert.equal(occurrences(WORKFLOW, /^\s{10}fetch-depth: 0$/gmu), 1);
    assert.equal(occurrences(WORKFLOW, /^\s+run: npm ci --include=optional --ignore-scripts$/gmu), 3);
    assert.match(WORKFLOW, /^\s{10}QUALITY_RESULT: \$\{\{ needs\.quality\.result \}\}$/mu);
    assert.match(WORKFLOW, /^\s{10}UNIT_RESULT: \$\{\{ needs\.unit\.result \}\}$/mu);
    assert.match(WORKFLOW, /^\s{10}BROWSER_RESULT: \$\{\{ needs\.browser\.result \}\}$/mu);

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
    ]);
    for (const { revision } of actions) assert.match(requiredValue(revision), /^[a-f0-9]{40}$/u);
    for (const command of [
      'npm run release:check',
      'npm run verification:timing:check',
      'npm run verification:ownership:check',
      'npm run verification:journeys:check',
      'npm run capabilities:check',
      'npm run privacy:check',
      'npm run schema:inventory',
      'npm run test:mutation',
      'npm run security:staged -- --range "$SECRET_SCAN_BASE_SHA..$SECRET_SCAN_HEAD_SHA"',
      'npm run licenses:check',
      'npm run providers:policy-check',
      'npm run technology:coverage-check',
      'npm run cli:package:check',
      'npm run architecture:check',
      'npm run dependencies:audit',
      'npm run test:coverage',
      'npm run typecheck',
      'npm run check',
      'npm run build',
      'npm run frontend:loading-report',
      'npm run security:retire',
      'npm run test:e2e:install',
      'npm run test:e2e:shard -- --run=${{ matrix.shard }}',
      'npm run test:e2e:summary',
      'npm run verification:artifacts -- --cleanup=unit',
      'npm run verification:artifacts -- --cleanup=browser',
    ]) {
      assert.match(WORKFLOW, new RegExp(`^\\s+run: ${escapeRegExp(command)}$`, 'mu'));
    }
    assert.match(WORKFLOW, /^\s{10}SECRET_SCAN_BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.event\.before \}\}$/mu);
    assert.match(WORKFLOW, /^\s{10}SECRET_SCAN_HEAD_SHA: \$\{\{ github\.sha \}\}$/mu);
    assert.equal(
      PACKAGE_MANIFEST.scripts?.['dependencies:audit'],
      'node tools/production-dependency-audit.mts',
    );
    assert.match(WORKFLOW, /^\s{10}- shard: 1\/2\s*\n\s{12}label: 1-of-2\s*\n\s{10}- shard: 2\/2\s*\n\s{12}label: 2-of-2$/mu);
    assert.match(WORKFLOW, /^\s{10}WHOISLEUTH_PLAYWRIGHT_SHARD: \$\{\{ matrix\.shard \}\}$/mu);
    assert.match(WORKFLOW, /^\s{10}path: playwright-results\.json$/mu);
    assert.match(WORKFLOW, /^\s{10}path: test-coverage\.lcov$/mu);
    assert.match(WORKFLOW, /^\s{10}retention-days: 7$/mu);
    assert.doesNotMatch(WORKFLOW, /continue-on-error|allow_failure|advisory/iu);
    const shardPlan = buildBalancedBrowserShardPlan(readVerificationTimingProfile());
    const assigned = shardPlan.shards.flatMap((shard) => shard.files);
    assert.equal(shardPlan.shards.length, 2);
    assert.equal(new Set(assigned).size, assigned.length);
    assert.deepEqual(assigned.sort(), readVerificationTimingProfile().files.filter((item) => item.lane === 'browser').map((item) => item.file).sort());
  });

  test('fails CI when a browser test passes only on retry and retains bounded diagnostics', () => {
    assert.match(PLAYWRIGHT_CONFIG, /^\s{2}forbidOnly: isCI,$/mu);
    assert.match(PLAYWRIGHT_CONFIG, /^\s{2}failOnFlakyTests: isCI,$/mu);
    assert.match(PLAYWRIGHT_CONFIG, /^\s{2}retries: isCI \? 1 : 0,$/mu);
    assert.match(PLAYWRIGHT_CONFIG, /\['json', \{ outputFile: 'playwright-results\.json' \}\]/u);
    assert.match(PLAYWRIGHT_CONFIG, /trace: 'retain-on-failure'/u);
    assert.match(PLAYWRIGHT_CONFIG, /screenshot: 'only-on-failure'/u);
  });

  test('runs local performance authorities once after the parallel browser project', () => {
    assert.match(PLAYWRIGHT_CONFIG, /const performanceAuthoritySpecs = \/\(\?:console-loading\|deferred-interactions\)\\\.spec\\\.ts\/u;/u);
    assert.match(PLAYWRIGHT_CONFIG, /\.\.\.\(!isCI \? \{ testIgnore: performanceAuthoritySpecs \} : \{\}\)/u);
    assert.match(PLAYWRIGHT_CONFIG, /name: 'performance-authority',[\s\S]*?testMatch: performanceAuthoritySpecs,[\s\S]*?dependencies: \['setup'\],[\s\S]*?workers: 1,[\s\S]*?fullyParallel: false,[\s\S]*?retries: 0,/u);
    assert.match(PLAYWRIGHT_CONFIG, /\.\.\.\(!isCI \? \[localPerformanceAuthorityProject\] : \[\]\)/u);
    assert.equal(
      PACKAGE_MANIFEST.scripts?.['frontend:authenticated-loading-report'],
      'playwright test e2e/console-loading.spec.ts e2e/deferred-interactions.spec.ts --project=performance-authority --workers=1 --retries=0',
    );
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
    assert.match(TEST_HEALTH_WORKFLOW, /^\s{10}WHOISLEUTH_FAST_CHECK_RUN_MULTIPLIER: '10'$/mu);
    assert.match(TEST_HEALTH_WORKFLOW, /^\s{10}WHOISLEUTH_FAST_CHECK_SEED: \$\{\{ github\.run_number \}\}$/mu);
    assert.match(TEST_HEALTH_WORKFLOW, /^\s+run: npm run test:properties$/mu);
    assert.match(TEST_HEALTH_WORKFLOW, /^\s+run: npm run verification:timing:check$/mu);
    assert.match(TEST_HEALTH_WORKFLOW, /npm run test:profile \| tee test-duration-report\.txt/u);
    assert.match(TEST_HEALTH_WORKFLOW, /^\s{10}path: test-duration-report\.txt$/mu);
    assert.equal(occurrences(TEST_HEALTH_WORKFLOW, /^\s{10}persist-credentials: false$/gmu), 1);
    const actions = pinnedActions(TEST_HEALTH_WORKFLOW);
    assert.deepEqual(actions.map(({ action }) => action), [
      'actions/checkout',
      'actions/setup-node',
      'actions/upload-artifact',
    ]);
    for (const { revision } of actions) assert.match(revision, /^[a-f0-9]{40}$/u);
    assert.match(PACKAGE_MANIFEST.scripts?.['test:properties'] ?? '', /verification-state-machines\.test\.mts/u);
  });
});
