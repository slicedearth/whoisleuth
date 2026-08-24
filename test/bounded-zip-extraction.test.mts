import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { inflateSync, Zip, ZipDeflate, zipSync } from 'fflate';

import { extractBoundedZipEntries } from '../packages/interchange/bounded-zip-extraction.mts';
import zipFixtures from '../fixtures/zip-fixtures.mts';

const { patchZipDeclaredUncompressedSize } = zipFixtures;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

type ZipEntryLayout = Readonly<{
  name: string;
  compression: number;
  crc32: number;
  compressedSize: number;
  originalSize: number;
  centralOffset: number;
  localOffset: number;
  dataOffset: number;
  descriptorOffset: number | null;
}>;

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function zipLayouts(input: Uint8Array): ZipEntryLayout[] {
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  let end = input.byteLength - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error('ZIP fixture has no end record.');
  const count = view.getUint16(end + 10, true);
  let centralOffset = view.getUint32(end + 16, true);
  const layouts: ZipEntryLayout[] = [];
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(centralOffset, true) !== 0x02014b50) throw new Error('ZIP fixture has an invalid central directory.');
    const flags = view.getUint16(centralOffset + 8, true);
    const compression = view.getUint16(centralOffset + 10, true);
    const crc32 = view.getUint32(centralOffset + 16, true);
    const compressedSize = view.getUint32(centralOffset + 20, true);
    const originalSize = view.getUint32(centralOffset + 24, true);
    const nameLength = view.getUint16(centralOffset + 28, true);
    const extraLength = view.getUint16(centralOffset + 30, true);
    const commentLength = view.getUint16(centralOffset + 32, true);
    const localOffset = view.getUint32(centralOffset + 42, true);
    const name = decoder.decode(input.subarray(centralOffset + 46, centralOffset + 46 + nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    layouts.push({
      name,
      compression,
      crc32,
      compressedSize,
      originalSize,
      centralOffset,
      localOffset,
      dataOffset,
      descriptorOffset: (flags & 8) !== 0 ? dataOffset + compressedSize : null,
    });
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }
  return layouts;
}

function layoutFor(input: Uint8Array, name: string): ZipEntryLayout {
  const layout = zipLayouts(input).find((entry) => entry.name === name);
  if (!layout) throw new Error(`ZIP fixture entry ${name} was not found.`);
  return layout;
}

function xorPayloadByte(input: Uint8Array, name: string, offset: number, mask = 1): Uint8Array {
  const output = input.slice();
  const layout = layoutFor(output, name);
  if (offset < 0 || offset >= layout.compressedSize) throw new Error('ZIP fixture payload offset is invalid.');
  output[layout.dataOffset + offset] = output[layout.dataOffset + offset]! ^ mask;
  return output;
}

function patchCrc(input: Uint8Array, name: string, value: number, targets: Readonly<{
  local?: boolean;
  central?: boolean;
  descriptor?: boolean;
}>): Uint8Array {
  const output = input.slice();
  const layout = layoutFor(output, name);
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  if (targets.local) view.setUint32(layout.localOffset + 14, value >>> 0, true);
  if (targets.central) view.setUint32(layout.centralOffset + 16, value >>> 0, true);
  if (targets.descriptor) {
    if (layout.descriptorOffset === null) throw new Error('ZIP fixture entry has no data descriptor.');
    const signed = view.getUint32(layout.descriptorOffset, true) === 0x08074b50;
    view.setUint32(layout.descriptorOffset + (signed ? 4 : 0), value >>> 0, true);
  }
  return output;
}

function extract(input: Uint8Array, selectedNames: readonly string[]) {
  const selected = new Set(selectedNames);
  return extractBoundedZipEntries(input, {
    inspect(info) {
      return {
        key: info.name,
        selected: selected.has(info.name),
        maximumBytes: 1_048_576,
        exceededMessage: 'Selected ZIP entry exceeds its test bound.',
      };
    },
    keyForName: (name) => name,
    maximumEntries: 20,
    maximumSelectedBytes: 2_097_152,
    selectedBytesExceededMessage: 'Selected ZIP entries exceed their aggregate test bound.',
    metadataMismatchMessage: 'ZIP metadata or payload integrity mismatch.',
  });
}

function findDeflateMutation(
  input: Uint8Array,
  name: string,
  outcome: 'different-output' | 'decompression-error',
): Uint8Array {
  const layout = layoutFor(input, name);
  assert.equal(layout.compression, 8);
  const compressed = input.subarray(layout.dataOffset, layout.dataOffset + layout.compressedSize);
  const original = inflateSync(compressed);
  for (let offset = 0; offset < compressed.byteLength; offset += 1) {
    for (const mask of [1, 2, 4, 8, 16, 32, 64, 128]) {
      const changed = compressed.slice();
      changed[offset] = changed[offset]! ^ mask;
      try {
        const inflated = inflateSync(changed);
        if (outcome === 'different-output'
          && inflated.byteLength === layout.originalSize
          && !equalBytes(inflated, original)) {
          return xorPayloadByte(input, name, offset, mask);
        }
      } catch {
        if (outcome === 'decompression-error') return xorPayloadByte(input, name, offset, mask);
      }
    }
  }
  throw new Error(`Could not construct a deterministic ${outcome} fixture.`);
}

