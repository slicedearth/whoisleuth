import { BrowserLocalDataProvider } from './browser-local-data.ts';
import { browserWorkspaceDirectory, type BrowserWorkspace } from './browser-workspace-directory.ts';
import { browserWorkspaceDatabaseName, namedWorkspaceLegacyStorage } from './browser-workspace-storage.ts';

export class WorkspaceDestinationStartError extends Error {
  readonly workspace: BrowserWorkspace;
  constructor(workspace: BrowserWorkspace) {
    super('The new workspace was created but could not be opened. The active workspace was not changed. Inspect the new workspace through Browser workspaces before starting again.');
    this.workspace = workspace;
  }
}

/** A fresh destination owns one exclusive lease and, when used, one new key. */
export async function openBrowserWorkspaceDestination(options: Readonly<{ name: string; passphrase?: string }>) {
  const workspace = await browserWorkspaceDirectory.create(options.name, options.passphrase ? { passphrase: options.passphrase } : undefined);
  let lease: Awaited<ReturnType<typeof browserWorkspaceDirectory.acquire>> | undefined;
  let protection: Awaited<ReturnType<typeof import('./browser-workspace-encryption.ts')['unlockBrowserWorkspaceEncryption']>> | undefined;
  let provider: BrowserLocalDataProvider;
  try {
    lease = await browserWorkspaceDirectory.acquire(workspace.id, 'exclusive');
    if (JSON.stringify(lease.workspace) !== JSON.stringify(workspace)) throw new Error('The destination changed before it could be opened.');
    if (workspace.encryption) protection = await (await import('./browser-workspace-encryption.ts')).unlockBrowserWorkspaceEncryption(workspace.id, workspace.encryption, options.passphrase!);
    provider = new BrowserLocalDataProvider({ databaseName: browserWorkspaceDatabaseName(workspace.id), storage: namedWorkspaceLegacyStorage,
      ...(protection ? { codec: protection.codec, requireExistingCollections: true } : {}) });
  } catch {
    protection?.lock(); await lease?.release();
    throw new WorkspaceDestinationStartError(workspace);
  } finally { options = { name: options.name }; }
  let closed: Promise<void> | null = null;
  return Object.freeze({
    workspace, provider,
    async assertCurrent() {
      if (closed || JSON.stringify(await browserWorkspaceDirectory.ready(workspace.id)) !== JSON.stringify(workspace)) {
        throw new Error('The destination workspace changed or was closed. Inspect it before another operation.');
      }
    },
    close(): Promise<void> {
      return closed ??= (async () => {
        try { await provider.close(); } finally { protection?.lock(); await lease?.release(); }
      })();
    },
  });
}
