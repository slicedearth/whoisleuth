// Covers lib/perceptual-hash.js. Fixtures are built in-code rather than
// committed as binary blobs: the decoder ignores PNG CRCs, so a structurally
// valid chunk stream with placeholder CRCs is enough, and BMP/ICO containers
// are just packed byte layouts. The key properties under test are that the
// same underlying image rendered at different resolutions hashes to a *near*
// (small Hamming distance) value while a different image hashes *far*, plus
// that malformed input fails closed to null.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { faviconPerceptualHash, hammingDistanceHex } = require('../lib/perceptual-hash');

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); // decoder ignores CRCs
  return Buffer.concat([length, Buffer.from(type, 'ascii'), data, crc]);
}

// Builds an 8-bit RGBA (colour type 6) PNG from a pixel function.
function makePng(width, height, pixelFn) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // compression, filter, interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type: None
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixelFn(x, y);
      const p = y * (stride + 1) + 1 + x * 4;
      raw[p] = r; raw[p + 1] = g; raw[p + 2] = b; raw[p + 3] = a;
    }
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// A smooth pattern sampled in normalized coordinates, so the *same* image can
// be rendered at any resolution. Different frequencies => a different image.
function patternPng(size, fx, fy) {
  return makePng(size, size, (x, y) => {
    const u = x / (size - 1);
    const v = y / (size - 1);
    const lum = Math.round(127.5 * (1 + Math.sin(fx * u) * Math.cos(fy * v)));
    return [lum, lum, lum, 255];
  });
}

function icoWrapPng(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // count
  const entry = Buffer.alloc(16);
  entry[0] = 32; entry[1] = 32; // width, height
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bit count
  entry.writeUInt32LE(png.length, 8); // bytes in resource
  entry.writeUInt32LE(6 + 16, 12); // offset
  return Buffer.concat([header, entry, png]);
}

// A 24-bit uncompressed BMP DIB (bottom-up), height doubled per the ICO
// convention, wrapped in an ICO directory - exercises the classic
// favicon.ico decode path.
function icoWrapDib(size) {
  const rowSize = Math.floor((24 * size + 31) / 32) * 4;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // header size
  header.writeInt32LE(size, 4); // width
  header.writeInt32LE(size * 2, 8); // height (doubled: XOR + AND mask)
  header.writeUInt16LE(1, 12); // planes
  header.writeUInt16LE(24, 14); // bit count
  header.writeUInt32LE(0, 16); // BI_RGB
  const pixels = Buffer.alloc(rowSize * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // Vary in both axes so the resulting dHash is informative (a pure
      // horizontal gradient would be degenerate and correctly rejected).
      const lum = (x * 90 + y * 150) % 256;
      const p = y * rowSize + x * 3;
      pixels[p] = lum; pixels[p + 1] = lum; pixels[p + 2] = lum; // BGR
    }
  }
  const dib = Buffer.concat([header, pixels]);

  const icoHeader = Buffer.alloc(6);
  icoHeader.writeUInt16LE(0, 0);
  icoHeader.writeUInt16LE(1, 2);
  icoHeader.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = size; entry[1] = size;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(24, 6);
  entry.writeUInt32LE(dib.length, 8);
  entry.writeUInt32LE(6 + 16, 12);
  return Buffer.concat([icoHeader, entry, dib]);
}

