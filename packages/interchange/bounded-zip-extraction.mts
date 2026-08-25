import {
  Unzip,
  UnzipInflate,
  unzipSync,
  type UnzipFileInfo,
} from 'fflate';

type BoundedZipSelection = Readonly<{
  key: string;
  selected: boolean;
  maximumBytes: number;
  exceededMessage: string;
}>;

type BoundedZipExtractionOptions = Readonly<{
  inspect: (entry: UnzipFileInfo) => BoundedZipSelection;
  keyForName: (name: string) => string;
  maximumEntries: number;
  maximumSelectedBytes: number;
  selectedBytesExceededMessage: string;
  metadataMismatchMessage: string;
}>;

type EntryPlan = Readonly<{
  info: UnzipFileInfo;
  directory: ZipDirectoryEntry;
  selection: BoundedZipSelection;
}>;

const INPUT_CHUNK_BYTES = 1_024;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const MAX_ZIP_COMMENT_BYTES = 0xffff;

type ZipDirectoryEntry = Readonly<{
  crc32: number;
  compression: number;
  compressedSize: number;
  originalSize: number;
  localHeaderOffset: number;
  localRegionEnd: number;
}>;

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function updateCrc32(state: number, bytes: Uint8Array): number {
  let next = state >>> 0;
  for (const byte of bytes) {
    next = CRC32_TABLE[(next ^ byte) & 0xff]! ^ (next >>> 8);
  }
  return next >>> 0;
}

