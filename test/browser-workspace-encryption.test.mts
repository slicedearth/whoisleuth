import assert from 'node:assert/strict';
import { createDecipheriv, createHash, createHmac, pbkdf2Sync } from 'node:crypto';
import { test } from 'node:test';
import { decodeBase64url, encodeBase64url } from '../lib/base64url.mts';
import { createBrowserWorkspaceEncryption, unlockBrowserWorkspaceEncryption } from '../frontend/src/lib/browser-workspace-encryption.ts';
import { readBrowserWorkspaceEncryption } from '../frontend/src/lib/browser-workspace-encryption-model.ts';
import { readBrowserWorkspace } from '../frontend/src/lib/browser-workspace-directory.ts';
import { MAX_CASE_STORE_BYTES } from '../packages/contracts/case-portability.mts';
import { decodeLocalDataSnapshots, plaintextJsonCodec, prepareLocalDataContent, type BrowserLocalCollectionManifest, type LocalDataCollectionDefinition } from '../frontend/src/lib/browser-local-data.ts';

const ID = '00000000-0000-4000-8000-000000000001';
const OTHER_ID = '00000000-0000-4000-8000-000000000002';
const PASSPHRASE = 'synthetic workspace fixture phrase';
const encryption = await createBrowserWorkspaceEncryption(ID, PASSPHRASE);
const unlocked = await unlockBrowserWorkspaceEncryption(ID, encryption, PASSPHRASE);
const definition: LocalDataCollectionDefinition<string[]> = {
  id: 'fixture', label: 'Fixture records', legacyKey: 'fixture-legacy', schemaVersion: 1,
  maximumBytes: 512, maximumRecords: 20, empty: () => [], acceptLegacyRoot: Array.isArray,
  version: () => 1, serialize: JSON.stringify,
  normalize: value => { if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error('Invalid fixture'); return value; },
  split: values => values.map((value, i) => ({ id: `record-${i}`, value })), join: records => records.map(record => record.value),
};
const fixtureManifest = (content: Awaited<ReturnType<typeof prepareLocalDataContent>>): BrowserLocalCollectionManifest => ({
  collection: definition.id, schemaVersion: 1, codec: 'aes-gcm-hmac-v1', revision: 1,
  recordCount: content.records.length, serializedBytes: content.serializedBytes, digest: content.digest,
  source: 'application', updatedAt: '2026-09-01T00:00:00.000Z', legacyKey: definition.legacyKey, legacyDigest: null,
});

test('base64url is canonical, bounded before allocation and agrees with independent encoding', () => {
  for (let length = 1; length <= 256; length++) {
    const bytes = Uint8Array.from({ length }, (_, i) => i);
    const encoded = Buffer.from(bytes).toString('base64url');
    assert.equal(encodeBase64url(bytes), encoded);
    assert.deepEqual(decodeBase64url(encoded, length, length), bytes);
    assert.throws(() => decodeBase64url(encoded, length - 1));
  }
  for (const malformed of ['', 'A', 'AB', 'AAB', 'AA=', 'AA+', 'AA/', ' A', null, {}, 'A'.repeat(100)]) assert.throws(() => decodeBase64url(malformed, 16));
  assert.throws(() => decodeBase64url('AA', 16, 2));
});

