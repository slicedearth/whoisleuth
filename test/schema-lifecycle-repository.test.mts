import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  defineSchemaLifecycleRegistry,
  type SchemaLifecycleRegistry,
} from '../packages/contracts/schema-lifecycle.mts';
import { SCHEMA_LIFECYCLE_REGISTRY } from '../packages/contracts/schema-lifecycle-registry.mts';
import {
  MAX_SCHEMA_LIFECYCLE_FIXTURE_BYTES,
  assertSchemaLifecycleFixtureDiscriminator,
  discoverSchemaLifecycleSourceBindings,
  validateSchemaLifecycleDefinitionCoverage,
  validateSchemaLifecycleRepository,
} from '../tools/schema-lifecycle-repository.mts';
import { discoverSchemaSources } from '../tools/schema-source-coverage.mts';

const LIFECYCLE_MODULE = Object.freeze({
  file: 'packages/contracts/schema-lifecycle.mts',
  source: 'export {}\n',
});

function familySource(exportName = 'FIXTURE_FAMILY', file = 'packages/contracts/fixture-family.mts') {
  return Object.freeze({
    file,
    source: `
      import { defineSchemaLifecycleFamily as defineFamily } from './schema-lifecycle.mts';
      export const ${exportName} = defineFamily({} as never);
    `,
  });
}

function registrySource(
  importName = 'FIXTURE_FAMILY',
  entries = 'registeredFamily',
  specifier = './fixture-family.mts',
) {
  return Object.freeze({
    file: 'packages/contracts/schema-lifecycle-registry.mts',
    source: `
      import { ${importName} as registeredFamily } from '${specifier}';
      import { defineSchemaLifecycleRegistry as defineRegistry } from './schema-lifecycle.mts';
      export const SCHEMA_LIFECYCLE_REGISTRY = defineRegistry([${entries}]);
    `,
  });
}

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

