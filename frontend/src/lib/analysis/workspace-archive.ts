// Pure, bounded workspace archive composition. Existing typed store models remain the
// authority for normalization and merge semantics; this module only packages
// their portable contracts, verifies integrity, and previews conflicts.

import {
  buildCaseExport,
  CASE_SCHEMA_VERSION,
  CASE_IMPORT_VERSIONS,
  enforceStoreBudget,
  mergeCases,
} from './case-model.ts';
import type { CaseRecord } from './case-model.ts';
import {
  assertBrandProfileStoreBudget,
  BRAND_PROFILE_SCHEMA,
  BRAND_PROFILE_SCHEMA_VERSION,
  buildBrandProfileExport,
  mergeBrandProfiles,
  normalizeBrandProfileId,
} from './brand-profile-model.ts';
import type { BrandProfile } from './brand-profile-model.ts';
import {
  assertCampaignStoreBudget,
  buildCampaignExport,
  CAMPAIGN_SCHEMA,
  CAMPAIGN_SCHEMA_VERSION,
  mergeCampaigns,
} from './campaign-model.ts';
import {
  assertWatchlistStoreBudget,
  buildWatchlistExport,
  mergeWatchlistStores,
  WATCHLIST_SCHEMA,
  WATCHLIST_SCHEMA_VERSION,
} from './watchlist-store.ts';
import {
  assertShortlistStoreBudget,
  buildShortlistExport,
  mergeShortlistStores,
  SHORTLIST_SCHEMA,
  SHORTLIST_SCHEMA_VERSION,
} from './shortlist-model.ts';
import {
  assertDetectionRuleStoreBudget,
  buildDetectionRuleExport,
  DETECTION_RULE_SCHEMA,
  DETECTION_RULE_SCHEMA_VERSION,
  mergeDetectionRules,
} from './detection-rule-model.ts';
import {
  buildRelationshipObservationExport,
  mergeRelationshipObservations,
  RELATIONSHIP_OBSERVATION_SCHEMA,
  RELATIONSHIP_OBSERVATION_SCHEMA_VERSION,
} from './relationship-observation-model.ts';
import {
  BULK_SESSION_SCHEMA,
  BULK_SESSION_SCHEMA_VERSION,
  buildBulkSessionExport,
  enforceBulkSessionStoreBudget,
  mergeBulkSessions,
} from './bulk-session-model.ts';
import {
  WEBSITE_SNAPSHOT_SCHEMA,
  WEBSITE_SNAPSHOT_SCHEMA_VERSION,
  buildWebsiteSnapshotExport,
  mergeWebsiteSnapshots,
} from './website-snapshot-model.ts';
import {
  INVESTIGATION_TEMPLATE_SCHEMA,
  INVESTIGATION_TEMPLATE_VERSION,
  buildInvestigationTemplateExport,
  mergeInvestigationTemplates,
} from './investigation-template-model.ts';
import {
  BULK_REVIEW_SCHEMA,
  BULK_REVIEW_SCHEMA_VERSION,
  buildBulkReviewExport,
  mergeBulkReviewStores,
} from './bulk-review-model.ts';

export const WORKSPACE_ARCHIVE_SCHEMA = 'whoisleuth.workspace-archive';
export const WORKSPACE_ARCHIVE_VERSION = 5;
export const SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS = [1, 2, 3, 4, WORKSPACE_ARCHIVE_VERSION] as const;
export const WORKSPACE_SETTINGS_SCHEMA = 'whoisleuth.workspace-settings';
export const WORKSPACE_SETTINGS_VERSION = 1;
export const MAX_WORKSPACE_ARCHIVE_BYTES = 10 * 1024 * 1024;
export const MAX_WORKSPACE_ARCHIVE_SECTION_BYTES = 5 * 1024 * 1024;
export const MAX_WORKSPACE_ARCHIVE_SECTIONS = 12;

export const WORKSPACE_ARCHIVE_SECTION_IDS = [
  'cases',
  'campaigns',
  'brandProfiles',
  'watchlists',
  'shortlist',
  'detectionRules',
  'relationshipObservations',
  'bulkSessions',
  'websiteSnapshots',
  'investigationTemplates',
  'bulkReview',
  'settings',
] as const;

