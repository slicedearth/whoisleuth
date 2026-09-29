import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { environmentWithoutV8Coverage } from './helpers/subprocess-environment.mts';

import { buildAnalystJourneyAssurance, parseAnalystJourneySource } from '../tools/analyst-journey-assurance.mts';
import { browserVerificationMatrix, selectBalancedBrowserShard } from '../tools/playwright-balanced-shard.mts';
import { reportPaths } from '../tools/playwright-shard-aggregate.mts';
import {
  isPlaywrightFunctionalSpec,
  isPlaywrightPerformanceAuthoritySpec,
  PLAYWRIGHT_PERFORMANCE_AUTHORITY_SPECS,
} from '../tools/playwright-execution-contract.mts';
import { createTestDurationReport } from '../tools/test-duration-reporter.mts';
import { inspectVerificationArtifacts } from '../tools/verification-artifact-status.mts';
import {
  buildFocusedVerificationExecution,
  assertFocusedBrowserCoverage,
  focusedBrowserLanes,
  discoverFocusedVerificationPaths,
  parseFocusedVerificationOptions,
  renderExecutionPlan,
} from '../tools/focused-verification.mts';
import {
  buildBalancedBrowserShardPlan,
  buildVerificationTimingUpdateCandidate,
  MAX_TIMING_PROVENANCE,
  parseVerificationTimingProfile,
  readVerificationTestInventory,
  readVerificationTimingProfile,
  VERIFICATION_TIMING_PROFILE_PATH,
  VERIFICATION_BROWSER_SHARD_COUNT,
  verificationTestInventoryFingerprint,
} from '../tools/verification-timing-profile.mts';
import {
  assertDeclaredVerificationTest,
  buildVerificationOwnershipPlan,
  browserSpecsForPrefixes,
  checkVerificationOwnershipMap,
  createVerificationOwnershipPlan,
  dependencyAnalysisFailure,
  importedTestConsumers,
  leafComponentContracts,
} from '../tools/verification-ownership.mts';

