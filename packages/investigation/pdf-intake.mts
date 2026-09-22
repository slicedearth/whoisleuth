import { getDocument, ImageKind, OPS, type PDFWorker } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createDocumentIntake } from './document-intake.mts';
import { MAX_DOCUMENT_IMAGE_PIXELS, MAX_DOCUMENT_PAGES, MAX_DOCUMENT_TEXT_BYTES,
  MAX_DOCUMENT_PAGE_OPERATIONS } from '../contracts/document-intake.mts';
import { readEvidenceImageDimensions } from '../evidence/image-regions.mts';
import { MAX_INTAKE_LINKS, MAX_INTAKE_URL_LENGTH } from '../contracts/message-intake.mts';

/** No document-controlled resource can reach a filesystem or network fetcher. */
class NoExternalBinaryData {
  async fetch(): Promise<never> { throw new TypeError('External PDF resources are not loaded.'); }
}

function imagePixels(raw: unknown) {
  if (!raw || typeof raw !== 'object') throw new TypeError('The PDF image is unavailable.');
  const value = raw as { width?: unknown; height?: unknown; kind?: unknown; data?: unknown };
  const { width, height } = readEvidenceImageDimensions(value.width, value.height);
  if (!(value.data instanceof Uint8Array) && !(value.data instanceof Uint8ClampedArray)) throw new TypeError('The PDF image has no supported pixel data.');
  const data = value.data, count = width * height, pixels = new Uint8ClampedArray(count * 4);
  if (value.kind === ImageKind.RGBA_32BPP && data.length === pixels.length) pixels.set(data);
  else if (value.kind === ImageKind.RGB_24BPP && data.length === count * 3) {
    for (let index = 0; index < count; index++) { pixels.set(data.subarray(index * 3, index * 3 + 3), index * 4); pixels[index * 4 + 3] = 255; }
  } else if (value.kind === ImageKind.GRAYSCALE_1BPP && data.length === Math.ceil(width / 8) * height) {
    const stride = Math.ceil(width / 8);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const colour = data[y * stride + (x >> 3)]! & (128 >> (x % 8)) ? 255 : 0;
      pixels.set([colour, colour, colour, 255], (y * width + x) * 4);
    }
  } else throw new TypeError('The PDF image pixel layout is unsupported.');
  return { width, height, pixels };
}

export async function reviewPdfInput(bytes: Uint8Array, reviewedAt: string, worker?: PDFWorker) {
  const review = await createDocumentIntake(bytes, 'pdf', reviewedAt);
  // PDF.js takes ownership of its input. The selected original stays unchanged.
  const task = getDocument({ data: bytes.slice(), ...(worker ? { worker } : {}),
    BinaryDataFactory: NoExternalBinaryData, useWorkerFetch: false, useWasm: false,
    useSystemFonts: false, disableFontFace: true, enableXfa: false,
    isOffscreenCanvasSupported: false, isImageDecoderSupported: false,
    maxImageSize: MAX_DOCUMENT_IMAGE_PIXELS, stopAtErrors: true, verbosity: 0,
    disableAutoFetch: true, disableStream: true, disableRange: true });
  try {
    const document = await task.promise;
    const total = document.numPages, admitted = Math.min(total, MAX_DOCUMENT_PAGES);
    review.pages(total, 0);
    if (total > admitted) review.partial('Further PDF pages exceed the page review bound.');
    if (document.isPureXfa) { review.unavailable('unsupported', 'XFA documents are not rendered or executed.'); return review.finish(); }
    let textCharacters = 0;
    for (let pageNumber = 1; pageNumber <= admitted; pageNumber++) {
      const page = await document.getPage(pageNumber);
      try {
        const reader = page.streamTextContent().getReader();
        let text = '';
        try {
          for (;;) {
            const chunk = await reader.read(); if (chunk.done) break;
            for (const item of chunk.value.items as Array<{ str?: unknown; hasEOL?: boolean }>) {
              if (typeof item.str !== 'string') continue;
              textCharacters += item.str.length + 1;
              if (textCharacters > MAX_DOCUMENT_TEXT_BYTES) { review.partial('Further PDF text exceeds the text review bound.'); break; }
              text += item.str + (item.hasEOL ? '\n' : ' ');
            }
            if (textCharacters > MAX_DOCUMENT_TEXT_BYTES) { await reader.cancel(); break; }
          }
          await review.text(text, pageNumber);
        } catch { review.partial(`Text on page ${pageNumber} could not be fully decoded.`); }
        finally { reader.releaseLock(); }
        try {
          const annotations = await page.getAnnotations(), destinations: string[] = [];
          for (const annotation of annotations) {
            if (typeof annotation.url !== 'string') continue;
            if (annotation.url.length > MAX_INTAKE_URL_LENGTH || destinations.length >= MAX_INTAKE_LINKS) { review.partial(`Some links on page ${pageNumber} exceed the link review bound.`); continue; }
            destinations.push(annotation.url);
          }
          await review.destinations(destinations, pageNumber);
        } catch { review.partial(`Links on page ${pageNumber} could not be fully decoded.`); }
        try {
          const operations = await page.getOperatorList(), seen = new Set<string>();
          if (operations.fnArray.length > MAX_DOCUMENT_PAGE_OPERATIONS) review.partial(`Image operations on page ${pageNumber} exceed the review bound.`);
          else for (let index = 0; index < operations.fnArray.length; index++) {
            const operation = operations.fnArray[index], args = operations.argsArray[index];
            let raw: unknown;
            if (operation === OPS.paintImageXObject || operation === OPS.paintImageXObjectRepeat) {
              const id: unknown = args?.[0];
              if (typeof id !== 'string' || seen.has(id)) continue;
              seen.add(id);
              raw = await new Promise(resolve => (id.startsWith('g_') ? page.commonObjs : page.objs).get(id, resolve));
            } else if (operation === OPS.paintInlineImageXObject) raw = args?.[0];
            else continue;
            try { await review.image(imagePixels(raw), pageNumber); }
            catch { review.partial(`An image on page ${pageNumber} has unsupported or unavailable pixels.`); }
          }
        } catch { review.partial(`Image operations on page ${pageNumber} could not be fully decoded.`); }
        review.pages(total, pageNumber);
      } finally { page.cleanup(); }
    }
    review.partial('QR review covers decoded embedded raster images, not vector artwork or a rendered-page reconstruction. Scripts, forms, embedded files and external resources are not executed or opened.');
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'PasswordException') review.unavailable('encrypted', 'The PDF requires a password. Review an explicitly decrypted copy; no password was requested or retained.');
    else review.unavailable('unsupported', 'The PDF could not be decoded completely within this review. The original bytes are unchanged.');
  } finally { await task.destroy(); }
  return review.finish();
}
