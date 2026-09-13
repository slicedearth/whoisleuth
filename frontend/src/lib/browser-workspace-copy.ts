import { retainedFileGroups, type RetainedFileInput } from '../../../packages/evidence/retained-file.mts';
import type { AnyLocalDataCollectionDefinition, BrowserLocalDataProvider } from './browser-local-data.ts';
import { openBrowserWorkspaceDestination } from './browser-workspace-destination.ts';

type Source = Pick<BrowserLocalDataProvider, 'readMany' | 'readFiles'>;
type Destination = Source & Pick<BrowserLocalDataProvider, 'updateMany'> & {
  initialize: (definitions: readonly AnyLocalDataCollectionDefinition[]) => Promise<unknown>;
};

/** Capture all collection owners, including local-only recovery, before creating a destination. */
export async function prepareBrowserWorkspaceCopy(source: Source, definitions: readonly AnyLocalDataCollectionDefinition[]) {
  const owners = [...definitions];
  const documents = structuredClone(await source.readMany(owners));
  const expected = new Map(owners.map(owner => [owner.id, owner.serialize(documents.get(owner.id))]));
  const groups = owners.flatMap(owner => retainedFileGroups(owner.binaryReferences?.(documents.get(owner.id)) ?? []).map(files => ({ owner, files })));
  return { owners, documents, expected, groups };
}

export type BrowserWorkspaceCopyReport = Readonly<{
  collections: readonly Readonly<{ id: string; label: string; records: number; matches: boolean }>[];
  sourceMatches: boolean;
  files: Readonly<{ expected: number; verified: number; missing: number; bytes: number }>;
  verified: boolean;
}>;

/** One coordinator owns this copy; the existing provider still owns atomic writes and conflicts. */
export function createBrowserWorkspaceCopy(prepared: Awaited<ReturnType<typeof prepareBrowserWorkspaceCopy>>, source: Source, destination: Destination,
  lifecycle: Readonly<{ assertCurrent: () => Promise<void>; close: () => Promise<void> }>) {
  const { owners, documents, expected, groups } = prepared;
  let attempted = false, closing = false, closed: Promise<void> | null = null, pending: Promise<unknown> | null = null;
  let writeState: 'not_started' | 'unconfirmed' | 'committed' = 'not_started';
  const controller = new AbortController();
  const matches = (actual: ReadonlyMap<string, unknown>) => owners.every(owner => owner.serialize(actual.get(owner.id)) === expected.get(owner.id));
  async function sourceCurrent() {
    controller.signal.throwIfAborted();
    if (!matches(await source.readMany(owners))) throw new Error('Saved records changed in the source workspace. This copy was not updated automatically. Keep or inspect it before starting a new copy.');
  }
  function run<T>(work: () => Promise<T>): Promise<T> {
    if (closing || pending) return Promise.reject(new Error('Finish the current workspace-copy operation before starting another.'));
    writeState = 'not_started';
    const result = (async () => { await lifecycle.assertCurrent(); controller.signal.throwIfAborted(); return work(); })();
    pending = result;
    void result.finally(() => { if (pending === result) pending = null; }).catch(() => {});
    return result;
  }
  async function verify(): Promise<BrowserWorkspaceCopyReport> {
    const actual = await destination.readMany(owners);
    const collections = owners.map(owner => ({ id: owner.id, label: owner.label, records: owner.split(actual.get(owner.id)).length,
      matches: owner.serialize(actual.get(owner.id)) === expected.get(owner.id) }));
    let verified = 0, missing = 0, bytes = 0;
    for (const { owner, files } of groups) {
      controller.signal.throwIfAborted();
      const retained = await destination.readFiles(owner, files);
      for (const file of files) {
        if (retained.get(file.digestSha256)) { verified++; bytes += file.byteLength; } else missing++;
      }
    }
    const sourceMatches = matches(await source.readMany(owners));
    await lifecycle.assertCurrent(); controller.signal.throwIfAborted();
    return { collections, sourceMatches, files: { expected: verified + missing, verified, missing, bytes },
      verified: sourceMatches && collections.every(item => item.matches) && missing === 0 };
  }
  async function copyMissingFiles() {
    await sourceCurrent();
    if (!matches(await destination.readMany(owners))) throw new Error('Destination records do not match the captured source. Nothing was overwritten. Verify this workspace before another copy.');
    for (const { owner, files } of groups) {
      controller.signal.throwIfAborted(); await lifecycle.assertCurrent();
      const existing = await destination.readFiles(owner, files);
      const missing = files.filter(file => !existing.get(file.digestSha256));
      if (!missing.length) continue;
      const originals = await source.readFiles(owner, missing);
      const inputs: RetainedFileInput[] = missing.flatMap(reference => {
        const file = originals.get(reference.digestSha256);
        return file ? [{ reference, file }] : [];
      });
      if (!inputs.length) continue;
      await sourceCurrent(); controller.signal.throwIfAborted();
      writeState = 'unconfirmed';
      await destination.updateMany([owner], current => {
        if (owner.serialize(current.get(owner.id)) !== expected.get(owner.id)) throw new Error('Destination records changed. No original files were replaced.');
        return { documents: current, result: undefined };
      }, { files: new Map([[owner.id, inputs]]) });
      writeState = 'committed';
    }
    return verify();
  }
  function close(): Promise<void> {
    if (!closed) {
      closing = true; controller.abort();
      closed = (async () => { await pending?.catch(() => {}); await lifecycle.close(); })();
    }
    return closed;
  }
  return Object.freeze({
    get writeState() { return writeState; },
    copy: () => run(async () => {
      if (attempted) throw new Error('The metadata write was already attempted. Verify the copy or retry only missing originals; do not repeat the metadata write.');
      attempted = true;
      await sourceCurrent();
      await destination.initialize(owners);
      controller.signal.throwIfAborted(); await lifecycle.assertCurrent();
      writeState = 'unconfirmed';
      await destination.updateMany(owners, current => {
        if (owners.some(owner => owner.serialize(current.get(owner.id)) !== owner.serialize(owner.empty()))) throw new Error('The new workspace is no longer empty. Nothing was overwritten.');
        return { documents, result: undefined };
      });
      writeState = 'committed';
      return copyMissingFiles();
    }),
    verify: () => run(verify),
    retryFiles: () => run(copyMissingFiles),
    close,
  });
}

export async function openEncryptedWorkspaceCopy(options: Readonly<{ name: string; passphrase: string }>) {
  if (!options.passphrase) throw new Error('A replacement workspace requires a new passphrase.');
  const [{ browserLocalDataProvider }, { BROWSER_LOCAL_COLLECTIONS }] = await Promise.all([
    import('./browser-local-data-service.ts'), import('./browser-local-data-definitions.ts'),
  ]);
  const source = await browserLocalDataProvider();
  const prepared = await prepareBrowserWorkspaceCopy(source, BROWSER_LOCAL_COLLECTIONS);
  const destination = await openBrowserWorkspaceDestination(options);
  options = { name: options.name, passphrase: '' };
  const copy = createBrowserWorkspaceCopy(prepared, source, destination.provider, destination);
  return Object.freeze({ workspace: destination.workspace, ...copy, get writeState() { return copy.writeState; } });
}

export type BrowserWorkspaceCopy = Awaited<ReturnType<typeof openEncryptedWorkspaceCopy>>;
