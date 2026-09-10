import { BrowserLocalDataProvider } from './browser-local-data.ts';
import { browserWorkspaceDatabaseName, browserWorkspaceDirectory } from './browser-workspace-directory.ts';
import { currentBrowserWorkspaceId } from './browser-workspace-context.ts';

let pageLease: ReturnType<typeof browserWorkspaceDirectory.acquire> | null = null;
let watchesPageRestore = false;

/** The document owns its lease; provider retries never retarget a live workspace. */
export async function createNamedWorkspaceProvider(options: ConstructorParameters<typeof BrowserLocalDataProvider>[0]): Promise<BrowserLocalDataProvider> {
  const id = currentBrowserWorkspaceId();
  if (!pageLease) pageLease = browserWorkspaceDirectory.acquire(id).catch(cause => { pageLease = null; throw cause; });
  await pageLease;
  if (!watchesPageRestore) {
    watchesPageRestore = true;
    window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
  }
  return new BrowserLocalDataProvider({
    ...options,
    databaseName: browserWorkspaceDatabaseName(id),
    // Named workspaces have no legacy collection namespace. In particular,
    // initialisation cannot copy the default workspace's retained legacy data.
    storage: {
      getItem: () => null,
      setItem: () => { throw new Error('Named workspaces use portable backups, not default legacy copies.'); },
      removeItem: () => { throw new Error('Named workspaces have no legacy copies to remove.'); },
    },
  });
}
