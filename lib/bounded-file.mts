import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

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

export async function readBoundedRegularFile(
  filePath: string,
  options: BoundedFileOptions,
  dependencies: BoundedFileDependencies = {},
): Promise<Buffer> {
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
    return Buffer.from(storage.subarray(0, offset));
  } finally {
    await handle.close();
  }
}

export async function readBoundedRegularTextFile(
  filePath: string,
  options: BoundedFileOptions,
  dependencies: BoundedFileDependencies = {},
): Promise<string> {
  return (await readBoundedRegularFile(filePath, options, dependencies)).toString('utf8');
}

export { MAX_BOUNDED_FILE_BYTES };
export type { BoundedFileDependencies, BoundedFileOptions };
