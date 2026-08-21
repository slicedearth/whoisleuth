import {
  CASE_SCHEMA_VERSION,
  MAX_CASES,
  MAX_CASE_STORE_BYTES,
} from './case-portability.mts';
import {
  BRAND_PROFILE_SCHEMA_VERSION,
  BULK_REVIEW_SCHEMA_VERSION,
  BULK_SESSION_SCHEMA_VERSION,
  CAMPAIGN_SCHEMA_VERSION,
  CT_HISTORY_SCHEMA_VERSION,
  DETECTION_RULE_SCHEMA_VERSION,
  INVESTIGATION_TEMPLATE_VERSION,
  MAX_BULK_REVIEW_PRESETS,
  MAX_BULK_REVIEW_ROWS,
  MAX_BULK_REVIEW_STORE_BYTES,
  MAX_BULK_SESSIONS,
  MAX_BULK_SESSION_STORE_BYTES,
  MAX_CAMPAIGNS,
  MAX_CAMPAIGN_STORE_BYTES,
  MAX_CT_HISTORY_SEARCHES,
  MAX_CT_HISTORY_STORE_BYTES,
  MAX_DETECTION_RULES,
  MAX_INVESTIGATION_TEMPLATES,
  MAX_INVESTIGATION_TEMPLATE_STORE_BYTES,
  MAX_PROFILES,
  MAX_PROFILE_STORE_BYTES,
  MAX_RELATIONSHIP_OBSERVATIONS,
  MAX_RELATIONSHIP_OBSERVATION_STORE_BYTES,
  MAX_RULE_STORE_BYTES,
  MAX_SHORTLIST_ENTRIES,
  MAX_SHORTLIST_STORE_BYTES,
  MAX_WATCHLISTS,
  MAX_WATCHLIST_STORE_BYTES,
  MAX_WEBSITE_SNAPSHOTS,
  MAX_WEBSITE_SNAPSHOT_STORE_BYTES,
  RELATIONSHIP_OBSERVATION_SCHEMA_VERSION,
  SHORTLIST_SCHEMA_VERSION,
  WATCHLIST_SCHEMA_VERSION,
  WEBSITE_SNAPSHOT_SCHEMA_VERSION,
} from './workspace-portability.mts';

export type BrowserLocalCollectionStaticDefinition = Readonly<{
  id: string;
  label: string;
  schemaVersion: number;
  maximumBytes: number;
  maximumRecords: number;
}>;

function definition(value: BrowserLocalCollectionStaticDefinition): BrowserLocalCollectionStaticDefinition {
  return Object.freeze(value);
}

export const BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID = Object.freeze({
  cases: definition({ id: 'cases', label: 'Cases', schemaVersion: CASE_SCHEMA_VERSION, maximumBytes: MAX_CASE_STORE_BYTES, maximumRecords: MAX_CASES }),
  campaigns: definition({ id: 'campaigns', label: 'Campaigns', schemaVersion: CAMPAIGN_SCHEMA_VERSION, maximumBytes: MAX_CAMPAIGN_STORE_BYTES, maximumRecords: MAX_CAMPAIGNS }),
  brand_profiles: definition({ id: 'brand_profiles', label: 'Brand Profiles', schemaVersion: BRAND_PROFILE_SCHEMA_VERSION, maximumBytes: MAX_PROFILE_STORE_BYTES, maximumRecords: MAX_PROFILES }),
  watchlists: definition({ id: 'watchlists', label: 'Watchlists', schemaVersion: WATCHLIST_SCHEMA_VERSION, maximumBytes: MAX_WATCHLIST_STORE_BYTES, maximumRecords: MAX_WATCHLISTS }),
  shortlist: definition({ id: 'shortlist', label: 'Shortlist', schemaVersion: SHORTLIST_SCHEMA_VERSION, maximumBytes: MAX_SHORTLIST_STORE_BYTES, maximumRecords: MAX_SHORTLIST_ENTRIES }),
  ct_history: definition({ id: 'ct_history', label: 'Certificate Transparency history', schemaVersion: CT_HISTORY_SCHEMA_VERSION, maximumBytes: MAX_CT_HISTORY_STORE_BYTES, maximumRecords: MAX_CT_HISTORY_SEARCHES }),
  detection_rules: definition({ id: 'detection_rules', label: 'Custom rules', schemaVersion: DETECTION_RULE_SCHEMA_VERSION, maximumBytes: MAX_RULE_STORE_BYTES, maximumRecords: MAX_DETECTION_RULES }),
  relationship_observations: definition({ id: 'relationship_observations', label: 'Retained relationship observations', schemaVersion: RELATIONSHIP_OBSERVATION_SCHEMA_VERSION, maximumBytes: MAX_RELATIONSHIP_OBSERVATION_STORE_BYTES, maximumRecords: MAX_RELATIONSHIP_OBSERVATIONS }),
  bulk_sessions: definition({ id: 'bulk_sessions', label: 'Saved Bulk sessions', schemaVersion: BULK_SESSION_SCHEMA_VERSION, maximumBytes: MAX_BULK_SESSION_STORE_BYTES, maximumRecords: MAX_BULK_SESSIONS }),
  website_snapshots: definition({ id: 'website_snapshots', label: 'Website profile snapshots', schemaVersion: WEBSITE_SNAPSHOT_SCHEMA_VERSION, maximumBytes: MAX_WEBSITE_SNAPSHOT_STORE_BYTES, maximumRecords: MAX_WEBSITE_SNAPSHOTS }),
  investigation_templates: definition({ id: 'investigation_templates', label: 'Investigation templates', schemaVersion: INVESTIGATION_TEMPLATE_VERSION, maximumBytes: MAX_INVESTIGATION_TEMPLATE_STORE_BYTES, maximumRecords: MAX_INVESTIGATION_TEMPLATES }),
  bulk_review: definition({ id: 'bulk_review', label: 'Bulk review views and queue state', schemaVersion: BULK_REVIEW_SCHEMA_VERSION, maximumBytes: MAX_BULK_REVIEW_STORE_BYTES, maximumRecords: MAX_BULK_REVIEW_PRESETS + MAX_BULK_REVIEW_ROWS }),
} as const);

export const BROWSER_LOCAL_COLLECTION_MANIFEST = Object.freeze([
  BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.cases,
  BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.campaigns,
  BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.brand_profiles,
  BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.watchlists,
  BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.shortlist,
  BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.ct_history,
  BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.detection_rules,
  BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.relationship_observations,
  BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.bulk_sessions,
  BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.website_snapshots,
  BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.investigation_templates,
  BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.bulk_review,
]);
