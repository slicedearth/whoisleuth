import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

import {
  defineSchemaLifecycleRegistry,
  type SchemaLifecycleRegistry,
} from '../packages/contracts/schema-lifecycle.mts';
import { SCHEMA_LIFECYCLE_REGISTRY } from '../packages/contracts/schema-lifecycle-registry.mts';
import {
  CASE_CONTRACT_OWNER,
  CASE_DOMAIN_COMPATIBILITY_FACADES,
  CASE_DOMAIN_RUNTIME_ADAPTERS,
} from '../packages/contracts/case-portability.mts';
import {
  WORKSPACE_CONTRACT_OWNER,
  WORKSPACE_DOMAIN_COMPATIBILITY_FACADES,
} from '../packages/contracts/workspace-portability.mts';
import {
  assertSchemaLifecycleFixtureDiscriminator,
  buildSchemaLifecycleCompatibilityMatrix,
  discoverSchemaLifecycleSourceBindings,
  validateCasePortabilitySourceSnapshot,
  validateWorkspacePortabilitySourceSnapshot,
  validateSchemaLifecycleDefinitionCoverage,
} from '../tools/schema-lifecycle-repository.mts';

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

async function casePortabilitySources() {
  const files = [...new Set([
    CASE_CONTRACT_OWNER,
    ...CASE_DOMAIN_COMPATIBILITY_FACADES.flatMap(([facade, owner]) => [facade, owner]),
    ...CASE_DOMAIN_RUNTIME_ADAPTERS,
  ])].sort();
  return Promise.all(files.map(async (file) => Object.freeze({
    file,
    source: await readFile(new URL(`../${file}`, import.meta.url), 'utf8'),
  })));
}

async function workspacePortabilitySources() {
  const files = [...new Set([
    WORKSPACE_CONTRACT_OWNER,
    ...WORKSPACE_DOMAIN_COMPATIBILITY_FACADES.flatMap(([facade, owner]) => [facade, owner]),
  ])].sort();
  return Promise.all(files.map(async (file) => Object.freeze({
    file,
    source: await readFile(new URL(`../${file}`, import.meta.url), 'utf8'),
  })));
}

