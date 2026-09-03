import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildAnalystJourneyAssurance, parseAnalystJourneySource } from '../tools/analyst-journey-assurance.mts';
import { selectBalancedBrowserShard } from '../tools/playwright-balanced-shard.mts';
import {
  isPlaywrightFunctionalSpec,
  isPlaywrightPerformanceAuthoritySpec,
  PLAYWRIGHT_PERFORMANCE_AUTHORITY_SPECS,
} from '../tools/playwright-execution-contract.mts';
import { createTestDurationReport } from '../tools/test-duration-reporter.mts';
import {
  buildBalancedBrowserShardPlan,
  buildVerificationTimingUpdateCandidate,
  MAX_TIMING_PROVENANCE,
  parseVerificationTimingProfile,
  readVerificationTestInventory,
  readVerificationTimingProfile,
  VERIFICATION_TIMING_PROFILE_PATH,
} from '../tools/verification-timing-profile.mts';
import {
  buildVerificationOwnershipPlan,
  checkVerificationOwnershipMap,
  FULL_BATCH_RELEASE_GATES,
} from '../tools/verification-ownership.mts';

function rawProfile(): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(`../${VERIFICATION_TIMING_PROFILE_PATH}`, import.meta.url), 'utf8')) as Record<string, unknown>;
}

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('verification architecture contracts', () => {
  test('retains complete measured timing identities and a deterministic exact browser plan', () => {
    const inventory = readVerificationTestInventory();
    const profile = readVerificationTimingProfile();
    const first = buildBalancedBrowserShardPlan(profile);
    const second = buildBalancedBrowserShardPlan(profile);
    assert.deepEqual(first, second);
    assert.deepEqual(profile.files.map((item) => item.file).sort(), [...inventory].sort());
    assert.ok(inventory.every((file) => !file.startsWith('test/') || /^test\/[^/]+\.test\.mts$/u.test(file)));
    assert.equal(inventory.includes('tools/test-duration-reporter.mts'), false);
    assert.equal(inventory.some((file) => file.startsWith('test/support/')), false);
    assert.equal(first.setupFiles.length, 1);
    assert.equal(first.shards.length, 4);
    const browserInventory = profile.files.filter((item) => item.lane === 'browser').map((item) => item.file).sort();
    const eligible = browserInventory.filter(isPlaywrightFunctionalSpec);
    const performanceAuthority = browserInventory.filter(isPlaywrightPerformanceAuthoritySpec);
    const assigned = first.shards.flatMap((item) => item.files).sort();
    assert.deepEqual(assigned, eligible);
    assert.deepEqual(performanceAuthority, [...PLAYWRIGHT_PERFORMANCE_AUTHORITY_SPECS].sort());
    assert.deepEqual([...assigned, ...performanceAuthority].sort(), browserInventory);
    assert.equal(new Set(assigned).size, assigned.length);
    assert.equal(first.shards.reduce((sum, item) => sum + item.plannedWeightMs, 0), first.totalPlannedWeightMs);
    assert.ok(first.unavoidableImbalanceMs >= 0);
    assert.deepEqual(selectBalancedBrowserShard('1/4').shard, first.shards[0]);
    assert.throws(() => selectBalancedBrowserShard('5/4'), /must select/u);
  });

  test('rejects missing, duplicate, unknown, malformed, and unmeasured timing identities', () => {
    const inventory = readVerificationTestInventory();
    const variants: Array<readonly [string, (value: Record<string, unknown>) => void]> = [
      ['missing', (value) => { (value.files as unknown[]).pop(); }],
      ['duplicate', (value) => { (value.files as unknown[]).push(structuredClone((value.files as unknown[])[0])); }],
      ['unknown', (value) => { ((value.files as Array<Record<string, unknown>>)[0]!).file = 'test/unknown.test.mts'; }],
      ['malformed', (value) => { ((value.files as Array<Record<string, unknown>>)[0]!).file = '../outside.test.mts'; }],
      ['unmeasured', (value) => { ((value.files as Array<Record<string, unknown>>)[0]!).weightMs = 0; }],
      ['excess provenance', (value) => {
        const provenance = value.provenance as Array<Record<string, unknown>>;
        while (provenance.length <= MAX_TIMING_PROVENANCE) {
          provenance.push({
            id: `unit-excess-${provenance.length}`,
            lane: 'unit',
            environmentClass: 'fixture',
            sampleBasis: 'fixture',
            sampleCount: 1,
          });
        }
      }],
    ];
    for (const [label, mutate] of variants) {
      const value = rawProfile();
      mutate(value);
      assert.throws(() => parseVerificationTimingProfile(JSON.stringify(value), inventory), label);
    }
  });

  test('builds a complete median-of-three unit candidate and retires replaced provenance', () => {
    const retained = readVerificationTimingProfile();
    assert.ok(retained.provenance.length < MAX_TIMING_PROVENANCE);
    const unitFiles = retained.files.filter((file) => file.lane === 'unit');
    const replacedProvenance = new Set(unitFiles.map((file) => file.provenanceId));
    assert.ok(unitFiles.length > 0 && replacedProvenance.size > 0);
    const directory = mkdtempSync(path.join(tmpdir(), 'whoisleuth-timing-update-'));
    const reports = [10.4, 12.6, 20.2].map((durationMs, index) => {
      const report = path.join(directory, `unit-${index + 1}.txt`);
      writeFileSync(report, createTestDurationReport(
        unitFiles.map((file) => ({ name: 'catalogue', file: file.file, durationMs, failed: false })),
        20,
        {
          passed: unitFiles.length,
          failed: 0,
          cancelled: 0,
          skipped: 0,
          todo: 0,
          durationMs: durationMs * unitFiles.length,
        },
      ));
      return report;
    });
    try {
      const profile = buildVerificationTimingUpdateCandidate([
        '--update-candidate',
        '--lane=unit',
        ...reports.map((report) => `--report=${report}`),
        '--provenance-id=unit-local-provenance-replacement-test',
        '--environment=local-test-environment',
        '--sample-basis=exact-provenance-replacement-regression',
      ]);
      assert.ok(profile.provenance.length <= MAX_TIMING_PROVENANCE);
      assert.ok(profile.provenance.some((item) => item.id === 'unit-local-provenance-replacement-test'));
      assert.ok(!profile.provenance.some((item) => replacedProvenance.has(item.id)));
      assert.deepEqual(
        profile.files.find((item) => item.file === unitFiles[0]!.file),
        {
          file: unitFiles[0]!.file,
          lane: 'unit',
          weightMs: 13,
          sampleCount: 3,
          provenanceId: 'unit-local-provenance-replacement-test',
        },
      );
      const partial = path.join(directory, 'partial.txt');
      const partialFiles = unitFiles.slice(0, -1);
      writeFileSync(partial, createTestDurationReport(
        partialFiles.map((file) => ({ name: 'catalogue', file: file.file, durationMs: 1, failed: false })),
        20,
        { passed: partialFiles.length, failed: 0, cancelled: 0, skipped: 0, todo: 0, durationMs: partialFiles.length },
      ));
      assert.throws(() => buildVerificationTimingUpdateCandidate([
        '--update-candidate',
        '--lane=unit',
        `--report=${partial}`,
        `--report=${partial}`,
        `--report=${partial}`,
        '--provenance-id=unit-incomplete-regression-test',
        '--environment=local-test-environment',
        '--sample-basis=incomplete-regression',
      ]), /complete maintained unit inventory/u);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('builds browser timing updates from the exact functional inventory while retaining performance authority measurements', () => {
    const retained = readVerificationTimingProfile();
    const plan = buildBalancedBrowserShardPlan(retained);
    const functionalFiles = plan.shards.flatMap((shard) => shard.files).sort();
    const performanceFiles = retained.files.filter((item) => isPlaywrightPerformanceAuthoritySpec(item.file));
    assert.equal(performanceFiles.length, PLAYWRIGHT_PERFORMANCE_AUTHORITY_SPECS.length);
    const directory = mkdtempSync(path.join(tmpdir(), 'whoisleuth-browser-update-'));
    const report = path.join(directory, 'aggregate.json');
    const aggregate = {
      reportVersion: 1,
      inventoryFingerprint: retained.inventoryFingerprint,
      files: [
        ...functionalFiles.map((file, index) => ({ file, lane: 'browser', weightMs: index + 1, sampleCount: 1 })),
        ...plan.setupFiles.map((file) => ({ file, lane: 'browser_setup', weightMs: 5, sampleCount: plan.shardCount })),
      ],
    };
    try {
      writeFileSync(report, JSON.stringify(aggregate));
      const candidate = buildVerificationTimingUpdateCandidate([
        '--update-candidate',
        '--lane=browser',
        `--report=${report}`,
        '--provenance-id=browser-functional-regression-test',
        '--environment=local-test-environment',
        '--sample-basis=exact-functional-inventory-regression',
      ]);
      assert.ok(functionalFiles.every((file) => (
        candidate.files.find((item) => item.file === file)?.provenanceId === 'browser-functional-regression-test'
      )));
      for (const retainedPerformance of performanceFiles) {
        assert.deepEqual(candidate.files.find((item) => item.file === retainedPerformance.file), retainedPerformance);
      }

      writeFileSync(report, JSON.stringify({
        ...aggregate,
        files: [
          ...aggregate.files,
          { file: performanceFiles[0]!.file, lane: 'browser', weightMs: 1, sampleCount: 1 },
        ],
      }));
      assert.throws(() => buildVerificationTimingUpdateCandidate([
        '--update-candidate',
        '--lane=browser',
        `--report=${report}`,
        '--provenance-id=browser-functional-overreach-test',
        '--environment=local-test-environment',
        '--sample-basis=performance-overreach-regression',
      ]), /complete maintained browser inventory/u);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('runs the hosted browser aggregation and timing candidate commands locally with pure machine output', () => {
    const retained = readVerificationTimingProfile();
    const plan = buildBalancedBrowserShardPlan(retained);
    const directory = mkdtempSync(path.join(tmpdir(), 'whoisleuth-browser-command-parity-'));
    const cleanEnvironment = { ...process.env };
    delete cleanEnvironment.NODE_V8_COVERAGE;
    try {
      const reports = plan.shards.map((shard) => {
        const report = path.join(directory, `shard-${shard.shard}.json`);
        const files = [...plan.setupFiles, ...shard.files];
        writeFileSync(report, JSON.stringify({
          stats: { expected: files.length, unexpected: 0, flaky: 0, skipped: 0, duration: files.length },
          suites: [{
            title: `shard-${shard.shard}`,
            specs: files.map((file) => ({
              file: file.slice('e2e/'.length),
              tests: [{ status: 'expected', results: [{ status: 'passed', duration: 1, retry: 0 }] }],
            })),
          }],
        }));
        return report;
      });
      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const aggregateRun = spawnSync(npm, [
        'run', '--silent', 'test:e2e:aggregate', '--',
        ...reports.map((report) => `--report=${report}`),
      ], {
        cwd: REPOSITORY_ROOT,
        env: cleanEnvironment,
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
      });
      assert.equal(aggregateRun.status, 0, aggregateRun.stderr || aggregateRun.stdout);
      const aggregate = JSON.parse(aggregateRun.stdout) as { inventoryFingerprint: string };
      assert.equal(aggregate.inventoryFingerprint, retained.inventoryFingerprint);
      const aggregatePath = path.join(directory, 'aggregate.json');
      writeFileSync(aggregatePath, aggregateRun.stdout);

      const candidateRun = spawnSync(npm, [
        'run', '--silent', 'verification:timing:update-candidate', '--',
        '--lane=browser',
        `--report=${aggregatePath}`,
        '--provenance-id=browser-hosted-command-regression-test',
        '--environment=local-test-environment',
        '--sample-basis=exact-hosted-command-regression',
      ], {
        cwd: REPOSITORY_ROOT,
        env: cleanEnvironment,
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
      });
      assert.equal(candidateRun.status, 0, candidateRun.stderr || candidateRun.stdout);
      const candidate = JSON.parse(candidateRun.stdout) as { inventoryFingerprint: string };
      assert.equal(candidate.inventoryFingerprint, retained.inventoryFingerprint);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('maps representative maintained changes to focused checks without weakening full gates', () => {
    const paths = [
      'packages/contracts/schema-lifecycle.mts',
      'packages/cases/case-report.mts',
      'packages/workspace/workspace-archive.mts',
      'packages/evidence/observation.mts',
      'lib/safe-fetch.mts',
      'cli/investigation-run.mts',
      'bin/whoisleuth.mts',
      'netlify/functions/lookup.mts',
      'frontend/src/routes/(console)/lookup/+page.svelte',
      'tools/verification-ownership.mts',
      'test/verification-architecture.test.mts',
      'e2e/dashboard.spec.ts',
      'README.md',
      'PRIVACY.md',
      'package.json',
      '.github/workflows/ci.yml',
    ];
    const plan = buildVerificationOwnershipPlan(paths);
    assert.equal(plan.assignments.length, paths.length);
    assert.deepEqual(plan.fullBatchReleaseGates, FULL_BATCH_RELEASE_GATES);
    assert.ok(plan.focusedUnitChecks.length > 0);
    assert.ok(plan.focusedBrowserChecks.includes('e2e/dashboard.spec.ts'));
    assert.equal(plan.userFacingBrowserRequired, true);
    assert.match(JSON.stringify(plan), /Focused checks support iteration only/u);
    assert.doesNotMatch(JSON.stringify(plan), /npm run|;|\$\(/u);

    const closure = checkVerificationOwnershipMap();
    assert.equal(closure.assignedFiles, closure.maintainedFiles);
    assert.equal(closure.fullBatchReleaseGates, FULL_BATCH_RELEASE_GATES.length);
    assert.ok(closure.schemaFamilies > 0 && closure.capabilities > 0 && closure.cliOperations > 0);
    assert.ok(closure.privacyProfiles > 0 && closure.privacyConsumerFlows > 0);
    assert.throws(() => buildVerificationOwnershipPlan(['../outside.mts']), /repository-relative|traverse/u);
    assert.throws(() => buildVerificationOwnershipPlan(['lib/safe-fetch.mts', 'lib/safe-fetch.mts']), /must not repeat/u);
    assert.throws(() => buildVerificationOwnershipPlan(['unowned-root.cfg']), /Unknown maintained ownership area/u);
  });

  test('binds every version-one analyst journey to enabled semantic mobile tests and one shard', () => {
    const assurance = buildAnalystJourneyAssurance();
    assert.equal(assurance.journeyContractVersion, 1);
    assert.equal(assurance.mappedJourneys, assurance.declaredJourneys);
    assert.ok(assurance.playwrightTests >= assurance.declaredJourneys);
    assert.equal(assurance.execution, 'static_source_audit');
    assert.equal(assurance.browserTestsExecuted, 0);
    assert.equal(
      assurance.balancedShardSpecifications,
      readVerificationTimingProfile().files.filter((item) => isPlaywrightFunctionalSpec(item.file)).length,
    );
    assert.equal(assurance.skippedJourneys, 0);
    assert.equal(assurance.retryAcceptance, false);
    assert.ok(assurance.jobs.Investigate.length > 0);
    assert.ok(assurance.jobs.Respond.length > 0);
    assert.ok(assurance.jobs.Assure.length > 0);
    assert.ok(assurance.journeyMappings.every((item) => item.mobileOutcome && item.accessibilityOutcome && item.shards.length > 0));
    assert.deepEqual(assurance.privacy, {
      sharedSameOriginGuard: true,
      reservedTargets: true,
      fixtureContractRetainsTargets: false,
      resultContractRetainsQueries: false,
      localStorageBoundarySpecifications: 3,
    });

    const disabled = parseAnalystJourneySource('e2e/skipped-journey.spec.ts', `
      import { test } from './fixtures';
      test.describe.skip('disabled group', () => {
        test('disabled journey', { tag: '@analyst-journey' }, async ({ page }) => {
          await page.setViewportSize({ width: 320, height: 760 });
          await page.getByRole('main').isVisible();
        });
      });
    `);
    assert.equal(disabled.length, 1);
    assert.equal(disabled[0]?.disabled, true);
  });
});
