import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { readBoundedRegularFileWithin } from '../lib/bounded-file.mts';
import { parseBoundedJsonObject } from '../packages/analysis/bounded-json.mts';
import { MAX_PACKAGE_GRAPH_BYTES, MAX_PACKAGE_PROCESSING_ITEMS, PACKAGE_PROCESS_TIMEOUT_MS } from './package-resource-bounds.mts';
import { CI_CLI_RUNTIME_NODE_MAJOR } from './ci-verification.mts';

const execFile = promisify(execFileCallback);

export function packageRuntimeDeadline(checkCount: number): number {
  if (!Number.isSafeInteger(checkCount) || checkCount < 1 || checkCount > MAX_PACKAGE_PROCESSING_ITEMS) {
    throw new Error('Package runtime checks exceed their processing bound.');
  }
  // Each existing operation keeps its own deadline. The parent guard must not
  // squeeze a growing sequence into one operation's timeout.
  return PACKAGE_PROCESS_TIMEOUT_MS * (checkCount + 1);
}

/** Each runtime installs independently. Only the already assembled archive is shared. */
export async function withPackageInstallation<T>(
  check: (context: Readonly<{
    temporary: string; installed: string; home: string; environment: NodeJS.ProcessEnv;
    run: (command: string, args: string[], cwd: string) => Promise<{ stdout: string; stderr: string }>;
  }>) => Promise<T>,
): Promise<T> {
  const temporary = await mkdtemp(path.join(tmpdir(), 'whoisleuth-installed-package-'));
  const installed = path.join(temporary, 'installed'), home = path.join(temporary, 'home');
  const environment: NodeJS.ProcessEnv = {
    ...process.env, HOME: home, USERPROFILE: home,
    npm_config_registry: 'https://registry.npmjs.org', npm_config_cache: path.join(temporary, 'cache'),
    npm_config_userconfig: path.join(home, 'npmrc'), npm_config_globalconfig: path.join(home, 'global-npmrc'),
    npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false',
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
  };
  for (const name of ['NODE_OPTIONS', 'NODE_PATH', 'NPM_TOKEN', 'NODE_AUTH_TOKEN', 'SITE_PASSWORD', 'SESSION_SECRET']) delete environment[name];
  const run = (command: string, args: string[], cwd: string) => execFile(command, args, {
    cwd, env: environment, encoding: 'utf8', timeout: PACKAGE_PROCESS_TIMEOUT_MS,
    maxBuffer: MAX_PACKAGE_GRAPH_BYTES, killSignal: 'SIGTERM' as const,
  });
  try {
    await Promise.all([installed, home].map(directory => mkdir(directory)));
    await Promise.all(['npmrc', 'global-npmrc'].map(name => writeFile(path.join(home, name), '', { flag: 'wx', mode: 0o600 })));
    return await check({ temporary, installed, home, environment, run });
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

async function archiveDigest(archive: string, maximumBytes: number): Promise<string> {
  const bytes = await readBoundedRegularFileWithin(path.dirname(archive), path.basename(archive), {
    maximumBytes, minimumBytes: 1, label: 'Runtime-check archive',
  });
  return createHash('sha256').update(bytes).digest('hex');
}

/** Private, short-lived process handoff, not a cached verification result. */
export async function readPackageRuntimeRequest<T>(filename: string, maximumArchiveBytes: number) {
  const request = parseBoundedJsonObject((await readBoundedRegularFileWithin(path.dirname(filename), path.basename(filename), {
    maximumBytes: MAX_PACKAGE_GRAPH_BYTES, minimumBytes: 1, label: 'Runtime-check request',
  })).toString('utf8'), { label: 'Runtime-check request', maximumBytes: MAX_PACKAGE_GRAPH_BYTES });
  if (request.version !== 1 || typeof request.archive !== 'string' || !/^[A-Za-z0-9._-]+\.tgz$/u.test(request.archive)
    || typeof request.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(request.sha256)
    || !request.input || typeof request.input !== 'object' || Array.isArray(request.input)) throw new Error('Invalid package runtime request.');
  const archive = path.join(path.dirname(filename), request.archive);
  if (await archiveDigest(archive, maximumArchiveBytes) !== request.sha256) throw new Error('Package archive changed before runtime verification.');
  return { archive, input: request.input as T };
}

export async function verifyPackageRuntimes<Input extends object, Result extends { installedChecks: readonly string[] }>(
  tool: string, archive: string, maximumArchiveBytes: number, input: Input,
  verify: (archive: string, input: Input) => Promise<Result>,
): Promise<Result> {
  const digest = await archiveDigest(archive, maximumArchiveBytes);
  const primary = await verify(archive, input);
  if (await archiveDigest(archive, maximumArchiveBytes) !== digest) throw new Error('Package archive changed during primary verification.');
  const secondary = process.env.WHOISLEUTH_CLI_RUNTIME_NODE;
  if (!secondary) return primary;
  if (!path.isAbsolute(secondary)) throw new Error('Package compatibility runtime must be an absolute executable path.');
  const environment: NodeJS.ProcessEnv = { ...process.env, PATH: `${path.dirname(secondary)}${path.delimiter}${process.env.PATH ?? ''}` };
  for (const name of ['NODE_OPTIONS', 'NODE_PATH', 'NPM_TOKEN', 'NODE_AUTH_TOKEN', 'SITE_PASSWORD', 'SESSION_SECRET', 'WHOISLEUTH_CLI_RUNTIME_NODE']) delete environment[name];
  const run = (args: string[], timeout = PACKAGE_PROCESS_TIMEOUT_MS) => execFile(secondary, args, { env: environment, encoding: 'utf8',
    timeout, maxBuffer: MAX_PACKAGE_GRAPH_BYTES, killSignal: 'SIGTERM' as const });
  const runtime = (await run(['--version'])).stdout.trim();
  if (Number(/^v(\d+)\.\d+\.\d+$/u.exec(runtime)?.[1]) !== CI_CLI_RUNTIME_NODE_MAJOR) {
    throw new Error(`Package compatibility verification requires Node.js ${CI_CLI_RUNTIME_NODE_MAJOR}.`);
  }
  const requestPath = path.join(path.dirname(archive), 'runtime-check.json');
  const text = JSON.stringify({ version: 1, archive: path.basename(archive), sha256: digest, input });
  if (Buffer.byteLength(text) > MAX_PACKAGE_GRAPH_BYTES) throw new Error('Package runtime request exceeds its bound.');
  let created = false;
  try {
    await writeFile(requestPath, text, { flag: 'wx', mode: 0o600 });
    created = true;
    const result = await run([tool, '--installed-check', requestPath], packageRuntimeDeadline(primary.installedChecks.length));
    assert.equal(result.stderr, '', 'Secondary package checks emitted unexpected diagnostics.');
    const checked = parseBoundedJsonObject(result.stdout, { label: 'Runtime-check result', maximumBytes: MAX_PACKAGE_GRAPH_BYTES });
    assert.deepEqual(checked.installedChecks, primary.installedChecks, 'Both runtimes must execute the same installed checks.');
    if (await archiveDigest(archive, maximumArchiveBytes) !== digest) throw new Error('Package archive changed during compatibility verification.');
    process.stderr.write(`Package runtime verification: ${process.version} and ${runtime}; ${primary.installedChecks.length} checks each; archive SHA-256 ${digest}.\n`);
  } finally { if (created) await rm(requestPath, { force: true }); }
  return primary;
}
