// Perceptual (fuzzy) favicon hashing - complements the exact SHA-256 in
// lib/favicon.js. An exact hash only catches a byte-for-byte copied favicon;
// a lookalike that resized, recompressed, or re-saved the brand's icon (very
// common - the copy passes through a different tool than the original) slips
// past it while still being visually identical. A perceptual hash catches
// those near-clones, with the exact hash retained as the higher-confidence
// tier.
//
// Pure JS, no external dependency and no native bindings, so it runs the same
// on the serverless (Netlify) and self-hosted (Express) paths. That means
// decoding the image ourselves: Node has no built-in image decoder, only
// zlib (used here for PNG inflate). We support the favicon formats that
// actually occur in practice - PNG, and PNG- or BMP-encoded ICO - and return
// null for anything else (GIF/JPEG/SVG), which simply falls back to
// exact-hash-only, exactly as before this module existed.
//
// The hash itself is a 64-bit dHash (difference hash): downscale to 9x8
// grayscale and record, per row, whether each pixel is brighter than its
// right-hand neighbour. dHash is intentionally robust to scale and to
// uniform brightness/contrast shifts, which is exactly the resave/recompress
// case, while staying cheap (no DCT). Output is 16 lowercase hex chars;
// similarity is the Hamming distance between two such strings.

const zlib = require('zlib');

// Bound the decode work on attacker-controlled image bytes. Real favicons top
// out around 256x256; anything claiming to be larger is refused rather than
// decoded (it would also never be a legitimate favicon to compare against).
const MAX_DIM = 1024;

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function isPng(buf) {
  return buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE);
}

// ICO container: reserved(0) + type(1 = icon) as two little-endian uint16s.
function isIco(buf) {
  return buf.length >= 6 && buf.readUInt16LE(0) === 0 && buf.readUInt16LE(2) === 1;
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// Decodes the subset of PNG that favicons actually use: 8-bit depth,
// non-interlaced, colour types 0/2/3/6 (gray, RGB, palette, RGBA). Returns
// { width, height, pixels } with pixels as RGBA bytes, or null for anything
// outside that subset (or malformed input). CRCs are intentionally not
// verified - we're computing a fuzzy hash, not validating integrity.
function decodePng(buf) {
  const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette = null;
  let transparency = null;
  const idatParts = [];

  let offset = 8;
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buf.length) break; // truncated chunk
    const data = buf.subarray(dataStart, dataEnd);

    if (type === 'IHDR') {
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'tRNS') {
      transparency = data;
    } else if (type === 'IDAT') {
      idatParts.push(Buffer.from(data));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4; // skip the 4-byte CRC
  }

  const channels = CHANNELS[colorType];
  if (!channels || bitDepth !== 8 || interlace !== 0) return null;
  if (width < 1 || height < 1 || width > MAX_DIM || height > MAX_DIM) return null;
  if (colorType === 3 && !palette) return null;
  if (idatParts.length === 0) return null;

  // A valid non-interlaced 8-bit PNG decompresses to exactly one filter byte
  // plus one scanline per row. Cap the inflate at that size so a malicious
  // IDAT can't expand a sub-200KB favicon into hundreds of MB (a zip bomb)
  // and exhaust the process during concurrent deep scans - dimensions are
  // already bounded by MAX_DIM above, so this ceiling is a few MB at most.
  const stride = width * channels;
  const expandedLength = (stride + 1) * height;

  let raw;
  try {
    raw = zlib.inflateSync(Buffer.concat(idatParts), { maxOutputLength: expandedLength });
  } catch {
    return null; // malformed, or output would exceed the expected size
  }

  if (raw.length < expandedLength) return null;

  // Reverse the per-scanline PNG filters into the raw sample bytes.
  const recon = new Uint8Array(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filterType = raw[pos];
    pos += 1;
    for (let x = 0; x < stride; x += 1) {
      const rawVal = raw[pos + x];
      const a = x >= channels ? recon[y * stride + x - channels] : 0;
      const b = y > 0 ? recon[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? recon[(y - 1) * stride + x - channels] : 0;
      let value;
      switch (filterType) {
        case 0: value = rawVal; break;
        case 1: value = rawVal + a; break;
        case 2: value = rawVal + b; break;
        case 3: value = rawVal + ((a + b) >> 1); break;
        case 4: value = rawVal + paethPredictor(a, b, c); break;
        default: return null;
      }
      recon[y * stride + x] = value & 0xff;
    }
    pos += stride;
  }

  // Expand whatever colour type we decoded into a uniform RGBA buffer.
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const s = i * channels;
    let r;
    let g;
    let b;
    let alpha = 255;
    if (colorType === 0) {
      r = g = b = recon[s];
    } else if (colorType === 4) {
      r = g = b = recon[s];
      alpha = recon[s + 1];
    } else if (colorType === 2) {
      r = recon[s]; g = recon[s + 1]; b = recon[s + 2];
    } else if (colorType === 6) {
      r = recon[s]; g = recon[s + 1]; b = recon[s + 2]; alpha = recon[s + 3];
    } else { // palette
      const idx = recon[s];
      r = palette[idx * 3]; g = palette[idx * 3 + 1]; b = palette[idx * 3 + 2];
      if (transparency && idx < transparency.length) alpha = transparency[idx];
    }
    const d = i * 4;
    pixels[d] = r; pixels[d + 1] = g; pixels[d + 2] = b; pixels[d + 3] = alpha;
  }
  return { width, height, pixels };
}

