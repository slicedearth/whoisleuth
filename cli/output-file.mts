import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { link, open, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import { CliUsageError } from './errors.mts';
import type { WritableTerminal } from './terminal-presentation.mts';

export const MAX_CLI_OUTPUT_BYTES = 32 * 1024 * 1024;
export const MAX_CLI_OUTPUT_PATH_LENGTH = 4096;
const pendingOutputFiles = new Set<string>();

type BufferedOutput = Readonly<{
  stream: WritableTerminal;
  value(): string;
}>;

function safeOutputPath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > MAX_CLI_OUTPUT_PATH_LENGTH) {
    throw new CliUsageError(`Output paths are limited to ${MAX_CLI_OUTPUT_PATH_LENGTH} characters.`);
  }
  if (/[\x00-\x1f\x7f]/u.test(value)) {
    throw new CliUsageError('Output paths cannot contain control characters.');
  }
  return resolve(value);
}

function createBufferedOutput(): BufferedOutput {
  const chunks: string[] = [];
  let bytes = 0;
  return Object.freeze({
    stream: {
      isTTY: false,
      columns: 80,
      write(chunk: string | Uint8Array) {
        const value = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
        bytes += Buffer.byteLength(value, 'utf8');
        if (bytes > MAX_CLI_OUTPUT_BYTES) {
          throw new CliUsageError(`Generated output is limited to ${MAX_CLI_OUTPUT_BYTES} bytes.`);
        }
        chunks.push(value);
        return true;
      },
    },
    value: () => chunks.join(''),
  });
}

async function writePrivateFile(
  pathValue: unknown,
  content: string,
  options: { force?: boolean; existingFileMessage?: string } = {},
): Promise<string> {
  const target = safeOutputPath(pathValue);
  if (Buffer.byteLength(content, 'utf8') > MAX_CLI_OUTPUT_BYTES) {
    throw new CliUsageError(`Generated output is limited to ${MAX_CLI_OUTPUT_BYTES} bytes.`);
  }
  const directory = dirname(target);
  const temporary = join(directory, `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  let temporaryCreated = false;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    temporaryCreated = true;
    pendingOutputFiles.add(temporary);
    try {
      await handle.writeFile(content, { encoding: 'utf8' });
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (options.force) {
      await rename(temporary, target);
      temporaryCreated = false;
    } else {
      try {
        await link(temporary, target);
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
        if (code === 'EEXIST') {
          throw new CliUsageError(options.existingFileMessage || `Output file already exists: ${target}. Use --force to replace it.`);
        }
        throw error;
      }
      await unlink(temporary);
      temporaryCreated = false;
    }
    return target;
  } finally {
    if (temporaryCreated) await unlink(temporary).catch(() => {});
    pendingOutputFiles.delete(temporary);
  }
}

function cleanupPendingOutputFilesSync(): void {
  for (const path of pendingOutputFiles) {
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

export { cleanupPendingOutputFilesSync, createBufferedOutput, safeOutputPath, writePrivateFile };
export type { BufferedOutput };