function rawProfile(): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(`../${VERIFICATION_TIMING_PROFILE_PATH}`, import.meta.url), 'utf8')) as Record<string, unknown>;
}

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('verification architecture contracts', () => {
  test('focused cleanup preserves pre-existing artefacts while explicit cleanup still removes its selected group', async () => {
    const repositoryRoot = mkdtempSync(path.join(tmpdir(), 'verification-cleanup-'));
    const options = { repositoryRoot };
    try {
      mkdirSync(path.join(repositoryRoot, 'frontend/.svelte-kit'), { recursive: true });
      mkdirSync(path.join(repositoryRoot, 'coverage'));
      const existing = await inspectVerificationArtifacts('none', false, options);
      assert.deepEqual([...existing.remaining].sort(), ['coverage', 'frontend/.svelte-kit']);
      mkdirSync(path.join(repositoryRoot, 'frontend/build'));
      const focused = await inspectVerificationArtifacts('browser', false, { ...options, preserve: existing.remaining });
      assert.deepEqual(focused.removed, ['frontend/build']);
      assert.deepEqual(focused.remaining, existing.remaining);
      assert.equal(existsSync(path.join(repositoryRoot, 'frontend/.svelte-kit')), true);
      const explicit = await inspectVerificationArtifacts('browser', false, options);
      assert.deepEqual(explicit.removed, ['frontend/.svelte-kit']);
      assert.deepEqual(explicit.remaining, ['coverage']);
      assert.equal(existsSync(path.join(repositoryRoot, 'coverage')), true);
    } finally {
      rmSync(repositoryRoot, { recursive: true, force: true });
    }
  });

  test('explains dependency fallback without exposing arbitrary failure details', () => {
    const failure = Object.assign(new Error('private transport detail'), { code: 'ENOENT' });
    assert.equal(dependencyAnalysisFailure('reading dependency configuration', failure),
      'Dependency analysis failed while reading dependency configuration (ENOENT): the focused plan falls back to the complete unit and functional browser inventories.');
    for (const error of [new SyntaxError('private transport detail'), new TypeError('private transport detail'), { code: 'private transport detail' }, null]) {
      assert.doesNotMatch(dependencyAnalysisFailure('mapping source dependents', error), /private transport detail/u);
    }
  });
  test('uses discovered tests for a deterministic exact browser plan and retains honest timing history', () => {
    const inventory = readVerificationTestInventory();
    const profile = readVerificationTimingProfile();
    const first = buildBalancedBrowserShardPlan(profile);
    const second = buildBalancedBrowserShardPlan(profile);
    assert.deepEqual(first, second);
    assert.equal(profile.inventoryFingerprint, verificationTestInventoryFingerprint(profile.files.map((item) => item.file)));
    assert.equal(first.inventoryFingerprint, verificationTestInventoryFingerprint(inventory));
    assert.ok(inventory.every((file) => !file.startsWith('test/') || /^test\/[^/]+\.test\.mts$/u.test(file)));
    assert.equal(inventory.includes('tools/test-duration-reporter.mts'), false);
    assert.equal(inventory.some((file) => file.startsWith('test/support/')), false);
    assert.equal(first.setupFiles.length, 1);
    assert.equal(first.shards.length, VERIFICATION_BROWSER_SHARD_COUNT);
    const browserInventory = inventory.filter((file) => file.endsWith('.spec.ts')).sort();
    const eligible = browserInventory.filter(isPlaywrightFunctionalSpec);
    const performanceAuthority = browserInventory.filter(isPlaywrightPerformanceAuthoritySpec);
    const assigned = first.shards.flatMap((item) => item.files).sort();
    assert.deepEqual(assigned, eligible);
    assert.deepEqual(performanceAuthority, [...PLAYWRIGHT_PERFORMANCE_AUTHORITY_SPECS].sort());
    assert.deepEqual([...assigned, ...performanceAuthority].sort(), browserInventory);
    assert.equal(new Set(assigned).size, assigned.length);
    assert.equal(first.shards.reduce((sum, item) => sum + item.plannedWeightMs, 0), first.totalPlannedWeightMs);
    assert.ok(first.unavoidableImbalanceMs >= 0);
    assert.deepEqual(selectBalancedBrowserShard(`1/${first.shardCount}`).shard, first.shards[0]);
    assert.throws(() => selectBalancedBrowserShard(`${first.shardCount + 1}/${first.shardCount}`), /must select/u);
    const matrix = browserVerificationMatrix(first);
    assert.deepEqual(matrix.include.filter(row => row.kind === 'functional').map(row => row.shard), first.shards.map(shard => `${shard.shard}/${first.shardCount}`));
    assert.deepEqual(matrix.include.filter(row => row.kind === 'performance'), [{ kind: 'performance', label: 'performance' }]);
  });

  test('rejects missing, duplicate, unknown, malformed, and unmeasured timing identities', () => {
    const retained = rawProfile();
    const inventory = (retained.files as Array<{ file: string }>).map((item) => item.file);
    assert.doesNotThrow(() => parseVerificationTimingProfile(JSON.stringify(retained), inventory));
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

  test('discovers new and removed tests without rewriting historical timings or pretending estimates were measured', () => {
    const files = ['a', 'b', 'c', 'd'].map((name, index) => ({
      file: `e2e/${name}.spec.ts`, lane: 'browser', weightMs: (index + 1) * 100, sampleCount: 1, provenanceId: 'fixture-browser',
    }));
    const profile = parseVerificationTimingProfile(JSON.stringify({
      profileVersion: 1,
      inventoryFingerprint: verificationTestInventoryFingerprint(files.map((item) => item.file)),
      provenance: [{ id: 'fixture-browser', lane: 'browser', environmentClass: 'fixture', sampleBasis: 'fixture', sampleCount: 1 }],
      files,
    }));
    const before = JSON.stringify(profile);
    const inventory = ['e2e/a.spec.ts', 'e2e/b.spec.ts', 'e2e/c.spec.ts', 'e2e/new.spec.ts', 'test/new.test.mts'];
    const plan = buildBalancedBrowserShardPlan(profile, 4, inventory);
    assert.deepEqual(plan, buildBalancedBrowserShardPlan(profile, 4, [...inventory].reverse()));
    assert.deepEqual(plan.shards.flatMap((shard) => shard.files).sort(), inventory.filter(isPlaywrightFunctionalSpec));
    assert.deepEqual(plan.unmeasuredFiles, ['e2e/new.spec.ts', 'test/new.test.mts']);
    assert.equal(plan.totalPlannedWeightMs, 850, 'new browser file uses the historical lane median only for scheduling');
    assert.equal(plan.inventoryFingerprint, verificationTestInventoryFingerprint(inventory));
    assert.equal(JSON.stringify(profile), before);
    assert.equal(profile.files.some((item) => item.file === 'e2e/new.spec.ts'), false);
    const withoutBrowserHistory = { ...profile, files: [] };
    assert.equal(buildBalancedBrowserShardPlan(withoutBrowserHistory, 4, inventory).totalPlannedWeightMs, 4);
  });

  test('builds a complete median-of-three unit candidate and retires replaced provenance', () => {
    const retained = readVerificationTimingProfile();
    assert.ok(retained.provenance.length < MAX_TIMING_PROVENANCE);
    const unitFiles = readVerificationTestInventory().filter((file) => file.startsWith('test/')).map((file) => ({ file }));
    const replacedProvenance = new Set(retained.files.filter((file) => file.lane === 'unit').map((file) => file.provenanceId));
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
      inventoryFingerprint: plan.inventoryFingerprint,
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
      for (const file of plan.unmeasuredFiles.filter((file) => file.startsWith('test/'))) {
        assert.equal(candidate.files.some((item) => item.file === file), false, 'browser evidence must not fabricate a unit timing');
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
    const cleanEnvironment = environmentWithoutV8Coverage();
    try {
      const reports = plan.shards.map((shard) => {
        const report = path.join(directory, `shard-${shard.shard}-of-${plan.shardCount}.json`);
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
      assert.deepEqual([...reportPaths([`--reports-directory=${directory}`]).paths].sort(), [...reports].sort());
      assert.throws(() => reportPaths([`--reports-directory=${directory}`, `--report=${reports[0]}`]), /Usage/u);
      assert.throws(() => reportPaths([`--reports-directory=${directory}`, '--summary', '--summary']), /Usage/u);
      const unexpected = path.join(directory, 'unexpected.json');
      writeFileSync(unexpected, '{}');
      assert.throws(() => reportPaths([`--reports-directory=${directory}`]), /exactly/u);
      rmSync(unexpected);
      const aggregateRun = spawnSync(npm, [
        'run', '--silent', 'test:e2e:aggregate', '--',
        `--reports-directory=${directory}`,
      ], {
        cwd: REPOSITORY_ROOT,
        env: cleanEnvironment,
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
      });
      assert.equal(aggregateRun.status, 0, aggregateRun.stderr || aggregateRun.stdout);
      const aggregate = JSON.parse(aggregateRun.stdout) as { inventoryFingerprint: string };
      assert.equal(aggregate.inventoryFingerprint, plan.inventoryFingerprint);
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
      const candidate = parseVerificationTimingProfile(candidateRun.stdout);
      const measuredBrowser = candidate.files.filter((item) => item.lane !== 'unit' && !isPlaywrightPerformanceAuthoritySpec(item.file));
      assert.deepEqual(measuredBrowser.map((item) => item.file).sort(), [...plan.setupFiles, ...plan.shards.flatMap((shard) => shard.files)].sort());
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
    assert.equal(plan.mapVersion, 3);
    assert.equal(plan.assignments.length, paths.length);
    assert.equal(plan.fullVerificationScript, 'verification:ci');
    const explanation = renderExecutionPlan(plan, buildFocusedVerificationExecution(plan));
    assert.match(explanation, /npm run verification:ci -- --list/u);
    assert.match(explanation, /npm run test:e2e:stress/u);
    assert.match(explanation, /production dependency audit.*docs\/releasing\.md/u);
    assert.ok(plan.focusedUnitChecks.length > 0);
    assert.ok(plan.focusedBrowserChecks.includes('e2e/dashboard.spec.ts'));
    assert.equal(plan.userFacingBrowserRequired, true);
    assert.match(JSON.stringify(plan), /Focused checks support iteration only/u);
    assert.ok(plan.focusedUnitChecks.every((file) => /^test\/[^/]+\.test\.mts$/u.test(file)));
    assert.ok(plan.focusedBrowserChecks.every(isPlaywrightFunctionalSpec));

    const closure = checkVerificationOwnershipMap();
    assert.equal(closure.assignedFiles, closure.maintainedFiles);
    assert.ok(closure.schemaFamilies > 0 && closure.capabilities > 0 && closure.cliOperations > 0);
    assert.ok(closure.privacyProfiles > 0 && closure.privacyConsumerFlows > 0);
    assert.ok(closure.browserRequiredSupportPaths > 0);
    assert.throws(() => buildVerificationOwnershipPlan(['../outside.mts']), /repository-relative|traverse/u);
    assert.throws(() => buildVerificationOwnershipPlan(['lib/helper;touch.mts']), /repository-relative/u);
    assert.throws(() => buildVerificationOwnershipPlan(['lib/$(id).mts']), /repository-relative/u);
    assert.throws(() => buildVerificationOwnershipPlan(['lib/safe-fetch.mts', 'lib/safe-fetch.mts']), /must not repeat/u);
    assert.throws(() => buildVerificationOwnershipPlan(['unowned-root.cfg']), /Unknown maintained ownership area/u);
    assert.throws(
      () => assertDeclaredVerificationTest('test/absent.test.mts', 'unit'),
      /does not exist/u,
    );
    assert.throws(
      () => assertDeclaredVerificationTest('test/verification-architecture.mts', 'unit'),
      /invalid test-file identity/u,
    );
    assert.throws(
      () => assertDeclaredVerificationTest('e2e/accessibility.setup.ts', 'browser'),
      /invalid test-file identity/u,
    );
  });

  test('selects derived coverage for each structural change owner', () => {
    const rehearsals = [
      {
        kind: 'isolated presentation',
        path: 'frontend/src/lib/components/LookupAtAGlance.svelte',
        owner: 'frontend user-facing routes and components',
        unit: 'test/lookup-request-controller.test.mts',
        browser: 'e2e/lookup-interaction-design.spec.ts',
        specialised: 'architecture',
        excluded: 'cli-package',
      },
      {
        kind: 'Case status decision',
        path: 'packages/cases/case-record-decisions.mts',
        owner: 'Case domain and response lifecycle',
        unit: 'test/case-record-ownership.test.mts',
        browser: 'e2e/cases.spec.ts',
        specialised: 'privacy-catalogue',
      },
      {
        kind: 'CLI option',
        path: 'cli/command-reference.mts',
        owner: 'CLI command and installed-package surface',
        unit: 'test/cli-command-registry.test.mts',
        browser: null,
        specialised: 'cli-package',
      },
      {
        kind: 'portable Case field',
        path: 'packages/cases/case-record-projection.mts',
        owner: 'Case domain and response lifecycle',
        unit: 'test/cli-case-pack.test.mts',
        browser: 'e2e/case-import-workflows.spec.ts',
        specialised: 'schema-inventory',
      },
      {
        kind: 'browser-test support artefact',
        path: 'tools/frontend-build-integrity.mts',
        owner: 'maintainer verification tooling',
        unit: 'test/frontend-build-integrity.test.mts',
        browser: 'e2e/deferred-recovery.spec.ts',
        specialised: 'browser-build',
      },
    ] as const;

    for (const rehearsal of rehearsals) {
      const assignment = buildVerificationOwnershipPlan([rehearsal.path]).assignments[0]!;
      assert.equal(assignment.ownershipArea, rehearsal.owner, rehearsal.kind);
      assert.ok(assignment.focusedUnitChecks.includes(rehearsal.unit), rehearsal.kind);
      if (rehearsal.browser) assert.ok(assignment.focusedBrowserChecks.includes(rehearsal.browser), rehearsal.kind);
      else assert.deepEqual(assignment.focusedBrowserChecks, [], rehearsal.kind);
      assert.ok(assignment.mandatorySpecialisedChecks.includes(rehearsal.specialised), rehearsal.kind);
      if ('excluded' in rehearsal) {
        assert.equal(assignment.mandatorySpecialisedChecks.includes(rehearsal.excluded), false, rehearsal.kind);
      }
    }
  });

  test('plans shared browser support changes against the complete functional inventory', () => {
    const functionalInventory = readVerificationTestInventory()
      .filter(isPlaywrightFunctionalSpec)
      .sort();
    const supportPaths = [
      'e2e/auth.setup.ts',
      'e2e/fixtures.ts',
      'e2e/helpers.ts',
    ];

    for (const supportPath of supportPaths) {
      const assignment = buildVerificationOwnershipPlan([supportPath]).assignments[0]!;
      assert.equal(assignment.ownershipArea, 'browser and analyst-journey verification');
      assert.ok(assignment.impactAreas.includes('shared browser setup and support verification'));
      assert.deepEqual(assignment.focusedBrowserChecks, functionalInventory);
      assert.equal(assignment.focusedBrowserChecks.includes('e2e/auth.setup.ts'), false);
      assert.equal(assignment.userFacingBrowserRequired, true);
    }

    const mixed = buildVerificationOwnershipPlan([
      'e2e/helpers.ts',
      'e2e/dashboard.spec.ts',
    ]);
    assert.deepEqual(mixed.focusedBrowserChecks, functionalInventory);
    assert.equal(mixed.assignments.length, 2);
    assert.deepEqual(
      buildFocusedVerificationExecution(mixed).browserSpecs,
      functionalInventory,
    );
  });

  test('discovers new browser specifications by family without a maintained filename mirror', () => {
    const inventory = ['e2e/lookup-new-review.spec.ts', 'e2e/lookup.spec.ts', 'e2e/lookupish.spec.ts', 'e2e/cases.spec.ts', 'e2e/auth.setup.ts'];
    assert.deepEqual(browserSpecsForPrefixes(['lookup'], inventory), ['e2e/lookup-new-review.spec.ts', 'e2e/lookup.spec.ts']);
    assert.deepEqual(browserSpecsForPrefixes(['lookup'], [...inventory].reverse()), browserSpecsForPrefixes(['lookup'], inventory));
  });

  test('covers canonical console destinations and focused Case forms without unrelated import journeys', () => {
    const navigation = buildVerificationOwnershipPlan(['frontend/src/lib/workspaces.ts']);
    assert.ok(navigation.focusedBrowserChecks.includes('e2e/console-workflow-navigation.spec.ts'));
    assert.ok(navigation.focusedBrowserChecks.includes('e2e/console-workspace-layout.spec.ts'));
    assert.ok(navigation.focusedBrowserChecks.includes('e2e/mobile-nav.spec.ts'));
    const form = buildVerificationOwnershipPlan(['frontend/src/lib/components/CaseHistoryStage.svelte']);
    assert.ok(form.focusedBrowserChecks.includes('e2e/case-workspace-navigation.spec.ts'));
    assert.ok(form.focusedBrowserChecks.includes('e2e/submitted-drafts.spec.ts'));
    assert.ok(form.focusedUnitChecks.includes('test/submitted-draft.test.mts'));
    assert.equal(form.focusedBrowserChecks.includes('e2e/case-import-workflows.spec.ts'), false);
    assert.equal(form.focusedBrowserChecks.includes('e2e/case-brand-association.spec.ts'), false);
    assert.equal(form.mandatorySpecialisedChecks.includes('schema-inventory'), false);
    assert.equal(form.mandatorySpecialisedChecks.includes('cli-package'), false);
    assert.equal(form.mandatorySpecialisedChecks.includes('privacy-catalogue'), false);
  });

  test('does not mistake an unexplained interface for accessibility-only impact', () => {
    const plan = buildVerificationOwnershipPlan(['frontend/src/lib/components/NewOrdinaryPanel.svelte']);
    assert.deepEqual(plan.focusedBrowserChecks, readVerificationTestInventory().filter(isPlaywrightFunctionalSpec).sort());
    const family = buildVerificationOwnershipPlan(['frontend/src/lib/components/LookupNewReview.svelte']);
    assert.ok(family.focusedBrowserChecks.includes('e2e/lookup-workspace-navigation.spec.ts'));
    assert.equal(family.focusedBrowserChecks.includes('e2e/bulk-analysis.spec.ts'), false);
  });

  test('test-only edits select their assertions without inheriting similarly named production work', async () => {
    for (const file of ['test/deferred-module.test.mts', 'test/privacy-data-flow-catalogue.test.mts']) {
      const plan = await createVerificationOwnershipPlan([file]);
      assert.deepEqual(plan.focusedUnitChecks, [file]);
      assert.deepEqual(plan.focusedBrowserChecks, []);
      assert.deepEqual(plan.mandatorySpecialisedChecks, []);
      assert.equal(buildFocusedVerificationExecution(plan).commands.some(command => command.id === 'build'), false);
    }
  });

  test('public routes include their own discovered behaviour specifications', () => {
    const demo = buildVerificationOwnershipPlan(['frontend/src/routes/(public)/demo/+page.svelte']);
    assert.ok(demo.focusedBrowserChecks.includes('e2e/demo.spec.ts'));
    assert.ok(demo.focusedBrowserChecks.includes('e2e/accessibility.spec.ts'));
    const article = 'frontend/src/routes/(public)/resources/[slug]/+page.svelte';
    assert.deepEqual(buildVerificationOwnershipPlan([article]).changedPaths, [article]);
  });

  test('leaf component contracts narrow iteration but not stateful, unresolved or unowned components', () => {
    const file = 'frontend/src/lib/components/CopyButton.svelte';
    const spec = 'e2e/copy-button.component.spec.ts';
    const graph = { modules: [{ source: file, dependencies: [{ module: 'svelte', resolved: 'node_modules/svelte/src/index.js' }] }] } as Parameters<typeof leafComponentContracts>[1];
    const contracts = leafComponentContracts([file], graph, [spec]);
    assert.deepEqual(contracts.get(file), [spec]);
    const plan = buildVerificationOwnershipPlan([file], new Map(), new Map(), new Map(), contracts);
    assert.deepEqual(plan.focusedBrowserChecks, [spec]);
    assert.equal(plan.fullVerificationScript, 'verification:ci');
    assert.equal(leafComponentContracts([file], graph, []).size, 0);
    graph.modules[0]!.dependencies[0]!.couldNotResolve = true;
    assert.equal(leafComponentContracts([file], graph, [spec]).size, 0);
    graph.modules[0]!.dependencies[0] = { module: '../browser-local-data', resolved: 'frontend/src/lib/browser-local-data.ts' } as typeof graph.modules[0]['dependencies'][number];
    assert.equal(leafComponentContracts([file], graph, [spec]).size, 0);
  });

  test('an extracted frontend helper inherits its persistence owner without a filename registration', () => {
    const file = 'frontend/src/lib/ordinary-transaction-helper.ts';
    const plan = buildVerificationOwnershipPlan([file], new Map(), new Map(), new Map([
      [file, ['frontend/src/lib/browser-local-data.ts', 'frontend/src/routes/(console)/bulk/+page.svelte']],
    ]));
    assert.ok(plan.impactAreas.includes('browser-local persistence and migration behaviour'));
    assert.ok(plan.focusedUnitChecks.includes('test/workspace-rollback.test.mts'));
    assert.ok(plan.focusedBrowserChecks.includes('e2e/watchlist-storage.spec.ts'));
    assert.ok(plan.mandatorySpecialisedChecks.includes('schema-inventory'));
  });

  test('keeps document-only checks offline and avoids application compilation and browser work', async () => {
    for (const file of ['README.md', 'docs/getting-started.md', 'packages/cases/README.md', 'docs/cli.md', 'SECURITY.md', 'TRADEMARKS.md', 'PRIVACY.md', 'docs/capability-manifest.md']) {
      const plan = await createVerificationOwnershipPlan([file]);
      const execution = buildFocusedVerificationExecution(plan);
      assert.deepEqual(execution.browserSpecs, [], file);
      assert.equal(execution.cleanupBrowserArtifacts, false, file);
      assert.ok(!execution.commands.some((command) => /typecheck|build|^check$/u.test(command.id)), file);
      if (['docs/cli.md', 'SECURITY.md', 'TRADEMARKS.md'].includes(file)) assert.ok(plan.focusedUnitChecks.includes('test/cli-package-boundary.test.mts'));
      if (file === 'PRIVACY.md') assert.ok(plan.mandatorySpecialisedChecks.includes('privacy-catalogue'));
      if (file === 'docs/capability-manifest.md') {
        assert.ok(plan.mandatorySpecialisedChecks.includes('capability-catalogue'));
        assert.ok(plan.focusedUnitChecks.includes('test/capability-manifest.test.mts'));
      }
    }
  });

  test('discovers transitive helper consumers and safely falls back when imports cannot explain coverage', () => {
    const inventory = ['test/consumer.test.mts', 'test/unrelated.test.mts'];
    const graph = { modules: [
      { source: 'test/consumer.test.mts', dependencies: [{ resolved: 'packages/example/owner.mts', module: '../packages/example/owner.mts' }] },
      { source: 'test/unrelated.test.mts', dependencies: [] },
      { source: 'packages/example/owner.mts', dependencies: [{ resolved: 'packages/example/helper.mts', module: './helper.mts' }] },
      { source: 'packages/example/helper.mts', dependencies: [{ resolved: 'packages/example/owner.mts', module: './owner.mts' }] },
    ] } as Parameters<typeof importedTestConsumers>[1];
    const selected = importedTestConsumers(['packages/example/helper.mts', 'test/consumer.test.mts', 'packages/example/deleted.mts'], graph, inventory);
    assert.deepEqual(selected.get('packages/example/helper.mts'), ['test/consumer.test.mts']);
    assert.deepEqual(selected.get('test/consumer.test.mts'), ['test/consumer.test.mts']);
    assert.deepEqual(selected.get('packages/example/deleted.mts'), inventory);
    graph.modules[0]!.dependencies[0]!.couldNotResolve = true;
    assert.deepEqual(importedTestConsumers(['packages/example/helper.mts'], graph, inventory).get('packages/example/helper.mts'), inventory);
    assert.equal(buildVerificationOwnershipPlan(['test/helpers/subprocess-environment.mts']).focusedUnitChecks.includes('test/helpers/subprocess-environment.mts'), false);
  });

  test('keeps erased type dependencies in compiler checks without treating them as runtime consumers', () => {
    const inventory = ['test/runtime.test.mts', 'test/type-only.test.mts'];
    const graph = { modules: [
      { source: inventory[0], dependencies: [{ resolved: 'packages/example/owner.mts', module: '../packages/example/owner.mts', typeOnly: false, preCompilationOnly: false }] },
      { source: inventory[1], dependencies: [
        { resolved: 'packages/example/owner.mts', module: '../packages/example/owner.mts', typeOnly: true },
        { resolved: './$types', module: './$types', couldNotResolve: true, preCompilationOnly: true },
      ] },
    ] } as Parameters<typeof importedTestConsumers>[1];
    assert.deepEqual(importedTestConsumers(['packages/example/owner.mts'], graph, inventory).get('packages/example/owner.mts'), [inventory[0]]);
    graph.modules[1]!.dependencies[1]!.preCompilationOnly = false;
    assert.deepEqual(importedTestConsumers(['packages/example/owner.mts'], graph, inventory).get('packages/example/owner.mts'), inventory);
    const execution = buildFocusedVerificationExecution(buildVerificationOwnershipPlan(['packages/cases/case-recheck-model.mts']));
    assert.equal(execution.commands.filter(command => command.id === 'typecheck').length, 1);
    assert.equal(execution.commands.some(command => command.id.startsWith('typecheck (')), false);
  });

  test('resolves ordinary components to existing route coverage without registering component names', () => {
    const ordinary = 'frontend/src/lib/components/NewOrdinaryPanel.svelte';
    const discovered = buildVerificationOwnershipPlan([ordinary], new Map(), new Map(),
      new Map([[ordinary, ['frontend/src/routes/(public)/resources/+page.svelte']]]));
    assert.ok(discovered.focusedBrowserChecks.includes('e2e/public-guide.spec.ts'));
    assert.equal(discovered.focusedBrowserChecks.includes('e2e/bulk-analysis.spec.ts'), false);
    const unexplained = buildVerificationOwnershipPlan([ordinary], new Map(), new Map(),
      new Map([[ordinary, ['frontend/src/routes/(console)/unclassified/+page.svelte']]]));
    assert.deepEqual(unexplained.focusedBrowserChecks, readVerificationTestInventory().filter(isPlaywrightFunctionalSpec).sort());
    assert.deepEqual(unexplained.assignments[0]!.selectionNotes, [
      'Full browser coverage: no classified route owner for frontend/src/routes/(console)/unclassified/+page.svelte.',
    ]);
    const explanation = renderExecutionPlan(unexplained, buildFocusedVerificationExecution(unexplained));
    assert.ok(explanation.includes('frontend/src/routes/(console)/unclassified/+page.svelte'));
    assert.ok(explanation.includes('Full browser coverage: no classified route owner'));
    assert.deepEqual(discovered.assignments[0]!.selectionNotes, []);
    const stage = 'frontend/src/lib/components/CaseHistoryStage.svelte';
    const known = buildVerificationOwnershipPlan([stage], new Map(), new Map(),
      new Map([[stage, ['frontend/src/routes/(console)/cases/+page.svelte']]]));
    assert.deepEqual(known.focusedBrowserChecks, buildVerificationOwnershipPlan([stage]).focusedBrowserChecks);
  });

  test('discovers frontend controller coverage through consumers rather than unrelated default workflows', () => {
    const helper = 'frontend/src/lib/controllers/ordinary-reference-filter.ts';
    const unit = 'test/ordinary-reference-filter.test.mts';
    const route = 'frontend/src/routes/(public)/resources/+page.svelte';
    const plan = buildVerificationOwnershipPlan([helper], new Map([[helper, [unit]]]), new Map(),
      new Map([[helper, [route]]]));
    assert.ok(plan.focusedUnitChecks.includes(unit));
    assert.ok(plan.focusedBrowserChecks.includes('e2e/public-guide.spec.ts'));
    assert.ok(plan.focusedBrowserChecks.includes('e2e/accessibility.spec.ts'));
    assert.equal(plan.focusedUnitChecks.includes('test/lookup-request-controller.test.mts'), false);
    assert.equal(plan.focusedBrowserChecks.includes('e2e/dashboard.spec.ts'), false);
    assert.equal(plan.focusedBrowserChecks.includes('e2e/bulk-analysis.spec.ts'), false);
    const missing = buildVerificationOwnershipPlan([helper]);
    assert.deepEqual(missing.assignments[0]!.selectionNotes, [
      'Full browser coverage: no consuming route could be established for this interface.',
    ]);
    assert.deepEqual(missing.focusedBrowserChecks, readVerificationTestInventory().filter(isPlaywrightFunctionalSpec).sort());
    const unknown = buildVerificationOwnershipPlan([helper], new Map(), new Map(),
      new Map([[helper, ['frontend/src/routes/(console)/new-workflow/+page.svelte']]]));
    assert.deepEqual(unknown.focusedBrowserChecks, missing.focusedBrowserChecks);
  });

  test('does not assign frontend workflow ownership to a similarly named CLI helper', () => {
    const assignment = buildVerificationOwnershipPlan(['cli/lookup-report.mts']).assignments[0]!;
    assert.equal(assignment.ownershipArea, 'CLI command and installed-package surface');
    assert.deepEqual(assignment.focusedBrowserChecks, []);
    assert.ok(assignment.mandatorySpecialisedChecks.includes('cli-package'));
  });


  test('selects one owner while aggregating every matching verification impact', () => {
    const plan = buildVerificationOwnershipPlan([
      'packages/contracts/privacy-data-flow-catalogue.mts',
      'tools/privacy-data-flow-catalogue-renderer.mts',
      'tools/schema-lifecycle-repository.mts',
      'tools/public-product-catalogue-renderer.mts',
      'frontend/src/lib/components/LookupAtAGlance.svelte',
    ]);
    const byPath = new Map(plan.assignments.map((assignment) => [assignment.changedPath, assignment]));

    const sharedPrivacy = byPath.get('packages/contracts/privacy-data-flow-catalogue.mts')!;
    assert.equal(sharedPrivacy.ownershipArea, 'shared contracts and lifecycle metadata');
    assert.deepEqual(sharedPrivacy.impactAreas, [
      'privacy contract and disclosure surfaces',
      'shared contracts and lifecycle metadata',
    ]);
    assert.ok(sharedPrivacy.focusedUnitChecks.includes('test/schema-lifecycle-registry.test.mts'));
    assert.ok(sharedPrivacy.focusedUnitChecks.includes('test/privacy-data-flow-catalogue.test.mts'));
    assert.ok(sharedPrivacy.focusedBrowserChecks.includes('e2e/privacy-data-flow-catalogue.spec.ts'));

    const privacyRenderer = byPath.get('tools/privacy-data-flow-catalogue-renderer.mts')!;
    assert.equal(privacyRenderer.ownershipArea, 'maintainer verification tooling');
    assert.ok(privacyRenderer.impactAreas.includes('privacy catalogue verification'));
    assert.ok(privacyRenderer.impactAreas.includes('privacy contract and disclosure surfaces'));
    assert.ok(privacyRenderer.mandatorySpecialisedChecks.includes('workflow-closure'));
    assert.ok(privacyRenderer.mandatorySpecialisedChecks.includes('privacy-catalogue'));

    const schemaTool = byPath.get('tools/schema-lifecycle-repository.mts')!;
    assert.ok(schemaTool.impactAreas.includes('schema inventory and lifecycle verification'));
    assert.ok(schemaTool.focusedUnitChecks.includes('test/schema-lifecycle-repository.test.mts'));
    assert.ok(schemaTool.mandatorySpecialisedChecks.includes('schema-inventory'));

    const publicTool = byPath.get('tools/public-product-catalogue-renderer.mts')!;
    assert.ok(publicTool.impactAreas.includes('public product and capability verification'));
    assert.ok(publicTool.focusedBrowserChecks.includes('e2e/capabilities.spec.ts'));
    assert.ok(publicTool.mandatorySpecialisedChecks.includes('capability-catalogue'));

    const lookup = byPath.get('frontend/src/lib/components/LookupAtAGlance.svelte')!;
    assert.equal(lookup.ownershipArea, 'frontend user-facing routes and components');
    assert.ok(lookup.impactAreas.includes('Lookup analyst workflow'));
    assert.ok(lookup.focusedBrowserChecks.includes('e2e/lookup-anchor-navigation.spec.ts'));
    assert.ok(lookup.focusedBrowserChecks.includes('e2e/accessibility.spec.ts'));
    assert.equal(lookup.focusedBrowserChecks.includes('e2e/bulk-analysis.spec.ts'), false);
  });

  test('consolidates a user-interface change into one bounded focused execution plan', () => {
    const ownership = buildVerificationOwnershipPlan([
      'frontend/src/lib/components/LookupAtAGlance.svelte',
      'e2e/lookup-interaction-design.spec.ts',
    ]);
    const execution = buildFocusedVerificationExecution(ownership);
    const ids = execution.commands.map((command) => command.id);

    assert.equal(ids[0], 'browser-discovery');
    assert.equal(execution.commands[0]!.args.includes('--list'), true);
    assert.deepEqual(execution.commands[0]!.environment, { CI: '', WHOISLEUTH_E2E_USE_BUILD: '0', WHOISLEUTH_E2E_PERFORMANCE_FIRST: '1', PLAYWRIGHT_JSON_OUTPUT_FILE: '' });
    assert.ok(execution.commands.slice(1).every(command => command.environment === undefined));

    assert.equal(ids.filter((id) => id === 'typecheck (e2e/tsconfig.json)').length, 1);
    assert.equal(ids.includes('typecheck (tsconfig.json)'), false);
    assert.equal(ids.filter((id) => id === 'check').length, 1);
    assert.equal(ids.filter((id) => id === 'build').length, 1);
    assert.equal(ids.filter((id) => id === 'architecture:check').length, 1);
    assert.ok(ids.includes('verification:journeys:check'));
    assert.ok(ids.includes('verification:timing:check'));
    assert.ok(ids.includes('diff-whitespace'));
    assert.ok(execution.browserSpecs.includes('e2e/lookup-interaction-design.spec.ts'));
    assert.ok(execution.browserSpecs.includes('e2e/accessibility.spec.ts'));
    assert.ok(execution.browserSpecs.includes('e2e/lookup-anchor-navigation.spec.ts'));
    assert.equal(execution.browserSpecs.includes('e2e/design-system.spec.ts'), false);
    assert.ok(!ids.includes('test:e2e:built'));
    assert.ok(!ids.includes('verification:ci'));
    assert.deepEqual(execution.deferredSpecialisedChecks, []);
  });

  test('browser discovery catches import failures without running setup, tests or a server', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'whoisleuth-test-discovery-'));
    try {
      const config = path.join(directory, 'playwright.config.cjs');
      const spec = path.join(directory, 'discovery.spec.cjs');
      writeFileSync(config, `module.exports = {
        testDir: ${JSON.stringify(directory)}, testMatch: '**/*.spec.cjs',
        projects: [{ name: 'chromium' }],
        webServer: { command: 'this-command-must-never-start', port: 4199 },
      };`);
      const execution = buildFocusedVerificationExecution(buildVerificationOwnershipPlan(['e2e/review-session.spec.ts']));
      const command = execution.commands[0]!;
      const args = [...command.args.filter(arg => !arg.endsWith('.spec.ts')), `--config=${config}`];
      const run = () => spawnSync(command.executable, args, {
        cwd: REPOSITORY_ROOT, env: { ...environmentWithoutV8Coverage(), ...command.environment },
        encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
      });
      writeFileSync(spec, "require('./missing-support.cjs');");
      const broken = run();
      assert.ifError(broken.error);
      assert.notEqual(broken.status, 0);
      assert.match(broken.stdout + broken.stderr, /missing-support/u);
      writeFileSync(spec, `const { test } = require(${JSON.stringify(path.join(REPOSITORY_ROOT, 'node_modules/@playwright/test'))});
        test.beforeAll(() => { throw new Error('setup must not run'); });
        test('discovered but not executed', () => { throw new Error('test must not run'); });`);
      const valid = run();
      assert.ifError(valid.error);
      assert.equal(valid.status, 0, valid.stdout + valid.stderr);
      assert.equal(JSON.parse(valid.stdout).suites[0].specs.length, 1);
      assert.doesNotMatch(valid.stdout + valid.stderr, /Error: (setup|test) must not run/u);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('iteration defers integration execution explicitly without changing its selection or defaults', () => {
    const paths = ['packages/cases/case-record-projection.mts', 'frontend/src/lib/components/LookupAtAGlance.svelte'];
    const plan = buildVerificationOwnershipPlan(paths);
    const integration = buildFocusedVerificationExecution(plan);
    const iteration = buildFocusedVerificationExecution(plan, { iteration: true });
    assert.equal(integration.scope, 'integration');
    assert.equal(iteration.scope, 'iteration');
    assert.deepEqual(iteration.browserSpecs, []);
    assert.deepEqual(iteration.deferredBrowserSpecs, plan.focusedBrowserChecks);
    assert.deepEqual(iteration.deferredSpecialisedChecks, [...plan.mandatorySpecialisedChecks].sort());
    assert.deepEqual(iteration.commands.map(command => command.id), ['browser-discovery', 'focused-unit', 'check', 'typecheck', 'diff-whitespace']);
    assert.deepEqual(iteration.commands.find(command => command.id === 'focused-unit')?.args,
      integration.commands.find(command => command.id === 'focused-unit')?.args);
    assert.deepEqual(iteration.commands.find(command => command.id === 'check')?.selectedBy, [paths[1]]);
    assert.deepEqual(iteration.commands.find(command => command.id === 'typecheck')?.selectedBy, [paths[0]]);
    assert.ok(integration.commands.some(command => command.id === 'schema:inventory'));
    for (const command of integration.commands) {
      assert.ok(command.selectedBy.length, command.id);
      assert.ok(command.selectedBy.every(file => paths.includes(file)), command.id);
    }
    const rendered = renderExecutionPlan(plan, iteration);
    assert.match(rendered, /Iteration is not integration acceptance/u);
    assert.match(rendered, /Browser execution deferred:/u);
    assert.match(rendered, /Run: check — selected by frontend\/src\/lib\/components\/LookupAtAGlance.svelte/u);
  });

  test('focused native integration checks use the shared preflight and stay out of iteration', async () => {
    const shell = 'test/cli-shell-completion.integration.test.mts';
    const unit = 'test/cli-doctor-completion.test.mts';
    const plan = await createVerificationOwnershipPlan([shell, unit]);
    assert.ok(plan.focusedUnitChecks.includes(shell));
    assert.ok(plan.focusedUnitChecks.includes(unit));
    const integration = buildFocusedVerificationExecution(plan);
    const iteration = buildFocusedVerificationExecution(plan, { iteration: true });
    const command = integration.commands.find(command => command.id === 'focused-integration');
    assert.ok(command);
    assert.equal(command.executable, process.execPath);
    assert.deepEqual(command.args, [
      path.join(REPOSITORY_ROOT, 'tools/toolchain-compatibility.mts'),
      '--unit-tests', '--test', '--test-concurrency=1', shell,
    ]);
    assert.deepEqual(command.selectedBy, [shell]);
    for (const execution of [integration, iteration]) {
      const selectedUnit = execution.commands.find(command => command.id === 'focused-unit');
      assert.ok(selectedUnit);
      assert.ok(selectedUnit.args.includes(unit));
      assert.equal(selectedUnit.args.includes(shell), false);
    }
    assert.equal(iteration.commands.some(command => command.id === 'focused-integration'), false);
    assert.deepEqual(iteration.deferredIntegrationChecks, [shell]);
    assert.deepEqual(integration.deferredIntegrationChecks, []);
    assert.match(renderExecutionPlan(plan, iteration), /Integration execution deferred: test\/cli-shell-completion.integration.test.mts/u);
    assert.match(renderExecutionPlan(plan, integration), /Focused integration files: 1/u);
    for (const execution of [integration, iteration]) {
      const rendered = renderExecutionPlan(plan, execution);
      assert.ok(rendered.includes(`Selected unit test: ${unit} — selected by ${unit}.`));
      assert.ok(rendered.includes(`Selected integration test: ${shell} — selected by ${shell}.`));
    }
  });

  test('workflow edits select executable shell contracts, with an explicit iteration deferral', async () => {
    const plan = await createVerificationOwnershipPlan(['.github/workflows/test-health.yml']);
    const shell = 'test/workflow-shells.integration.test.mts';
    assert.ok(plan.focusedUnitChecks.includes(shell));
    assert.ok(buildFocusedVerificationExecution(plan).commands.some(command => command.id === 'focused-integration' && command.args.includes(shell)));
    assert.ok(buildFocusedVerificationExecution(plan, { iteration: true }).deferredIntegrationChecks.includes(shell));
  });

  test('optional editor configuration does not select application or release checks', async () => {
    for (const file of ['.prettierrc.json', '.prettierignore', '.editorconfig', 'prettier.config.mjs']) {
      const plan = await createVerificationOwnershipPlan([file]);
      const execution = buildFocusedVerificationExecution(plan);
      assert.equal(plan.assignments[0]!.ownershipArea, 'optional editor formatting');
      assert.deepEqual(plan.focusedUnitChecks, []);
      assert.deepEqual(plan.focusedBrowserChecks, []);
      assert.deepEqual(execution.commands.map(command => command.id), ['diff-whitespace']);
      assert.deepEqual(execution.deferredSpecialisedChecks, ['staged-security']);
    }
    // Executable application, compiler and package configuration is not an
    // editor preference and must keep its independent verification boundaries.
    for (const file of ['package.json', 'tsconfig.json', 'frontend/vite.config.ts']) {
      const plan = buildVerificationOwnershipPlan([file]);
      assert.notEqual(plan.assignments[0]!.ownershipArea, 'optional editor formatting');
      assert.ok(buildFocusedVerificationExecution(plan).commands.length > 1);
    }
  });

  test('new frontend configuration inherits build verification without a filename registration', () => {
    const functional = readVerificationTestInventory().filter(isPlaywrightFunctionalSpec).sort();
    for (const file of ['frontend/vite.config.ts', 'frontend/new-build-helper.ts', 'frontend/static/example.svg']) {
      const plan = buildVerificationOwnershipPlan([file]);
      assert.equal(plan.assignments[0]!.ownershipArea, 'frontend build configuration and assets');
      assert.deepEqual(plan.focusedBrowserChecks, functional);
      assert.ok(plan.focusedUnitChecks.includes('test/frontend-build-integrity.test.mts'));
      assert.ok(plan.mandatorySpecialisedChecks.includes('browser-build'));
      assert.ok(plan.mandatorySpecialisedChecks.includes('browser-loading-report'));
    }
  });

  test('documentation-only plans do not acquire browser discovery or build work', () => {
    for (const document of ['CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', '.github/pull_request_template.md', '.github/ISSUE_TEMPLATE/question.md']) {
      const execution = buildFocusedVerificationExecution(buildVerificationOwnershipPlan([document]));
      assert.equal(execution.browserSpecs.length, 0, document);
      assert.equal(execution.commands.some(command => ['browser-discovery', 'build', 'workflow:check', 'typecheck'].includes(command.id)), false, document);
      assert.equal(execution.commands.some(command => command.args.includes('test/documentation-links.test.mts')), true, document);
    }
  });

  test('focused discovery includes both execution owners and rejects missing or unexpected specifications', () => {
    const specs = ['e2e/dashboard.spec.ts', 'e2e/console-loading.spec.ts'];
    assert.deepEqual(focusedBrowserLanes(specs), [
      { kind: 'performance', project: 'performance-measurement', specs: ['e2e/console-loading.spec.ts'] },
      { kind: 'functional', project: 'chromium', specs: ['e2e/dashboard.spec.ts'] },
    ]);
    assert.throws(() => focusedBrowserLanes([...specs, specs[0]!]), /unique/u);
    assert.throws(() => focusedBrowserLanes(['e2e/not-a-spec.ts']), /maintained/u);
    const execution = buildFocusedVerificationExecution({ ...buildVerificationOwnershipPlan(['e2e/dashboard.spec.ts']), focusedBrowserChecks: specs });
    const command = execution.commands[0]!;
    const run = spawnSync(command.executable, command.args, {
      cwd: REPOSITORY_ROOT, env: { ...environmentWithoutV8Coverage(), ...command.environment },
      encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
    });
    assert.ifError(run.error);
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const report = JSON.parse(run.stdout);
    assert.doesNotThrow(() => assertFocusedBrowserCoverage(specs, report));
    assert.throws(() => assertFocusedBrowserCoverage([...specs, 'e2e/missing.spec.ts'], report), /Missing: e2e\/missing/u);
    assert.throws(() => assertFocusedBrowserCoverage([specs[0]!], report), /unexpected: e2e\/console-loading/u);
    assert.throws(() => assertFocusedBrowserCoverage(specs, { suites: [] }), /Missing:/u);
  });

  test('workflow edits run the native workflow validator once without deferring syntax validation', () => {
    const execution = buildFocusedVerificationExecution(buildVerificationOwnershipPlan(['.github/workflows/ci.yml']));
    assert.equal(execution.commands.filter(command => command.id === 'workflow:check').length, 1);
    assert.equal(execution.deferredSpecialisedChecks.includes('workflow-closure'), false);
  });

  test('binds lowercase workflow facades and shared browser storage to their dedicated suites', () => {
    const plan = buildVerificationOwnershipPlan([
      'frontend/src/lib/cases.ts',
      'frontend/src/lib/campaigns.ts',
      'frontend/src/lib/watchlists.ts',
      'frontend/src/lib/scheduled-monitoring.ts',
      'frontend/src/lib/browser-local-data.ts',
      'frontend/src/lib/browser-local-data-service.ts',
    ]);
    const byPath = new Map(plan.assignments.map((assignment) => [assignment.changedPath, assignment]));

    const cases = byPath.get('frontend/src/lib/cases.ts')!;
    assert.ok(cases.impactAreas.includes('Case analyst workflow'));
    assert.ok(cases.focusedUnitChecks.includes('test/case-model.test.mts'));
    assert.ok(cases.focusedBrowserChecks.includes('e2e/cases.spec.ts'));
    assert.ok(cases.focusedBrowserChecks.includes('e2e/case-brand-association.spec.ts'));

    const campaigns = byPath.get('frontend/src/lib/campaigns.ts')!;
    assert.ok(campaigns.impactAreas.includes('Brand and campaign analyst workflow'));
    assert.ok(campaigns.focusedUnitChecks.includes('test/campaign-model.test.mts'));
    assert.ok(campaigns.focusedBrowserChecks.includes('e2e/brand-asset-register.spec.ts'));
    assert.ok(campaigns.focusedBrowserChecks.includes('e2e/case-brand-association.spec.ts'));
    assert.ok(campaigns.focusedBrowserChecks.includes('e2e/parent-domain-campaign-scope.spec.ts'));

    for (const owner of ['frontend/src/lib/watchlists.ts', 'frontend/src/lib/scheduled-monitoring.ts']) {
      const assignment = byPath.get(owner)!;
      assert.ok(assignment.impactAreas.includes('Monitoring analyst workflow'));
      assert.ok(assignment.focusedUnitChecks.includes('test/watchlist-store.test.mts'));
      assert.ok(assignment.focusedBrowserChecks.includes('e2e/hosted-monitoring.spec.ts'));
    }

    for (const owner of ['frontend/src/lib/browser-local-data.ts', 'frontend/src/lib/browser-local-data-service.ts']) {
      const assignment = byPath.get(owner)!;
      assert.ok(assignment.impactAreas.includes('browser-local persistence and migration behaviour'));
      assert.ok(assignment.focusedUnitChecks.includes('test/browser-local-data-provider.test.mts'));
      assert.ok(assignment.focusedBrowserChecks.includes('e2e/local-data-platform.spec.ts'));
      assert.ok(assignment.mandatorySpecialisedChecks.includes('privacy-catalogue'));
      assert.ok(assignment.mandatorySpecialisedChecks.includes('schema-inventory'));
    }
  });

  test('runs a real production build, loading report and recovery check for build-boundary tooling', () => {
    const ownership = buildVerificationOwnershipPlan(['tools/frontend-build-integrity.mts']);
    const execution = buildFocusedVerificationExecution(ownership);
    const ids = execution.commands.map((command) => command.id);
    const build = ids.indexOf('build');
    const loading = ids.indexOf('frontend:loading-report');

    assert.ok(build >= 0);
    assert.ok(loading > build);
    assert.equal(ids.filter((id) => id === 'build').length, 1);
    assert.equal(execution.cleanupBrowserArtifacts, true);
    assert.deepEqual(execution.browserSpecs, ['e2e/deferred-recovery.spec.ts']);
  });

  test('closes application-version changes over derived fixtures, documentation, and release gates', () => {
    const ownership = buildVerificationOwnershipPlan(['package.json', 'package-lock.json']);
    const execution = buildFocusedVerificationExecution(ownership);
    const unitChecks = new Set(ownership.focusedUnitChecks);
    const commandIds = new Set(execution.commands.map((command) => command.id));

    for (const testFile of [
      'test/release-version-check.test.mts',
      'test/case-portability-lifecycle.test.mts',
      'test/case-supported-contract-baseline.test.mts',
      'test/case-contract-doc.test.mts',
      'test/documentation-contract.test.mts',
      'test/cli-package.test.mts',
    ]) {
      assert.equal(unitChecks.has(testFile), true, `${testFile} must own application-version changes`);
    }
    for (const command of [
      'release:check',
      'schema:inventory',
      'cli:package:check',
      'licenses:check',
      'dependencies:audit',
    ]) {
      assert.equal(commandIds.has(command), true, `${command} must own application-version changes`);
    }
    assert.equal(ownership.mandatorySpecialisedChecks.includes('documentation'), true);
    assert.equal(ownership.userFacingBrowserRequired, false);
  });

  test('retains delivery-only security checks outside dirty-tree verification', () => {
    const ownership = buildVerificationOwnershipPlan(['lib/safe-fetch.mts']);
    const execution = buildFocusedVerificationExecution(ownership);
    assert.deepEqual(execution.deferredSpecialisedChecks, ['staged-security']);
    assert.ok(execution.commands.some((command) => command.id === 'test:mutation'));
  });

  test('accepts automatic or explicit focused paths and rejects ambiguous options', () => {
    assert.deepEqual(parseFocusedVerificationOptions([]), { list: false, changed: true, paths: [] });
    assert.deepEqual(parseFocusedVerificationOptions(['--changed', '--list']), { list: true, changed: true, paths: [] });
    assert.deepEqual(parseFocusedVerificationOptions(['frontend/src/app.css']), {
      list: false,
      changed: false,
      paths: ['frontend/src/app.css'],
    });
    assert.throws(
      () => parseFocusedVerificationOptions(['--changed', 'frontend/src/app.css']),
      /Usage/u,
    );
    assert.throws(() => parseFocusedVerificationOptions(['--unknown']), /Usage/u);
    assert.deepEqual(parseFocusedVerificationOptions(['--iteration', '--list', '--since=HEAD~2']), {
      list: true, changed: true, iteration: true, paths: [], since: 'HEAD~2',
    });
    assert.throws(() => parseFocusedVerificationOptions(['--iteration', '--iteration']), /Usage/u);
    assert.deepEqual(parseFocusedVerificationOptions(['--since=HEAD~2', '--list']), {
      list: true, changed: true, paths: [], since: 'HEAD~2',
    });
    for (const args of [['--since='], ['--since=HEAD', '--changed'], ['--since=HEAD', 'README.md'], ['--since=HEAD', '--since=HEAD~1'], ['--since=--help']]) {
      assert.throws(() => parseFocusedVerificationOptions(args), /Usage/u);
    }
  });

  test('accepts an optional path separator without interpreting following paths as options', () => {
    const paths = ['cli/doctor.mts', 'frontend/src/routes/(console)/lookup/+page.svelte'];
    const options = ['--list', '--iteration'];
    assert.deepEqual(parseFocusedVerificationOptions([...options, '--', ...paths]), {
      list: true, changed: false, iteration: true, paths,
    });
    assert.deepEqual(
      parseFocusedVerificationOptions([...options, ...paths]),
      parseFocusedVerificationOptions([...options, '--', ...paths]),
    );
    assert.deepEqual(parseFocusedVerificationOptions(['--']), parseFocusedVerificationOptions([]));
    for (const args of [
      ['--changed', '--', ...paths],
      ['--since=HEAD', '--', ...paths],
      ['--', '--list'],
      ['--', '--iteration'],
      ['--', '--since=HEAD'],
      ['--', '--', ...paths],
    ]) {
      assert.throws(() => parseFocusedVerificationOptions(args), /Usage/u);
    }
  });

  test('a focused batch includes committed, staged, working and new files from its explicit baseline', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'whoisleuth-focused-history-'));
    const git = (...args: string[]) => {
      const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    try {
      git('init', '--quiet');
      git('config', 'user.name', 'Fixture Maintainer');
      git('config', 'user.email', 'maintainer@example.invalid');
      for (const file of ['committed.ts', 'staged.ts', 'working.ts', 'deleted.ts']) writeFileSync(path.join(directory, file), 'export const value = 1;\n');
      git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Initial fixture');
      const base = git('rev-parse', 'HEAD');
      writeFileSync(path.join(directory, 'committed.ts'), 'export const value = 2;\n');
      git('add', 'committed.ts'); git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Change fixture');
      writeFileSync(path.join(directory, 'staged.ts'), 'export const value = 2;\n'); git('add', 'staged.ts');
      writeFileSync(path.join(directory, 'working.ts'), 'export const value = 2;\n');
      writeFileSync(path.join(directory, 'new.ts'), 'export const value = 2;\n');
      rmSync(path.join(directory, 'deleted.ts'));
      assert.deepEqual(discoverFocusedVerificationPaths(base, directory), ['committed.ts', 'deleted.ts', 'new.ts', 'staged.ts', 'working.ts']);
      assert.deepEqual(discoverFocusedVerificationPaths('HEAD', directory), ['deleted.ts', 'new.ts', 'staged.ts', 'working.ts']);
      assert.throws(() => discoverFocusedVerificationPaths('absent-revision', directory), /Git changed-path discovery failed/u);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test('binds every declared analyst journey to enabled tests without claiming rendered outcomes', () => {
    const assurance = buildAnalystJourneyAssurance();
    assert.equal(assurance.journeyContractVersion, 1);
    assert.equal(assurance.mappedJourneys, assurance.declaredJourneys);
    assert.ok(assurance.playwrightTests >= assurance.declaredJourneys);
    assert.equal(assurance.execution, 'source_and_fixture_contract_audit');
    assert.equal(assurance.browserTestsExecuted, 0);
    assert.equal(
      assurance.balancedShardSpecifications,
      readVerificationTestInventory().filter(isPlaywrightFunctionalSpec).length,
    );
    assert.equal(assurance.skippedJourneys, 0);
    assert.equal(assurance.retryAcceptance, false);
    assert.ok(assurance.jobs.Investigate.length > 0);
    assert.ok(assurance.jobs.Respond.length > 0);
    assert.ok(assurance.jobs.Assure.length > 0);
    assert.equal(assurance.assuranceVersion, 2);
    assert.ok(assurance.journeyMappings.every((item) => item.mobileOutcome === null && item.accessibilityOutcome === null && item.shards.length > 0));
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
    const helperBased = parseAnalystJourneySource('e2e/helper-journey.spec.ts', `
      import { test } from './fixtures';
      test('helper-driven journey', { tag: '@analyst-journey' }, async ({ page }) => {
        // test.skip() in a comment does not disable a real test.
        const explanation = 'testInfo.fixme() is only text';
        await checkNarrowLayoutAndKeyboard(page);
      });
    `);
    assert.equal(helperBased.length, 1);
    assert.equal(helperBased[0]?.disabled, false);
    for (const declaration of ['test.skip(true)', 'testInfo.fixme(true)']) {
      const conditionallyDisabled = parseAnalystJourneySource('e2e/conditional-journey.spec.ts', `
        import { test } from './fixtures';
        test('conditional journey', { tag: '@analyst-journey' }, async ({ page }) => { ${declaration}; });
      `);
      assert.equal(conditionallyDisabled[0]?.disabled, true);
    }
  });
});
