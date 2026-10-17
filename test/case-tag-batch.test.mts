import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCase, updateCase } from '../packages/cases/case-record-operations.mts';
import { MAX_CASE_BATCH_MUTATIONS } from '../packages/cases/case-batch-limits.mts';
import { applyCaseTagBatch, captureCaseTagBatch, parseCaseBatchTags, prepareCaseTagBatch } from '../packages/cases/case-tag-batch.mts';
import { MAX_CASE_STORE_BYTES, MAX_TAG_LENGTH, MAX_TAGS_PER_CASE } from '../packages/contracts/case-portability.mts';
import { serializeCaseStore, enforceStoreBudget } from '../packages/cases/case-storage-model.mts';
import { caseStoreAtCapacity } from './workspace-backup-capacity-fixture.mts';

const NOW = '2000-01-01T00:00:00.000Z', LATER = '2000-01-02T00:00:00.000Z';
function fixture() {
  return ['first', 'second', 'third'].map((name, index) => ({ ...createCase({ domain: `${name}.example` }, NOW), id: `case-${name}`, tags: index === 0 ? ['Keep', 'Existing'] : [] }));
}
const add = (ids = ['case-first', 'case-second'], tags = ['new']) => ({ ids, tags, operation: 'add' as const });

test('exact add/remove previews preserve casing, no-ops and unselected records', () => {
  const cases = fixture(), original = structuredClone(cases);
  const preview = prepareCaseTagBatch(cases, add(undefined, [' keep ', 'Reviewed']), LATER);
  assert.equal(preview.canApply, true);
  assert.deepEqual(preview.rows.map(row => row.nextTags), [['Keep', 'Existing', 'Reviewed'], ['keep', 'Reviewed']]);
  const saved = applyCaseTagBatch(cases, preview, LATER);
  assert.deepEqual([saved.changed, saved.unchanged, saved.pruned], [2, 0, 0]);
  assert.equal(saved.cases[2]!.updatedAt, NOW);
  assert.deepEqual(saved.cases[2], original[2]);
  assert.deepEqual(cases, original);
  const removal = prepareCaseTagBatch(saved.cases, { ids: ['case-first', 'case-second'], operation: 'remove', tags: ['KEEP'] });
  assert.deepEqual(removal.rows.map(row => row.nextTags), [['Existing', 'Reviewed'], ['Reviewed']]);
  const noOp = prepareCaseTagBatch(cases, add(['case-first'], ['keep']));
  const unchanged = applyCaseTagBatch(cases, noOp, LATER);
  assert.equal(unchanged.cases, cases); assert.deepEqual([unchanged.changed, unchanged.unchanged], [0, 1]);
});

test('the tag entry is literal, bounded and rejects duplicates instead of dropping content', () => {
  assert.deepEqual(parseCaseBatchTags(String.raw`first\0second, other`), [String.raw`first\0second`, 'other']);
  assert.deepEqual(parseCaseBatchTags(' first ,\nsecond '), ['first', 'second']);
  for (const tags of [[], ['same', 'SAME'], [''], ['a'.repeat(MAX_TAG_LENGTH + 1)], ['a\0b'], Array.from({ length: MAX_TAGS_PER_CASE + 1 }, (_, i) => `tag-${i}`)])
    assert.throws(() => prepareCaseTagBatch(fixture(), add(undefined, tags)), /tags|tag/iu);
  assert.throws(() => parseCaseBatchTags('x'.repeat(1000)), /bounded/iu);
  assert.throws(() => prepareCaseTagBatch(fixture(), { ...add(), operation: 'replace' } as never), /add or remove/iu);
  for (const ids of [[], ['case-first', 'case-first'], ['bad\0id'], Array.from({ length: MAX_CASE_BATCH_MUTATIONS + 1 }, (_, i) => `case-${i}`)])
    assert.throws(() => prepareCaseTagBatch(fixture(), add(ids)), /distinct retained Cases/iu);
});

