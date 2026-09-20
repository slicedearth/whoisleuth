import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { MAX_SELECTED_FILES, MAX_SELECTED_FILE_BYTES } from '../packages/contracts/selected-file-limits.mts';
import { captureRetainedFiles, readRetainedFileReference, readVerifiedRetainedFileBytes, verifyRetainedFile } from '../packages/evidence/retained-file.mts';
import { plaintextLocalBinaryCodec } from '../frontend/src/lib/browser-local-binaries.ts';

const content = Buffer.from('Exact selected original\0\r\n\xff', 'latin1');
const reference = { digestSha256: `sha256:${createHash('sha256').update(content).digest('hex')}`, byteLength: content.length };
const file = new Blob([content]);

test('retained references are exact, bounded content identities rather than provenance', () => {
  assert.deepEqual(readRetainedFileReference(reference), reference);
  for (const value of [null, [], {}, { ...reference, source: 'not part of content identity' }, { ...reference, digestSha256: reference.digestSha256.toUpperCase() },
    ...[0, -1, 1.1, NaN, Infinity, MAX_SELECTED_FILE_BYTES + 1].map(byteLength => ({ ...reference, byteLength }))]) assert.throws(() => readRetainedFileReference(value));
});

test('selected file declarations are captured before asynchronous verification and never retain mutable bytes', async () => {
  const declaration = { ...reference }, selected = [{ reference: declaration, file }];
  const captured = captureRetainedFiles(selected);
  declaration.byteLength = 1; declaration.digestSha256 = `sha256:${'0'.repeat(64)}`; selected.length = 0;
  assert.equal(captured.length, 1);
  assert.deepEqual(captured[0]!.reference, reference);
  assert.ok(Object.isFrozen(captured)); assert.ok(Object.isFrozen(captured[0]!.reference));
  assert.deepEqual(Buffer.from(await captured[0]!.file.arrayBuffer()), content);
  await verifyRetainedFile(captured[0]!.reference, captured[0]!.file);
});

test('selection bounds are checked before reading any body and exact bytes reject alteration', async () => {
  const input = { reference, file };
  assert.equal(captureRetainedFiles(Array(MAX_SELECTED_FILES).fill(input)).length, MAX_SELECTED_FILES);
  assert.throws(() => captureRetainedFiles(Array(MAX_SELECTED_FILES + 1).fill(input)));
  assert.throws(() => captureRetainedFiles([{ reference, file: { size: reference.byteLength, arrayBuffer() { assert.fail('Untrusted body must not be read.'); } } as unknown as Blob }]));
  await assert.rejects(verifyRetainedFile(reference, new Blob([content.subarray(1)])), /length/);
  const changed = Buffer.from(content); changed[0] = changed[0]! ^ 1;
  await assert.rejects(verifyRetainedFile(reference, new Blob([changed])), /digest/);
  assert.deepEqual(Buffer.from(await readVerifiedRetainedFileBytes(reference, file)), content);
});

test('plaintext storage preserves exact bytes without JSON expansion and validates lookup scope', async () => {
  const lookupKey = await plaintextLocalBinaryCodec.lookupKey('cases', reference);
  const payload = await plaintextLocalBinaryCodec.encode({ collection: 'cases', lookupKey, reference, file });
  assert.equal(payload.byteLength, content.length);
  const pending = plaintextLocalBinaryCodec.decode({ collection: 'cases', lookupKey, reference, payload });
  new Uint8Array(payload).fill(0);
  const decoded = await pending;
  assert.deepEqual(Buffer.from(await decoded.arrayBuffer()), content);
  await assert.rejects(plaintextLocalBinaryCodec.decode({ collection: 'cases', lookupKey: 'wrong', reference, payload }));
  await assert.rejects(plaintextLocalBinaryCodec.decode({ collection: 'cases', lookupKey, reference, payload }), /digest/);
  await assert.rejects(plaintextLocalBinaryCodec.encode({ collection: 'cases', lookupKey: 'wrong', reference, file }));
});

test('the maximum selected file remains verifiable without changing the portable admission bound', async () => {
  const bytes = new Uint8Array(MAX_SELECTED_FILE_BYTES); bytes[0] = 1; bytes[bytes.length - 1] = 255;
  const maximum = { digestSha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, byteLength: bytes.length };
  const blob = new Blob([bytes]); bytes.fill(0);
  const selected = captureRetainedFiles([{ reference: maximum, file: blob }]);
  assert.equal(selected[0]!.file.size, MAX_SELECTED_FILE_BYTES);
  await verifyRetainedFile(maximum, selected[0]!.file);
  const payload = await plaintextLocalBinaryCodec.encode({ collection: 'cases', lookupKey: maximum.digestSha256, reference: maximum, file: selected[0]!.file });
  assert.equal(payload.byteLength, MAX_SELECTED_FILE_BYTES);
  const restored = await plaintextLocalBinaryCodec.decode({ collection: 'cases', lookupKey: maximum.digestSha256, reference: maximum, payload });
  await verifyRetainedFile(maximum, restored);
  assert.throws(() => captureRetainedFiles([...selected, { reference, file }]), /combined/);
});
