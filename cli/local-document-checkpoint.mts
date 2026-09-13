import { createHash } from 'node:crypto';
import { lstat, open, realpath, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import { decodeBoundedUtf8, readBoundedRegularFile } from '../lib/bounded-file.mts';
import { CliUsageError } from './errors.mts';
import { writePrivateFile } from './output-file.mts';

type FileIdentity = Readonly<{ device: number; inode: number; modified: number; changed: number; bytes: number; sha256: string }>;
type Snapshot = Readonly<{ identity: FileIdentity; text: string }>;
type Lease = Readonly<{ path: string; device: number; inode: number }>;

function missing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

async function canonicalPath(value: string, allowMissing: boolean, label: string): Promise<string> {
  const absolute = resolve(value);
  if (basename(absolute).endsWith('.workflow.lock')) throw new CliUsageError('The .workflow.lock suffix is reserved for workflow file ownership.');
  try {
    const metadata = await lstat(absolute);
    if (!metadata.isFile() || metadata.nlink !== 1) {
      throw new CliUsageError(`${label} files must be regular files without symbolic or additional hard links.`);
    }
    return await realpath(absolute);
  } catch (error) {
    if (!allowMissing || !missing(error)) throw error;
    return join(await realpath(dirname(absolute)), basename(absolute));
  }
}

async function snapshot(path: string, maximumBytes: number, label: string, signal?: AbortSignal): Promise<Snapshot | null> {
  let before;
  try { before = await lstat(path); } catch (error) { if (missing(error)) return null; throw error; }
  if (!before.isFile() || before.nlink !== 1) throw new CliUsageError(`${label} files must be regular files without links.`);
  const bytes = await readBoundedRegularFile(path, {
    maximumBytes, label: `${label} file`, ...(signal ? { signal } : {}),
  });
  const after = await lstat(path);
  if (!after.isFile() || after.nlink !== 1 || before.dev !== after.dev || before.ino !== after.ino
    || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.size !== after.size) {
    throw new CliUsageError(`${label} file changed while it was being read.`);
  }
  return {
    identity: { device: after.dev, inode: after.ino, modified: after.mtimeMs, changed: after.ctimeMs,
      bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
    text: decodeBoundedUtf8(bytes, `${label} file`),
  };
}

async function ownsLease(lease: Lease): Promise<boolean> {
  try {
    const current = await lstat(lease.path);
    return current.isFile() && current.nlink === 1 && current.dev === lease.device && current.ino === lease.inode;
  } catch (error) { if (missing(error)) return false; throw error; }
}

/** One selected document write, holding source and destination ownership until publication. */
export async function prepareLocalDocumentWrite(options: Readonly<{
  destination: string;
  source: string | null;
  force: boolean;
  maximumInputBytes: number;
  maximumOutputBytes: number;
  label: 'Workflow state' | 'Case';
  allowSourceReplacement?: boolean;
  signal?: AbortSignal;
}>) {
  if (![options.maximumInputBytes, options.maximumOutputBytes].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new TypeError('Local document byte limits must be positive safe integers.');
  }
  const label = options.label;
  const leases: Lease[] = [];
  let released = false;
  let published = false;
  async function release(): Promise<number> {
    released = true;
    let unresolved = 0;
    for (const lease of leases.splice(0).reverse()) {
      try {
        if (await ownsLease(lease)) await unlink(lease.path);
        else unresolved += 1;
      } catch { unresolved += 1; }
    }
    return unresolved;
  }
  try {
    options.signal?.throwIfAborted();
    const destination = await canonicalPath(options.destination, true, label);
    const source = options.source ? await canonicalPath(options.source, false, label) : null;
    if (source === destination && options.allowSourceReplacement === false) {
      throw new CliUsageError(`${label} review output must use a different path from its source file.`);
    }
    const paths = [...new Set([destination, ...(source ? [source] : [])])].sort();
    for (const path of paths) {
      options.signal?.throwIfAborted();
      const leasePath = join(dirname(path), `.${basename(path)}.workflow.lock`);
      let handle;
      try { handle = await open(leasePath, 'wx', 0o600); } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
          throw new CliUsageError(`${label} is already locked. Wait for its owner; after an interrupted process, inspect and remove only its abandoned .workflow.lock file.`);
        }
        throw error;
      }
      try {
        const identity = await handle.stat();
        leases.push({ path: leasePath, device: identity.dev, inode: identity.ino });
        await handle.writeFile(`${JSON.stringify({ pid: process.pid })}\n`, 'utf8');
        await handle.sync();
      } finally { await handle.close(); }
    }
    const snapshots = new Map<string, FileIdentity | null>();
    let sourceInput: string | null = null;
    for (const path of paths) {
      const value = await snapshot(path, options.maximumInputBytes, label, options.signal);
      if (path === source) {
        if (!value) throw new CliUsageError(`${label} source file disappeared before it could be read.`);
        sourceInput = value.text;
      }
      if (path === destination && value && !options.force) {
        throw new CliUsageError(`${label} output already exists; use --force to replace it or choose another path.`);
      }
      snapshots.set(path, value?.identity ?? null);
    }
    async function assertUnchanged(): Promise<void> {
      if (released) throw new CliUsageError(`${label} file ownership has already been released.`);
      options.signal?.throwIfAborted();
      for (const lease of leases) {
        if (!await ownsLease(lease)) throw new CliUsageError(`${label} file ownership changed; output was not published.`);
      }
      for (const [path, expected] of snapshots) {
        const actual = (await snapshot(path, options.maximumInputBytes, label, options.signal))?.identity ?? null;
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          throw new CliUsageError(`${label} changed during execution; output was not published. Review the current files before resuming.`);
        }
      }
    }
    return Object.freeze({
      sourceInput,
      async publish(content: string): Promise<void> {
        if (published || released) throw new CliUsageError(`${label} file publication has already settled.`);
        if (Buffer.byteLength(content, 'utf8') > options.maximumOutputBytes) {
          throw new CliUsageError(`${label} output is limited to ${options.maximumOutputBytes} bytes.`);
        }
        await writePrivateFile(destination, content, { force: options.force, beforePublish: assertUnchanged });
        published = true;
      },
      release,
    });
  } catch (error) {
    const unresolved = await release();
    if (unresolved) {
      throw new CliUsageError(`${label} file preparation failed and lease cleanup could not be verified. Inspect the selected directory before resuming.`);
    }
    throw error;
  }
}
