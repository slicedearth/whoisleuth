import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { buildCaseExport, createCase, updateCase, serializeCaseStore, CASE_SCHEMA_VERSION } from '../packages/cases/case-model.mts';
import { applyCaseReviewReturn, previewCaseReviewReturn, selectedCaseReviewRows } from '../packages/cases/case-review-return.mts';
import { MAX_CASE_MANUAL_TRAIL_EVENTS, MAX_NOTES_PER_CASE, MAX_CASE_STORE_BYTES } from '../packages/contracts/case-portability.mts';
import { buildCliCasePack, verifyCliCasePack } from '../cli/case-pack.mts';

const BEFORE = '2026-08-20T00:00:00.000Z';
const AFTER = '2026-08-22T00:00:00.000Z';
const DIGEST = `sha256:${'a'.repeat(64)}`;
function fixture() {
  const current = createCase({ domain: 'example.test', note: 'Original local note', title: 'Independent incident',
    evidence: { capturedAt: BEFORE, scanDepth: 'deep', availability: 'registered' },
    evidencePin: { field: 'dns.mx', category: 'dns', label: 'Mail exchanger', value: 'mail.example.test', source: 'Fixture DNS', observedAt: BEFORE, completeness: 'partial' },
  }, BEFORE);
  let returned = updateCase([current], current.id, { note: 'Returned annotation',
    evidencePin: { field: 'web.title', category: 'web', label: 'Page title', value: 'Example sign in', source: 'Fixture page', observedAt: null, completeness: 'partial' },
  }, AFTER).record;
  const pin = returned.evidencePins.find(item => !current.evidencePins.some(existing => item.id === existing.id))!;
  returned = updateCase([returned], returned.id, { decision: { summary: 'Review the credential claim', rationale: 'The title alone is not proof.', confidence: 'low', evidencePinIds: [pin.id] },
    assertion: { kind: 'hypothesis', statement: 'The page may request credentials.', rationale: 'Requires content review.', evidencePinIds: [pin.id], state: 'open' },
  }, AFTER).record;
  return { current, returned, pin, file: buildCaseExport([returned], AFTER) };
}

test('review preview is read-only and distinguishes new, identical and conflicting authored entries', () => {
  const { current, file } = fixture();
  file.cases[0]!.notes[0]!.body = 'Conflicting rewrite';
  const before = structuredClone(current);
  const preview = previewCaseReviewReturn(current, file, DIGEST);
  assert.equal(preview.rows.filter(row => row.state === 'new').length, 4);
  assert.equal(preview.rows.filter(row => row.state === 'conflict').length, 1);
  assert.equal(preview.rows.filter(row => row.state === 'unchanged').length, 1);
  assert.deepEqual(preview.rows.find(row => row.state === 'conflict')?.local, current.notes[0]);
  assert.deepEqual(current, before);
});

test('selected additions preserve source clocks, conflicts, unrelated metadata and another same-domain incident', () => {
  const { current, returned, pin, file } = fixture();
  file.cases[0]!.notes[0]!.body = 'Do not overwrite local history';
  file.cases[0]!.status = 'resolved';
  file.cases[0]!.disposition = 'confirmed_abuse';
  file.cases[0]!.title = 'Do not adopt this title';
  const other = createCase({ domain: current.domain, title: 'Separate incident' }, BEFORE);
  const original = structuredClone([current, other]);
  const preview = previewCaseReviewReturn(current, file, DIGEST);
  const selected = preview.rows.filter(row => row.state === 'new' && row.kind !== 'assertions').map(row => row.key);
  const result = applyCaseReviewReturn([current, other], preview, selected, AFTER);
  assert.deepEqual([current, other], original);
  assert.deepEqual(result.cases.find(record => record.id === other.id), other);
  assert.equal(result.record.notes[0]!.body, 'Original local note');
  assert.equal(result.record.notes[1]!.createdAt, AFTER);
  assert.deepEqual(result.record.evidencePins.find(item => item.id === pin.id), pin);
  assert.equal(result.record.evidencePins.find(item => item.id === pin.id)?.observedAt, null);
  assert.deepEqual(result.record.decisions, returned.decisions);
  assert.deepEqual(result.record.assertions, []);
  for (const field of ['title', 'status', 'disposition', 'evidenceHistory', 'actions', 'observedEffects', 'closures', 'brandProfileIds', 'tags'] as const) {
    assert.deepEqual(result.record[field], current[field], field);
  }
  assert.equal(result.record.manualTrail.at(-1)?.target, DIGEST);
  assert.equal(result.record.manualTrail.at(-1)?.kind, 'handoff');
  const selectionDigest = createHash('sha256').update(JSON.stringify([...selected].sort())).digest('hex');
  assert.ok(result.record.manualTrail.at(-1)?.summary.includes(`sha256:${selectionDigest}`));
  assert.equal(result.pruned, 0);
  const again = previewCaseReviewReturn(result.record, file, DIGEST);
  assert.equal(again.rows.filter(row => row.state === 'new').length, 1, 'Only the deliberately unselected assertion remains new.');
  assert.throws(() => applyCaseReviewReturn(result.cases, preview, selected, AFTER), /changed after the preview/u);
});

