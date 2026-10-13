import test from 'node:test';
import assert from 'node:assert/strict';
import { createCase } from '../packages/cases/case-record-operations.mts';
import { readCaseAttachment } from '../packages/cases/case-attachment-model.mts';
import { retainedGalleryInventory, resolveGalleryFile, filterGalleryFiles,
  gallerySelectionSignature, galleryObservationContext } from '../frontend/src/lib/analysis/retained-evidence-gallery.ts';

const attachment = (id: string, source: string | null = null) => readCaseAttachment({ id, fileName: `${id}.png`, mediaType: 'image/png',
  source, observedAt: null, retainedAt: '2026-09-01T00:00:00.000Z', byteLength: 12, digestSha256: `sha256:${'a'.repeat(64)}` });
const record = () => createCase({ domain: 'incident.example' }, '2026-09-01T00:00:00.000Z');

test('gallery resolves exact Case and file identities independently of shared pixels or titles', () => {
  const left = { ...record(), title: 'Same title', attachments: [attachment('selected', 'First declaration')] };
  const right = { ...record(), title: 'Same title', attachments: [attachment('selected', 'Other declaration')] };
  const inventory = retainedGalleryInventory([left, right]);
  assert.equal(inventory.files.length, 2); assert.notEqual(inventory.files[0]!.key, inventory.files[1]!.key);
  assert.equal(resolveGalleryFile([left, right], { caseId: right.id, attachmentId: 'selected' })!.attachment.source, 'Other declaration');
  assert.deepEqual(galleryObservationContext(inventory.files[0]!), { observedAt: null, observerLabel: null, vantageLabel: null, conditions: null });
  assert.equal(resolveGalleryFile([left, right], { caseId: 'missing', attachmentId: 'selected' }), null);
});

test('ambiguous Case or attachment identities cannot silently select a first record', () => {
  const original = { ...record(), attachments: [attachment('one')] };
  assert.equal(resolveGalleryFile([original, original], { caseId: original.id, attachmentId: 'one' }), null);
  assert.equal(retainedGalleryInventory([original, original]).ambiguous, 2);
  const duplicate = { ...original, attachments: [attachment('one'), attachment('one', 'Conflicting source')] };
  assert.equal(resolveGalleryFile([duplicate], { caseId: original.id, attachmentId: 'one' }), null);
  assert.equal(retainedGalleryInventory([duplicate]).files.length, 0);
});

test('all admitted metadata remains searchable without a smaller gallery cap and retained input stays unchanged', () => {
  const records = Array.from({ length: 3 }, (_, i) => ({ ...record(), attachments: Array.from({ length: 100 }, (_, j) => attachment(`file-${i}-${j}`)) }));
  const before = structuredClone(records), inventory = retainedGalleryInventory(records);
  assert.equal(inventory.files.length, 300); assert.equal(inventory.eligible, 300);
  assert.equal(inventory.ambiguous, 0); assert.deepEqual(records, before);
  assert.equal(filterGalleryFiles(inventory.files, 'png', 'file-2-99').length, 1);
  assert.throws(() => retainedGalleryInventory([{ ...record(), attachments: Array.from({ length: 129 }, (_, j) => attachment(`file-${j}`)) }]), /supported Case or attachment/);
});

test('metadata search separates PNG and text hints without inferring UTF-8 validity or observation attribution', () => {
  const text = readCaseAttachment({ ...attachment('text'), fileName: 'passage.txt', mediaType: 'application/octet-stream', source: 'Selected source' });
  const other = { ...record(), attachments: [attachment('image'), text] };
  const files = retainedGalleryInventory([other]).files;
  assert.equal(filterGalleryFiles(files, 'text', 'source').length, 1);
  assert.equal(filterGalleryFiles(files, 'png', 'source').length, 0);
  assert.equal(filterGalleryFiles(files, 'text', 'private body not indexed').length, 0);
});

test('prepared selection signatures invalidate on source, clock, file or Case revision changes', () => {
  const original = { ...record(), attachments: [attachment('one')] }, refs = [{ caseId: original.id, attachmentId: 'one' }];
  const first = gallerySelectionSignature([original], refs);
  assert.ok(first);
  for (const changed of [{ ...original, updatedAt: '2026-09-02T00:00:00.000Z' },
    { ...original, attachments: [attachment('one', 'Replacement provenance')] },
    { ...original, attachments: [readCaseAttachment({ ...attachment('one'), observedAt: '2026-09-02T00:00:00.000Z' })] }]) {
    assert.notEqual(gallerySelectionSignature([changed], refs), first);
  }
  assert.equal(gallerySelectionSignature([{ ...original, attachments: [] }], refs), null);
});
