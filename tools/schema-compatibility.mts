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
  BRAND_PROFILE_SCHEMA,
  BRAND_PROFILE_SCHEMA_VERSION,
  MAX_PROFILE_STORE_BYTES,
} from '../frontend/src/lib/analysis/brand-profile-model.js';
import {
  CAMPAIGN_SCHEMA,
  CAMPAIGN_SCHEMA_VERSION,
  MAX_CAMPAIGN_IMPORT_BYTES,
  MAX_CAMPAIGN_STORE_BYTES,
} from '../frontend/src/lib/analysis/campaign-model.js';
import {
  CASE_REPORT_SCHEMA,
  CASE_REPORT_SCHEMA_VERSION,
} from '../frontend/src/lib/analysis/case-report.js';
import {
  CASE_SCHEMA_VERSION,
  MAX_CASE_IMPORT_BYTES,
  MAX_CASE_STORE_BYTES,
} from '../frontend/src/lib/analysis/case-model.js';
import {
  CT_HISTORY_SCHEMA_VERSION,
  MAX_CT_HISTORY_STORE_BYTES,
} from '../frontend/src/lib/analysis/ct-history.js';
import {
  DEFENSIVE_INDICATOR_EXPORT_VERSION,
} from '../frontend/src/lib/analysis/defensive-indicator-export.js';
import {
  DETECTION_RULE_SCHEMA,
  DETECTION_RULE_SCHEMA_VERSION,
  MAX_RULE_IMPORT_BYTES,
  MAX_RULE_STORE_BYTES,
} from '../frontend/src/lib/analysis/detection-rule-model.js';
import {
  SYNTHETIC_DEMO_EXPORT_SCHEMA,
  SYNTHETIC_DEMO_EXPORT_VERSION,
  SYNTHETIC_DEMO_VERSION,
} from '../frontend/src/lib/analysis/demo-model.js';
import {
  INVESTIGATION_GUIDE_EXPORT_SCHEMA,
  INVESTIGATION_GUIDE_EXPORT_VERSION,
  INVESTIGATION_GUIDE_VERSION,
  MAX_INVESTIGATION_GUIDE_EXPORT_BYTES,
  MAX_INVESTIGATION_GUIDE_SERIALIZED_BYTES,
} from '../frontend/src/lib/analysis/investigation-guide.ts';
import {
  INVESTIGATION_PROJECTION_SCHEMA,
  INVESTIGATION_PROJECTION_VERSION,
} from '../frontend/src/lib/analysis/investigation-projection.ts';
import {
  MAX_RELATIONSHIP_GRAPH_EXPORT_BYTES,
  RELATIONSHIP_GRAPH_EXPORT_SCHEMA,
  RELATIONSHIP_GRAPH_EXPORT_VERSION,
} from '../frontend/src/lib/analysis/case-relationship-graph-export.js';
import {
  MAX_WORKSPACE_ARCHIVE_BYTES,
  WORKSPACE_ARCHIVE_SCHEMA,
  WORKSPACE_ARCHIVE_VERSION,
  WORKSPACE_SETTINGS_SCHEMA,
  WORKSPACE_SETTINGS_VERSION,
} from '../frontend/src/lib/analysis/workspace-archive.js';
import {
  INVESTIGATION_SEARCH_SCHEMA,
  INVESTIGATION_SEARCH_VERSION,
} from '../frontend/src/lib/analysis/investigation-search.ts';
import {
  MISP_INDICATOR_EXPORT_VERSION,
} from '../frontend/src/lib/analysis/misp-indicator-export.js';
import {
  SCHEDULED_MONITOR_DELIVERY_SCHEMA,
  SCHEDULED_MONITOR_DELIVERY_VERSION,
} from '../frontend/src/lib/analysis/scheduled-monitor-dispatcher.js';
import {
  MAX_SCHEDULED_MONITOR_STORE_BYTES,
  SCHEDULED_MONITOR_SCHEMA,
  SCHEDULED_MONITOR_SCHEMA_VERSION,
} from '../frontend/src/lib/analysis/scheduled-monitor-model.js';
import {
  MAX_SHORTLIST_STORE_BYTES,
  SHORTLIST_SCHEMA,
  SHORTLIST_SCHEMA_VERSION,
} from '../frontend/src/lib/analysis/shortlist-model.js';
import {
  STIX_INDICATOR_EXPORT_VERSION,
} from '../frontend/src/lib/analysis/stix-indicator-export.js';
import {
  MAX_WATCHLIST_STORE_BYTES,
  WATCHLIST_SCHEMA,
  WATCHLIST_SCHEMA_VERSION,
} from '../frontend/src/lib/analysis/watchlist-store.js';
import {
  HANDOFF_VERSION,
} from '../frontend/src/lib/candidate-handoff-core.js';
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
  registryStandardsCoverageSnapshot,
} from '../lib/registry-capabilities.mts';
import {
  DEPLOYMENT_SELF_CHECK_SCHEMA,
  DEPLOYMENT_SELF_CHECK_VERSION,
} from './deployment-self-check.mts';

