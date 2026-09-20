const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function encodeBase64url(bytes: Uint8Array): string {
  // Bounded argument lists and one join avoid a string node for every quartet.
  const chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += 4_096) chunks.push(String.fromCharCode(...bytes.subarray(index, index + 4_096)));
  return btoa(chunks.join('')).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

/** Require canonical unpadded encoding and bound allocation before decoding. */
export function decodeBase64url(value: unknown, maximumBytes: number, exactBytes?: number): Uint8Array<ArrayBuffer> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || typeof value !== 'string' || !value
    || value.length > Math.ceil(maximumBytes * 4 / 3) || value.length % 4 === 1 || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error('Invalid or oversized base64url value.');
  }
  const size = Math.floor(value.length * 6 / 8);
  if (size > maximumBytes || exactBytes !== undefined && size !== exactBytes) throw new Error('Invalid base64url byte count.');
  const remainder = value.length % 4;
  const unusedBits = remainder === 2 ? 15 : remainder === 3 ? 3 : 0;
  if ((ALPHABET.indexOf(value.at(-1)!) & unusedBits) !== 0) throw new Error('Non-canonical base64url value.');
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