test('missing, ambiguous and full-tag targets block the complete batch', () => {
  const cases = fixture(); cases[1]!.tags = Array.from({ length: MAX_TAGS_PER_CASE }, (_, i) => `tag-${i}`);
  const preview = prepareCaseTagBatch(cases, add());
  assert.equal(preview.canApply, false);
  assert.deepEqual(preview.rows.map(row => row.state), ['changed', 'blocked']);
  assert.equal(preview.rows[1]!.nextTags.length, MAX_TAGS_PER_CASE + 1);
  assert.throws(() => applyCaseTagBatch(cases, preview), /blockers/iu);
  for (const current of [cases.filter(row => row.id !== 'case-second'), [...cases, cases[0]!]]) {
    const unavailable = prepareCaseTagBatch(current, add());
    assert.equal(unavailable.canApply, false); assert.equal(unavailable.rows.length, 2);
  }
});

test('same-clock tag and identity changes reject all writes while unrelated peer work survives', () => {
  const cases = fixture(), reviewed = prepareCaseTagBatch(cases, add(), LATER);
  for (const changed of [
    cases.slice(0, 1),
    cases.map(row => row.id === 'case-second' ? { ...row, tags: ['peer'] } : row),
    cases.map(row => row.id === 'case-first' ? { ...row, title: 'Different incident' } : row),
    cases.map(row => row.id === 'case-first' ? { ...row, domain: 'different.example' } : row),
  ]) {
    const before = structuredClone(changed);
    assert.throws(() => applyCaseTagBatch(changed, reviewed, LATER), /changed or became unavailable/iu);
    assert.deepEqual(changed, before);
  }
  const peer = updateCase(cases, 'case-first', { note: 'A newer independent note.' }, LATER).cases;
  const saved = applyCaseTagBatch(peer, reviewed, LATER);
  assert.equal(saved.cases[0]!.notes[0]!.body, 'A newer independent note.');
  assert.deepEqual(saved.cases[0]!.tags, ['Keep', 'Existing', 'new']);
});

test('captured submissions detach caller arrays and recompute the exact reviewed result', () => {
  const cases = fixture(), preview = prepareCaseTagBatch(cases, add(), LATER), captured = captureCaseTagBatch(preview);
  (preview.intent.tags as string[])[0] = 'mutated'; (preview.rows[0]!.nextTags as string[])[0] = 'mutated';
  assert.deepEqual(applyCaseTagBatch(cases, captured, LATER).cases[0]!.tags, ['Keep', 'Existing', 'new']);
  const altered = { ...captured, rows: captured.rows.map((row, i) => i ? row : { ...row, nextTags: ['unreviewed'] }) };
  assert.throws(() => applyCaseTagBatch(cases, altered, LATER), /reviewed tag result changed/iu);
});

test('a tag-only batch refuses to prune evidence from an unselected Case at the exact byte boundary', () => {
  const cases = caseStoreAtCapacity(records => {
    records[0]!.evidenceHistory = createCase({ domain: records[0]!.domain,
      evidence: { availability: 'registered', activityStatus: 'active', scanDepth: 'deep' } }, NOW).evidenceHistory;
  }).cases;
  const size = () => Buffer.byteLength(serializeCaseStore(cases));
  assert.equal(size(), MAX_CASE_STORE_BYTES);
  assert.equal(enforceStoreBudget(cases).pruned, 0);
  const before = serializeCaseStore(cases), selected = cases.at(-1)!.id;
  const preview = prepareCaseTagBatch(cases, add([selected], ['extra']), LATER);
  assert.equal(preview.canApply, false); assert.match(preview.blockers.join(' '), /remove existing evidence/iu);
  const reviewedBeforeCapacity = prepareCaseTagBatch([{ ...cases.at(-1)!, notes: [] }], add([selected], ['extra']), LATER);
  assert.throws(() => applyCaseTagBatch(cases, reviewedBeforeCapacity, LATER), /remove existing evidence/iu);
  assert.equal(serializeCaseStore(cases), before); assert.equal(cases[0]!.evidenceHistory.length, 1);
});
