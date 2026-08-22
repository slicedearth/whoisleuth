import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CASE_PORTABILITY_LIFECYCLE_FAMILY } from '../packages/contracts/case-portability.mts';
import { ANALYST_INTERCHANGE_LIFECYCLE_FAMILY } from '../packages/contracts/analyst-interchange.mts';
import { CLI_LOOKUP_SCHEMA_LIFECYCLE } from '../packages/contracts/cli-lookup.mts';
import { DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA_LIFECYCLE } from '../packages/contracts/domain-control-flight-recorder.mts';
import { DOMAIN_CONTROL_SCHEMA_LIFECYCLE } from '../packages/contracts/domain-control-manifest.mts';
import { DOMAIN_CONTROL_MONITOR_SCHEMA_LIFECYCLE } from '../packages/contracts/domain-control-monitor.mts';
import { DOMAIN_CONTROL_REVIEW_SCHEMA_LIFECYCLE } from '../packages/contracts/domain-control-review.mts';
import { EXTERNAL_OBSERVATION_INTERCHANGE_LIFECYCLE_FAMILY } from '../packages/contracts/external-observation-interchange.mts';
import { INVESTIGATION_PORTABILITY_LIFECYCLE_FAMILY } from '../packages/contracts/investigation-portability.mts';
import { INVESTIGATION_PROJECTIONS_LIFECYCLE_FAMILY } from '../packages/contracts/investigation-projections.mts';
import { MONITORING_PORTABILITY_LIFECYCLE_FAMILY } from '../packages/contracts/monitoring-portability.mts';
import { OFFLINE_COMPARISON_LIFECYCLE_FAMILY } from '../packages/contracts/offline-comparison.mts';
import { PRIVACY_DATA_FLOW_CATALOGUE_LIFECYCLE_FAMILY } from '../packages/contracts/privacy-data-flow-catalogue.mts';
import { RELATIONSHIP_PORTABILITY_LIFECYCLE_FAMILY } from '../packages/contracts/relationship-portability.mts';
import { RISK_CALIBRATION_SCHEMA_LIFECYCLE } from '../packages/contracts/risk-calibration.mts';
import { TAB_PORTABILITY_LIFECYCLE_FAMILY } from '../packages/contracts/tab-portability.mts';
import { WORKSPACE_PORTABILITY_LIFECYCLE_FAMILY } from '../packages/contracts/workspace-portability.mts';
import {
  MAX_SCHEMA_LIFECYCLE_FAMILIES,
  defineSchemaLifecycleRegistry,
  type SchemaLifecycleFamily,
} from '../packages/contracts/schema-lifecycle.mts';
import { SCHEMA_LIFECYCLE_REGISTRY } from '../packages/contracts/schema-lifecycle-registry.mts';

function legacyCopy(): Record<string, unknown> {
  const family = structuredClone(DOMAIN_CONTROL_SCHEMA_LIFECYCLE) as Record<string, unknown>;
  delete family.metadata;
  return family;
}

function uniqueCompatibility(family: Record<string, unknown>, suffix: string): void {
  const compatibility = family.compatibility as Array<Record<string, unknown>>;
  const ids = new Map<string, string>();
  for (const descriptor of compatibility) {
    const oldId = String(descriptor.id);
    const newId = `${oldId}.${suffix}`;
    descriptor.id = newId;
    ids.set(oldId, newId);
  }
  for (const contract of family.contracts as Array<Record<string, unknown>>) {
    contract.compatibilityId = ids.get(String(contract.compatibilityId));
  }
}

function rewriteExactStrings(value: unknown, replacements: ReadonlyMap<string, string>): void {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const item = value[index];
      if (typeof item === 'string' && replacements.has(item)) value[index] = replacements.get(item);
      else rewriteExactStrings(item, replacements);
    }
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' && replacements.has(item)) {
      (value as Record<string, unknown>)[key] = replacements.get(item);
    } else rewriteExactStrings(item, replacements);
  }
}

