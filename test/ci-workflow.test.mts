import { requiredValue } from './value-assertions.mts';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW_PATH = path.join(__dirname, '..', '.github', 'workflows', 'ci.yml');
const WORKFLOW = fs.readFileSync(WORKFLOW_PATH, 'utf8');
const STRESS_WORKFLOW = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'e2e-stress.yml'),
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
      'actions/checkout',
      'actions/setup-node',
      'actions/upload-artifact',
      'actions/upload-artifact',
    ]);
    for (const { revision } of actions) assert.match(requiredValue(revision), /^[a-f0-9]{40}$/u);
    for (const command of [
      'npm run release:check',
      'npm run licenses:check',
      'npm audit --omit=dev',
      'npm test',
      'npm run typecheck',
      'npm run check',
      'npm run build',
      'npm run frontend:loading-report',
      'npm run security:retire',
      'npm run test:e2e -- --shard=${{ matrix.shard }}',
    ]) {
      assert.match(WORKFLOW, new RegExp(`^\\s+run: ${escapeRegExp(command)}$`, 'mu'));
    }
    assert.match(WORKFLOW, /^\s{10}- shard: 1\/2\s*\n\s{12}label: 1-of-2\s*\n\s{10}- shard: 2\/2\s*\n\s{12}label: 2-of-2$/mu);
    assert.match(WORKFLOW, /^\s{10}path: playwright-results\.json$/mu);
    assert.match(WORKFLOW, /^\s{10}retention-days: 7$/mu);
  });

  test('fails CI when a browser test passes only on retry and retains bounded diagnostics', () => {
    assert.match(PLAYWRIGHT_CONFIG, /^\s{2}forbidOnly: isCI,$/mu);
    assert.match(PLAYWRIGHT_CONFIG, /^\s{2}failOnFlakyTests: isCI,$/mu);
    assert.match(PLAYWRIGHT_CONFIG, /^\s{2}retries: isCI \? 1 : 0,$/mu);
    assert.match(PLAYWRIGHT_CONFIG, /\['json', \{ outputFile: 'playwright-results\.json' \}\]/u);
    assert.match(PLAYWRIGHT_CONFIG, /trace: 'retain-on-failure'/u);
    assert.match(PLAYWRIGHT_CONFIG, /screenshot: 'only-on-failure'/u);
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
});
