import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { REVIEW_SESSION_COLLECTION } from '../frontend/src/lib/browser-local-data-definitions.ts';
import { WORKSPACE_ARCHIVE_COLLECTIONS } from '../packages/contracts/browser-local-collection-manifest.mts';
import { compareReviewSessionBaseline, createReviewSessionBaseline, describeReviewSessionResume, emptyReviewSessionStore, mergeReviewSessionDrafts, normalizeReviewSessionStore, normalizeReviewSessionPosition, normalizeReviewFormDraft, resolveReviewSessionSelection, reviewSessionStoreVersion, serializeReviewSessionStore, type ReviewSessionResumeBriefing } from '../packages/workspace/review-session.mts';
import type { ReviewFormDraft, ReviewSessionPosition } from '../packages/contracts/review-session-contract.mts';
import { MAX_ANALYST_REVIEW_ITEMS, MAX_ANALYST_REVIEW_RATIONALE_LENGTH } from '../packages/contracts/analyst-review-state-contract.mts';
import { MAX_REVIEW_SESSION_BYTES } from '../packages/contracts/review-session-contract.mts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/extracted-domain-lifecycle/review-session-v1.json', import.meta.url), 'utf8'));
const saved = normalizeReviewSessionStore(fixture).records[0]!;
const currentStore = { ...emptyReviewSessionStore(), records: [saved] };
const position: ReviewSessionPosition = { question: '', baseline: null, filters: saved.filters, drafts: [], selected: { id: 'review-one', subjectKey: 'subject-one', materialFingerprint: 'material-one', caseId: 'case-one' } };

test('the review checkpoint uses its existing provider codec but never enters portable workspace sections', () => {
  assert.equal(REVIEW_SESSION_COLLECTION.legacyRollback, false);
  assert.equal(WORKSPACE_ARCHIVE_COLLECTIONS.some(([, collection]) => String(collection) === 'review_session'), false);
  const original = structuredClone(fixture);
  assert.equal(saved.question, null); assert.equal(saved.baseline, null);
  assert.deepEqual(normalizeReviewSessionStore(JSON.parse(serializeReviewSessionStore(fixture))), currentStore);
  assert.deepEqual(REVIEW_SESSION_COLLECTION.normalize(REVIEW_SESSION_COLLECTION.join(REVIEW_SESSION_COLLECTION.split(fixture), 1)), currentStore);
  assert.deepEqual(fixture, original);
  const current = JSON.parse(readFileSync(new URL('./fixtures/extracted-domain-lifecycle/review-session-v2.json', import.meta.url), 'utf8'));
  assert.deepEqual(normalizeReviewSessionStore(current), current);
  assert.deepEqual(JSON.parse(serializeReviewSessionStore(current)), current);
});
test('future, duplicate, unknown-field and invalid filter data fail without changing their input', () => {
  const invalids = [
    { ...currentStore, version: 3 }, { ...currentStore, records: [saved, saved] },
    { ...currentStore, unexpected: 'unretained-value' }, { ...currentStore, records: [{ ...saved, revision: '-'.repeat(36) }] },
    { ...currentStore, records: [{ ...saved, filters: { ...saved.filters, queue: 'automatic_collection' } }] },
    { ...fixture, records: [saved] },
  ];
  for (const raw of invalids) { const before = structuredClone(raw); assert.throws(() => normalizeReviewSessionStore(raw)); assert.deepEqual(raw, before); }
  assert.equal(reviewSessionStoreVersion({ ...fixture, version: 3 }), 3);
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
  assert.deepEqual(emptyReviewSessionStore(), { schema: 'whoisleuth.review-session', version: 2, records: [] });
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
    matchingItems: 1, restoredDrafts: 1, keptOpenDrafts: 1, uncertainDrafts: 1,
    comparison: { state: 'unknown', unchanged: 0, changed: 0, newlyMatching: 0, ambiguous: 0, unavailable: 0 } });
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
  const store = { ...currentStore, records: [{ ...saved, ...position, drafts }] };
  const serialized = serializeReviewSessionStore(store);
  assert.ok(Buffer.byteLength(serialized) <= MAX_REVIEW_SESSION_BYTES);
  assert.deepEqual(normalizeReviewSessionStore(JSON.parse(serialized)).records[0]!.drafts, drafts);
  assert.throws(() => normalizeReviewSessionPosition({ ...position, drafts: [...drafts, { ...drafts[0], id: 'one-too-many' }] }), /queue size/u);
});

