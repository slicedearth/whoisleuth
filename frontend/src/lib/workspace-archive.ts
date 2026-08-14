import {
  MAX_WORKSPACE_ARCHIVE_BYTES,
  buildWorkspaceArchive,
  previewWorkspaceArchive,
  WORKSPACE_ARCHIVE_SECTION_IDS,
} from './analysis/workspace-archive.ts';
import type { WorkspaceArchivePreviewSection } from './analysis/workspace-archive.ts';
import {
  MAX_ENCRYPTED_WORKSPACE_ARCHIVE_BYTES,
  decryptWorkspaceArchive,
  encryptWorkspaceArchive,
} from './analysis/workspace-archive-crypto.ts';
import { enforceStoreBudget, mergeCases } from './analysis/case-model.ts';
import type { CaseRecord } from './analysis/case-model.ts';
import { assertCampaignStoreBudget, mergeCampaigns } from './analysis/campaign-model.ts';
import { assertBrandProfileStoreBudget, mergeBrandProfiles } from './analysis/brand-profile-model.ts';
import { assertWatchlistStoreBudget, mergeWatchlistStores } from './analysis/watchlist-store.ts';
import { assertShortlistStoreBudget, mergeShortlistStores } from './analysis/shortlist-model.ts';
import { assertDetectionRuleStoreBudget, mergeDetectionRules } from './analysis/detection-rule-model.ts';
import { mergeRelationshipObservations } from './analysis/relationship-observation-model.ts';
import { enforceBulkSessionStoreBudget, mergeBulkSessions } from './analysis/bulk-session-model.ts';
import { mergeWebsiteSnapshots } from './analysis/website-snapshot-model.ts';
import { mergeInvestigationTemplates } from './analysis/investigation-template-model.ts';
import { mergeBulkReviewStores } from './analysis/bulk-review-model.ts';
import { ACTIVE_PROFILE_KEY, activeProfileId, loadProfiles, setActiveProfile } from './brand-profiles';
import { loadCampaigns } from './campaigns';
import { loadCases } from './cases';
import { loadDetectionRules } from './detection-rules';
import { loadRelationshipObservations } from './relationship-observations';
import { loadBulkSessions } from './bulk-sessions';
import { loadWebsiteSnapshots } from './website-snapshots';
import { loadInvestigationTemplates } from './investigation-templates';
import { loadBulkReviewStore } from './bulk-review';
import { loadShortlist } from './shortlist';
import { THEME_CHANGE_EVENT, THEME_STORAGE_KEY, applyThemePreference, normalizeThemePreference, readThemePreference, setThemePreference } from './theme';
import { loadWatchlists } from './watchlists';
import {
  browserLocalDataCollection,
  browserLocalDataProvider,
} from './browser-local-data-service.ts';
import type { AnyLocalDataCollectionDefinition } from './browser-local-data.ts';
import { guardedWorkspaceRollback, guardedWorkspaceSettingsRollback } from './analysis/workspace-rollback.ts';

export { MAX_WORKSPACE_ARCHIVE_BYTES } from './analysis/workspace-archive.ts';
export {
  MAX_ENCRYPTED_WORKSPACE_ARCHIVE_BYTES,
  MAX_WORKSPACE_ARCHIVE_PASSPHRASE_BYTES,
  MIN_WORKSPACE_ARCHIVE_PASSPHRASE_CHARACTERS,
  inspectEncryptedWorkspaceArchive,
  isEncryptedWorkspaceArchive,
} from './analysis/workspace-archive-crypto.ts';

export type WorkspaceArchiveSectionId = typeof WORKSPACE_ARCHIVE_SECTION_IDS[number];
export type WorkspaceImportSummary = {
  id: string;
  added: number;
  updated: number;
  skipped: number;
  pruned: number;
  brandProfileReferencesOmitted: number;
};

