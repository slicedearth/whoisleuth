import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { link, open, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import { CliUsageError } from './errors.mts';
import type { WritableTerminal } from './terminal-presentation.mts';
import { MAX_INVESTIGATION_PACKAGE_BYTES } from '../packages/investigation/investigation-package.mts';

export const MAX_CLI_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_CLI_OUTPUT_PATH_LENGTH = 4096;
type PendingOutputFile = {
  remove(): Promise<void>;
  published: boolean;
  settled: boolean;
};
const pendingOutputFiles = new Map<string, PendingOutputFile>();

type BufferedOutput = Readonly<{
  stream: WritableTerminal;
  writeBinary(value: Uint8Array): void;
  value(): string;
}>;
type BinaryBufferedOutput = Readonly<{ stream: WritableTerminal; writeBinary(value: Uint8Array): void; value(): Uint8Array }>;

type OutputFileHandle = Readonly<{
  writeFile(content: string | Uint8Array, options: Readonly<{ encoding: 'utf8' }>): Promise<unknown>;
  sync(): Promise<void>;
  close(): Promise<void>;
}>;

export type OutputFileOperations = Readonly<{
  randomUUID(): string;
  open(path: string, flags: 'wx', mode: number): Promise<OutputFileHandle>;
  link(existingPath: string, newPath: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  unlink(path: string): Promise<void>;
}>;

export type OutputCleanupReport = Readonly<{
  attempted: number;
  removed: number;
  retained: number;
  retainedPublished: number;
  retainedUnpublished: number;
}>;

const OUTPUT_FILE_OPERATIONS: OutputFileOperations = Object.freeze({
  randomUUID,
  open,
  link,
  rename,
  unlink,
});

function safeOutputPath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > MAX_CLI_OUTPUT_PATH_LENGTH) {
    throw new CliUsageError(`Output paths are limited to ${MAX_CLI_OUTPUT_PATH_LENGTH} characters.`);
  }
  if (/[\x00-\x1f\x7f]/u.test(value)) {
    throw new CliUsageError('Output paths cannot contain control characters.');
  }
  return resolve(value);
}

function createBufferedOutput(): BufferedOutput;
function createBufferedOutput(options: { binary: boolean }): BufferedOutput | BinaryBufferedOutput;
function createBufferedOutput(options: { binary: boolean } = { binary: false }): BufferedOutput | BinaryBufferedOutput {
  const chunks: string[] = [];
  const binaryChunks: Uint8Array[] = [];
  let bytes = 0;
  const writeBinary = (chunk: Uint8Array): void => {
    if (!options.binary || !(chunk instanceof Uint8Array)) throw new CliUsageError('Binary output requires an explicit package destination.');
    if (chunk.byteLength > MAX_INVESTIGATION_PACKAGE_BYTES - bytes) throw new CliUsageError('Binary package output exceeds its byte limit.');
    bytes += chunk.byteLength;
    binaryChunks.push(new Uint8Array(chunk));
  };
  return Object.freeze({
    writeBinary,
    stream: {
      isTTY: false,
      columns: 80,
      write(chunk: string | Uint8Array) {
        if (options.binary) throw new CliUsageError('Binary package output cannot contain terminal text.');
        const value = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
        bytes += Buffer.byteLength(value, 'utf8');
        if (bytes > MAX_CLI_OUTPUT_BYTES) {
          throw new CliUsageError(`Generated output is limited to ${MAX_CLI_OUTPUT_BYTES} bytes.`);
        }
        chunks.push(value);
        return true;
      },
    },
    value: () => {
      if (!options.binary) return chunks.join('');
      const result = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of binaryChunks) { result.set(chunk, offset); offset += chunk.byteLength; }
      return result;
    },
  }) as BufferedOutput | BinaryBufferedOutput;
}

async function writePrivateFile(
  pathValue: unknown,
  content: string | Uint8Array,
  options: { force?: boolean; existingFileMessage?: string; beforePublish?: () => Promise<void> } = {},
  operations: OutputFileOperations = OUTPUT_FILE_OPERATIONS,
): Promise<string> {
  const target = safeOutputPath(pathValue);
  const maximumBytes = typeof content === 'string' ? MAX_CLI_OUTPUT_BYTES : MAX_INVESTIGATION_PACKAGE_BYTES;
  if ((typeof content === 'string' ? Buffer.byteLength(content, 'utf8') : content.byteLength) > maximumBytes) {
    throw new CliUsageError(`Generated output is limited to ${maximumBytes} bytes.`);
  }
  const captured = typeof content === 'string' ? content : new Uint8Array(content);
  const directory = dirname(target);
  const temporary = join(directory, `.${basename(target)}.${process.pid}.${operations.randomUUID()}.tmp`);
  let temporaryCreated = false;
  try {
    const handle = await operations.open(temporary, 'wx', 0o600);
    temporaryCreated = true;
    pendingOutputFiles.set(temporary, {
      remove: () => operations.unlink(temporary),
      published: false,
      settled: false,
    });
    try {
      await handle.writeFile(captured, { encoding: 'utf8' });
      await handle.sync();
    } finally {
      await handle.close();
    }
    await options.beforePublish?.();
    if (options.force) {
      await operations.rename(temporary, target);
      temporaryCreated = false;
    } else {
      try {
        await operations.link(temporary, target);
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
        if (code === 'EEXIST') {
          throw new CliUsageError(options.existingFileMessage || `Output file already exists: ${target}. Use --force to replace it.`);
        }
        throw error;
      }
      const pending = pendingOutputFiles.get(temporary);
      if (pending) pending.published = true;
      try {
        await operations.unlink(temporary);
        temporaryCreated = false;
      } catch {
        // The target is already published. A second best-effort cleanup runs
        // below, and signal cleanup retains ownership if it still cannot run.
      }
    }
    return target;
  } finally {
    if (temporaryCreated) {
      try {
        await operations.unlink(temporary);
        temporaryCreated = false;
      } catch {
        // Keep the path registered for best-effort signal cleanup.
      }
    }
    if (temporaryCreated) {
      const pending = pendingOutputFiles.get(temporary);
      if (pending) pending.settled = true;
    }
    if (!temporaryCreated) pendingOutputFiles.delete(temporary);
  }
}

async function cleanupPendingOutputFiles(): Promise<OutputCleanupReport> {
  const entries = [...pendingOutputFiles].filter(([, pending]) => pending.settled);
  let removed = 0;
  for (const [path, pending] of entries) {
    try {
      await pending.remove();
      pendingOutputFiles.delete(path);
      removed += 1;
    } catch {
      // The caller receives an explicit retained count and can disclose that
      // the published output is intact while temporary cleanup remains due.
    }
  }
  const retainedFiles = [...pendingOutputFiles.values()].filter((item) => item.settled);
  return Object.freeze({
    attempted: entries.length,
    removed,
    retained: retainedFiles.length,
    retainedPublished: retainedFiles.filter((item) => item.published).length,
    retainedUnpublished: retainedFiles.filter((item) => !item.published).length,
  });
}

function cleanupPendingOutputFilesSync(): void {
  for (const path of pendingOutputFiles.keys()) {
    try {
      unlinkSync(path);
    } catch {
      // A second interrupt is an emergency exit. Best-effort cleanup must not
      // delay it or replace the analyst-requested exit status.
    } finally {
      pendingOutputFiles.delete(path);
    }
  }
}

export { cleanupPendingOutputFiles, cleanupPendingOutputFilesSync, createBufferedOutput, writePrivateFile };
