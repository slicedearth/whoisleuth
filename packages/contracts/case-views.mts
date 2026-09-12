import { defineSchemaCompatibility } from './schema-compatibility.mts';
import { buildExtractedLifecycleFamily } from './extracted-domain-lifecycle.mts';
import { defineSchemaLifecycleFamily } from './schema-lifecycle.mts';
import { CASE_VIEWS_SCHEMA, CASE_VIEWS_VERSION, MAX_CASE_VIEWS_BYTES } from './case-views-contract.mts';

export const CASE_VIEWS_COMPATIBILITY = defineSchemaCompatibility({
  id: 'browser.case-views', kind: 'browser_store', schema: CASE_VIEWS_SCHEMA,
  currentVersion: CASE_VIEWS_VERSION, supportedVersions: [CASE_VIEWS_VERSION],
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'preserve_without_write',
  migration: 'exact_current_only', writeSemantics: 'optimistic_replace',
  byteBudget: MAX_CASE_VIEWS_BYTES, owner: 'packages/contracts/case-views.mts',
  note: 'Workspace-local named Case filters. Saved views retain no result set and grant no collection authority; workspace exports include their names and search text.',
});

export const CASE_VIEWS_LIFECYCLE_FAMILY = /* @__PURE__ */ defineSchemaLifecycleFamily(/* @__PURE__ */ buildExtractedLifecycleFamily({
  id: 'case-views', owner: 'packages/contracts/case-views.mts',
  serializerModule: 'packages/workspace/case-views.mts', serializerExportName: 'serialiseCaseViewsJson',
  plane: 'browser', projection: 'browser_import', retention: 'browser_indexeddb', notePolicy: 'allowed_bounded',
  includedCategories: ['saved-filter-name', 'case-status-and-disposition', 'search-text', 'sort-order', 'authored-times'],
  excludedCategories: ['matching-case-records', 'source-evidence', 'collection-authorisation', 'public-response-packets'],
  formats: [{
    descriptor: CASE_VIEWS_COMPATIBILITY, lifecycleSchema: CASE_VIEWS_SCHEMA,
    requiredKeys: ['schema', 'version', 'views'], optionalKeys: [],
    hook: { module: 'packages/workspace/case-views.mts', exportName: 'normalizeCaseViewsStore', role: 'normaliser', runtime: 'shared' },
    fixtures: [{ id: 'case-views-v1', path: 'test/fixtures/extracted-domain-lifecycle/case-views-v1.json', version: 1,
      bytes: 408, sha256: '015592dd0d6f4536b5960be9325b8d3b8c136eaab195d82383ab9a320a03f855' }],
  }],
}));