export function isSupportedWorkspaceArchiveVersion(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS.some((version) => version === value);
}

export type WorkspaceArchiveSectionId = typeof WORKSPACE_ARCHIVE_SECTION_IDS[number];
export type WorkspaceArchiveSectionStatus = 'ready' | 'unsupported';
export type WorkspaceArchivePreviewStatus = WorkspaceArchiveSectionStatus | 'blocked';
export type WorkspaceTheme = 'dark' | 'light' | 'system';
type UnknownRecord = Record<string, unknown>;

export interface WorkspaceArchiveOptions {
  generatedAt?: unknown;
  cryptoProvider?: {
    subtle?: {
      digest?: (algorithm: AlgorithmIdentifier, data: BufferSource) => Promise<ArrayBuffer>;
    };
  };
}

export interface WorkspaceArchiveManifestEntry {
  id: string;
  schema: string | null;
  version: number;
  recordCount: number;
  bytes: number;
  checksum: string;
}

export interface WorkspaceArchiveManifest {
  sectionCount: number;
  totalRecords: number;
  sections: WorkspaceArchiveManifestEntry[];
}

export interface WorkspaceSettings {
  activeProfileId: string;
  theme: WorkspaceTheme;
}

export interface WorkspaceSettingsDocument {
  schema: typeof WORKSPACE_SETTINGS_SCHEMA;
  version: typeof WORKSPACE_SETTINGS_VERSION;
  activeProfileId: string;
  theme: WorkspaceTheme;
}

export interface WorkspaceArchiveSectionMap {
  cases: ReturnType<typeof buildCaseExport>;
  campaigns: ReturnType<typeof buildCampaignExport>;
  brandProfiles: ReturnType<typeof buildBrandProfileExport>;
  watchlists: ReturnType<typeof buildWatchlistExport>;
  shortlist: ReturnType<typeof buildShortlistExport>;
  detectionRules: ReturnType<typeof buildDetectionRuleExport>;
  relationshipObservations: ReturnType<typeof buildRelationshipObservationExport>;
  bulkSessions: ReturnType<typeof buildBulkSessionExport>;
  websiteSnapshots: ReturnType<typeof buildWebsiteSnapshotExport>;
  investigationTemplates: ReturnType<typeof buildInvestigationTemplateExport>;
  bulkReview: ReturnType<typeof buildBulkReviewExport>;
  settings: WorkspaceSettingsDocument;
}

export interface WorkspaceArchiveDocument {
  schema: typeof WORKSPACE_ARCHIVE_SCHEMA;
  version: typeof WORKSPACE_ARCHIVE_VERSION;
  generatedAt: string;
  manifest: WorkspaceArchiveManifest;
  sections: WorkspaceArchiveSectionMap;
  limitations: string[];
}

export interface WorkspaceArchiveSection extends WorkspaceArchiveManifestEntry {
  label: string;
  status: WorkspaceArchiveSectionStatus;
  reason: string;
  data: unknown;
}

export interface WorkspaceArchivePreviewSection extends Omit<WorkspaceArchiveSection, 'status'> {
  status: WorkspaceArchivePreviewStatus;
  added: number;
  updated: number;
  skipped: number;
  pruned?: number;
  selected: boolean;
  normalizedSettings?: WorkspaceSettings | null;
}

interface NormalizedWorkspaceInput {
  cases: CaseRecord[];
  campaigns: unknown[];
  brandProfiles: BrandProfile[];
  watchlists: UnknownRecord;
  shortlist: unknown[];
  detectionRules: unknown[];
  relationshipObservations: unknown[];
  bulkSessions: unknown[];
  websiteSnapshots: unknown[];
  investigationTemplates: unknown[];
  bulkReview: unknown;
  settings: UnknownRecord;
}

interface WorkspaceMergeResult {
  added: number;
  updated: number;
  skipped: number;
  pruned?: number;
  profiles?: BrandProfile[];
  settings?: WorkspaceSettings;
}

