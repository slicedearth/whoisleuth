import { WORKSPACE_ARCHIVE_COLLECTIONS } from '../../../packages/contracts/browser-local-collection-manifest.mts';
import { buildWorkspaceArchive, mergeReadyWorkspaceArchiveData, readWorkspaceArchive } from '../../../packages/workspace/workspace-archive.mts';
import { compareRecoveredWorkspace, matchRecoveryFiles, workspaceAttachmentGroups, type ReviewedWorkspaceArchive } from '../../../packages/workspace/workspace-recovery.mts';
import { browserWorkspaceDirectory } from './browser-workspace-directory.ts';
import { openBrowserWorkspaceDestination } from './browser-workspace-destination.ts';
export { WorkspaceDestinationStartError as WorkspaceRecoveryStartError } from './browser-workspace-destination.ts';
import { currentBrowserWorkspaceId } from './browser-workspace-context.ts';
import { MAX_SELECTED_FILES, MAX_SELECTED_FILE_TOTAL_BYTES } from '../../../packages/contracts/selected-file-limits.mts';
import { MAX_ENCRYPTED_INVESTIGATION_PACKAGE_BYTES } from '../../../packages/contracts/investigation-package-limits.mts';
import type { AnyLocalDataCollectionDefinition } from './browser-local-data.ts';
import type { CaseRecord } from '../../../packages/cases/case-model.mts';

export type WorkspaceRecoveryReport = ReturnType<typeof compareRecoveredWorkspace> & Readonly<{
  files: Readonly<{ expected: number; verified: number; missing: number; bytes: number }>;
  omissions: number;
  verified: boolean;
}>;

