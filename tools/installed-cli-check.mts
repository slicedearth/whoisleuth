import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { packageProcessEnvironment } from './package-source.mts';

const execFile = promisify(execFileCallback);
export const CLI_PACKAGE_INSTALLED_CHECK_TIMEOUT_MS = 15_000;
export type RunInstalledCli = (args: readonly string[], label: string, expectedExitCode?: number, expectedDiagnostics?: RegExp) => Promise<string>;

/** A report contains only invocations that actually met their process contract. */
export function createInstalledCliRunner(executable: string) {
  const completed: string[] = [];
  const run: RunInstalledCli = async (args, label, expectedExitCode = 0, expectedDiagnostics) => {
    let output: { stdout: string; stderr: string };
    let exitCode = 0;
    try {
      output = await execFile(process.execPath, [executable, ...args], {
        encoding: 'utf8', timeout: CLI_PACKAGE_INSTALLED_CHECK_TIMEOUT_MS,
        killSignal: 'SIGTERM', maxBuffer: 2 * 1024 * 1024,
        env: packageProcessEnvironment({ FORCE_COLOR: '0', NO_COLOR: '1' }),
      });
    } catch (cause) {
      const error = cause as { code?: unknown; stdout?: unknown; stderr?: unknown; killed?: unknown };
      if (error.code !== expectedExitCode || error.killed || typeof error.stdout !== 'string' || typeof error.stderr !== 'string') throw cause;
      exitCode = Number(error.code);
      output = { stdout: error.stdout, stderr: error.stderr };
    }
    if (exitCode !== expectedExitCode) throw new TypeError(`Installed CLI ${label} returned an unexpected exit code.`);
    if (expectedDiagnostics ? !expectedDiagnostics.test(output.stderr) : output.stderr) throw new TypeError(`Installed CLI ${label} wrote unexpected diagnostics.`);
    completed.push(label);
    return output.stdout;
  };
  return { run, completed: () => Object.freeze([...completed]) };
}
