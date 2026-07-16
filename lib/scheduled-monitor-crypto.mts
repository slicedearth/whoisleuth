// Provider-neutral authenticated-encryption boundary for optional scheduled
// monitoring state. The storage provider receives only this bounded envelope;
// the deployment runtime retains the data key and supplies a mandatory
// namespace as authenticated context so ciphertext cannot be moved silently
// between stores or deployments.

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

type EncryptedScheduledMonitorEnvelope = {
  schema: typeof ENVELOPE_SCHEMA;
  version: typeof ENVELOPE_VERSION;
  algorithm: typeof ALGORITHM;
  iv: string;
  ciphertext: string;
  tag: string;
};

const ENVELOPE_SCHEMA = 'whoisleuth.scheduled-monitor.encrypted';
const ENVELOPE_VERSION = 1;
const ALGORITHM = 'A256GCM';
const AAD_PREFIX = `${ENVELOPE_SCHEMA}:v${ENVELOPE_VERSION}`;
const MAX_PLAINTEXT_BYTES = 2 * 1024 * 1024;
const MAX_ENVELOPE_BYTES = 3 * 1024 * 1024;
const MAX_CONTEXT_LENGTH = 300;
const MAX_KEY_INPUT_LENGTH = 64;
const MAX_CIPHERTEXT_TEXT_LENGTH = Math.ceil(MAX_PLAINTEXT_BYTES / 3) * 4;
const CONTROL_RE = /[\u0000-\u001f\u007f]/u;
const BASE64_RE = /^[A-Za-z0-9+/_-]+={0,2}$/u;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/u;

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function invalidKey(): Error {
  return new Error('Scheduled monitoring data key must be a base64-encoded 32-byte value.');
}

function parseScheduledMonitorKey(value: unknown): Buffer {
  if (typeof value !== 'string') throw invalidKey();
  const input = value.trim();
  if (!input
    || input.length > MAX_KEY_INPUT_LENGTH
    || CONTROL_RE.test(input)
    || !BASE64_RE.test(input)
    || (/[+/]/u.test(input) && /[-_]/u.test(input))) {
    throw invalidKey();
  }

  const unpadded = input.replace(/=+$/u, '');
  const normalized = unpadded.replace(/-/gu, '+').replace(/_/gu, '/');
  if (normalized.length % 4 === 1) throw invalidKey();

  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  const key = Buffer.from(`${normalized}${padding}`, 'base64');
  const canonical = key.toString('base64').replace(/=+$/u, '');
  if (key.length !== 32 || canonical !== normalized) throw invalidKey();
  return key;
}

function authenticatedContext(value: unknown): Buffer {
  if (typeof value !== 'string'
    || !value
    || value.length > MAX_CONTEXT_LENGTH
    || value.trim() !== value
    || CONTROL_RE.test(value)) {
    throw new Error('Scheduled monitoring encryption context is invalid.');
  }
  return Buffer.from(`${AAD_PREFIX}:${value}`, 'utf8');
}

function serializePlaintext(value: unknown): Buffer {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error('Scheduled monitoring state must be JSON-serializable.');
  }
  if (serialized === undefined) {
    throw new Error('Scheduled monitoring state must be JSON-serializable.');
  }
  const plaintext = Buffer.from(serialized, 'utf8');
  if (plaintext.length > MAX_PLAINTEXT_BYTES) {
    throw new Error('Scheduled monitoring state exceeds the encrypted storage limit.');
  }
  return plaintext;
}

function encryptScheduledMonitorState(value: unknown, keyInput: unknown, context: unknown): string {
  const key = parseScheduledMonitorKey(keyInput);
  const aad = authenticatedContext(context);
  const plaintext = serializePlaintext(value);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const envelope: EncryptedScheduledMonitorEnvelope = {
    schema: ENVELOPE_SCHEMA,
    version: ENVELOPE_VERSION,
    algorithm: ALGORITHM,
    iv: iv.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
  };
  return JSON.stringify(envelope);
}

function decodeEnvelopePart(value: unknown, maximum: number): Buffer {
  if (typeof value !== 'string'
    || !value
    || value.length > maximum
    || !BASE64URL_RE.test(value)) {
    throw new Error('malformed encrypted value');
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) throw new Error('non-canonical encrypted value');
  return decoded;
}

function parseEnvelope(serialized: unknown): EncryptedScheduledMonitorEnvelope {
  if (typeof serialized !== 'string'
    || !serialized
    || Buffer.byteLength(serialized, 'utf8') > MAX_ENVELOPE_BYTES) {
    throw new Error('Encrypted scheduled monitoring state is missing or oversized.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error('Encrypted scheduled monitoring state is malformed.');
  }
  const envelope = plainRecord(parsed);
  if (!envelope
    || envelope.schema !== ENVELOPE_SCHEMA
    || envelope.version !== ENVELOPE_VERSION
    || envelope.algorithm !== ALGORITHM) {
    throw new Error('Encrypted scheduled monitoring state uses an unsupported format.');
  }
  return envelope as EncryptedScheduledMonitorEnvelope;
}

function decryptScheduledMonitorState(serialized: unknown, keyInput: unknown, context: unknown): unknown {
  const key = parseScheduledMonitorKey(keyInput);
  const aad = authenticatedContext(context);
  const envelope = parseEnvelope(serialized);
  try {
    const iv = decodeEnvelopePart(envelope.iv, 24);
    const ciphertext = decodeEnvelopePart(envelope.ciphertext, MAX_CIPHERTEXT_TEXT_LENGTH);
    const tag = decodeEnvelopePart(envelope.tag, 32);
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length > MAX_PLAINTEXT_BYTES) {
      throw new Error('invalid encrypted lengths');
    }
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (plaintext.length > MAX_PLAINTEXT_BYTES) throw new Error('plaintext limit exceeded');
    return JSON.parse(plaintext.toString('utf8'));
  } catch {
    // Do not distinguish a wrong key from ciphertext, tag, or context
    // tampering. All are untrusted-store integrity failures to callers.
    throw new Error('Encrypted scheduled monitoring state could not be authenticated.');
  }
}

export {
  ALGORITHM,
  decryptScheduledMonitorState,
  encryptScheduledMonitorState,
  ENVELOPE_SCHEMA,
  ENVELOPE_VERSION,
  MAX_ENVELOPE_BYTES,
  MAX_PLAINTEXT_BYTES,
  parseScheduledMonitorKey,
};
export type { EncryptedScheduledMonitorEnvelope };