function rewriteSchemas(family: Record<string, unknown>, suffix = ''): void {
  const schemas = new Map([
    ['whoisleuth.domain-control-manifest-input', `whoisleuth.fixture${suffix}-manifest-input`],
    ['whoisleuth.domain-control-manifest', `whoisleuth.fixture${suffix}-manifest`],
  ]);
  rewriteExactStrings(family, schemas);
}

function uniqueFixtures(family: Record<string, unknown>, suffix: string): void {
  const fixtureIds = new Map<string, string>();
  for (const fixture of family.fixtures as Array<Record<string, unknown>>) {
    const oldId = String(fixture.id);
    const newId = `${oldId}-${suffix}`;
    fixture.id = newId;
    fixture.path = String(fixture.path).replace(/\.json$/u, `-${suffix}.json`);
    fixtureIds.set(oldId, newId);
  }
  for (const contract of family.contracts as Array<Record<string, unknown>>) {
    contract.fixtureIds = (contract.fixtureIds as string[]).map((id) => fixtureIds.get(id));
  }
  for (const fixture of family.fixtures as Array<Record<string, unknown>>) {
    if (fixture.expectedOutputFixtureId !== null) {
      fixture.expectedOutputFixtureId = fixtureIds.get(String(fixture.expectedOutputFixtureId));
    }
  }
}

function uniqueMetadata(family: Record<string, unknown>, suffix: string): void {
  const metadata = family.metadata as Record<string, unknown>;
  const replacements = new Map<string, string>();
  for (const field of [
    'shapes',
    'boundProfiles',
    'hooks',
    'serialisationProfiles',
    'privacyProfiles',
    'expiryProfiles',
    'consumerEdges',
    'consumerRelationships',
  ]) {
    for (const item of metadata[field] as Array<Record<string, unknown>>) {
      const id = String(item.id);
      replacements.set(id, `${id}.${suffix}`);
    }
  }
  rewriteExactStrings(metadata, replacements);
}

function distinctFamily(suffix: string, includeMetadata = false): Record<string, unknown> {
  const family = structuredClone(DOMAIN_CONTROL_SCHEMA_LIFECYCLE) as Record<string, unknown>;
  if (!includeMetadata) delete family.metadata;
  family.id = `domain-control-manifest-${suffix}`;
  uniqueCompatibility(family, suffix);
  rewriteSchemas(family, `-${suffix}`);
  uniqueFixtures(family, suffix);
  if (includeMetadata) uniqueMetadata(family, suffix);
  return family;
}

function fixedLengthId(prefix: string, fill: string): string {
  return `${prefix}-${fill.repeat(Math.max(0, 76 - prefix.length - 1))}`;
}

function heavyFamily(index: number): Record<string, unknown> {
  const suffix = `h${String(index).padStart(2, '0')}`;
  const family = distinctFamily(suffix, true);
  const metadata = family.metadata as Record<string, unknown>;
  const privacyProfiles = metadata.privacyProfiles as Array<Record<string, unknown>>;
  for (let profileIndex = 0; profileIndex < privacyProfiles.length; profileIndex += 1) {
    const profile = privacyProfiles[profileIndex]!;
    profile.includedCategories = Array.from({ length: 64 }, (_, itemIndex) => fixedLengthId(
      `included-${suffix}-${profileIndex}-${itemIndex}`,
      'a',
    ));
    profile.excludedCategories = Array.from({ length: 64 }, (_, itemIndex) => fixedLengthId(
      `excluded-${suffix}-${profileIndex}-${itemIndex}`,
      'b',
    ));
  }
  const shapes = metadata.shapes as Array<Record<string, unknown>>;
  const documentShape = shapes.find((shape) => String(shape.id).startsWith('domain-control.manifest.v1-v2'));
  const fixedArrays = documentShape?.fixedArrays as Array<Record<string, unknown>> | undefined;
  assert.ok(fixedArrays?.[0]);
  fixedArrays[0].values = Array.from({ length: 64 }, (_, itemIndex) => {
    const prefix = `${suffix}-${String(itemIndex).padStart(2, '0')}-`;
    return `${prefix}${'c'.repeat(996 - prefix.length)}`;
  });
  return family;
}

