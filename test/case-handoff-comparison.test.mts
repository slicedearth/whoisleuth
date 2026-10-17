import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { readCaseHandoffCopy, compareCaseHandoffCopies, type CaseHandoffCopy } from '../packages/cases/case-handoff-comparison.mts';
import { createCase, buildCaseExport } from '../packages/cases/case-model.mts';
import { readEditableCaseExport } from '../packages/cases/case-export-input.mts';
import { CASE_RESPONSE_PACKET_SCHEMA, CASE_RESPONSE_PACKET_VERSION, CASE_SCHEMA_VERSION, CLI_CASE_PACK_INPUT_CASE_VERSIONS, MAX_EDITABLE_CASE_INPUT_BYTES, SUPPORTED_CASE_RESPONSE_PACKET_VERSIONS } from '../packages/contracts/case-portability.mts';
import { canonicalArtifactJsonV2 } from '../packages/evidence/artifact-integrity.mts';
import { verifyCaseResponsePacketIntegrity } from '../packages/cases/case-response-packet.mts';
import { verifyOfflineArtifact } from '../cli/artifact-verify.mts';
import { validateOfflineArtifactStructure } from '../cli/offline-artifact-validation.mts';
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
  assert.equal(selected.kind, 'case_export');
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

test('future, malformed, multi-Case, envelope and oversized inputs fail without normalisation or fallback', async () => {
  const file = buildCaseExport([fixture()], AT);
  for (const value of [
    { ...file, version: CASE_SCHEMA_VERSION + 1 },
    { ...file, packet: {} },
    { ...file, cases: [] },
    { ...file, cases: [...file.cases, fixture()] },
    { ...file, cases: [{ ...file.cases[0], notes: [...file.cases[0]!.notes, file.cases[0]!.notes[0]] }] },
    { ...file, cases: [{ ...file.cases[0], notes: [{ id: 'long', body: 'x'.repeat(2001), createdAt: AT }] }] },
    { schema: 'whoisleuth.encrypted-investigation-package', version: 1, ciphertext: 'not admitted' },
  ]) await assert.rejects(copy(value));
  await assert.rejects(readCaseHandoffCopy(new Uint8Array(MAX_EDITABLE_CASE_INPUT_BYTES + 1)), /bytes/u);
  await assert.rejects(readCaseHandoffCopy(new Uint8Array()), /bytes/u);
  await assert.rejects(readCaseHandoffCopy(new Uint8Array([0xff, 0xff])));
});

function packetFixture(version: number = CASE_RESPONSE_PACKET_VERSION): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(`./fixtures/case-lifecycle/case-response-packet-v${version}.json`, import.meta.url), 'utf8'));
}
function resignPacket(value: Record<string, unknown>) {
  const { integrity, ...unsigned } = value;
  return { ...unsigned, integrity: { ...integrity as Record<string, unknown>,
    digestSha256: createHash('sha256').update(canonicalArtifactJsonV2(unsigned)).digest('hex') } };
}

test('all historical packet versions retain original wire values and synchronous CLI validation', async () => {
  const copies: CaseHandoffCopy[] = [];
  for (const version of SUPPORTED_CASE_RESPONSE_PACKET_VERSIONS) {
    const packet = packetFixture(version), before = JSON.stringify(packet);
    const selected = await copy(packet);
    assert.equal(selected.kind, 'response_packet');
    assert.equal(selected.version, version);
    assert.deepEqual(selected.record, packet);
    assert.equal(selected.exportedAt, packet.generatedAt);
    assert.equal(validateOfflineArtifactStructure(CASE_RESPONSE_PACKET_SCHEMA, packet), undefined);
    assert.equal((await verifyOfflineArtifact(before)).state, 'verified');
    assert.equal(JSON.stringify(packet), before);
    copies.push(selected);
  }
  const result = compareCaseHandoffCopies(copies[2]!, copies.at(-1)!);
  assert.equal(result.rows.find(row => row.field === 'schemaVersion')?.state, 'changed');
  assert.equal(Object.hasOwn(copies[0]!.record, 'selectedEvidence'), false);
  assert.throws(() => compareCaseHandoffCopies(copies[0]!, copies.at(-1)!), /same Case ID and domain/u);
});