function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function inspectZipDirectory(
  input: Uint8Array,
  maximumEntries: number,
  mismatchMessage: string,
): readonly ZipDirectoryEntry[] {
  if (input.byteLength < 22) throw new Error(mismatchMessage);
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const earliestEndRecord = Math.max(0, input.byteLength - 22 - MAX_ZIP_COMMENT_BYTES);
  let endRecordOffset = -1;
  for (let offset = input.byteLength - 22; offset >= earliestEndRecord; offset -= 1) {
    if (view.getUint32(offset, true) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) continue;
    const commentBytes = view.getUint16(offset + 20, true);
    if (offset + 22 + commentBytes === input.byteLength) {
      endRecordOffset = offset;
      break;
    }
  }
  if (endRecordOffset < 0) throw new Error(mismatchMessage);

  const disk = view.getUint16(endRecordOffset + 4, true);
  const directoryDisk = view.getUint16(endRecordOffset + 6, true);
  const diskEntries = view.getUint16(endRecordOffset + 8, true);
  const entryCount = view.getUint16(endRecordOffset + 10, true);
  const directoryBytes = view.getUint32(endRecordOffset + 12, true);
  const directoryOffset = view.getUint32(endRecordOffset + 16, true);
  if (disk !== 0
    || directoryDisk !== 0
    || diskEntries !== entryCount
    || entryCount === 0xffff
    || entryCount > maximumEntries
    || directoryBytes === 0xffff_ffff
    || directoryOffset === 0xffff_ffff
    || directoryOffset + directoryBytes !== endRecordOffset) {
    throw new Error(mismatchMessage);
  }

  const entries: ZipDirectoryEntry[] = [];
  let offset = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset > endRecordOffset - 46 || view.getUint32(offset, true) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error(mismatchMessage);
    }
    const flags = view.getUint16(offset + 8, true);
    const compression = view.getUint16(offset + 10, true);
    const crc32 = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const originalSize = view.getUint32(offset + 24, true);
    const nameBytes = view.getUint16(offset + 28, true);
    const extraBytes = view.getUint16(offset + 30, true);
    const commentBytes = view.getUint16(offset + 32, true);
    const startingDisk = view.getUint16(offset + 34, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nextOffset = offset + 46 + nameBytes + extraBytes + commentBytes;
    if ((flags & 1) !== 0
      || compressedSize === 0xffff_ffff
      || originalSize === 0xffff_ffff
      || localHeaderOffset === 0xffff_ffff
      || startingDisk !== 0
      || nextOffset > endRecordOffset
      || localHeaderOffset > directoryOffset - 30
      || view.getUint32(localHeaderOffset, true) !== LOCAL_FILE_HEADER_SIGNATURE) {
      throw new Error(mismatchMessage);
    }

    const localFlags = view.getUint16(localHeaderOffset + 6, true);
    const localCompression = view.getUint16(localHeaderOffset + 8, true);
    const localCrc32 = view.getUint32(localHeaderOffset + 14, true);
    const localCompressedSize = view.getUint32(localHeaderOffset + 18, true);
    const localOriginalSize = view.getUint32(localHeaderOffset + 22, true);
    const localNameBytes = view.getUint16(localHeaderOffset + 26, true);
    const localExtraBytes = view.getUint16(localHeaderOffset + 28, true);
    const localDataOffset = localHeaderOffset + 30 + localNameBytes + localExtraBytes;
    const dataEnd = localDataOffset + compressedSize;
    if (localFlags !== flags
      || localCompression !== compression
      || localDataOffset > directoryOffset
      || dataEnd > directoryOffset
      || !equalBytes(
        input.subarray(offset + 46, offset + 46 + nameBytes),
        input.subarray(localHeaderOffset + 30, localHeaderOffset + 30 + localNameBytes),
      )) {
      throw new Error(mismatchMessage);
    }

    let localRegionEnd = dataEnd;
    if ((flags & 8) !== 0) {
      if ((localCrc32 !== 0 && localCrc32 !== crc32)
        || (localCompressedSize !== 0 && localCompressedSize !== compressedSize)
        || (localOriginalSize !== 0 && localOriginalSize !== originalSize)) {
        throw new Error(mismatchMessage);
      }
      const unsignedDescriptorMatches = dataEnd <= directoryOffset - 12
        && view.getUint32(dataEnd, true) === crc32
        && view.getUint32(dataEnd + 4, true) === compressedSize
        && view.getUint32(dataEnd + 8, true) === originalSize;
      const signedDescriptorMatches = dataEnd <= directoryOffset - 16
        && view.getUint32(dataEnd, true) === DATA_DESCRIPTOR_SIGNATURE
        && view.getUint32(dataEnd + 4, true) === crc32
        && view.getUint32(dataEnd + 8, true) === compressedSize
        && view.getUint32(dataEnd + 12, true) === originalSize;
      if (!signedDescriptorMatches && !unsignedDescriptorMatches) throw new Error(mismatchMessage);
      localRegionEnd = dataEnd + (signedDescriptorMatches ? 16 : 12);
    } else if (localCrc32 !== crc32
      || localCompressedSize !== compressedSize
      || localOriginalSize !== originalSize) {
      throw new Error(mismatchMessage);
    }

    entries.push(Object.freeze({
      crc32,
      compression,
      compressedSize,
      originalSize,
      localHeaderOffset,
      localRegionEnd,
    }));
    offset = nextOffset;
  }
  if (offset !== endRecordOffset) throw new Error(mismatchMessage);

  const localOrder = [...entries].sort((left, right) => left.localHeaderOffset - right.localHeaderOffset);
  for (let index = 0; index < localOrder.length; index += 1) {
    const entry = localOrder[index]!;
    const next = localOrder[index + 1];
    if (entry.localRegionEnd > (next?.localHeaderOffset ?? directoryOffset)) {
      throw new Error(mismatchMessage);
    }
  }
  return Object.freeze(entries);
}

