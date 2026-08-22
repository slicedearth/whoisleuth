import { defineSchemaCompatibility } from './schema-compatibility.mts';
import { buildExtractedLifecycleFamilyV4 } from './extracted-domain-lifecycle.mts';
import { defineSchemaLifecycleFamily } from './schema-lifecycle.mts';
export const ANALYST_INTERCHANGE_CONTRACT_OWNER = 'packages/contracts/analyst-interchange.mts';
export const INVESTIGATION_CACAO_SPEC_VERSION = 'cacao-2.0';
export const INVESTIGATION_CACAO_PROFILE_VERSION = 2;
export const INVESTIGATION_CACAO_PROFILE_SEMVER = '2.0.0';
export const INVESTIGATION_CACAO_SUPPORTED_PROFILE_VERSIONS = [INVESTIGATION_CACAO_PROFILE_VERSION] as const;
export const MAX_INVESTIGATION_CACAO_IMPORT_BYTES = 384 * 1024;
export const BRAND_PROTECTION_OPERATIONS_REPORT_SCHEMA = 'whoisleuth.brand-protection-operations-report';
export const BRAND_PROTECTION_OPERATIONS_REPORT_VERSION = 2;
export const MAX_OPERATIONS_REPORT_BYTES = 64 * 1024;
export const DEFENSIVE_INDICATOR_LIFECYCLE_SCHEMA = 'whoisleuth.internal.defensive-indicators';
export const DEFENSIVE_INDICATOR_EXPORT_VERSION = 2;
export const DEFENSIVE_INDICATOR_MANIFEST_SCHEMA = 'whoisleuth.defensive-indicator-manifest';
export const DEFENSIVE_INDICATOR_ROLLBACK_SCHEMA = 'whoisleuth.defensive-indicator-rollback';
export const STIX_INDICATOR_LIFECYCLE_SCHEMA = 'whoisleuth.internal.stix-indicators';
export const STIX_INDICATOR_EXPORT_VERSION = 1;
export const MISP_INDICATOR_LIFECYCLE_SCHEMA = 'whoisleuth.internal.misp-indicators';
export const MISP_INDICATOR_EXPORT_VERSION = 1;
export const DNS_CHANGE_REHEARSAL_VERSION = 2;
export const DNS_CHANGE_REHEARSAL_EXPORT_SCHEMA = 'whoisleuth.dns-change-rehearsal';
export const MAIL_REPORT_SCHEMA = 'whoisleuth.mail-report-review';
export const MAIL_REPORT_VERSION = 1;
export const REGISTRATION_DISCLOSURE_PLAN_SCHEMA = 'whoisleuth.registration-disclosure-plan';
export const REGISTRATION_DISCLOSURE_PLAN_VERSION = 2;
export const STATIC_PAGE_PATTERN_PACK_SCHEMA = 'whoisleuth.static-page-pattern-pack';
export const STATIC_PAGE_PATTERN_PACK_VERSION = 2;
export const MAX_STATIC_PAGE_PATTERN_PACK_BYTES = 256 * 1024;
export const WEB_CAPTURE_SUMMARY_SCHEMA = 'whoisleuth.web-capture-summary';
export const WEB_CAPTURE_SUMMARY_VERSION = 1;
export const WEB_CAPTURE_MANIFEST_SCHEMA = 'whoisleuth.web-capture-manifest';
export const WEB_CAPTURE_MANIFEST_VERSION = 2;
export const MAX_WEB_CAPTURE_MANIFEST_BYTES = 1024 * 1024;