function importSummary(
  id: string,
  result: { added: number; updated: number; skipped: number; pruned?: number; brandProfileReferencesOmitted?: number },
): WorkspaceImportSummary {
  return {
    id,
    added: result.added ?? 0,
    updated: result.updated ?? 0,
    skipped: result.skipped ?? 0,
    pruned: result.pruned ?? 0,
    brandProfileReferencesOmitted: result.brandProfileReferencesOmitted ?? 0,
  };
}

const SETTINGS_KEYS = [ACTIVE_PROFILE_KEY, THEME_STORAGE_KEY];
async function localInput() {
  const [cases, campaigns, brandProfiles, watchlists, shortlist, detectionRules, relationshipObservations, bulkSessions, websiteSnapshots, investigationTemplates, bulkReview] = await Promise.all([
    loadCases(),
    loadCampaigns(),
    loadProfiles(),
    loadWatchlists(),
    loadShortlist(),
    loadDetectionRules(),
    loadRelationshipObservations(),
    loadBulkSessions(),
    loadWebsiteSnapshots(),
    loadInvestigationTemplates(),
    loadBulkReviewStore(),
  ]);
  return {
    cases,
    campaigns,
    brandProfiles,
    watchlists,
    shortlist,
    detectionRules,
    relationshipObservations,
    bulkSessions,
    websiteSnapshots,
    investigationTemplates,
    bulkReview,
    settings: {
      activeProfileId: activeProfileId(),
      theme: readThemePreference(),
    },
  };
}

export async function createWorkspaceArchive(generatedAt = new Date().toISOString()) {
  return buildWorkspaceArchive(await localInput(), { generatedAt });
}

export async function createWorkspaceArchiveDownload(generatedAt = new Date().toISOString()) {
  const archive = await createWorkspaceArchive(generatedAt);
  const content = `${JSON.stringify(archive, null, 2)}\n`;
  if (new TextEncoder().encode(content).byteLength > MAX_WORKSPACE_ARCHIVE_BYTES) {
    throw new Error('Workspace archives are limited to 10 MiB. Export smaller collections separately before trying again.');
  }
  return {
    archive,
    content,
    filename: `whoisleuth-workspace-${archive.generatedAt.slice(0, 10)}.json`,
    mimeType: 'application/json;charset=utf-8',
  };
}

export async function createEncryptedWorkspaceArchiveDownload(
  passphrase: string,
  generatedAt = new Date().toISOString(),
) {
  const archive = await createWorkspaceArchive(generatedAt);
  const envelope = await encryptWorkspaceArchive(archive, passphrase);
  const content = `${JSON.stringify(envelope, null, 2)}\n`;
  if (new TextEncoder().encode(content).byteLength > MAX_ENCRYPTED_WORKSPACE_ARCHIVE_BYTES) {
    throw new Error('The encrypted workspace archive exceeds its 13.4 MiB envelope limit.');
  }
  return {
    archive,
    envelope,
    content,
    filename: `whoisleuth-workspace-encrypted-${archive.generatedAt.slice(0, 10)}.json`,
    mimeType: 'application/json;charset=utf-8',
  };
}

export async function decryptLocalWorkspaceArchive(raw: unknown, passphrase: string) {
  return decryptWorkspaceArchive(raw, passphrase);
}

export async function previewLocalWorkspaceArchive(raw: unknown, selectedSectionIds?: readonly string[]) {
  return previewWorkspaceArchive(
    raw,
    await localInput(),
    selectedSectionIds ? { selectedSectionIds } : {},
  );
}

function snapshotSettings() {
  try {
    return new Map(SETTINGS_KEYS.map((key) => [key, localStorage.getItem(key)]));
  } catch {
    throw new Error('Could not read the browser-local workspace. Browser storage may be unavailable.');
  }
}

function restoreSettings(snapshot: Map<string, string | null>, applied: Map<string, string | null>): boolean {
  const current = snapshotSettings();
  const rollback = guardedWorkspaceSettingsRollback(current, applied, snapshot);
  for (const [key, value] of rollback.settings) {
    if (current.get(key) === value) continue;
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  }
  const theme = normalizeThemePreference(rollback.settings.get(THEME_STORAGE_KEY));
  applyThemePreference(theme);
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: theme }));
  return rollback.fullyRestored;
}

