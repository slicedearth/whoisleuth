import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const SHUTDOWN_TIMEOUT_MS = 10_000;

function forceStopOwnedTree(child: ChildProcess): readonly number[] {
  const pid = child.pid;
  if (!pid || child.exitCode !== null || child.signalCode !== null) return [];
  if (process.platform === 'win32') {
    // Windows signals do not provide the runner's graceful POSIX shutdown.
    const result = spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
      shell: false, windowsHide: true, timeout: 5_000, maxBuffer: 64 * 1024,
    });
    if (result.error || result.status !== 0) throw new Error('Could not terminate the owned browser process tree.');
    return [];
  }

  // The browser and preview server can create their own process groups. A
  // group signal alone would miss them. Enumerate only PID/parent identities,
  // then terminate this live child's descendants, leaves first.
  const result = spawnSync('ps', ['-A', '-o', 'pid=,ppid='], {
    encoding: 'utf8', timeout: 5_000, maxBuffer: 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error('Could not enumerate the owned browser process tree.');
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
    try {
      process.kill(target, 'SIGKILL');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
  return [...owned];
}

async function waitForOwnedTreeExit(owned: readonly number[]): Promise<void> {
  // Sending a signal is not the same as observing termination. In particular,
  // the wrapper's close event can arrive before an independently grouped
  // preview process has released its listener. Never signal these PIDs again.
  const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
  while (owned.some((pid) => {
    try { process.kill(pid, 0); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
      throw error;
    }
  })) {
    if (Date.now() >= deadline) throw new Error('The owned browser process tree did not finish terminating.');
    await delay(25);
  }
}

/** Await the runner's shutdown before callers check ports or remove artefacts. */
export function runPlaywrightProcess(
  args: readonly string[],
  options: Readonly<{
    cwd: string;
    env: NodeJS.ProcessEnv;
    signal: AbortSignal;
    shutdownTimeoutMs?: number;
  }>,
): Promise<number> {
  if (options.signal.aborted) return Promise.resolve(130);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: 'inherit',
      // Keep a terminal interrupt from reaching both a wrapper and its runner.
      detached: process.platform !== 'win32',
    });
    let timer: NodeJS.Timeout | undefined;
    let shutdownFailure: unknown;
    let stoppedProcesses: readonly number[] = [];
    const forceStop = () => {
      try {
        stoppedProcesses = forceStopOwnedTree(child);
      } catch (error) {
        shutdownFailure = error;
        child.kill('SIGKILL');
      }
    };
    const interrupt = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      if (process.platform === 'win32') {
        forceStop();
      } else {
        // Playwright owns teardown of its browsers, workers and preview server
        // on SIGINT. SIGTERM on the wrapper is intentionally translated too.
        child.kill('SIGINT');
        timer = setTimeout(forceStop, options.shutdownTimeoutMs ?? SHUTDOWN_TIMEOUT_MS);
        timer.unref();
      }
    };
    options.signal.addEventListener('abort', interrupt, { once: true });
    const finish = () => {
      clearTimeout(timer);
      options.signal.removeEventListener('abort', interrupt);
    };
    child.once('error', (error) => {
      finish();
      reject(error);
    });
    child.once('close', async (code) => {
      finish();
      try {
        await waitForOwnedTreeExit(stoppedProcesses);
        if (shutdownFailure) reject(shutdownFailure);
        else resolve(options.signal.aborted ? 130 : code ?? 2);
      } catch (error) { reject(shutdownFailure ?? error); }
    });
  });
}
