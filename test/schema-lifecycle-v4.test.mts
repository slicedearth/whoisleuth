import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { defineSchemaCompatibility } from '../packages/contracts/schema-compatibility.mts';
import {
  defineSchemaLifecycleFamily,
  defineSchemaLifecycleRegistry,
} from '../packages/contracts/schema-lifecycle.mts';

const DATASET_SCHEMA = 'whoisleuth.test.projected-dataset';
const REPORT_SCHEMA = 'whoisleuth.test.variant-report';

const DATASET_COMPATIBILITY = defineSchemaCompatibility({
  id: 'test.projected-dataset',
  kind: 'cli_document',
  schema: DATASET_SCHEMA,
  currentVersion: 1,
  supportedVersions: [1],
  acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'reject',
  migration: 'exact_current_only',
  writeSemantics: 'normalized_rewrite',
  byteBudget: 1_024,
  owner: 'packages/contracts/test-schema-lifecycle-v4.mts',
  note: 'Synthetic projected dataset used to verify lifecycle metadata version 4.',
});

const REPORT_COMPATIBILITY = defineSchemaCompatibility({
  id: 'test.variant-report',
  kind: 'cli_document',
  schema: REPORT_SCHEMA,
  currentVersion: 3,
  supportedVersions: [1, 2, 3],
  acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'reject',
  migration: 'read_only',
  writeSemantics: 'read_only',
  byteBudget: null,
  owner: 'packages/contracts/test-schema-lifecycle-v4.mts',
  note: 'Synthetic retired and discriminated output history used to verify lifecycle metadata version 4.',
});

