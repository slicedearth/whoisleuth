import { MAX_DOMAIN_NAME_LENGTH } from './domain-name.mts';
import { defineSchemaCompatibility } from './schema-compatibility.mts';
import { defineSchemaLifecycleFamily } from './schema-lifecycle.mts';
import type { SchemaLifecycleFamilyWithMetadataV4 } from './schema-lifecycle.mts';

export const CASE_CONTRACT_OWNER = 'packages/contracts/case-portability.mts';
export const LATEST_PUBLIC_APPLICATION_VERSION = '2.0.1';

export const CASE_PORTABILITY_IDENTITY_CONSTANTS = Object.freeze([
  'LATEST_PUBLIC_APPLICATION_VERSION',
  'CASE_BROWSER_STORE_LIFECYCLE_SCHEMA',
  'CASE_EXPORT_LIFECYCLE_SCHEMA',
  'CASE_SCHEMA_VERSION',
  'CASE_BROWSER_SUPPORTED_VERSIONS',
  'CASE_IMPORT_VERSIONS',
  'CASE_REPORT_SCHEMA',
  'CASE_REPORT_SCHEMA_VERSION',
  'CASE_REPORT_OUTPUT_VERSIONS',
  'CASE_RESPONSE_PACKET_SCHEMA',
  'CASE_RESPONSE_PACKET_VERSION',
  'CASE_RESPONSE_PACKET_OUTPUT_VERSIONS',
  'SUPPORTED_CASE_RESPONSE_PACKET_VERSIONS',
  'CASE_RESPONSE_REVIEW_INPUTS_SCHEMA',
  'CASE_RESPONSE_REVIEW_INPUTS_VERSION',
  'SUPPORTED_CASE_RESPONSE_REVIEW_INPUTS_VERSIONS',
  'CLI_CASE_PACK_SCHEMA',
  'CLI_CASE_PACK_VERSION',
  'SUPPORTED_CLI_CASE_PACK_VERSIONS',
  'CLI_CASE_PACK_CASE_REPORT_EPOCHS',
  'WORKSPACE_ARCHIVE_SCHEMA',
  'PUBLIC_WORKSPACE_ARCHIVE_VERSION',
  'WORKSPACE_ARCHIVE_VERSION',
  'SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS',
  'PUBLIC_WORKSPACE_ARCHIVE_SECTION_IDS',
  'WORKSPACE_ARCHIVE_SECTION_IDS',
  'WORKSPACE_ARCHIVE_CASE_SECTION',
  'WORKSPACE_SETTINGS_SCHEMA',
  'WORKSPACE_SETTINGS_VERSION',
  'ENCRYPTED_WORKSPACE_ARCHIVE_SCHEMA',
  'ENCRYPTED_WORKSPACE_ARCHIVE_VERSION',
] as const);

export const CASE_PORTABILITY_BOUND_CONSTANTS = Object.freeze([
  'MAX_CASES',
  'MAX_NOTES_PER_CASE',
  'MAX_NOTE_LENGTH',
  'MAX_TAGS_PER_CASE',
  'MAX_CASE_IMPORT_BYTES',
  'MAX_CASE_STORE_BYTES',
  'MAX_EVIDENCE_SNAPSHOTS_PER_CASE',
  'MAX_EVIDENCE_FACTORS',
  'MAX_EVIDENCE_NAMESERVERS',
  'MAX_EVIDENCE_MUTATIONS',
  'MAX_EVIDENCE_STRING_LENGTH',
  'MAX_EVIDENCE_TITLE_LENGTH',
  'MAX_EVIDENCE_DETAIL_LENGTH',
  'MAX_EVIDENCE_CHANGES',
  'MAX_CASE_BRAND_PROFILE_IDS',
  'MAX_CASE_BRAND_PROFILE_ID_CANDIDATES',
  'MAX_CASE_EVIDENCE_PINS',
  'MAX_CASE_CHECKPOINT_FACTS',
  'MAX_CASE_DECISIONS',
  'MAX_CASE_ACTIONS',
  'MAX_CASE_ACTION_EVENTS_PER_ACTION',
  'MAX_CASE_ACTION_EVENTS_PER_CASE',
  'MAX_CASE_ACTION_BYTES',
  'MAX_CASE_ACTION_HISTORY_BYTES_PER_CASE',
  'MAX_CASE_OBSERVED_EFFECT_REVIEWS',
  'MAX_CASE_CLOSURES',
  'MAX_CASE_ASSERTIONS',
  'MAX_CASE_MANUAL_TRAIL_EVENTS',
  'MAX_CASE_SIGHTINGS',
  'MAX_RESPONSE_LABEL_LENGTH',
  'MAX_RESPONSE_VALUE_LENGTH',
  'MAX_RESPONSE_RATIONALE_LENGTH',
  'MAX_RESPONSE_RECIPIENT_LENGTH',
  'MAX_RESPONSE_REFERENCE_LENGTH',
  'MAX_RESPONSE_LIMITATIONS',
  'MAX_RESPONSE_LIMITATION_LENGTH',
  'MAX_DECISION_PIN_REFERENCES',
  'MAX_TRAIL_TARGET_LENGTH',
  'MAX_ASSERTION_PROVENANCE_LABELS',
  'MAX_ASSERTION_PROVENANCE_MARKINGS',
  'MAX_ABUSIVE_URLS',
  'MAX_RESPONSE_CONTACTS',
  'MAX_RESPONSE_ACTION_HISTORY',
  'MAX_RESPONSE_HARM_LENGTH',
  'MAX_AFFECTED_PARTY_LENGTH',
  'MAX_ABUSE_CATEGORY_LENGTH',
  'MAX_EXACT_URL_LENGTH',
  'MAX_RESPONSE_ARTEFACT_REFERENCES',
  'MAX_RESPONSE_SELECTED_EVIDENCE',
  'MAX_RESPONSE_CONTRADICTIONS',
  'RESPONSE_ROUTE_STALE_AFTER_DAYS',
  'MAX_RESPONSE_AUTHORISATION_CLOCK_SKEW_MS',
  'MAX_CASE_PACK_INPUT_BYTES',
  'MAX_CASE_PACK_CASES',
  'MAX_WORKSPACE_ARCHIVE_BYTES',
  'MAX_WORKSPACE_ARCHIVE_SECTION_BYTES',
  'MAX_WORKSPACE_ARCHIVE_SECTIONS',
  'WORKSPACE_ARCHIVE_PBKDF2_ITERATIONS',
  'MIN_WORKSPACE_ARCHIVE_PASSPHRASE_CHARACTERS',
  'MAX_WORKSPACE_ARCHIVE_PASSPHRASE_BYTES',
  'MAX_ENCRYPTED_WORKSPACE_ARCHIVE_BYTES',
] as const);

export const CASE_DOMAIN_COMPATIBILITY_FACADES = Object.freeze([
  ['frontend/src/lib/analysis/case-brand-profile-references.ts', 'packages/cases/case-brand-profile-references.mts'],
  ['frontend/src/lib/analysis/case-evidence-model.ts', 'packages/cases/case-evidence-model.mts'],
  ['frontend/src/lib/analysis/case-investigation-branch-model.ts', 'packages/cases/case-investigation-branch-model.mts'],
  ['frontend/src/lib/analysis/case-migration-model.ts', 'packages/cases/case-migration-model.mts'],
  ['frontend/src/lib/analysis/case-model.ts', 'packages/cases/case-model.mts'],
  ['frontend/src/lib/analysis/case-record-contracts.ts', 'packages/cases/case-record-contracts.mts'],
  ['frontend/src/lib/analysis/case-record-core.ts', 'packages/cases/case-record-core.mts'],
  ['frontend/src/lib/analysis/case-record-model.ts', 'packages/cases/case-record-model.mts'],
  ['frontend/src/lib/analysis/case-record-operations.ts', 'packages/cases/case-record-operations.mts'],
  ['frontend/src/lib/analysis/case-report.ts', 'packages/cases/case-report.mts'],
  ['frontend/src/lib/analysis/case-response-model.ts', 'packages/cases/case-response-model.mts'],
  ['frontend/src/lib/analysis/case-response-packet.ts', 'packages/cases/case-response-packet.mts'],
  ['frontend/src/lib/analysis/case-storage-model.ts', 'packages/cases/case-storage-model.mts'],
  ['frontend/src/lib/analysis/http-summary.ts', 'packages/cases/http-summary.mts'],
  ['frontend/src/lib/analysis/opaque-reference-id.ts', 'packages/cases/opaque-reference-id.mts'],
  ['frontend/src/lib/analysis/workspace-archive.ts', 'packages/workspace/workspace-archive.mts'],
  ['frontend/src/lib/analysis/workspace-archive-crypto.ts', 'packages/workspace/workspace-archive-crypto.mts'],
] as const);

export const CASE_DOMAIN_RUNTIME_ADAPTERS = Object.freeze([
  'frontend/src/lib/cases.ts',
  'frontend/src/lib/workspace-archive.ts',
] as const);

export const CASE_BROWSER_STORE_LIFECYCLE_SCHEMA = 'whoisleuth.browser.case-store';
export const CASE_EXPORT_LIFECYCLE_SCHEMA = 'whoisleuth.case-export';
export const PUBLIC_CASE_SCHEMA_VERSION = 12;
export const PUBLISHED_V2_CASE_SCHEMA_VERSION = 13;
export const CASE_SCHEMA_VERSION = 14;
export const CASE_BROWSER_SUPPORTED_VERSIONS = Object.freeze([
  PUBLIC_CASE_SCHEMA_VERSION,
  PUBLISHED_V2_CASE_SCHEMA_VERSION,
  CASE_SCHEMA_VERSION,
] as const);
export const CASE_IMPORT_VERSIONS = CASE_BROWSER_SUPPORTED_VERSIONS;

export const CASE_REPORT_SCHEMA = 'whoisleuth.case-report';
export const PUBLIC_CASE_REPORT_SCHEMA_VERSION = 8;
export const PUBLISHED_V2_CASE_REPORT_SCHEMA_VERSION = 9;
export const CASE_REPORT_SCHEMA_VERSION = 10;
export const CASE_REPORT_OUTPUT_VERSIONS = Object.freeze([
  PUBLISHED_V2_CASE_REPORT_SCHEMA_VERSION,
  CASE_REPORT_SCHEMA_VERSION,
] as const);

