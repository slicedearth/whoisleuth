import { WORKSPACE_ARCHIVE_SECTION_IDS } from './case-portability.mts';
import { defineSchemaCompatibility, type SchemaCompatibilityDescriptor } from './schema-compatibility.mts';
import {
  defineSchemaLifecycleFamily,
  type SchemaLifecycleBoundProfile,
  type SchemaLifecycleConsumerEdgeV4,
  type SchemaLifecycleContract,
  type SchemaLifecycleFixtureV4,
  type SchemaLifecycleHook,
  type SchemaLifecyclePrivacyProfile,
  type SchemaLifecycleSerialisationProfile,
  type SchemaLifecycleShapeV4,
} from './schema-lifecycle.mts';

export const WORKSPACE_CONTRACT_OWNER = 'packages/contracts/workspace-portability.mts';

export const BRAND_PROFILE_SCHEMA = 'whoisleuth.brand-profiles';
export const PUBLIC_BRAND_PROFILE_SCHEMA_VERSION = 6;
export const BRAND_PROFILE_SCHEMA_VERSION = 7;
export const BRAND_PROFILE_BROWSER_SUPPORTED_VERSIONS = Object.freeze([PUBLIC_BRAND_PROFILE_SCHEMA_VERSION, BRAND_PROFILE_SCHEMA_VERSION]);
export const SUPPORTED_BRAND_PROFILE_SCHEMA_VERSIONS = BRAND_PROFILE_BROWSER_SUPPORTED_VERSIONS;
export const MAX_PROFILES = 100;
export const MAX_PROFILE_VALUES = 200;
export const MAX_PROFILE_VALUE_INPUTS = MAX_PROFILE_VALUES * 4;
export const MAX_PROFILE_STORE_BYTES = 1024 * 1024;
export const MAX_PROFILE_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_PROFILE_NAME_LENGTH = 100;
export const MAX_PROFILE_TEXT_LENGTH = 200;
export const MAX_PROFILE_DOMAIN_LENGTH = 253;
export const MAX_PROFILE_TLD_LENGTH = 63;
export const MAX_DKIM_SELECTOR_LENGTH = 253;
export const MAX_DKIM_SELECTORS = 10;
export const MAX_PROTECTION_ATTESTATIONS = 6;
export const MAX_DESIRED_POSTURE_BASELINES = 20;
export const MAX_DESIRED_POSTURE_RECORDS = 32;
export const MAX_DESIRED_POSTURE_SUPPRESSIONS = 12;
export const MAX_DESIRED_POSTURE_OBSERVATIONS = 12;
export const MAX_DESIRED_POSTURE_CHANGE_WINDOWS = 8;

export const CAMPAIGN_SCHEMA = 'whoisleuth.campaigns';
export const CAMPAIGN_SCHEMA_VERSION = 1;
export const CAMPAIGN_BROWSER_SUPPORTED_VERSIONS = Object.freeze([CAMPAIGN_SCHEMA_VERSION]);
export const CAMPAIGN_EXPORT_SUPPORTED_VERSIONS = Object.freeze([CAMPAIGN_SCHEMA_VERSION]);
export const MAX_CAMPAIGNS = 50;
export const MAX_CAMPAIGN_DOMAINS = 50;
export const MAX_CAMPAIGN_NAME_LENGTH = 100;
export const MAX_CAMPAIGN_DESCRIPTION_LENGTH = 1000;
export const MAX_CAMPAIGN_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_CAMPAIGN_INPUT_RECORDS = 500;
export const MAX_CAMPAIGN_STORE_BYTES = 512 * 1024;

export const WATCHLIST_SCHEMA = 'whoisleuth.watchlists';
export const WATCHLIST_SCHEMA_VERSION = 2;
export const WATCHLIST_BROWSER_SUPPORTED_VERSIONS = Object.freeze([WATCHLIST_SCHEMA_VERSION]);
export const WATCHLIST_EXPORT_SUPPORTED_VERSIONS = Object.freeze([WATCHLIST_SCHEMA_VERSION]);
export const MAX_WATCHLISTS = 100;
export const MAX_WATCHLIST_INPUTS = MAX_WATCHLISTS * 4;
export const MAX_WATCHLIST_NAME_LENGTH = 100;
export const MAX_WATCHLIST_STORE_BYTES = 2 * 1024 * 1024;
export const MAX_WATCHLIST_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_WATCHLIST_HISTORY_EVENTS = 12;
export const MAX_WATCHLIST_CHANGES_PER_EVENT = 500;
export const MAX_WATCHLIST_DOMAINS = 2_000;
export const MAX_WATCHLIST_INPUT_RECORDS = MAX_WATCHLIST_DOMAINS * 2;
export const MAX_WATCHLIST_NAMESERVERS = 12;
export const MAX_WATCHLIST_MUTATION_TYPES = 30;
export const MAX_WATCHLIST_HISTORY_DOMAIN_OPTIONS = MAX_WATCHLIST_DOMAINS;

export const SHORTLIST_SCHEMA = 'whoisleuth.shortlist';
export const SHORTLIST_SCHEMA_VERSION = 3;
export const SHORTLIST_BROWSER_SUPPORTED_VERSIONS = Object.freeze([SHORTLIST_SCHEMA_VERSION]);
export const SUPPORTED_SHORTLIST_SCHEMA_VERSIONS = SHORTLIST_BROWSER_SUPPORTED_VERSIONS;
export const MAX_SHORTLIST_ENTRIES = 500;
export const MAX_SHORTLIST_INPUTS = MAX_SHORTLIST_ENTRIES * 4;
export const MAX_SHORTLIST_STORE_BYTES = 1024 * 1024;
export const MAX_SHORTLIST_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_SHORTLIST_FACTORS = 20;

export const CT_HISTORY_SCHEMA_VERSION = 3;
export const CT_HISTORY_BROWSER_SUPPORTED_VERSIONS = Object.freeze([CT_HISTORY_SCHEMA_VERSION]);
export const MAX_CT_HISTORY_SEARCHES = 30;
export const MAX_CT_HISTORY_EVENTS = 20;
export const MAX_CT_HISTORY_DISCARDED_CHECKS = 1_000_000;
export const MAX_CT_HISTORY_DOMAINS = 500;
export const MAX_CT_HISTORY_NEW_DOMAINS = 100;
export const MAX_CT_HISTORY_EVER_SEEN_DOMAINS = 1_000;
export const MAX_CT_HISTORY_QUERY_LENGTH = 200;
export const MAX_CT_HISTORY_STORE_BYTES = 1024 * 1024;

export const DETECTION_RULE_SCHEMA = 'whoisleuth.detection-rules';
export const DETECTION_RULE_SCHEMA_VERSION = 1;
export const DETECTION_RULE_BROWSER_SUPPORTED_VERSIONS = Object.freeze([DETECTION_RULE_SCHEMA_VERSION]);
export const DETECTION_RULE_EXPORT_SUPPORTED_VERSIONS = Object.freeze([DETECTION_RULE_SCHEMA_VERSION]);
export const MAX_DETECTION_RULES = 50;
export const MAX_RULE_CONDITIONS = 8;
export const MAX_RULE_INPUT_RECORDS = 250;
export const MAX_RULE_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_RULE_STORE_BYTES = 256 * 1024;
export const MAX_RULE_NAME_LENGTH = 100;
export const MAX_RULE_TAG_LENGTH = 40;
export const MAX_CONDITION_VALUE_LENGTH = 200;
export const MAX_RULE_RISK_DELTA = 25;
export const MAX_CUSTOM_RISK_TOTAL = 50;

export const RELATIONSHIP_OBSERVATION_SCHEMA = 'whoisleuth.relationship-observations';
export const RELATIONSHIP_OBSERVATION_SCHEMA_VERSION = 1;
export const RELATIONSHIP_OBSERVATION_BROWSER_SUPPORTED_VERSIONS = Object.freeze([RELATIONSHIP_OBSERVATION_SCHEMA_VERSION]);
export const RELATIONSHIP_OBSERVATION_EXPORT_SUPPORTED_VERSIONS = Object.freeze([RELATIONSHIP_OBSERVATION_SCHEMA_VERSION]);
export const MAX_RELATIONSHIP_OBSERVATIONS = 300;
export const MAX_RELATIONSHIP_OBSERVATION_INPUTS = 1_200;
export const MAX_RELATIONSHIP_OBSERVATION_DOMAINS = 50;
export const MAX_RELATIONSHIP_OBSERVATION_LIMITATIONS = 8;
export const MAX_RELATIONSHIP_OBSERVATION_VALUE_LENGTH = 20_000;
export const MAX_RELATIONSHIP_OBSERVATION_STORE_BYTES = 768 * 1024;

export const WEBSITE_SNAPSHOT_SCHEMA = 'whoisleuth.website-profile-snapshots';
export const WEBSITE_SNAPSHOT_SCHEMA_VERSION = 5;
export const WEBSITE_SNAPSHOT_BROWSER_SUPPORTED_VERSIONS = Object.freeze([4, WEBSITE_SNAPSHOT_SCHEMA_VERSION]);
export const SUPPORTED_WEBSITE_SNAPSHOT_SCHEMA_VERSIONS = WEBSITE_SNAPSHOT_BROWSER_SUPPORTED_VERSIONS;
export const MAX_WEBSITE_SNAPSHOTS = 60;
export const MAX_WEBSITE_SNAPSHOTS_PER_DOMAIN = 12;
export const MAX_WEBSITE_SNAPSHOT_STORE_BYTES = 512 * 1024;
export const MAX_WEBSITE_SNAPSHOT_IMPORT_BYTES = 768 * 1024;

export const BULK_SESSION_SCHEMA = 'whoisleuth.bulk-sessions';
export const BULK_SESSION_SCHEMA_VERSION = 4;
export const BULK_SESSION_BROWSER_SUPPORTED_VERSIONS = Object.freeze([BULK_SESSION_SCHEMA_VERSION]);
export const SUPPORTED_BULK_SESSION_SCHEMA_VERSIONS = BULK_SESSION_BROWSER_SUPPORTED_VERSIONS;
export const MAX_BULK_SESSIONS = 10;
export const MAX_BULK_SESSION_ROWS = 2_000;
export const MAX_BULK_SESSION_STORE_BYTES = 4 * 1024 * 1024;
export const MAX_BULK_SESSION_NAME_LENGTH = 100;
export const MAX_BULK_SESSION_TEXT_LENGTH = 500;
export const MAX_BULK_SESSION_ARRAY_VALUES = 100;
export const MAX_BULK_SESSION_SOURCES = 12;
export const MAX_BULK_PROFILE_CONTEXT_LIMITATION_LENGTH = 300;

export const INVESTIGATION_TEMPLATE_SCHEMA = 'whoisleuth.investigation-templates';
export const INVESTIGATION_TEMPLATE_VERSION = 2;
export const INVESTIGATION_TEMPLATE_SUPPORTED_VERSIONS = Object.freeze([INVESTIGATION_TEMPLATE_VERSION]);
export const MAX_INVESTIGATION_TEMPLATES = 20;
export const MAX_INVESTIGATION_TEMPLATE_STORE_BYTES = 256 * 1024;
export const MAX_INVESTIGATION_TEMPLATE_IMPORT_BYTES = 384 * 1024;

