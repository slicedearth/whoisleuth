import { DEFAULT_BROWSER_WORKSPACE_NAME, requireBrowserWorkspaceId } from './browser-workspace-context.ts';
import { readBrowserWorkspaceEncryption, type BrowserWorkspaceEncryption } from './browser-workspace-encryption-model.ts';
import { browserWorkspaceDatabaseName, deleteWorkspaceDatabase, prepareEncryptedBrowserWorkspace } from './browser-workspace-storage.ts';
export { browserWorkspaceDatabaseName } from './browser-workspace-storage.ts';

export const BROWSER_WORKSPACE_DIRECTORY = 'whoisleuth-workspace-directory-v1';
export const BROWSER_WORKSPACE_DIRECTORY_VERSION = 1;
export const BROWSER_WORKSPACE_DIRECTORY_STORE = 'workspaces';
// At most 1,000 small directory records are read in one operation. Evidence
// capacity belongs to each collection and the browser's shared origin quota.
export const MAX_BROWSER_WORKSPACES = 1_000;
export const MAX_BROWSER_WORKSPACE_NAME = 100;
const TIMEOUT_MS = 10_000;

export type BrowserWorkspace = Readonly<{
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  state: 'ready' | 'deleting';
  encryption?: BrowserWorkspaceEncryption;
}>;

export function browserWorkspaceName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_BROWSER_WORKSPACE_NAME || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`Enter a workspace name of 1–${MAX_BROWSER_WORKSPACE_NAME} characters without control characters.`);
  }
  return value.trim();
}

