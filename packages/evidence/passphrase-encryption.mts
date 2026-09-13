// Passphrase policy and native key derivation shared by portable encrypted files.
import { MAX_WORKSPACE_ARCHIVE_PASSPHRASE_BYTES, MIN_WORKSPACE_ARCHIVE_PASSPHRASE_CHARACTERS, WORKSPACE_ARCHIVE_PBKDF2_ITERATIONS } from '../contracts/case-portability.mts';

export const AES_KEY_BITS = 256;
const encoder = new TextEncoder();

export function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

export function assertPassphrase(passphrase: string): Uint8Array {
  if (typeof passphrase !== 'string') {
    throw new Error(`Use a backup passphrase with at least ${MIN_WORKSPACE_ARCHIVE_PASSPHRASE_CHARACTERS} characters.`);
  }
  if (passphrase.length > MAX_WORKSPACE_ARCHIVE_PASSPHRASE_BYTES) {
    throw new Error('Backup passphrases are limited to 1024 UTF-8 bytes.');
  }
  if (Array.from(passphrase).length < MIN_WORKSPACE_ARCHIVE_PASSPHRASE_CHARACTERS) {
    throw new Error(`Use a backup passphrase with at least ${MIN_WORKSPACE_ARCHIVE_PASSPHRASE_CHARACTERS} characters.`);
  }
  const bytes = encoder.encode(passphrase);
  if (bytes.byteLength > MAX_WORKSPACE_ARCHIVE_PASSPHRASE_BYTES) {
    bytes.fill(0);
    throw new Error('Backup passphrases are limited to 1024 UTF-8 bytes.');
  }
  return bytes;
}

export function cryptoProvider(provider: Crypto = globalThis.crypto): Crypto {
  if (
    !provider
    || typeof provider.getRandomValues !== 'function'
    || typeof provider.subtle?.importKey !== 'function'
    || typeof provider.subtle?.deriveKey !== 'function'
    || typeof provider.subtle?.encrypt !== 'function'
    || typeof provider.subtle?.decrypt !== 'function'
  ) {
    throw new Error('Encrypted workspace archives are unavailable in this browser.');
  }
  return provider;
}

export async function deriveArchiveKey(
  provider: Crypto,
  passphraseBytes: Uint8Array,
  salt: Uint8Array,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const material = await provider.subtle.importKey('raw', arrayBuffer(passphraseBytes), 'PBKDF2', false, ['deriveKey']);
  return provider.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: arrayBuffer(salt),
      iterations: WORKSPACE_ARCHIVE_PBKDF2_ITERATIONS,
    },
    material,
    { name: 'AES-GCM', length: AES_KEY_BITS },
    false,
    usages,
  );
}
