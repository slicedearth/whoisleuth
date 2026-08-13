import {
  CLI_BULK_ITEM_SCHEMA,
  CLI_BULK_SCHEMA,
  CLI_BULK_SCHEMA_VERSION,
  CLI_COMPARE_SCHEMA,
  CLI_COMPARE_SCHEMA_VERSION,
  CLI_CT_SEARCH_SCHEMA,
  CLI_CT_SEARCH_SCHEMA_VERSION,
  CLI_DISCOVER_ITEM_SCHEMA,
  CLI_DISCOVER_SCHEMA,
  CLI_DISCOVER_SCHEMA_VERSION,
  CLI_HTTP_SCHEMA,
  CLI_HTTP_SCHEMA_VERSION,
  CLI_LOOKUP_SCHEMA,
  CLI_LOOKUP_SCHEMA_VERSION,
  CLI_POSTURE_SCHEMA,
  CLI_POSTURE_SCHEMA_VERSION,
  CLI_TLS_SCHEMA,
  CLI_TLS_SCHEMA_VERSION,
} from '../cli/formatters/json.mts';
import { DOCTOR_SCHEMA, DOCTOR_VERSION } from '../cli/doctor.mts';
import {
  CLI_COMMAND_CATALOGUE_SCHEMA,
  CLI_COMMAND_CATALOGUE_VERSION,
} from '../cli/command-catalogue.mts';
import { CLI_LOOKUP_PLAN_SCHEMA, CLI_LOOKUP_PLAN_VERSION } from '../cli/lookup-plan.mts';
import {
  CLI_LOOKUP_TIMELINE_SCHEMA,
  CLI_LOOKUP_TIMELINE_VERSION,
  MAX_LOOKUP_TIMELINE_INPUT_BYTES,
} from '../cli/lookup-timeline.mts';
import {
  CLI_MAIL_REVIEW_SCHEMA,
  CLI_MAIL_REVIEW_VERSION,
  MAX_MAIL_REVIEW_INPUT_BYTES,
} from '../cli/mail-review.mts';
import { CLI_PAGE_COMPARE_SCHEMA, CLI_PAGE_COMPARE_VERSION } from '../cli/page-compare.mts';
import { ARCHIVE_INSPECTION_SCHEMA, ARCHIVE_INSPECTION_VERSION } from '../cli/archive-inspect.mts';
import {
  MAX_OFFLINE_ARTIFACT_BYTES,
  OFFLINE_ARTIFACT_VERIFICATION_SCHEMA,
  OFFLINE_ARTIFACT_VERIFICATION_VERSION,
} from '../cli/artifact-verify.mts';
import {
  EVIDENCE_SIGNATURE_VERIFICATION_SCHEMA,
  EVIDENCE_SIGNATURE_VERIFICATION_VERSION,
  SIGNED_EVIDENCE_PACKAGE_SCHEMA,
  SIGNED_EVIDENCE_PACKAGE_VERSION,
} from '../cli/evidence-signing.mts';
import { LOCAL_MMDB_QUERY_SCHEMA, LOCAL_MMDB_QUERY_VERSION } from '../cli/local-mmdb-review.mts';
import {
  REGISTRY_STANDARDS_COVERAGE_SCHEMA,
  REGISTRY_SUPPORT_SCHEMA,
  REGISTRY_SUPPORT_SCHEMA_VERSION,
} from '../cli/registry-support.mts';
import {
  MAX_RISK_CALIBRATION_INPUT_BYTES,
  RISK_CALIBRATION_DATASET_SCHEMA,
  RISK_CALIBRATION_DATASET_VERSION,
  RISK_CALIBRATION_REPORT_SCHEMA,
  RISK_CALIBRATION_REPORT_VERSION,
} from '../cli/risk-calibration.mts';
import {
  MAX_SAVED_LOOKUP_INPUT_BYTES,
} from '../cli/saved-lookup.mts';
import {
  CLI_INVESTIGATION_PLAN_SCHEMA,
  CLI_INVESTIGATION_PLAN_VERSION,
} from '../cli/investigation-plan.mts';
import {
  CLI_INVESTIGATION_RUN_SCHEMA,
  CLI_INVESTIGATION_RUN_VERSION,
  MAX_INVESTIGATION_RUN_BYTES,
} from '../cli/investigation-run.mts';
import {
  CLI_COLLECTION_PREFLIGHT_SCHEMA,
  CLI_COLLECTION_PREFLIGHT_VERSION,
} from '../cli/collection-preflight.mts';
import {
  CLI_CONFIG_SCHEMA,
  CLI_CONFIG_VERSION,
  MAX_CLI_CONFIG_BYTES,
} from '../cli/config-profile.mts';
import {
  CLI_CASE_PACK_SCHEMA,
  CLI_CASE_PACK_VERSION,
  MAX_CASE_PACK_INPUT_BYTES,
} from '../cli/case-pack.mts';
import {
  INTERCHANGE_FIDELITY_REPORT_SCHEMA,
  INTERCHANGE_FIDELITY_REPORT_VERSION,
  MAX_INTERCHANGE_REPORT_BYTES,
} from '../cli/interchange-report.mts';
import { INTERCHANGE_ARTIFACT_CONTRACTS } from '../lib/interchange-fidelity-registry.mts';
import {
  CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA,
  CLI_DOMAIN_CONTROL_REVIEW_SCHEMA,
  CLI_DOMAIN_CONTROL_REVIEW_VERSION,
  MAX_DOMAIN_CONTROL_REVIEW_INPUT_BYTES,
} from '../cli/domain-control-observations.mts';
import {
  CLI_DOMAIN_CONTROL_MONITOR_SCHEMA,
  CLI_DOMAIN_CONTROL_MONITOR_VERSION,
} from '../cli/domain-control-monitor.mts';
import {
  CLI_LOOKUP_BRIEF_SCHEMA,
  CLI_LOOKUP_BRIEF_VERSION,
} from '../cli/lookup-brief.mts';
import {
  MAX_REGISTRY_COHORT_INPUT_BYTES,
  REGISTRY_COHORT_SCHEMA,
  REGISTRY_COHORT_VERSION,
} from '../cli/registry-cohort.mts';
import {
  CLI_BULK_CHECKPOINT_SCHEMA,
  CLI_BULK_CHECKPOINT_VERSION,
  MAX_BULK_CHECKPOINT_BYTES,
} from '../cli/bulk-checkpoint.mts';
import {
  CLI_LOOKUP_DIFF_SCHEMA,
  CLI_LOOKUP_DIFF_VERSION,
} from '../cli/lookup-diff.mts';
import {
  CLI_COMPARISON_LEDGER_SCHEMA,
  CLI_COMPARISON_LEDGER_VERSION,
  MAX_RETAINED_ARTIFACT_DIFF_BYTES,
} from '../cli/retained-artifact-diff.mts';
import {
  CLI_LOOKUP_RECONCILIATION_SCHEMA,
  CLI_LOOKUP_RECONCILIATION_VERSION,
  MAX_LOOKUP_RECONCILIATION_INPUT_BYTES,
} from '../cli/lookup-reconcile.mts';
import {
  SHARING_REVIEW_SCHEMA,
  SHARING_REVIEW_VERSION,
  MAX_SHARING_REVIEW_BYTES,
} from '../cli/sharing-review.mts';
import {
  REGISTRY_DOCTOR_SCHEMA,
  REGISTRY_DOCTOR_VERSION,
} from '../cli/registry-doctor.mts';
import {
  LOOKALIKE_CALIBRATION_INPUT_SCHEMA,
  LOOKALIKE_CALIBRATION_SCHEMA,
  LOOKALIKE_CALIBRATION_VERSION,
  MAX_LOOKALIKE_CALIBRATION_BYTES,
} from '../cli/lookalike-calibration.mts';
import {
  DOMAIN_ASSURANCE_INPUT_SCHEMA,
  DOMAIN_ASSURANCE_SCHEMA,
  DOMAIN_ASSURANCE_VERSION,
  MAX_ASSURANCE_INPUT_BYTES,
} from '../lib/domain-assurance.mts';
import {
  DOMAIN_PORTFOLIO_INPUT_SCHEMA,
  DOMAIN_PORTFOLIO_REVIEW_SCHEMA,
  DOMAIN_PORTFOLIO_REVIEW_VERSION,
} from '../lib/domain-portfolio-review.mts';
import {
  DOMAIN_CHANGE_INPUT_SCHEMA,
  DOMAIN_CHANGE_REVIEW_SCHEMA,
  DOMAIN_CHANGE_REVIEW_VERSION,
} from '../lib/domain-change-review.mts';
import {
  NAMESERVER_PREFLIGHT_INPUT_SCHEMA,
  NAMESERVER_PREFLIGHT_REVIEW_SCHEMA,
  NAMESERVER_PREFLIGHT_REVIEW_VERSION,
} from '../lib/nameserver-preflight-review.mts';
import {
  MAX_ZONE_TEXT_BYTES,
  ZONE_INTENT_INPUT_SCHEMA,
  ZONE_INTENT_REVIEW_SCHEMA,
  ZONE_INTENT_REVIEW_VERSION,
} from '../lib/zone-intent-review.mts';
import {
  CLI_PROGRESS_EVENT_SCHEMA,
  CLI_PROGRESS_EVENT_VERSION,
} from '../cli/progress-events.mts';
import {
  CLI_DISCOVERY_SCAN_ITEM_SCHEMA,
  CLI_DISCOVERY_SCAN_SCHEMA,
  CLI_DISCOVERY_SCAN_VERSION,
} from '../cli/discovery-scan.mts';
import {
  CLI_DISCOVERY_SNAPSHOT_SCHEMA,
  CLI_DISCOVERY_SNAPSHOT_VERSION,
  MAX_DISCOVERY_SNAPSHOT_BYTES,
} from '../cli/discovery-snapshot.mts';
import {
  CLI_DISCOVERY_OBSERVATION_SCHEMA,
  CLI_DISCOVERY_OBSERVATION_VERSION,
  MAX_DISCOVERY_OBSERVATION_BYTES,
} from '../cli/discovery-observation-snapshot.mts';
import {
  INVESTIGATION_MANIFEST_SCHEMA,
  INVESTIGATION_MANIFEST_VERSION,
  MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES,
} from '../cli/investigation-manifest.mts';
import {
  CT_EVENT_BATCH_SCHEMA,
  CT_EVENT_BATCH_VERSION,
  MAX_CT_EVENT_INPUT_BYTES,
} from '../cli/ct-event-intake.mts';
import {
  EXTERNAL_OBSERVATION_MAPPING_SCHEMA,
  EXTERNAL_OBSERVATION_MAPPING_VERSION,
  MAX_EXTERNAL_OBSERVATION_MAPPING_BYTES,
} from '../cli/external-observation-mapping.mts';
import {
  OPEN_ASSET_MODEL_BRIDGE_SCHEMA,
  OPEN_ASSET_MODEL_BRIDGE_VERSION,
} from '../cli/open-asset-model-bridge.mts';
import {
  SOURCE_RELIABILITY_REPORT_SCHEMA,
  SOURCE_RELIABILITY_REPORT_VERSION,
  MAX_SOURCE_RELIABILITY_INPUT_BYTES,
} from '../cli/source-reliability.mts';
import {
  DNSSEC_EVIDENCE_INPUT_SCHEMA,
  ENCRYPTED_DNS_PLAN_INPUT_SCHEMA,
  LOCAL_GEOIP_QUERY_SCHEMA,
  MAX_OFFLINE_EVIDENCE_INPUT_BYTES,
  OFFLINE_EVIDENCE_INPUT_VERSION,
  OFFLINE_EVIDENCE_REVIEW_SCHEMA,
  OFFLINE_EVIDENCE_REVIEW_VERSION,
  RDAP_SEARCH_INPUT_SCHEMA,
  RPKI_ROUTE_INPUT_SCHEMA,
  TLSA_EVIDENCE_INPUT_SCHEMA,
} from '../cli/offline-evidence-review.mts';
import {
  CRYPTOGRAPHIC_ASSURANCE_INPUT_SCHEMA,
  CRYPTOGRAPHIC_ASSURANCE_SCHEMA,
  CRYPTOGRAPHIC_ASSURANCE_VERSION,
} from '../lib/cryptographic-assurance.mts';
import {
  DNSSEC_CHAIN_SCHEMA,
  DNSSEC_CHAIN_VERSION,
  DNSSEC_TRUST_ANCHOR_SCHEMA,
  DNSSEC_TRUST_ANCHOR_VERSION,
  MAX_DNSSEC_TRUST_ANCHOR_BYTES,
} from '../lib/dnssec-chain-validation.mts';
import {
  MAIL_TRANSPORT_INPUT_SCHEMA,
  MAIL_TRANSPORT_INPUT_VERSION,
  MAIL_TRANSPORT_REVIEW_SCHEMA,
  MAIL_TRANSPORT_REVIEW_VERSION,
  MAX_MAIL_TRANSPORT_INPUT_BYTES,
} from '../lib/smtp-transport-review.mts';
import {
  BRAND_PROFILE_SCHEMA,
  BRAND_PROFILE_SCHEMA_VERSION,
  MAX_PROFILE_STORE_BYTES,
  SUPPORTED_BRAND_PROFILE_SCHEMA_VERSIONS,
} from '../frontend/src/lib/analysis/brand-profile-model.ts';
import {
  BULK_SESSION_SCHEMA,
  BULK_SESSION_SCHEMA_VERSION,
  MAX_BULK_SESSION_STORE_BYTES,
  SUPPORTED_BULK_SESSION_SCHEMA_VERSIONS,
} from '../frontend/src/lib/analysis/bulk-session-model.ts';
import {
  BULK_REVIEW_SCHEMA,
  BULK_REVIEW_SCHEMA_VERSION,
  MAX_BULK_REVIEW_STORE_BYTES,
} from '../frontend/src/lib/analysis/bulk-review-model.ts';
import {
  CAMPAIGN_SCHEMA,
  CAMPAIGN_SCHEMA_VERSION,
  MAX_CAMPAIGN_IMPORT_BYTES,
  MAX_CAMPAIGN_STORE_BYTES,
} from '../frontend/src/lib/analysis/campaign-model.ts';
import {
  CAMPAIGN_TEMPORAL_REVIEW_SCHEMA,
  CAMPAIGN_TEMPORAL_REVIEW_VERSION,
} from '../frontend/src/lib/analysis/campaign-temporal-review.ts';
import {
  CASE_REPORT_SCHEMA,
  CASE_REPORT_SCHEMA_VERSION,
} from '../frontend/src/lib/analysis/case-report.ts';
import {
  CASE_RESPONSE_PACKET_SCHEMA,
  CASE_RESPONSE_PACKET_VERSION,
} from '../frontend/src/lib/analysis/case-response-packet.ts';
import {
  ACQUISITION_DECISION_PACKET_SCHEMA,
  ACQUISITION_DECISION_PACKET_VERSION,
} from '../frontend/src/lib/analysis/acquisition-decision-packet.ts';
import {
  LOOKUP_CLAIM_PASSPORT_SCHEMA,
  LOOKUP_CLAIM_PASSPORT_VERSION,
  MAX_LOOKUP_CLAIM_PASSPORT_BYTES,
} from '../frontend/src/lib/analysis/lookup-claim-passport.ts';
import {
  BULK_DOMAIN_COMPARISON_EXPORT_VERSION,
  BULK_DOMAIN_COMPARISON_SCHEMA,
} from '../frontend/src/lib/analysis/bulk-domain-comparison.ts';
import {
  BULK_MAIL_EXPOSURE_EXPORT_VERSION,
  BULK_MAIL_EXPOSURE_SCHEMA,
} from '../frontend/src/lib/analysis/bulk-mail-exposure.ts';
import {
  BULK_REVIEW_MANIFEST_SCHEMA,
  BULK_REVIEW_MANIFEST_VERSION,
} from '../frontend/src/lib/analysis/bulk-review-export.ts';
import {
  INVESTIGATION_CAPSULE_SCHEMA,
  INVESTIGATION_CAPSULE_VERSION,
} from '../frontend/src/lib/analysis/investigation-capsule.ts';
import {
  CASE_IMPORT_VERSIONS,
  CASE_SCHEMA_VERSION,
  MAX_CASE_IMPORT_BYTES,
  MAX_CASE_STORE_BYTES,
} from '../frontend/src/lib/analysis/case-model.ts';
import {
  CT_HISTORY_SCHEMA_VERSION,
  MAX_CT_HISTORY_STORE_BYTES,
} from '../frontend/src/lib/analysis/ct-history.ts';
import {
  DEFENSIVE_INDICATOR_EXPORT_VERSION,
} from '../frontend/src/lib/analysis/defensive-indicator-export.ts';
import {
  DETECTION_RULE_SCHEMA,
  DETECTION_RULE_SCHEMA_VERSION,
  MAX_RULE_IMPORT_BYTES,
  MAX_RULE_STORE_BYTES,
} from '../frontend/src/lib/analysis/detection-rule-model.ts';
import {
  SYNTHETIC_DEMO_EXPORT_SCHEMA,
  SYNTHETIC_DEMO_EXPORT_VERSION,
  MAX_SYNTHETIC_DEMO_SERIALIZED_BYTES,
  SYNTHETIC_DEMO_VERSION,
} from '../frontend/src/lib/analysis/demo-model.ts';
import {
  INVESTIGATION_GUIDE_EXPORT_SCHEMA,
  INVESTIGATION_GUIDE_EXPORT_VERSION,
  INVESTIGATION_GUIDE_VERSION,
  MAX_INVESTIGATION_GUIDE_EXPORT_BYTES,
  MAX_INVESTIGATION_GUIDE_SERIALIZED_BYTES,
} from '../frontend/src/lib/analysis/investigation-guide.ts';
import {
  INVESTIGATION_TEMPLATE_SCHEMA,
  INVESTIGATION_TEMPLATE_VERSION,
  MAX_INVESTIGATION_TEMPLATE_IMPORT_BYTES,
  MAX_INVESTIGATION_TEMPLATE_STORE_BYTES,
} from '../frontend/src/lib/analysis/investigation-template-model.ts';
import {
  INVESTIGATION_CACAO_PROFILE_VERSION,
  INVESTIGATION_CACAO_SPEC_VERSION,
  MAX_INVESTIGATION_CACAO_IMPORT_BYTES,
} from '../frontend/src/lib/analysis/investigation-playbook-interchange.ts';
import {
  BRAND_PROTECTION_OPERATIONS_REPORT_SCHEMA,
  BRAND_PROTECTION_OPERATIONS_REPORT_VERSION,
  MAX_OPERATIONS_REPORT_BYTES,
} from '../frontend/src/lib/analysis/brand-protection-operations-report.ts';
import {
  INVESTIGATION_PROJECTION_SCHEMA,
  INVESTIGATION_PROJECTION_VERSION,
} from '../frontend/src/lib/analysis/investigation-projection.ts';
import {
  MAX_ENVELOPE_BYTES as MAX_OBSERVATION_ENVELOPE_BYTES,
  OBSERVATION_ENVELOPE_SCHEMA,
  OBSERVATION_ENVELOPE_VERSION,
} from '../frontend/src/lib/analysis/observation-envelope.ts';
import {
  MAX_RELATIONSHIP_GRAPH_EXPORT_BYTES,
  RELATIONSHIP_GRAPH_EXPORT_SCHEMA,
  RELATIONSHIP_GRAPH_EXPORT_VERSION,
} from '../frontend/src/lib/analysis/case-relationship-graph-export.ts';
import {
  MAX_RELATIONSHIP_OBSERVATION_STORE_BYTES,
  RELATIONSHIP_OBSERVATION_SCHEMA,
  RELATIONSHIP_OBSERVATION_SCHEMA_VERSION,
} from '../frontend/src/lib/analysis/relationship-observation-model.ts';
import {
  MAX_WEBSITE_SNAPSHOT_STORE_BYTES,
  WEBSITE_SNAPSHOT_SCHEMA,
  WEBSITE_SNAPSHOT_SCHEMA_VERSION,
  SUPPORTED_WEBSITE_SNAPSHOT_SCHEMA_VERSIONS,
} from '../frontend/src/lib/analysis/website-snapshot-model.ts';
import {
  MAX_WORKSPACE_ARCHIVE_BYTES,
  WORKSPACE_ARCHIVE_SCHEMA,
  WORKSPACE_ARCHIVE_VERSION,
  WORKSPACE_SETTINGS_SCHEMA,
  WORKSPACE_SETTINGS_VERSION,
} from '../frontend/src/lib/analysis/workspace-archive.ts';
import {
  ENCRYPTED_WORKSPACE_ARCHIVE_SCHEMA,
  ENCRYPTED_WORKSPACE_ARCHIVE_VERSION,
  MAX_ENCRYPTED_WORKSPACE_ARCHIVE_BYTES,
} from '../frontend/src/lib/analysis/workspace-archive-crypto.ts';
import {
  INVESTIGATION_SEARCH_SCHEMA,
  INVESTIGATION_SEARCH_VERSION,
} from '../frontend/src/lib/analysis/investigation-search.ts';
import {
  EXTERNAL_FINDINGS_SCHEMA,
  EXTERNAL_FINDINGS_VERSION,
  MAX_EXTERNAL_FINDINGS_IMPORT_BYTES,
} from '../frontend/src/lib/analysis/external-findings-import.ts';
import {
  CERTIFICATE_OBSERVATION_ROWS_SCHEMA,
  DNS_OBSERVATION_ROWS_SCHEMA,
  DOMAIN_OBSERVATION_ROWS_SCHEMA,
  EXTERNAL_FINDING_ROWS_SCHEMA,
  EXTERNAL_FINDING_ROWS_VERSION,
  SUPPORTED_OBSERVATION_ROWS_VERSION,
} from '../frontend/src/lib/analysis/external-findings-converters.ts';
import {
  MISP_INDICATOR_EXPORT_VERSION,
} from '../frontend/src/lib/analysis/misp-indicator-export.ts';
import {
  SCHEDULED_MONITOR_DELIVERY_SCHEMA,
  SCHEDULED_MONITOR_DELIVERY_VERSION,
} from '../frontend/src/lib/analysis/scheduled-monitor-dispatcher.ts';
import {
  MAX_SCHEDULED_MONITOR_STORE_BYTES,
  SCHEDULED_MONITOR_SCHEMA,
  SCHEDULED_MONITOR_SCHEMA_VERSION,
} from '../frontend/src/lib/analysis/scheduled-monitor-model.ts';
import {
  MAX_SHORTLIST_STORE_BYTES,
  SHORTLIST_SCHEMA,
  SHORTLIST_SCHEMA_VERSION,
} from '../frontend/src/lib/analysis/shortlist-model.ts';
import {
  STIX_INDICATOR_EXPORT_VERSION,
} from '../frontend/src/lib/analysis/stix-indicator-export.ts';
import {
  MAX_WATCHLIST_STORE_BYTES,
  WATCHLIST_SCHEMA,
  WATCHLIST_SCHEMA_VERSION,
} from '../frontend/src/lib/analysis/watchlist-store.ts';
import {
  HANDOFF_VERSION,
  MAX_CANDIDATE_HANDOFF_SERIALIZED_BYTES,
} from '../frontend/src/lib/candidate-handoff-core.ts';
import {
  LOOKUP_EVIDENCE_PORTABLE_MAX_BYTES,
  LOOKUP_EVIDENCE_SCHEMA,
  LOOKUP_EVIDENCE_SCHEMA_VERSION,
} from '../lib/evidence-export.mts';
import {
  ENVELOPE_SCHEMA,
  ENVELOPE_VERSION,
  MAX_ENVELOPE_BYTES,
} from '../lib/scheduled-monitor-crypto.mts';
import {
  CURATED_CONNECTOR_CONTRACT_VERSION,
  CURATED_CONNECTOR_RESULT_SCHEMA,
} from '../lib/threat-intelligence-contract.mts';
import {
  DOMAIN_CONTROL_MANIFEST_SCHEMA,
  DOMAIN_CONTROL_MANIFEST_VERSION,
  DOMAIN_CONTROL_REVIEW_SCHEMA,
  DOMAIN_CONTROL_REVIEW_VERSION,
} from '../lib/domain-control-manifest.mts';
import {
  DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA,
  DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA,
  DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION,
} from '../lib/domain-control-flight-recorder.mts';
import {
  DOMAIN_CHANGE_PACKET_INPUT_SCHEMA,
  DOMAIN_CHANGE_PACKET_INPUT_VERSION,
  DOMAIN_CHANGE_PACKET_SCHEMA,
  DOMAIN_CHANGE_PACKET_VERSION,
  MAX_DOMAIN_CHANGE_PACKET_INPUT_BYTES,
} from '../lib/domain-change-packet.mts';
import {
  DNS_CONVERGENCE_INPUT_SCHEMA,
  DNS_CONVERGENCE_REVIEW_SCHEMA,
  DNS_CONVERGENCE_REVIEW_VERSION,
} from '../lib/dns-convergence-review.mts';
import {
  TRUST_STORE_COMPARISON_INPUT_SCHEMA,
  TRUST_STORE_COMPARISON_REVIEW_SCHEMA,
  TRUST_STORE_COMPARISON_REVIEW_VERSION,
} from '../lib/trust-store-comparison.mts';
import {
  registryStandardsCoverageSnapshot,
} from '../lib/registry-capabilities.mts';
import {
  MAX_WEB_CAPTURE_MANIFEST_BYTES,
  MAX_WEB_CAPTURE_DOM_DIGEST_BYTES,
  WEB_CAPTURE_COMPARISON_SCHEMA,
  WEB_CAPTURE_COMPARISON_VERSION,
  WEB_CAPTURE_DOM_DIGEST_SCHEMA,
  WEB_CAPTURE_DOM_DIGEST_VERSION,
  WEB_CAPTURE_MANIFEST_SCHEMA,
  WEB_CAPTURE_MANIFEST_VERSION,
  WEB_CAPTURE_SUMMARY_SCHEMA,
  WEB_CAPTURE_SUMMARY_VERSION,
} from '../lib/web-capture-contract.mts';
import {
  DEPLOYMENT_SELF_CHECK_SCHEMA,
  DEPLOYMENT_SELF_CHECK_VERSION,
} from './deployment-self-check.mts';
import {
  MAINTAINER_DUPLICATION_REPORT_SCHEMA,
  MAINTAINER_DUPLICATION_REPORT_VERSION,
  MAX_MAINTAINER_DUPLICATION_REPORT_BYTES,
} from './maintainer-duplication-report.mts';
import {
  REGISTRY_DRIFT_AUDIT_SCHEMA,
  REGISTRY_DRIFT_AUDIT_VERSION,
} from './registry-drift-audit.mts';
import {
  MAX_RDAP_EXTENSION_SOURCE_BYTES,
  RDAP_EXTENSION_DRIFT_AUDIT_SCHEMA,
  RDAP_EXTENSION_DRIFT_AUDIT_VERSION,
} from './rdap-extension-drift-audit.mts';
import {
  SPECIALIST_WORKFLOW_BENCHMARK_SCHEMA,
  SPECIALIST_WORKFLOW_BENCHMARK_VERSION,
} from './specialist-workflow-benchmark.mts';
import {
  SERVICE_DEPENDENCY_SIGNATURE_AUDIT_SCHEMA,
  SERVICE_DEPENDENCY_SIGNATURE_AUDIT_VERSION,
} from './service-dependency-signature-audit.mts';
import { CISA_KEV_STATUS_SCHEMA, CISA_KEV_STATUS_VERSION } from './cisa-kev-catalog-status.mts';
import { CLI_PACKAGE_REPORT_SCHEMA, CLI_PACKAGE_REPORT_VERSION } from './cli-package.mts';
import { COMMON_INFRASTRUCTURE_SCHEMA, COMMON_INFRASTRUCTURE_VERSION, MAX_SNAPSHOT_BYTES } from './common-infrastructure-snapshot.mts';
import {
  FIRST_USE_STUDY_REPORT_SCHEMA,
  FIRST_USE_STUDY_SESSION_SCHEMA,
  FIRST_USE_STUDY_VERSION,
  MAX_FIRST_USE_STUDY_INPUT_BYTES,
} from './first-use-analyst-study.mts';
import { FRONTEND_LOADING_REPORT_SCHEMA, FRONTEND_LOADING_REPORT_VERSION } from './frontend-loading-report.mts';
import {
  INCREMENTAL_LOOKUP_QUALIFICATION_SCHEMA,
  INCREMENTAL_LOOKUP_QUALIFICATION_VERSION,
} from './incremental-lookup-qualification.mts';
import {
  INCREMENTAL_LOOKUP_TRANSPORT_SPIKE_SCHEMA,
  INCREMENTAL_LOOKUP_TRANSPORT_SPIKE_VERSION,
} from './incremental-lookup-transport-spike.mts';
import {
  LOCAL_DATA_PLATFORM_EVALUATION_SCHEMA,
  LOCAL_DATA_PLATFORM_EVALUATION_VERSION,
} from './local-data-platform-evaluation.mts';
import {
  PROVIDER_POLICY_FRESHNESS_SCHEMA,
  PROVIDER_POLICY_FRESHNESS_VERSION,
} from './provider-policy-freshness.mts';
import { PUBLISHED_CLI_CHECK_SCHEMA, PUBLISHED_CLI_CHECK_VERSION } from './published-cli-check.mts';
import {
  REGISTRY_FIXTURE_FRESHNESS_SCHEMA,
  REGISTRY_FIXTURE_FRESHNESS_VERSION,
} from './registry-fixture-freshness.mts';
import { RELEASE_VERSION_CHECK_SCHEMA, RELEASE_VERSION_CHECK_VERSION } from './release-version-check.mts';
import {
  REVIEWED_ACCURACY_INTAKE_SCHEMA,
  REVIEWED_ACCURACY_INTAKE_VERSION,
} from './reviewed-accuracy-scaffold.mts';
import {
  REVIEWED_ACCURACY_STATUS_SCHEMA,
  REVIEWED_ACCURACY_STATUS_VERSION,
} from './reviewed-accuracy-status.mts';
import { SSLBL_SNAPSHOT_SCHEMA, SSLBL_SNAPSHOT_VERSION } from './sslbl-snapshot.mts';
import {
  MAX_SYNTHETIC_ANALYST_INPUT_BYTES,
  SYNTHETIC_ANALYST_REPORT_SCHEMA,
  SYNTHETIC_ANALYST_RESULT_SCHEMA,
  SYNTHETIC_ANALYST_RESULT_VERSION,
} from './synthetic-analyst-journeys.mts';
import { TECHNOLOGY_EXAMPLE_REVIEW_SCHEMA, TECHNOLOGY_EXAMPLE_REVIEW_VERSION } from './technology-example-review.mts';
import {
  TECHNOLOGY_SIGNATURE_BENCHMARK_SCHEMA,
  TECHNOLOGY_SIGNATURE_BENCHMARK_VERSION,
} from './technology-signature-benchmark.mts';
import {
  MAX_TECHNOLOGY_SOURCE_MANIFEST_BYTES,
  TECHNOLOGY_SOURCE_MANIFEST_SCHEMA,
  TECHNOLOGY_SOURCE_MANIFEST_VERSION,
  TECHNOLOGY_SOURCE_VERIFICATION_SCHEMA,
  TECHNOLOGY_SOURCE_VERIFICATION_VERSION,
} from './technology-source-verify.mts';
import { UNICODE_CONFUSABLE_AUDIT_SCHEMA, UNICODE_CONFUSABLE_AUDIT_VERSION } from './unicode-confusable-audit.mts';
import {
  CODEQL_TEMP_MARKER_SCHEMA,
  CODEQL_TEMP_MARKER_VERSION,
  MAX_CODEQL_TEMP_MARKER_BYTES,
} from './local-codeql.mts';

