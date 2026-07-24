import {
  CASE_SCHEMA_VERSION,
  MAX_CASES,
  MAX_CASE_STORE_BYTES,
  normalizeCaseStore,
  parseStoreVersion,
  serializeCaseStore,
} from './analysis/case-model.js';
import {
  CAMPAIGN_SCHEMA_VERSION,
  MAX_CAMPAIGNS,
  MAX_CAMPAIGN_STORE_BYTES,
  campaignStoreVersion,
  normalizeCampaignStore,
  serializeCampaignStore,
} from './analysis/campaign-model.js';
import {
  BRAND_PROFILE_SCHEMA_VERSION,
  MAX_PROFILES,
  MAX_PROFILE_STORE_BYTES,
  brandProfileStoreVersion,
  normalizeBrandProfileStore,
  serializeBrandProfileStore,
} from './analysis/brand-profile-model.js';
import {
  MAX_WATCHLISTS,
  MAX_WATCHLIST_STORE_BYTES,
  WATCHLIST_SCHEMA_VERSION,
  normalizeWatchlistStore,
  serializeWatchlistStore,
  watchlistStoreVersion,
} from './analysis/watchlist-store.js';
import {
  MAX_SHORTLIST_ENTRIES,
  MAX_SHORTLIST_STORE_BYTES,
  SHORTLIST_SCHEMA_VERSION,
  normalizeShortlistStore,
  serializeShortlistStore,
  shortlistStoreVersion,
} from './analysis/shortlist-model.js';
import {
  CT_HISTORY_SCHEMA_VERSION,
  MAX_CT_HISTORY_SEARCHES,
  MAX_CT_HISTORY_STORE_BYTES,
  ctHistoryStoreVersion,
  emptyCtHistoryStore,
  enforceCtHistoryBudget,
  normalizeCtHistoryStore,
} from './analysis/ct-history.js';
import {
  DETECTION_RULE_SCHEMA_VERSION,
  MAX_DETECTION_RULES,
  MAX_RULE_STORE_BYTES,
  detectionRuleStoreVersion,
  normalizeDetectionRuleStore,
  serializeDetectionRuleStore,
} from './analysis/detection-rule-model.js';
import {
  MAX_RELATIONSHIP_OBSERVATIONS,
  MAX_RELATIONSHIP_OBSERVATION_STORE_BYTES,
  RELATIONSHIP_OBSERVATION_SCHEMA,
  RELATIONSHIP_OBSERVATION_SCHEMA_VERSION,
  normalizeRelationshipObservationStore,
  relationshipObservationStoreVersion,
  serializeRelationshipObservationStore,
} from './analysis/relationship-observation-model.ts';
import type { LocalDataCollectionDefinition, LocalDataRecord } from './browser-local-data.js';

export const LEGACY_CASES_KEY = 'whois-rdap-cases-v1';
export const LEGACY_CAMPAIGNS_KEY = 'whoisleuth-campaigns-v1';
export const LEGACY_PROFILES_KEY = 'whois-rdap-brand-profiles-v1';
export const LEGACY_WATCHLIST_KEY = 'whois-rdap-watchlist-v1';
export const LEGACY_SHORTLIST_KEY = 'whois-rdap-shortlist-v1';
export const LEGACY_CT_HISTORY_KEY = 'whoisleuth:ct-search-history:v1';
export const LEGACY_DETECTION_RULES_KEY = 'whoisleuth-detection-rules-v1';
export const LEGACY_RELATIONSHIP_OBSERVATIONS_KEY = 'whoisleuth-relationship-observations-v1';

function recordsFromArray(values: readonly unknown[], key: (value: any) => unknown): LocalDataRecord[] {
  return values.map((value) => ({ id: String(key(value) ?? ''), value }));
}

function arrayFromRecords(records: readonly LocalDataRecord[]): unknown[] {
  return records.map((record) => record.value);
}

export const CASES_COLLECTION: LocalDataCollectionDefinition<any[]> = Object.freeze({
  id: 'cases',
  label: 'Cases',
  legacyKey: LEGACY_CASES_KEY,
  schemaVersion: CASE_SCHEMA_VERSION,
  maximumBytes: MAX_CASE_STORE_BYTES,
  maximumRecords: MAX_CASES,
  empty: () => [],
  normalize: (raw) => normalizeCaseStore(raw).cases,
  version: parseStoreVersion,
  serialize: serializeCaseStore,
  split: (cases) => recordsFromArray(cases, (record) => record.id),
  join: (records, schemaVersion) => ({ version: schemaVersion, cases: arrayFromRecords(records) }),
});

export const CAMPAIGNS_COLLECTION: LocalDataCollectionDefinition<any[]> = Object.freeze({
  id: 'campaigns',
  label: 'Campaigns',
  legacyKey: LEGACY_CAMPAIGNS_KEY,
  schemaVersion: CAMPAIGN_SCHEMA_VERSION,
  maximumBytes: MAX_CAMPAIGN_STORE_BYTES,
  maximumRecords: MAX_CAMPAIGNS,
  empty: () => [],
  normalize: (raw) => normalizeCampaignStore(raw).campaigns,
  version: campaignStoreVersion,
  serialize: serializeCampaignStore,
  split: (campaigns) => recordsFromArray(campaigns, (record) => record.id),
  join: (records, schemaVersion) => ({ version: schemaVersion, campaigns: arrayFromRecords(records) }),
});

