import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { readCaseHandoffCopy, compareCaseHandoffCopies } from '../packages/cases/case-handoff-comparison.mts';
import { createCase, buildCaseExport } from '../packages/cases/case-model.mts';
import { readEditableCaseExport } from '../packages/cases/case-export-input.mts';
import { CASE_SCHEMA_VERSION, CLI_CASE_PACK_INPUT_CASE_VERSIONS, MAX_EDITABLE_CASE_INPUT_BYTES } from '../packages/contracts/case-portability.mts';
import { correctionFixture } from './case-delivery-correction-fixture.mts';

const AT = '2026-10-03T10:00:00.000Z';
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const copy = (value: unknown) => readCaseHandoffCopy(bytes(value));
const fixture = () => createCase({ domain: 'comparison.example', note: 'Retained original note' }, AT);

test('selected exports keep exact wire values and file identities without mutating input bytes', async () => {
  const file = buildCaseExport([fixture()], AT), original = bytes(file), before = original.slice();
  const selected = await readCaseHandoffCopy(original);
  assert.deepEqual(original, before);
  assert.deepEqual(selected.record, file.cases[0]);
  assert.equal(selected.digest, `sha256:${createHash('sha256').update(original).digest('hex')}`);
  assert.equal(selected.exportedAt, AT);
  const result = compareCaseHandoffCopies(selected, await copy(file));
  assert.equal(result.state, 'ready');
  assert.ok(result.rows.length > 0);
  assert.equal(result.counts.unchanged, result.rows.length);
});

test('missing baseline stays unavailable and unrelated same-domain Cases cannot be aligned', async () => {
  const selected = await copy(buildCaseExport([fixture()], AT));
  for (const pair of [[null, selected], [selected, null], [null, null]] as const) {
    assert.deepEqual(compareCaseHandoffCopies(pair[0], pair[1]), {
      state: 'unavailable', rows: [], counts: { unchanged: 0, changed: 0, baseline_only: 0, comparison_only: 0 },
    });
  }
  const other = await copy(buildCaseExport([fixture()], AT));
  assert.notEqual(other.caseId, selected.caseId);
  assert.throws(() => compareCaseHandoffCopies(selected, other), /same Case ID and domain/u);
  assert.throws(() => compareCaseHandoffCopies(selected, { ...selected, domain: 'other.example' }), /same Case ID and domain/u);
});

test('entry IDs, not positions or shortened text, identify added, changed and absent selections', async () => {
  const current = fixture();
  current.notes[0]!.body = `${'x'.repeat(1800)} baseline ending`;
  const baseline = buildCaseExport([current], AT);
  const changed = structuredClone(baseline);
  changed.cases[0]!.notes[0]!.body = `${'x'.repeat(1800)} comparison ending`;
  changed.cases[0]!.notes.unshift({ id: 'additional-note', body: 'New selected note', createdAt: AT });
  const before = JSON.stringify(baseline);
  let result = compareCaseHandoffCopies(await copy(baseline), await copy(changed));
  const notes = result.rows.filter(row => row.field === 'notes');
  assert.equal(notes.find(row => row.recordId === current.notes[0]!.id)?.state, 'changed');
  assert.equal(notes.find(row => row.recordId === 'additional-note')?.state, 'comparison_only');
  changed.cases[0]!.notes = [];
  result = compareCaseHandoffCopies(await copy(baseline), await copy(changed));
  assert.equal(result.rows.find(row => row.field === 'notes')?.state, 'baseline_only');
  assert.equal(Object.hasOwn(result, 'importable'), false);
  assert.equal(JSON.stringify(baseline), before);
});