const CACAO_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.investigation-cacao-profile', kind: 'export', schema: INVESTIGATION_CACAO_SPEC_VERSION,
  currentVersion: INVESTIGATION_CACAO_PROFILE_VERSION, supportedVersions: INVESTIGATION_CACAO_SUPPORTED_PROFILE_VERSIONS,
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only',
  writeSemantics: 'non_destructive_merge', byteBudget: MAX_INVESTIGATION_CACAO_IMPORT_BYTES,
  owner: ANALYST_INTERCHANGE_CONTRACT_OWNER,
  note: 'Restricted CACAO 2.0 profile with a connected linear sequence of manual analyst steps; version 2 adds fixed response recipe identifiers while executable commands, branches, targets, credentials, and arbitrary operations remain rejected.',
});
const OPERATIONS_REPORT_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.brand-protection-operations-report', kind: 'export', schema: BRAND_PROTECTION_OPERATIONS_REPORT_SCHEMA,
  currentVersion: BRAND_PROTECTION_OPERATIONS_REPORT_VERSION, supportedVersions: [BRAND_PROTECTION_OPERATIONS_REPORT_VERSION],
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only',
  writeSemantics: 'read_only', byteBudget: MAX_OPERATIONS_REPORT_BYTES, owner: ANALYST_INTERCHANGE_CONTRACT_OWNER,
  note: 'Version 2 aggregates typed action and independent-effect events with explicit denominators, omissions, time-window basis, and limitations. It excludes case identities and is not a service level or provider ranking.',
});
const DEFENSIVE_INDICATORS_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.defensive-indicators', kind: 'export', schema: null,
  currentVersion: DEFENSIVE_INDICATOR_EXPORT_VERSION, supportedVersions: [DEFENSIVE_INDICATOR_EXPORT_VERSION],
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only',
  writeSemantics: 'read_only', byteBudget: null, owner: ANALYST_INTERCHANGE_CONTRACT_OWNER,
  note: 'Review-only indicator, provenance-manifest, and rollback formats; never submitted or applied automatically.',
});
const STIX_INDICATORS_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.stix-indicators', kind: 'export', schema: null,
  currentVersion: STIX_INDICATOR_EXPORT_VERSION, supportedVersions: [STIX_INDICATOR_EXPORT_VERSION],
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only',
  writeSemantics: 'read_only', byteBudget: null, owner: ANALYST_INTERCHANGE_CONTRACT_OWNER,
  note: 'STIX 2.1 bundle with direct observations separated from heuristic indicators.',
});
const MISP_INDICATORS_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.misp-indicators', kind: 'export', schema: null,
  currentVersion: MISP_INDICATOR_EXPORT_VERSION, supportedVersions: [MISP_INDICATOR_EXPORT_VERSION],
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only',
  writeSemantics: 'read_only', byteBudget: null, owner: ANALYST_INTERCHANGE_CONTRACT_OWNER,
  note: 'Unpublished, non-IDS, non-correlating event for reviewed import.',
});
const WEB_CAPTURE_SUMMARY_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.web-capture-summary', kind: 'export', schema: WEB_CAPTURE_SUMMARY_SCHEMA,
  currentVersion: WEB_CAPTURE_SUMMARY_VERSION, supportedVersions: [WEB_CAPTURE_SUMMARY_VERSION],
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only',
  writeSemantics: 'read_only', byteBudget: null, owner: ANALYST_INTERCHANGE_CONTRACT_OWNER,
  note: 'Sanitised metadata-only capture summary accepted through the bounded external-finding preview.',
});
const WEB_CAPTURE_MANIFEST_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.web-capture-manifest', kind: 'export', schema: WEB_CAPTURE_MANIFEST_SCHEMA,
  currentVersion: WEB_CAPTURE_MANIFEST_VERSION, supportedVersions: [WEB_CAPTURE_MANIFEST_VERSION],
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'read_only',
  writeSemantics: 'read_only', byteBudget: MAX_WEB_CAPTURE_MANIFEST_BYTES,
  owner: ANALYST_INTERCHANGE_CONTRACT_OWNER,
  note: 'Metadata-only capture manifest; the browser and offline artefact comparison accept the v1.47.4 current-writer version 2.',
});
const DEFENSIVE_MANIFEST_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.defensive-indicator-manifest', kind: 'export', schema: DEFENSIVE_INDICATOR_MANIFEST_SCHEMA,
  currentVersion: DEFENSIVE_INDICATOR_EXPORT_VERSION, supportedVersions: [DEFENSIVE_INDICATOR_EXPORT_VERSION],
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only',
  writeSemantics: 'read_only', byteBudget: null, owner: ANALYST_INTERCHANGE_CONTRACT_OWNER,
  note: 'Output-only manifest for explicitly selected defensive indicators; historical version 1 is not claimed without a retained reader.',
});
const DEFENSIVE_ROLLBACK_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.defensive-indicator-rollback', kind: 'export', schema: DEFENSIVE_INDICATOR_ROLLBACK_SCHEMA,
  currentVersion: DEFENSIVE_INDICATOR_EXPORT_VERSION, supportedVersions: [DEFENSIVE_INDICATOR_EXPORT_VERSION],
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only',
  writeSemantics: 'read_only', byteBudget: null, owner: ANALYST_INTERCHANGE_CONTRACT_OWNER,
  note: 'Output-only rollback companion for the same bounded defensive-indicator selection.',
});
const DNS_REHEARSAL_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.dns-change-rehearsal', kind: 'export', schema: DNS_CHANGE_REHEARSAL_EXPORT_SCHEMA,
  currentVersion: DNS_CHANGE_REHEARSAL_VERSION, supportedVersions: [DNS_CHANGE_REHEARSAL_VERSION],
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only',
  writeSemantics: 'read_only', byteBudget: null, owner: ANALYST_INTERCHANGE_CONTRACT_OWNER,
  note: 'Output-only DNS change rehearsal document; version 2 is the only producer contract represented by this tree.',
});
const MAIL_REPORT_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.mail-report-review', kind: 'export', schema: MAIL_REPORT_SCHEMA,
  currentVersion: MAIL_REPORT_VERSION, supportedVersions: [MAIL_REPORT_VERSION], acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null,
  owner: ANALYST_INTERCHANGE_CONTRACT_OWNER,
  note: 'Output-only review derived from bounded offline aggregate-report input; the producer has field and collection limits but no separate serialised-output byte contract.',
});
const REGISTRATION_DISCLOSURE_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.registration-disclosure-plan', kind: 'export', schema: REGISTRATION_DISCLOSURE_PLAN_SCHEMA,
  currentVersion: REGISTRATION_DISCLOSURE_PLAN_VERSION, supportedVersions: [REGISTRATION_DISCLOSURE_PLAN_VERSION],
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only',
  writeSemantics: 'read_only', byteBudget: null, owner: ANALYST_INTERCHANGE_CONTRACT_OWNER,
  note: 'Output-only bounded registration-disclosure planning document; version 2 is the only current producer contract.',
});
const STATIC_PATTERN_PACK_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.static-page-pattern-pack', kind: 'export', schema: STATIC_PAGE_PATTERN_PACK_SCHEMA,
  currentVersion: STATIC_PAGE_PATTERN_PACK_VERSION, supportedVersions: [STATIC_PAGE_PATTERN_PACK_VERSION],
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only',
  writeSemantics: 'non_destructive_merge', byteBudget: MAX_STATIC_PAGE_PATTERN_PACK_BYTES,
  owner: ANALYST_INTERCHANGE_CONTRACT_OWNER,
  note: 'Exact-current bounded page-pattern pack imported by explicit analyst action and merged without executing code or starting collection.',
});

export function serialiseAnalystInterchangeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const F = 'test/fixtures/extracted-domain-lifecycle/';
export const ANALYST_INTERCHANGE_LIFECYCLE_FAMILY = defineSchemaLifecycleFamily(buildExtractedLifecycleFamilyV4({
  id: 'analyst-interchange', owner: ANALYST_INTERCHANGE_CONTRACT_OWNER,
  serializerExportName: 'serialiseAnalystInterchangeJson', plane: 'shared', projection: 'browser_export',
  retention: 'operator_controlled_output',
  includedCategories: ['reviewed-indicators', 'source-identity', 'provenance', 'completeness', 'omitted-counts', 'limitations'],
  excludedCategories: ['credentials', 'cookies', 'message-content', 'raw-upstream-responses', 'expanded-contacts'],
  formats: [
    { descriptor: CACAO_COMPATIBILITY, lifecycleSchema: INVESTIGATION_CACAO_SPEC_VERSION,
      requiredKeys: ['type', 'spec_version', 'id', 'name', 'created', 'modified', 'workflow_start', 'workflow', 'extension_definitions'],
      optionalKeys: ['description', 'playbook_types', 'playbook_activities', 'created_by', 'playbook_extensions', 'agent_definitions', 'x_whoisleuth_profile_version'],
      hook: { module: 'packages/interchange/investigation-playbook-interchange.mts', exportName: 'parseCacaoInvestigationPlaybook', role: 'normaliser', runtime: 'shared' },
      fixtures: [
        { id: 'investigation-cacao-profile-v2', path: `${F}investigation-cacao-profile-v2.json`, bytes: 4_091, sha256: '7e9a3de6e12b83477690c0c58e03e6efbbb8b0c11fd98dc8470bdb6784d42358', version: INVESTIGATION_CACAO_PROFILE_VERSION },
      ] },
    { descriptor: OPERATIONS_REPORT_COMPATIBILITY, lifecycleSchema: BRAND_PROTECTION_OPERATIONS_REPORT_SCHEMA,
      requiredKeys: ['schema', 'version', 'generatedAt', 'window', 'limitations'], optionalKeys: ['sourceState', 'summary', 'counts', 'states', 'actionTypes', 'durations', 'denominators', 'omissions'],
      hook: { module: 'packages/interchange/brand-protection-operations-report.mts', exportName: 'serializeBrandProtectionOperationsReport', role: 'builder', runtime: 'shared' },
      fixtures: [
        { id: 'brand-protection-operations-report-v2', path: `${F}brand-protection-operations-report-v2.json`, bytes: 187, sha256: 'd38bf9b2c5cfc9c83df267ff2303ea2c3cdb398dd12c6607fbedb265b880a324', version: BRAND_PROTECTION_OPERATIONS_REPORT_VERSION },
      ] },
    { descriptor: DEFENSIVE_INDICATORS_COMPATIBILITY, lifecycleSchema: DEFENSIVE_INDICATOR_LIFECYCLE_SCHEMA,
      requiredKeys: ['version', 'format'], optionalKeys: ['generatedAt', 'expiresAt', 'domains', 'entries', 'indicators', 'exclusions', 'explicitSelection', 'includeWildcards', 'truncated', 'filename', 'manifestFilename', 'rollbackFilename', 'mimeType', 'content', 'manifestContent', 'rollbackContent', 'limitations'],
      hook: { module: 'packages/interchange/defensive-indicator-export.mts', exportName: 'buildDefensiveIndicatorExport', role: 'builder', runtime: 'shared' },
      fixtures: [
        { id: 'defensive-indicators-v2', path: `${F}defensive-indicators-v2.json`, bytes: 66, sha256: '597794782fbb2291acbcd854ced48bb2b8142f175fd9dd8ab99d53dd5532701e', version: DEFENSIVE_INDICATOR_EXPORT_VERSION },
      ] },
    { descriptor: STIX_INDICATORS_COMPATIBILITY, lifecycleSchema: STIX_INDICATOR_LIFECYCLE_SCHEMA,
      requiredKeys: ['type', 'id', 'objects'], optionalKeys: ['x_whoisleuth_export_version'],
      hook: { module: 'packages/interchange/stix-indicator-export.mts', exportName: 'buildStixIndicatorExport', role: 'builder', runtime: 'shared' },
      fixtures: [{ id: 'stix-indicators-v1', path: `${F}stix-indicators-v1.json`, bytes: 115, sha256: '517fe4aec65bbdb5252945d5f0f0a393c5c72a2eb8f48a1c8147ae5c6e681f8e', version: STIX_INDICATOR_EXPORT_VERSION }] },
    { descriptor: MISP_INDICATORS_COMPATIBILITY, lifecycleSchema: MISP_INDICATOR_LIFECYCLE_SCHEMA,
      requiredKeys: ['Event'], optionalKeys: [],
      hook: { module: 'packages/interchange/misp-indicator-export.mts', exportName: 'buildMispIndicatorExport', role: 'builder', runtime: 'shared' },
      fixtures: [{ id: 'misp-indicators-v1', path: `${F}misp-indicators-v1.json`, bytes: 167, sha256: '043102cfb145ead16f6eba9b4ebe723aed12cc02f5899c918a0d172674e74997', version: MISP_INDICATOR_EXPORT_VERSION }] },
    { descriptor: WEB_CAPTURE_SUMMARY_COMPATIBILITY, lifecycleSchema: WEB_CAPTURE_SUMMARY_SCHEMA,
      requiredKeys: ['schema', 'schemaVersion', 'source', 'captures'], optionalKeys: [],
      hook: { module: 'packages/interchange/web-capture-import.mts', exportName: 'parseWebCaptureSummary', role: 'normaliser', runtime: 'shared' },
      fixtures: [{ id: 'web-capture-summary-v1', path: `${F}web-capture-summary-v1.json`, bytes: 341, sha256: '70fba8a784f61f473ba6cde71a7d9dd915cfca46fbb3469e3bb57767adf973d9', version: WEB_CAPTURE_SUMMARY_VERSION }] },
    { descriptor: WEB_CAPTURE_MANIFEST_COMPATIBILITY, lifecycleSchema: WEB_CAPTURE_MANIFEST_SCHEMA,
      requiredKeys: ['schema', 'schemaVersion', 'source', 'captures'], optionalKeys: [],
      hook: { module: 'packages/interchange/web-capture-import.mts', exportName: 'parseWebCaptureManifest', role: 'normaliser', runtime: 'shared' },
      fixtures: [
        { id: 'web-capture-manifest-v2', path: `${F}web-capture-manifest-v2.json`, bytes: 494, sha256: 'a2208dc956a832d70e37cd9a5929db81d29148856c485e4fd6ce5b123de5b8e6', version: WEB_CAPTURE_MANIFEST_VERSION },
      ] },
    { descriptor: DEFENSIVE_MANIFEST_COMPATIBILITY, lifecycleSchema: DEFENSIVE_INDICATOR_MANIFEST_SCHEMA,
      requiredKeys: ['schema', 'version', 'generatedAt'], optionalKeys: ['expiresAt', 'reviewRequired', 'explicitSelection', 'includeWildcards', 'entries', 'indicators', 'exclusions', 'limitations'],
      hook: { module: 'packages/interchange/defensive-indicator-export.mts', exportName: 'buildDefensiveIndicatorExport', role: 'builder', runtime: 'shared' },
      fixtures: [{ id: 'defensive-indicator-manifest-v2', path: `${F}defensive-indicator-manifest-v2.json`, bytes: 139, sha256: '8a2475b1be1810bcc10b6285630e7056986f961320c884fd8cfc72951eb79db7', version: DEFENSIVE_INDICATOR_EXPORT_VERSION }] },
    { descriptor: DEFENSIVE_ROLLBACK_COMPATIBILITY, lifecycleSchema: DEFENSIVE_INDICATOR_ROLLBACK_SCHEMA,
      requiredKeys: ['schema', 'version', 'generatedAt'], optionalKeys: ['removes', 'indicators', 'limitations'],
      hook: { module: 'packages/interchange/defensive-indicator-export.mts', exportName: 'buildDefensiveIndicatorExport', role: 'builder', runtime: 'shared' },
      fixtures: [{ id: 'defensive-indicator-rollback-v2', path: `${F}defensive-indicator-rollback-v2.json`, bytes: 139, sha256: '1af3d32d3e808327fadc39066256d441abb5957d1ae696b834a61a37658103e6', version: DEFENSIVE_INDICATOR_EXPORT_VERSION }] },
    { descriptor: DNS_REHEARSAL_COMPATIBILITY, lifecycleSchema: DNS_CHANGE_REHEARSAL_EXPORT_SCHEMA,
      requiredKeys: ['schema', 'version', 'generatedAt'], optionalKeys: ['domain', 'changes', 'findings', 'limitations'],
      hook: { module: 'packages/interchange/dns-change-rehearsal.mts', exportName: 'buildDnsChangeRehearsalExport', role: 'builder', runtime: 'shared' },
      fixtures: [{ id: 'dns-change-rehearsal-v2', path: `${F}dns-change-rehearsal-v2.json`, bytes: 169, sha256: '31b2e5d8d3774356362c4f5fc1741506ce7060953b49bb3cd3588adbd3bb96d3', version: DNS_CHANGE_REHEARSAL_VERSION }] },
    { descriptor: MAIL_REPORT_COMPATIBILITY, lifecycleSchema: MAIL_REPORT_SCHEMA,
      requiredKeys: ['schema', 'version', 'generatedAt'], optionalKeys: ['source', 'summary', 'findings', 'limitations'],
      hook: { module: 'packages/interchange/mail-report-workbench.mts', exportName: 'buildMailReportReview', role: 'builder', runtime: 'shared' },
      fixtures: [{ id: 'mail-report-review-v1', path: `${F}mail-report-review-v1.json`, bytes: 152, sha256: '804ffda72784ee2f0b34985f47f78075238841b4fbcc484b971efcd17f2b0c17', version: MAIL_REPORT_VERSION }] },
    { descriptor: REGISTRATION_DISCLOSURE_COMPATIBILITY, lifecycleSchema: REGISTRATION_DISCLOSURE_PLAN_SCHEMA,
      requiredKeys: ['schema', 'version', 'generatedAt'], optionalKeys: ['domain', 'requests', 'limitations'],
      hook: { module: 'packages/interchange/registration-disclosure-plan.mts', exportName: 'buildRegistrationDisclosurePlan', role: 'builder', runtime: 'shared' },
      fixtures: [{ id: 'registration-disclosure-plan-v2', path: `${F}registration-disclosure-plan-v2.json`, bytes: 164, sha256: '74e516dc369a2c62fc5794134512bff8ec251faa85b30e78172f670b58db9037', version: REGISTRATION_DISCLOSURE_PLAN_VERSION }] },
    { descriptor: STATIC_PATTERN_PACK_COMPATIBILITY, lifecycleSchema: STATIC_PAGE_PATTERN_PACK_SCHEMA,
      requiredKeys: ['schema', 'version', 'id', 'label', 'description', 'evidenceBoundary', 'relationship', 'confidence', 'rules'], optionalKeys: [],
      hook: { module: 'packages/interchange/static-page-pattern-packs.mts', exportName: 'validateStaticPagePatternPack', role: 'structure_validator', runtime: 'shared' },
      fixtures: [{ id: 'static-page-pattern-pack-v2', path: `${F}static-page-pattern-pack-v2.json`, bytes: 1_094, sha256: 'c409e527850bcb924f5be0708a58c5e2c32d98947c42150f6a79765991c0eb6f', version: STATIC_PAGE_PATTERN_PACK_VERSION }] },
  ],
}));
