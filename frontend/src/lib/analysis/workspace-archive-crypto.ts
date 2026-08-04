// Browser-local authenticated encryption for portable workspace archives.
// This protects a downloaded file while it is locked. It does not encrypt the
// active IndexedDB workspace or defend an unlocked page from same-origin code.

import {
  MAX_WORKSPACE_ARCHIVE_BYTES,
  WORKSPACE_ARCHIVE_SCHEMA,
  WORKSPACE_ARCHIVE_VERSION,
  isSupportedWorkspaceArchiveVersion,
  readWorkspaceArchive,
} from './workspace-archive.ts';

export const ENCRYPTED_WORKSPACE_ARCHIVE_SCHEMA = 'whoisleuth.encrypted-workspace-archive';
export const ENCRYPTED_WORKSPACE_ARCHIVE_VERSION = 1;
export const WORKSPACE_ARCHIVE_PBKDF2_ITERATIONS = 600_000;
export const MIN_WORKSPACE_ARCHIVE_PASSPHRASE_CHARACTERS = 12;
export const MAX_WORKSPACE_ARCHIVE_PASSPHRASE_BYTES = 1024;
export const MAX_ENCRYPTED_WORKSPACE_ARCHIVE_BYTES = Math.ceil(MAX_WORKSPACE_ARCHIVE_BYTES * 4 / 3) + 4096;

const SALT_BYTES = 16;
const IV_BYTES = 12;
const AES_KEY_BITS = 256;
const AES_GCM_TAG_BITS = 128;
const MAX_CIPHERTEXT_BASE64URL_CHARACTERS = Math.ceil(
  (MAX_WORKSPACE_ARCHIVE_BYTES + AES_GCM_TAG_BITS / 8) * 4 / 3,
);
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

type UnknownRecord = Record<string, unknown>;

export interface EncryptedWorkspaceArchiveEnvelope {
  schema: typeof ENCRYPTED_WORKSPACE_ARCHIVE_SCHEMA;
  version: typeof ENCRYPTED_WORKSPACE_ARCHIVE_VERSION;
  createdAt: string;
  content: {
    schema: typeof WORKSPACE_ARCHIVE_SCHEMA;
    version: number;
  };
  kdf: {
    name: 'PBKDF2';
    hash: 'SHA-256';
    iterations: typeof WORKSPACE_ARCHIVE_PBKDF2_ITERATIONS;
    salt: string;
  };
  cipher: {
    name: 'AES-GCM';
    keyBits: typeof AES_KEY_BITS;
    tagBits: typeof AES_GCM_TAG_BITS;
    iv: string;
  };
  ciphertext: string;
}

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function hasExactKeys(value: UnknownRecord, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

function assertPassphrase(passphrase: string): Uint8Array {
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
    throw new Error('Backup passphrases are limited to 1024 UTF-8 bytes.');
  }
  return bytes;
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + 0x8000, bytes.length)));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function decodeBase64url(value: unknown, expectedBytes: number | null, label: string): Uint8Array {
  const expectedCharacters = expectedBytes === null ? null : Math.ceil(expectedBytes * 4 / 3);
  if (
    typeof value !== 'string'
    || !value
    || (expectedCharacters !== null && value.length > expectedCharacters)
    || !BASE64URL_RE.test(value)
  ) {
    throw new Error(`The encrypted workspace archive has an invalid ${label}.`);
  }
  const padding = (4 - value.length % 4) % 4;
  let binary = '';
  try {
    binary = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat(padding));
  } catch {
    throw new Error(`The encrypted workspace archive has an invalid ${label}.`);
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (expectedBytes !== null && bytes.byteLength !== expectedBytes) {
    throw new Error(`The encrypted workspace archive has an invalid ${label}.`);
  }
  if (base64url(bytes) !== value) {
    throw new Error(`The encrypted workspace archive has a non-canonical ${label}.`);
  }
  return bytes;
}

