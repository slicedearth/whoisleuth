export const DEFAULT_BROWSER_WORKSPACE = 'default';
export const DEFAULT_BROWSER_WORKSPACE_NAME = 'Default';
export const BROWSER_WORKSPACE_SELECTION_KEY = 'whoisleuth:workspace-selection:v1';
export const BROWSER_WORKSPACE_DIRECTORY_EVENT = 'whoisleuth:workspace-directory-change';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function requireBrowserWorkspaceId(value: unknown): string {
  if (value === DEFAULT_BROWSER_WORKSPACE || typeof value === 'string' && UUID.test(value)) return value;
  throw new Error('The selected workspace identity is invalid. Choose a workspace explicitly; no saved data was changed.');
}

/** A page keeps its selection even while navigation to another workspace starts. */
export function captureBrowserWorkspace(read: () => string | null): () => string {
  let captured: { id: string } | { error: Error } | undefined;
  return () => {
    if (!captured) {
      try { captured = { id: requireBrowserWorkspaceId(read() ?? DEFAULT_BROWSER_WORKSPACE) }; }
      catch { captured = { error: new Error('The workspace selection could not be read. Choose a workspace explicitly; no saved data was changed.') }; }
    }
    if ('error' in captured) throw captured.error;
    return captured.id;
  };
}

const pageWorkspace = captureBrowserWorkspace(() => sessionStorage.getItem(BROWSER_WORKSPACE_SELECTION_KEY));
export function currentBrowserWorkspaceId(): string {
  return typeof window === 'undefined' ? DEFAULT_BROWSER_WORKSPACE : pageWorkspace();
}

export function scopedWorkspaceStorage(storage: StorageAccess, workspaceId: string): StorageAccess {
  const id = requireBrowserWorkspaceId(workspaceId);
  const key = (name: string) => id === DEFAULT_BROWSER_WORKSPACE ? name : `whoisleuth:workspace:${id}:${name}`;
  return {
    getItem: name => storage.getItem(key(name)),
    setItem: (name, value) => storage.setItem(key(name), value),
    removeItem: name => storage.removeItem(key(name)),
  };
}

export function workspaceSessionStorage(): StorageAccess {
  return scopedWorkspaceStorage(sessionStorage, currentBrowserWorkspaceId());
}

/** The public default preference stays in localStorage; named preferences are tab-local. */
export function workspacePreferenceStorage(): StorageAccess {
  return currentBrowserWorkspaceId() === DEFAULT_BROWSER_WORKSPACE ? localStorage : workspaceSessionStorage();
}

export function navigateToBrowserWorkspace(id: string): void {
  sessionStorage.setItem(BROWSER_WORKSPACE_SELECTION_KEY, requireBrowserWorkspaceId(id));
  window.location.assign('/dashboard');
}