// Decodes an uncompressed BMP DIB (the classic favicon.ico payload) - a
// BITMAPINFOHEADER, an optional palette (for <=8-bit depths), then bottom-up
// pixel rows. Supports the depths favicons actually ship: 1/4/8-bit
// palettized and 24/32-bit truecolour. The stored height is doubled (it
// includes the 1-bpp AND transparency mask); we use the real image height
// and ignore the mask (opaque is fine for a brightness-based hash).
function decodeDib(buf) {
  if (buf.length < 40) return null;
  const headerSize = buf.readUInt32LE(0);
  if (headerSize < 40) return null;
  const width = buf.readInt32LE(4);
  const rawHeight = buf.readInt32LE(8);
  const bitCount = buf.readUInt16LE(14);
  const compression = buf.readUInt32LE(16);
  if (compression !== 0) return null; // BI_RGB only
  if (![1, 4, 8, 24, 32].includes(bitCount)) return null;
  const height = Math.floor(Math.abs(rawHeight) / 2) || Math.abs(rawHeight);
  if (width < 1 || height < 1 || width > MAX_DIM || height > MAX_DIM) return null;

  // Palette (BGRA quads) for indexed depths, sitting between the header and
  // the pixel data. biClrUsed (offset 32) overrides the default 2^depth count.
  let palette = null;
  let pixelStart = headerSize;
  if (bitCount <= 8) {
    const declared = buf.readUInt32LE(32);
    const paletteCount = declared > 0 ? declared : (1 << bitCount);
    const paletteBytes = paletteCount * 4;
    if (headerSize + paletteBytes > buf.length) return null;
    palette = { start: headerSize, count: paletteCount };
    pixelStart = headerSize + paletteBytes;
  }

  const rowSize = Math.floor((bitCount * width + 31) / 32) * 4; // padded to 4 bytes
  if (pixelStart + rowSize * height > buf.length) return null;

  const paletteColor = (index) => {
    if (!palette || index >= palette.count) return [0, 0, 0];
    const p = palette.start + index * 4;
    return [buf[p + 2], buf[p + 1], buf[p]]; // stored BGRA -> RGB
  };

  const pixels = new Uint8ClampedArray(width * height * 4);
  let sawNonzeroAlpha = false;
  for (let y = 0; y < height; y += 1) {
    const srcRow = pixelStart + (height - 1 - y) * rowSize; // stored bottom-up
    for (let x = 0; x < width; x += 1) {
      let r;
      let g;
      let b;
      let alpha = 255;
      if (bitCount === 24 || bitCount === 32) {
        const s = srcRow + x * (bitCount / 8);
        b = buf[s]; g = buf[s + 1]; r = buf[s + 2];
        if (bitCount === 32) alpha = buf[s + 3];
      } else if (bitCount === 8) {
        [r, g, b] = paletteColor(buf[srcRow + x]);
      } else if (bitCount === 4) {
        const byte = buf[srcRow + (x >> 1)];
        const index = x & 1 ? byte & 0x0f : byte >> 4;
        [r, g, b] = paletteColor(index);
      } else { // 1-bit
        const byte = buf[srcRow + (x >> 3)];
        const index = (byte >> (7 - (x & 7))) & 1;
        [r, g, b] = paletteColor(index);
      }
      if (alpha !== 0) sawNonzeroAlpha = true;
      const d = (y * width + x) * 4;
      pixels[d] = r; pixels[d + 1] = g; pixels[d + 2] = b; pixels[d + 3] = alpha;
    }
  }
  // Many legacy 32-bit BMP-in-ICO payloads leave the alpha plane all-zero and
  // rely on the separate 1-bit AND mask for transparency. Trusting those alpha
  // bytes literally would composite the whole icon to white and hash to a
  // meaningless all-zero value, so treat a fully-zero alpha plane as opaque.
  if (bitCount === 32 && !sawNonzeroAlpha) {
    for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
  }
  return { width, height, pixels };
}

