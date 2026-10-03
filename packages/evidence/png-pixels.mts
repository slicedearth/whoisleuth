import { decode, convertIndexedToRgb, hasPngSignature } from 'fast-png';
import { Unzlib } from 'fflate';
import { updateCrc32 } from '../interchange/crc32.mts';
import { readEvidenceImageDimensions } from './image-regions.mts';

/** Admit PNG structure and inflated work before the image library allocates it. */
export function decodeEvidencePng(bytes: Uint8Array) {
  if (!(bytes instanceof Uint8Array) || !(bytes.buffer instanceof ArrayBuffer) || !hasPngSignature(bytes) || bytes.byteLength < 33) throw new TypeError('Select a valid PNG image.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13 || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') throw new TypeError('The PNG header is malformed.');
  const { width, height } = readEvidenceImageDimensions(view.getUint32(16), view.getUint32(20));
  if (bytes[24]! < 8 && bytes[28] !== 0) throw new TypeError('Convert this interlaced low-bit-depth PNG to a non-interlaced image before review.');
  const maximumInflatedBytes = width * height * 8 + height * 8 + 64;
  let inflatedBytes = 0;
  const inflater = new Unzlib(chunk => {
    inflatedBytes += chunk.byteLength;
    if (inflatedBytes > maximumInflatedBytes) throw new TypeError('The PNG exceeds its dimension-derived decompression bound.');
  });
  const selected: Uint8Array[] = [bytes.subarray(0, 8)];
  let offset = 8, total = 8, ended = false, imageData = false, dataEnded = false, header = false, palette = false, transparency = false;
  while (offset < bytes.byteLength) {
    if (bytes.byteLength - offset < 12) throw new TypeError('The PNG contains a truncated chunk.');
    const length = view.getUint32(offset), end = offset + length + 12;
    if (end > bytes.byteLength) throw new TypeError('The PNG contains a truncated chunk.');
    const kind = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (!/^[A-Za-z]{4}$/u.test(kind)) throw new TypeError('The PNG contains an invalid chunk type.');
    const crc = (updateCrc32(0xffff_ffff, bytes.subarray(offset + 4, end - 4)) ^ 0xffff_ffff) >>> 0;
    if (crc !== view.getUint32(end - 4)) throw new TypeError('The PNG chunk checksum does not match.');
    if (kind === 'acTL' || kind === 'fcTL' || kind === 'fdAT') throw new TypeError('Select a still PNG image; animated frames are not silently omitted.');
    if (kind === 'IHDR') {
      if (header || offset !== 8 || length !== 13) throw new TypeError('The PNG has conflicting headers.');
      header = true;
    } else if (kind === 'PLTE') {
      if (palette || imageData || !length || length > 768 || length % 3) throw new TypeError('The PNG palette is malformed.');
      palette = true;
    } else if (kind === 'tRNS') {
      if (transparency || imageData || length > 256) throw new TypeError('The PNG transparency data is malformed.');
      transparency = true;
    } else if (kind === 'IDAT') {
      if (dataEnded) throw new TypeError('The PNG image-data chunks are not consecutive.');
      imageData = true;
      // A small compressed slice bounds transient inflation before the callback.
      for (let position = offset + 8; position < end - 4; position += 1_024) inflater.push(bytes.subarray(position, Math.min(position + 1_024, end - 4)), false);
    } else if (kind === 'IEND') {
      if (length || !imageData || end !== bytes.byteLength) throw new TypeError('The PNG trailer is malformed.');
      ended = true;
    } else if (kind[0] === kind[0]!.toUpperCase()) throw new TypeError('The PNG has an unsupported critical chunk.');
    if (imageData && kind !== 'IDAT') dataEnded = true;
    // Colour-profile and text metadata are irrelevant to QR pixel analysis and
    // may contain independent compressed payloads. Never decode those payloads.
    if (['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'].includes(kind)) { const part = bytes.subarray(offset, end); selected.push(part); total += part.byteLength; }
    offset = end;
  }
  if (!ended) throw new TypeError('The PNG trailer is missing.');
  inflater.push(new Uint8Array(), true);
  const admitted = new Uint8Array(total);
  let position = 0;
  for (const part of selected) { admitted.set(part, position); position += part.byteLength; }
  let image = decode(admitted, { checkCrc: true });
  if (image.width !== width || image.height !== height) throw new TypeError('The decoded PNG dimensions changed.');
  if (image.depth < 8 && !image.palette && image.channels === 1) {
    const maximum = (1 << image.depth) - 1;
    // Use the library's packed-sample conversion for grayscale as well as
    // indexed images; a generated grayscale palette does not parse new bytes.
    image = { ...image, palette: Array.from({ length: maximum + 1 }, (_, value) => {
      const grey = Math.round(value * 255 / maximum);
      return [grey, grey, grey, image.transparency?.[0] === value ? 0 : 255];
    }) };
  }
  const indexed = Boolean(image.palette), samples = indexed ? convertIndexedToRgb(image) : image.data;
  const channels = indexed ? image.palette![0]!.length : image.channels;
  if (![1, 2, 3, 4].includes(channels) || samples.length !== width * height * channels) throw new TypeError('The PNG pixel layout is unsupported.');
  const pixels = new Uint8ClampedArray(width * height * 4);
  const sample = (index: number) => image.depth === 16 && !indexed ? Math.round(samples[index]! / 257) : samples[index]!;
  for (let index = 0; index < width * height; index++) {
    const source = index * channels, target = index * 4;
    pixels[target] = sample(source);
    pixels[target + 1] = channels <= 2 ? sample(source) : sample(source + 1);
    pixels[target + 2] = channels <= 2 ? sample(source) : sample(source + 2);
    pixels[target + 3] = channels === 2 || channels === 4 ? sample(source + channels - 1) : 255;
    if (!indexed && image.transparency && (channels === 1 ? samples[source] === image.transparency[0]
      : channels === 3 && [0, 1, 2].every(channel => samples[source + channel] === image.transparency![channel]))) pixels[target + 3] = 0;
  }
  return { width, height, pixels };
}