export const BULK_REVIEW_SCHEMA = 'whoisleuth.bulk-review';
export const BULK_REVIEW_SCHEMA_VERSION = 1;
export const BULK_REVIEW_BROWSER_SUPPORTED_VERSIONS = Object.freeze([BULK_REVIEW_SCHEMA_VERSION]);
export const BULK_REVIEW_EXPORT_SUPPORTED_VERSIONS = Object.freeze([BULK_REVIEW_SCHEMA_VERSION]);
export const MAX_BULK_REVIEW_PRESETS = 24;
export const MAX_BULK_REVIEW_ROWS = 1_900;
export const MAX_BULK_REVIEW_STORE_BYTES = 512 * 1024;
export const MAX_BULK_REVIEW_NAME_LENGTH = 80;

export const MAX_WORKSPACE_INPUT_GRAPH_DEPTH = 32;
export const MAX_WORKSPACE_INPUT_GRAPH_NODES = 25_000;
export const MAX_WORKSPACE_INPUT_ARRAY_LENGTH = 10_000;
export const MAX_WORKSPACE_INPUT_OBJECT_KEYS = 4_096;
export const MAX_WORKSPACE_INPUT_STRING_CODE_UNITS = 8 * 1024 * 1024;

export const PAGE_BASELINE_VERSION = 1;
export const PAGE_IDENTITY_VERSION = 3;
export const PAGE_FINGERPRINT_VERSION = 1;
export const MAX_BASELINE_TITLE_LENGTH = 200;
export const MAX_BASELINE_RESOURCE_HOSTS = 30;
export const MAX_BASELINE_IDENTIFIERS = 30;

export const BRAND_PROFILE_BROWSER_STORE_LIFECYCLE_SCHEMA = 'whoisleuth.browser.brand-profile-store';
export const CAMPAIGN_BROWSER_STORE_LIFECYCLE_SCHEMA = 'whoisleuth.browser.campaign-store';
export const WATCHLIST_BROWSER_STORE_LIFECYCLE_SCHEMA = 'whoisleuth.browser.watchlist-store';
export const SHORTLIST_BROWSER_STORE_LIFECYCLE_SCHEMA = 'whoisleuth.browser.shortlist-store';
export const CT_HISTORY_BROWSER_STORE_LIFECYCLE_SCHEMA = 'whoisleuth.browser.ct-history-store';
export const DETECTION_RULE_BROWSER_STORE_LIFECYCLE_SCHEMA = 'whoisleuth.browser.detection-rule-store';
export const RELATIONSHIP_OBSERVATION_BROWSER_STORE_LIFECYCLE_SCHEMA = 'whoisleuth.browser.relationship-observation-store';
export const WEBSITE_SNAPSHOT_BROWSER_STORE_LIFECYCLE_SCHEMA = 'whoisleuth.browser.website-snapshot-store';
export const BULK_SESSION_BROWSER_STORE_LIFECYCLE_SCHEMA = 'whoisleuth.browser.bulk-session-store';
export const INVESTIGATION_TEMPLATE_BROWSER_STORE_LIFECYCLE_SCHEMA = 'whoisleuth.browser.investigation-template-store';
export const BULK_REVIEW_BROWSER_STORE_LIFECYCLE_SCHEMA = 'whoisleuth.browser.bulk-review-store';

export const WORKSPACE_PORTABILITY_IDENTITY_CONSTANTS = Object.freeze([
  'BRAND_PROFILE_SCHEMA', 'BRAND_PROFILE_SCHEMA_VERSION', 'BRAND_PROFILE_BROWSER_SUPPORTED_VERSIONS', 'SUPPORTED_BRAND_PROFILE_SCHEMA_VERSIONS',
  'CAMPAIGN_SCHEMA', 'CAMPAIGN_SCHEMA_VERSION', 'CAMPAIGN_BROWSER_SUPPORTED_VERSIONS', 'CAMPAIGN_EXPORT_SUPPORTED_VERSIONS',
  'WATCHLIST_SCHEMA', 'WATCHLIST_SCHEMA_VERSION', 'WATCHLIST_BROWSER_SUPPORTED_VERSIONS', 'WATCHLIST_EXPORT_SUPPORTED_VERSIONS',
  'SHORTLIST_SCHEMA', 'SHORTLIST_SCHEMA_VERSION', 'SHORTLIST_BROWSER_SUPPORTED_VERSIONS', 'SUPPORTED_SHORTLIST_SCHEMA_VERSIONS',
  'CT_HISTORY_SCHEMA_VERSION', 'CT_HISTORY_BROWSER_SUPPORTED_VERSIONS',
  'DETECTION_RULE_SCHEMA', 'DETECTION_RULE_SCHEMA_VERSION', 'DETECTION_RULE_BROWSER_SUPPORTED_VERSIONS', 'DETECTION_RULE_EXPORT_SUPPORTED_VERSIONS',
  'RELATIONSHIP_OBSERVATION_SCHEMA', 'RELATIONSHIP_OBSERVATION_SCHEMA_VERSION', 'RELATIONSHIP_OBSERVATION_BROWSER_SUPPORTED_VERSIONS', 'RELATIONSHIP_OBSERVATION_EXPORT_SUPPORTED_VERSIONS',
  'WEBSITE_SNAPSHOT_SCHEMA', 'WEBSITE_SNAPSHOT_SCHEMA_VERSION', 'WEBSITE_SNAPSHOT_BROWSER_SUPPORTED_VERSIONS', 'SUPPORTED_WEBSITE_SNAPSHOT_SCHEMA_VERSIONS',
  'BULK_SESSION_SCHEMA', 'BULK_SESSION_SCHEMA_VERSION', 'BULK_SESSION_BROWSER_SUPPORTED_VERSIONS', 'SUPPORTED_BULK_SESSION_SCHEMA_VERSIONS',
  'INVESTIGATION_TEMPLATE_SCHEMA', 'INVESTIGATION_TEMPLATE_VERSION', 'INVESTIGATION_TEMPLATE_SUPPORTED_VERSIONS',
  'BULK_REVIEW_SCHEMA', 'BULK_REVIEW_SCHEMA_VERSION', 'BULK_REVIEW_BROWSER_SUPPORTED_VERSIONS', 'BULK_REVIEW_EXPORT_SUPPORTED_VERSIONS',
  'BRAND_PROFILE_BROWSER_STORE_LIFECYCLE_SCHEMA', 'CAMPAIGN_BROWSER_STORE_LIFECYCLE_SCHEMA', 'WATCHLIST_BROWSER_STORE_LIFECYCLE_SCHEMA',
  'SHORTLIST_BROWSER_STORE_LIFECYCLE_SCHEMA', 'CT_HISTORY_BROWSER_STORE_LIFECYCLE_SCHEMA', 'DETECTION_RULE_BROWSER_STORE_LIFECYCLE_SCHEMA',
  'RELATIONSHIP_OBSERVATION_BROWSER_STORE_LIFECYCLE_SCHEMA', 'WEBSITE_SNAPSHOT_BROWSER_STORE_LIFECYCLE_SCHEMA',
  'BULK_SESSION_BROWSER_STORE_LIFECYCLE_SCHEMA', 'INVESTIGATION_TEMPLATE_BROWSER_STORE_LIFECYCLE_SCHEMA', 'BULK_REVIEW_BROWSER_STORE_LIFECYCLE_SCHEMA',
] as const);

export const WORKSPACE_PORTABILITY_BOUND_CONSTANTS = Object.freeze([
  'MAX_PROFILES', 'MAX_PROFILE_VALUES', 'MAX_PROFILE_VALUE_INPUTS', 'MAX_PROFILE_STORE_BYTES', 'MAX_PROFILE_IMPORT_BYTES',
  'MAX_PROFILE_NAME_LENGTH', 'MAX_PROFILE_TEXT_LENGTH', 'MAX_PROFILE_DOMAIN_LENGTH', 'MAX_PROFILE_TLD_LENGTH', 'MAX_DKIM_SELECTOR_LENGTH',
  'MAX_DKIM_SELECTORS', 'MAX_PROTECTION_ATTESTATIONS', 'MAX_DESIRED_POSTURE_BASELINES', 'MAX_DESIRED_POSTURE_RECORDS',
  'MAX_DESIRED_POSTURE_SUPPRESSIONS', 'MAX_DESIRED_POSTURE_OBSERVATIONS', 'MAX_DESIRED_POSTURE_CHANGE_WINDOWS',
  'MAX_CAMPAIGNS', 'MAX_CAMPAIGN_DOMAINS', 'MAX_CAMPAIGN_NAME_LENGTH', 'MAX_CAMPAIGN_DESCRIPTION_LENGTH',
  'MAX_CAMPAIGN_IMPORT_BYTES', 'MAX_CAMPAIGN_INPUT_RECORDS', 'MAX_CAMPAIGN_STORE_BYTES',
  'MAX_WATCHLISTS', 'MAX_WATCHLIST_INPUTS', 'MAX_WATCHLIST_NAME_LENGTH', 'MAX_WATCHLIST_STORE_BYTES', 'MAX_WATCHLIST_IMPORT_BYTES',
  'MAX_WATCHLIST_HISTORY_EVENTS', 'MAX_WATCHLIST_CHANGES_PER_EVENT', 'MAX_WATCHLIST_DOMAINS', 'MAX_WATCHLIST_INPUT_RECORDS',
  'MAX_WATCHLIST_NAMESERVERS', 'MAX_WATCHLIST_MUTATION_TYPES', 'MAX_WATCHLIST_HISTORY_DOMAIN_OPTIONS',
  'MAX_SHORTLIST_ENTRIES', 'MAX_SHORTLIST_INPUTS', 'MAX_SHORTLIST_STORE_BYTES', 'MAX_SHORTLIST_IMPORT_BYTES', 'MAX_SHORTLIST_FACTORS',
  'MAX_CT_HISTORY_SEARCHES', 'MAX_CT_HISTORY_EVENTS', 'MAX_CT_HISTORY_DISCARDED_CHECKS', 'MAX_CT_HISTORY_DOMAINS',
  'MAX_CT_HISTORY_NEW_DOMAINS', 'MAX_CT_HISTORY_EVER_SEEN_DOMAINS', 'MAX_CT_HISTORY_QUERY_LENGTH', 'MAX_CT_HISTORY_STORE_BYTES',
  'MAX_DETECTION_RULES', 'MAX_RULE_CONDITIONS', 'MAX_RULE_INPUT_RECORDS', 'MAX_RULE_IMPORT_BYTES', 'MAX_RULE_STORE_BYTES',
  'MAX_RULE_NAME_LENGTH', 'MAX_RULE_TAG_LENGTH', 'MAX_CONDITION_VALUE_LENGTH', 'MAX_RULE_RISK_DELTA', 'MAX_CUSTOM_RISK_TOTAL',
  'MAX_RELATIONSHIP_OBSERVATIONS', 'MAX_RELATIONSHIP_OBSERVATION_INPUTS', 'MAX_RELATIONSHIP_OBSERVATION_DOMAINS',
  'MAX_RELATIONSHIP_OBSERVATION_LIMITATIONS', 'MAX_RELATIONSHIP_OBSERVATION_VALUE_LENGTH', 'MAX_RELATIONSHIP_OBSERVATION_STORE_BYTES',
  'MAX_WEBSITE_SNAPSHOTS', 'MAX_WEBSITE_SNAPSHOTS_PER_DOMAIN', 'MAX_WEBSITE_SNAPSHOT_STORE_BYTES', 'MAX_WEBSITE_SNAPSHOT_IMPORT_BYTES',
  'MAX_BULK_SESSIONS', 'MAX_BULK_SESSION_ROWS', 'MAX_BULK_SESSION_STORE_BYTES', 'MAX_BULK_SESSION_NAME_LENGTH',
  'MAX_BULK_SESSION_TEXT_LENGTH', 'MAX_BULK_SESSION_ARRAY_VALUES', 'MAX_BULK_SESSION_SOURCES', 'MAX_BULK_PROFILE_CONTEXT_LIMITATION_LENGTH',
  'MAX_INVESTIGATION_TEMPLATES', 'MAX_INVESTIGATION_TEMPLATE_STORE_BYTES', 'MAX_INVESTIGATION_TEMPLATE_IMPORT_BYTES',
  'MAX_BULK_REVIEW_PRESETS', 'MAX_BULK_REVIEW_ROWS', 'MAX_BULK_REVIEW_STORE_BYTES', 'MAX_BULK_REVIEW_NAME_LENGTH',
  'MAX_WORKSPACE_INPUT_GRAPH_DEPTH', 'MAX_WORKSPACE_INPUT_GRAPH_NODES', 'MAX_WORKSPACE_INPUT_ARRAY_LENGTH',
  'MAX_WORKSPACE_INPUT_OBJECT_KEYS', 'MAX_WORKSPACE_INPUT_STRING_CODE_UNITS',
  'PAGE_BASELINE_VERSION', 'PAGE_IDENTITY_VERSION', 'PAGE_FINGERPRINT_VERSION', 'MAX_BASELINE_TITLE_LENGTH',
  'MAX_BASELINE_RESOURCE_HOSTS', 'MAX_BASELINE_IDENTIFIERS',
] as const);