function familySource(): any {
  return {
    id: 'test-schema-lifecycle-v4',
    owner: 'packages/contracts/test-schema-lifecycle-v4.mts',
    privacy: 'analyst_authored_sensitive',
    compatibility: [DATASET_COMPATIBILITY, REPORT_COMPATIBILITY],
    contracts: [
      {
        compatibilityId: DATASET_COMPATIBILITY.id,
        schema: DATASET_SCHEMA,
        version: 1,
        role: 'document',
        lifecycle: 'current',
        readable: true,
        emitted: true,
        exactKeys: false,
        extensionPolicy: 'discard_bounded',
        futureVersionBehaviour: 'reject',
        migrationTarget: null,
        canonicalisation: null,
        byteBudget: 1_024,
        fixtureIds: ['test-projected-dataset-v1'],
      },
      ...[1, 2].map((version) => ({
        compatibilityId: REPORT_COMPATIBILITY.id,
        schema: REPORT_SCHEMA,
        version,
        role: 'document',
        lifecycle: 'retired',
        readable: false,
        emitted: false,
        exactKeys: true,
        extensionPolicy: 'reject',
        futureVersionBehaviour: 'not_applicable',
        migrationTarget: null,
        canonicalisation: null,
        byteBudget: null,
        fixtureIds: [`test-variant-report-v${version}`],
      })),
      {
        compatibilityId: REPORT_COMPATIBILITY.id,
        schema: REPORT_SCHEMA,
        version: 3,
        role: 'document',
        lifecycle: 'current',
        readable: true,
        emitted: true,
        exactKeys: true,
        extensionPolicy: 'reject',
        futureVersionBehaviour: 'reject',
        migrationTarget: null,
        canonicalisation: null,
        byteBudget: null,
        fixtureIds: ['test-variant-report-v3-detailed', 'test-variant-report-v3-summary'],
      },
    ],
    fixtures: [
      {
        id: 'test-projected-dataset-v1',
        path: 'test/fixtures/test-projected-dataset-v1.json',
        bytes: 64,
        sha256: '0'.repeat(64),
        contentDigestSha256: null,
        schema: DATASET_SCHEMA,
        version: 1,
        role: 'current',
        expectation: 'accepted_exact',
        expectedOutputFixtureId: null,
        scope: 'repository',
        shapeId: 'test.projected-dataset.v1',
      },
      ...[1, 2].map((version) => ({
        id: `test-variant-report-v${version}`,
        path: `test/fixtures/test-variant-report-v${version}.json`,
        bytes: 64,
        sha256: String(version).repeat(64),
        contentDigestSha256: null,
        schema: REPORT_SCHEMA,
        version,
        role: 'historical',
        expectation: 'historical_output_exact',
        expectedOutputFixtureId: null,
        scope: 'repository',
        shapeId: 'test.variant-report.v1-v2',
      })),
      ...(['detailed', 'summary'] as const).map((mode, index) => ({
        id: `test-variant-report-v3-${mode}`,
        path: `test/fixtures/test-variant-report-v3-${mode}.json`,
        bytes: 96,
        sha256: String(index + 3).repeat(64),
        contentDigestSha256: null,
        schema: REPORT_SCHEMA,
        version: 3,
        role: 'current',
        expectation: 'accepted_exact',
        expectedOutputFixtureId: null,
        scope: 'repository',
        shapeId: `test.variant-report.v3-${mode}`,
      })),
    ],
    metadata: {
      metadataVersion: 4,
      enforcement: 'declarative_only',
      shapes: [
        {
          id: 'test.projected-dataset.v1',
          schema: DATASET_SCHEMA,
          versions: [1],
          objects: [
            {
              path: '$',
              requiredKeys: ['schema', 'version', 'payload'],
              alternativeRequiredKeys: [],
              optionalKeys: [],
              unknownKeys: 'discard_bounded',
            },
            {
              path: '$.payload',
              requiredKeys: [],
              alternativeRequiredKeys: [{ keys: ['availability', 'state'], resolution: 'first_present' }],
              optionalKeys: ['observedAt'],
              unknownKeys: 'discard_bounded',
            },
          ],
          fixedArrays: [],
          normalisation: 'project_known_fields',
          target: null,
          discriminator: null,
        },
        {
          id: 'test.variant-report.v1-v2',
          schema: REPORT_SCHEMA,
          versions: [1, 2],
          objects: [{
            path: '$',
            requiredKeys: ['schema', 'version', 'records'],
            alternativeRequiredKeys: [],
            optionalKeys: [],
            unknownKeys: 'reject',
          }],
          fixedArrays: [],
          normalisation: 'preserve_document',
          target: null,
          discriminator: null,
        },
        ...(['detailed', 'summary'] as const).map((mode) => ({
          id: `test.variant-report.v3-${mode}`,
          schema: REPORT_SCHEMA,
          versions: [3],
          objects: [{
            path: '$',
            requiredKeys: ['schema', 'version', 'mode', mode === 'detailed' ? 'records' : 'privacy'],
            alternativeRequiredKeys: [],
            optionalKeys: [],
            unknownKeys: 'reject',
          }],
          fixedArrays: [],
          normalisation: 'preserve_document',
          target: null,
          discriminator: { path: '$.mode', value: mode },
        })),
      ],
      boundProfiles: [
        {
          id: 'test.projected-dataset.bounds.v1',
          bounds: [
            { id: 'raw-bytes', path: '$', phase: 'raw_intake', unit: 'bytes', minimum: 1, maximum: 1_024, handling: 'reject' },
            { id: 'serialised-bytes', path: '$', phase: 'serialised', unit: 'bytes', minimum: 1, maximum: 1_024, handling: 'reject' },
          ],
        },
        {
          id: 'test.variant-report.detailed-bounds.v3',
          bounds: [{ id: 'records', path: 'records', phase: 'normalised', unit: 'entries', minimum: 1, maximum: 100, handling: 'reject' }],
        },
        {
          id: 'test.variant-report.summary-bounds.v3',
          bounds: [{ id: 'serialised-bytes', path: '$', phase: 'serialised', unit: 'bytes', minimum: 1, maximum: 512, handling: 'reject' }],
        },
      ],
      hooks: [
        { id: 'test.projected-dataset.build', role: 'builder', runtime: 'cli', module: 'cli/test-projected-dataset.mts', exportName: 'buildProjectedDataset' },
        { id: 'test.projected-dataset.read', role: 'normaliser', runtime: 'cli', module: 'cli/test-projected-dataset.mts', exportName: 'readProjectedDataset' },
        { id: 'test.projected-dataset.serialise', role: 'serialiser', runtime: 'cli', module: 'cli/test-projected-dataset.mts', exportName: 'serialiseProjectedDataset' },
        { id: 'test.variant-report.build-detailed', role: 'builder', runtime: 'cli', module: 'cli/test-variant-report.mts', exportName: 'buildDetailedReport' },
        { id: 'test.variant-report.build-summary', role: 'builder', runtime: 'cli', module: 'cli/test-variant-report.mts', exportName: 'buildSummaryReport' },
        { id: 'test.variant-report.read-summary', role: 'normaliser', runtime: 'cli', module: 'cli/test-variant-report.mts', exportName: 'readSummaryReport' },
        { id: 'test.variant-report.serialise', role: 'serialiser', runtime: 'cli', module: 'cli/test-variant-report.mts', exportName: 'serialiseReport' },
      ],
      serialisationProfiles: [
        {
          id: 'test.projected-dataset.json.v1',
          schema: DATASET_SCHEMA,
          versions: [1],
          mediaType: 'application/json',
          encoding: 'utf-8',
          bom: false,
          indentSpaces: 2,
          terminalLf: true,
          propertyOrder: 'normalised_fixed',
          canonicalisation: null,
          integrity: 'none',
          serializerHookId: 'test.projected-dataset.serialise',
          verifierHookIds: [],
        },
        {
          id: 'test.variant-report.json.v3',
          schema: REPORT_SCHEMA,
          versions: [3],
          mediaType: 'application/json',
          encoding: 'utf-8',
          bom: false,
          indentSpaces: 2,
          terminalLf: true,
          propertyOrder: 'normalised_fixed',
          canonicalisation: null,
          integrity: 'none',
          serializerHookId: 'test.variant-report.serialise',
          verifierHookIds: [],
        },
      ],
      privacyProfiles: [
        {
          id: 'test.projected-dataset.output.v1',
          classification: 'analyst_authored_sensitive',
          projection: 'full_manifest',
          includedCategories: ['target-identifiers'],
          excludedCategories: [],
          notePolicy: 'not_applicable',
          retention: 'operator_controlled_output',
          network: 'none',
          sharingReview: 'required',
        },
        {
          id: 'test.projected-dataset.input.v1',
          classification: 'analyst_authored_sensitive',
          projection: 'full_manifest',
          includedCategories: ['target-identifiers'],
          excludedCategories: [],
          notePolicy: 'not_applicable',
          retention: 'deliberate_local_file',
          network: 'none',
          sharingReview: 'required',
        },
        {
          id: 'test.variant-report.detailed.v3',
          classification: 'analyst_authored_sensitive',
          projection: 'full_manifest',
          includedCategories: ['target-identifiers'],
          excludedCategories: [],
          notePolicy: 'not_applicable',
          retention: 'operator_controlled_output',
          network: 'none',
          sharingReview: 'required',
        },
        {
          id: 'test.variant-report.summary.v3',
          classification: 'metadata_only',
          projection: 'metadata_only',
          includedCategories: ['aggregate-counts'],
          excludedCategories: ['target-identifiers'],
          notePolicy: 'not_applicable',
          retention: 'transient_report',
          network: 'none',
          sharingReview: 'not_applicable',
        },
      ],
      expiryProfiles: [{
        id: 'test.schema-lifecycle-v4.expiry.v1',
        field: null,
        anchor: null,
        handling: 'not_applicable',
        phase: 'not_applicable',
        maximumLifetimeDays: null,
      }],
      consumerEdges: [
        {
          id: 'test.projected-dataset.cli-build',
          plane: 'cli',
          operation: 'build-dataset',
          acceptedContracts: [],
          emittedContract: { schema: DATASET_SCHEMA, version: 1, discriminator: null },
          shapeIds: ['test.projected-dataset.v1'],
          boundProfileIds: ['test.projected-dataset.bounds.v1'],
          hookIds: ['test.projected-dataset.build', 'test.projected-dataset.serialise'],
          serialisationProfileId: 'test.projected-dataset.json.v1',
          privacyProfileId: 'test.projected-dataset.output.v1',
          expiryPolicyId: 'test.schema-lifecycle-v4.expiry.v1',
          requestMode: 'none',
          retentionEffect: 'operator_controlled_output',
          bindingState: 'declared_unenforced',
          policyState: 'current',
        },
        {
          id: 'test.projected-dataset.cli-read',
          plane: 'cli',
          operation: 'read-dataset',
          acceptedContracts: [{ schema: DATASET_SCHEMA, versions: [1], mode: 'direct', discriminator: null }],
          emittedContract: null,
          shapeIds: ['test.projected-dataset.v1'],
          boundProfileIds: ['test.projected-dataset.bounds.v1'],
          hookIds: ['test.projected-dataset.read'],
          serialisationProfileId: null,
          privacyProfileId: 'test.projected-dataset.input.v1',
          expiryPolicyId: 'test.schema-lifecycle-v4.expiry.v1',
          requestMode: 'none',
          retentionEffect: 'deliberate_local_file',
          bindingState: 'declared_unenforced',
          policyState: 'current',
        },
        ...(['detailed', 'summary'] as const).map((mode) => ({
          id: `test.variant-report.cli-build-${mode}`,
          plane: 'cli',
          operation: `build-${mode}`,
          acceptedContracts: [],
          emittedContract: { schema: REPORT_SCHEMA, version: 3, discriminator: { path: '$.mode', value: mode } },
          shapeIds: [`test.variant-report.v3-${mode}`],
          boundProfileIds: [`test.variant-report.${mode}-bounds.v3`],
          hookIds: [`test.variant-report.build-${mode}`, 'test.variant-report.serialise'],
          serialisationProfileId: 'test.variant-report.json.v3',
          privacyProfileId: `test.variant-report.${mode}.v3`,
          expiryPolicyId: 'test.schema-lifecycle-v4.expiry.v1',
          requestMode: 'none',
          retentionEffect: mode === 'detailed' ? 'operator_controlled_output' : 'transient_report',
          bindingState: 'declared_unenforced',
          policyState: 'current',
        })),
        {
          id: 'test.variant-report.cli-read-summary',
          plane: 'cli',
          operation: 'read-summary',
          acceptedContracts: [{
            schema: REPORT_SCHEMA,
            versions: [3],
            mode: 'direct',
            discriminator: { path: '$.mode', values: ['summary'] },
          }],
          emittedContract: null,
          shapeIds: ['test.variant-report.v3-summary'],
          boundProfileIds: ['test.variant-report.summary-bounds.v3'],
          hookIds: ['test.variant-report.read-summary'],
          serialisationProfileId: null,
          privacyProfileId: 'test.variant-report.summary.v3',
          expiryPolicyId: 'test.schema-lifecycle-v4.expiry.v1',
          requestMode: 'none',
          retentionEffect: 'transient_report',
          bindingState: 'declared_unenforced',
          policyState: 'current',
        },
      ],
      consumerRelationships: [],
    },
  };
}

