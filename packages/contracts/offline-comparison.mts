import { defineSchemaCompatibility } from './schema-compatibility.mts';
import { defineSchemaLifecycleFamily } from './schema-lifecycle.mts';

export const OFFLINE_COMPARISON_CONTRACT_OWNER = 'packages/contracts/offline-comparison.mts';
export const MAX_OFFLINE_COMPARISON_INPUT_BYTES = 8 * 1024 * 1024;

export const PAGE_COMPARISON_VERSION = 3;
export const CLI_PAGE_COMPARE_SCHEMA = 'whoisleuth.cli.page-compare';
export const CLI_PAGE_COMPARE_VERSION = 4;
export const SUPPORTED_CLI_PAGE_COMPARE_VERSIONS = Object.freeze([CLI_PAGE_COMPARE_VERSION] as const);

export const CLI_COMPARISON_LEDGER_SCHEMA = 'whoisleuth.cli.comparison-ledger';
export const CLI_COMPARISON_LEDGER_VERSION = 1;
export const MAX_RETAINED_ARTIFACT_DIFF_BYTES = 8 * 1024 * 1024;

export const RELATIONSHIP_EVIDENCE_SCHEMA = 'whoisleuth.relationship-evidence';
export const RELATIONSHIP_EVIDENCE_VERSION = 2;
export const TLS_RELATIONSHIP_PROFILE_VERSION = 2;
export const SUPPORTED_TLS_RELATIONSHIP_PROFILE_VERSIONS = Object.freeze([TLS_RELATIONSHIP_PROFILE_VERSION] as const);

export const OFFLINE_COMPARISON_COMPATIBILITY_FACADES = Object.freeze([
  ['frontend/src/lib/analysis/comparison-ledger-bulk.ts', 'packages/comparison/comparison-ledger-bulk.mts'],
  ['frontend/src/lib/analysis/comparison-ledger-contract.ts', 'packages/comparison/comparison-ledger-contract.mts'],
  ['frontend/src/lib/analysis/comparison-ledger-json.ts', 'packages/comparison/comparison-ledger-json.mts'],
  ['frontend/src/lib/analysis/comparison-ledger-serialization.ts', 'packages/comparison/comparison-ledger-serialization.mts'],
  ['frontend/src/lib/analysis/page-similarity.ts', 'packages/comparison/page-similarity.mts'],
  ['frontend/src/lib/analysis/relationship-evidence.ts', 'packages/comparison/relationship-evidence.mts'],
] as const);

export const CLI_PAGE_COMPARE_COMPATIBILITY = defineSchemaCompatibility({
  id: 'cli.page-compare', kind: 'cli_document', schema: CLI_PAGE_COMPARE_SCHEMA,
  currentVersion: CLI_PAGE_COMPARE_VERSION, supportedVersions: SUPPORTED_CLI_PAGE_COMPARE_VERSIONS,
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only',
  byteBudget: MAX_OFFLINE_COMPARISON_INPUT_BYTES, owner: OFFLINE_COMPARISON_CONTRACT_OWNER,
  note: 'Offline comparison of two bounded deep-lookup page identity, technology, favicon, TLS, and response observations; version 3 withholds technology equality for partial sets and version 4 also withholds TLS issuer and public-key conclusions for partial TLS evidence.',
});

export const CLI_COMPARISON_LEDGER_COMPATIBILITY = defineSchemaCompatibility({
  id: 'cli.comparison-ledger', kind: 'cli_document', schema: CLI_COMPARISON_LEDGER_SCHEMA,
  currentVersion: CLI_COMPARISON_LEDGER_VERSION, supportedVersions: [CLI_COMPARISON_LEDGER_VERSION],
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only',
  byteBudget: MAX_RETAINED_ARTIFACT_DIFF_BYTES * 2, owner: OFFLINE_COMPARISON_CONTRACT_OWNER,
  note: 'Value-free bounded index plus on-demand exact rows for explicitly paired retained Bulk sessions or domain-portfolio reviews.',
});

export const OFFLINE_COMPARISON_COMPATIBILITY = Object.freeze([
  CLI_PAGE_COMPARE_COMPATIBILITY,
  CLI_COMPARISON_LEDGER_COMPATIBILITY,
]);

