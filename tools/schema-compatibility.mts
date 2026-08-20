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
  CLI_POSTURE_SCHEMA,
  CLI_POSTURE_SCHEMA_VERSION,
  CLI_TLS_SCHEMA,
  CLI_TLS_SCHEMA_VERSION,
} from '../cli/formatters/json.mts';
import {
  CAPABILITY_MANIFEST_SCHEMA,
  CAPABILITY_MANIFEST_VERSION,
  MAX_CAPABILITY_MANIFEST_BYTES,
} from '../packages/contracts/capability-manifest.mts';
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
  mutableSchemaCompatibilityEntry,
  validateSchemaCompatibilityDescriptor,
  type ContractKind,
  type FutureVersionBehavior,
  type MigrationBehavior,
  type SchemaCompatibilityDescriptor,
  type SchemaCompatibilityEntry,
  type WriteSemantics,
} from '../packages/contracts/schema-compatibility.mts';
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
} from '../cli/case-pack.mts';
import {
  INTERCHANGE_FIDELITY_REPORT_SCHEMA,
  INTERCHANGE_FIDELITY_REPORT_VERSION,
  MAX_INTERCHANGE_REPORT_BYTES,
} from '../cli/interchange-report.mts';
import { INTERCHANGE_ARTIFACT_CONTRACTS } from '../lib/interchange-fidelity-registry.mts';
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
  DEFENSIVE_INDICATOR_MANIFEST_SCHEMA,
  DEFENSIVE_INDICATOR_ROLLBACK_SCHEMA,
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
import { SCHEMA_LIFECYCLE_REGISTRY } from '../packages/contracts/schema-lifecycle-registry.mts';
import { RDAP_NAMESERVER_SEARCH_COMPATIBILITY } from '../packages/contracts/rdap-nameserver-search.mts';
import { SSLBL_SNAPSHOT_COMPATIBILITY } from '../packages/contracts/sslbl-snapshot.mts';
import {
  CASE_RELATIONSHIP_CLUSTER_VERSION,
  REVIEWED_RELATIONSHIP_CLUSTERS_SCHEMA,
} from '../frontend/src/lib/analysis/case-relationship-clusters.ts';
import {
  DNS_CHANGE_REHEARSAL_EXPORT_SCHEMA,
  DNS_CHANGE_REHEARSAL_VERSION,
} from '../frontend/src/lib/analysis/dns-change-rehearsal.ts';
import {
  LOOKUP_INVESTIGATION_BRIEF_SCHEMA,
  LOOKUP_INVESTIGATION_BRIEF_VERSION,
} from '../frontend/src/lib/analysis/lookup-investigation-brief.ts';
import {
  LOOKUP_ASSET_GRAPH_SCHEMA,
  LOOKUP_ASSET_GRAPH_VERSION,
} from '../frontend/src/lib/analysis/lookup-asset-graph.ts';
import {
  MAIL_REPORT_SCHEMA,
  MAIL_REPORT_VERSION,
} from '../frontend/src/lib/analysis/mail-report-workbench.ts';
import {
  REGISTRATION_DISCLOSURE_PLAN_SCHEMA,
  REGISTRATION_DISCLOSURE_PLAN_VERSION,
} from '../frontend/src/lib/analysis/registration-disclosure-plan.ts';
import {
  MAX_STATIC_PAGE_PATTERN_PACK_BYTES,
  STATIC_PAGE_PATTERN_PACK_SCHEMA,
  STATIC_PAGE_PATTERN_PACK_VERSION,
} from '../frontend/src/lib/analysis/static-page-pattern-packs.ts';
import {
  DNSSEC_EVIDENCE_SCHEMA,
  DNSSEC_EVIDENCE_VERSION,
} from '../lib/dnssec-evidence-validation.mts';
import {
  TLSA_EVIDENCE_SCHEMA,
  TLSA_EVIDENCE_VERSION,
} from '../lib/tlsa-evidence.mts';
import {
  RPKI_EVIDENCE_SCHEMA,
  RPKI_EVIDENCE_VERSION,
} from '../lib/rpki-evidence.mts';
import {
  ENCRYPTED_DNS_CONTRACT_SCHEMA,
  ENCRYPTED_DNS_CONTRACT_VERSION,
} from '../lib/encrypted-dns-contract.mts';
import {
  RDAP_SEARCH_WORKBENCH_SCHEMA,
  RDAP_SEARCH_WORKBENCH_VERSION,
} from '../lib/rdap-search-workbench.mts';
import {
  LOOKUP_PROGRESS_SCHEMA,
  LOOKUP_PROGRESS_VERSION,
  MAX_LOOKUP_PROGRESS_STREAM_BYTES,
} from '../lib/lookup-progress.mts';
import {
  LOOKUP_PROGRESS_STAGING_EVIDENCE_SCHEMA,
  LOOKUP_PROGRESS_STAGING_EVIDENCE_VERSION,
  LOOKUP_PROGRESS_STAGING_QUALIFICATION_SCHEMA,
  LOOKUP_PROGRESS_STAGING_QUALIFICATION_VERSION,
} from '../lib/lookup-progress-staging-evidence.mts';
import {
  LOOKUP_READABLE_REPORT_SCHEMA,
  LOOKUP_READABLE_REPORT_VERSION,
  MAX_LOOKUP_READABLE_REPORT_BYTES,
} from '../lib/lookup-readable-report.mts';
import {
  CONFUSABLE_PROJECTION_SCHEMA,
  CONFUSABLE_PROJECTION_VERSION,
} from '../lib/idn-confusable-policy.mts';
import {
  THREAT_INTELLIGENCE_CONTRACT_VERSION,
  THREAT_INTELLIGENCE_SCHEMA,
} from '../lib/threat-intelligence-types.mts';
import {
  SCHEDULED_MONITOR_LOG_SCHEMA,
  SCHEDULED_MONITOR_LOG_VERSION,
} from '../netlify/functions/scheduled-monitor.mts';
import { MAX_LOOKUP_PROGRESS_STAGING_FILE_BYTES } from './incremental-lookup-staging-evidence.mts';