test('explicit baselines retain only comparison fields and distinguish view membership from collection', () => {
  const row = { id: 'row-one', subjectKey: 'subject-one', materialFingerprint: 'fingerprint-one',
    sourceIds: ['source-b', 'source-a'], completeness: 'complete' as const, detail: 'PRIVATE SOURCE PAYLOAD' };
  const baseline = createReviewSessionBaseline([row], { sourcesAvailable: true, truncated: false });
  row.sourceIds.push('later');
  assert.deepEqual(baseline.items[0]!.sourceIds, ['source-a', 'source-b']);
  assert.doesNotMatch(JSON.stringify(baseline), /PRIVATE|detail/u);
  const view = (items: typeof baseline.items) => ({ ...baseline, items });
  const before = view([
    baseline.items[0]!,
    { ...baseline.items[0]!, id: 'row-two', subjectKey: 'subject-two' },
    { ...baseline.items[0]!, id: 'row-three', subjectKey: 'subject-three' },
  ]);
  const after = view([
    baseline.items[0]!,
    { ...baseline.items[0]!, id: 'row-two-later', subjectKey: 'subject-two', materialFingerprint: 'changed' },
    { ...baseline.items[0]!, id: 'new-match', subjectKey: 'new-match' },
  ]);
  assert.deepEqual(compareReviewSessionBaseline(before, after), {
    state: 'comparable', unchanged: 1, changed: 1, newlyMatching: 1, ambiguous: 0, unavailable: 1,
  });
  const ambiguous = compareReviewSessionBaseline(baseline, view([baseline.items[0]!, { ...baseline.items[0]!, id: 'duplicate-subject' }]));
  assert.equal(ambiguous.ambiguous, 1); assert.equal(ambiguous.unchanged, 0);
  assert.equal(compareReviewSessionBaseline(null, baseline).state, 'unknown');
  assert.equal(compareReviewSessionBaseline(baseline, null).state, 'unknown');
  for (const current of [
    { ...baseline, sourcesAvailable: false },
    view([{ ...baseline.items[0]!, sourceIds: ['different-source'] }]),
  ]) {
    const compared = compareReviewSessionBaseline(baseline, current);
    assert.equal(compared.state, 'qualified'); assert.equal(compared.unavailable, 1);
    assert.equal(compared.unchanged + compared.changed, 0);
  }
  const partial = view([{ ...baseline.items[0]!, completeness: 'partial' }]);
  assert.deepEqual(compareReviewSessionBaseline(baseline, partial), {
    state: 'qualified', unchanged: 0, changed: 1, newlyMatching: 0, ambiguous: 0, unavailable: 0,
  });
  assert.equal(compareReviewSessionBaseline(partial, partial).unchanged, 1, 'matching retained context does not certify full evidence');
  assert.equal(compareReviewSessionBaseline({ ...baseline, truncated: true }, after).state, 'qualified');
  const submitted = { ...position, question: 'Which retained observations still need independent support?', baseline };
  assert.deepEqual(normalizeReviewSessionPosition(submitted), submitted);
  assert.throws(() => normalizeReviewSessionPosition({ ...submitted, question: 'x'.repeat(MAX_ANALYST_REVIEW_RATIONALE_LENGTH + 1) }));
  assert.throws(() => normalizeReviewSessionPosition({ ...submitted, baseline: { ...baseline, items: [row] } }), /unsupported fields/u);
  assert.throws(() => normalizeReviewSessionPosition({ ...submitted, baseline: view([baseline.items[0]!, baseline.items[0]!]) }), /duplicate/u);
});

test('combined checkpoint admission rejects over-budget context without pruning drafts or the baseline', () => {
  const item = { id: 'one', subjectKey: '界'.repeat(512), materialFingerprint: '界'.repeat(512),
    sourceIds: ['case'], completeness: 'complete' as const };
  const baseline = createReviewSessionBaseline(Array.from({ length: MAX_ANALYST_REVIEW_ITEMS }, (_, index) => ({ ...item, id: `${index}`.padEnd(512, '界') })), { sourcesAvailable: true, truncated: false });
  const drafts = baseline.items.map(value => ({ id: value.id, subjectKey: value.subjectKey, materialFingerprint: value.materialFingerprint,
    disposition: 'open' as const, rationale: '界'.repeat(MAX_ANALYST_REVIEW_RATIONALE_LENGTH), expiresAt: '', reviewDueAt: '', uncertain: false }));
  const raw = { ...currentStore, records: [{ ...saved, ...position, question: 'Private question', baseline, drafts }] };
  const before = structuredClone(raw);
  assert.ok(Buffer.byteLength(JSON.stringify(raw)) > MAX_REVIEW_SESSION_BYTES);
  assert.throws(() => normalizeReviewSessionStore(raw), /bound|limit|large/u);
  assert.deepEqual(raw, before);
  assert.deepEqual(normalizeReviewSessionStore(fixture), currentStore, 'the original checkpoint remains independently readable');
});
