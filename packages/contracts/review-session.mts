import { defineSchemaCompatibility } from './schema-compatibility.mts';
import { buildExtractedLifecycleFamily } from './extracted-domain-lifecycle.mts';
import { defineSchemaLifecycleFamily } from './schema-lifecycle.mts';
import { MAX_REVIEW_SESSION_BYTES, REVIEW_SESSION_SCHEMA, REVIEW_SESSION_VERSION } from './review-session-contract.mts';

export const REVIEW_SESSION_COMPATIBILITY = defineSchemaCompatibility({
  id: 'browser.review-session', kind: 'browser_store', schema: REVIEW_SESSION_SCHEMA,
  currentVersion: REVIEW_SESSION_VERSION, supportedVersions: [REVIEW_SESSION_VERSION],
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'preserve_without_write',
  migration: 'exact_current_only', writeSemantics: 'optimistic_replace', byteBudget: MAX_REVIEW_SESSION_BYTES,
  owner: 'packages/contracts/review-session.mts',
  note: 'Explicit workspace-local review position. Restoring it re-evaluates current evidence and never submits decisions, drafts or collection requests.',
});
export const REVIEW_SESSION_LIFECYCLE_FAMILY = /* @__PURE__ */ defineSchemaLifecycleFamily(/* @__PURE__ */ buildExtractedLifecycleFamily({
  id: 'review-session', owner: 'packages/contracts/review-session.mts',
  serializerModule: 'packages/workspace/review-session.mts', serializerExportName: 'serializeReviewSessionStore',
  plane: 'browser', projection: 'browser_import', retention: 'browser_indexeddb', notePolicy: 'allowed_bounded',
  includedCategories: ['review-filters', 'selected-review-reference', 'evidence-fingerprint', 'unfinished-review-forms', 'local-revision', 'save-time'],
  excludedCategories: ['collected-source-payloads', 'session-credentials', 'public-export'],
  formats: [{ descriptor: REVIEW_SESSION_COMPATIBILITY, lifecycleSchema: REVIEW_SESSION_SCHEMA,
    requiredKeys: ['schema', 'version', 'records'], optionalKeys: [],
    hook: { module: 'packages/workspace/review-session.mts', exportName: 'normalizeReviewSessionStore', role: 'normaliser', runtime: 'shared' },
    fixtures: [{ id: 'review-session-v1', path: 'test/fixtures/extracted-domain-lifecycle/review-session-v1.json', version: 1,
      bytes: 373, sha256: 'e4e6f048fb81218c369ec861e23a30b0b30b47ff0d45d1a3493d78237382bb6d' }],
  }],
}));
