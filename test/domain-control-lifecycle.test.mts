import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import {
  DOMAIN_CONTROL_MANIFEST_COMPATIBILITY,
  DOMAIN_CONTROL_MANIFEST_CANONICALIZATION_ROUTES,
  DOMAIN_CONTROL_MANIFEST_CURRENT_CANONICALIZATION,
  DOMAIN_CONTROL_MANIFEST_INPUT_COMPATIBILITY,
  DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
  DOMAIN_CONTROL_MANIFEST_INPUT_VERSION,
  DOMAIN_CONTROL_MANIFEST_SCHEMA,
  DOMAIN_CONTROL_MANIFEST_VERSION,
  DOMAIN_CONTROL_MANIFEST_READABLE_VERSIONS,
  DOMAIN_CONTROL_SCHEMA_LIFECYCLE,
  LEGACY_DOMAIN_CONTROL_MANIFEST_VERSION,
  MAX_DOMAIN_CONTROL_MANIFEST_BYTES,
} from '../packages/contracts/domain-control-manifest.mts';
import {
  defineSchemaLifecycleFamily,
  type SchemaLifecycleFamily,
} from '../packages/contracts/schema-lifecycle.mts';
import {
  buildDomainControlManifest,
  verifyDomainControlManifest,
} from '../lib/domain-control-manifest.mts';
import {
  canonicalArtifactJson,
  canonicalArtifactJsonV2,
  SORTED_JSON_V1,
} from '../packages/evidence/artifact-integrity.mts';
import {
  buildDomainControlPassport,
  verifyDomainControlPassport,
} from '../frontend/src/lib/analysis/domain-control-passport.ts';
import { DOMAIN_CONTROL_PASSPORT_VERSION } from '../frontend/src/lib/analysis/domain-control-manifest-core.ts';

const REPOSITORY_ROOT = new URL('../', import.meta.url);
const GENERATED_AT = '2026-08-03T00:00:00.000Z';

type MutableLifecycle = {
  id: string;
  owner: string;
  privacy: string;
  contracts: Array<Record<string, unknown>>;
  fixtures: Array<Record<string, unknown>>;
  compatibility: Array<Record<string, unknown>>;
};

function mutableLifecycle(): MutableLifecycle {
  return structuredClone(DOMAIN_CONTROL_SCHEMA_LIFECYCLE) as unknown as MutableLifecycle;
}

function assertRecursivelyFrozen(value: unknown, seen = new Set<object>()): void {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && 'value' in descriptor) assertRecursivelyFrozen(descriptor.value, seen);
  }
}

async function rawFixture(id: string): Promise<Readonly<{ raw: string; document: Record<string, unknown> }>> {
  const fixture = DOMAIN_CONTROL_SCHEMA_LIFECYCLE.fixtures.find((candidate) => candidate.id === id);
  assert.ok(fixture, `Lifecycle fixture is registered: ${id}`);
  const bytes = await readFile(new URL(fixture.path, REPOSITORY_ROOT));
  assert.equal(bytes.byteLength, fixture.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), fixture.sha256);
  assert.equal(bytes.at(-1), 0x0a);
  const raw = bytes.toString('utf8');
  return { raw, document: JSON.parse(raw) as Record<string, unknown> };
}