export const SCHEMA_COMPATIBILITY_INVENTORY_SCHEMA = 'whoisleuth.schema-compatibility-inventory';
export const SCHEMA_COMPATIBILITY_INVENTORY_VERSION = 1;
export const MAX_SCHEMA_COMPATIBILITY_ENTRIES = 64;

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
  entry({ id: 'browser.cases', kind: 'browser_store', schema: null, currentVersion: CASE_SCHEMA_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: true, futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current', writeSemantics: 'normalized_rewrite', byteBudget: MAX_CASE_STORE_BYTES, owner: 'frontend/src/lib/analysis/case-model.js', note: 'Known fields can be read from newer local envelopes, but wrappers block overwrite and downgraded export.' }),
  entry({ id: 'browser.brand-profiles', kind: 'browser_store', schema: null, currentVersion: BRAND_PROFILE_SCHEMA_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: true, futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current', writeSemantics: 'normalized_rewrite', byteBudget: MAX_PROFILE_STORE_BYTES, owner: 'frontend/src/lib/analysis/brand-profile-model.js', note: 'Version 1 bare arrays normalize to the current bounded store; the schema string belongs to portable exports.' }),
  entry({ id: 'browser.campaigns', kind: 'browser_store', schema: null, currentVersion: CAMPAIGN_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: true, futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current', writeSemantics: 'normalized_rewrite', byteBudget: MAX_CAMPAIGN_STORE_BYTES, owner: 'frontend/src/lib/analysis/campaign-model.js', note: 'Bare arrays remain recoverable; explicit future versions are not overwritten; the schema string belongs to portable exports.' }),
  entry({ id: 'browser.watchlists', kind: 'browser_store', schema: WATCHLIST_SCHEMA, currentVersion: WATCHLIST_SCHEMA_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: true, futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current', writeSemantics: 'normalized_rewrite', byteBudget: MAX_WATCHLIST_STORE_BYTES, owner: 'frontend/src/lib/analysis/watchlist-store.js', note: 'Legacy map-shaped stores normalize to the current envelope.' }),
  entry({ id: 'browser.shortlist', kind: 'browser_store', schema: SHORTLIST_SCHEMA, currentVersion: SHORTLIST_SCHEMA_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: true, futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current', writeSemantics: 'normalized_rewrite', byteBudget: MAX_SHORTLIST_STORE_BYTES, owner: 'frontend/src/lib/analysis/shortlist-model.js', note: 'Legacy arrays normalize to the current compact envelope.' }),
  entry({ id: 'browser.ct-history', kind: 'browser_store', schema: null, currentVersion: CT_HISTORY_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current', writeSemantics: 'normalized_rewrite', byteBudget: MAX_CT_HISTORY_STORE_BYTES, owner: 'frontend/src/lib/analysis/ct-history.js', note: 'Malformed values degrade to an empty bounded history; future stores are not overwritten.' }),
  entry({ id: 'browser.detection-rules', kind: 'browser_store', schema: null, currentVersion: DETECTION_RULE_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: true, futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current', writeSemantics: 'normalized_rewrite', byteBudget: MAX_RULE_STORE_BYTES, owner: 'frontend/src/lib/analysis/detection-rule-model.js', note: 'Only allowlisted structured rule fields and operators survive normalization; the schema string belongs to portable exports.' }),
  entry({ id: 'tab.candidate-handoff', kind: 'tab_store', schema: null, currentVersion: HANDOFF_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'discard', migration: 'exact_current_only', writeSemantics: 'ephemeral_replace', byteBudget: null, owner: 'frontend/src/lib/candidate-handoff-core.js', note: 'Bounded session handoff; unsupported envelopes are ignored.' }),
  entry({ id: 'tab.investigation-guide', kind: 'tab_store', schema: null, currentVersion: INVESTIGATION_GUIDE_VERSION, supportedVersions: [1, 2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current', writeSemantics: 'ephemeral_replace', byteBudget: MAX_INVESTIGATION_GUIDE_SERIALIZED_BYTES, owner: 'frontend/src/lib/analysis/investigation-guide.ts', note: 'Version 1 navigation records normalize into the bounded version 2 recipe state; future records remain untouched.' }),
  entry({ id: 'tab.synthetic-demo', kind: 'tab_store', schema: null, currentVersion: SYNTHETIC_DEMO_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'discard', migration: 'exact_current_only', writeSemantics: 'ephemeral_replace', byteBudget: null, owner: 'frontend/src/lib/analysis/demo-model.js', note: 'Fixed synthetic fixtures remain separate from investigation stores.' }),
  entry({ id: 'hosted.scheduled-monitor', kind: 'hosted_store', schema: SCHEDULED_MONITOR_SCHEMA, currentVersion: SCHEDULED_MONITOR_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'optimistic_replace', byteBudget: MAX_SCHEDULED_MONITOR_STORE_BYTES, owner: 'frontend/src/lib/analysis/scheduled-monitor-model.js', note: 'Compact authority-aware evidence only; raw responses and expanded contacts are excluded.' }),
  entry({ id: 'hosted.scheduled-monitor-envelope', kind: 'hosted_store', schema: ENVELOPE_SCHEMA, currentVersion: ENVELOPE_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'optimistic_replace', byteBudget: MAX_ENVELOPE_BYTES, owner: 'lib/scheduled-monitor-crypto.mts', note: 'Authenticated encrypted envelope; version and namespace are part of authenticated context.' }),
  entry({ id: 'hosted.scheduled-monitor-delivery', kind: 'hosted_store', schema: SCHEDULED_MONITOR_DELIVERY_SCHEMA, currentVersion: SCHEDULED_MONITOR_DELIVERY_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'ephemeral_replace', byteBudget: null, owner: 'frontend/src/lib/analysis/scheduled-monitor-dispatcher.js', note: 'Opaque bounded queue message with an allowlisted key set.' }),
  entry({ id: 'export.cases', kind: 'export', schema: null, currentVersion: CASE_SCHEMA_VERSION, supportedVersions: [2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'non_destructive_merge', byteBudget: MAX_CASE_IMPORT_BYTES, owner: 'frontend/src/lib/analysis/case-model.js', note: 'Non-destructive merge; current exports intentionally reject legacy and future import versions.' }),
  entry({ id: 'export.brand-profiles', kind: 'export', schema: BRAND_PROFILE_SCHEMA, currentVersion: BRAND_PROFILE_SCHEMA_VERSION, supportedVersions: [2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'non_destructive_merge', byteBudget: null, owner: 'frontend/src/lib/analysis/brand-profile-model.js', note: 'Non-destructive merge by bounded normalized profile identity.' }),
  entry({ id: 'export.campaigns', kind: 'export', schema: CAMPAIGN_SCHEMA, currentVersion: CAMPAIGN_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: true, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'non_destructive_merge', byteBudget: MAX_CAMPAIGN_IMPORT_BYTES, owner: 'frontend/src/lib/analysis/campaign-model.js', note: 'Non-destructive merge; unversioned legacy campaign arrays remain accepted.' }),
  entry({ id: 'export.watchlists', kind: 'export', schema: WATCHLIST_SCHEMA, currentVersion: WATCHLIST_SCHEMA_VERSION, supportedVersions: [2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'non_destructive_merge', byteBudget: null, owner: 'frontend/src/lib/analysis/watchlist-store.js', note: 'Non-destructive collection merge with current schema required.' }),
  entry({ id: 'export.shortlist', kind: 'export', schema: SHORTLIST_SCHEMA, currentVersion: SHORTLIST_SCHEMA_VERSION, supportedVersions: [2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'non_destructive_merge', byteBudget: null, owner: 'frontend/src/lib/analysis/shortlist-model.js', note: 'Non-destructive domain merge with current schema required.' }),
  entry({ id: 'export.detection-rules', kind: 'export', schema: DETECTION_RULE_SCHEMA, currentVersion: DETECTION_RULE_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: true, futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'non_destructive_merge', byteBudget: MAX_RULE_IMPORT_BYTES, owner: 'frontend/src/lib/analysis/detection-rule-model.js', note: 'Non-destructive rule merge; imported conditions remain allowlisted and non-executable.' }),
  entry({ id: 'export.case-report', kind: 'export', schema: CASE_REPORT_SCHEMA, currentVersion: CASE_REPORT_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'frontend/src/lib/analysis/case-report.js', note: 'Local report output; not an import or persistence contract.' }),
  entry({ id: 'export.investigation-recipe-summary', kind: 'export', schema: INVESTIGATION_GUIDE_EXPORT_SCHEMA, currentVersion: INVESTIGATION_GUIDE_EXPORT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_INVESTIGATION_GUIDE_EXPORT_BYTES, owner: 'frontend/src/lib/analysis/investigation-guide.ts', note: 'Compact analyst workflow metadata only; raw evidence, notes, credentials, provider responses, and scan results are excluded.' }),
  entry({ id: 'export.relationship-graph', kind: 'export', schema: RELATIONSHIP_GRAPH_EXPORT_SCHEMA, currentVersion: RELATIONSHIP_GRAPH_EXPORT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_RELATIONSHIP_GRAPH_EXPORT_BYTES, owner: 'frontend/src/lib/analysis/case-relationship-graph-export.js', note: 'One canonical bounded relationship document serialized as WHOISleuth JSON, GraphML, or GEXF; transient graph view state is excluded.' }),
  entry({ id: 'export.workspace-archive', kind: 'export', schema: WORKSPACE_ARCHIVE_SCHEMA, currentVersion: WORKSPACE_ARCHIVE_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'non_destructive_merge', byteBudget: MAX_WORKSPACE_ARCHIVE_BYTES, owner: 'frontend/src/lib/analysis/workspace-archive.js', note: 'Manifested local archive with per-section checksums, preview-first import, and rollback on browser-store write failure.' }),
  entry({ id: 'export.workspace-settings-section', kind: 'export', schema: WORKSPACE_SETTINGS_SCHEMA, currentVersion: WORKSPACE_SETTINGS_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'non_destructive_merge', byteBudget: null, owner: 'frontend/src/lib/analysis/workspace-archive.js', note: 'Nested archive section limited to the active Brand Profile identifier and dark, light, or system theme preference.' }),
  entry({ id: 'export.lookup-evidence', kind: 'export', schema: LOOKUP_EVIDENCE_SCHEMA, currentVersion: LOOKUP_EVIDENCE_SCHEMA_VERSION, supportedVersions: [12], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/evidence-export.mts', note: 'Full-fidelity normalized lookup package; distinct from compact browser evidence.' }),
  entry({ id: 'export.defensive-indicators', kind: 'export', schema: null, currentVersion: DEFENSIVE_INDICATOR_EXPORT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'frontend/src/lib/analysis/defensive-indicator-export.js', note: 'Review-only text formats; never submitted or applied automatically.' }),
  entry({ id: 'export.stix-indicators', kind: 'export', schema: null, currentVersion: STIX_INDICATOR_EXPORT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'frontend/src/lib/analysis/stix-indicator-export.js', note: 'STIX 2.1 bundle with direct observations separated from heuristic indicators.' }),
  entry({ id: 'export.misp-indicators', kind: 'export', schema: null, currentVersion: MISP_INDICATOR_EXPORT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'frontend/src/lib/analysis/misp-indicator-export.js', note: 'Unpublished, non-IDS, non-correlating event for reviewed import.' }),
  entry({ id: 'export.synthetic-demo', kind: 'export', schema: SYNTHETIC_DEMO_EXPORT_SCHEMA, currentVersion: SYNTHETIC_DEMO_EXPORT_VERSION, supportedVersions: [2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'frontend/src/lib/analysis/demo-model.js', note: 'Explicitly synthetic fixed-fixture package, never live evidence.' }),
  entry({ id: 'cli.lookup', kind: 'cli_document', schema: CLI_LOOKUP_SCHEMA, currentVersion: CLI_LOOKUP_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: MAX_SAVED_LOOKUP_INPUT_BYTES, owner: 'cli/formatters/json.mts', note: 'Saved domain lookups are parsed for compare and evidence export only at the exact current version.' }),
  entry({ id: 'cli.bulk', kind: 'cli_document', schema: CLI_BULK_SCHEMA, currentVersion: CLI_BULK_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/formatters/json.mts', note: 'Bounded bulk result document.' }),
  entry({ id: 'cli.bulk-item', kind: 'cli_document', schema: CLI_BULK_ITEM_SCHEMA, currentVersion: CLI_BULK_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/formatters/json.mts', note: 'One bounded bulk JSONL or document item.' }),
  entry({ id: 'cli.ct-search', kind: 'cli_document', schema: CLI_CT_SEARCH_SCHEMA, currentVersion: CLI_CT_SEARCH_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/formatters/json.mts', note: 'Certificate log search output.' }),
  entry({ id: 'cli.discover', kind: 'cli_document', schema: CLI_DISCOVER_SCHEMA, currentVersion: CLI_DISCOVER_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/formatters/json.mts', note: 'Candidate discovery document.' }),
  entry({ id: 'cli.discover-item', kind: 'cli_document', schema: CLI_DISCOVER_ITEM_SCHEMA, currentVersion: CLI_DISCOVER_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/formatters/json.mts', note: 'One candidate discovery JSONL item.' }),
  entry({ id: 'cli.posture', kind: 'cli_document', schema: CLI_POSTURE_SCHEMA, currentVersion: CLI_POSTURE_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/formatters/json.mts', note: 'Owned-domain posture output.' }),
  entry({ id: 'cli.http', kind: 'cli_document', schema: CLI_HTTP_SCHEMA, currentVersion: CLI_HTTP_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/formatters/json.mts', note: 'Bounded HTTP evidence output.' }),
  entry({ id: 'cli.tls', kind: 'cli_document', schema: CLI_TLS_SCHEMA, currentVersion: CLI_TLS_SCHEMA_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/formatters/json.mts', note: 'Bounded TLS evidence output.' }),
  entry({ id: 'cli.compare', kind: 'cli_document', schema: CLI_COMPARE_SCHEMA, currentVersion: CLI_COMPARE_SCHEMA_VERSION, supportedVersions: [3], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: MAX_SAVED_LOOKUP_INPUT_BYTES, owner: 'cli/compare.mts', note: 'Comparison output reads exact-current saved lookup inputs.' }),
  entry({ id: 'cli.registry-support', kind: 'cli_document', schema: REGISTRY_SUPPORT_SCHEMA, currentVersion: REGISTRY_SUPPORT_SCHEMA_VERSION, supportedVersions: [2], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/registry-support.mts', note: 'Catalogue coverage report; does not test live reachability.' }),
  entry({ id: 'cli.registry-standards-coverage', kind: 'cli_document', schema: REGISTRY_STANDARDS_COVERAGE_SCHEMA, currentVersion: standardsCoverage.version, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'lib/registry-capabilities.mts', note: 'Immutable official-source coverage snapshot embedded in registry-support output.' }),
  entry({ id: 'cli.risk-calibration-dataset', kind: 'cli_document', schema: RISK_CALIBRATION_DATASET_SCHEMA, currentVersion: RISK_CALIBRATION_DATASET_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'read_only', byteBudget: MAX_RISK_CALIBRATION_INPUT_BYTES, owner: 'cli/risk-calibration.mts', note: 'Offline labelled fixture input; no live collection.' }),
  entry({ id: 'cli.risk-calibration-report', kind: 'cli_document', schema: RISK_CALIBRATION_REPORT_SCHEMA, currentVersion: RISK_CALIBRATION_REPORT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'cli/risk-calibration.mts', note: 'Offline calibration output; labels and metrics do not prove maliciousness.' }),
  entry({ id: 'cli.deployment-self-check', kind: 'cli_document', schema: DEPLOYMENT_SELF_CHECK_SCHEMA, currentVersion: DEPLOYMENT_SELF_CHECK_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'not_applicable', migration: 'read_only', writeSemantics: 'read_only', byteBudget: null, owner: 'tools/deployment-self-check.mts', note: 'Redacted operator-run public-boundary report; response bodies and credentialed posture are excluded.' }),
  entry({ id: 'derived.curated-connector-result', kind: 'derived', schema: CURATED_CONNECTOR_RESULT_SCHEMA, currentVersion: CURATED_CONNECTOR_CONTRACT_VERSION, supportedVersions: [1], acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'none', byteBudget: null, owner: 'lib/threat-intelligence-contract.mts', note: 'Transient bounded entity and relationship projection; the contract enables no connector, request, credential, storage, score, or availability decision.' }),
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
      'A listed version is supported only according to the named owner module and the migration behavior shown here.',
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
    '| Contract | Kind | Schema | Current | Supported | Future version | Migration | Write semantics | Serialized bound | Owner |',
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
