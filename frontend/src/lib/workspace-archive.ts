import {
  MAX_WORKSPACE_ARCHIVE_BYTES,
  buildWorkspaceArchive,
  previewWorkspaceArchive,
  WORKSPACE_ARCHIVE_SECTION_IDS,
} from './analysis/workspace-archive.ts';
import type { WorkspaceArchivePreviewSection } from './analysis/workspace-archive.ts';
import { enforceStoreBudget, mergeCases } from './analysis/case-model.ts';
import type { CaseRecord } from './analysis/case-model.ts';
import { assertCampaignStoreBudget, mergeCampaigns } from './analysis/campaign-model.ts';
import { assertBrandProfileStoreBudget, mergeBrandProfiles } from './analysis/brand-profile-model.ts';
import { assertWatchlistStoreBudget, mergeWatchlistStores } from './analysis/watchlist-store.ts';
import { assertShortlistStoreBudget, mergeShortlistStores } from './analysis/shortlist-model.ts';
import { assertDetectionRuleStoreBudget, mergeDetectionRules } from './analysis/detection-rule-model.ts';
import { mergeRelationshipObservations } from './analysis/relationship-observation-model.ts';
import { ACTIVE_PROFILE_KEY, activeProfileId, loadProfiles, setActiveProfile } from './brand-profiles';
import { loadCampaigns } from './campaigns';
import { loadCases } from './cases';
import { loadDetectionRules } from './detection-rules';
import { loadRelationshipObservations } from './relationship-observations';
import { loadShortlist } from './shortlist';
import { THEME_CHANGE_EVENT, THEME_STORAGE_KEY, applyThemePreference, normalizeThemePreference, readThemePreference, setThemePreference } from './theme';
import { loadWatchlists } from './watchlists';
import { browserLocalDataProvider } from './browser-local-data-service.ts';
import {
  CAMPAIGNS_COLLECTION,
  CASES_COLLECTION,
  DETECTION_RULES_COLLECTION,
  PROFILES_COLLECTION,
  SHORTLIST_COLLECTION,
  WATCHLISTS_COLLECTION,
  RELATIONSHIP_OBSERVATIONS_COLLECTION,
} from './browser-local-data-definitions.ts';
import type { AnyLocalDataCollectionDefinition } from './browser-local-data.ts';

export { MAX_WORKSPACE_ARCHIVE_BYTES } from './analysis/workspace-archive.ts';

export type WorkspaceArchiveSectionId = typeof WORKSPACE_ARCHIVE_SECTION_IDS[number];
export type WorkspaceImportSummary = {
  id: string;
  added: number;
  updated: number;
  skipped: number;
  pruned: number;
};

function importSummary(
  id: string,
  result: { added: number; updated: number; skipped: number; pruned?: number },
): WorkspaceImportSummary {
  return {
    id,
    added: result.added ?? 0,
    updated: result.updated ?? 0,
    skipped: result.skipped ?? 0,
    pruned: result.pruned ?? 0,
  };
}

const SETTINGS_KEYS = [ACTIVE_PROFILE_KEY, THEME_STORAGE_KEY];
const profileId = () => crypto.randomUUID ? crypto.randomUUID() : `bp-${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function localInput() {
  const [cases, campaigns, brandProfiles, watchlists, shortlist, detectionRules, relationshipObservations] = await Promise.all([
    loadCases(),
    loadCampaigns(),
    loadProfiles(),
    loadWatchlists(),
    loadShortlist(),
    loadDetectionRules(),
    loadRelationshipObservations(),
  ]);
  return {
    cases,
    campaigns,
    brandProfiles,
    watchlists,
    shortlist,
    detectionRules,
    relationshipObservations,
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

export async function previewLocalWorkspaceArchive(raw: unknown) {
  return previewWorkspaceArchive(raw, await localInput());
}

function snapshotSettings() {
  try {
    return new Map(SETTINGS_KEYS.map((key) => [key, localStorage.getItem(key)]));
  } catch {
    throw new Error('Could not read the browser-local workspace. Browser storage may be unavailable.');
  }
}

function restoreSettings(snapshot: Map<string, string | null>) {
  for (const [key, value] of snapshot) {
    if (localStorage.getItem(key) === value) continue;
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  }
  const theme = normalizeThemePreference(snapshot.get(THEME_STORAGE_KEY));
  applyThemePreference(theme);
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: theme }));
}

async function applySettings(section: WorkspaceArchivePreviewSection): Promise<Omit<WorkspaceImportSummary, 'id'>> {
  const settings = section.normalizedSettings;
  const theme = normalizeThemePreference(settings?.theme);
  if (!setThemePreference(theme)) throw new Error('Could not save the imported theme preference. Browser storage may be full or unavailable.');
  if (settings?.activeProfileId && (await loadProfiles()).some((profile) => profile.id === settings.activeProfileId)) {
    setActiveProfile(settings.activeProfileId);
    return { added: 0, updated: section.updated, skipped: 0, pruned: 0 };
  }
  if (!settings?.activeProfileId) setActiveProfile('');
  return { added: 0, updated: section.updated, skipped: settings?.activeProfileId ? 1 : 0, pruned: 0 };
}

/** Revalidates the archive, then applies only selected ready sections. */
export async function mergeLocalWorkspaceArchive(raw: unknown, selectedIds: string[]) {
  const preview = await previewLocalWorkspaceArchive(raw);
  const selected = new Set(selectedIds);
  const sections = preview.sections.filter((section) => section.status === 'ready' && selected.has(section.id));
  if (!sections.length) throw new Error('Select at least one supported archive section to merge.');
  const settingsSnapshot = snapshotSettings();
  const dataSections = sections.filter((section) => section.id !== 'settings');
  const definitionBySection = new Map<string, AnyLocalDataCollectionDefinition>([
    ['cases', CASES_COLLECTION],
    ['campaigns', CAMPAIGNS_COLLECTION],
    ['brandProfiles', PROFILES_COLLECTION],
    ['watchlists', WATCHLISTS_COLLECTION],
    ['shortlist', SHORTLIST_COLLECTION],
    ['detectionRules', DETECTION_RULES_COLLECTION],
    ['relationshipObservations', RELATIONSHIP_OBSERVATIONS_COLLECTION],
  ]);
  const definitions = dataSections
    .map((section) => definitionBySection.get(section.id))
    .filter((definition): definition is AnyLocalDataCollectionDefinition => Boolean(definition));
  let results: WorkspaceImportSummary[] = [];
  let previousDocuments = new Map<string, unknown>();
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
            const result = mergeBrandProfiles(documents.get('brand_profiles'), section.data, { makeId: profileId });
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
          } else continue;
        }
        return { documents: next, result: summaries };
      });
    }
    const settingsSection = sections.find((section) => section.id === 'settings');
    if (settingsSection) {
      const result = await applySettings(settingsSection);
      results.push({ id: settingsSection.id, added: result.added ?? 0, updated: result.updated ?? 0, skipped: result.skipped ?? 0, pruned: result.pruned ?? 0 });
    }
  } catch (cause) {
    try {
      if (definitions.length && previousDocuments.size) {
        await (await browserLocalDataProvider()).updateMany(definitions, () => ({ documents: previousDocuments, result: undefined }));
      }
      restoreSettings(settingsSnapshot);
    } catch {
      throw new Error('Workspace import failed and the previous browser-local state could not be fully restored. Reload before making further changes.');
    }
    throw new Error(`Workspace import failed. No archive changes were kept. ${cause instanceof Error ? cause.message : ''}`.trim());
  }
  return { results, preview };
}
