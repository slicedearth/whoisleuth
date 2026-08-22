// Pure, bounded workspace archive composition. Existing typed store models remain the
// authority for normalization and merge semantics; this module only packages
// their portable contracts, verifies integrity, and previews conflicts.

import {
  buildCaseExport,
  enforceStoreBudget,
  mergeCases,
} from '../cases/case-model.mts';
import type { CaseRecord } from '../cases/case-model.mts';
import {
  assertBrandProfileStoreBudget,
  buildBrandProfileExport,
  mergeBrandProfiles,
  normalizeBrandProfileId,
} from './brand-profile-model.mts';
import type { BrandProfile } from './brand-profile-model.mts';
import {
  assertCampaignStoreBudget,
  buildCampaignExport,
  mergeCampaigns,
} from './campaign-model.mts';
import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';
import { assertWorkspaceInputGraph } from './hostile-input.mts';
import {
  assertWatchlistStoreBudget,
  buildWatchlistExport,
  mergeWatchlistStores,
} from './watchlist-store.mts';
import {
  assertShortlistStoreBudget,
  buildShortlistExport,
  mergeShortlistStores,
} from './shortlist-model.mts';
import {
  assertDetectionRuleStoreBudget,
  buildDetectionRuleExport,
  mergeDetectionRules,
} from './detection-rule-model.mts';
import {
  buildRelationshipObservationExport,
  mergeRelationshipObservations,
} from './relationship-observation-model.mts';
import {
  buildBulkSessionExport,
  enforceBulkSessionStoreBudget,
  mergeBulkSessions,
} from './bulk-session-model.mts';
import {
  buildWebsiteSnapshotExport,
  mergeWebsiteSnapshots,
} from './website-snapshot-model.mts';
import {
  buildInvestigationTemplateExport,
  mergeInvestigationTemplates,
} from './investigation-template-model.mts';
import {
  buildBulkReviewExport,
  mergeBulkReviewStores,
} from './bulk-review-model.mts';
import {
  buildAnalystReviewStateExport,
  emptyAnalystReviewStateStore,
  mergeAnalystReviewStateStores,
} from '../monitoring/analyst-review-state.mts';
import {
  isSupportedWorkspaceArchiveVersion,
  MAX_WORKSPACE_ARCHIVE_BYTES,
  MAX_WORKSPACE_ARCHIVE_SECTION_BYTES,
  MAX_WORKSPACE_ARCHIVE_SECTIONS,
  serialiseWorkspaceArchiveSection,
  SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS,
  WORKSPACE_ARCHIVE_CASE_SECTION,
  WORKSPACE_ARCHIVE_SCHEMA,
  WORKSPACE_ARCHIVE_SECTION_IDS,
  PUBLIC_WORKSPACE_ARCHIVE_SECTION_IDS,
  PUBLIC_WORKSPACE_ARCHIVE_VERSION,
  WORKSPACE_ARCHIVE_VERSION,
  WORKSPACE_SETTINGS_COMPATIBILITY,
  WORKSPACE_SETTINGS_SCHEMA,
  WORKSPACE_SETTINGS_VERSION,
} from '../contracts/case-portability.mts';
import { ANALYST_REVIEW_STATE_COMPATIBILITY } from '../contracts/analyst-review-state.mts';
import { WORKSPACE_PORTABILITY_ARCHIVE_SECTION_REFERENCES } from '../contracts/workspace-portability.mts';

export {
  isSupportedWorkspaceArchiveVersion,
  MAX_WORKSPACE_ARCHIVE_BYTES,
  MAX_WORKSPACE_ARCHIVE_SECTION_BYTES,
  MAX_WORKSPACE_ARCHIVE_SECTIONS,
  SUPPORTED_WORKSPACE_ARCHIVE_VERSIONS,
  WORKSPACE_ARCHIVE_CASE_SECTION,
  WORKSPACE_ARCHIVE_SCHEMA,
  WORKSPACE_ARCHIVE_SECTION_IDS,
  PUBLIC_WORKSPACE_ARCHIVE_SECTION_IDS,
  PUBLIC_WORKSPACE_ARCHIVE_VERSION,
  WORKSPACE_ARCHIVE_VERSION,
  WORKSPACE_SETTINGS_SCHEMA,
  WORKSPACE_SETTINGS_VERSION,
};