export function readBrowserWorkspace(value: unknown): BrowserWorkspace {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The workspace directory contains an unreadable record.');
  const row = value as Record<string, unknown>;
  const keys = ['id', 'name', 'createdAt', 'updatedAt', 'revision', 'state'];
  if (Object.hasOwn(row, 'encryption')) keys.push('encryption');
  if (Object.keys(row).length !== keys.length || keys.some(key => !Object.hasOwn(row, key))) throw new Error('The workspace directory record has an unsupported shape.');
  browserWorkspaceDatabaseName(requireBrowserWorkspaceId(row.id));
  if (browserWorkspaceName(row.name) !== row.name || !Number.isSafeInteger(row.revision) || Number(row.revision) < 1
    || row.state !== 'ready' && row.state !== 'deleting') throw new Error('The workspace directory contains invalid metadata.');
  for (const value of [row.createdAt, row.updatedAt]) {
    if (typeof value !== 'string' || value.length > 32 || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('The workspace directory contains an invalid date.');
  }
  if (String(row.updatedAt) < String(row.createdAt)) throw new Error('The workspace directory dates are inconsistent.');
  return Object.freeze({ ...row, ...(Object.hasOwn(row, 'encryption') ? { encryption: readBrowserWorkspaceEncryption(row.encryption) } : {}) }) as BrowserWorkspace;
}

type DirectoryOptions = Readonly<{ indexedDB?: IDBFactory; locks?: LockManager | null; now?: () => string; makeId?: () => string; timeoutMs?: number }>;

export function createBrowserWorkspaceDirectory(options: DirectoryOptions = {}) {
  const factory = () => options.indexedDB ?? globalThis.indexedDB;
  const locks = () => options.locks === undefined ? globalThis.navigator?.locks : options.locks;
  const timeout = options.timeoutMs ?? TIMEOUT_MS;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > TIMEOUT_MS) throw new TypeError('Invalid workspace operation timeout.');
  const now = options.now ?? (() => new Date().toISOString());

  async function database(): Promise<IDBDatabase> {
    if (!factory()) throw new Error('IndexedDB is unavailable; the workspace directory cannot be opened.');
    return new Promise((resolve, reject) => {
      const request = factory().open(BROWSER_WORKSPACE_DIRECTORY, BROWSER_WORKSPACE_DIRECTORY_VERSION);
      let settled = false;
      const timer = setTimeout(() => { settled = true; reject(new Error('The workspace directory did not open. Close older tabs and retry.')); }, timeout);
      request.onupgradeneeded = event => {
        if (settled || event.oldVersion !== 0) { request.transaction?.abort(); return; }
        request.result.createObjectStore(BROWSER_WORKSPACE_DIRECTORY_STORE, { keyPath: 'id' });
      };
      request.onerror = () => { clearTimeout(timer); settled = true; reject(new Error('The workspace directory is unavailable or has a newer version. No records were changed.')); };
      request.onsuccess = () => {
        clearTimeout(timer);
        if (settled) { request.result.close(); return; }
        settled = true;
        const db = request.result;
        if (db.version !== BROWSER_WORKSPACE_DIRECTORY_VERSION || db.objectStoreNames.length !== 1 || !db.objectStoreNames.contains(BROWSER_WORKSPACE_DIRECTORY_STORE)) {
          db.close(); reject(new Error('The workspace directory structure is unsupported.')); return;
        }
        db.onversionchange = () => db.close();
        resolve(db);
      };
    });
  }

  /** One transaction owns the bounded read and optional mutation. No async gap inside it. */
  async function transact<Result>(mode: IDBTransactionMode, apply: (rows: readonly BrowserWorkspace[], store: IDBObjectStore) => Result): Promise<Result> {
    const db = await database();
    try {
      return await new Promise<Result>((resolve, reject) => {
        const transaction = db.transaction(BROWSER_WORKSPACE_DIRECTORY_STORE, mode);
        const store = transaction.objectStore(BROWSER_WORKSPACE_DIRECTORY_STORE);
        if (store.keyPath !== 'id' || store.autoIncrement || store.indexNames.length !== 0) {
          transaction.abort(); reject(new Error('The workspace directory structure is unsupported.')); return;
        }
        let failure: Error | undefined;
        let result: Result;
        let prepared = false;
        let settled = false;
        let grace: ReturnType<typeof setTimeout> | undefined;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true; clearTimeout(timer); clearTimeout(grace);
          if (error) reject(error); else resolve(result!);
        };
        const timer = setTimeout(() => {
          failure = new Error('The workspace operation timed out.');
          try { transaction.abort(); } catch { /* Completion may already be queued. */ }
          grace = setTimeout(() => finish(new Error(mode === 'readonly'
            ? 'The workspace directory could not be read.'
            : 'The workspace change could not be confirmed. Refresh the directory before making another change.')), timeout);
        }, timeout);
        transaction.onabort = () => finish(failure ?? new Error('The workspace change was not saved. Browser storage may be full or unavailable.'));
        transaction.onerror = () => { failure ??= new Error('The workspace directory operation failed.'); };
        transaction.oncomplete = () => finish(prepared ? undefined : new Error('The workspace operation completed without a result.'));
        let request: IDBRequest<unknown[]>;
        try { request = store.getAll(undefined, MAX_BROWSER_WORKSPACES + 1); }
        catch {
          failure = new Error('The workspace directory could not be read.');
          try { transaction.abort(); } catch { finish(failure); }
          return;
        }
        request.onsuccess = () => {
          if (settled) return;
          try {
            if (request.result.length > MAX_BROWSER_WORKSPACES) throw new Error('The workspace directory exceeds its supported capacity.');
            const rows = request.result.map(readBrowserWorkspace);
            if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('The workspace directory contains duplicate identities.');
            result = apply(rows, store); prepared = true;
          } catch (cause) {
            failure = cause instanceof Error ? cause : new Error('The workspace directory could not be read.');
            transaction.abort();
          }
        };
      });
    } finally { db.close(); }
  }

  function requireLocks(): LockManager {
    const manager = locks();
    if (!manager) throw new Error('Named workspaces require browser Web Locks. The default workspace remains available.');
    return manager;
  }
  const lockName = (id: string) => `whoisleuth-workspace:${browserWorkspaceDatabaseName(id)}`;
  const list = () => transact('readonly', rows => rows);
  const ready = async (id: string) => {
    browserWorkspaceDatabaseName(id);
    const row = (await list()).find(row => row.id === id);
    if (!row || row.state !== 'ready') throw new Error('The selected workspace is missing or pending deletion. Choose another workspace explicitly.');
    return row;
  };
  function expectedRow(rows: readonly BrowserWorkspace[], expected: BrowserWorkspace): BrowserWorkspace {
    readBrowserWorkspace(expected);
    const current = rows.find(row => row.id === expected.id);
    if (!current || current.revision !== expected.revision || current.state !== expected.state) throw new Error('The workspace changed in another tab. Refresh its details before retrying.');
    return current;
  }

  async function create(name: string, protection?: Readonly<{ passphrase: string }>): Promise<BrowserWorkspace> {
    requireLocks();
    if (browserWorkspaceName(name).toLowerCase() === DEFAULT_BROWSER_WORKSPACE_NAME.toLowerCase()) throw new Error('Choose a name other than the default workspace name.');
    const timestamp = now();
    const id = (options.makeId ?? (() => crypto.randomUUID()))();
    const label = browserWorkspaceName(name);
    if (protection) {
      const rows = await list();
      if (rows.length >= MAX_BROWSER_WORKSPACES || rows.some(row => row.id === id || row.name.toLowerCase() === label.toLowerCase())) {
        throw new Error('The workspace directory is full, or that name or identity already exists.');
      }
    }
    const encryption = protection ? await (await import('./browser-workspace-encryption.ts')).createBrowserWorkspaceEncryption(id, protection.passphrase) : undefined;
    const candidate = readBrowserWorkspace({ id, name: label, createdAt: timestamp, updatedAt: timestamp, revision: 1, state: 'ready', ...(encryption ? { encryption } : {}) });
    const insert = () => transact('readwrite', (rows, store) => {
      if (rows.length >= MAX_BROWSER_WORKSPACES) throw new Error(`The directory already contains ${MAX_BROWSER_WORKSPACES} named workspaces.`);
      if (rows.some(row => row.id === candidate.id || row.name.toLowerCase() === candidate.name.toLowerCase())) throw new Error('A workspace already has that name or identity.');
      store.add(candidate); return candidate;
    });
    if (!encryption || !protection) return insert();
    return requireLocks().request(lockName(id), { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (!lock) throw new Error('That workspace identity is already in use. Refresh the directory before retrying.');
      await prepareEncryptedBrowserWorkspace(id, encryption, protection.passphrase, factory());
      try { return await insert(); }
      catch (cause) {
        // A late commit must be reconciled before removing this newly prepared
        // empty database. The exclusive lease prevents another tab opening it.
        let current: BrowserWorkspace | undefined;
        try { current = (await list()).find(row => row.id === id); }
        catch { throw new Error('Encrypted workspace preparation completed, but its directory entry could not be confirmed. Refresh the directory before creating another workspace.'); }
        if (current) {
          if (JSON.stringify(current) === JSON.stringify(candidate)) return current;
          throw new Error('The workspace identity changed during creation. No database was removed. Refresh the directory.');
        }
        try { await deleteWorkspaceDatabase(id, factory(), timeout); }
        catch { throw new Error('The workspace was not added to the directory, but its empty encrypted database is still pending cleanup. Close older tabs and reload before retrying.'); }
        throw cause;
      }
    });
  }

  async function rename(expected: BrowserWorkspace, name: string): Promise<BrowserWorkspace> {
    const label = browserWorkspaceName(name);
    if (label.toLowerCase() === DEFAULT_BROWSER_WORKSPACE_NAME.toLowerCase()) throw new Error('Choose a name other than the default workspace name.');
    return transact('readwrite', (rows, store) => {
      const current = expectedRow(rows, expected);
      if (current.state !== 'ready') throw new Error('A workspace pending deletion cannot be renamed.');
      if (rows.some(row => row.id !== current.id && row.name.toLowerCase() === label.toLowerCase())) throw new Error('A workspace already has that name.');
      const next = readBrowserWorkspace({ ...current, name: label, updatedAt: now(), revision: current.revision + 1 });
      store.put(next); return next;
    });
  }

  async function acquire(id: string, mode: 'shared' | 'exclusive' = 'shared'): Promise<Readonly<{ workspace: BrowserWorkspace; release: () => Promise<void> }>> {
    const manager = requireLocks();
    return new Promise((resolve, reject) => {
      let release!: () => void;
      const held = new Promise<void>(done => { release = done; });
      const request = manager.request(lockName(id), { mode, ifAvailable: true }, async lock => {
        if (!lock) throw new Error('The workspace is in use or being deleted. Close its other tabs or finish its recovery rehearsal before opening it.');
        const workspace = await ready(id);
        resolve({ workspace, release: async () => { release(); await request; } });
        await held;
      });
      void request.catch(reject);
    });
  }

  async function remove(expected: BrowserWorkspace, currentId: string): Promise<void> {
    if (expected.id === requireBrowserWorkspaceId(currentId)) throw new Error('Switch away from this workspace before deleting it.');
    await requireLocks().request(lockName(expected.id), { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (!lock) throw new Error('This workspace is open in another tab. Close its tabs before deleting it.');
      const deleting = await transact('readwrite', (rows, store) => {
        const current = expectedRow(rows, expected);
        if (current.state === 'deleting') return current;
        const next = readBrowserWorkspace({ ...current, state: 'deleting', updatedAt: now(), revision: current.revision + 1 });
        store.put(next); return next;
      });
      // IndexedDB deletion cannot be cancelled. Keep the directory tombstone
      // until success, including after a timeout or a late blocked completion.
      await deleteWorkspaceDatabase(deleting.id, factory(), timeout);
      try { await transact('readwrite', (rows, store) => { expectedRow(rows, deleting); store.delete(deleting.id); }); }
      catch { throw new Error('Workspace data was deleted, but its directory entry could not be removed. Refresh and retry deletion to finish cleanup.'); }
    });
  }

  return Object.freeze({ list, ready, create, rename, acquire, remove, supported: () => {
    try { return Boolean(factory() && locks()); } catch { return false; }
  } });
}

export const browserWorkspaceDirectory = createBrowserWorkspaceDirectory();