async function applySettings(
  section: WorkspaceArchivePreviewSection,
  beforeWrite: (settings: Map<string, string | null>) => void,
): Promise<Omit<WorkspaceImportSummary, 'id'>> {
  const settings = section.normalizedSettings;
  const theme = normalizeThemePreference(settings?.theme);
  const requestedProfileId = settings?.activeProfileId ?? '';
  const profiles = requestedProfileId ? await loadProfiles() : [];
  const activeProfileAvailable = Boolean(requestedProfileId && profiles.some((profile) => profile.id === requestedProfileId));
  const applied = new Map<string, string | null>([[THEME_STORAGE_KEY, theme]]);
  if (activeProfileAvailable) applied.set(ACTIVE_PROFILE_KEY, requestedProfileId);
  else if (!requestedProfileId) applied.set(ACTIVE_PROFILE_KEY, null);
  beforeWrite(applied);
  if (!setThemePreference(theme)) throw new Error('Could not save the imported theme preference. Browser storage may be full or unavailable.');
  if (activeProfileAvailable) {
    setActiveProfile(requestedProfileId);
    return { added: 0, updated: section.updated, skipped: section.skipped, pruned: 0, brandProfileReferencesOmitted: 0 };
  }
  if (!requestedProfileId) setActiveProfile('');
  return { added: 0, updated: section.updated, skipped: section.skipped, pruned: 0, brandProfileReferencesOmitted: 0 };
}

