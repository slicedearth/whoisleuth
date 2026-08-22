import { defineSchemaCompatibility } from './schema-compatibility.mts';
import { buildExtractedLifecycleFamilyV2 } from './extracted-domain-lifecycle.mts';
import { defineSchemaLifecycleFamily } from './schema-lifecycle.mts';
import {
  ANALYST_REVIEW_STATE_SCHEMA,
  ANALYST_REVIEW_STATE_SCHEMA_VERSION,
  ANALYST_REVIEW_STATE_SUPPORTED_VERSIONS,
  MAX_ANALYST_REVIEW_STATE_BYTES,
} from './analyst-review-state-contract.mts';

export * from './analyst-review-state-contract.mts';

export const ANALYST_REVIEW_STATE_CONTRACT_OWNER = 'packages/contracts/analyst-review-state.mts';

export const ANALYST_REVIEW_STATE_COMPATIBILITY = defineSchemaCompatibility({
  id: 'browser.analyst-review-state',
  kind: 'browser_store',
  schema: ANALYST_REVIEW_STATE_SCHEMA,
  currentVersion: ANALYST_REVIEW_STATE_SCHEMA_VERSION,
  supportedVersions: ANALYST_REVIEW_STATE_SUPPORTED_VERSIONS,
  acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'preserve_without_write',
  migration: 'exact_current_only',
  writeSemantics: 'optimistic_replace',
  byteBudget: MAX_ANALYST_REVIEW_STATE_BYTES,
  owner: ANALYST_REVIEW_STATE_CONTRACT_OWNER,
  note: 'Bounded analyst-authored lifecycle overlay. Material evidence changes, expiry, and incomplete evidence reopen review without rewriting source evidence or losing earlier rationale.',
});

export const ANALYST_REVIEW_STATE_LIFECYCLE_FAMILY = defineSchemaLifecycleFamily(buildExtractedLifecycleFamilyV2({
  id: 'analyst-review-state',
  owner: ANALYST_REVIEW_STATE_CONTRACT_OWNER,
  serializerModule: 'packages/monitoring/analyst-review-state.mts',
  serializerExportName: 'serialiseAnalystReviewStateJson',
  plane: 'browser',
  projection: 'browser_export',
  retention: 'operator_controlled_output',
  includedCategories: ['subject-identity', 'material-fingerprint', 'analyst-disposition', 'rationale', 'review-times', 'case-and-campaign-references'],
  excludedCategories: ['raw-upstream-responses', 'expanded-contacts', 'complete-query-urls', 'credentials', 'cookies', 'certificate-transparency-history'],
  formats: [{
    descriptor: ANALYST_REVIEW_STATE_COMPATIBILITY,
    lifecycleSchema: ANALYST_REVIEW_STATE_SCHEMA,
    requiredKeys: ['schema', 'version', 'records'],
    optionalKeys: [],
    hook: {
      module: 'packages/monitoring/analyst-review-state.mts',
      exportName: 'normalizeAnalystReviewStateStore',
      role: 'normaliser',
      runtime: 'shared',
    },
    fixtures: [{
      id: 'analyst-review-state-v1',
      path: 'test/fixtures/extracted-domain-lifecycle/analyst-review-state-v1.json',
      bytes: 83,
      sha256: '4c2215a69dcb2b3108e37a71061edae57c74946fbed5856f63330358cbb5a830',
      version: ANALYST_REVIEW_STATE_SCHEMA_VERSION,
    }],
  }],
}));
