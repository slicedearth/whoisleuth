export function patchZipDeclaredUncompressedSize(
  input: Uint8Array,
  entryName: string,
  declaredSize: number,
): Uint8Array {
  if (!(input instanceof Uint8Array)
    || typeof entryName !== 'string'
    || !entryName
    || !Number.isSafeInteger(declaredSize)
    || declaredSize < 0
    || declaredSize > 0xffff_ffff) {
    throw new TypeError('ZIP fixture metadata is invalid.');
  }
  const output = input.slice();
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  const decoder = new TextDecoder();
  let localPatched = false;
  let centralPatched = false;
  for (let offset = 0; offset <= output.byteLength - 30; offset += 1) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x04034b50) {
      const nameLength = view.getUint16(offset + 26, true);
      const start = offset + 30;
      if (start + nameLength <= output.byteLength
        && decoder.decode(output.subarray(start, start + nameLength)) === entryName) {
        view.setUint32(offset + 22, declaredSize, true);
        localPatched = true;
      }
    } else if (signature === 0x02014b50 && offset <= output.byteLength - 46) {
      const nameLength = view.getUint16(offset + 28, true);
      const start = offset + 46;
      if (start + nameLength <= output.byteLength
        && decoder.decode(output.subarray(start, start + nameLength)) === entryName) {
        view.setUint32(offset + 24, declaredSize, true);
        centralPatched = true;
      }
    }
  }
  if (!localPatched || !centralPatched) throw new Error('ZIP fixture entry metadata was not found.');
  return output;
}

export function patchZipDataDescriptorUncompressedSize(
  input: Uint8Array,
  entryName: string,
  declaredSize: number,
): Uint8Array {
  if (!(input instanceof Uint8Array)
    || typeof entryName !== 'string'
    || !entryName
    || !Number.isSafeInteger(declaredSize)
    || declaredSize < 0
    || declaredSize > 0xffff_ffff) {
    throw new TypeError('ZIP fixture metadata is invalid.');
  }
  const output = input.slice();
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  const decoder = new TextDecoder();
  for (let offset = 0; offset <= output.byteLength - 46; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const nameLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 46;
    if (nameStart + nameLength > output.byteLength
      || decoder.decode(output.subarray(nameStart, nameStart + nameLength)) !== entryName) continue;
    const compressedSize = view.getUint32(offset + 20, true);
    const localOffset = view.getUint32(offset + 42, true);
    if (localOffset > output.byteLength - 30 || view.getUint32(localOffset, true) !== 0x04034b50) break;
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const descriptorOffset = localOffset + 30 + localNameLength + localExtraLength + compressedSize;
    const signed = descriptorOffset <= output.byteLength - 16
      && view.getUint32(descriptorOffset, true) === 0x08074b50;
    const originalSizeOffset = descriptorOffset + (signed ? 12 : 8);
    if (originalSizeOffset > output.byteLength - 4) break;
    view.setUint32(originalSizeOffset, declaredSize, true);
    return output;
  }
  throw new Error('ZIP fixture data descriptor was not found.');
}

export default Object.freeze({
  patchZipDataDescriptorUncompressedSize,
  patchZipDeclaredUncompressedSize,
});