export const SCHEMA_COMPATIBILITY_INVENTORY_SCHEMA = 'whoisleuth.schema-compatibility-inventory';
export const SCHEMA_COMPATIBILITY_INVENTORY_VERSION = 1;
export const MAX_SCHEMA_COMPATIBILITY_ENTRIES = 224;

const MAX_SCHEMA_COMPATIBILITY_VERSIONS = 32;
const SCHEMA_COMPATIBILITY_ENTRY_KEYS = Object.freeze([
  'id',
  'kind',
  'schema',
  'currentVersion',
  'supportedVersions',
  'acceptsUnversionedLegacy',
  'futureVersionBehavior',
  'migration',
  'writeSemantics',
  'byteBudget',
  'owner',
  'note',
] as const satisfies readonly (keyof SchemaCompatibilityEntry)[]);
const SCHEMA_COMPATIBILITY_ENTRY_KEY_SET = new Set<PropertyKey>(SCHEMA_COMPATIBILITY_ENTRY_KEYS);
const SCHEMA_COMPATIBILITY_INVENTORY_KEYS = Object.freeze([
  'schema',
  'version',
  'generatedAt',
  'entries',
  'limitations',
] as const satisfies readonly (keyof SchemaCompatibilityInventory)[]);

type SchemaCompatibilityInventory = {
  schema: typeof SCHEMA_COMPATIBILITY_INVENTORY_SCHEMA;
  version: typeof SCHEMA_COMPATIBILITY_INVENTORY_VERSION;
  generatedAt: string;
  entries: SchemaCompatibilityEntry[];
  limitations: string[];
};

const MAX_INVENTORY_LIMITATIONS = 8;
const MAX_INVENTORY_LIMITATION_LENGTH = 300;
const SCHEMA_COMPATIBILITY_PROFILES = Object.freeze({
  'whoisleuth.bulk-review': Object.freeze(['browser.bulk-review', 'export.bulk-review']),
  'whoisleuth.bulk-sessions': Object.freeze(['browser.bulk-sessions', 'export.bulk-sessions']),
  'whoisleuth.investigation-templates': Object.freeze(['browser.investigation-templates', 'export.investigation-templates']),
  'whoisleuth.relationship-observations': Object.freeze(['browser.relationship-observations', 'export.relationship-observations']),
  'whoisleuth.shortlist': Object.freeze(['browser.shortlist', 'export.shortlist']),
  'whoisleuth.watchlists': Object.freeze(['browser.watchlists', 'export.watchlists']),
} as const);