export const WORKSPACE_DOMAIN_COMPATIBILITY_FACADES = Object.freeze([
  ['frontend/src/lib/analysis/brand-profile-model.ts', 'packages/workspace/brand-profile-model.mts'],
  ['frontend/src/lib/analysis/campaign-model.ts', 'packages/workspace/campaign-model.mts'],
  ['frontend/src/lib/analysis/watchlist-store.ts', 'packages/workspace/watchlist-store.mts'],
  ['frontend/src/lib/analysis/shortlist-model.ts', 'packages/workspace/shortlist-model.mts'],
  ['frontend/src/lib/analysis/ct-history.ts', 'packages/workspace/ct-history.mts'],
  ['frontend/src/lib/analysis/detection-rule-model.ts', 'packages/workspace/detection-rule-model.mts'],
  ['frontend/src/lib/analysis/relationship-observation-model.ts', 'packages/workspace/relationship-observation-model.mts'],
  ['frontend/src/lib/analysis/website-snapshot-model.ts', 'packages/workspace/website-snapshot-model.mts'],
  ['frontend/src/lib/analysis/bulk-session-model.ts', 'packages/workspace/bulk-session-model.mts'],
  ['frontend/src/lib/analysis/investigation-template-model.ts', 'packages/workspace/investigation-template-model.mts'],
  ['frontend/src/lib/analysis/bulk-review-model.ts', 'packages/workspace/bulk-review-model.mts'],
  ['frontend/src/lib/analysis/watchlist-history.ts', 'packages/workspace/watchlist-history.mts'],
  ['frontend/src/lib/analysis/page-baseline.ts', 'packages/workspace/page-baseline.mts'],
  ['frontend/src/lib/analysis/bulk-sort.ts', 'packages/workspace/bulk-sort.mts'],
  ['frontend/src/lib/analysis/dns-record-normalization.ts', 'packages/workspace/dns-record-normalization.mts'],
  ['frontend/src/lib/analysis/investigation-guide.ts', 'packages/workspace/investigation-guide.mts'],
] as const);

const [, CAMPAIGNS_SECTION_ID, BRAND_PROFILES_SECTION_ID, WATCHLISTS_SECTION_ID,
  SHORTLIST_SECTION_ID, DETECTION_RULES_SECTION_ID, RELATIONSHIP_OBSERVATIONS_SECTION_ID,
  BULK_SESSIONS_SECTION_ID, WEBSITE_SNAPSHOTS_SECTION_ID, INVESTIGATION_TEMPLATES_SECTION_ID,
  BULK_REVIEW_SECTION_ID] = WORKSPACE_ARCHIVE_SECTION_IDS;

export const BRAND_PROFILE_BROWSER_COMPATIBILITY = defineSchemaCompatibility({
  id: 'browser.brand-profiles', kind: 'browser_store', schema: null, currentVersion: BRAND_PROFILE_SCHEMA_VERSION,
  supportedVersions: BRAND_PROFILE_BROWSER_SUPPORTED_VERSIONS, acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current', writeSemantics: 'normalized_rewrite',
  byteBudget: MAX_PROFILE_STORE_BYTES, owner: WORKSPACE_CONTRACT_OWNER,
  note: 'Exact public version 6 profiles migrate directly to version 7, which gives each approved change window a durable opaque identity; other historical stores are outside the compatibility boundary.',
});
export const CAMPAIGN_BROWSER_COMPATIBILITY = defineSchemaCompatibility({
  id: 'browser.campaigns', kind: 'browser_store', schema: null, currentVersion: CAMPAIGN_SCHEMA_VERSION,
  supportedVersions: CAMPAIGN_BROWSER_SUPPORTED_VERSIONS, acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'preserve_without_write', migration: 'exact_current_only', writeSemantics: 'normalized_rewrite',
  byteBudget: MAX_CAMPAIGN_STORE_BYTES, owner: WORKSPACE_CONTRACT_OWNER,
  note: 'The unchanged public version 1 envelope is the browser baseline; unsupported roots and explicit future versions are preserved without write.',
});
export const WATCHLIST_BROWSER_COMPATIBILITY = defineSchemaCompatibility({
  id: 'browser.watchlists', kind: 'browser_store', schema: null, currentVersion: WATCHLIST_SCHEMA_VERSION,
  supportedVersions: WATCHLIST_BROWSER_SUPPORTED_VERSIONS, acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'preserve_without_write', migration: 'exact_current_only', writeSemantics: 'normalized_rewrite',
  byteBudget: MAX_WATCHLIST_STORE_BYTES, owner: WORKSPACE_CONTRACT_OWNER,
  note: 'The unchanged public version 2 envelope is the browser baseline; unversioned maps are outside the compatibility boundary.',
});
export const SHORTLIST_BROWSER_COMPATIBILITY = defineSchemaCompatibility({
  id: 'browser.shortlist', kind: 'browser_store', schema: null, currentVersion: SHORTLIST_SCHEMA_VERSION,
  supportedVersions: SHORTLIST_BROWSER_SUPPORTED_VERSIONS, acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'preserve_without_write', migration: 'exact_current_only', writeSemantics: 'normalized_rewrite',
  byteBudget: MAX_SHORTLIST_STORE_BYTES, owner: WORKSPACE_CONTRACT_OWNER,
  note: 'The unchanged public version 3 envelope is the browser baseline; unversioned arrays are outside the compatibility boundary.',
});
export const CT_HISTORY_BROWSER_COMPATIBILITY = defineSchemaCompatibility({
  id: 'browser.ct-history', kind: 'browser_store', schema: null, currentVersion: CT_HISTORY_SCHEMA_VERSION,
  supportedVersions: CT_HISTORY_BROWSER_SUPPORTED_VERSIONS, acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'preserve_without_write', migration: 'exact_current_only', writeSemantics: 'normalized_rewrite',
  byteBudget: MAX_CT_HISTORY_STORE_BYTES, owner: WORKSPACE_CONTRACT_OWNER,
  note: 'The unchanged public version 3 writer is the v2 browser baseline; future stores are preserved without write.',
});
export const DETECTION_RULE_BROWSER_COMPATIBILITY = defineSchemaCompatibility({
  id: 'browser.detection-rules', kind: 'browser_store', schema: null, currentVersion: DETECTION_RULE_SCHEMA_VERSION,
  supportedVersions: DETECTION_RULE_BROWSER_SUPPORTED_VERSIONS, acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'preserve_without_write', migration: 'exact_current_only', writeSemantics: 'normalized_rewrite',
  byteBudget: MAX_RULE_STORE_BYTES, owner: WORKSPACE_CONTRACT_OWNER,
  note: 'Only allowlisted structured rule fields and operators survive normalisation; the schema string belongs to portable exports.',
});
export const RELATIONSHIP_OBSERVATION_BROWSER_COMPATIBILITY = defineSchemaCompatibility({
  id: 'browser.relationship-observations', kind: 'browser_store', schema: null,
  currentVersion: RELATIONSHIP_OBSERVATION_SCHEMA_VERSION, supportedVersions: RELATIONSHIP_OBSERVATION_BROWSER_SUPPORTED_VERSIONS,
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'preserve_without_write', migration: 'exact_current_only',
  writeSemantics: 'normalized_rewrite', byteBudget: MAX_RELATIONSHIP_OBSERVATION_STORE_BYTES, owner: WORKSPACE_CONTRACT_OWNER,
  note: 'Only explicit analyst selections from bounded Bulk relationship evidence are retained; identities are re-derived from normalised values and members.',
});
export const WEBSITE_SNAPSHOT_BROWSER_COMPATIBILITY = defineSchemaCompatibility({
  id: 'browser.website-snapshots', kind: 'browser_store', schema: null,
  currentVersion: WEBSITE_SNAPSHOT_SCHEMA_VERSION, supportedVersions: WEBSITE_SNAPSHOT_BROWSER_SUPPORTED_VERSIONS,
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'preserve_without_write', migration: 'normalize_to_current',
  writeSemantics: 'normalized_rewrite', byteBudget: MAX_WEBSITE_SNAPSHOT_STORE_BYTES, owner: WORKSPACE_CONTRACT_OWNER,
  note: 'Public version 4 records normalise to version 5 with explicit unknown profile provenance; raw lookup payloads, contact data, certificate bytes, and fetched bodies remain excluded.',
});
export const BULK_SESSION_BROWSER_COMPATIBILITY = defineSchemaCompatibility({
  id: 'browser.bulk-sessions', kind: 'browser_store', schema: null, currentVersion: BULK_SESSION_SCHEMA_VERSION,
  supportedVersions: BULK_SESSION_BROWSER_SUPPORTED_VERSIONS, acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'preserve_without_write', migration: 'exact_current_only', writeSemantics: 'normalized_rewrite',
  byteBudget: MAX_BULK_SESSION_STORE_BYTES, owner: WORKSPACE_CONTRACT_OWNER,
  note: 'The unchanged public schema 4 writer is the exact browser baseline with bounded Brand Profile provenance; unsupported local checkpoints are preserved without rewrite.',
});
export const INVESTIGATION_TEMPLATE_BROWSER_COMPATIBILITY = defineSchemaCompatibility({
  id: 'browser.investigation-templates', kind: 'browser_store', schema: null,
  currentVersion: INVESTIGATION_TEMPLATE_VERSION, supportedVersions: INVESTIGATION_TEMPLATE_SUPPORTED_VERSIONS,
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'preserve_without_write', migration: 'exact_current_only',
  writeSemantics: 'normalized_rewrite', byteBudget: MAX_INVESTIGATION_TEMPLATE_STORE_BYTES, owner: WORKSPACE_CONTRACT_OWNER,
  note: 'Version 2 adds the fixed response-playbook recipe identifiers. Analyst-authored guidance remains bound to allowlisted built-in stages and cannot run code, start collection, submit evidence, or remove mandatory request gates.',
});
export const BULK_REVIEW_BROWSER_COMPATIBILITY = defineSchemaCompatibility({
  id: 'browser.bulk-review', kind: 'browser_store', schema: null, currentVersion: BULK_REVIEW_SCHEMA_VERSION,
  supportedVersions: BULK_REVIEW_BROWSER_SUPPORTED_VERSIONS, acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'preserve_without_write', migration: 'exact_current_only', writeSemantics: 'normalized_rewrite',
  byteBudget: MAX_BULK_REVIEW_STORE_BYTES, owner: WORKSPACE_CONTRACT_OWNER,
  note: 'Bounded saved Bulk filter views and per-domain review states only; scan results, contacts, notes, and case disposition remain separate.',
});