// An 8-bit palettized BMP DIB in an ICO - the format Wikipedia/StackOverflow
// and many classic favicon.ico files actually ship (verified live), and the
// case that motivated widening the decoder past 24/32-bit.
function icoWrap8bitDib(size) {
  const colors = 4; // small grayscale palette to keep the fixture compact
  const rowSize = Math.floor((8 * size + 31) / 32) * 4;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(8, 14); // bit count
  header.writeUInt32LE(0, 16); // BI_RGB
  header.writeUInt32LE(colors, 32); // biClrUsed
  const palette = Buffer.alloc(colors * 4);
  for (let i = 0; i < colors; i += 1) {
    const lum = Math.round((i / (colors - 1)) * 255);
    palette[i * 4] = lum; palette[i * 4 + 1] = lum; palette[i * 4 + 2] = lum; // BGRA
  }
  const pixels = Buffer.alloc(rowSize * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      pixels[y * rowSize + x] = (x + y) % colors; // 2D pattern -> informative hash
    }
  }
  const dib = Buffer.concat([header, palette, pixels]);

  const icoHeader = Buffer.alloc(6);
  icoHeader.writeUInt16LE(0, 0);
  icoHeader.writeUInt16LE(1, 2);
  icoHeader.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = size; entry[1] = size;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(8, 6);
  entry.writeUInt32LE(dib.length, 8);
  entry.writeUInt32LE(6 + 16, 12);
  return Buffer.concat([icoHeader, entry, dib]);
}

// A PNG whose IDAT decompresses to far more than its declared 2x2 dimensions
// - a zip bomb. Decoding must refuse it (bounded inflate) rather than allocate
// the whole expansion.
function makeZipBombPng() {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const huge = Buffer.alloc(5 * 1024 * 1024, 0); // compresses tiny, expands large
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(huge)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// A 32-bit BMP-in-ICO whose pixels carry a real 2D pattern in BGR but whose
// alpha plane is entirely `alpha` - used to prove an all-zero alpha plane is
// treated as opaque rather than compositing the icon to white.
function icoWrap32bitDib(size, alpha) {
  const rowSize = size * 4;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  const pixels = Buffer.alloc(rowSize * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const lum = (x * 40 + y * 80) % 256; // varies in both axes -> non-trivial hash
      const p = y * rowSize + x * 4;
      pixels[p] = lum; pixels[p + 1] = lum; pixels[p + 2] = lum; pixels[p + 3] = alpha;
    }
  }
  const dib = Buffer.concat([header, pixels]);

  const icoHeader = Buffer.alloc(6);
  icoHeader.writeUInt16LE(0, 0);
  icoHeader.writeUInt16LE(1, 2);
  icoHeader.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = size; entry[1] = size;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(dib.length, 8);
  entry.writeUInt32LE(6 + 16, 12);
  return Buffer.concat([icoHeader, entry, dib]);
}