export const SCHEMA_COMPATIBILITY_INVENTORY_SCHEMA = 'whoisleuth.schema-compatibility-inventory';
export const SCHEMA_COMPATIBILITY_INVENTORY_VERSION = 1;
export const MAX_SCHEMA_COMPATIBILITY_ENTRIES = 192;

type ContractKind = 'browser_store' | 'tab_store' | 'hosted_store' | 'export' | 'cli_document' | 'derived';
type FutureVersionBehavior = 'reject' | 'preserve_without_write' | 'discard' | 'not_applicable';
type MigrationBehavior = 'normalize_to_current' | 'exact_current_only' | 'read_only' | 'none';
type WriteSemantics = 'normalized_rewrite' | 'ephemeral_replace' | 'optimistic_replace' | 'non_destructive_merge' | 'read_only' | 'none';

type SchemaCompatibilityEntry = {
  id: string;
  kind: ContractKind;
  schema: string | null;
  currentVersion: number;
  supportedVersions: number[];
  acceptsUnversionedLegacy: boolean;
  futureVersionBehavior: FutureVersionBehavior;
  migration: MigrationBehavior;
  writeSemantics: WriteSemantics;
  byteBudget: number | null;
  owner: string;
  note: string;
};

type SchemaCompatibilityInventory = {
  schema: typeof SCHEMA_COMPATIBILITY_INVENTORY_SCHEMA;
  version: typeof SCHEMA_COMPATIBILITY_INVENTORY_VERSION;
  generatedAt: string;
  entries: SchemaCompatibilityEntry[];
  limitations: string[];
};

