import {
  MAX_WORKSPACE_ARCHIVE_BYTES,
  buildWorkspaceArchive,
  mergeReadyWorkspaceArchiveData,
  prepareWorkspaceArchive,
  WORKSPACE_ARCHIVE_SECTION_IDS,
} from './analysis/workspace-archive.ts';
import type { WorkspaceArchivePreviewSection } from './analysis/workspace-archive.ts';
import {
  MAX_ENCRYPTED_WORKSPACE_ARCHIVE_BYTES,
  decryptWorkspaceArchive,
  encryptWorkspaceArchive,
} from './analysis/workspace-archive-crypto.ts';
import { ACTIVE_PROFILE_KEY, activeProfileId, loadProfiles, setActiveProfile } from './brand-profiles';
import { workspacePreferenceStorage } from './browser-workspace-context.ts';
import { THEME_CHANGE_EVENT, THEME_STORAGE_KEY, applyThemePreference, normalizeThemePreference, readThemePreference, setThemePreference } from './theme';
import {
  browserLocalDataCollection,
  browserLocalDataProvider,
  readBrowserLocalDataCollections,
} from './browser-local-data-service.ts';
import type { AnyLocalDataCollectionDefinition } from './browser-local-data.ts';
import { guardedWorkspaceRollback, guardedWorkspaceSettingsRollback } from './analysis/workspace-rollback.ts';
import { rethrowUnknownWorkspaceCommit } from './analysis/workspace-import-outcome.ts';
import { WORKSPACE_ARCHIVE_COLLECTIONS as SECTION_COLLECTIONS } from '../../../packages/contracts/browser-local-collection-manifest.mts';

export { MAX_WORKSPACE_ARCHIVE_BYTES } from './analysis/workspace-archive.ts';
export {
  MAX_ENCRYPTED_WORKSPACE_ARCHIVE_BYTES,
  MAX_WORKSPACE_ARCHIVE_PASSPHRASE_BYTES,
  MIN_WORKSPACE_ARCHIVE_PASSPHRASE_CHARACTERS,
  inspectEncryptedWorkspaceArchive,
  isEncryptedWorkspaceArchive,
} from './analysis/workspace-archive-crypto.ts';

export type WorkspaceArchiveSectionId = typeof WORKSPACE_ARCHIVE_SECTION_IDS[number];
type WorkspacePreview = ReturnType<Awaited<ReturnType<typeof prepareWorkspaceArchive>>['preview']>;
export type WorkspaceImportSummary = {
  id: string;
  added: number;
  updated: number;
  skipped: number;
  pruned: number;
  brandProfileReferencesOmitted: number;
  authoredHistoryOmitted: number;
};

function importSummary(
  id: string,
  result: { added: number; updated: number; skipped: number; pruned?: number; brandProfileReferencesOmitted?: number; authoredHistoryOmitted?: number },
): WorkspaceImportSummary {
  return {
    id,
    added: result.added ?? 0,
    updated: result.updated ?? 0,
    skipped: result.skipped ?? 0,
    pruned: result.pruned ?? 0,
    brandProfileReferencesOmitted: result.brandProfileReferencesOmitted ?? 0,
    authoredHistoryOmitted: result.authoredHistoryOmitted ?? 0,
  };
}