export const CASE_RESPONSE_PACKET_SCHEMA = 'whoisleuth.case-response-packet';
export const PUBLIC_CASE_RESPONSE_PACKET_VERSION = 6;
export const PUBLISHED_V2_CASE_RESPONSE_PACKET_VERSION = 7;
export const CASE_RESPONSE_PACKET_VERSION = 8;
export const CASE_RESPONSE_PACKET_OUTPUT_VERSIONS = Object.freeze([
  PUBLIC_CASE_RESPONSE_PACKET_VERSION,
  PUBLISHED_V2_CASE_RESPONSE_PACKET_VERSION,
  CASE_RESPONSE_PACKET_VERSION,
] as const);
export const SUPPORTED_CASE_RESPONSE_PACKET_VERSIONS = CASE_RESPONSE_PACKET_OUTPUT_VERSIONS;
export const CASE_RESPONSE_REVIEW_INPUTS_SCHEMA = 'whoisleuth.case-response-review-inputs';
export const PUBLISHED_V2_CASE_RESPONSE_REVIEW_INPUTS_VERSION = 1;
export const CASE_RESPONSE_REVIEW_INPUTS_VERSION = 2;
export const SUPPORTED_CASE_RESPONSE_REVIEW_INPUTS_VERSIONS = Object.freeze([
  PUBLISHED_V2_CASE_RESPONSE_REVIEW_INPUTS_VERSION,
  CASE_RESPONSE_REVIEW_INPUTS_VERSION,
] as const);

export const CLI_CASE_PACK_SCHEMA = 'whoisleuth.cli.case-pack';
export const CLI_CASE_PACK_VERSION = 2;
export const SUPPORTED_CLI_CASE_PACK_VERSIONS = Object.freeze([CLI_CASE_PACK_VERSION] as const);
export const CLI_CASE_PACK_ROOT_KEYS = Object.freeze(['version', 'exportedAt', 'cases', 'packet', 'integrity'] as const);
export const CLI_CASE_PACK_PACKET_KEYS = Object.freeze(['schema', 'version', 'audience', 'reviewed', 'reports', 'redactionManifest', 'limitations'] as const);
export const CLI_CASE_PACK_PUBLIC_REPORT_KEYS = Object.freeze(['schema', 'schemaVersion', 'generatedAt', 'application', 'case', 'currentAssessment', 'evidenceTimeline', 'analystResponse', 'limitations'] as const);
export const CLI_CASE_PACK_REPORT_KEYS = Object.freeze(['schema', 'schemaVersion', 'generatedAt', 'application', 'case', 'currentAssessment', 'evidenceTimeline', 'analystResponse', 'responseLifecycle', 'limitations'] as const);
export const CLI_CASE_PACK_INTEGRITY_KEYS = Object.freeze(['algorithm', 'canonicalization', 'digestSha256'] as const);
export const CLI_CASE_PACK_CURRENT_REDACTION_KEYS = Object.freeze(['excluded', 'sourceCaseCount', 'brandProfileReferencesOmitted'] as const);
export const CLI_CASE_PACK_LIMITATIONS = Object.freeze([
  'This local package is browser-importable through its top-level case collection and does not upload or submit evidence.',
  'The reviewed flag records a deliberate CLI choice; it does not prove recipient authorisation, factual correctness, or legal sufficiency.',
  'Importing the package does not restore fields excluded by its audience profile.',
] as const);
export const CLI_CASE_PACK_CASE_REPORT_EPOCHS = Object.freeze([
  Object.freeze({ caseVersions: Object.freeze([PUBLIC_CASE_SCHEMA_VERSION] as const), reportVersions: Object.freeze([PUBLIC_CASE_REPORT_SCHEMA_VERSION] as const) }),
  Object.freeze({ caseVersions: Object.freeze([PUBLISHED_V2_CASE_SCHEMA_VERSION] as const), reportVersions: Object.freeze([PUBLISHED_V2_CASE_REPORT_SCHEMA_VERSION] as const) }),
  Object.freeze({ caseVersions: Object.freeze([CASE_SCHEMA_VERSION] as const), reportVersions: Object.freeze([CASE_REPORT_SCHEMA_VERSION] as const) }),
] as const);

export function caseReportVersionMatchesCase(caseVersion: number, reportVersion: unknown): boolean {
  return typeof reportVersion === 'number'
    && Number.isSafeInteger(reportVersion)
    && CLI_CASE_PACK_CASE_REPORT_EPOCHS.some((epoch) => (
      epoch.caseVersions.some((version) => version === caseVersion)
      && epoch.reportVersions.some((version) => version === reportVersion)
    ));
}

export const WORKSPACE_ARCHIVE_SCHEMA = 'whoisleuth.workspace-archive';
export const PUBLIC_WORKSPACE_ARCHIVE_VERSION = 5;
export const PUBLISHED_V2_WORKSPACE_ARCHIVE_VERSION = 6;
export const WORKSPACE_ARCHIVE_VERSION = 7;
export const SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS = Object.freeze([
  PUBLIC_WORKSPACE_ARCHIVE_VERSION,
  PUBLISHED_V2_WORKSPACE_ARCHIVE_VERSION,
  WORKSPACE_ARCHIVE_VERSION,
] as const);
export function isSupportedWorkspaceArchiveVersion(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS.some((version) => version === value);
}
export const WORKSPACE_ARCHIVE_SECTION_IDS = Object.freeze([
  'cases', 'campaigns', 'brandProfiles', 'watchlists', 'shortlist', 'detectionRules',
  'relationshipObservations', 'bulkSessions', 'websiteSnapshots', 'investigationTemplates',
  'bulkReview', 'analystReviewState', 'settings',
] as const);
export const PUBLIC_WORKSPACE_ARCHIVE_SECTION_IDS = Object.freeze(
  WORKSPACE_ARCHIVE_SECTION_IDS.filter((id) => id !== 'analystReviewState'),
);
export const WORKSPACE_ARCHIVE_CASE_SECTION = Object.freeze({
  id: 'cases',
  schema: null,
  currentVersion: CASE_SCHEMA_VERSION,
  supportedVersions: CASE_IMPORT_VERSIONS,
});
export const WORKSPACE_SETTINGS_SCHEMA = 'whoisleuth.workspace-settings';
export const WORKSPACE_SETTINGS_VERSION = 1;
export const ENCRYPTED_WORKSPACE_ARCHIVE_SCHEMA = 'whoisleuth.encrypted-workspace-archive';
export const ENCRYPTED_WORKSPACE_ARCHIVE_VERSION = 1;

export const CASE_PORTABILITY_VERIFIER_DISPATCH = Object.freeze([
  Object.freeze({
    id: 'case-response-packet',
    artifactKind: 'case_response_packet',
    schema: CASE_RESPONSE_PACKET_SCHEMA,
    discriminator: 'root_schema',
    versionField: 'schemaVersion',
    supportedVersions: SUPPORTED_CASE_RESPONSE_PACKET_VERSIONS,
    structureHookId: 'case.packet.structure',
    integrityHookId: 'case.packet.verify',
  }),
  Object.freeze({
    id: 'cli-case-pack',
    artifactKind: 'cli_case_pack',
    schema: CLI_CASE_PACK_SCHEMA,
    discriminator: 'packet_schema',
    versionField: 'packet.version',
    supportedVersions: SUPPORTED_CLI_CASE_PACK_VERSIONS,
    structureHookId: 'case.cli-pack.verify',
    integrityHookId: 'case.cli-pack.verify',
  }),
] as const);

export const MAX_CASES = 500;
export const MAX_NOTES_PER_CASE = 50;
export const MAX_NOTE_LENGTH = 2000;
export const MAX_TAGS_PER_CASE = 20;
export const MAX_TAG_LENGTH = 40;
export const MAX_DOMAIN_LENGTH = MAX_DOMAIN_NAME_LENGTH;
export const MAX_CASE_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_CASE_STORE_BYTES = 4 * 1024 * 1024;
export const MAX_EVIDENCE_SNAPSHOTS_PER_CASE = 25;
export const MAX_EVIDENCE_FACTORS = 20;
export const MAX_EVIDENCE_NAMESERVERS = 12;
export const MAX_EVIDENCE_MUTATIONS = 20;
export const MAX_EVIDENCE_STRING_LENGTH = 200;
export const MAX_EVIDENCE_TITLE_LENGTH = 200;
export const MAX_EVIDENCE_DETAIL_LENGTH = 200;
export const MAX_EVIDENCE_CHANGES = 40;
export const MAX_CASE_BRAND_PROFILE_IDS = 8;
export const MAX_CASE_BRAND_PROFILE_ID_CANDIDATES = 32;
export const MAX_CASE_EVIDENCE_PINS = 40;
export const MAX_CASE_CHECKPOINT_FACTS = 20;
export const MAX_CASE_DECISIONS = 30;
export const MAX_CASE_ACTIONS = 50;
export const MAX_CASE_ACTION_EVENTS_PER_ACTION = 40;
export const MAX_CASE_ACTION_EVENTS_PER_CASE = 400;
export const MAX_CASE_ACTION_BYTES = 32 * 1024;
export const MAX_CASE_ACTION_HISTORY_BYTES_PER_CASE = 512 * 1024;
export const MAX_CASE_OBSERVED_EFFECT_REVIEWS = 40;
export const MAX_CASE_CLOSURES = 12;
export const MAX_CASE_ASSERTIONS = 50;
export const MAX_CASE_MANUAL_TRAIL_EVENTS = 80;
export const MAX_CASE_SIGHTINGS = 80;
export const MAX_RESPONSE_LABEL_LENGTH = 80;
export const MAX_RESPONSE_VALUE_LENGTH = 1000;
export const MAX_RESPONSE_RATIONALE_LENGTH = 2000;
export const MAX_RESPONSE_RECIPIENT_LENGTH = 320;
export const MAX_RESPONSE_REFERENCE_LENGTH = 500;
export const MAX_RESPONSE_LIMITATIONS = 8;
export const MAX_RESPONSE_LIMITATION_LENGTH = 240;
export const MAX_DECISION_PIN_REFERENCES = 20;
export const MAX_TRAIL_TARGET_LENGTH = 500;
export const MAX_ASSERTION_PROVENANCE_LABELS = 20;
export const MAX_ASSERTION_PROVENANCE_MARKINGS = 12;
export const MAX_ABUSIVE_URLS = 20;
export const MAX_RESPONSE_CONTACTS = 12;
export const MAX_RESPONSE_ACTION_HISTORY = 20;
export const MAX_RESPONSE_HARM_LENGTH = 2000;
export const MAX_AFFECTED_PARTY_LENGTH = 200;
export const MAX_ABUSE_CATEGORY_LENGTH = 80;
export const MAX_EXACT_URL_LENGTH = 2048;
export const MAX_RESPONSE_ARTEFACT_REFERENCES = 12;
export const MAX_RESPONSE_SELECTED_EVIDENCE = 20;
export const MAX_RESPONSE_CONTRADICTIONS = 20;
export const RESPONSE_ROUTE_STALE_AFTER_DAYS = 30;
export const MAX_RESPONSE_AUTHORISATION_CLOCK_SKEW_MS = 300_000;
export const MAX_CASE_PACK_INPUT_BYTES = 4 * 1024 * 1024;
export const MAX_CASE_PACK_CASES = 25;
export const MAX_WORKSPACE_ARCHIVE_BYTES = 10 * 1024 * 1024;
export const MAX_WORKSPACE_ARCHIVE_SECTION_BYTES = 5 * 1024 * 1024;
export const MAX_WORKSPACE_ARCHIVE_SECTIONS = 13;
export const WORKSPACE_ARCHIVE_PBKDF2_ITERATIONS = 600_000;
export const MIN_WORKSPACE_ARCHIVE_PASSPHRASE_CHARACTERS = 12;
export const MAX_WORKSPACE_ARCHIVE_PASSPHRASE_BYTES = 1024;
export const MAX_ENCRYPTED_WORKSPACE_ARCHIVE_BYTES = Math.ceil(MAX_WORKSPACE_ARCHIVE_BYTES * 4 / 3) + 4096;