interface WorkspaceSectionDefinition {
  id: WorkspaceArchiveSectionId;
  label: string;
  schema: string | null;
  version: number;
  supportedVersions?: readonly number[];
  count: (data: unknown) => number;
  merge: ((local: NormalizedWorkspaceInput, data: unknown, now: string | null) => WorkspaceMergeResult) | null;
}

const CONTROL_RE = /[\x00-\x1f\x7f]/;
const CHECKSUM_RE = /^sha256:[a-f0-9]{64}$/;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function serialize(value: unknown, message = 'The workspace archive contains data that cannot be serialised.'): string {
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== 'string') throw new Error(message);
    return serialized;
  } catch {
    throw new Error(message);
  }
}

function clone<T>(value: T): T {
  return JSON.parse(serialize(value)) as T;
}

function timestamp(value: unknown, fallback: string | null = null): string | null {
  if (typeof value !== 'string' || value.length > 64 || CONTROL_RE.test(value)) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function boundedText(value: unknown, maximum = 300): string {
  if (typeof value !== 'string' || value.length > maximum * 4 || CONTROL_RE.test(value)) return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maximum).trim();
}

function normalizeTheme(value: unknown): WorkspaceTheme {
  return value === 'dark' || value === 'light' ? value : 'system';
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  const item = record(value);
  if (!item) return value;
  return Object.fromEntries(Object.keys(item).sort().map((key) => [key, canonicalize(item[key])]));
}

function canonicalString(value: unknown): string {
  try {
    return JSON.stringify(canonicalize(value));
  } catch {
    throw new Error('A workspace archive section could not be canonicalized safely.');
  }
}

