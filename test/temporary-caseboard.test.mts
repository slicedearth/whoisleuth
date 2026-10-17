import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createCase } from '../packages/cases/case-record-operations.mts';
import { canonicalArtifactJsonV2 } from '../packages/evidence/artifact-integrity.mts';
import { changeTemporaryCaseboard, emptyTemporaryCaseboard, resolveBoardReference, TEMPORARY_BOARD_CARD_LIMIT,
  TEMPORARY_BOARD_LINK_LIMIT, TEMPORARY_BOARD_TEXT_BYTES, type BoardOperation, type TemporaryCaseboard } from '../frontend/src/lib/analysis/temporary-caseboard.ts';

const now = '2026-10-01T00:00:00.000Z';
function input() {
  const record = createCase({ domain: 'board.example', evidencePin: { label: 'Retained source', field: 'http.status', value: '200',
    source: 'Independent fixture', category: 'http', observedAt: now, completeness: 'complete' } }, now);
  const id = record.evidencePins[0]!.id;
  record.assertions = [{ id, kind: 'hypothesis', statement: 'An analyst question', rationale: 'Independent reasoning',
    state: 'open', evidencePinIds: [id], createdAt: now, updatedAt: now }];
  record.notes = [{ id, body: 'A retained note', createdAt: now }];
  return record;
}
function accepted(board: TemporaryCaseboard, operation: BoardOperation, record = input()) {
  const result = changeTemporaryCaseboard(board, record, operation);
  assert.equal(result.ok, true, result.message); return result.board;
}
const text = (id: string, value = 'Question for review'): BoardOperation => ({ kind: 'text', id, type: 'question', text: value });

test('temporary references remain family-specific and retain only exact identity and content fingerprint', () => {
  const record = input(), before = structuredClone(record), id = record.evidencePins[0]!.id;
  let board = emptyTemporaryCaseboard();
  for (const [index, kind] of (['pin','assertion','note'] as const).entries()) board = accepted(board, { kind: 'reference', id: `card-${index}`, reference: { kind, id } }, record);
  assert.equal(board.cards.length, 3);
  assert.ok(board.cards.every(card => card.kind === 'reference' && !Object.hasOwn(card, 'value') && !Object.hasOwn(card, 'text')));
  assert.equal(resolveBoardReference(record, { kind: 'pin', id }).state, 'ready');
  const source = resolveBoardReference(record, { kind: 'pin', id });
  if (source.state !== 'ready') assert.fail('Expected the exact pin.');
  assert.equal(source.fingerprint, createHash('sha256').update(canonicalArtifactJsonV2(record.evidencePins[0])).digest('hex'));
  const duplicate = changeTemporaryCaseboard(board, record, { kind: 'reference', id: 'another-card', reference: { kind: 'pin', id } });
  assert.equal(duplicate.ok, false); assert.equal(duplicate.board, board); assert.deepEqual(record, before);
});

test('missing and ambiguous sources never choose another record or reproduce deleted source text', () => {
  const record = input(), id = record.evidencePins[0]!.id;
  const board = accepted(emptyTemporaryCaseboard(), { kind: 'reference', id: 'reference', reference: { kind: 'pin', id } }, record);
  record.evidencePins.push({ ...record.evidencePins[0]!, value: 'Conflicting duplicate' });
  assert.deepEqual(resolveBoardReference(record, { kind: 'pin', id }), { state: 'ambiguous' });
  assert.equal(changeTemporaryCaseboard(emptyTemporaryCaseboard(), record, { kind: 'reference', id: 'duplicate', reference: { kind: 'pin', id } }).ok, false);
  record.evidencePins = [];
  assert.deepEqual(resolveBoardReference(record, { kind: 'pin', id }), { state: 'missing' });
  assert.doesNotMatch(JSON.stringify(board), /Retained source|Independent fixture/);
  assert.deepEqual(resolveBoardReference(record, { kind: 'note', id: 'missing' }), { state: 'missing' });
});

test('current content refresh changes fingerprints without changing authored reasoning, order or identities', () => {
  const record = input(), id = record.notes[0]!.id;
  let board = accepted(emptyTemporaryCaseboard(), { kind: 'reference', id: 'ref', reference: { kind: 'note', id } }, record);
  board = accepted(board, text('question', 'Keep this exact reasoning'), record);
  const before = structuredClone(board), source = resolveBoardReference(record, { kind: 'note', id });
  record.notes[0]!.body = 'Different content at the same retained timestamp';
  const changed = resolveBoardReference(record, { kind: 'note', id });
  assert.ok(source.state === 'ready' && changed.state === 'ready');
  assert.notEqual(changed.fingerprint, source.fingerprint); assert.deepEqual(board, before);
});

test('authored cards preserve exact text, reject invalid inputs and never truncate or evict at capacity', () => {
  const record = input(), before = structuredClone(record);
  let board = emptyTemporaryCaseboard();
  for (let index = 0; index < TEMPORARY_BOARD_CARD_LIMIT; index++) board = accepted(board, text(`card-${index}`, 'Exact text.\nSecond line. '), record);
  const full = board;
  assert.equal(changeTemporaryCaseboard(board, record, text('overflow')).ok, false);
  assert.equal(changeTemporaryCaseboard(board, record, text('overflow')).board, full);
  assert.equal(changeTemporaryCaseboard(board, record, text('card-0')).ok, false);
  for (const operation of [text('', 'text'), text('new', 'x'.repeat(2001)), text('new', ' '),
    { kind: 'text', id: 'new', type: 'observed_fact', text: 'Not an observation' }] as BoardOperation[]) assert.equal(changeTemporaryCaseboard(emptyTemporaryCaseboard(), record, operation).ok, false);
  assert.ok(board.cards.every(card => card.kind !== 'reference' && card.text === 'Exact text.\nSecond line. '));
  assert.deepEqual(record, before);
});

