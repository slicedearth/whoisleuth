import test from 'node:test';
import assert from 'node:assert/strict';
import { createCase } from '../packages/cases/case-record-operations.mts';
import { readCaseAttachment } from '../packages/cases/case-attachment-model.mts';
import { retainedGalleryInventory, resolveGalleryFile, filterGalleryFiles,
  gallerySelectionSignature, galleryObservationContext, galleryComparisonUnavailableReason } from '../frontend/src/lib/analysis/retained-evidence-gallery.ts';
import { TEXT_COMPARISON_BYTES } from '../packages/comparison/text-passages.mts';
import { MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES } from '../packages/investigation/investigation-manifest.mts';

const attachment = (id: string, source: string | null = null) => readCaseAttachment({ id, fileName: `${id}.png`, mediaType: 'image/png',
  source, observedAt: null, retainedAt: '2026-09-01T00:00:00.000Z', byteLength: 12, digestSha256: `sha256:${'a'.repeat(64)}` });
const record = () => createCase({ domain: 'incident.example' }, '2026-09-01T00:00:00.000Z');

test('comparison eligibility explains selection and existing byte bounds without treating equal hashes as duplicate references', () => {
  const [left, right] = retainedGalleryInventory([{ ...record(), attachments: [attachment('one'), attachment('two')] }]).files;
  assert.match(galleryComparisonUnavailableReason('png')!, /reference file and a candidate file/u);
  assert.equal(galleryComparisonUnavailableReason('png', left), 'Choose a candidate file.');
  assert.equal(galleryComparisonUnavailableReason('png', undefined, right), 'Choose a reference file.');
  assert.equal(galleryComparisonUnavailableReason('png', left, left), 'Choose two different attachment references.');
  assert.equal(galleryComparisonUnavailableReason('text', left, right), 'Choose two text references.');
  assert.equal(left!.attachment.digestSha256, right!.attachment.digestSha256);
  assert.equal(galleryComparisonUnavailableReason('png', left, right), null);
  for (const [kind, ceiling] of [['text', TEXT_COMPARISON_BYTES], ['png', MAX_INVESTIGATION_MANIFEST_ARTIFACT_BYTES]] as const) {
    const reference = { ...left!, kind, attachment: { ...left!.attachment, byteLength: ceiling } };
    const candidate = { ...right!, kind, attachment: { ...right!.attachment, byteLength: ceiling } };
    assert.equal(galleryComparisonUnavailableReason(kind, reference, candidate), null);
    for (const pair of [[{ ...reference, attachment: { ...reference.attachment, byteLength: ceiling + 1 } }, candidate],
      [reference, { ...candidate, attachment: { ...candidate.attachment, byteLength: ceiling + 1 } }]] as const)
      assert.match(galleryComparisonUnavailableReason(kind, ...pair)!, /Choose smaller files without changing the retained originals\.$/u);
  }
});

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

test('prepared selection signatures invalidate on exact content and provenance changes', () => {
  const original = { ...record(), attachments: [attachment('one')] }, refs = [{ caseId: original.id, attachmentId: 'one' }];
  const first = gallerySelectionSignature([original], refs);
  assert.ok(first);
  for (const patch of [
    { source: 'Replacement provenance' },
    { observedAt: '2026-09-02T00:00:00.000Z' },
    { retainedAt: '2026-09-03T00:00:00.000Z' },
    { digestSha256: `sha256:${'b'.repeat(64)}` },
    { byteLength: 13 },
    { mediaType: 'application/octet-stream', fileName: 'one.txt' },
    { derivation: { method: 'png-regions-v1', sourceAttachmentId: 'parent',
      source: { digestSha256: `sha256:${'c'.repeat(64)}`, byteLength: 16 },
      plan: { width: 10, height: 10, regions: [{ x: 0, y: 0, width: 1, height: 1, kind: 'redact' }] } } },
  ]) {
    const changed = { ...original, attachments: [readCaseAttachment({ ...attachment('one'), ...patch })] };
    assert.notEqual(gallerySelectionSignature([changed], refs), first);
  }
  assert.equal(gallerySelectionSignature([{ ...original, attachments: [] }], refs), null);
  assert.equal(gallerySelectionSignature([{ ...original, attachments: [attachment('replacement')] }], refs), null);
  assert.equal(gallerySelectionSignature([original, original], refs), null);
});

test('display edits do not invalidate comparison inputs while current metadata remains readable', () => {
  const original = { ...record(), attachments: [attachment('one')] }, refs = [{ caseId: original.id, attachmentId: 'one' }];
  const updated = { ...original, title: 'Updated title', tags: ['reviewed'],
    notes: [{ id: 'note-one', createdAt: '2026-09-02T00:00:00.000Z', body: 'An unrelated note' }], updatedAt: '2026-09-02T00:00:00.000Z',
    attachments: [readCaseAttachment({ ...attachment('one'), fileName: 'renamed.png' })] };
  assert.equal(gallerySelectionSignature([updated], refs), gallerySelectionSignature([original], refs));
  assert.equal(resolveGalleryFile([updated], refs[0]!)!.caseTitle, 'Updated title');
  assert.equal(resolveGalleryFile([updated], refs[0]!)!.attachment.fileName, 'renamed.png');
  const noLongerText = { ...original, attachments: [readCaseAttachment({ ...attachment('one'), mediaType: 'application/octet-stream', fileName: 'one.bin' })] };
  assert.equal(gallerySelectionSignature([noLongerText], refs), null);
});

test('search is a view over inventory and reversing roles changes the ordered comparison identity', () => {
  const original = { ...record(), attachments: [attachment('one'), attachment('two')] };
  const refs = original.attachments.map(file => ({ caseId: original.id, attachmentId: file.id }));
  const inventory = retainedGalleryInventory([original]), first = gallerySelectionSignature([original], refs);
  assert.equal(filterGalleryFiles(inventory.files, 'png', 'no matching label').length, 0);
  assert.equal(resolveGalleryFile([original], refs[0]!)!.attachment.id, 'one');
  assert.equal(gallerySelectionSignature([original], refs), first);
  assert.notEqual(gallerySelectionSignature([original], [...refs].reverse()), first);
});