function canonicalMetadata(envelope: Omit<EncryptedWorkspaceArchiveEnvelope, 'ciphertext'>): string {
  return JSON.stringify({
    schema: envelope.schema,
    version: envelope.version,
    createdAt: envelope.createdAt,
    content: envelope.content,
    kdf: envelope.kdf,
    cipher: envelope.cipher,
  });
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 32 || !ISO_TIMESTAMP_RE.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function validateEnvelope(raw: unknown): {
  envelope: EncryptedWorkspaceArchiveEnvelope;
  salt: Uint8Array;
  iv: Uint8Array;
  ciphertext: Uint8Array;
} {
  const value = record(raw);
  if (!value || value.schema !== ENCRYPTED_WORKSPACE_ARCHIVE_SCHEMA) {
    throw new Error('This file is not an encrypted WHOISleuth workspace archive.');
  }
  if (value.version !== ENCRYPTED_WORKSPACE_ARCHIVE_VERSION) {
    if (typeof value.version === 'number' && Number.isSafeInteger(value.version) && value.version > ENCRYPTED_WORKSPACE_ARCHIVE_VERSION) {
      throw new Error(`This encrypted workspace archive uses newer schema ${value.version}. Update the app before importing it.`);
    }
    throw new Error(`Expected encrypted workspace archive schema ${ENCRYPTED_WORKSPACE_ARCHIVE_VERSION}.`);
  }
  if (!hasExactKeys(value, ['schema', 'version', 'createdAt', 'content', 'kdf', 'cipher', 'ciphertext'])) {
    throw new Error('The encrypted workspace archive envelope is malformed.');
  }
  if (!validTimestamp(value.createdAt)) {
    throw new Error('The encrypted workspace archive has an invalid creation time.');
  }

  const content = record(value.content);
  if (
    !content
    || !hasExactKeys(content, ['schema', 'version'])
    || content.schema !== WORKSPACE_ARCHIVE_SCHEMA
    || !isSupportedWorkspaceArchiveVersion(content.version)
  ) {
    throw new Error('The encrypted workspace archive declares an unsupported content contract.');
  }

  const kdf = record(value.kdf);
  if (
    !kdf
    || !hasExactKeys(kdf, ['name', 'hash', 'iterations', 'salt'])
    || kdf.name !== 'PBKDF2'
    || kdf.hash !== 'SHA-256'
    || kdf.iterations !== WORKSPACE_ARCHIVE_PBKDF2_ITERATIONS
  ) {
    throw new Error('The encrypted workspace archive declares an unsupported key-derivation contract.');
  }

  const cipher = record(value.cipher);
  if (
    !cipher
    || !hasExactKeys(cipher, ['name', 'keyBits', 'tagBits', 'iv'])
    || cipher.name !== 'AES-GCM'
    || cipher.keyBits !== AES_KEY_BITS
    || cipher.tagBits !== AES_GCM_TAG_BITS
  ) {
    throw new Error('The encrypted workspace archive declares an unsupported cipher contract.');
  }

  const salt = decodeBase64url(kdf.salt, SALT_BYTES, 'salt');
  const iv = decodeBase64url(cipher.iv, IV_BYTES, 'initialisation vector');
  if (typeof value.ciphertext !== 'string' || value.ciphertext.length > MAX_CIPHERTEXT_BASE64URL_CHARACTERS) {
    throw new Error('The encrypted workspace archive ciphertext exceeds its byte limit.');
  }
  const ciphertext = decodeBase64url(value.ciphertext, null, 'ciphertext');
  if (ciphertext.byteLength < AES_GCM_TAG_BITS / 8 || ciphertext.byteLength > MAX_WORKSPACE_ARCHIVE_BYTES + AES_GCM_TAG_BITS / 8) {
    throw new Error('The encrypted workspace archive ciphertext exceeds its byte limit.');
  }

  return {
    envelope: {
      schema: ENCRYPTED_WORKSPACE_ARCHIVE_SCHEMA,
      version: ENCRYPTED_WORKSPACE_ARCHIVE_VERSION,
      createdAt: value.createdAt,
      content: {
        schema: WORKSPACE_ARCHIVE_SCHEMA,
        version: content.version,
      },
      kdf: {
        name: 'PBKDF2',
        hash: 'SHA-256',
        iterations: WORKSPACE_ARCHIVE_PBKDF2_ITERATIONS,
        salt: kdf.salt as string,
      },
      cipher: {
        name: 'AES-GCM',
        keyBits: AES_KEY_BITS,
        tagBits: AES_GCM_TAG_BITS,
        iv: cipher.iv as string,
      },
      ciphertext: value.ciphertext as string,
    },
    salt,
    iv,
    ciphertext,
  };
}

function cryptoProvider(provider: Crypto = globalThis.crypto): Crypto {
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

async function deriveArchiveKey(
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

export function isEncryptedWorkspaceArchive(raw: unknown): boolean {
  return record(raw)?.schema === ENCRYPTED_WORKSPACE_ARCHIVE_SCHEMA;
}

/** Validate the bounded envelope without deriving a key or exposing plaintext. */
export function inspectEncryptedWorkspaceArchive(raw: unknown): {
  createdAt: string;
  ciphertextBytes: number;
} {
  const { envelope, ciphertext } = validateEnvelope(raw);
  return { createdAt: envelope.createdAt, ciphertextBytes: ciphertext.byteLength };
}

/** Encrypt one already-built workspace archive using browser-native Web Crypto. */
export async function encryptWorkspaceArchive(
  archive: unknown,
  passphrase: string,
  provider?: Crypto,
): Promise<EncryptedWorkspaceArchiveEnvelope> {
  await readWorkspaceArchive(archive);
  const archiveVersion = record(archive)?.version;
  if (!isSupportedWorkspaceArchiveVersion(archiveVersion)) {
    throw new Error('The workspace archive declares an unsupported content contract.');
  }
  const plaintext = JSON.stringify(archive);
  const plaintextBytes = encoder.encode(plaintext);
  if (plaintextBytes.byteLength > MAX_WORKSPACE_ARCHIVE_BYTES) {
    throw new Error('Workspace archives are limited to 10 MiB. Export smaller collections separately before trying again.');
  }
  const crypto = cryptoProvider(provider);
  const passphraseBytes = assertPassphrase(passphrase);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const envelopeWithoutCiphertext: Omit<EncryptedWorkspaceArchiveEnvelope, 'ciphertext'> = {
    schema: ENCRYPTED_WORKSPACE_ARCHIVE_SCHEMA,
    version: ENCRYPTED_WORKSPACE_ARCHIVE_VERSION,
    createdAt: new Date().toISOString(),
    content: {
      schema: WORKSPACE_ARCHIVE_SCHEMA,
      version: archiveVersion,
    },
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: WORKSPACE_ARCHIVE_PBKDF2_ITERATIONS,
      salt: base64url(salt),
    },
    cipher: {
      name: 'AES-GCM',
      keyBits: AES_KEY_BITS,
      tagBits: AES_GCM_TAG_BITS,
      iv: base64url(iv),
    },
  };
  try {
    const key = await deriveArchiveKey(crypto, passphraseBytes, salt, ['encrypt']);
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: arrayBuffer(iv),
        additionalData: arrayBuffer(encoder.encode(canonicalMetadata(envelopeWithoutCiphertext))),
        tagLength: AES_GCM_TAG_BITS,
      },
      key,
      arrayBuffer(plaintextBytes),
    );
    return { ...envelopeWithoutCiphertext, ciphertext: base64url(new Uint8Array(ciphertext)) };
  } finally {
    passphraseBytes.fill(0);
  }
}

