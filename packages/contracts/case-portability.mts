import { MAX_DOMAIN_NAME_LENGTH } from './domain-name.mts';
import { defineSchemaCompatibility } from './schema-compatibility.mts';
import { defineSchemaLifecycleFamily } from './schema-lifecycle.mts';
import type { SchemaLifecycleFamilyWithMetadataV4 } from './schema-lifecycle.mts';

export const CASE_CONTRACT_OWNER = 'packages/contracts/case-portability.mts';

export const CASE_PORTABILITY_IDENTITY_CONSTANTS = Object.freeze([
  'CASE_BROWSER_STORE_LIFECYCLE_SCHEMA',
  'CASE_EXPORT_LIFECYCLE_SCHEMA',
  'CASE_SCHEMA_VERSION',
  'CASE_BROWSER_SUPPORTED_VERSIONS',
  'CASE_IMPORT_VERSIONS',
  'CASE_REPORT_SCHEMA',
  'CASE_REPORT_SCHEMA_VERSION',
  'CASE_REPORT_OUTPUT_VERSIONS',
  'CASE_REPORT_RETIRED_OUTPUT_VERSIONS',
  'CASE_RESPONSE_PACKET_SCHEMA',
  'CASE_RESPONSE_PACKET_VERSION',
  'PREVIOUS_CASE_RESPONSE_PACKET_VERSION',
  'LEGACY_CASE_RESPONSE_PACKET_VERSION',
  'CASE_RESPONSE_PACKET_OUTPUT_VERSIONS',
  'SUPPORTED_CASE_RESPONSE_PACKET_VERSIONS',
  'CASE_RESPONSE_REVIEW_INPUTS_SCHEMA',
  'CASE_RESPONSE_REVIEW_INPUTS_VERSION',
  'CLI_CASE_PACK_SCHEMA',
  'CLI_CASE_PACK_VERSION',
  'LEGACY_CLI_CASE_PACK_VERSION',
  'SUPPORTED_CLI_CASE_PACK_VERSIONS',
  'CLI_CASE_PACK_CASE_REPORT_EPOCHS',
  'WORKSPACE_ARCHIVE_SCHEMA',
  'WORKSPACE_ARCHIVE_VERSION',
  'SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS',
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
export const CASE_SCHEMA_VERSION = 14;
export const CASE_BROWSER_SUPPORTED_VERSIONS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, CASE_SCHEMA_VERSION] as const);
export const CASE_IMPORT_VERSIONS = Object.freeze([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, CASE_SCHEMA_VERSION] as const);

export const CASE_REPORT_SCHEMA = 'whoisleuth.case-report';
export const CASE_REPORT_SCHEMA_VERSION = 9;
export const CASE_REPORT_OUTPUT_VERSIONS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, CASE_REPORT_SCHEMA_VERSION] as const);
export const CASE_REPORT_RETIRED_OUTPUT_VERSIONS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8] as const);

export const CASE_RESPONSE_PACKET_SCHEMA = 'whoisleuth.case-response-packet';
export const CASE_RESPONSE_PACKET_VERSION = 7;
export const PREVIOUS_CASE_RESPONSE_PACKET_VERSION = 6;
export const LEGACY_CASE_RESPONSE_PACKET_VERSION = 5;
export const CASE_RESPONSE_PACKET_OUTPUT_VERSIONS = Object.freeze([1, 2, 3, 4, 5, 6, CASE_RESPONSE_PACKET_VERSION] as const);
export const SUPPORTED_CASE_RESPONSE_PACKET_VERSIONS = Object.freeze([
  LEGACY_CASE_RESPONSE_PACKET_VERSION,
  PREVIOUS_CASE_RESPONSE_PACKET_VERSION,
  CASE_RESPONSE_PACKET_VERSION,
] as const);
export const CASE_RESPONSE_REVIEW_INPUTS_SCHEMA = 'whoisleuth.case-response-review-inputs';
export const CASE_RESPONSE_REVIEW_INPUTS_VERSION = 1;