export const CASE_BROWSER_COMPATIBILITY = defineSchemaCompatibility({
  id: 'browser.cases', kind: 'browser_store', schema: null, currentVersion: CASE_SCHEMA_VERSION,
  supportedVersions: CASE_BROWSER_SUPPORTED_VERSIONS, acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current',
  writeSemantics: 'normalized_rewrite', byteBudget: MAX_CASE_STORE_BYTES, owner: CASE_CONTRACT_OWNER,
  note: 'Exact Case versions 12 and 13 migrate directly to current version 14; other retired stores are rejected and future stores remain untouched.',
});
export const CASE_EXPORT_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.cases', kind: 'export', schema: null, currentVersion: CASE_SCHEMA_VERSION,
  supportedVersions: CASE_IMPORT_VERSIONS, acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'reject', migration: 'normalize_to_current',
  writeSemantics: 'non_destructive_merge', byteBudget: MAX_CASE_IMPORT_BYTES, owner: CASE_CONTRACT_OWNER,
  note: 'Exact Case versions 12, 13 and 14 merge non-destructively through one bounded reader; other versions fail without mutation.',
});
export const CASE_REPORT_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.case-report', kind: 'export', schema: CASE_REPORT_SCHEMA, currentVersion: CASE_REPORT_SCHEMA_VERSION,
  supportedVersions: CASE_REPORT_OUTPUT_VERSIONS, acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'reject', migration: 'read_only', writeSemantics: 'read_only',
  byteBudget: null, owner: CASE_CONTRACT_OWNER,
  note: 'Published Case report version 9 and current version 10 are exact readable output contracts; retired and future report versions are unsupported.',
});
export const CASE_RESPONSE_PACKET_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.case-response-packet', kind: 'export', schema: CASE_RESPONSE_PACKET_SCHEMA,
  currentVersion: CASE_RESPONSE_PACKET_VERSION, supportedVersions: CASE_RESPONSE_PACKET_OUTPUT_VERSIONS,
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'read_only',
  writeSemantics: 'read_only', byteBudget: null, owner: CASE_CONTRACT_OWNER,
  note: 'Exact packet versions 6, 7 and 8 are verified independently; other versions fail closed.',
});
export const CASE_RESPONSE_REVIEW_INPUTS_COMPATIBILITY = defineSchemaCompatibility({
  id: 'derived.case-response-review-inputs', kind: 'derived', schema: CASE_RESPONSE_REVIEW_INPUTS_SCHEMA,
  currentVersion: CASE_RESPONSE_REVIEW_INPUTS_VERSION, supportedVersions: SUPPORTED_CASE_RESPONSE_REVIEW_INPUTS_VERSIONS,
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'read_only',
  writeSemantics: 'read_only', byteBudget: null, owner: CASE_CONTRACT_OWNER,
  note: 'Exact published review-input version 1 and current version 2 remain independently readable for response authorisation; extensions and future versions fail closed.',
});
export const CLI_CASE_PACK_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.cli-case-pack', kind: 'export', schema: CLI_CASE_PACK_SCHEMA, currentVersion: CLI_CASE_PACK_VERSION,
  supportedVersions: SUPPORTED_CLI_CASE_PACK_VERSIONS, acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'reject', migration: 'read_only', writeSemantics: 'read_only',
  byteBudget: MAX_CASE_IMPORT_BYTES, owner: CASE_CONTRACT_OWNER,
  note: 'Case-pack version 2 verifies exact Case/report epochs 12/8, 13/9 and 14/10 with deterministic sorted-json-v2 integrity.',
});
export const WORKSPACE_ARCHIVE_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.workspace-archive', kind: 'export', schema: WORKSPACE_ARCHIVE_SCHEMA,
  currentVersion: WORKSPACE_ARCHIVE_VERSION, supportedVersions: SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS,
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'normalize_to_current',
  writeSemantics: 'non_destructive_merge', byteBudget: MAX_WORKSPACE_ARCHIVE_BYTES, owner: CASE_CONTRACT_OWNER,
  note: 'Workspace version 7 carries the current Case contract. Exact versions 5 and 6 remain readable; version 5 gains an empty Review Item section without inventing decisions, and future envelopes fail without mutation.',
});
export const WORKSPACE_SETTINGS_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.workspace-settings-section', kind: 'export', schema: WORKSPACE_SETTINGS_SCHEMA,
  currentVersion: WORKSPACE_SETTINGS_VERSION, supportedVersions: [WORKSPACE_SETTINGS_VERSION],
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only',
  writeSemantics: 'non_destructive_merge', byteBudget: null, owner: CASE_CONTRACT_OWNER,
  note: 'Nested archive section limited to the active Brand Profile identifier and dark, light, or system theme preference.',
});
export const ENCRYPTED_WORKSPACE_ARCHIVE_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.encrypted-workspace-archive', kind: 'export', schema: ENCRYPTED_WORKSPACE_ARCHIVE_SCHEMA,
  currentVersion: ENCRYPTED_WORKSPACE_ARCHIVE_VERSION, supportedVersions: [ENCRYPTED_WORKSPACE_ARCHIVE_VERSION],
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only',
  writeSemantics: 'non_destructive_merge', byteBudget: MAX_ENCRYPTED_WORKSPACE_ARCHIVE_BYTES,
  owner: CASE_CONTRACT_OWNER,
  note: 'Version 1 is the exact PBKDF2 and AES-GCM wrapper for supported ordinary workspace envelopes; passphrases remain transient.',
});
export const CASE_PORTABILITY_COMPATIBILITY = Object.freeze([
  CASE_BROWSER_COMPATIBILITY, CASE_EXPORT_COMPATIBILITY, CASE_REPORT_COMPATIBILITY,
  CASE_RESPONSE_PACKET_COMPATIBILITY, CASE_RESPONSE_REVIEW_INPUTS_COMPATIBILITY,
  CLI_CASE_PACK_COMPATIBILITY, WORKSPACE_ARCHIVE_COMPATIBILITY,
  WORKSPACE_SETTINGS_COMPATIBILITY,
  ENCRYPTED_WORKSPACE_ARCHIVE_COMPATIBILITY,
] as const);

export function serialiseCasePortableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Canonical compact bytes used for workspace-section checksums and byte counts. */
export function serialiseWorkspaceArchiveSection(value: unknown): string {
  const serialised = JSON.stringify(value);
  if (typeof serialised !== 'string') {
    throw new TypeError('Workspace archive sections must be JSON-serialisable documents.');
  }
  return serialised;
}

