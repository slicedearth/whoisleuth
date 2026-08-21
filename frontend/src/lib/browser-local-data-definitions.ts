import {
  normalizeCaseStore,
  parseStoreVersion,
  serializeCaseStore,
} from './analysis/case-model.ts';
import type { CaseRecord } from './analysis/case-model.ts';
import {
  campaignStoreVersion,
  normalizeCampaignStore,
  serializeCampaignStore,
} from './analysis/campaign-model.ts';
import type { CampaignRecord } from './analysis/campaign-model.ts';
import {
  BRAND_PROFILE_SCHEMA,
  brandProfileStoreVersion,
  normalizeBrandProfileStore,
  serializeBrandProfileStore,
} from './analysis/brand-profile-model.ts';
import type { BrandProfile } from './analysis/brand-profile-model.ts';
import {
  normalizeWatchlistStore,
  serializeWatchlistStore,
  watchlistStoreVersion,
} from './analysis/watchlist-store.ts';
import type { WatchlistCollection, WatchlistEntry } from './analysis/watchlist-store.ts';
import {
  normalizeShortlistStore,
  serializeShortlistStore,
  shortlistStoreVersion,
} from './analysis/shortlist-model.ts';
import type { ShortlistRecord } from './analysis/shortlist-model.ts';
import {
  ctHistoryStoreVersion,
  emptyCtHistoryStore,
  enforceCtHistoryBudget,
  normalizeCtHistoryStore,
  serializeCtHistoryStore,
} from './analysis/ct-history.ts';
import type { CtHistoryEntry, CtHistoryStore } from './analysis/ct-history.ts';
import {
  detectionRuleStoreVersion,
  normalizeDetectionRuleStore,
  serializeDetectionRuleStore,
} from './analysis/detection-rule-model.ts';
import type { DetectionRule } from './analysis/detection-rule-model.ts';
import {
  RELATIONSHIP_OBSERVATION_SCHEMA,
  normalizeRelationshipObservationStore,
  relationshipObservationStoreVersion,
  serializeRelationshipObservationStore,
} from './analysis/relationship-observation-model.ts';
import type { RelationshipObservation } from './analysis/relationship-observation-model.ts';
import {
  BULK_SESSION_SCHEMA,
  bulkSessionStoreVersion,
  normalizeBulkSessionStore,
  serializeBulkSessionStore,
} from './analysis/bulk-session-model.ts';
import type { BulkSession } from './analysis/bulk-session-model.ts';
import {
  WEBSITE_SNAPSHOT_SCHEMA,
  normalizeWebsiteSnapshotStore,
  serializeWebsiteSnapshotStore,
  websiteSnapshotStoreVersion,
} from './analysis/website-snapshot-model.ts';
import type { WebsiteProfileSnapshot } from './analysis/website-snapshot-model.ts';
import {
  INVESTIGATION_TEMPLATE_SCHEMA,
  investigationTemplateStoreVersion,
  normalizeInvestigationTemplateStore,
  serializeInvestigationTemplateStore,
} from './analysis/investigation-template-model.ts';
import type { InvestigationTemplate } from './analysis/investigation-template-model.ts';
import {
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
import {
  LEGACY_BULK_REVIEW_KEY,
  LEGACY_BULK_SESSIONS_KEY,
  LEGACY_CAMPAIGNS_KEY,
  LEGACY_CASES_KEY,
  LEGACY_CT_HISTORY_KEY,
  LEGACY_DETECTION_RULES_KEY,
  LEGACY_INVESTIGATION_TEMPLATES_KEY,
  LEGACY_PROFILES_KEY,
  LEGACY_RELATIONSHIP_OBSERVATIONS_KEY,
  LEGACY_SHORTLIST_KEY,
  LEGACY_WATCHLIST_KEY,
  LEGACY_WEBSITE_SNAPSHOTS_KEY,
} from './browser-local-data-contract.ts';
import { BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID } from '../../../packages/contracts/browser-local-collection-manifest.mts';

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

export type BrowserLocalCollectionDocumentMap = Readonly<{
  cases: CaseRecord[];
  campaigns: CampaignRecord[];
  brand_profiles: BrandProfile[];
  watchlists: WatchlistCollection;
  shortlist: ShortlistRecord[];
  ct_history: CtHistoryStore;
  detection_rules: DetectionRule[];
  relationship_observations: RelationshipObservation[];
  bulk_sessions: BulkSession[];
  website_snapshots: WebsiteProfileSnapshot[];
  investigation_templates: InvestigationTemplate[];
  bulk_review: BulkReviewStore;
}>;

export type BrowserLocalCollectionId = keyof BrowserLocalCollectionValueMap;
export type BrowserLocalDecodedCollectionRecord<Collection extends BrowserLocalCollectionId> = Readonly<{
  id: string;
  value: BrowserLocalCollectionValueMap[Collection];
}>;

function recordsFromArray<T>(values: readonly T[], key: (value: T) => unknown): LocalDataRecord[] {
  return values.map((value) => ({ id: String(key(value) ?? ''), value }));
}

function arrayFromRecords(records: readonly LocalDataRecord[]): unknown[] {
  return records.map((record) => record.value);
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function positiveVersion(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function arrayOrVersionedList(
  raw: unknown,
  key: string,
  options: Readonly<{ schema?: string; allowArray?: boolean }> = {},
): boolean {
  if (Array.isArray(raw)) return options.allowArray === true;
  const value = record(raw);
  if (!value || !positiveVersion(value.version) || !Array.isArray(value[key])) return false;
  if (options.schema !== undefined && value.schema !== options.schema) return false;
  if (options.schema === undefined && Object.hasOwn(value, 'schema')) return false;
  return true;
}

function watchlistLegacyRoot(raw: unknown): boolean {
  const value = record(raw);
  if (!value) return false;
  if (value.schema === 'whoisleuth.watchlists' && record(value.watchlists)) {
    const watchlists = record(value.watchlists);
    return positiveVersion(value.version) && watchlists !== null;
  }
  return Object.values(value).every((item) => Array.isArray(record(item)?.results));
}

export const CASES_COLLECTION: LocalDataCollectionDefinition<CaseRecord[]> = Object.freeze({
  ...BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.cases,
  legacyKey: LEGACY_CASES_KEY,
  empty: () => [],
  acceptLegacyRoot: (raw) => arrayOrVersionedList(raw, 'cases', { allowArray: true }),
  normalize: (raw) => normalizeCaseStore(raw).cases,
  version: parseStoreVersion,
  serialize: serializeCaseStore,
  split: (cases) => recordsFromArray(cases, (record) => record.id),
  join: (records, schemaVersion) => ({ version: schemaVersion, cases: arrayFromRecords(records) }),
});

export const CAMPAIGNS_COLLECTION: LocalDataCollectionDefinition<CampaignRecord[]> = Object.freeze({
  ...BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.campaigns,
  legacyKey: LEGACY_CAMPAIGNS_KEY,
  empty: () => [],
  acceptLegacyRoot: (raw) => arrayOrVersionedList(raw, 'campaigns', { allowArray: true }),
  normalize: (raw) => normalizeCampaignStore(raw).campaigns,
  version: campaignStoreVersion,
  serialize: serializeCampaignStore,
  split: (campaigns) => recordsFromArray(campaigns, (record) => record.id),
  join: (records, schemaVersion) => ({ version: schemaVersion, campaigns: arrayFromRecords(records) }),
});

export const PROFILES_COLLECTION: LocalDataCollectionDefinition<BrandProfile[]> = Object.freeze({
  ...BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.brand_profiles,
  legacyKey: LEGACY_PROFILES_KEY,
  empty: () => [],
  acceptLegacyRoot: (raw) => (
    arrayOrVersionedList(raw, 'profiles', { allowArray: true })
    || arrayOrVersionedList(raw, 'profiles', { schema: BRAND_PROFILE_SCHEMA })
  ),
  normalize: (raw) => normalizeBrandProfileStore(raw).profiles,
  version: brandProfileStoreVersion,
  serialize: serializeBrandProfileStore,
  split: (profiles) => recordsFromArray(profiles, (record) => record.id),
  join: (records, schemaVersion) => ({ version: schemaVersion, profiles: arrayFromRecords(records) }),
});

export const WATCHLISTS_COLLECTION: LocalDataCollectionDefinition<WatchlistCollection> = Object.freeze({
  ...BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.watchlists,
  legacyKey: LEGACY_WATCHLIST_KEY,
  empty: () => ({}),
  acceptLegacyRoot: watchlistLegacyRoot,
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
  ...BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.shortlist,
  legacyKey: LEGACY_SHORTLIST_KEY,
  empty: () => [],
  acceptLegacyRoot: (raw) => arrayOrVersionedList(raw, 'entries', { schema: 'whoisleuth.shortlist', allowArray: true }),
  normalize: (raw) => normalizeShortlistStore(raw).entries,
  version: shortlistStoreVersion,
  serialize: serializeShortlistStore,
  split: (entries) => recordsFromArray(entries, (record) => record.domain),
  join: (records, schemaVersion) => ({ schema: 'whoisleuth.shortlist', version: schemaVersion, entries: arrayFromRecords(records) }),
});

export const CT_HISTORY_COLLECTION: LocalDataCollectionDefinition<CtHistoryStore> = Object.freeze({
  ...BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.ct_history,
  legacyKey: LEGACY_CT_HISTORY_KEY,
  empty: emptyCtHistoryStore,
  acceptLegacyRoot: (raw) => arrayOrVersionedList(raw, 'entries'),
  normalize: (raw) => enforceCtHistoryBudget(normalizeCtHistoryStore(raw)),
  version: ctHistoryStoreVersion,
  serialize: serializeCtHistoryStore,
  split: (store) => recordsFromArray(store.entries, (record) => record.query),
  join: (records, schemaVersion) => ({ version: schemaVersion, entries: arrayFromRecords(records) }),
});

export const DETECTION_RULES_COLLECTION: LocalDataCollectionDefinition<DetectionRule[]> = Object.freeze({
  ...BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.detection_rules,
  legacyKey: LEGACY_DETECTION_RULES_KEY,
  empty: () => [],
  acceptLegacyRoot: (raw) => arrayOrVersionedList(raw, 'rules', { allowArray: true }),
  normalize: (raw) => normalizeDetectionRuleStore(raw).rules,
  version: detectionRuleStoreVersion,
  serialize: serializeDetectionRuleStore,
  split: (rules) => recordsFromArray(rules, (record) => record.id),
  join: (records, schemaVersion) => ({ version: schemaVersion, rules: arrayFromRecords(records) }),
});

export const RELATIONSHIP_OBSERVATIONS_COLLECTION: LocalDataCollectionDefinition<RelationshipObservation[]> = Object.freeze({
  ...BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.relationship_observations,
  legacyKey: LEGACY_RELATIONSHIP_OBSERVATIONS_KEY,
  empty: () => [],
  acceptLegacyRoot: (raw) => arrayOrVersionedList(raw, 'observations', { schema: RELATIONSHIP_OBSERVATION_SCHEMA, allowArray: true }),
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
  ...BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.bulk_sessions,
  legacyKey: LEGACY_BULK_SESSIONS_KEY,
  empty: () => [],
  acceptLegacyRoot: (raw) => arrayOrVersionedList(raw, 'sessions', { schema: BULK_SESSION_SCHEMA, allowArray: true }),
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
  ...BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.website_snapshots,
  legacyKey: LEGACY_WEBSITE_SNAPSHOTS_KEY,
  empty: () => [],
  acceptLegacyRoot: (raw) => arrayOrVersionedList(raw, 'snapshots', { schema: WEBSITE_SNAPSHOT_SCHEMA, allowArray: true }),
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
  ...BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.investigation_templates,
  legacyKey: LEGACY_INVESTIGATION_TEMPLATES_KEY,
  empty: () => [],
  acceptLegacyRoot: (raw) => arrayOrVersionedList(raw, 'templates', { schema: INVESTIGATION_TEMPLATE_SCHEMA, allowArray: true }),
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
  ...BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.bulk_review,
  legacyKey: LEGACY_BULK_REVIEW_KEY,
  empty: () => enforceBulkReviewBudget(null),
  acceptLegacyRoot: (raw) => Array.isArray(raw) || (
    record(raw)?.schema === 'whoisleuth.bulk-review'
    && positiveVersion(record(raw)?.version)
    && Array.isArray(record(raw)?.presets)
    && Array.isArray(record(raw)?.rows)
  ),
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