// Decodes an ICO directory, preferring the largest image (best detail for
// hashing) but falling back to progressively smaller entries when a larger
// one is in a variant we don't decode (e.g. a 4-bit-palette PNG sub-entry
// alongside a plain BMP one). A multi-size favicon.ico only needs one usable
// entry, and any size hashes to nearly the same dHash since it downsamples.
function decodeIco(buf) {
  const count = buf.readUInt16LE(4);
  if (count < 1 || 6 + count * 16 > buf.length) return null;
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    const entry = 6 + i * 16;
    const w = buf[entry] || 256;
    const h = buf[entry + 1] || 256;
    const size = buf.readUInt32LE(entry + 8);
    const dataOffset = buf.readUInt32LE(entry + 12);
    if (dataOffset + size > buf.length || size < 1) continue;
    entries.push({ area: w * h, dataOffset, size });
  }
  entries.sort((a, b) => b.area - a.area);
  for (const { dataOffset, size } of entries) {
    const payload = buf.subarray(dataOffset, dataOffset + size);
    const image = isPng(payload) ? decodePng(payload) : decodeDib(payload);
    if (image) return image;
  }
  return null;
}

function decodeImage(buf) {
  if (!Buffer.isBuffer(buf)) return null;
  if (isPng(buf)) return decodePng(buf);
  if (isIco(buf)) return decodeIco(buf);
  return null;
}

// Downscales to cols x rows of grayscale luma. Transparency is composited
// over white first, so a favicon with a transparent background hashes the
// same way it visually renders on this app's (and most) light surfaces,
// rather than letting undefined transparent RGB values swing the hash.
function grayscaleGrid(image, cols, rows) {
  const { width, height, pixels } = image;
  const grid = new Float64Array(cols * rows);
  for (let ty = 0; ty < rows; ty += 1) {
    const y0 = Math.floor((ty * height) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * height) / rows));
    for (let tx = 0; tx < cols; tx += 1) {
      const x0 = Math.floor((tx * width) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * width) / cols));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1 && y < height; y += 1) {
        for (let x = x0; x < x1 && x < width; x += 1) {
          const d = (y * width + x) * 4;
          const a = pixels[d + 3] / 255;
          const r = pixels[d] * a + 255 * (1 - a);
          const g = pixels[d + 1] * a + 255 * (1 - a);
          const b = pixels[d + 2] * a + 255 * (1 - a);
          sum += 0.299 * r + 0.587 * g + 0.114 * b;
          n += 1;
        }
      }
      grid[ty * cols + tx] = n ? sum / n : 0;
    }
  }
  return grid;
}

