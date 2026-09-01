import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import { buildAnalystJourneyAssurance, parseAnalystJourneySource } from '../tools/analyst-journey-assurance.mts';
import { selectBalancedBrowserShard } from '../tools/playwright-balanced-shard.mts';
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

describe('verification architecture contracts', () => {
  test('retains complete measured timing identities and a deterministic exact browser plan', () => {
    const inventory = readVerificationTestInventory();
    const profile = readVerificationTimingProfile();
    const first = buildBalancedBrowserShardPlan(profile);
    const second = buildBalancedBrowserShardPlan(profile);
    assert.deepEqual(first, second);
    assert.deepEqual(profile.files.map((item) => item.file).sort(), [...inventory].sort());
    assert.equal(first.setupFiles.length, 1);
    assert.equal(first.shards.length, 4);
    const eligible = profile.files.filter((item) => item.lane === 'browser').map((item) => item.file).sort();
    const assigned = first.shards.flatMap((item) => item.files).sort();
    assert.deepEqual(assigned, eligible);
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
    ];
    for (const [label, mutate] of variants) {
      const value = rawProfile();
      mutate(value);
      assert.throws(() => parseVerificationTimingProfile(JSON.stringify(value), inventory), label);
    }
  });

  test('replaces obsolete provenance when a bounded timing update reaches the profile limit', () => {
    const retained = readVerificationTimingProfile();
    assert.equal(retained.provenance.length, MAX_TIMING_PROVENANCE);
    const provenanceUse = new Map<string, number>();
    for (const file of retained.files) {
      provenanceUse.set(file.provenanceId, (provenanceUse.get(file.provenanceId) ?? 0) + 1);
    }
    const unitProvenance = retained.provenance
      .filter((item) => item.lane === 'unit')
      .sort((left, right) => (
        (provenanceUse.get(left.id) ?? 0) - (provenanceUse.get(right.id) ?? 0)
        || left.id.localeCompare(right.id)
      ))[0];
    assert.ok(unitProvenance);
    const replaceable = retained.files.filter((file) => file.provenanceId === unitProvenance.id);
    assert.ok(replaceable.length > 0 && replaceable.every((file) => file.lane === 'unit'));
    const directory = mkdtempSync(path.join(tmpdir(), 'whoisleuth-timing-update-'));
    const report = path.join(directory, 'unit.xml');
    const testCases = replaceable.map((file) => (
      `  <testcase name="catalogue" time="0.012" file="${path.resolve(file.file)}"/>`
    ));
    writeFileSync(report, [
      '<testsuites>',
      ...testCases,
      `  <!-- tests ${replaceable.length} -->`,
      `  <!-- pass ${replaceable.length} -->`,
      '  <!-- fail 0 -->',
      '  <!-- cancelled 0 -->',
      '  <!-- skipped 0 -->',
      '  <!-- todo 0 -->',
      '</testsuites>',
    ].join('\n'));
    try {
      const profile = buildVerificationTimingUpdateCandidate([
        '--update-candidate',
        '--lane=unit',
        `--report=${report}`,
        '--provenance-id=unit-local-provenance-replacement-test',
        '--environment=local-test-environment',
        '--sample-basis=exact-provenance-replacement-regression',
        '--sample-count=1',
      ]);
      assert.equal(profile.provenance.length, MAX_TIMING_PROVENANCE);
      assert.ok(profile.provenance.some((item) => item.id === 'unit-local-provenance-replacement-test'));
      assert.ok(!profile.provenance.some((item) => item.id === unitProvenance.id));
      assert.deepEqual(
        profile.files.find((item) => item.file === replaceable[0]!.file),
        {
          file: replaceable[0]!.file,
          lane: 'unit',
          weightMs: 12,
          sampleCount: 1,
          provenanceId: 'unit-local-provenance-replacement-test',
        },
      );
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
    assert.equal(
      assurance.balancedShardSpecifications,
      readVerificationTimingProfile().files.filter((item) => item.lane === 'browser').length,
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