test('a verified current CLI pack can supply review entries without claiming that preview verifies its envelope digest', () => {
  const { current, file } = fixture();
  const pack = buildCliCasePack(JSON.stringify(file), { audience: 'internal', reviewed: true }, AFTER);
  assert.equal(verifyCliCasePack(pack).caseCount, 1);
  const preview = previewCaseReviewReturn(current, pack, DIGEST);
  assert.equal(preview.isCliPack, true);
  assert.ok(preview.rows.some(row => row.kind === 'decisions' && row.state === 'new'));
});

test('the selected Case snapshot, not a whole-workspace timestamp, guards a return', () => {
  const { current, file } = fixture();
  const preview = previewCaseReviewReturn(current, file, DIGEST);
  const key = preview.rows.find(row => row.kind === 'notes' && row.state === 'new')!.key;
  const other = createCase({ domain: 'other.example', note: 'New unrelated work' }, AFTER);
  assert.equal(applyCaseReviewReturn([current, other], preview, [key], AFTER).cases.length, 2);
  const changed = structuredClone(current);
  changed.notes[0]!.body = 'Changed without a newer timestamp';
  assert.throws(() => applyCaseReviewReturn([changed], preview, [key], AFTER), /changed after the preview/u);
  assert.throws(() => applyCaseReviewReturn([], preview, [key], AFTER), /changed after the preview/u);
});

test('a full valid workspace rejects additions rather than pruning retained source evidence', () => {
  const { current, file } = fixture();
  const cases = [current];
  // Fill with ordinary bounded notes, leaving every source snapshot intact.
  for (let index = 0; index < 41; index++) {
    const record = createCase({ domain: `padding-${index}.example` }, BEFORE);
    record.notes = Array.from({ length: MAX_NOTES_PER_CASE }, (_, note) => ({ id: `n-${note}`, body: 'x'.repeat(2000), createdAt: BEFORE }));
    cases.push(record);
  }
  const last = cases.at(-1)!;
  while (Buffer.byteLength(serializeCaseStore(cases)) > MAX_CASE_STORE_BYTES) last.notes.pop();
  const room = MAX_CASE_STORE_BYTES - Buffer.byteLength(serializeCaseStore(cases));
  if (room) {
    // A spare partial note uses the residual capacity, accounting for its JSON envelope.
    const filler = { id: 'remaining', body: 'x', createdAt: BEFORE };
    last.notes.push(filler);
    const remaining = MAX_CASE_STORE_BYTES - Buffer.byteLength(serializeCaseStore(cases));
    if (remaining >= 0 && remaining < 2000) filler.body += 'x'.repeat(remaining);
    else last.notes.pop();
  }
  const size = Buffer.byteLength(serializeCaseStore(cases));
  assert.ok(size <= MAX_CASE_STORE_BYTES && MAX_CASE_STORE_BYTES - size < 120);
  const before = structuredClone(cases);
  const preview = previewCaseReviewReturn(current, file, DIGEST);
  assert.throws(() => applyCaseReviewReturn(cases, preview, preview.rows.filter(row => row.state === 'new').map(row => row.key), AFTER), /not enough workspace room|storage budget/u);
  assert.deepEqual(cases, before);
  assert.equal(cases[0]!.evidenceHistory.length, 1);
});

