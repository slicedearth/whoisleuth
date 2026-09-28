import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { SCHEMA_SOURCE_CLASSIFICATIONS } from '../fixtures/schema-source-classifications.mts';
import { SCHEMA_LIFECYCLE_REGISTRY } from '../packages/contracts/schema-lifecycle-registry.mts';
import { defineSchemaLifecycleRegistry, type SchemaLifecycleRegistry } from '../packages/contracts/schema-lifecycle.mts';
import { buildSchemaCompatibilityInventory } from '../tools/schema-compatibility.mts';
import { discoverSchemaSources, discoverSchemaIdentifiersInSource, validateSchemaSourceCoverage } from '../tools/schema-source-coverage.mts';
import { MAX_SCHEMA_LIFECYCLE_FIXTURE_BYTES, prepareSchemaLifecycleRepositorySnapshot, validatePreparedSchemaLifecycleRepository } from '../tools/schema-lifecycle-repository.mts';
import { createVerificationOwnershipPlan } from '../tools/verification-ownership.mts';
import { buildFocusedVerificationExecution } from '../tools/focused-verification.mts';
import { readVerificationTestInventory } from '../tools/verification-timing-profile.mts';

const NOW = '2026-08-16T00:00:00.000Z';
function cloneRegistry(): Array<Record<string, unknown>> {
  return structuredClone(SCHEMA_LIFECYCLE_REGISTRY) as unknown as Array<Record<string, unknown>>;
}
function firstFixture(registry: Array<Record<string, unknown>>): Record<string, unknown> {
  const fixtures = registry[0]?.fixtures as Array<Record<string, unknown>> | undefined;
  assert.ok(fixtures?.[0]);
  return fixtures[0];
}
function firstHook(registry: Array<Record<string, unknown>>): Record<string, unknown> {
  const metadata = registry[0]?.metadata as Record<string, unknown> | undefined;
  const hooks = metadata?.hooks as Array<Record<string, unknown>> | undefined;
  assert.ok(hooks?.[0]);
  return hooks[0];
}

