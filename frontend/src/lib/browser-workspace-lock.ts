import { DEFAULT_BROWSER_WORKSPACE, requireBrowserWorkspaceId, scopedWorkspaceStorage } from './browser-workspace-context.ts';

export const WORKSPACE_IDLE_MINUTES = Object.freeze([0, 5, 15, 30, 60] as const);
const KEY = 'idle-lock-minutes-v1';
type StorageAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function workspaceIdleMinutes(value: unknown): number {
  if (typeof value !== 'number' || !WORKSPACE_IDLE_MINUTES.some(minutes => minutes === value)) throw new Error('Choose one of the supported idle-lock intervals.');
  return value;
}
function storageFor(id: string, storage: StorageAccess) {
  if (requireBrowserWorkspaceId(id) === DEFAULT_BROWSER_WORKSPACE) throw new Error('Idle locking requires a named encrypted workspace.');
  return scopedWorkspaceStorage(storage, id);
}
export function readWorkspaceIdleMinutes(id: string, storage: StorageAccess = sessionStorage): number {
  const value = storageFor(id, storage).getItem(KEY);
  if (value === null) return 0;
  if (!/^(?:0|5|15|30|60)$/u.test(value)) throw new Error('The saved idle-lock choice is unreadable. Choose an interval explicitly.');
  return workspaceIdleMinutes(Number(value));
}
export function saveWorkspaceIdleMinutes(id: string, value: number, storage: StorageAccess = sessionStorage): void {
  const minutes = workspaceIdleMinutes(value), selected = storageFor(id, storage);
  if (minutes) selected.setItem(KEY, String(minutes)); else selected.removeItem(KEY);
}

/** Elapsed inactivity is a user-selected lock policy, not a device-performance budget. */
export function createWorkspaceIdleTimer(minutes: number, options: Readonly<{
  now: () => number;
  schedule: (callback: () => void, delay: number) => () => void;
  expire: () => void;
}>) {
  const duration = workspaceIdleMinutes(minutes) * 60_000;
  let last = options.now(), expired = false, disposed = false, cancel: (() => void) | undefined;
  function check() {
    cancel?.(); cancel = undefined;
    if (disposed || expired || !duration) return;
    const elapsed = options.now() - last;
    // Clock rollback cannot extend an unlocked session indefinitely.
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= duration) { expired = true; options.expire(); }
    else cancel = options.schedule(check, duration - elapsed);
  }
  function activity() {
    if (disposed || !duration) return;
    last = options.now();
    // After cancelled navigation, deliberate activity starts a fresh interval.
    if (expired) { expired = false; check(); }
  }
  check();
  return Object.freeze({ activity, check, dispose: () => { disposed = true; cancel?.(); cancel = undefined; } });
}
