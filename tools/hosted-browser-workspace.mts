import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  assertFrontendBuildIntegrity,
  FRONTEND_BUILD_INTEGRITY_MARKER,
} from './frontend-build-integrity.mts';
import {
  boundedSafeRelativePath,
  compareCodeUnits,
  sha256Bytes,
} from './maintainer-tool-helpers.mts';

const MAX_CHECKOUT_FILES = 4_096;
const MAX_CHECKOUT_FILE_BYTES = 32 * 1024 * 1024;
const MAX_CHECKOUT_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_GIT_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_PATH_LENGTH = 1_024;

export type HostedBrowserWorkspace = Readonly<{
  root: string;
  revision: string;
  dispose: () => void;
}>;

function checkoutFiles(repositoryRoot: string): readonly string[] {
  const child = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    {
      cwd: repositoryRoot,
      encoding: 'buffer',
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  if (child.error) throw child.error;
  if (child.status !== 0) {
    throw new TypeError(`Hosted browser workspace could not inventory the checkout: ${child.stderr.toString('utf8').trim() || `exit ${child.status ?? 2}`}.`);
  }
  if (child.stdout.byteLength > MAX_GIT_OUTPUT_BYTES) {
    throw new TypeError('Hosted browser checkout inventory exceeds its byte limit.');
  }
  const files = child.stdout.toString('utf8').split('\0').filter(Boolean).map((value) => (
    boundedSafeRelativePath(value, 'Hosted browser checkout path', MAX_PATH_LENGTH)
  )).filter((value) => (
    value !== FRONTEND_BUILD_INTEGRITY_MARKER
    && !value.startsWith('frontend/build/')
    && !value.startsWith('frontend/.svelte-kit/')
  )).sort(compareCodeUnits);
  if (files.length < 1 || files.length > MAX_CHECKOUT_FILES || new Set(files).size !== files.length) {
    throw new TypeError('Hosted browser checkout inventory is empty, duplicated, or exceeds its file bound.');
  }
  return Object.freeze(files);
}

function copyRegularFile(source: string, destination: string, label: string, expected?: Readonly<{
  bytes: number;
  sha256: string;
}>): number {
  const before = lstatSync(source);
  if (!before.isFile() || before.isSymbolicLink() || !Number.isSafeInteger(before.size)
    || before.size < 0 || before.size > MAX_CHECKOUT_FILE_BYTES) {
    throw new TypeError(`${label} must be a bounded stable regular file.`);
  }
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  const copied = readFileSync(destination);
  const after = lstatSync(source);
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || copied.byteLength !== before.size) {
    throw new TypeError(`${label} changed while the hosted browser workspace was created.`);
  }
  if (expected && (copied.byteLength !== expected.bytes || sha256Bytes(copied) !== expected.sha256)) {
    throw new TypeError(`${label} does not match the declared frontend build identity.`);
  }
  return copied.byteLength;
}

export function createHostedBrowserWorkspace(
  repositoryRoot: string,
  environment: NodeJS.ProcessEnv = process.env,
): HostedBrowserWorkspace {
  const snapshot = assertFrontendBuildIntegrity(repositoryRoot, environment);
  const files = checkoutFiles(repositoryRoot);
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'whoisleuth-hosted-browser-'));
  let complete = false;
  try {
    let totalBytes = 0;
    for (const relative of files) {
      totalBytes += copyRegularFile(
        path.join(repositoryRoot, relative),
        path.join(temporaryRoot, relative),
        `Hosted browser checkout file ${relative}`,
      );
      if (totalBytes > MAX_CHECKOUT_TOTAL_BYTES) {
        throw new TypeError('Hosted browser checkout exceeds its aggregate byte limit.');
      }
    }
    for (const file of snapshot.served.files) {
      totalBytes += copyRegularFile(
        path.join(repositoryRoot, 'frontend/build', file.path),
        path.join(temporaryRoot, 'frontend/build', file.path),
        `Hosted browser served file ${file.path}`,
        file,
      );
      if (totalBytes > MAX_CHECKOUT_TOTAL_BYTES) {
        throw new TypeError('Hosted browser workspace exceeds its aggregate byte limit.');
      }
    }
    totalBytes += copyRegularFile(
      path.join(repositoryRoot, FRONTEND_BUILD_INTEGRITY_MARKER),
      path.join(temporaryRoot, FRONTEND_BUILD_INTEGRITY_MARKER),
      'Hosted browser build-integrity marker',
    );
    if (totalBytes > MAX_CHECKOUT_TOTAL_BYTES) {
      throw new TypeError('Hosted browser workspace exceeds its aggregate byte limit.');
    }
    const dependencyRoot = path.join(repositoryRoot, 'node_modules');
    const dependencyStat = lstatSync(dependencyRoot);
    if (!dependencyStat.isDirectory() || dependencyStat.isSymbolicLink()) {
      throw new TypeError('Hosted browser workspace requires the checked-out dependency directory.');
    }
    symlinkSync(dependencyRoot, path.join(temporaryRoot, 'node_modules'), 'dir');
    if (existsSync(path.join(temporaryRoot, 'frontend/.svelte-kit'))) {
      throw new TypeError('Hosted browser workspace contains undeclared SvelteKit builder output.');
    }
    assertFrontendBuildIntegrity(temporaryRoot, {
      ...environment,
      WHOISLEUTH_BUILD_REVISION: snapshot.runtime.revision,
    });
    complete = true;
    return Object.freeze({
      // Node canonicalises an executed module before exposing import.meta.url.
      // Return the same canonical spelling so absolute runner paths still
      // satisfy their entry-point guard on platforms where tmpdir crosses a
      // filesystem alias (for example /var to /private/var on macOS).
      root: realpathSync(temporaryRoot),
      revision: snapshot.runtime.revision,
      dispose: () => rmSync(temporaryRoot, { recursive: true, force: true }),
    });
  } finally {
    if (!complete) rmSync(temporaryRoot, { recursive: true, force: true });
  }
}
