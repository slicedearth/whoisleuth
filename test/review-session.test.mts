import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { REVIEW_SESSION_COLLECTION } from '../frontend/src/lib/browser-local-data-definitions.ts';
import { WORKSPACE_ARCHIVE_COLLECTIONS } from '../packages/contracts/browser-local-collection-manifest.mts';
import { emptyReviewSessionStore, normalizeReviewSessionStore, normalizeReviewSessionPosition, normalizeReviewFormDraft, resolveReviewSessionSelection, reviewSessionStoreVersion, serializeReviewSessionStore } from '../packages/workspace/review-session.mts';
import type { ReviewSessionPosition } from '../packages/contracts/review-session-contract.mts';
import { MAX_ANALYST_REVIEW_ITEMS, MAX_ANALYST_REVIEW_RATIONALE_LENGTH } from '../packages/contracts/analyst-review-state-contract.mts';
import { MAX_REVIEW_SESSION_BYTES } from '../packages/contracts/review-session-contract.mts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/extracted-domain-lifecycle/review-session-v1.json', import.meta.url), 'utf8'));
const saved = normalizeReviewSessionStore(fixture).records[0]!;
const position: ReviewSessionPosition = { filters: saved.filters, drafts: [], selected: { id: 'review-one', subjectKey: 'subject-one', materialFingerprint: 'material-one', caseId: 'case-one' } };

test('the review checkpoint uses its existing provider codec but never enters portable workspace sections', () => {
  assert.equal(REVIEW_SESSION_COLLECTION.legacyRollback, false);
  assert.equal(WORKSPACE_ARCHIVE_COLLECTIONS.some(([, collection]) => String(collection) === 'review_session'), false);
  assert.deepEqual(normalizeReviewSessionStore(JSON.parse(serializeReviewSessionStore(fixture))), fixture);
  assert.deepEqual(REVIEW_SESSION_COLLECTION.normalize(REVIEW_SESSION_COLLECTION.join(REVIEW_SESSION_COLLECTION.split(fixture), 1)), fixture);
});
test('future, duplicate, unknown-field and invalid filter data fail without changing their input', () => {
  const invalids = [
    { ...fixture, version: 2 }, { ...fixture, records: [saved, saved] },
    { ...fixture, unexpected: 'unretained-value' }, { ...fixture, records: [{ ...saved, revision: '-'.repeat(36) }] },
    { ...fixture, records: [{ ...saved, filters: { ...saved.filters, queue: 'automatic_collection' } }] },
  ];
  for (const raw of invalids) { const before = structuredClone(raw); assert.throws(() => normalizeReviewSessionStore(raw)); assert.deepEqual(raw, before); }
  assert.equal(reviewSessionStoreVersion({ ...fixture, version: 2 }), 2);
  assert.equal(reviewSessionStoreVersion({ schema: 'unknown', version: 1 }), null);
});
test('checkpoint input is detached, bounded and excludes hidden fields or incomplete identities', () => {
  const raw = structuredClone(position);
  const normal = normalizeReviewSessionPosition(raw);
  assert.deepEqual(normal, raw); assert.notEqual(normal.filters, raw.filters); assert.notEqual(normal.selected, raw.selected);
  assert.throws(() => normalizeReviewSessionPosition({ ...raw, filters: { ...raw.filters, caseQuery: 'x'.repeat(254) } }));
  assert.throws(() => normalizeReviewSessionPosition({ ...raw, filters: { ...raw.filters, source: 'bad\nsource' } }));
  assert.throws(() => normalizeReviewSessionPosition({ ...raw, selected: { ...raw.selected, materialFingerprint: '' } }));
  assert.throws(() => normalizeReviewSessionPosition(JSON.parse('{"__proto__":{"polluted":true}}')));
  assert.deepEqual(emptyReviewSessionStore(), { schema: 'whoisleuth.review-session', version: 1, records: [] });
});
test('resume distinguishes unchanged, materially changed, unavailable and ambiguous subjects', () => {
  const item = position.selected!;
  assert.deepEqual(resolveReviewSessionSelection(position, [item]), { state: 'unchanged', index: 0 });
  assert.deepEqual(resolveReviewSessionSelection(position, [{ ...item, materialFingerprint: 'later' }]), { state: 'changed', index: 0 });
  assert.deepEqual(resolveReviewSessionSelection(position, [{ ...item, id: 'new-item', materialFingerprint: 'later' }]), { state: 'changed', index: 0 });
  assert.deepEqual(resolveReviewSessionSelection(position, [{ ...item, subjectKey: 'another-subject' }]), { state: 'unavailable', index: -1 });
  assert.deepEqual(resolveReviewSessionSelection(position, [{ ...item, id: 'second' }, { ...item, id: 'third' }]), { state: 'ambiguous', index: -1 });
  assert.deepEqual(resolveReviewSessionSelection({ ...position, selected: null }, [item]), { state: 'no_selection', index: -1 });
});

test('review drafts retain multiline rationale and uncertain write state without becoming decisions', () => {
  const draft = { ...position.selected!, disposition: 'suppressed', rationale: 'First line\nSecond line', expiresAt: '2026-10-01T00:00', reviewDueAt: '', uncertain: true };
  const { caseId: _caseId, ...form } = draft;
  const parsed = normalizeReviewFormDraft(form);
  assert.equal(parsed.uncertain, true); assert.equal(parsed.rationale, 'First line\nSecond line');
  assert.deepEqual(normalizeReviewSessionPosition({ ...position, drafts: [form] }).drafts, [form]);
  assert.throws(() => normalizeReviewSessionPosition({ ...position, drafts: [form, form] }), /duplicate/u);
  assert.throws(() => normalizeReviewFormDraft({ ...form, rationale: 'a'.repeat(1001) }), /over bound/u);
  assert.throws(() => normalizeReviewFormDraft({ ...form, unexpected: 'unretained' }), /unsupported fields/u);
});

test('a complete admitted queue of maximum-size forms remains retainable without truncation', () => {
  const drafts = Array.from({ length: MAX_ANALYST_REVIEW_ITEMS }, (_, index) => ({
    id: `${index}`.padEnd(512, '界'), subjectKey: '界'.repeat(512), materialFingerprint: '界'.repeat(512),
    disposition: 'suppressed' as const, rationale: '界'.repeat(MAX_ANALYST_REVIEW_RATIONALE_LENGTH),
    expiresAt: '2026-10-01T00:00:00.000', reviewDueAt: '2026-10-02T00:00:00.000', uncertain: true,
  }));
  const store = { ...fixture, records: [{ ...saved, ...position, drafts }] };
  const serialized = serializeReviewSessionStore(store);
  assert.ok(Buffer.byteLength(serialized) <= MAX_REVIEW_SESSION_BYTES);
  assert.deepEqual(normalizeReviewSessionStore(JSON.parse(serialized)).records[0]!.drafts, drafts);
  assert.throws(() => normalizeReviewSessionPosition({ ...position, drafts: [...drafts, { ...drafts[0], id: 'one-too-many' }] }), /queue size/u);
});