const OFFLINE_COMPARISON_FIXTURES = Object.freeze([
  { id: 'cli-page-compare-v4', path: 'test/fixtures/offline-comparison/cli-page-compare-v4.json', bytes: 5_059, sha256: '12bff7f46b852778f0f38926159083f37c34038ccdbbf8c4fc904ce03482360c', schema: CLI_PAGE_COMPARE_SCHEMA, version: 4, role: 'current' as const, expectation: 'accepted_exact' as const, shapeId: 'offline-comparison.page-output.current' },
  { id: 'cli-comparison-ledger-v1', path: 'test/fixtures/offline-comparison/cli-comparison-ledger-v1.json', bytes: 6_820, sha256: '861a733500dede0af9f2551d94db66dc51b0a2fbdb68e377a71fd4661a51530b', schema: CLI_COMPARISON_LEDGER_SCHEMA, version: 1, role: 'current' as const, expectation: 'accepted_exact' as const, shapeId: 'offline-comparison.ledger-output.current' },
].map((fixture) => Object.freeze({
  ...fixture,
  contentDigestSha256: null,
  expectedOutputFixtureId: null,
  scope: 'repository' as const,
})));

function offlineFixtureIds(schema: string, version: number): readonly string[] {
  return Object.freeze(OFFLINE_COMPARISON_FIXTURES
    .filter((fixture) => fixture.schema === schema && fixture.version === version)
    .map((fixture) => fixture.id));
}

const OFFLINE_COMPARISON_CONTRACTS = Object.freeze([
  ...SUPPORTED_CLI_PAGE_COMPARE_VERSIONS.map((version) => Object.freeze({
    compatibilityId: CLI_PAGE_COMPARE_COMPATIBILITY.id,
    schema: CLI_PAGE_COMPARE_SCHEMA,
    version,
    role: 'document' as const,
    lifecycle: version === CLI_PAGE_COMPARE_VERSION ? 'current' as const : 'retired' as const,
    readable: false,
    emitted: version === CLI_PAGE_COMPARE_VERSION,
    exactKeys: true,
    extensionPolicy: 'reject' as const,
    futureVersionBehaviour: 'not_applicable' as const,
    migrationTarget: null,
    canonicalisation: null,
    byteBudget: MAX_OFFLINE_COMPARISON_INPUT_BYTES,
    fixtureIds: offlineFixtureIds(CLI_PAGE_COMPARE_SCHEMA, version),
  })),
  Object.freeze({
    compatibilityId: CLI_COMPARISON_LEDGER_COMPATIBILITY.id,
    schema: CLI_COMPARISON_LEDGER_SCHEMA,
    version: CLI_COMPARISON_LEDGER_VERSION,
    role: 'document' as const,
    lifecycle: 'current' as const,
    readable: false,
    emitted: true,
    exactKeys: true,
    extensionPolicy: 'reject' as const,
    futureVersionBehaviour: 'not_applicable' as const,
    migrationTarget: null,
    canonicalisation: null,
    byteBudget: MAX_RETAINED_ARTIFACT_DIFF_BYTES * 2,
    fixtureIds: offlineFixtureIds(CLI_COMPARISON_LEDGER_SCHEMA, CLI_COMPARISON_LEDGER_VERSION),
  }),
]);

function offlineOutputShape(id: string, schema: string, versions: readonly number[], requiredKeys: readonly string[]) {
  return Object.freeze({
    id,
    schema,
    versions,
    objects: [{ path: '$', requiredKeys, optionalKeys: [], alternativeRequiredKeys: [], unknownKeys: 'reject' as const }],
    fixedArrays: [],
    normalisation: 'preserve_document' as const,
    target: null,
    discriminator: null,
  });
}

const offlineConsumerCommon = Object.freeze({
  expiryPolicyId: 'offline-comparison.expiry.not-applicable',
  requestMode: 'none' as const,
  retentionEffect: 'transient_report' as const,
  bindingState: 'declared_unenforced' as const,
  policyState: 'current' as const,
});

