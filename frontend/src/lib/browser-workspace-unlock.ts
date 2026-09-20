import { BrowserLocalDataError, type BrowserLocalDataCodec } from './browser-local-data.ts';
import { clearProtectedBrowserWorkspaceSession, currentBrowserWorkspaceId } from './browser-workspace-context.ts';
import { workspaceEncryptionIdentity, type BrowserWorkspaceEncryption } from './browser-workspace-encryption-model.ts';

// Keys belong to this document, never to browser storage or a worker message.
let unlocked: { id: string; identity: string; codec: BrowserLocalDataCodec; lock: () => void } | null = null;

export function lockBrowserWorkspace(): void {
  unlocked?.lock();
  unlocked = null;
  clearProtectedBrowserWorkspaceSession();
}

export function hasUnlockedBrowserWorkspace(): boolean { return unlocked !== null; }

export function unlockedBrowserWorkspaceCodec(id: string, metadata: BrowserWorkspaceEncryption): BrowserLocalDataCodec {
  if (!unlocked || unlocked.id !== id || unlocked.identity !== workspaceEncryptionIdentity(metadata)) {
    throw new BrowserLocalDataError('LOCAL_DATA_WORKSPACE_LOCKED', 'This workspace is encrypted. Unlock it in this tab to continue.');
  }
  return unlocked.codec;
}

export async function unlockCurrentBrowserWorkspace(passphrase: string, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('Workspace unlock was cancelled.', 'AbortError');
  const id = currentBrowserWorkspaceId();
  const { browserWorkspaceDirectory } = await import('./browser-workspace-directory.ts');
  const workspace = await browserWorkspaceDirectory.ready(id);
  if (!workspace.encryption) throw new Error('The selected workspace is not encrypted. Reload its details.');
  const identity = workspaceEncryptionIdentity(workspace.encryption);
  const { unlockBrowserWorkspaceEncryption } = await import('./browser-workspace-encryption.ts');
  const result = await unlockBrowserWorkspaceEncryption(id, workspace.encryption, passphrase);
  try {
    const current = await browserWorkspaceDirectory.ready(id);
    if (signal?.aborted) throw new DOMException('Workspace unlock was cancelled.', 'AbortError');
    if (currentBrowserWorkspaceId() !== id || !current.encryption || workspaceEncryptionIdentity(current.encryption) !== identity) {
      throw new Error('The selected workspace changed while unlocking. Reload before retrying.');
    }
    lockBrowserWorkspace();
    unlocked = { id, identity, ...result };
  } catch (cause) { result.lock(); throw cause; }
}
