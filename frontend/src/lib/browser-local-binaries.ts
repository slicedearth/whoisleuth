import { readRetainedFileReference, readVerifiedRetainedFileBytes, verifyRetainedFile, type RetainedFileInput, type RetainedFileReference } from '../../../packages/evidence/retained-file.mts';

export interface BrowserLocalBinaryCodec {
  lookupKey(collection: string, reference: RetainedFileReference): Promise<string>;
  encode(input: RetainedFileInput & Readonly<{ collection: string; lookupKey: string }>): Promise<ArrayBuffer>;
  decode(input: Readonly<{ collection: string; lookupKey: string; reference: RetainedFileReference; payload: ArrayBuffer }>): Promise<Blob>;
}

export type { LocalDataStoredBinary as BrowserLocalStoredBinary } from '../../../packages/workspace/local-data-storage.mts';

export const plaintextLocalBinaryCodec: BrowserLocalBinaryCodec = Object.freeze<BrowserLocalBinaryCodec>({
  async lookupKey(_collection, reference) { return readRetainedFileReference(reference).digestSha256; },
  async encode(input) {
    const { lookupKey, file } = input, reference = readRetainedFileReference(input.reference);
    if (lookupKey !== reference.digestSha256) throw new TypeError('Retained file lookup identity does not match.');
    return (await readVerifiedRetainedFileBytes(reference, file)).buffer;
  },
  async decode(input) {
    const { lookupKey, payload } = input, reference = readRetainedFileReference(input.reference);
    if (lookupKey !== reference.digestSha256) throw new TypeError('Retained file lookup identity does not match.');
    if (!(payload instanceof ArrayBuffer) || payload.byteLength !== reference.byteLength) throw new TypeError('Retained file bytes do not match their declared length.');
    const file = new Blob([payload]);
    await verifyRetainedFile(reference, file);
    return file;
  },
});
