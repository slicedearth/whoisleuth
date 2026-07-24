// Pure, bounded workspace archive composition. Existing store models remain the
// authority for normalization and merge semantics; this module only packages
// their portable contracts, verifies integrity, and previews conflicts.

import {
  buildCaseExport,
  CASE_SCHEMA_VERSION,
  enforceStoreBudget,
  mergeCases,
} from './case-model.js';
import {
  assertBrandProfileStoreBudget,
  BRAND_PROFILE_SCHEMA,
  BRAND_PROFILE_SCHEMA_VERSION,
  buildBrandProfileExport,
  mergeBrandProfiles,
} from './brand-profile-model.js';
import {
  assertCampaignStoreBudget,
  buildCampaignExport,
  CAMPAIGN_SCHEMA,
  CAMPAIGN_SCHEMA_VERSION,
  mergeCampaigns,
} from './campaign-model.js';
import {
  assertWatchlistStoreBudget,
  buildWatchlistExport,
  mergeWatchlistStores,
  WATCHLIST_SCHEMA,
  WATCHLIST_SCHEMA_VERSION,
} from './watchlist-store.js';
import {
  assertShortlistStoreBudget,
  buildShortlistExport,
  mergeShortlistStores,
  SHORTLIST_SCHEMA,
  SHORTLIST_SCHEMA_VERSION,
} from './shortlist-model.js';
import {
  assertDetectionRuleStoreBudget,
  buildDetectionRuleExport,
  DETECTION_RULE_SCHEMA,
  DETECTION_RULE_SCHEMA_VERSION,
  mergeDetectionRules,
} from './detection-rule-model.js';
import {
  buildRelationshipObservationExport,
  mergeRelationshipObservations,
  RELATIONSHIP_OBSERVATION_SCHEMA,
  RELATIONSHIP_OBSERVATION_SCHEMA_VERSION,
} from './relationship-observation-model.ts';

export const WORKSPACE_ARCHIVE_SCHEMA = 'whoisleuth.workspace-archive';
export const WORKSPACE_ARCHIVE_VERSION = 1;
export const WORKSPACE_SETTINGS_SCHEMA = 'whoisleuth.workspace-settings';
export const WORKSPACE_SETTINGS_VERSION = 1;
export const MAX_WORKSPACE_ARCHIVE_BYTES = 10 * 1024 * 1024;
export const MAX_WORKSPACE_ARCHIVE_SECTION_BYTES = 5 * 1024 * 1024;
export const MAX_WORKSPACE_ARCHIVE_SECTIONS = 8;

export const WORKSPACE_ARCHIVE_SECTION_IDS = Object.freeze([
  'cases',
  'campaigns',
  'brandProfiles',
  'watchlists',
  'shortlist',
  'detectionRules',
  'relationshipObservations',
  'settings',
]);

const CONTROL_RE = /[\x00-\x1f\x7f]/;
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const CHECKSUM_RE = /^sha256:[a-f0-9]{64}$/;

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function serialize(value, message = 'The workspace archive contains data that cannot be serialized.') {
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== 'string') throw new Error(message);
    return serialized;
  } catch {
    throw new Error(message);
  }
}

function clone(value) {
  return JSON.parse(serialize(value));
}

function timestamp(value, fallback = null) {
  if (typeof value !== 'string' || value.length > 64 || CONTROL_RE.test(value)) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function boundedText(value, maximum = 300) {
  if (typeof value !== 'string' || value.length > maximum * 4 || CONTROL_RE.test(value)) return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maximum).trim();
}

function normalizeTheme(value) {
  return value === 'dark' || value === 'light' ? value : 'system';
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  const item = record(value);
  if (!item) return value;
  return Object.fromEntries(Object.keys(item).sort().map((key) => [key, canonicalize(item[key])]));
}

function canonicalString(value) {
  try {
    return JSON.stringify(canonicalize(value));
  } catch {
    throw new Error('A workspace archive section could not be canonicalized safely.');
  }
}

