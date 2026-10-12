import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCase, updateCase } from '../packages/cases/case-record-operations.mts';
import { prepareCaseReportPreview } from '../packages/cases/case-report-preview.mts';
import { buildCaseResponsePacket } from '../packages/cases/case-response-packet.mts';
import { preparedDisclosureRows } from '../packages/cases/prepared-disclosure-comparison.mts';
import { preparedPacketTimeline } from '../packages/cases/prepared-packet-timeline.mts';

const NOW = '2000-01-03T00:00:00.000Z';
async function pair(includeNotes = true) {
  const base = createCase({ domain: 'review.example', title: 'PRIVATE-TITLE', tags: ['PRIVATE-TAG'], note: 'PRIVATE-NOTE' }, NOW);
  let record = updateCase([base], base.id, { evidencePin: { label: 'Selected source', value: 'PRIVATE-RAW-VALUE', source: 'Supplied observation', observedAt: NOW, completeness: 'partial', limitations: ['Only this supplied view is covered.'] } }, NOW).record;
  const selected = record.evidencePins[0]!.id;
  record = updateCase([record], record.id, { evidencePin: { label: 'PRIVATE-UNSELECTED-LABEL', value: 'PRIVATE-UNSELECTED-VALUE', source: 'Separate supplied observation', observedAt: null } }, NOW).record;
  const built = await buildCaseResponsePacket(record, { profile: 'internal_soc', category: 'Review', affectedParty: 'Example organisation',
    abusiveUrls: ['https://review.example/page?selected=1'], observedHarm: 'Supplied material requires review.', observedAt: NOW,
    selectedEvidencePinIds: [selected] }, NOW);
  const internal = prepareCaseReportPreview(record, { includeNotes, includeAttribution: true, applicationVersion: 'test' }, built.json.generatedAt);
  return { record, selected, built, internal };
}

test('disclosure rows compare actual prepared fields and never modify recipient bytes or source', async () => {
  const { record, selected, built, internal } = await pair();
  const source = JSON.stringify(record), packet = JSON.stringify(built);
  const rows = preparedDisclosureRows(internal.report.json, built.json);
  const note = rows.find(row => row.group === 'Case field' && row.reference === 'notes')!;
  assert.equal(note.state, 'internal_only'); assert.match(JSON.stringify(note.internal.value), /PRIVATE-NOTE/u);
  assert.equal(note.recipient.present, false);
  const pin = rows.find(row => row.group === 'Evidence reference' && row.reference === selected)!;
  assert.equal(pin.state, 'different_representation');
  assert.equal(Reflect.get(pin.internal.value as object, 'value'), 'PRIVATE-RAW-VALUE');
  assert.equal(Object.hasOwn(pin.recipient.value as object, 'value'), false);
  const unselected = rows.find(row => row.group === 'Evidence reference' && row.internal.present && !row.recipient.present)!;
  assert.match(JSON.stringify(unselected.internal.value), /PRIVATE-UNSELECTED-LABEL/u);
  const url = rows.find(row => row.group === 'Prepared envelope field' && row.reference === 'incident')!;
  assert.equal(url.state, 'recipient_only'); assert.match(JSON.stringify(url.recipient.value), /selected=1/u);
  for (const sentinel of ['PRIVATE-NOTE', 'PRIVATE-RAW-VALUE', 'PRIVATE-UNSELECTED-LABEL', 'PRIVATE-TAG']) {
    assert.equal(JSON.stringify(built.json).includes(sentinel), false);
    assert.equal(built.markdown.includes(sentinel), false); assert.equal(built.email.includes(sentinel), false);
  }
  assert.equal(JSON.stringify(record), source); assert.equal(JSON.stringify(built), packet);
});

test('unprepared notes are not manufactured as an internal exclusion or Case deletion', async () => {
  const { internal, built } = await pair(false), rows = preparedDisclosureRows(internal.report.json, built.json);
  assert.equal(rows.some(row => row.group === 'Case field' && row.reference === 'notes'), false);
  assert.equal(rows.find(row => row.group === 'Case field' && row.reference === 'notesIncluded')!.internal.value, false);
  assert.equal(JSON.stringify(internal.report.json).includes('PRIVATE-NOTE'), false);
});

test('incompatible Case/time pairs reject and duplicate evidence identities remain ambiguous', async () => {
  const { internal, built, selected } = await pair();
  for (const patch of [{ ...built.json, generatedAt: '2000-01-04T00:00:00Z' },
    { ...built.json, case: { ...built.json.case, id: 'another-case' } },
    { ...built.json, case: { ...built.json.case, domain: 'another.example' } }])
    assert.throws(() => preparedDisclosureRows(internal.report.json, patch), /same Case and preparation time/iu);
  const duplicate = structuredClone(internal.report.json);
  duplicate.analystResponse.evidencePins.push({ ...duplicate.analystResponse.evidencePins[0]!, value: 'SECOND-DISTINCT-VALUE' });
  const row = preparedDisclosureRows(duplicate, built.json).find(row => row.group === 'Evidence reference' && row.reference === selected)!;
  assert.equal(row.state, 'ambiguous'); assert.equal(row.internal.ambiguous, true);
  assert.equal((row.internal.value as unknown[]).length, 2);
});

test('packet timeline preserves unknown clocks, source identities and separate simultaneous observations', async () => {
  const { built } = await pair();
  const packet = structuredClone(built.json), before = JSON.stringify(packet);
  packet.selectedEvidence.push({ ...packet.selectedEvidence[0]!, id: 'unknown-observation', observedAt: null });
  packet.selectedEvidence.push({ ...packet.selectedEvidence[0]!, id: 'equal-time-observation', source: 'Separate source' });
  const captured = JSON.stringify(packet), rows = preparedPacketTimeline(packet);
  assert.equal(rows.filter(row => row.kind === 'Selected evidence observation' && row.at === NOW).length, 2);
  assert.equal(rows.find(row => row.reference === 'unknown-observation')!.at, null);
  assert.equal(rows.at(-1)!.reference, 'unknown-observation');
  assert.equal(rows.find(row => row.reference === 'equal-time-observation')!.source, 'Separate source');
  assert.match(rows.find(row => row.id === 'packet')!.source, /not an observation/u);
  assert.equal(JSON.stringify(packet), captured); assert.equal(JSON.stringify(built.json), before);
});
