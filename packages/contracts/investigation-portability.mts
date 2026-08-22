import { defineSchemaCompatibility } from './schema-compatibility.mts';
import { defineSchemaLifecycleFamily } from './schema-lifecycle.mts';

export const INVESTIGATION_PORTABILITY_CONTRACT_OWNER = 'packages/contracts/investigation-portability.mts';
export const MAX_INVESTIGATION_PORTABLE_BYTES = 15 * 1024 * 1024;

export const ACQUISITION_DECISION_PACKET_SCHEMA = 'whoisleuth.acquisition-decision';
export const ACQUISITION_DECISION_PACKET_VERSION = 2;
export const SUPPORTED_ACQUISITION_DECISION_PACKET_VERSIONS = Object.freeze([ACQUISITION_DECISION_PACKET_VERSION] as const);

export const LOOKUP_CLAIM_READINESS_VERSION = 2;
export const LOOKUP_CLAIM_PASSPORT_SCHEMA = 'whoisleuth.lookup-claim-passport';
export const LOOKUP_CLAIM_PASSPORT_VERSION = 1;
export const MAX_LOOKUP_CLAIM_PASSPORT_BYTES = 64 * 1024;
export const MAX_LOOKUP_CLAIM_PASSPORT_REQUIREMENTS = 16;
export const MAX_LOOKUP_CLAIM_PASSPORT_LIMITATIONS = 16;
export const LOOKUP_CLAIM_PASSPORT_TARGET_TYPES = Object.freeze(['domain', 'ipv4', 'ipv6', 'asn'] as const);

export const BULK_DOMAIN_COMPARISON_SCHEMA = 'whoisleuth.domain-comparison';
export const BULK_DOMAIN_COMPARISON_VERSION = 3;
export const BULK_DOMAIN_COMPARISON_EXPORT_VERSION = 4;
export const SUPPORTED_BULK_DOMAIN_COMPARISON_EXPORT_VERSIONS = Object.freeze([BULK_DOMAIN_COMPARISON_EXPORT_VERSION] as const);

export const BULK_MAIL_EXPOSURE_SCHEMA = 'whoisleuth.bulk-mail-exposure';
export const BULK_MAIL_EXPOSURE_VERSION = 1;
export const BULK_MAIL_EXPOSURE_EXPORT_VERSION = 2;
export const SUPPORTED_BULK_MAIL_EXPOSURE_EXPORT_VERSIONS = Object.freeze([BULK_MAIL_EXPOSURE_EXPORT_VERSION] as const);
export const MAX_BULK_MAIL_EXPOSURE_ROWS = 2_000;

export const BULK_REVIEW_MANIFEST_SCHEMA = 'whoisleuth.bulk-review-manifest';
export const BULK_REVIEW_MANIFEST_VERSION = 2;
export const SUPPORTED_BULK_REVIEW_MANIFEST_VERSIONS = Object.freeze([BULK_REVIEW_MANIFEST_VERSION] as const);

export const INVESTIGATION_CAPSULE_SCHEMA = 'whoisleuth.investigation-capsule';
export const INVESTIGATION_CAPSULE_VERSION = 3;
export const PUBLIC_INVESTIGATION_CAPSULE_VERSION = 2;
export const SUPPORTED_INVESTIGATION_CAPSULE_VERSIONS = Object.freeze([
  PUBLIC_INVESTIGATION_CAPSULE_VERSION,
  INVESTIGATION_CAPSULE_VERSION,
] as const);
export const INVESTIGATION_CAPSULE_ANALYST_RECORDS_SCHEMA = 'whoisleuth.case-analyst-records';
export const INVESTIGATION_CAPSULE_ANALYST_RECORDS_VERSION = 1;

export const LOOKUP_INVESTIGATION_BRIEF_SCHEMA = 'whoisleuth.investigation-brief';
export const LOOKUP_INVESTIGATION_BRIEF_VERSION = 2;
export const PUBLIC_LOOKUP_INVESTIGATION_BRIEF_VERSION = 1;
export const SUPPORTED_LOOKUP_INVESTIGATION_BRIEF_VERSIONS = Object.freeze([
  PUBLIC_LOOKUP_INVESTIGATION_BRIEF_VERSION,
  LOOKUP_INVESTIGATION_BRIEF_VERSION,
] as const);
export const MAX_LOOKUP_INVESTIGATION_BRIEF_BYTES = 128 * 1024;

export const LOOKUP_ASSET_GRAPH_SCHEMA = 'whoisleuth.lookup-asset-graph';
export const LOOKUP_ASSET_GRAPH_VERSION = 2;