export const CLI_CASE_PACK_SCHEMA = 'whoisleuth.cli.case-pack';
export const CLI_CASE_PACK_VERSION = 2;
export const LEGACY_CLI_CASE_PACK_VERSION = 1;
export const SUPPORTED_CLI_CASE_PACK_VERSIONS = Object.freeze([LEGACY_CLI_CASE_PACK_VERSION, CLI_CASE_PACK_VERSION] as const);
export const CLI_CASE_PACK_ROOT_KEYS = Object.freeze(['version', 'exportedAt', 'cases', 'packet', 'integrity'] as const);
export const CLI_CASE_PACK_PACKET_KEYS = Object.freeze(['schema', 'version', 'audience', 'reviewed', 'reports', 'redactionManifest', 'limitations'] as const);
export const CLI_CASE_PACK_REPORT_KEYS = Object.freeze(['schema', 'schemaVersion', 'generatedAt', 'application', 'case', 'currentAssessment', 'evidenceTimeline', 'analystResponse', 'responseLifecycle', 'limitations'] as const);
export const CLI_CASE_PACK_INTEGRITY_KEYS = Object.freeze(['algorithm', 'canonicalization', 'digestSha256'] as const);
export const CLI_CASE_PACK_LEGACY_REDACTION_KEYS = Object.freeze(['excluded', 'sourceCaseCount'] as const);
export const CLI_CASE_PACK_CURRENT_REDACTION_KEYS = Object.freeze(['excluded', 'sourceCaseCount', 'brandProfileReferencesOmitted'] as const);
export const CLI_CASE_PACK_LIMITATIONS = Object.freeze([
  'This local package is browser-importable through its top-level case collection and does not upload or submit evidence.',
  'The reviewed flag records a deliberate CLI choice; it does not prove recipient authorisation, factual correctness, or legal sufficiency.',
  'Importing the package does not restore fields excluded by its audience profile.',
] as const);
export const CLI_CASE_PACK_CASE_REPORT_EPOCHS = Object.freeze([
  Object.freeze({ caseVersions: Object.freeze([2] as const), reportVersions: Object.freeze([1] as const) }),
  Object.freeze({ caseVersions: Object.freeze([3] as const), reportVersions: Object.freeze([2] as const) }),
  Object.freeze({ caseVersions: Object.freeze([4, 5, 6, 7, 8] as const), reportVersions: Object.freeze([3] as const) }),
  Object.freeze({ caseVersions: Object.freeze([9] as const), reportVersions: Object.freeze([4] as const) }),
  Object.freeze({ caseVersions: Object.freeze([10] as const), reportVersions: Object.freeze([5, 6] as const) }),
  Object.freeze({ caseVersions: Object.freeze([11] as const), reportVersions: Object.freeze([7] as const) }),
  Object.freeze({ caseVersions: Object.freeze([12] as const), reportVersions: Object.freeze([8] as const) }),
  Object.freeze({ caseVersions: Object.freeze([13, CASE_SCHEMA_VERSION] as const), reportVersions: Object.freeze([CASE_REPORT_SCHEMA_VERSION] as const) }),
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
export const WORKSPACE_ARCHIVE_VERSION = 5;
export const SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS = Object.freeze([1, 2, 3, 4, WORKSPACE_ARCHIVE_VERSION] as const);
export function isSupportedWorkspaceArchiveVersion(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS.some((version) => version === value);
}
export const WORKSPACE_ARCHIVE_SECTION_IDS = Object.freeze([
  'cases', 'campaigns', 'brandProfiles', 'watchlists', 'shortlist', 'detectionRules',
  'relationshipObservations', 'bulkSessions', 'websiteSnapshots', 'investigationTemplates',
  'bulkReview', 'settings',
] as const);
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
export const MAX_WORKSPACE_ARCHIVE_SECTIONS = 12;
export const WORKSPACE_ARCHIVE_PBKDF2_ITERATIONS = 600_000;
export const MIN_WORKSPACE_ARCHIVE_PASSPHRASE_CHARACTERS = 12;
export const MAX_WORKSPACE_ARCHIVE_PASSPHRASE_BYTES = 1024;
export const MAX_ENCRYPTED_WORKSPACE_ARCHIVE_BYTES = Math.ceil(MAX_WORKSPACE_ARCHIVE_BYTES * 4 / 3) + 4096;

export const CASE_BROWSER_COMPATIBILITY = defineSchemaCompatibility({
  id: 'browser.cases', kind: 'browser_store', schema: null, currentVersion: CASE_SCHEMA_VERSION,
  supportedVersions: CASE_BROWSER_SUPPORTED_VERSIONS, acceptsUnversionedLegacy: true,
  futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current',
  writeSemantics: 'normalized_rewrite', byteBudget: MAX_CASE_STORE_BYTES, owner: CASE_CONTRACT_OWNER,
  note: 'Version 14 retains strictly validated submitted hostnames on their point-in-time evidence snapshots; version 13 and older normalise them to null, and future stores are preserved without write.',
});
export const CASE_EXPORT_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.cases', kind: 'export', schema: null, currentVersion: CASE_SCHEMA_VERSION,
  supportedVersions: CASE_IMPORT_VERSIONS, acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'reject', migration: 'normalize_to_current',
  writeSemantics: 'non_destructive_merge', byteBudget: MAX_CASE_IMPORT_BYTES, owner: CASE_CONTRACT_OWNER,
  note: 'Portable Case versions 2 through 14 merge non-destructively through exact bounded readers; writers emit version 14 only and reject future versions.',
});
export const CASE_REPORT_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.case-report', kind: 'export', schema: CASE_REPORT_SCHEMA, currentVersion: CASE_REPORT_SCHEMA_VERSION,
  supportedVersions: CASE_REPORT_OUTPUT_VERSIONS, acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only',
  byteBudget: null, owner: CASE_CONTRACT_OWNER,
  note: 'Case reports are output contracts. Versions 1 through 8 are frozen output history and version 9 is the only emitted report.',
});
export const CASE_RESPONSE_PACKET_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.case-response-packet', kind: 'export', schema: CASE_RESPONSE_PACKET_SCHEMA,
  currentVersion: CASE_RESPONSE_PACKET_VERSION, supportedVersions: CASE_RESPONSE_PACKET_OUTPUT_VERSIONS,
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'read_only',
  writeSemantics: 'read_only', byteBudget: null, owner: CASE_CONTRACT_OWNER,
  note: 'Packet versions 1 through 4 are frozen output history, versions 5 and 6 retain exact offline verification, and version 7 is current.',
});
export const CASE_RESPONSE_REVIEW_INPUTS_COMPATIBILITY = defineSchemaCompatibility({
  id: 'derived.case-response-review-inputs', kind: 'derived', schema: CASE_RESPONSE_REVIEW_INPUTS_SCHEMA,
  currentVersion: CASE_RESPONSE_REVIEW_INPUTS_VERSION, supportedVersions: [CASE_RESPONSE_REVIEW_INPUTS_VERSION],
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only',
  writeSemantics: 'read_only', byteBudget: null, owner: CASE_CONTRACT_OWNER,
  note: 'Exact bounded review inputs are canonicalised with sorted-json-v2 for one response authorisation digest and reject extensions or future versions.',
});
export const CLI_CASE_PACK_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.cli-case-pack', kind: 'export', schema: CLI_CASE_PACK_SCHEMA, currentVersion: CLI_CASE_PACK_VERSION,
  supportedVersions: SUPPORTED_CLI_CASE_PACK_VERSIONS, acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'reject', migration: 'read_only', writeSemantics: 'read_only',
  byteBudget: MAX_CASE_IMPORT_BYTES, owner: CASE_CONTRACT_OWNER,
  note: 'Case-pack versions 1 and 2 retain exact Case and report epoch pairing; writers emit version 2 with deterministic sorted-json-v2 integrity.',
});
export const WORKSPACE_ARCHIVE_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.workspace-archive', kind: 'export', schema: WORKSPACE_ARCHIVE_SCHEMA,
  currentVersion: WORKSPACE_ARCHIVE_VERSION, supportedVersions: SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS,
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'normalize_to_current',
  writeSemantics: 'non_destructive_merge', byteBudget: MAX_WORKSPACE_ARCHIVE_BYTES, owner: CASE_CONTRACT_OWNER,
  note: 'Workspace envelope versions 1 through 5 retain independent section declarations, exact checksums, preview-first import, and version-5-only output.',
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

const CASE_CONTENT_DIGESTS = Object.freeze({
  'case-response-packet-v3': 'sha256:85dd2442e2f07eb33f7dfc61791ad586e4cfd3b06d2636037edbb82645d17697',
  'case-response-packet-v4': 'sha256:8f5c32c18764b4a25c5bcc6ac1e5bfcd5f75d0a5effca03a9fa72da00952f1f6',
  'case-response-packet-v5': 'sha256:6cf926a9825e3174158583c531b23523e0ef82bb2628db7db43aa3071ee08444',
  'case-response-packet-v6': 'sha256:29a5185a3d944af38c9656706fe89d96e60f949e8684646a55c8bcd10de54746',
  'case-response-packet-v7': 'sha256:fa5b7f079882dd72b15365d844937ae99e47f81465e79b3911c25e70c157e562',
  'cli-case-pack-v1': 'sha256:eb599762ee85189b595832a09d0d7274eeb45da82a6e729aa0d8f3bcf0ad03ee',
  'cli-case-pack-v2': 'sha256:d37579b77ca22d5f89d0e6e6557a78fb472fb8cc1e15a7ee95098107fd806dc0',
} as const);

