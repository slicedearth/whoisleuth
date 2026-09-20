import { spawn } from 'node:child_process';
import { forceStopOwnedTree, waitForOwnedTreeExit, PROCESS_SHUTDOWN_TIMEOUT_MS } from './owned-process.mts';

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
        timer = setTimeout(forceStop, options.shutdownTimeoutMs ?? PROCESS_SHUTDOWN_TIMEOUT_MS);
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
