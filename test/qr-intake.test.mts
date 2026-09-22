import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Encoder, Byte } from '@nuintun/qrcode';
import { encode } from 'fast-png';
import { zlibSync } from 'fflate';
import { reviewQrInput } from '../packages/investigation/qr-intake.mts';
import { decodeEvidencePng } from '../packages/evidence/png-pixels.mts';
import { updateCrc32 } from '../packages/interchange/crc32.mts';

function image(value: string, inverted = false) {
  const qr = new Encoder().encode(new Byte(value)), width = (qr.size + 8) * 4, data = new Uint8Array(width * width * 4);
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const qx = Math.floor(x / 4) - 4, qy = Math.floor(y / 4) - 4;
    const black = qx >= 0 && qy >= 0 && qx < qr.size && qy < qr.size && Boolean(qr.get(qx, qy));
    const colour = black !== inverted ? 0 : 255, offset = (y * width + x) * 4;
    data.set([colour, colour, colour, 255], offset);
  }
  return encode({ width, height: width, data, channels: 4 });
}
const now = '2026-09-22T00:00:00Z';

function chunk(kind: string, data: Uint8Array) {
  const bytes = new Uint8Array(data.length + 12), view = new DataView(bytes.buffer);
  view.setUint32(0, data.length); bytes.set(new TextEncoder().encode(kind), 4); bytes.set(data, 8);
  view.setUint32(bytes.length - 4, (updateCrc32(0xffff_ffff, bytes.subarray(4, -4)) ^ 0xffff_ffff) >>> 0);
  return bytes;
}
function png(header: Uint8Array, raw: Uint8Array) {
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlibSync(raw)), chunk('IEND', new Uint8Array())];
  const bytes = new Uint8Array(parts.reduce((size, part) => size + part.length, 0)); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}

test('packed grayscale images preserve row padding and unsupported interlacing is explicit', () => {
  for (const depth of [1, 2, 4]) {
    const header = new Uint8Array(13), view = new DataView(header.buffer);
    view.setUint32(0, 3); view.setUint32(4, 2); header.set([depth, 0, 0, 0, 0], 8);
    const stride = Math.ceil(3 * depth / 8), raw = new Uint8Array((stride + 1) * 2);
    raw.set(new Uint8Array(stride).fill(255), stride + 2);
    const decoded = decodeEvidencePng(png(header, raw));
    assert.deepEqual([...decoded.pixels], [0,0,0,255, 0,0,0,255, 0,0,0,255, 255,255,255,255, 255,255,255,255, 255,255,255,255]);
    header[12] = 1;
    assert.throws(() => decodeEvidencePng(png(header, raw)), /interlaced low-bit-depth/u);
  }
});

test('PNG QR analysis decodes normal and inverted selected images without retaining private query values', async () => {
  for (const inverted of [false, true]) {
    const result = await reviewQrInput(image('https://qr.example/private?token=secret', inverted), now);
    assert.deepEqual(result.report.links.map(link => link.origin), ['https://qr.example']);
    assert.equal(result.report.source.kind, 'qr');
    assert.equal(result.report.coverage.reviewedParts, 1);
    assert.equal(JSON.stringify(result.report).includes('secret'), false);
    assert.match(result.targets[0]!.exactUrl, /token=secret/u);
  }
});

test('a decoded non-URL QR is not executed or reported as a collected target', async () => {
  const result = await reviewQrInput(image('WIFI:T:WPA;S:private-name;P:private-password;;'), now);
  assert.equal(result.report.coverage.reviewedParts, 1);
  assert.deepEqual(result.report.links, []);
  assert.equal(JSON.stringify(result.report).includes('private'), false);
});

test('blank, corrupt, oversized and truncated PNGs remain distinct from decoded QR content', async () => {
  const blank = encode({ width: 32, height: 32, data: new Uint8Array(32 * 32 * 4).fill(255), channels: 4 });
  assert.equal((await reviewQrInput(blank, now)).report.coverage.reviewedParts, 0);
  const corrupt = image('https://example.test'); corrupt[corrupt.length - 1]! ^= 1;
  await assert.rejects(reviewQrInput(corrupt, now), /checksum/u);
  await assert.rejects(reviewQrInput(blank.subarray(0, -8), now), /truncated/u);
  const oversized = blank.slice(); new DataView(oversized.buffer).setUint32(16, 100_000);
  assert.throws(() => decodeEvidencePng(oversized), /width/u);
});

test('PNG inflation cannot exceed its declared image dimensions', () => {
  const header = new Uint8Array(13), hv = new DataView(header.buffer); hv.setUint32(0, 1); hv.setUint32(4, 1); header.set([8, 6, 0, 0, 0], 8);
  const bomb = png(header, new Uint8Array(1_000_000));
  assert.throws(() => decodeEvidencePng(bomb), /decompression bound/u);
});