async function checksum(value: unknown, cryptoProvider: WorkspaceArchiveOptions['cryptoProvider'] = globalThis.crypto): Promise<string> {
  if (!cryptoProvider?.subtle?.digest) {
    throw new Error('Workspace archive checksums are unavailable in this browser.');
  }
  const digest = await cryptoProvider.subtle.digest('SHA-256', new TextEncoder().encode(canonicalString(value)));
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function settingsDocument(input: NormalizedWorkspaceInput): WorkspaceSettingsDocument {
  const profiles = Array.isArray(input.brandProfiles) ? input.brandProfiles : [];
  const requestedProfileId = normalizeBrandProfileId(input.settings?.activeProfileId) || '';
  const activeProfileId = profiles.some((profile) => profile?.id === requestedProfileId)
    ? requestedProfileId
    : '';
  return {
    schema: WORKSPACE_SETTINGS_SCHEMA,
    version: WORKSPACE_SETTINGS_VERSION,
    activeProfileId,
    theme: normalizeTheme(input.settings?.theme),
  };
}

function workspaceArchiveSections(
  input: NormalizedWorkspaceInput,
  now: string,
): WorkspaceArchiveSectionMap {
  return {
    cases: buildCaseExport(input.cases, now),
    campaigns: buildCampaignExport(input.campaigns, now),
    brandProfiles: buildBrandProfileExport(input.brandProfiles, now),
    watchlists: buildWatchlistExport(input.watchlists, now),
    shortlist: buildShortlistExport(input.shortlist, now),
    detectionRules: buildDetectionRuleExport(input.detectionRules, now),
    relationshipObservations: buildRelationshipObservationExport(input.relationshipObservations, now),
    bulkSessions: buildBulkSessionExport(input.bulkSessions, now),
    websiteSnapshots: buildWebsiteSnapshotExport(input.websiteSnapshots, now),
    investigationTemplates: buildInvestigationTemplateExport(input.investigationTemplates, now),
    bulkReview: buildBulkReviewExport(input.bulkReview),
    settings: settingsDocument(input),
  };
}

function arrayCount(data: unknown, key: string): number {
  const value = record(data);
  return value && Array.isArray(value[key]) ? value[key].length : 0;
}

function objectCount(data: unknown, key: string): number {
  const value = record(data);
  const nested = value ? record(value[key]) : null;
  return nested ? Object.keys(nested).length : 0;
}

const SECTION_DEFINITIONS: readonly WorkspaceSectionDefinition[] = [
  {
    id: 'cases', label: 'Cases', schema: null, version: CASE_SCHEMA_VERSION,
    supportedVersions: CASE_IMPORT_VERSIONS,
    count: (data) => arrayCount(data, 'cases'),
    merge: (local, data) => {
      const result = mergeCases(local.cases, data);
      const bounded = enforceStoreBudget(result.cases);
      return { ...result, cases: bounded.cases, pruned: bounded.pruned };
    },
  },
  {
    id: 'campaigns', label: 'Campaigns', schema: CAMPAIGN_SCHEMA, version: CAMPAIGN_SCHEMA_VERSION,
    count: (data) => arrayCount(data, 'campaigns'),
    merge: (local, data) => {
      const result = mergeCampaigns(local.campaigns, data);
      return { ...result, campaigns: assertCampaignStoreBudget(result.campaigns).campaigns };
    },
  },
  {
    id: 'brandProfiles', label: 'Brand profiles', schema: BRAND_PROFILE_SCHEMA, version: BRAND_PROFILE_SCHEMA_VERSION,
    count: (data) => arrayCount(data, 'profiles'),
    merge: (local, data, now) => {
      const result = mergeBrandProfiles(local.brandProfiles, data, { nowIso: now });
      return { ...result, profiles: assertBrandProfileStoreBudget(result.profiles).profiles };
    },
  },
  {
    id: 'watchlists', label: 'Watchlists', schema: WATCHLIST_SCHEMA, version: WATCHLIST_SCHEMA_VERSION,
    count: (data) => objectCount(data, 'watchlists'),
    merge: (local, data) => {
      const result = mergeWatchlistStores(local.watchlists, data);
      return { ...result, watchlists: assertWatchlistStoreBudget(result.watchlists).watchlists };
    },
  },
  {
    id: 'shortlist', label: 'Shortlist', schema: SHORTLIST_SCHEMA, version: SHORTLIST_SCHEMA_VERSION,
    count: (data) => arrayCount(data, 'entries'),
    merge: (local, data) => {
      const result = mergeShortlistStores(local.shortlist, data);
      return { ...result, entries: assertShortlistStoreBudget(result.entries).entries };
    },
  },
  {
    id: 'detectionRules', label: 'Detection rules', schema: DETECTION_RULE_SCHEMA, version: DETECTION_RULE_SCHEMA_VERSION,
    count: (data) => arrayCount(data, 'rules'),
    merge: (local, data) => {
      const result = mergeDetectionRules(local.detectionRules, data);
      return { ...result, rules: assertDetectionRuleStoreBudget(result.rules).rules };
    },
  },
  {
    id: 'relationshipObservations',
    label: 'Retained relationship observations',
    schema: RELATIONSHIP_OBSERVATION_SCHEMA,
    version: RELATIONSHIP_OBSERVATION_SCHEMA_VERSION,
    count: (data) => arrayCount(data, 'observations'),
    merge: (local, data) => mergeRelationshipObservations(local.relationshipObservations, data),
  },
  {
    id: 'bulkSessions',
    label: 'Saved Bulk sessions',
    schema: BULK_SESSION_SCHEMA,
    version: BULK_SESSION_SCHEMA_VERSION,
    count: (data) => arrayCount(data, 'sessions'),
    merge: (local, data) => {
      const result = mergeBulkSessions(local.bulkSessions, data);
      enforceBulkSessionStoreBudget(result.sessions);
      return result;
    },
  },
  {
    id: 'websiteSnapshots',
    label: 'Website profile snapshots',
    schema: WEBSITE_SNAPSHOT_SCHEMA,
    version: WEBSITE_SNAPSHOT_SCHEMA_VERSION,
    count: (data) => arrayCount(data, 'snapshots'),
    merge: (local, data) => mergeWebsiteSnapshots(local.websiteSnapshots, data),
  },
  {
    id: 'investigationTemplates',
    label: 'Investigation templates',
    schema: INVESTIGATION_TEMPLATE_SCHEMA,
    version: INVESTIGATION_TEMPLATE_VERSION,
    count: (data) => arrayCount(data, 'templates'),
    merge: (local, data) => mergeInvestigationTemplates(local.investigationTemplates, data),
  },
  {
    id: 'bulkReview',
    label: 'Bulk saved views and review queue',
    schema: BULK_REVIEW_SCHEMA,
    version: BULK_REVIEW_SCHEMA_VERSION,
    count: (data) => arrayCount(data, 'presets') + arrayCount(data, 'rows'),
    merge: (local, data) => mergeBulkReviewStores(local.bulkReview, data),
  },
  {
    id: 'settings', label: 'Workspace settings', schema: WORKSPACE_SETTINGS_SCHEMA, version: WORKSPACE_SETTINGS_VERSION,
    count: () => 1,
    merge: null,
  },
] as const;

const DEFINITION_BY_ID = new Map<string, WorkspaceSectionDefinition>(
  SECTION_DEFINITIONS.map((definition) => [definition.id, definition]),
);
const SECTION_ORDER = new Map<string, number>(WORKSPACE_ARCHIVE_SECTION_IDS.map((id, index) => [id, index]));

function canonicalSectionOrder(left: { id: string }, right: { id: string }): number {
  const leftIndex = SECTION_ORDER.get(left.id) ?? Number.MAX_SAFE_INTEGER;
  const rightIndex = SECTION_ORDER.get(right.id) ?? Number.MAX_SAFE_INTEGER;
  return leftIndex - rightIndex;
}

function normalizedInput(input: unknown): NormalizedWorkspaceInput {
  const value = record(input) || {};
  return {
    cases: Array.isArray(value.cases) ? value.cases as CaseRecord[] : [],
    campaigns: Array.isArray(value.campaigns) ? value.campaigns : [],
    brandProfiles: Array.isArray(value.brandProfiles) ? value.brandProfiles as BrandProfile[] : [],
    watchlists: record(value.watchlists) || {},
    shortlist: Array.isArray(value.shortlist) ? value.shortlist : [],
    detectionRules: Array.isArray(value.detectionRules) ? value.detectionRules : [],
    relationshipObservations: Array.isArray(value.relationshipObservations) ? value.relationshipObservations : [],
    bulkSessions: Array.isArray(value.bulkSessions) ? value.bulkSessions : [],
    websiteSnapshots: Array.isArray(value.websiteSnapshots) ? value.websiteSnapshots : [],
    investigationTemplates: Array.isArray(value.investigationTemplates) ? value.investigationTemplates : [],
    bulkReview: record(value.bulkReview) || {},
    settings: record(value.settings) || {},
  };
}

function ensureArchiveBudget(value: unknown): { serialized: string; bytes: number } {
  const serialized = serialize(value);
  const bytes = byteLength(serialized);
  if (bytes > MAX_WORKSPACE_ARCHIVE_BYTES) {
    throw new Error('Workspace archives are limited to 10 MiB. Export smaller collections separately before trying again.');
  }
  return { serialized, bytes };
}

/** Build one deterministic, unencrypted archive from normalized local stores. */
export async function buildWorkspaceArchive(input: unknown, options: WorkspaceArchiveOptions = {}) {
  const now = timestamp(options.generatedAt) || new Date().toISOString();
  const source = normalizedInput(input);
  const sections = workspaceArchiveSections(source, now);
  const manifestSections: WorkspaceArchiveManifestEntry[] = [];
  let totalRecords = 0;

  for (const definition of SECTION_DEFINITIONS) {
    const data = sections[definition.id];
    const sectionBytes = byteLength(serialize(data));
    if (sectionBytes > MAX_WORKSPACE_ARCHIVE_SECTION_BYTES) {
      throw new Error(`${definition.label} exceeds the 5 MiB workspace archive section limit.`);
    }
    const recordCount = definition.count(data);
    manifestSections.push({
      id: definition.id,
      schema: definition.schema,
      version: definition.version,
      recordCount,
      bytes: sectionBytes,
      checksum: await checksum(data, options.cryptoProvider),
    });
    totalRecords += recordCount;
  }

  const archive: WorkspaceArchiveDocument = {
    schema: WORKSPACE_ARCHIVE_SCHEMA,
    version: WORKSPACE_ARCHIVE_VERSION,
    generatedAt: now,
    manifest: {
      sectionCount: manifestSections.length,
      totalRecords,
      sections: manifestSections,
    },
    sections,
    limitations: [
      'This archive contains only the bounded browser-local workspace sections listed in its manifest.',
      'It excludes login sessions, passwords, API credentials, hosted-monitor encryption keys, raw upstream payloads, tab state, and unrelated browser storage.',
      'Import is a reviewed non-destructive merge. Existing records can be updated according to their section-specific versioned merge rules but are not deleted by absence from the archive.',
    ],
  };
  ensureArchiveBudget(archive);
  return archive;
}

function manifestEntry(raw: unknown): WorkspaceArchiveManifestEntry | null {
  const value = record(raw);
  if (!value) return null;
  const id = boundedText(value.id, 40);
  const schema = value.schema === null ? null : boundedText(value.schema, 100);
  const version = typeof value.version === 'number' && Number.isSafeInteger(value.version) && value.version > 0 && value.version <= 1000 ? value.version : null;
  const recordCount = typeof value.recordCount === 'number' && Number.isSafeInteger(value.recordCount) && value.recordCount >= 0 && value.recordCount <= 10000 ? value.recordCount : null;
  const bytes = typeof value.bytes === 'number' && Number.isSafeInteger(value.bytes) && value.bytes >= 0 && value.bytes <= MAX_WORKSPACE_ARCHIVE_SECTION_BYTES ? value.bytes : null;
  const checksumValue = typeof value.checksum === 'string' && CHECKSUM_RE.test(value.checksum) ? value.checksum : null;
  return id && version !== null && recordCount !== null && bytes !== null && checksumValue
    ? { id, schema, version, recordCount, bytes, checksum: checksumValue }
    : null;
}

/** Validate structure, section byte counts, and checksums without applying data. */
export async function readWorkspaceArchive(raw: unknown, options: WorkspaceArchiveOptions = {}) {
  const value = record(raw);
  if (!value || value.schema !== WORKSPACE_ARCHIVE_SCHEMA) {
    throw new Error('This file is not a WHOISleuth workspace archive.');
  }
  if (
    !isSupportedWorkspaceArchiveVersion(value.version)
  ) {
    if (typeof value.version === 'number' && Number.isSafeInteger(value.version) && value.version > WORKSPACE_ARCHIVE_VERSION) {
      throw new Error(`This workspace archive uses newer schema ${value.version}. Update the app before importing it.`);
    }
    throw new Error(`Expected workspace archive schema 1, 2, 3, 4, or ${WORKSPACE_ARCHIVE_VERSION}.`);
  }
  const sourceVersion = value.version;
  const { bytes } = ensureArchiveBudget(value);
  const manifest = record(value.manifest);
  const sectionValues = record(value.sections);
  if (!manifest || !sectionValues || !Array.isArray(manifest.sections)) {
    throw new Error('The workspace archive manifest is missing or malformed.');
  }
  if (manifest.sections.length > MAX_WORKSPACE_ARCHIVE_SECTIONS) {
    throw new Error(`Workspace archives are limited to ${MAX_WORKSPACE_ARCHIVE_SECTIONS} sections.`);
  }

  const seen = new Set<string>();
  const sections: WorkspaceArchiveSection[] = [];
  let totalRecords = 0;
  for (const rawEntry of manifest.sections) {
    const entry = manifestEntry(rawEntry);
    if (!entry || seen.has(entry.id) || !Object.prototype.hasOwnProperty.call(sectionValues, entry.id)) {
      throw new Error('The workspace archive manifest contains an invalid, duplicate, or missing section.');
    }
    seen.add(entry.id);
    const data = sectionValues[entry.id];
    const actualBytes = byteLength(serialize(data));
    if (actualBytes !== entry.bytes) throw new Error(`${entry.id} failed its archive byte-count check.`);
    if (await checksum(data, options.cryptoProvider) !== entry.checksum) {
      throw new Error(`${entry.id} failed its archive checksum check.`);
    }
    const definition = DEFINITION_BY_ID.get(entry.id);
    let status: WorkspaceArchiveSectionStatus = 'ready';
    let reason = '';
    if (!definition) {
      status = 'unsupported';
      reason = 'This app does not recognise the archive section.';
    } else if (!(definition.supportedVersions ?? [definition.version]).includes(entry.version) || entry.schema !== definition.schema) {
      status = 'unsupported';
      reason = entry.version > definition.version
        ? `This section uses newer schema ${entry.version}.`
        : 'This section uses an unsupported schema contract.';
    } else if (definition.count(data) !== entry.recordCount) {
      throw new Error(`${entry.id} does not match its manifest record count.`);
    }
    sections.push({ ...entry, label: definition?.label || entry.id, status, reason, data: clone(data) });
    totalRecords += entry.recordCount;
  }
  if (Object.keys(sectionValues).some((id) => !seen.has(id))) {
    throw new Error('The workspace archive contains data that is not declared in its manifest.');
  }
  if (manifest.sectionCount !== sections.length || manifest.totalRecords !== totalRecords) {
    throw new Error('The workspace archive manifest totals do not match its sections.');
  }
  sections.sort(canonicalSectionOrder);
  return {
    schema: WORKSPACE_ARCHIVE_SCHEMA,
    version: WORKSPACE_ARCHIVE_VERSION,
    sourceVersion,
    generatedAt: timestamp(value.generatedAt),
    bytes,
    sections,
    limitations: Array.isArray(value.limitations)
      ? value.limitations.map((item) => boundedText(item, 400)).filter(Boolean).slice(0, 8)
      : [],
  };
}

function settingsPreview(
  data: unknown,
  local: NormalizedWorkspaceInput,
  mergedProfiles: BrandProfile[],
): WorkspaceMergeResult {
  const value = record(data) || {};
  const activeProfileId = normalizeBrandProfileId(value.activeProfileId) || '';
  const theme = normalizeTheme(value.theme);
  let skipped = 0;
  if (activeProfileId && !mergedProfiles.some((profile) => profile?.id === activeProfileId)) skipped++;
  const updated = Number(
    theme !== normalizeTheme(local.settings?.theme)
    || (Boolean(activeProfileId) && activeProfileId !== local.settings?.activeProfileId && skipped === 0),
  );
  return { added: 0, updated, skipped, settings: { activeProfileId: skipped ? '' : activeProfileId, theme } };
}

/** Preview section-specific non-destructive merge outcomes without writing. */
export async function previewWorkspaceArchive(raw: unknown, localInput: unknown, options: WorkspaceArchiveOptions = {}) {
  const archive = await readWorkspaceArchive(raw, options);
  const local = normalizedInput(localInput);
  const results: WorkspaceArchivePreviewSection[] = [];
  let mergedProfiles = local.brandProfiles;

  for (const section of archive.sections) {
    if (section.status !== 'ready') {
      results.push({ ...section, added: 0, updated: 0, skipped: section.recordCount, selected: false });
      continue;
    }
    const definition = DEFINITION_BY_ID.get(section.id);
    if (!definition) continue;
    try {
      const result = definition.id === 'settings'
        ? settingsPreview(section.data, local, mergedProfiles)
        : definition.merge
          ? definition.merge(local, section.data, archive.generatedAt)
          : { added: 0, updated: 0, skipped: section.recordCount };
      if (definition.id === 'brandProfiles' && result.profiles) mergedProfiles = result.profiles;
      results.push({
        ...section,
        status: 'ready',
        reason: '',
        added: result.added ?? 0,
        updated: result.updated ?? 0,
        skipped: result.skipped ?? 0,
        pruned: result.pruned ?? 0,
        selected: true,
        normalizedSettings: result.settings || null,
      });
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : 'This section could not be previewed.';
      const status = /newer schema|expected .* export|not a .* export/i.test(reason) ? 'unsupported' : 'blocked';
      results.push({
        ...section,
        status,
        reason,
        added: 0,
        updated: 0,
        skipped: section.recordCount,
        pruned: 0,
        selected: false,
      });
    }
  }

  return {
    ...archive,
    sections: results,
    readyCount: results.filter((section) => section.status === 'ready').length,
    unsupportedCount: results.filter((section) => section.status !== 'ready').length,
  };
}