/** Revalidates the archive, then applies only selected ready sections. */
export async function mergeLocalWorkspaceArchive(raw: unknown, selectedIds: string[]) {
  const preview = await previewLocalWorkspaceArchive(raw, selectedIds);
  const selected = new Set(selectedIds);
  const sections = preview.sections.filter((section) => section.status === 'ready' && selected.has(section.id));
  if (!sections.length) throw new Error('Select at least one supported archive section to merge.');
  const settingsSnapshot = snapshotSettings();
  const dataSections = sections.filter((section) => section.id !== 'settings');
  const sectionCollections = [
    ['cases', 'cases'],
    ['campaigns', 'campaigns'],
    ['brandProfiles', 'brand_profiles'],
    ['watchlists', 'watchlists'],
    ['shortlist', 'shortlist'],
    ['detectionRules', 'detection_rules'],
    ['relationshipObservations', 'relationship_observations'],
    ['bulkSessions', 'bulk_sessions'],
    ['websiteSnapshots', 'website_snapshots'],
    ['investigationTemplates', 'investigation_templates'],
    ['bulkReview', 'bulk_review'],
  ] as const;
  const definitionEntries = await Promise.all(sectionCollections.map(async ([section, collection]) => [
    section,
    await browserLocalDataCollection(collection),
  ] as const));
  const definitionBySection = new Map<string, AnyLocalDataCollectionDefinition>(definitionEntries);
  const definitions = dataSections
    .map((section) => definitionBySection.get(section.id))
    .filter((definition): definition is AnyLocalDataCollectionDefinition => Boolean(definition));
  let results: WorkspaceImportSummary[] = [];
  let previousDocuments = new Map<string, unknown>();
  let appliedDocuments = new Map<string, unknown>();
  let appliedSettings = new Map<string, string | null>();
  let dataApplied = false;
  try {
    if (definitions.length) {
      results = await (await browserLocalDataProvider()).updateMany(definitions, (documents) => {
        previousDocuments = new Map(documents);
        const next = new Map(documents);
        const summaries: WorkspaceImportSummary[] = [];
        for (const section of dataSections) {
          if (section.id === 'cases') {
            const currentCases = Array.isArray(documents.get('cases'))
              ? documents.get('cases') as CaseRecord[]
              : [];
            const merged = mergeCases(currentCases, section.data);
            const bounded = enforceStoreBudget(merged.cases);
            next.set('cases', bounded.cases);
            summaries.push(importSummary(section.id, { ...merged, pruned: bounded.pruned }));
          } else if (section.id === 'campaigns') {
            const result = mergeCampaigns(documents.get('campaigns'), section.data);
            next.set('campaigns', assertCampaignStoreBudget(result.campaigns).campaigns);
            summaries.push(importSummary(section.id, result));
          } else if (section.id === 'brandProfiles') {
            const result = mergeBrandProfiles(documents.get('brand_profiles'), section.data);
            next.set('brand_profiles', assertBrandProfileStoreBudget(result.profiles).profiles);
            summaries.push(importSummary(section.id, result));
          } else if (section.id === 'watchlists') {
            const result = mergeWatchlistStores(documents.get('watchlists'), section.data);
            next.set('watchlists', assertWatchlistStoreBudget(result.watchlists).watchlists);
            summaries.push(importSummary(section.id, result));
          } else if (section.id === 'shortlist') {
            const result = mergeShortlistStores(documents.get('shortlist'), section.data);
            next.set('shortlist', assertShortlistStoreBudget(result.entries).entries);
            summaries.push(importSummary(section.id, result));
          } else if (section.id === 'detectionRules') {
            const result = mergeDetectionRules(documents.get('detection_rules'), section.data);
            next.set('detection_rules', assertDetectionRuleStoreBudget(result.rules).rules);
            summaries.push(importSummary(section.id, result));
          } else if (section.id === 'relationshipObservations') {
            const result = mergeRelationshipObservations(documents.get('relationship_observations'), section.data);
            next.set('relationship_observations', result.observations);
            summaries.push(importSummary(section.id, result));
          } else if (section.id === 'bulkSessions') {
            const result = mergeBulkSessions(documents.get('bulk_sessions'), section.data);
            next.set('bulk_sessions', enforceBulkSessionStoreBudget(result.sessions).store.sessions);
            summaries.push(importSummary(section.id, result));
          } else if (section.id === 'websiteSnapshots') {
            const result = mergeWebsiteSnapshots(documents.get('website_snapshots'), section.data);
            next.set('website_snapshots', result.snapshots);
            summaries.push(importSummary(section.id, result));
          } else if (section.id === 'investigationTemplates') {
            const result = mergeInvestigationTemplates(documents.get('investigation_templates'), section.data);
            next.set('investigation_templates', result.templates);
            summaries.push(importSummary(section.id, result));
          } else if (section.id === 'bulkReview') {
            const result = mergeBulkReviewStores(documents.get('bulk_review'), section.data);
            next.set('bulk_review', result.store);
            summaries.push(importSummary(section.id, result));
          } else continue;
        }
        appliedDocuments = new Map(next);
        return { documents: next, result: summaries };
      });
      dataApplied = true;
    }
    const settingsSection = sections.find((section) => section.id === 'settings');
    if (settingsSection) {
      const result = await applySettings(settingsSection, (settings) => { appliedSettings = settings; });
      results.push({ id: settingsSection.id, added: result.added ?? 0, updated: result.updated ?? 0, skipped: result.skipped ?? 0, pruned: result.pruned ?? 0, brandProfileReferencesOmitted: 0 });
    }
  } catch (cause) {
    let fullyRestored = true;
    try {
      if (dataApplied && definitions.length && previousDocuments.size) {
        await (await browserLocalDataProvider()).updateMany(definitions, (documents) => ({
          documents: guardedWorkspaceRollback(definitions, documents, appliedDocuments, previousDocuments),
          result: undefined,
        }));
      }
    } catch {
      fullyRestored = false;
    }
    try {
      if (appliedSettings.size && !restoreSettings(settingsSnapshot, appliedSettings)) fullyRestored = false;
    } catch {
      fullyRestored = false;
    }
    if (!fullyRestored) {
      throw new Error('Workspace import failed and the previous browser-local state could not be fully restored. Reload before making further changes.');
    }
    throw new Error(`Workspace import failed. No archive changes were kept. ${cause instanceof Error ? cause.message : ''}`.trim());
  }
  return { results, preview };
}