export const BRAND_PROFILE_EXPORT_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.brand-profiles', kind: 'export', schema: BRAND_PROFILE_SCHEMA, currentVersion: BRAND_PROFILE_SCHEMA_VERSION,
  supportedVersions: SUPPORTED_BRAND_PROFILE_SCHEMA_VERSIONS, acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'reject', migration: 'normalize_to_current', writeSemantics: 'non_destructive_merge',
  byteBudget: MAX_PROFILE_IMPORT_BYTES, owner: WORKSPACE_CONTRACT_OWNER,
  note: 'Supported exports merge non-destructively by bounded normalised profile identity.',
});
export const CAMPAIGN_EXPORT_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.campaigns', kind: 'export', schema: CAMPAIGN_SCHEMA, currentVersion: CAMPAIGN_SCHEMA_VERSION,
  supportedVersions: CAMPAIGN_EXPORT_SUPPORTED_VERSIONS, acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'non_destructive_merge',
  byteBudget: MAX_CAMPAIGN_IMPORT_BYTES, owner: WORKSPACE_CONTRACT_OWNER,
  note: 'The unchanged public version 1 campaign export merges non-destructively by bounded campaign identity.',
});
export const WATCHLIST_EXPORT_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.watchlists', kind: 'export', schema: WATCHLIST_SCHEMA, currentVersion: WATCHLIST_SCHEMA_VERSION,
  supportedVersions: WATCHLIST_EXPORT_SUPPORTED_VERSIONS, acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'non_destructive_merge',
  byteBudget: MAX_WATCHLIST_IMPORT_BYTES, owner: WORKSPACE_CONTRACT_OWNER,
  note: 'Non-destructive collection merge with current schema required.',
});
export const SHORTLIST_EXPORT_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.shortlist', kind: 'export', schema: SHORTLIST_SCHEMA, currentVersion: SHORTLIST_SCHEMA_VERSION,
  supportedVersions: SUPPORTED_SHORTLIST_SCHEMA_VERSIONS, acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'non_destructive_merge',
  byteBudget: MAX_SHORTLIST_IMPORT_BYTES, owner: WORKSPACE_CONTRACT_OWNER,
  note: 'The unchanged public schema 3 shortlist export merges bounded domain records non-destructively.',
});
export const DETECTION_RULE_EXPORT_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.detection-rules', kind: 'export', schema: DETECTION_RULE_SCHEMA, currentVersion: DETECTION_RULE_SCHEMA_VERSION,
  supportedVersions: DETECTION_RULE_EXPORT_SUPPORTED_VERSIONS, acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'non_destructive_merge',
  byteBudget: MAX_RULE_IMPORT_BYTES, owner: WORKSPACE_CONTRACT_OWNER,
  note: 'Non-destructive rule merge; imported conditions remain allowlisted and non-executable.',
});
export const RELATIONSHIP_OBSERVATION_EXPORT_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.relationship-observations', kind: 'export', schema: RELATIONSHIP_OBSERVATION_SCHEMA,
  currentVersion: RELATIONSHIP_OBSERVATION_SCHEMA_VERSION, supportedVersions: RELATIONSHIP_OBSERVATION_EXPORT_SUPPORTED_VERSIONS,
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only',
  writeSemantics: 'non_destructive_merge', byteBudget: MAX_RELATIONSHIP_OBSERVATION_STORE_BYTES, owner: WORKSPACE_CONTRACT_OWNER,
  note: 'Workspace-archive section for bounded analyst-selected derived pivots; raw scan and lookup responses are excluded.',
});
export const WEBSITE_SNAPSHOT_EXPORT_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.website-snapshots', kind: 'export', schema: WEBSITE_SNAPSHOT_SCHEMA,
  currentVersion: WEBSITE_SNAPSHOT_SCHEMA_VERSION, supportedVersions: SUPPORTED_WEBSITE_SNAPSHOT_SCHEMA_VERSIONS,
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'normalize_to_current',
  writeSemantics: 'non_destructive_merge', byteBudget: MAX_WEBSITE_SNAPSHOT_IMPORT_BYTES, owner: WORKSPACE_CONTRACT_OWNER,
  note: 'Public schema 4 archive sections normalise to version 5 with explicit unknown profile provenance and merge non-destructively without retaining fetched bodies.',
});
export const BULK_SESSION_EXPORT_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.bulk-sessions', kind: 'export', schema: BULK_SESSION_SCHEMA, currentVersion: BULK_SESSION_SCHEMA_VERSION,
  supportedVersions: SUPPORTED_BULK_SESSION_SCHEMA_VERSIONS, acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'non_destructive_merge',
  byteBudget: MAX_BULK_SESSION_STORE_BYTES, owner: WORKSPACE_CONTRACT_OWNER,
  note: 'The unchanged public schema 4 portable sessions retain explicit source states, comparison limitations, and bounded profile-context provenance.',
});
export const INVESTIGATION_TEMPLATE_EXPORT_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.investigation-templates', kind: 'export', schema: INVESTIGATION_TEMPLATE_SCHEMA,
  currentVersion: INVESTIGATION_TEMPLATE_VERSION, supportedVersions: INVESTIGATION_TEMPLATE_SUPPORTED_VERSIONS,
  acceptsUnversionedLegacy: false, futureVersionBehavior: 'reject', migration: 'exact_current_only',
  writeSemantics: 'non_destructive_merge', byteBudget: MAX_INVESTIGATION_TEMPLATE_IMPORT_BYTES, owner: WORKSPACE_CONTRACT_OWNER,
  note: 'The unchanged public version 2 writer remains the exact bounded analyst-authored guide baseline with allowlisted stage identities and request gates.',
});
export const BULK_REVIEW_EXPORT_COMPATIBILITY = defineSchemaCompatibility({
  id: 'export.bulk-review', kind: 'export', schema: BULK_REVIEW_SCHEMA, currentVersion: BULK_REVIEW_SCHEMA_VERSION,
  supportedVersions: BULK_REVIEW_EXPORT_SUPPORTED_VERSIONS, acceptsUnversionedLegacy: false,
  futureVersionBehavior: 'reject', migration: 'exact_current_only', writeSemantics: 'non_destructive_merge',
  byteBudget: MAX_BULK_REVIEW_STORE_BYTES, owner: WORKSPACE_CONTRACT_OWNER,
  note: 'Workspace-archive section for saved Bulk views and explicit review states; network collection and case disposition are never changed by import.',
});

export const WORKSPACE_PORTABILITY_COMPATIBILITY = Object.freeze([
  BRAND_PROFILE_BROWSER_COMPATIBILITY, CAMPAIGN_BROWSER_COMPATIBILITY, WATCHLIST_BROWSER_COMPATIBILITY,
  SHORTLIST_BROWSER_COMPATIBILITY, CT_HISTORY_BROWSER_COMPATIBILITY, DETECTION_RULE_BROWSER_COMPATIBILITY,
  RELATIONSHIP_OBSERVATION_BROWSER_COMPATIBILITY, WEBSITE_SNAPSHOT_BROWSER_COMPATIBILITY,
  BULK_SESSION_BROWSER_COMPATIBILITY, INVESTIGATION_TEMPLATE_BROWSER_COMPATIBILITY, BULK_REVIEW_BROWSER_COMPATIBILITY,
  BRAND_PROFILE_EXPORT_COMPATIBILITY, CAMPAIGN_EXPORT_COMPATIBILITY, WATCHLIST_EXPORT_COMPATIBILITY,
  SHORTLIST_EXPORT_COMPATIBILITY, DETECTION_RULE_EXPORT_COMPATIBILITY, RELATIONSHIP_OBSERVATION_EXPORT_COMPATIBILITY,
  WEBSITE_SNAPSHOT_EXPORT_COMPATIBILITY, BULK_SESSION_EXPORT_COMPATIBILITY,
  INVESTIGATION_TEMPLATE_EXPORT_COMPATIBILITY, BULK_REVIEW_EXPORT_COMPATIBILITY,
] as const);

function archiveSectionReference(
  sectionId: string,
  descriptor: typeof WORKSPACE_PORTABILITY_COMPATIBILITY[number],
) {
  if (!descriptor.schema) throw new TypeError(`Workspace archive section ${sectionId} must name a portable schema.`);
  return Object.freeze({
    sectionId,
    schema: descriptor.schema,
    version: descriptor.currentVersion,
    supportedVersions: descriptor.supportedVersions,
  });
}

export const WORKSPACE_PORTABILITY_ARCHIVE_SECTION_REFERENCES = Object.freeze([
  archiveSectionReference(CAMPAIGNS_SECTION_ID, CAMPAIGN_EXPORT_COMPATIBILITY),
  archiveSectionReference(BRAND_PROFILES_SECTION_ID, BRAND_PROFILE_EXPORT_COMPATIBILITY),
  archiveSectionReference(WATCHLISTS_SECTION_ID, WATCHLIST_EXPORT_COMPATIBILITY),
  archiveSectionReference(SHORTLIST_SECTION_ID, SHORTLIST_EXPORT_COMPATIBILITY),
  archiveSectionReference(DETECTION_RULES_SECTION_ID, DETECTION_RULE_EXPORT_COMPATIBILITY),
  archiveSectionReference(RELATIONSHIP_OBSERVATIONS_SECTION_ID, RELATIONSHIP_OBSERVATION_EXPORT_COMPATIBILITY),
  archiveSectionReference(BULK_SESSIONS_SECTION_ID, BULK_SESSION_EXPORT_COMPATIBILITY),
  archiveSectionReference(WEBSITE_SNAPSHOTS_SECTION_ID, WEBSITE_SNAPSHOT_EXPORT_COMPATIBILITY),
  archiveSectionReference(INVESTIGATION_TEMPLATES_SECTION_ID, INVESTIGATION_TEMPLATE_EXPORT_COMPATIBILITY),
  archiveSectionReference(BULK_REVIEW_SECTION_ID, BULK_REVIEW_EXPORT_COMPATIBILITY),
]);

export function serialiseWorkspacePortableJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function serialiseWorkspacePortableJsonLine(value: unknown): string {
  return `${serialiseWorkspacePortableJson(value)}\n`;
}
type WorkspaceLifecycleItemBound = Readonly<{
  id: string;
  path: string;
  maximum: number;
  handling: 'drop_value' | 'reject' | 'truncate';
}>;

