import { defineSchemaCompatibility } from './schema-compatibility.mts';
import { buildExtractedLifecycleFamily } from './extracted-domain-lifecycle.mts';
import { defineSchemaLifecycleFamily } from './schema-lifecycle.mts';

export const CASE_DRAFT_SCHEMA = 'whoisleuth.case-drafts';
export const CASE_DRAFT_VERSION = 1;
export const MAX_CASE_DRAFT_BYTES = 64 * 1024;
export const MAX_CASE_DRAFT_STORE_BYTES = 8 * 1024 * 1024;
export const MAX_CASE_DRAFT_RECORDS = 2000;

export type CaseDraftFields = Record<string, string | boolean | string[] | Record<string, string>[]>;
export type CaseDraftReceipt = Readonly<{ id: string; revision: string }>;
export type CaseDraftRecord = CaseDraftReceipt & Readonly<{
  caseId: string;
  form: string;
  formVersion: number;
  updatedAt: string;
  fields: CaseDraftFields;
}>;
export type CaseDraftStore = Readonly<{
  schema: typeof CASE_DRAFT_SCHEMA;
  version: typeof CASE_DRAFT_VERSION;
  records: readonly CaseDraftRecord[];
}>;

export const CASE_DRAFT_COMPATIBILITY = defineSchemaCompatibility({
  id: 'browser.case-drafts', kind: 'browser_store', schema: CASE_DRAFT_SCHEMA,
  currentVersion: CASE_DRAFT_VERSION, supportedVersions: [CASE_DRAFT_VERSION],
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'preserve_without_write',
  migration: 'exact_current_only', writeSemantics: 'optimistic_replace',
  byteBudget: MAX_CASE_DRAFT_STORE_BYTES, owner: 'packages/contracts/case-drafts.mts',
  note: 'Workspace-local unfinished Case forms. Drafts are not evidence or submitted records and are excluded from portable exports.',
});

export const CASE_DRAFT_LIFECYCLE_FAMILY = /* @__PURE__ */ defineSchemaLifecycleFamily(/* @__PURE__ */ buildExtractedLifecycleFamily({
  id: 'case-drafts', owner: 'packages/contracts/case-drafts.mts',
  serializerModule: 'packages/cases/case-drafts.mts', serializerExportName: 'serializeCaseDraftStore',
  plane: 'browser', projection: 'browser_import', retention: 'browser_indexeddb', notePolicy: 'allowed_bounded',
  includedCategories: ['case-reference', 'unfinished-form-values', 'local-revision', 'draft-time'],
  excludedCategories: ['collected-source-payloads', 'password-controls', 'session-credentials', 'public-export'],
  formats: [{
    descriptor: CASE_DRAFT_COMPATIBILITY, lifecycleSchema: CASE_DRAFT_SCHEMA,
    requiredKeys: ['schema', 'version', 'records'], optionalKeys: [],
    hook: { module: 'packages/cases/case-drafts.mts', exportName: 'normalizeCaseDraftStore', role: 'normaliser', runtime: 'shared' },
    fixtures: [{ id: 'case-drafts-v1', path: 'test/fixtures/extracted-domain-lifecycle/case-drafts-v1.json', version: 1,
      bytes: 289, sha256: 'a2108e7323fec7aaadee20dc6b1dacb662649a9fdf32eaed900c754a9d56ee09' }],
  }],
}));
