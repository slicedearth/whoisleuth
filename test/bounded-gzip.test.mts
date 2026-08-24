import assert from 'node:assert/strict';
import { test } from 'node:test';

import { gzipSync } from 'fflate';

import {
  BOUNDED_GZIP_INPUT_CHUNK_BYTES,
  decompressBoundedGzip,
} from '../packages/interchange/bounded-gzip.mts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const OPTIONS = {
  maximumOutputBytes: 64,
  exceededMessage: 'Expanded fixture exceeds its limit.',
  invalidMessage: 'Fixture gzip is invalid.',
  emptyMessage: 'Fixture gzip is empty.',
};

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