export const OFFLINE_COMPARISON_LIFECYCLE_FAMILY = defineSchemaLifecycleFamily({
  id: 'offline-comparison',
  owner: OFFLINE_COMPARISON_CONTRACT_OWNER,
  privacy: 'analyst_authored_sensitive',
  compatibility: OFFLINE_COMPARISON_COMPATIBILITY,
  contracts: OFFLINE_COMPARISON_CONTRACTS,
  fixtures: OFFLINE_COMPARISON_FIXTURES,
  metadata: {
    metadataVersion: 4,
    enforcement: 'declarative_only',
    shapes: [
      offlineOutputShape('offline-comparison.page-output.current', CLI_PAGE_COMPARE_SCHEMA, [4], ['schema', 'version', 'generatedAt', 'left', 'right', 'page', 'technology', 'tls', 'limitations']),
      offlineOutputShape('offline-comparison.ledger-output.current', CLI_COMPARISON_LEDGER_SCHEMA, [1], ['schema', 'version', 'generatedAt', 'artifactFamily', 'left', 'right', 'index', 'details', 'limitations']),
    ],
    boundProfiles: [
      { id: 'offline-comparison.page.bounds', bounds: [
        { id: 'serialised-bytes', path: '$', phase: 'serialised', unit: 'bytes', minimum: 1, maximum: MAX_OFFLINE_COMPARISON_INPUT_BYTES, handling: 'reject' },
      ] },
      { id: 'offline-comparison.ledger.bounds', bounds: [
        { id: 'serialised-bytes', path: '$', phase: 'serialised', unit: 'bytes', minimum: 1, maximum: MAX_RETAINED_ARTIFACT_DIFF_BYTES * 2, handling: 'reject' },
      ] },
    ],
    hooks: [
      { id: 'offline-comparison.page.build', role: 'builder', runtime: 'cli', module: 'cli/page-compare.mts', exportName: 'buildCliPageComparison' },
      { id: 'offline-comparison.ledger.build', role: 'builder', runtime: 'cli', module: 'cli/retained-artifact-diff.mts', exportName: 'buildCliRetainedArtifactDiff' },
      { id: 'offline-comparison.json.serialise', role: 'serialiser', runtime: 'cli', module: 'cli/formatters/json.mts', exportName: 'formatJsonDocument' },
    ],
    serialisationProfiles: [
      { id: 'offline-comparison.page.json.v4', schema: CLI_PAGE_COMPARE_SCHEMA, versions: [CLI_PAGE_COMPARE_VERSION], mediaType: 'application/json', encoding: 'utf-8', bom: false, indentSpaces: 2, terminalLf: true, propertyOrder: 'normalised_fixed', canonicalisation: null, integrity: 'none', serializerHookId: 'offline-comparison.json.serialise', verifierHookIds: [] },
      { id: 'offline-comparison.ledger.json.v1', schema: CLI_COMPARISON_LEDGER_SCHEMA, versions: [CLI_COMPARISON_LEDGER_VERSION], mediaType: 'application/json', encoding: 'utf-8', bom: false, indentSpaces: 2, terminalLf: true, propertyOrder: 'normalised_fixed', canonicalisation: null, integrity: 'none', serializerHookId: 'offline-comparison.json.serialise', verifierHookIds: [] },
    ],
    privacyProfiles: [{ id: 'offline-comparison.privacy.output', classification: 'analyst_authored_sensitive', projection: 'review_output', includedCategories: ['bounded-comparison-states', 'source-completeness', 'limitations'], excludedCategories: ['input-paths', 'raw-upstream-payloads', 'expanded-contacts', 'credentials', 'cookies', 'query-bearing-urls'], notePolicy: 'not_applicable', retention: 'transient_report', network: 'none', sharingReview: 'not_applicable' }],
    expiryProfiles: [{ id: 'offline-comparison.expiry.not-applicable', field: null, anchor: null, handling: 'not_applicable', phase: 'not_applicable', maximumLifetimeDays: null }],
    consumerEdges: [
      {
        id: 'offline-comparison.consumer.page-output', plane: 'cli', operation: 'build-current-page-comparison', acceptedContracts: [],
        emittedContract: { schema: CLI_PAGE_COMPARE_SCHEMA, version: CLI_PAGE_COMPARE_VERSION, discriminator: null },
        shapeIds: ['offline-comparison.page-output.current'], boundProfileIds: ['offline-comparison.page.bounds'],
        hookIds: ['offline-comparison.page.build', 'offline-comparison.json.serialise'], serialisationProfileId: 'offline-comparison.page.json.v4',
        privacyProfileId: 'offline-comparison.privacy.output', ...offlineConsumerCommon,
      },
      {
        id: 'offline-comparison.consumer.ledger-output', plane: 'cli', operation: 'build-current-comparison-ledger', acceptedContracts: [],
        emittedContract: { schema: CLI_COMPARISON_LEDGER_SCHEMA, version: CLI_COMPARISON_LEDGER_VERSION, discriminator: null },
        shapeIds: ['offline-comparison.ledger-output.current'], boundProfileIds: ['offline-comparison.ledger.bounds'],
        hookIds: ['offline-comparison.ledger.build', 'offline-comparison.json.serialise'], serialisationProfileId: 'offline-comparison.ledger.json.v1',
        privacyProfileId: 'offline-comparison.privacy.output', ...offlineConsumerCommon,
      },
    ],
    consumerRelationships: [],
  },
});
