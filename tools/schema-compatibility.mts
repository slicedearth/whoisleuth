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
  SAVED_LOOKUP_SCHEMA,
  SAVED_LOOKUP_SCHEMA_VERSION,
} from '../cli/saved-lookup.mts';
import {
  CLI_INVESTIGATION_PLAN_SCHEMA,
  CLI_INVESTIGATION_PLAN_VERSION,
} from '../cli/investigation-plan.mts';
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
  BRAND_PROFILE_SCHEMA,
  BRAND_PROFILE_SCHEMA_VERSION,
  MAX_PROFILE_STORE_BYTES,
} from '../frontend/src/lib/analysis/brand-profile-model.ts';
import {
  BULK_SESSION_SCHEMA,
  BULK_SESSION_SCHEMA_VERSION,
  MAX_BULK_SESSION_STORE_BYTES,
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
  CASE_REPORT_SCHEMA,
  CASE_REPORT_SCHEMA_VERSION,
} from '../frontend/src/lib/analysis/case-report.ts';
import {
  CASE_RESPONSE_PACKET_SCHEMA,
  CASE_RESPONSE_PACKET_VERSION,
} from '../frontend/src/lib/analysis/case-response-packet.ts';
import {
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
} from '../frontend/src/lib/candidate-handoff-core.ts';
import {
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

export const SCHEMA_COMPATIBILITY_INVENTORY_SCHEMA = 'whoisleuth.schema-compatibility-inventory';
export const SCHEMA_COMPATIBILITY_INVENTORY_VERSION = 1;
export const MAX_SCHEMA_COMPATIBILITY_ENTRIES = 100;

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
  entry({ id: 'browser.cases', kind: 'browser_store', schema: null, currentVersion: CASE_SCHEMA_VERSION, supportedVersions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], acceptsUnversionedLegacy: true, futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current', writeSemantics: 'normalized_rewrite', byteBudget: MAX_CASE_STORE_BYTES, owner: 'frontend/src/lib/analysis/case-model.ts', note: 'Known fields can be read from newer local envelopes, but wrappers block overwrite and downgraded export.' }),
  entry({ id: 'browser.brand-profiles', kind: 'browser_store', schema: null, currentVersion: BRAND_PROFILE_SCHEMA_VERSION, supportedVersions: [1, 2, 3, 4, 5], acceptsUnversionedLegacy: true, futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current', writeSemantics: 'normalized_rewrite', byteBudget: MAX_PROFILE_STORE_BYTES, owner: 'frontend/src/lib/analysis/brand-profile-model.ts', note: 'Version 1 bare arrays and supported profiles normalise to the current bounded store; the schema string belongs to portable exports.' }),
  entry({ id: 'browser.campaigns', kind: 'browser_store', schema: null, currentVersion: CAMPAIGN_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: true, futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current', writeSemantics: 'normalized_rewrite', byteBudget: MAX_CAMPAIGN_STORE_BYTES, owner: 'frontend/src/lib/analysis/campaign-model.ts', note: 'Bare arrays remain recoverable; explicit future versions are not overwritten; the schema string belongs to portable exports.' }),
  entry({ id: 'browser.watchlists', kind: 'browser_store', schema: WATCHLIST_SCHEMA, currentVersion: WATCHLIST_SCHEMA_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: true, futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current', writeSemantics: 'normalized_rewrite', byteBudget: MAX_WATCHLIST_STORE_BYTES, owner: 'frontend/src/lib/analysis/watchlist-store.ts', note: 'Legacy map-shaped stores normalise to the current envelope.' }),
  entry({ id: 'browser.shortlist', kind: 'browser_store', schema: SHORTLIST_SCHEMA, currentVersion: SHORTLIST_SCHEMA_VERSION, supportedVersions: [1, 2, 3], acceptsUnversionedLegacy: true, futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current', writeSemantics: 'normalized_rewrite', byteBudget: MAX_SHORTLIST_STORE_BYTES, owner: 'frontend/src/lib/analysis/shortlist-model.ts', note: 'Legacy arrays normalise to the current compact envelope.' }),
  entry({ id: 'browser.ct-history', kind: 'browser_store', schema: null, currentVersion: CT_HISTORY_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current', writeSemantics: 'normalized_rewrite', byteBudget: MAX_CT_HISTORY_STORE_BYTES, owner: 'frontend/src/lib/analysis/ct-history.ts', note: 'Malformed values degrade to an empty bounded history; future stores are not overwritten.' }),
  entry({ id: 'browser.detection-rules', kind: 'browser_store', schema: null, currentVersion: DETECTION_RULE_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: true, futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current', writeSemantics: 'normalized_rewrite', byteBudget: MAX_RULE_STORE_BYTES, owner: 'frontend/src/lib/analysis/detection-rule-model.ts', note: 'Only allowlisted structured rule fields and operators survive normalisation; the schema string belongs to portable exports.' }),
  entry({ id: 'browser.relationship-observations', kind: 'browser_store', schema: RELATIONSHIP_OBSERVATION_SCHEMA, currentVersion: RELATIONSHIP_OBSERVATION_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: true, futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current', writeSemantics: 'normalized_rewrite', byteBudget: MAX_RELATIONSHIP_OBSERVATION_STORE_BYTES, owner: 'frontend/src/lib/analysis/relationship-observation-model.ts', note: 'Only explicit analyst selections from bounded Bulk relationship evidence are retained; identities are re-derived from normalised values and members.' }),
  entry({ id: 'browser.website-snapshots', kind: 'browser_store', schema: WEBSITE_SNAPSHOT_SCHEMA, currentVersion: WEBSITE_SNAPSHOT_SCHEMA_VERSION, supportedVersions: [1, 2, 3, 4], acceptsUnversionedLegacy: true, futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current', writeSemantics: 'normalized_rewrite', byteBudget: MAX_WEBSITE_SNAPSHOT_STORE_BYTES, owner: 'frontend/src/lib/analysis/website-snapshot-model.ts', note: 'Only explicit analyst-selected compact website profiles and optional normalised leaf-certificate observations are retained; version 4 adds a bounded reviewed security-posture baseline, while raw lookup payloads, contact data, certificate bytes, and fetched bodies remain excluded.' }),
  entry({ id: 'browser.bulk-sessions', kind: 'browser_store', schema: BULK_SESSION_SCHEMA, currentVersion: BULK_SESSION_SCHEMA_VERSION, supportedVersions: [1, 2, 3], acceptsUnversionedLegacy: false, futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current', writeSemantics: 'normalized_rewrite', byteBudget: MAX_BULK_SESSION_STORE_BYTES, owner: 'frontend/src/lib/analysis/bulk-session-model.ts', note: 'Schema 3 adds score-model identity and bounded assessment context; earlier schemas remain readable without inventing newer evidence. Raw source payloads and contact records are excluded.' }),
  entry({ id: 'browser.investigation-templates', kind: 'browser_store', schema: INVESTIGATION_TEMPLATE_SCHEMA, currentVersion: INVESTIGATION_TEMPLATE_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: true, futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current', writeSemantics: 'normalized_rewrite', byteBudget: MAX_INVESTIGATION_TEMPLATE_STORE_BYTES, owner: 'frontend/src/lib/analysis/investigation-template-model.ts', note: 'Analyst-authored guidance is bound to allowlisted built-in stages; templates cannot run code, start collection, submit evidence, or remove mandatory request gates.' }),
  entry({ id: 'browser.bulk-review', kind: 'browser_store', schema: BULK_REVIEW_SCHEMA, currentVersion: BULK_REVIEW_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: true, futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current', writeSemantics: 'normalized_rewrite', byteBudget: MAX_BULK_REVIEW_STORE_BYTES, owner: 'frontend/src/lib/analysis/bulk-review-model.ts', note: 'Bounded saved Bulk filter views and per-domain review states only; scan results, contacts, notes, and case disposition remain separate.' }),
  entry({ id: 'tab.candidate-handoff', kind: 'tab_store', schema: null, currentVersion: HANDOFF_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'discard', migration: 'exact_current_only', writeSemantics: 'ephemeral_replace', byteBudget: null, owner: 'frontend/src/lib/candidate-handoff-core.ts', note: 'Bounded session handoff; unsupported envelopes are ignored.' }),
  entry({ id: 'tab.investigation-guide', kind: 'tab_store', schema: null, currentVersion: INVESTIGATION_GUIDE_VERSION, supportedVersions: [1, 2, 3, 4], acceptsUnversionedLegacy: false, futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current', writeSemantics: 'ephemeral_replace', byteBudget: MAX_INVESTIGATION_GUIDE_SERIALIZED_BYTES, owner: 'frontend/src/lib/analysis/investigation-guide.ts', note: 'Versions 1 through 3 normalise into the bounded version 4 recipe state without inventing a custom template or stage-review decision; future records remain untouched.' }),
  entry({ id: 'tab.synthetic-demo', kind: 'tab_store', schema: null, currentVersion: SYNTHETIC_DEMO_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'discard', migration: 'exact_current_only', writeSemantics: 'ephemeral_replace', byteBudget: null, owner: 'frontend/src/lib/analysis/demo-model.ts', note: 'Fixed synthetic fixtures remain separate from investigation stores.' }),
  entry({ id: 'hosted.scheduled-monitor', kind: 'hosted_store', schema: SCHEDULED_MONITOR_SCHEMA, currentVersion: SCHEDULED_MONITOR_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'optimistic_replace', byteBudget: MAX_SCHEDULED_MONITOR_STORE_BYTES, owner: 'frontend/src/lib/analysis/scheduled-monitor-model.ts', note: 'Compact authority-aware evidence only; raw responses and expanded contacts are excluded.' }),
  entry({ id: 'hosted.scheduled-monitor-envelope', kind: 'hosted_store', schema: ENVELOPE_SCHEMA, currentVersion: ENVELOPE_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'optimistic_replace', byteBudget: MAX_ENVELOPE_BYTES, owner: 'lib/scheduled-monitor-crypto.mts', note: 'Authenticated encrypted envelope; version and namespace are part of authenticated context.' }),
  entry({ id: 'hosted.scheduled-monitor-delivery', kind: 'hosted_store', schema: SCHEDULED_MONITOR_DELIVERY_SCHEMA, currentVersion: SCHEDULED_MONITOR_DELIVERY_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'ephemeral_replace', byteBudget: null, owner: 'frontend/src/lib/analysis/scheduled-monitor-dispatcher.ts', note: 'Opaque bounded queue message with an allowlisted key set.' }),
  entry({ id: 'export.cases', kind: 'export', schema: null, currentVersion: CASE_SCHEMA_VERSION, supportedVersions: [3, 4, 5, 6, 7, 8, 9, 10], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'non_destructive_merge', byteBudget: MAX_CASE_IMPORT_BYTES, owner: 'frontend/src/lib/analysis/case-model.ts', note: 'Non-destructive merge accepts supported case schemas and rejects older or future versions; version 10 adds score-model identity and reviewed reason context.' }),
  entry({ id: 'export.brand-profiles', kind: 'export', schema: BRAND_PROFILE_SCHEMA, currentVersion: BRAND_PROFILE_SCHEMA_VERSION, supportedVersions: [2, 3, 4, 5], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'non_destructive_merge', byteBudget: null, owner: 'frontend/src/lib/analysis/brand-profile-model.ts', note: 'Supported exports merge non-destructively by bounded normalised profile identity.' }),
  entry({ id: 'export.campaigns', kind: 'export', schema: CAMPAIGN_SCHEMA, currentVersion: CAMPAIGN_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: true, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'non_destructive_merge', byteBudget: MAX_CAMPAIGN_IMPORT_BYTES, owner: 'frontend/src/lib/analysis/campaign-model.ts', note: 'Non-destructive merge; unversioned legacy campaign arrays remain accepted.' }),
  entry({ id: 'export.watchlists', kind: 'export', schema: WATCHLIST_SCHEMA, currentVersion: WATCHLIST_SCHEMA_VERSION, supportedVersions: [2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'non_destructive_merge', byteBudget: null, owner: 'frontend/src/lib/analysis/watchlist-store.ts', note: 'Non-destructive collection merge with current schema required.' }),
  entry({ id: 'export.shortlist', kind: 'export', schema: SHORTLIST_SCHEMA, currentVersion: SHORTLIST_SCHEMA_VERSION, supportedVersions: [2, 3], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'non_destructive_merge', byteBudget: null, owner: 'frontend/src/lib/analysis/shortlist-model.ts', note: 'Non-destructive domain merge retains schema 2 records while schema 3 adds Opportunity model identity.' }),
  entry({ id: 'export.detection-rules', kind: 'export', schema: DETECTION_RULE_SCHEMA, currentVersion: DETECTION_RULE_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: true, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'non_destructive_merge', byteBudget: MAX_RULE_IMPORT_BYTES, owner: 'frontend/src/lib/analysis/detection-rule-model.ts', note: 'Non-destructive rule merge; imported conditions remain allowlisted and non-executable.' }),
  entry({ id: 'export.case-report', kind: 'export', schema: CASE_REPORT_SCHEMA, currentVersion: CASE_REPORT_SCHEMA_VERSION, supportedVersions: [1, 2, 3, 4, 5, 6], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'frontend/src/lib/analysis/case-report.ts', note: 'Local report output; version 6 adds conservative analyst-derived interoperability tags and remains a non-import persistence contract.' }),
  entry({ id: 'export.case-response-packet', kind: 'export', schema: CASE_RESPONSE_PACKET_SCHEMA, currentVersion: CASE_RESPONSE_PACKET_VERSION, supportedVersions: [1, 2, 3, 4, 5], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'frontend/src/lib/analysis/case-response-packet.ts', note: 'Local reviewed response packet and draft with a bounded preflight summary; no submission or provider side effect.' }),
  entry({ id: 'export.external-findings', kind: 'export', schema: EXTERNAL_FINDINGS_SCHEMA, currentVersion: EXTERNAL_FINDINGS_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'non_destructive_merge', byteBudget: MAX_EXTERNAL_FINDINGS_IMPORT_BYTES, owner: 'frontend/src/lib/analysis/external-findings-import.ts', note: 'Strict local findings import. Version 2 distinguishes deployment observations from provider reports; analyst assertions remain a separate case workflow.' }),
  entry({ id: 'export.investigation-recipe-summary', kind: 'export', schema: INVESTIGATION_GUIDE_EXPORT_SCHEMA, currentVersion: INVESTIGATION_GUIDE_EXPORT_VERSION, supportedVersions: [1, 2, 3], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_INVESTIGATION_GUIDE_EXPORT_BYTES, owner: 'frontend/src/lib/analysis/investigation-guide.ts', note: 'Compact analyst workflow metadata, including an optional template identifier, label, and bounded stage-review reasons; raw evidence, notes, credentials, provider responses, and scan results are excluded.' }),
  entry({ id: 'export.investigation-templates', kind: 'export', schema: INVESTIGATION_TEMPLATE_SCHEMA, currentVersion: INVESTIGATION_TEMPLATE_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'non_destructive_merge', byteBudget: MAX_INVESTIGATION_TEMPLATE_IMPORT_BYTES, owner: 'frontend/src/lib/analysis/investigation-template-model.ts', note: 'Portable bounded analyst-authored guide definitions with allowlisted stage identities and request gates.' }),
  entry({ id: 'export.investigation-cacao-profile', kind: 'export', schema: INVESTIGATION_CACAO_SPEC_VERSION, currentVersion: INVESTIGATION_CACAO_PROFILE_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'non_destructive_merge', byteBudget: MAX_INVESTIGATION_CACAO_IMPORT_BYTES, owner: 'frontend/src/lib/analysis/investigation-playbook-interchange.ts', note: 'Restricted CACAO 2.0 profile with a connected linear sequence of manual analyst steps; executable commands, branches, targets, credentials, and arbitrary operations are rejected.' }),
  entry({ id: 'export.relationship-graph', kind: 'export', schema: RELATIONSHIP_GRAPH_EXPORT_SCHEMA, currentVersion: RELATIONSHIP_GRAPH_EXPORT_VERSION, supportedVersions: [1, 2, 3], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_RELATIONSHIP_GRAPH_EXPORT_BYTES, owner: 'frontend/src/lib/analysis/case-relationship-graph-export.ts', note: 'One canonical bounded relationship document serialised as WHOISleuth JSON, GraphML, or GEXF; version 3 adds browser-local commonality context while transient graph view state remains excluded.' }),
  entry({ id: 'export.relationship-observations', kind: 'export', schema: RELATIONSHIP_OBSERVATION_SCHEMA, currentVersion: RELATIONSHIP_OBSERVATION_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'non_destructive_merge', byteBudget: MAX_RELATIONSHIP_OBSERVATION_STORE_BYTES, owner: 'frontend/src/lib/analysis/relationship-observation-model.ts', note: 'Workspace-archive section for bounded analyst-selected derived pivots; raw scan and lookup responses are excluded.' }),
  entry({ id: 'export.bulk-sessions', kind: 'export', schema: BULK_SESSION_SCHEMA, currentVersion: BULK_SESSION_SCHEMA_VERSION, supportedVersions: [1, 2, 3], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'non_destructive_merge', byteBudget: MAX_BULK_SESSION_STORE_BYTES, owner: 'frontend/src/lib/analysis/bulk-session-model.ts', note: 'Portable compact Bulk sessions with explicit source-state and comparison limitations; earlier schemas merge without inventing newer comparison or score-model fields.' }),
  entry({ id: 'export.bulk-review', kind: 'export', schema: BULK_REVIEW_SCHEMA, currentVersion: BULK_REVIEW_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'non_destructive_merge', byteBudget: MAX_BULK_REVIEW_STORE_BYTES, owner: 'frontend/src/lib/analysis/bulk-review-model.ts', note: 'Workspace-archive section for saved Bulk views and explicit review states; network collection and case disposition are never changed by import.' }),
  entry({ id: 'export.workspace-archive', kind: 'export', schema: WORKSPACE_ARCHIVE_SCHEMA, currentVersion: WORKSPACE_ARCHIVE_VERSION, supportedVersions: [1, 2, 3, 4, 5], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'non_destructive_merge', byteBudget: MAX_WORKSPACE_ARCHIVE_BYTES, owner: 'frontend/src/lib/analysis/workspace-archive.ts', note: 'Manifested local archive with per-section checksums, preview-first import, rollback on browser-store write failure, and backward compatibility with archive versions 1 through 4.' }),
  entry({ id: 'export.encrypted-workspace-archive', kind: 'export', schema: ENCRYPTED_WORKSPACE_ARCHIVE_SCHEMA, currentVersion: ENCRYPTED_WORKSPACE_ARCHIVE_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'non_destructive_merge', byteBudget: MAX_ENCRYPTED_WORKSPACE_ARCHIVE_BYTES, owner: 'frontend/src/lib/analysis/workspace-archive-crypto.ts', note: 'Browser-local PBKDF2 and AES-GCM wrapper around the ordinary checksummed archive; passphrases are never persisted or recoverable.' }),
  entry({ id: 'export.workspace-settings-section', kind: 'export', schema: WORKSPACE_SETTINGS_SCHEMA, currentVersion: WORKSPACE_SETTINGS_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'non_destructive_merge', byteBudget: null, owner: 'frontend/src/lib/analysis/workspace-archive.ts', note: 'Nested archive section limited to the active Brand Profile identifier and dark, light, or system theme preference.' }),
  entry({ id: 'export.lookup-evidence', kind: 'export', schema: LOOKUP_EVIDENCE_SCHEMA, currentVersion: LOOKUP_EVIDENCE_SCHEMA_VERSION, supportedVersions: [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/evidence-export.mts', note: 'Full-fidelity normalised lookup package; distinct from compact browser evidence.' }),
  entry({ id: 'export.domain-control-manifest', kind: 'export', schema: DOMAIN_CONTROL_MANIFEST_SCHEMA, currentVersion: DOMAIN_CONTROL_MANIFEST_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/domain-control-manifest.mts', note: 'Integrity-protected analyst-authored desired state. Empty fields remain unconfigured and are not absence requirements.' }),
  entry({ id: 'export.defensive-indicators', kind: 'export', schema: null, currentVersion: DEFENSIVE_INDICATOR_EXPORT_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'frontend/src/lib/analysis/defensive-indicator-export.ts', note: 'Review-only indicator, provenance-manifest, and rollback formats; never submitted or applied automatically.' }),
  entry({ id: 'export.stix-indicators', kind: 'export', schema: null, currentVersion: STIX_INDICATOR_EXPORT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'frontend/src/lib/analysis/stix-indicator-export.ts', note: 'STIX 2.1 bundle with direct observations separated from heuristic indicators.' }),
  entry({ id: 'export.misp-indicators', kind: 'export', schema: null, currentVersion: MISP_INDICATOR_EXPORT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'frontend/src/lib/analysis/misp-indicator-export.ts', note: 'Unpublished, non-IDS, non-correlating event for reviewed import.' }),
  entry({ id: 'export.synthetic-demo', kind: 'export', schema: SYNTHETIC_DEMO_EXPORT_SCHEMA, currentVersion: SYNTHETIC_DEMO_EXPORT_VERSION, supportedVersions: [2, 3, 4, 5], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'frontend/src/lib/analysis/demo-model.ts', note: 'Explicitly synthetic fixed-fixture package, never live evidence.' }),
  entry({ id: 'cli.lookup', kind: 'cli_document', schema: CLI_LOOKUP_SCHEMA, currentVersion: CLI_LOOKUP_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: MAX_SAVED_LOOKUP_INPUT_BYTES, owner: 'cli/formatters/json.mts', note: 'Saved domain lookups are parsed for compare and evidence export only at the exact current version.' }),
  entry({ id: 'cli.bulk', kind: 'cli_document', schema: CLI_BULK_SCHEMA, currentVersion: CLI_BULK_SCHEMA_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/formatters/json.mts', note: 'Bounded bulk result document; version 2 adds compact DNS and passive mail summaries while version 1 remains identifiable as an earlier emitted contract.' }),
  entry({ id: 'cli.bulk-item', kind: 'cli_document', schema: CLI_BULK_ITEM_SCHEMA, currentVersion: CLI_BULK_SCHEMA_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/formatters/json.mts', note: 'One bounded bulk JSONL or document item; version 2 adds compact DNS and passive mail summaries while version 1 remains identifiable as an earlier emitted contract.' }),
  entry({ id: 'cli.bulk-checkpoint', kind: 'cli_document', schema: CLI_BULK_CHECKPOINT_SCHEMA, currentVersion: CLI_BULK_CHECKPOINT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'normalized_rewrite', byteBudget: MAX_BULK_CHECKPOINT_BYTES, owner: 'cli/bulk-checkpoint.mts', note: 'Private local compact Bulk checkpoint tied to the exact ordered input digest and scan mode.' }),
  entry({ id: 'cli.progress-event', kind: 'cli_document', schema: CLI_PROGRESS_EVENT_SCHEMA, currentVersion: CLI_PROGRESS_EVENT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/progress-events.mts', note: 'Target-free JSONL lifecycle event emitted on standard error only when explicitly requested.' }),
  entry({ id: 'cli.lookup-diff', kind: 'cli_document', schema: CLI_LOOKUP_DIFF_SCHEMA, currentVersion: CLI_LOOKUP_DIFF_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_SAVED_LOOKUP_INPUT_BYTES, owner: 'cli/lookup-diff.mts', note: 'Offline comparison of two exact-current bounded saved Lookup documents.' }),
  entry({ id: 'cli.lookup-reconciliation', kind: 'cli_document', schema: CLI_LOOKUP_RECONCILIATION_SCHEMA, currentVersion: CLI_LOOKUP_RECONCILIATION_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_LOOKUP_RECONCILIATION_INPUT_BYTES, owner: 'cli/lookup-reconcile.mts', note: 'Offline reconciliation of two to five same-domain saved observations; labels remain analyst context rather than proof of independent collection.' }),
  entry({ id: 'cli.registry-doctor', kind: 'cli_document', schema: REGISTRY_DOCTOR_SCHEMA, currentVersion: REGISTRY_DOCTOR_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_SAVED_LOOKUP_INPUT_BYTES, owner: 'cli/registry-doctor.mts', note: 'Offline compatibility diagnostic comparing saved collection states with the reviewed local registry capability profile.' }),
  entry({ id: 'cli.sharing-review', kind: 'cli_document', schema: SHARING_REVIEW_SCHEMA, currentVersion: SHARING_REVIEW_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_SHARING_REVIEW_BYTES, owner: 'cli/sharing-review.mts', note: 'Redacted offline pre-sharing lint; it emits only bounded schema/version metadata, no content values, and no raw evidence, and does not grant recipient authorisation.' }),
  entry({ id: 'cli.lookalike-calibration-input', kind: 'cli_document', schema: LOOKALIKE_CALIBRATION_INPUT_SCHEMA, currentVersion: LOOKALIKE_CALIBRATION_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: MAX_LOOKALIKE_CALIBRATION_BYTES, owner: 'cli/lookalike-calibration.mts', note: 'Reviewed local candidate dispositions used only for target-free mutation-family yield diagnostics.' }),
  entry({ id: 'cli.lookalike-calibration', kind: 'cli_document', schema: LOOKALIKE_CALIBRATION_SCHEMA, currentVersion: LOOKALIKE_CALIBRATION_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/lookalike-calibration.mts', note: 'Target-free review-yield report that retains no candidate identifiers, domains, notes, or evidence values.' }),
  entry({ id: 'cli.domain-assurance-input', kind: 'cli_document', schema: DOMAIN_ASSURANCE_INPUT_SCHEMA, currentVersion: DOMAIN_ASSURANCE_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'read_only', byteBudget: MAX_ASSURANCE_INPUT_BYTES, owner: 'lib/domain-assurance.mts', note: 'Bounded analyst-authored planned-change, recovery-dependency, or retirement input; version 2 adds optional bounded custom retirement checks and performs no credentials or provider changes.' }),
  entry({ id: 'cli.domain-assurance', kind: 'cli_document', schema: DOMAIN_ASSURANCE_SCHEMA, currentVersion: DOMAIN_ASSURANCE_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/domain-assurance.mts', note: 'Offline assurance review with explicit unknown and incomplete states; version 2 can report bounded analyst-defined retirement checks and performs no collection or configuration change.' }),
  entry({ id: 'cli.domain-control-review', kind: 'cli_document', schema: DOMAIN_CONTROL_REVIEW_SCHEMA, currentVersion: DOMAIN_CONTROL_REVIEW_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/domain-control-manifest.mts', note: 'Offline desired-state comparison. Only complete separately attributed observations can produce drift.' }),
  entry({ id: 'cli.zone-intent-input', kind: 'cli_document', schema: ZONE_INTENT_INPUT_SCHEMA, currentVersion: ZONE_INTENT_REVIEW_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: MAX_ZONE_TEXT_BYTES, owner: 'lib/zone-intent-review.mts', note: 'Bounded BIND-subset or normalized-record intent input. Unsupported syntax is rejected and TXT values are reduced to digests.' }),
  entry({ id: 'cli.zone-intent-review', kind: 'cli_document', schema: ZONE_INTENT_REVIEW_SCHEMA, currentVersion: ZONE_INTENT_REVIEW_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/zone-intent-review.mts', note: 'Offline desired-versus-observed DNS comparison with explicit partial and unsupported states; never applies a DNS change.' }),
  entry({ id: 'cli.domain-portfolio-input', kind: 'cli_document', schema: DOMAIN_PORTFOLIO_INPUT_SCHEMA, currentVersion: DOMAIN_PORTFOLIO_REVIEW_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/domain-portfolio-review.mts', note: 'Bounded analyst-supplied portfolio assertions without credentials, contact details, or provider requests.' }),
  entry({ id: 'cli.domain-portfolio-review', kind: 'cli_document', schema: DOMAIN_PORTFOLIO_REVIEW_SCHEMA, currentVersion: DOMAIN_PORTFOLIO_REVIEW_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/domain-portfolio-review.mts', note: 'Offline concentration, renewal, and recovery-dependency review that preserves analyst-authored provenance.' }),
  entry({ id: 'cli.investigation-plan', kind: 'cli_document', schema: CLI_INVESTIGATION_PLAN_SCHEMA, currentVersion: CLI_INVESTIGATION_PLAN_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/investigation-plan.mts', note: 'Plan-only fixed recipes composed from existing bounded commands; no step, placeholder, script, file, request, case change, or submission is executed.' }),
  entry({ id: 'cli.ct-search', kind: 'cli_document', schema: CLI_CT_SEARCH_SCHEMA, currentVersion: CLI_CT_SEARCH_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/formatters/json.mts', note: 'Certificate log search output.' }),
  entry({ id: 'cli.discover', kind: 'cli_document', schema: CLI_DISCOVER_SCHEMA, currentVersion: CLI_DISCOVER_SCHEMA_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/formatters/json.mts', note: 'Candidate discovery document.' }),
  entry({ id: 'cli.discover-item', kind: 'cli_document', schema: CLI_DISCOVER_ITEM_SCHEMA, currentVersion: CLI_DISCOVER_SCHEMA_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/formatters/json.mts', note: 'One candidate discovery JSONL item.' }),
  entry({ id: 'cli.discovery-scan', kind: 'cli_document', schema: CLI_DISCOVERY_SCAN_SCHEMA, currentVersion: CLI_DISCOVERY_SCAN_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/discovery-scan.mts', note: 'Bounded supervised candidate scan output with separately attributed collection states and analyst review lanes.' }),
  entry({ id: 'cli.discovery-scan-item', kind: 'cli_document', schema: CLI_DISCOVERY_SCAN_ITEM_SCHEMA, currentVersion: CLI_DISCOVERY_SCAN_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/discovery-scan.mts', note: 'One bounded supervised candidate scan JSONL item.' }),
  entry({ id: 'cli.discovery-snapshot', kind: 'cli_document', schema: CLI_DISCOVERY_SNAPSHOT_SCHEMA, currentVersion: CLI_DISCOVERY_SNAPSHOT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'normalized_rewrite', byteBudget: MAX_DISCOVERY_SNAPSHOT_BYTES, owner: 'cli/discovery-snapshot.mts', note: 'Private local generated-candidate baseline tied to the exact normalised discovery configuration and dictionary digest.' }),
  entry({ id: 'cli.discovery-observation-snapshot', kind: 'cli_document', schema: CLI_DISCOVERY_OBSERVATION_SCHEMA, currentVersion: CLI_DISCOVERY_OBSERVATION_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'normalized_rewrite', byteBudget: MAX_DISCOVERY_OBSERVATION_BYTES, owner: 'cli/discovery-observation-snapshot.mts', note: 'Private local registration and DNS baseline; version 2 preserves component-specific observation times and migrates version 1 on the next successful write.' }),
  entry({ id: 'cli.posture', kind: 'cli_document', schema: CLI_POSTURE_SCHEMA, currentVersion: CLI_POSTURE_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/formatters/json.mts', note: 'Owned-domain posture output.' }),
  entry({ id: 'cli.http', kind: 'cli_document', schema: CLI_HTTP_SCHEMA, currentVersion: CLI_HTTP_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/formatters/json.mts', note: 'Bounded HTTP evidence output.' }),
  entry({ id: 'cli.tls', kind: 'cli_document', schema: CLI_TLS_SCHEMA, currentVersion: CLI_TLS_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/formatters/json.mts', note: 'Bounded TLS evidence output.' }),
  entry({ id: 'cli.compare', kind: 'cli_document', schema: CLI_COMPARE_SCHEMA, currentVersion: CLI_COMPARE_SCHEMA_VERSION, supportedVersions: [3], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_SAVED_LOOKUP_INPUT_BYTES, owner: 'cli/compare.mts', note: 'Comparison output reads exact-current saved lookup inputs.' }),
  entry({ id: 'cli.registry-support', kind: 'cli_document', schema: REGISTRY_SUPPORT_SCHEMA, currentVersion: REGISTRY_SUPPORT_SCHEMA_VERSION, supportedVersions: [2, 3], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/registry-support.mts', note: 'Catalogue coverage report; does not test live reachability.' }),
  entry({ id: 'cli.registry-standards-coverage', kind: 'cli_document', schema: REGISTRY_STANDARDS_COVERAGE_SCHEMA, currentVersion: standardsCoverage.version, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/registry-capabilities.mts', note: 'Immutable official-source coverage snapshot embedded in registry-support output.' }),
  entry({ id: 'cli.risk-calibration-dataset', kind: 'cli_document', schema: RISK_CALIBRATION_DATASET_SCHEMA, currentVersion: RISK_CALIBRATION_DATASET_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'read_only', byteBudget: MAX_RISK_CALIBRATION_INPUT_BYTES, owner: 'cli/risk-calibration.mts', note: 'Offline labelled fixture input; version 2 adds bounded review context without live collection.' }),
  entry({ id: 'cli.risk-calibration-report', kind: 'cli_document', schema: RISK_CALIBRATION_REPORT_SCHEMA, currentVersion: RISK_CALIBRATION_REPORT_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/risk-calibration.mts', note: 'Offline calibration output; version 2 adds confidence intervals, strata, and model replay while labels and metrics remain analyst context.' }),
  entry({ id: 'cli.deployment-self-check', kind: 'cli_document', schema: DEPLOYMENT_SELF_CHECK_SCHEMA, currentVersion: DEPLOYMENT_SELF_CHECK_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'tools/deployment-self-check.mts', note: 'Redacted operator-run public-boundary report; response bodies and credentialed posture are excluded.' }),
  entry({ id: 'cli.registry-drift-audit', kind: 'cli_document', schema: REGISTRY_DRIFT_AUDIT_SCHEMA, currentVersion: REGISTRY_DRIFT_AUDIT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'tools/registry-drift-audit.mts', note: 'Manual bounded comparison of two fixed official IANA catalogues; no registry query or automatic catalogue rewrite.' }),
  entry({ id: 'cli.rdap-extension-drift-audit', kind: 'cli_document', schema: RDAP_EXTENSION_DRIFT_AUDIT_SCHEMA, currentVersion: RDAP_EXTENSION_DRIFT_AUDIT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_RDAP_EXTENSION_SOURCE_BYTES, owner: 'tools/rdap-extension-drift-audit.mts', note: 'Offline fixture comparison with an optional manual fetch of one fixed official registry; never enables an extension or reverse search.' }),
  entry({ id: 'cli.specialist-workflow-benchmark', kind: 'cli_document', schema: SPECIALIST_WORKFLOW_BENCHMARK_SCHEMA, currentVersion: SPECIALIST_WORKFLOW_BENCHMARK_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'tools/specialist-workflow-benchmark.mts', note: 'Offline synthetic regression and workflow-contract benchmark; no live target, provider request, or deployment effect.' }),
  entry({ id: 'cli.service-dependency-signature-audit', kind: 'cli_document', schema: SERVICE_DEPENDENCY_SIGNATURE_AUDIT_SCHEMA, currentVersion: SERVICE_DEPENDENCY_SIGNATURE_AUDIT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'tools/service-dependency-signature-audit.mts', note: 'Offline digest, metadata, collision, and freshness audit for the passive service-dependency signature catalogue.' }),
  entry({ id: 'export.web-capture-summary', kind: 'export', schema: WEB_CAPTURE_SUMMARY_SCHEMA, currentVersion: WEB_CAPTURE_SUMMARY_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: null, owner: 'frontend/src/lib/analysis/web-capture-import.ts', note: 'Sanitised metadata-only capture summary accepted through the bounded external-finding preview.' }),
  entry({ id: 'export.web-capture-manifest', kind: 'export', schema: WEB_CAPTURE_MANIFEST_SCHEMA, currentVersion: WEB_CAPTURE_MANIFEST_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_WEB_CAPTURE_MANIFEST_BYTES, owner: 'frontend/src/lib/analysis/web-capture-import.ts', note: 'Metadata-only capture manifest; the browser accepts versions 1 and 2 while offline artefact comparison requires current version 2.' }),
  entry({ id: 'export.web-capture-dom-digest', kind: 'export', schema: WEB_CAPTURE_DOM_DIGEST_SCHEMA, currentVersion: WEB_CAPTURE_DOM_DIGEST_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: MAX_WEB_CAPTURE_DOM_DIGEST_BYTES, owner: 'packages/web-capture/capture.mts', note: 'Local structural and visible-text digests with counts and truncation only; markup and page text are excluded.' }),
  entry({ id: 'cli.web-capture-comparison', kind: 'cli_document', schema: WEB_CAPTURE_COMPARISON_SCHEMA, currentVersion: WEB_CAPTURE_COMPARISON_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'packages/web-capture/compare.mts', note: 'Offline comparison of two verified current rendered-capture packages without input paths or retained page text.' }),
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

function buildSchemaCompatibilityInventory(
  options: { generatedAt?: string } = {},
): SchemaCompatibilityInventory {
  validateSchemaCompatibilityEntries(ENTRIES);
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