test('linked decisions require reviewed pin dependencies and cannot inherit a conflicting pin', () => {
  const { current, file, pin } = fixture();
  const preview = previewCaseReviewReturn(current, file, DIGEST);
  const decision = preview.rows.find(row => row.kind === 'decisions')!;
  assert.throws(() => selectedCaseReviewRows(preview, [decision.key]), /linked evidence first/u);
  assert.equal(selectedCaseReviewRows(preview, [decision.key, `evidencePins:${pin.id}`]).length, 2);
  const modified = { ...current, evidencePins: [...current.evidencePins, { ...pin, value: 'Different retained value' }] };
  const conflict = previewCaseReviewReturn(modified, file, DIGEST);
  assert.throws(() => selectedCaseReviewRows(conflict, [decision.key]), /linked evidence first/u);
  assert.throws(() => selectedCaseReviewRows(conflict, [`evidencePins:${pin.id}`]), /not overwritten/u);
  assert.throws(() => selectedCaseReviewRows(preview, ['notes:missing']), /not overwritten/u);
  assert.throws(() => selectedCaseReviewRows(preview, [decision.key, decision.key]), /invalid/u);
  assert.throws(() => selectedCaseReviewRows(preview, []), /Select at least one/u);
});

test('return admission fails closed for wrong identities, future versions, malformed and duplicate history', () => {
  const { current, file } = fixture();
  for (const changed of [{ ...file, version: CASE_SCHEMA_VERSION + 1 }, { ...file, version: 15 },
    { ...file, cases: [{ ...file.cases[0], id: 'another-incident' }] },
    { ...file, cases: [{ ...file.cases[0], domain: 'other.example' }] },
    { ...file, cases: [...file.cases, createCase({ domain: 'other.example' }, BEFORE)] },
    { ...file, cases: [{ ...file.cases[0], notes: [...file.cases[0]!.notes, file.cases[0]!.notes[0]] }] },
    { ...file, cases: [{ ...file.cases[0], decisions: [{ ...file.cases[0]!.decisions[0], evidencePinIds: ['missing'] }] }] },
    { ...file, cases: [{ ...file.cases[0], notes: [{ id: 'note', body: 'x'.repeat(2001), createdAt: AFTER }] }] },
  ]) assert.throws(() => previewCaseReviewReturn(current, changed, DIGEST));
  assert.throws(() => previewCaseReviewReturn(current, file, 'missing'), /digest/u);
  assert.throws(() => previewCaseReviewReturn(current, { padding: 'x'.repeat(2 * 1024 * 1024 + 1) }, DIGEST));
});

test('quota and trail capacity failures leave the complete source unchanged without evicting history', () => {
  const { current, file } = fixture();
  const full = { ...current, notes: Array.from({ length: MAX_NOTES_PER_CASE }, (_, index) => ({ id: `retained-${index}`, body: `Keep note ${index}`, createdAt: BEFORE })) };
  const preview = previewCaseReviewReturn(full, file, DIGEST);
  const before = structuredClone(full);
  assert.throws(() => applyCaseReviewReturn([full], preview, [preview.rows.find(row => row.kind === 'notes' && row.state === 'new')!.key]), /capacity/u);
  assert.deepEqual(full, before);
  const trailFull = { ...current, manualTrail: Array.from({ length: MAX_CASE_MANUAL_TRAIL_EVENTS }, (_, index) => ({ id: `trail-${index}`, kind: 'review' as const, summary: 'Retain reviewed step', target: null, createdAt: BEFORE })) };
  const trailPreview = previewCaseReviewReturn(trailFull, file, DIGEST);
  assert.throws(() => applyCaseReviewReturn([trailFull], trailPreview, [trailPreview.rows.find(row => row.kind === 'notes' && row.state === 'new')!.key]), /investigation-trail entries/u);
});
