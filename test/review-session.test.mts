import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { REVIEW_SESSION_COLLECTION } from '../frontend/src/lib/browser-local-data-definitions.ts';
import { WORKSPACE_ARCHIVE_COLLECTIONS } from '../packages/contracts/browser-local-collection-manifest.mts';
import { describeReviewSessionResume, emptyReviewSessionStore, mergeReviewSessionDrafts, normalizeReviewSessionStore, normalizeReviewSessionPosition, normalizeReviewFormDraft, resolveReviewSessionSelection, reviewSessionStoreVersion, serializeReviewSessionStore, type ReviewSessionResumeBriefing } from '../packages/workspace/review-session.mts';
import type { ReviewFormDraft, ReviewSessionPosition } from '../packages/contracts/review-session-contract.mts';
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

test('resume briefing shares the bounded current-form-wins merge without exposing draft content', () => {
  const older: ReviewFormDraft = { id: 'review-one', subjectKey: 'subject-one', materialFingerprint: 'material-one',
    disposition: 'open', rationale: 'Private earlier reasoning', expiresAt: '', reviewDueAt: '', uncertain: false };
  const current = { ...older, rationale: 'Private newer reasoning', uncertain: true };
  const another = { ...older, id: 'review-two', subjectKey: 'subject-two' };
  const checkpoint = { ...position, drafts: [older, another] };
  const before = structuredClone({ checkpoint, current });
  const merged = mergeReviewSessionDrafts(checkpoint.drafts, [current]);
  assert.ok(merged);
  assert.deepEqual(merged, { drafts: [current, another], keptOpen: 1, restored: 1 });
  assert.equal(merged.drafts[0], current, 'resume must preserve the already-open buffer');
  const briefing = describeReviewSessionResume(checkpoint, [{ ...position.selected!, materialFingerprint: 'later', title: 'Current retained review' }], merged);
  assert.deepEqual(briefing, { selected: { state: 'changed', index: 0 }, currentTitle: 'Current retained review',
    matchingItems: 1, restoredDrafts: 1, keptOpenDrafts: 1, uncertainDrafts: 1 });
  assert.doesNotMatch(JSON.stringify(briefing), /Private|reasoning|material-one/u);
  assert.deepEqual({ checkpoint, current }, before);
});

test('a resume briefing does not choose an ambiguous or unavailable item or invent a previous queue', () => {
  const merged = mergeReviewSessionDrafts([], []);
  assert.ok(merged);
  const item = { ...position.selected!, title: 'Current item' };
  for (const [items, state, title] of [
    [[item], 'unchanged', 'Current item'],
    [[], 'unavailable', null],
    [[{ ...item, id: 'second' }, { ...item, id: 'third' }], 'ambiguous', null],
  ] as const) {
    const briefing: ReviewSessionResumeBriefing = describeReviewSessionResume(position, items, merged);
    assert.equal(briefing.selected.state, state); assert.equal(briefing.currentTitle, title);
    assert.equal(briefing.matchingItems, items.length);
    assert.equal(briefing.restoredDrafts, 0); assert.equal(briefing.keptOpenDrafts, 0);
  }
  const noSelection = describeReviewSessionResume({ ...position, selected: null }, [item], merged);
  assert.equal(noSelection.selected.state, 'no_selection'); assert.equal(noSelection.currentTitle, null);
});

test('an over-capacity resume returns no merge and leaves every saved and open form intact', () => {
  const draft: ReviewFormDraft = { id: 'open', subjectKey: 'subject-one', materialFingerprint: 'material-one',
    disposition: '', rationale: 'Retain this buffer', expiresAt: '', reviewDueAt: '', uncertain: true };
  const current = Array.from({ length: MAX_ANALYST_REVIEW_ITEMS }, (_, index) => ({ ...draft, id: `open-${index}` }));
  const checkpoint = [{ ...draft, id: 'additional-copy' }];
  const before = structuredClone({ current, checkpoint });
  assert.equal(mergeReviewSessionDrafts(checkpoint, current), null);
  assert.deepEqual({ current, checkpoint }, before);
  assert.equal(mergeReviewSessionDrafts([current[0]!], current)?.drafts.length, MAX_ANALYST_REVIEW_ITEMS);
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