export const INVESTIGATION_DOMAIN_COMPATIBILITY_FACADES = Object.freeze([
  ['frontend/src/lib/analysis/acquisition-decision-packet.ts', 'packages/investigation/acquisition-decision-packet.mts'],
  ['frontend/src/lib/analysis/acquisition-due-diligence.ts', 'packages/investigation/acquisition-due-diligence.mts'],
  ['frontend/src/lib/analysis/bulk-domain-comparison.ts', 'packages/investigation/bulk-domain-comparison.mts'],
  ['frontend/src/lib/analysis/bulk-mail-exposure.ts', 'packages/investigation/bulk-mail-exposure.mts'],
  ['frontend/src/lib/analysis/bulk-review-export.ts', 'packages/investigation/bulk-review-export.mts'],
  ['frontend/src/lib/analysis/evidence-coverage-ledger.ts', 'packages/investigation/evidence-coverage-ledger.mts'],
  ['frontend/src/lib/analysis/investigation-capsule.ts', 'packages/investigation/investigation-capsule.mts'],
  ['frontend/src/lib/analysis/lookup-asset-graph.ts', 'packages/investigation/lookup-asset-graph.mts'],
  ['frontend/src/lib/analysis/lookup-claim-passport.ts', 'packages/investigation/lookup-claim-passport.mts'],
  ['frontend/src/lib/analysis/lookup-claim-readiness.ts', 'packages/investigation/lookup-claim-readiness.mts'],
  ['frontend/src/lib/analysis/lookup-investigation-brief.ts', 'packages/investigation/lookup-investigation-brief.mts'],
] as const);

export const ACQUISITION_DECISION_PACKET_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.acquisition-decision', kind: 'export', schema: ACQUISITION_DECISION_PACKET_SCHEMA,
  currentVersion: ACQUISITION_DECISION_PACKET_VERSION, supportedVersions: SUPPORTED_ACQUISITION_DECISION_PACKET_VERSIONS,
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'read_only', writeSemantics: 'read_only',
  byteBudget: MAX_INVESTIGATION_PORTABLE_BYTES, owner: INVESTIGATION_PORTABILITY_CONTRACT_OWNER,
  note: 'The v1.47.4 current writer and v2 both use version 2 with deterministic sorted-json-v2 integrity for a bounded acquisition review without making an availability, eligibility, ownership, valuation, or purchase determination.',
});

export const LOOKUP_CLAIM_PASSPORT_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.lookup-claim-passport', kind: 'export', schema: LOOKUP_CLAIM_PASSPORT_SCHEMA,
  currentVersion: LOOKUP_CLAIM_PASSPORT_VERSION, supportedVersions: [LOOKUP_CLAIM_PASSPORT_VERSION],
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'read_only', writeSemantics: 'read_only',
  byteBudget: MAX_LOOKUP_CLAIM_PASSPORT_BYTES, owner: INVESTIGATION_PORTABILITY_CONTRACT_OWNER,
  note: 'Explicit local export of one typed claim-readiness projection with exact evidence requirement IDs, retained source states, bounded limitations, and deterministic sorted-json-v2 integrity; raw source payloads and browser-local records are excluded.',
});

export const BULK_DOMAIN_COMPARISON_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.domain-comparison', kind: 'export', schema: BULK_DOMAIN_COMPARISON_SCHEMA,
  currentVersion: BULK_DOMAIN_COMPARISON_EXPORT_VERSION, supportedVersions: SUPPORTED_BULK_DOMAIN_COMPARISON_EXPORT_VERSIONS,
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'read_only', writeSemantics: 'read_only',
  byteBudget: MAX_INVESTIGATION_PORTABLE_BYTES, owner: INVESTIGATION_PORTABILITY_CONTRACT_OWNER,
  note: 'Export version 4 uses deterministic sorted-json-v2 integrity while its nested comparison remains version 3 and preserves distinct evidence states.',
});

export const BULK_MAIL_EXPOSURE_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.bulk-mail-exposure', kind: 'export', schema: BULK_MAIL_EXPOSURE_SCHEMA,
  currentVersion: BULK_MAIL_EXPOSURE_EXPORT_VERSION, supportedVersions: SUPPORTED_BULK_MAIL_EXPOSURE_EXPORT_VERSIONS,
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'read_only', writeSemantics: 'read_only',
  byteBudget: MAX_INVESTIGATION_PORTABLE_BYTES, owner: INVESTIGATION_PORTABILITY_CONTRACT_OWNER,
  note: 'Export version 2 uses deterministic sorted-json-v2 integrity while its nested report remains version 1 and incomplete DNS evidence remains inconclusive.',
});

export const BULK_REVIEW_MANIFEST_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.bulk-review-manifest', kind: 'export', schema: BULK_REVIEW_MANIFEST_SCHEMA,
  currentVersion: BULK_REVIEW_MANIFEST_VERSION, supportedVersions: SUPPORTED_BULK_REVIEW_MANIFEST_VERSIONS,
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'read_only', writeSemantics: 'read_only',
  byteBudget: MAX_INVESTIGATION_PORTABLE_BYTES, owner: INVESTIGATION_PORTABILITY_CONTRACT_OWNER,
  note: 'Version 2 uses deterministic sorted-json-v2 integrity for one bounded Bulk review selection while excluding raw payloads, contacts, notes, and transient request state.',
});