async function streamingZip(name: string, bytes: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    const archive = new Zip((error, chunk, final) => {
      if (error) {
        reject(error);
        return;
      }
      chunks.push(chunk.slice());
      total += chunk.byteLength;
      if (!final) return;
      const output = new Uint8Array(total);
      let offset = 0;
      for (const retained of chunks) {
        output.set(retained, offset);
        offset += retained.byteLength;
      }
      resolve(output);
    });
    const entry = new ZipDeflate(name);
    archive.add(entry);
    entry.push(bytes, true);
    archive.end();
  });
}

describe('bounded ZIP payload integrity', () => {
  test('accepts stored and zero-length entries only when their payload CRCs match', () => {
    const stored = encoder.encode('Selected stored evidence');
    const archive = zipSync({
      'stored.txt': [stored, { level: 0 }],
      'empty.txt': [new Uint8Array(), { level: 0 }],
    });
    const valid = extract(archive, ['stored.txt', 'empty.txt']);
    assert.deepEqual(valid.files.get('stored.txt'), stored);
    assert.deepEqual(valid.files.get('empty.txt'), new Uint8Array());

    const corrupted = xorPayloadByte(archive, 'stored.txt', 3, 0x20);
    assert.throws(() => extract(corrupted, ['stored.txt']), /payload integrity mismatch/u);
  });

  test('rejects deflated corruption whether decompression succeeds or fails', () => {
    const bytes = Uint8Array.from({ length: 4_096 }, (_, index) => (index * 31 + (index >>> 3)) & 0xff);
    const archive = zipSync({ 'deflated.bin': bytes });
    const changedOutput = findDeflateMutation(archive, 'deflated.bin', 'different-output');
    assert.throws(() => extract(changedOutput, ['deflated.bin']), /payload integrity mismatch/u);

    const invalidDeflate = findDeflateMutation(archive, 'deflated.bin', 'decompression-error');
    assert.throws(() => extract(invalidDeflate, ['deflated.bin']));
  });

  test('rejects local, central, descriptor, CRC and size inconsistencies', async () => {
    const bytes = encoder.encode('Consistent entry bytes');
    const archive = zipSync({ 'entry.txt': [bytes, { level: 0 }] });
    const layout = layoutFor(archive, 'entry.txt');
    const wrongCrc = (layout.crc32 + 1) >>> 0;
    assert.throws(
      () => extract(patchCrc(archive, 'entry.txt', wrongCrc, { local: true }), ['entry.txt']),
      /payload integrity mismatch/u,
    );
    assert.throws(
      () => extract(patchCrc(archive, 'entry.txt', wrongCrc, { local: true, central: true }), ['entry.txt']),
      /payload integrity mismatch/u,
    );
    assert.throws(
      () => extract(patchZipDeclaredUncompressedSize(archive, 'entry.txt', bytes.byteLength + 1), ['entry.txt']),
      /payload integrity mismatch/u,
    );

    const descriptorArchive = await streamingZip('streamed.txt', bytes);
    assert.deepEqual(extract(descriptorArchive, ['streamed.txt']).files.get('streamed.txt'), bytes);
    const descriptorLayout = layoutFor(descriptorArchive, 'streamed.txt');
    const wrongDescriptorCrc = (descriptorLayout.crc32 + 1) >>> 0;
    assert.throws(
      () => extract(patchCrc(descriptorArchive, 'streamed.txt', wrongDescriptorCrc, { descriptor: true }), ['streamed.txt']),
      /payload integrity mismatch/u,
    );
    assert.throws(
      () => extract(patchCrc(descriptorArchive, 'streamed.txt', wrongDescriptorCrc, { central: true, descriptor: true }), ['streamed.txt']),
      /payload integrity mismatch/u,
    );
  });

  test('does not return partial selected output when the final entry is corrupt', () => {
    const archive = zipSync({
      'first.txt': [encoder.encode('First selected entry'), { level: 0 }],
      'last.txt': [encoder.encode('Last selected entry'), { level: 0 }],
    });
    const corrupted = xorPayloadByte(archive, 'last.txt', 1, 0x08);
    assert.throws(() => extract(corrupted, ['first.txt', 'last.txt']), /payload integrity mismatch/u);
  });

  test('does not decompress or CRC-validate an unselected payload', () => {
    const selected = encoder.encode('Selected report');
    const archive = zipSync({
      'selected.txt': [selected, { level: 0 }],
      'ignored.bin': [encoder.encode('Ignored bytes'), { level: 0 }],
    });
    const corruptedIgnored = xorPayloadByte(archive, 'ignored.bin', 2, 0x40);
    const result = extract(corruptedIgnored, ['selected.txt']);
    assert.deepEqual(result.files.get('selected.txt'), selected);
    assert.equal(result.files.has('ignored.bin'), false);
  });
});