const CASE_LIFECYCLE_FIXTURES = Object.freeze([
  Object.freeze({
    id: 'browser-case-v12-public',
    path: 'test/fixtures/case-lifecycle/browser-case-v12.json',
    bytes: 1286,
    sha256: '86d4f3be343034ff05f1214229294d9c6424ccc13fc63e884358fb691b2e0d4e',
    contentDigestSha256: null,
    schema: CASE_BROWSER_STORE_LIFECYCLE_SCHEMA,
    version: PUBLIC_CASE_SCHEMA_VERSION,
    role: 'historical' as const,
    expectation: 'normalises_to_current_output' as const,
    expectedOutputFixtureId: 'browser-case-v14',
    shapeId: 'case.browser-store.public',
    scope: 'repository' as const,
  }),
  Object.freeze({
    id: 'browser-case-v13',
    path: 'test/fixtures/case-lifecycle/browser-case-v13.json',
    bytes: 3096,
    sha256: 'd679030e52340ecc7795ac88de15316d88c8c07b94b34da60fd52589a0375712',
    contentDigestSha256: null,
    schema: CASE_BROWSER_STORE_LIFECYCLE_SCHEMA,
    version: PUBLISHED_V2_CASE_SCHEMA_VERSION,
    role: 'historical' as const,
    expectation: 'normalises_to_current_output' as const,
    expectedOutputFixtureId: 'browser-case-v14',
    shapeId: 'case.browser-store.v13',
    scope: 'repository' as const,
  }),
  Object.freeze({
    id: 'browser-case-v14',
    path: 'test/fixtures/case-lifecycle/browser-case-v14.json',
    bytes: 3131,
    sha256: 'ece46f5d27a52a20196678af8236674836f3979c0d45f0ad5751c00677ec8bae',
    contentDigestSha256: null,
    schema: CASE_BROWSER_STORE_LIFECYCLE_SCHEMA,
    version: CASE_SCHEMA_VERSION,
    role: 'current' as const,
    expectation: 'accepted_exact' as const,
    expectedOutputFixtureId: null,
    shapeId: 'case.browser-store.current',
    scope: 'repository' as const,
  }),
  Object.freeze({
    id: 'case-export-v12-public',
    path: 'test/fixtures/case-v12-response-lifecycle.json',
    bytes: 1290,
    sha256: 'c5182bc1d413a1e1940e06e158d8dde47971d3fb034090934fe600753ffd7f0b',
    contentDigestSha256: null,
    schema: CASE_EXPORT_LIFECYCLE_SCHEMA,
    version: PUBLIC_CASE_SCHEMA_VERSION,
    role: 'historical' as const,
    expectation: 'normalises_to_current_output' as const,
    expectedOutputFixtureId: 'case-export-v14',
    shapeId: 'case.export.public',
    scope: 'repository' as const,
  }),
  Object.freeze({
    id: 'case-export-v13',
    path: 'test/fixtures/case-lifecycle/case-export-v13.json',
    bytes: 3140,
    sha256: 'fd2aa7623c2aaea385b952727ad74cf5af0f1ee21dc478c0e5c820a332376a0d',
    contentDigestSha256: null,
    schema: CASE_EXPORT_LIFECYCLE_SCHEMA,
    version: PUBLISHED_V2_CASE_SCHEMA_VERSION,
    role: 'historical' as const,
    expectation: 'normalises_to_current_output' as const,
    expectedOutputFixtureId: 'case-export-v14',
    shapeId: 'case.export.v13',
    scope: 'repository' as const,
  }),
  Object.freeze({
    id: 'case-export-v14',
    path: 'test/fixtures/case-lifecycle/case-export-v14.json',
    bytes: 3175,
    sha256: '50cf1df53c3558852b712844d588d9eb955af858e160969d9a6af613c257feaf',
    contentDigestSha256: null,
    schema: CASE_EXPORT_LIFECYCLE_SCHEMA,
    version: CASE_SCHEMA_VERSION,
    role: 'current' as const,
    expectation: 'accepted_exact' as const,
    expectedOutputFixtureId: null,
    shapeId: 'case.export.current',
    scope: 'repository' as const,
  }),
  Object.freeze({
    id: 'case-response-packet-v6-public',
    path: 'test/fixtures/case-lifecycle/case-response-packet-v6.json',
    bytes: 5100,
    sha256: '32030d3941119dce378dc03f6b3f5d710ce3883e7253cd43fa322c989ff529cb',
    contentDigestSha256: 'sha256:29a5185a3d944af38c9656706fe89d96e60f949e8684646a55c8bcd10de54746',
    schema: CASE_RESPONSE_PACKET_SCHEMA,
    version: PUBLIC_CASE_RESPONSE_PACKET_VERSION,
    role: 'historical' as const,
    expectation: 'accepted_exact' as const,
    expectedOutputFixtureId: null,
    shapeId: 'case.response-packet.v6',
    scope: 'repository' as const,
  }),
  Object.freeze({
    id: 'case-report-v9',
    path: 'test/fixtures/case-lifecycle/case-report-v9.json',
    bytes: 2761,
    sha256: 'd9903318123c63ae7a385f153286a5596585a401771c8def8149792b9b7b9326',
    contentDigestSha256: null,
    schema: CASE_REPORT_SCHEMA,
    version: PUBLISHED_V2_CASE_REPORT_SCHEMA_VERSION,
    role: 'historical' as const,
    expectation: 'accepted_exact' as const,
    expectedOutputFixtureId: null,
    shapeId: 'case.report.v9',
    scope: 'repository' as const,
  }),
  Object.freeze({
    id: 'case-report-v10',
    path: 'test/fixtures/case-lifecycle/case-report-v10.json',
    bytes: 4606,
    sha256: '36c8b89bb1b335d923bd5035020ff47f89c88775e14d08af2d2eb2ee2f5cc03a',
    contentDigestSha256: null,
    schema: CASE_REPORT_SCHEMA,
    version: CASE_REPORT_SCHEMA_VERSION,
    role: 'current' as const,
    expectation: 'accepted_exact' as const,
    expectedOutputFixtureId: null,
    shapeId: 'case.report.v10',
    scope: 'repository' as const,
  }),
  Object.freeze({
    id: 'case-response-packet-v7',
    path: 'test/fixtures/case-lifecycle/case-response-packet-v7.json',
    bytes: 10000,
    sha256: '0ea150d920710b331839be0a0f995d4597a133ecb930ef850de1eecfca4d94e3',
    contentDigestSha256: 'sha256:fa5b7f079882dd72b15365d844937ae99e47f81465e79b3911c25e70c157e562',
    schema: CASE_RESPONSE_PACKET_SCHEMA,
    version: PUBLISHED_V2_CASE_RESPONSE_PACKET_VERSION,
    role: 'historical' as const,
    expectation: 'accepted_exact' as const,
    expectedOutputFixtureId: null,
    shapeId: 'case.response-packet.v7',
    scope: 'repository' as const,
  }),
  Object.freeze({
    id: 'case-response-packet-v8',
    path: 'test/fixtures/case-lifecycle/case-response-packet-v8.json',
    bytes: 12191,
    sha256: '7bd2237f208714b92c3669c0581dbf0bc2dc22369e53b3ef9da088e8af0f4a83',
    contentDigestSha256: 'sha256:86d4d88d1d9fc969e6efa432061c64bf0725767d81c50b8655abd2d231dcc5b6',
    schema: CASE_RESPONSE_PACKET_SCHEMA,
    version: CASE_RESPONSE_PACKET_VERSION,
    role: 'current' as const,
    expectation: 'accepted_exact' as const,
    expectedOutputFixtureId: null,
    shapeId: 'case.response-packet.v8',
    scope: 'repository' as const,
  }),
  Object.freeze({
    id: 'case-response-review-inputs-v1',
    path: 'test/fixtures/case-lifecycle/case-response-review-inputs-v1.json',
    bytes: 5555,
    sha256: '67d3d36f316cf17898e04c39f2ba0ba7599abdc4b4e387baef5f5866a73c7b9c',
    contentDigestSha256: null,
    schema: CASE_RESPONSE_REVIEW_INPUTS_SCHEMA,
    version: PUBLISHED_V2_CASE_RESPONSE_REVIEW_INPUTS_VERSION,
    role: 'historical' as const,
    expectation: 'accepted_exact' as const,
    expectedOutputFixtureId: null,
    shapeId: 'case.response-review-inputs.v1',
    scope: 'repository' as const,
  }),
  Object.freeze({
    id: 'case-response-review-inputs-v2',
    path: 'test/fixtures/case-lifecycle/case-response-review-inputs-v2.json',
    bytes: 7520,
    sha256: 'dcc9aaa7cdbd79a33559095f4c212e4eea5ad635c8c36290456d8b1946845aa6',
    contentDigestSha256: null,
    schema: CASE_RESPONSE_REVIEW_INPUTS_SCHEMA,
    version: CASE_RESPONSE_REVIEW_INPUTS_VERSION,
    role: 'current' as const,
    expectation: 'accepted_exact' as const,
    expectedOutputFixtureId: null,
    shapeId: 'case.response-review-inputs.v2',
    scope: 'repository' as const,
  }),
  Object.freeze({
    id: 'cli-case-pack-v2-case-v12-public',
    path: 'test/fixtures/case-lifecycle/cli-case-pack-v2-case-v12-public.json',
    bytes: 4947,
    sha256: '4c8117dfb73c1eed5bd3f4cf78bf350459cdcc8f406120f089b34e6a6fcbfc7c',
    contentDigestSha256: 'sha256:93cc725c03052aa0232fb6965154c58810d8d1aef3ea0203e451a94bf9d091cf',
    schema: CLI_CASE_PACK_SCHEMA,
    version: CLI_CASE_PACK_VERSION,
    role: 'current' as const,
    expectation: 'accepted_exact' as const,
    expectedOutputFixtureId: null,
    shapeId: 'case.cli-pack.current',
    scope: 'repository' as const,
  }),
  Object.freeze({
    id: 'cli-case-pack-v2-case-v13',
    path: 'test/fixtures/case-lifecycle/cli-case-pack-v2-case-v13.json',
    bytes: 9288,
    sha256: '915ca7f3171ae48a2d3d06dc089f5840d4240b6a1fff1c050413b8bcca75fe26',
    contentDigestSha256: 'sha256:5991d0f4c04db2e846e078cb147668b2b4a14c6097490d2ebf09e41dfdb0fc9b',
    schema: CLI_CASE_PACK_SCHEMA,
    version: CLI_CASE_PACK_VERSION,
    role: 'current' as const,
    expectation: 'accepted_exact' as const,
    expectedOutputFixtureId: null,
    shapeId: 'case.cli-pack.current',
    scope: 'repository' as const,
  }),
  Object.freeze({
    id: 'cli-case-pack-v2-case-v14',
    path: 'test/fixtures/case-lifecycle/cli-case-pack-v2-case-v14.json',
    bytes: 9363,
    sha256: 'b51f23bca2dc91715f2aeeb931b79e4f990d59c3564d7cd60a9abac7e0d687a6',
    contentDigestSha256: 'sha256:82b88b1251c773a01823fccac9baf3e95f752570f091559c58dd0b1664444655',
    schema: CLI_CASE_PACK_SCHEMA,
    version: CLI_CASE_PACK_VERSION,
    role: 'current' as const,
    expectation: 'accepted_exact' as const,
    expectedOutputFixtureId: null,
    shapeId: 'case.cli-pack.current',
    scope: 'repository' as const,
  }),
  Object.freeze({
    id: 'workspace-archive-v5-public',
    path: 'test/fixtures/case-lifecycle/workspace-archive-v5-public.json',
    bytes: 5271,
    sha256: '27fd5f590b493be1ce57708be8b5c11d95eb600ae54e1ed3a530e78db433ec0d',
    contentDigestSha256: null,
    schema: WORKSPACE_ARCHIVE_SCHEMA,
    version: PUBLIC_WORKSPACE_ARCHIVE_VERSION,
    role: 'historical' as const,
    expectation: 'normalises_to_current_output' as const,
    expectedOutputFixtureId: 'workspace-archive-v7-empty-current',
    shapeId: 'case.workspace-archive.v5',
    scope: 'repository' as const,
  }),
  Object.freeze({
    id: 'workspace-archive-v6-empty-current',
    path: 'test/fixtures/case-lifecycle/workspace-archive-v6-empty-current.json',
    bytes: 5557,
    sha256: 'bca86a66043c88838f252358962ff5cdbc306373a2ad2d209ae90abdeff09aaa',
    contentDigestSha256: null,
    schema: WORKSPACE_ARCHIVE_SCHEMA,
    version: PUBLISHED_V2_WORKSPACE_ARCHIVE_VERSION,
    role: 'historical' as const,
    expectation: 'normalises_to_current_output' as const,
    expectedOutputFixtureId: 'workspace-archive-v7-empty-current',
    shapeId: 'case.workspace-archive.v6',
    scope: 'repository' as const,
  }),
  Object.freeze({
    id: 'workspace-archive-v7-empty-current',
    path: 'test/fixtures/case-lifecycle/workspace-archive-v7-empty-current.json',
    bytes: 7258,
    sha256: '892b0d321f42bfb34501019388da682071024af452a8263f138cc08221947f0a',
    contentDigestSha256: null,
    schema: WORKSPACE_ARCHIVE_SCHEMA,
    version: WORKSPACE_ARCHIVE_VERSION,
    role: 'current' as const,
    expectation: 'accepted_exact' as const,
    expectedOutputFixtureId: null,
    shapeId: 'case.workspace-archive.v7',
    scope: 'repository' as const,
  }),
  Object.freeze({
    id: 'workspace-settings-v1',
    path: 'test/fixtures/case-lifecycle/workspace-settings-v1.json',
    bytes: 110,
    sha256: '75675baf68765da5d36e9911d106dd8b72a8fd3c859136b651411d8041a4e184',
    contentDigestSha256: null,
    schema: WORKSPACE_SETTINGS_SCHEMA,
    version: WORKSPACE_SETTINGS_VERSION,
    role: 'current' as const,
    expectation: 'accepted_exact' as const,
    expectedOutputFixtureId: null,
    shapeId: 'case.workspace-settings.v1',
    scope: 'repository' as const,
  }),
  Object.freeze({
    id: 'encrypted-workspace-archive-v1',
    path: 'test/fixtures/case-lifecycle/encrypted-workspace-archive-v1.json',
    bytes: 7502,
    sha256: 'd7279ba0afb548d3ce41bdfc56acebffd05dc9b0b5b1451cb57a1164be881733',
    contentDigestSha256: null,
    schema: ENCRYPTED_WORKSPACE_ARCHIVE_SCHEMA,
    version: ENCRYPTED_WORKSPACE_ARCHIVE_VERSION,
    role: 'current' as const,
    expectation: 'accepted_exact' as const,
    expectedOutputFixtureId: null,
    shapeId: 'case.encrypted-workspace-archive.v1',
    scope: 'repository' as const,
  }),
]);
function fixtureIdsFor(schema: string, version: number): readonly string[] {
  return Object.freeze(CASE_LIFECYCLE_FIXTURES
    .filter((fixture) => fixture.schema === schema && fixture.version === version)
    .map((fixture) => fixture.id));
}
function lifecycleContract(input: {
  compatibilityId: string; schema: string; version: number; role?: 'input' | 'document';
  lifecycle: 'current' | 'legacy' | 'retired'; readable: boolean; emitted: boolean;
  exactKeys: boolean; extensionPolicy: 'discard_bounded' | 'preserve_bounded' | 'reject';
  futureVersionBehaviour: 'not_applicable' | 'preserve_without_write' | 'reject';
  migrationTarget: Readonly<{ schema: string; version: number }> | null;
  canonicalisation: string | null; byteBudget: number | null;
}) {
  return { ...input, role: input.role ?? 'document' as const, fixtureIds: fixtureIdsFor(input.schema, input.version) };
}

