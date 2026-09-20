import { spawnSync, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export const PROCESS_SHUTDOWN_TIMEOUT_MS = 10_000;

/** Stop only a live child's descendants, including independently grouped workers. */
export function forceStopOwnedTree(child: ChildProcess): readonly number[] {
  const pid = child.pid;
  if (!pid || child.exitCode !== null || child.signalCode !== null) return [];
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
      shell: false, windowsHide: true, timeout: 5_000, maxBuffer: 64 * 1024,
    });
    if (result.error || result.status !== 0) throw new Error('Could not terminate the owned process tree.');
    return [];
  }

  // A descendant can create its own process group. Group signals alone miss
  // that case; inspect PID/parent identities only and terminate leaves first.
  const result = spawnSync('ps', ['-A', '-o', 'pid=,ppid='], {
    encoding: 'utf8', timeout: 5_000, maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error('Could not enumerate the owned process tree.');
  const children = new Map<number, number[]>();
  for (const line of result.stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/u.exec(line);
    if (!match) continue;
    const descendant = Number(match[1]);
    const parent = Number(match[2]);
    if (descendant <= 1) continue;
    const siblings = children.get(parent) ?? [];
    siblings.push(descendant);
    children.set(parent, siblings);
  }
  const owned = new Set([pid]);
  for (const parent of owned) for (const descendant of children.get(parent) ?? []) owned.add(descendant);
  for (const target of [...owned].reverse()) {
    try { process.kill(target, 'SIGKILL'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
  return [...owned];
}

/** Observe termination before releasing ports or removing owned artefacts. */
export async function waitForOwnedTreeExit(owned: readonly number[]): Promise<void> {
  // Only observe these identities after signalling; a reused PID must never
  // receive a second signal from this shutdown operation.
  const deadline = Date.now() + PROCESS_SHUTDOWN_TIMEOUT_MS;
  while (owned.some((pid) => {
    try { process.kill(pid, 0); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
      throw error;
    }
  })) {
    if (Date.now() >= deadline) throw new Error('The owned process tree did not finish terminating.');
    await delay(25);
  }
}
