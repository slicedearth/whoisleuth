import { decodeBase64url, encodeBase64url } from '../../../lib/base64url.mts';
import { BrowserLocalDataError, decodeLocalDataJsonRecord, plaintextJsonCodec, type BrowserLocalDataCodec } from './browser-local-data.ts';
import { BROWSER_WORKSPACE_ENCRYPTION_CODEC, MAX_BROWSER_WORKSPACE_PASSPHRASE_BYTES, MIN_BROWSER_WORKSPACE_PASSPHRASE_CHARACTERS, readBrowserWorkspaceEncryption, type BrowserWorkspaceEncryption } from './browser-workspace-encryption-model.ts';
import { DEFAULT_BROWSER_WORKSPACE, requireBrowserWorkspaceId } from './browser-workspace-context.ts';
import { readRetainedFileReference, readVerifiedRetainedFileBytes, verifyRetainedFile } from '../../../packages/evidence/retained-file.mts';
import type { BrowserLocalBinaryCodec } from './browser-local-binaries.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
type Keys = { cipher: CryptoKey; authentication: CryptoKey };
// Immutable parameters of working-workspace format 1, independent of backups.
const PBKDF2_ITERATIONS = 600_000;

function workspaceId(value: string): string {
  const id = requireBrowserWorkspaceId(value);
  if (id === DEFAULT_BROWSER_WORKSPACE) throw new Error('Create a named encrypted workspace; the default workspace is not converted in place.');
  return id;
}

async function deriveKeys(passphrase: string, salt: string): Promise<Keys> {
  if (typeof passphrase !== 'string' || passphrase.length > MAX_BROWSER_WORKSPACE_PASSPHRASE_BYTES
    || Array.from(passphrase).length < MIN_BROWSER_WORKSPACE_PASSPHRASE_CHARACTERS) {
    throw new Error(`Use a workspace passphrase with at least ${MIN_BROWSER_WORKSPACE_PASSPHRASE_CHARACTERS} characters and at most ${MAX_BROWSER_WORKSPACE_PASSPHRASE_BYTES} UTF-8 bytes.`);
  }
  const bytes = encoder.encode(passphrase);
  if (bytes.byteLength > MAX_BROWSER_WORKSPACE_PASSPHRASE_BYTES) { bytes.fill(0); throw new Error('The workspace passphrase exceeds its UTF-8 byte limit.'); }
  let material: Uint8Array<ArrayBuffer> | undefined;
  try {
    const password = await crypto.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveBits']);
    material = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, salt: decodeBase64url(salt, 16, 16) }, password, 512));
    const cipher = await crypto.subtle.importKey('raw', material.subarray(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);
    const authentication = await crypto.subtle.importKey('raw', material.subarray(32), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    return { cipher, authentication };
  } finally { bytes.fill(0); material?.fill(0); }
}

function context(id: string, kind: string, ...parts: unknown[]): Uint8Array<ArrayBuffer> {
  return encoder.encode(JSON.stringify([BROWSER_WORKSPACE_ENCRYPTION_CODEC, id, kind, ...parts]));
}

export async function createBrowserWorkspaceEncryption(id: string, passphrase: string): Promise<BrowserWorkspaceEncryption> {
  workspaceId(id);
  const salt = encodeBase64url(crypto.getRandomValues(new Uint8Array(16)));
  const keys = await deriveKeys(passphrase, salt);
  const verifier = encodeBase64url(new Uint8Array(await crypto.subtle.sign('HMAC', keys.authentication, context(id, 'unlock'))));
  return Object.freeze({ version: 1, salt, verifier });
}

