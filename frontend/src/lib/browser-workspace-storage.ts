import { DEFAULT_BROWSER_WORKSPACE, requireBrowserWorkspaceId } from './browser-workspace-context.ts';
import type { BrowserWorkspaceEncryption } from './browser-workspace-encryption-model.ts';

export function browserWorkspaceDatabaseName(id: string): string {
  if (requireBrowserWorkspaceId(id) === DEFAULT_BROWSER_WORKSPACE) throw new Error('The default workspace keeps its existing database.');
  return `whoisleuth-workspace-${id}-v1`;
}

export const namedWorkspaceLegacyStorage = Object.freeze({
  getItem: () => null,
  setItem: () => { throw new Error('Named workspaces use portable backups, not default legacy copies.'); },
  removeItem: () => { throw new Error('Named workspaces have no legacy copies to remove.'); },
});

export async function deleteWorkspaceDatabase(id: string, factory: IDBFactory, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try { request = factory.deleteDatabase(browserWorkspaceDatabaseName(id)); }
    catch { reject(new Error('The workspace remains pending deletion. Refresh its status before retrying.')); return; }
    const timer = setTimeout(() => reject(new Error('Deletion is pending. Close older tabs, refresh the directory and retry deletion.')), timeoutMs);
    request.onsuccess = () => { clearTimeout(timer); resolve(); };
    request.onerror = () => { clearTimeout(timer); reject(new Error('The workspace remains pending deletion. Refresh its status before retrying.')); };
  });
}

/** Create every encrypted collection before exposing its directory entry. */
export async function prepareEncryptedBrowserWorkspace(id: string, encryption: BrowserWorkspaceEncryption, passphrase: string, indexedDB?: IDBFactory): Promise<void> {
  const { unlockBrowserWorkspaceEncryption } = await import('./browser-workspace-encryption.ts');
  const { BROWSER_LOCAL_COLLECTIONS } = await import('./browser-local-data-definitions.ts');
  const { BrowserLocalDataProvider } = await import('./browser-local-data.ts');
  const unlocked = await unlockBrowserWorkspaceEncryption(id, encryption, passphrase);
  const provider = new BrowserLocalDataProvider({ databaseName: browserWorkspaceDatabaseName(id), storage: namedWorkspaceLegacyStorage, codec: unlocked.codec, ...(indexedDB ? { indexedDB } : {}) });
  try {
    try { await provider.initialize(BROWSER_LOCAL_COLLECTIONS); }
    catch (cause) {
      // No directory entry or user records exist yet. Never remove a database
      // that predates this provider, including a conflicting or future version.
      if (provider.createdDatabase) {
        await provider.close();
        try { await deleteWorkspaceDatabase(id, indexedDB ?? globalThis.indexedDB, provider.timeoutMs); }
        catch { throw new Error('Encrypted workspace preparation failed and its new empty database is still pending cleanup. Close older tabs and reload before retrying.'); }
      }
      throw cause;
    }
  }
  finally { try { await provider.close(); } finally { unlocked.lock(); } }
}