export const INVESTIGATION_CAPSULE_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.investigation-capsule', kind: 'export', schema: INVESTIGATION_CAPSULE_SCHEMA,
  currentVersion: INVESTIGATION_CAPSULE_VERSION, supportedVersions: SUPPORTED_INVESTIGATION_CAPSULE_VERSIONS,
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'read_only', writeSemantics: 'read_only',
  byteBudget: MAX_INVESTIGATION_PORTABLE_BYTES, owner: INVESTIGATION_PORTABILITY_CONTRACT_OWNER,
  note: 'Version 3 embeds investigation brief v2 with canonical Decision Facts; the v1.47.4 version 2 and v2 version 3 retain whole-capsule sorted-json-v2 integrity.',
});

export const LOOKUP_ASSET_GRAPH_COMPATIBILITY = defineSchemaCompatibility({
  id: 'derived.lookup-asset-graph', kind: 'derived', schema: LOOKUP_ASSET_GRAPH_SCHEMA,
  tier: 'durable_interchange',
  currentVersion: LOOKUP_ASSET_GRAPH_VERSION, supportedVersions: [LOOKUP_ASSET_GRAPH_VERSION],
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only',
  byteBudget: null, owner: INVESTIGATION_PORTABILITY_CONTRACT_OWNER,
  note: 'Bounded relationship projection embedded in investigation capsules; source attribution and incomplete evidence remain explicit.',
});

export const INVESTIGATION_CAPSULE_ANALYST_RECORDS_COMPATIBILITY = defineSchemaCompatibility({
  id: 'derived.case-analyst-records', kind: 'derived', schema: INVESTIGATION_CAPSULE_ANALYST_RECORDS_SCHEMA,
  tier: 'durable_interchange',
  currentVersion: INVESTIGATION_CAPSULE_ANALYST_RECORDS_VERSION, supportedVersions: [INVESTIGATION_CAPSULE_ANALYST_RECORDS_VERSION],
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only',
  byteBudget: null, owner: INVESTIGATION_PORTABILITY_CONTRACT_OWNER,
  note: 'Optional bounded analyst-decision and assertion projection embedded only after deliberate selection for an investigation capsule.',
});

export const LOOKUP_INVESTIGATION_BRIEF_COMPATIBILITY = defineSchemaCompatibility({
  id: 'derived.lookup-investigation-brief', kind: 'derived', schema: LOOKUP_INVESTIGATION_BRIEF_SCHEMA,
  tier: 'durable_interchange',
  currentVersion: LOOKUP_INVESTIGATION_BRIEF_VERSION, supportedVersions: SUPPORTED_LOOKUP_INVESTIGATION_BRIEF_VERSIONS,
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'read_only', writeSemantics: 'none',
  byteBudget: MAX_LOOKUP_INVESTIGATION_BRIEF_BYTES, owner: INVESTIGATION_PORTABILITY_CONTRACT_OWNER,
  note: 'Version 2 replaces the public version-1 summary and decision-entry arrays with one bounded canonical Decision Fact projection; public version 1 remains structurally verified when embedded in supported capsule versions.',
});

export const INVESTIGATION_PORTABILITY_COMPATIBILITY = Object.freeze([
  ACQUISITION_DECISION_PACKET_COMPATIBILITY,
  LOOKUP_CLAIM_PASSPORT_COMPATIBILITY,
  BULK_DOMAIN_COMPARISON_COMPATIBILITY,
  BULK_MAIL_EXPOSURE_COMPATIBILITY,
  BULK_REVIEW_MANIFEST_COMPATIBILITY,
  INVESTIGATION_CAPSULE_COMPATIBILITY,
  LOOKUP_ASSET_GRAPH_COMPATIBILITY,
  INVESTIGATION_CAPSULE_ANALYST_RECORDS_COMPATIBILITY,
  LOOKUP_INVESTIGATION_BRIEF_COMPATIBILITY,
]);

