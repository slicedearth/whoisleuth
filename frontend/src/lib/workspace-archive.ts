import {
  MAX_WORKSPACE_ARCHIVE_BYTES,
  buildWorkspaceArchive,
  previewWorkspaceArchive,
  WORKSPACE_ARCHIVE_SECTION_IDS,
} from './analysis/workspace-archive.js';
import { ACTIVE_PROFILE_KEY, activeProfileId, importProfiles, loadProfiles, PROFILES_KEY, setActiveProfile } from './brand-profiles';
import { CAMPAIGNS_KEY, importCampaigns, loadCampaigns } from './campaigns';
import { CASES_KEY, importCases, loadCases } from './cases';
import { DETECTION_RULES_KEY, importDetectionRules, loadDetectionRules } from './detection-rules';
import { SHORTLIST_KEY, importShortlist, loadShortlist } from './shortlist';
import { THEME_CHANGE_EVENT, THEME_STORAGE_KEY, applyThemePreference, normalizeThemePreference, readThemePreference, setThemePreference } from './theme';
import { WATCHLIST_KEY, importWatchlists, loadWatchlists } from './watchlists';

export { MAX_WORKSPACE_ARCHIVE_BYTES } from './analysis/workspace-archive.js';

export type WorkspaceArchiveSectionId = typeof WORKSPACE_ARCHIVE_SECTION_IDS[number];

const STORAGE_KEYS = [
  CASES_KEY,
  CAMPAIGNS_KEY,
  PROFILES_KEY,
  WATCHLIST_KEY,
  SHORTLIST_KEY,
  DETECTION_RULES_KEY,
  ACTIVE_PROFILE_KEY,
  THEME_STORAGE_KEY,
];

function localInput() {
  return {
    cases: loadCases(),
    campaigns: loadCampaigns(),
    brandProfiles: loadProfiles(),
    watchlists: loadWatchlists(),
    shortlist: loadShortlist(),
    detectionRules: loadDetectionRules(),
    settings: {
      activeProfileId: activeProfileId(),
      theme: readThemePreference(),
    },
  };
}

export async function createWorkspaceArchive(generatedAt = new Date().toISOString()) {
  return buildWorkspaceArchive(localInput(), { generatedAt });
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
  return previewWorkspaceArchive(raw, localInput());
}

function snapshotStorage() {
  try {
    return new Map(STORAGE_KEYS.map((key) => [key, localStorage.getItem(key)]));
  } catch {
    throw new Error('Could not read the browser-local workspace. Browser storage may be unavailable.');
  }
}

function restoreStorage(snapshot: Map<string, string | null>) {
  for (const [key, value] of snapshot) {
    if (localStorage.getItem(key) === value) continue;
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  }
  const theme = normalizeThemePreference(snapshot.get(THEME_STORAGE_KEY));
  applyThemePreference(theme);
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: theme }));
}

function applySettings(section: any) {
  const settings = section.normalizedSettings || {};
  const theme = normalizeThemePreference(settings.theme);
  if (!setThemePreference(theme)) throw new Error('Could not save the imported theme preference. Browser storage may be full or unavailable.');
  if (settings.activeProfileId && loadProfiles().some((profile) => profile.id === settings.activeProfileId)) {
    setActiveProfile(settings.activeProfileId);
    return { added: 0, updated: section.updated, skipped: 0, pruned: 0 };
  }
  if (!settings.activeProfileId) setActiveProfile('');
  return { added: 0, updated: section.updated, skipped: settings.activeProfileId ? 1 : 0, pruned: 0 };
}

/** Revalidates the archive, then applies only selected ready sections. */
export async function mergeLocalWorkspaceArchive(raw: unknown, selectedIds: string[]) {
  const preview = await previewLocalWorkspaceArchive(raw);
  const selected = new Set(selectedIds);
  const sections = preview.sections.filter((section: any) => section.status === 'ready' && selected.has(section.id));
  if (!sections.length) throw new Error('Select at least one supported archive section to merge.');
  const snapshot = snapshotStorage();
  const results = [];
  try {
    for (const section of sections) {
      let result:any;
      if (section.id === 'cases') result = importCases(section.data);
      else if (section.id === 'campaigns') result = importCampaigns(section.data);
      else if (section.id === 'brandProfiles') result = importProfiles(section.data);
      else if (section.id === 'watchlists') result = importWatchlists(section.data);
      else if (section.id === 'shortlist') result = importShortlist(section.data);
      else if (section.id === 'detectionRules') result = importDetectionRules(section.data);
      else if (section.id === 'settings') result = applySettings(section);
      else continue;
      results.push({ id: section.id, added: result.added || 0, updated: result.updated || 0, skipped: result.skipped || 0, pruned: result.pruned || 0 });
    }
  } catch (cause) {
    try {
      restoreStorage(snapshot);
    } catch {
      throw new Error('Workspace import failed and the previous browser-local state could not be fully restored. Reload before making further changes.');
    }
    throw new Error(`Workspace import failed. No archive changes were kept. ${cause instanceof Error ? cause.message : ''}`.trim());
  }
  return { results, preview };
}
