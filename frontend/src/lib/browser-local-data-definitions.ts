import {
  CASE_SCHEMA_VERSION,
  MAX_CASES,
  MAX_CASE_STORE_BYTES,
  normalizeCaseStore,
  parseStoreVersion,
  serializeCaseStore,
} from './analysis/case-model.ts';
import type { CaseRecord } from './analysis/case-model.ts';
import {
  CAMPAIGN_SCHEMA_VERSION,
  MAX_CAMPAIGNS,
  MAX_CAMPAIGN_STORE_BYTES,
  campaignStoreVersion,
  normalizeCampaignStore,
  serializeCampaignStore,
} from './analysis/campaign-model.ts';
import type { CampaignRecord } from './analysis/campaign-model.ts';
import {
  BRAND_PROFILE_SCHEMA_VERSION,
  MAX_PROFILES,
  MAX_PROFILE_STORE_BYTES,
  brandProfileStoreVersion,
  normalizeBrandProfileStore,
  serializeBrandProfileStore,
} from './analysis/brand-profile-model.ts';
import type { BrandProfile } from './analysis/brand-profile-model.ts';
import {
  MAX_WATCHLISTS,
  MAX_WATCHLIST_STORE_BYTES,
  WATCHLIST_SCHEMA_VERSION,
  normalizeWatchlistStore,
  serializeWatchlistStore,
  watchlistStoreVersion,
} from './analysis/watchlist-store.ts';
import type { WatchlistCollection, WatchlistEntry } from './analysis/watchlist-store.ts';
import {
  MAX_SHORTLIST_ENTRIES,
  MAX_SHORTLIST_STORE_BYTES,
  SHORTLIST_SCHEMA_VERSION,
  normalizeShortlistStore,
  serializeShortlistStore,
  shortlistStoreVersion,
} from './analysis/shortlist-model.ts';
import type { ShortlistRecord } from './analysis/shortlist-model.ts';
import {
  CT_HISTORY_SCHEMA_VERSION,
  MAX_CT_HISTORY_SEARCHES,
  MAX_CT_HISTORY_STORE_BYTES,
  ctHistoryStoreVersion,
  emptyCtHistoryStore,
  enforceCtHistoryBudget,
  normalizeCtHistoryStore,
} from './analysis/ct-history.ts';
import type { CtHistoryEntry, CtHistoryStore } from './analysis/ct-history.ts';
import {
  DETECTION_RULE_SCHEMA_VERSION,
  MAX_DETECTION_RULES,
  MAX_RULE_STORE_BYTES,
  detectionRuleStoreVersion,
  normalizeDetectionRuleStore,
  serializeDetectionRuleStore,
} from './analysis/detection-rule-model.ts';
import type { DetectionRule } from './analysis/detection-rule-model.ts';
import {
  MAX_RELATIONSHIP_OBSERVATIONS,
  MAX_RELATIONSHIP_OBSERVATION_STORE_BYTES,
  RELATIONSHIP_OBSERVATION_SCHEMA,
  RELATIONSHIP_OBSERVATION_SCHEMA_VERSION,
  normalizeRelationshipObservationStore,
  relationshipObservationStoreVersion,
  serializeRelationshipObservationStore,
} from './analysis/relationship-observation-model.ts';
import type { RelationshipObservation } from './analysis/relationship-observation-model.ts';
import {
  BULK_SESSION_SCHEMA,
  BULK_SESSION_SCHEMA_VERSION,
  MAX_BULK_SESSIONS,
  MAX_BULK_SESSION_STORE_BYTES,
  bulkSessionStoreVersion,
  normalizeBulkSessionStore,
  serializeBulkSessionStore,
} from './analysis/bulk-session-model.ts';
import type { BulkSession } from './analysis/bulk-session-model.ts';
import {
  MAX_WEBSITE_SNAPSHOTS,
  MAX_WEBSITE_SNAPSHOT_STORE_BYTES,
  WEBSITE_SNAPSHOT_SCHEMA,
  WEBSITE_SNAPSHOT_SCHEMA_VERSION,
  normalizeWebsiteSnapshotStore,
  serializeWebsiteSnapshotStore,
  websiteSnapshotStoreVersion,
} from './analysis/website-snapshot-model.ts';
import type { WebsiteProfileSnapshot } from './analysis/website-snapshot-model.ts';
import {
  INVESTIGATION_TEMPLATE_SCHEMA,
  INVESTIGATION_TEMPLATE_VERSION,
  MAX_INVESTIGATION_TEMPLATES,
  MAX_INVESTIGATION_TEMPLATE_STORE_BYTES,
  investigationTemplateStoreVersion,
  normalizeInvestigationTemplateStore,
  serializeInvestigationTemplateStore,
} from './analysis/investigation-template-model.ts';
import type { InvestigationTemplate } from './analysis/investigation-template-model.ts';
import {
  BULK_REVIEW_SCHEMA_VERSION,
  MAX_BULK_REVIEW_PRESETS,
  MAX_BULK_REVIEW_ROWS,
  MAX_BULK_REVIEW_STORE_BYTES,
  bulkReviewRecords,
  bulkReviewStoreFromRecords,
  bulkReviewStoreVersion,
  enforceBulkReviewBudget,
  serializeBulkReviewStore,
} from './analysis/bulk-review-model.ts';
import type { BulkReviewRecord, BulkReviewStore } from './analysis/bulk-review-model.ts';
import {
  BrowserLocalDataError,
  plaintextJsonCodec,
} from './browser-local-data.ts';
import type {
  AnyLocalDataCollectionDefinition,
  BrowserLocalCollectionManifest,
  BrowserLocalStoredRecord,
  LocalDataCollectionDefinition,
  LocalDataRecord,
} from './browser-local-data.ts';