const INVESTIGATION_FIXTURES = Object.freeze([
  { id: 'acquisition-decision-v2', path: 'test/fixtures/investigation-portability/acquisition-decision-v2.json', bytes: 6_278, sha256: '1c1b5c2fcea2886dae5661085f605d95317b89bb6d9774cb8967a754ef8165bf', schema: ACQUISITION_DECISION_PACKET_SCHEMA, version: 2, role: 'current' as const },
  { id: 'lookup-claim-passport-v1', path: 'test/fixtures/investigation-portability/lookup-claim-passport-v1.json', bytes: 2_011, sha256: 'dbf1c3975282e340b6639162a0555aeaed42c06abe92ed3b354409ce73c284a4', schema: LOOKUP_CLAIM_PASSPORT_SCHEMA, version: 1, role: 'current' as const },
  { id: 'bulk-domain-comparison-v4', path: 'test/fixtures/investigation-portability/bulk-domain-comparison-v4.json', bytes: 17_079, sha256: 'b718af34c8f5f1ba4427807cd149561bc1b7e605a6e74206a694beaee078cc2d', schema: BULK_DOMAIN_COMPARISON_SCHEMA, version: 4, role: 'current' as const },
  { id: 'bulk-mail-exposure-v2', path: 'test/fixtures/investigation-portability/bulk-mail-exposure-v2.json', bytes: 2_582, sha256: '9ff6c4c9f2dda4c5451daf8fb11e36a3ee15b513a09ad3c93515cc37df5d6660', schema: BULK_MAIL_EXPOSURE_SCHEMA, version: 2, role: 'current' as const },
  { id: 'bulk-review-manifest-v2', path: 'test/fixtures/investigation-portability/bulk-review-manifest-v2.json', bytes: 1_657, sha256: '1c90f4d0661357fc277360cc924f2464e463f9c8bd815a6b45408e95e1caf7d3', schema: BULK_REVIEW_MANIFEST_SCHEMA, version: 2, role: 'current' as const },
  { id: 'investigation-capsule-v2', path: 'test/fixtures/investigation-capsule-v2.json', bytes: 3_286, sha256: 'fb71cb243020d401e3653bb714f9de07a71b81622fcf83c0027599b763dda070', schema: INVESTIGATION_CAPSULE_SCHEMA, version: 2, role: 'historical' as const },
  { id: 'investigation-capsule-v3', path: 'test/fixtures/investigation-portability/investigation-capsule-v3.json', bytes: 6_132, sha256: '685123c8bd152ee1a8074441bcd56bbde9fb0304aa4a320ee9b37d02061ed82a', schema: INVESTIGATION_CAPSULE_SCHEMA, version: 3, role: 'current' as const },
  { id: 'lookup-asset-graph-v2', path: 'test/fixtures/investigation-portability/lookup-asset-graph-v2.json', bytes: 1_157, sha256: '455397a2b2987180d54657199e76c4dc175e01aed0fa83d945a6f3ec30bdcd49', schema: LOOKUP_ASSET_GRAPH_SCHEMA, version: 2, role: 'current' as const },
  { id: 'investigation-analyst-records-v1', path: 'test/fixtures/investigation-portability/investigation-analyst-records-v1.json', bytes: 624, sha256: '0730116afef29e52b448e150f6755e89ec1189c2fbc6ec4ef8cfc4b41f677456', schema: INVESTIGATION_CAPSULE_ANALYST_RECORDS_SCHEMA, version: 1, role: 'current' as const },
  { id: 'lookup-investigation-brief-v1', path: 'test/fixtures/investigation-portability/lookup-investigation-brief-v1.json', bytes: 1_651, sha256: 'bc21c886671370659149c3e494c7e6061302569308823c69ef96f0c601dadbab', schema: LOOKUP_INVESTIGATION_BRIEF_SCHEMA, version: 1, role: 'historical' as const },
  { id: 'lookup-investigation-brief-v2', path: 'test/fixtures/investigation-portability/lookup-investigation-brief-v2.json', bytes: 1_724, sha256: '25d0133318df8daa00848e6a2c03913478beb30818a4959298ec1500b6aaa0fd', schema: LOOKUP_INVESTIGATION_BRIEF_SCHEMA, version: 2, role: 'current' as const },
].map((fixture) => Object.freeze({
  ...fixture,
  contentDigestSha256: null,
  expectation: 'accepted_exact' as const,
  expectedOutputFixtureId: null,
  scope: 'repository' as const,
})));

function investigationFixtureIds(schema: string, version: number): readonly string[] {
  return Object.freeze(INVESTIGATION_FIXTURES
    .filter((fixture) => fixture.schema === schema && fixture.version === version)
    .map((fixture) => fixture.id));
}

function investigationContract(input: Readonly<{
  compatibilityId: string;
  schema: string;
  version: number;
  currentVersion: number;
  canonicalisation: string | null;
  byteBudget: number | null;
}>) {
  return Object.freeze({
    compatibilityId: input.compatibilityId,
    schema: input.schema,
    version: input.version,
    role: 'document' as const,
    lifecycle: input.version === input.currentVersion ? 'current' as const : 'legacy' as const,
    readable: true,
    emitted: input.version === input.currentVersion,
    exactKeys: true,
    extensionPolicy: 'reject' as const,
    futureVersionBehaviour: 'reject' as const,
    migrationTarget: null,
    canonicalisation: input.canonicalisation,
    byteBudget: input.byteBudget,
    fixtureIds: investigationFixtureIds(input.schema, input.version),
  });
}