export async function unlockBrowserWorkspaceEncryption(id: string, metadata: BrowserWorkspaceEncryption, passphrase: string): Promise<Readonly<{ codec: BrowserLocalDataCodec; lock: () => void }>> {
  workspaceId(id);
  const envelope = readBrowserWorkspaceEncryption(metadata);
  let keys: Keys | null = await deriveKeys(passphrase, envelope.salt);
  if (!await crypto.subtle.verify('HMAC', keys.authentication, decodeBase64url(envelope.verifier, 32, 32), context(id, 'unlock'))) {
    keys = null;
    throw new Error('The passphrase is incorrect or the workspace encryption metadata is damaged. No saved records were changed.');
  }
  function active(): Keys {
    if (!keys) throw new BrowserLocalDataError('LOCAL_DATA_LOCKED', 'Unlock this encrypted workspace before reading or saving records.');
    return keys;
  }
  async function authenticate(kind: string, ...parts: unknown[]): Promise<string> {
    const result = await crypto.subtle.sign('HMAC', active().authentication, context(id, kind, ...parts));
    active();
    return encodeBase64url(new Uint8Array(result));
  }
  const encodedBytes = (bytes: number, records: number) => Math.ceil((bytes + 16 * records) * 4 / 3) + 18 * records;
  const codec = Object.freeze<BrowserLocalDataCodec>({
    id: BROWSER_WORKSPACE_ENCRYPTION_CODEC,
    encodedBytes,
    digestCollection: input => authenticate('collection', input.collection, input.schemaVersion, input.serializedBytes, input.content),
    binary: Object.freeze<BrowserLocalBinaryCodec>({
      async lookupKey(collection, reference) {
        const expected = readRetainedFileReference(reference);
        return authenticate('file-lookup', collection, expected.digestSha256);
      },
      async encode(input) {
        active();
        const reference = readRetainedFileReference(input.reference);
        const { collection, lookupKey, file } = input;
        if (await authenticate('file-lookup', collection, reference.digestSha256) !== lookupKey) throw new Error('Encrypted file lookup identity does not match.');
        const bytes = await readVerifiedRetainedFileBytes(reference, file);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        try {
          const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128,
            additionalData: context(id, 'file', collection, lookupKey, reference.byteLength) }, active().cipher, bytes);
          active();
          const envelope = new Uint8Array(iv.length + ciphertext.byteLength);
          envelope.set(iv); envelope.set(new Uint8Array(ciphertext), iv.length);
          return envelope.buffer;
        } finally { bytes.fill(0); }
      },
      async decode(input) {
        active();
        const reference = readRetainedFileReference(input.reference);
        const { collection, lookupKey, payload } = input;
        if (!(payload instanceof ArrayBuffer) || payload.byteLength !== reference.byteLength + 28) throw new Error('Encrypted file has an invalid byte length.');
        const envelope = new Uint8Array(payload.slice(0));
        if (await authenticate('file-lookup', collection, reference.digestSha256) !== lookupKey) throw new Error('Encrypted file lookup identity does not match.');
        const bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: envelope.subarray(0, 12), tagLength: 128,
          additionalData: context(id, 'file', collection, lookupKey, reference.byteLength) }, active().cipher, envelope.subarray(12)));
        try {
          active();
          const file = new Blob([bytes]);
          await verifyRetainedFile(reference, file);
          active();
          return file;
        } finally { bytes.fill(0); }
      },
    }),
    async encode(input) {
      active();
      const plaintext = await plaintextJsonCodec.encode(input);
      const lookupKey = await authenticate('lookup', input.collection, input.id);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const bytes = encoder.encode(plaintext.payload);
      try {
        const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128, additionalData: context(id, 'record', input.collection, lookupKey) }, active().cipher, bytes);
        active();
        return { lookupKey, payload: `${encodeBase64url(iv)}.${encodeBase64url(new Uint8Array(ciphertext))}` };
      } finally { bytes.fill(0); }
    },
    async decode(input) {
      active();
      if (typeof input.payload !== 'string' || input.payload.length > encodedBytes(input.maximumBytes, 1)) throw new Error('Encrypted record exceeds its byte limit.');
      const parts = input.payload.split('.');
      if (parts.length !== 2) throw new Error('Encrypted record has an invalid envelope.');
      const iv = decodeBase64url(parts[0], 12, 12);
      const ciphertext = decodeBase64url(parts[1], input.maximumBytes + 16);
      if (ciphertext.byteLength < 16) throw new Error('Encrypted record is incomplete.');
      const bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128, additionalData: context(id, 'record', input.collection, input.lookupKey) }, active().cipher, ciphertext));
      try {
        active();
        const payload = decoder.decode(bytes);
        const record = decodeLocalDataJsonRecord(payload, input.maximumBytes);
        if (await authenticate('lookup', input.collection, record.id) !== input.lookupKey) throw new Error('Encrypted record identity does not match its lookup key.');
        return record;
      } finally { bytes.fill(0); }
    },
  });
  return Object.freeze({ codec, lock: () => { keys = null; } });
}
