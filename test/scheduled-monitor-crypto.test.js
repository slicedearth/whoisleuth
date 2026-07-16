const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');

const {
  ALGORITHM,
  decryptScheduledMonitorState,
  encryptScheduledMonitorState,
  ENVELOPE_SCHEMA,
  ENVELOPE_VERSION,
  MAX_ENVELOPE_BYTES,
  MAX_PLAINTEXT_BYTES,
  parseScheduledMonitorKey,
} = require('../lib/scheduled-monitor-crypto.mts');

const CONTEXT = 'deployment:scheduled-watchlists';
const key = randomBytes(32).toString('base64');

describe('scheduled monitoring data keys', () => {
  test('accepts canonical standard and URL-safe Base64 encodings of exactly 32 bytes', () => {
    const raw = randomBytes(32);
    assert.deepEqual(parseScheduledMonitorKey(raw.toString('base64')), raw);
    assert.deepEqual(parseScheduledMonitorKey(raw.toString('base64url')), raw);
  });

  test('rejects malformed, non-canonical, mixed-alphabet, and incorrectly sized keys', () => {
    for (const value of [
      undefined,
      '',
      'short',
      '!not-base64!',
      `${randomBytes(32).toString('base64url')}+`,
      `${randomBytes(32).toString('base64')}extra`,
      randomBytes(31).toString('base64'),
      randomBytes(33).toString('base64'),
    ]) {
      assert.throws(() => parseScheduledMonitorKey(value), /base64-encoded 32-byte value/i);
    }
  });
});

describe('scheduled monitoring authenticated encryption', () => {
  test('round-trips bounded JSON without retaining plaintext or a key fingerprint', () => {
    const state = { version: 1, watchlists: [{ name: 'Private investigation' }], activeRun: null };
    const serialized = encryptScheduledMonitorState(state, key, CONTEXT);
    const envelope = JSON.parse(serialized);
    assert.equal(envelope.schema, ENVELOPE_SCHEMA);
    assert.equal(envelope.version, ENVELOPE_VERSION);
    assert.equal(envelope.algorithm, ALGORITHM);
    assert.equal(serialized.includes('Private investigation'), false);
    assert.equal(Object.hasOwn(envelope, 'keyId'), false);
    assert.deepEqual(decryptScheduledMonitorState(serialized, key, CONTEXT), state);
  });

  test('uses a fresh 96-bit nonce for every write', () => {
    const first = JSON.parse(encryptScheduledMonitorState({ value: 1 }, key, CONTEXT));
    const second = JSON.parse(encryptScheduledMonitorState({ value: 1 }, key, CONTEXT));
    assert.notEqual(first.iv, second.iv);
    assert.equal(Buffer.from(first.iv, 'base64url').length, 12);
    assert.equal(Buffer.from(second.iv, 'base64url').length, 12);
  });

  test('binds ciphertext to a mandatory bounded deployment context', () => {
    const serialized = encryptScheduledMonitorState({ value: 1 }, key, CONTEXT);
    assert.throws(
      () => decryptScheduledMonitorState(serialized, key, 'deployment:other-store'),
      /could not be authenticated/i,
    );
    for (const value of [undefined, '', ' padded ', 'invalid\ncontext', 'x'.repeat(301)]) {
      assert.throws(() => encryptScheduledMonitorState({ value: 1 }, key, value), /context is invalid/i);
    }
  });

  test('fails identically for ciphertext, tag, and key tampering', () => {
    const serialized = encryptScheduledMonitorState({ value: 1 }, key, CONTEXT);
    const variants = [];
    for (const field of ['ciphertext', 'tag']) {
      const envelope = JSON.parse(serialized);
      const last = envelope[field].at(-1);
      envelope[field] = `${envelope[field].slice(0, -1)}${last === 'A' ? 'B' : 'A'}`;
      variants.push(() => decryptScheduledMonitorState(JSON.stringify(envelope), key, CONTEXT));
    }
    variants.push(() => decryptScheduledMonitorState(
      serialized,
      randomBytes(32).toString('base64'),
      CONTEXT,
    ));
    for (const attempt of variants) {
      assert.throws(attempt, { message: 'Encrypted scheduled monitoring state could not be authenticated.' });
    }
  });

  test('rejects malformed and unsupported envelopes before decryption', () => {
    const serialized = encryptScheduledMonitorState({ value: 1 }, key, CONTEXT);
    const unsupported = { ...JSON.parse(serialized), version: ENVELOPE_VERSION + 1 };
    assert.throws(() => decryptScheduledMonitorState('', key, CONTEXT), /missing or oversized/i);
    assert.throws(() => decryptScheduledMonitorState('{', key, CONTEXT), /malformed/i);
    assert.throws(() => decryptScheduledMonitorState(JSON.stringify(unsupported), key, CONTEXT), /unsupported format/i);
    assert.throws(
      () => decryptScheduledMonitorState('x'.repeat(MAX_ENVELOPE_BYTES + 1), key, CONTEXT),
      /missing or oversized/i,
    );
  });

  test('bounds plaintext before encryption and rejects non-serializable state', () => {
    assert.throws(
      () => encryptScheduledMonitorState({ value: 'x'.repeat(MAX_PLAINTEXT_BYTES) }, key, CONTEXT),
      /exceeds the encrypted storage limit/i,
    );
    assert.throws(
      () => encryptScheduledMonitorState({ value: 1n }, key, CONTEXT),
      /must be JSON-serializable/i,
    );
    assert.throws(
      () => encryptScheduledMonitorState(undefined, key, CONTEXT),
      /must be JSON-serializable/i,
    );
  });

  test('accepts a value exactly at the plaintext byte boundary', () => {
    const prefix = Buffer.byteLength('{"value":"', 'utf8');
    const suffix = Buffer.byteLength('"}', 'utf8');
    const state = { value: 'x'.repeat(MAX_PLAINTEXT_BYTES - prefix - suffix) };
    const serialized = encryptScheduledMonitorState(state, key, CONTEXT);
    assert.deepEqual(decryptScheduledMonitorState(serialized, key, CONTEXT), state);
  });
});