const INVESTIGATION_CONTRACTS = Object.freeze([
  ...SUPPORTED_ACQUISITION_DECISION_PACKET_VERSIONS.map((version) => investigationContract({ compatibilityId: ACQUISITION_DECISION_PACKET_COMPATIBILITY.id, schema: ACQUISITION_DECISION_PACKET_SCHEMA, version, currentVersion: ACQUISITION_DECISION_PACKET_VERSION, canonicalisation: 'sorted-json-v2', byteBudget: MAX_INVESTIGATION_PORTABLE_BYTES })),
  investigationContract({ compatibilityId: LOOKUP_CLAIM_PASSPORT_COMPATIBILITY.id, schema: LOOKUP_CLAIM_PASSPORT_SCHEMA, version: LOOKUP_CLAIM_PASSPORT_VERSION, currentVersion: LOOKUP_CLAIM_PASSPORT_VERSION, canonicalisation: 'sorted-json-v2', byteBudget: MAX_LOOKUP_CLAIM_PASSPORT_BYTES }),
  ...SUPPORTED_BULK_DOMAIN_COMPARISON_EXPORT_VERSIONS.map((version) => investigationContract({ compatibilityId: BULK_DOMAIN_COMPARISON_COMPATIBILITY.id, schema: BULK_DOMAIN_COMPARISON_SCHEMA, version, currentVersion: BULK_DOMAIN_COMPARISON_EXPORT_VERSION, canonicalisation: 'sorted-json-v2', byteBudget: MAX_INVESTIGATION_PORTABLE_BYTES })),
  ...SUPPORTED_BULK_MAIL_EXPOSURE_EXPORT_VERSIONS.map((version) => investigationContract({ compatibilityId: BULK_MAIL_EXPOSURE_COMPATIBILITY.id, schema: BULK_MAIL_EXPOSURE_SCHEMA, version, currentVersion: BULK_MAIL_EXPOSURE_EXPORT_VERSION, canonicalisation: 'sorted-json-v2', byteBudget: MAX_INVESTIGATION_PORTABLE_BYTES })),
  ...SUPPORTED_BULK_REVIEW_MANIFEST_VERSIONS.map((version) => investigationContract({ compatibilityId: BULK_REVIEW_MANIFEST_COMPATIBILITY.id, schema: BULK_REVIEW_MANIFEST_SCHEMA, version, currentVersion: BULK_REVIEW_MANIFEST_VERSION, canonicalisation: 'sorted-json-v2', byteBudget: MAX_INVESTIGATION_PORTABLE_BYTES })),
  ...SUPPORTED_INVESTIGATION_CAPSULE_VERSIONS.map((version) => investigationContract({ compatibilityId: INVESTIGATION_CAPSULE_COMPATIBILITY.id, schema: INVESTIGATION_CAPSULE_SCHEMA, version, currentVersion: INVESTIGATION_CAPSULE_VERSION, canonicalisation: 'sorted-json-v2', byteBudget: MAX_INVESTIGATION_PORTABLE_BYTES })),
  investigationContract({ compatibilityId: LOOKUP_ASSET_GRAPH_COMPATIBILITY.id, schema: LOOKUP_ASSET_GRAPH_SCHEMA, version: LOOKUP_ASSET_GRAPH_VERSION, currentVersion: LOOKUP_ASSET_GRAPH_VERSION, canonicalisation: null, byteBudget: null }),
  investigationContract({ compatibilityId: INVESTIGATION_CAPSULE_ANALYST_RECORDS_COMPATIBILITY.id, schema: INVESTIGATION_CAPSULE_ANALYST_RECORDS_SCHEMA, version: INVESTIGATION_CAPSULE_ANALYST_RECORDS_VERSION, currentVersion: INVESTIGATION_CAPSULE_ANALYST_RECORDS_VERSION, canonicalisation: null, byteBudget: null }),
  ...SUPPORTED_LOOKUP_INVESTIGATION_BRIEF_VERSIONS.map((version) => investigationContract({ compatibilityId: LOOKUP_INVESTIGATION_BRIEF_COMPATIBILITY.id, schema: LOOKUP_INVESTIGATION_BRIEF_SCHEMA, version, currentVersion: LOOKUP_INVESTIGATION_BRIEF_VERSION, canonicalisation: null, byteBudget: MAX_LOOKUP_INVESTIGATION_BRIEF_BYTES })),
]);

function investigationShape(
  id: string,
  schema: string,
  versions: readonly number[],
  requiredKeys: readonly string[],
  normalisation: 'preserve_document' | 'preserve_signed_document',
) {
  return Object.freeze({
    id,
    schema,
    versions,
    objects: [{ path: '$', requiredKeys, optionalKeys: [], unknownKeys: 'reject' as const }],
    fixedArrays: [],
    normalisation,
    target: null,
  });
}