test('order changes are explicit while equivalent object-key order is not a content change', async () => {
  const record = fixture();
  record.notes.push({ id: 'another-note', body: 'Same time, separate note', createdAt: AT });
  const file = buildCaseExport([record], AT);
  const reversed = structuredClone(file);
  reversed.cases[0]!.notes.reverse();
  const result = compareCaseHandoffCopies(await copy(file), await copy(reversed));
  assert.equal(result.rows.filter(row => row.field === 'notes' && row.state === 'changed').length, 1);
  assert.deepEqual(result.rows.find(row => row.order)?.baseline, record.notes.map(note => note.id));
  assert.equal(result.rows.filter(row => row.field === 'notes' && row.recordId && row.state === 'unchanged').length, 2);
  const keyOrder = { ...file, cases: [Object.fromEntries(Object.entries(file.cases[0]!).reverse())] };
  assert.equal(compareCaseHandoffCopies(await copy(file), await copy(keyOrder)).counts.changed, 0);
});

test('recipient, exact scope and limitations remain separate complete action records', async () => {
  const f = correctionFixture();
  const baseline = buildCaseExport([f.record], AT);
  f.change({ actionUpdate: { id: f.originalId, recipient: 'Another review desk', responseObjects: [f.objects[1]!], contactLimitations: ['Only this object was reviewed.'] } });
  const comparison = buildCaseExport([f.record], AT);
  const result = compareCaseHandoffCopies(await copy(baseline), await copy(comparison));
  const action = result.rows.find(row => row.field === 'actions' && row.recordId === f.originalId)!;
  assert.equal(action.state, 'changed');
  assert.deepEqual(action.baseline, baseline.cases[0]!.actions[0]);
  assert.deepEqual(action.comparison, comparison.cases[0]!.actions[0]);
  assert.deepEqual((action.comparison as typeof f.record.actions[0]).responseObjects, [f.objects[1]]);
  assert.deepEqual((action.comparison as typeof f.record.actions[0]).contactLimitations, ['Only this object was reviewed.']);
});

test('supported historical fixtures preserve missing fields rather than projected current defaults', async () => {
  for (const version of CLI_CASE_PACK_INPUT_CASE_VERSIONS) {
    const raw = readFileSync(new URL(`./fixtures/case-lifecycle/case-export-v${version}.json`, import.meta.url));
    const wire = JSON.parse(raw.toString());
    const selected = await readCaseHandoffCopy(raw);
    assert.equal(selected.version, version);
    assert.deepEqual(selected.record, wire.cases[0]);
    const current = await copy(buildCaseExport(readEditableCaseExport(raw.toString()), AT));
    const result = compareCaseHandoffCopies(selected, current);
    if (!Object.hasOwn(wire.cases[0], 'title')) {
      assert.equal(Object.hasOwn(selected.record, 'title'), false);
      assert.equal(result.rows.find(row => row.field === 'title')?.state, 'comparison_only');
    }
  }
});

test('future, malformed, multi-Case, packet and oversized inputs fail without normalisation or fallback', async () => {
  const file = buildCaseExport([fixture()], AT);
  for (const value of [
    { ...file, version: CASE_SCHEMA_VERSION + 1 },
    { ...file, packet: {} },
    { ...file, cases: [] },
    { ...file, cases: [...file.cases, fixture()] },
    { ...file, cases: [{ ...file.cases[0], notes: [...file.cases[0]!.notes, file.cases[0]!.notes[0]] }] },
    { ...file, cases: [{ ...file.cases[0], notes: [{ id: 'long', body: 'x'.repeat(2001), createdAt: AT }] }] },
    JSON.parse(readFileSync(new URL('./fixtures/case-lifecycle/case-response-packet-v13.json', import.meta.url), 'utf8')),
  ]) await assert.rejects(copy(value));
  await assert.rejects(readCaseHandoffCopy(new Uint8Array(MAX_EDITABLE_CASE_INPUT_BYTES + 1)), /bytes/u);
  await assert.rejects(readCaseHandoffCopy(new Uint8Array()), /bytes/u);
  await assert.rejects(readCaseHandoffCopy(new Uint8Array([0xff, 0xff])));
});
