import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crc32, gzipSync as nativeGzip, gunzipSync as nativeGunzip } from 'node:zlib';

import { gzipSync } from 'fflate';

import {
  BOUNDED_GZIP_INPUT_CHUNK_BYTES,
  decompressBoundedGzip,
} from '../packages/interchange/bounded-gzip.mts';
import { updateCrc32 } from '../packages/interchange/crc32.mts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const OPTIONS = {
  maximumOutputBytes: 64,
  exceededMessage: 'Expanded fixture exceeds its limit.',
  invalidMessage: 'Fixture gzip is invalid.',
  emptyMessage: 'Fixture gzip is empty.',
};

function join(...parts: Uint8Array[]): Uint8Array {
  return new Uint8Array(Buffer.concat(parts));
}

test('shares an incremental CRC implementation with an independent published check value', () => {
  const first = updateCrc32(0xffff_ffff, encoder.encode('1234'));
  assert.equal((updateCrc32(first, encoder.encode('56789')) ^ 0xffff_ffff) >>> 0, 0xcbf4_3926);
});

test('checks every GZIP member trailer against independently compressed input', () => {
  const first = nativeGzip(encoder.encode('first'));
  const second = nativeGzip(encoder.encode('second'));
  const valid = join(first, second);
  assert.equal(decoder.decode(decompressBoundedGzip(valid, OPTIONS)), 'firstsecond');
  assert.deepEqual(decompressBoundedGzip(valid, OPTIONS), new Uint8Array(nativeGunzip(valid)));
  for (const memberEnd of [first.byteLength, valid.byteLength]) {
    for (const offsets of [[8], [4], [8, 4]]) {
      const corrupt = valid.slice();
      for (const offset of offsets) corrupt[memberEnd - offset]! ^= 1;
      assert.throws(() => nativeGunzip(corrupt));
      assert.throws(() => decompressBoundedGzip(corrupt, OPTIONS), /Fixture gzip is invalid/u);
    }
  }
  for (const value of [join(nativeGzip(new Uint8Array()), first), join(first, nativeGzip(new Uint8Array()))]) {
    assert.equal(decoder.decode(decompressBoundedGzip(value, OPTIONS)), 'first');
  }
});

test('validates optional GZIP headers and their checksum without retaining metadata', () => {
  const base = nativeGzip(encoder.encode('fixture'));
  const header = join(base.subarray(0, 10), new Uint8Array([3, 0, 1, 2, 3]), encoder.encode('fixture.txt\0comment\0'));
  header[3] = 2 | 4 | 8 | 16;
  const checksum = crc32(header) & 0xffff;
  const member = join(header, new Uint8Array([checksum & 0xff, checksum >>> 8]), base.subarray(10));
  assert.equal(decoder.decode(decompressBoundedGzip(member, OPTIONS)), 'fixture');
  assert.deepEqual(decompressBoundedGzip(member, OPTIONS), new Uint8Array(nativeGunzip(member)));
  const corrupt = member.slice();
  corrupt[header.byteLength]! ^= 1;
  assert.throws(() => decompressBoundedGzip(corrupt, OPTIONS), /Fixture gzip is invalid/u);
  for (const flags of [0x20, 0x40, 0x80]) {
    const invalid = base.slice();
    invalid[3] = flags;
    assert.throws(() => decompressBoundedGzip(invalid, OPTIONS), /Fixture gzip is invalid/u);
  }
  for (const truncated of [member.subarray(0, 9), member.subarray(0, header.byteLength), member.subarray(0, member.byteLength - 1)]) {
    assert.throws(() => decompressBoundedGzip(truncated, OPTIONS), /Fixture gzip is invalid/u);
  }
});

test('preserves input chunk, output and view-offset boundaries while checking trailers', () => {
  const body = Uint8Array.from({ length: 4096 }, (_, index) => (index * 73 + (index >>> 3)) & 0xff);
  const compressed = nativeGzip(body, { level: 0 });
  assert.ok(compressed.byteLength > BOUNDED_GZIP_INPUT_CHUNK_BYTES * 4);
  const carrier = join(new Uint8Array(7), compressed, new Uint8Array(11));
  const view = carrier.subarray(7, 7 + compressed.byteLength);
  assert.deepEqual(decompressBoundedGzip(view, { ...OPTIONS, maximumOutputBytes: body.byteLength }), body);
  assert.throws(() => decompressBoundedGzip(view, { ...OPTIONS, maximumOutputBytes: body.byteLength - 1 }), /exceeds its limit/u);
  const mixed = join(compressed, nativeGzip(encoder.encode('last')));
  assert.equal(decompressBoundedGzip(mixed, { ...OPTIONS, maximumOutputBytes: body.byteLength + 4 }).byteLength, body.byteLength + 4);
});

test('expands valid and concatenated gzip members through bounded input chunks', () => {
  assert.equal(BOUNDED_GZIP_INPUT_CHUNK_BYTES, 1_024);
  assert.equal(decoder.decode(decompressBoundedGzip(gzipSync(encoder.encode('first')), OPTIONS)), 'first');
  const first = gzipSync(encoder.encode('first'));
  const second = gzipSync(encoder.encode('second'));
  const concatenated = new Uint8Array(first.byteLength + second.byteLength);
  concatenated.set(first);
  concatenated.set(second, first.byteLength);
  assert.equal(decoder.decode(decompressBoundedGzip(concatenated, OPTIONS)), 'firstsecond');
});

test('rejects invalid, empty and over-limit gzip expansion with stable errors', () => {
  assert.throws(() => decompressBoundedGzip(new Uint8Array([1, 2, 3]), OPTIONS), /Fixture gzip is invalid/u);
  assert.throws(
    () => decompressBoundedGzip(gzipSync(new Uint8Array(65)), OPTIONS),
    /Expanded fixture exceeds its limit/u,
  );
  assert.throws(
    () => decompressBoundedGzip(gzipSync(encoder.encode('x')), { ...OPTIONS, maximumOutputBytes: 0 }),
    /Expanded fixture exceeds its limit/u,
  );
  assert.throws(
    () => decompressBoundedGzip(gzipSync(new Uint8Array()), OPTIONS),
    /Fixture gzip is empty/u,
  );
});
