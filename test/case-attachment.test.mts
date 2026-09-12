import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addCaseAttachments, caseAttachmentReferences, mergeCaseAttachments, readCaseAttachment, readCaseAttachments, removeCaseAttachment, type CaseAttachment } from '../packages/cases/case-attachment-model.mts';
import { createCase, normalizeCaseStore, serializeCaseStore, mergeCases, buildCaseExport, CASE_SCHEMA_VERSION, projectCaseForAudience } from '../packages/cases/case-model.mts';

const now = '2026-09-13T00:00:00.000Z';
const original: CaseAttachment = { id: 'original-one', fileName: 'private-original.png', mediaType: 'image/png',
  source: 'Private selected capture', observedAt: null, retainedAt: now, byteLength: 123, digestSha256: `sha256:${'a'.repeat(64)}` };
const record = createCase({ domain: 'attachment.invalid' }, now);

test('old current Cases keep their exact serialized shape when no attachment references exist', () => {
  const before = serializeCaseStore([record]);
  assert.ok(!before.includes('attachments'));
  const decoded = normalizeCaseStore(JSON.parse(before)).cases;
  assert.equal(serializeCaseStore(decoded), before);
  assert.equal(readCaseAttachments(undefined), undefined);
});

test('exact file content can have independent Case provenance without merging those references', () => {
  const second = { ...original, id: 'original-two', source: 'Independent observation', observedAt: now };
  const updated = addCaseAttachments(record, [original, second], now);
  assert.equal(updated.attachments?.length, 2);
  assert.equal(caseAttachmentReferences([updated]).length, 2);
  assert.notEqual(updated.attachments![0]!.source, updated.attachments![1]!.source);
  assert.deepEqual(normalizeCaseStore(JSON.parse(serializeCaseStore([updated]))).cases[0]!.attachments, [original, second]);
  assert.equal(mergeCaseAttachments(updated.attachments, [original])?.length, 2);
});

test('attachment metadata is strict, path-free and cannot silently change an existing provenance identity', () => {
  for (const value of [{ ...original, fileName: '/private/source.png' }, { ...original, fileName: '..\\source.png' }, { ...original, observedAt: 'yesterday' },
    { ...original, retainedAt: null }, { ...original, byteLength: 0 }, { ...original, extra: 'unknown' }, { ...original, mediaType: 'text/html' }]) assert.throws(() => readCaseAttachment(value));
  assert.throws(() => readCaseAttachments([original, original]), /unique/);
  assert.throws(() => readCaseAttachments([original, { ...original, id: 'second', byteLength: 124 }]), /conflicting/);
  assert.throws(() => mergeCaseAttachments([original], [{ ...original, source: 'Changed observation' }]), /conflicts/);
});

test('file references survive internal portability but never enter trusted or public Case exports', () => {
  const updated = addCaseAttachments(record, [original], now);
  const exported = buildCaseExport([updated], now);
  const restored = mergeCases([], exported).cases[0]!;
  assert.deepEqual(restored.attachments, [original]);
  for (const audience of ['public', 'trusted'] as const) {
    const output = JSON.stringify(projectCaseForAudience(updated, audience));
    for (const secret of ['private-original.png', 'Private selected capture', original.digestSha256, 'original-one']) assert.ok(!output.includes(secret));
  }
  assert.deepEqual(projectCaseForAudience(updated, 'internal').attachments, [original]);
  assert.throws(() => normalizeCaseStore({ version: CASE_SCHEMA_VERSION - 1, cases: [updated] }), /current Case schema/);
});

test('removal is deliberate, conflict-aware and leaves unrelated references intact', () => {
  const second = { ...original, id: 'second', source: 'Other provenance' };
  const updated = addCaseAttachments(record, [original, second], now);
  assert.throws(() => removeCaseAttachment(updated, original.id, { ...original, fileName: 'changed.png' }, now), /another tab/);
  const removed = removeCaseAttachment(updated, original.id, original, now);
  assert.deepEqual(removed.attachments, [second]);
  assert.equal(removeCaseAttachment(removed, original.id, original, now), removed);
  assert.equal(updated.attachments?.length, 2);
});