const CASE_LIFECYCLE_FIXTURE_FILES = Object.freeze([
  { path: "test/fixtures/case-lifecycle/browser-case-unversioned-to-v14.json", bytes: 3493, sha256: "d7df287751b3ffb6b5edf7af87aca6021223bd9e020e480f353c382e0b12ec4e" },
  { path: "test/fixtures/case-lifecycle/browser-case-unversioned.json", bytes: 3606, sha256: "b0796880da2f1fd8565149d902fd15cd9ed0ee6603cf93676054fb68defb23c2" },
  { path: "test/fixtures/case-lifecycle/browser-case-v1-to-v14.json", bytes: 3673, sha256: "24c7bcddb83b7b5bcbdc86ec40c22f726ef5f34fa6a2e8aed2342eb45a6f19df" },
  { path: "test/fixtures/case-lifecycle/browser-case-v1.json", bytes: 3889, sha256: "60cdb944e2bd1c9b523e67894adb4c0eae23c0ab446af056466de0598a1c9987" },
  { path: "test/fixtures/case-lifecycle/browser-case-v10-to-v14.json", bytes: 6283, sha256: "a63afa162a26aac5fda6154d03334976acc9cbfbf2bbe72c1876c210fa9386b4" },
  { path: "test/fixtures/case-lifecycle/browser-case-v10.json", bytes: 7754, sha256: "63cb875bdc690146043ccc3cee1c5c7ec3d3c795bdf24d0a85d36ab87ff418cf" },
  { path: "test/fixtures/case-lifecycle/browser-case-v11-to-v14.json", bytes: 6526, sha256: "301dcc82413fbd9beff06e773e9302b639ddefd813e188ea11b61a111fcbfcb3" },
  { path: "test/fixtures/case-lifecycle/browser-case-v11.json", bytes: 8224, sha256: "584bb4f96e2bb32017d1f2cbaeb776af95385ce00cbf58471d0c0befb1bd7d3b" },
  { path: "test/fixtures/case-lifecycle/browser-case-v12-to-v14.json", bytes: 6537, sha256: "0b632b595165a10b591d63da9162119f7ed234843004c10cb0fa4027b8bb6b2c" },
  { path: "test/fixtures/case-lifecycle/browser-case-v12.json", bytes: 8442, sha256: "a6b2f7055f3e4ec6c4bacc0a2ef897a63e73b1b2a18161deae7d697bf7ac2c2c" },
  { path: "test/fixtures/case-lifecycle/browser-case-v13-to-v14.json", bytes: 2175, sha256: "2c24b3cc1714a7e08d917e814bcb9919ea7e8edc1370b8f5d4a6afe0480328e7" },
  { path: "test/fixtures/case-lifecycle/browser-case-v13.json", bytes: 3096, sha256: "d679030e52340ecc7795ac88de15316d88c8c07b94b34da60fd52589a0375712" },
  { path: "test/fixtures/case-lifecycle/browser-case-v14.json", bytes: 3096, sha256: "ce3cdab82023b9e5cd01f002a060d5ff2beb9cd73b0a49b89d125bc0a2ae3314" },
  { path: "test/fixtures/case-lifecycle/browser-case-v2-to-v14.json", bytes: 3673, sha256: "24c7bcddb83b7b5bcbdc86ec40c22f726ef5f34fa6a2e8aed2342eb45a6f19df" },
  { path: "test/fixtures/case-lifecycle/browser-case-v2.json", bytes: 3889, sha256: "af6edc6cb6825eaf2a8deeaf192cf4405771e123a735d5bd63b88864bc965866" },
  { path: "test/fixtures/case-lifecycle/browser-case-v3-to-v14.json", bytes: 5077, sha256: "2a0b0f134b7ec03ff1c5009d897e87280e94bcb59c99ea5e5e72b99708d95863" },
  { path: "test/fixtures/case-lifecycle/browser-case-v3.json", bytes: 5008, sha256: "9ae2adb00b45e730721de98fe476f229c8b93318fa46a9d48715c9badf1f5365" },
  { path: "test/fixtures/case-lifecycle/browser-case-v4-to-v14.json", bytes: 5520, sha256: "6a8b8db311c9103dd7401c94af3ded8ac930ca95b20b9ef20edbc2cefbd9bd28" },
  { path: "test/fixtures/case-lifecycle/browser-case-v4.json", bytes: 5662, sha256: "c6f0e65ca7d17aae22733510c8558052412939b4524b0d91b13f4d98c2791727" },
  { path: "test/fixtures/case-lifecycle/browser-case-v5-to-v14.json", bytes: 5541, sha256: "1959b1fd19766845a967b7e9711bca5c65e3beb1266347f0e36a454a8a27ed31" },
  { path: "test/fixtures/case-lifecycle/browser-case-v5.json", bytes: 5900, sha256: "a82ad71b95269b9ee08dd2b00afb88012f533b50336b9e78c3e0db3568706211" },
  { path: "test/fixtures/case-lifecycle/browser-case-v6-to-v14.json", bytes: 5541, sha256: "1959b1fd19766845a967b7e9711bca5c65e3beb1266347f0e36a454a8a27ed31" },
  { path: "test/fixtures/case-lifecycle/browser-case-v6.json", bytes: 5900, sha256: "cd3a31cb05a99f0537f757ff256b6256c92f2962ec6500575cf491be84ac8ef6" },
  { path: "test/fixtures/case-lifecycle/browser-case-v7-to-v14.json", bytes: 6010, sha256: "fe701e18af6444b4937985ef70adb9824b941b7f599278c23763bb5458099d5c" },
  { path: "test/fixtures/case-lifecycle/browser-case-v7.json", bytes: 6657, sha256: "8dfcdda1dde4b30acb7ec996d531aee2b63c72984d019cdac0cea7c1cd769338" },
  { path: "test/fixtures/case-lifecycle/browser-case-v8-to-v14.json", bytes: 6016, sha256: "b1cf1e1585db64a6b54c10aaf23937152e5474290c029577fe0a60022f609058" },
  { path: "test/fixtures/case-lifecycle/browser-case-v8.json", bytes: 6743, sha256: "52a89009905f1c4a434b3966a61c896f005c1012e242c34f8485e6548c77c4be" },
  { path: "test/fixtures/case-lifecycle/browser-case-v9-to-v14.json", bytes: 6285, sha256: "c99966a39885460dae2ce055a63b8ff76a8e198cc34d554967bfbe870bf6f1b2" },
  { path: "test/fixtures/case-lifecycle/browser-case-v9.json", bytes: 7180, sha256: "2f6d13a6e1820531f0d90fc444e4dd600a0a7ed13498fe43464da9a7a5bd7c1a" },
  { path: "test/fixtures/case-lifecycle/case-export-v10-to-v14.json", bytes: 9815, sha256: "52ad629590a5c278bfe788916eea3a5b9c763514c48a9abe99512c2d491f6499" },
  { path: "test/fixtures/case-lifecycle/case-export-v10.json", bytes: 7798, sha256: "95efc3d8f94f83b5de7b1e2e9567e9d944d7d7684b664568a237bc5e245aadb1" },
  { path: "test/fixtures/case-lifecycle/case-export-v11-to-v14.json", bytes: 10263, sha256: "3f5dfbc5d89d4cc7d2069490b750b1f1735cee39afda612989c79548e363f029" },
  { path: "test/fixtures/case-lifecycle/case-export-v11.json", bytes: 8268, sha256: "0ea1d3c890909ee8343b4c6baf12de6162e9b53c6be2843007155a36d6927314" },
  { path: "test/fixtures/case-lifecycle/case-export-v12-to-v14.json", bytes: 10290, sha256: "f55aba52c0ffd3b4822c18b9249f1a2cc766373c39de12c3cf18e58d61d31dab" },
  { path: "test/fixtures/case-lifecycle/case-export-v12.json", bytes: 8486, sha256: "e0deb52e3cb64bcc216e3cbc299e62f51608afa73d92a11eba7a4a1b88740145" },
  { path: "test/fixtures/case-lifecycle/case-export-v13-to-v14.json", bytes: 3140, sha256: "77fa7f41c4c16ac90d2ede534f2da84633e20a6ad40e69268da7c56e86ab82ed" },
  { path: "test/fixtures/case-lifecycle/case-export-v13.json", bytes: 3140, sha256: "fd2aa7623c2aaea385b952727ad74cf5af0f1ee21dc478c0e5c820a332376a0d" },
  { path: "test/fixtures/case-lifecycle/case-export-v14.json", bytes: 3140, sha256: "77fa7f41c4c16ac90d2ede534f2da84633e20a6ad40e69268da7c56e86ab82ed" },
  { path: "test/fixtures/case-lifecycle/case-export-v2-to-v14.json", bytes: 5646, sha256: "76a9b16fefdba6a39c3e4fbd7b0deeaf48a93aff8f4c2b1ae6503eaf9c70259f" },
  { path: "test/fixtures/case-lifecycle/case-export-v2.json", bytes: 3933, sha256: "a7975c5c9c3430acf600ebd672746e4f2ae67e010291ae394f691ea520301c8a" },
  { path: "test/fixtures/case-lifecycle/case-export-v3-to-v14.json", bytes: 7906, sha256: "6299201b23d6da676d98ede791c3d8a0ec95075add6cf26ea05baa02498a14ab" },
  { path: "test/fixtures/case-lifecycle/case-export-v3.json", bytes: 5052, sha256: "9d9e2d9a89ee52a1af6124d80aab32fb58fecf066240ec5ed485a7697a67c7e8" },
  { path: "test/fixtures/case-lifecycle/case-export-v4-to-v14.json", bytes: 8660, sha256: "d3eaa42761c1e15f719291e19020245f9daed82524db07a209c0f4da7f0438ab" },
  { path: "test/fixtures/case-lifecycle/case-export-v4.json", bytes: 5706, sha256: "d0a704772257d4a3b5d4c30cf186b4c89c3eed2104bf153fabab2baf045afb9d" },
  { path: "test/fixtures/case-lifecycle/case-export-v5-to-v14.json", bytes: 8681, sha256: "278c6efe6a5eda215be19990f3d3486468525637f38a4ddb702a01f7502b1d2f" },
  { path: "test/fixtures/case-lifecycle/case-export-v5.json", bytes: 5944, sha256: "bec24dc8d2b4acbfcf13ccf57e65c7416b23dad1ee9f0dd1abd1d872334918a4" },
  { path: "test/fixtures/case-lifecycle/case-export-v6-to-v14.json", bytes: 8681, sha256: "278c6efe6a5eda215be19990f3d3486468525637f38a4ddb702a01f7502b1d2f" },
  { path: "test/fixtures/case-lifecycle/case-export-v6.json", bytes: 5944, sha256: "61b52058fe366b76893fe12611040160a446d13f720cd294a0fe60eea72bfd1f" },
  { path: "test/fixtures/case-lifecycle/case-export-v7-to-v14.json", bytes: 9397, sha256: "e82fdeeb7ff0073d9a3832333631a0f22ba3541b6dece7237a9a109e1ea3c6f7" },
  { path: "test/fixtures/case-lifecycle/case-export-v7.json", bytes: 6701, sha256: "d857c9b64b7082187627d51aad56e934721274b4bd0e890a11d0da8010b2bced" },
  { path: "test/fixtures/case-lifecycle/case-export-v8-to-v14.json", bytes: 9403, sha256: "352ab90d227c55435d38ed2c2aa466b7e83400d5ced9b4970db994acd442a891" },
  { path: "test/fixtures/case-lifecycle/case-export-v8.json", bytes: 6787, sha256: "0d19b54dfceeec6b4071b93d0eb381a2acb58292be4ef7488dddf047a38a9419" },
  { path: "test/fixtures/case-lifecycle/case-export-v9-to-v14.json", bytes: 9817, sha256: "bb7a317e7b0b5c4f3d6da6bebbce15898b68d8c421c9bc1ad8d810912f9ec0f9" },
  { path: "test/fixtures/case-lifecycle/case-export-v9.json", bytes: 7224, sha256: "33c97c749640ae3484c73043d8335f4fda96468b3d9570d850b054066c87ddbe" },
  { path: "test/fixtures/case-lifecycle/case-report-v1.json", bytes: 7498, sha256: "37977f9591af8b8e1aa2c01b4a2075bda93ef1d9635d2a5b24d7aaa19efebe5b" },
  { path: "test/fixtures/case-lifecycle/case-report-v2.json", bytes: 8566, sha256: "8a4b0046df9e6a01f15df202c3d2a63973946623641ac4ec53ebc954dd4bb15a" },
  { path: "test/fixtures/case-lifecycle/case-report-v3.json", bytes: 9174, sha256: "769c50ad8b517d71be5414837e19142cd33348ced1686d4953973a2f151b816e" },
  { path: "test/fixtures/case-lifecycle/case-report-v4.json", bytes: 10646, sha256: "517994b45e09460f7979f906aeb10ef8f3a3dbae2ce56f4efcae5502993ce263" },
  { path: "test/fixtures/case-lifecycle/case-report-v5.json", bytes: 11216, sha256: "c13d9fa661f329dd2540f6c7fd48e96bc4c9fcc12d9c8b8610bf4b174750ebc0" },
  { path: "test/fixtures/case-lifecycle/case-report-v6.json", bytes: 11473, sha256: "9c682d8fc36fabd4b959c956f2e0681e5fc6e9871a5dd03c1f9c4404cbae791d" },
  { path: "test/fixtures/case-lifecycle/case-report-v7.json", bytes: 11905, sha256: "978d839d7b0a5daa486338d63f3dd33884b7f1e39c79a7f0deefce81ade99868" },
  { path: "test/fixtures/case-lifecycle/case-report-v8.json", bytes: 12337, sha256: "d1a6b0412e84b67f70e84055fcb391a92a5ae1a6d573a5756d83c524d2bfc1ad" },
  { path: "test/fixtures/case-lifecycle/case-report-v9.json", bytes: 2761, sha256: "d9903318123c63ae7a385f153286a5596585a401771c8def8149792b9b7b9326" },
  { path: "test/fixtures/case-lifecycle/case-response-packet-v1.json", bytes: 1152, sha256: "a47c0412770729f3b3698b36132f8aa0c22bbdf5ce660daa76b40789baa23653" },
  { path: "test/fixtures/case-lifecycle/case-response-packet-v2.json", bytes: 1177, sha256: "51213bb3ca70b91ca2363667ada03281f084b68184d390e8b4f16d0dc6381ed0" },
  { path: "test/fixtures/case-lifecycle/case-response-packet-v3.json", bytes: 1546, sha256: "432b0df8dfe0b3d6f6f4e665b9000e20534c57850f26d0c0dc457352c51ded8d" },
  { path: "test/fixtures/case-lifecycle/case-response-packet-v4.json", bytes: 3619, sha256: "0801b026e1dadaf1375f6708a39c62ee0b4c5e8e6593dad350ce5f05f4d6b551" },
  { path: "test/fixtures/case-lifecycle/case-response-packet-v5.json", bytes: 5100, sha256: "eee842140eea9e13f733f57bb76f6cabf907f06085b31d1ae3ff276d646c51f2" },
  { path: "test/fixtures/case-lifecycle/case-response-packet-v6.json", bytes: 5100, sha256: "32030d3941119dce378dc03f6b3f5d710ce3883e7253cd43fa322c989ff529cb" },
  { path: "test/fixtures/case-lifecycle/case-response-packet-v7.json", bytes: 10000, sha256: "0ea150d920710b331839be0a0f995d4597a133ecb930ef850de1eecfca4d94e3" },
  { path: "test/fixtures/case-lifecycle/case-response-review-inputs-v1.json", bytes: 5555, sha256: "67d3d36f316cf17898e04c39f2ba0ba7599abdc4b4e387baef5f5866a73c7b9c" },
  { path: "test/fixtures/case-lifecycle/cli-case-pack-v1.json", bytes: 24274, sha256: "2a0902ee6db38361aa649da19969794e00d2654a29f2f24a36361838d27f0746" },
  { path: "test/fixtures/case-lifecycle/cli-case-pack-v2-case-v14.json", bytes: 9289, sha256: "4804b1b1a908753faf7921fec752a10cda95d5f5e17bccf1a1f8f7e7153e1f64" },
  { path: "test/fixtures/case-lifecycle/cli-case-pack-v2.json", bytes: 9289, sha256: "b2f94cd670d0514eaa8d2d448e5f21ffa5121409a260e76936c2add0f0b50af4" },
  { path: "test/fixtures/case-lifecycle/encrypted-workspace-archive-v1.json", bytes: 8628, sha256: "39953d8bddd1ff9b2d3ea62b488fec2b26b62ec5b9869cda49ba8336832af8e7" },
  { path: "test/fixtures/case-lifecycle/workspace-archive-v1-to-v5.json", bytes: 6863, sha256: "7a1f5e2d79e1ee91f2a31a18339cc79394097f142a242be8e3432676266a67f3" },
  { path: "test/fixtures/case-lifecycle/workspace-archive-v1.json", bytes: 3838, sha256: "9f07d0722d26445f5830dd87aeeafc7678fc1b843a9e0795ecd7bf87fe269d57" },
  { path: "test/fixtures/case-lifecycle/workspace-archive-v2-to-v5.json", bytes: 6863, sha256: "7a1f5e2d79e1ee91f2a31a18339cc79394097f142a242be8e3432676266a67f3" },
  { path: "test/fixtures/case-lifecycle/workspace-archive-v2.json", bytes: 5209, sha256: "0c81cfe84b3a0e6b1ddd83bd6d0c0adb99402df614f069a9889e0bcae0ba751b" },
  { path: "test/fixtures/case-lifecycle/workspace-archive-v3-to-v5.json", bytes: 6863, sha256: "7a1f5e2d79e1ee91f2a31a18339cc79394097f142a242be8e3432676266a67f3" },
  { path: "test/fixtures/case-lifecycle/workspace-archive-v3.json", bytes: 5663, sha256: "59c5cd8d54e1c4eae170b7c1b4421c442798c01baaa40090462090d0ee398844" },
  { path: "test/fixtures/case-lifecycle/workspace-archive-v4-to-v5.json", bytes: 6863, sha256: "7a1f5e2d79e1ee91f2a31a18339cc79394097f142a242be8e3432676266a67f3" },
  { path: "test/fixtures/case-lifecycle/workspace-archive-v4.json", bytes: 6482, sha256: "9e8c25bbc8a5f6ed22bdf3b66980b4ecf98dfe40078a420249e29dce1f6cfc08" },
  { path: "test/fixtures/case-lifecycle/workspace-archive-v5-case-v14-current.json", bytes: 8174, sha256: "cc8bb2e069f81f56a456d946f3f0526b2a3bcb52dcf99b8b2e46c72e2b8ff213" },
  { path: "test/fixtures/case-lifecycle/workspace-archive-v5-current.json", bytes: 8174, sha256: "5e8f50d83e1f67e9bcf6b60039509dee7620408fbaf65c77342aeafbc36ef600" },
  { path: "test/fixtures/case-lifecycle/workspace-archive-v5.json", bytes: 6861, sha256: "96aa758b0a63d0070e23d7a39a760e834cc44e44b1696dc2138b272909292b6d" },
  { path: "test/fixtures/case-lifecycle/workspace-settings-v1.json", bytes: 110, sha256: "75675baf68765da5d36e9911d106dd8b72a8fd3c859136b651411d8041a4e184" },
] as const);

