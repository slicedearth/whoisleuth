import { existsSync, mkdirSync, writeFileSync, writeSync } from 'node:fs';
import path from 'node:path';
import { isMainThread } from 'node:worker_threads';
import { readBoundedRegularTextFile } from '../lib/bounded-file.mts';
import { playwrightRunArtifacts } from './playwright-run-artifacts.mts';

function reportPath(root: string): string {
  return path.join(root, playwrightRunArtifacts().testResults, 'server-egress.txt');
}

function diagnostic(message: string): void {
  // Worker streams are forwarded asynchronously. Write the small diagnostic
  // before terminating, but never let a broken output pipe bypass denial.
  try { writeSync(2, message); } catch { /* The owned process must still stop. */ }
}

export function recordUnexpectedBrowserServerEgress(operation: string): never {
  // Record only the transport operation, never its target, URL or arguments.
  const report = reportPath(process.cwd());
  diagnostic(`Unexpected collector request in the fixture browser server: ${operation}.\n`);
  try {
    mkdirSync(path.dirname(report), { recursive: true, mode: 0o700 });
    // One violation is sufficient to reject the run. Replacing the marker
    // keeps concurrent worker failures from accumulating an unbounded log.
    writeFileSync(report, `${operation}\n`, { mode: 0o600 });
  } catch {
    diagnostic('The server egress diagnostic could not be retained.\n');
    // A caught worker failure must not hide an unrecorded violation. Terminate
    // this owned server process, never a parent or another process group.
    if (!isMainThread) process.kill(process.pid, 'SIGTERM');
  }
  process.exit(86);
}

export default async function assertNoBrowserServerEgress(configuration: { configFile?: string; webServer?: { cwd?: string } | null } = {}): Promise<void> {
  const root = configuration.webServer?.cwd ?? (configuration.configFile ? path.dirname(path.resolve(configuration.configFile))
    : process.cwd());
  const report = reportPath(root);
  if (!existsSync(report)) return;
  const operations = await readBoundedRegularTextFile(report, {
    maximumBytes: 4 * 1024, minimumBytes: 1, label: 'browser server egress violations',
  });
  throw new Error(`Unexpected collector request in the fixture browser server: ${operations.trim()}`);
}
