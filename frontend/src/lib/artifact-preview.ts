import { MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES } from '../../../packages/investigation/investigation-manifest.mts';

export const ARTIFACT_TEXT_PAGE_BYTES = 32 * 1024;
// One decoded RGBA image uses at most 64 MiB, independently of compressed size.
export const MAX_ARTIFACT_PREVIEW_PIXELS = 16 * 1024 * 1024;
export const MAX_ARTIFACT_PREVIEW_DIMENSION = 10_000;
export const supportsArtifactPreview = (mediaType: string) => mediaType === 'application/json' || mediaType === 'image/png';

let imageDecodeTail: Promise<void> = Promise.resolve();

/** Native decoding cannot be interrupted; serialise it and discard cancelled results. */
export async function decodeArtifactPng(file: Blob, signal: AbortSignal): Promise<ImageBitmap> {
  signal.throwIfAborted();
  const size = await readArtifactPngDimensions(file);
  signal.throwIfAborted();
  let release!: () => void;
  const previous = imageDecodeTail;
  imageDecodeTail = new Promise<void>(resolve => { release = resolve; });
  try {
    await previous;
    signal.throwIfAborted();
    const bitmap = await createImageBitmap(file.slice(0, file.size, 'image/png'));
    if (signal.aborted) { bitmap.close(); signal.throwIfAborted(); }
    if (bitmap.width !== size.width || bitmap.height !== size.height) {
      bitmap.close(); throw new TypeError('Decoded PNG dimensions do not match its header.');
    }
    return bitmap;
  } finally { release(); }
}

function admit(file: Blob): void {
  if (!(file instanceof Blob) || file.size < 1 || file.size > MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES) {
    throw new TypeError('The selected file is outside the supported evidence-file size.');
  }
}

export async function readArtifactTextPage(file: Blob, page: number) {
  admit(file);
  const pages = Math.ceil(file.size / ARTIFACT_TEXT_PAGE_BYTES);
  if (!Number.isSafeInteger(page) || page < 0 || page >= pages) throw new TypeError('Invalid text page.');
  const offset = page * ARTIFACT_TEXT_PAGE_BYTES;
  const nominalEnd = Math.min(file.size, offset + ARTIFACT_TEXT_PAGE_BYTES);
  const bytes = new Uint8Array(await file.slice(offset, nominalEnd + 3).arrayBuffer());
  const continuation = (value: number | undefined) => value !== undefined && (value & 0xc0) === 0x80;
  let start = 0, end = nominalEnd - offset;
  // A UTF-8 character belongs to the page containing its first byte. At most
  // three continuation bytes cross the nominal boundary; no text is omitted.
  if (page > 0) while (start < 3 && continuation(bytes[start])) start++;
  while (end < bytes.length && continuation(bytes[end])) end++;
  const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(start, end));
  let escapedControls = false;
  const text = decoded.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/gu, character => {
    escapedControls = true;
    return '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0');
  });
  return { text, pages, page, startByte: offset + start, endByte: offset + end, escapedControls };
}

export async function readArtifactPngDimensions(file: Blob) {
  admit(file);
  const bytes = new Uint8Array(await file.slice(0, 33).arrayBuffer());
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length !== 33 || !signature.every((byte, index) => bytes[index] === byte)
    || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') throw new TypeError('The selected bytes do not contain a PNG header.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13) throw new TypeError('The PNG header is malformed.');
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height || width > MAX_ARTIFACT_PREVIEW_DIMENSION || height > MAX_ARTIFACT_PREVIEW_DIMENSION
    || width * height > MAX_ARTIFACT_PREVIEW_PIXELS) {
    throw new TypeError('This PNG exceeds the inline decoded-image bound. Its original bytes remain available to download.');
  }
  return { width, height };
}
