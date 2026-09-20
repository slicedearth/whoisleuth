import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { unzipSync, zipSync } from 'fflate';
import { buildInvestigationPackage, MAX_INVESTIGATION_PACKAGE_BYTES } from '../packages/investigation/investigation-package.mts';
import { decryptInvestigationPackage, encryptInvestigationPackage, inspectEncryptedInvestigationPackage } from '../packages/investigation/investigation-package-crypto.mts';
import { MAX_ENCRYPTED_INVESTIGATION_PACKAGE_BYTES } from '../packages/contracts/investigation-package-limits.mts';
import { arrayBuffer } from '../packages/evidence/passphrase-encryption.mts';

const PASSPHRASE = 'independent package fixture passphrase';
const CONTENT = new Uint8Array([0, 255, 128, 13, 10, 1]);
test('native crypto byte conversion copies only the selected view, including pooled runtime buffers', () => {
  const backing = Buffer.from([99, 1, 2, 3, 88]), selected = backing.subarray(1, 4);
  const copied = arrayBuffer(selected); backing.fill(0);
  assert.deepEqual([...new Uint8Array(copied)], [1, 2, 3]);
});
const build = () => buildInvestigationPackage({ workflow: 'Selected evidence', configurationDigestSha256: null,
  artifacts: [{ content: CONTENT, source: { identity: 'Declared source', observedAt: null } }],
}, '2026-09-13T00:00:00.000Z', '2.4.0');

// Independent format expectations: fixed v1 header and native runtime crypto,
// not the production encoder or its constants, construct adversarial inputs.
function seal(bytes: Uint8Array, passphrase = PASSPHRASE): Uint8Array {
  const header = Buffer.alloc(58);
  header.write('WHOISLEUTH-ENCRYPTED\0', 0, 'ascii'); header[21] = 1;
  header.writeUInt32BE(600_000, 22); header.fill(1, 26, 42); header.fill(2, 42, 54);
  header.writeUInt32BE(bytes.byteLength, 54);
  const key = pbkdf2Sync(passphrase, header.subarray(26, 42), 600_000, 32, 'sha256');
  try {
    const cipher = createCipheriv('aes-256-gcm', key, header.subarray(42, 54)); cipher.setAAD(header);
    return new Uint8Array(Buffer.concat([header, cipher.update(bytes), cipher.final(), cipher.getAuthTag()]));
  } finally { key.fill(0); }
}

test('encrypted package v1 immutable bytes and current output use the independent authenticated format', async () => {
  const fixture = Buffer.from(readFileSync(new URL('./fixtures/encrypted-evidence-package-v1.hex', import.meta.url), 'utf8').trim(), 'hex');
  const retained = await decryptInvestigationPackage(fixture, PASSPHRASE);
  assert.deepEqual(retained.review.contents.get('artifact-1'), CONTENT);
  assert.equal(retained.review.manifest.version, 3);
  const built = await build(), encrypted = await encryptInvestigationPackage(built.bytes, PASSPHRASE);
  assert.equal(Buffer.from(encrypted.subarray(0, 21)).toString('ascii'), 'WHOISLEUTH-ENCRYPTED\0');
  assert.equal(encrypted[21], 1);
  const header = Buffer.from(encrypted.subarray(0, 58));
  assert.equal(header.readUInt32BE(22), 600_000); assert.equal(header.readUInt32BE(54), built.bytes.length);
  assert.equal(encrypted.length, built.bytes.length + 74);
  const key = pbkdf2Sync(PASSPHRASE, header.subarray(26, 42), 600_000, 32, 'sha256');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(42, 54));
    decipher.setAAD(header); decipher.setAuthTag(encrypted.subarray(-16));
    assert.deepEqual(new Uint8Array(Buffer.concat([decipher.update(encrypted.subarray(58, -16)), decipher.final()])), built.bytes);
  } finally { key.fill(0); }
  retained.bytes.fill(0);
  assert.deepEqual(retained.review.contents.get('artifact-1'), CONTENT, 'verified files own their bytes independently of the decrypted ZIP');
  assert.equal(retained.review.signatureTrust, 'not_checked');
  assert.equal(retained.review.factualAccuracy, 'not_established');
});