describe('schema lifecycle repository closure', () => {
  test('generates the complete routine compatibility matrix from canonical metadata', () => {
    const matrix = buildSchemaLifecycleCompatibilityMatrix(SCHEMA_LIFECYCLE_REGISTRY);
    assert.equal(matrix.familyCount, SCHEMA_LIFECYCLE_REGISTRY.length);
    assert.equal(matrix.compatibilityCount, SCHEMA_LIFECYCLE_REGISTRY.reduce((sum, family) => sum + family.compatibility.length, 0));
    assert.equal(matrix.contractCount, SCHEMA_LIFECYCLE_REGISTRY.reduce((sum, family) => sum + family.contracts.length, 0));
    assert.equal(matrix.fixtureCount, SCHEMA_LIFECYCLE_REGISTRY.reduce((sum, family) => sum + family.fixtures.length, 0));
    assert.ok(matrix.families.every((family) => (
      family.fixtureEvidence.every((fixture) => fixture.bytes > 0 && /^[a-f0-9]{64}$/u.test(fixture.sha256))
      && family.compatibility.every((entry) => (
        entry.supportedVersions.at(-1) === entry.currentVersion
        && ['reader_writer', 'reader_only', 'output_only', 'retired'].includes(entry.disposition)
        && entry.migration.length > 0
        && entry.futureVersionBehaviour.length > 0
      ))
      && family.closure.shapes > 0
      && family.closure.boundProfiles > 0
      && family.closure.hooks > 0
      && family.closure.serialisationProfiles > 0
      && family.closure.privacyProfiles > 0
      && family.closure.consumerEdges > 0
    )));

    const declaredMigration = matrix.families.flatMap((family) => family.compatibility.map((compatibility) => ({
      familyId: family.id,
      compatibility,
    }))).find(({ compatibility }) => compatibility.migration === 'normalize_to_current' && compatibility.expectedOutputs.length > 0);
    assert.ok(declaredMigration);
    const missingOutput = cloneRegistry();
    const family = missingOutput.find((candidate) => candidate.id === declaredMigration.familyId);
    assert.ok(family);
    const fixture = (family.fixtures as Array<Record<string, unknown>>).find((candidate) => (
      candidate.id === declaredMigration.compatibility.expectedOutputs[0]?.inputFixtureId
    ));
    assert.ok(fixture);
    fixture.expectedOutputFixtureId = null;
    assert.throws(
      () => buildSchemaLifecycleCompatibilityMatrix(missingOutput as unknown as SchemaLifecycleRegistry),
      /migration output is missing/u,
    );

    const overbound = cloneRegistry();
    const firstFamily = overbound[0];
    assert.ok(firstFamily);
    const firstContract = (firstFamily.contracts as Array<Record<string, unknown>>)[0];
    assert.ok(firstContract);
    firstFamily.contracts = Array.from({ length: 513 }, () => structuredClone(firstContract));
    assert.throws(
      () => buildSchemaLifecycleCompatibilityMatrix(overbound as unknown as SchemaLifecycleRegistry),
      /aggregate bounds/u,
    );
  });

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

  test('closes canonical Case identities and exact compatibility facades', async () => {
    const sources = await casePortabilitySources();
    assert.doesNotThrow(() => validateCasePortabilitySourceSnapshot(sources));

    const [firstFacade] = CASE_DOMAIN_COMPATIBILITY_FACADES[0]!;
    const formatted = sources.map((source) => source.file === firstFacade
      ? Object.freeze({ ...source, source: `// A descriptive comment is not a runtime contract.\n;\n${source.source.replaceAll("'", '"')}\n` })
      : source);
    assert.doesNotThrow(() => validateCasePortabilitySourceSnapshot(formatted));
    const staleFacade = sources.map((source) => source.file === firstFacade
      ? Object.freeze({ ...source, source: `${source.source}\nexport const unrelated = true;\n` })
      : source);
    assert.throws(
      () => validateCasePortabilitySourceSnapshot(staleFacade),
      /compatibility facade is stale/u,
    );

    assert.doesNotThrow(
      () => validateCasePortabilitySourceSnapshot([
        ...sources,
        Object.freeze({
          file: 'frontend/src/lib/analysis/case-review-helper.mts',
          source: "export * from './case-model.ts';\n",
        }),
      ]),
      'An internal forwarding helper does not need a compatibility-register entry.',
    );

    assert.throws(
      () => validateCasePortabilitySourceSnapshot([
        ...sources,
        Object.freeze({
          file: 'lib/duplicate-case-identity.mts',
          source: 'export const CASE_SCHEMA_VERSION = 13;\nexport const MAX_CASE_IMPORT_BYTES = 2097152;\n',
        }),
      ]),
      /constant is declared outside its canonical owner/u,
    );

    assert.throws(
      () => validateCasePortabilitySourceSnapshot([
        ...sources,
        Object.freeze({
          file: 'lib/duplicate-case-bound.mts',
          source: 'export const MAX_CASE_IMPORT_BYTES = 2097152;\n',
        }),
      ]),
      /constant is declared outside its canonical owner/u,
    );
  });

  test('closes canonical workspace identities and exact compatibility facades', async () => {
    const sources = await workspacePortabilitySources();
    assert.doesNotThrow(() => validateWorkspacePortabilitySourceSnapshot(sources));

    const [firstFacade, firstOwner] = WORKSPACE_DOMAIN_COMPATIBILITY_FACADES[0]!;
    const formatted = sources.map((source) => source.file === firstFacade
      ? Object.freeze({ ...source, source: `// Formatting does not change the forwarded module.\n${source.source.replaceAll("'", '"')}\n;` })
      : source);
    assert.doesNotThrow(() => validateWorkspacePortabilitySourceSnapshot(formatted));
    const staleFacade = sources.map((source) => source.file === firstFacade
      ? Object.freeze({ ...source, source: `${source.source}\nexport const unrelated = true;\n` })
      : source);
    assert.throws(
      () => validateWorkspacePortabilitySourceSnapshot(staleFacade),
      /compatibility facade is stale/u,
    );
    const original = sources.find((source) => source.file === firstFacade);
    assert.ok(original);
    for (const replacement of [
      original.source.replace('export *', 'export type *'),
      original.source.replace('export *', 'export * as nested'),
      original.source.replace('export *', 'export {}'),
      "export * from './another-owner.mts';",
      `${original.source.trim().replace(/;$/u, '')} with { type: 'json' };`,
      `${original.source}\nimport './side-effect.mts';`,
      'export * from',
    ]) {
      assert.throws(() => validateWorkspacePortabilitySourceSnapshot(sources.map((source) => source.file === firstFacade
        ? { ...source, source: replacement } : source)), /compatibility facade is stale/u);
    }

    const duplicateIdentity = sources.map((source) => source.file === firstOwner
      ? Object.freeze({ ...source, source: `${source.source}\nconst BRAND_PROFILE_SCHEMA_VERSION = 6;\n` })
      : source);
    assert.throws(
      () => validateWorkspacePortabilitySourceSnapshot(duplicateIdentity),
      /constant is declared outside its canonical owner/u,
    );
  });

});