const browserContracts = CASE_BROWSER_SUPPORTED_VERSIONS.map((version) => lifecycleContract({
  compatibilityId: CASE_BROWSER_COMPATIBILITY.id, schema: CASE_BROWSER_STORE_LIFECYCLE_SCHEMA, version,
  lifecycle: version === CASE_SCHEMA_VERSION ? 'current' : 'legacy', readable: true,
  emitted: version === CASE_SCHEMA_VERSION, exactKeys: false,
  extensionPolicy: 'discard_bounded', futureVersionBehaviour: 'preserve_without_write',
  migrationTarget: version === CASE_SCHEMA_VERSION ? null : { schema: CASE_BROWSER_STORE_LIFECYCLE_SCHEMA, version: CASE_SCHEMA_VERSION },
  canonicalisation: null, byteBudget: MAX_CASE_STORE_BYTES,
}));
const exportContracts = CASE_IMPORT_VERSIONS.map((version) => lifecycleContract({
  compatibilityId: CASE_EXPORT_COMPATIBILITY.id, schema: CASE_EXPORT_LIFECYCLE_SCHEMA, version,
  lifecycle: version === CASE_SCHEMA_VERSION ? 'current' : 'legacy', readable: true,
  emitted: version === CASE_SCHEMA_VERSION, exactKeys: true, extensionPolicy: 'reject',
  futureVersionBehaviour: 'reject', migrationTarget: version === CASE_SCHEMA_VERSION
    ? null
    : { schema: CASE_EXPORT_LIFECYCLE_SCHEMA, version: CASE_SCHEMA_VERSION },
  canonicalisation: null, byteBudget: MAX_CASE_IMPORT_BYTES,
}));
const reportContracts = CASE_REPORT_OUTPUT_VERSIONS.map((version) => lifecycleContract({
  compatibilityId: CASE_REPORT_COMPATIBILITY.id, schema: CASE_REPORT_SCHEMA, version,
  lifecycle: version === CASE_REPORT_SCHEMA_VERSION ? 'current' : 'legacy', readable: true,
  emitted: version === CASE_REPORT_SCHEMA_VERSION, exactKeys: true, extensionPolicy: 'reject',
  futureVersionBehaviour: 'reject',
  migrationTarget: null, canonicalisation: null, byteBudget: null,
}));
const packetContracts = CASE_RESPONSE_PACKET_OUTPUT_VERSIONS.map((version) => lifecycleContract({
  compatibilityId: CASE_RESPONSE_PACKET_COMPATIBILITY.id, schema: CASE_RESPONSE_PACKET_SCHEMA, version,
  lifecycle: version === CASE_RESPONSE_PACKET_VERSION ? 'current' : 'legacy', readable: true,
  emitted: version === CASE_RESPONSE_PACKET_VERSION, exactKeys: true,
  extensionPolicy: 'reject', futureVersionBehaviour: 'reject', migrationTarget: null,
  canonicalisation: 'sorted-json-v2',
  byteBudget: null,
}));
const workspaceContracts = SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS.map((version) => lifecycleContract({
  compatibilityId: WORKSPACE_ARCHIVE_COMPATIBILITY.id, schema: WORKSPACE_ARCHIVE_SCHEMA, version,
  lifecycle: version === WORKSPACE_ARCHIVE_VERSION ? 'current' : 'legacy', readable: true,
  emitted: version === WORKSPACE_ARCHIVE_VERSION, exactKeys: true, extensionPolicy: 'reject',
  futureVersionBehaviour: 'reject', migrationTarget: version === WORKSPACE_ARCHIVE_VERSION
    ? null
    : { schema: WORKSPACE_ARCHIVE_SCHEMA, version: WORKSPACE_ARCHIVE_VERSION },
  canonicalisation: 'workspace-section-sorted-json-v1', byteBudget: MAX_WORKSPACE_ARCHIVE_BYTES,
}));

function shape(
  id: string,
  schema: string,
  versions: readonly number[],
  requiredKeys: readonly string[],
  normalisation: 'input_to_current' | 'preserve_document' | 'preserve_signed_document' | 'project_known_fields',
  target: Readonly<{ schema: string; version: number }> | null = null,
) {
  return {
    id,
    schema,
    versions,
    objects: [{
      path: '$',
      requiredKeys,
      alternativeRequiredKeys: [],
      optionalKeys: schema === CASE_EXPORT_LIFECYCLE_SCHEMA ? ['exportedAt'] : [],
      unknownKeys: schema === CASE_BROWSER_STORE_LIFECYCLE_SCHEMA ? 'discard_bounded' as const : 'reject' as const,
    }],
    fixedArrays: [],
    normalisation,
    target,
    discriminator: null,
  };
}

const CASE_LIFECYCLE_SHAPES = Object.freeze([
  shape(
    'case.browser-store.public',
    CASE_BROWSER_STORE_LIFECYCLE_SCHEMA,
    [PUBLIC_CASE_SCHEMA_VERSION],
    ['version', 'cases'],
    'project_known_fields',
  ),
  shape(
    'case.browser-store.v13',
    CASE_BROWSER_STORE_LIFECYCLE_SCHEMA,
    [PUBLISHED_V2_CASE_SCHEMA_VERSION],
    ['version', 'cases'],
    'project_known_fields',
  ),
  shape(
    'case.browser-store.current',
    CASE_BROWSER_STORE_LIFECYCLE_SCHEMA,
    [CASE_SCHEMA_VERSION],
    ['version', 'cases'],
    'project_known_fields',
  ),
  shape(
    'case.export.v13',
    CASE_EXPORT_LIFECYCLE_SCHEMA,
    [PUBLISHED_V2_CASE_SCHEMA_VERSION],
    ['version', 'cases'],
    'preserve_document',
  ),
  shape(
    'case.export.public',
    CASE_EXPORT_LIFECYCLE_SCHEMA,
    [PUBLIC_CASE_SCHEMA_VERSION],
    ['version', 'cases'],
    'preserve_document',
  ),
  shape(
    'case.response-packet.v6',
    CASE_RESPONSE_PACKET_SCHEMA,
    [PUBLIC_CASE_RESPONSE_PACKET_VERSION],
    [
      'schema', 'schemaVersion', 'generatedAt', 'reviewRequired', 'submissionPerformed',
      'profile', 'case', 'incident', 'contacts', 'preflight', 'escalationHistory',
      'provenance', 'integrity',
    ],
    'preserve_signed_document',
  ),
  shape(
    'case.export.current',
    CASE_EXPORT_LIFECYCLE_SCHEMA,
    [CASE_SCHEMA_VERSION],
    ['version', 'cases'],
    'preserve_document',
  ),
  shape(
    'case.report.v9',
    CASE_REPORT_SCHEMA,
    [PUBLISHED_V2_CASE_REPORT_SCHEMA_VERSION],
    ['schema', 'schemaVersion', 'generatedAt', 'application', 'case', 'currentAssessment', 'evidenceTimeline', 'analystResponse', 'responseLifecycle', 'limitations'],
    'preserve_document',
  ),
  shape(
    'case.report.v10',
    CASE_REPORT_SCHEMA,
    [CASE_REPORT_SCHEMA_VERSION],
    ['schema', 'schemaVersion', 'generatedAt', 'application', 'case', 'currentAssessment', 'evidenceTimeline', 'analystResponse', 'responseLifecycle', 'limitations'],
    'preserve_document',
  ),
  shape(
    'case.response-packet.v7',
    CASE_RESPONSE_PACKET_SCHEMA,
    [PUBLISHED_V2_CASE_RESPONSE_PACKET_VERSION],
    [
      'schema', 'schemaVersion', 'generatedAt', 'reviewRequired', 'submissionPerformed',
      'profile', 'case', 'incident', 'contacts', 'provenance', 'selectedEvidence',
      'contradictions', 'readiness', 'artefactReferences', 'preflight', 'escalationHistory',
      'escalationHistoryOmitted', 'escalationHistoryLimitations', 'responseLifecycle',
      'authorisation', 'integrity',
    ],
    'preserve_signed_document',
  ),
  shape(
    'case.response-packet.v8',
    CASE_RESPONSE_PACKET_SCHEMA,
    [CASE_RESPONSE_PACKET_VERSION],
    [
      'schema', 'schemaVersion', 'generatedAt', 'reviewRequired', 'submissionPerformed',
      'profile', 'case', 'incident', 'contacts', 'recipientRoute', 'actionBinding',
      'provenance', 'selectedEvidence', 'contradictions', 'readiness', 'artefactReferences',
      'preflight', 'escalationHistory', 'escalationHistoryOmitted',
      'escalationHistoryLimitations', 'responseLifecycle', 'authorisation', 'integrity',
    ],
    'preserve_signed_document',
  ),
  shape(
    'case.response-review-inputs.v1',
    CASE_RESPONSE_REVIEW_INPUTS_SCHEMA,
    [PUBLISHED_V2_CASE_RESPONSE_REVIEW_INPUTS_VERSION],
    [
      'contract', 'version', 'profile', 'case', 'incident', 'contacts', 'selectedEvidence',
      'contradictions', 'readiness', 'artefactReferences', 'escalationHistory',
      'escalationHistoryOmitted', 'escalationHistoryLimitations', 'responseLifecycle',
    ],
    'preserve_signed_document',
  ),
  shape(
    'case.response-review-inputs.v2',
    CASE_RESPONSE_REVIEW_INPUTS_SCHEMA,
    [CASE_RESPONSE_REVIEW_INPUTS_VERSION],
    [
      'contract', 'version', 'profile', 'case', 'incident', 'contacts',
      'recipientRoute', 'actionBinding', 'selectedEvidence', 'contradictions',
      'readiness', 'artefactReferences', 'escalationHistory',
      'escalationHistoryOmitted', 'escalationHistoryLimitations', 'responseLifecycle',
    ],
    'preserve_signed_document',
  ),
  shape(
    'case.cli-pack.current',
    CLI_CASE_PACK_SCHEMA,
    [CLI_CASE_PACK_VERSION],
    CLI_CASE_PACK_ROOT_KEYS,
    'preserve_signed_document',
  ),
  shape(
    'case.workspace-archive.v5',
    WORKSPACE_ARCHIVE_SCHEMA,
    [5],
    ['schema', 'version', 'generatedAt', 'manifest', 'sections', 'limitations'],
    'preserve_signed_document',
  ),
  shape(
    'case.workspace-archive.v6',
    WORKSPACE_ARCHIVE_SCHEMA,
    [PUBLISHED_V2_WORKSPACE_ARCHIVE_VERSION],
    ['schema', 'version', 'generatedAt', 'manifest', 'sections', 'limitations'],
    'preserve_signed_document',
  ),
  shape(
    'case.workspace-archive.v7',
    WORKSPACE_ARCHIVE_SCHEMA,
    [WORKSPACE_ARCHIVE_VERSION],
    ['schema', 'version', 'generatedAt', 'manifest', 'sections', 'limitations'],
    'preserve_signed_document',
  ),
  shape(
    'case.workspace-settings.v1',
    WORKSPACE_SETTINGS_SCHEMA,
    [WORKSPACE_SETTINGS_VERSION],
    ['schema', 'version', 'activeProfileId', 'theme'],
    'preserve_document',
  ),
  shape(
    'case.encrypted-workspace-archive.v1',
    ENCRYPTED_WORKSPACE_ARCHIVE_SCHEMA,
    [ENCRYPTED_WORKSPACE_ARCHIVE_VERSION],
    ['schema', 'version', 'createdAt', 'content', 'kdf', 'cipher', 'ciphertext'],
    'preserve_signed_document',
  ),
]);
const CASE_LIFECYCLE_HOOKS = Object.freeze([
  {
    id: 'case.browser.normalise',
    role: 'normaliser',
    runtime: 'shared',
    module: 'packages/cases/case-model.mts',
    exportName: 'normalizeCaseStore',
  },
  {
    id: 'case.browser.serialise',
    role: 'serialiser',
    runtime: 'shared',
    module: 'packages/cases/case-model.mts',
    exportName: 'serializeCaseStore',
  },
  {
    id: 'case.export.merge',
    role: 'merger',
    runtime: 'shared',
    module: 'packages/cases/case-model.mts',
    exportName: 'mergeCases',
  },
  {
    id: 'case.export.build',
    role: 'builder',
    runtime: 'shared',
    module: 'packages/cases/case-model.mts',
    exportName: 'buildCaseExport',
  },
  {
    id: 'case.portable.serialise',
    role: 'serialiser',
    runtime: 'shared',
    module: CASE_CONTRACT_OWNER,
    exportName: 'serialiseCasePortableJson',
  },
  {
    id: 'case.report.build',
    role: 'builder',
    runtime: 'shared',
    module: 'packages/cases/case-report.mts',
    exportName: 'buildCaseReport',
  },
  {
    id: 'case.packet.build',
    role: 'builder',
    runtime: 'shared',
    module: 'packages/cases/case-response-packet.mts',
    exportName: 'buildCaseResponsePacket',
  },
  {
    id: 'case.packet.verify',
    role: 'integrity_verifier',
    runtime: 'shared',
    module: 'packages/cases/case-response-packet.mts',
    exportName: 'verifyCaseResponsePacketIntegrity',
  },
  {
    id: 'case.packet.structure',
    role: 'structure_validator',
    runtime: 'cli',
    module: 'cli/offline-artifact-validation.mts',
    exportName: 'validateOfflineArtifactStructure',
  },
  {
    id: 'case.review-inputs.build',
    role: 'builder',
    runtime: 'shared',
    module: 'packages/cases/case-response-packet.mts',
    exportName: 'buildCaseResponseReviewInputs',
  },
  {
    id: 'case.review-inputs.validate',
    role: 'structure_validator',
    runtime: 'shared',
    module: 'packages/cases/case-response-packet.mts',
    exportName: 'validateCaseResponseReviewInputs',
  },
  {
    id: 'case.cli-pack.build',
    role: 'builder',
    runtime: 'cli',
    module: 'cli/case-pack.mts',
    exportName: 'buildCliCasePack',
  },
  {
    id: 'case.cli-pack.verify',
    role: 'integrity_verifier',
    runtime: 'cli',
    module: 'cli/case-pack.mts',
    exportName: 'verifyCliCasePack',
  },
  {
    id: 'case.cli-pack.serialise',
    role: 'serialiser',
    runtime: 'cli',
    module: 'cli/case-pack.mts',
    exportName: 'formatCliCasePack',
  },
  {
    id: 'case.workspace.build',
    role: 'builder',
    runtime: 'shared',
    module: 'packages/workspace/workspace-archive.mts',
    exportName: 'buildWorkspaceArchive',
  },
  {
    id: 'case.workspace.verify',
    role: 'integrity_verifier',
    runtime: 'shared',
    module: 'packages/workspace/workspace-archive.mts',
    exportName: 'readWorkspaceArchive',
  },
  {
    id: 'case.encrypted-workspace.build',
    role: 'builder',
    runtime: 'shared',
    module: 'packages/workspace/workspace-archive-crypto.mts',
    exportName: 'encryptWorkspaceArchive',
  },
  {
    id: 'case.encrypted-workspace.verify',
    role: 'integrity_verifier',
    runtime: 'shared',
    module: 'packages/workspace/workspace-archive-crypto.mts',
    exportName: 'decryptWorkspaceArchive',
  },
] as const);