type WorkspaceLifecyclePortableDefinition = Readonly<{
  descriptor: SchemaCompatibilityDescriptor;
  schema: string;
  builder: string;
  merger: string;
  serializerHookId: 'workspace.portable.json' | 'workspace.portable.json-line' | 'workspace.portable.archive-section';
  indentSpaces: 0 | 2;
  terminalLf: boolean;
}>;

type WorkspaceLifecycleDefinition = Readonly<{
  slug: string;
  browserDescriptor: SchemaCompatibilityDescriptor;
  browserSchema: string;
  collectionKey: string;
  module: string;
  normalizer: string;
  serializer: string;
  itemBounds: readonly WorkspaceLifecycleItemBound[];
  portable: WorkspaceLifecyclePortableDefinition | null;
}>;

const WORKSPACE_LIFECYCLE_DEFINITIONS: readonly WorkspaceLifecycleDefinition[] = Object.freeze([
  {
    slug: 'brand',
    browserDescriptor: BRAND_PROFILE_BROWSER_COMPATIBILITY,
    browserSchema: BRAND_PROFILE_BROWSER_STORE_LIFECYCLE_SCHEMA,
    collectionKey: 'profiles',
    module: 'packages/workspace/brand-profile-model.mts',
    normalizer: 'normalizeBrandProfileStore',
    serializer: 'serializeBrandProfileStore',
    itemBounds: [
      { id: 'profiles', path: 'profiles', maximum: MAX_PROFILES, handling: 'truncate' },
      { id: 'profile-values', path: 'profiles[].values', maximum: MAX_PROFILE_VALUES, handling: 'truncate' },
    ],
    portable: {
      descriptor: BRAND_PROFILE_EXPORT_COMPATIBILITY,
      schema: BRAND_PROFILE_SCHEMA,
      builder: 'buildBrandProfileExport',
      merger: 'mergeBrandProfiles',
      serializerHookId: 'workspace.portable.json',
      indentSpaces: 2,
      terminalLf: false,
    },
  },
  {
    slug: 'campaign',
    browserDescriptor: CAMPAIGN_BROWSER_COMPATIBILITY,
    browserSchema: CAMPAIGN_BROWSER_STORE_LIFECYCLE_SCHEMA,
    collectionKey: 'campaigns',
    module: 'packages/workspace/campaign-model.mts',
    normalizer: 'normalizeCampaignStore',
    serializer: 'serializeCampaignStore',
    itemBounds: [
      { id: 'campaigns', path: 'campaigns', maximum: MAX_CAMPAIGNS, handling: 'truncate' },
      { id: 'domains', path: 'campaigns[].domains', maximum: MAX_CAMPAIGN_DOMAINS, handling: 'truncate' },
    ],
    portable: {
      descriptor: CAMPAIGN_EXPORT_COMPATIBILITY,
      schema: CAMPAIGN_SCHEMA,
      builder: 'buildCampaignExport',
      merger: 'mergeCampaigns',
      serializerHookId: 'workspace.portable.json',
      indentSpaces: 2,
      terminalLf: false,
    },
  },
  {
    slug: 'watchlist',
    browserDescriptor: WATCHLIST_BROWSER_COMPATIBILITY,
    browserSchema: WATCHLIST_BROWSER_STORE_LIFECYCLE_SCHEMA,
    collectionKey: 'watchlists',
    module: 'packages/workspace/watchlist-store.mts',
    normalizer: 'normalizeWatchlistStore',
    serializer: 'serializeWatchlistStore',
    itemBounds: [
      { id: 'watchlists', path: 'watchlists', maximum: MAX_WATCHLISTS, handling: 'truncate' },
      { id: 'domains', path: 'watchlists[].results', maximum: MAX_WATCHLIST_DOMAINS, handling: 'drop_value' },
      { id: 'history', path: 'watchlists[].history', maximum: MAX_WATCHLIST_HISTORY_EVENTS, handling: 'truncate' },
    ],
    portable: {
      descriptor: WATCHLIST_EXPORT_COMPATIBILITY,
      schema: WATCHLIST_SCHEMA,
      builder: 'buildWatchlistExport',
      merger: 'mergeWatchlistStores',
      serializerHookId: 'workspace.portable.json',
      indentSpaces: 2,
      terminalLf: false,
    },
  },
  {
    slug: 'shortlist',
    browserDescriptor: SHORTLIST_BROWSER_COMPATIBILITY,
    browserSchema: SHORTLIST_BROWSER_STORE_LIFECYCLE_SCHEMA,
    collectionKey: 'entries',
    module: 'packages/workspace/shortlist-model.mts',
    normalizer: 'normalizeShortlistStore',
    serializer: 'serializeShortlistStore',
    itemBounds: [
      { id: 'entries', path: 'entries', maximum: MAX_SHORTLIST_ENTRIES, handling: 'truncate' },
      { id: 'factors', path: 'entries[].riskFactors', maximum: MAX_SHORTLIST_FACTORS, handling: 'truncate' },
    ],
    portable: {
      descriptor: SHORTLIST_EXPORT_COMPATIBILITY,
      schema: SHORTLIST_SCHEMA,
      builder: 'buildShortlistExport',
      merger: 'mergeShortlistStores',
      serializerHookId: 'workspace.portable.json',
      indentSpaces: 2,
      terminalLf: false,
    },
  },
  {
    slug: 'ct',
    browserDescriptor: CT_HISTORY_BROWSER_COMPATIBILITY,
    browserSchema: CT_HISTORY_BROWSER_STORE_LIFECYCLE_SCHEMA,
    collectionKey: 'entries',
    module: 'packages/workspace/ct-history.mts',
    normalizer: 'normalizeCtHistoryStore',
    serializer: 'serializeCtHistoryStore',
    itemBounds: [
      { id: 'searches', path: 'entries', maximum: MAX_CT_HISTORY_SEARCHES, handling: 'truncate' },
      { id: 'events', path: 'entries[].history', maximum: MAX_CT_HISTORY_EVENTS, handling: 'truncate' },
      { id: 'domains', path: 'entries[].domains', maximum: MAX_CT_HISTORY_DOMAINS, handling: 'truncate' },
      { id: 'ever-seen-domains', path: 'entries[].everSeenDomains', maximum: MAX_CT_HISTORY_EVER_SEEN_DOMAINS, handling: 'truncate' },
    ],
    portable: null,
  },
  {
    slug: 'detection',
    browserDescriptor: DETECTION_RULE_BROWSER_COMPATIBILITY,
    browserSchema: DETECTION_RULE_BROWSER_STORE_LIFECYCLE_SCHEMA,
    collectionKey: 'rules',
    module: 'packages/workspace/detection-rule-model.mts',
    normalizer: 'normalizeDetectionRuleStore',
    serializer: 'serializeDetectionRuleStore',
    itemBounds: [
      { id: 'rules', path: 'rules', maximum: MAX_DETECTION_RULES, handling: 'truncate' },
      { id: 'conditions', path: 'rules[].conditions', maximum: MAX_RULE_CONDITIONS, handling: 'truncate' },
    ],
    portable: {
      descriptor: DETECTION_RULE_EXPORT_COMPATIBILITY,
      schema: DETECTION_RULE_SCHEMA,
      builder: 'buildDetectionRuleExport',
      merger: 'mergeDetectionRules',
      serializerHookId: 'workspace.portable.json',
      indentSpaces: 2,
      terminalLf: false,
    },
  },
  {
    slug: 'relationship',
    browserDescriptor: RELATIONSHIP_OBSERVATION_BROWSER_COMPATIBILITY,
    browserSchema: RELATIONSHIP_OBSERVATION_BROWSER_STORE_LIFECYCLE_SCHEMA,
    collectionKey: 'observations',
    module: 'packages/workspace/relationship-observation-model.mts',
    normalizer: 'normalizeRelationshipObservationStore',
    serializer: 'serializeRelationshipObservationStore',
    itemBounds: [
      { id: 'observations', path: 'observations', maximum: MAX_RELATIONSHIP_OBSERVATIONS, handling: 'truncate' },
      { id: 'domains', path: 'observations[].domains', maximum: MAX_RELATIONSHIP_OBSERVATION_DOMAINS, handling: 'truncate' },
      { id: 'limitations', path: 'observations[].limitations', maximum: MAX_RELATIONSHIP_OBSERVATION_LIMITATIONS, handling: 'truncate' },
    ],
    portable: {
      descriptor: RELATIONSHIP_OBSERVATION_EXPORT_COMPATIBILITY,
      schema: RELATIONSHIP_OBSERVATION_SCHEMA,
      builder: 'buildRelationshipObservationExport',
      merger: 'mergeRelationshipObservations',
      serializerHookId: 'workspace.portable.archive-section',
      indentSpaces: 0,
      terminalLf: false,
    },
  },
  {
    slug: 'website',
    browserDescriptor: WEBSITE_SNAPSHOT_BROWSER_COMPATIBILITY,
    browserSchema: WEBSITE_SNAPSHOT_BROWSER_STORE_LIFECYCLE_SCHEMA,
    collectionKey: 'snapshots',
    module: 'packages/workspace/website-snapshot-model.mts',
    normalizer: 'normalizeWebsiteSnapshotStore',
    serializer: 'serializeWebsiteSnapshotStore',
    itemBounds: [
      { id: 'snapshots', path: 'snapshots', maximum: MAX_WEBSITE_SNAPSHOTS, handling: 'truncate' },
      { id: 'snapshots-per-domain', path: 'snapshotsByDomain', maximum: MAX_WEBSITE_SNAPSHOTS_PER_DOMAIN, handling: 'truncate' },
    ],
    portable: {
      descriptor: WEBSITE_SNAPSHOT_EXPORT_COMPATIBILITY,
      schema: WEBSITE_SNAPSHOT_SCHEMA,
      builder: 'buildWebsiteSnapshotExport',
      merger: 'mergeWebsiteSnapshots',
      serializerHookId: 'workspace.portable.json',
      indentSpaces: 2,
      terminalLf: false,
    },
  },
  {
    slug: 'bulk',
    browserDescriptor: BULK_SESSION_BROWSER_COMPATIBILITY,
    browserSchema: BULK_SESSION_BROWSER_STORE_LIFECYCLE_SCHEMA,
    collectionKey: 'sessions',
    module: 'packages/workspace/bulk-session-model.mts',
    normalizer: 'normalizeBulkSessionStore',
    serializer: 'serializeBulkSessionStore',
    itemBounds: [
      { id: 'sessions', path: 'sessions', maximum: MAX_BULK_SESSIONS, handling: 'truncate' },
      { id: 'rows', path: 'sessions[].results', maximum: MAX_BULK_SESSION_ROWS, handling: 'truncate' },
    ],
    portable: {
      descriptor: BULK_SESSION_EXPORT_COMPATIBILITY,
      schema: BULK_SESSION_SCHEMA,
      builder: 'buildBulkSessionExport',
      merger: 'mergeBulkSessions',
      serializerHookId: 'workspace.portable.json-line',
      indentSpaces: 2,
      terminalLf: true,
    },
  },
  {
    slug: 'template',
    browserDescriptor: INVESTIGATION_TEMPLATE_BROWSER_COMPATIBILITY,
    browserSchema: INVESTIGATION_TEMPLATE_BROWSER_STORE_LIFECYCLE_SCHEMA,
    collectionKey: 'templates',
    module: 'packages/workspace/investigation-template-model.mts',
    normalizer: 'normalizeInvestigationTemplateStore',
    serializer: 'serializeInvestigationTemplateStore',
    itemBounds: [
      { id: 'templates', path: 'templates', maximum: MAX_INVESTIGATION_TEMPLATES, handling: 'truncate' },
    ],
    portable: {
      descriptor: INVESTIGATION_TEMPLATE_EXPORT_COMPATIBILITY,
      schema: INVESTIGATION_TEMPLATE_SCHEMA,
      builder: 'buildInvestigationTemplateExport',
      merger: 'mergeInvestigationTemplates',
      serializerHookId: 'workspace.portable.json-line',
      indentSpaces: 2,
      terminalLf: true,
    },
  },
  {
    slug: 'review',
    browserDescriptor: BULK_REVIEW_BROWSER_COMPATIBILITY,
    browserSchema: BULK_REVIEW_BROWSER_STORE_LIFECYCLE_SCHEMA,
    collectionKey: 'presets',
    module: 'packages/workspace/bulk-review-model.mts',
    normalizer: 'normalizeBulkReviewStore',
    serializer: 'serializeBulkReviewStore',
    itemBounds: [
      { id: 'presets', path: 'presets', maximum: MAX_BULK_REVIEW_PRESETS, handling: 'truncate' },
      { id: 'rows', path: 'rows', maximum: MAX_BULK_REVIEW_ROWS, handling: 'truncate' },
    ],
    portable: {
      descriptor: BULK_REVIEW_EXPORT_COMPATIBILITY,
      schema: BULK_REVIEW_SCHEMA,
      builder: 'buildBulkReviewExport',
      merger: 'mergeBulkReviewStores',
      serializerHookId: 'workspace.portable.archive-section',
      indentSpaces: 0,
      terminalLf: false,
    },
  },
]);

