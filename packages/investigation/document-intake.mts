import { createIntakeReport } from './intake-report.mts';
import { createLinkIntake } from './link-intake.mts';
import { decodeQrPixels } from './qr-intake.mts';
import { sha256ArtifactBytes } from '../evidence/artifact-integrity.mts';
import { MAX_DOCUMENT_PARTS, MAX_DOCUMENT_TEXT_BYTES, MAX_DOCUMENT_TOTAL_IMAGE_PIXELS,
  type DocumentPart, type DocumentReview } from '../contracts/document-intake.mts';
import type { MessageIntakeResult } from '../contracts/message-intake.mts';

/** The format adapters provide inert text/pixels; this owner retains provenance and links. */
export async function createDocumentIntake(bytes: Uint8Array, kind: 'pdf' | 'docx', reviewedAt: string) {
  const base = await createIntakeReport(bytes, kind, reviewedAt), links = createLinkIntake();
  const parts: DocumentPart[] = [], notes = new Set<string>();
  let textBytes = 0, imagePixels = 0;
  let state: DocumentReview['state'] = 'reviewed', pageCount: number | null = null, reviewedPages = 0;
  const encoder = new TextEncoder();
  function partial(note: string) { if (state === 'reviewed') state = 'partial'; notes.add(note); }
  async function part(input: Omit<DocumentPart, 'id' | 'parentDigestSha256' | 'digestSha256' | 'byteLength'>, original: Uint8Array) {
    if (parts.length >= MAX_DOCUMENT_PARTS) { partial('Further document parts exceed the review bound.'); return null; }
    const value: DocumentPart = { ...input, id: `part-${parts.length + 1}`, parentDigestSha256: base.source.digestSha256,
      digestSha256: await sha256ArtifactBytes(original), byteLength: original.byteLength };
    parts.push(value); return { partId: value.id, page: value.page };
  }
  return {
    partial,
    unavailable(reason: 'encrypted' | 'unsupported', note: string) { state = reason; notes.add(note); },
    pages(total: number, reviewed: number) { pageCount = total; reviewedPages = reviewed; },
    async text(value: string, page: number | null, original?: Uint8Array) {
      if (value.length > MAX_DOCUMENT_TEXT_BYTES - textBytes) { partial('Further extracted text exceeds the review bound.'); return; }
      const encoded = encoder.encode(value); textBytes += encoded.byteLength;
      if (textBytes > MAX_DOCUMENT_TEXT_BYTES) { partial('Further extracted text exceeds the review bound.'); return; }
      const location = await part({ kind: 'text', page, identity: original ? 'original_part_bytes' : 'extracted_text', state: 'reviewed' }, original ?? encoded);
      if (location) links.addText(value, 'document_text', location);
    },
    async destinations(values: readonly string[], page: number | null, original?: Uint8Array) {
      const encoded = encoder.encode(JSON.stringify(values));
      if (encoded.byteLength > MAX_DOCUMENT_TEXT_BYTES - textBytes) { partial('Further document links exceed the review bound.'); return; }
      textBytes += encoded.byteLength;
      const location = await part({ kind: 'links', page, identity: original ? 'original_part_bytes' : 'extracted_links', state: 'reviewed' }, original ?? encoded);
      if (location) for (const value of values) links.add(value, 'document_link', '', null, 0, location);
    },
    async image(image: Readonly<{ width: number; height: number; pixels: Uint8ClampedArray }>, page: number | null, original?: Uint8Array) {
      imagePixels += image.width * image.height;
      if (imagePixels > MAX_DOCUMENT_TOTAL_IMAGE_PIXELS) { partial('Further image pixels exceed the aggregate QR review bound.'); return; }
      const decoded = decodeQrPixels(image);
      const location = await part({ kind: 'image', page, identity: original ? 'original_part_bytes' : 'decoded_rgba_pixels', state: decoded.bounded || decoded.structured ? 'partial' : 'reviewed' }, original ?? new Uint8Array(image.pixels.buffer, image.pixels.byteOffset, image.pixels.byteLength));
      if (location) for (const value of decoded.texts) links.addText(value, 'document_qr', location);
      if (decoded.bounded || decoded.structured) partial('Some QR candidates were bounded or require multi-symbol reassembly.');
    },
    finish(): MessageIntakeResult {
      const result = links.result();
      if (result.bounded) partial('Further extracted links exceed the review bound.');
      return { targets: result.targets, report: { ...base, links: result.links,
        coverage: { ...base.coverage, state: state === 'reviewed' ? 'reviewed' : 'partial', reviewedParts: parts.length, rejectedLinks: result.rejected },
        documentReview: { state, pageCount, reviewedPages, parts, notes: [...notes] } } };
    },
  };
}
export type DocumentIntake = Awaited<ReturnType<typeof createDocumentIntake>>;