function fixtureId(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1, -'.json'.length);
}
function numberedVersion(id: string, prefix: string): number | null {
  const match = new RegExp(`^${prefix}-v(\\d+)(?:-|$)`, 'u').exec(id);
  return match ? Number(match[1]) : null;
}
function fixtureContract(id: string) {
  if (id === 'browser-case-unversioned-to-v14') return {
    schema: CASE_BROWSER_STORE_LIFECYCLE_SCHEMA, version: CASE_SCHEMA_VERSION, role: 'current' as const,
    expectation: 'accepted_exact' as const, expectedOutputFixtureId: null,
    shapeId: 'case.browser-store.current',
  };
  if (id === 'browser-case-unversioned') return {
    schema: CASE_BROWSER_STORE_LIFECYCLE_SCHEMA, version: 1, role: 'historical' as const,
    expectation: 'normalises_to_current_output' as const, expectedOutputFixtureId: 'browser-case-unversioned-to-v14',
    shapeId: 'case.browser-store.historical',
  };
  const browserVersion = numberedVersion(id, 'browser-case');
  if (browserVersion !== null) {
    const migration = id.endsWith('-to-v14');
    return {
      schema: CASE_BROWSER_STORE_LIFECYCLE_SCHEMA,
      version: migration ? CASE_SCHEMA_VERSION : browserVersion,
      role: migration || browserVersion === CASE_SCHEMA_VERSION ? 'current' as const : 'historical' as const,
      expectation: migration || browserVersion === CASE_SCHEMA_VERSION ? 'accepted_exact' as const : 'normalises_to_current_output' as const,
      expectedOutputFixtureId: browserVersion < CASE_SCHEMA_VERSION && !migration ? `browser-case-v${browserVersion}-to-v14` : null,
      shapeId: migration || browserVersion === CASE_SCHEMA_VERSION ? 'case.browser-store.current' : 'case.browser-store.historical',
    };
  }
  const exportVersion = numberedVersion(id, 'case-export');
  if (exportVersion !== null) {
    const migration = id.endsWith('-to-v14');
    return {
      schema: CASE_EXPORT_LIFECYCLE_SCHEMA,
      version: migration ? CASE_SCHEMA_VERSION : exportVersion,
      role: migration || exportVersion === CASE_SCHEMA_VERSION ? 'current' as const : 'historical' as const,
      expectation: migration || exportVersion === CASE_SCHEMA_VERSION ? 'accepted_exact' as const : 'normalises_to_current_output' as const,
      expectedOutputFixtureId: exportVersion < CASE_SCHEMA_VERSION && !migration ? `case-export-v${exportVersion}-to-v14` : null,
      shapeId: migration || exportVersion === CASE_SCHEMA_VERSION ? 'case.export.current' : 'case.export.historical',
    };
  }
  const reportVersion = numberedVersion(id, 'case-report');
  if (reportVersion !== null) return {
    schema: CASE_REPORT_SCHEMA, version: reportVersion,
    role: reportVersion === CASE_REPORT_SCHEMA_VERSION ? 'current' as const : 'historical' as const,
    expectation: reportVersion === CASE_REPORT_SCHEMA_VERSION ? 'accepted_exact' as const : 'historical_output_exact' as const,
    expectedOutputFixtureId: null,
    shapeId: reportVersion === 1 ? 'case.report.v1' : reportVersion < 9 ? 'case.report.v2-v8' : 'case.report.v9',
  };
  const packetVersion = numberedVersion(id, 'case-response-packet');
  if (packetVersion !== null) return {
    schema: CASE_RESPONSE_PACKET_SCHEMA, version: packetVersion,
    role: packetVersion === CASE_RESPONSE_PACKET_VERSION ? 'current' as const : 'historical' as const,
    expectation: packetVersion < LEGACY_CASE_RESPONSE_PACKET_VERSION ? 'historical_output_exact' as const : 'accepted_exact' as const,
    expectedOutputFixtureId: null,
    shapeId: packetVersion <= 2 ? 'case.response-packet.v1-v2'
      : packetVersion === 3 ? 'case.response-packet.v3'
        : packetVersion === 4 ? 'case.response-packet.v4'
          : packetVersion <= 6 ? 'case.response-packet.v5-v6' : 'case.response-packet.v7',
  };
  if (id === 'case-response-review-inputs-v1') return {
    schema: CASE_RESPONSE_REVIEW_INPUTS_SCHEMA, version: CASE_RESPONSE_REVIEW_INPUTS_VERSION,
    role: 'current' as const, expectation: 'accepted_exact' as const, expectedOutputFixtureId: null,
    shapeId: 'case.response-review-inputs.v1',
  };
  const packVersion = numberedVersion(id, 'cli-case-pack');
  if (packVersion !== null) return {
    schema: CLI_CASE_PACK_SCHEMA, version: packVersion,
    role: packVersion === CLI_CASE_PACK_VERSION ? 'current' as const : 'historical' as const,
    expectation: 'accepted_exact' as const, expectedOutputFixtureId: null,
    shapeId: packVersion === CLI_CASE_PACK_VERSION ? 'case.cli-pack.current' : 'case.cli-pack.historical',
  };
  const workspaceVersion = numberedVersion(id, 'workspace-archive');
  if (workspaceVersion !== null) {
    const migration = /-to-v5$/u.test(id);
    return {
      schema: WORKSPACE_ARCHIVE_SCHEMA, version: migration ? WORKSPACE_ARCHIVE_VERSION : workspaceVersion,
      role: migration || workspaceVersion === WORKSPACE_ARCHIVE_VERSION ? 'current' as const : 'historical' as const,
      expectation: migration || workspaceVersion === WORKSPACE_ARCHIVE_VERSION ? 'accepted_exact' as const : 'normalises_to_current_output' as const,
      expectedOutputFixtureId: workspaceVersion < WORKSPACE_ARCHIVE_VERSION && !migration ? `workspace-archive-v${workspaceVersion}-to-v5` : null,
      shapeId: migration || workspaceVersion === WORKSPACE_ARCHIVE_VERSION ? 'case.workspace-archive.current' : 'case.workspace-archive.historical',
    };
  }
  if (id === 'encrypted-workspace-archive-v1') return {
    schema: ENCRYPTED_WORKSPACE_ARCHIVE_SCHEMA, version: ENCRYPTED_WORKSPACE_ARCHIVE_VERSION,
    role: 'current' as const, expectation: 'accepted_exact' as const, expectedOutputFixtureId: null,
    shapeId: 'case.encrypted-workspace-archive.v1',
  };
  if (id === 'workspace-settings-v1') return {
    schema: WORKSPACE_SETTINGS_SCHEMA, version: WORKSPACE_SETTINGS_VERSION,
    role: 'current' as const, expectation: 'accepted_exact' as const, expectedOutputFixtureId: null,
    shapeId: 'case.workspace-settings.v1',
  };
  throw new TypeError(`Unclassified Case lifecycle fixture: ${id}`);
}