function extractBoundedZipEntries(
  input: Uint8Array,
  options: BoundedZipExtractionOptions,
): Readonly<{ files: ReadonlyMap<string, Uint8Array>; entryCount: number }> {
  if (!(input instanceof Uint8Array)
    || !Number.isSafeInteger(options.maximumEntries)
    || options.maximumEntries < 1
    || !Number.isSafeInteger(options.maximumSelectedBytes)
    || options.maximumSelectedBytes < 0) {
    throw new TypeError('Bounded ZIP extraction received invalid input.');
  }

  const directory = inspectZipDirectory(input, options.maximumEntries, options.metadataMismatchMessage);
  const plans = new Map<string, EntryPlan>();
  let directoryIndex = 0;
  unzipSync(input, {
    filter(info) {
      const directoryEntry = directory[directoryIndex];
      directoryIndex += 1;
      if (!directoryEntry
        || info.compression !== directoryEntry.compression
        || info.size !== directoryEntry.compressedSize
        || info.originalSize !== directoryEntry.originalSize) {
        throw new Error(options.metadataMismatchMessage);
      }
      const selection = options.inspect(info);
      if (!selection
        || typeof selection.key !== 'string'
        || !selection.key
        || typeof selection.selected !== 'boolean'
        || !Number.isSafeInteger(selection.maximumBytes)
        || selection.maximumBytes < 0
        || typeof selection.exceededMessage !== 'string'
        || !selection.exceededMessage) {
        throw new TypeError('Bounded ZIP extraction received an invalid entry plan.');
      }
      if (plans.has(selection.key)) throw new Error(options.metadataMismatchMessage);
      plans.set(selection.key, Object.freeze({ info, directory: directoryEntry, selection }));
      return false;
    },
  });
  if (directoryIndex !== directory.length) throw new Error(options.metadataMismatchMessage);

  const files = new Map<string, Uint8Array>();
  const localEntries = new Set<string>();
  let selectedBytes = 0;
  let failure: unknown = null;
  const unzip = new Unzip((file) => {
    try {
      const key = options.keyForName(file.name);
      const plan = plans.get(key);
      if (!plan
        || localEntries.has(key)
        || file.name !== plan.info.name
        || file.compression !== plan.info.compression
        || (file.size !== undefined && file.size !== plan.info.size)
        || (file.originalSize !== undefined && file.originalSize !== plan.info.originalSize)) {
        throw new Error(options.metadataMismatchMessage);
      }
      localEntries.add(key);
      // Unselected entries are structurally inspected but are not decompressed or
      // CRC-validated because their payload is outside the caller's import scope.
      if (!plan.selection.selected) return;

      const chunks: Uint8Array[] = [];
      let entryBytes = 0;
      let crc32State = 0xffff_ffff;
      file.ondata = (error, chunk, final) => {
        if (failure) throw failure;
        if (error || !(chunk instanceof Uint8Array)) {
          failure = error || new Error(options.metadataMismatchMessage);
          file.terminate();
          throw failure;
        }
        if (chunk.byteLength > plan.selection.maximumBytes - entryBytes) {
          failure = new Error(plan.selection.exceededMessage);
          file.terminate();
          throw failure;
        }
        if (chunk.byteLength > options.maximumSelectedBytes - selectedBytes) {
          failure = new Error(options.selectedBytesExceededMessage);
          file.terminate();
          throw failure;
        }
        entryBytes += chunk.byteLength;
        selectedBytes += chunk.byteLength;
        crc32State = updateCrc32(crc32State, chunk);
        if (chunk.byteLength) chunks.push(chunk.slice());
        if (final) {
          const actualCrc32 = (crc32State ^ 0xffff_ffff) >>> 0;
          if (entryBytes !== plan.info.originalSize || actualCrc32 !== plan.directory.crc32) {
            failure = new Error(options.metadataMismatchMessage);
            file.terminate();
            throw failure;
          }
          files.set(plan.info.name, concat(chunks, entryBytes));
        }
      };
      file.start();
    } catch (cause) {
      failure = cause;
      throw cause;
    }
  });
  unzip.register(UnzipInflate);

  try {
    for (let offset = 0; offset < input.byteLength; offset += INPUT_CHUNK_BYTES) {
      const end = Math.min(input.byteLength, offset + INPUT_CHUNK_BYTES);
      unzip.push(input.subarray(offset, end), end === input.byteLength);
      if (failure) throw failure;
    }
  } catch (cause) {
    throw failure || cause;
  }

  const selectedCount = [...plans.values()].filter((plan) => plan.selection.selected).length;
  if (localEntries.size !== plans.size || files.size !== selectedCount) {
    throw new Error(options.metadataMismatchMessage);
  }
  return Object.freeze({ files, entryCount: plans.size });
}

export { extractBoundedZipEntries };
export type { BoundedZipExtractionOptions, BoundedZipSelection };