const CASE_LIFECYCLE_BOUNDS = Object.freeze([
  {
    id: 'case.browser-store.bounds',
    bounds: [
      { id: 'raw-bytes', path: '$', phase: 'raw_intake', unit: 'bytes', minimum: 1, maximum: MAX_CASE_STORE_BYTES, handling: 'reject' },
      { id: 'serialised-bytes', path: '$', phase: 'serialised', unit: 'bytes', minimum: 1, maximum: MAX_CASE_STORE_BYTES, handling: 'reject' },
    ],
  },
  {
    id: 'case.portable.bounds',
    bounds: [
      { id: 'raw-bytes', path: '$', phase: 'raw_intake', unit: 'bytes', minimum: 1, maximum: MAX_CASE_IMPORT_BYTES, handling: 'reject' },
      { id: 'serialised-bytes', path: '$', phase: 'serialised', unit: 'bytes', minimum: 1, maximum: MAX_CASE_IMPORT_BYTES, handling: 'reject' },
    ],
  },
  {
    id: 'case.domain.bounds',
    bounds: [
      { id: 'cases', path: 'cases', phase: 'normalised', unit: 'items', minimum: 0, maximum: MAX_CASES, handling: 'truncate' },
      { id: 'notes', path: 'cases[].notes', phase: 'normalised', unit: 'items', minimum: 0, maximum: MAX_NOTES_PER_CASE, handling: 'truncate' },
      { id: 'evidence-history', path: 'cases[].evidenceHistory', phase: 'normalised', unit: 'items', minimum: 0, maximum: MAX_EVIDENCE_SNAPSHOTS_PER_CASE, handling: 'truncate' },
      { id: 'actions', path: 'cases[].actions', phase: 'normalised', unit: 'items', minimum: 0, maximum: MAX_CASE_ACTIONS, handling: 'truncate' },
      { id: 'action-events', path: 'cases[].actions[].history', phase: 'normalised', unit: 'items', minimum: 0, maximum: MAX_CASE_ACTION_EVENTS_PER_ACTION, handling: 'truncate' },
    ],
  },
  {
    id: 'case.packet.bounds',
    bounds: [
      { id: 'contacts', path: 'contacts', phase: 'normalised', unit: 'items', minimum: 0, maximum: MAX_RESPONSE_CONTACTS, handling: 'truncate' },
      { id: 'urls', path: 'incident.abusiveUrls', phase: 'normalised', unit: 'items', minimum: 0, maximum: MAX_ABUSIVE_URLS, handling: 'truncate' },
      { id: 'selected-evidence', path: 'selectedEvidence', phase: 'normalised', unit: 'items', minimum: 0, maximum: MAX_RESPONSE_SELECTED_EVIDENCE, handling: 'truncate' },
      { id: 'contradictions', path: 'contradictions', phase: 'normalised', unit: 'items', minimum: 0, maximum: MAX_RESPONSE_CONTRADICTIONS, handling: 'truncate' },
      { id: 'artefact-references', path: 'artefactReferences', phase: 'normalised', unit: 'items', minimum: 0, maximum: MAX_RESPONSE_ARTEFACT_REFERENCES, handling: 'truncate' },
      { id: 'escalation-history', path: 'escalationHistory', phase: 'normalised', unit: 'items', minimum: 0, maximum: MAX_RESPONSE_ACTION_HISTORY, handling: 'truncate' },
    ],
  },
  {
    id: 'case.cli-pack.bounds',
    bounds: [
      { id: 'cases', path: 'cases', phase: 'normalised', unit: 'items', minimum: 1, maximum: MAX_CASE_PACK_CASES, handling: 'reject' },
      { id: 'reports', path: 'packet.reports', phase: 'normalised', unit: 'items', minimum: 1, maximum: MAX_CASE_PACK_CASES, handling: 'reject' },
    ],
  },
  {
    id: 'case.workspace.bounds',
    bounds: [
      { id: 'raw-bytes', path: '$', phase: 'raw_intake', unit: 'bytes', minimum: 1, maximum: MAX_WORKSPACE_ARCHIVE_BYTES, handling: 'reject' },
      { id: 'serialised-bytes', path: '$', phase: 'serialised', unit: 'bytes', minimum: 1, maximum: MAX_WORKSPACE_ARCHIVE_BYTES, handling: 'reject' },
      { id: 'sections', path: 'manifest.sections', phase: 'pre_accumulation', unit: 'items', minimum: 1, maximum: MAX_WORKSPACE_ARCHIVE_SECTIONS, handling: 'reject' },
      { id: 'section-bytes', path: 'manifest.sections[].bytes', phase: 'pre_accumulation', unit: 'bytes', minimum: 0, maximum: MAX_WORKSPACE_ARCHIVE_SECTION_BYTES, handling: 'reject' },
    ],
  },
  {
    id: 'case.encrypted-workspace.bounds',
    bounds: [
      { id: 'raw-bytes', path: '$', phase: 'raw_intake', unit: 'bytes', minimum: 1, maximum: MAX_ENCRYPTED_WORKSPACE_ARCHIVE_BYTES, handling: 'reject' },
      { id: 'serialised-bytes', path: '$', phase: 'serialised', unit: 'bytes', minimum: 1, maximum: MAX_ENCRYPTED_WORKSPACE_ARCHIVE_BYTES, handling: 'reject' },
      { id: 'passphrase-characters', path: '$.passphrase', phase: 'action', unit: 'characters', minimum: MIN_WORKSPACE_ARCHIVE_PASSPHRASE_CHARACTERS, maximum: MAX_WORKSPACE_ARCHIVE_PASSPHRASE_BYTES, handling: 'reject' },
      { id: 'passphrase-bytes', path: '$.passphrase', phase: 'action', unit: 'bytes', minimum: MIN_WORKSPACE_ARCHIVE_PASSPHRASE_CHARACTERS, maximum: MAX_WORKSPACE_ARCHIVE_PASSPHRASE_BYTES, handling: 'reject' },
    ],
  },
] as const);

