import type { SchemaCompatibilityDescriptor } from './schema-compatibility.mts';
import type {
  SchemaLifecycleFamilyWithMetadata,
  SchemaLifecycleFamilyWithMetadataV2,
  SchemaLifecycleFamilyWithMetadataV3,
  SchemaLifecycleFamilyWithMetadataV4,
} from './schema-lifecycle.mts';

export type ExtractedLifecycleHook = Readonly<{
  module: string;
  exportName: string;
  role: 'builder' | 'normaliser' | 'structure_validator';
  runtime: 'browser' | 'node' | 'shared';
}>;

export type ExtractedLifecycleFixture = Readonly<{
  id: string;
  path: string;
  bytes: number;
  sha256: string;
  version: number;
}>;

export type ExtractedLifecycleFormat = Readonly<{
  descriptor: SchemaCompatibilityDescriptor;
  lifecycleSchema: string;
  requiredKeys: readonly string[];
  optionalKeys: readonly string[];
  hook: ExtractedLifecycleHook;
  fixtures: readonly ExtractedLifecycleFixture[];
}>;

export type ExtractedLifecycleFamilyOptions = Readonly<{
  id: string;
  owner: string;
  formats: readonly ExtractedLifecycleFormat[];
  serializerModule?: string; serializerExportName: string;
  plane: 'browser' | 'node' | 'shared';
  projection: 'bounded_passive_monitor' | 'browser_export' | 'browser_import' | 'review_output';
  retention: 'none' | 'operator_controlled_output' | 'transient_report';
  includedCategories: readonly string[];
  excludedCategories: readonly string[];
}>;

function formatSlug(id: string): string {
  return id.replaceAll('.', '-');
}

function lifecycleShapeId(format: ExtractedLifecycleFormat, version: number, v4: boolean): string {
  return v4
    ? `${formatSlug(format.descriptor.id)}.v${version}`
    : `${formatSlug(format.descriptor.id)}.document`;
}

function contractState(format: ExtractedLifecycleFormat, version: number) {
  const current = version === format.descriptor.currentVersion;
  const outputOnly = format.descriptor.futureVersionBehavior === 'not_applicable';
  return {
    lifecycle: current ? 'current' as const : outputOnly ? 'retired' as const : 'legacy' as const,
    readable: !outputOnly,
    emitted: current,
    futureVersionBehaviour: outputOnly
      ? 'not_applicable' as const
      : format.descriptor.futureVersionBehavior,
    migrationTarget: !current && format.descriptor.migration === 'normalize_to_current'
      ? { schema: format.lifecycleSchema, version: format.descriptor.currentVersion }
      : null,
  };
}

function fixtureRecord(format: ExtractedLifecycleFormat, fixture: ExtractedLifecycleFixture, v4: boolean) {
  const state = contractState(format, fixture.version);
  const output = format.fixtures.find((candidate) => candidate.version === format.descriptor.currentVersion);
  return {
    ...fixture,
    contentDigestSha256: null,
    schema: format.lifecycleSchema,
    role: state.lifecycle === 'current' ? 'current' as const : 'historical' as const,
    expectation: state.lifecycle === 'retired'
      ? 'historical_output_exact' as const
      : state.lifecycle === 'legacy' && format.descriptor.migration === 'normalize_to_current'
        ? 'normalises_to_current_output' as const
        : 'accepted_exact' as const,
    expectedOutputFixtureId: state.lifecycle === 'legacy' && format.descriptor.migration === 'normalize_to_current'
      ? output?.id ?? null
      : null,
    scope: 'repository' as const,
    ...(v4 ? { shapeId: lifecycleShapeId(format, fixture.version, true) } : {}),
  };
}

