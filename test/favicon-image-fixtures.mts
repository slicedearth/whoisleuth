import { crc32, deflateSync } from 'node:zlib';

export const ICON_SIZE = 32;

function luminance(x: number, y: number): number { return (x * 40 + y * 80) % 256; }

function pngChunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length);
  header.write(type, 4, 'ascii');
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([header.subarray(4), data])));
  return Buffer.concat([header, data, checksum]);
}

function png(colourType: 0 | 2 | 6): Buffer {
  const channels = colourType === 0 ? 1 : colourType === 2 ? 3 : 4;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(ICON_SIZE);
  header.writeUInt32BE(ICON_SIZE, 4);
  header[8] = 8;
  header[9] = colourType;
  const stride = ICON_SIZE * channels + 1;
  const samples = Buffer.alloc(stride * ICON_SIZE);
  for (let y = 0; y < ICON_SIZE; y += 1) {
    for (let x = 0; x < ICON_SIZE; x += 1) {
      const value = luminance(x, y);
      const offset = y * stride + 1 + x * channels;
      samples.fill(value, offset, offset + Math.min(channels, 3));
      if (colourType === 6) samples[offset + 3] = value === 0 ? 0 : 255;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    ...(colourType === 6 ? [] : [pngChunk('tRNS', Buffer.alloc(colourType === 0 ? 2 : 6))]),
    pngChunk('IDAT', deflateSync(samples)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function ico(bits: 24 | 32, legacyAlpha = false): Buffer {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40);
  header.writeInt32LE(ICON_SIZE, 4);
  header.writeInt32LE(ICON_SIZE * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(bits, 14);
  const channels = bits / 8;
  const stride = Math.ceil(ICON_SIZE * channels / 4) * 4;
  const maskStride = Math.ceil(ICON_SIZE / 32) * 4;
  const pixels = Buffer.alloc(stride * ICON_SIZE);
  const mask = Buffer.alloc(maskStride * ICON_SIZE);
  for (let y = 0; y < ICON_SIZE; y += 1) {
    for (let x = 0; x < ICON_SIZE; x += 1) {
      const value = luminance(x, y);
      const row = ICON_SIZE - 1 - y;
      const offset = row * stride + x * channels;
      pixels.fill(value, offset, offset + 3);
      if (bits === 32) pixels[offset + 3] = legacyAlpha || value === 0 ? 0 : 255;
      if (value === 0) mask[row * maskStride + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  const bitmap = Buffer.concat([header, pixels, mask]);
  const directory = Buffer.alloc(22);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(1, 4);
  directory[6] = directory[7] = ICON_SIZE;
  directory.writeUInt16LE(1, 10);
  directory.writeUInt16LE(bits, 12);
  directory.writeUInt32LE(bitmap.length, 14);
  directory.writeUInt32LE(directory.length, 18);
  return Buffer.concat([directory, bitmap]);
}

// These containers have independently specified pixels, real PNG CRCs and
// complete ICO masks. Transparent pixels have black RGB, including after a
// native canvas round trip, so all RGBA bytes can be compared directly.
export function faviconTransparencyFixtures() {
  return [
    { name: 'RGBA PNG', mime: 'image/png', bytes: png(6) },
    { name: 'RGB colour-key PNG', mime: 'image/png', bytes: png(2) },
    { name: 'greyscale colour-key PNG', mime: 'image/png', bytes: png(0) },
    { name: '24-bit masked ICO', mime: 'image/x-icon', bytes: ico(24) },
    { name: '32-bit legacy-alpha masked ICO', mime: 'image/x-icon', bytes: ico(32, true) },
    { name: '32-bit alpha ICO', mime: 'image/x-icon', bytes: ico(32) },
  ];
}

export function expectedIconPixels(): number[] {
  return Array.from({ length: ICON_SIZE * ICON_SIZE }, (_, index) => {
    const value = luminance(index % ICON_SIZE, Math.floor(index / ICON_SIZE));
    return [value, value, value, value === 0 ? 0 : 255];
  }).flat();
}

export const EXACT_ONLY_SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><path d="M0 0h1v1H0z"/></svg>');
export const EXACT_ONLY_GIF = Buffer.from([
  ...Buffer.from('GIF89a'), 1, 0, 1, 0, 0x80, 0, 0,
  0, 0, 0, 255, 255, 255, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0,
  2, 2, 0x44, 1, 0, 0x3b,
]);