const INVESTIGATION_SHAPES = Object.freeze([
  investigationShape('investigation.acquisition.v2', ACQUISITION_DECISION_PACKET_SCHEMA, [...SUPPORTED_ACQUISITION_DECISION_PACKET_VERSIONS], ['schema', 'version', 'generatedAt', 'target', 'synthetic', 'evidenceObservedAt', 'analystReview', 'evidenceReview', 'limitations', 'integrity'], 'preserve_signed_document'),
  investigationShape('investigation.claim-passport.v1', LOOKUP_CLAIM_PASSPORT_SCHEMA, [LOOKUP_CLAIM_PASSPORT_VERSION], ['schema', 'version', 'generatedAt', 'application', 'target', 'observation', 'claim', 'models', 'limitations', 'integrity'], 'preserve_signed_document'),
  investigationShape('investigation.domain-comparison.v4', BULK_DOMAIN_COMPARISON_SCHEMA, [...SUPPORTED_BULK_DOMAIN_COMPARISON_EXPORT_VERSIONS], ['schema', 'version', 'generatedAt', 'comparison', 'integrity'], 'preserve_signed_document'),
  investigationShape('investigation.mail-exposure.v2', BULK_MAIL_EXPOSURE_SCHEMA, [...SUPPORTED_BULK_MAIL_EXPOSURE_EXPORT_VERSIONS], ['schema', 'version', 'report', 'integrity'], 'preserve_signed_document'),
  investigationShape('investigation.bulk-review.v2', BULK_REVIEW_MANIFEST_SCHEMA, [...SUPPORTED_BULK_REVIEW_MANIFEST_VERSIONS], ['schema', 'version', 'generatedAt', 'observedAt', 'lookupProfile', 'selection', 'view', 'rows', 'limitations', 'integrity'], 'preserve_signed_document'),
  investigationShape('investigation.capsule.v2-v3', INVESTIGATION_CAPSULE_SCHEMA, [...SUPPORTED_INVESTIGATION_CAPSULE_VERSIONS], ['schema', 'schemaVersion', 'generatedAt', 'application', 'target', 'sourceContracts', 'investigationBrief', 'graphSnapshot', 'analystRecords', 'limitations', 'integrity'], 'preserve_signed_document'),
  investigationShape('investigation.asset-graph.v2', LOOKUP_ASSET_GRAPH_SCHEMA, [LOOKUP_ASSET_GRAPH_VERSION], ['version', 'targetId', 'nodes', 'edges', 'sources', 'truncated', 'limitations'], 'preserve_document'),
  investigationShape('investigation.analyst-records.v1', INVESTIGATION_CAPSULE_ANALYST_RECORDS_SCHEMA, [INVESTIGATION_CAPSULE_ANALYST_RECORDS_VERSION], ['caseId', 'status', 'disposition', 'decisions', 'assertions'], 'preserve_document'),
  investigationShape('investigation.brief.v1', LOOKUP_INVESTIGATION_BRIEF_SCHEMA, [PUBLIC_LOOKUP_INVESTIGATION_BRIEF_VERSION], ['schema', 'schemaVersion', 'generatedAt', 'target', 'targetType', 'task', 'taskLabel', 'question', 'summary', 'observation', 'verifiedFacts', 'contradictions', 'unknowns', 'nextActions', 'relationships', 'limitations'], 'preserve_document'),
  investigationShape('investigation.brief.v2', LOOKUP_INVESTIGATION_BRIEF_SCHEMA, [LOOKUP_INVESTIGATION_BRIEF_VERSION], ['schema', 'schemaVersion', 'generatedAt', 'target', 'targetType', 'task', 'taskLabel', 'question', 'summary', 'observation', 'decisionFacts', 'relationships', 'limitations'], 'preserve_document'),
]);

const investigationConsumerCommon = Object.freeze({
  expiryPolicyId: 'investigation.expiry.not-applicable',
  requestMode: 'none' as const,
  bindingState: 'declared_unenforced' as const,
  policyState: 'current' as const,
});

