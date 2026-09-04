import { Buffer } from 'node:buffer';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

import { decodeBoundedUtf8, readBoundedRegularTextFile } from '../lib/bounded-file.mts';
import type { BoundedTextStream } from './bulk.mts';
import { CliUsageError } from './errors.mts';

type CliInputOptions = Readonly<{
  maximumBytes: number;
  label: string;
  signal?: AbortSignal;
}>;

function headerEnd(bytes: Uint8Array): number {
  for (let index = 0; index < bytes.length - 1; index += 1) {
    if (bytes[index] === 0x0a && bytes[index + 1] === 0x0a) return index;
    if (index < bytes.length - 3
      && bytes[index] === 0x0d && bytes[index + 1] === 0x0a
      && bytes[index + 2] === 0x0d && bytes[index + 3] === 0x0a) return index;
  }
  return -1;
}

function decodeHeaderStorage(storage: Buffer, length: number, maximumBytes: number, label: string): string {
  const end = headerEnd(storage.subarray(0, length));
  if ((end < 0 && length > maximumBytes) || end > maximumBytes) {
    throw new CliUsageError(`${label} is limited to ${maximumBytes} bytes before the message body.`);
  }
  return decodeBoundedUtf8(storage.subarray(0, end < 0 ? length : end), label);
}

function appendUntilHeaderEnd(storage: Buffer, offset: number, input: Uint8Array): Readonly<{ offset: number; complete: boolean }> {
  let nextOffset = offset;
  for (const byte of input) {
    if (nextOffset >= storage.length) return Object.freeze({ offset: nextOffset, complete: false });
    storage[nextOffset] = byte;
    nextOffset += 1;
    const lfBoundary = nextOffset >= 2
      && storage[nextOffset - 2] === 0x0a
      && storage[nextOffset - 1] === 0x0a;
    const crlfBoundary = nextOffset >= 4
      && storage[nextOffset - 4] === 0x0d
      && storage[nextOffset - 3] === 0x0a
      && storage[nextOffset - 2] === 0x0d
      && storage[nextOffset - 1] === 0x0a;
    if (lfBoundary || crlfBoundary) return Object.freeze({ offset: nextOffset, complete: true });
  }
  return Object.freeze({ offset: nextOffset, complete: false });
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted.', 'AbortError');
}

export async function readCliTextInput(
  source: string | null | undefined,
  stdin: BoundedTextStream | null | undefined,
  options: CliInputOptions,
): Promise<string> {
  if (options.signal?.aborted) throw abortError(options.signal);
  if (source) {
    try {
      return await readBoundedRegularTextFile(source, {
        maximumBytes: options.maximumBytes,
        label: options.label,
        allowSymbolicLink: true,
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (error) {
      if (options.signal?.aborted) throw abortError(options.signal);
      if (error instanceof CliUsageError) throw error;
      const message = error instanceof Error ? error.message : `${options.label} could not be read.`;
      throw new CliUsageError(message);
    }
  }
  if (!stdin || stdin.isTTY) return '';

  let bytes = 0;
  const chunks: Buffer[] = [];
  const onAbort = () => {
    if ('destroy' in stdin && typeof stdin.destroy === 'function') stdin.destroy(abortError(options.signal!));
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    for await (const chunk of stdin as AsyncIterable<unknown>) {
      if (options.signal?.aborted) throw abortError(options.signal);
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      bytes += buffer.length;
      if (bytes > options.maximumBytes) {
        throw new CliUsageError(`${options.label} is limited to ${options.maximumBytes} bytes.`);
      }
      chunks.push(buffer);
    }
    if (options.signal?.aborted) throw abortError(options.signal);
    try {
      return decodeBoundedUtf8(Buffer.concat(chunks, bytes), options.label);
    } catch (cause) {
      throw new CliUsageError(cause instanceof Error ? cause.message : `${options.label} must contain valid UTF-8 text.`);
    }
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Read only the RFC-style header block from a selected regular file or stdin.
 * The fixed retained allocation includes delimiter look-ahead but accumulates
 * only bytes through the first header/body boundary. A regular file may be
 * larger than the header limit while parsing stays tied to the admitted prefix.
 */
export async function readCliHeaderInput(
  source: string | null | undefined,
  stdin: BoundedTextStream | null | undefined,
  options: CliInputOptions,
): Promise<string> {
  if (!Number.isSafeInteger(options.maximumBytes) || options.maximumBytes < 1 || options.maximumBytes > 1024 * 1024) {
    throw new TypeError('Header input has an invalid byte boundary.');
  }
  if (options.signal?.aborted) throw abortError(options.signal);
  const storage = Buffer.allocUnsafe(options.maximumBytes + 4);
  if (source) {
    let handle;
    try {
      handle = await open(source, constants.O_RDONLY | constants.O_NONBLOCK);
      const before = await handle.stat();
      if (!before.isFile()) throw new CliUsageError(`${options.label} must be a regular file.`);
      let offset = 0;
      let complete = false;
      const chunk = Buffer.allocUnsafe(Math.min(4 * 1024, storage.length));
      while (offset < storage.length && !complete) {
        if (options.signal?.aborted) throw abortError(options.signal);
        const result = await handle.read(chunk, 0, Math.min(chunk.length, storage.length - offset), null);
        if (result.bytesRead === 0) break;
        ({ offset, complete } = appendUntilHeaderEnd(storage, offset, chunk.subarray(0, result.bytesRead)));
      }
      chunk.fill(0);
      const after = await handle.stat();
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
        throw new CliUsageError(`${options.label} changed while it was being read.`);
      }
      return decodeHeaderStorage(storage, offset, options.maximumBytes, options.label);
    } catch (error) {
      if (error instanceof CliUsageError || options.signal?.aborted) throw error;
      const message = error instanceof Error ? error.message : `${options.label} could not be read.`;
      throw new CliUsageError(message);
    } finally {
      await handle?.close();
    }
  }
  if (!stdin || stdin.isTTY) return '';
  let offset = 0;
  const onAbort = () => {
    if ('destroy' in stdin && typeof stdin.destroy === 'function') stdin.destroy(abortError(options.signal!));
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    for await (const chunk of stdin as AsyncIterable<unknown>) {
      if (options.signal?.aborted) throw abortError(options.signal);
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      const retained = appendUntilHeaderEnd(storage, offset, bytes);
      offset = retained.offset;
      if (retained.complete) break;
      if (offset >= storage.length) break;
    }
    if (options.signal?.aborted) throw abortError(options.signal);
    return decodeHeaderStorage(storage, offset, options.maximumBytes, options.label);
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
  }
}

export type { CliInputOptions };