async function checksum(value, cryptoProvider = globalThis.crypto) {
  if (!cryptoProvider?.subtle?.digest) {
    throw new Error('Workspace archive checksums are unavailable in this browser.');
  }
  const digest = await cryptoProvider.subtle.digest('SHA-256', new TextEncoder().encode(canonicalString(value)));
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function settingsDocument(input) {
  const profiles = Array.isArray(input.brandProfiles) ? input.brandProfiles : [];
  const requestedProfileId = typeof input.settings?.activeProfileId === 'string' && SAFE_ID_RE.test(input.settings.activeProfileId)
    ? input.settings.activeProfileId
    : '';
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

const SECTION_DEFINITIONS = Object.freeze([
  {
    id: 'cases', label: 'Cases', schema: null, version: CASE_SCHEMA_VERSION,
    build: (input, now) => buildCaseExport(input.cases, now),
    count: (data) => Array.isArray(data?.cases) ? data.cases.length : 0,
    merge: (local, data) => {
      const result = mergeCases(local.cases, data);
      const bounded = enforceStoreBudget(result.cases);
      return { ...result, cases: bounded.cases, pruned: bounded.pruned };
    },
  },
  {
    id: 'campaigns', label: 'Campaigns', schema: CAMPAIGN_SCHEMA, version: CAMPAIGN_SCHEMA_VERSION,
    build: (input, now) => buildCampaignExport(input.campaigns, now),
    count: (data) => Array.isArray(data?.campaigns) ? data.campaigns.length : 0,
    merge: (local, data) => {
      const result = mergeCampaigns(local.campaigns, data);
      return { ...result, campaigns: assertCampaignStoreBudget(result.campaigns).campaigns };
    },
  },
  {
    id: 'brandProfiles', label: 'Brand profiles', schema: BRAND_PROFILE_SCHEMA, version: BRAND_PROFILE_SCHEMA_VERSION,
    build: (input, now) => buildBrandProfileExport(input.brandProfiles, now),
    count: (data) => Array.isArray(data?.profiles) ? data.profiles.length : 0,
    merge: (local, data, now) => {
      const result = mergeBrandProfiles(local.brandProfiles, data, { nowIso: now });
      return { ...result, profiles: assertBrandProfileStoreBudget(result.profiles).profiles };
    },
  },
  {
    id: 'watchlists', label: 'Watchlists', schema: WATCHLIST_SCHEMA, version: WATCHLIST_SCHEMA_VERSION,
    build: (input, now) => buildWatchlistExport(input.watchlists, now),
    count: (data) => record(data?.watchlists) ? Object.keys(data.watchlists).length : 0,
    merge: (local, data) => {
      const result = mergeWatchlistStores(local.watchlists, data);
      return { ...result, watchlists: assertWatchlistStoreBudget(result.watchlists).watchlists };
    },
  },
  {
    id: 'shortlist', label: 'Shortlist', schema: SHORTLIST_SCHEMA, version: SHORTLIST_SCHEMA_VERSION,
    build: (input, now) => buildShortlistExport(input.shortlist, now),
    count: (data) => Array.isArray(data?.entries) ? data.entries.length : 0,
    merge: (local, data) => {
      const result = mergeShortlistStores(local.shortlist, data);
      return { ...result, entries: assertShortlistStoreBudget(result.entries).entries };
    },
  },
  {
    id: 'detectionRules', label: 'Detection rules', schema: DETECTION_RULE_SCHEMA, version: DETECTION_RULE_SCHEMA_VERSION,
    build: (input, now) => buildDetectionRuleExport(input.detectionRules, now),
    count: (data) => Array.isArray(data?.rules) ? data.rules.length : 0,
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
    build: (input, now) => buildRelationshipObservationExport(input.relationshipObservations, now),
    count: (data) => Array.isArray(data?.observations) ? data.observations.length : 0,
    merge: (local, data) => mergeRelationshipObservations(local.relationshipObservations, data),
  },
  {
    id: 'settings', label: 'Workspace settings', schema: WORKSPACE_SETTINGS_SCHEMA, version: WORKSPACE_SETTINGS_VERSION,
    build: (input) => settingsDocument(input),
    count: () => 1,
    merge: null,
  },
]);

const DEFINITION_BY_ID = new Map(SECTION_DEFINITIONS.map((definition) => [definition.id, definition]));
const SECTION_ORDER = new Map(WORKSPACE_ARCHIVE_SECTION_IDS.map((id, index) => [id, index]));

function canonicalSectionOrder(left, right) {
  const leftIndex = SECTION_ORDER.get(left.id) ?? Number.MAX_SAFE_INTEGER;
  const rightIndex = SECTION_ORDER.get(right.id) ?? Number.MAX_SAFE_INTEGER;
  return leftIndex - rightIndex;
}

function normalizedInput(input) {
  const value = record(input) || {};
  return {
    cases: Array.isArray(value.cases) ? value.cases : [],
    campaigns: Array.isArray(value.campaigns) ? value.campaigns : [],
    brandProfiles: Array.isArray(value.brandProfiles) ? value.brandProfiles : [],
    watchlists: record(value.watchlists) || {},
    shortlist: Array.isArray(value.shortlist) ? value.shortlist : [],
    detectionRules: Array.isArray(value.detectionRules) ? value.detectionRules : [],
    relationshipObservations: Array.isArray(value.relationshipObservations) ? value.relationshipObservations : [],
    settings: record(value.settings) || {},
  };
}

function ensureArchiveBudget(value) {
  const serialized = serialize(value);
  const bytes = byteLength(serialized);
  if (bytes > MAX_WORKSPACE_ARCHIVE_BYTES) {
    throw new Error('Workspace archives are limited to 10 MiB. Export smaller collections separately before trying again.');
  }
  return { serialized, bytes };
}

/** Build one deterministic, unencrypted archive from normalized local stores. */
export async function buildWorkspaceArchive(input, options = {}) {
  const now = timestamp(options.generatedAt) || new Date().toISOString();
  const source = normalizedInput(input);
  const sections = {};
  const manifestSections = [];
  let totalRecords = 0;

  for (const definition of SECTION_DEFINITIONS) {
    const data = definition.build(source, now);
    const sectionBytes = byteLength(serialize(data));
    if (sectionBytes > MAX_WORKSPACE_ARCHIVE_SECTION_BYTES) {
      throw new Error(`${definition.label} exceeds the 5 MiB workspace archive section limit.`);
    }
    const recordCount = definition.count(data);
    sections[definition.id] = data;
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

  const archive = {
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
      'It excludes sessions, passwords, API credentials, hosted-monitor encryption keys, raw upstream payloads, tab state, and unrelated browser storage.',
      'Import is a reviewed non-destructive merge. Existing records can be updated according to their section-specific versioned merge rules but are not deleted by absence from the archive.',
    ],
  };
  ensureArchiveBudget(archive);
  return archive;
}

function manifestEntry(raw) {
  const value = record(raw);
  if (!value) return null;
  const id = boundedText(value.id, 40);
  const schema = value.schema === null ? null : boundedText(value.schema, 100);
  const version = Number.isSafeInteger(value.version) && value.version > 0 && value.version <= 1000 ? value.version : null;
  const recordCount = Number.isSafeInteger(value.recordCount) && value.recordCount >= 0 && value.recordCount <= 10000 ? value.recordCount : null;
  const bytes = Number.isSafeInteger(value.bytes) && value.bytes >= 0 && value.bytes <= MAX_WORKSPACE_ARCHIVE_SECTION_BYTES ? value.bytes : null;
  const checksumValue = typeof value.checksum === 'string' && CHECKSUM_RE.test(value.checksum) ? value.checksum : null;
  return id && version !== null && recordCount !== null && bytes !== null && checksumValue
    ? { id, schema, version, recordCount, bytes, checksum: checksumValue }
    : null;
}

/** Validate structure, section byte counts, and checksums without applying data. */
export async function readWorkspaceArchive(raw, options = {}) {
  const value = record(raw);
  if (!value || value.schema !== WORKSPACE_ARCHIVE_SCHEMA) {
    throw new Error('This file is not a WHOISleuth workspace archive.');
  }
  if (!Number.isSafeInteger(value.version) || value.version !== WORKSPACE_ARCHIVE_VERSION) {
    if (Number.isSafeInteger(value.version) && value.version > WORKSPACE_ARCHIVE_VERSION) {
      throw new Error(`This workspace archive uses newer schema ${value.version}. Update the app before importing it.`);
    }
    throw new Error(`Expected workspace archive schema ${WORKSPACE_ARCHIVE_VERSION}.`);
  }
  const { bytes } = ensureArchiveBudget(value);
  const manifest = record(value.manifest);
  const sectionValues = record(value.sections);
  if (!manifest || !sectionValues || !Array.isArray(manifest.sections)) {
    throw new Error('The workspace archive manifest is missing or malformed.');
  }
  if (manifest.sections.length > MAX_WORKSPACE_ARCHIVE_SECTIONS) {
    throw new Error(`Workspace archives are limited to ${MAX_WORKSPACE_ARCHIVE_SECTIONS} sections.`);
  }

  const seen = new Set();
  const sections = [];
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
    let status = 'ready';
    let reason = '';
    if (!definition) {
      status = 'unsupported';
      reason = 'This app does not recognize the archive section.';
    } else if (entry.version !== definition.version || entry.schema !== definition.schema) {
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
    generatedAt: timestamp(value.generatedAt),
    bytes,
    sections,
    limitations: Array.isArray(value.limitations)
      ? value.limitations.map((item) => boundedText(item, 400)).filter(Boolean).slice(0, 8)
      : [],
  };
}

function settingsPreview(data, local, mergedProfiles) {
  const value = record(data) || {};
  const activeProfileId = SAFE_ID_RE.test(value.activeProfileId || '') ? value.activeProfileId : '';
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
export async function previewWorkspaceArchive(raw, localInput, options = {}) {
  const archive = await readWorkspaceArchive(raw, options);
  const local = normalizedInput(localInput);
  const results = [];
  let mergedProfiles = local.brandProfiles;

  for (const section of archive.sections) {
    if (section.status !== 'ready') {
      results.push({ ...section, added: 0, updated: 0, skipped: section.recordCount, selected: false });
      continue;
    }
    const definition = /** @type {any} */ (DEFINITION_BY_ID.get(section.id));
    if (!definition) continue;
    try {
      const result = /** @type {any} */ (definition.id === 'settings'
        ? settingsPreview(section.data, local, mergedProfiles)
        : definition.merge(local, section.data, archive.generatedAt));
      if (definition.id === 'brandProfiles') mergedProfiles = result.profiles;
      results.push({
        ...section,
        status: 'ready',
        reason: '',
        added: result.added || 0,
        updated: result.updated || 0,
        skipped: result.skipped || 0,
        pruned: result.pruned || 0,
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
