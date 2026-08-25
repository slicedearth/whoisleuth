import { Gunzip } from 'fflate';

export const BOUNDED_GZIP_INPUT_CHUNK_BYTES = 1_024;

type BoundedGzipOptions = Readonly<{
  maximumOutputBytes: number;
  exceededMessage: string;
  invalidMessage: string;
  emptyMessage: string;
}>;

function concatenate(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

/**
 * Expands gzip input incrementally so one highly compressible input cannot
 * make the decompressor return the complete expanded body in one callback.
 */
export function decompressBoundedGzip(
  input: Uint8Array,
  options: BoundedGzipOptions,
): Uint8Array {
  if (!(input instanceof Uint8Array)
    || input.byteLength < 2
    || input[0] !== 0x1f
    || input[1] !== 0x8b) {
    throw new Error(options.invalidMessage);
  }
  if (!Number.isSafeInteger(options.maximumOutputBytes) || options.maximumOutputBytes < 0) {
    throw new TypeError('Bounded gzip expansion requires a non-negative safe-integer output limit.');
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  let exceeded = false;
  try {
    const gunzip = new Gunzip((chunk) => {
      if (chunk.byteLength > options.maximumOutputBytes - total) {
        exceeded = true;
        throw new Error(options.exceededMessage);
      }
      total += chunk.byteLength;
      if (chunk.byteLength) chunks.push(chunk.slice());
    });
    for (let offset = 0; offset < input.byteLength; offset += BOUNDED_GZIP_INPUT_CHUNK_BYTES) {
      const end = Math.min(input.byteLength, offset + BOUNDED_GZIP_INPUT_CHUNK_BYTES);
      gunzip.push(input.subarray(offset, end), end === input.byteLength);
    }
  } catch (cause) {
    if (exceeded) throw cause;
    throw new Error(options.invalidMessage, { cause });
  }
  if (!total) throw new Error(options.emptyMessage);
  return concatenate(chunks, total);
}