export type BrowserLocalCollectionValueMap = Readonly<{
  cases: CaseRecord;
  campaigns: CampaignRecord;
  brand_profiles: BrandProfile;
  watchlists: WatchlistEntry;
  shortlist: ShortlistRecord;
  ct_history: CtHistoryEntry;
  detection_rules: DetectionRule;
  relationship_observations: RelationshipObservation;
  bulk_sessions: BulkSession;
  website_snapshots: WebsiteProfileSnapshot;
  investigation_templates: InvestigationTemplate;
  bulk_review: BulkReviewRecord;
}>;

export type BrowserLocalCollectionId = keyof BrowserLocalCollectionValueMap;
export type BrowserLocalDecodedCollectionRecord<Collection extends BrowserLocalCollectionId> = Readonly<{
  id: string;
  value: BrowserLocalCollectionValueMap[Collection];
}>;

export const LEGACY_CASES_KEY = 'whois-rdap-cases-v1';
export const LEGACY_CAMPAIGNS_KEY = 'whoisleuth-campaigns-v1';
export const LEGACY_PROFILES_KEY = 'whois-rdap-brand-profiles-v1';
export const LEGACY_WATCHLIST_KEY = 'whois-rdap-watchlist-v1';
export const LEGACY_SHORTLIST_KEY = 'whois-rdap-shortlist-v1';
export const LEGACY_CT_HISTORY_KEY = 'whoisleuth:ct-search-history:v1';
export const LEGACY_DETECTION_RULES_KEY = 'whoisleuth-detection-rules-v1';
export const LEGACY_RELATIONSHIP_OBSERVATIONS_KEY = 'whoisleuth-relationship-observations-v1';
export const LEGACY_BULK_SESSIONS_KEY = 'whoisleuth-bulk-sessions-v1';
export const LEGACY_WEBSITE_SNAPSHOTS_KEY = 'whoisleuth-website-snapshots-v1';
export const LEGACY_INVESTIGATION_TEMPLATES_KEY = 'whoisleuth-investigation-templates-v1';
export const LEGACY_BULK_REVIEW_KEY = 'whoisleuth-bulk-review-v1';

function recordsFromArray<T>(values: readonly T[], key: (value: T) => unknown): LocalDataRecord[] {
  return values.map((value) => ({ id: String(key(value) ?? ''), value }));
}