test('moving cards preserves stable authored-link endpoints and removing a card removes only incident links', () => {
  let board = accepted(emptyTemporaryCaseboard(), text('a'));
  board = accepted(board, text('b')); board = accepted(board, text('c'));
  board = accepted(board, { kind: 'link', link: { id: 'ab', from: 'a', to: 'b', kind: 'supports', basis: 'Authored explanation' } });
  board = accepted(board, { kind: 'link', link: { id: 'bc', from: 'b', to: 'c', kind: 'contradicts', basis: 'Different explanation' } });
  board = accepted(board, { kind: 'move', id: 'b', direction: -1 });
  assert.deepEqual(board.cards.map(card => card.id), ['b','a','c']); assert.equal(board.links[0]?.from, 'a');
  assert.equal(changeTemporaryCaseboard(board, input(), { kind: 'move', id: 'b', direction: -1 }).ok, false);
  board = accepted(board, { kind: 'remove', id: 'a' });
  assert.deepEqual(board.links.map(link => link.id), ['bc']); assert.deepEqual(board.cards.map(card => card.id), ['b','c']);
  board = accepted(board, { kind: 'unlink', id: 'bc' }); assert.equal(board.links.length, 0);
});

test('editing authored text preserves prior state and cannot rewrite a retained reference', () => {
  const record = input(), before = structuredClone(record);
  const original = accepted(emptyTemporaryCaseboard(), text('authored', 'Earlier exact explanation'), record);
  const edited = accepted(original, { kind: 'edit', id: 'authored', text: 'Revised exact explanation' }, record);
  assert.deepEqual(original.cards, [{ id: 'authored', kind: 'question', text: 'Earlier exact explanation' }]);
  assert.deepEqual(edited.cards, [{ id: 'authored', kind: 'question', text: 'Revised exact explanation' }]);
  const reference = accepted(edited, { kind: 'reference', id: 'retained', reference: { kind: 'pin', id: record.evidencePins[0]!.id } }, record);
  for (const operation of [
    { kind: 'edit', id: 'retained', text: 'Different source content' },
    { kind: 'edit', id: 'authored', text: '' },
    { kind: 'edit', id: 'authored', text: 'x'.repeat(2001) },
    { kind: 'edit', id: 'missing', text: 'New content' },
  ] as const) {
    const result = changeTemporaryCaseboard(reference, record, operation);
    assert.equal(result.ok, false); assert.equal(result.board, reference);
  }
  assert.deepEqual(record, before);
});

test('authored links reject self, missing, duplicate and invalid relationships without changing the board', () => {
  let board = accepted(emptyTemporaryCaseboard(), text('a')); board = accepted(board, text('b'));
  const link = { id: 'link', from: 'a', to: 'b', kind: 'supports' as const, basis: 'Analyst reasoning' };
  board = accepted(board, { kind: 'link', link });
  for (const value of [{ ...link, id: 'other' }, { ...link, id: 'self', to: 'a' }, { ...link, id: 'missing', to: 'missing' },
    { ...link, id: 'long', basis: 'x'.repeat(2001) }, { ...link, id: 'empty', basis: ' ' }, { ...link, id: 'invalid', kind: 'observed_edge' }] ) {
    const result = changeTemporaryCaseboard(board, input(), { kind: 'link', link: value } as BoardOperation);
    assert.equal(result.ok, false); assert.equal(result.board, board);
  }
});

test('link and aggregate UTF-8 bounds reject prospective additions while preserving complete earlier text', () => {
  let board = emptyTemporaryCaseboard();
  for (let index = 0; index < 12; index++) board = accepted(board, text(`card-${index}`, 'a'));
  for (let index = 0; index < TEMPORARY_BOARD_LINK_LIMIT; index++) board = accepted(board, { kind: 'link', link: {
    id: `link-${index}`, from: `card-${index % 12}`, to: `card-${(index % 12 + 1) % 12}`,
    kind: index < 12 ? 'supports' : 'contradicts', basis: 'Independent authored explanation',
  } });
  assert.equal(changeTemporaryCaseboard(board, input(), { kind: 'link', link: { id: 'extra', from: 'card-0', to: 'card-1', kind: 'analyst_grouping', basis: 'Another explanation' } }).ok, false);
  let rich = emptyTemporaryCaseboard();
  for (let index = 0; index < 5; index++) rich = accepted(rich, text(`unicode-${index}`, '界'.repeat(2000)));
  assert.equal(new TextEncoder().encode('界'.repeat(10000)).length, 30000);
  assert.ok(30000 <= TEMPORARY_BOARD_TEXT_BYTES);
  const blocked = changeTemporaryCaseboard(rich, input(), text('overflow', '界'.repeat(2000)));
  assert.equal(blocked.ok, false); assert.equal(blocked.board, rich);
});