function buildExtractedLifecycleFamily(
  options: ExtractedLifecycleFamilyOptions,
  metadataVersion: 2 | 3 | 4,
): SchemaLifecycleFamilyWithMetadata {
  const v4 = metadataVersion === 4;
  const fixtures = options.formats.flatMap((format) => format.fixtures.map((fixture) => (
    fixtureRecord(format, fixture, v4)
  )));
  const contracts = options.formats.flatMap((format) => format.descriptor.supportedVersions.map((version) => ({
    compatibilityId: format.descriptor.id,
    schema: format.lifecycleSchema,
    version,
    role: 'document' as const,
    ...contractState(format, version),
    exactKeys: true,
    extensionPolicy: 'reject' as const,
    canonicalisation: null,
    byteBudget: format.descriptor.byteBudget,
    fixtureIds: fixtures
      .filter((fixture) => fixture.schema === format.lifecycleSchema && fixture.version === version)
      .map((fixture) => fixture.id),
  })));
  const shapes = options.formats.flatMap((format) => (v4
    ? format.descriptor.supportedVersions
    : [format.descriptor.currentVersion]
  ).map((version) => ({
    id: lifecycleShapeId(format, version, v4),
    schema: format.lifecycleSchema,
    versions: v4 ? [version] : format.descriptor.supportedVersions,
    objects: [{
      path: '$',
      requiredKeys: format.requiredKeys,
      optionalKeys: format.optionalKeys,
      ...(v4 ? { alternativeRequiredKeys: [] as const } : {}),
      unknownKeys: 'reject' as const,
    }],
    fixedArrays: [],
    normalisation: 'preserve_document' as const,
    target: null,
    ...(v4 ? { discriminator: null } : {}),
  })));
  const boundProfiles = options.formats.map((format) => ({
    id: `${formatSlug(format.descriptor.id)}.bounds`,
    bounds: format.descriptor.byteBudget === null
      ? [{
        id: 'aggregate-depth', path: '$', phase: 'pre_accumulation' as const,
        unit: 'depth' as const, minimum: 0, maximum: 64, handling: 'reject' as const,
      }]
      : [{
        id: 'serialised-bytes', path: '$', phase: 'serialised' as const,
        unit: 'bytes' as const, minimum: 1, maximum: format.descriptor.byteBudget,
        handling: 'reject' as const,
      }],
  }));
  const serializerHookId = `${options.id}.serialise`;
  const implementationHooks = new Map<string, Readonly<{
    id: string;
    role: ExtractedLifecycleHook['role'];
    runtime: ExtractedLifecycleHook['runtime'];
    module: string;
    exportName: string;
  }>>();
  for (const format of options.formats) {
    const key = `${format.hook.module}\u0000${format.hook.exportName}`;
    if (!implementationHooks.has(key)) {
      implementationHooks.set(key, {
        id: `${options.id}.${formatSlug(format.descriptor.id)}.implementation`,
        ...format.hook,
      });
    }
  }
  const hookIdFor = (format: ExtractedLifecycleFormat): string => implementationHooks
    .get(`${format.hook.module}\u0000${format.hook.exportName}`)!.id;
  const hooks = [
    ...implementationHooks.values(),
    {
      id: serializerHookId,
      role: 'serialiser' as const,
      runtime: 'shared' as const,
      module: options.serializerModule ?? options.owner,
      exportName: options.serializerExportName,
    },
  ];
  const serialisedFormat = options.formats[0]!;
  const serialisationProfileId = `${options.id}.json`;
  const privacyProfileId = `${options.id}.privacy`;
  const expiryPolicyId = `${options.id}.expiry`;
  const consumerEdges = options.formats.map((format, index) => {
    const outputOnly = format.descriptor.futureVersionBehavior === 'not_applicable';
    const acceptedVersions = outputOnly ? [] : format.descriptor.supportedVersions;
    const edgeVersions = outputOnly ? [format.descriptor.currentVersion] : format.descriptor.supportedVersions;
    const shapeIds = v4
      ? edgeVersions.map((version) => lifecycleShapeId(format, version, true))
      : [lifecycleShapeId(format, format.descriptor.currentVersion, false)];
    const hookId = hookIdFor(format);
    const serialises = index === 0;
    return {
      id: `${options.id}.${formatSlug(format.descriptor.id)}.consumer`,
      plane: options.plane,
      operation: outputOnly ? 'produce-reviewed-output' : 'validate-and-produce',
      acceptedContracts: acceptedVersions.length
        ? [{
          schema: format.lifecycleSchema,
          versions: acceptedVersions,
          mode: 'direct' as const,
          ...(metadataVersion >= 3 ? { discriminator: null } : {}),
        }]
        : [],
      emittedContract: {
        schema: format.lifecycleSchema,
        version: format.descriptor.currentVersion,
        ...(v4 ? { discriminator: null } : {}),
      },
      shapeIds,
      boundProfileIds: [`${formatSlug(format.descriptor.id)}.bounds`],
      hookIds: serialises ? [hookId, serializerHookId] : [hookId],
      serialisationProfileId: serialises ? serialisationProfileId : null,
      privacyProfileId,
      expiryPolicyId,
      requestMode: 'none' as const,
      retentionEffect: options.retention,
      bindingState: 'declared_unenforced' as const,
      policyState: 'current' as const,
    };
  });
  const metadata = {
    metadataVersion,
    enforcement: 'declarative_only' as const,
    shapes,
    boundProfiles,
    hooks,
    serialisationProfiles: [{
      id: serialisationProfileId,
      schema: serialisedFormat.lifecycleSchema,
      versions: [serialisedFormat.descriptor.currentVersion],
      mediaType: 'application/json' as const,
      encoding: 'utf-8' as const,
      bom: false as const,
      indentSpaces: 2 as const,
      terminalLf: true,
      propertyOrder: 'normalised_fixed' as const,
      canonicalisation: null,
      integrity: 'none' as const,
      serializerHookId,
      verifierHookIds: [],
    }],
    privacyProfiles: [{
      id: privacyProfileId,
      classification: 'analyst_authored_sensitive' as const,
      projection: options.projection,
      includedCategories: options.includedCategories,
      excludedCategories: options.excludedCategories,
      notePolicy: 'discarded' as const,
      retention: options.retention,
      network: 'none' as const,
      sharingReview: options.retention === 'operator_controlled_output' ? 'required' as const : 'not_applicable' as const,
    }],
    expiryProfiles: [{
      id: expiryPolicyId,
      field: null,
      anchor: null,
      handling: 'not_applicable' as const,
      phase: 'not_applicable' as const,
      maximumLifetimeDays: null,
    }],
    consumerEdges,
    consumerRelationships: [],
  };
  return {
    id: options.id,
    owner: options.owner,
    privacy: 'analyst_authored_sensitive',
    compatibility: options.formats.map((format) => format.descriptor),
    contracts,
    fixtures,
    metadata,
  } as SchemaLifecycleFamilyWithMetadata;
}

export function buildExtractedLifecycleFamilyV2(
  options: ExtractedLifecycleFamilyOptions,
): SchemaLifecycleFamilyWithMetadataV2 {
  return buildExtractedLifecycleFamily(options, 2) as SchemaLifecycleFamilyWithMetadataV2;
}

export function buildExtractedLifecycleFamilyV3(
  options: ExtractedLifecycleFamilyOptions,
): SchemaLifecycleFamilyWithMetadataV3 {
  return buildExtractedLifecycleFamily(options, 3) as SchemaLifecycleFamilyWithMetadataV3;
}

export function buildExtractedLifecycleFamilyV4(
  options: ExtractedLifecycleFamilyOptions,
): SchemaLifecycleFamilyWithMetadataV4 {
  return buildExtractedLifecycleFamily(options, 4) as SchemaLifecycleFamilyWithMetadataV4;
}