const CONTRACT_KINDS = new Set<ContractKind>(['browser_store', 'tab_store', 'hosted_store', 'export', 'cli_document', 'derived']);
const FUTURE_VERSION_BEHAVIORS = new Set<FutureVersionBehavior>(['reject', 'preserve_without_write', 'discard', 'not_applicable']);
const MIGRATION_BEHAVIORS = new Set<MigrationBehavior>(['normalize_to_current', 'exact_current_only', 'read_only', 'none']);
const WRITE_SEMANTICS = new Set<WriteSemantics>(['normalized_rewrite', 'ephemeral_replace', 'optimistic_replace', 'non_destructive_merge', 'read_only', 'none']);
const MAX_INVENTORY_LIMITATIONS = 8;
const MAX_INVENTORY_LIMITATION_LENGTH = 300;

function entry(value: SchemaCompatibilityEntry): SchemaCompatibilityEntry {
  return value;
}

const standardsCoverage = registryStandardsCoverageSnapshot();

const ENTRIES: SchemaCompatibilityEntry[] = [
  entry({ id: 'maintainer.cisa-kev-status', kind: 'cli_document', schema: CISA_KEV_STATUS_SCHEMA, currentVersion: CISA_KEV_STATUS_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'tools/cisa-kev-catalog-status.mts', note: 'Target-free freshness and bounded catalogue status output for the checked-in CISA KEV projection.' }),
  entry({ id: 'maintainer.cli-package-check', kind: 'cli_document', schema: CLI_PACKAGE_REPORT_SCHEMA, currentVersion: CLI_PACKAGE_REPORT_VERSION, supportedVersions: [3], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: null, owner: 'tools/cli-package.mts', note: 'Exact-current release-candidate evidence consumed by the published-package check; older reports are not reinterpreted.' }),
  entry({ id: 'derived.common-infrastructure', kind: 'derived', schema: COMMON_INFRASTRUCTURE_SCHEMA, currentVersion: COMMON_INFRASTRUCTURE_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'normalized_rewrite', byteBudget: MAX_SNAPSHOT_BYTES, owner: 'tools/common-infrastructure-snapshot.mts', note: 'Checked-in exact-CIDR catalogue with an exact active-or-stale source partition; stale ranges never participate in matching.' }),
  entry({ id: 'maintainer.first-use-study-session', kind: 'cli_document', schema: FIRST_USE_STUDY_SESSION_SCHEMA, currentVersion: FIRST_USE_STUDY_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: MAX_FIRST_USE_STUDY_INPUT_BYTES, owner: 'tools/first-use-analyst-study.mts', note: 'Bounded analyst-entered study session consumed only by the local target-free aggregation command.' }),
  entry({ id: 'maintainer.first-use-study-report', kind: 'cli_document', schema: FIRST_USE_STUDY_REPORT_SCHEMA, currentVersion: FIRST_USE_STUDY_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'tools/first-use-analyst-study.mts', note: 'Target-free aggregate report that excludes raw analyst notes and target identifiers.' }),
  entry({ id: 'maintainer.frontend-loading-report', kind: 'cli_document', schema: FRONTEND_LOADING_REPORT_SCHEMA, currentVersion: FRONTEND_LOADING_REPORT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'tools/frontend-loading-report.mts', note: 'Post-build bounded static dependency and gzip-budget report; it does not execute generated application code.' }),
  entry({ id: 'maintainer.incremental-lookup-qualification', kind: 'cli_document', schema: INCREMENTAL_LOOKUP_QUALIFICATION_SCHEMA, currentVersion: INCREMENTAL_LOOKUP_QUALIFICATION_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'tools/incremental-lookup-qualification.mts', note: 'Offline synthetic qualification report for the bounded incremental Lookup transport.' }),
  entry({ id: 'maintainer.incremental-lookup-transport-spike', kind: 'cli_document', schema: INCREMENTAL_LOOKUP_TRANSPORT_SPIKE_SCHEMA, currentVersion: INCREMENTAL_LOOKUP_TRANSPORT_SPIKE_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'tools/incremental-lookup-transport-spike.mts', note: 'Offline architecture-spike report; no deployment adapter or target request is enabled.' }),
  entry({ id: 'maintainer.local-data-platform-evaluation', kind: 'cli_document', schema: LOCAL_DATA_PLATFORM_EVALUATION_SCHEMA, currentVersion: LOCAL_DATA_PLATFORM_EVALUATION_VERSION, supportedVersions: [2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'tools/local-data-platform-evaluation.mts', note: 'Target-free browser-local storage evaluation report with reviewed capacity assumptions and no retained user data.' }),
  entry({ id: 'maintainer.local-codeql-temporary-reservation', kind: 'cli_document', schema: CODEQL_TEMP_MARKER_SCHEMA, currentVersion: CODEQL_TEMP_MARKER_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'ephemeral_replace', byteBudget: MAX_CODEQL_TEMP_MARKER_BYTES, owner: 'tools/local-codeql.mts', note: 'Private marker for one owned temporary analysis reservation; it contains only bounded process and filesystem identity metadata and is removed with the reservation.' }),
  entry({ id: 'maintainer.provider-policy-freshness', kind: 'cli_document', schema: PROVIDER_POLICY_FRESHNESS_SCHEMA, currentVersion: PROVIDER_POLICY_FRESHNESS_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'tools/provider-policy-freshness.mts', note: 'Provider-policy metadata freshness report; it does not enable an adapter or make a provider request.' }),
  entry({ id: 'maintainer.published-cli-check', kind: 'cli_document', schema: PUBLISHED_CLI_CHECK_SCHEMA, currentVersion: PUBLISHED_CLI_CHECK_VERSION, supportedVersions: [2, 3], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'tools/published-cli-check.mts', note: 'Explicit post-publication tar-payload, registry-integrity, metadata, and provenance comparison report for one reviewed package candidate.' }),
  entry({ id: 'maintainer.registry-fixture-freshness', kind: 'cli_document', schema: REGISTRY_FIXTURE_FRESHNESS_SCHEMA, currentVersion: REGISTRY_FIXTURE_FRESHNESS_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'tools/registry-fixture-freshness.mts', note: 'Target-free age and provenance status for checked-in registry fixtures.' }),
  entry({ id: 'maintainer.release-version-check', kind: 'cli_document', schema: RELEASE_VERSION_CHECK_SCHEMA, currentVersion: RELEASE_VERSION_CHECK_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'tools/release-version-check.mts', note: 'Local version-alignment and publication-boundary report across package manifests.' }),
  entry({ id: 'maintainer.reviewed-accuracy-intake', kind: 'cli_document', schema: REVIEWED_ACCURACY_INTAKE_SCHEMA, currentVersion: REVIEWED_ACCURACY_INTAKE_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: null, owner: 'tools/reviewed-accuracy-scaffold.mts', note: 'Bounded reviewed-accuracy intake contract; future records are rejected rather than silently normalized.' }),
  entry({ id: 'maintainer.reviewed-accuracy-status', kind: 'cli_document', schema: REVIEWED_ACCURACY_STATUS_SCHEMA, currentVersion: REVIEWED_ACCURACY_STATUS_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'tools/reviewed-accuracy-status.mts', note: 'Target-free corpus readiness report that never promotes insufficient samples to reviewed evidence.' }),
  entry({ id: 'maintainer.schema-compatibility-inventory', kind: 'cli_document', schema: SCHEMA_COMPATIBILITY_INVENTORY_SCHEMA, currentVersion: SCHEMA_COMPATIBILITY_INVENTORY_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'tools/schema-compatibility.mts', note: 'Bounded deterministic inventory of every reviewed serialized contract and its explicit compatibility decision.' }),
  entry({ id: 'derived.sslbl-certificate-snapshot', kind: 'derived', schema: SSLBL_SNAPSHOT_SCHEMA, currentVersion: SSLBL_SNAPSHOT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'normalized_rewrite', byteBudget: null, owner: 'tools/sslbl-snapshot.mts', note: 'Checked-in certificate fingerprint snapshot parsed only at its exact current contract.' }),
  entry({ id: 'maintainer.synthetic-analyst-result', kind: 'cli_document', schema: SYNTHETIC_ANALYST_RESULT_SCHEMA, currentVersion: SYNTHETIC_ANALYST_RESULT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: MAX_SYNTHETIC_ANALYST_INPUT_BYTES, owner: 'tools/synthetic-analyst-journeys.mts', note: 'Bounded explicitly synthetic journey result consumed without live target evidence.' }),
  entry({ id: 'maintainer.synthetic-analyst-report', kind: 'cli_document', schema: SYNTHETIC_ANALYST_REPORT_SCHEMA, currentVersion: SYNTHETIC_ANALYST_RESULT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'tools/synthetic-analyst-journeys.mts', note: 'Target-free aggregate of explicitly synthetic journey fixtures.' }),
  entry({ id: 'maintainer.technology-example-review', kind: 'cli_document', schema: TECHNOLOGY_EXAMPLE_REVIEW_SCHEMA, currentVersion: TECHNOLOGY_EXAMPLE_REVIEW_VERSION, supportedVersions: [5], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'tools/technology-example-review.mts', note: 'Offline reviewed-fixture evidence report for bounded technology signatures.' }),
  entry({ id: 'maintainer.technology-signature-benchmark', kind: 'cli_document', schema: TECHNOLOGY_SIGNATURE_BENCHMARK_SCHEMA, currentVersion: TECHNOLOGY_SIGNATURE_BENCHMARK_VERSION, supportedVersions: [4], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'tools/technology-signature-benchmark.mts', note: 'Target-free precision and collision benchmark over reviewed local fixtures.' }),
  entry({ id: 'maintainer.technology-source-verification', kind: 'cli_document', schema: TECHNOLOGY_SOURCE_VERIFICATION_SCHEMA, currentVersion: TECHNOLOGY_SOURCE_VERIFICATION_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'tools/technology-source-verify.mts', note: 'Bounded source-document verification report; no live application target is queried.' }),
  entry({ id: 'maintainer.technology-source-manifest', kind: 'cli_document', schema: TECHNOLOGY_SOURCE_MANIFEST_SCHEMA, currentVersion: TECHNOLOGY_SOURCE_MANIFEST_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: MAX_TECHNOLOGY_SOURCE_MANIFEST_BYTES, owner: 'tools/technology-source-verify.mts', note: 'Exact-current reviewed source manifest consumed by the verification tool.' }),
  entry({ id: 'maintainer.unicode-confusable-audit', kind: 'cli_document', schema: UNICODE_CONFUSABLE_AUDIT_SCHEMA, currentVersion: UNICODE_CONFUSABLE_AUDIT_VERSION, supportedVersions: [2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'tools/unicode-confusable-audit.mts', note: 'Target-free Unicode confusable calibration and invariant report.' }),
  entry({ id: 'browser.cases', kind: 'browser_store', schema: null, currentVersion: CASE_SCHEMA_VERSION, supportedVersions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], acceptsUnversionedLegacy: true, futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current', writeSemantics: 'normalized_rewrite', byteBudget: MAX_CASE_STORE_BYTES, owner: 'frontend/src/lib/analysis/case-model.ts', note: 'Known fields can be read from newer local envelopes, but wrappers block overwrite and downgraded export; version 12 adds up to eight exact opaque analyst-selected Brand Profile references without inferred or cascading relationships.' }),
  entry({ id: 'browser.brand-profiles', kind: 'browser_store', schema: null, currentVersion: BRAND_PROFILE_SCHEMA_VERSION, supportedVersions: [1, 2, 3, 4, 5, 6], acceptsUnversionedLegacy: true, futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current', writeSemantics: 'normalized_rewrite', byteBudget: MAX_PROFILE_STORE_BYTES, owner: 'frontend/src/lib/analysis/brand-profile-model.ts', note: 'Version 1 bare arrays and supported profiles normalise to the current bounded store; version 6 adds bounded domain-control planning context and approved change windows.' }),
  entry({ id: 'browser.campaigns', kind: 'browser_store', schema: null, currentVersion: CAMPAIGN_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: true, futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current', writeSemantics: 'normalized_rewrite', byteBudget: MAX_CAMPAIGN_STORE_BYTES, owner: 'frontend/src/lib/analysis/campaign-model.ts', note: 'Bare arrays remain recoverable; explicit future versions are not overwritten; the schema string belongs to portable exports.' }),
  entry({ id: 'browser.watchlists', kind: 'browser_store', schema: WATCHLIST_SCHEMA, currentVersion: WATCHLIST_SCHEMA_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: true, futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current', writeSemantics: 'normalized_rewrite', byteBudget: MAX_WATCHLIST_STORE_BYTES, owner: 'frontend/src/lib/analysis/watchlist-store.ts', note: 'Legacy map-shaped stores normalise to the current envelope.' }),
  entry({ id: 'browser.shortlist', kind: 'browser_store', schema: SHORTLIST_SCHEMA, currentVersion: SHORTLIST_SCHEMA_VERSION, supportedVersions: [1, 2, 3], acceptsUnversionedLegacy: true, futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current', writeSemantics: 'normalized_rewrite', byteBudget: MAX_SHORTLIST_STORE_BYTES, owner: 'frontend/src/lib/analysis/shortlist-model.ts', note: 'Legacy arrays normalise to the current compact envelope.' }),
  entry({ id: 'browser.ct-history', kind: 'browser_store', schema: null, currentVersion: CT_HISTORY_SCHEMA_VERSION, supportedVersions: [1, 2, 3], acceptsUnversionedLegacy: false, futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current', writeSemantics: 'normalized_rewrite', byteBudget: MAX_CT_HISTORY_STORE_BYTES, owner: 'frontend/src/lib/analysis/ct-history.ts', note: 'Version 3 adds bounded ever-seen and reappearance state; versions 1 and 2 migrate without invented history completeness, and future stores are preserved without write.' }),
  entry({ id: 'browser.detection-rules', kind: 'browser_store', schema: null, currentVersion: DETECTION_RULE_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: true, futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current', writeSemantics: 'normalized_rewrite', byteBudget: MAX_RULE_STORE_BYTES, owner: 'frontend/src/lib/analysis/detection-rule-model.ts', note: 'Only allowlisted structured rule fields and operators survive normalisation; the schema string belongs to portable exports.' }),
  entry({ id: 'browser.relationship-observations', kind: 'browser_store', schema: RELATIONSHIP_OBSERVATION_SCHEMA, currentVersion: RELATIONSHIP_OBSERVATION_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: true, futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current', writeSemantics: 'normalized_rewrite', byteBudget: MAX_RELATIONSHIP_OBSERVATION_STORE_BYTES, owner: 'frontend/src/lib/analysis/relationship-observation-model.ts', note: 'Only explicit analyst selections from bounded Bulk relationship evidence are retained; identities are re-derived from normalised values and members.' }),
  entry({ id: 'browser.website-snapshots', kind: 'browser_store', schema: WEBSITE_SNAPSHOT_SCHEMA, currentVersion: WEBSITE_SNAPSHOT_SCHEMA_VERSION, supportedVersions: [...SUPPORTED_WEBSITE_SNAPSHOT_SCHEMA_VERSIONS], acceptsUnversionedLegacy: true, futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current', writeSemantics: 'normalized_rewrite', byteBudget: MAX_WEBSITE_SNAPSHOT_STORE_BYTES, owner: 'frontend/src/lib/analysis/website-snapshot-model.ts', note: 'Only explicit analyst-selected compact website profiles and optional normalised leaf-certificate observations are retained; version 4 adds a bounded reviewed security-posture baseline, while raw lookup payloads, contact data, certificate bytes, and fetched bodies remain excluded.' }),
  entry({ id: 'browser.bulk-sessions', kind: 'browser_store', schema: BULK_SESSION_SCHEMA, currentVersion: BULK_SESSION_SCHEMA_VERSION, supportedVersions: [...SUPPORTED_BULK_SESSION_SCHEMA_VERSIONS], acceptsUnversionedLegacy: true, futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current', writeSemantics: 'normalized_rewrite', byteBudget: MAX_BULK_SESSION_STORE_BYTES, owner: 'frontend/src/lib/analysis/bulk-session-model.ts', note: 'Schema 4 binds rows and sessions to bounded Brand Profile provenance. Bare browser arrays classify each record independently: complete schema-4 provenance is retained, wholly legacy records migrate fail-closed, and portable imports require a local rescan.' }),
  entry({ id: 'browser.investigation-templates', kind: 'browser_store', schema: INVESTIGATION_TEMPLATE_SCHEMA, currentVersion: INVESTIGATION_TEMPLATE_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: true, futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current', writeSemantics: 'normalized_rewrite', byteBudget: MAX_INVESTIGATION_TEMPLATE_STORE_BYTES, owner: 'frontend/src/lib/analysis/investigation-template-model.ts', note: 'Version 2 adds the fixed response-playbook recipe identifiers. Analyst-authored guidance remains bound to allowlisted built-in stages and cannot run code, start collection, submit evidence, or remove mandatory request gates.' }),
  entry({ id: 'browser.bulk-review', kind: 'browser_store', schema: BULK_REVIEW_SCHEMA, currentVersion: BULK_REVIEW_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: true, futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current', writeSemantics: 'normalized_rewrite', byteBudget: MAX_BULK_REVIEW_STORE_BYTES, owner: 'frontend/src/lib/analysis/bulk-review-model.ts', note: 'Bounded saved Bulk filter views and per-domain review states only; scan results, contacts, notes, and case disposition remain separate.' }),
  entry({ id: 'tab.candidate-handoff', kind: 'tab_store', schema: null, currentVersion: HANDOFF_VERSION, supportedVersions: [2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'discard', migration: 'exact_current_only', writeSemantics: 'ephemeral_replace', byteBudget: MAX_CANDIDATE_HANDOFF_SERIALIZED_BYTES, owner: 'frontend/src/lib/candidate-handoff-core.ts', note: 'Bounded one-use session handoff; unsupported and legacy envelopes are ignored rather than applied.' }),
  entry({ id: 'tab.investigation-guide', kind: 'tab_store', schema: null, currentVersion: INVESTIGATION_GUIDE_VERSION, supportedVersions: [1, 2, 3, 4, 5], acceptsUnversionedLegacy: false, futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current', writeSemantics: 'ephemeral_replace', byteBudget: MAX_INVESTIGATION_GUIDE_SERIALIZED_BYTES, owner: 'frontend/src/lib/analysis/investigation-guide.ts', note: 'Versions 1 through 4 normalise into bounded version 5 recipe state; version 5 adds three fixed manual response-preparation recipes without inventing a custom template, action, submission, or stage outcome.' }),
  entry({ id: 'tab.synthetic-demo', kind: 'tab_store', schema: null, currentVersion: SYNTHETIC_DEMO_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'discard', migration: 'exact_current_only', writeSemantics: 'ephemeral_replace', byteBudget: MAX_SYNTHETIC_DEMO_SERIALIZED_BYTES, owner: 'frontend/src/lib/analysis/demo-model.ts', note: 'Fixed synthetic fixtures remain separate from investigation stores.' }),
  entry({ id: 'hosted.scheduled-monitor', kind: 'hosted_store', schema: SCHEDULED_MONITOR_SCHEMA, currentVersion: SCHEDULED_MONITOR_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'optimistic_replace', byteBudget: MAX_SCHEDULED_MONITOR_STORE_BYTES, owner: 'frontend/src/lib/analysis/scheduled-monitor-model.ts', note: 'Compact authority-aware evidence only; raw responses and expanded contacts are excluded.' }),
  entry({ id: 'hosted.scheduled-monitor-envelope', kind: 'hosted_store', schema: ENVELOPE_SCHEMA, currentVersion: ENVELOPE_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'optimistic_replace', byteBudget: MAX_ENVELOPE_BYTES, owner: 'lib/scheduled-monitor-crypto.mts', note: 'Authenticated encrypted envelope; version and namespace are part of authenticated context.' }),
  entry({ id: 'hosted.scheduled-monitor-delivery', kind: 'hosted_store', schema: SCHEDULED_MONITOR_DELIVERY_SCHEMA, currentVersion: SCHEDULED_MONITOR_DELIVERY_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'ephemeral_replace', byteBudget: null, owner: 'frontend/src/lib/analysis/scheduled-monitor-dispatcher.ts', note: 'Opaque bounded queue message with an allowlisted key set.' }),
  entry({ id: 'export.cases', kind: 'export', schema: null, currentVersion: CASE_SCHEMA_VERSION, supportedVersions: [...CASE_IMPORT_VERSIONS], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'non_destructive_merge', byteBudget: MAX_CASE_IMPORT_BYTES, owner: 'frontend/src/lib/analysis/case-model.ts', note: 'Non-destructive merge accepts declared schemas 2 through 12, rejects future versions, and unions exact opaque Brand Profile references existing-first within the eight-reference bound.' }),
  entry({ id: 'export.brand-profiles', kind: 'export', schema: BRAND_PROFILE_SCHEMA, currentVersion: BRAND_PROFILE_SCHEMA_VERSION, supportedVersions: [...SUPPORTED_BRAND_PROFILE_SCHEMA_VERSIONS], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'non_destructive_merge', byteBudget: null, owner: 'frontend/src/lib/analysis/brand-profile-model.ts', note: 'Supported exports merge non-destructively by bounded normalised profile identity.' }),
  entry({ id: 'export.campaigns', kind: 'export', schema: CAMPAIGN_SCHEMA, currentVersion: CAMPAIGN_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: true, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'non_destructive_merge', byteBudget: MAX_CAMPAIGN_IMPORT_BYTES, owner: 'frontend/src/lib/analysis/campaign-model.ts', note: 'Non-destructive merge; unversioned legacy campaign arrays remain accepted.' }),
  entry({ id: 'export.campaign-temporal-review', kind: 'export', schema: CAMPAIGN_TEMPORAL_REVIEW_SCHEMA, currentVersion: CAMPAIGN_TEMPORAL_REVIEW_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'frontend/src/lib/analysis/campaign-temporal-review.ts', note: 'Integrity-protected local projection of source-qualified case pins and sightings. Retained timestamps are not global first-seen or service-activation times.' }),
  entry({ id: 'export.watchlists', kind: 'export', schema: WATCHLIST_SCHEMA, currentVersion: WATCHLIST_SCHEMA_VERSION, supportedVersions: [2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'non_destructive_merge', byteBudget: null, owner: 'frontend/src/lib/analysis/watchlist-store.ts', note: 'Non-destructive collection merge with current schema required.' }),
  entry({ id: 'export.shortlist', kind: 'export', schema: SHORTLIST_SCHEMA, currentVersion: SHORTLIST_SCHEMA_VERSION, supportedVersions: [2, 3], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'non_destructive_merge', byteBudget: null, owner: 'frontend/src/lib/analysis/shortlist-model.ts', note: 'Non-destructive domain merge retains schema 2 records while schema 3 adds Opportunity model identity.' }),
  entry({ id: 'export.detection-rules', kind: 'export', schema: DETECTION_RULE_SCHEMA, currentVersion: DETECTION_RULE_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: true, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'non_destructive_merge', byteBudget: MAX_RULE_IMPORT_BYTES, owner: 'frontend/src/lib/analysis/detection-rule-model.ts', note: 'Non-destructive rule merge; imported conditions remain allowlisted and non-executable.' }),
  entry({ id: 'export.case-report', kind: 'export', schema: CASE_REPORT_SCHEMA, currentVersion: CASE_REPORT_SCHEMA_VERSION, supportedVersions: [1, 2, 3, 4, 5, 6, 7, 8], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'frontend/src/lib/analysis/case-report.ts', note: 'Local report output; version 8 preserves exact opaque analyst-selected Brand Profile references and remains a non-import persistence contract.' }),
  entry({ id: 'export.case-response-packet', kind: 'export', schema: CASE_RESPONSE_PACKET_SCHEMA, currentVersion: CASE_RESPONSE_PACKET_VERSION, supportedVersions: [1, 2, 3, 4, 5, 6], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'frontend/src/lib/analysis/case-response-packet.ts', note: 'Version 6 uses deterministic sorted-json-v2 integrity for the local reviewed response packet; no submission or provider side effect occurs.' }),
  entry({ id: 'export.acquisition-decision', kind: 'export', schema: ACQUISITION_DECISION_PACKET_SCHEMA, currentVersion: ACQUISITION_DECISION_PACKET_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_OFFLINE_ARTIFACT_BYTES, owner: 'frontend/src/lib/analysis/acquisition-decision-packet.ts', note: 'Version 2 uses deterministic sorted-json-v2 integrity for a bounded acquisition review without making an availability, eligibility, ownership, valuation, or purchase determination.' }),
  entry({ id: 'export.lookup-claim-passport', kind: 'export', schema: LOOKUP_CLAIM_PASSPORT_SCHEMA, currentVersion: LOOKUP_CLAIM_PASSPORT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_LOOKUP_CLAIM_PASSPORT_BYTES, owner: 'frontend/src/lib/analysis/lookup-claim-passport.ts', note: 'Explicit local export of one typed claim-readiness projection with exact evidence requirement IDs, retained source states, bounded limitations, and deterministic sorted-json-v2 integrity; raw source payloads and browser-local records are excluded.' }),
  entry({ id: 'export.domain-comparison', kind: 'export', schema: BULK_DOMAIN_COMPARISON_SCHEMA, currentVersion: BULK_DOMAIN_COMPARISON_EXPORT_VERSION, supportedVersions: [3, 4], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_OFFLINE_ARTIFACT_BYTES, owner: 'frontend/src/lib/analysis/bulk-domain-comparison.ts', note: 'Export version 4 uses deterministic sorted-json-v2 integrity while its nested comparison remains version 3 and preserves distinct evidence states.' }),
  entry({ id: 'export.bulk-mail-exposure', kind: 'export', schema: BULK_MAIL_EXPOSURE_SCHEMA, currentVersion: BULK_MAIL_EXPOSURE_EXPORT_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_OFFLINE_ARTIFACT_BYTES, owner: 'frontend/src/lib/analysis/bulk-mail-exposure.ts', note: 'Export version 2 uses deterministic sorted-json-v2 integrity while its nested report remains version 1 and incomplete DNS evidence remains inconclusive.' }),
  entry({ id: 'export.bulk-review-manifest', kind: 'export', schema: BULK_REVIEW_MANIFEST_SCHEMA, currentVersion: BULK_REVIEW_MANIFEST_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_OFFLINE_ARTIFACT_BYTES, owner: 'frontend/src/lib/analysis/bulk-review-export.ts', note: 'Version 2 uses deterministic sorted-json-v2 integrity for one bounded Bulk review selection while excluding raw payloads, contacts, notes, and transient request state.' }),
  entry({ id: 'export.investigation-capsule', kind: 'export', schema: INVESTIGATION_CAPSULE_SCHEMA, currentVersion: INVESTIGATION_CAPSULE_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_OFFLINE_ARTIFACT_BYTES, owner: 'frontend/src/lib/analysis/investigation-capsule.ts', note: 'Version 2 adds deterministic whole-capsule integrity; version 1 remains verifiable only for its embedded projections.' }),
  entry({ id: 'derived.lookup-asset-graph', kind: 'derived', schema: 'whoisleuth.lookup-asset-graph', currentVersion: 2, supportedVersions: [2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: null, owner: 'frontend/src/lib/analysis/lookup-asset-graph.ts', note: 'Bounded relationship projection embedded in investigation capsules; source attribution and incomplete evidence remain explicit.' }),
  entry({ id: 'derived.case-analyst-records', kind: 'derived', schema: 'whoisleuth.case-analyst-records', currentVersion: 1, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: null, owner: 'frontend/src/lib/analysis/investigation-capsule.ts', note: 'Optional bounded analyst-decision and assertion projection embedded only after deliberate selection for an investigation capsule.' }),
  entry({ id: 'export.external-findings', kind: 'export', schema: EXTERNAL_FINDINGS_SCHEMA, currentVersion: EXTERNAL_FINDINGS_VERSION, supportedVersions: [1, 2, 3, 4], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'non_destructive_merge', byteBudget: MAX_EXTERNAL_FINDINGS_IMPORT_BYTES, owner: 'frontend/src/lib/analysis/external-findings-import.ts', note: 'Strict local findings import. Version 4 can retain bounded certificate event identity and name-completeness metadata while analyst assertions remain a separate case workflow.' }),
  entry({ id: 'import.external-finding-rows', kind: 'export', schema: EXTERNAL_FINDING_ROWS_SCHEMA, currentVersion: EXTERNAL_FINDING_ROWS_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: true, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'non_destructive_merge', byteBudget: MAX_EXTERNAL_FINDINGS_IMPORT_BYTES, owner: 'frontend/src/lib/analysis/external-findings-converters.ts', note: 'Bounded fixed-column JSON rows converted through the strict findings parser.' }),
  entry({ id: 'import.domain-observation-rows', kind: 'export', schema: DOMAIN_OBSERVATION_ROWS_SCHEMA, currentVersion: SUPPORTED_OBSERVATION_ROWS_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'non_destructive_merge', byteBudget: MAX_EXTERNAL_FINDINGS_IMPORT_BYTES, owner: 'frontend/src/lib/analysis/external-findings-converters.ts', note: 'Typed external domain-state observations retained with source-qualified provenance.' }),
  entry({ id: 'import.dns-observation-rows', kind: 'export', schema: DNS_OBSERVATION_ROWS_SCHEMA, currentVersion: SUPPORTED_OBSERVATION_ROWS_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'non_destructive_merge', byteBudget: MAX_EXTERNAL_FINDINGS_IMPORT_BYTES, owner: 'frontend/src/lib/analysis/external-findings-converters.ts', note: 'Typed external DNS observations; only valid relational values project graph edges.' }),
  entry({ id: 'import.certificate-observation-rows', kind: 'export', schema: CERTIFICATE_OBSERVATION_ROWS_SCHEMA, currentVersion: SUPPORTED_OBSERVATION_ROWS_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'non_destructive_merge', byteBudget: MAX_EXTERNAL_FINDINGS_IMPORT_BYTES, owner: 'frontend/src/lib/analysis/external-findings-converters.ts', note: 'Typed external certificate observations requiring an exact SHA-256 fingerprint.' }),
  entry({ id: 'export.investigation-recipe-summary', kind: 'export', schema: INVESTIGATION_GUIDE_EXPORT_SCHEMA, currentVersion: INVESTIGATION_GUIDE_EXPORT_VERSION, supportedVersions: [1, 2, 3, 4], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_INVESTIGATION_GUIDE_EXPORT_BYTES, owner: 'frontend/src/lib/analysis/investigation-guide.ts', note: 'Version 4 covers the fixed response-playbook identifiers. The compact summary retains only workflow metadata, optional template identity, and bounded stage-review reasons.' }),
  entry({ id: 'export.investigation-templates', kind: 'export', schema: INVESTIGATION_TEMPLATE_SCHEMA, currentVersion: INVESTIGATION_TEMPLATE_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'non_destructive_merge', byteBudget: MAX_INVESTIGATION_TEMPLATE_IMPORT_BYTES, owner: 'frontend/src/lib/analysis/investigation-template-model.ts', note: 'Portable bounded analyst-authored guide definitions with allowlisted stage identities and request gates; version 1 remains readable only for the original recipe identifiers.' }),
  entry({ id: 'export.investigation-cacao-profile', kind: 'export', schema: INVESTIGATION_CACAO_SPEC_VERSION, currentVersion: INVESTIGATION_CACAO_PROFILE_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'non_destructive_merge', byteBudget: MAX_INVESTIGATION_CACAO_IMPORT_BYTES, owner: 'frontend/src/lib/analysis/investigation-playbook-interchange.ts', note: 'Restricted CACAO 2.0 profile with a connected linear sequence of manual analyst steps; version 2 adds fixed response recipe identifiers while executable commands, branches, targets, credentials, and arbitrary operations remain rejected.' }),
  entry({ id: 'export.brand-protection-operations-report', kind: 'export', schema: BRAND_PROTECTION_OPERATIONS_REPORT_SCHEMA, currentVersion: BRAND_PROTECTION_OPERATIONS_REPORT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_OPERATIONS_REPORT_BYTES, owner: 'frontend/src/lib/analysis/brand-protection-operations-report.ts', note: 'Aggregate current Case-action counts with explicit denominators, time-window basis, source state, bounds, and limitations. It excludes domains, recipients, notes, outcomes, raw evidence, and transition-time inference.' }),
  entry({ id: 'export.relationship-graph', kind: 'export', schema: RELATIONSHIP_GRAPH_EXPORT_SCHEMA, currentVersion: RELATIONSHIP_GRAPH_EXPORT_VERSION, supportedVersions: [1, 2, 3], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_RELATIONSHIP_GRAPH_EXPORT_BYTES, owner: 'frontend/src/lib/analysis/case-relationship-graph-export.ts', note: 'One canonical bounded relationship document serialised as WHOISleuth JSON, GraphML, or GEXF; version 3 adds browser-local commonality context while transient graph view state remains excluded.' }),
  entry({ id: 'export.relationship-observations', kind: 'export', schema: RELATIONSHIP_OBSERVATION_SCHEMA, currentVersion: RELATIONSHIP_OBSERVATION_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'non_destructive_merge', byteBudget: MAX_RELATIONSHIP_OBSERVATION_STORE_BYTES, owner: 'frontend/src/lib/analysis/relationship-observation-model.ts', note: 'Workspace-archive section for bounded analyst-selected derived pivots; raw scan and lookup responses are excluded.' }),
  entry({ id: 'export.bulk-sessions', kind: 'export', schema: BULK_SESSION_SCHEMA, currentVersion: BULK_SESSION_SCHEMA_VERSION, supportedVersions: [...SUPPORTED_BULK_SESSION_SCHEMA_VERSIONS], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'non_destructive_merge', byteBudget: MAX_BULK_SESSION_STORE_BYTES, owner: 'frontend/src/lib/analysis/bulk-session-model.ts', note: 'Portable compact Bulk sessions with explicit source states, comparison limitations, and schema-4 bounded profile-context provenance. Schemas 1 through 3 merge with profile-dependent conclusions withheld because those rows cannot prove which profile context was evaluated.' }),
  entry({ id: 'export.bulk-review', kind: 'export', schema: BULK_REVIEW_SCHEMA, currentVersion: BULK_REVIEW_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'non_destructive_merge', byteBudget: MAX_BULK_REVIEW_STORE_BYTES, owner: 'frontend/src/lib/analysis/bulk-review-model.ts', note: 'Workspace-archive section for saved Bulk views and explicit review states; network collection and case disposition are never changed by import.' }),
  entry({ id: 'export.workspace-archive', kind: 'export', schema: WORKSPACE_ARCHIVE_SCHEMA, currentVersion: WORKSPACE_ARCHIVE_VERSION, supportedVersions: [1, 2, 3, 4, 5], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'non_destructive_merge', byteBudget: MAX_WORKSPACE_ARCHIVE_BYTES, owner: 'frontend/src/lib/analysis/workspace-archive.ts', note: 'Manifested local archive with per-section checksums, preview-first import, rollback on browser-store write failure, and backward compatibility with archive versions 1 through 4.' }),
  entry({ id: 'export.encrypted-workspace-archive', kind: 'export', schema: ENCRYPTED_WORKSPACE_ARCHIVE_SCHEMA, currentVersion: ENCRYPTED_WORKSPACE_ARCHIVE_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'non_destructive_merge', byteBudget: MAX_ENCRYPTED_WORKSPACE_ARCHIVE_BYTES, owner: 'frontend/src/lib/analysis/workspace-archive-crypto.ts', note: 'Browser-local PBKDF2 and AES-GCM wrapper around the ordinary checksummed archive; passphrases are never persisted or recoverable.' }),
  entry({ id: 'export.workspace-settings-section', kind: 'export', schema: WORKSPACE_SETTINGS_SCHEMA, currentVersion: WORKSPACE_SETTINGS_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'non_destructive_merge', byteBudget: null, owner: 'frontend/src/lib/analysis/workspace-archive.ts', note: 'Nested archive section limited to the active Brand Profile identifier and dark, light, or system theme preference.' }),
  entry({ id: 'export.lookup-evidence', kind: 'export', schema: LOOKUP_EVIDENCE_SCHEMA, currentVersion: LOOKUP_EVIDENCE_SCHEMA_VERSION, supportedVersions: [25, 26, 27], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'read_only', writeSemantics: 'read_only', byteBudget: LOOKUP_EVIDENCE_PORTABLE_MAX_BYTES, owner: 'lib/evidence-export.mts', note: 'Version 27 retains fixed homepage publication and selected-response delivery summaries. Version 26 binds projected diagnostics and source data to explicit source states. Version 25 keeps retained diagnostics authoritative over historical wrapper mismatches.' }),
  entry({ id: 'export.domain-control-manifest', kind: 'export', schema: DOMAIN_CONTROL_MANIFEST_SCHEMA, currentVersion: DOMAIN_CONTROL_MANIFEST_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/domain-control-manifest.mts', note: 'Version 2 uses deterministic sorted-json-v2 integrity for analyst-authored desired state; version 1 remains readable and empty fields remain unconfigured.' }),
  entry({ id: 'export.defensive-indicators', kind: 'export', schema: null, currentVersion: DEFENSIVE_INDICATOR_EXPORT_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'frontend/src/lib/analysis/defensive-indicator-export.ts', note: 'Review-only indicator, provenance-manifest, and rollback formats; never submitted or applied automatically.' }),
  entry({ id: 'export.stix-indicators', kind: 'export', schema: null, currentVersion: STIX_INDICATOR_EXPORT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'frontend/src/lib/analysis/stix-indicator-export.ts', note: 'STIX 2.1 bundle with direct observations separated from heuristic indicators.' }),
  entry({ id: 'export.misp-indicators', kind: 'export', schema: null, currentVersion: MISP_INDICATOR_EXPORT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'frontend/src/lib/analysis/misp-indicator-export.ts', note: 'Unpublished, non-IDS, non-correlating event for reviewed import.' }),
  entry({ id: 'export.synthetic-demo', kind: 'export', schema: SYNTHETIC_DEMO_EXPORT_SCHEMA, currentVersion: SYNTHETIC_DEMO_EXPORT_VERSION, supportedVersions: [2, 3, 4, 5], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'frontend/src/lib/analysis/demo-model.ts', note: 'Explicitly synthetic fixed-fixture package, never live evidence.' }),
  entry({ id: 'cli.lookup', kind: 'cli_document', schema: CLI_LOOKUP_SCHEMA, currentVersion: CLI_LOOKUP_SCHEMA_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_SAVED_LOOKUP_INPUT_BYTES, owner: 'cli/formatters/json.mts', note: 'Saved domain lookups preserve version 1 compatibility while version 2 can retain bounded Deep homepage metadata for offline review and evidence export.' }),
  entry({ id: 'cli.doctor', kind: 'cli_document', schema: DOCTOR_SCHEMA, currentVersion: DOCTOR_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/doctor.mts', note: 'Bounded runtime and optional explicitly approved network-diagnostic report; normal operation remains offline.' }),
  entry({ id: 'cli.command-catalogue', kind: 'cli_document', schema: CLI_COMMAND_CATALOGUE_SCHEMA, currentVersion: CLI_COMMAND_CATALOGUE_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/command-catalogue.mts', note: 'Installed command, usage, collection-mode, and boundary catalogue without target or evidence values.' }),
  entry({ id: 'cli.lookup-plan', kind: 'cli_document', schema: CLI_LOOKUP_PLAN_SCHEMA, currentVersion: CLI_LOOKUP_PLAN_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/lookup-plan.mts', note: 'Request-free preview of the sources and disclosures associated with an analyst-selected lookup mode.' }),
  entry({ id: 'cli.lookup-timeline', kind: 'cli_document', schema: CLI_LOOKUP_TIMELINE_SCHEMA, currentVersion: CLI_LOOKUP_TIMELINE_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_LOOKUP_TIMELINE_INPUT_BYTES, owner: 'cli/lookup-timeline.mts', note: 'Offline chronological comparison of bounded same-domain saved observations; missing fields and unavailable evidence remain explicit.' }),
  entry({ id: 'cli.mail-review', kind: 'cli_document', schema: CLI_MAIL_REVIEW_SCHEMA, currentVersion: CLI_MAIL_REVIEW_VERSION, supportedVersions: [2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_MAIL_REVIEW_INPUT_BYTES, owner: 'cli/mail-review.mts', note: 'Offline passive mail and DANE review over bounded saved lookup inputs; it makes no SMTP connection.' }),
  entry({ id: 'cli.page-compare', kind: 'cli_document', schema: CLI_PAGE_COMPARE_SCHEMA, currentVersion: CLI_PAGE_COMPARE_VERSION, supportedVersions: [2, 3], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_SAVED_LOOKUP_INPUT_BYTES, owner: 'cli/page-compare.mts', note: 'Offline comparison of two bounded deep-lookup page identity, technology, favicon, TLS, and response observations; version 3 withholds equality for partial technology sets.' }),
  entry({ id: 'cli.workspace-archive-inspection', kind: 'cli_document', schema: ARCHIVE_INSPECTION_SCHEMA, currentVersion: ARCHIVE_INSPECTION_VERSION, supportedVersions: [2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_OFFLINE_ARTIFACT_BYTES, owner: 'cli/archive-inspect.mts', note: 'Offline bounded archive summary and deliberate redacted search report; it does not reveal retained values unless explicitly requested.' }),
  entry({ id: 'cli.offline-artifact-verification', kind: 'cli_document', schema: OFFLINE_ARTIFACT_VERIFICATION_SCHEMA, currentVersion: OFFLINE_ARTIFACT_VERIFICATION_VERSION, supportedVersions: [2, 3], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_OFFLINE_ARTIFACT_BYTES, owner: 'cli/artifact-verify.mts', note: 'Version 3 adds optional exact-byte manifest identity checks while preserving separate structure, integrity, projection, and encrypted-envelope assurance.' }),
  entry({ id: 'cli.signed-evidence-package', kind: 'cli_document', schema: SIGNED_EVIDENCE_PACKAGE_SCHEMA, currentVersion: SIGNED_EVIDENCE_PACKAGE_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_OFFLINE_ARTIFACT_BYTES, owner: 'cli/evidence-signing.mts', note: 'Version 2 signs deterministic sorted-json-v2 bytes; valid version-1 signatures remain verifiable and embedded-artifact assurance stays separate.' }),
  entry({ id: 'cli.evidence-signature-verification', kind: 'cli_document', schema: EVIDENCE_SIGNATURE_VERIFICATION_SCHEMA, currentVersion: EVIDENCE_SIGNATURE_VERIFICATION_VERSION, supportedVersions: [2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_OFFLINE_ARTIFACT_BYTES, owner: 'cli/evidence-signing.mts', note: 'Version 2 reports cryptographic signature validity separately from embedded-artifact assurance, signer identity, and evidence accuracy.' }),
  entry({ id: 'cli.local-mmdb-query-input', kind: 'cli_document', schema: LOCAL_MMDB_QUERY_SCHEMA, currentVersion: LOCAL_MMDB_QUERY_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: MAX_OFFLINE_EVIDENCE_INPUT_BYTES, owner: 'cli/local-mmdb-review.mts', note: 'Local analyst-supplied address and database provenance metadata; the database and address are not transmitted.' }),
  entry({ id: 'cli.rdap-search-input', kind: 'cli_document', schema: RDAP_SEARCH_INPUT_SCHEMA, currentVersion: OFFLINE_EVIDENCE_INPUT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: MAX_OFFLINE_EVIDENCE_INPUT_BYTES, owner: 'cli/offline-evidence-review.mts', note: 'Offline RDAP search help, request plan and optional retained response inspection input.' }),
  entry({ id: 'cli.dnssec-evidence-input', kind: 'cli_document', schema: DNSSEC_EVIDENCE_INPUT_SCHEMA, currentVersion: OFFLINE_EVIDENCE_INPUT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: MAX_OFFLINE_EVIDENCE_INPUT_BYTES, owner: 'cli/offline-evidence-review.mts', note: 'Offline source-qualified DNSSEC evidence input; it does not perform validation requests.' }),
  entry({ id: 'cli.tlsa-evidence-input', kind: 'cli_document', schema: TLSA_EVIDENCE_INPUT_SCHEMA, currentVersion: OFFLINE_EVIDENCE_INPUT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: MAX_OFFLINE_EVIDENCE_INPUT_BYTES, owner: 'cli/offline-evidence-review.mts', note: 'Offline TLSA and certificate-material review input; unsupported or incomplete chains remain explicit.' }),
  entry({ id: 'cli.rpki-route-input', kind: 'cli_document', schema: RPKI_ROUTE_INPUT_SCHEMA, currentVersion: OFFLINE_EVIDENCE_INPUT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: MAX_OFFLINE_EVIDENCE_INPUT_BYTES, owner: 'cli/offline-evidence-review.mts', note: 'Offline route-origin and analyst-supplied authorisation evidence input.' }),
  entry({ id: 'cli.cryptographic-assurance-input', kind: 'cli_document', schema: CRYPTOGRAPHIC_ASSURANCE_INPUT_SCHEMA, currentVersion: CRYPTOGRAPHIC_ASSURANCE_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: MAX_OFFLINE_EVIDENCE_INPUT_BYTES, owner: 'lib/cryptographic-assurance.mts', note: 'Offline source-qualified DNSSEC, route-origin, and DANE or TLSA input whose evidence families remain independently attributed.' }),
  entry({ id: 'cli.dnssec-trust-anchor-input', kind: 'cli_document', schema: DNSSEC_TRUST_ANCHOR_SCHEMA, currentVersion: DNSSEC_TRUST_ANCHOR_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: MAX_DNSSEC_TRUST_ANCHOR_BYTES, owner: 'lib/dnssec-chain-validation.mts', note: 'Analyst-supplied bounded trust anchor used only by an explicitly authorised isolated validation action.' }),
  entry({ id: 'cli.mail-transport-input', kind: 'cli_document', schema: MAIL_TRANSPORT_INPUT_SCHEMA, currentVersion: MAIL_TRANSPORT_INPUT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: MAX_MAIL_TRANSPORT_INPUT_BYTES, owner: 'lib/smtp-transport-review.mts', note: 'Bounded analyst-selected MX and supplied policy-context input; its version is independent from output evolution and it cannot select more than three endpoints.' }),
  entry({ id: 'cli.local-geoip-query-input', kind: 'cli_document', schema: LOCAL_GEOIP_QUERY_SCHEMA, currentVersion: OFFLINE_EVIDENCE_INPUT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: MAX_OFFLINE_EVIDENCE_INPUT_BYTES, owner: 'cli/offline-evidence-review.mts', note: 'Offline query against an analyst-supplied bounded local GeoIP evidence document.' }),
  entry({ id: 'cli.encrypted-dns-plan-input', kind: 'cli_document', schema: ENCRYPTED_DNS_PLAN_INPUT_SCHEMA, currentVersion: OFFLINE_EVIDENCE_INPUT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: MAX_OFFLINE_EVIDENCE_INPUT_BYTES, owner: 'cli/offline-evidence-review.mts', note: 'Request-free encrypted-DNS adapter and query-plan input; it does not send a DNS request.' }),
  entry({ id: 'cli.bulk', kind: 'cli_document', schema: CLI_BULK_SCHEMA, currentVersion: CLI_BULK_SCHEMA_VERSION, supportedVersions: [1, 2, 3], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/formatters/json.mts', note: 'Bounded Bulk result document; version 2 added compact DNS and passive mail summaries, and version 3 separates report generation time from nullable per-item observation time and collection origin.' }),
  entry({ id: 'cli.bulk-item', kind: 'cli_document', schema: CLI_BULK_ITEM_SCHEMA, currentVersion: CLI_BULK_SCHEMA_VERSION, supportedVersions: [1, 2, 3], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/formatters/json.mts', note: 'One bounded Bulk JSONL or document item; version 3 preserves nullable per-item observation time and distinguishes current collection from checkpoint restoration.' }),
  entry({ id: 'cli.bulk-checkpoint', kind: 'cli_document', schema: CLI_BULK_CHECKPOINT_SCHEMA, currentVersion: CLI_BULK_CHECKPOINT_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'normalized_rewrite', byteBudget: MAX_BULK_CHECKPOINT_BYTES, owner: 'cli/bulk-checkpoint.mts', note: 'Private local compact Bulk checkpoint tied to the exact ordered input digest and scan mode; version 2 preserves nullable per-item observation time while schema-1 rows migrate without inventing one.' }),
  entry({ id: 'cli.progress-event', kind: 'cli_document', schema: CLI_PROGRESS_EVENT_SCHEMA, currentVersion: CLI_PROGRESS_EVENT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/progress-events.mts', note: 'Target-free JSONL lifecycle event emitted on standard error only when explicitly requested.' }),
  entry({ id: 'cli.lookup-diff', kind: 'cli_document', schema: CLI_LOOKUP_DIFF_SCHEMA, currentVersion: CLI_LOOKUP_DIFF_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_SAVED_LOOKUP_INPUT_BYTES, owner: 'cli/lookup-diff.mts', note: 'Offline comparison of two supported bounded saved Lookup documents.' }),
  entry({ id: 'cli.comparison-ledger', kind: 'cli_document', schema: CLI_COMPARISON_LEDGER_SCHEMA, currentVersion: CLI_COMPARISON_LEDGER_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_RETAINED_ARTIFACT_DIFF_BYTES * 2, owner: 'cli/retained-artifact-diff.mts', note: 'Value-free bounded index plus on-demand exact rows for explicitly paired retained Bulk sessions or domain-portfolio reviews.' }),
  entry({ id: 'cli.lookup-reconciliation', kind: 'cli_document', schema: CLI_LOOKUP_RECONCILIATION_SCHEMA, currentVersion: CLI_LOOKUP_RECONCILIATION_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_LOOKUP_RECONCILIATION_INPUT_BYTES, owner: 'cli/lookup-reconcile.mts', note: 'Offline reconciliation of two to five same-domain saved observations; labels remain analyst context rather than proof of independent collection.' }),
  entry({ id: 'cli.registry-doctor', kind: 'cli_document', schema: REGISTRY_DOCTOR_SCHEMA, currentVersion: REGISTRY_DOCTOR_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_SAVED_LOOKUP_INPUT_BYTES, owner: 'cli/registry-doctor.mts', note: 'Offline compatibility diagnostic comparing saved collection states and RDAP publication quality with the reviewed local registry capability profile.' }),
  entry({ id: 'cli.sharing-review', kind: 'cli_document', schema: SHARING_REVIEW_SCHEMA, currentVersion: SHARING_REVIEW_VERSION, supportedVersions: [2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_SHARING_REVIEW_BYTES, owner: 'cli/sharing-review.mts', note: 'Version 2 withholds ready status for projection-only or structure-only assurance; output remains redacted and does not grant recipient authorisation.' }),
  entry({ id: 'cli.lookalike-calibration-input', kind: 'cli_document', schema: LOOKALIKE_CALIBRATION_INPUT_SCHEMA, currentVersion: LOOKALIKE_CALIBRATION_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: MAX_LOOKALIKE_CALIBRATION_BYTES, owner: 'cli/lookalike-calibration.mts', note: 'Reviewed local candidate dispositions used only for target-free mutation-family yield diagnostics.' }),
  entry({ id: 'cli.lookalike-calibration', kind: 'cli_document', schema: LOOKALIKE_CALIBRATION_SCHEMA, currentVersion: LOOKALIKE_CALIBRATION_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/lookalike-calibration.mts', note: 'Target-free review-yield report that retains no candidate identifiers, domains, notes, or evidence values.' }),
  entry({ id: 'cli.domain-assurance-input', kind: 'cli_document', schema: DOMAIN_ASSURANCE_INPUT_SCHEMA, currentVersion: DOMAIN_ASSURANCE_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'read_only', byteBudget: MAX_ASSURANCE_INPUT_BYTES, owner: 'lib/domain-assurance.mts', note: 'Bounded analyst-authored planned-change, recovery-dependency, or retirement input; version 2 adds optional bounded custom retirement checks and performs no credentials or provider changes.' }),
  entry({ id: 'cli.domain-assurance', kind: 'cli_document', schema: DOMAIN_ASSURANCE_SCHEMA, currentVersion: DOMAIN_ASSURANCE_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/domain-assurance.mts', note: 'Offline assurance review with explicit unknown and incomplete states; version 2 can report bounded analyst-defined retirement checks and performs no collection or configuration change.' }),
  entry({ id: 'cli.domain-control-review', kind: 'cli_document', schema: DOMAIN_CONTROL_REVIEW_SCHEMA, currentVersion: DOMAIN_CONTROL_REVIEW_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/domain-control-manifest.mts', note: 'Offline desired-state comparison. Only complete separately attributed observations can produce drift.' }),
  entry({ id: 'cli.zone-intent-input', kind: 'cli_document', schema: ZONE_INTENT_INPUT_SCHEMA, currentVersion: ZONE_INTENT_REVIEW_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: MAX_ZONE_TEXT_BYTES, owner: 'lib/zone-intent-review.mts', note: 'Bounded BIND-subset or normalized-record intent input. Unsupported syntax is rejected and TXT values are reduced to digests.' }),
  entry({ id: 'cli.zone-intent-review', kind: 'cli_document', schema: ZONE_INTENT_REVIEW_SCHEMA, currentVersion: ZONE_INTENT_REVIEW_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/zone-intent-review.mts', note: 'Offline desired-versus-observed DNS comparison with explicit partial and unsupported states; never applies a DNS change.' }),
  entry({ id: 'cli.domain-portfolio-input', kind: 'cli_document', schema: DOMAIN_PORTFOLIO_INPUT_SCHEMA, currentVersion: DOMAIN_PORTFOLIO_REVIEW_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/domain-portfolio-review.mts', note: 'Bounded analyst-supplied portfolio assertions without credentials, contact details, or provider requests.' }),
  entry({ id: 'cli.domain-portfolio-review', kind: 'cli_document', schema: DOMAIN_PORTFOLIO_REVIEW_SCHEMA, currentVersion: DOMAIN_PORTFOLIO_REVIEW_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/domain-portfolio-review.mts', note: 'Offline concentration, renewal, and recovery-dependency review that preserves analyst-authored provenance.' }),
  entry({ id: 'cli.domain-change-input', kind: 'cli_document', schema: DOMAIN_CHANGE_INPUT_SCHEMA, currentVersion: DOMAIN_CHANGE_REVIEW_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/domain-change-review.mts', note: 'Bounded analyst-supplied authority, resolver, ACME, certificate, service, and HSTS observations; TXT values are reduced to digests.' }),
  entry({ id: 'cli.domain-change-review', kind: 'cli_document', schema: DOMAIN_CHANGE_REVIEW_SCHEMA, currentVersion: DOMAIN_CHANGE_REVIEW_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/domain-change-review.mts', note: 'Offline DNS change gate with explicit record agreement, DNSSEC automation, resolver-divergence, ACME, TLS-continuity, service, and preload context.' }),
  entry({ id: 'cli.domain-change-packet-input', kind: 'cli_document', schema: DOMAIN_CHANGE_PACKET_INPUT_SCHEMA, currentVersion: DOMAIN_CHANGE_PACKET_INPUT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: MAX_DOMAIN_CHANGE_PACKET_INPUT_BYTES, owner: 'lib/domain-change-packet.mts', note: 'Bounded version-1 analyst-supplied pre-change, post-change, and planned-change assurance inputs used without new collection.' }),
  entry({ id: 'cli.domain-change-packet', kind: 'cli_document', schema: DOMAIN_CHANGE_PACKET_SCHEMA, currentVersion: DOMAIN_CHANGE_PACKET_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/domain-change-packet.mts', note: 'Version 2 uses deterministic sorted-json-v2 integrity for the local change packet; the digest does not establish the truth of its observations.' }),
  entry({ id: 'cli.dns-convergence-input', kind: 'cli_document', schema: DNS_CONVERGENCE_INPUT_SCHEMA, currentVersion: DNS_CONVERGENCE_REVIEW_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: MAX_OFFLINE_EVIDENCE_INPUT_BYTES, owner: 'lib/dns-convergence-review.mts', note: 'Bounded analyst-supplied expected DNS state and separately attributed observer snapshots; unavailable observations remain explicit.' }),
  entry({ id: 'cli.dns-convergence-review', kind: 'cli_document', schema: DNS_CONVERGENCE_REVIEW_SCHEMA, currentVersion: DNS_CONVERGENCE_REVIEW_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/dns-convergence-review.mts', note: 'Offline resolver-convergence matrix that separates agreement, divergence, incompleteness, and unavailable observations.' }),
  entry({ id: 'cli.trust-store-comparison-input', kind: 'cli_document', schema: TRUST_STORE_COMPARISON_INPUT_SCHEMA, currentVersion: TRUST_STORE_COMPARISON_REVIEW_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: MAX_OFFLINE_EVIDENCE_INPUT_BYTES, owner: 'lib/trust-store-comparison.mts', note: 'Bounded analyst-supplied certificate-chain digests and separately attributed trust-store snapshots; certificate bytes and local store contents are excluded.' }),
  entry({ id: 'cli.trust-store-comparison-review', kind: 'cli_document', schema: TRUST_STORE_COMPARISON_REVIEW_SCHEMA, currentVersion: TRUST_STORE_COMPARISON_REVIEW_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/trust-store-comparison.mts', note: 'Offline exact-fingerprint intersection review; it does not perform certificate path validation or establish browser trust.' }),
  entry({ id: 'cli.nameserver-preflight-input', kind: 'cli_document', schema: NAMESERVER_PREFLIGHT_INPUT_SCHEMA, currentVersion: NAMESERVER_PREFLIGHT_REVIEW_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/nameserver-preflight-review.mts', note: 'Bounded intended nameserver set and separately attributed direct-service observations; performs no collection or registry change.' }),
  entry({ id: 'cli.nameserver-preflight-review', kind: 'cli_document', schema: NAMESERVER_PREFLIGHT_REVIEW_SCHEMA, currentVersion: NAMESERVER_PREFLIGHT_REVIEW_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/nameserver-preflight-review.mts', note: 'Offline undelegated nameserver readiness gate covering authority, served NS set, SOA, public address and in-bailiwick glue evidence.' }),
  entry({ id: 'cli.investigation-plan', kind: 'cli_document', schema: CLI_INVESTIGATION_PLAN_SCHEMA, currentVersion: CLI_INVESTIGATION_PLAN_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/investigation-plan.mts', note: 'Plan-only fixed recipes composed from existing bounded commands; no step, placeholder, script, file, request, case change, or submission is executed.' }),
  entry({ id: 'cli.investigation-run', kind: 'cli_document', schema: CLI_INVESTIGATION_RUN_SCHEMA, currentVersion: CLI_INVESTIGATION_RUN_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'normalized_rewrite', byteBudget: MAX_INVESTIGATION_RUN_BYTES, owner: 'cli/investigation-run.mts', note: 'Resumable state for installed fixed-recipe steps; network work requires per-run approval and analyst placeholders always pause.' }),
  entry({ id: 'cli.collection-preflight', kind: 'cli_document', schema: CLI_COLLECTION_PREFLIGHT_SCHEMA, currentVersion: CLI_COLLECTION_PREFLIGHT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/collection-preflight.mts', note: 'Offline bounded collection-family and disclosure preview that makes no request.' }),
  entry({ id: 'cli.config', kind: 'cli_document', schema: CLI_CONFIG_SCHEMA, currentVersion: CLI_CONFIG_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: MAX_CLI_CONFIG_BYTES, owner: 'cli/config-profile.mts', note: 'Strict local safe-default profiles; targets, deep mode, output paths, network approvals, failure policies and arbitrary arguments are refused.' }),
  entry({ id: 'export.cli-case-pack', kind: 'export', schema: CLI_CASE_PACK_SCHEMA, currentVersion: CLI_CASE_PACK_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_CASE_PACK_INPUT_BYTES, owner: 'cli/case-pack.mts', note: 'Packet version 2 uses deterministic sorted-json-v2 integrity while the enclosed Case schema remains version 12; packet version 1 remains verifiable.' }),
  entry({ id: 'cli.interchange-fidelity-report', kind: 'cli_document', schema: INTERCHANGE_FIDELITY_REPORT_SCHEMA, currentVersion: INTERCHANGE_FIDELITY_REPORT_VERSION, supportedVersions: [2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_INTERCHANGE_REPORT_BYTES, owner: 'cli/interchange-report.mts', note: 'Version 2 enforces the runtime registry assurance requirement before reporting fidelity; output remains metadata-only and excludes evidence values and unknown schema text.' }),
  entry({ id: 'cli.domain-control-review-input', kind: 'cli_document', schema: CLI_DOMAIN_CONTROL_REVIEW_INPUT_SCHEMA, currentVersion: CLI_DOMAIN_CONTROL_REVIEW_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: MAX_DOMAIN_CONTROL_REVIEW_INPUT_BYTES, owner: 'cli/domain-control-observations.mts', note: 'Bounded desired-state manifest plus saved Lookups converted without new collection.' }),
  entry({ id: 'cli.domain-control-observation-review', kind: 'cli_document', schema: CLI_DOMAIN_CONTROL_REVIEW_SCHEMA, currentVersion: CLI_DOMAIN_CONTROL_REVIEW_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/domain-control-observations.mts', note: 'Compact source-qualified control observations and desired-state comparison.' }),
  entry({ id: 'cli.domain-control-monitor', kind: 'cli_document', schema: CLI_DOMAIN_CONTROL_MONITOR_SCHEMA, currentVersion: CLI_DOMAIN_CONTROL_MONITOR_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'normalized_rewrite', byteBudget: null, owner: 'cli/domain-control-monitor.mts', note: 'One-shot bounded control review and optional prior checkpoint; not a daemon or scheduler.' }),
  entry({ id: 'cli.lookup-brief', kind: 'cli_document', schema: CLI_LOOKUP_BRIEF_SCHEMA, currentVersion: CLI_LOOKUP_BRIEF_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_SAVED_LOOKUP_INPUT_BYTES, owner: 'cli/lookup-brief.mts', note: 'Offline source-aware handoff; version 2 adds structured actions with expected outcomes.' }),
  entry({ id: 'cli.registry-cohort', kind: 'cli_document', schema: REGISTRY_COHORT_SCHEMA, currentVersion: REGISTRY_COHORT_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'normalize_to_current', writeSemantics: 'read_only', byteBudget: MAX_REGISTRY_COHORT_INPUT_BYTES, owner: 'cli/registry-cohort.mts', note: 'Version 2 adds bounded target-free timelines and can merge one unmixed family of retained version-1 or version-2 cohort reports without treating overlapping samples as independent.' }),
  entry({ id: 'cli.domain-control-flight-recorder-input', kind: 'cli_document', schema: DOMAIN_CONTROL_FLIGHT_RECORDER_INPUT_SCHEMA, currentVersion: DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/domain-control-flight-recorder.mts', note: 'Bounded source-qualified control observations and approved change windows.' }),
  entry({ id: 'cli.domain-control-flight-recorder', kind: 'cli_document', schema: DOMAIN_CONTROL_FLIGHT_RECORDER_SCHEMA, currentVersion: DOMAIN_CONTROL_FLIGHT_RECORDER_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/domain-control-flight-recorder.mts', note: 'Offline first/last-observed control history that preserves expected and unexpected changes.' }),
  entry({ id: 'cli.ct-search', kind: 'cli_document', schema: CLI_CT_SEARCH_SCHEMA, currentVersion: CLI_CT_SEARCH_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/formatters/json.mts', note: 'Certificate log search output.' }),
  entry({ id: 'cli.discover', kind: 'cli_document', schema: CLI_DISCOVER_SCHEMA, currentVersion: CLI_DISCOVER_SCHEMA_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/formatters/json.mts', note: 'Candidate discovery document.' }),
  entry({ id: 'cli.discover-item', kind: 'cli_document', schema: CLI_DISCOVER_ITEM_SCHEMA, currentVersion: CLI_DISCOVER_SCHEMA_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/formatters/json.mts', note: 'One candidate discovery JSONL item.' }),
  entry({ id: 'cli.discovery-scan', kind: 'cli_document', schema: CLI_DISCOVERY_SCAN_SCHEMA, currentVersion: CLI_DISCOVERY_SCAN_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/discovery-scan.mts', note: 'Bounded supervised candidate scan output with separately attributed collection states and analyst review lanes.' }),
  entry({ id: 'cli.discovery-scan-item', kind: 'cli_document', schema: CLI_DISCOVERY_SCAN_ITEM_SCHEMA, currentVersion: CLI_DISCOVERY_SCAN_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/discovery-scan.mts', note: 'One bounded supervised candidate scan JSONL item.' }),
  entry({ id: 'cli.discovery-snapshot', kind: 'cli_document', schema: CLI_DISCOVERY_SNAPSHOT_SCHEMA, currentVersion: CLI_DISCOVERY_SNAPSHOT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'normalized_rewrite', byteBudget: MAX_DISCOVERY_SNAPSHOT_BYTES, owner: 'cli/discovery-snapshot.mts', note: 'Private local generated-candidate baseline tied to the exact normalised discovery configuration and dictionary digest.' }),
  entry({ id: 'cli.discovery-observation-snapshot', kind: 'cli_document', schema: CLI_DISCOVERY_OBSERVATION_SCHEMA, currentVersion: CLI_DISCOVERY_OBSERVATION_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'normalized_rewrite', byteBudget: MAX_DISCOVERY_OBSERVATION_BYTES, owner: 'cli/discovery-observation-snapshot.mts', note: 'Private local registration and DNS baseline; version 2 preserves component-specific observation times and migrates version 1 on the next successful write.' }),
  entry({ id: 'cli.ct-event-batch', kind: 'cli_document', schema: CT_EVENT_BATCH_SCHEMA, currentVersion: CT_EVENT_BATCH_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: MAX_CT_EVENT_INPUT_BYTES, owner: 'cli/ct-event-intake.mts', note: 'Local source-qualified certificate-event intake that emits browser-compatible external findings without contacting a log or retaining certificate bytes.' }),
  entry({ id: 'cli.investigation-manifest', kind: 'cli_document', schema: INVESTIGATION_MANIFEST_SCHEMA, currentVersion: INVESTIGATION_MANIFEST_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_INVESTIGATION_MANIFEST_TOTAL_BYTES, owner: 'cli/investigation-manifest.mts', note: 'Version 2 uses deterministic sorted-json-v2 root and canonical-content digests in a path-free ordered manifest; it does not prove evidence truth.' }),
  entry({ id: 'cli.external-observation-mapping', kind: 'cli_document', schema: EXTERNAL_OBSERVATION_MAPPING_SCHEMA, currentVersion: EXTERNAL_OBSERVATION_MAPPING_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: MAX_EXTERNAL_OBSERVATION_MAPPING_BYTES, owner: 'cli/external-observation-mapping.mts', note: 'Strict analyst-authored mapping of bounded dotted fields into source-qualified browser-compatible findings; arbitrary code and prototype paths are refused.' }),
  entry({ id: 'cli.open-asset-model-bridge', kind: 'cli_document', schema: OPEN_ASSET_MODEL_BRIDGE_SCHEMA, currentVersion: OPEN_ASSET_MODEL_BRIDGE_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/open-asset-model-bridge.mts', note: 'Loss-aware local projection of strict external findings into a bounded open asset graph while preserving source, time, completeness, and limitations.' }),
  entry({ id: 'cli.source-reliability-report', kind: 'cli_document', schema: SOURCE_RELIABILITY_REPORT_SCHEMA, currentVersion: SOURCE_RELIABILITY_REPORT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: MAX_SOURCE_RELIABILITY_INPUT_BYTES, owner: 'cli/source-reliability.mts', note: 'Target-free local aggregation of source states, durations, truncation, and rate limits; reports retain no domains, queries, or raw response data.' }),
  entry({ id: 'cli.offline-evidence-review', kind: 'cli_document', schema: OFFLINE_EVIDENCE_REVIEW_SCHEMA, currentVersion: OFFLINE_EVIDENCE_REVIEW_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_OFFLINE_EVIDENCE_INPUT_BYTES, owner: 'cli/offline-evidence-review.mts', note: 'Local wrapper for supported versioned evidence-review inputs; it performs no refresh, transmission, provider request, or configuration change.' }),
  entry({ id: 'cli.cryptographic-assurance-review', kind: 'cli_document', schema: CRYPTOGRAPHIC_ASSURANCE_SCHEMA, currentVersion: CRYPTOGRAPHIC_ASSURANCE_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/cryptographic-assurance.mts', note: 'Three independently attributed assurance cards with no combined state, scalar score, or cross-family inference.' }),
  entry({ id: 'cli.dnssec-chain-validation', kind: 'cli_document', schema: DNSSEC_CHAIN_SCHEMA, currentVersion: DNSSEC_CHAIN_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/dnssec-chain-validation.mts', note: 'Isolated authorised DNSSEC chain report with distinct validation and transport states and no retained raw DNS or key material.' }),
  entry({ id: 'cli.mail-transport-review', kind: 'cli_document', schema: MAIL_TRANSPORT_REVIEW_SCHEMA, currentVersion: MAIL_TRANSPORT_REVIEW_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/smtp-transport-review.mts', note: 'Isolated authorised SMTP, STARTTLS, PKIX, DNSSEC and DANE review retaining distinct selected, public-revalidated, connected and address-authentication provenance; only confirmed connections form address relationship leads.' }),
  entry({ id: 'cli.posture', kind: 'cli_document', schema: CLI_POSTURE_SCHEMA, currentVersion: CLI_POSTURE_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/formatters/json.mts', note: 'Owned-domain posture output.' }),
  entry({ id: 'cli.http', kind: 'cli_document', schema: CLI_HTTP_SCHEMA, currentVersion: CLI_HTTP_SCHEMA_VERSION, supportedVersions: [1, 2, 3], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/formatters/json.mts', note: 'Bounded HTTP evidence output; version 3 adds fixed selected-response delivery metadata, version 2 separates an inconclusive activity assessment from a negative reachability claim, and version 1 retains its historical interpretation.' }),
  entry({ id: 'cli.tls', kind: 'cli_document', schema: CLI_TLS_SCHEMA, currentVersion: CLI_TLS_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/formatters/json.mts', note: 'Bounded TLS evidence output.' }),
  entry({ id: 'cli.compare', kind: 'cli_document', schema: CLI_COMPARE_SCHEMA, currentVersion: CLI_COMPARE_SCHEMA_VERSION, supportedVersions: [3], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_SAVED_LOOKUP_INPUT_BYTES, owner: 'cli/compare.mts', note: 'Comparison output reads supported saved Lookup versions 1 and 2 through the shared bounded parser.' }),
  entry({ id: 'cli.registry-support', kind: 'cli_document', schema: REGISTRY_SUPPORT_SCHEMA, currentVersion: REGISTRY_SUPPORT_SCHEMA_VERSION, supportedVersions: [2, 3, 4], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/registry-support.mts', note: 'Catalogue coverage report; optional official lookup links require deliberate browser navigation and do not test live reachability.' }),
  entry({ id: 'cli.registry-standards-coverage', kind: 'cli_document', schema: REGISTRY_STANDARDS_COVERAGE_SCHEMA, currentVersion: standardsCoverage.version, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/registry-capabilities.mts', note: 'Immutable official-source coverage snapshot embedded in registry-support output.' }),
  entry({ id: 'cli.risk-calibration-dataset', kind: 'cli_document', schema: RISK_CALIBRATION_DATASET_SCHEMA, currentVersion: RISK_CALIBRATION_DATASET_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'read_only', byteBudget: MAX_RISK_CALIBRATION_INPUT_BYTES, owner: 'cli/risk-calibration.mts', note: 'Offline labelled fixture input; version 2 adds bounded review context without live collection.' }),
  entry({ id: 'cli.risk-calibration-report', kind: 'cli_document', schema: RISK_CALIBRATION_REPORT_SCHEMA, currentVersion: RISK_CALIBRATION_REPORT_VERSION, supportedVersions: [1, 2, 3], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/risk-calibration.mts', note: 'Offline calibration output; version 3 distinguishes the bounded detailed report from a target-free aggregate summary for tab-local review.' }),
  entry({ id: 'cli.deployment-self-check', kind: 'cli_document', schema: DEPLOYMENT_SELF_CHECK_SCHEMA, currentVersion: DEPLOYMENT_SELF_CHECK_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'tools/deployment-self-check.mts', note: 'Redacted operator-run public-boundary report; response bodies and credentialed posture are excluded.' }),
  entry({ id: 'cli.maintainer-duplication-report', kind: 'cli_document', schema: MAINTAINER_DUPLICATION_REPORT_SCHEMA, currentVersion: MAINTAINER_DUPLICATION_REPORT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_MAINTAINER_DUPLICATION_REPORT_BYTES, owner: 'tools/maintainer-duplication-report.mts', note: 'Deterministic repository-relative static call graph and exact token-clone inventory for bounded maintainer modules; source text, literals, absolute paths, runtime values, and automatic consolidation are excluded.' }),
  entry({ id: 'cli.registry-drift-audit', kind: 'cli_document', schema: REGISTRY_DRIFT_AUDIT_SCHEMA, currentVersion: REGISTRY_DRIFT_AUDIT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'tools/registry-drift-audit.mts', note: 'Manual bounded comparison of two fixed official IANA catalogues; no registry query or automatic catalogue rewrite.' }),
  entry({ id: 'cli.rdap-extension-drift-audit', kind: 'cli_document', schema: RDAP_EXTENSION_DRIFT_AUDIT_SCHEMA, currentVersion: RDAP_EXTENSION_DRIFT_AUDIT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_RDAP_EXTENSION_SOURCE_BYTES, owner: 'tools/rdap-extension-drift-audit.mts', note: 'Offline fixture comparison with an optional manual fetch of one fixed official registry; never enables an extension or reverse search.' }),
  entry({ id: 'cli.specialist-workflow-benchmark', kind: 'cli_document', schema: SPECIALIST_WORKFLOW_BENCHMARK_SCHEMA, currentVersion: SPECIALIST_WORKFLOW_BENCHMARK_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'tools/specialist-workflow-benchmark.mts', note: 'Offline synthetic regression and workflow-contract benchmark; no live target, provider request, or deployment effect.' }),
  entry({ id: 'cli.service-dependency-signature-audit', kind: 'cli_document', schema: SERVICE_DEPENDENCY_SIGNATURE_AUDIT_SCHEMA, currentVersion: SERVICE_DEPENDENCY_SIGNATURE_AUDIT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'tools/service-dependency-signature-audit.mts', note: 'Offline digest, metadata, collision, and freshness audit for the passive service-dependency signature catalogue.' }),
  entry({ id: 'export.web-capture-summary', kind: 'export', schema: WEB_CAPTURE_SUMMARY_SCHEMA, currentVersion: WEB_CAPTURE_SUMMARY_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: null, owner: 'frontend/src/lib/analysis/web-capture-import.ts', note: 'Sanitised metadata-only capture summary accepted through the bounded external-finding preview.' }),
  entry({ id: 'export.web-capture-manifest', kind: 'export', schema: WEB_CAPTURE_MANIFEST_SCHEMA, currentVersion: WEB_CAPTURE_MANIFEST_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_WEB_CAPTURE_MANIFEST_BYTES, owner: 'frontend/src/lib/analysis/web-capture-import.ts', note: 'Metadata-only capture manifest; the browser accepts versions 1 and 2 while offline artefact comparison requires current version 2.' }),
  entry({ id: 'export.web-capture-dom-digest', kind: 'export', schema: WEB_CAPTURE_DOM_DIGEST_SCHEMA, currentVersion: WEB_CAPTURE_DOM_DIGEST_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: MAX_WEB_CAPTURE_DOM_DIGEST_BYTES, owner: 'packages/web-capture/capture.mts', note: 'Local structural and visible-text digests with counts and truncation only; markup and page text are excluded.' }),
  entry({ id: 'cli.web-capture-comparison', kind: 'cli_document', schema: WEB_CAPTURE_COMPARISON_SCHEMA, currentVersion: WEB_CAPTURE_COMPARISON_VERSION, supportedVersions: [2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'packages/web-capture/compare.mts', note: 'Version 2 offline comparison of two verified current rendered-capture packages reports page-title equality without copying either title and excludes input paths and DOM or body text.' }),
  entry({ id: 'derived.curated-connector-result', kind: 'derived', schema: CURATED_CONNECTOR_RESULT_SCHEMA, currentVersion: CURATED_CONNECTOR_CONTRACT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'none', byteBudget: null, owner: 'lib/threat-intelligence-contract.mts', note: 'Transient bounded entity and relationship projection; the contract enables no connector, request, credential, storage, score, or availability decision.' }),
  entry({ id: 'derived.observation-envelope', kind: 'derived', schema: OBSERVATION_ENVELOPE_SCHEMA, currentVersion: OBSERVATION_ENVELOPE_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'none', byteBudget: MAX_OBSERVATION_ENVELOPE_BYTES, owner: 'frontend/src/lib/analysis/observation-envelope.ts', note: 'Disposable typed adapter over authoritative browser-local records; it performs no writes and preserves source schema, provenance, partialness, and rollback state.' }),
  entry({ id: 'derived.investigation-projection', kind: 'derived', schema: INVESTIGATION_PROJECTION_SCHEMA, currentVersion: INVESTIGATION_PROJECTION_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'none', byteBudget: null, owner: 'frontend/src/lib/analysis/investigation-projection.ts', note: 'Read-only bounded projection over existing stores; never persisted.' }),
  entry({ id: 'derived.investigation-search', kind: 'derived', schema: INVESTIGATION_SEARCH_SCHEMA, currentVersion: INVESTIGATION_SEARCH_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'none', byteBudget: null, owner: 'frontend/src/lib/analysis/investigation-search.ts', note: 'Disposable in-memory index; never persisted or transmitted.' }),
];

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || value.length > 64 || /[\x00-\x1f\x7f]/u.test(value)) {
    throw new TypeError('Schema inventory timestamp must be a bounded ISO date.');
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError('Schema inventory timestamp must be a bounded ISO date.');
  return new Date(parsed).toISOString();
}

function validateSchemaCompatibilityEntries(values: readonly SchemaCompatibilityEntry[]): void {
  if (!Array.isArray(values) || values.length === 0 || values.length > MAX_SCHEMA_COMPATIBILITY_ENTRIES) {
    throw new Error(`Schema compatibility inventory must contain 1-${MAX_SCHEMA_COMPATIBILITY_ENTRIES} entries.`);
  }
  const ids = new Set<string>();
  for (const value of values) {
    if (!/^[a-z0-9][a-z0-9.-]{2,79}$/u.test(value.id) || ids.has(value.id)) {
      throw new Error(`Schema compatibility entry id is invalid or duplicated: ${value.id}`);
    }
    ids.add(value.id);
    if (!CONTRACT_KINDS.has(value.kind)
      || !FUTURE_VERSION_BEHAVIORS.has(value.futureVersionBehavior)
      || !MIGRATION_BEHAVIORS.has(value.migration)
      || !WRITE_SEMANTICS.has(value.writeSemantics)
      || typeof value.acceptsUnversionedLegacy !== 'boolean') {
      throw new Error(`Schema compatibility entry ${value.id} has invalid compatibility metadata.`);
    }
    if (!Number.isSafeInteger(value.currentVersion) || value.currentVersion <= 0) {
      throw new Error(`Schema compatibility entry ${value.id} has an invalid current version.`);
    }
    const versions = [...value.supportedVersions];
    if (!versions.length
      || versions.some((version) => !Number.isSafeInteger(version) || version <= 0)
      || new Set(versions).size !== versions.length
      || versions.some((version, index) => index > 0 && version <= versions[index - 1])
      || versions.at(-1) !== value.currentVersion) {
      throw new Error(`Schema compatibility entry ${value.id} must explicitly end its supported-version list at current version ${value.currentVersion}.`);
    }
    if (value.schema !== null && (value.schema.length > 120 || !/^[-a-z0-9.:]+$/u.test(value.schema))) {
      throw new Error(`Schema compatibility entry ${value.id} has an invalid schema identifier.`);
    }
    if (value.byteBudget !== null && (!Number.isSafeInteger(value.byteBudget) || value.byteBudget <= 0)) {
      throw new Error(`Schema compatibility entry ${value.id} has an invalid byte budget.`);
    }
    if (value.owner.length > 200 || !/^[a-z0-9_./-]+$/iu.test(value.owner) || value.owner.startsWith('/') || value.owner.includes('..')) {
      throw new Error(`Schema compatibility entry ${value.id} has an invalid owner path.`);
    }
    if (!value.note || value.note.length > 300 || /[\x00-\x1f\x7f]/u.test(value.note)) {
      throw new Error(`Schema compatibility entry ${value.id} has an invalid note.`);
    }
  }
}

function cloneEntry(value: SchemaCompatibilityEntry): SchemaCompatibilityEntry {
  return { ...value, supportedVersions: [...value.supportedVersions] };
}

export function validateInterchangeSchemaCompatibility(
  entries: readonly SchemaCompatibilityEntry[],
  contracts = INTERCHANGE_ARTIFACT_CONTRACTS,
): void {
  for (const contract of contracts.filter((item) => item.id !== 'legacy_desired_baseline')) {
    const declared = entries.find((item) => item.schema === contract.schema);
    if (
      !declared
      || contract.versions.length !== declared.supportedVersions.length
      || contract.versions.some((version, index) => version !== declared.supportedVersions[index])
    ) {
      throw new Error(`Interchange contract ${contract.id} must exactly match the schema compatibility inventory versions.`);
    }
  }
}

function buildSchemaCompatibilityInventory(
  options: { generatedAt?: string } = {},
): SchemaCompatibilityInventory {
  validateSchemaCompatibilityEntries(ENTRIES);
  validateInterchangeSchemaCompatibility(ENTRIES);
  return {
    schema: SCHEMA_COMPATIBILITY_INVENTORY_SCHEMA,
    version: SCHEMA_COMPATIBILITY_INVENTORY_VERSION,
    generatedAt: timestamp(options.generatedAt || new Date().toISOString()),
    entries: ENTRIES.map(cloneEntry),
    limitations: [
      'This report describes checked-in compatibility contracts; it does not inspect browser data, hosted storage, or a deployment.',
      'A listed version is supported only according to the named owner module and the migration behaviour shown here.',
      'Unversioned settings without a structured schema are outside this report unless they have an explicit compatibility reader.',
    ],
  };
}

function markdownCell(value: unknown): string {
  return String(value)
    .replace(/[\x00-\x1f\x7f]+/gu, ' ')
    .replace(/\\/gu, '\\\\')
    .replace(/\|/gu, '\\|')
    .replace(/`/gu, '\\`');
}

function formatByteBudget(value: number | null): string {
  return value === null ? 'Field and collection bounds' : `${value.toLocaleString('en-US')} bytes`;
}

function formatSchemaCompatibilityInventory(inventory: SchemaCompatibilityInventory): string {
  if (!inventory || typeof inventory !== 'object'
    || inventory.schema !== SCHEMA_COMPATIBILITY_INVENTORY_SCHEMA
    || inventory.version !== SCHEMA_COMPATIBILITY_INVENTORY_VERSION) {
    throw new TypeError('Schema compatibility report requires the current inventory contract.');
  }
  const generatedAt = timestamp(inventory.generatedAt);
  if (!Array.isArray(inventory.limitations)
    || inventory.limitations.length > MAX_INVENTORY_LIMITATIONS
    || inventory.limitations.some((value) => typeof value !== 'string'
      || !value
      || value.length > MAX_INVENTORY_LIMITATION_LENGTH
      || /[\x00-\x1f\x7f]/u.test(value))) {
    throw new TypeError('Schema compatibility report limitations are invalid.');
  }
  validateSchemaCompatibilityEntries(inventory.entries);
  const lines = [
    '# WHOISleuth schema compatibility inventory',
    '',
    `Contract: \`${markdownCell(inventory.schema)}\` v${inventory.version}`,
    `Generated: ${markdownCell(generatedAt)}`,
    '',
    '| Contract | Kind | Schema | Current | Supported | Future version | Migration | Write semantics | Serialised bound | Owner |',
    '| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |',
  ];
  for (const value of inventory.entries) {
    const supported = `${value.supportedVersions.join(', ')}${value.acceptsUnversionedLegacy ? ' plus unversioned legacy' : ''}`;
    lines.push(`| ${markdownCell(value.id)} | ${markdownCell(value.kind)} | ${value.schema ? `\`${markdownCell(value.schema)}\`` : 'No schema string'} | ${value.currentVersion} | ${markdownCell(supported)} | ${markdownCell(value.futureVersionBehavior)} | ${markdownCell(value.migration)} | ${markdownCell(value.writeSemantics)} | ${markdownCell(formatByteBudget(value.byteBudget))} | \`${markdownCell(value.owner)}\` |`);
  }
  lines.push('', '## Contract notes', '');
  for (const value of inventory.entries) lines.push(`- **${markdownCell(value.id)}:** ${markdownCell(value.note)}`);
  lines.push('', '## Limitations', '');
  for (const limitation of inventory.limitations) lines.push(`- ${markdownCell(limitation)}`);
  return `${lines.join('\n')}\n`;
}

export {
  buildSchemaCompatibilityInventory,
  formatSchemaCompatibilityInventory,
  validateSchemaCompatibilityEntries,
};
export type {
  ContractKind,
  FutureVersionBehavior,
  MigrationBehavior,
  WriteSemantics,
  SchemaCompatibilityEntry,
  SchemaCompatibilityInventory,
};