const SETTINGS_KEYS = [ACTIVE_PROFILE_KEY, THEME_STORAGE_KEY];
async function localInput() {
  const documents = await readBrowserLocalDataCollections(SECTION_COLLECTIONS.map(([, collection]) => collection));
  return {
    ...Object.fromEntries(SECTION_COLLECTIONS.map(([section, collection]) => [section, documents[collection]])),
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
  const content = `${JSON.stringify(archive)}\n`;
  if (new TextEncoder().encode(content).byteLength > MAX_WORKSPACE_ARCHIVE_BYTES) {
    throw new Error(`Workspace archives are limited to ${MAX_WORKSPACE_ARCHIVE_BYTES / 1024 / 1024} MiB. Export smaller collections separately before trying again.`);
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
    throw new Error(`The encrypted workspace archive exceeds its ${MAX_ENCRYPTED_WORKSPACE_ARCHIVE_BYTES}-byte envelope limit.`);
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

export async function previewLocalWorkspaceArchive(raw: unknown, selectedSectionIds?: readonly string[]): Promise<WorkspacePreview> {
  return (await prepareLocalWorkspaceArchive(raw)).preview(selectedSectionIds);
}

/** A page-scoped verified archive; local records are read afresh for every action. */
export async function prepareLocalWorkspaceArchive(raw: unknown) {
  const archive = await prepareWorkspaceArchive(raw);
  async function preview(selectedSectionIds?: readonly string[]) {
    return archive.preview(await localInput(), selectedSectionIds ? { selectedSectionIds } : {});
  }
  return Object.freeze({
    read: archive.read,
    preview,
    merge: async (selectedIds: string[]) => mergeWorkspacePreview(await preview(selectedIds), selectedIds),
  });
}

function snapshotSettings() {
  try {
    return new Map(SETTINGS_KEYS.map((key) => [key, (key === ACTIVE_PROFILE_KEY ? workspacePreferenceStorage() : localStorage).getItem(key)]));
  } catch {
    throw new Error('Could not read the browser-local workspace. Browser storage may be unavailable.');
  }
}

function restoreSettings(snapshot: Map<string, string | null>, applied: Map<string, string | null>): boolean {
  const current = snapshotSettings();
  const rollback = guardedWorkspaceSettingsRollback(current, applied, snapshot);
  for (const [key, value] of rollback.settings) {
    if (current.get(key) === value) continue;
    const storage = key === ACTIVE_PROFILE_KEY ? workspacePreferenceStorage() : localStorage;
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
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
    return { added: 0, updated: section.updated, skipped: section.skipped, pruned: 0, brandProfileReferencesOmitted: 0, authoredHistoryOmitted: 0 };
  }
  if (!requestedProfileId) setActiveProfile('');
  return { added: 0, updated: section.updated, skipped: section.skipped, pruned: 0, brandProfileReferencesOmitted: 0, authoredHistoryOmitted: 0 };
}

/** Revalidates the archive, then applies only selected ready sections. */
export async function mergeLocalWorkspaceArchive(raw: unknown, selectedIds: string[]) {
  return (await prepareLocalWorkspaceArchive(raw)).merge(selectedIds);
}

async function mergeWorkspacePreview(
  preview: WorkspacePreview,
  selectedIds: string[],
) {
  const selected = new Set(selectedIds);
  const sections = preview.sections.filter((section) => section.status === 'ready' && selected.has(section.id));
  if (!sections.length) throw new Error('Select at least one supported archive section to merge.');
  const settingsSnapshot = snapshotSettings();
  const dataSections = sections.filter((section) => section.id !== 'settings');
  const definitionEntries = await Promise.all(SECTION_COLLECTIONS.map(async ([section, collection]) => [
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
        const input = Object.fromEntries(SECTION_COLLECTIONS.map(([section, collection]) => [section, documents.get(collection)]));
        for (const result of mergeReadyWorkspaceArchiveData(input, dataSections, preview.generatedAt)) {
          const definition = definitionBySection.get(result.id);
          if (!definition) throw new Error('The selected workspace section has no storage owner.');
          next.set(definition.id, result.document);
          summaries.push(importSummary(result.id, result));
        }
        appliedDocuments = new Map(next);
        return { documents: next, result: summaries };
      });
      dataApplied = true;
    }
    const settingsSection = sections.find((section) => section.id === 'settings');
    if (settingsSection) {
      const result = await applySettings(settingsSection, (settings) => { appliedSettings = settings; });
      results.push({ id: settingsSection.id, added: result.added ?? 0, updated: result.updated ?? 0, skipped: result.skipped ?? 0, pruned: result.pruned ?? 0, brandProfileReferencesOmitted: 0, authoredHistoryOmitted: 0 });
    }
  } catch (cause) {
    rethrowUnknownWorkspaceCommit(cause);
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