export const PROFILES_COLLECTION: LocalDataCollectionDefinition<any[]> = Object.freeze({
  id: 'brand_profiles',
  label: 'Brand Profiles',
  legacyKey: LEGACY_PROFILES_KEY,
  schemaVersion: BRAND_PROFILE_SCHEMA_VERSION,
  maximumBytes: MAX_PROFILE_STORE_BYTES,
  maximumRecords: MAX_PROFILES,
  empty: () => [],
  normalize: (raw) => normalizeBrandProfileStore(raw).profiles,
  version: brandProfileStoreVersion,
  serialize: serializeBrandProfileStore,
  split: (profiles) => recordsFromArray(profiles, (record) => record.id),
  join: (records, schemaVersion) => ({ version: schemaVersion, profiles: arrayFromRecords(records) }),
});

export const WATCHLISTS_COLLECTION: LocalDataCollectionDefinition<Record<string, any>> = Object.freeze({
  id: 'watchlists',
  label: 'Watchlists',
  legacyKey: LEGACY_WATCHLIST_KEY,
  schemaVersion: WATCHLIST_SCHEMA_VERSION,
  maximumBytes: MAX_WATCHLIST_STORE_BYTES,
  maximumRecords: MAX_WATCHLISTS,
  empty: () => ({}),
  normalize: (raw) => normalizeWatchlistStore(raw).watchlists,
  version: watchlistStoreVersion,
  serialize: serializeWatchlistStore,
  split: (watchlists) => Object.entries(watchlists).map(([id, value]) => ({ id, value })),
  join: (records, schemaVersion) => ({
    schema: 'whoisleuth.watchlists',
    version: schemaVersion,
    watchlists: Object.fromEntries(records.map((record) => [record.id, record.value])),
  }),
});

export const SHORTLIST_COLLECTION: LocalDataCollectionDefinition<any[]> = Object.freeze({
  id: 'shortlist',
  label: 'Shortlist',
  legacyKey: LEGACY_SHORTLIST_KEY,
  schemaVersion: SHORTLIST_SCHEMA_VERSION,
  maximumBytes: MAX_SHORTLIST_STORE_BYTES,
  maximumRecords: MAX_SHORTLIST_ENTRIES,
  empty: () => [],
  normalize: (raw) => normalizeShortlistStore(raw).entries,
  version: shortlistStoreVersion,
  serialize: serializeShortlistStore,
  split: (entries) => recordsFromArray(entries, (record) => record.domain),
  join: (records, schemaVersion) => ({ schema: 'whoisleuth.shortlist', version: schemaVersion, entries: arrayFromRecords(records) }),
});

export const CT_HISTORY_COLLECTION: LocalDataCollectionDefinition<any> = Object.freeze({
  id: 'ct_history',
  label: 'Certificate Transparency history',
  legacyKey: LEGACY_CT_HISTORY_KEY,
  schemaVersion: CT_HISTORY_SCHEMA_VERSION,
  maximumBytes: MAX_CT_HISTORY_STORE_BYTES,
  maximumRecords: MAX_CT_HISTORY_SEARCHES,
  empty: emptyCtHistoryStore,
  normalize: (raw) => enforceCtHistoryBudget(normalizeCtHistoryStore(raw)),
  version: ctHistoryStoreVersion,
  serialize: (store) => JSON.stringify(enforceCtHistoryBudget(store)),
  split: (store) => recordsFromArray(store.entries, (record) => record.query),
  join: (records, schemaVersion) => ({ version: schemaVersion, entries: arrayFromRecords(records) }),
});

export const DETECTION_RULES_COLLECTION: LocalDataCollectionDefinition<any[]> = Object.freeze({
  id: 'detection_rules',
  label: 'Custom rules',
  legacyKey: LEGACY_DETECTION_RULES_KEY,
  schemaVersion: DETECTION_RULE_SCHEMA_VERSION,
  maximumBytes: MAX_RULE_STORE_BYTES,
  maximumRecords: MAX_DETECTION_RULES,
  empty: () => [],
  normalize: (raw) => normalizeDetectionRuleStore(raw).rules,
  version: detectionRuleStoreVersion,
  serialize: serializeDetectionRuleStore,
  split: (rules) => recordsFromArray(rules, (record) => record.id),
  join: (records, schemaVersion) => ({ version: schemaVersion, rules: arrayFromRecords(records) }),
});

export const RELATIONSHIP_OBSERVATIONS_COLLECTION: LocalDataCollectionDefinition<any[]> = Object.freeze({
  id: 'relationship_observations',
  label: 'Retained relationship observations',
  legacyKey: LEGACY_RELATIONSHIP_OBSERVATIONS_KEY,
  schemaVersion: RELATIONSHIP_OBSERVATION_SCHEMA_VERSION,
  maximumBytes: MAX_RELATIONSHIP_OBSERVATION_STORE_BYTES,
  maximumRecords: MAX_RELATIONSHIP_OBSERVATIONS,
  empty: () => [],
  normalize: (raw) => normalizeRelationshipObservationStore(raw).observations,
  version: relationshipObservationStoreVersion,
  serialize: serializeRelationshipObservationStore,
  split: (observations) => recordsFromArray(observations, (record) => record.id),
  join: (records, schemaVersion) => ({
    schema: RELATIONSHIP_OBSERVATION_SCHEMA,
    version: schemaVersion,
    observations: arrayFromRecords(records),
  }),
});

export const BROWSER_LOCAL_COLLECTIONS = Object.freeze([
  CASES_COLLECTION,
  CAMPAIGNS_COLLECTION,
  PROFILES_COLLECTION,
  WATCHLISTS_COLLECTION,
  SHORTLIST_COLLECTION,
  CT_HISTORY_COLLECTION,
  DETECTION_RULES_COLLECTION,
  RELATIONSHIP_OBSERVATIONS_COLLECTION,
]);