describe('schema lifecycle metadata version 4', () => {
  test('accepts an explicitly bounded finite-number unit without weakening integer bounds', () => {
    const source = familySource();
    const metadata = source.metadata as Record<string, unknown>;
    const profiles = metadata.boundProfiles as Array<Record<string, unknown>>;
    const datasetProfile = profiles[0];
    assert.ok(datasetProfile);
    const bounds = datasetProfile.bounds as Array<Record<string, unknown>>;
    bounds.push({
      id: 'domain-age',
      path: '$.payload.domainAgeDays',
      phase: 'normalised',
      unit: 'finite_number',
      minimum: 0,
      maximum: 100_000,
      handling: 'reject',
    });
    const family = defineSchemaLifecycleFamily(source);
    const copied = family.metadata.boundProfiles[0]?.bounds.find(({ id }) => id === 'domain-age');
    assert.deepEqual(copied, {
      id: 'domain-age',
      path: '$.payload.domainAgeDays',
      phase: 'normalised',
      unit: 'finite_number',
      minimum: 0,
      maximum: 100_000,
      handling: 'reject',
    });
  });

  test('registers a private-file writer as a distinct output hook role', () => {
    const source = familySource();
    const metadata = source.metadata as Record<string, unknown>;
    const hooks = metadata.hooks as Array<Record<string, unknown>>;
    hooks.push({
      id: 'test.projected-dataset.write-private-file',
      role: 'private_file_writer',
      runtime: 'cli',
      module: 'cli/output-file.mts',
      exportName: 'writePrivateFile',
    });
    const consumers = metadata.consumerEdges as Array<Record<string, unknown>>;
    const hookIds = consumers[0]?.hookIds as string[];
    hookIds.push('test.projected-dataset.write-private-file');
    const family = defineSchemaLifecycleFamily(source);
    assert.equal(
      family.metadata.hooks.find(({ id }) => id === 'test.projected-dataset.write-private-file')?.role,
      'private_file_writer',
    );
  });

  test('owns retired output history, discriminated variants, and bounded projections', () => {
    const source = familySource();
    const family = defineSchemaLifecycleFamily(source);

    assert.equal(family.metadata.metadataVersion, 4);
    assert.equal(family.contracts[1]?.lifecycle, 'retired');
    assert.equal(family.fixtures[1]?.expectation, 'historical_output_exact');
    assert.deepEqual(family.metadata.shapes[2]?.discriminator, { path: '$.mode', value: 'detailed' });
    assert.deepEqual(
      family.metadata.shapes[0]?.objects[1]?.alternativeRequiredKeys,
      [{ keys: ['availability', 'state'], resolution: 'first_present' }],
    );
    assert.equal(family.metadata.shapes[0]?.normalisation, 'project_known_fields');
    assert.equal(Object.isFrozen(family), true);
    assert.equal(Object.isFrozen(family.metadata.shapes[0]?.objects[1]?.alternativeRequiredKeys), true);
    assert.equal(Object.isFrozen(family.metadata.shapes[0]?.objects[1]?.alternativeRequiredKeys?.[0]?.keys), true);

    source.metadata.shapes[2].discriminator.value = 'changed';
    source.metadata.shapes[0].objects[1].alternativeRequiredKeys[0].keys[0] = 'changed';
    assert.equal(family.metadata.shapes[2]?.discriminator?.value, 'detailed');
    assert.deepEqual(
      family.metadata.shapes[0]?.objects[1]?.alternativeRequiredKeys?.[0]?.keys,
      ['availability', 'state'],
    );

    const registry = defineSchemaLifecycleRegistry([familySource()]);
    assert.equal(registry[0]?.id, family.id);
    assert.equal(Object.isFrozen(registry), true);
  });

  test('rejects contradictory retired and shape-bound fixture history', () => {
    const cases: Array<readonly [string, (value: any) => void]> = [
      ['retired readable', (value) => { value.contracts[1].readable = true; }],
      ['retired emission', (value) => { value.contracts[1].emitted = true; }],
      ['retired migration', (value) => { value.contracts[1].migrationTarget = { schema: REPORT_SCHEMA, version: 3 }; }],
      ['retired expectation', (value) => { value.fixtures[1].expectation = 'accepted_exact'; }],
      ['fixture shape', (value) => { value.fixtures[1].shapeId = 'test.variant-report.v3-summary'; }],
      ['missing shape', (value) => { delete value.fixtures[1].shapeId; }],
    ];
    for (const [label, mutate] of cases) {
      const value = familySource();
      mutate(value);
      assert.throws(() => defineSchemaLifecycleFamily(value), label);
    }
  });

  test('allows exact fixture coverage for retired discriminated output history', () => {
    const value = familySource();
    const historicalShape = value.metadata.shapes[1];
    historicalShape.versions = [2];
    const historicalV1Shapes = (['detailed', 'summary'] as const).map((mode) => ({
      ...structuredClone(historicalShape),
      id: `test.variant-report.v1-${mode}`,
      versions: [1],
      objects: [{
        path: '$',
        requiredKeys: ['schema', 'version', 'mode', 'records'],
        alternativeRequiredKeys: [],
        optionalKeys: [],
        unknownKeys: 'reject',
      }],
      discriminator: { path: '$.mode', value: mode },
    }));
    value.metadata.shapes.push(...historicalV1Shapes);
    value.fixtures[1].shapeId = 'test.variant-report.v1-detailed';
    value.fixtures.push({
      ...structuredClone(value.fixtures[1]),
      id: 'test-variant-report-v1-summary',
      path: 'test/fixtures/test-variant-report-v1-summary.json',
      sha256: '5'.repeat(64),
      shapeId: 'test.variant-report.v1-summary',
    });
    value.contracts[1].fixtureIds.push('test-variant-report-v1-summary');

    const family = defineSchemaLifecycleFamily(value);
    assert.equal(family.contracts[1]?.lifecycle, 'retired');
    assert.deepEqual(
      family.metadata.shapes
        .filter((shape) => shape.schema === REPORT_SCHEMA && shape.versions.includes(1))
        .map((shape) => shape.id),
      ['test.variant-report.v1-detailed', 'test.variant-report.v1-summary'],
    );
  });

  test('requires disjoint exact variant selection for readers and writers', () => {
    const cases: Array<readonly [string, (value: any) => void]> = [
      ['duplicate variant', (value) => { value.metadata.shapes[3].discriminator.value = 'detailed'; }],
      ['missing writer variant', (value) => { value.metadata.consumerEdges[2].emittedContract.discriminator = null; }],
      ['unknown writer variant', (value) => { value.metadata.consumerEdges[2].emittedContract.discriminator.value = 'other'; }],
      ['unknown reader variant', (value) => { value.metadata.consumerEdges[4].acceptedContracts[0].discriminator.values = ['other']; }],
      ['hybrid unqualified shape', (value) => { value.metadata.shapes[3].discriminator = null; }],
      ['mixed discriminator paths', (value) => {
        value.metadata.shapes[3].objects[0].requiredKeys.push('kind');
        value.metadata.shapes[3].discriminator.path = '$.kind';
      }],
      ['optional discriminator', (value) => {
        value.metadata.shapes[2].objects[0].requiredKeys = ['schema', 'version', 'records'];
        value.metadata.shapes[2].objects[0].optionalKeys = ['mode'];
      }],
      ['optional discriminator ancestor', (value) => {
        for (const shape of value.metadata.shapes.slice(2, 4)) {
          shape.objects[0].requiredKeys = shape.objects[0].requiredKeys
            .filter((key: string) => key !== 'mode');
          shape.objects[0].optionalKeys.push('variant');
          shape.objects.push({
            path: '$.variant',
            requiredKeys: ['mode'],
            alternativeRequiredKeys: [],
            optionalKeys: [],
            unknownKeys: 'reject',
          });
          shape.discriminator.path = '$.variant.mode';
        }
        value.metadata.consumerEdges[2].emittedContract.discriminator.path = '$.variant.mode';
        value.metadata.consumerEdges[3].emittedContract.discriminator.path = '$.variant.mode';
        value.metadata.consumerEdges[4].acceptedContracts[0].discriminator.path = '$.variant.mode';
      }],
      ['alternative discriminator ancestor', (value) => {
        for (const shape of value.metadata.shapes.slice(2, 4)) {
          shape.objects[0].requiredKeys = shape.objects[0].requiredKeys
            .filter((key: string) => key !== 'mode');
          shape.objects[0].alternativeRequiredKeys.push({
            keys: ['variant', 'legacyVariant'],
            resolution: 'first_present',
          });
          shape.objects.push({
            path: '$.variant',
            requiredKeys: ['mode'],
            alternativeRequiredKeys: [],
            optionalKeys: [],
            unknownKeys: 'reject',
          });
          shape.discriminator.path = '$.variant.mode';
        }
        value.metadata.consumerEdges[2].emittedContract.discriminator.path = '$.variant.mode';
        value.metadata.consumerEdges[3].emittedContract.discriminator.path = '$.variant.mode';
        value.metadata.consumerEdges[4].acceptedContracts[0].discriminator.path = '$.variant.mode';
      }],
      ['overlapping reader variants', (value) => {
        value.metadata.consumerEdges[4].acceptedContracts.push({
          schema: REPORT_SCHEMA,
          versions: [3],
          mode: 'direct',
          discriminator: { path: '$.mode', values: ['summary'] },
        });
      }],
    ];
    for (const [label, mutate] of cases) {
      const value = familySource();
      mutate(value);
      assert.throws(() => defineSchemaLifecycleFamily(value), label);
    }
  });

  test('requires bounded projection and ordered alternative-key policy', () => {
    const cases: Array<readonly [string, (value: any) => void]> = [
      ['exact mismatch', (value) => { value.contracts[0].exactKeys = true; }],
      ['extension mismatch', (value) => { value.contracts[0].extensionPolicy = 'reject'; }],
      ['normalisation mismatch', (value) => { value.metadata.shapes[0].normalisation = 'preserve_document'; }],
      ['missing raw intake', (value) => { value.metadata.boundProfiles[0].bounds.shift(); }],
      ['raw intake below contract budget', (value) => { value.metadata.boundProfiles[0].bounds[0].maximum = 32; }],
      ['raw intake above contract budget', (value) => { value.metadata.boundProfiles[0].bounds[0].maximum = 2_048; }],
      ['extra raw intake profile', (value) => {
        value.metadata.boundProfiles[1].bounds.push({
          id: 'extra-raw-bytes',
          path: '$',
          phase: 'raw_intake',
          unit: 'bytes',
          minimum: 1,
          maximum: 1_024,
          handling: 'reject',
        });
        value.metadata.consumerEdges[1].boundProfileIds.push('test.variant-report.detailed-bounds.v3');
      }],
      ['missing normaliser', (value) => { value.metadata.hooks[1].role = 'reviewer'; }],
      ['one alternative', (value) => { value.metadata.shapes[0].objects[1].alternativeRequiredKeys[0].keys = ['availability']; }],
      ['overlapping alternative', (value) => { value.metadata.shapes[0].objects[1].optionalKeys.push('availability'); }],
      ['duplicate alternative', (value) => { value.metadata.shapes[0].objects[1].alternativeRequiredKeys.push({ keys: ['state', 'legacyState'], resolution: 'first_present' }); }],
      ['invalid resolution', (value) => { value.metadata.shapes[0].objects[1].alternativeRequiredKeys[0].resolution = 'last_present'; }],
    ];
    for (const [label, mutate] of cases) {
      const value = familySource();
      mutate(value);
      assert.throws(() => defineSchemaLifecycleFamily(value), label);
    }
  });

  test('keeps version 4 vocabulary isolated from older and six-key families', () => {
    const withoutMetadata = familySource();
    delete withoutMetadata.metadata;
    assert.throws(() => defineSchemaLifecycleFamily(withoutMetadata), /metadata version 4/iu);

    const older = familySource();
    older.metadata.metadataVersion = 3;
    assert.throws(() => defineSchemaLifecycleFamily(older), /version 4|exact registered/iu);
  });

  test('fails closed on accessor and revoked version 4 metadata without invoking caller code', () => {
    let getterCalls = 0;
    const discriminatorAccessor = familySource();
    Object.defineProperty(discriminatorAccessor.metadata.shapes[2], 'discriminator', {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls += 1;
        return { path: '$.mode', value: 'detailed' };
      },
    });
    assert.throws(() => defineSchemaLifecycleFamily(discriminatorAccessor));
    assert.equal(getterCalls, 0);

    const alternativeAccessor = familySource();
    Object.defineProperty(
      alternativeAccessor.metadata.shapes[0].objects[1].alternativeRequiredKeys[0],
      'keys',
      {
        enumerable: true,
        configurable: true,
        get() {
          getterCalls += 1;
          return ['availability', 'state'];
        },
      },
    );
    assert.throws(() => defineSchemaLifecycleFamily(alternativeAccessor));
    assert.equal(getterCalls, 0);

    const revoked = familySource();
    const proxy = Proxy.revocable(revoked.metadata.shapes[2].discriminator, {});
    revoked.metadata.shapes[2].discriminator = proxy.proxy;
    proxy.revoke();
    assert.throws(() => defineSchemaLifecycleFamily(revoked));
  });
});