/** Own one fresh destination, its exclusive lease and its in-memory key. */
export async function openWorkspaceRecovery(input: ReviewedWorkspaceArchive, options: Readonly<{ name: string; passphrase?: string; requireEncryption: boolean }>) {
  if (options.requireEncryption && !options.passphrase) throw new Error('An encrypted backup requires an encrypted rehearsal workspace.');
  const source = structuredClone(input);
  if (source.sections.some(section => section.status !== 'ready')) throw new Error('The backup includes an unsupported section. Use a compatible version before rehearsing its recovery. No workspace was created.');
  const groups = workspaceAttachmentGroups(source);
  const { BROWSER_LOCAL_COLLECTIONS, CASES_COLLECTION } = await import('./browser-local-data-definitions.ts');
  const definitions: AnyLocalDataCollectionDefinition[] = WORKSPACE_ARCHIVE_COLLECTIONS.map(([, collection]) => {
    const definition = BROWSER_LOCAL_COLLECTIONS.find(candidate => candidate.id === collection);
    if (!definition) throw new Error('A workspace archive collection has no storage owner.');
    return definition;
  });
  const ready = source.sections.filter(section => section.id !== 'settings' && section.status === 'ready');
  if (!ready.length) throw new Error('The backup has no supported data sections to rehearse.');
  const merged = mergeReadyWorkspaceArchiveData({}, ready, source.generatedAt);
  const documents = new Map<string, unknown>(definitions.map(definition => [definition.id, definition.empty()]));
  for (const result of merged) {
    const owner = WORKSPACE_ARCHIVE_COLLECTIONS.find(([section]) => section === result.id);
    if (!owner) throw new Error('The backup section has no storage owner.');
    documents.set(owner[1], result.document);
  }
  const omissions = merged.reduce((total, result) => total + result.skipped + (result.pruned ?? 0)
    + (result.brandProfileReferencesOmitted ?? 0) + (result.authoredHistoryOmitted ?? 0), 0);
  const destination = await openBrowserWorkspaceDestination(options);
  const { workspace, provider } = destination;
  options = { name: options.name, requireEncryption: options.requireEncryption };
  let attempted = false, closing = false, pending: Promise<unknown> | null = null, closed: Promise<void> | null = null;
  let writeState: 'not_started' | 'unconfirmed' | 'committed' = 'not_started';
  function run<T>(operation: () => Promise<T>): Promise<T> {
    if (closing || pending) return Promise.reject(new Error('Finish the current recovery operation before starting another.'));
    writeState = 'not_started';
    const result = (async () => { await destination.assertCurrent(); return operation(); })();
    pending = result;
    void result.finally(() => { if (pending === result) pending = null; }).catch(() => {});
    return result;
  }
  async function verify(): Promise<WorkspaceRecoveryReport> {
    const actual = await provider.readMany(definitions);
    const restored = await readWorkspaceArchive(await buildWorkspaceArchive(Object.fromEntries(WORKSPACE_ARCHIVE_COLLECTIONS.map(([section, collection]) => [section, actual.get(collection)])),
      { generatedAt: source.generatedAt ?? new Date().toISOString() }));
    const comparison = compareRecoveredWorkspace(source, restored);
    let verified = 0, missing = 0, bytes = 0;
    for (const group of groups) {
      const files = await provider.readFiles(CASES_COLLECTION, group.map(({ digestSha256, byteLength }) => ({ digestSha256, byteLength })));
      for (const item of group) {
        if (files.get(item.digestSha256)) { verified++; bytes += item.byteLength; } else missing++;
      }
    }
    return { ...comparison, files: { expected: verified + missing, verified, missing, bytes }, omissions,
      verified: comparison.metadataMatches && omissions === 0 && missing === 0 };
  }
  function close(): Promise<void> {
    if (!closed) {
      closing = true;
      closed = (async () => {
        await pending?.catch(() => {});
        await destination.close();
      })();
    }
    return closed;
  }
  return Object.freeze({
    workspace,
    get writeState() { return writeState; },
    restore: () => run(async () => {
      if (attempted) throw new Error('This rehearsal has already attempted its write. Verify the destination or remove it; do not repeat the write.');
      attempted = true;
      await provider.initialize(BROWSER_LOCAL_COLLECTIONS);
      writeState = 'unconfirmed';
      await provider.updateMany(definitions, current => {
        for (const definition of definitions) if (definition.serialize(current.get(definition.id)) !== definition.serialize(definition.empty())) {
          throw new Error('The rehearsal destination is no longer empty. Nothing was overwritten.');
        }
        return { documents, result: undefined };
      });
      writeState = 'committed';
      return verify();
    }),
    verify: () => run(verify),
    addFiles: (input: readonly Blob[], kind: 'originals' | 'package', passphrase?: string) => {
      // Capture immutable bodies before directory reads or package parsing.
      const maximum = kind === 'package' ? MAX_ENCRYPTED_INVESTIGATION_PACKAGE_BYTES : MAX_SELECTED_FILE_TOTAL_BYTES;
      if (!Array.isArray(input) || !input.length || input.length > (kind === 'package' ? 1 : MAX_SELECTED_FILES)
        || input.some(file => !(file instanceof Blob) || !file.size) || input.reduce((sum, file) => sum + file.size, 0) > maximum) {
        return run(async () => { throw new Error('Selected recovery files exceed the count or byte limit for this operation.'); });
      }
      const selected = input.map(file => file.slice());
      return run(async () => {
        let files = selected;
        if (kind === 'package') {
          const { runInvestigationPackageWorker } = await import('./investigation-package-worker.ts');
          if (selected.length !== 1 || !selected[0]!.size || selected[0]!.size > MAX_ENCRYPTED_INVESTIGATION_PACKAGE_BYTES) throw new Error('Select one bounded evidence package.');
          const reviewed = await runInvestigationPackageWorker('inspect', { file: selected[0]!, ...(passphrase === undefined ? {} : { passphrase }) });
          if (!reviewed.identityVerified) throw new Error('The evidence package contains an unverified file. Nothing was added.');
          files = [...reviewed.contents.values()];
        }
        const matched = await matchRecoveryFiles(groups, files);
        writeState = 'unconfirmed';
        await provider.update(CASES_COLLECTION, current => {
          if (CASES_COLLECTION.serialize(current) !== CASES_COLLECTION.serialize(documents.get('cases') as CaseRecord[])) throw new Error('The restored Cases do not match the reviewed recovery state. Nothing was added.');
          return { document: current, result: undefined };
        }, { files: matched });
        writeState = 'committed';
        return verify();
      });
    },
    close,
    remove: async () => { await close(); await browserWorkspaceDirectory.remove(workspace, currentBrowserWorkspaceId()); },
  });
}

export type WorkspaceRecovery = Awaited<ReturnType<typeof openWorkspaceRecovery>>;