describe('faviconPerceptualHash', () => {
  test('produces a 16-char hex hash for a PNG', () => {
    const hash = faviconPerceptualHash(patternPng(32, 6, 5));
    assert.match(hash, /^[0-9a-f]{16}$/);
  });

  test('refuses a zip-bomb PNG instead of inflating it unbounded', () => {
    assert.equal(faviconPerceptualHash(makeZipBombPng()), null);
  });

  test('returns null for near-uniform icons (no dHash collision on solid colours)', () => {
    // Every solid colour hashes to all-zeros under dHash; without the
    // low-information guard, two different solid favicons would falsely match.
    const solidGray = faviconPerceptualHash(makePng(16, 16, () => [128, 128, 128, 255]));
    const solidRed = faviconPerceptualHash(makePng(16, 16, () => [200, 30, 30, 255]));
    const solidBlue = faviconPerceptualHash(makePng(16, 16, () => [30, 30, 200, 255]));
    assert.equal(solidGray, null);
    assert.equal(solidRed, null);
    assert.equal(solidBlue, null);
  });

  test('treats an all-zero 32-bit ICO alpha plane as opaque, not transparent-white', () => {
    const zeroAlpha = faviconPerceptualHash(icoWrap32bitDib(16, 0));
    const opaque = faviconPerceptualHash(icoWrap32bitDib(16, 255));
    // Without the fix the zero-alpha icon composites to white -> uniform ->
    // rejected as low-information (null); with it, it hashes like the opaque one.
    assert.match(zeroAlpha, /^[0-9a-f]{16}$/);
    assert.equal(hammingDistanceHex(zeroAlpha, opaque), 0);
  });

  test('the same image at a different resolution hashes near-identically', () => {
    const big = faviconPerceptualHash(patternPng(48, 6, 5));
    const small = faviconPerceptualHash(patternPng(16, 6, 5));
    const distance = hammingDistanceHex(big, small);
    assert.ok(distance <= 6, `expected small distance for a resized copy, got ${distance}`);
  });

  test('a visually different image hashes far away', () => {
    const a = faviconPerceptualHash(patternPng(32, 6, 5));
    const b = faviconPerceptualHash(patternPng(32, 13, 2));
    const distance = hammingDistanceHex(a, b);
    assert.ok(distance >= 12, `expected large distance for a different image, got ${distance}`);
  });

  test('decodes a PNG embedded in an ICO container', () => {
    const hash = faviconPerceptualHash(icoWrapPng(patternPng(32, 6, 5)));
    assert.match(hash, /^[0-9a-f]{16}$/);
    // Same underlying pixels, whether bare PNG or PNG-in-ICO.
    const bare = faviconPerceptualHash(patternPng(32, 6, 5));
    assert.equal(hammingDistanceHex(hash, bare), 0);
  });

  test('decodes a classic 24-bit BMP-in-ICO favicon', () => {
    const hash = faviconPerceptualHash(icoWrapDib(16));
    assert.match(hash, /^[0-9a-f]{16}$/);
  });

  test('decodes an 8-bit palettized BMP-in-ICO favicon', () => {
    const hash = faviconPerceptualHash(icoWrap8bitDib(16));
    assert.match(hash, /^[0-9a-f]{16}$/);
  });

  test('rejects a high-variance but monotonic gradient (degenerate hash)', () => {
    // A bright left-to-right gradient has high image variance yet still hashes
    // to all-zeros - the case the image-variance guard missed. Two unrelated
    // gradients must not become perceptual matches, so both are rejected.
    const gradient = makePng(24, 24, (x) => { const l = Math.round((x / 23) * 255); return [l, l, l, 255]; });
    assert.equal(faviconPerceptualHash(gradient), null);
    const verticalGradient = makePng(24, 24, (x, y) => { const l = Math.round((y / 23) * 255); return [l, l, l, 255]; });
    assert.equal(faviconPerceptualHash(verticalGradient), null);
  });

  test('returns null for unsupported or malformed input', () => {
    assert.equal(faviconPerceptualHash(Buffer.from('GIF89a nonsense')), null);
    assert.equal(faviconPerceptualHash(Buffer.from([0xff, 0xd8, 0xff])), null); // JPEG magic, unsupported
    assert.equal(faviconPerceptualHash(Buffer.alloc(0)), null);
    assert.equal(faviconPerceptualHash(Buffer.from('not an image at all')), null);
  });

  test('returns null for a truncated PNG', () => {
    const png = patternPng(32, 6, 5);
    assert.equal(faviconPerceptualHash(png.subarray(0, 30)), null);
  });
});

describe('hammingDistanceHex', () => {
  test('is zero for identical hashes', () => {
    assert.equal(hammingDistanceHex('0123456789abcdef', '0123456789abcdef'), 0);
  });

  test('counts differing bits', () => {
    // 0x0 vs 0xf in the last nibble = 4 differing bits.
    assert.equal(hammingDistanceHex('0000000000000000', '000000000000000f'), 4);
    assert.equal(hammingDistanceHex('0000000000000000', 'ffffffffffffffff'), 64);
  });

  test('returns null for malformed hashes', () => {
    assert.equal(hammingDistanceHex('short', '0123456789abcdef'), null);
    assert.equal(hammingDistanceHex('0123456789abcdeg', '0123456789abcdef'), null); // g not hex
    assert.equal(hammingDistanceHex(null, '0123456789abcdef'), null);
    assert.equal(hammingDistanceHex(42, '0123456789abcdef'), null);
  });
});