const WORKSPACE_LIFECYCLE_FIXTURE_SOURCE: readonly SchemaLifecycleFixtureV4[] = Object.freeze([
  {
    "id": "workspace.browser.brand.v6",
    "path": "test/fixtures/workspace-lifecycle/browser-brand-v6.json",
    "bytes": 37,
    "sha256": "624d0b889df19b0f1abfd4026a4dd868003188ed4f4294f6e912589255847df9",
    "contentDigestSha256": null,
    "schema": "whoisleuth.browser.brand-profile-store",
    "version": 6,
    "role": "historical",
    "expectation": "normalises_to_current_output",
    "expectedOutputFixtureId": "workspace.browser.brand.v7",
    "scope": "repository",
    "shapeId": "workspace.browser.brand.shape"
  },
  {
    "id": "workspace.browser.brand.v7",
    "path": "test/fixtures/workspace-lifecycle/browser-brand-v7.json",
    "bytes": 37,
    "sha256": "c866b2aff3dad05236114e96d3997a1c6af571658b38faa6aeb3c224d125a46b",
    "contentDigestSha256": null,
    "schema": "whoisleuth.browser.brand-profile-store",
    "version": 7,
    "role": "current",
    "expectation": "accepted_exact",
    "expectedOutputFixtureId": null,
    "scope": "repository",
    "shapeId": "workspace.browser.brand.shape"
  },
  {
    "id": "workspace.browser.bulk.v4",
    "path": "test/fixtures/workspace-lifecycle/browser-bulk-v4.json",
    "bytes": 77,
    "sha256": "605442d181a35a1809edb2ff0b5be17920d52f04276cacaf1786dcc41d3c96ec",
    "contentDigestSha256": null,
    "schema": "whoisleuth.browser.bulk-session-store",
    "version": 4,
    "role": "current",
    "expectation": "accepted_exact",
    "expectedOutputFixtureId": null,
    "scope": "repository",
    "shapeId": "workspace.browser.bulk.shape"
  },
  {
    "id": "workspace.browser.campaign.v1",
    "path": "test/fixtures/workspace-lifecycle/browser-campaign-v1.json",
    "bytes": 38,
    "sha256": "c9f2a2f619c6237230e609a68c895c819472eba644ac4185b3eac3af256c7709",
    "contentDigestSha256": null,
    "schema": "whoisleuth.browser.campaign-store",
    "version": 1,
    "role": "current",
    "expectation": "accepted_exact",
    "expectedOutputFixtureId": null,
    "scope": "repository",
    "shapeId": "workspace.browser.campaign.shape"
  },
  {
    "id": "workspace.browser.ct.v3",
    "path": "test/fixtures/workspace-lifecycle/browser-ct-v3.json",
    "bytes": 36,
    "sha256": "48e7de97a1b64878f450f12238f7c9f5a41b85e07db3b86b0bc95ca5a5630685",
    "contentDigestSha256": null,
    "schema": "whoisleuth.browser.ct-history-store",
    "version": 3,
    "role": "current",
    "expectation": "accepted_exact",
    "expectedOutputFixtureId": null,
    "scope": "repository",
    "shapeId": "workspace.browser.ct.shape"
  },
  {
    "id": "workspace.browser.detection.v1",
    "path": "test/fixtures/workspace-lifecycle/browser-detection-v1.json",
    "bytes": 34,
    "sha256": "8772df49af2416bdf2f4881dd6f70452b3a0a8c31cf93f4aa1d7cb40ba0537a4",
    "contentDigestSha256": null,
    "schema": "whoisleuth.browser.detection-rule-store",
    "version": 1,
    "role": "current",
    "expectation": "accepted_exact",
    "expectedOutputFixtureId": null,
    "scope": "repository",
    "shapeId": "workspace.browser.detection.shape"
  },
  {
    "id": "workspace.browser.relationship.v1",
    "path": "test/fixtures/workspace-lifecycle/browser-relationship-v1.json",
    "bytes": 41,
    "sha256": "d26f28d5d0a654c2b2eab004f2e1a72c05845f433e8b47716f416b7271142668",
    "contentDigestSha256": null,
    "schema": "whoisleuth.browser.relationship-observation-store",
    "version": 1,
    "role": "current",
    "expectation": "accepted_exact",
    "expectedOutputFixtureId": null,
    "scope": "repository",
    "shapeId": "workspace.browser.relationship.shape"
  },
  {
    "id": "workspace.browser.review.v1",
    "path": "test/fixtures/workspace-lifecycle/browser-review-v1.json",
    "bytes": 88,
    "sha256": "9da86165eee183509ad3770b4f7bcf5296040c16ac108024e10b97c54c653609",
    "contentDigestSha256": null,
    "schema": "whoisleuth.browser.bulk-review-store",
    "version": 1,
    "role": "current",
    "expectation": "accepted_exact",
    "expectedOutputFixtureId": null,
    "scope": "repository",
    "shapeId": "workspace.browser.review.shape"
  },
  {
    "id": "workspace.browser.shortlist.v3",
    "path": "test/fixtures/workspace-lifecycle/browser-shortlist-v3.json",
    "bytes": 72,
    "sha256": "8ee7f00e2cdd899893549823df9699cf800a392e8a74cbe2907d2a8b2340ebca",
    "contentDigestSha256": null,
    "schema": "whoisleuth.browser.shortlist-store",
    "version": 3,
    "role": "current",
    "expectation": "accepted_exact",
    "expectedOutputFixtureId": null,
    "scope": "repository",
    "shapeId": "workspace.browser.shortlist.shape"
  },
  {
    "id": "workspace.browser.template.v2",
    "path": "test/fixtures/workspace-lifecycle/browser-template-v2.json",
    "bytes": 88,
    "sha256": "52c1a5a671bf3bd0d052fb7c75d746ed3527898b18ba6532fa9103bd240920aa",
    "contentDigestSha256": null,
    "schema": "whoisleuth.browser.investigation-template-store",
    "version": 2,
    "role": "current",
    "expectation": "accepted_exact",
    "expectedOutputFixtureId": null,
    "scope": "repository",
    "shapeId": "workspace.browser.template.shape"
  },
  {
    "id": "workspace.browser.watchlist.v2",
    "path": "test/fixtures/workspace-lifecycle/browser-watchlist-v2.json",
    "bytes": 76,
    "sha256": "230e7b6c83659a096e2ccd0da251558088f38b24e438c713bba1012fea788b2c",
    "contentDigestSha256": null,
    "schema": "whoisleuth.browser.watchlist-store",
    "version": 2,
    "role": "current",
    "expectation": "accepted_exact",
    "expectedOutputFixtureId": null,
    "scope": "repository",
    "shapeId": "workspace.browser.watchlist.shape"
  },
  {
    "id": "workspace.browser.website.v4",
    "path": "test/fixtures/workspace-lifecycle/browser-website-v4.json",
    "bytes": 90,
    "sha256": "b6f1aa0f80fa902c085d831c7bb3334b7c95db49906ffc8dd452173f423b85a4",
    "contentDigestSha256": null,
    "schema": "whoisleuth.browser.website-snapshot-store",
    "version": 4,
    "role": "historical",
    "expectation": "normalises_to_current_output",
    "expectedOutputFixtureId": "workspace.browser.website.v5",
    "scope": "repository",
    "shapeId": "workspace.browser.website.shape"
  },
  {
    "id": "workspace.browser.website.v5",
    "path": "test/fixtures/workspace-lifecycle/browser-website-v5.json",
    "bytes": 90,
    "sha256": "16550a8c24d5c7bcfe271086071fee7f3392279990cc6fe91e3b9c95f07d0759",
    "contentDigestSha256": null,
    "schema": "whoisleuth.browser.website-snapshot-store",
    "version": 5,
    "role": "current",
    "expectation": "accepted_exact",
    "expectedOutputFixtureId": null,
    "scope": "repository",
    "shapeId": "workspace.browser.website.shape"
  },
  {
    "id": "workspace.portable.brand.v6",
    "path": "test/fixtures/workspace-lifecycle/portable-brand-v6.json",
    "bytes": 122,
    "sha256": "19e8ab9772bcb07d989249576feab1d71a1a62d401a1a1a7cecf1c65cd7d5f80",
    "contentDigestSha256": null,
    "schema": "whoisleuth.brand-profiles",
    "version": 6,
    "role": "historical",
    "expectation": "normalises_to_current_output",
    "expectedOutputFixtureId": "workspace.portable.brand.v7",
    "scope": "repository",
    "shapeId": "workspace.portable.brand.shape"
  },
  {
    "id": "workspace.portable.brand.v7",
    "path": "test/fixtures/workspace-lifecycle/portable-brand-v7.json",
    "bytes": 122,
    "sha256": "49db0b0a2d5c00da9dc55fd5b03702d7412550e17329b917567acf6c4ec3ebb9",
    "contentDigestSha256": null,
    "schema": "whoisleuth.brand-profiles",
    "version": 7,
    "role": "current",
    "expectation": "accepted_exact",
    "expectedOutputFixtureId": null,
    "scope": "repository",
    "shapeId": "workspace.portable.brand.shape"
  },
  {
    "id": "workspace.portable.bulk.v4",
    "path": "test/fixtures/workspace-lifecycle/portable-bulk-v4.json",
    "bytes": 338,
    "sha256": "5b3adc2e58c2e47399cf8c0634225dd6cad18d6189d55520603b914a6e719785",
    "contentDigestSha256": null,
    "schema": "whoisleuth.bulk-sessions",
    "version": 4,
    "role": "current",
    "expectation": "accepted_exact",
    "expectedOutputFixtureId": null,
    "scope": "repository",
    "shapeId": "workspace.portable.bulk.shape"
  },
  {
    "id": "workspace.portable.campaign.v1",
    "path": "test/fixtures/workspace-lifecycle/portable-campaign-v1.json",
    "bytes": 281,
    "sha256": "2a0618a9f639cd8375eb46f9bdd5fc9fbb5d8f9ce347f1b93c2d760a91162ccd",
    "contentDigestSha256": null,
    "schema": "whoisleuth.campaigns",
    "version": 1,
    "role": "current",
    "expectation": "accepted_exact",
    "expectedOutputFixtureId": null,
    "scope": "repository",
    "shapeId": "workspace.portable.campaign.shape"
  },
  {
    "id": "workspace.portable.detection.v1",
    "path": "test/fixtures/workspace-lifecycle/portable-detection-v1.json",
    "bytes": 293,
    "sha256": "0c1306057547a5bf4a5c8c37f5bfaf9195a15a4971adc8e5c9085e8e87946508",
    "contentDigestSha256": null,
    "schema": "whoisleuth.detection-rules",
    "version": 1,
    "role": "current",
    "expectation": "accepted_exact",
    "expectedOutputFixtureId": null,
    "scope": "repository",
    "shapeId": "workspace.portable.detection.shape"
  },
  {
    "id": "workspace.portable.relationship.v1",
    "path": "test/fixtures/workspace-lifecycle/portable-relationship-v1.json",
    "bytes": 363,
    "sha256": "d16411297ec5be4eb0c87dbc36e1ed34e55ef3699084af2d5f18d76b042d398a",
    "contentDigestSha256": null,
    "schema": "whoisleuth.relationship-observations",
    "version": 1,
    "role": "current",
    "expectation": "accepted_exact",
    "expectedOutputFixtureId": null,
    "scope": "repository",
    "shapeId": "workspace.portable.relationship.shape"
  },
  {
    "id": "workspace.portable.review.v1",
    "path": "test/fixtures/workspace-lifecycle/portable-review-v1.json",
    "bytes": 88,
    "sha256": "9da86165eee183509ad3770b4f7bcf5296040c16ac108024e10b97c54c653609",
    "contentDigestSha256": null,
    "schema": "whoisleuth.bulk-review",
    "version": 1,
    "role": "current",
    "expectation": "accepted_exact",
    "expectedOutputFixtureId": null,
    "scope": "repository",
    "shapeId": "workspace.portable.review.shape"
  },
  {
    "id": "workspace.portable.shortlist.v3",
    "path": "test/fixtures/workspace-lifecycle/portable-shortlist-v3.json",
    "bytes": 116,
    "sha256": "282569f92d9dc0cd0ef3fdca985ba066e7003477398c2aea64149a036e00e627",
    "contentDigestSha256": null,
    "schema": "whoisleuth.shortlist",
    "version": 3,
    "role": "current",
    "expectation": "accepted_exact",
    "expectedOutputFixtureId": null,
    "scope": "repository",
    "shapeId": "workspace.portable.shortlist.shape"
  },
  {
    "id": "workspace.portable.template.v2",
    "path": "test/fixtures/workspace-lifecycle/portable-template-v2.json",
    "bytes": 471,
    "sha256": "827aaa27e86cc2e22247f5709fb0df8fa92226ae0691750d7bfdb9a85ca6e6b5",
    "contentDigestSha256": null,
    "schema": "whoisleuth.investigation-templates",
    "version": 2,
    "role": "current",
    "expectation": "accepted_exact",
    "expectedOutputFixtureId": null,
    "scope": "repository",
    "shapeId": "workspace.portable.template.shape"
  },
  {
    "id": "workspace.portable.watchlist.v2",
    "path": "test/fixtures/workspace-lifecycle/portable-watchlist-v2.json",
    "bytes": 120,
    "sha256": "1176a691294968af187a383839212a75dedbc0089b7a23bbb3d29a079f91e29b",
    "contentDigestSha256": null,
    "schema": "whoisleuth.watchlists",
    "version": 2,
    "role": "current",
    "expectation": "accepted_exact",
    "expectedOutputFixtureId": null,
    "scope": "repository",
    "shapeId": "workspace.portable.watchlist.shape"
  },
  {
    "id": "workspace.portable.website.v4",
    "path": "test/fixtures/workspace-lifecycle/portable-website-v4.json",
    "bytes": 135,
    "sha256": "08eef9ee031d5226464a0da5624c444c69eb48ca9dc2cb2fd2f1551018c4b11c",
    "contentDigestSha256": null,
    "schema": "whoisleuth.website-profile-snapshots",
    "version": 4,
    "role": "historical",
    "expectation": "normalises_to_current_output",
    "expectedOutputFixtureId": "workspace.portable.website.v5",
    "scope": "repository",
    "shapeId": "workspace.portable.website.shape"
  },
  {
    "id": "workspace.portable.website.v5",
    "path": "test/fixtures/workspace-lifecycle/portable-website-v5.json",
    "bytes": 135,
    "sha256": "0cab1675a632793141107fac330a130e7d300a7726e9963f8409199902bf0d23",
    "contentDigestSha256": null,
    "schema": "whoisleuth.website-profile-snapshots",
    "version": 5,
    "role": "current",
    "expectation": "accepted_exact",
    "expectedOutputFixtureId": null,
    "scope": "repository",
    "shapeId": "workspace.portable.website.shape"
  }
]);