function entry(value: SchemaCompatibilityDescriptor): SchemaCompatibilityEntry {
  return mutableSchemaCompatibilityEntry(value);
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
  entry(SSLBL_SNAPSHOT_COMPATIBILITY),
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
  entry({ id: 'derived.lookup-asset-graph', kind: 'derived', schema: LOOKUP_ASSET_GRAPH_SCHEMA, currentVersion: LOOKUP_ASSET_GRAPH_VERSION, supportedVersions: [LOOKUP_ASSET_GRAPH_VERSION], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: null, owner: 'frontend/src/lib/analysis/lookup-asset-graph.ts', note: 'Bounded relationship projection embedded in investigation capsules; source attribution and incomplete evidence remain explicit.' }),
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
  entry({ id: 'export.lookup-evidence', kind: 'export', schema: LOOKUP_EVIDENCE_SCHEMA, currentVersion: LOOKUP_EVIDENCE_SCHEMA_VERSION, supportedVersions: [25, 26, 27, 28], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'read_only', writeSemantics: 'read_only', byteBudget: LOOKUP_EVIDENCE_PORTABLE_MAX_BYTES, owner: 'lib/evidence-export.mts', note: 'Version 28 removes raw registration payloads, expanded contacts, and attributed contact routes behind positive publication allowlists. Version 27 retains fixed homepage summaries; versions 25 and 26 preserve their documented source-wrapper compatibility.' }),
  ...SCHEMA_LIFECYCLE_REGISTRY.flatMap((family) => family.compatibility.map(entry)),
  entry({ id: 'export.defensive-indicators', kind: 'export', schema: null, currentVersion: DEFENSIVE_INDICATOR_EXPORT_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'frontend/src/lib/analysis/defensive-indicator-export.ts', note: 'Review-only indicator, provenance-manifest, and rollback formats; never submitted or applied automatically.' }),
  entry({ id: 'export.stix-indicators', kind: 'export', schema: null, currentVersion: STIX_INDICATOR_EXPORT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'frontend/src/lib/analysis/stix-indicator-export.ts', note: 'STIX 2.1 bundle with direct observations separated from heuristic indicators.' }),
  entry({ id: 'export.misp-indicators', kind: 'export', schema: null, currentVersion: MISP_INDICATOR_EXPORT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'frontend/src/lib/analysis/misp-indicator-export.ts', note: 'Unpublished, non-IDS, non-correlating event for reviewed import.' }),
  entry({ id: 'export.synthetic-demo', kind: 'export', schema: SYNTHETIC_DEMO_EXPORT_SCHEMA, currentVersion: SYNTHETIC_DEMO_EXPORT_VERSION, supportedVersions: [2, 3, 4, 5], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'frontend/src/lib/analysis/demo-model.ts', note: 'Explicitly synthetic fixed-fixture package, never live evidence.' }),
  entry({ id: 'cli.doctor', kind: 'cli_document', schema: DOCTOR_SCHEMA, currentVersion: DOCTOR_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/doctor.mts', note: 'Bounded runtime and optional explicitly approved network-diagnostic report; normal operation remains offline.' }),
  entry({ id: 'cli.command-catalogue', kind: 'cli_document', schema: CLI_COMMAND_CATALOGUE_SCHEMA, currentVersion: CLI_COMMAND_CATALOGUE_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/command-catalogue.mts', note: 'Installed command, usage, collection-mode, and boundary catalogue without target or evidence values.' }),
  entry({ id: 'cli.lookup-plan', kind: 'cli_document', schema: CLI_LOOKUP_PLAN_SCHEMA, currentVersion: CLI_LOOKUP_PLAN_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/lookup-plan.mts', note: 'Request-free preview of the sources and disclosures associated with an analyst-selected lookup mode.' }),
  entry({ id: 'cli.lookup-timeline', kind: 'cli_document', schema: CLI_LOOKUP_TIMELINE_SCHEMA, currentVersion: CLI_LOOKUP_TIMELINE_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_LOOKUP_TIMELINE_INPUT_BYTES, owner: 'cli/lookup-timeline.mts', note: 'Offline chronological comparison of bounded same-domain saved observations; missing fields and unavailable evidence remain explicit.' }),
  entry({ id: 'cli.mail-review', kind: 'cli_document', schema: CLI_MAIL_REVIEW_SCHEMA, currentVersion: CLI_MAIL_REVIEW_VERSION, supportedVersions: [2, 3], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_MAIL_REVIEW_INPUT_BYTES, owner: 'cli/mail-review.mts', note: 'Version 3 discloses every row, relationship, and domain coverage bound in the offline passive mail and DANE review. Version 2 remains a supported historical pre-disclosure output; neither version makes an SMTP connection.' }),
  entry({ id: 'cli.page-compare', kind: 'cli_document', schema: CLI_PAGE_COMPARE_SCHEMA, currentVersion: CLI_PAGE_COMPARE_VERSION, supportedVersions: [2, 3, 4], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_SAVED_LOOKUP_INPUT_BYTES, owner: 'cli/page-compare.mts', note: 'Offline comparison of two bounded deep-lookup page identity, technology, favicon, TLS, and response observations; version 3 withholds technology equality for partial sets and version 4 also withholds TLS issuer and public-key conclusions for partial TLS evidence.' }),
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
  entry({ id: 'cli.registry-doctor', kind: 'cli_document', schema: REGISTRY_DOCTOR_SCHEMA, currentVersion: REGISTRY_DOCTOR_VERSION, supportedVersions: [1, 2, 3], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_SAVED_LOOKUP_INPUT_BYTES, owner: 'cli/registry-doctor.mts', note: 'Version 3 propagates bounded RDAP publication-family truncation and withholds absence or consistency conclusions that omitted values could change.' }),
  entry({ id: 'cli.sharing-review', kind: 'cli_document', schema: SHARING_REVIEW_SCHEMA, currentVersion: SHARING_REVIEW_VERSION, supportedVersions: [2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_SHARING_REVIEW_BYTES, owner: 'cli/sharing-review.mts', note: 'Version 2 withholds ready status for projection-only or structure-only assurance; output remains redacted and does not grant recipient authorisation.' }),
  entry({ id: 'cli.lookalike-calibration-input', kind: 'cli_document', schema: LOOKALIKE_CALIBRATION_INPUT_SCHEMA, currentVersion: LOOKALIKE_CALIBRATION_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: MAX_LOOKALIKE_CALIBRATION_BYTES, owner: 'cli/lookalike-calibration.mts', note: 'Reviewed local candidate dispositions used only for target-free mutation-family yield diagnostics.' }),
  entry({ id: 'cli.lookalike-calibration', kind: 'cli_document', schema: LOOKALIKE_CALIBRATION_SCHEMA, currentVersion: LOOKALIKE_CALIBRATION_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/lookalike-calibration.mts', note: 'Target-free review-yield report that retains no candidate identifiers, domains, notes, or evidence values.' }),
  entry({ id: 'cli.domain-assurance-input', kind: 'cli_document', schema: DOMAIN_ASSURANCE_INPUT_SCHEMA, currentVersion: DOMAIN_ASSURANCE_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'read_only', byteBudget: MAX_ASSURANCE_INPUT_BYTES, owner: 'lib/domain-assurance.mts', note: 'Bounded analyst-authored planned-change, recovery-dependency, or retirement input; version 2 adds optional bounded custom retirement checks and performs no credentials or provider changes.' }),
  entry({ id: 'cli.domain-assurance', kind: 'cli_document', schema: DOMAIN_ASSURANCE_SCHEMA, currentVersion: DOMAIN_ASSURANCE_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/domain-assurance.mts', note: 'Offline assurance review with explicit unknown and incomplete states; version 2 can report bounded analyst-defined retirement checks and performs no collection or configuration change.' }),
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
  entry({ id: 'export.cli-case-pack', kind: 'export', schema: CLI_CASE_PACK_SCHEMA, currentVersion: CLI_CASE_PACK_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_CASE_IMPORT_BYTES, owner: 'cli/case-pack.mts', note: 'Packet versions 1 and 2 are verified within the portable Case import ceiling; future packet versions are rejected, and version 2 uses deterministic sorted-json-v2 integrity while the enclosed Case schema remains version 12.' }),
  entry({ id: 'cli.interchange-fidelity-report', kind: 'cli_document', schema: INTERCHANGE_FIDELITY_REPORT_SCHEMA, currentVersion: INTERCHANGE_FIDELITY_REPORT_VERSION, supportedVersions: [2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_INTERCHANGE_REPORT_BYTES, owner: 'cli/interchange-report.mts', note: 'Version 2 enforces the runtime registry assurance requirement before reporting fidelity; output remains metadata-only and excludes evidence values and unknown schema text.' }),
  entry({ id: 'cli.lookup-brief', kind: 'cli_document', schema: CLI_LOOKUP_BRIEF_SCHEMA, currentVersion: CLI_LOOKUP_BRIEF_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_SAVED_LOOKUP_INPUT_BYTES, owner: 'cli/lookup-brief.mts', note: 'Offline source-aware handoff; version 2 adds structured actions with expected outcomes.' }),
  entry({ id: 'cli.registry-cohort', kind: 'cli_document', schema: REGISTRY_COHORT_SCHEMA, currentVersion: REGISTRY_COHORT_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'normalize_to_current', writeSemantics: 'read_only', byteBudget: MAX_REGISTRY_COHORT_INPUT_BYTES, owner: 'cli/registry-cohort.mts', note: 'Version 2 adds bounded target-free timelines and can merge one unmixed family of retained version-1 or version-2 cohort reports without treating overlapping samples as independent.' }),
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
  entry({ id: 'cli.compare', kind: 'cli_document', schema: CLI_COMPARE_SCHEMA, currentVersion: CLI_COMPARE_SCHEMA_VERSION, supportedVersions: [3], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_SAVED_LOOKUP_INPUT_BYTES, owner: 'cli/formatters/json.mts', note: 'Comparison output reads supported saved Lookup versions 1 and 2 through the shared bounded parser.' }),
  entry({ id: 'cli.registry-support', kind: 'cli_document', schema: REGISTRY_SUPPORT_SCHEMA, currentVersion: REGISTRY_SUPPORT_SCHEMA_VERSION, supportedVersions: [2, 3, 4], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/registry-support.mts', note: 'Catalogue coverage report; optional official lookup links require deliberate browser navigation and do not test live reachability.' }),
  entry({ id: 'cli.registry-standards-coverage', kind: 'cli_document', schema: REGISTRY_STANDARDS_COVERAGE_SCHEMA, currentVersion: standardsCoverage.version, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/registry-support.mts', note: 'Immutable official-source coverage snapshot embedded in registry-support output.' }),
  entry({ id: 'cli.deployment-self-check', kind: 'cli_document', schema: DEPLOYMENT_SELF_CHECK_SCHEMA, currentVersion: DEPLOYMENT_SELF_CHECK_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'tools/deployment-self-check.mts', note: 'Redacted operator-run public-boundary report; response bodies and credentialed posture are excluded.' }),
  entry({ id: 'cli.maintainer-duplication-report', kind: 'cli_document', schema: MAINTAINER_DUPLICATION_REPORT_SCHEMA, currentVersion: MAINTAINER_DUPLICATION_REPORT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_MAINTAINER_DUPLICATION_REPORT_BYTES, owner: 'tools/maintainer-duplication-report.mts', note: 'Deterministic repository-relative static call graph and exact token-clone inventory for bounded maintainer modules; source text, literals, absolute paths, runtime values, and automatic consolidation are excluded.' }),
  entry({ id: 'cli.registry-drift-audit', kind: 'cli_document', schema: REGISTRY_DRIFT_AUDIT_SCHEMA, currentVersion: REGISTRY_DRIFT_AUDIT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'tools/registry-drift-audit.mts', note: 'Manual bounded comparison of two fixed official IANA catalogues; no registry query or automatic catalogue rewrite.' }),
  entry({ id: 'cli.rdap-extension-drift-audit', kind: 'cli_document', schema: RDAP_EXTENSION_DRIFT_AUDIT_SCHEMA, currentVersion: RDAP_EXTENSION_DRIFT_AUDIT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_RDAP_EXTENSION_SOURCE_BYTES, owner: 'tools/rdap-extension-drift-audit.mts', note: 'Offline fixture comparison with an optional manual fetch of one fixed official registry; never enables an extension or reverse search.' }),
  entry({ id: 'cli.specialist-workflow-benchmark', kind: 'cli_document', schema: SPECIALIST_WORKFLOW_BENCHMARK_SCHEMA, currentVersion: SPECIALIST_WORKFLOW_BENCHMARK_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'tools/specialist-workflow-benchmark.mts', note: 'Offline synthetic regression and workflow-contract benchmark; no live target, provider request, or deployment effect.' }),
  entry({ id: 'cli.service-dependency-signature-audit', kind: 'cli_document', schema: SERVICE_DEPENDENCY_SIGNATURE_AUDIT_SCHEMA, currentVersion: SERVICE_DEPENDENCY_SIGNATURE_AUDIT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'tools/service-dependency-signature-audit.mts', note: 'Offline digest, metadata, collision, and freshness audit for the passive service-dependency signature catalogue.' }),
  entry({ id: 'export.web-capture-summary', kind: 'export', schema: WEB_CAPTURE_SUMMARY_SCHEMA, currentVersion: WEB_CAPTURE_SUMMARY_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: null, owner: 'frontend/src/lib/analysis/web-capture-import.ts', note: 'Sanitised metadata-only capture summary accepted through the bounded external-finding preview.' }),
  entry({ id: 'export.web-capture-manifest', kind: 'export', schema: WEB_CAPTURE_MANIFEST_SCHEMA, currentVersion: WEB_CAPTURE_MANIFEST_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_WEB_CAPTURE_MANIFEST_BYTES, owner: 'frontend/src/lib/analysis/web-capture-import.ts', note: 'Metadata-only capture manifest; the browser accepts versions 1 and 2 while offline artefact comparison requires current version 2.' }),
  entry({ id: 'export.web-capture-dom-digest', kind: 'export', schema: WEB_CAPTURE_DOM_DIGEST_SCHEMA, currentVersion: WEB_CAPTURE_DOM_DIGEST_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: MAX_WEB_CAPTURE_DOM_DIGEST_BYTES, owner: 'packages/web-capture/capture.mts', note: 'Local structural and visible-text digests with counts and truncation only; markup and page text are excluded.' }),
  entry({ id: 'cli.web-capture-comparison', kind: 'cli_document', schema: WEB_CAPTURE_COMPARISON_SCHEMA, currentVersion: WEB_CAPTURE_COMPARISON_VERSION, supportedVersions: [2, 3], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'packages/web-capture/compare.mts', note: 'Version 2 reports page-title equality without copying either title; version 3 withholds DOM equality for equal truncated prefixes. Both exclude input paths and DOM or body text.' }),
  entry({ id: 'derived.capability-manifest', kind: 'derived', schema: CAPABILITY_MANIFEST_SCHEMA, currentVersion: CAPABILITY_MANIFEST_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: MAX_CAPABILITY_MANIFEST_BYTES, owner: 'packages/contracts/capability-manifest.mts', note: 'Read-only fixed product boundary metadata; it enables no capability, request, credential, retention, score, or authorisation.' }),
  entry({ id: 'derived.curated-connector-result', kind: 'derived', schema: CURATED_CONNECTOR_RESULT_SCHEMA, currentVersion: CURATED_CONNECTOR_CONTRACT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'none', byteBudget: null, owner: 'lib/threat-intelligence-runtime.mts', note: 'Transient bounded entity and relationship projection; the contract enables no connector, request, credential, storage, score, or availability decision.' }),
  entry({ id: 'derived.observation-envelope', kind: 'derived', schema: OBSERVATION_ENVELOPE_SCHEMA, currentVersion: OBSERVATION_ENVELOPE_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'none', byteBudget: MAX_OBSERVATION_ENVELOPE_BYTES, owner: 'frontend/src/lib/analysis/observation-envelope.ts', note: 'Disposable typed adapter over authoritative browser-local records; it performs no writes and preserves source schema, provenance, partialness, and rollback state.' }),
  entry({ id: 'derived.investigation-projection', kind: 'derived', schema: INVESTIGATION_PROJECTION_SCHEMA, currentVersion: INVESTIGATION_PROJECTION_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'none', byteBudget: null, owner: 'frontend/src/lib/analysis/investigation-projection.ts', note: 'Read-only bounded projection over existing stores; never persisted.' }),
  entry({ id: 'derived.investigation-search', kind: 'derived', schema: INVESTIGATION_SEARCH_SCHEMA, currentVersion: INVESTIGATION_SEARCH_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'none', byteBudget: null, owner: 'frontend/src/lib/analysis/investigation-search.ts', note: 'Disposable in-memory index; never persisted or transmitted.' }),
  entry({ id: 'export.reviewed-relationship-clusters', kind: 'export', schema: REVIEWED_RELATIONSHIP_CLUSTERS_SCHEMA, currentVersion: CASE_RELATIONSHIP_CLUSTER_VERSION, supportedVersions: [2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'frontend/src/lib/analysis/case-relationship-clusters.ts', note: 'Output-only bounded reviewed relationship clusters; version 2 is the only contract represented by the current producer.' }),
  entry({ id: 'export.defensive-indicator-manifest', kind: 'export', schema: DEFENSIVE_INDICATOR_MANIFEST_SCHEMA, currentVersion: DEFENSIVE_INDICATOR_EXPORT_VERSION, supportedVersions: [2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'frontend/src/lib/analysis/defensive-indicator-export.ts', note: 'Output-only manifest for explicitly selected defensive indicators; historical version 1 is not claimed without a retained reader.' }),
  entry({ id: 'export.defensive-indicator-rollback', kind: 'export', schema: DEFENSIVE_INDICATOR_ROLLBACK_SCHEMA, currentVersion: DEFENSIVE_INDICATOR_EXPORT_VERSION, supportedVersions: [2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'frontend/src/lib/analysis/defensive-indicator-export.ts', note: 'Output-only rollback companion for the same bounded defensive-indicator selection.' }),
  entry({ id: 'export.dns-change-rehearsal', kind: 'export', schema: DNS_CHANGE_REHEARSAL_EXPORT_SCHEMA, currentVersion: DNS_CHANGE_REHEARSAL_VERSION, supportedVersions: [2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'frontend/src/lib/analysis/dns-change-rehearsal.ts', note: 'Output-only DNS change rehearsal document; version 2 is the only producer contract represented by this tree.' }),
  entry({ id: 'derived.lookup-investigation-brief', kind: 'derived', schema: LOOKUP_INVESTIGATION_BRIEF_SCHEMA, currentVersion: LOOKUP_INVESTIGATION_BRIEF_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'none', byteBudget: null, owner: 'frontend/src/lib/analysis/lookup-investigation-brief.ts', note: 'Bounded decision brief derived from the current Lookup view without adding collection or persistence.' }),
  entry({ id: 'export.mail-report-review', kind: 'export', schema: MAIL_REPORT_SCHEMA, currentVersion: MAIL_REPORT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'frontend/src/lib/analysis/mail-report-workbench.ts', note: 'Output-only review derived from bounded offline aggregate-report input; the producer has field and collection limits but no separate serialised-output byte contract.' }),
  entry({ id: 'export.registration-disclosure-plan', kind: 'export', schema: REGISTRATION_DISCLOSURE_PLAN_SCHEMA, currentVersion: REGISTRATION_DISCLOSURE_PLAN_VERSION, supportedVersions: [2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'frontend/src/lib/analysis/registration-disclosure-plan.ts', note: 'Output-only bounded registration-disclosure planning document; version 2 is the only current producer contract.' }),
  entry({ id: 'export.static-page-pattern-pack', kind: 'export', schema: STATIC_PAGE_PATTERN_PACK_SCHEMA, currentVersion: STATIC_PAGE_PATTERN_PACK_VERSION, supportedVersions: [2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'non_destructive_merge', byteBudget: MAX_STATIC_PAGE_PATTERN_PACK_BYTES, owner: 'frontend/src/lib/analysis/static-page-pattern-packs.ts', note: 'Exact-current bounded page-pattern pack imported by explicit analyst action and merged without executing code or starting collection.' }),
  entry({ id: 'cli.dnssec-evidence-review', kind: 'cli_document', schema: DNSSEC_EVIDENCE_SCHEMA, currentVersion: DNSSEC_EVIDENCE_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/dnssec-evidence-validation.mts', note: 'Output-only offline relationship review of bounded analyst-supplied DS, DNSKEY, and RRSIG evidence.' }),
  entry({ id: 'cli.tlsa-evidence-review', kind: 'cli_document', schema: TLSA_EVIDENCE_SCHEMA, currentVersion: TLSA_EVIDENCE_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/tlsa-evidence.mts', note: 'Output-only offline comparison of bounded analyst-supplied TLSA and certificate material with independent DNSSEC and PKIX states.' }),
  entry({ id: 'cli.rpki-route-review', kind: 'cli_document', schema: RPKI_EVIDENCE_SCHEMA, currentVersion: RPKI_EVIDENCE_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/rpki-evidence.mts', note: 'Output-only offline route-origin review over bounded analyst-supplied authorisations.' }),
  entry({ id: 'cli.encrypted-dns-plan', kind: 'cli_document', schema: ENCRYPTED_DNS_CONTRACT_SCHEMA, currentVersion: ENCRYPTED_DNS_CONTRACT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/encrypted-dns-contract.mts', note: 'Request-free bounded adapter and disclosure plan; it does not enable an encrypted DNS provider or send a query.' }),
  entry({ id: 'cli.rdap-search-workbench', kind: 'cli_document', schema: RDAP_SEARCH_WORKBENCH_SCHEMA, currentVersion: RDAP_SEARCH_WORKBENCH_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/rdap-search-workbench.mts', note: 'One versioned output family for request-free capability help, bounded reverse-search plans, and offline response inspection.' }),
  entry({ id: 'derived.lookup-progress', kind: 'derived', schema: LOOKUP_PROGRESS_SCHEMA, currentVersion: LOOKUP_PROGRESS_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'none', byteBudget: MAX_LOOKUP_PROGRESS_STREAM_BYTES, owner: 'lib/lookup-progress.mts', note: 'Bounded incremental Lookup stream; partial fragments are presentation-only and only the validated final result is persistable.' }),
  entry({ id: 'maintainer.lookup-progress-staging-evidence', kind: 'cli_document', schema: LOOKUP_PROGRESS_STAGING_EVIDENCE_SCHEMA, currentVersion: LOOKUP_PROGRESS_STAGING_EVIDENCE_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: MAX_LOOKUP_PROGRESS_STAGING_FILE_BYTES, owner: 'lib/lookup-progress-staging-evidence.mts', note: 'Exact-current operator-supplied staging evidence with target-free bounded measurements and authenticated build identity.' }),
  entry({ id: 'maintainer.lookup-progress-staging-qualification', kind: 'cli_document', schema: LOOKUP_PROGRESS_STAGING_QUALIFICATION_SCHEMA, currentVersion: LOOKUP_PROGRESS_STAGING_QUALIFICATION_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/lookup-progress-staging-evidence.mts', note: 'Output-only target-free qualification across the fixed Express and Netlify staging evidence pair.' }),
  entry({ id: 'export.lookup-readable-report', kind: 'export', schema: LOOKUP_READABLE_REPORT_SCHEMA, currentVersion: LOOKUP_READABLE_REPORT_VERSION, supportedVersions: [2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_LOOKUP_READABLE_REPORT_BYTES, owner: 'lib/lookup-readable-report.mts', note: 'Output-only bounded human-readable Lookup report; this tree does not claim a reader for historical version 1.' }),
  entry(RDAP_NAMESERVER_SEARCH_COMPATIBILITY),
  entry({ id: 'derived.threat-intelligence-result', kind: 'derived', schema: THREAT_INTELLIGENCE_SCHEMA, currentVersion: THREAT_INTELLIGENCE_CONTRACT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'none', byteBudget: null, owner: 'lib/threat-intelligence-types.mts', note: 'Transient provider-attributed result with bounded findings; exact markers are validated before browser projection.' }),
  entry({ id: 'derived.unicode-confusable-projection', kind: 'derived', schema: CONFUSABLE_PROJECTION_SCHEMA, currentVersion: CONFUSABLE_PROJECTION_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'none', byteBudget: null, owner: 'lib/idn-confusable-policy.mts', note: 'Transient bounded Unicode confusable projection generated from a reviewed local data source without target collection.' }),
  entry({ id: 'derived.scheduled-monitor-cycle', kind: 'derived', schema: SCHEDULED_MONITOR_LOG_SCHEMA, currentVersion: SCHEDULED_MONITOR_LOG_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'none', byteBudget: null, owner: 'netlify/functions/scheduled-monitor.mts', note: 'Output-only bounded operational log record retained only according to the hosting platform log policy.' }),
];

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || value.length > 64 || /[\x00-\x1f\x7f]/u.test(value)) {
    throw new TypeError('Schema inventory timestamp must be a bounded ISO date.');
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError('Schema inventory timestamp must be a bounded ISO date.');
  return new Date(parsed).toISOString();
}

function snapshotDenseArray(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${label} must be a bounded ordinary array.`);
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  const length = lengthDescriptor && 'value' in lengthDescriptor ? lengthDescriptor.value : null;
  if (!Number.isSafeInteger(length) || length < minimum || length > maximum) {
    throw new TypeError(`${label} must contain ${minimum}-${maximum} entries.`);
  }
  const keys = Reflect.ownKeys(value);
  const expectedKeys = new Set<PropertyKey>([
    'length',
    ...Array.from({ length }, (_, index) => String(index)),
  ]);
  if (keys.length !== expectedKeys.size || keys.some((key) => !expectedKeys.has(key))) {
    throw new TypeError(`${label} must be a dense ordinary array without custom fields.`);
  }
  const copy: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError(`${label} must use ordinary enumerable data entries.`);
    }
    copy.push(descriptor.value);
  }
  return copy;
}

function snapshotExactRecord(
  value: unknown,
  keys: readonly PropertyKey[],
  label: string,
): Map<PropertyKey, unknown> {
  if (value === null || typeof value !== 'object') {
    throw new TypeError(`${label} must be an ordinary exact record.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be an ordinary exact record.`);
  }
  const actualKeys = Reflect.ownKeys(value);
  const keySet = keys === SCHEMA_COMPATIBILITY_ENTRY_KEYS
    ? SCHEMA_COMPATIBILITY_ENTRY_KEY_SET
    : new Set<PropertyKey>(keys);
  if (actualKeys.length !== keys.length || actualKeys.some((key) => !keySet.has(key))) {
    throw new TypeError(`${label} must use its exact registered fields.`);
  }
  const fields = new Map<PropertyKey, unknown>();
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError(`${label} must use ordinary enumerable data fields.`);
    }
    fields.set(key, descriptor.value);
  }
  return fields;
}

function snapshotSchemaCompatibilityEntry(value: unknown, index: number): SchemaCompatibilityEntry {
  const fields = snapshotExactRecord(
    value,
    SCHEMA_COMPATIBILITY_ENTRY_KEYS,
    `Schema compatibility entry ${index}`,
  );
  return {
    id: fields.get('id') as string,
    kind: fields.get('kind') as ContractKind,
    schema: fields.get('schema') as string | null,
    currentVersion: fields.get('currentVersion') as number,
    supportedVersions: snapshotDenseArray(
      fields.get('supportedVersions'),
      `Schema compatibility entry ${index} supported versions`,
      1,
      MAX_SCHEMA_COMPATIBILITY_VERSIONS,
    ) as number[],
    acceptsUnversionedLegacy: fields.get('acceptsUnversionedLegacy') as boolean,
    futureVersionBehavior: fields.get('futureVersionBehavior') as FutureVersionBehavior,
    migration: fields.get('migration') as MigrationBehavior,
    writeSemantics: fields.get('writeSemantics') as WriteSemantics,
    byteBudget: fields.get('byteBudget') as number | null,
    owner: fields.get('owner') as string,
    note: fields.get('note') as string,
  };
}

function snapshotSchemaCompatibilityEntries(values: unknown): SchemaCompatibilityEntry[] {
  return snapshotDenseArray(
    values,
    'Schema compatibility inventory',
    1,
    MAX_SCHEMA_COMPATIBILITY_ENTRIES,
  ).map(snapshotSchemaCompatibilityEntry);
}

function reconcileSchemaLifecycleRegistryCompatibility(
  values: readonly SchemaCompatibilityEntry[],
): void {
  const entriesById = new Map<string, SchemaCompatibilityEntry[]>();
  for (const value of values) {
    const matches = entriesById.get(value.id) ?? [];
    matches.push(value);
    entriesById.set(value.id, matches);
  }
  for (const family of SCHEMA_LIFECYCLE_REGISTRY) {
    for (const descriptor of family.compatibility) {
      const matches = entriesById.get(descriptor.id) ?? [];
      const actual = matches[0];
      if (matches.length !== 1
        || !actual
        || actual.kind !== descriptor.kind
        || actual.schema !== descriptor.schema
        || actual.currentVersion !== descriptor.currentVersion
        || actual.supportedVersions.length !== descriptor.supportedVersions.length
        || actual.supportedVersions.some((version, versionIndex) => version !== descriptor.supportedVersions[versionIndex])
        || actual.acceptsUnversionedLegacy !== descriptor.acceptsUnversionedLegacy
        || actual.futureVersionBehavior !== descriptor.futureVersionBehavior
        || actual.migration !== descriptor.migration
        || actual.writeSemantics !== descriptor.writeSemantics
        || actual.byteBudget !== descriptor.byteBudget
        || actual.owner !== descriptor.owner
        || actual.note !== descriptor.note) {
        throw new Error(`Schema lifecycle compatibility ${descriptor.id} must exactly match the generated inventory row.`);
      }
    }
  }
}

function snapshotAndValidateSchemaCompatibilityEntries(values: unknown): SchemaCompatibilityEntry[] {
  const entries = snapshotSchemaCompatibilityEntries(values);
  const ids = new Set<string>();
  for (const value of entries) {
    if (!/^[a-z0-9][a-z0-9.-]{2,79}$/u.test(value.id) || ids.has(value.id)) {
      throw new Error(`Schema compatibility entry id is invalid or duplicated: ${value.id}`);
    }
    ids.add(value.id);
    validateSchemaCompatibilityDescriptor(value);
  }
  const entriesBySchema = new Map<string, string[]>();
  for (const value of entries) {
    if (value.schema) entriesBySchema.set(value.schema, [...(entriesBySchema.get(value.schema) ?? []), value.id]);
  }
  for (const [schema, allowedIds] of Object.entries(SCHEMA_COMPATIBILITY_PROFILES)) {
    const actualIds = [...(entriesBySchema.get(schema) ?? [])].sort();
    const expectedIds = [...allowedIds].sort();
    if (actualIds.length !== expectedIds.length || actualIds.some((id, index) => id !== expectedIds[index])) {
      throw new Error(`Schema compatibility profiles for ${schema} must use the exact reviewed entry ids.`);
    }
  }
  for (const [schema, entryIds] of entriesBySchema) {
    if (entryIds.length > 1 && !Object.hasOwn(SCHEMA_COMPATIBILITY_PROFILES, schema)) {
      throw new Error(`Schema compatibility identifier has undeclared profiles: ${schema}.`);
    }
  }
  reconcileSchemaLifecycleRegistryCompatibility(entries);
  return entries;
}

function validateSchemaCompatibilityEntries(values: readonly SchemaCompatibilityEntry[]): void {
  snapshotAndValidateSchemaCompatibilityEntries(values);
}

function validateSchemaLifecycleRegistryCompatibility(
  values: readonly SchemaCompatibilityEntry[],
): void {
  const entries = snapshotSchemaCompatibilityEntries(values);
  for (const value of entries) validateSchemaCompatibilityDescriptor(value);
  reconcileSchemaLifecycleRegistryCompatibility(entries);
}

function cloneEntry(value: SchemaCompatibilityEntry): SchemaCompatibilityEntry {
  return { ...value, supportedVersions: [...value.supportedVersions] };
}

export function validateInterchangeSchemaCompatibility(
  entries: readonly SchemaCompatibilityEntry[],
  contracts = INTERCHANGE_ARTIFACT_CONTRACTS,
): void {
  const snapshot = snapshotSchemaCompatibilityEntries(entries);
  for (const value of snapshot) validateSchemaCompatibilityDescriptor(value);
  for (const contract of contracts) {
    if (contract.compatibilityEntryId === null) {
      if (contract.id !== 'legacy_desired_baseline') {
        throw new Error(`Interchange contract ${contract.id} must name a schema compatibility entry.`);
      }
      continue;
    }
    const declared = snapshot.find((item) => item.id === contract.compatibilityEntryId);
    if (
      !declared
      || declared.schema !== contract.schema
      || declared.futureVersionBehavior !== contract.futureVersionBehaviour
      || contract.versions.length !== declared.supportedVersions.length
      || contract.versions.some((version, index) => version !== declared.supportedVersions[index])
    ) {
      throw new Error(`Interchange contract ${contract.id} must exactly match the schema compatibility inventory versions and future-version behaviour.`);
    }
  }
}

function buildSchemaCompatibilityInventory(
  options: { generatedAt?: string } = {},
): SchemaCompatibilityInventory {
  const entries = snapshotAndValidateSchemaCompatibilityEntries(ENTRIES);
  validateInterchangeSchemaCompatibility(entries);
  return {
    schema: SCHEMA_COMPATIBILITY_INVENTORY_SCHEMA,
    version: SCHEMA_COMPATIBILITY_INVENTORY_VERSION,
    generatedAt: timestamp(options.generatedAt || new Date().toISOString()),
    entries: entries.map(cloneEntry),
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
  const source = snapshotExactRecord(
    inventory,
    SCHEMA_COMPATIBILITY_INVENTORY_KEYS,
    'Schema compatibility inventory',
  );
  if (source.get('schema') !== SCHEMA_COMPATIBILITY_INVENTORY_SCHEMA
    || source.get('version') !== SCHEMA_COMPATIBILITY_INVENTORY_VERSION) {
    throw new TypeError('Schema compatibility report requires the current inventory contract.');
  }
  const generatedAt = timestamp(source.get('generatedAt'));
  const limitations = snapshotDenseArray(
    source.get('limitations'),
    'Schema compatibility report limitations',
    0,
    MAX_INVENTORY_LIMITATIONS,
  );
  for (const value of limitations) {
    if (typeof value !== 'string'
      || !value
      || value.length > MAX_INVENTORY_LIMITATION_LENGTH
      || /[\x00-\x1f\x7f]/u.test(value)) {
      throw new TypeError('Schema compatibility report limitations are invalid.');
    }
  }
  const entries = snapshotAndValidateSchemaCompatibilityEntries(source.get('entries'));
  const lines = [
    '# WHOISleuth schema compatibility inventory',
    '',
    `Contract: \`${markdownCell(source.get('schema'))}\` v${source.get('version')}`,
    `Generated: ${markdownCell(generatedAt)}`,
    '',
    '| Contract | Kind | Schema | Current | Supported | Future version | Migration | Write semantics | Serialised bound | Owner |',
    '| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |',
  ];
  for (const value of entries) {
    const supported = `${value.supportedVersions.join(', ')}${value.acceptsUnversionedLegacy ? ' plus unversioned legacy' : ''}`;
    lines.push(`| ${markdownCell(value.id)} | ${markdownCell(value.kind)} | ${value.schema ? `\`${markdownCell(value.schema)}\`` : 'No schema string'} | ${value.currentVersion} | ${markdownCell(supported)} | ${markdownCell(value.futureVersionBehavior)} | ${markdownCell(value.migration)} | ${markdownCell(value.writeSemantics)} | ${markdownCell(formatByteBudget(value.byteBudget))} | \`${markdownCell(value.owner)}\` |`);
  }
  lines.push('', '## Contract notes', '');
  for (const value of entries) lines.push(`- **${markdownCell(value.id)}:** ${markdownCell(value.note)}`);
  lines.push('', '## Limitations', '');
  for (const limitation of limitations) lines.push(`- ${markdownCell(limitation)}`);
  return `${lines.join('\n')}\n`;
}

export {
  buildSchemaCompatibilityInventory,
  formatSchemaCompatibilityInventory,
  validateSchemaCompatibilityEntries,
  validateSchemaLifecycleRegistryCompatibility,
};
export type {
  ContractKind,
  FutureVersionBehavior,
  MigrationBehavior,
  WriteSemantics,
  SchemaCompatibilityEntry,
  SchemaCompatibilityInventory,
};
