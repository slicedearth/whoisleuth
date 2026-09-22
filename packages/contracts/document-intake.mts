/** Input admission, decoded XML, page work and pixels are independently bounded. */
export const MAX_DOCUMENT_PARTS = 512;
export const MAX_DOCUMENT_PAGES = 256;
export const MAX_DOCUMENT_DECODED_BYTES = 32 * 1024 * 1024;
export const MAX_DOCUMENT_TEXT_BYTES = 8 * 1024 * 1024;
export const MAX_DOCUMENT_XML_NODES = 200_000;
export const MAX_DOCUMENT_PAGE_OPERATIONS = 200_000;
export const MAX_DOCUMENT_XML_DEPTH = 64;
export const MAX_DOCUMENT_IMAGE_PIXELS = 16 * 1024 * 1024;
export const MAX_DOCUMENT_TOTAL_IMAGE_PIXELS = 64 * 1024 * 1024;
export const DOCUMENT_REVIEW_DEADLINE_MS = 60_000;
export type DocumentPart = Readonly<{
  id: string;
  kind: 'text' | 'links' | 'image';
  page: number | null;
  parentDigestSha256: string;
  digestSha256: string;
  identity: 'original_part_bytes' | 'extracted_text' | 'extracted_links' | 'decoded_rgba_pixels';
  byteLength: number;
  state: 'reviewed' | 'partial' | 'unsupported';
}>;
export type DocumentReview = Readonly<{
  state: 'reviewed' | 'partial' | 'encrypted' | 'unsupported';
  pageCount: number | null;
  reviewedPages: number;
  parts: readonly DocumentPart[];
  notes: readonly string[];
}>;
