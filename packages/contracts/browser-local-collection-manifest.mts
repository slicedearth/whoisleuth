import {
  CASE_BROWSER_COMPATIBILITY,
  MAX_CASES,
  MAX_CASE_STORE_BYTES,
} from './case-portability.mts';
import {
  BRAND_PROFILE_BROWSER_COMPATIBILITY,
  BULK_REVIEW_BROWSER_COMPATIBILITY,
  BULK_SESSION_BROWSER_COMPATIBILITY,
  CAMPAIGN_BROWSER_COMPATIBILITY,
  CT_HISTORY_BROWSER_COMPATIBILITY,
  DETECTION_RULE_BROWSER_COMPATIBILITY,
  INVESTIGATION_TEMPLATE_BROWSER_COMPATIBILITY,
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
  RELATIONSHIP_OBSERVATION_BROWSER_COMPATIBILITY,
  SHORTLIST_BROWSER_COMPATIBILITY,
  WATCHLIST_BROWSER_COMPATIBILITY,
  WEBSITE_SNAPSHOT_BROWSER_COMPATIBILITY,
} from './workspace-portability.mts';
import {
  MAX_ANALYST_REVIEW_STATE_BYTES,
  MAX_ANALYST_REVIEW_STATE_RECORDS,
} from './analyst-review-state-contract.mts';
import { ANALYST_REVIEW_STATE_COMPATIBILITY } from './analyst-review-state.mts';
import type { SchemaCompatibilityDescriptor } from './schema-compatibility.mts';

export type BrowserLocalCollectionStaticDefinition = Readonly<{
  id: string;
  label: string;
  schemaVersion: number;
  minimumReadableVersion: number;
  acceptsUnversionedLegacy: boolean;
  maximumBytes: number;
  maximumRecords: number;
}>;

function definition(value: Omit<BrowserLocalCollectionStaticDefinition, 'schemaVersion' | 'minimumReadableVersion' | 'acceptsUnversionedLegacy'> & {
  compatibility: SchemaCompatibilityDescriptor;
}): BrowserLocalCollectionStaticDefinition {
  const { compatibility, ...fields } = value;
  return Object.freeze({
    ...fields,
    schemaVersion: compatibility.currentVersion,
    minimumReadableVersion: compatibility.supportedVersions[0]!,
    acceptsUnversionedLegacy: compatibility.acceptsUnversionedLegacy,
  });
}

export const BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID = Object.freeze({
  cases: definition({ id: 'cases', label: 'Cases', compatibility: CASE_BROWSER_COMPATIBILITY, maximumBytes: MAX_CASE_STORE_BYTES, maximumRecords: MAX_CASES }),
  campaigns: definition({ id: 'campaigns', label: 'Campaigns', compatibility: CAMPAIGN_BROWSER_COMPATIBILITY, maximumBytes: MAX_CAMPAIGN_STORE_BYTES, maximumRecords: MAX_CAMPAIGNS }),
  brand_profiles: definition({ id: 'brand_profiles', label: 'Brand Profiles', compatibility: BRAND_PROFILE_BROWSER_COMPATIBILITY, maximumBytes: MAX_PROFILE_STORE_BYTES, maximumRecords: MAX_PROFILES }),
  watchlists: definition({ id: 'watchlists', label: 'Watchlists', compatibility: WATCHLIST_BROWSER_COMPATIBILITY, maximumBytes: MAX_WATCHLIST_STORE_BYTES, maximumRecords: MAX_WATCHLISTS }),
  shortlist: definition({ id: 'shortlist', label: 'Shortlist', compatibility: SHORTLIST_BROWSER_COMPATIBILITY, maximumBytes: MAX_SHORTLIST_STORE_BYTES, maximumRecords: MAX_SHORTLIST_ENTRIES }),
  ct_history: definition({ id: 'ct_history', label: 'Certificate Transparency history', compatibility: CT_HISTORY_BROWSER_COMPATIBILITY, maximumBytes: MAX_CT_HISTORY_STORE_BYTES, maximumRecords: MAX_CT_HISTORY_SEARCHES }),
  detection_rules: definition({ id: 'detection_rules', label: 'Custom rules', compatibility: DETECTION_RULE_BROWSER_COMPATIBILITY, maximumBytes: MAX_RULE_STORE_BYTES, maximumRecords: MAX_DETECTION_RULES }),
  relationship_observations: definition({ id: 'relationship_observations', label: 'Retained relationship observations', compatibility: RELATIONSHIP_OBSERVATION_BROWSER_COMPATIBILITY, maximumBytes: MAX_RELATIONSHIP_OBSERVATION_STORE_BYTES, maximumRecords: MAX_RELATIONSHIP_OBSERVATIONS }),
  bulk_sessions: definition({ id: 'bulk_sessions', label: 'Saved Bulk sessions', compatibility: BULK_SESSION_BROWSER_COMPATIBILITY, maximumBytes: MAX_BULK_SESSION_STORE_BYTES, maximumRecords: MAX_BULK_SESSIONS }),
  website_snapshots: definition({ id: 'website_snapshots', label: 'Website profile snapshots', compatibility: WEBSITE_SNAPSHOT_BROWSER_COMPATIBILITY, maximumBytes: MAX_WEBSITE_SNAPSHOT_STORE_BYTES, maximumRecords: MAX_WEBSITE_SNAPSHOTS }),
  investigation_templates: definition({ id: 'investigation_templates', label: 'Investigation templates', compatibility: INVESTIGATION_TEMPLATE_BROWSER_COMPATIBILITY, maximumBytes: MAX_INVESTIGATION_TEMPLATE_STORE_BYTES, maximumRecords: MAX_INVESTIGATION_TEMPLATES }),
  bulk_review: definition({ id: 'bulk_review', label: 'Bulk review views and queue state', compatibility: BULK_REVIEW_BROWSER_COMPATIBILITY, maximumBytes: MAX_BULK_REVIEW_STORE_BYTES, maximumRecords: MAX_BULK_REVIEW_PRESETS + MAX_BULK_REVIEW_ROWS }),
  analyst_review_state: definition({ id: 'analyst_review_state', label: 'Analyst Review Item lifecycle', compatibility: ANALYST_REVIEW_STATE_COMPATIBILITY, maximumBytes: MAX_ANALYST_REVIEW_STATE_BYTES, maximumRecords: MAX_ANALYST_REVIEW_STATE_RECORDS }),
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
  BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.analyst_review_state,
]);