test('workspace metadata fails closed for future algorithms, malformed encodings and unknown fields', () => {
  assert.deepEqual(readBrowserWorkspaceEncryption(encryption), encryption);
  assert.ok(Object.isFrozen(readBrowserWorkspaceEncryption(encryption)));
  assert.throws(() => readBrowserWorkspaceEncryption(Object.assign(Object.create({ verifier: encryption.verifier }), { version: 1, salt: encryption.salt, unrelated: true })));
  for (const invalid of [null, [], { ...encryption, version: 2 }, { ...encryption, extra: true }, { ...encryption, salt: '' }, { ...encryption, verifier: 'A'.repeat(42) }, { ...encryption, salt: `${encryption.salt}=` }]) assert.throws(() => readBrowserWorkspaceEncryption(invalid));
  const row = { id: ID, name: 'Protected fixture', revision: 1, state: 'ready', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', encryption };
  assert.deepEqual(readBrowserWorkspace(row).encryption, encryption);
  assert.throws(() => readBrowserWorkspace({ ...row, encryption: { ...encryption, version: 2 } }));
});

test('rejects invalid passphrases and does not permit default-workspace conversion', async () => {
  for (const passphrase of ['short', 'x'.repeat(1025), '😀'.repeat(300)]) await assert.rejects(createBrowserWorkspaceEncryption(ID, passphrase), /passphrase/i);
  await assert.rejects(createBrowserWorkspaceEncryption('default', PASSPHRASE), /not converted/);
  await assert.rejects(unlockBrowserWorkspaceEncryption(ID, encryption, 'a different fixture phrase'), /incorrect or.*damaged/);
  await assert.rejects(unlockBrowserWorkspaceEncryption(OTHER_ID, encryption, PASSPHRASE), /incorrect or.*damaged/);
});

test('uses independent cipher and authentication keys, fresh record nonces and private lookup identifiers', async () => {
  const input = { collection: 'fixture', id: 'sensitive.example', value: { note: 'private retained observation' }, maximumBytes: 512 };
  const first = await unlocked.codec.encode(input);
  const second = await unlocked.codec.encode(input);
  assert.equal(first.lookupKey, second.lookupKey);
  assert.notEqual(first.payload, second.payload);
  assert.ok(!JSON.stringify(first).includes(input.id));
  assert.ok(!JSON.stringify(first).includes(input.value.note));
  const material = pbkdf2Sync(PASSPHRASE, Buffer.from(encryption.salt, 'base64url'), 600_000, 64, 'sha256');
  const lookup = createHmac('sha256', material.subarray(32)).update(JSON.stringify(['aes-gcm-hmac-v1', ID, 'lookup', 'fixture', input.id])).digest('base64url');
  assert.equal(first.lookupKey, lookup);
  const [iv, body] = first.payload.split('.').map(value => Buffer.from(value, 'base64url'));
  assert.equal(iv!.length, 12);
  const cipher = createDecipheriv('aes-256-gcm', material.subarray(0, 32), iv!);
  cipher.setAAD(Buffer.from(JSON.stringify(['aes-gcm-hmac-v1', ID, 'record', 'fixture', lookup])));
  cipher.setAuthTag(body!.subarray(-16));
  const plaintext = Buffer.concat([cipher.update(body!.subarray(0, -16)), cipher.final()]);
  assert.deepEqual(JSON.parse(plaintext.toString()), { id: input.id, value: input.value });
  material.fill(0); plaintext.fill(0);
});

test('encrypted records reject altered ciphertext, lookup keys, collection scope and malformed or oversized envelopes', async () => {
  const encoded = await unlocked.codec.encode({ collection: 'fixture', id: 'record-0', value: 'retained', maximumBytes: 512 });
  const input = { collection: 'fixture', ...encoded, maximumBytes: 512 };
  assert.deepEqual(await unlocked.codec.decode(input), { id: 'record-0', value: 'retained' });
  for (const change of [{ collection: 'other' }, { lookupKey: 'other' }, { payload: encoded.payload.replace(/^./u, encoded.payload[0] === 'A' ? 'B' : 'A') }, { payload: `${encoded.payload}.extra` }, { payload: 'A'.repeat(1000) }]) await assert.rejects(unlocked.codec.decode({ ...input, ...change }));
});

test('collection authentication rejects deletion, order changes, schema substitution and rehashed ciphertext', async () => {
  const content = await prepareLocalDataContent(definition, ['first', 'second'], unlocked.codec);
  const manifest = fixtureManifest(content);
  assert.deepEqual(await decodeLocalDataSnapshots([definition], [{ manifest, records: [...content.records] }], unlocked.codec), [['first', 'second']]);
  const reordered = content.records.map(record => ({ ...record, ordinal: 1 - record.ordinal }));
  const shortened = [content.records[0]!];
  const unkeyed = createHash('sha256').update(JSON.stringify(shortened.map(record => [record.lookupKey, record.ordinal, record.codec, record.payload, record.payloadBytes]))).digest('base64url');
  for (const captured of [
    { manifest, records: reordered },
    { manifest: { ...manifest, recordCount: 1, digest: unkeyed }, records: shortened },
    { manifest: { ...manifest, serializedBytes: manifest.serializedBytes + 1 }, records: [...content.records] },
  ]) await assert.rejects(decodeLocalDataSnapshots([definition], [captured], unlocked.codec), /verified manifest/);
  await assert.rejects(decodeLocalDataSnapshots([{ ...definition, schemaVersion: 2 }], [{ manifest: { ...manifest, schemaVersion: 2 }, records: [...content.records] }], unlocked.codec), /verified manifest/);
});

test('encrypted empty collections are authenticated and codec mismatch never reads them as plaintext', async () => {
  const content = await prepareLocalDataContent(definition, [], unlocked.codec);
  const manifest = fixtureManifest(content);
  assert.deepEqual(await decodeLocalDataSnapshots([definition], [{ manifest, records: [] }], unlocked.codec), [[]]);
  assert.notEqual(content.digest, createHash('sha256').update('[]').digest('base64url'));
  await assert.rejects(decodeLocalDataSnapshots([definition], [{ manifest, records: [] }], plaintextJsonCodec));
});

test('ciphertext overhead admits a valid maximum record without raising its plaintext limit', async () => {
  const value = 'x'.repeat(480);
  const input = { collection: 'fixture', id: 'record-0', value, maximumBytes: 508 };
  assert.equal(Buffer.byteLength(JSON.stringify({ id: input.id, value })), 508);
  const encrypted = await unlocked.codec.encode(input);
  assert.ok(encrypted.payload.length > input.maximumBytes);
  assert.deepEqual(await unlocked.codec.decode({ ...encrypted, collection: input.collection, maximumBytes: input.maximumBytes }), { id: input.id, value });
  await assert.rejects(unlocked.codec.encode({ ...input, maximumBytes: 507 }));
  await assert.rejects(unlocked.codec.decode({ ...encrypted, collection: input.collection, maximumBytes: 507 }));
  const prepared = await prepareLocalDataContent(definition, [value], unlocked.codec);
  assert.deepEqual(await decodeLocalDataSnapshots([definition], [{ manifest: fixtureManifest(prepared), records: prepared.records }], unlocked.codec), [[value]]);
});

test('the codec preserves an exact maximum Case-store-sized record', async () => {
  const id = 'record-0';
  const overhead = Buffer.byteLength(JSON.stringify({ id, value: '' }));
  const value = 'x'.repeat(MAX_CASE_STORE_BYTES - overhead);
  const input = { collection: 'fixture', id, value, maximumBytes: MAX_CASE_STORE_BYTES };
  assert.equal(Buffer.byteLength(JSON.stringify({ id, value })), MAX_CASE_STORE_BYTES);
  const encoded = await unlocked.codec.encode(input);
  assert.deepEqual(await unlocked.codec.decode({ collection: input.collection, ...encoded, maximumBytes: MAX_CASE_STORE_BYTES }), { id, value });
  await assert.rejects(unlocked.codec.decode({ collection: input.collection, ...encoded, maximumBytes: MAX_CASE_STORE_BYTES - 1 }));
});

test('revoking a workspace key prevents subsequent reads, writes and collection authentication', async () => {
  const local = await unlockBrowserWorkspaceEncryption(ID, encryption, PASSPHRASE);
  const encoded = await local.codec.encode({ collection: 'fixture', id: 'record-0', value: 'private', maximumBytes: 512 });
  local.lock(); local.lock();
  await assert.rejects(local.codec.decode({ collection: 'fixture', ...encoded, maximumBytes: 512 }), /Unlock this encrypted workspace/);
  await assert.rejects(local.codec.encode({ collection: 'fixture', id: 'record-0', value: 'private', maximumBytes: 512 }), /Unlock this encrypted workspace/);
  await assert.rejects(prepareLocalDataContent(definition, [], local.codec), /Unlock this encrypted workspace/);
});

test('invalid codec resource and integrity declarations cannot bypass provider bounds', async () => {
  for (const value of [NaN, Infinity, -1, 0, 1.5, 100_000]) {
    await assert.rejects(prepareLocalDataContent(definition, ['record'], { ...unlocked.codec, encodedBytes: () => value }), /unsupported encoding bound/);
  }
  await assert.rejects(prepareLocalDataContent(definition, [], { ...unlocked.codec, digestCollection: async () => 'invalid' }), /invalid integrity value/);
});
