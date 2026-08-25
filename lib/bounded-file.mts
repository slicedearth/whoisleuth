import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';

const MAX_BOUNDED_FILE_BYTES = 64 * 1024 * 1024;

type BoundedFileOptions = Readonly<{
  maximumBytes: number;
  minimumBytes?: number;
  expectedBytes?: number | null;
  label?: string;
  allowSymbolicLink?: boolean;
  signal?: AbortSignal;
}>;

type BoundedFileDependencies = Readonly<{
  openFile?: typeof open;
}>;
type BoundedFileIdentity = Readonly<{
  bytes: Buffer;
  device: number;
  inode: number;
}>;

function boundedSize(value: unknown, fallback: number): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= MAX_BOUNDED_FILE_BYTES
    ? Number(value)
    : fallback;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted.', 'AbortError');
}

async function readBoundedRegularFileIdentity(
  filePath: string,
  options: BoundedFileOptions,
  dependencies: BoundedFileDependencies = {},
): Promise<BoundedFileIdentity> {
  const label = options.label?.trim().slice(0, 120) || 'Input file';
  const maximumBytes = boundedSize(options.maximumBytes, 0);
  const minimumBytes = boundedSize(options.minimumBytes, 0);
  if (maximumBytes < 1 || minimumBytes > maximumBytes) {
    throw new TypeError(`${label} has an invalid byte boundary.`);
  }
  const expectedBytes = options.expectedBytes === null || options.expectedBytes === undefined
    ? null
    : boundedSize(options.expectedBytes, -1);
  if (expectedBytes !== null && (expectedBytes < minimumBytes || expectedBytes > maximumBytes)) {
    throw new TypeError(`${label} expected size is outside its byte boundary.`);
  }
  throwIfAborted(options.signal);

  // Non-blocking open prevents a named pipe from stalling the process before
  // the descriptor can be classified. Final-component symlinks remain denied
  // unless an analyst-facing input explicitly opts in; artefacts resolved
  // inside a verified directory must retain the default confinement boundary.
  const flags = constants.O_RDONLY
    | constants.O_NONBLOCK
    | (options.allowSymbolicLink ? 0 : constants.O_NOFOLLOW);
  const handle = await (dependencies.openFile ?? open)(filePath, flags);
  try {
    throwIfAborted(options.signal);
    const before = await handle.stat();
    throwIfAborted(options.signal);
    if (!before.isFile()) throw new TypeError(`${label} must be a regular file.`);
    if (before.size < minimumBytes) throw new TypeError(`${label} is smaller than its ${minimumBytes}-byte minimum.`);
    if (before.size > maximumBytes) throw new TypeError(`${label} exceeds its ${maximumBytes}-byte maximum.`);
    if (expectedBytes !== null && before.size !== expectedBytes) {
      throw new TypeError(`${label} size does not match its declared size.`);
    }

    // Read from the already-opened descriptor and reserve only one sentinel
    // byte beyond the admitted size. A concurrent append is detected without
    // allocating from an attacker-controlled post-stat file length.
    const storage = Buffer.allocUnsafe(Math.min(maximumBytes + 1, before.size + 1));
    let offset = 0;
    while (offset < storage.length) {
      throwIfAborted(options.signal);
      const { bytesRead } = await handle.read(storage, offset, storage.length - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    throwIfAborted(options.signal);
    const after = await handle.stat();
    throwIfAborted(options.signal);
    if (
      offset > maximumBytes
      || after.size !== before.size
      || offset !== after.size
      || after.mtimeMs !== before.mtimeMs
      || after.ctimeMs !== before.ctimeMs
    ) {
      throw new TypeError(`${label} changed while it was being read.`);
    }
    return {
      bytes: Buffer.from(storage.subarray(0, offset)),
      device: before.dev,
      inode: before.ino,
    };
  } finally {
    await handle.close();
  }
}

export async function readBoundedRegularFile(
  filePath: string,
  options: BoundedFileOptions,
  dependencies: BoundedFileDependencies = {},
): Promise<Buffer> {
  return (await readBoundedRegularFileIdentity(filePath, options, dependencies)).bytes;
}

/**
 * Decode admitted bytes without replacement-character normalisation.  The BOM
 * is deliberately retained so re-encoding the returned string preserves the
 * exact bytes used by artefact identity and manifest checks.
 */
export function decodeBoundedUtf8(bytes: Uint8Array, label = 'Input'): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new TypeError(`${label.trim().slice(0, 120) || 'Input'} must contain valid UTF-8 text.`);
  }
}

export async function readBoundedRegularTextFile(
  filePath: string,
  options: BoundedFileOptions,
  dependencies: BoundedFileDependencies = {},
): Promise<string> {
  return decodeBoundedUtf8(
    await readBoundedRegularFile(filePath, options, dependencies),
    options.label,
  );
}

function safeRelativeFilePath(value: string, label: string): string {
  if (!value || path.isAbsolute(value) || value.includes('\\')
    || value.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new TypeError(`${label} must be a safe relative file path.`);
  }
  return value;
}

/**
 * Reads one regular file beneath a canonical root while rejecting final and
 * intermediate symbolic links. The ordinary descriptor-level size/change
 * checks still apply after path confinement is established.
 */
export async function readBoundedRegularFileWithin(
  rootDirectory: string,
  relativeFilePath: string,
  options: BoundedFileOptions,
  dependencies: BoundedFileDependencies = {},
): Promise<Buffer> {
  const label = options.label?.trim().slice(0, 120) || 'Input file';
  const relativePath = safeRelativeFilePath(relativeFilePath, label);
  const canonicalRoot = await realpath(rootDirectory);
  const targetPath = path.resolve(canonicalRoot, relativePath);
  const confined = path.relative(canonicalRoot, targetPath);
  if (!confined || confined.startsWith(`..${path.sep}`) || confined === '..' || path.isAbsolute(confined)) {
    throw new TypeError(`${label} escapes its configured root.`);
  }
  let cursor = canonicalRoot;
  const components = relativePath.split('/');
  let admittedDevice = -1;
  let admittedInode = -1;
  for (const [index, component] of components.entries()) {
    cursor = path.join(cursor, component);
    const metadata = await lstat(cursor);
    if (metadata.isSymbolicLink()) throw new TypeError(`${label} must not traverse a symbolic link.`);
    if (index === components.length - 1) {
      admittedDevice = metadata.dev;
      admittedInode = metadata.ino;
    }
  }
  const canonicalTarget = await realpath(targetPath);
  if (canonicalTarget !== targetPath) throw new TypeError(`${label} must not traverse a symbolic link.`);
  const identity = await readBoundedRegularFileIdentity(targetPath, {
    ...options,
    allowSymbolicLink: false,
  }, dependencies);
  const finalMetadata = await lstat(targetPath);
  if (finalMetadata.isSymbolicLink()
    || identity.device !== admittedDevice
    || identity.inode !== admittedInode
    || identity.device !== finalMetadata.dev
    || identity.inode !== finalMetadata.ino
    || await realpath(targetPath) !== canonicalTarget) {
    throw new TypeError(`${label} changed while it was being read.`);
  }
  return identity.bytes;
}

export { MAX_BOUNDED_FILE_BYTES };
export type { BoundedFileDependencies, BoundedFileOptions };
