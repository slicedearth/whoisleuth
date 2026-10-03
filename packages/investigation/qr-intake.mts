import { binarize, Decoder, Detector } from '@nuintun/qrcode';
import { decodeEvidencePng } from '../evidence/png-pixels.mts';
import { assertMessageBytes, reviewMessageInput } from './message-intake.mts';
import { readEvidenceImageDimensions } from '../evidence/image-regions.mts';

export const MAX_QR_DETECTION_ATTEMPTS = 256;

export function decodeQrPixels(image: Readonly<{ width: number; height: number; pixels: Uint8ClampedArray }>) {
  readEvidenceImageDimensions(image.width, image.height);
  if (!(image.pixels instanceof Uint8ClampedArray) || image.pixels.length !== image.width * image.height * 4) throw new TypeError('Invalid QR pixel surface.');
  const luminance = new Uint8Array(image.width * image.height);
  for (let index = 0; index < luminance.length; index++) {
    const offset = index * 4, alpha = image.pixels[offset + 3]! / 255;
    luminance[index] = Math.round((image.pixels[offset]! * 0.299 + image.pixels[offset + 1]! * 0.587 + image.pixels[offset + 2]! * 0.114) * alpha + 255 * (1 - alpha));
  }
  const texts = new Set<string>();
  let attempts = 0, bounded = false, structured = false;
  // Normal and inverted symbols are both considered, without altering originals.
  for (const inverted of [false, true]) {
    if (inverted) for (let index = 0; index < luminance.length; index++) luminance[index] = 255 - luminance[index]!;
    const candidates = new Detector().detect(binarize(luminance, image.width, image.height)), decoder = new Decoder();
    let candidate = candidates.next();
    while (!candidate.done) {
      if (++attempts > MAX_QR_DETECTION_ATTEMPTS) { bounded = true; candidates.return(); break; }
      let decoded = false;
      try {
        const symbol = decoder.decode(candidate.value.matrix);
        decoded = true;
        if (symbol.structured) structured = true;
        else if (symbol.content.length <= 8_192) texts.add(symbol.content);
        else bounded = true;
      } catch { /* A finder-pattern candidate need not contain a decodable symbol. */ }
      candidate = candidates.next(decoded);
    }
    if (bounded) break;
  }
  return { texts: [...texts], bounded, structured };
}

export async function reviewQrInput(bytes: Uint8Array, reviewedAt: string) {
  assertMessageBytes(bytes);
  const { texts, bounded, structured } = decodeQrPixels(decodeEvidencePng(bytes));
  const result = await reviewMessageInput(bytes, 'qr', reviewedAt, texts);
  const boundsReached = [...result.report.coverage.boundsReached, ...(bounded ? ['QR candidate work'] : []), ...(structured ? ['Multi-symbol structured content requires reassembly'] : [])];
  return { ...result, report: { ...result.report, coverage: { ...result.report.coverage,
    state: boundsReached.length ? 'partial' as const : result.report.coverage.state, boundsReached } } };
}
