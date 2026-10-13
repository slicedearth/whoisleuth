import test from 'node:test';
import assert from 'node:assert/strict';
import { brandReviewReferences } from '../frontend/src/lib/analysis/brand-review-references.ts';
import { createCase } from '../packages/cases/case-record-operations.mts';
import { readCaseAttachment } from '../packages/cases/case-attachment-model.mts';

const file = (id: string) => readCaseAttachment({ id, fileName: `${id}.png`, mediaType: 'image/png',
  source: 'Analyst source declaration', observedAt: null, retainedAt: '2026-09-01T00:00:00.000Z', byteLength: 12, digestSha256: `sha256:${'a'.repeat(64)}` });
const record = () => ({ ...createCase({ domain: 'official.example' }, '2026-09-01T00:00:00.000Z'), brandProfileIds: ['brand-a'], attachments: [file('one')] });

test('Brand references require explicit association and do not infer official status or observation context', () => {
  const linked = record(), unrelated = { ...record(), brandProfileIds: [] }, other = { ...record(), brandProfileIds: ['brand-b'] };
  const before = structuredClone([linked, unrelated, other]);
  const result = brandReviewReferences('brand-a', [linked, unrelated, other]);
  assert.equal(result.length, 1); assert.equal(result[0]!.reference.caseId, linked.id);
  assert.equal(result[0]!.attachment.observedAt, null); assert.equal(result[0]!.attachment.source, 'Analyst source declaration');
  assert.deepEqual([linked, unrelated, other], before);
  assert.deepEqual(brandReviewReferences('absent-brand', [linked, unrelated, other]), []);
});

test('unlinked duplicate Case identities cannot be hidden by the Brand scope filter', () => {
  const original = record();
  assert.deepEqual(brandReviewReferences('brand-a', [original, { ...original, brandProfileIds: [] }]), []);
  assert.deepEqual(brandReviewReferences('brand-a', [{ ...original, attachments: [file('duplicate'), file('duplicate')] }]), []);
});

test('all admitted PNG metadata stays selectable without a smaller inventory cap or text misclassification', () => {
  const records = Array.from({ length: 3 }, () => ({ ...record(), attachments: Array.from({ length: 100 }, (_, index) => file(`file-${index}`)) }));
  records[0]!.attachments[0] = readCaseAttachment({ ...file('text'), mediaType: 'application/octet-stream', fileName: 'page.txt' });
  assert.equal(brandReviewReferences('brand-a', records).length, 299);
  assert.throws(() => brandReviewReferences('brand-a', [{ ...record(), attachments: Array.from({ length: 129 }, (_, index) => file(`file-${index}`)) }]), /supported Case or attachment/);
});
