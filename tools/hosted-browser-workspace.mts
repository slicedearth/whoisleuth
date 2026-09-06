import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  opendirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
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
  hasMaintainerUnsafeCharacters,
  sha256Bytes,
} from './maintainer-tool-helpers.mts';
import { playwrightRunArtifacts } from './playwright-run-artifacts.mts';
import { MAX_PLAYWRIGHT_RESULTS_BYTES } from './playwright-results-summary.mts';

const MAX_CHECKOUT_FILES = 4_096;
const MAX_CHECKOUT_FILE_BYTES = 32 * 1024 * 1024;
const MAX_CHECKOUT_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_GIT_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_PATH_LENGTH = 1_024;

export const HOSTED_BROWSER_DIAGNOSTIC_LIMITS = Object.freeze({
  entries: 2_048,
  depth: 8,
  fileBytes: MAX_PLAYWRIGHT_RESULTS_BYTES,
  totalBytes: 2 * MAX_PLAYWRIGHT_RESULTS_BYTES,
});

type FailedBrowserOutcome = 'failed' | 'interrupted';
type HostedBrowserDiagnostics = Readonly<{
  directory: string;
  retainedFiles: number;
  retainedBytes: number;
  omittedEntries: number;
}>;

export type HostedBrowserWorkspace = Readonly<{
  root: string;
  revision: string;
  dispose: () => void;
  retainDiagnostics: (outcome: FailedBrowserOutcome) => HostedBrowserDiagnostics;
}>;

function retainDiagnostics(root: string, revision: string, outcome: FailedBrowserOutcome): HostedBrowserDiagnostics {
  // Keep report paths valid by reducing the owned temporary workspace to a
  // diagnostics-only directory. Authentication, source and dependencies are
  // not diagnostic roots. Prefer JSON and traces over the HTML report when
  // the retained-byte ceiling is reached.
  const artifacts = playwrightRunArtifacts({ WHOISLEUTH_PLAYWRIGHT_RUN_KIND: 'performance' });
  const roots = [...new Set([artifacts.jsonResults, artifacts.testResults, artifacts.htmlReport]
    .map((relative) => relative.split('/')[0]!))];
  const keep = new Set(roots);
  const directory = opendirSync(root);
  try {
    for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
      if (!keep.has(entry.name)) rmSync(path.join(root, entry.name), { recursive: true, force: true });
    }
  } finally {
    directory.closeSync();
  }
  chmodSync(root, 0o700);

  let entries = 0;
  let retainedFiles = 0;
  let retainedBytes = 0;
  let omittedEntries = 0;
  const prune = (relative: string, depth: number): void => {
    const filename = path.join(root, relative);
    const stat = lstatSync(filename);
    entries += 1;
    const unsafe = relative.length > MAX_PATH_LENGTH || hasMaintainerUnsafeCharacters(relative)
      || relative.includes('\\') || stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile());
    const excessive = entries > HOSTED_BROWSER_DIAGNOSTIC_LIMITS.entries
      || depth > HOSTED_BROWSER_DIAGNOSTIC_LIMITS.depth
      || (stat.isFile() && (stat.nlink !== 1 || stat.size > HOSTED_BROWSER_DIAGNOSTIC_LIMITS.fileBytes
        || retainedBytes + stat.size > HOSTED_BROWSER_DIAGNOSTIC_LIMITS.totalBytes));
    if (unsafe || excessive) {
      rmSync(filename, { recursive: true, force: true });
      omittedEntries += 1;
      return;
    }
    if (stat.isFile()) {
      chmodSync(filename, 0o600);
      retainedFiles += 1;
      retainedBytes += stat.size;
      return;
    }
    chmodSync(filename, 0o700);
    const children = opendirSync(filename);
    try {
      for (let entry = children.readSync(); entry; entry = children.readSync()) {
        prune(`${relative}/${entry.name}`, depth + 1);
      }
    } finally {
      children.closeSync();
    }
  };
  for (const relative of roots) {
    // lstat also finds dangling symbolic links, which must not survive cleanup.
    if (lstatSync(path.join(root, relative), { throwIfNoEntry: false })) prune(relative, 1);
  }
  writeFileSync(path.join(root, 'diagnostics.json'), `${JSON.stringify({
    revision,
    outcome,
    retainedFiles,
    retainedBytes,
    omittedEntries,
    limits: HOSTED_BROWSER_DIAGNOSTIC_LIMITS,
    note: 'Omitted entries count files or whole subtrees. Interrupted runs may contain incomplete reports. Remove this private directory after review.',
  }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return Object.freeze({ directory: root, retainedFiles, retainedBytes, omittedEntries });
}

export async function runHostedBrowserWorkspace(
  workspace: HostedBrowserWorkspace,
  execute: () => Promise<number>,
  isInterrupted: () => boolean = () => false,
  report: (message: string) => void = (message) => { process.stderr.write(message); },
): Promise<number> {
  let exit: number | undefined;
  try {
    exit = await execute();
    if (isInterrupted()) exit = 130;
    return exit;
  } finally {
    const outcome = isInterrupted() || exit === 130 ? 'interrupted' : exit === 0 ? 'passed' : 'failed';
    if (outcome === 'passed') workspace.dispose();
    else {
      try {
        const diagnostics = workspace.retainDiagnostics(outcome);
        report(`Browser ${outcome} diagnostics retained at ${diagnostics.directory}: `
          + `${diagnostics.retainedFiles} files, ${diagnostics.retainedBytes} bytes, `
          + `${diagnostics.omittedEntries} omitted files/subtrees. Remove after review.\n`);
      } catch (cause) {
        // Do not erase the only remaining evidence if retention itself fails.
        throw new Error(`Browser diagnostic cleanup failed; inspect the retained workspace at ${workspace.root}.`, { cause });
      }
    }
  }
}

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
      retainDiagnostics: (outcome: FailedBrowserOutcome) => retainDiagnostics(
        realpathSync(temporaryRoot), snapshot.runtime.revision, outcome,
      ),
    });
  } finally {
    if (!complete) rmSync(temporaryRoot, { recursive: true, force: true });
  }
}