function workspaceByteBudget(descriptor: SchemaCompatibilityDescriptor): number {
  if (descriptor.byteBudget === null) {
    throw new TypeError('Workspace portability contracts require an explicit byte budget.');
  }
  return descriptor.byteBudget;
}

function workspaceByteBoundId(descriptor: SchemaCompatibilityDescriptor): string {
  return 'workspace.bytes.' + workspaceByteBudget(descriptor);
}

function workspaceShapeId(
  plane: 'browser' | 'portable',
  slug: string,
  lifecycle: 'current' | 'historical',
): string {
  return 'workspace.' + plane + '.' + slug + '.' + lifecycle + '.shape';
}

const WORKSPACE_LIFECYCLE_FIXTURES: readonly SchemaLifecycleFixtureV4[] = Object.freeze(
  WORKSPACE_LIFECYCLE_FIXTURE_SOURCE.map((fixture) => ({
    ...fixture,
    shapeId: workspaceShapeId(
      fixture.id.includes('.browser.') ? 'browser' : 'portable',
      fixture.id.split('.')[2] ?? '',
      fixture.role === 'historical' ? 'historical' : 'current',
    ),
  })),
);

function workspaceFixtureIds(schema: string, version: number): string[] {
  return WORKSPACE_LIFECYCLE_FIXTURES
    .filter((fixture) => fixture.schema === schema && fixture.version === version)
    .map((fixture) => fixture.id);
}

function workspaceFutureVersionBehaviour(
  descriptor: SchemaCompatibilityDescriptor,
): 'not_applicable' | 'preserve_without_write' | 'reject' {
  if (descriptor.futureVersionBehavior === 'discard') {
    throw new TypeError('Workspace portability contracts cannot discard unsupported future data.');
  }
  return descriptor.futureVersionBehavior;
}

function workspaceContracts(
  descriptor: SchemaCompatibilityDescriptor,
  schema: string,
): SchemaLifecycleContract[] {
  return descriptor.supportedVersions.map((version) => {
    const current = version === descriptor.currentVersion;
    return {
      compatibilityId: descriptor.id,
      schema,
      version,
      role: 'document',
      lifecycle: current ? 'current' : 'legacy',
      readable: true,
      emitted: current,
      exactKeys: false,
      extensionPolicy: 'discard_bounded',
      futureVersionBehaviour: workspaceFutureVersionBehaviour(descriptor),
      migrationTarget: current || descriptor.migration !== 'normalize_to_current'
        ? null
        : { schema, version: descriptor.currentVersion },
      canonicalisation: null,
      byteBudget: workspaceByteBudget(descriptor),
      fixtureIds: workspaceFixtureIds(schema, version),
    };
  });
}

const WORKSPACE_LIFECYCLE_CONTRACTS: readonly SchemaLifecycleContract[] = Object.freeze(
  WORKSPACE_LIFECYCLE_DEFINITIONS.flatMap((definition) => [
    ...workspaceContracts(definition.browserDescriptor, definition.browserSchema),
    ...(definition.portable
      ? workspaceContracts(definition.portable.descriptor, definition.portable.schema)
      : []),
  ]),
);

function workspaceShape(
  definition: WorkspaceLifecycleDefinition,
  plane: 'browser' | 'portable',
  lifecycle: 'current' | 'historical',
): SchemaLifecycleShapeV4 {
  const portable = plane === 'portable' ? definition.portable : null;
  const descriptor = portable?.descriptor ?? definition.browserDescriptor;
  const schema = portable?.schema ?? definition.browserSchema;
  const rootKeys = plane === 'portable'
    ? ['schema', 'version', definition.collectionKey, 'exportedAt', 'generatedAt', 'limitations']
    : ['schema', 'version', definition.collectionKey, ...(definition.slug === 'review' ? ['rows'] : [])];
  return {
    id: workspaceShapeId(plane, definition.slug, lifecycle),
    schema,
    versions: descriptor.supportedVersions.filter((version) => (
      lifecycle === 'current'
        ? version === descriptor.currentVersion
        : version !== descriptor.currentVersion
    )),
    objects: [{
      path: '$',
      requiredKeys: descriptor.acceptsUnversionedLegacy
        ? []
        : ['version', definition.collectionKey],
      optionalKeys: rootKeys.filter((key) => (
        descriptor.acceptsUnversionedLegacy || (key !== 'version' && key !== definition.collectionKey)
      )),
      alternativeRequiredKeys: [],
      unknownKeys: 'discard_bounded',
    }],
    fixedArrays: [],
    normalisation: 'project_known_fields',
    target: null,
    discriminator: null,
  };
}

const WORKSPACE_LIFECYCLE_SHAPES: readonly SchemaLifecycleShapeV4[] = Object.freeze(
  WORKSPACE_LIFECYCLE_DEFINITIONS.flatMap((definition) => [
    ...(definition.browserDescriptor.supportedVersions.length > 1
      ? [workspaceShape(definition, 'browser', 'historical')]
      : []),
    workspaceShape(definition, 'browser', 'current'),
    ...(definition.portable
      ? [
        ...(definition.portable.descriptor.supportedVersions.length > 1
          ? [workspaceShape(definition, 'portable', 'historical')]
          : []),
        workspaceShape(definition, 'portable', 'current'),
      ]
      : []),
  ]),
);

