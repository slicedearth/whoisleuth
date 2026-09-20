import { Gunzip } from 'fflate';
import { updateCrc32 } from './crc32.mts';

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

function headerEnd(input: Uint8Array, start: number): number {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const flags = input[start + 3];
  if (start + 18 > input.byteLength || input[start] !== 0x1f || input[start + 1] !== 0x8b
    || input[start + 2] !== 8 || flags === undefined || (flags & 0xe0) !== 0) throw new Error('Invalid GZIP member header.');
  let offset = start + 10;
  if (flags & 4) {
    if (offset + 2 > input.byteLength) throw new Error('Incomplete GZIP extra field.');
    offset += 2 + view.getUint16(offset, true);
  }
  for (const flag of [8, 16]) {
    if (!(flags & flag)) continue;
    while (offset < input.byteLength && input[offset] !== 0) offset += 1;
    offset += 1;
  }
  if (offset > input.byteLength - 8) throw new Error('Incomplete GZIP member header.');
  if (flags & 2) {
    if (offset + 2 > input.byteLength - 8) throw new Error('Incomplete GZIP header checksum.');
    const checksum = (updateCrc32(0xffff_ffff, input.subarray(start, offset)) ^ 0xffff_ffff) & 0xffff;
    if (view.getUint16(offset, true) !== checksum) throw new Error('Invalid GZIP header checksum.');
    offset += 2;
  }
  return offset;
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
    const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
    let memberHeaderEnd = headerEnd(input, 0);
    let memberBytes = 0;
    let checksumState = 0xffff_ffff;
    const verifyMember = (end: number) => {
      if (end - 8 < memberHeaderEnd
        || view.getUint32(end - 8, true) !== ((checksumState ^ 0xffff_ffff) >>> 0)
        || view.getUint32(end - 4, true) !== (memberBytes >>> 0)) {
        throw new Error('Invalid GZIP member trailer.');
      }
    };
    const gunzip = new Gunzip((chunk) => {
      if (chunk.byteLength > options.maximumOutputBytes - total) {
        exceeded = true;
        throw new Error(options.exceededMessage);
      }
      total += chunk.byteLength;
      memberBytes += chunk.byteLength;
      checksumState = updateCrc32(checksumState, chunk);
      if (chunk.byteLength) chunks.push(chunk.slice());
    });
    gunzip.onmember = (offset) => {
      verifyMember(offset);
      memberHeaderEnd = headerEnd(input, offset);
      memberBytes = 0;
      checksumState = 0xffff_ffff;
    };
    for (let offset = 0; offset < input.byteLength; offset += BOUNDED_GZIP_INPUT_CHUNK_BYTES) {
      const end = Math.min(input.byteLength, offset + BOUNDED_GZIP_INPUT_CHUNK_BYTES);
      gunzip.push(input.subarray(offset, end), end === input.byteLength);
    }
    verifyMember(input.byteLength);
  } catch (cause) {
    if (exceeded) throw cause;
    throw new Error(options.invalidMessage, { cause });
  }
  if (!total) throw new Error(options.emptyMessage);
  return concatenate(chunks, total);
}
