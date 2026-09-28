import { normalizeCaseStore, parseStoreVersion } from '../../../packages/cases/case-migration-model.mts';
import { serializeCaseStore } from '../../../packages/cases/case-storage-model.mts';
import type { CaseRecord } from '../../../packages/cases/case-model.mts';
import {
  campaignStoreVersion,
  normalizeCampaignStore,
  serializeCampaignStore,
} from '../../../packages/workspace/campaign-model.mts';
import type { CampaignRecord } from '../../../packages/workspace/campaign-model.mts';
import {
  brandProfileStoreVersion,
  normalizeBrandProfileStore,
  serializeBrandProfileStore,
} from '../../../packages/workspace/brand-profile-model.mts';
import type { BrandProfile } from '../../../packages/workspace/brand-profile-model.mts';
import {
  WATCHLIST_SCHEMA,
  normalizeWatchlistStore,
  serializeWatchlistStore,
  watchlistStoreVersion,
} from '../../../packages/workspace/watchlist-store.mts';
import type { WatchlistCollection } from '../../../packages/workspace/watchlist-store.mts';
import {
  SHORTLIST_SCHEMA,
  normalizeShortlistStore,
  serializeShortlistStore,
  shortlistStoreVersion,
} from '../../../packages/workspace/shortlist-model.mts';
import type { ShortlistRecord } from '../../../packages/workspace/shortlist-model.mts';
import {
  ctHistoryStoreVersion,
  emptyCtHistoryStore,
  enforceCtHistoryBudget,
  normalizeCtHistoryStore,
  serializeCtHistoryStore,
} from '../../../packages/workspace/ct-history.mts';
import type { CtHistoryStore } from '../../../packages/workspace/ct-history.mts';
import {
  detectionRuleStoreVersion,
  normalizeDetectionRuleStore,
  serializeDetectionRuleStore,
} from '../../../packages/workspace/detection-rule-model.mts';
import type { DetectionRule } from '../../../packages/workspace/detection-rule-model.mts';
import {
  RELATIONSHIP_OBSERVATION_SCHEMA,
  normalizeRelationshipObservationStore,
  relationshipObservationStoreVersion,
  serializeRelationshipObservationStore,
} from '../../../packages/workspace/relationship-observation-model.mts';
import type { RelationshipObservation } from '../../../packages/workspace/relationship-observation-model.mts';
import {
  BULK_SESSION_SCHEMA,
  bulkSessionStorageValue,
  bulkSessionStoreVersion,
  normalizeBulkSessionStore,
  serializeNormalizedBulkSessions,
} from '../../../packages/workspace/bulk-session-model.mts';
import type { BulkSession } from '../../../packages/workspace/bulk-session-model.mts';
import {
  WEBSITE_SNAPSHOT_SCHEMA,
  normalizeWebsiteSnapshotStore,
  serializeWebsiteSnapshotStore,
  websiteSnapshotStoreVersion,
} from '../../../packages/workspace/website-snapshot-model.mts';
import type { WebsiteProfileSnapshot } from '../../../packages/workspace/website-snapshot-model.mts';
import {
  INVESTIGATION_TEMPLATE_SCHEMA,
  investigationTemplateStoreVersion,
  normalizeInvestigationTemplateStore,
  serializeInvestigationTemplateStore,
} from '../../../packages/workspace/investigation-template-model.mts';
import type { InvestigationTemplate } from '../../../packages/workspace/investigation-template-model.mts';
import {
  BULK_REVIEW_SCHEMA,
  bulkReviewRecords,
  bulkReviewStoreFromRecords,
  bulkReviewStoreVersion,
  enforceBulkReviewBudget,
  serializeBulkReviewStore,
} from '../../../packages/workspace/bulk-review-model.mts';
import type { BulkReviewStore } from '../../../packages/workspace/bulk-review-model.mts';
import {
  ANALYST_REVIEW_STATE_SCHEMA,
  ANALYST_REVIEW_STATE_BROWSER_STORAGE_REVISION,
  analystReviewStateRecords,
  analystReviewStateStoreFromRecords,
  analystReviewStateStoreVersion,
  emptyAnalystReviewStateStore,
  migrateDevelopmentAnalystReviewStateStore,
  serializeAnalystReviewStateStore,
} from '../../../packages/monitoring/analyst-review-state.mts';
import type { AnalystReviewStateStore } from '../../../packages/monitoring/analyst-review-state.mts';
import {
  BrowserLocalDataError,
  plaintextJsonCodec,
} from './browser-local-data-content.ts';
import type {
  AnyLocalDataCollectionDefinition,
  BrowserLocalCollectionManifest,
  BrowserLocalStoredRecord,
  LocalDataCollectionDefinition,
  LocalDataRecord,
} from './browser-local-data-content.ts';
import {
  LEGACY_BULK_REVIEW_KEY,
  LEGACY_ANALYST_REVIEW_STATE_KEY,
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
import { BROWSER_LOCAL_COLLECTION_MANIFEST, BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID } from '../../../packages/contracts/browser-local-collection-manifest.mts';
import { CASE_DRAFT_SCHEMA, type CaseDraftStore } from '../../../packages/contracts/case-drafts.mts';
import { emptyCaseDraftStore, normalizeCaseDraftStore, serializeCaseDraftStore, caseDraftStoreVersion } from '../../../packages/cases/case-drafts.mts';
import { caseAttachmentReferences } from '../../../packages/cases/case-attachment-model.mts';
import { CASE_VIEWS_SCHEMA, type CaseViewsStore } from '../../../packages/contracts/case-views-contract.mts';
import { caseViewsStoreVersion, emptyCaseViewsStore, normalizeCaseViewsStore, serializeCaseViewsStore } from '../../../packages/workspace/case-views.mts';
import { REVIEW_SESSION_SCHEMA, type ReviewSessionStore } from '../../../packages/contracts/review-session-contract.mts';
import { emptyReviewSessionStore, normalizeReviewSessionStore, reviewSessionStoreVersion, serializeReviewSessionStore } from '../../../packages/workspace/review-session.mts';

export type BrowserLocalCollectionId = keyof typeof BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID;
export type BrowserLocalDecodedCollectionRecord<Collection extends BrowserLocalCollectionId> = Readonly<{
  id: string;
  value: BrowserLocalCollectionValueMap[Collection];
}>;

function recordsFromArray<T>(values: readonly T[], key: (value: T) => unknown): LocalDataRecord<T>[] {
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
  options: Readonly<{ schema?: string }> = {},
): boolean {
  if (Array.isArray(raw)) return false;
  const value = record(raw);
  if (!value || !positiveVersion(value.version) || !Array.isArray(value[key])) return false;
  if (options.schema !== undefined && value.schema !== options.schema) return false;
  if (options.schema === undefined && Object.hasOwn(value, 'schema')) return false;
  return true;
}

function watchlistVersionedRoot(raw: unknown): boolean {
  const value = record(raw);
  return value?.schema === WATCHLIST_SCHEMA
    && positiveVersion(value.version)
    && record(value.watchlists) !== null;
}

export const CASES_COLLECTION = Object.freeze({
  ...BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.cases,
  legacyKey: LEGACY_CASES_KEY,
  empty: () => [],
  // Recognise the retired unversioned list only so the provider can preserve
  // it and report the explicit retired-schema path; it is never normalised.
  acceptLegacyRoot: (raw) => Array.isArray(raw) || arrayOrVersionedList(raw, 'cases'),
  normalize: (raw) => normalizeCaseStore(raw).cases,
  version: parseStoreVersion,
  serialize: serializeCaseStore,
  split: (cases) => recordsFromArray(cases, (record) => record.id),
  binaryReferences: caseAttachmentReferences,
  join: (records, schemaVersion) => ({ version: schemaVersion, cases: arrayFromRecords(records) }),
} satisfies LocalDataCollectionDefinition<CaseRecord[]>);

export const CAMPAIGNS_COLLECTION = Object.freeze({
  ...BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.campaigns,
  legacyKey: LEGACY_CAMPAIGNS_KEY,
  empty: () => [],
  acceptLegacyRoot: (raw) => arrayOrVersionedList(raw, 'campaigns'),
  normalize: (raw) => normalizeCampaignStore(raw).campaigns,
  version: campaignStoreVersion,
  serialize: serializeCampaignStore,
  split: (campaigns) => recordsFromArray(campaigns, (record) => record.id),
  join: (records, schemaVersion) => ({ version: schemaVersion, campaigns: arrayFromRecords(records) }),
} satisfies LocalDataCollectionDefinition<CampaignRecord[]>);

export const PROFILES_COLLECTION = Object.freeze({
  ...BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.brand_profiles,
  legacyKey: LEGACY_PROFILES_KEY,
  empty: () => [],
  acceptLegacyRoot: (raw) => arrayOrVersionedList(raw, 'profiles'),
  normalize: (raw) => normalizeBrandProfileStore(raw).profiles,
  version: brandProfileStoreVersion,
  serialize: serializeBrandProfileStore,
  split: (profiles) => recordsFromArray(profiles, (record) => record.id),
  join: (records, schemaVersion) => ({ version: schemaVersion, profiles: arrayFromRecords(records) }),
} satisfies LocalDataCollectionDefinition<BrandProfile[]>);

export const WATCHLISTS_COLLECTION = Object.freeze({
  ...BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.watchlists,
  legacyKey: LEGACY_WATCHLIST_KEY,
  empty: () => ({}),
  acceptLegacyRoot: watchlistVersionedRoot,
  normalize: (raw) => normalizeWatchlistStore(raw).watchlists,
  version: watchlistStoreVersion,
  serialize: serializeWatchlistStore,
  split: (watchlists) => Object.entries(watchlists).map(([id, value]) => ({ id, value })),
  join: (records, schemaVersion) => ({
    schema: WATCHLIST_SCHEMA,
    version: schemaVersion,
    watchlists: Object.fromEntries(records.map((record) => [record.id, record.value])),
  }),
} satisfies LocalDataCollectionDefinition<WatchlistCollection>);

export const SHORTLIST_COLLECTION = Object.freeze({
  ...BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.shortlist,
  legacyKey: LEGACY_SHORTLIST_KEY,
  empty: () => [],
  acceptLegacyRoot: (raw) => arrayOrVersionedList(raw, 'entries', { schema: SHORTLIST_SCHEMA }),
  normalize: (raw) => normalizeShortlistStore(raw).entries,
  version: shortlistStoreVersion,
  serialize: serializeShortlistStore,
  split: (entries) => recordsFromArray(entries, (record) => record.domain),
  join: (records, schemaVersion) => ({ schema: SHORTLIST_SCHEMA, version: schemaVersion, entries: arrayFromRecords(records) }),
} satisfies LocalDataCollectionDefinition<ShortlistRecord[]>);

export const CT_HISTORY_COLLECTION = Object.freeze({
  ...BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.ct_history,
  legacyKey: LEGACY_CT_HISTORY_KEY,
  empty: emptyCtHistoryStore,
  acceptLegacyRoot: (raw) => arrayOrVersionedList(raw, 'entries'),
  normalize: (raw) => enforceCtHistoryBudget(normalizeCtHistoryStore(raw)),
  version: ctHistoryStoreVersion,
  serialize: serializeCtHistoryStore,
  split: (store) => recordsFromArray(store.entries, (record) => record.query),
  join: (records, schemaVersion) => ({ version: schemaVersion, entries: arrayFromRecords(records) }),
} satisfies LocalDataCollectionDefinition<CtHistoryStore>);

export const DETECTION_RULES_COLLECTION = Object.freeze({
  ...BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.detection_rules,
  legacyKey: LEGACY_DETECTION_RULES_KEY,
  empty: () => [],
  acceptLegacyRoot: (raw) => arrayOrVersionedList(raw, 'rules'),
  normalize: (raw) => normalizeDetectionRuleStore(raw).rules,
  version: detectionRuleStoreVersion,
  serialize: serializeDetectionRuleStore,
  split: (rules) => recordsFromArray(rules, (record) => record.id),
  join: (records, schemaVersion) => ({ version: schemaVersion, rules: arrayFromRecords(records) }),
} satisfies LocalDataCollectionDefinition<DetectionRule[]>);

export const RELATIONSHIP_OBSERVATIONS_COLLECTION = Object.freeze({
  ...BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.relationship_observations,
  legacyKey: LEGACY_RELATIONSHIP_OBSERVATIONS_KEY,
  empty: () => [],
  acceptLegacyRoot: (raw) => arrayOrVersionedList(raw, 'observations', { schema: RELATIONSHIP_OBSERVATION_SCHEMA }),
  normalize: (raw) => normalizeRelationshipObservationStore(raw).observations,
  version: relationshipObservationStoreVersion,
  serialize: serializeRelationshipObservationStore,
  split: (observations) => recordsFromArray(observations, (record) => record.id),
  join: (records, schemaVersion) => ({
    schema: RELATIONSHIP_OBSERVATION_SCHEMA,
    version: schemaVersion,
    observations: arrayFromRecords(records),
  }),
} satisfies LocalDataCollectionDefinition<RelationshipObservation[]>);

export const BULK_SESSIONS_COLLECTION = Object.freeze({
  ...BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.bulk_sessions,
  legacyKey: LEGACY_BULK_SESSIONS_KEY,
  empty: () => [],
  acceptLegacyRoot: (raw) => arrayOrVersionedList(raw, 'sessions', { schema: BULK_SESSION_SCHEMA }),
  normalize: (raw) => normalizeBulkSessionStore(raw).sessions,
  version: bulkSessionStoreVersion,
  serialize: serializeNormalizedBulkSessions,
  split: (sessions) => recordsFromArray(sessions, (record) => record.id),
  storageRecords: (sessions) => recordsFromArray(sessions.map(bulkSessionStorageValue), (record) => record.id),
  join: (records, schemaVersion) => ({
    schema: BULK_SESSION_SCHEMA,
    version: schemaVersion,
    sessions: arrayFromRecords(records),
  }),
} satisfies LocalDataCollectionDefinition<BulkSession[]>);

export const WEBSITE_SNAPSHOTS_COLLECTION = Object.freeze({
  ...BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.website_snapshots,
  legacyKey: LEGACY_WEBSITE_SNAPSHOTS_KEY,
  empty: () => [],
  acceptLegacyRoot: (raw) => arrayOrVersionedList(raw, 'snapshots', { schema: WEBSITE_SNAPSHOT_SCHEMA }),
  normalize: (raw) => normalizeWebsiteSnapshotStore(raw).snapshots,
  version: websiteSnapshotStoreVersion,
  serialize: serializeWebsiteSnapshotStore,
  split: (snapshots) => recordsFromArray(snapshots, (record) => record.id),
  join: (records, schemaVersion) => ({
    schema: WEBSITE_SNAPSHOT_SCHEMA,
    version: schemaVersion,
    snapshots: arrayFromRecords(records),
  }),
} satisfies LocalDataCollectionDefinition<WebsiteProfileSnapshot[]>);

export const INVESTIGATION_TEMPLATES_COLLECTION = Object.freeze({
  ...BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.investigation_templates,
  legacyKey: LEGACY_INVESTIGATION_TEMPLATES_KEY,
  empty: () => [],
  acceptLegacyRoot: (raw) => arrayOrVersionedList(raw, 'templates', { schema: INVESTIGATION_TEMPLATE_SCHEMA }),
  normalize: (raw) => normalizeInvestigationTemplateStore(raw).templates,
  version: investigationTemplateStoreVersion,
  serialize: serializeInvestigationTemplateStore,
  split: (templates) => recordsFromArray(templates, (record) => record.id),
  join: (records, schemaVersion) => ({
    schema: INVESTIGATION_TEMPLATE_SCHEMA,
    version: schemaVersion,
    templates: arrayFromRecords(records),
  }),
} satisfies LocalDataCollectionDefinition<InvestigationTemplate[]>);

export const BULK_REVIEW_COLLECTION = Object.freeze({
  ...BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.bulk_review,
  legacyKey: LEGACY_BULK_REVIEW_KEY,
  empty: () => enforceBulkReviewBudget(null),
  acceptLegacyRoot: (raw) => (
    record(raw)?.schema === BULK_REVIEW_SCHEMA
    && positiveVersion(record(raw)?.version)
    && Array.isArray(record(raw)?.presets)
    && Array.isArray(record(raw)?.rows)
  ),
  normalize: enforceBulkReviewBudget,
  version: bulkReviewStoreVersion,
  serialize: serializeBulkReviewStore,
  split: (store) => bulkReviewRecords(store).map((value) => ({ id: value.id, value })),
  join: (records) => bulkReviewStoreFromRecords(records.map((record) => record.value)),
} satisfies LocalDataCollectionDefinition<BulkReviewStore>);

export const ANALYST_REVIEW_STATE_COLLECTION = Object.freeze({
  ...BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.analyst_review_state,
  legacyKey: LEGACY_ANALYST_REVIEW_STATE_KEY,
  empty: emptyAnalystReviewStateStore,
  acceptLegacyRoot: (raw) => (
    record(raw)?.schema === ANALYST_REVIEW_STATE_SCHEMA
    && positiveVersion(record(raw)?.version)
    && Array.isArray(record(raw)?.records)
  ),
  normalize: migrateDevelopmentAnalystReviewStateStore,
  version: analystReviewStateStoreVersion,
  serialize: serializeAnalystReviewStateStore,
  split: (store) => analystReviewStateRecords(store).map((value) => ({ id: value.subjectKey, value })),
  join: (records, storageRevision) => storageRevision < ANALYST_REVIEW_STATE_BROWSER_STORAGE_REVISION
    ? migrateDevelopmentAnalystReviewStateStore({
      schema: ANALYST_REVIEW_STATE_SCHEMA,
      version: 1,
      records: records.map((record) => record.value),
    })
    : analystReviewStateStoreFromRecords(records.map((record) => record.value)),
} satisfies LocalDataCollectionDefinition<AnalystReviewStateStore>);

export const CASE_DRAFTS_COLLECTION = Object.freeze({
  ...BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.case_drafts,
  legacyKey: 'whoisleuth-case-drafts-v1',
  legacyRollback: false,
  empty: emptyCaseDraftStore,
  acceptLegacyRoot: (raw) => record(raw)?.schema === CASE_DRAFT_SCHEMA && positiveVersion(record(raw)?.version) && Array.isArray(record(raw)?.records),
  normalize: normalizeCaseDraftStore,
  version: caseDraftStoreVersion,
  serialize: serializeCaseDraftStore,
  split: (store) => store.records.map(value => ({ id: value.id, value })),
  join: (records, version) => ({ schema: CASE_DRAFT_SCHEMA, version, records: records.map(item => item.value) }),
} satisfies LocalDataCollectionDefinition<CaseDraftStore>);

export const CASE_VIEWS_COLLECTION = Object.freeze({
  ...BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.case_views,
  legacyKey: 'whoisleuth-case-views-v1',
  legacyRollback: false,
  empty: emptyCaseViewsStore,
  acceptLegacyRoot: (raw) => record(raw)?.schema === CASE_VIEWS_SCHEMA && positiveVersion(record(raw)?.version) && Array.isArray(record(raw)?.views),
  normalize: normalizeCaseViewsStore,
  version: caseViewsStoreVersion,
  serialize: serializeCaseViewsStore,
  split: (store) => store.views.map(value => ({ id: value.id, value })),
  join: (records, version) => ({ schema: CASE_VIEWS_SCHEMA, version, views: records.map(item => item.value) }),
} satisfies LocalDataCollectionDefinition<CaseViewsStore>);

export const REVIEW_SESSION_COLLECTION = Object.freeze({
  ...BROWSER_LOCAL_COLLECTION_MANIFEST_BY_ID.review_session,
  legacyKey: 'whoisleuth-review-session-v1', legacyRollback: false,
  empty: emptyReviewSessionStore,
  acceptLegacyRoot: raw => record(raw)?.schema === REVIEW_SESSION_SCHEMA && positiveVersion(record(raw)?.version) && Array.isArray(record(raw)?.records),
  normalize: normalizeReviewSessionStore, version: reviewSessionStoreVersion, serialize: serializeReviewSessionStore,
  split: store => store.records.map(value => ({ id: value.id, value })),
  join: (records, version) => ({ schema: REVIEW_SESSION_SCHEMA, version, records: records.map(item => item.value) }),
} satisfies LocalDataCollectionDefinition<ReviewSessionStore>);

const browserLocalCollectionsById = {
  review_session: REVIEW_SESSION_COLLECTION,
  case_drafts: CASE_DRAFTS_COLLECTION,
  case_views: CASE_VIEWS_COLLECTION,
  cases: CASES_COLLECTION,
  campaigns: CAMPAIGNS_COLLECTION,
  brand_profiles: PROFILES_COLLECTION,
  watchlists: WATCHLISTS_COLLECTION,
  shortlist: SHORTLIST_COLLECTION,
  ct_history: CT_HISTORY_COLLECTION,
  detection_rules: DETECTION_RULES_COLLECTION,
  relationship_observations: RELATIONSHIP_OBSERVATIONS_COLLECTION,
  bulk_sessions: BULK_SESSIONS_COLLECTION,
  website_snapshots: WEBSITE_SNAPSHOTS_COLLECTION,
  investigation_templates: INVESTIGATION_TEMPLATES_COLLECTION,
  bulk_review: BULK_REVIEW_COLLECTION,
  analyst_review_state: ANALYST_REVIEW_STATE_COLLECTION,
} satisfies Readonly<Record<BrowserLocalCollectionId, AnyLocalDataCollectionDefinition>>;

export type BrowserLocalCollectionDocumentMap = {
  readonly [Collection in BrowserLocalCollectionId]: ReturnType<typeof browserLocalCollectionsById[Collection]['normalize']>;
};

export type BrowserLocalCollectionValueMap = {
  readonly [Collection in BrowserLocalCollectionId]: ReturnType<typeof browserLocalCollectionsById[Collection]['split']>[number]['value'];
};

export const BROWSER_LOCAL_COLLECTIONS = Object.freeze(
  BROWSER_LOCAL_COLLECTION_MANIFEST.map(({ id }) => browserLocalCollectionsById[id]),
);

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
    maximumBytes: definition.maximumBytes,
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