// Capture once for this immutable run. Negative cases mutate copies, never the
// checkout or retained snapshot. Discovery belongs to integration, not unit setup.
describe('repository integration closure', () => {
  let discovery: Awaited<ReturnType<typeof discoverSchemaSources>>;
  before(async () => { discovery = await discoverSchemaSources(); });
  test('resolves real components, helpers, release metadata and fixtures from one repository snapshot', async () => {
    // One graph covers these independent expectations. Rebuilding the identical
    // repository for each changed path adds no integration coverage.
    const paths = ['frontend/src/lib/components/PublicGoalPaths.svelte', 'packages/comparison/favicon-similarity.mts',
      'package.json', 'test/support/current-case.mts', 'frontend/src/lib/components/CopyButton.svelte',
      'frontend/src/routes/(public)/demo/+page.svelte'];
    const plan = await createVerificationOwnershipPlan(paths);
    const assignments = new Map(plan.assignments.map(assignment => [assignment.changedPath, assignment]));
    assert.equal(assignments.size, paths.length);
    const component = assignments.get(paths[0]!)!;
    const helper = assignments.get(paths[1]!)!;
    const metadata = assignments.get(paths[2]!)!;
    const unitCount = readVerificationTestInventory().filter(file => file.startsWith('test/')).length;
    const fixture = assignments.get(paths[3]!)!;
    // Report all selection mismatches together. An early incidental assertion
    // must not hide later under-selection or unnecessary whole-suite fallbacks.
    assert.deepEqual({
      component: {
        guide: component.focusedBrowserChecks.includes('e2e/public-guide.spec.ts'),
        accessibility: component.focusedBrowserChecks.includes('e2e/accessibility.spec.ts'),
        bulk: component.focusedBrowserChecks.includes('e2e/bulk-analysis.spec.ts'),
        caseImport: component.focusedBrowserChecks.includes('e2e/case-import-workflows.spec.ts'),
        guideUnit: component.focusedUnitChecks.includes('test/public-guide.test.mts'),
        cliUnit: component.focusedUnitChecks.includes('test/cli.test.mts'),
      },
      helper: { consumer: helper.focusedUnitChecks.includes('test/utils.test.mts'), bounded: helper.focusedUnitChecks.length < unitCount },
      metadata: {
        catalogue: metadata.focusedUnitChecks.includes('test/public-product-catalogue.test.mts'),
        dashboard: metadata.focusedBrowserChecks.includes('e2e/dashboard.spec.ts'),
        bulk: metadata.focusedBrowserChecks.includes('e2e/bulk-analysis.spec.ts'),
        bounded: metadata.focusedUnitChecks.length < unitCount,
      },
      fixture: {
        unit: fixture.focusedUnitChecks.includes('test/current-case.test.mts'),
        review: fixture.focusedBrowserChecks.includes('e2e/review-session.spec.ts'),
        bulk: fixture.focusedBrowserChecks.includes('e2e/bulk-analysis.spec.ts'),
        browser: fixture.userFacingBrowserRequired,
      },
      compile: buildFocusedVerificationExecution(plan).commands.some(command => command.id === 'check'),
      first: buildFocusedVerificationExecution(plan).commands[0]!.id,
      leaf: assignments.get(paths[4]!)!.focusedBrowserChecks,
      demo: assignments.get(paths[5]!)!.focusedBrowserChecks.includes('e2e/demo.spec.ts'),
    }, {
      component: { guide: true, accessibility: true, bulk: false, caseImport: false, guideUnit: true, cliUnit: false },
      helper: { consumer: true, bounded: true },
      metadata: { catalogue: true, dashboard: true, bulk: false, bounded: true },
      fixture: { unit: true, review: true, bulk: false, browser: true },
      compile: true, first: 'browser-discovery', leaf: ['e2e/copy-button.component.spec.ts'], demo: true,
    });
  });

  test('accounts for every production schema-like identifier and canonical owner', async () => {
    const inventory = buildSchemaCompatibilityInventory({ generatedAt: NOW });
    const coverage = await validateSchemaSourceCoverage(inventory.entries, discovery);
    assert.ok(coverage.files > 700);
    assert.equal(coverage.identifiers, coverage.inventoriedIdentifiers + coverage.classifiedIdentifiers);
    assert.match(coverage.digestSha256, /^[a-f0-9]{64}$/u);
  });

  test('fails closed for missing coverage, stale ownership, dynamic construction, and duplicate definitions', async () => {
    const inventory = buildSchemaCompatibilityInventory({ generatedAt: NOW });
    const withoutThreatResult = inventory.entries.filter((entry) => entry.id !== 'derived.threat-intelligence-result');
    await assert.rejects(
      validateSchemaSourceCoverage(withoutThreatResult, discovery),
      /not inventoried or classified: whoisleuth\.threat-intelligence-result/iu,
    );

    const missingOwner = structuredClone(inventory.entries);
    const first = missingOwner[0];
    assert.ok(first);
    first.owner = 'lib/missing-schema-owner.mts';
    await assert.rejects(
      validateSchemaSourceCoverage(missingOwner, discovery),
      /owner .* is missing/iu,
    );

    await assert.rejects(
      validateSchemaSourceCoverage(inventory.entries, {
        ...discovery,
        dynamicConstructions: [
          ...discovery.dynamicConstructions,
          { file: 'lib/example.mts', line: 1, identifier: 'whoisleuth.lookup-progress', reason: 'dynamic' },
        ],
      }),
      /unsafe dynamic/iu,
    );

    const definition = discovery.definitions.find((item) => item.identifier === 'whoisleuth.lookup-progress');
    assert.ok(definition);
    await assert.rejects(
      validateSchemaSourceCoverage(inventory.entries, {
        ...discovery,
        definitions: [...discovery.definitions, { ...definition, file: 'lib/duplicate.mts', line: 1 }],
      }),
      /multiple definition owners/iu,
    );

    const runtimeUse = discovery.emitters.find((item) => (
      item.file === 'cli/archive-inspect.mts' && item.identifier === null && item.role === 'writer'
    ));
    assert.ok(runtimeUse);
    await validateSchemaSourceCoverage(inventory.entries, {
      ...discovery,
      emitters: discovery.emitters.filter((item) => item !== runtimeUse),
    });
    for (const copied of [
      { ...runtimeUse, file: 'lib/extracted-helper.mts' },
      { ...runtimeUse, role: 'reader' as const },
    ]) {
      await validateSchemaSourceCoverage(inventory.entries, {
        ...discovery, emitters: [...discovery.emitters, copied],
      });
    }
    for (const file of ['lib/extracted-helper.mts', 'tools/schema-compatibility.mts']) {
      const constructed = discoverSchemaIdentifiersInSource(
        "export const document = { schema: 'whoisleuth'.concat('.hidden') };", file);
      assert.ok(constructed.dynamicConstructions.length > 0);
      await assert.rejects(validateSchemaSourceCoverage(inventory.entries, {
        ...discovery, dynamicConstructions: [...discovery.dynamicConstructions, ...constructed.dynamicConstructions],
      }), /unsafe dynamic/iu);
    }

    await assert.rejects(
      validateSchemaSourceCoverage(inventory.entries, discovery, [
        ...SCHEMA_SOURCE_CLASSIFICATIONS.map((item) => item.identifier === 'whoisleuth.relationship-evidence'
          ? { ...item, relatedEntryIds: ['derived.missing-entry'] }
          : item),
      ]),
      /unknown compatibility entry/iu,
    );

    await assert.rejects(
      validateSchemaSourceCoverage(inventory.entries, discovery, [
        ...SCHEMA_SOURCE_CLASSIFICATIONS.map((item) => item.identifier === 'whoisleuth.relationship-evidence'
          ? { identifier: item.identifier, kind: 'non_schema', reason: item.reason, note: item.note }
          : item),
      ]),
      /inconsistent kind metadata/iu,
    );

    const sourceFilename = discovery.occurrences.find(item => item.identifier === 'whoisleuth.mts');
    assert.ok(sourceFilename);
    await validateSchemaSourceCoverage(inventory.entries, {
      ...discovery,
      occurrences: [...discovery.occurrences, { ...sourceFilename, file: 'tools/extracted-helper.mts', line: 1 }],
    });
    await assert.rejects(validateSchemaSourceCoverage(inventory.entries, {
      ...discovery,
      emitters: [...discovery.emitters, { file: 'tools/extracted-helper.mts', line: 1,
        role: 'writer', identifier: sourceFilename.identifier, symbol: null }],
    }), /cannot mask a schema emitter/iu);

    const localGeoIpOccurrence = discovery.occurrences.find((item) => item.identifier === 'whoisleuth.local-geoip-evidence');
    assert.ok(localGeoIpOccurrence);
    await validateSchemaSourceCoverage(inventory.entries, {
      ...discovery,
      occurrences: [
        ...discovery.occurrences,
        { ...localGeoIpOccurrence, file: 'lib/extracted-reference.mts', line: 1 },
      ],
    });

    await assert.rejects(
      validateSchemaSourceCoverage(inventory.entries, {
        ...discovery,
        occurrences: discovery.occurrences.filter((item) => item !== localGeoIpOccurrence),
      }),
      /classification owner .* does not declare/iu,
    );
  });

  test('verifies every registered fixture, hook and canonical definition in the checkout', async () => {
    const snapshot = await prepareSchemaLifecycleRepositorySnapshot(SCHEMA_LIFECYCLE_REGISTRY, discovery);
    assert.doesNotThrow(() => validatePreparedSchemaLifecycleRepository(SCHEMA_LIFECYCLE_REGISTRY, snapshot));
    assert.deepEqual(
      [...snapshot.hookModules.keys()].sort(),
      [...new Set(SCHEMA_LIFECYCLE_REGISTRY.flatMap((family) => (
        'metadata' in family ? family.metadata.hooks.map((hook) => hook.module) : []
      )))].sort(),
    );

    const missingFixture = cloneRegistry();
    firstFixture(missingFixture).path = 'test/fixtures/missing-schema-lifecycle-fixture.json';
    assert.throws(
      () => validatePreparedSchemaLifecycleRepository(missingFixture as unknown as SchemaLifecycleRegistry, snapshot),
      /fixture/u,
    );

    const wrongFixtureBytes = cloneRegistry();
    firstFixture(wrongFixtureBytes).bytes = Number(firstFixture(wrongFixtureBytes).bytes) + 1;
    assert.throws(
      () => validatePreparedSchemaLifecycleRepository(wrongFixtureBytes as unknown as SchemaLifecycleRegistry, snapshot),
      /fixture/u,
    );

    const wrongFixtureDigest = cloneRegistry();
    firstFixture(wrongFixtureDigest).sha256 = '0'.repeat(64);
    assert.throws(
      () => validatePreparedSchemaLifecycleRepository(wrongFixtureDigest as unknown as SchemaLifecycleRegistry, snapshot),
      /does not match its registered SHA-256/u,
    );

    const missingModule = cloneRegistry();
    firstHook(missingModule).module = 'lib/missing-lifecycle-hook.mts';
    assert.throws(
      () => validatePreparedSchemaLifecycleRepository(missingModule as unknown as SchemaLifecycleRegistry, snapshot),
      /hook module was not loaded from the canonical registry/u,
    );

    const missingExport = cloneRegistry();
    firstHook(missingExport).exportName = 'missingLifecycleHook';
    assert.throws(
      () => validatePreparedSchemaLifecycleRepository(missingExport as unknown as SchemaLifecycleRegistry, snapshot),
      /hook export is missing or is not callable/u,
    );

    const nonFunctionExport = cloneRegistry();
    firstHook(nonFunctionExport).module = 'lib/domain-control-manifest.mts';
    firstHook(nonFunctionExport).exportName = 'DOMAIN_CONTROL_MANIFEST_SCHEMA';
    assert.throws(
      () => validatePreparedSchemaLifecycleRepository(nonFunctionExport as unknown as SchemaLifecycleRegistry, snapshot),
      /hook export is missing or is not callable/u,
    );

    const oversizedFixtures = cloneRegistry();
    firstFixture(oversizedFixtures).path = 'test/fixtures/missing-schema-lifecycle-fixture.json';
    firstFixture(oversizedFixtures).bytes = MAX_SCHEMA_LIFECYCLE_FIXTURE_BYTES;
    assert.throws(
      () => validatePreparedSchemaLifecycleRepository(oversizedFixtures as unknown as SchemaLifecycleRegistry, snapshot),
      /fixtures exceed their aggregate byte ceiling/u,
    );

    const swappedOwners = cloneRegistry();
    const firstOwner = String(swappedOwners[0]?.owner);
    const secondOwner = String(swappedOwners[1]?.owner);
    swappedOwners[0]!.owner = secondOwner;
    swappedOwners[1]!.owner = firstOwner;
    for (const descriptor of swappedOwners[0]!.compatibility as Array<Record<string, unknown>>) {
      descriptor.owner = secondOwner;
    }
    for (const descriptor of swappedOwners[1]!.compatibility as Array<Record<string, unknown>>) {
      descriptor.owner = firstOwner;
    }
    const swappedRegistry = defineSchemaLifecycleRegistry(
      swappedOwners as unknown as SchemaLifecycleRegistry,
    );
    assert.throws(
      () => validatePreparedSchemaLifecycleRepository(swappedRegistry, snapshot),
      /runtime family owner does not match registry entry/u,
    );
  });
});