describe('schema lifecycle registry', () => {
  it('owns a detached recursively frozen canonical family list', () => {
    const source = [
      structuredClone(CASE_PORTABILITY_LIFECYCLE_FAMILY),
      structuredClone(INVESTIGATION_PORTABILITY_LIFECYCLE_FAMILY),
      structuredClone(EXTERNAL_OBSERVATION_INTERCHANGE_LIFECYCLE_FAMILY),
      structuredClone(OFFLINE_COMPARISON_LIFECYCLE_FAMILY),
      structuredClone(DOMAIN_CONTROL_SCHEMA_LIFECYCLE),
      structuredClone(DOMAIN_CONTROL_REVIEW_SCHEMA_LIFECYCLE),
      structuredClone(DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA_LIFECYCLE),
      structuredClone(DOMAIN_CONTROL_MONITOR_SCHEMA_LIFECYCLE),
      structuredClone(CLI_LOOKUP_SCHEMA_LIFECYCLE),
      structuredClone(RISK_CALIBRATION_SCHEMA_LIFECYCLE),
      structuredClone(WORKSPACE_PORTABILITY_LIFECYCLE_FAMILY),
      structuredClone(TAB_PORTABILITY_LIFECYCLE_FAMILY),
      structuredClone(MONITORING_PORTABILITY_LIFECYCLE_FAMILY),
      structuredClone(INVESTIGATION_PROJECTIONS_LIFECYCLE_FAMILY),
      structuredClone(RELATIONSHIP_PORTABILITY_LIFECYCLE_FAMILY),
      structuredClone(ANALYST_INTERCHANGE_LIFECYCLE_FAMILY),
      structuredClone(PRIVACY_DATA_FLOW_CATALOGUE_LIFECYCLE_FAMILY),
    ];
    const registry = defineSchemaLifecycleRegistry(source as unknown as readonly SchemaLifecycleFamily[]);
    assert.deepEqual(registry, SCHEMA_LIFECYCLE_REGISTRY);
    assert.notEqual(registry[0], source[0]);
    assert.equal(Object.isFrozen(registry), true);
    assert.equal(Object.isFrozen(registry[0]), true);
    assert.equal(Object.isFrozen(registry[0]?.compatibility), true);
    (source as unknown as Array<Record<string, unknown>>)[0]!.id = 'changed-after-registration';
    assert.equal(registry[0]?.id, 'case-portability');
    assert.equal(registry[1]?.id, 'investigation-portability');
    assert.equal(registry[2]?.id, 'external-observation-interchange');
    assert.equal(registry[3]?.id, 'offline-comparison');
    assert.equal(registry[4]?.id, 'domain-control-manifest');
    assert.equal(registry[5]?.id, 'domain-control-review');
    assert.equal(registry[6]?.id, 'domain-control-flight-recorder');
    assert.equal(registry[7]?.id, 'domain-control-monitor');
    assert.equal(registry[8]?.id, 'cli-lookup');
    assert.equal(registry[9]?.id, 'risk-calibration');
    assert.equal(registry[10]?.id, 'workspace-portability');
    assert.equal(registry[11]?.id, 'tab-portability');
    assert.equal(registry[12]?.id, 'monitoring-portability');
    assert.equal(registry[13]?.id, 'investigation-projections');
    assert.equal(registry[14]?.id, 'relationship-portability');
    assert.equal(registry[15]?.id, 'analyst-interchange');
    assert.equal(registry[16]?.id, 'privacy-data-flow-catalogue');
    assert.equal(registry.length, 17);
    assert.equal(registry.flatMap((family) => family.contracts).length, 183);
    assert.equal(registry.flatMap((family) => family.compatibility).length, 84);
    assert.equal(registry.flatMap((family) => family.fixtures).length, 233);
  });

  it('rejects malformed registry arrays without invoking entries', () => {
    assert.throws(() => defineSchemaLifecycleRegistry([]), /bounded ordinary array/u);
    assert.throws(
      () => defineSchemaLifecycleRegistry(Array(MAX_SCHEMA_LIFECYCLE_FAMILIES + 1).fill(DOMAIN_CONTROL_SCHEMA_LIFECYCLE)),
      /bounded ordinary array/u,
    );
    const sparse = [DOMAIN_CONTROL_SCHEMA_LIFECYCLE];
    sparse.length = 2;
    assert.throws(() => defineSchemaLifecycleRegistry(sparse), /dense ordinary array/u);

    let getterCalls = 0;
    const accessor = [DOMAIN_CONTROL_SCHEMA_LIFECYCLE];
    Object.defineProperty(accessor, '0', {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls += 1;
        return DOMAIN_CONTROL_SCHEMA_LIFECYCLE;
      },
    });
    assert.throws(() => defineSchemaLifecycleRegistry(accessor), /ordinary enumerable data entries/u);
    assert.equal(getterCalls, 0);

    const revocable = Proxy.revocable([DOMAIN_CONTROL_SCHEMA_LIFECYCLE], {});
    revocable.revoke();
    assert.throws(() => defineSchemaLifecycleRegistry(revocable.proxy));
  });

  it('rejects cross-family ownership collisions', () => {
    assert.throws(
      () => defineSchemaLifecycleRegistry([DOMAIN_CONTROL_SCHEMA_LIFECYCLE, DOMAIN_CONTROL_SCHEMA_LIFECYCLE]),
      /family id is duplicated/u,
    );

    const duplicateCompatibility = legacyCopy();
    duplicateCompatibility.id = 'domain-control-manifest-copy';
    assert.throws(
      () => defineSchemaLifecycleRegistry([
        DOMAIN_CONTROL_SCHEMA_LIFECYCLE,
        duplicateCompatibility as unknown as SchemaLifecycleFamily,
      ]),
      /compatibility id is duplicated/u,
    );

    const duplicateSchema = legacyCopy();
    duplicateSchema.id = 'domain-control-manifest-copy';
    uniqueCompatibility(duplicateSchema, 'copy');
    assert.throws(
      () => defineSchemaLifecycleRegistry([
        DOMAIN_CONTROL_SCHEMA_LIFECYCLE,
        duplicateSchema as unknown as SchemaLifecycleFamily,
      ]),
      /multiple family owners/u,
    );

    const duplicateFixtureId = distinctFamily('fixture-id');
    const duplicateIdFixture = (duplicateFixtureId.fixtures as Array<Record<string, unknown>>)
      .find((fixture) => String(fixture.id).startsWith('domain-control-manifest-v1-'));
    assert.ok(duplicateIdFixture);
    const formerFixtureId = String(duplicateIdFixture.id);
    duplicateIdFixture.id = 'domain-control-manifest-v1';
    for (const contract of duplicateFixtureId.contracts as Array<Record<string, unknown>>) {
      contract.fixtureIds = (contract.fixtureIds as string[])
        .map((id) => id === formerFixtureId ? 'domain-control-manifest-v1' : id);
    }
    assert.throws(
      () => defineSchemaLifecycleRegistry([
        DOMAIN_CONTROL_SCHEMA_LIFECYCLE,
        duplicateFixtureId as unknown as SchemaLifecycleFamily,
      ]),
      /fixture id or path is duplicated/u,
    );

    const duplicateFixturePath = distinctFamily('fixture-path');
    const duplicatePathFixture = (duplicateFixturePath.fixtures as Array<Record<string, unknown>>)
      .find((fixture) => String(fixture.id).startsWith('domain-control-manifest-v1-'));
    assert.ok(duplicatePathFixture);
    duplicatePathFixture.path = 'test/fixtures/domain-control-manifest-v1.json';
    assert.throws(
      () => defineSchemaLifecycleRegistry([
        DOMAIN_CONTROL_SCHEMA_LIFECYCLE,
        duplicateFixturePath as unknown as SchemaLifecycleFamily,
      ]),
      /fixture id or path is duplicated/u,
    );

    const duplicateMetadataId = structuredClone(
      DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA_LIFECYCLE,
    ) as unknown as Record<string, unknown>;
    const metadata = duplicateMetadataId.metadata as Record<string, unknown>;
    const expiryProfiles = metadata.expiryProfiles as Array<Record<string, unknown>>;
    const formerExpiryId = String(expiryProfiles[0]?.id);
    expiryProfiles[0]!.id = 'domain-control-review.expiry-report.v1';
    for (const edge of metadata.consumerEdges as Array<Record<string, unknown>>) {
      if (edge.expiryPolicyId === formerExpiryId) {
        edge.expiryPolicyId = 'domain-control-review.expiry-report.v1';
      }
    }
    assert.throws(
      () => defineSchemaLifecycleRegistry([
        DOMAIN_CONTROL_REVIEW_SCHEMA_LIFECYCLE,
        duplicateMetadataId as unknown as SchemaLifecycleFamily,
      ]),
      /metadata id is duplicated/u,
    );
  });

  it('accepts a distinct six-key compatibility family alongside the metadata family', () => {
    const distinct = distinctFamily('second');
    const registry = defineSchemaLifecycleRegistry([
      DOMAIN_CONTROL_SCHEMA_LIFECYCLE,
      distinct as unknown as SchemaLifecycleFamily,
    ]);
    assert.equal(registry.length, 2);
    assert.equal(registry[1]?.id, 'domain-control-manifest-second');
    assert.equal(Object.hasOwn(registry[1]!, 'metadata'), false);
    assert.equal(Object.isFrozen(registry[1]), true);
  });

  it('resolves bounded cross-family consumer composition without weakening local contracts', () => {
    const source = distinctFamily('relationship-source', true);
    const target = distinctFamily('relationship-target', true);
    const sourceMetadata = source.metadata as Record<string, unknown>;
    const targetMetadata = target.metadata as Record<string, unknown>;
    const sourceConsumers = sourceMetadata.consumerEdges as Array<Record<string, unknown>>;
    const targetConsumers = targetMetadata.consumerEdges as Array<Record<string, unknown>>;
    assert.ok(sourceConsumers[0]);
    assert.ok(sourceConsumers[1]);
    assert.ok(targetConsumers[0]);
    const targetConsumerId = String(targetConsumers[0].id);
    const relationship = {
      id: 'registry-test.composes-consumer',
      sourceConsumerId: String(sourceConsumers[0].id),
      targetConsumerId,
      relationship: 'composes',
    };
    sourceMetadata.consumerRelationships = [relationship];

    const registry = defineSchemaLifecycleRegistry([
      source as unknown as SchemaLifecycleFamily,
      target as unknown as SchemaLifecycleFamily,
    ]);
    const copied = (registry[0] as Record<string, unknown>).metadata as Record<string, unknown>;
    assert.deepEqual(copied.consumerRelationships, [relationship]);
    assert.equal(Object.isFrozen(copied.consumerRelationships), true);
    relationship.targetConsumerId = 'changed-after-definition';
    assert.equal(
      ((copied.consumerRelationships as Array<Record<string, unknown>>)[0]?.targetConsumerId),
      targetConsumerId,
    );

    const invalidLocal = distinctFamily('relationship-local', true);
    const invalidLocalMetadata = invalidLocal.metadata as Record<string, unknown>;
    const invalidLocalConsumers = invalidLocalMetadata.consumerEdges as Array<Record<string, unknown>>;
    invalidLocalMetadata.consumerRelationships = [{
      id: 'registry-test.local-consumer',
      sourceConsumerId: String(invalidLocalConsumers[0]?.id),
      targetConsumerId: String(invalidLocalConsumers[1]?.id),
      relationship: 'composes',
    }];
    assert.throws(
      () => defineSchemaLifecycleRegistry([invalidLocal as unknown as SchemaLifecycleFamily]),
      /invalid local endpoints/u,
    );

    const missingSource = distinctFamily('relationship-source-missing', true);
    const missingSourceMetadata = missingSource.metadata as Record<string, unknown>;
    missingSourceMetadata.consumerRelationships = [{
      id: 'registry-test.missing-source',
      sourceConsumerId: 'registry-test.unregistered-source',
      targetConsumerId,
      relationship: 'composes',
    }];
    assert.throws(
      () => defineSchemaLifecycleRegistry([missingSource as unknown as SchemaLifecycleFamily]),
      /invalid local endpoints/u,
    );

    const duplicateTuple = distinctFamily('relationship-duplicate', true);
    const duplicateMetadata = duplicateTuple.metadata as Record<string, unknown>;
    const duplicateConsumers = duplicateMetadata.consumerEdges as Array<Record<string, unknown>>;
    duplicateMetadata.consumerRelationships = [
      {
        id: 'registry-test.duplicate-first',
        sourceConsumerId: String(duplicateConsumers[0]?.id),
        targetConsumerId,
        relationship: 'composes',
      },
      {
        id: 'registry-test.duplicate-second',
        sourceConsumerId: String(duplicateConsumers[0]?.id),
        targetConsumerId,
        relationship: 'composes',
      },
    ];
    assert.throws(
      () => defineSchemaLifecycleRegistry([duplicateTuple as unknown as SchemaLifecycleFamily]),
      /invalid local endpoints/u,
    );

    const collidingId = distinctFamily('relationship-collision', true);
    const collidingMetadata = collidingId.metadata as Record<string, unknown>;
    const collidingConsumers = collidingMetadata.consumerEdges as Array<Record<string, unknown>>;
    collidingMetadata.consumerRelationships = [{
      id: String(collidingConsumers[0]?.id),
      sourceConsumerId: String(collidingConsumers[0]?.id),
      targetConsumerId,
      relationship: 'composes',
    }];
    assert.throws(
      () => defineSchemaLifecycleRegistry([collidingId as unknown as SchemaLifecycleFamily]),
      /globally unique/u,
    );

    const accessorRelationship = distinctFamily('relationship-accessor', true);
    const accessorMetadata = accessorRelationship.metadata as Record<string, unknown>;
    const accessorConsumers = accessorMetadata.consumerEdges as Array<Record<string, unknown>>;
    let accessorCalls = 0;
    const accessor = {
      id: 'registry-test.accessor-relationship',
      sourceConsumerId: String(accessorConsumers[0]?.id),
      targetConsumerId,
      relationship: 'composes',
    };
    Object.defineProperty(accessor, 'targetConsumerId', {
      enumerable: true,
      get() {
        accessorCalls += 1;
        return targetConsumerId;
      },
    });
    accessorMetadata.consumerRelationships = [accessor];
    assert.throws(
      () => defineSchemaLifecycleRegistry([accessorRelationship as unknown as SchemaLifecycleFamily]),
      /ordinary enumerable data fields/u,
    );
    assert.equal(accessorCalls, 0);

    const excessiveRelationships = distinctFamily('relationship-excessive', true);
    const excessiveMetadata = excessiveRelationships.metadata as Record<string, unknown>;
    const excessiveConsumers = excessiveMetadata.consumerEdges as Array<Record<string, unknown>>;
    excessiveMetadata.consumerRelationships = Array.from({ length: 129 }, (_, index) => ({
      id: `registry-test.excessive-${index}`,
      sourceConsumerId: String(excessiveConsumers[0]?.id),
      targetConsumerId,
      relationship: 'composes',
    }));
    assert.throws(
      () => defineSchemaLifecycleRegistry([excessiveRelationships as unknown as SchemaLifecycleFamily]),
      /bounded ordinary array/u,
    );

    const missingTarget = distinctFamily('relationship-missing', true);
    const missingMetadata = missingTarget.metadata as Record<string, unknown>;
    const missingConsumers = missingMetadata.consumerEdges as Array<Record<string, unknown>>;
    missingMetadata.consumerRelationships = [{
      id: 'registry-test.missing-consumer',
      sourceConsumerId: String(missingConsumers[0]?.id),
      targetConsumerId: 'registry-test.unregistered-consumer',
      relationship: 'composes',
    }];
    assert.throws(
      () => defineSchemaLifecycleRegistry([missingTarget as unknown as SchemaLifecycleFamily]),
      /target consumer is not registered/u,
    );

    const incompatibleSource = distinctFamily('relationship-incompatible-source', true);
    const incompatibleTarget = distinctFamily('relationship-incompatible-target', true);
    const incompatibleSourceMetadata = incompatibleSource.metadata as Record<string, unknown>;
    const incompatibleTargetMetadata = incompatibleTarget.metadata as Record<string, unknown>;
    const incompatibleSourceConsumer = (incompatibleSourceMetadata.consumerEdges as Array<Record<string, unknown>>)[0]!;
    const incompatibleTargetConsumer = (incompatibleTargetMetadata.consumerEdges as Array<Record<string, unknown>>)[0]!;
    incompatibleSourceMetadata.consumerRelationships = [{
      id: 'registry-test.incompatible-policy',
      sourceConsumerId: String(incompatibleSourceConsumer.id),
      targetConsumerId: String(incompatibleTargetConsumer.id),
      relationship: 'composes',
    }];
    incompatibleTargetConsumer.policyState = 'target';
    assert.throws(
      () => defineSchemaLifecycleRegistry([
        incompatibleSource as unknown as SchemaLifecycleFamily,
        incompatibleTarget as unknown as SchemaLifecycleFamily,
      ]),
      /incompatible consumer policies/u,
    );

    const hookSource = distinctFamily('relationship-hook-source', true);
    const hookTarget = distinctFamily('relationship-hook-target', true);
    const hookSourceMetadata = hookSource.metadata as Record<string, unknown>;
    const hookTargetMetadata = hookTarget.metadata as Record<string, unknown>;
    const hookSourceConsumer = (hookSourceMetadata.consumerEdges as Array<Record<string, unknown>>)[0]!;
    const hookTargetConsumer = (hookTargetMetadata.consumerEdges as Array<Record<string, unknown>>)[0]!;
    hookSourceMetadata.consumerRelationships = [{
      id: 'registry-test.incompatible-hook',
      sourceConsumerId: String(hookSourceConsumer.id),
      targetConsumerId: String(hookTargetConsumer.id),
      relationship: 'composes',
    }];
    const targetHookIds = new Set(hookTargetConsumer.hookIds as string[]);
    for (const hook of hookTargetMetadata.hooks as Array<Record<string, unknown>>) {
      if (targetHookIds.has(String(hook.id))) hook.exportName = `${String(hook.exportName)}Changed`;
    }
    assert.throws(
      () => defineSchemaLifecycleRegistry([
        hookSource as unknown as SchemaLifecycleFamily,
        hookTarget as unknown as SchemaLifecycleFamily,
      ]),
      /share one exact hook target/u,
    );

    const hookRoleSource = distinctFamily('relationship-hook-role-source', true);
    const hookRoleTarget = distinctFamily('relationship-hook-role-target', true);
    const hookRoleSourceMetadata = hookRoleSource.metadata as Record<string, unknown>;
    const hookRoleTargetMetadata = hookRoleTarget.metadata as Record<string, unknown>;
    const hookRoleSourceConsumer = (hookRoleSourceMetadata.consumerEdges as Array<Record<string, unknown>>)[9]!;
    const hookRoleTargetConsumer = (hookRoleTargetMetadata.consumerEdges as Array<Record<string, unknown>>)[9]!;
    hookRoleSourceMetadata.consumerRelationships = [{
      id: 'registry-test.incompatible-hook-role',
      sourceConsumerId: String(hookRoleSourceConsumer.id),
      targetConsumerId: String(hookRoleTargetConsumer.id),
      relationship: 'composes',
    }];
    const roleTargetHookIds = new Set(hookRoleTargetConsumer.hookIds as string[]);
    for (const hook of hookRoleTargetMetadata.hooks as Array<Record<string, unknown>>) {
      if (roleTargetHookIds.has(String(hook.id))) hook.role = 'reviewer';
    }
    assert.throws(
      () => defineSchemaLifecycleRegistry([
        hookRoleSource as unknown as SchemaLifecycleFamily,
        hookRoleTarget as unknown as SchemaLifecycleFamily,
      ]),
      /share one exact hook target/u,
    );

    const hookRuntimeSource = distinctFamily('relationship-hook-runtime-source', true);
    const hookRuntimeTarget = distinctFamily('relationship-hook-runtime-target', true);
    const hookRuntimeSourceMetadata = hookRuntimeSource.metadata as Record<string, unknown>;
    const hookRuntimeTargetMetadata = hookRuntimeTarget.metadata as Record<string, unknown>;
    const hookRuntimeSourceConsumer = (hookRuntimeSourceMetadata.consumerEdges as Array<Record<string, unknown>>)[9]!;
    const hookRuntimeTargetConsumer = (hookRuntimeTargetMetadata.consumerEdges as Array<Record<string, unknown>>)[9]!;
    hookRuntimeSourceMetadata.consumerRelationships = [{
      id: 'registry-test.incompatible-hook-runtime',
      sourceConsumerId: String(hookRuntimeSourceConsumer.id),
      targetConsumerId: String(hookRuntimeTargetConsumer.id),
      relationship: 'composes',
    }];
    const runtimeTargetHookIds = new Set(hookRuntimeTargetConsumer.hookIds as string[]);
    for (const hook of hookRuntimeTargetMetadata.hooks as Array<Record<string, unknown>>) {
      if (runtimeTargetHookIds.has(String(hook.id))) hook.runtime = 'shared';
    }
    assert.throws(
      () => defineSchemaLifecycleRegistry([
        hookRuntimeSource as unknown as SchemaLifecycleFamily,
        hookRuntimeTarget as unknown as SchemaLifecycleFamily,
      ]),
      /share one exact hook target/u,
    );

    const cycleSource = distinctFamily('relationship-cycle-source', true);
    const cycleTarget = distinctFamily('relationship-cycle-target', true);
    const cycleSourceMetadata = cycleSource.metadata as Record<string, unknown>;
    const cycleTargetMetadata = cycleTarget.metadata as Record<string, unknown>;
    const cycleSourceConsumer = (cycleSourceMetadata.consumerEdges as Array<Record<string, unknown>>)[0]!;
    const cycleTargetConsumer = (cycleTargetMetadata.consumerEdges as Array<Record<string, unknown>>)[0]!;
    cycleSourceMetadata.consumerRelationships = [{
      id: 'registry-test.cycle-forward',
      sourceConsumerId: String(cycleSourceConsumer.id),
      targetConsumerId: String(cycleTargetConsumer.id),
      relationship: 'composes',
    }];
    cycleTargetMetadata.consumerRelationships = [{
      id: 'registry-test.cycle-reverse',
      sourceConsumerId: String(cycleTargetConsumer.id),
      targetConsumerId: String(cycleSourceConsumer.id),
      relationship: 'composes',
    }];
    assert.throws(
      () => defineSchemaLifecycleRegistry([
        cycleSource as unknown as SchemaLifecycleFamily,
        cycleTarget as unknown as SchemaLifecycleFamily,
      ]),
      /composition cycle/u,
    );
  });

  it('enforces the aggregate serialised registry budget before inspecting the untouched tail', () => {
    const families = Array.from({ length: 24 }, (_, index) => heavyFamily(index));
    assert.doesNotThrow(() => defineSchemaLifecycleRegistry(
      families.slice(0, 23) as unknown as readonly SchemaLifecycleFamily[],
    ));

    let tailTouches = 0;
    const tail = new Proxy(distinctFamily('tail', true), {
      getOwnPropertyDescriptor(target, property) {
        tailTouches += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      ownKeys(target) {
        tailTouches += 1;
        return Reflect.ownKeys(target);
      },
    });
    assert.throws(
      () => defineSchemaLifecycleRegistry([
        ...families,
        tail as unknown as SchemaLifecycleFamily,
      ] as unknown as readonly SchemaLifecycleFamily[]),
      /aggregate serialised byte budget/u,
    );
    assert.equal(tailTouches, 0);
  });
});
