import { WORKSPACE_ARCHIVE_PBKDF2_ITERATIONS } from '../contracts/case-portability.mts';
import {
  ENCRYPTED_INVESTIGATION_PACKAGE_MAGIC, ENCRYPTED_INVESTIGATION_PACKAGE_VERSION,
  ENCRYPTED_INVESTIGATION_PACKAGE_HEADER_BYTES, MAX_ENCRYPTED_INVESTIGATION_PACKAGE_BYTES,
  MAX_INVESTIGATION_PACKAGE_BYTES, hasEncryptedInvestigationPackagePrefix,
} from '../contracts/investigation-package-limits.mts';
import { arrayBuffer, assertPassphrase, cryptoProvider, deriveArchiveKey } from '../evidence/passphrase-encryption.mts';
import { inspectInvestigationPackage } from './investigation-package.mts';

const VERSION_OFFSET = ENCRYPTED_INVESTIGATION_PACKAGE_MAGIC.length;
const ITERATIONS_OFFSET = VERSION_OFFSET + 1;
const SALT_OFFSET = ITERATIONS_OFFSET + 4;
const IV_OFFSET = SALT_OFFSET + 16;
const LENGTH_OFFSET = IV_OFFSET + 12;
const HEADER_BYTES = ENCRYPTED_INVESTIGATION_PACKAGE_HEADER_BYTES;
const TAG_BYTES = 16;

function boundedSnapshot(input: Uint8Array, maximum: number): Uint8Array<ArrayBuffer> {
  if (!(input instanceof Uint8Array) || !(input.buffer instanceof ArrayBuffer)
    || input.byteLength < 22 || input.byteLength > maximum) throw new TypeError('Evidence package exceeds its input byte limit or uses shared memory.');
  return new Uint8Array(input);
}

/** Fixed-width binary metadata. No targets, file identities or source claims are exposed. */
export function inspectEncryptedInvestigationPackage(input: Uint8Array) {
  if (!(input instanceof Uint8Array) || !(input.buffer instanceof ArrayBuffer) || !hasEncryptedInvestigationPackagePrefix(input)
    || input.byteLength < HEADER_BYTES + TAG_BYTES + 22 || input.byteLength > MAX_ENCRYPTED_INVESTIGATION_PACKAGE_BYTES) {
    throw new TypeError('The encrypted evidence package is malformed or exceeds its byte limit.');
  }
  if (input[VERSION_OFFSET] !== ENCRYPTED_INVESTIGATION_PACKAGE_VERSION) throw new TypeError('Unsupported encrypted evidence package version. No file was decrypted.');
  const header = input.slice(0, HEADER_BYTES);
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (view.getUint32(ITERATIONS_OFFSET) !== WORKSPACE_ARCHIVE_PBKDF2_ITERATIONS) throw new TypeError('Unsupported encrypted evidence package key-derivation parameters.');
  const plaintextBytes = view.getUint32(LENGTH_OFFSET);
  if (plaintextBytes < 22 || plaintextBytes > MAX_INVESTIGATION_PACKAGE_BYTES
    || input.byteLength !== HEADER_BYTES + plaintextBytes + TAG_BYTES) throw new TypeError('Encrypted evidence package length does not match its declaration.');
  return Object.freeze({ version: ENCRYPTED_INVESTIGATION_PACKAGE_VERSION, plaintextBytes, ciphertextBytes: plaintextBytes + TAG_BYTES });
}

/** Encrypt an independently verified package, never a partly accepted archive. */
export async function encryptInvestigationPackage(input: Uint8Array, passphrase: string, provider?: Crypto): Promise<Uint8Array> {
  const plaintext = boundedSnapshot(input, MAX_INVESTIGATION_PACKAGE_BYTES);
  let secret: Uint8Array | null = null;
  try {
    secret = assertPassphrase(passphrase);
    const inspected = await inspectInvestigationPackage(plaintext);
    if (!inspected.identityVerified) throw new TypeError('The evidence package contains an unverified file. Nothing was encrypted.');
    const crypto = cryptoProvider(provider);
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const header = new Uint8Array(HEADER_BYTES), view = new DataView(header.buffer);
    header.set(new TextEncoder().encode(ENCRYPTED_INVESTIGATION_PACKAGE_MAGIC));
    header[VERSION_OFFSET] = ENCRYPTED_INVESTIGATION_PACKAGE_VERSION;
    view.setUint32(ITERATIONS_OFFSET, WORKSPACE_ARCHIVE_PBKDF2_ITERATIONS);
    header.set(salt, SALT_OFFSET); header.set(iv, IV_OFFSET); view.setUint32(LENGTH_OFFSET, plaintext.byteLength);
    const key = await deriveArchiveKey(crypto, secret, salt, ['encrypt']);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: arrayBuffer(iv), additionalData: header, tagLength: TAG_BYTES * 8 }, key, plaintext);
    const output = new Uint8Array(HEADER_BYTES + encrypted.byteLength);
    output.set(header); output.set(new Uint8Array(encrypted), HEADER_BYTES);
    return output;
  } finally { secret?.fill(0); plaintext.fill(0); }
}

/** Authenticate all container bytes before passing the plaintext to the ZIP reader. */
export async function decryptInvestigationPackage(input: Uint8Array, passphrase: string, provider?: Crypto) {
  const snapshot = boundedSnapshot(input, MAX_ENCRYPTED_INVESTIGATION_PACKAGE_BYTES);
  let secret: Uint8Array | null = null;
  let plaintext: Uint8Array<ArrayBuffer> | null = null;
  try {
    const metadata = inspectEncryptedInvestigationPackage(snapshot);
    secret = assertPassphrase(passphrase);
    const crypto = cryptoProvider(provider);
    try {
      const key = await deriveArchiveKey(crypto, secret, snapshot.slice(SALT_OFFSET, IV_OFFSET), ['decrypt']);
      plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: snapshot.slice(IV_OFFSET, LENGTH_OFFSET),
        additionalData: snapshot.slice(0, HEADER_BYTES), tagLength: TAG_BYTES * 8 }, key, snapshot.slice(HEADER_BYTES)));
    } catch { throw new Error('The package passphrase is incorrect or the encrypted file is corrupted.'); }
    if (plaintext.byteLength !== metadata.plaintextBytes) throw new TypeError('Decrypted evidence package length is invalid.');
    const review = await inspectInvestigationPackage(plaintext);
    if (!review.identityVerified) throw new TypeError('The decrypted package contains an unverified file. No evidence was accepted.');
    return { bytes: plaintext, review, ciphertextBytes: metadata.ciphertextBytes };
  } catch (cause) { plaintext?.fill(0); throw cause; }
  finally { secret?.fill(0); snapshot.fill(0); }
}
