import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  ENCRYPTED_WORKSPACE_ARCHIVE_SCHEMA,
  ENCRYPTED_WORKSPACE_ARCHIVE_VERSION,
  MAX_ENCRYPTED_WORKSPACE_ARCHIVE_BYTES,
  MIN_WORKSPACE_ARCHIVE_PASSPHRASE_CHARACTERS,
  WORKSPACE_ARCHIVE_PBKDF2_ITERATIONS,
  decryptWorkspaceArchive,
  encryptWorkspaceArchive,
  inspectEncryptedWorkspaceArchive,
  isEncryptedWorkspaceArchive,
} from '../frontend/src/lib/analysis/workspace-archive-crypto.ts';
import {
  WORKSPACE_ARCHIVE_SCHEMA,
  WORKSPACE_ARCHIVE_VERSION,
  buildWorkspaceArchive,
  readWorkspaceArchive,
} from '../frontend/src/lib/analysis/workspace-archive.ts';

const PASSPHRASE = 'correct horse archive staple';
const NOW = '2026-07-28T08:00:00.000Z';

async function workspaceArchive() {
  return buildWorkspaceArchive({
    cases: [],
    campaigns: [],
    brandProfiles: [],
    watchlists: {},
    shortlist: [],
    detectionRules: [],
    relationshipObservations: [],
    bulkSessions: [],
    websiteSnapshots: [],
    investigationTemplates: [],
    settings: { activeProfileId: '', theme: 'system' },
  }, { generatedAt: NOW });
}

describe('encrypted portable workspace archives', () => {
  test('round trips a checksummed workspace archive through authenticated encryption', async () => {
    const source = await workspaceArchive();
    const encrypted = await encryptWorkspaceArchive(source, PASSPHRASE);
    const decrypted = await decryptWorkspaceArchive(encrypted, PASSPHRASE);
    const parsed = await readWorkspaceArchive(decrypted);

    assert.equal(encrypted.schema, ENCRYPTED_WORKSPACE_ARCHIVE_SCHEMA);
    assert.equal(encrypted.version, ENCRYPTED_WORKSPACE_ARCHIVE_VERSION);
    assert.deepEqual(encrypted.content, {
      schema: WORKSPACE_ARCHIVE_SCHEMA,
      version: WORKSPACE_ARCHIVE_VERSION,
    });
    assert.deepEqual(encrypted.kdf, {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: WORKSPACE_ARCHIVE_PBKDF2_ITERATIONS,
      salt: encrypted.kdf.salt,
    });
    assert.deepEqual(encrypted.cipher, {
      name: 'AES-GCM',
      keyBits: 256,
      tagBits: 128,
      iv: encrypted.cipher.iv,
    });
    assert.equal(parsed.generatedAt, NOW);
    assert.equal(parsed.sections.length, 12);
    assert.equal(JSON.stringify(encrypted).includes(PASSPHRASE), false);
    assert.equal(JSON.stringify(encrypted).includes(WORKSPACE_ARCHIVE_SCHEMA), true);
  });

  test('uses fresh salt and initialization-vector values for each export', async () => {
    const source = await workspaceArchive();
    const first = await encryptWorkspaceArchive(source, PASSPHRASE);
    const second = await encryptWorkspaceArchive(source, PASSPHRASE);

    assert.notEqual(first.kdf.salt, second.kdf.salt);
    assert.notEqual(first.cipher.iv, second.cipher.iv);
    assert.notEqual(first.ciphertext, second.ciphertext);
  });

  test('preserves every readable legacy content version when locking an archive', async () => {
    for (const version of [1, 2, 3]) {
      const legacy = structuredClone(await workspaceArchive());
      Reflect.set(legacy, 'version', version);
      const encrypted = await encryptWorkspaceArchive(legacy, PASSPHRASE);

      assert.equal(encrypted.content.version, version);
      const decrypted = await decryptWorkspaceArchive(encrypted, PASSPHRASE);
      const parsed = await readWorkspaceArchive(decrypted);
      assert.equal(parsed.version, WORKSPACE_ARCHIVE_VERSION);
    }
  });

  test('reports one generic failure for a wrong passphrase or authenticated-data tampering', async () => {
    const encrypted = await encryptWorkspaceArchive(await workspaceArchive(), PASSPHRASE);
    await assert.rejects(
      decryptWorkspaceArchive(encrypted, 'different archive passphrase'),
      /passphrase is incorrect or the encrypted file is corrupted/,
    );

    const tampered = structuredClone(encrypted);
    tampered.createdAt = '2026-07-28T08:01:00.000Z';
    await assert.rejects(
      decryptWorkspaceArchive(tampered, PASSPHRASE),
      /passphrase is incorrect or the encrypted file is corrupted/,
    );
  });

  test('validates the fixed envelope before performing password work', async () => {
    const encrypted = await encryptWorkspaceArchive(await workspaceArchive(), PASSPHRASE);
    assert.equal(isEncryptedWorkspaceArchive(encrypted), true);
    assert.equal(isEncryptedWorkspaceArchive({ schema: WORKSPACE_ARCHIVE_SCHEMA }), false);
    const inspection = inspectEncryptedWorkspaceArchive(encrypted);
    assert.equal(inspection.createdAt, encrypted.createdAt);
    assert.ok(inspection.ciphertextBytes > 16);
    assert.ok(JSON.stringify(encrypted).length < MAX_ENCRYPTED_WORKSPACE_ARCHIVE_BYTES);

    const future = { ...encrypted, version: ENCRYPTED_WORKSPACE_ARCHIVE_VERSION + 1 };
    assert.throws(() => inspectEncryptedWorkspaceArchive(future), /newer schema 2/);

    const unknownField = { ...encrypted, unexpected: true };
    assert.throws(() => inspectEncryptedWorkspaceArchive(unknownField), /envelope is malformed/);

    const weakKdf = structuredClone(encrypted);
    Reflect.set(weakKdf.kdf, 'iterations', 1);
    assert.throws(() => inspectEncryptedWorkspaceArchive(weakKdf), /unsupported key-derivation contract/);

    const oversized = structuredClone(encrypted);
    oversized.ciphertext = 'A'.repeat(MAX_ENCRYPTED_WORKSPACE_ARCHIVE_BYTES);
    assert.throws(() => inspectEncryptedWorkspaceArchive(oversized), /ciphertext exceeds its byte limit/);
  });

  test('bounds passphrases before encryption or decryption', async () => {
    const source = await workspaceArchive();
    await assert.rejects(
      encryptWorkspaceArchive(source, 'x'.repeat(MIN_WORKSPACE_ARCHIVE_PASSPHRASE_CHARACTERS - 1)),
      /at least 12 characters/,
    );
    await assert.rejects(
      encryptWorkspaceArchive(source, '界'.repeat(400)),
      /limited to 1024 UTF-8 bytes/,
    );
    const encrypted = await encryptWorkspaceArchive(source, PASSPHRASE);
    await assert.rejects(
      decryptWorkspaceArchive(encrypted, 'too short'),
      /at least 12 characters/,
    );
  });

  test('fails explicitly when browser cryptography is unavailable', async () => {
    await assert.rejects(
      encryptWorkspaceArchive(await workspaceArchive(), PASSPHRASE, {} as Crypto),
      /unavailable in this browser/,
    );
  });

  test('refuses to encrypt a document that is not a valid ordinary workspace archive', async () => {
    await assert.rejects(
      encryptWorkspaceArchive({ schema: WORKSPACE_ARCHIVE_SCHEMA, version: WORKSPACE_ARCHIVE_VERSION }, PASSPHRASE),
      /manifest is missing or malformed/,
    );
  });
});