describe('schema lifecycle repository closure', () => {
  test('binds fixture content to its declared variant discriminator', () => {
    const detailed = '{"schema":"whoisleuth.test.report","version":3,"mode":"detailed"}\n';
    assert.doesNotThrow(() => assertSchemaLifecycleFixtureDiscriminator(
      detailed,
      Buffer.byteLength(detailed),
      '$.mode',
      'detailed',
      'Schema lifecycle test fixture',
    ));
    assert.throws(() => assertSchemaLifecycleFixtureDiscriminator(
      detailed,
      Buffer.byteLength(detailed),
      '$.mode',
      'summary',
      'Schema lifecycle test fixture',
    ), /does not match its registered lifecycle discriminator/u);
  });

  test('discovers aliased canonical family definitions and one static registry', () => {
    const bindings = discoverSchemaLifecycleSourceBindings([
      LIFECYCLE_MODULE,
      familySource(),
      registrySource(),
    ]);
    assert.deepEqual(bindings.definitions, [{
      owner: 'packages/contracts/fixture-family.mts',
      exportName: 'FIXTURE_FAMILY',
      line: 3,
    }]);
    assert.deepEqual(bindings.registryEntries, [{
      owner: 'packages/contracts/fixture-family.mts',
      exportName: 'FIXTURE_FAMILY',
      line: 4,
    }]);
    assert.doesNotThrow(() => validateSchemaLifecycleDefinitionCoverage(bindings));
  });

  test('rejects orphan, missing, duplicated, stale and re-exported definitions', () => {
    const valid = [LIFECYCLE_MODULE, familySource(), registrySource()];

    const orphanBindings = discoverSchemaLifecycleSourceBindings([
      ...valid,
      familySource('ORPHAN_FAMILY', 'packages/contracts/orphan-family.mts'),
    ]);
    assert.throws(
      () => validateSchemaLifecycleDefinitionCoverage(orphanBindings),
      /definition is not registered/u,
    );

    const duplicateEntryBindings = discoverSchemaLifecycleSourceBindings([
      LIFECYCLE_MODULE,
      familySource(),
      registrySource('FIXTURE_FAMILY', 'registeredFamily, registeredFamily'),
    ]);
    assert.throws(
      () => validateSchemaLifecycleDefinitionCoverage(duplicateEntryBindings),
      /registry entry is duplicated/u,
    );

    const staleExportBindings = discoverSchemaLifecycleSourceBindings([
      LIFECYCLE_MODULE,
      familySource('ACTUAL_FAMILY'),
      registrySource('STALE_FAMILY'),
    ]);
    assert.throws(
      () => validateSchemaLifecycleDefinitionCoverage(staleExportBindings),
      /has no canonical definition/u,
    );

    const duplicateDefinitionBindings = discoverSchemaLifecycleSourceBindings([
      LIFECYCLE_MODULE,
      Object.freeze({
        file: 'packages/contracts/fixture-family.mts',
        source: `
          import { defineSchemaLifecycleFamily as defineFamily } from './schema-lifecycle.mts';
          export const FIXTURE_FAMILY = defineFamily({} as never);
          export const FIXTURE_FAMILY = defineFamily({} as never);
        `,
      }),
      registrySource(),
    ]);
    assert.throws(
      () => validateSchemaLifecycleDefinitionCoverage(duplicateDefinitionBindings),
      /definition is duplicated/u,
    );

    const reExportBindings = discoverSchemaLifecycleSourceBindings([
      LIFECYCLE_MODULE,
      familySource(),
      Object.freeze({
        file: 'packages/contracts/re-export.mts',
        source: "export { FIXTURE_FAMILY } from './fixture-family.mts';\n",
      }),
      registrySource('FIXTURE_FAMILY', 'registeredFamily', './re-export.mts'),
    ]);
    assert.throws(
      () => validateSchemaLifecycleDefinitionCoverage(reExportBindings),
      /has no canonical definition/u,
    );
  });

  test('recognises factories only from the canonical lifecycle module', () => {
    assert.throws(
      () => discoverSchemaLifecycleSourceBindings([
        LIFECYCLE_MODULE,
        Object.freeze({
          file: 'packages/contracts/fake-schema-lifecycle.mts',
          source: 'export function defineSchemaLifecycleFamily(value: unknown) { return value; }\n',
        }),
        Object.freeze({
          file: 'packages/contracts/fixture-family.mts',
          source: `
            import { defineSchemaLifecycleFamily as defineFamily } from './fake-schema-lifecycle.mts';
            export const FIXTURE_FAMILY = defineFamily({});
          `,
        }),
        registrySource(),
      ]),
      /canonical lifecycle module/u,
    );

    assert.throws(
      () => discoverSchemaLifecycleSourceBindings([
        LIFECYCLE_MODULE,
        Object.freeze({
          file: 'packages/contracts/fixture-family.mts',
          source: `
            import { defineSchemaLifecycleFamily as defineFamily } from './schema-lifecycle.mts';
            const indirectFamily = defineFamily;
            export const FIXTURE_FAMILY = indirectFamily({});
          `,
        }),
        registrySource(),
      ]),
      /direct exported constants/u,
    );

    assert.throws(
      () => discoverSchemaLifecycleSourceBindings([
        LIFECYCLE_MODULE,
        familySource(),
        Object.freeze({
          file: 'packages/contracts/factory-re-export.mts',
          source: "export { defineSchemaLifecycleFamily as makeFamily } from './schema-lifecycle.mts';\n",
        }),
        registrySource(),
      ]),
      /must not be re-exported/u,
    );

    for (const source of [
      "export * from './schema-lifecycle.mts';\n",
      "export * as lifecycle from './schema-lifecycle.mts';\n",
    ]) {
      assert.throws(
        () => discoverSchemaLifecycleSourceBindings([
          LIFECYCLE_MODULE,
          familySource(),
          Object.freeze({ file: 'packages/contracts/factory-re-export.mts', source }),
          registrySource(),
        ]),
        /must not be re-exported/u,
      );
    }

    assert.throws(
      () => discoverSchemaLifecycleSourceBindings([
        LIFECYCLE_MODULE,
        familySource(),
        Object.freeze({
          file: 'packages/contracts/dynamic-family.mts',
          source: `
            const lifecycle = await import('./schema-lifecycle.mts');
            export const ORPHAN_FAMILY = lifecycle.defineSchemaLifecycleFamily({});
          `,
        }),
        registrySource(),
      ]),
      /must not be loaded dynamically/u,
    );

    for (const source of [
      `
        const lifecycle = await import(\`./schema-lifecycle.mts\`);
        export const ORPHAN_FAMILY = lifecycle[\`defineSchemaLifecycleFamily\`]({} as never);
      `,
      `
        const suffix = '-lifecycle.mts';
        const lifecycle = await import('./schema' + suffix);
        const member = 'defineSchemaLifecycle' + 'Family';
        export const ORPHAN_FAMILY = lifecycle[member]({} as never);
      `,
    ]) {
      assert.throws(
        () => discoverSchemaLifecycleSourceBindings([
          LIFECYCLE_MODULE,
          familySource(),
          Object.freeze({ file: 'packages/contracts/computed-dynamic-family.mts', source }),
          registrySource(),
        ]),
        /must not be loaded dynamically/u,
      );
    }

    const escapedOrphan = discoverSchemaLifecycleSourceBindings([
      LIFECYCLE_MODULE,
      familySource(),
      Object.freeze({
        file: 'packages/contracts/escaped-family.mts',
        source: `
          import { defineSchemaLifecycle\\u0046amily as defineEscaped } from './schema-lifecycle.mts';
          export const ESCAPED_FAMILY = defineEscaped({} as never);
        `,
      }),
      registrySource(),
    ]);
    assert.throws(
      () => validateSchemaLifecycleDefinitionCoverage(escapedOrphan),
      /definition is not registered/u,
    );

    assert.throws(
      () => discoverSchemaLifecycleSourceBindings([
        LIFECYCLE_MODULE,
        Object.freeze({
          file: 'packages/contracts/fixture-family.mts',
          source: `
            import { defineSchemaLifecycleFamily as defineFamily } from './schema-lifecycle.mts';
            export let FIXTURE_FAMILY = defineFamily({} as never);
          `,
        }),
        registrySource(),
      ]),
      /exported const declarations/u,
    );

    assert.throws(
      () => discoverSchemaLifecycleSourceBindings([
        LIFECYCLE_MODULE,
        familySource(),
        Object.freeze({
          file: 'packages/contracts/schema-lifecycle-registry.mts',
          source: `
            import { FIXTURE_FAMILY as registeredFamily } from './fixture-family.mts';
            import { defineSchemaLifecycleRegistry as defineRegistry } from './schema-lifecycle.mts';
            export let SCHEMA_LIFECYCLE_REGISTRY = defineRegistry([registeredFamily]);
          `,
        }),
      ]),
      /exported const declaration/u,
    );

    assert.throws(
      () => discoverSchemaLifecycleSourceBindings([
        LIFECYCLE_MODULE,
        familySource(),
        registrySource(),
        Object.freeze({ file: 'lib/hook.mts', source: 'export function run() {}\n' }),
        Object.freeze({ file: 'lib/wrong.mts', source: 'export function run() {}\n' }),
        Object.freeze({
          file: 'tools/schema-lifecycle-repository.mts',
          source: `
            import * as hookModule from '../lib/hook.mts';
            export const SCHEMA_LIFECYCLE_HOOK_MODULES = Object.freeze({
              'lib/wrong.mts': hookModule,
            } as const);
          `,
        }),
      ]),
      /path does not match its static import/u,
    );
  });

  test('copies a bounded ordinary source list without invoking accessors', () => {
    let getterCalls = 0;
    const accessor = [LIFECYCLE_MODULE, familySource(), registrySource()];
    Object.defineProperty(accessor, '1', {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls += 1;
        return familySource();
      },
    });
    assert.throws(
      () => discoverSchemaLifecycleSourceBindings(accessor),
      /ordinary enumerable data entries/u,
    );
    assert.equal(getterCalls, 0);

    const withExtra = [LIFECYCLE_MODULE, familySource(), registrySource()] as typeof accessor & {
      extra?: boolean;
    };
    withExtra.extra = true;
    assert.throws(
      () => discoverSchemaLifecycleSourceBindings(withExtra),
      /dense ordinary source list/u,
    );

    let proxyTraps = 0;
    const proxiedSources = new Proxy([LIFECYCLE_MODULE, familySource(), registrySource()], {
      getPrototypeOf(target) {
        proxyTraps += 1;
        return Reflect.getPrototypeOf(target);
      },
      ownKeys(target) {
        proxyTraps += 1;
        return Reflect.ownKeys(target);
      },
    });
    assert.throws(
      () => discoverSchemaLifecycleSourceBindings(proxiedSources),
      /ordinary source list/u,
    );
    assert.equal(proxyTraps, 0);

    const proxiedRecord = new Proxy(familySource(), {
      getPrototypeOf(target) {
        proxyTraps += 1;
        return Reflect.getPrototypeOf(target);
      },
      ownKeys(target) {
        proxyTraps += 1;
        return Reflect.ownKeys(target);
      },
    });
    assert.throws(
      () => discoverSchemaLifecycleSourceBindings([
        LIFECYCLE_MODULE,
        proxiedRecord,
        registrySource(),
      ]),
      /ordinary source record/u,
    );
    assert.equal(proxyTraps, 0);
  });

  test('verifies every registered fixture, hook and canonical definition in the checkout', async () => {
    const discovery = await discoverSchemaSources();
    await assert.doesNotReject(
      validateSchemaLifecycleRepository(SCHEMA_LIFECYCLE_REGISTRY, discovery),
    );

    const missingFixture = cloneRegistry();
    firstFixture(missingFixture).path = 'test/fixtures/missing-schema-lifecycle-fixture.json';
    await assert.rejects(
      validateSchemaLifecycleRepository(missingFixture as unknown as SchemaLifecycleRegistry, discovery),
      /fixture/u,
    );

    const wrongFixtureBytes = cloneRegistry();
    firstFixture(wrongFixtureBytes).bytes = Number(firstFixture(wrongFixtureBytes).bytes) + 1;
    await assert.rejects(
      validateSchemaLifecycleRepository(wrongFixtureBytes as unknown as SchemaLifecycleRegistry, discovery),
      /fixture/u,
    );

    const wrongFixtureDigest = cloneRegistry();
    firstFixture(wrongFixtureDigest).sha256 = '0'.repeat(64);
    await assert.rejects(
      validateSchemaLifecycleRepository(wrongFixtureDigest as unknown as SchemaLifecycleRegistry, discovery),
      /does not match its registered SHA-256/u,
    );

    const missingModule = cloneRegistry();
    firstHook(missingModule).module = 'lib/missing-lifecycle-hook.mts';
    await assert.rejects(
      validateSchemaLifecycleRepository(missingModule as unknown as SchemaLifecycleRegistry, discovery),
      /hook module is not statically bound/u,
    );

    const missingExport = cloneRegistry();
    firstHook(missingExport).exportName = 'missingLifecycleHook';
    await assert.rejects(
      validateSchemaLifecycleRepository(missingExport as unknown as SchemaLifecycleRegistry, discovery),
      /hook export is missing or is not callable/u,
    );

    const nonFunctionExport = cloneRegistry();
    firstHook(nonFunctionExport).module = 'lib/domain-control-manifest.mts';
    firstHook(nonFunctionExport).exportName = 'DOMAIN_CONTROL_MANIFEST_SCHEMA';
    await assert.rejects(
      validateSchemaLifecycleRepository(nonFunctionExport as unknown as SchemaLifecycleRegistry, discovery),
      /hook export is missing or is not callable/u,
    );

    const oversizedFixtures = cloneRegistry();
    firstFixture(oversizedFixtures).path = 'test/fixtures/missing-schema-lifecycle-fixture.json';
    firstFixture(oversizedFixtures).bytes = MAX_SCHEMA_LIFECYCLE_FIXTURE_BYTES;
    await assert.rejects(
      validateSchemaLifecycleRepository(oversizedFixtures as unknown as SchemaLifecycleRegistry, discovery),
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
    await assert.rejects(
      validateSchemaLifecycleRepository(swappedRegistry, discovery),
      /runtime family owner does not match registry entry/u,
    );
  });
});