test('each encryption has fresh salt and IV, while snapshots preserve caller bytes across asynchronous work', async () => {
  const built = await build(), original = built.bytes.slice();
  const pending = encryptInvestigationPackage(built.bytes, PASSPHRASE); built.bytes.fill(0);
  const encrypted = await pending, second = await encryptInvestigationPackage(original, PASSPHRASE);
  assert.notDeepEqual(encrypted.slice(26, 42), second.slice(26, 42));
  assert.notDeepEqual(encrypted.slice(42, 54), second.slice(42, 54));
  assert.doesNotMatch(Buffer.from(encrypted).toString('utf8'), /Declared source|Selected evidence|artifact-1|manifest\.json/u);
  const unlocking = decryptInvestigationPackage(encrypted, PASSPHRASE); encrypted.fill(0);
  assert.deepEqual((await unlocking).bytes, original);
});

test('malformed headers and oversized inputs are rejected before any key derivation', async () => {
  const encrypted = seal((await build()).bytes);
  const unsupported = [encrypted.slice(0, -1), new Uint8Array([...encrypted, 0]), encrypted.slice(0, 58)];
  for (const [offset, value] of [[0, 0], [21, 2], [22, 255], [54, 255]] as const) {
    const changed = encrypted.slice(); changed[offset] = value; unsupported.push(changed);
  }
  let calls = 0;
  const unavailable = { getRandomValues() { calls++; throw new Error('unexpected crypto'); } } as unknown as Crypto;
  for (const input of unsupported) await assert.rejects(decryptInvestigationPackage(input, PASSPHRASE, unavailable), /version|parameters|length|malformed/u);
  const oversized = new Uint8Array(22); Object.defineProperty(oversized, 'byteLength', { value: MAX_ENCRYPTED_INVESTIGATION_PACKAGE_BYTES + 1 });
  await assert.rejects(decryptInvestigationPackage(oversized, PASSPHRASE, unavailable), /byte limit/u);
  await assert.rejects(encryptInvestigationPackage(oversized, PASSPHRASE, unavailable), /byte limit/u);
  await assert.rejects(encryptInvestigationPackage(new Uint8Array(new SharedArrayBuffer(22)), PASSPHRASE), /shared memory/u);
  assert.equal(calls, 0);
  assert.equal(MAX_ENCRYPTED_INVESTIGATION_PACKAGE_BYTES - MAX_INVESTIGATION_PACKAGE_BYTES, 74);
});

test('wrong passphrases and every authenticated region fail without a plaintext fallback', async () => {
  const encrypted = seal((await build()).bytes);
  await assert.rejects(decryptInvestigationPackage(encrypted, 'different valid passphrase'), /incorrect|corrupted/u);
  for (const offset of [26, 42, 58, encrypted.length - 1]) {
    const changed = encrypted.slice(); changed[offset] = changed[offset]! ^ 1;
    assert.equal(inspectEncryptedInvestigationPackage(changed).version, 1);
    await assert.rejects(decryptInvestigationPackage(changed, PASSPHRASE), /incorrect|corrupted/u);
  }
  for (const passphrase of ['', 'short', 'é'.repeat(513), 'x'.repeat(1025)]) {
    await assert.rejects(decryptInvestigationPackage(encrypted, passphrase), /passphrase/u);
    await assert.rejects(encryptInvestigationPackage((await build()).bytes, passphrase), /passphrase/u);
  }
});

test('authenticated ciphertext does not bypass inner path, CRC, manifest or file identity checks', async () => {
  const built = await build(), files = unzipSync(built.bytes);
  const crc = built.bytes.slice(); crc[14] = crc[14]! ^ 1;
  const differentFiles = { ...files, 'artifacts/artifact-1': new Uint8Array([3, 2, 1]) };
  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json'])); manifest.version = 999;
  const invalid = [crc, zipSync({ '../outside': CONTENT }), zipSync(differentFiles),
    zipSync({ ...files, 'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)) })];
  for (const input of invalid) {
    await assert.rejects(decryptInvestigationPackage(seal(input), PASSPHRASE));
    await assert.rejects(encryptInvestigationPackage(input, PASSPHRASE));
  }
});
