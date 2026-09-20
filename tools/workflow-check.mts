#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { readBoundedStableRegularFileSync } from './maintainer-tool-helpers.mts';

export const ACTIONLINT_VERSION = '1.7.12';
export const MAX_ACTIONLINT_ARCHIVE_BYTES = 8 * 1024 * 1024;
const MAX_BINARY_BYTES = 32 * 1024 * 1024;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASES = Object.freeze({
  'darwin-x64': ['darwin_amd64.tar.gz', '5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644'],
  'darwin-arm64': ['darwin_arm64.tar.gz', 'aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f'],
  'linux-x64': ['linux_amd64.tar.gz', '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8'],
  'linux-arm64': ['linux_arm64.tar.gz', '325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6'],
  'win32-x64': ['windows_amd64.zip', '6e7241b51e6817ea6a047693d8e6fed13b31819c9a0dd6c5a726e1592d22f6e9'],
  'win32-arm64': ['windows_arm64.zip', 'cadcf7ea4efe3a68728893813643cebe1185e5b1d4be5b96245f65c9a4d5ea41'],
} as const);

export type ActionlintRelease = Readonly<{ url: string; sha256: string; executable: string; zip: boolean }>;
type Execute = (file: string, args: readonly string[], options: SpawnSyncOptions) => Pick<SpawnSyncReturns<string | Buffer>, 'status' | 'stdout' | 'stderr' | 'error'>;
const execute: Execute = (file, args, options) => spawnSync(file, args, options);

export function actionlintRelease(platform: string = process.platform, architecture: string = process.arch): ActionlintRelease {
  const key = `${platform}-${architecture}`;
  if (!Object.hasOwn(RELEASES, key)) throw new Error(`No pinned actionlint release for ${key}.`);
  const [archive, sha256] = RELEASES[key as keyof typeof RELEASES];
  return Object.freeze({
    url: `https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_${archive}`,
    sha256, executable: platform === 'win32' ? 'actionlint.exe' : 'actionlint', zip: platform === 'win32',
  });
}

export function verifyActionlintArchive(bytes: Uint8Array, release: ActionlintRelease): void {
  if (!bytes.byteLength || bytes.byteLength > MAX_ACTIONLINT_ARCHIVE_BYTES
    || createHash('sha256').update(bytes).digest('hex') !== release.sha256) {
    throw new Error('The actionlint archive does not match its pinned digest and byte bounds.');
  }
}

export async function readActionlintDownload(response: Response): Promise<Buffer> {
  if (!response.ok || !response.body) throw new Error(`The actionlint download failed (${response.status}).`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > MAX_ACTIONLINT_ARCHIVE_BYTES) throw new Error('The actionlint download exceeds its byte bound.');
      chunks.push(result.value);
    }
    return Buffer.concat(chunks, bytes);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export function installActionlintArchive(bytes: Buffer, release: ActionlintRelease, directory: string, run: Execute = execute): string {
  verifyActionlintArchive(bytes, release);
  const archive = path.join(directory, release.zip ? 'release.zip' : 'release.tar.gz');
  writeFileSync(archive, bytes, { flag: 'wx', mode: 0o600 });
  let binary: Uint8Array;
  if (release.zip) {
    binary = unzipSync(bytes, { filter: entry => entry.name === release.executable && entry.originalSize <= MAX_BINARY_BYTES })[release.executable] ?? new Uint8Array();
  } else {
    const result = run('tar', ['-xOf', archive, release.executable], {
      timeout: 15_000, maxBuffer: MAX_BINARY_BYTES,
    });
    if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) throw new Error('Could not extract the verified actionlint executable.');
    binary = result.stdout;
  }
  if (!binary.byteLength || binary.byteLength > MAX_BINARY_BYTES) throw new Error('The actionlint executable is missing or exceeds its byte bound.');
  const executable = path.join(directory, release.executable);
  writeFileSync(executable, binary, { flag: 'wx', mode: 0o700 });
  chmodSync(executable, 0o700);
  return executable;
}

export function runActionlint(executable: string, root = ROOT, run: Execute = execute): void {
  // Optional host-installed linters must not change the verification scope.
  const result = run(executable, ['-color', '-shellcheck=', '-pyflakes='], {
    cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw new Error('Could not run the pinned workflow validator.', { cause: result.error });
  if (result.status !== 0) throw new Error(`Workflow validation failed.\n${result.stdout}${result.stderr}`);
}

export async function main(): Promise<void> {
  const release = actionlintRelease();
  const source = process.env.WHOISLEUTH_ACTIONLINT_ARCHIVE;
  const bytes = source
    ? readBoundedStableRegularFileSync(source, MAX_ACTIONLINT_ARCHIVE_BYTES, 'Actionlint archive')
    : await readActionlintDownload(await fetch(release.url, { signal: AbortSignal.timeout(30_000) }));
  const directory = mkdtempSync(path.join(tmpdir(), 'whoisleuth-workflow-check-'));
  try {
    runActionlint(installActionlintArchive(bytes, release, directory));
    process.stdout.write(`All workflows passed actionlint ${ACTIONLINT_VERSION}.\n`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