const WORKSPACE_LIFECYCLE_HOOKS: readonly SchemaLifecycleHook[] = Object.freeze([
  ...WORKSPACE_LIFECYCLE_DEFINITIONS.flatMap((definition) => [
    {
      id: 'workspace.' + definition.slug + '.normalise',
      role: 'normaliser' as const,
      runtime: 'shared' as const,
      module: definition.module,
      exportName: definition.normalizer,
    },
    {
      id: 'workspace.' + definition.slug + '.serialise',
      role: 'serialiser' as const,
      runtime: 'shared' as const,
      module: definition.module,
      exportName: definition.serializer,
    },
    ...(definition.portable ? [
      {
        id: 'workspace.' + definition.slug + '.build',
        role: 'builder' as const,
        runtime: 'shared' as const,
        module: definition.module,
        exportName: definition.portable.builder,
      },
      {
        id: 'workspace.' + definition.slug + '.merge',
        role: 'merger' as const,
        runtime: 'shared' as const,
        module: definition.module,
        exportName: definition.portable.merger,
      },
    ] : []),
  ]),
  {
    id: 'workspace.portable.json',
    role: 'serialiser',
    runtime: 'shared',
    module: WORKSPACE_CONTRACT_OWNER,
    exportName: 'serialiseWorkspacePortableJson',
  },
  {
    id: 'workspace.portable.json-line',
    role: 'serialiser',
    runtime: 'shared',
    module: WORKSPACE_CONTRACT_OWNER,
    exportName: 'serialiseWorkspacePortableJsonLine',
  },
  {
    id: 'workspace.portable.archive-section',
    role: 'serialiser',
    runtime: 'shared',
    module: 'packages/contracts/case-portability.mts',
    exportName: 'serialiseWorkspaceArchiveSection',
  },
]);

const WORKSPACE_LIFECYCLE_BYTE_BUDGETS = Object.freeze([
  ...new Set(WORKSPACE_PORTABILITY_COMPATIBILITY.map(workspaceByteBudget)),
].sort((left, right) => left - right));

const WORKSPACE_LIFECYCLE_BOUNDS: readonly SchemaLifecycleBoundProfile[] = Object.freeze([
  ...WORKSPACE_LIFECYCLE_BYTE_BUDGETS.map((maximum) => ({
    id: 'workspace.bytes.' + maximum,
    bounds: [
      { id: 'raw-bytes', path: '$', phase: 'raw_intake' as const, unit: 'bytes' as const, minimum: 1, maximum, handling: 'reject' as const },
      { id: 'serialised-bytes', path: '$', phase: 'serialised' as const, unit: 'bytes' as const, minimum: 1, maximum, handling: 'reject' as const },
    ],
  })),
  ...WORKSPACE_LIFECYCLE_DEFINITIONS.map((definition) => ({
    id: 'workspace.' + definition.slug + '.domain-bounds',
    bounds: definition.itemBounds.map((bound) => ({
      ...bound,
      phase: bound.handling === 'truncate' ? 'normalised' as const : 'pre_accumulation' as const,
      unit: bound.id === 'watchlists' ? 'entries' as const : 'items' as const,
      minimum: 0,
    })),
  })),
]);

const WORKSPACE_LIFECYCLE_PRIVACY: readonly SchemaLifecyclePrivacyProfile[] = Object.freeze([
  {
    id: 'workspace.privacy.browser-state',
    classification: 'analyst_authored_sensitive',
    projection: 'browser_import',
    includedCategories: ['analyst-selected-identifiers', 'bounded-derived-observations', 'local-workspace-state'],
    excludedCategories: ['raw-upstream-payloads', 'expanded-contacts', 'credentials', 'cookies', 'session-data'],
    notePolicy: 'allowed_bounded',
    retention: 'browser_indexeddb',
    network: 'none',
    sharingReview: 'not_applicable',
  },
  {
    id: 'workspace.privacy.portable-input',
    classification: 'analyst_authored_sensitive',
    projection: 'browser_import',
    includedCategories: ['declared-collection-records', 'bounded-derived-observations', 'analyst-authored-state'],
    excludedCategories: ['raw-upstream-payloads', 'expanded-contacts', 'credentials', 'cookies', 'session-data'],
    notePolicy: 'allowed_bounded',
    retention: 'deliberate_local_file',
    network: 'none',
    sharingReview: 'required',
  },
  {
    id: 'workspace.privacy.portable-output',
    classification: 'analyst_authored_sensitive',
    projection: 'browser_export',
    includedCategories: ['privacy-minimised-collection-records', 'bounded-derived-observations', 'analyst-authored-state'],
    excludedCategories: ['raw-upstream-payloads', 'expanded-contacts', 'credentials', 'cookies', 'session-data'],
    notePolicy: 'allowed_bounded',
    retention: 'operator_controlled_output',
    network: 'none',
    sharingReview: 'required',
  },
]);

const WORKSPACE_EXPIRY_ID = 'workspace.expiry.not-applicable';
const WORKSPACE_LIFECYCLE_EXPIRY = Object.freeze([{
  id: WORKSPACE_EXPIRY_ID,
  field: null,
  anchor: null,
  handling: 'not_applicable' as const,
  phase: 'not_applicable' as const,
  maximumLifetimeDays: null,
}]);

function workspaceBrowserSerialisation(
  definition: WorkspaceLifecycleDefinition,
): SchemaLifecycleSerialisationProfile {
  return {
    id: 'workspace.browser.' + definition.slug + '.json',
    schema: definition.browserSchema,
    versions: [definition.browserDescriptor.currentVersion],
    mediaType: 'application/json',
    encoding: 'utf-8',
    bom: false,
    indentSpaces: 0,
    terminalLf: false,
    propertyOrder: 'normalised_fixed',
    canonicalisation: null,
    integrity: 'none',
    serializerHookId: 'workspace.' + definition.slug + '.serialise',
    verifierHookIds: [],
  };
}

function workspacePortableSerialisation(
  definition: WorkspaceLifecycleDefinition,
): SchemaLifecycleSerialisationProfile[] {
  if (!definition.portable) return [];
  return [{
    id: 'workspace.portable.' + definition.slug + '.json',
    schema: definition.portable.schema,
    versions: [definition.portable.descriptor.currentVersion],
    mediaType: 'application/json',
    encoding: 'utf-8',
    bom: false,
    indentSpaces: definition.portable.indentSpaces,
    terminalLf: definition.portable.terminalLf,
    propertyOrder: 'normalised_fixed',
    canonicalisation: null,
    integrity: 'none',
    serializerHookId: definition.portable.serializerHookId,
    verifierHookIds: [],
  }];
}

const WORKSPACE_LIFECYCLE_SERIALISATION: readonly SchemaLifecycleSerialisationProfile[] = Object.freeze(
  WORKSPACE_LIFECYCLE_DEFINITIONS.flatMap((definition) => [
    workspaceBrowserSerialisation(definition),
    ...workspacePortableSerialisation(definition),
  ]),
);

const WORKSPACE_EDGE_POLICY = {
  expiryPolicyId: WORKSPACE_EXPIRY_ID,
  requestMode: 'none',
  bindingState: 'declared_unenforced',
  policyState: 'current',
} as const;

function workspaceBrowserConsumer(
  definition: WorkspaceLifecycleDefinition,
): SchemaLifecycleConsumerEdgeV4 {
  return {
    id: 'workspace.browser.' + definition.slug + '.read-write',
    plane: 'browser',
    operation: 'normalise-and-store',
    acceptedContracts: [{
      schema: definition.browserSchema,
      versions: definition.browserDescriptor.supportedVersions,
      mode: 'direct',
      discriminator: null,
    }],
    emittedContract: {
      schema: definition.browserSchema,
      version: definition.browserDescriptor.currentVersion,
      discriminator: null,
    },
    shapeIds: [
      ...(definition.browserDescriptor.supportedVersions.length > 1
        ? [workspaceShapeId('browser', definition.slug, 'historical')]
        : []),
      workspaceShapeId('browser', definition.slug, 'current'),
    ],
    boundProfileIds: [
      workspaceByteBoundId(definition.browserDescriptor),
      'workspace.' + definition.slug + '.domain-bounds',
    ],
    hookIds: [
      'workspace.' + definition.slug + '.normalise',
      'workspace.' + definition.slug + '.serialise',
    ],
    serialisationProfileId: 'workspace.browser.' + definition.slug + '.json',
    privacyProfileId: 'workspace.privacy.browser-state',
    retentionEffect: 'browser_indexeddb',
    ...WORKSPACE_EDGE_POLICY,
  };
}

function workspacePortableConsumers(
  definition: WorkspaceLifecycleDefinition,
): SchemaLifecycleConsumerEdgeV4[] {
  if (!definition.portable) return [];
  const portable = definition.portable;
  const importShapeIds = [
    ...(portable.descriptor.supportedVersions.length > 1
      ? [workspaceShapeId('portable', definition.slug, 'historical')]
      : []),
    workspaceShapeId('portable', definition.slug, 'current'),
  ];
  const boundProfileIds = [
    workspaceByteBoundId(portable.descriptor),
    'workspace.' + definition.slug + '.domain-bounds',
  ];
  return [
    {
      id: 'workspace.portable.' + definition.slug + '.import',
      plane: 'shared',
      operation: 'normalise-and-non-destructive-merge',
      acceptedContracts: [{
        schema: portable.schema,
        versions: portable.descriptor.supportedVersions,
        mode: 'direct',
        discriminator: null,
      }],
      emittedContract: null,
      shapeIds: importShapeIds,
      boundProfileIds,
      hookIds: [
        'workspace.' + definition.slug + '.normalise',
        'workspace.' + definition.slug + '.merge',
      ],
      serialisationProfileId: null,
      privacyProfileId: 'workspace.privacy.portable-input',
      retentionEffect: 'deliberate_local_file',
      ...WORKSPACE_EDGE_POLICY,
    },
    {
      id: 'workspace.portable.' + definition.slug + '.output',
      plane: 'shared',
      operation: 'build-privacy-projection',
      acceptedContracts: [],
      emittedContract: {
        schema: portable.schema,
        version: portable.descriptor.currentVersion,
        discriminator: null,
      },
      shapeIds: [workspaceShapeId('portable', definition.slug, 'current')],
      boundProfileIds,
      hookIds: [
        'workspace.' + definition.slug + '.build',
        portable.serializerHookId,
      ],
      serialisationProfileId: 'workspace.portable.' + definition.slug + '.json',
      privacyProfileId: 'workspace.privacy.portable-output',
      retentionEffect: 'operator_controlled_output',
      ...WORKSPACE_EDGE_POLICY,
    },
  ];
}

const WORKSPACE_LIFECYCLE_CONSUMERS: readonly SchemaLifecycleConsumerEdgeV4[] = Object.freeze(
  WORKSPACE_LIFECYCLE_DEFINITIONS.flatMap((definition) => [
    workspaceBrowserConsumer(definition),
    ...workspacePortableConsumers(definition),
  ]),
);

export const WORKSPACE_PORTABILITY_LIFECYCLE_FAMILY = defineSchemaLifecycleFamily({
  id: 'workspace-portability',
  owner: WORKSPACE_CONTRACT_OWNER,
  privacy: 'analyst_authored_sensitive',
  compatibility: WORKSPACE_PORTABILITY_COMPATIBILITY,
  contracts: WORKSPACE_LIFECYCLE_CONTRACTS,
  fixtures: WORKSPACE_LIFECYCLE_FIXTURES,
  metadata: {
    metadataVersion: 4,
    enforcement: 'declarative_only',
    shapes: WORKSPACE_LIFECYCLE_SHAPES,
    boundProfiles: WORKSPACE_LIFECYCLE_BOUNDS,
    hooks: WORKSPACE_LIFECYCLE_HOOKS,
    serialisationProfiles: WORKSPACE_LIFECYCLE_SERIALISATION,
    privacyProfiles: WORKSPACE_LIFECYCLE_PRIVACY,
    expiryProfiles: WORKSPACE_LIFECYCLE_EXPIRY,
    consumerEdges: WORKSPACE_LIFECYCLE_CONSUMERS,
    consumerRelationships: [],
  },
});