export const INVESTIGATION_PORTABILITY_LIFECYCLE_FAMILY = defineSchemaLifecycleFamily({
  id: 'investigation-portability',
  owner: INVESTIGATION_PORTABILITY_CONTRACT_OWNER,
  privacy: 'analyst_authored_sensitive',
  compatibility: INVESTIGATION_PORTABILITY_COMPATIBILITY,
  contracts: INVESTIGATION_CONTRACTS,
  fixtures: INVESTIGATION_FIXTURES,
  metadata: {
    metadataVersion: 3,
    enforcement: 'declarative_only',
    shapes: INVESTIGATION_SHAPES,
    boundProfiles: [
      { id: 'investigation.portable.bounds', bounds: [
        { id: 'raw-bytes', path: '$', phase: 'raw_intake', unit: 'bytes', minimum: 1, maximum: MAX_INVESTIGATION_PORTABLE_BYTES, handling: 'reject' },
        { id: 'serialised-bytes', path: '$', phase: 'serialised', unit: 'bytes', minimum: 1, maximum: MAX_INVESTIGATION_PORTABLE_BYTES, handling: 'reject' },
      ] },
      { id: 'investigation.passport.bounds', bounds: [
        { id: 'raw-bytes', path: '$', phase: 'raw_intake', unit: 'bytes', minimum: 1, maximum: MAX_LOOKUP_CLAIM_PASSPORT_BYTES, handling: 'reject' },
        { id: 'serialised-bytes', path: '$', phase: 'serialised', unit: 'bytes', minimum: 1, maximum: MAX_LOOKUP_CLAIM_PASSPORT_BYTES, handling: 'reject' },
      ] },
      { id: 'investigation.brief.bounds', bounds: [
        { id: 'raw-bytes', path: '$', phase: 'raw_intake', unit: 'bytes', minimum: 1, maximum: MAX_LOOKUP_INVESTIGATION_BRIEF_BYTES, handling: 'reject' },
        { id: 'serialised-bytes', path: '$', phase: 'serialised', unit: 'bytes', minimum: 1, maximum: MAX_LOOKUP_INVESTIGATION_BRIEF_BYTES, handling: 'reject' },
      ] },
      { id: 'investigation.derived.bounds', bounds: [
        { id: 'projection-items', path: '$', phase: 'normalised', unit: 'items', minimum: 0, maximum: 2_000, handling: 'truncate' },
      ] },
    ],
    hooks: [
      { id: 'investigation.offline.structure', role: 'structure_validator', runtime: 'cli', module: 'cli/artifact-structure.mts', exportName: 'validateOfflineArtifactStructure' },
      { id: 'investigation.offline.verify', role: 'integrity_verifier', runtime: 'cli', module: 'cli/artifact-verify.mts', exportName: 'verifyOfflineArtifact' },
      { id: 'investigation.acquisition.build', role: 'builder', runtime: 'shared', module: 'packages/investigation/acquisition-decision-packet.mts', exportName: 'buildAcquisitionDecisionPacket' },
      { id: 'investigation.passport.build', role: 'builder', runtime: 'shared', module: 'packages/investigation/lookup-claim-passport.mts', exportName: 'buildLookupClaimPassport' },
      { id: 'investigation.domain-comparison.build', role: 'builder', runtime: 'shared', module: 'packages/investigation/bulk-domain-comparison.mts', exportName: 'buildBulkDomainComparisonExport' },
      { id: 'investigation.mail-exposure.build', role: 'builder', runtime: 'shared', module: 'packages/investigation/bulk-mail-exposure.mts', exportName: 'buildBulkMailExposureExport' },
      { id: 'investigation.bulk-review.build', role: 'builder', runtime: 'shared', module: 'packages/investigation/bulk-review-export.mts', exportName: 'buildBulkReviewManifest' },
      { id: 'investigation.capsule.build', role: 'builder', runtime: 'shared', module: 'packages/investigation/investigation-capsule.mts', exportName: 'buildInvestigationCapsule' },
      { id: 'investigation.capsule.verify', role: 'integrity_verifier', runtime: 'shared', module: 'packages/investigation/investigation-capsule.mts', exportName: 'verifyInvestigationCapsule' },
      { id: 'investigation.capsule.serialise', role: 'serialiser', runtime: 'shared', module: 'packages/investigation/investigation-capsule.mts', exportName: 'serializeInvestigationCapsule' },
      { id: 'investigation.graph.build', role: 'builder', runtime: 'shared', module: 'packages/investigation/lookup-asset-graph.mts', exportName: 'buildLookupAssetGraph' },
      { id: 'investigation.brief.build', role: 'builder', runtime: 'shared', module: 'packages/investigation/lookup-investigation-brief.mts', exportName: 'buildLookupInvestigationBrief' },
    ],
    serialisationProfiles: [{
      id: 'investigation.capsule.json.v2-v3',
      schema: INVESTIGATION_CAPSULE_SCHEMA,
      versions: [...SUPPORTED_INVESTIGATION_CAPSULE_VERSIONS],
      mediaType: 'application/json',
      encoding: 'utf-8',
      bom: false,
      indentSpaces: 2,
      terminalLf: true,
      propertyOrder: 'normalised_fixed',
      canonicalisation: null,
      integrity: 'structural_only_requires_separate_verification',
      serializerHookId: 'investigation.capsule.serialise',
      verifierHookIds: ['investigation.capsule.verify'],
    }],
    privacyProfiles: [
      { id: 'investigation.privacy.input', classification: 'analyst_authored_sensitive', projection: 'browser_import', includedCategories: ['bounded-investigation-projections', 'source-qualified-evidence-states', 'declared-integrity'], excludedCategories: ['raw-upstream-payloads', 'expanded-contacts', 'credentials', 'cookies', 'query-bearing-urls'], notePolicy: 'allowed_bounded', retention: 'deliberate_local_file', network: 'none', sharingReview: 'required' },
      { id: 'investigation.privacy.output', classification: 'analyst_authored_sensitive', projection: 'browser_export', includedCategories: ['bounded-investigation-projections', 'source-qualified-evidence-states', 'declared-integrity'], excludedCategories: ['raw-upstream-payloads', 'expanded-contacts', 'credentials', 'cookies', 'query-bearing-urls'], notePolicy: 'allowed_bounded', retention: 'operator_controlled_output', network: 'none', sharingReview: 'required' },
    ],
    expiryProfiles: [{ id: 'investigation.expiry.not-applicable', field: null, anchor: null, handling: 'not_applicable', phase: 'not_applicable', maximumLifetimeDays: null }],
    consumerEdges: [
      {
        id: 'investigation.consumer.offline-verify', plane: 'cli', operation: 'validate-structure-and-integrity',
        acceptedContracts: [
          { schema: ACQUISITION_DECISION_PACKET_SCHEMA, versions: [...SUPPORTED_ACQUISITION_DECISION_PACKET_VERSIONS], mode: 'direct' },
          { schema: LOOKUP_CLAIM_PASSPORT_SCHEMA, versions: [LOOKUP_CLAIM_PASSPORT_VERSION], mode: 'direct' },
          { schema: BULK_DOMAIN_COMPARISON_SCHEMA, versions: [...SUPPORTED_BULK_DOMAIN_COMPARISON_EXPORT_VERSIONS], mode: 'direct' },
          { schema: BULK_MAIL_EXPOSURE_SCHEMA, versions: [...SUPPORTED_BULK_MAIL_EXPOSURE_EXPORT_VERSIONS], mode: 'direct' },
          { schema: BULK_REVIEW_MANIFEST_SCHEMA, versions: [...SUPPORTED_BULK_REVIEW_MANIFEST_VERSIONS], mode: 'direct' },
          { schema: INVESTIGATION_CAPSULE_SCHEMA, versions: [...SUPPORTED_INVESTIGATION_CAPSULE_VERSIONS], mode: 'direct' },
        ],
        emittedContract: null,
        shapeIds: ['investigation.acquisition.v2', 'investigation.claim-passport.v1', 'investigation.domain-comparison.v4', 'investigation.mail-exposure.v2', 'investigation.bulk-review.v2', 'investigation.capsule.v2-v3'],
        boundProfileIds: ['investigation.portable.bounds', 'investigation.passport.bounds'],
        hookIds: ['investigation.offline.structure', 'investigation.offline.verify'],
        serialisationProfileId: null,
        privacyProfileId: 'investigation.privacy.input', retentionEffect: 'deliberate_local_file', ...investigationConsumerCommon,
      },
      {
        id: 'investigation.consumer.capsule-compose', plane: 'shared', operation: 'compose-and-verify-capsule',
        acceptedContracts: [
          { schema: LOOKUP_ASSET_GRAPH_SCHEMA, versions: [LOOKUP_ASSET_GRAPH_VERSION], mode: 'embedded' },
          { schema: INVESTIGATION_CAPSULE_ANALYST_RECORDS_SCHEMA, versions: [INVESTIGATION_CAPSULE_ANALYST_RECORDS_VERSION], mode: 'embedded' },
          { schema: LOOKUP_INVESTIGATION_BRIEF_SCHEMA, versions: [...SUPPORTED_LOOKUP_INVESTIGATION_BRIEF_VERSIONS], mode: 'embedded' },
        ],
        emittedContract: { schema: INVESTIGATION_CAPSULE_SCHEMA, version: INVESTIGATION_CAPSULE_VERSION },
        shapeIds: ['investigation.asset-graph.v2', 'investigation.analyst-records.v1', 'investigation.brief.v1', 'investigation.brief.v2', 'investigation.capsule.v2-v3'],
        boundProfileIds: ['investigation.portable.bounds', 'investigation.brief.bounds', 'investigation.derived.bounds'],
        hookIds: ['investigation.capsule.build', 'investigation.capsule.verify', 'investigation.capsule.serialise'],
        serialisationProfileId: 'investigation.capsule.json.v2-v3',
        privacyProfileId: 'investigation.privacy.output', retentionEffect: 'operator_controlled_output', ...investigationConsumerCommon,
      },
      ...([
        ['investigation.consumer.acquisition-build', ACQUISITION_DECISION_PACKET_SCHEMA, ACQUISITION_DECISION_PACKET_VERSION, 'investigation.acquisition.v2', 'investigation.acquisition.build', 'investigation.portable.bounds'],
        ['investigation.consumer.passport-build', LOOKUP_CLAIM_PASSPORT_SCHEMA, LOOKUP_CLAIM_PASSPORT_VERSION, 'investigation.claim-passport.v1', 'investigation.passport.build', 'investigation.passport.bounds'],
        ['investigation.consumer.domain-comparison-build', BULK_DOMAIN_COMPARISON_SCHEMA, BULK_DOMAIN_COMPARISON_EXPORT_VERSION, 'investigation.domain-comparison.v4', 'investigation.domain-comparison.build', 'investigation.portable.bounds'],
        ['investigation.consumer.mail-exposure-build', BULK_MAIL_EXPOSURE_SCHEMA, BULK_MAIL_EXPOSURE_EXPORT_VERSION, 'investigation.mail-exposure.v2', 'investigation.mail-exposure.build', 'investigation.portable.bounds'],
        ['investigation.consumer.bulk-review-build', BULK_REVIEW_MANIFEST_SCHEMA, BULK_REVIEW_MANIFEST_VERSION, 'investigation.bulk-review.v2', 'investigation.bulk-review.build', 'investigation.portable.bounds'],
        ['investigation.consumer.graph-build', LOOKUP_ASSET_GRAPH_SCHEMA, LOOKUP_ASSET_GRAPH_VERSION, 'investigation.asset-graph.v2', 'investigation.graph.build', 'investigation.derived.bounds'],
        ['investigation.consumer.analyst-records-project', INVESTIGATION_CAPSULE_ANALYST_RECORDS_SCHEMA, INVESTIGATION_CAPSULE_ANALYST_RECORDS_VERSION, 'investigation.analyst-records.v1', 'investigation.capsule.build', 'investigation.derived.bounds'],
        ['investigation.consumer.brief-build', LOOKUP_INVESTIGATION_BRIEF_SCHEMA, LOOKUP_INVESTIGATION_BRIEF_VERSION, 'investigation.brief.v2', 'investigation.brief.build', 'investigation.brief.bounds'],
      ] as const).map(([id, schema, version, shapeId, hookId, boundProfileId]) => ({
        id, plane: 'shared' as const, operation: 'build-current-projection', acceptedContracts: [],
        emittedContract: { schema, version }, shapeIds: [shapeId], boundProfileIds: [boundProfileId],
        hookIds: [hookId], serialisationProfileId: null,
        privacyProfileId: 'investigation.privacy.output', retentionEffect: 'operator_controlled_output' as const,
        ...investigationConsumerCommon,
      })),
    ],
    consumerRelationships: [],
  },
});