describe('domain-control schema lifecycle', () => {
  it('owns exact immutable input and document version histories', () => {
    assertRecursivelyFrozen(DOMAIN_CONTROL_SCHEMA_LIFECYCLE);
    assert.equal(DOMAIN_CONTROL_SCHEMA_LIFECYCLE.id, 'domain-control-manifest');
    assert.equal(DOMAIN_CONTROL_SCHEMA_LIFECYCLE.owner, 'packages/contracts/domain-control-manifest.mts');
    assert.equal(DOMAIN_CONTROL_SCHEMA_LIFECYCLE.privacy, 'analyst_authored_sensitive');
    assert.deepEqual(DOMAIN_CONTROL_MANIFEST_READABLE_VERSIONS, [
      LEGACY_DOMAIN_CONTROL_MANIFEST_VERSION,
      DOMAIN_CONTROL_MANIFEST_VERSION,
    ]);
    assert.deepEqual(DOMAIN_CONTROL_MANIFEST_CANONICALIZATION_ROUTES, [
      { version: LEGACY_DOMAIN_CONTROL_MANIFEST_VERSION, canonicalization: 'sorted-json-v1', explicit: true },
      { version: DOMAIN_CONTROL_MANIFEST_VERSION, canonicalization: 'sorted-json-v2', explicit: true },
    ]);
    assert.equal(DOMAIN_CONTROL_MANIFEST_CURRENT_CANONICALIZATION, 'sorted-json-v2');
    assert.ok(Object.isFrozen(DOMAIN_CONTROL_MANIFEST_READABLE_VERSIONS));
    assert.ok(Object.isFrozen(DOMAIN_CONTROL_MANIFEST_CANONICALIZATION_ROUTES));
    assert.deepEqual(DOMAIN_CONTROL_SCHEMA_LIFECYCLE.contracts, [
      {
        compatibilityId: DOMAIN_CONTROL_MANIFEST_INPUT_COMPATIBILITY.id,
        schema: DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
        version: DOMAIN_CONTROL_MANIFEST_INPUT_VERSION,
        role: 'input',
        lifecycle: 'current',
        readable: true,
        emitted: true,
        exactKeys: true,
        extensionPolicy: 'reject',
        futureVersionBehaviour: 'reject',
        migrationTarget: null,
        canonicalisation: null,
        byteBudget: MAX_DOMAIN_CONTROL_MANIFEST_BYTES,
        fixtureIds: ['domain-control-manifest-input-v1'],
      },
      {
        compatibilityId: DOMAIN_CONTROL_MANIFEST_COMPATIBILITY.id,
        schema: DOMAIN_CONTROL_MANIFEST_SCHEMA,
        version: LEGACY_DOMAIN_CONTROL_MANIFEST_VERSION,
        role: 'document',
        lifecycle: 'legacy',
        readable: true,
        emitted: false,
        exactKeys: true,
        extensionPolicy: 'reject',
        futureVersionBehaviour: 'reject',
        migrationTarget: null,
        canonicalisation: 'sorted-json-v1',
        byteBudget: MAX_DOMAIN_CONTROL_MANIFEST_BYTES,
        fixtureIds: ['domain-control-manifest-v1'],
      },
      {
        compatibilityId: DOMAIN_CONTROL_MANIFEST_COMPATIBILITY.id,
        schema: DOMAIN_CONTROL_MANIFEST_SCHEMA,
        version: DOMAIN_CONTROL_MANIFEST_VERSION,
        role: 'document',
        lifecycle: 'current',
        readable: true,
        emitted: true,
        exactKeys: true,
        extensionPolicy: 'reject',
        futureVersionBehaviour: 'reject',
        migrationTarget: null,
        canonicalisation: 'sorted-json-v2',
        byteBudget: MAX_DOMAIN_CONTROL_MANIFEST_BYTES,
        fixtureIds: ['domain-control-manifest-v2'],
      },
    ]);
    assert.equal(DOMAIN_CONTROL_MANIFEST_INPUT_VERSION, 1);
    assert.equal(DOMAIN_CONTROL_PASSPORT_VERSION, LEGACY_DOMAIN_CONTROL_MANIFEST_VERSION);
    assert.equal(DOMAIN_CONTROL_PASSPORT_VERSION, DOMAIN_CONTROL_MANIFEST_INPUT_VERSION);
    assert.deepEqual(DOMAIN_CONTROL_SCHEMA_LIFECYCLE.compatibility, [
      DOMAIN_CONTROL_MANIFEST_INPUT_COMPATIBILITY,
      DOMAIN_CONTROL_MANIFEST_COMPATIBILITY,
    ]);
  });

  it('pins the historical fixture to its unchanged aggregate source', async () => {
    const [{ raw: historicalRaw, document: historical }, aggregateBytes] = await Promise.all([
      rawFixture('domain-control-manifest-v1'),
      readFile(new URL('test/fixtures/artifact-integrity-v1.json', REPOSITORY_ROOT)),
    ]);
    const aggregate = JSON.parse(aggregateBytes.toString('utf8')) as {
      artifacts: { domainControl: Record<string, unknown> };
    };
    assert.deepEqual(historical, aggregate.artifacts.domainControl);
    assert.equal(historicalRaw, `${JSON.stringify(aggregate.artifacts.domainControl, null, 2)}\n`);
    assert.equal(verifyDomainControlManifest(historical).version, LEGACY_DOMAIN_CONTROL_MANIFEST_VERSION);
    assert.equal(
      (historical.integrity as Record<string, unknown>).digestSha256,
      DOMAIN_CONTROL_SCHEMA_LIFECYCLE.fixtures.find((fixture) => fixture.id === 'domain-control-manifest-v1')?.contentDigestSha256,
    );
  });

  it('produces the exact current fixture in both runtimes and reads both histories', async () => {
    const [{ document: input }, current, historical] = await Promise.all([
      rawFixture('domain-control-manifest-input-v1'),
      rawFixture('domain-control-manifest-v2'),
      rawFixture('domain-control-manifest-v1'),
    ]);
    const nodeManifest = buildDomainControlManifest(input, GENERATED_AT);
    const browserManifest = await buildDomainControlPassport(input, GENERATED_AT);
    const expectedRaw = `${JSON.stringify(nodeManifest, null, 2)}\n`;
    assert.equal(expectedRaw, current.raw);
    assert.deepEqual(browserManifest, nodeManifest);
    assert.equal(nodeManifest.version, DOMAIN_CONTROL_MANIFEST_VERSION);
    assert.equal(verifyDomainControlManifest(current.document).version, DOMAIN_CONTROL_MANIFEST_VERSION);
    assert.equal(verifyDomainControlManifest(historical.document).version, LEGACY_DOMAIN_CONTROL_MANIFEST_VERSION);
    assert.equal((await verifyDomainControlPassport(current.document, GENERATED_AT)).version, DOMAIN_CONTROL_MANIFEST_VERSION);
    assert.equal((await verifyDomainControlPassport(historical.document, GENERATED_AT)).version, LEGACY_DOMAIN_CONTROL_MANIFEST_VERSION);
    assert.equal(
      (current.document.integrity as Record<string, unknown>).digestSha256,
      DOMAIN_CONTROL_SCHEMA_LIFECYCLE.fixtures.find((fixture) => fixture.id === 'domain-control-manifest-v2')?.contentDigestSha256,
    );
    assert.equal(
      DOMAIN_CONTROL_SCHEMA_LIFECYCLE.fixtures.find((fixture) => fixture.id === 'domain-control-manifest-input-v1')?.contentDigestSha256,
      null,
    );
  });

  it('writes locale-independent order while preserving already signed v1 and v2 entry order', async () => {
    const input = {
      schema: DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
      version: DOMAIN_CONTROL_MANIFEST_INPUT_VERSION,
      expiresAt: '2026-09-03T00:00:00.000Z',
      entries: ['aa.example', 'ab.example', 'az.example', 'z.example'].map((domain) => ({ domain })),
    };
    const originalLocaleCompare = String.prototype.localeCompare;
    let manifest: ReturnType<typeof buildDomainControlManifest>;
    String.prototype.localeCompare = function forbiddenLocaleCompare(): never {
      throw new Error('Domain-control ordering must not consult localeCompare.');
    };
    try {
      manifest = buildDomainControlManifest(input, GENERATED_AT);
    } finally {
      String.prototype.localeCompare = originalLocaleCompare;
    }
    assert.deepEqual(manifest.entries.map((entry) => entry.domain), [
      'aa.example',
      'ab.example',
      'az.example',
      'z.example',
    ]);

    const { integrity, ...unsigned } = manifest;
    const suppliedOrder = Object.freeze({
      ...unsigned,
      entries: Object.freeze([...unsigned.entries].reverse()),
    });
    const signedSuppliedOrder = Object.freeze({
      ...suppliedOrder,
      integrity: Object.freeze({
        ...integrity,
        digestSha256: `sha256:${createHash('sha256').update(canonicalArtifactJsonV2(suppliedOrder)).digest('hex')}`,
      }),
    });
    assert.deepEqual(
      verifyDomainControlManifest(signedSuppliedOrder).entries.map((entry) => entry.domain),
      ['z.example', 'az.example', 'ab.example', 'aa.example'],
    );
    assert.deepEqual(
      (await verifyDomainControlPassport(signedSuppliedOrder, GENERATED_AT)).entries.map((entry) => entry.domain),
      ['z.example', 'az.example', 'ab.example', 'aa.example'],
    );

    const legacyUnsigned = Object.freeze({
      ...suppliedOrder,
      version: LEGACY_DOMAIN_CONTROL_MANIFEST_VERSION,
    });
    const signedLegacyOrder = Object.freeze({
      ...legacyUnsigned,
      integrity: Object.freeze({
        ...integrity,
        canonicalization: SORTED_JSON_V1,
        digestSha256: `sha256:${createHash('sha256').update(canonicalArtifactJson(legacyUnsigned)).digest('hex')}`,
      }),
    });
    assert.deepEqual(
      verifyDomainControlManifest(signedLegacyOrder).entries.map((entry) => entry.domain),
      ['z.example', 'az.example', 'ab.example', 'aa.example'],
    );
    assert.deepEqual(
      (await verifyDomainControlPassport(signedLegacyOrder, GENERATED_AT)).entries.map((entry) => entry.domain),
      ['z.example', 'az.example', 'ab.example', 'aa.example'],
    );
  });

  it('defensively copies metadata and rejects inconsistent lifecycle declarations', () => {
    const source = mutableLifecycle();
    const copied = defineSchemaLifecycleFamily(source as unknown as SchemaLifecycleFamily);
    source.id = 'changed-after-definition';
    source.contracts[0]!.schema = 'whoisleuth.changed-after-definition';
    assert.equal(copied.id, 'domain-control-manifest');
    assert.equal(copied.contracts[0]?.schema, DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA);
    assertRecursivelyFrozen(copied);

    const cases: Array<Readonly<{ label: string; mutate: (value: MutableLifecycle) => void }>> = [
      {
        label: 'duplicate schema/version',
        mutate(value) { value.contracts.push(structuredClone(value.contracts[2]!)); },
      },
      {
        label: 'multiple current versions',
        mutate(value) { value.contracts[1]!.lifecycle = 'current'; },
      },
      {
        label: 'emitted legacy version',
        mutate(value) { value.contracts[1]!.emitted = true; },
      },
      {
        label: 'cross-schema migration target',
        mutate(value) {
          value.contracts[1]!.migrationTarget = {
            schema: DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
            version: DOMAIN_CONTROL_MANIFEST_INPUT_VERSION,
          };
        },
      },
      {
        label: 'migration target under a read-only compatibility policy',
        mutate(value) {
          value.contracts[1]!.migrationTarget = {
            schema: DOMAIN_CONTROL_MANIFEST_SCHEMA,
            version: DOMAIN_CONTROL_MANIFEST_VERSION,
          };
        },
      },
      {
        label: 'normalising compatibility policy without a legacy migration target',
        mutate(value) { value.compatibility[1]!.migration = 'normalize_to_current'; },
      },
      {
        label: 'normalising compatibility policy without a legacy source',
        mutate(value) { value.compatibility[0]!.migration = 'normalize_to_current'; },
      },
      {
        label: 'exact-current compatibility policy with legacy support',
        mutate(value) { value.compatibility[1]!.migration = 'exact_current_only'; },
      },
      {
        label: 'exact-current compatibility policy with unversioned legacy support',
        mutate(value) { value.compatibility[0]!.acceptsUnversionedLegacy = true; },
      },
      {
        label: 'mismatched fixture version',
        mutate(value) { value.fixtures[0]!.version = 2; },
      },
      {
        label: 'mismatched fixture reference',
        mutate(value) { value.contracts[0]!.fixtureIds = ['domain-control-manifest-v2']; },
      },
      {
        label: 'normalisation target that is not current output',
        mutate(value) { value.fixtures[0]!.expectedOutputFixtureId = 'domain-control-manifest-v1'; },
      },
    ];
    for (const candidate of cases) {
      const value = mutableLifecycle();
      candidate.mutate(value);
      assert.throws(
        () => defineSchemaLifecycleFamily(value as unknown as SchemaLifecycleFamily),
        candidate.label,
      );
    }

    const normalising = mutableLifecycle();
    normalising.compatibility[1]!.migration = 'normalize_to_current';
    normalising.contracts[1]!.migrationTarget = {
      schema: DOMAIN_CONTROL_MANIFEST_SCHEMA,
      version: DOMAIN_CONTROL_MANIFEST_VERSION,
    };
    normalising.fixtures[1]!.expectation = 'normalises_to_current_output';
    normalising.fixtures[1]!.expectedOutputFixtureId = 'domain-control-manifest-v2';
    const normalisingCopy = defineSchemaLifecycleFamily(
      normalising as unknown as SchemaLifecycleFamily,
    );
    assert.deepEqual(normalisingCopy.contracts[1]?.migrationTarget, {
      schema: DOMAIN_CONTROL_MANIFEST_SCHEMA,
      version: DOMAIN_CONTROL_MANIFEST_VERSION,
    });

    const unprovenNormalising = structuredClone(normalising);
    unprovenNormalising.fixtures[1]!.expectation = 'accepted_exact';
    unprovenNormalising.fixtures[1]!.expectedOutputFixtureId = null;
    assert.throws(
      () => defineSchemaLifecycleFamily(unprovenNormalising as unknown as SchemaLifecycleFamily),
      /prove every declared normalisation with a fixture/iu,
    );

    const nonEmittedTarget = mutableLifecycle();
    nonEmittedTarget.contracts[2]!.emitted = false;
    assert.throws(
      () => defineSchemaLifecycleFamily(nonEmittedTarget as unknown as SchemaLifecycleFamily),
      /current document fixture/iu,
    );

    for (const ownerMutation of [
      (value: MutableLifecycle) => { value.owner = 'packages/contracts/other-owner.mts'; },
      (value: MutableLifecycle) => { value.compatibility[0]!.owner = 'packages/contracts/other-owner.mts'; },
    ]) {
      const divergentOwner = mutableLifecycle();
      ownerMutation(divergentOwner);
      assert.throws(
        () => defineSchemaLifecycleFamily(divergentOwner as unknown as SchemaLifecycleFamily),
        /does not match its contracts/iu,
      );
    }

    const unreferenced = mutableLifecycle();
    const extraFixture = structuredClone(unreferenced.fixtures[2]!);
    extraFixture.id = 'domain-control-manifest-v2-extra';
    extraFixture.path = 'test/fixtures/domain-control-manifest-v2-extra.json';
    unreferenced.fixtures.push(extraFixture);
    assert.throws(
      () => defineSchemaLifecycleFamily(unreferenced as unknown as SchemaLifecycleFamily),
      /Every schema lifecycle fixture must be referenced/iu,
    );

    const underBudget = mutableLifecycle();
    underBudget.contracts[0]!.byteBudget = 1;
    underBudget.compatibility[0]!.byteBudget = 1;
    assert.throws(
      () => defineSchemaLifecycleFamily(underBudget as unknown as SchemaLifecycleFamily),
      /fit within their contract byte budget/iu,
    );

    const reusedCompatibilityId = mutableLifecycle();
    reusedCompatibilityId.contracts[0]!.compatibilityId = DOMAIN_CONTROL_MANIFEST_COMPATIBILITY.id;
    assert.throws(
      () => defineSchemaLifecycleFamily(reusedCompatibilityId as unknown as SchemaLifecycleFamily),
      /one schema and role|does not match/iu,
    );

    const unknownFamilyField = { ...mutableLifecycle(), unsupported: true };
    assert.throws(() => defineSchemaLifecycleFamily(unknownFamilyField as unknown as SchemaLifecycleFamily), /exact registered fields/iu);

    const accessor = mutableLifecycle();
    Object.defineProperty(accessor.contracts[0], 'schema', {
      enumerable: true,
      get: () => DOMAIN_CONTROL_MANIFEST_INPUT_SCHEMA,
    });
    assert.throws(() => defineSchemaLifecycleFamily(accessor as unknown as SchemaLifecycleFamily), /ordinary enumerable data fields/iu);

    const sparse = mutableLifecycle();
    sparse.contracts.length += 1;
    assert.throws(() => defineSchemaLifecycleFamily(sparse as unknown as SchemaLifecycleFamily), /dense ordinary array/iu);

    const statefulLength = mutableLifecycle();
    const statefulLengthTarget = statefulLength.contracts;
    let lengthDescriptorReads = 0;
    let lengthValueReads = 0;
    statefulLength.contracts = new Proxy(statefulLengthTarget, {
      get(target, key, receiver) {
        if (key === 'length') {
          lengthValueReads += 1;
          return 1_000;
        }
        return Reflect.get(target, key, receiver);
      },
      getOwnPropertyDescriptor(target, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        if (key !== 'length' || !descriptor || !('value' in descriptor)) return descriptor;
        lengthDescriptorReads += 1;
        return {
          ...descriptor,
          value: lengthDescriptorReads === 1 ? descriptor.value : 1_000,
        };
      },
    });
    const statefulLengthCopy = defineSchemaLifecycleFamily(
      statefulLength as unknown as SchemaLifecycleFamily,
    );
    assert.equal(statefulLengthCopy.contracts.length, 3);
    assert.equal(lengthDescriptorReads, 1);
    assert.equal(lengthValueReads, 0);

    for (const collection of ['contracts', 'fixtures'] as const) {
      const accessorCollection = mutableLifecycle();
      let getterCalls = 0;
      Object.defineProperty(accessorCollection[collection], '0', {
        enumerable: true,
        get() {
          getterCalls += 1;
          return mutableLifecycle()[collection][0];
        },
      });
      assert.throws(
        () => defineSchemaLifecycleFamily(accessorCollection as unknown as SchemaLifecycleFamily),
        /ordinary enumerable data entries/iu,
      );
      assert.equal(getterCalls, 0);
    }

    const accessorFixtureIds = mutableLifecycle();
    const fixtureIds = accessorFixtureIds.contracts[0]!.fixtureIds as string[];
    let fixtureIdGetterCalls = 0;
    Object.defineProperty(fixtureIds, '0', {
      enumerable: true,
      get() {
        fixtureIdGetterCalls += 1;
        return 'domain-control-manifest-input-v1';
      },
    });
    assert.throws(
      () => defineSchemaLifecycleFamily(accessorFixtureIds as unknown as SchemaLifecycleFamily),
      /ordinary enumerable data entries/iu,
    );
    assert.equal(fixtureIdGetterCalls, 0);
  });
});
