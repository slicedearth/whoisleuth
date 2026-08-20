import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { defineSchemaCompatibility } from '../packages/contracts/schema-compatibility.mts';
import { defineSchemaLifecycleFamily } from '../packages/contracts/schema-lifecycle.mts';

const COMPATIBILITY = defineSchemaCompatibility({
  id: 'test.extensible-document',
  kind: 'cli_document',
  schema: 'whoisleuth.test.extensible-document',
  currentVersion: 1,
  supportedVersions: [1],
  acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'reject',
  migration: 'exact_current_only',
  writeSemantics: 'normalized_rewrite',
  byteBudget: 1_024,
  owner: 'packages/contracts/test-extensible-document.mts',
  note: 'Synthetic lifecycle metadata used to verify bounded extension and discriminator vocabulary.',
});

function extensibleFamily() {
  return {
    id: 'test-extensible-document',
    owner: 'packages/contracts/test-extensible-document.mts',
    privacy: 'analyst_authored_sensitive' as const,
    compatibility: [COMPATIBILITY],
    contracts: [{
      compatibilityId: COMPATIBILITY.id,
      schema: COMPATIBILITY.schema!,
      version: 1,
      role: 'document' as const,
      lifecycle: 'current' as const,
      readable: true,
      emitted: true,
      exactKeys: false,
      extensionPolicy: 'preserve_bounded' as const,
      futureVersionBehaviour: 'reject' as const,
      migrationTarget: null,
      canonicalisation: null,
      byteBudget: 1_024,
      fixtureIds: ['test-extensible-document-v1'],
    }],
    fixtures: [{
      id: 'test-extensible-document-v1',
      path: 'test/fixtures/test-extensible-document-v1.json',
      bytes: 64,
      sha256: '0'.repeat(64),
      contentDigestSha256: null,
      schema: COMPATIBILITY.schema!,
      version: 1,
      role: 'current' as const,
      expectation: 'accepted_exact' as const,
      expectedOutputFixtureId: null,
      scope: 'repository' as const,
    }],
    metadata: {
      metadataVersion: 3 as const,
      enforcement: 'declarative_only' as const,
      shapes: [{
        id: 'test-extensible-document.shape.v1',
        schema: COMPATIBILITY.schema!,
        versions: [1],
        objects: [{
          path: '$',
          requiredKeys: ['schema', 'version', 'type'],
          optionalKeys: [],
          unknownKeys: 'preserve_bounded' as const,
        }],
        fixedArrays: [],
        normalisation: 'preserve_bounded_document' as const,
        target: null,
      }],
      boundProfiles: [{
        id: 'test-extensible-document.bounds.v1',
        bounds: [{
          id: 'serialised-bytes',
          path: '$',
          phase: 'serialised' as const,
          unit: 'bytes' as const,
          minimum: 1,
          maximum: 1_024,
          handling: 'reject' as const,
        }],
      }],
      hooks: [
        { id: 'test-extensible-document.build', role: 'builder' as const, runtime: 'cli' as const, module: 'cli/test-extensible-document.mts', exportName: 'buildTestDocument' },
        { id: 'test-extensible-document.read', role: 'normaliser' as const, runtime: 'cli' as const, module: 'cli/test-extensible-document.mts', exportName: 'readTestDocument' },
        { id: 'test-extensible-document.serialise', role: 'serialiser' as const, runtime: 'cli' as const, module: 'cli/test-extensible-document.mts', exportName: 'serialiseTestDocument' },
      ],
      serialisationProfiles: [{
        id: 'test-extensible-document.json.v1',
        schema: COMPATIBILITY.schema!,
        versions: [1],
        mediaType: 'application/json' as const,
        encoding: 'utf-8' as const,
        bom: false as const,
        indentSpaces: 2 as const,
        terminalLf: true as const,
        propertyOrder: 'source_insertion' as const,
        canonicalisation: null,
        integrity: 'none' as const,
        serializerHookId: 'test-extensible-document.serialise',
        verifierHookIds: [],
      }],
      privacyProfiles: [
        {
          id: 'test-extensible-document.collection.v1',
          classification: 'analyst_authored_sensitive' as const,
          projection: 'full_manifest' as const,
          includedCategories: ['target-identifiers'],
          excludedCategories: [],
          notePolicy: 'not_applicable' as const,
          retention: 'operator_controlled_output' as const,
          network: 'explicit_bounded_passive_fast_or_deep' as const,
          sharingReview: 'required' as const,
        },
        {
          id: 'test-extensible-document.offline.v1',
          classification: 'analyst_authored_sensitive' as const,
          projection: 'full_manifest' as const,
          includedCategories: ['target-identifiers'],
          excludedCategories: [],
          notePolicy: 'not_applicable' as const,
          retention: 'deliberate_local_file' as const,
          network: 'none' as const,
          sharingReview: 'required' as const,
        },
      ],
      expiryProfiles: [{
        id: 'test-extensible-document.expiry.v1',
        field: null,
        anchor: null,
        handling: 'not_applicable' as const,
        phase: 'not_applicable' as const,
        maximumLifetimeDays: null,
      }],
      consumerEdges: [
        {
          id: 'test-extensible-document.cli-build',
          plane: 'cli' as const,
          operation: 'collect-and-build',
          acceptedContracts: [],
          emittedContract: { schema: COMPATIBILITY.schema!, version: 1 },
          shapeIds: ['test-extensible-document.shape.v1'],
          boundProfileIds: ['test-extensible-document.bounds.v1'],
          hookIds: ['test-extensible-document.build', 'test-extensible-document.serialise'],
          serialisationProfileId: 'test-extensible-document.json.v1',
          privacyProfileId: 'test-extensible-document.collection.v1',
          expiryPolicyId: 'test-extensible-document.expiry.v1',
          requestMode: 'explicit_bounded_passive_fast_or_deep' as const,
          retentionEffect: 'operator_controlled_output' as const,
          bindingState: 'declared_unenforced' as const,
          policyState: 'current' as const,
        },
        {
          id: 'test-extensible-document.cli-domain-read',
          plane: 'cli' as const,
          operation: 'read-domain',
          acceptedContracts: [{
            schema: COMPATIBILITY.schema!,
            versions: [1],
            mode: 'direct' as const,
            discriminator: { path: '$.type', values: ['domain'] },
          }],
          emittedContract: null,
          shapeIds: ['test-extensible-document.shape.v1'],
          boundProfileIds: ['test-extensible-document.bounds.v1'],
          hookIds: ['test-extensible-document.read'],
          serialisationProfileId: null,
          privacyProfileId: 'test-extensible-document.offline.v1',
          expiryPolicyId: 'test-extensible-document.expiry.v1',
          requestMode: 'none' as const,
          retentionEffect: 'deliberate_local_file' as const,
          bindingState: 'declared_unenforced' as const,
          policyState: 'current' as const,
        },
      ],
      consumerRelationships: [],
    },
  };
}