test('a re-signed outer packet cannot bypass semantic or reviewed-input validation in either runtime path', async () => {
  for (const version of SUPPORTED_CASE_RESPONSE_PACKET_VERSIONS) {
    const invalid = packetFixture(version);
    if (version === 6) invalid.reviewRequired = false;
    else (invalid.authorisation as Record<string, unknown>).reviewedInputDigestSha256 = 'f'.repeat(64);
    const resigned = resignPacket(invalid);
    assert.equal(await verifyCaseResponsePacketIntegrity(resigned), true);
    assert.throws(() => validateOfflineArtifactStructure(CASE_RESPONSE_PACKET_SCHEMA, resigned), /unsupported or malformed structure/u);
    await assert.rejects(copy(resigned), /unsupported or malformed structure/u);
    await assert.rejects(verifyOfflineArtifact(JSON.stringify(resigned)), /unsupported or malformed structure/u);
  }
});

test('outer integrity is required even when synchronous packet semantics accept the input', async () => {
  const packet = packetFixture();
  (packet.integrity as Record<string, unknown>).digestSha256 = 'f'.repeat(64);
  assert.doesNotThrow(() => validateOfflineArtifactStructure(CASE_RESPONSE_PACKET_SCHEMA, packet));
  await assert.rejects(copy(packet), /manifest integrity check/u);
  await assert.rejects(verifyOfflineArtifact(JSON.stringify(packet)), /manifest integrity check/u);
});

test('packet schema, version, exact fields and bounded parsing fail closed', async () => {
  const packet = packetFixture();
  for (const invalid of [
    { ...packet, schema: 'unknown.packet' },
    ...[5, CASE_RESPONSE_PACKET_VERSION + 1, String(CASE_RESPONSE_PACKET_VERSION)].map(schemaVersion => ({ ...packet, schemaVersion })),
    { ...packet, extra: true },
    { ...packet, integrity: { ...packet.integrity as object, canonicalization: 'sorted-json-v1' } },
  ]) await assert.rejects(copy(invalid));
  let nested: unknown = null;
  for (let index = 0; index < 50; index++) nested = { child: nested };
  await assert.rejects(copy({ ...packet, extra: nested }), /nesting|depth/u);
  await assert.rejects(copy({ ...packet, extra: Array(10_001).fill(0) }), /container|items/u);
  const raw = JSON.stringify(packet);
  await assert.rejects(readCaseHandoffCopy(new TextEncoder().encode(`{"schema": "duplicate",${raw.slice(1)}`)), /duplicate/u);
});

test('packet comparisons keep exact action identities, recipient, object scope and missing selections', async () => {
  const f = correctionFixture(), before = (await f.preparePacket(f.originalId)).json;
  const oldPin = f.record.evidencePins[0]!.id;
  f.change({ evidencePin: { label: 'Later selected evidence', value: 'Different selected observation', source: 'Fixture', observedAt: AT, completeness: 'partial', limitations: ['A separate selected observation.'] } });
  const newPin = f.record.evidencePins.find(pin => pin.id !== oldPin)!.id;
  f.change({ actionUpdate: { id: f.originalId, recipient: 'Another review desk', responseObjects: [f.objects[1]!] } });
  const after = (await f.preparePacket(f.originalId, { selectedEvidencePinIds: [newPin] })).json;
  const baseline = await copy(before), comparison = await copy(after);
  const result = compareCaseHandoffCopies(baseline, comparison);
  assert.equal(result.rows.find(row => row.field === 'selectedEvidence' && row.recordId === oldPin)?.state, 'baseline_only');
  assert.equal(result.rows.find(row => row.field === 'selectedEvidence' && row.recordId === newPin)?.state, 'comparison_only');
  const action = result.rows.find(row => row.field === 'escalationHistory' && row.recordId === f.originalId)!;
  assert.equal(action.state, 'changed');
  assert.deepEqual(action.baseline, before.escalationHistory[0]);
  assert.deepEqual(action.comparison, after.escalationHistory[0]);
  assert.equal(result.rows.find(row => row.field === 'authorisation')?.state, 'changed');
  assert.equal(result.rows.find(row => row.field === 'recipientRoute')?.state, 'changed');
  assert.equal(compareCaseHandoffCopies(null, comparison).state, 'unavailable');
  assert.throws(() => compareCaseHandoffCopies(baseline, { ...comparison, caseId: 'different-case' }), /same Case ID/u);
  assert.throws(() => compareCaseHandoffCopies(baseline, { ...comparison, domain: 'different.example' }), /same Case ID/u);
  const ordinary = await copy(buildCaseExport([f.record], AT));
  assert.throws(() => compareCaseHandoffCopies(baseline, ordinary), /not one of each/u);
  assert.throws(() => compareCaseHandoffCopies(ordinary, comparison), /not one of each/u);
});
