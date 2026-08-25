import { defineSchemaCompatibility } from './schema-compatibility.mts';
import { buildExtractedLifecycleFamilyV2 } from './extracted-domain-lifecycle.mts';
import { defineSchemaLifecycleFamily } from './schema-lifecycle.mts';

export const INVESTIGATION_PROJECTION_CONTRACT_OWNER = 'packages/contracts/investigation-projections.mts';
export const CAMPAIGN_TEMPORAL_REVIEW_SCHEMA = 'whoisleuth.campaign-temporal-review';
export const CAMPAIGN_TEMPORAL_REVIEW_VERSION = 1;
export const PARENT_DOMAIN_CAMPAIGN_REVIEW_SCHEMA = 'whoisleuth.parent-domain-campaign-review';
export const PARENT_DOMAIN_CAMPAIGN_REVIEW_VERSION = 1;
export const MAX_PARENT_DOMAIN_CAMPAIGN_REVIEW_BYTES = 512 * 1024;
export const OBSERVATION_ENVELOPE_SCHEMA = 'whoisleuth.observation-envelope';
export const OBSERVATION_ENVELOPE_VERSION = 1;
export const MAX_OBSERVATION_ENVELOPE_BYTES = 8 * 1024 * 1024;
export const INVESTIGATION_PROJECTION_SCHEMA = 'whoisleuth.investigation-projection';
export const INVESTIGATION_PROJECTION_VERSION = 1;
export const INVESTIGATION_SEARCH_SCHEMA = 'whoisleuth.investigation-search-index';
export const INVESTIGATION_SEARCH_VERSION = 1;

const CAMPAIGN_TEMPORAL_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.campaign-temporal-review', kind: 'export', schema: CAMPAIGN_TEMPORAL_REVIEW_SCHEMA,
  currentVersion: CAMPAIGN_TEMPORAL_REVIEW_VERSION, supportedVersions: [CAMPAIGN_TEMPORAL_REVIEW_VERSION],
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only',
  writeSemantics: 'read_only', byteBudget: null, owner: INVESTIGATION_PROJECTION_CONTRACT_OWNER,
  note: 'Integrity-protected local projection of source-qualified case pins and sightings. Retained timestamps are not global first-seen or service-activation times.',
});
const PARENT_DOMAIN_CAMPAIGN_REVIEW_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.parent-domain-campaign-review', kind: 'export', schema: PARENT_DOMAIN_CAMPAIGN_REVIEW_SCHEMA,
  currentVersion: PARENT_DOMAIN_CAMPAIGN_REVIEW_VERSION, supportedVersions: [PARENT_DOMAIN_CAMPAIGN_REVIEW_VERSION],
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only',
  writeSemantics: 'read_only', byteBudget: MAX_PARENT_DOMAIN_CAMPAIGN_REVIEW_BYTES,
  owner: INVESTIGATION_PROJECTION_CONTRACT_OWNER,
  note: 'Deliberate bounded local export of exact retained submitted-hostname observations grouped by registrable parent; transient response-scope selection is excluded.',
});
const OBSERVATION_ENVELOPE_COMPATIBILITY = defineSchemaCompatibility({
  id: 'derived.observation-envelope', kind: 'derived', schema: OBSERVATION_ENVELOPE_SCHEMA,
  currentVersion: OBSERVATION_ENVELOPE_VERSION, supportedVersions: [OBSERVATION_ENVELOPE_VERSION],
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only',
  writeSemantics: 'none', byteBudget: MAX_OBSERVATION_ENVELOPE_BYTES,
  owner: INVESTIGATION_PROJECTION_CONTRACT_OWNER,
  note: 'Disposable typed adapter over authoritative browser-local records; it performs no writes and preserves source schema, provenance, partialness, and rollback state.',
});
const INVESTIGATION_PROJECTION_COMPATIBILITY = defineSchemaCompatibility({
  id: 'derived.investigation-projection', kind: 'derived', schema: INVESTIGATION_PROJECTION_SCHEMA,
  currentVersion: INVESTIGATION_PROJECTION_VERSION, supportedVersions: [INVESTIGATION_PROJECTION_VERSION],
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only',
  writeSemantics: 'none', byteBudget: null, owner: INVESTIGATION_PROJECTION_CONTRACT_OWNER,
  note: 'Read-only bounded projection over existing stores; never persisted.',
});
const INVESTIGATION_SEARCH_COMPATIBILITY = defineSchemaCompatibility({
  id: 'derived.investigation-search', kind: 'derived', schema: INVESTIGATION_SEARCH_SCHEMA,
  currentVersion: INVESTIGATION_SEARCH_VERSION, supportedVersions: [INVESTIGATION_SEARCH_VERSION],
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only',
  writeSemantics: 'none', byteBudget: null, owner: INVESTIGATION_PROJECTION_CONTRACT_OWNER,
  note: 'Disposable in-memory index; never persisted or transmitted.',
});

export function serialiseInvestigationProjectionJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export const INVESTIGATION_PROJECTIONS_LIFECYCLE_FAMILY = defineSchemaLifecycleFamily(buildExtractedLifecycleFamilyV2({
  id: 'investigation-projections',
  owner: INVESTIGATION_PROJECTION_CONTRACT_OWNER,
  serializerExportName: 'serialiseInvestigationProjectionJson',
  plane: 'shared',
  projection: 'review_output',
  retention: 'transient_report',
  includedCategories: ['source-identity', 'provenance', 'freshness', 'completeness', 'bounded-relationships', 'exact-investigated-hostnames'],
  excludedCategories: ['raw-upstream-responses', 'expanded-contacts', 'credentials', 'cookies', 'complete-query-urls'],
  formats: [
    {
      descriptor: CAMPAIGN_TEMPORAL_COMPATIBILITY,
      lifecycleSchema: CAMPAIGN_TEMPORAL_REVIEW_SCHEMA,
      requiredKeys: ['schema', 'version', 'generatedAt', 'campaign', 'review', 'integrity'], optionalKeys: [],
      hook: { module: 'packages/investigation/campaign-temporal-review.mts', exportName: 'buildCampaignTemporalExport', role: 'builder', runtime: 'shared' },
      fixtures: [{ id: 'campaign-temporal-review-v1', path: 'test/fixtures/extracted-domain-lifecycle/campaign-temporal-review-v1.json', bytes: 534, sha256: '77340b4a096aa52a84d8a200aacf43d4f22a959fab66c54c4faae099089c2255', version: CAMPAIGN_TEMPORAL_REVIEW_VERSION }],
    },
    {
      descriptor: PARENT_DOMAIN_CAMPAIGN_REVIEW_COMPATIBILITY,
      lifecycleSchema: PARENT_DOMAIN_CAMPAIGN_REVIEW_SCHEMA,
      requiredKeys: ['schema', 'version', 'generatedAt', 'campaign', 'review'], optionalKeys: [],
      hook: { module: 'packages/investigation/parent-domain-campaign-review.mts', exportName: 'buildParentDomainCampaignReviewExport', role: 'builder', runtime: 'shared' },
      fixtures: [{ id: 'parent-domain-campaign-review-v1', path: 'test/fixtures/extracted-domain-lifecycle/parent-domain-campaign-review-v1.json', bytes: 755, sha256: '621af44f8168df35b97c8c8d0b37176e2f369b734c39d3ad53bda12e162cfb3d', version: PARENT_DOMAIN_CAMPAIGN_REVIEW_VERSION }],
    },
    {
      descriptor: OBSERVATION_ENVELOPE_COMPATIBILITY,
      lifecycleSchema: OBSERVATION_ENVELOPE_SCHEMA,
      requiredKeys: ['schema', 'version', 'generatedAt', 'adapter', 'entities', 'observations', 'relationships', 'artifactReferences', 'assertions', 'quota', 'rollback', 'limitations'], optionalKeys: [],
      hook: { module: 'packages/investigation/observation-envelope.mts', exportName: 'adaptRelationshipObservationsToEnvelope', role: 'normaliser', runtime: 'shared' },
      fixtures: [{ id: 'observation-envelope-domain-v1', path: 'test/fixtures/extracted-domain-lifecycle/observation-envelope-v1.json', bytes: 639, sha256: 'ddc750b78d2c56c9adecb6eb225fcbefc901bc4dace1d51b84a76b9e38353e37', version: OBSERVATION_ENVELOPE_VERSION }],
    },
    {
      descriptor: INVESTIGATION_PROJECTION_COMPATIBILITY,
      lifecycleSchema: INVESTIGATION_PROJECTION_SCHEMA,
      requiredKeys: ['schema', 'version', 'generatedAt', 'sources', 'entities', 'observations', 'relationships', 'truncated', 'limitations', 'counts'], optionalKeys: [],
      hook: { module: 'packages/investigation/investigation-projection.mts', exportName: 'buildInvestigationProjection', role: 'builder', runtime: 'shared' },
      fixtures: [{ id: 'investigation-projection-v1', path: 'test/fixtures/extracted-domain-lifecycle/investigation-projection-v1.json', bytes: 260, sha256: '15a6deae5a05b5208d691debef99123062cb663a849d7fcde3699430a62a2b2e', version: INVESTIGATION_PROJECTION_VERSION }],
    },
    {
      descriptor: INVESTIGATION_SEARCH_COMPATIBILITY,
      lifecycleSchema: INVESTIGATION_SEARCH_SCHEMA,
      requiredKeys: ['schema', 'version', 'state', 'generatedAt', 'projectionVersion', 'sources', 'entries', 'entityCount', 'termCount', 'truncated', 'limitations'], optionalKeys: [],
      hook: { module: 'packages/investigation/investigation-search.mts', exportName: 'buildInvestigationSearchIndex', role: 'builder', runtime: 'shared' },
      fixtures: [{ id: 'investigation-search-v1', path: 'test/fixtures/extracted-domain-lifecycle/investigation-search-v1.json', bytes: 233, sha256: '10a24322f33d859e1c6505f9ff5603c2e00909defbcd7e320b83aa3052e1e3fe', version: INVESTIGATION_SEARCH_VERSION }],
    },
  ],
}));