const CASE_LIFECYCLE_FIXTURES = Object.freeze(CASE_LIFECYCLE_FIXTURE_FILES.map((file) => {
  const id = fixtureId(file.path);
  return Object.freeze({
    id, path: file.path, bytes: file.bytes, sha256: file.sha256,
    contentDigestSha256: CASE_CONTENT_DIGESTS[id as keyof typeof CASE_CONTENT_DIGESTS] ?? null,
    ...fixtureContract(id), scope: 'repository' as const,
  });
}));
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
  emitted: version === CASE_SCHEMA_VERSION, exactKeys: false, extensionPolicy: 'discard_bounded',
  futureVersionBehaviour: 'preserve_without_write',
  migrationTarget: version === CASE_SCHEMA_VERSION ? null : { schema: CASE_BROWSER_STORE_LIFECYCLE_SCHEMA, version: CASE_SCHEMA_VERSION },
  canonicalisation: null, byteBudget: MAX_CASE_STORE_BYTES,
}));
const exportContracts = CASE_IMPORT_VERSIONS.map((version) => lifecycleContract({
  compatibilityId: CASE_EXPORT_COMPATIBILITY.id, schema: CASE_EXPORT_LIFECYCLE_SCHEMA, version,
  lifecycle: version === CASE_SCHEMA_VERSION ? 'current' : 'legacy', readable: true,
  emitted: version === CASE_SCHEMA_VERSION, exactKeys: true, extensionPolicy: 'reject',
  futureVersionBehaviour: 'reject',
  migrationTarget: version === CASE_SCHEMA_VERSION ? null : { schema: CASE_EXPORT_LIFECYCLE_SCHEMA, version: CASE_SCHEMA_VERSION },
  canonicalisation: null, byteBudget: MAX_CASE_IMPORT_BYTES,
}));
const reportContracts = CASE_REPORT_OUTPUT_VERSIONS.map((version) => lifecycleContract({
  compatibilityId: CASE_REPORT_COMPATIBILITY.id, schema: CASE_REPORT_SCHEMA, version,
  lifecycle: version === CASE_REPORT_SCHEMA_VERSION ? 'current' : 'retired', readable: false,
  emitted: version === CASE_REPORT_SCHEMA_VERSION, exactKeys: true, extensionPolicy: 'reject',
  futureVersionBehaviour: 'not_applicable', migrationTarget: null, canonicalisation: null, byteBudget: null,
}));
const packetContracts = CASE_RESPONSE_PACKET_OUTPUT_VERSIONS.map((version) => lifecycleContract({
  compatibilityId: CASE_RESPONSE_PACKET_COMPATIBILITY.id, schema: CASE_RESPONSE_PACKET_SCHEMA, version,
  lifecycle: version < LEGACY_CASE_RESPONSE_PACKET_VERSION ? 'retired'
    : version === CASE_RESPONSE_PACKET_VERSION ? 'current' : 'legacy',
  readable: version >= LEGACY_CASE_RESPONSE_PACKET_VERSION,
  emitted: version === CASE_RESPONSE_PACKET_VERSION, exactKeys: true, extensionPolicy: 'reject',
  futureVersionBehaviour: version < LEGACY_CASE_RESPONSE_PACKET_VERSION ? 'not_applicable' : 'reject',
  migrationTarget: null,
  canonicalisation: version < 3 ? null : version <= LEGACY_CASE_RESPONSE_PACKET_VERSION ? 'sorted-json-v1' : 'sorted-json-v2',
  byteBudget: null,
}));
const workspaceContracts = SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS.map((version) => lifecycleContract({
  compatibilityId: WORKSPACE_ARCHIVE_COMPATIBILITY.id, schema: WORKSPACE_ARCHIVE_SCHEMA, version,
  lifecycle: version === WORKSPACE_ARCHIVE_VERSION ? 'current' : 'legacy', readable: true,
  emitted: version === WORKSPACE_ARCHIVE_VERSION, exactKeys: true, extensionPolicy: 'reject',
  futureVersionBehaviour: 'reject',
  migrationTarget: version === WORKSPACE_ARCHIVE_VERSION ? null : { schema: WORKSPACE_ARCHIVE_SCHEMA, version: WORKSPACE_ARCHIVE_VERSION },
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
    'case.browser-store.historical',
    CASE_BROWSER_STORE_LIFECYCLE_SCHEMA,
    CASE_BROWSER_SUPPORTED_VERSIONS.slice(0, -1),
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
    'case.export.historical',
    CASE_EXPORT_LIFECYCLE_SCHEMA,
    CASE_IMPORT_VERSIONS.slice(0, -1),
    ['version', 'cases'],
    'preserve_document',
  ),
  shape(
    'case.export.current',
    CASE_EXPORT_LIFECYCLE_SCHEMA,
    [CASE_SCHEMA_VERSION],
    ['version', 'cases'],
    'preserve_document',
  ),
  shape(
    'case.report.v1',
    CASE_REPORT_SCHEMA,
    [1],
    ['schema', 'schemaVersion', 'generatedAt', 'application', 'case', 'currentAssessment', 'evidenceTimeline', 'limitations'],
    'preserve_document',
  ),
  shape(
    'case.report.v2-v8',
    CASE_REPORT_SCHEMA,
    CASE_REPORT_RETIRED_OUTPUT_VERSIONS.slice(1),
    ['schema', 'schemaVersion', 'generatedAt', 'application', 'case', 'currentAssessment', 'evidenceTimeline', 'analystResponse', 'limitations'],
    'preserve_document',
  ),
  shape(
    'case.report.v9',
    CASE_REPORT_SCHEMA,
    [CASE_REPORT_SCHEMA_VERSION],
    ['schema', 'schemaVersion', 'generatedAt', 'application', 'case', 'currentAssessment', 'evidenceTimeline', 'analystResponse', 'responseLifecycle', 'limitations'],
    'preserve_document',
  ),
  shape(
    'case.response-packet.v1-v2',
    CASE_RESPONSE_PACKET_SCHEMA,
    [1, 2],
    ['schema', 'schemaVersion', 'generatedAt', 'reviewRequired', 'submissionPerformed', 'case', 'incident', 'contacts', 'provenance'],
    'preserve_document',
  ),
  shape(
    'case.response-packet.v3',
    CASE_RESPONSE_PACKET_SCHEMA,
    [3],
    ['schema', 'schemaVersion', 'generatedAt', 'reviewRequired', 'submissionPerformed', 'case', 'incident', 'contacts', 'provenance', 'escalationHistory', 'integrity'],
    'preserve_signed_document',
  ),
  shape(
    'case.response-packet.v4',
    CASE_RESPONSE_PACKET_SCHEMA,
    [4],
    ['schema', 'schemaVersion', 'generatedAt', 'reviewRequired', 'submissionPerformed', 'case', 'incident', 'contacts', 'provenance', 'preflight', 'escalationHistory', 'integrity'],
    'preserve_signed_document',
  ),
  shape(
    'case.response-packet.v5-v6',
    CASE_RESPONSE_PACKET_SCHEMA,
    [5, 6],
    ['schema', 'schemaVersion', 'generatedAt', 'reviewRequired', 'submissionPerformed', 'profile', 'case', 'incident', 'contacts', 'provenance', 'preflight', 'escalationHistory', 'integrity'],
    'preserve_signed_document',
  ),
  shape(
    'case.response-packet.v7',
    CASE_RESPONSE_PACKET_SCHEMA,
    [7],
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
    'case.response-review-inputs.v1',
    CASE_RESPONSE_REVIEW_INPUTS_SCHEMA,
    [1],
    [
      'contract', 'version', 'profile', 'case', 'incident', 'contacts', 'selectedEvidence',
      'contradictions', 'readiness', 'artefactReferences', 'escalationHistory',
      'escalationHistoryOmitted', 'escalationHistoryLimitations', 'responseLifecycle',
    ],
    'preserve_signed_document',
  ),
  shape(
    'case.cli-pack.historical',
    CLI_CASE_PACK_SCHEMA,
    [1],
    CLI_CASE_PACK_ROOT_KEYS,
    'preserve_signed_document',
  ),
  shape(
    'case.cli-pack.current',
    CLI_CASE_PACK_SCHEMA,
    [2],
    CLI_CASE_PACK_ROOT_KEYS,
    'preserve_signed_document',
  ),
  shape(
    'case.workspace-archive.historical',
    WORKSPACE_ARCHIVE_SCHEMA,
    SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS.slice(0, -1),
    ['schema', 'version', 'generatedAt', 'manifest', 'sections', 'limitations'],
    'preserve_signed_document',
  ),
  shape(
    'case.workspace-archive.current',
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
    [1],
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
    module: 'cli/artifact-structure.mts',
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
    ['case.report.json.v9', CASE_REPORT_SCHEMA, [CASE_REPORT_SCHEMA_VERSION], 'none', []],
    ['case.packet.json.v5-v7', CASE_RESPONSE_PACKET_SCHEMA, [...SUPPORTED_CASE_RESPONSE_PACKET_VERSIONS], 'structural_only_requires_separate_verification', ['case.packet.verify']],
    ['case.workspace.json.v1-v5', WORKSPACE_ARCHIVE_SCHEMA, [...SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS], 'structural_only_requires_separate_verification', ['case.workspace.verify']],
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
    id: 'case.cli-pack.json.v1-v2',
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
    shapeIds: ['case.browser-store.historical', 'case.browser-store.current'],
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
    shapeIds: ['case.export.historical', 'case.export.current'],
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
    id: 'case.consumer.report-build',
    plane: 'shared',
    operation: 'build-report',
    acceptedContracts: [],
    emittedContract: { schema: CASE_REPORT_SCHEMA, version: CASE_REPORT_SCHEMA_VERSION, discriminator: null },
    shapeIds: ['case.report.v9'],
    boundProfileIds: ['case.domain.bounds'],
    hookIds: ['case.report.build', 'case.portable.serialise'],
    serialisationProfileId: 'case.report.json.v9',
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
    shapeIds: ['case.response-packet.v5-v6', 'case.response-packet.v7'],
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
    shapeIds: ['case.response-packet.v5-v6', 'case.response-packet.v7'],
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
    shapeIds: ['case.response-packet.v7'],
    boundProfileIds: ['case.packet.bounds'],
    hookIds: ['case.packet.build', 'case.portable.serialise'],
    serialisationProfileId: 'case.packet.json.v5-v7',
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
      versions: [CASE_RESPONSE_REVIEW_INPUTS_VERSION],
      mode: 'direct',
      discriminator: null,
    }],
    emittedContract: null,
    shapeIds: ['case.response-review-inputs.v1'],
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
    shapeIds: ['case.response-review-inputs.v1'],
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
    shapeIds: ['case.cli-pack.historical', 'case.cli-pack.current'],
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
      versions: [...CASE_IMPORT_VERSIONS],
      mode: 'direct',
      discriminator: null,
    }],
    emittedContract: { schema: CLI_CASE_PACK_SCHEMA, version: CLI_CASE_PACK_VERSION, discriminator: null },
    shapeIds: ['case.export.historical', 'case.export.current', 'case.cli-pack.current'],
    boundProfileIds: ['case.portable.bounds', 'case.domain.bounds', 'case.cli-pack.bounds'],
    hookIds: ['case.cli-pack.build', 'case.cli-pack.serialise'],
    serialisationProfileId: 'case.cli-pack.json.v1-v2',
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
    shapeIds: ['case.workspace-archive.historical', 'case.workspace-archive.current', 'case.workspace-settings.v1'],
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
    shapeIds: ['case.workspace-archive.current'],
    boundProfileIds: ['case.workspace.bounds'],
    hookIds: ['case.workspace.build', 'case.portable.serialise'],
    serialisationProfileId: 'case.workspace.json.v1-v5',
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
    shapeIds: [
      'case.workspace-archive.historical',
      'case.workspace-archive.current',
      'case.encrypted-workspace-archive.v1',
    ],
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
    lifecycleContract({
      compatibilityId: CASE_RESPONSE_REVIEW_INPUTS_COMPATIBILITY.id,
      schema: CASE_RESPONSE_REVIEW_INPUTS_SCHEMA,
      version: CASE_RESPONSE_REVIEW_INPUTS_VERSION,
      lifecycle: 'current',
      readable: true,
      emitted: true,
      exactKeys: true,
      extensionPolicy: 'reject',
      futureVersionBehaviour: 'reject',
      migrationTarget: null,
      canonicalisation: 'sorted-json-v2',
      byteBudget: null,
    }),
    lifecycleContract({
      compatibilityId: CLI_CASE_PACK_COMPATIBILITY.id,
      schema: CLI_CASE_PACK_SCHEMA,
      version: LEGACY_CLI_CASE_PACK_VERSION,
      lifecycle: 'legacy',
      readable: true,
      emitted: false,
      exactKeys: true,
      extensionPolicy: 'reject',
      futureVersionBehaviour: 'reject',
      migrationTarget: null,
      canonicalisation: 'sorted-json-v1',
      byteBudget: MAX_CASE_IMPORT_BYTES,
    }),
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
