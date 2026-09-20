import { BrowserLocalDataProvider } from './browser-local-data.ts';
import { browserWorkspaceDirectory } from './browser-workspace-directory.ts';
import { browserWorkspaceDatabaseName, namedWorkspaceLegacyStorage } from './browser-workspace-storage.ts';
import { currentBrowserWorkspaceId, protectBrowserWorkspaceSession } from './browser-workspace-context.ts';
import { lockBrowserWorkspace, unlockedBrowserWorkspaceCodec } from './browser-workspace-unlock.ts';

let pageLease: ReturnType<typeof browserWorkspaceDirectory.acquire> | null = null;
let watchesPageRestore = false;

/** The document owns its lease; provider retries never retarget a live workspace. */
export async function createNamedWorkspaceProvider(options: ConstructorParameters<typeof BrowserLocalDataProvider>[0] = {}): Promise<BrowserLocalDataProvider> {
  const id = currentBrowserWorkspaceId();
  if (!pageLease) pageLease = browserWorkspaceDirectory.acquire(id).catch(cause => { pageLease = null; throw cause; });
  const { workspace } = await pageLease;
  if (workspace.encryption) protectBrowserWorkspaceSession();
  const codec = workspace.encryption ? unlockedBrowserWorkspaceCodec(id, workspace.encryption) : options.codec;
  if (!watchesPageRestore) {
    watchesPageRestore = true;
    window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
    window.addEventListener('pagehide', lockBrowserWorkspace);
  }
  return new BrowserLocalDataProvider({
    ...options,
    ...(codec ? { codec } : {}),
    requireExistingCollections: Boolean(workspace.encryption),
    databaseName: browserWorkspaceDatabaseName(id),
    // Named workspaces have no legacy collection namespace. In particular,
    // initialisation cannot copy the default workspace's retained legacy data.
    storage: namedWorkspaceLegacyStorage,
  });
}