function arrayFromRecords(records: readonly LocalDataRecord[]): unknown[] {
  return records.map((record) => record.value);
}

export const CASES_COLLECTION: LocalDataCollectionDefinition<CaseRecord[]> = Object.freeze({
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

export const CAMPAIGNS_COLLECTION: LocalDataCollectionDefinition<CampaignRecord[]> = Object.freeze({
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

export const PROFILES_COLLECTION: LocalDataCollectionDefinition<BrandProfile[]> = Object.freeze({
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

export const WATCHLISTS_COLLECTION: LocalDataCollectionDefinition<WatchlistCollection> = Object.freeze({
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

export const SHORTLIST_COLLECTION: LocalDataCollectionDefinition<ShortlistRecord[]> = Object.freeze({
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

export const CT_HISTORY_COLLECTION: LocalDataCollectionDefinition<CtHistoryStore> = Object.freeze({
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

export const DETECTION_RULES_COLLECTION: LocalDataCollectionDefinition<DetectionRule[]> = Object.freeze({
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

export const RELATIONSHIP_OBSERVATIONS_COLLECTION: LocalDataCollectionDefinition<RelationshipObservation[]> = Object.freeze({
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

export const BULK_SESSIONS_COLLECTION: LocalDataCollectionDefinition<BulkSession[]> = Object.freeze({
  id: 'bulk_sessions',
  label: 'Saved Bulk sessions',
  legacyKey: LEGACY_BULK_SESSIONS_KEY,
  schemaVersion: BULK_SESSION_SCHEMA_VERSION,
  maximumBytes: MAX_BULK_SESSION_STORE_BYTES,
  maximumRecords: MAX_BULK_SESSIONS,
  empty: () => [],
  normalize: (raw) => normalizeBulkSessionStore(raw).sessions,
  version: bulkSessionStoreVersion,
  serialize: serializeBulkSessionStore,
  split: (sessions) => recordsFromArray(sessions, (record) => record.id),
  join: (records, schemaVersion) => ({
    schema: BULK_SESSION_SCHEMA,
    version: schemaVersion,
    sessions: arrayFromRecords(records),
  }),
});

export const WEBSITE_SNAPSHOTS_COLLECTION: LocalDataCollectionDefinition<WebsiteProfileSnapshot[]> = Object.freeze({
  id: 'website_snapshots',
  label: 'Website profile snapshots',
  legacyKey: LEGACY_WEBSITE_SNAPSHOTS_KEY,
  schemaVersion: WEBSITE_SNAPSHOT_SCHEMA_VERSION,
  maximumBytes: MAX_WEBSITE_SNAPSHOT_STORE_BYTES,
  maximumRecords: MAX_WEBSITE_SNAPSHOTS,
  empty: () => [],
  normalize: (raw) => normalizeWebsiteSnapshotStore(raw).snapshots,
  version: websiteSnapshotStoreVersion,
  serialize: serializeWebsiteSnapshotStore,
  split: (snapshots) => recordsFromArray(snapshots, (record) => record.id),
  join: (records, schemaVersion) => ({
    schema: WEBSITE_SNAPSHOT_SCHEMA,
    version: schemaVersion,
    snapshots: arrayFromRecords(records),
  }),
});

export const INVESTIGATION_TEMPLATES_COLLECTION: LocalDataCollectionDefinition<InvestigationTemplate[]> = Object.freeze({
  id: 'investigation_templates',
  label: 'Investigation templates',
  legacyKey: LEGACY_INVESTIGATION_TEMPLATES_KEY,
  schemaVersion: INVESTIGATION_TEMPLATE_VERSION,
  maximumBytes: MAX_INVESTIGATION_TEMPLATE_STORE_BYTES,
  maximumRecords: MAX_INVESTIGATION_TEMPLATES,
  empty: () => [],
  normalize: (raw) => normalizeInvestigationTemplateStore(raw).templates,
  version: investigationTemplateStoreVersion,
  serialize: serializeInvestigationTemplateStore,
  split: (templates) => recordsFromArray(templates, (record) => record.id),
  join: (records, schemaVersion) => ({
    schema: INVESTIGATION_TEMPLATE_SCHEMA,
    version: schemaVersion,
    templates: arrayFromRecords(records),
  }),
});

export const BULK_REVIEW_COLLECTION: LocalDataCollectionDefinition<BulkReviewStore> = Object.freeze({
  id: 'bulk_review',
  label: 'Bulk review views and queue state',
  legacyKey: LEGACY_BULK_REVIEW_KEY,
  schemaVersion: BULK_REVIEW_SCHEMA_VERSION,
  maximumBytes: MAX_BULK_REVIEW_STORE_BYTES,
  maximumRecords: MAX_BULK_REVIEW_PRESETS + MAX_BULK_REVIEW_ROWS,
  empty: () => enforceBulkReviewBudget(null),
  normalize: enforceBulkReviewBudget,
  version: bulkReviewStoreVersion,
  serialize: serializeBulkReviewStore,
  split: (store) => bulkReviewRecords(store).map((value) => ({ id: value.id, value })),
  join: (records) => bulkReviewStoreFromRecords(records.map((record) => record.value)),
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
  BULK_SESSIONS_COLLECTION,
  WEBSITE_SNAPSHOTS_COLLECTION,
  INVESTIGATION_TEMPLATES_COLLECTION,
  BULK_REVIEW_COLLECTION,
]);

function browserLocalCollectionDefinition(
  collection: BrowserLocalCollectionId,
): AnyLocalDataCollectionDefinition {
  const definition = BROWSER_LOCAL_COLLECTIONS.find((candidate) => candidate.id === collection);
  if (!definition) {
    throw new BrowserLocalDataError('INVALID_LOCAL_DATA_DEFINITION', `The ${collection} collection is unavailable.`);
  }
  return definition;
}

/**
 * Decode one stored record through the configured codec and its owning
 * collection normalizer. The final type association is asserted only after the
 * authoritative model accepts the record and preserves its identifier.
 */
export async function decodeBrowserLocalCollectionRecord<Collection extends BrowserLocalCollectionId>(
  collection: Collection,
  record: BrowserLocalStoredRecord,
  manifest: BrowserLocalCollectionManifest,
): Promise<BrowserLocalDecodedCollectionRecord<Collection>> {
  const definition = browserLocalCollectionDefinition(collection);
  if (record.collection !== collection
    || manifest.collection !== collection
    || record.codec !== manifest.codec
    || record.codec !== plaintextJsonCodec.id) {
    throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', `The ${collection} record metadata is inconsistent.`);
  }
  const payloadBytes = new TextEncoder().encode(record.payload).byteLength;
  if (record.payloadBytes !== payloadBytes
    || payloadBytes > definition.maximumBytes
    || !Number.isSafeInteger(record.ordinal)
    || record.ordinal < 0
    || record.ordinal >= definition.maximumRecords
    || !Number.isSafeInteger(manifest.schemaVersion)
    || manifest.schemaVersion < 1
    || manifest.schemaVersion > definition.schemaVersion) {
    throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', `The ${collection} record bounds are inconsistent.`);
  }
  const decoded = await plaintextJsonCodec.decode({
    collection,
    lookupKey: record.lookupKey,
    payload: record.payload,
  });
  const normalizedDocument = definition.normalize(definition.join(
    [{ id: decoded.id, value: decoded.value }],
    manifest.schemaVersion,
  ));
  const normalizedRecords = definition.split(normalizedDocument);
  const normalized = normalizedRecords.length === 1 && normalizedRecords[0]?.id === decoded.id
    ? normalizedRecords[0]
    : null;
  if (!normalized) {
    throw new BrowserLocalDataError('LOCAL_DATA_INTEGRITY', `The ${collection} record failed model validation.`);
  }
  return {
    id: normalized.id,
    value: normalized.value as BrowserLocalCollectionValueMap[Collection],
  };
}
