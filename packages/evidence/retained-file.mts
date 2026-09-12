import { MAX_SELECTED_FILES, MAX_SELECTED_FILE_BYTES, MAX_SELECTED_FILE_TOTAL_BYTES } from '../contracts/selected-file-limits.mts';
import { digest, exact, integer } from './artifact-structure.mts';
import { sha256ArtifactBytes } from './artifact-integrity.mts';

/** Content identity does not identify its source, observation or Case link. */
export type RetainedFileReference = Readonly<{ digestSha256: string; byteLength: number }>;
export type RetainedFileInput = Readonly<{ reference: RetainedFileReference; file: Blob }>;

export function readRetainedFileReference(value: unknown): RetainedFileReference {
  const record = exact(value, ['digestSha256', 'byteLength'], 'Retained file reference');
  digest(record.digestSha256, 'Retained file digest');
  const byteLength = integer(record.byteLength, 'Retained file bytes', 1, MAX_SELECTED_FILE_BYTES);
  return Object.freeze({ digestSha256: record.digestSha256 as string, byteLength });
}

/** Capture declarations synchronously; Blob contents are immutable. */
export function captureRetainedFiles(input: readonly RetainedFileInput[]): readonly RetainedFileInput[] {
  if (!Array.isArray(input) || input.length > MAX_SELECTED_FILES) throw new TypeError(`Select at most ${MAX_SELECTED_FILES} files per operation.`);
  let total = 0;
  return Object.freeze(input.map(item => {
    const reference = readRetainedFileReference(item?.reference);
    if (!(item.file instanceof Blob) || item.file.size !== reference.byteLength) throw new TypeError('Selected file bytes do not match their declared length.');
    total += reference.byteLength;
    if (total > MAX_SELECTED_FILE_TOTAL_BYTES) throw new TypeError('Selected files exceed the combined byte limit.');
    return Object.freeze({ reference, file: item.file.slice() });
  }));
}

/** Check the complete selected bytes, never a prefix or a canonicalised copy. */
export async function readVerifiedRetainedFileBytes(reference: RetainedFileReference, file: Blob): Promise<Uint8Array<ArrayBuffer>> {
  const expected = readRetainedFileReference(reference);
  if (!(file instanceof Blob) || file.size !== expected.byteLength) throw new TypeError('Retained file bytes do not match their declared length.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    if (bytes.byteLength !== expected.byteLength || await sha256ArtifactBytes(bytes) !== expected.digestSha256) throw new TypeError('Retained file bytes do not match their declared digest.');
    return bytes;
  } catch (cause) { bytes.fill(0); throw cause; }
}

export async function verifyRetainedFile(reference: RetainedFileReference, file: Blob): Promise<void> {
  (await readVerifiedRetainedFileBytes(reference, file)).fill(0);
}