const CASE_LIFECYCLE_PRIVACY = Object.freeze([
  {
    id: 'case.privacy.browser-state',
    classification: 'analyst_authored_sensitive',
    projection: 'browser_import',
    includedCategories: ['case-identifiers', 'analyst-notes', 'bounded-evidence-summaries', 'exact-submitted-hostnames', 'response-history'],
    excludedCategories: ['raw-upstream-payloads', 'credentials', 'cookies', 'session-data'],
    notePolicy: 'allowed_bounded',
    retention: 'browser_indexeddb',
    network: 'none',
    sharingReview: 'not_applicable',
  },
  {
    id: 'case.privacy.portable-input',
    classification: 'analyst_authored_sensitive',
    projection: 'browser_import',
    includedCategories: ['case-identifiers', 'bounded-case-records', 'exact-submitted-hostnames', 'declared-integrity'],
    excludedCategories: ['raw-upstream-payloads', 'credentials', 'cookies', 'session-data'],
    notePolicy: 'allowed_bounded',
    retention: 'deliberate_local_file',
    network: 'none',
    sharingReview: 'required',
  },
  {
    id: 'case.privacy.portable-output',
    classification: 'analyst_authored_sensitive',
    projection: 'browser_export',
    includedCategories: ['case-identifiers', 'bounded-case-records', 'exact-submitted-hostnames', 'declared-integrity'],
    excludedCategories: ['raw-upstream-payloads', 'credentials', 'cookies', 'session-data'],
    notePolicy: 'allowed_bounded',
    retention: 'operator_controlled_output',
    network: 'none',
    sharingReview: 'required',
  },
] as const);

const EXPIRY_ID = 'case.expiry.not-applicable';
const CASE_LIFECYCLE_EXPIRY = Object.freeze([{
  id: EXPIRY_ID,
  field: null,
  anchor: null,
  handling: 'not_applicable',
  phase: 'not_applicable',
  maximumLifetimeDays: null,
}] as const);

const CASE_LIFECYCLE_SERIALISATION = Object.freeze([
  {
    id: 'case.browser-store.json.v14',
    schema: CASE_BROWSER_STORE_LIFECYCLE_SCHEMA,
    versions: [CASE_SCHEMA_VERSION],
    mediaType: 'application/json',
    encoding: 'utf-8',
    bom: false,
    indentSpaces: 2,
    terminalLf: true,
    propertyOrder: 'normalised_fixed',
    canonicalisation: null,
    integrity: 'none',
    serializerHookId: 'case.browser.serialise',
    verifierHookIds: [],
  },
  ...([
    ['case.export.json.v14', CASE_EXPORT_LIFECYCLE_SCHEMA, [CASE_SCHEMA_VERSION], 'none', []],
    ['case.report.json.v10', CASE_REPORT_SCHEMA, [...CASE_REPORT_OUTPUT_VERSIONS], 'none', []],
    ['case.packet.json.v8', CASE_RESPONSE_PACKET_SCHEMA, [...SUPPORTED_CASE_RESPONSE_PACKET_VERSIONS], 'structural_only_requires_separate_verification', ['case.packet.verify']],
    ['case.workspace.json.v7', WORKSPACE_ARCHIVE_SCHEMA, [WORKSPACE_ARCHIVE_VERSION], 'structural_only_requires_separate_verification', ['case.workspace.verify']],
    ['case.encrypted-workspace.json.v1', ENCRYPTED_WORKSPACE_ARCHIVE_SCHEMA, [ENCRYPTED_WORKSPACE_ARCHIVE_VERSION], 'structural_only_requires_separate_verification', ['case.encrypted-workspace.verify']],
  ] as const).map(([id, schema, versions, integrity, verifierHookIds]) => ({
    id,
    schema,
    versions,
    mediaType: 'application/json',
    encoding: 'utf-8',
    bom: false,
    indentSpaces: 2,
    terminalLf: true,
    propertyOrder: 'normalised_fixed',
    canonicalisation: null,
    integrity,
    serializerHookId: 'case.portable.serialise',
    verifierHookIds,
  } as const)),
  {
    id: 'case.cli-pack.json.v2',
    schema: CLI_CASE_PACK_SCHEMA,
    versions: [...SUPPORTED_CLI_CASE_PACK_VERSIONS],
    mediaType: 'application/json',
    encoding: 'utf-8',
    bom: false,
    indentSpaces: 2,
    terminalLf: true,
    propertyOrder: 'normalised_fixed',
    canonicalisation: null,
    integrity: 'structural_only_requires_separate_verification',
    serializerHookId: 'case.cli-pack.serialise',
    verifierHookIds: ['case.cli-pack.verify'],
  },
] as const);

const sharedEdge = {
  expiryPolicyId: EXPIRY_ID,
  requestMode: 'none',
  bindingState: 'declared_unenforced',
  policyState: 'current',
} as const;

