import { Buffer } from 'node:buffer';

import { readBoundedRegularTextFile } from '../lib/bounded-file.mts';
import type { BoundedTextStream } from './bulk.mts';
import { CliUsageError } from './errors.mts';

type CliInputOptions = Readonly<{
  maximumBytes: number;
  label: string;
  signal?: AbortSignal;
}>;

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
    return Buffer.concat(chunks, bytes).toString('utf8');
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
  }
}

export type { CliInputOptions };