export type WorkspaceArchiveSectionId = typeof WORKSPACE_ARCHIVE_SECTION_IDS[number];
export type WorkspaceArchiveSectionStatus = 'ready' | 'unsupported';
export type WorkspaceArchivePreviewStatus = WorkspaceArchiveSectionStatus | 'blocked';
export type WorkspaceTheme = 'dark' | 'light' | 'system';
type UnknownRecord = Record<string, unknown>;

export interface WorkspaceArchiveOptions {
  generatedAt?: unknown;
  selectedSectionIds?: readonly string[];
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
  analystReviewState: ReturnType<typeof buildAnalystReviewStateExport>;
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
  brandProfileReferencesOmitted?: number;
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
  analystReviewState: unknown;
  settings: UnknownRecord;
}

interface WorkspaceMergeResult {
  added: number;
  updated: number;
  skipped: number;
  pruned?: number;
  brandProfileReferencesOmitted?: number;
  profiles?: BrandProfile[];
  settings?: WorkspaceSettings;
  reason?: string;
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
const WORKSPACE_ARCHIVE_ROOT_KEYS = Object.freeze(['schema', 'version', 'generatedAt', 'manifest', 'sections', 'limitations']);
const WORKSPACE_ARCHIVE_MANIFEST_KEYS = Object.freeze(['sectionCount', 'totalRecords', 'sections']);
const WORKSPACE_ARCHIVE_MANIFEST_ENTRY_KEYS = Object.freeze(['id', 'schema', 'version', 'recordCount', 'bytes', 'checksum']);

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function assertExactKeys(value: UnknownRecord, expected: readonly string[], label: string): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    throw new Error(`The workspace archive ${label} contains missing or undeclared fields.`);
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function serialize(value: unknown, message = 'The workspace archive contains data that cannot be serialised.'): string {
  try {
    return serialiseWorkspaceArchiveSection(value);
  } catch {
    throw new Error(message);
  }
}

function clone<T>(value: T): T {
  return JSON.parse(serialize(value)) as T;
}

function timestamp(value: unknown, fallback: string | null = null): string | null {
  const explicit = normalizeExplicitIsoTimestamp(value);
  if (explicit) return explicit;
  return fallback;
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
    analystReviewState: buildAnalystReviewStateExport(input.analystReviewState),
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

function sectionContract(sectionId: string): Readonly<{
  id: WorkspaceArchiveSectionId;
  schema: string;
  version: number;
  supportedVersions: readonly number[];
}> {
  const reference = WORKSPACE_PORTABILITY_ARCHIVE_SECTION_REFERENCES.find((entry) => entry.sectionId === sectionId);
  if (!reference) throw new TypeError(`Workspace archive section ${sectionId} has no canonical contract reference.`);
  return Object.freeze({
    id: reference.sectionId as WorkspaceArchiveSectionId,
    schema: reference.schema,
    version: reference.version,
    supportedVersions: reference.supportedVersions,
  });
}

function compatibilitySchema(descriptor: Readonly<{ id: string; schema: string | null }>): string {
  if (!descriptor.schema) throw new TypeError(`Workspace compatibility ${descriptor.id} must name a schema.`);
  return descriptor.schema;
}

const SECTION_DEFINITIONS: readonly WorkspaceSectionDefinition[] = [
  {
    id: WORKSPACE_ARCHIVE_CASE_SECTION.id,
    label: 'Cases',
    schema: WORKSPACE_ARCHIVE_CASE_SECTION.schema,
    version: WORKSPACE_ARCHIVE_CASE_SECTION.currentVersion,
    supportedVersions: WORKSPACE_ARCHIVE_CASE_SECTION.supportedVersions,
    count: (data) => arrayCount(data, 'cases'),
    merge: (local, data) => {
      const result = mergeCases(local.cases, data);
      const bounded = enforceStoreBudget(result.cases);
      return { ...result, cases: bounded.cases, pruned: bounded.pruned };
    },
  },
  {
    ...sectionContract('campaigns'), label: 'Campaigns',
    count: (data) => arrayCount(data, 'campaigns'),
    merge: (local, data) => {
      const result = mergeCampaigns(local.campaigns, data);
      return { ...result, campaigns: assertCampaignStoreBudget(result.campaigns).campaigns };
    },
  },
  {
    ...sectionContract('brandProfiles'), label: 'Brand profiles',
    count: (data) => arrayCount(data, 'profiles'),
    merge: (local, data, now) => {
      const result = mergeBrandProfiles(local.brandProfiles, data, { nowIso: now });
      return { ...result, profiles: assertBrandProfileStoreBudget(result.profiles).profiles };
    },
  },
  {
    ...sectionContract('watchlists'), label: 'Watchlists',
    count: (data) => objectCount(data, 'watchlists'),
    merge: (local, data) => {
      const result = mergeWatchlistStores(local.watchlists, data);
      return { ...result, watchlists: assertWatchlistStoreBudget(result.watchlists).watchlists };
    },
  },
  {
    ...sectionContract('shortlist'), label: 'Shortlist',
    count: (data) => arrayCount(data, 'entries'),
    merge: (local, data) => {
      const result = mergeShortlistStores(local.shortlist, data);
      return { ...result, entries: assertShortlistStoreBudget(result.entries).entries };
    },
  },
  {
    ...sectionContract('detectionRules'), label: 'Detection rules',
    count: (data) => arrayCount(data, 'rules'),
    merge: (local, data) => {
      const result = mergeDetectionRules(local.detectionRules, data);
      return { ...result, rules: assertDetectionRuleStoreBudget(result.rules).rules };
    },
  },
  {
    ...sectionContract('relationshipObservations'),
    label: 'Retained relationship observations',
    count: (data) => arrayCount(data, 'observations'),
    merge: (local, data) => mergeRelationshipObservations(local.relationshipObservations, data),
  },
  {
    ...sectionContract('bulkSessions'),
    label: 'Saved Bulk sessions',
    count: (data) => arrayCount(data, 'sessions'),
    merge: (local, data) => {
      const result = mergeBulkSessions(local.bulkSessions, data);
      enforceBulkSessionStoreBudget(result.sessions);
      return result;
    },
  },
  {
    ...sectionContract('websiteSnapshots'),
    label: 'Website profile snapshots',
    count: (data) => arrayCount(data, 'snapshots'),
    merge: (local, data) => mergeWebsiteSnapshots(local.websiteSnapshots, data),
  },
  {
    ...sectionContract('investigationTemplates'),
    label: 'Investigation templates',
    count: (data) => arrayCount(data, 'templates'),
    merge: (local, data) => mergeInvestigationTemplates(local.investigationTemplates, data),
  },
  {
    ...sectionContract('bulkReview'),
    label: 'Bulk saved views and review queue',
    count: (data) => arrayCount(data, 'presets') + arrayCount(data, 'rows'),
    merge: (local, data) => mergeBulkReviewStores(local.bulkReview, data),
  },
  {
    id: 'analystReviewState',
    label: 'Analyst Review Item lifecycle',
    schema: compatibilitySchema(ANALYST_REVIEW_STATE_COMPATIBILITY),
    version: ANALYST_REVIEW_STATE_COMPATIBILITY.currentVersion,
    supportedVersions: ANALYST_REVIEW_STATE_COMPATIBILITY.supportedVersions,
    count: (data) => arrayCount(data, 'records'),
    merge: (local, data) => mergeAnalystReviewStateStores(local.analystReviewState, data),
  },
  {
    id: 'settings', label: 'Workspace settings', schema: compatibilitySchema(WORKSPACE_SETTINGS_COMPATIBILITY),
    version: WORKSPACE_SETTINGS_COMPATIBILITY.currentVersion,
    supportedVersions: WORKSPACE_SETTINGS_COMPATIBILITY.supportedVersions,
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
    analystReviewState: record(value.analystReviewState) || emptyAnalystReviewStateStore(),
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
  const now = timestamp(options.generatedAt ?? new Date().toISOString());
  if (!now) throw new Error('Workspace archive generation time must use an explicit timezone.');
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
  assertWorkspaceInputGraph(raw, 'Workspace archive');
  const value = record(raw);
  if (!value || value.schema !== WORKSPACE_ARCHIVE_SCHEMA) {
    throw new Error('This file is not a WHOISleuth workspace archive.');
  }
  if (!isSupportedWorkspaceArchiveVersion(value.version)) {
    if (typeof value.version === 'number' && Number.isSafeInteger(value.version) && value.version < WORKSPACE_ARCHIVE_VERSION) {
      throw new Error(`Workspace archive schema ${value.version} is retired. Export it as schema ${WORKSPACE_ARCHIVE_VERSION} with the last broad-reader release before importing; no data was changed.`);
    }
    if (typeof value.version === 'number' && Number.isSafeInteger(value.version) && value.version > WORKSPACE_ARCHIVE_VERSION) {
      throw new Error(`Workspace archive schema ${value.version} is newer than the supported schema ${WORKSPACE_ARCHIVE_VERSION}; no data was changed.`);
    }
    throw new Error(`Expected a well-formed workspace archive using schema ${WORKSPACE_ARCHIVE_VERSION}; no data was changed.`);
  }
  const sourceVersion = value.version;
  const expectedSectionIds: readonly string[] = sourceVersion === PUBLIC_WORKSPACE_ARCHIVE_VERSION
    ? PUBLIC_WORKSPACE_ARCHIVE_SECTION_IDS
    : WORKSPACE_ARCHIVE_SECTION_IDS;
  const generatedAt = timestamp(value.generatedAt);
  if (!generatedAt) throw new Error('The workspace archive generation time is invalid.');
  const { bytes } = ensureArchiveBudget(value);
  assertExactKeys(value, WORKSPACE_ARCHIVE_ROOT_KEYS, `version ${sourceVersion} envelope`);
  const manifest = record(value.manifest);
  const sectionValues = record(value.sections);
  if (!manifest || !sectionValues || !Array.isArray(manifest.sections)) {
    throw new Error('The workspace archive manifest is missing or malformed.');
  }
  assertExactKeys(manifest, WORKSPACE_ARCHIVE_MANIFEST_KEYS, 'manifest');
  if (manifest.sections.length > MAX_WORKSPACE_ARCHIVE_SECTIONS) {
    throw new Error(`Workspace archives are limited to ${MAX_WORKSPACE_ARCHIVE_SECTIONS} sections.`);
  }

  const seen = new Set<string>();
  const sections: WorkspaceArchiveSection[] = [];
  let totalRecords = 0;
  for (const rawEntry of manifest.sections) {
    const rawEntryRecord = record(rawEntry);
    if (!rawEntryRecord) throw new Error('The workspace archive manifest contains a malformed section entry.');
    assertExactKeys(rawEntryRecord, WORKSPACE_ARCHIVE_MANIFEST_ENTRY_KEYS, 'manifest section entry');
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
    const embedded = record(data);
    const embeddedVersion = embedded?.version;
    const embeddedSchema = embedded && Object.prototype.hasOwnProperty.call(embedded, 'schema')
      ? embedded.schema
      : null;
    if (
      !embedded
      || typeof embeddedVersion !== 'number'
      || !Number.isSafeInteger(embeddedVersion)
      || embeddedVersion < 1
      || embeddedVersion > 1000
      || (embeddedSchema !== null && typeof embeddedSchema !== 'string')
      || embeddedVersion !== entry.version
      || embeddedSchema !== entry.schema
    ) {
      throw new Error(`${entry.id} section contract does not match its archive manifest.`);
    }
    const definition = DEFINITION_BY_ID.get(entry.id);
    let status: WorkspaceArchiveSectionStatus = 'ready';
    let reason = '';
    if (!definition) {
      status = 'unsupported';
      reason = 'This app does not recognise the archive section.';
    } else if (!(definition.supportedVersions ?? [definition.version]).includes(entry.version) || entry.schema !== definition.schema) {
      status = 'unsupported';
      reason = entry.schema !== definition.schema
        ? 'This section uses an unsupported schema contract.'
        : entry.version > definition.version
          ? `This section uses newer schema ${entry.version}.`
          : `This section uses retired schema ${entry.version}. Export it with the last broad-reader release before importing; no data was changed.`;
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
  if (seen.size !== expectedSectionIds.length || expectedSectionIds.some((id) => !seen.has(id))) {
    throw new Error(`Workspace archive schema ${sourceVersion} does not contain its exact required section set.`);
  }
  if (sourceVersion === PUBLIC_WORKSPACE_ARCHIVE_VERSION) {
    const data = emptyAnalystReviewStateStore();
    sections.push({
      id: 'analystReviewState',
      label: 'Analyst Review Item lifecycle',
      schema: compatibilitySchema(ANALYST_REVIEW_STATE_COMPATIBILITY),
      version: ANALYST_REVIEW_STATE_COMPATIBILITY.currentVersion,
      recordCount: 0,
      bytes: byteLength(serialize(data)),
      checksum: await checksum(data, options.cryptoProvider),
      status: 'ready',
      reason: `Workspace schema ${PUBLIC_WORKSPACE_ARCHIVE_VERSION} did not contain Review Item lifecycle state. Import supplies an empty section and invents no analyst decisions.`,
      data,
    });
  }
  sections.sort(canonicalSectionOrder);
  return {
    schema: WORKSPACE_ARCHIVE_SCHEMA,
    version: WORKSPACE_ARCHIVE_VERSION,
    sourceVersion,
    generatedAt,
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
  const rawActiveProfileId = value.activeProfileId;
  const intentionalClear = rawActiveProfileId === '';
  const normalizedActiveProfileId = normalizeBrandProfileId(rawActiveProfileId);
  const validActiveProfileId = typeof rawActiveProfileId === 'string'
    && rawActiveProfileId.length > 0
    && normalizedActiveProfileId === rawActiveProfileId;
  const theme = normalizeTheme(value.theme);
  const retainedActiveProfileId = normalizeBrandProfileId(local.settings?.activeProfileId) || '';
  let activeProfileId = retainedActiveProfileId;
  let skipped = 0;
  let reason = '';
  if (!intentionalClear && !validActiveProfileId) {
    skipped = 1;
    reason = 'The imported active Brand Profile preference is missing or malformed. Existing active-profile context is preserved.';
  } else if (validActiveProfileId && !mergedProfiles.some((profile) => profile?.id === normalizedActiveProfileId)) {
    skipped = 1;
    reason = 'The imported active Brand Profile preference will be skipped because its identifier is not available in the selected Profile data or the current browser. Existing active-profile context is preserved.';
  } else {
    activeProfileId = intentionalClear ? '' : normalizedActiveProfileId ?? retainedActiveProfileId;
  }
  const updated = Number(
    theme !== normalizeTheme(local.settings?.theme)
    || (skipped === 0 && activeProfileId !== retainedActiveProfileId),
  );
  return { added: 0, updated, skipped, reason, settings: { activeProfileId, theme } };
}

/** Preview section-specific non-destructive merge outcomes without writing. */
export async function previewWorkspaceArchive(raw: unknown, localInput: unknown, options: WorkspaceArchiveOptions = {}) {
  const archive = await readWorkspaceArchive(raw, options);
  const local = normalizedInput(localInput);
  const results: WorkspaceArchivePreviewSection[] = [];
  let mergedProfiles = local.brandProfiles;
  const selectedIds = options.selectedSectionIds
    ? new Set(options.selectedSectionIds.slice(0, MAX_WORKSPACE_ARCHIVE_SECTIONS))
    : null;

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
      const selected = selectedIds ? selectedIds.has(section.id) : true;
      if (definition.id === 'brandProfiles' && selected && result.profiles) mergedProfiles = result.profiles;
      results.push({
        ...section,
        status: 'ready',
        reason: definition.id === 'settings' && selected && (result.skipped ?? 0) > 0
          ? result.reason ?? 'The imported workspace preference was skipped. Existing browser-local context is preserved.'
          : section.reason,
        added: result.added ?? 0,
        updated: result.updated ?? 0,
        skipped: result.skipped ?? 0,
        pruned: result.pruned ?? 0,
        brandProfileReferencesOmitted: result.brandProfileReferencesOmitted ?? 0,
        selected,
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

  const profileCollision = results.find((section) =>
    section.id === 'brandProfiles'
    && section.status === 'blocked'
    && /reuses one exact identifier for different normalised profile names/iu.test(section.reason)
  );
  if (profileCollision) {
    for (const dependentId of ['cases', 'settings'] as const) {
      const dependentIndex = results.findIndex((section) => section.id === dependentId && section.status === 'ready');
      const dependentSection = results[dependentIndex];
      if (dependentIndex < 0 || !dependentSection) continue;
      results[dependentIndex] = {
        ...dependentSection,
        status: 'blocked',
        reason: dependentId === 'cases'
          ? 'Cases were not selected because a Brand Profile identifier collision must be resolved before their opaque references can be imported safely.'
          : 'Workspace settings were not selected because an active Brand Profile preference could otherwise bind to a different local profile that reuses the same identifier.',
        added: 0,
        updated: 0,
        skipped: dependentSection.recordCount,
        pruned: 0,
        brandProfileReferencesOmitted: 0,
        selected: false,
        normalizedSettings: dependentId === 'settings' ? null : dependentSection.normalizedSettings ?? null,
      };
    }
  }

  return {
    ...archive,
    sections: results,
    readyCount: results.filter((section) => section.status === 'ready').length,
    unsupportedCount: results.filter((section) => section.status !== 'ready').length,
  };
}