const CASE_LIFECYCLE_CONSUMERS = Object.freeze([
  {
    id: 'case.browser.read-write',
    plane: 'browser',
    operation: 'normalise-and-store',
    acceptedContracts: [{
      schema: CASE_BROWSER_STORE_LIFECYCLE_SCHEMA,
      versions: [...CASE_BROWSER_SUPPORTED_VERSIONS],
      mode: 'direct',
      discriminator: null,
    }],
    emittedContract: { schema: CASE_BROWSER_STORE_LIFECYCLE_SCHEMA, version: CASE_SCHEMA_VERSION, discriminator: null },
    shapeIds: ['case.browser-store.public', 'case.browser-store.v13', 'case.browser-store.current'],
    boundProfileIds: ['case.browser-store.bounds', 'case.domain.bounds'],
    hookIds: ['case.browser.normalise', 'case.browser.serialise'],
    serialisationProfileId: 'case.browser-store.json.v14',
    privacyProfileId: 'case.privacy.browser-state',
    retentionEffect: 'browser_indexeddb',
    ...sharedEdge,
  },
  {
    id: 'case.export.import',
    plane: 'shared',
    operation: 'non-destructive-merge',
    acceptedContracts: [{
      schema: CASE_EXPORT_LIFECYCLE_SCHEMA,
      versions: [...CASE_IMPORT_VERSIONS],
      mode: 'direct',
      discriminator: null,
    }],
    emittedContract: null,
    shapeIds: ['case.export.public', 'case.export.v13', 'case.export.current'],
    boundProfileIds: ['case.portable.bounds', 'case.domain.bounds'],
    hookIds: ['case.export.merge'],
    serialisationProfileId: null,
    privacyProfileId: 'case.privacy.portable-input',
    retentionEffect: 'deliberate_local_file',
    ...sharedEdge,
  },
  {
    id: 'case.consumer.export-build',
    plane: 'shared',
    operation: 'build-portable-export',
    acceptedContracts: [],
    emittedContract: { schema: CASE_EXPORT_LIFECYCLE_SCHEMA, version: CASE_SCHEMA_VERSION, discriminator: null },
    shapeIds: ['case.export.current'],
    boundProfileIds: ['case.portable.bounds', 'case.domain.bounds'],
    hookIds: ['case.export.build', 'case.portable.serialise'],
    serialisationProfileId: 'case.export.json.v14',
    privacyProfileId: 'case.privacy.portable-output',
    retentionEffect: 'operator_controlled_output',
    ...sharedEdge,
  },
  {
    id: 'case.consumer.report-pack-verify',
    plane: 'cli',
    operation: 'validate-embedded-report',
    acceptedContracts: [{
      schema: CASE_REPORT_SCHEMA,
      versions: [...CASE_REPORT_OUTPUT_VERSIONS],
      mode: 'embedded',
      discriminator: null,
    }],
    emittedContract: null,
    shapeIds: ['case.report.v9', 'case.report.v10'],
    boundProfileIds: ['case.domain.bounds'],
    hookIds: ['case.cli-pack.verify'],
    serialisationProfileId: null,
    privacyProfileId: 'case.privacy.portable-input',
    retentionEffect: 'deliberate_local_file',
    ...sharedEdge,
  },
  {
    id: 'case.consumer.report-build',
    plane: 'shared',
    operation: 'build-report',
    acceptedContracts: [],
    emittedContract: { schema: CASE_REPORT_SCHEMA, version: CASE_REPORT_SCHEMA_VERSION, discriminator: null },
    shapeIds: ['case.report.v10'],
    boundProfileIds: ['case.domain.bounds'],
    hookIds: ['case.report.build', 'case.portable.serialise'],
    serialisationProfileId: 'case.report.json.v10',
    privacyProfileId: 'case.privacy.portable-output',
    retentionEffect: 'operator_controlled_output',
    ...sharedEdge,
  },
  {
    id: 'case.consumer.packet-verify',
    plane: 'shared',
    operation: 'verify-integrity',
    acceptedContracts: [{
      schema: CASE_RESPONSE_PACKET_SCHEMA,
      versions: [...SUPPORTED_CASE_RESPONSE_PACKET_VERSIONS],
      mode: 'direct',
      discriminator: null,
    }],
    emittedContract: null,
    shapeIds: ['case.response-packet.v6', 'case.response-packet.v7', 'case.response-packet.v8'],
    boundProfileIds: ['case.packet.bounds'],
    hookIds: ['case.packet.verify'],
    serialisationProfileId: null,
    privacyProfileId: 'case.privacy.portable-input',
    retentionEffect: 'deliberate_local_file',
    ...sharedEdge,
  },
  {
    id: 'case.consumer.packet-offline-verify',
    plane: 'cli',
    operation: 'validate-structure-and-integrity',
    acceptedContracts: [{
      schema: CASE_RESPONSE_PACKET_SCHEMA,
      versions: [...SUPPORTED_CASE_RESPONSE_PACKET_VERSIONS],
      mode: 'direct',
      discriminator: null,
    }],
    emittedContract: null,
    shapeIds: ['case.response-packet.v6', 'case.response-packet.v7', 'case.response-packet.v8'],
    boundProfileIds: ['case.packet.bounds'],
    hookIds: ['case.packet.structure', 'case.packet.verify'],
    serialisationProfileId: null,
    privacyProfileId: 'case.privacy.portable-input',
    retentionEffect: 'deliberate_local_file',
    ...sharedEdge,
  },
  {
    id: 'case.consumer.packet-build',
    plane: 'shared',
    operation: 'build-packet',
    acceptedContracts: [],
    emittedContract: { schema: CASE_RESPONSE_PACKET_SCHEMA, version: CASE_RESPONSE_PACKET_VERSION, discriminator: null },
    shapeIds: ['case.response-packet.v8'],
    boundProfileIds: ['case.packet.bounds'],
    hookIds: ['case.packet.build', 'case.portable.serialise'],
    serialisationProfileId: 'case.packet.json.v8',
    privacyProfileId: 'case.privacy.portable-output',
    retentionEffect: 'operator_controlled_output',
    ...sharedEdge,
  },
  {
    id: 'case.consumer.review-inputs-validate',
    plane: 'shared',
    operation: 'validate-review-inputs',
    acceptedContracts: [{
      schema: CASE_RESPONSE_REVIEW_INPUTS_SCHEMA,
      versions: [...SUPPORTED_CASE_RESPONSE_REVIEW_INPUTS_VERSIONS],
      mode: 'direct',
      discriminator: null,
    }],
    emittedContract: null,
    shapeIds: ['case.response-review-inputs.v1', 'case.response-review-inputs.v2'],
    boundProfileIds: ['case.packet.bounds'],
    hookIds: ['case.review-inputs.validate'],
    serialisationProfileId: null,
    privacyProfileId: 'case.privacy.portable-input',
    retentionEffect: 'deliberate_local_file',
    ...sharedEdge,
  },
  {
    id: 'case.consumer.review-inputs-build',
    plane: 'shared',
    operation: 'build-review-inputs',
    acceptedContracts: [],
    emittedContract: {
      schema: CASE_RESPONSE_REVIEW_INPUTS_SCHEMA,
      version: CASE_RESPONSE_REVIEW_INPUTS_VERSION,
      discriminator: null,
    },
    shapeIds: ['case.response-review-inputs.v2'],
    boundProfileIds: ['case.packet.bounds'],
    hookIds: ['case.review-inputs.build'],
    serialisationProfileId: null,
    privacyProfileId: 'case.privacy.portable-output',
    retentionEffect: 'operator_controlled_output',
    ...sharedEdge,
  },
  {
    id: 'case.consumer.cli-pack-verify',
    plane: 'cli',
    operation: 'verify-case-pack',
    acceptedContracts: [{
      schema: CLI_CASE_PACK_SCHEMA,
      versions: [...SUPPORTED_CLI_CASE_PACK_VERSIONS],
      mode: 'direct',
      discriminator: null,
    }],
    emittedContract: null,
    shapeIds: ['case.cli-pack.current'],
    boundProfileIds: ['case.portable.bounds', 'case.cli-pack.bounds'],
    hookIds: ['case.cli-pack.verify'],
    serialisationProfileId: null,
    privacyProfileId: 'case.privacy.portable-input',
    retentionEffect: 'deliberate_local_file',
    ...sharedEdge,
  },
  {
    id: 'case.consumer.cli-pack-build',
    plane: 'cli',
    operation: 'build-case-pack',
    acceptedContracts: [{
      schema: CASE_EXPORT_LIFECYCLE_SCHEMA,
      versions: [CASE_SCHEMA_VERSION],
      mode: 'direct',
      discriminator: null,
    }],
    emittedContract: { schema: CLI_CASE_PACK_SCHEMA, version: CLI_CASE_PACK_VERSION, discriminator: null },
    shapeIds: ['case.export.current', 'case.cli-pack.current'],
    boundProfileIds: ['case.portable.bounds', 'case.domain.bounds', 'case.cli-pack.bounds'],
    hookIds: ['case.cli-pack.build', 'case.cli-pack.serialise'],
    serialisationProfileId: 'case.cli-pack.json.v2',
    privacyProfileId: 'case.privacy.portable-output',
    retentionEffect: 'operator_controlled_output',
    ...sharedEdge,
  },
  {
    id: 'case.consumer.workspace-verify',
    plane: 'browser',
    operation: 'verify-and-preview-workspace',
    acceptedContracts: [{
      schema: WORKSPACE_ARCHIVE_SCHEMA,
      versions: [...SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS],
      mode: 'direct',
      discriminator: null,
    }, {
      schema: WORKSPACE_SETTINGS_SCHEMA,
      versions: [WORKSPACE_SETTINGS_VERSION],
      mode: 'embedded',
      discriminator: null,
    }],
    emittedContract: null,
    shapeIds: ['case.workspace-archive.v5', 'case.workspace-archive.v6', 'case.workspace-archive.v7', 'case.workspace-settings.v1'],
    boundProfileIds: ['case.workspace.bounds'],
    hookIds: ['case.workspace.verify'],
    serialisationProfileId: null,
    privacyProfileId: 'case.privacy.portable-input',
    retentionEffect: 'deliberate_local_file',
    ...sharedEdge,
  },
  {
    id: 'case.consumer.workspace-build',
    plane: 'browser',
    operation: 'build-workspace',
    acceptedContracts: [],
    emittedContract: { schema: WORKSPACE_ARCHIVE_SCHEMA, version: WORKSPACE_ARCHIVE_VERSION, discriminator: null },
    shapeIds: ['case.workspace-archive.v7'],
    boundProfileIds: ['case.workspace.bounds'],
    hookIds: ['case.workspace.build', 'case.portable.serialise'],
    serialisationProfileId: 'case.workspace.json.v7',
    privacyProfileId: 'case.privacy.portable-output',
    retentionEffect: 'operator_controlled_output',
    ...sharedEdge,
  },
  {
    id: 'case.consumer.workspace-settings-build',
    plane: 'browser',
    operation: 'build-workspace-settings-section',
    acceptedContracts: [],
    emittedContract: { schema: WORKSPACE_SETTINGS_SCHEMA, version: WORKSPACE_SETTINGS_VERSION, discriminator: null },
    shapeIds: ['case.workspace-settings.v1'],
    boundProfileIds: ['case.workspace.bounds'],
    hookIds: ['case.workspace.build'],
    serialisationProfileId: null,
    privacyProfileId: 'case.privacy.portable-output',
    retentionEffect: 'operator_controlled_output',
    ...sharedEdge,
  },
  {
    id: 'case.consumer.encrypted-workspace-verify',
    plane: 'browser',
    operation: 'decrypt-and-verify-workspace',
    acceptedContracts: [{
      schema: ENCRYPTED_WORKSPACE_ARCHIVE_SCHEMA,
      versions: [ENCRYPTED_WORKSPACE_ARCHIVE_VERSION],
      mode: 'direct',
      discriminator: null,
    }],
    emittedContract: null,
    shapeIds: ['case.encrypted-workspace-archive.v1'],
    boundProfileIds: ['case.encrypted-workspace.bounds'],
    hookIds: ['case.encrypted-workspace.verify'],
    serialisationProfileId: null,
    privacyProfileId: 'case.privacy.portable-input',
    retentionEffect: 'deliberate_local_file',
    ...sharedEdge,
  },
  {
    id: 'case.consumer.encrypted-workspace-build',
    plane: 'browser',
    operation: 'encrypt-workspace',
    acceptedContracts: [{
      schema: WORKSPACE_ARCHIVE_SCHEMA,
      versions: [...SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS],
      mode: 'direct',
      discriminator: null,
    }],
    emittedContract: {
      schema: ENCRYPTED_WORKSPACE_ARCHIVE_SCHEMA,
      version: ENCRYPTED_WORKSPACE_ARCHIVE_VERSION,
      discriminator: null,
    },
    shapeIds: ['case.workspace-archive.v5', 'case.workspace-archive.v6', 'case.workspace-archive.v7', 'case.encrypted-workspace-archive.v1'],
    boundProfileIds: ['case.workspace.bounds', 'case.encrypted-workspace.bounds'],
    hookIds: ['case.encrypted-workspace.build', 'case.portable.serialise'],
    serialisationProfileId: 'case.encrypted-workspace.json.v1',
    privacyProfileId: 'case.privacy.portable-output',
    retentionEffect: 'operator_controlled_output',
    ...sharedEdge,
  },
] as const);

export const CASE_PORTABILITY_LIFECYCLE_FAMILY = defineSchemaLifecycleFamily({
  id: 'case-portability',
  owner: CASE_CONTRACT_OWNER,
  privacy: 'analyst_authored_sensitive',
  compatibility: CASE_PORTABILITY_COMPATIBILITY,
  contracts: [
    ...browserContracts,
    ...exportContracts,
    ...reportContracts,
    ...packetContracts,
    ...SUPPORTED_CASE_RESPONSE_REVIEW_INPUTS_VERSIONS.map((version) => lifecycleContract({
      compatibilityId: CASE_RESPONSE_REVIEW_INPUTS_COMPATIBILITY.id,
      schema: CASE_RESPONSE_REVIEW_INPUTS_SCHEMA,
      version,
      lifecycle: version === CASE_RESPONSE_REVIEW_INPUTS_VERSION ? 'current' : 'legacy',
      readable: true,
      emitted: version === CASE_RESPONSE_REVIEW_INPUTS_VERSION,
      exactKeys: true,
      extensionPolicy: 'reject',
      futureVersionBehaviour: 'reject',
      migrationTarget: null,
      canonicalisation: 'sorted-json-v2',
      byteBudget: null,
    })),
    lifecycleContract({
      compatibilityId: CLI_CASE_PACK_COMPATIBILITY.id,
      schema: CLI_CASE_PACK_SCHEMA,
      version: CLI_CASE_PACK_VERSION,
      lifecycle: 'current',
      readable: true,
      emitted: true,
      exactKeys: true,
      extensionPolicy: 'reject',
      futureVersionBehaviour: 'reject',
      migrationTarget: null,
      canonicalisation: 'sorted-json-v2',
      byteBudget: MAX_CASE_IMPORT_BYTES,
    }),
    ...workspaceContracts,
    lifecycleContract({
      compatibilityId: WORKSPACE_SETTINGS_COMPATIBILITY.id,
      schema: WORKSPACE_SETTINGS_SCHEMA,
      version: WORKSPACE_SETTINGS_VERSION,
      lifecycle: 'current',
      readable: true,
      emitted: true,
      exactKeys: true,
      extensionPolicy: 'reject',
      futureVersionBehaviour: 'reject',
      migrationTarget: null,
      canonicalisation: null,
      byteBudget: null,
    }),
    lifecycleContract({
      compatibilityId: ENCRYPTED_WORKSPACE_ARCHIVE_COMPATIBILITY.id,
      schema: ENCRYPTED_WORKSPACE_ARCHIVE_SCHEMA,
      version: ENCRYPTED_WORKSPACE_ARCHIVE_VERSION,
      lifecycle: 'current',
      readable: true,
      emitted: true,
      exactKeys: true,
      extensionPolicy: 'reject',
      futureVersionBehaviour: 'reject',
      migrationTarget: null,
      canonicalisation: 'aes-gcm-v1',
      byteBudget: MAX_ENCRYPTED_WORKSPACE_ARCHIVE_BYTES,
    }),
  ],
  fixtures: CASE_LIFECYCLE_FIXTURES,
  metadata: {
    metadataVersion: 4 as const,
    enforcement: 'declarative_only',
    shapes: CASE_LIFECYCLE_SHAPES,
    boundProfiles: CASE_LIFECYCLE_BOUNDS,
    hooks: CASE_LIFECYCLE_HOOKS,
    serialisationProfiles: CASE_LIFECYCLE_SERIALISATION,
    privacyProfiles: CASE_LIFECYCLE_PRIVACY,
    expiryProfiles: CASE_LIFECYCLE_EXPIRY,
    consumerEdges: CASE_LIFECYCLE_CONSUMERS,
    consumerRelationships: [],
  },
} satisfies SchemaLifecycleFamilyWithMetadataV4);