/** Decrypt and parse one encrypted archive. The ordinary archive reader remains authoritative. */
export async function decryptWorkspaceArchive(
  raw: unknown,
  passphrase: string,
  provider?: Crypto,
): Promise<unknown> {
  const { envelope, salt, iv, ciphertext } = validateEnvelope(raw);
  const crypto = cryptoProvider(provider);
  const passphraseBytes = assertPassphrase(passphrase);
  const { ciphertext: _ciphertext, ...metadata } = envelope;
  try {
    const key = await deriveArchiveKey(crypto, passphraseBytes, salt, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: arrayBuffer(iv),
        additionalData: arrayBuffer(encoder.encode(canonicalMetadata(metadata))),
        tagLength: AES_GCM_TAG_BITS,
      },
      key,
      arrayBuffer(ciphertext),
    );
    if (plaintext.byteLength > MAX_WORKSPACE_ARCHIVE_BYTES) {
      throw new Error('The decrypted workspace archive exceeds its byte limit.');
    }
    return JSON.parse(decoder.decode(plaintext));
  } catch (cause) {
    if (cause instanceof Error && cause.message === 'The decrypted workspace archive exceeds its byte limit.') throw cause;
    throw new Error('The backup passphrase is incorrect or the encrypted file is corrupted.');
  } finally {
    passphraseBytes.fill(0);
  }
}