describe('schema lifecycle metadata version 3', () => {
  test('preserves bounded extensions and discriminator-qualified consumers as detached frozen metadata', () => {
    const source = extensibleFamily();
    const family = defineSchemaLifecycleFamily(source);

    assert.equal(family.metadata.metadataVersion, 3);
    assert.equal(family.contracts[0]?.exactKeys, false);
    assert.equal(family.contracts[0]?.extensionPolicy, 'preserve_bounded');
    assert.equal(family.metadata.shapes[0]?.objects[0]?.unknownKeys, 'preserve_bounded');
    assert.equal(family.metadata.serialisationProfiles[0]?.propertyOrder, 'source_insertion');
    assert.deepEqual(
      family.metadata.consumerEdges[1]?.acceptedContracts[0]?.discriminator,
      { path: '$.type', values: ['domain'] },
    );
    assert.equal(Object.isFrozen(family.metadata.consumerEdges[1]?.acceptedContracts[0]?.discriminator), true);
    assert.equal(Object.isFrozen(family.metadata.consumerEdges[1]?.acceptedContracts[0]?.discriminator?.values), true);

    source.metadata.consumerEdges[1]!.acceptedContracts[0]!.discriminator!.values[0] = 'asn';
    assert.deepEqual(
      family.metadata.consumerEdges[1]?.acceptedContracts[0]?.discriminator?.values,
      ['domain'],
    );
  });

  test('canonicalises an omitted version 3 consumer discriminator to null', () => {
    const source = extensibleFamily() as any;
    delete source.metadata.consumerEdges[1].acceptedContracts[0].discriminator;

    const family = defineSchemaLifecycleFamily(source);

    assert.equal(
      family.metadata.consumerEdges[1]?.acceptedContracts[0]?.discriminator,
      null,
    );
    assert.equal(
      Object.hasOwn(family.metadata.consumerEdges[1]?.acceptedContracts[0] ?? {}, 'discriminator'),
      true,
    );
  });

  test('rejects bounded-extension contracts without version 3 metadata', () => {
    const source = extensibleFamily() as any;
    delete source.metadata;

    assert.throws(
      () => defineSchemaLifecycleFamily(source),
      /metadata version 3.*bounded extensions/iu,
    );
  });

  test('rejects contradictory extension, discriminator, request, and serialisation declarations', () => {
    const cases: Array<readonly [string, (value: any) => void]> = [
      ['exact keys', (value) => { value.contracts[0]!.exactKeys = true; }],
      ['extension policy', (value) => { value.contracts[0]!.extensionPolicy = 'reject'; }],
      ['shape policy', (value) => { value.metadata.shapes[0]!.objects[0]!.unknownKeys = 'reject'; }],
      ['normalisation', (value) => { value.metadata.shapes[0]!.normalisation = 'preserve_document'; }],
      ['discriminator path', (value) => { value.metadata.consumerEdges[1]!.acceptedContracts[0]!.discriminator!.path = '$.missing'; }],
      ['duplicate discriminator', (value) => { value.metadata.consumerEdges[1]!.acceptedContracts[0]!.discriminator!.values = ['domain', 'domain']; }],
      ['request policy', (value) => { value.metadata.consumerEdges[0]!.requestMode = 'none'; }],
      ['serialisation policy', (value) => { value.metadata.serialisationProfiles[0]!.propertyOrder = 'normalised_fixed'; }],
    ];
    for (const [label, mutate] of cases) {
      const value = extensibleFamily();
      mutate(value);
      assert.throws(() => defineSchemaLifecycleFamily(value), label);
    }
  });

  test('keeps the new vocabulary unavailable to older metadata versions', () => {
    const value = extensibleFamily() as any;
    value.metadata.metadataVersion = 2;
    for (const edge of value.metadata.consumerEdges) {
      for (const reference of edge.acceptedContracts) delete reference.discriminator;
    }
    assert.throws(
      () => defineSchemaLifecycleFamily(value),
      /version 3|bounded extensions/iu,
    );
  });
});