// dHash only records the *direction* of horizontal brightness changes, so a
// whole class of icons - a solid-colour square, but also any image whose
// brightness is monotonic left-to-right or varies only vertically - produces
// the same all-zero hash regardless of their actual appearance. Two such
// icons would then read as a perceptual match, falsely scoring risk and
// clustering unrelated domains. This is a property of the resulting *hash*,
// not the source image's variance (a bright left-to-right gradient has high
// variance yet still hashes to all zeros), so it's checked on the bit
// population of the finished hash: too few or too many set bits carries too
// little structure to compare safely, so we return no perceptual hash
// (callers fall back to the exact hash) rather than a collision-prone one.
// isInformativeHash re-checks this at comparison time too, since a Brand
// Profile saved before this guard existed may already hold a degenerate hash.
const MIN_INFORMATIVE_BITS = 10;

function popcountHex(hex) {
  let bits = 0;
  for (let i = 0; i < hex.length; i += 1) bits += POPCOUNT[parseInt(hex[i], 16)];
  return bits;
}

function isInformativeHash(hex) {
  if (typeof hex !== 'string' || !HEX_HASH_RE.test(hex)) return false;
  const bits = popcountHex(hex);
  return bits >= MIN_INFORMATIVE_BITS && bits <= 64 - MIN_INFORMATIVE_BITS;
}

// 64-bit dHash over a 9x8 grid -> 16 hex chars, or null when the resulting
// hash is degenerate (see MIN_INFORMATIVE_BITS). Each row contributes 8 bits:
// bit set when a cell is brighter than its right-hand neighbour.
function dHash(image) {
  const cols = 9;
  const rows = 8;
  const grid = grayscaleGrid(image, cols, rows);
  let hex = '';
  for (let y = 0; y < rows; y += 1) {
    let nibble = 0;
    let bitsInNibble = 0;
    for (let x = 0; x < cols - 1; x += 1) {
      const bit = grid[y * cols + x] > grid[y * cols + x + 1] ? 1 : 0;
      nibble = (nibble << 1) | bit;
      bitsInNibble += 1;
      if (bitsInNibble === 4) {
        hex += nibble.toString(16);
        nibble = 0;
        bitsInNibble = 0;
      }
    }
  }
  return isInformativeHash(hex) ? hex : null;
}

/**
 * Computes a perceptual (dHash) hex string for favicon bytes, or null if the
 * image can't be decoded (unsupported format, malformed, oversized). Never
 * throws - callers treat null as "no perceptual signal available", falling
 * back to the exact hash.
 * @param {Buffer} buf
 * @returns {string | null}
 */
function faviconPerceptualHash(buf) {
  try {
    const image = decodeImage(buf);
    if (!image) return null;
    return dHash(image);
  } catch {
    return null;
  }
}

const HEX_HASH_RE = /^[0-9a-f]{16}$/;
const POPCOUNT = new Uint8Array(16);
for (let i = 0; i < 16; i += 1) POPCOUNT[i] = (i & 1) + ((i >> 1) & 1) + ((i >> 2) & 1) + ((i >> 3) & 1);

/**
 * Hamming distance (0-64) between two 16-hex dHash strings, or null if either
 * isn't a well-formed hash. Smaller = more visually similar.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {number | null}
 */
function hammingDistanceHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return null;
  if (!HEX_HASH_RE.test(a) || !HEX_HASH_RE.test(b)) return null;
  let distance = 0;
  for (let i = 0; i < 16; i += 1) {
    distance += POPCOUNT[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  }
  return distance;
}

module.exports = { faviconPerceptualHash, hammingDistanceHex };
