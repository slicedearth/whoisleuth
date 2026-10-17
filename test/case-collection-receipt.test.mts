import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createCase, normalizeCaseStore, normalizeCase, updateCase, mergeCases, buildCaseExport, serializeCaseStore } from '../packages/cases/case-model.mts';
import { readCaseCheckpointReceipts } from '../packages/cases/case-checkpoint-receipts.mts';
import { MAX_CASE_EVIDENCE_PINS } from '../packages/contracts/case-portability.mts';
import { buildWorkspaceArchive, readWorkspaceArchive } from '../packages/workspace/workspace-archive.mts';
import { normalizeSnapshot, normalizeEvidenceHistory, caseEvidenceTimeline, caseEvidenceWithoutCollectionReceipts } from '../packages/cases/case-evidence-model.mts';
import { projectCaseForAudience } from '../packages/cases/case-record-projection.mts';
import { buildCaseReport } from '../packages/cases/case-report.mts';
import { buildCaseResponsePacket } from '../packages/cases/case-response-packet.mts';
import { buildCliCasePack, verifyCliCasePack } from '../cli/case-pack.mts';
import { canonicalArtifactJsonV2 } from '../packages/evidence/artifact-integrity.mts';
import { parseLookupCollectionReceipt } from '../packages/evidence/lookup-collection-receipt.mts';

const EARLIER = '2026-10-01T00:00:00.000Z', LATER = '2026-10-02T00:00:00.000Z';
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const receipt = () => parseLookupCollectionReceipt(fixture('cli-lookup-v3').collectionReceipt)!;
function capture(changed = false, capturedAt = EARLIER) {
  const original = receipt();
  return { scanDepth: 'deep', registrar: 'Example registrar', availability: 'registered', capturedAt,
    collectionReceipt: changed ? { ...original, sources: original.sources.map(row => row.source === 'rdap'
      ? { ...row, settlement: 'partial' as const, complete: false, truncated: true } : row) } : original };
}
function record() {
  const value = createCase({ domain: 'example.test', evidence: capture(),
    evidencePin: { id: 'retained-pin', checkpointId: 'selected-group', label: 'Selected fact', value: 'Retained value', observedAt: EARLIER, collectionDepth: 'deep' },
    checkpointCollectionReceipts: [{ checkpointId: 'selected-group', collectionReceipt: receipt() }],
  }, EARLIER);
  value.evidenceHistory = normalizeEvidenceHistory([capture(), capture(true, LATER)], {caseDomain: value.domain});
  return value;
}

test('receipt-free formats and non-empty pre-receipt snapshots preserve their exact identities', () => {
  for (const version of [12, 13, 14, 15, 16, 17, 18, 19]) {
    const original = fixture(`case-lifecycle/browser-case-v${version}`);
    const restored = normalizeCaseStore(original);
    assert.deepEqual(restored.cases[0]!.evidenceHistory.map(({id, fingerprint}) => ({id, fingerprint})),
      original.cases[0].evidenceHistory.map(({id, fingerprint}: {id: string; fingerprint: string}) => ({id, fingerprint})));
    assert.ok(restored.cases[0]!.evidenceHistory.every(snapshot => snapshot.collectionReceipt === undefined));
    // Fixed expectation measured from the committed pre-receipt normaliser;
    // the format fixtures above contain no snapshots and cannot prove this.
    const snapshot = normalizeSnapshot({scanDepth: 'deep', registrar: 'Example registrar', availability: 'registered',
      capturedAt: EARLIER, nameservers: ['ns2.example.test', 'ns1.example.test'], riskFactors: [{label: 'Fixture condition', points: 5}]}, {sourceVersion: version})!;
    assert.equal(snapshot.id, 'ev-1br3him');
    assert.equal(snapshot.fingerprint, '1br3him');
    assert.equal(snapshot.collectionReceipt, undefined);
    assert.deepEqual(normalizeEvidenceHistory([snapshot], {sourceVersion: version}), [snapshot]);
  }
});

test('same receipt coalesces but different execution retains context without asserting an evidence change', () => {
  const history = normalizeEvidenceHistory([capture(), capture(false, LATER), capture(true, LATER)], {caseDomain: 'example.test'});
  assert.equal(history.length, 2);
  assert.equal(history.find(snapshot => snapshot.collectionReceipt!.sources[0]!.complete)?.firstCapturedAt, EARLIER);
  const timeline = caseEvidenceTimeline(record().evidenceHistory);
  assert.equal(timeline[1]!.collectionContextChanged, true);
  assert.equal(timeline[1]!.changes, null);
  assert.deepEqual(timeline[1]!.incomparableReasons, []);
});

test('receipt-only, invalid, mismatched and historical declarations cannot manufacture a Case observation', () => {
  assert.equal(normalizeSnapshot({scanDepth: 'deep', collectionReceipt: receipt(), capturedAt: EARLIER}), null);
  for (const value of [null, {...receipt(), version: 2}, {...receipt(), targetClass: 'asn', webSelection: 'not_applicable'},
    {...receipt(), requestedDepth: 'fast'}, {...receipt(), privatePath: 'private-sentinel'}]) {
    assert.throws(() => normalizeSnapshot({...capture(), collectionReceipt: value}));
  }
  for (const sourceVersion of [12, 15, 19]) assert.throws(() => normalizeSnapshot(capture(), {sourceVersion}), /Case schema 20/);
});

test('private storage, ordinary export, import and internal Case pack retain complete receipts and pin references', () => {
  const original = record(), before = structuredClone(original);
  const stored = normalizeCaseStore(JSON.parse(serializeCaseStore([original]))).cases[0]!;
  assert.deepEqual(stored.evidenceHistory, original.evidenceHistory);
  const exported = buildCaseExport([stored], LATER);
  const imported = mergeCases([], exported).cases[0]!;
  const pack = buildCliCasePack(JSON.stringify(exported), {audience: 'internal', reviewed: true}, LATER);
  assert.equal(verifyCliCasePack(pack).caseCount, 1);
  const restored = mergeCases([], pack).cases[0]!;
  for (const value of [imported, restored]) {
    assert.deepEqual(value.evidenceHistory, original.evidenceHistory);
    assert.deepEqual(value.evidencePins, original.evidencePins);
    assert.deepEqual(value.checkpointCollectionReceipts, original.checkpointCollectionReceipts);
  }
  assert.deepEqual(original, before);
});

test('shared projection coalesces receipt-free history and reports without changing pin IDs or private originals', () => {
  const original = record(), before = structuredClone(original);
  const privateIds = original.evidenceHistory.map(snapshot => snapshot.id);
  for (const audience of ['trusted', 'public'] as const) {
    const shared = projectCaseForAudience(original, audience);
    assert.equal(shared.evidenceHistory.length, 1);
    assert.equal(JSON.stringify(shared).includes('collectionReceipt'), false);
    assert.equal(shared.checkpointCollectionReceipts, undefined);
    assert.deepEqual(shared.evidencePins.map(({id, checkpointId}) => ({id, checkpointId})), original.evidencePins.map(({id, checkpointId}) => ({id, checkpointId})));
    assert.deepEqual(projectCaseForAudience(shared, audience), shared);
    const pack = buildCliCasePack(JSON.stringify(buildCaseExport([original], LATER)), {audience, reviewed: true}, LATER);
    assert.equal(verifyCliCasePack(pack).caseCount, 1);
    assert.equal(mergeCases([], pack).added, 1);
    for (const id of privateIds) assert.equal(JSON.stringify(pack).includes(id), false);
  }
  const report = buildCaseReport(original, {generatedAt: LATER});
  assert.equal(report.json.evidenceTimeline.length, 1);
  for (const text of [JSON.stringify(report.json), report.markdown]) {
    assert.equal(text.includes('collectionReceipt'), false);
    for (const id of privateIds) assert.equal(text.includes(id), false);
  }
  assert.deepEqual(original, before);
  assert.deepEqual(caseEvidenceWithoutCollectionReceipts(original), report.json.evidenceTimeline.map(item => ({...item.snapshot, inputHostname: null})));
});

test('freshly rehashed shared packs reject real and hidden receipts through both readers', () => {
  const original = record();
  for (const audience of ['trusted', 'public'] as const) for (const placement of ['history', 'checkpoint', 'nested']) {
    const pack = structuredClone(buildCliCasePack(JSON.stringify(buildCaseExport([original], LATER)), {audience, reviewed: true}, LATER));
    if (placement === 'history') pack.cases[0]!.evidenceHistory = structuredClone(original.evidenceHistory);
    else if (placement === 'checkpoint') pack.cases[0]!.checkpointCollectionReceipts = structuredClone(original.checkpointCollectionReceipts!);
    else Object.assign(pack.cases[0]!, {extension: {collectionReceipt: receipt()}});
    const {integrity: _integrity, ...unsigned} = pack;
    const forged = {...pack, integrity: {...pack.integrity, digestSha256: `sha256:${createHash('sha256').update(canonicalArtifactJsonV2(unsigned)).digest('hex')}`}};
    assert.throws(() => verifyCliCasePack(forged), /collection receipt|audience-sensitive/i);
    assert.throws(() => mergeCases([], forged), /collection receipt/i);
  }
});

test('checkpoint receipts are bounded, conflict-checked and removed with their last pin without changing IDs', () => {
  const original = record(), before = structuredClone(original);
  const entry = original.checkpointCollectionReceipts![0]!;
  const pins = original.evidencePins;
  assert.deepEqual(readCaseCheckpointReceipts([entry, entry], pins), [entry]);
  assert.throws(() => readCaseCheckpointReceipts([entry, {...entry, collectionReceipt: capture(true).collectionReceipt}], pins), /Conflicting/);
  for (const value of [null, {}, [null], new Array(1), [{...entry, extra: 'private-sentinel'}],
    Array.from({length: MAX_CASE_EVIDENCE_PINS + 1}, () => entry)]) {
    assert.throws(() => readCaseCheckpointReceipts(value, pins));
  }
  assert.throws(() => readCaseCheckpointReceipts([entry], pins, 19), /schema 20/);
  assert.throws(() => readCaseCheckpointReceipts([entry], pins.map(pin => ({...pin, collectionDepth: 'fast'}))), /does not match/);
  assert.equal(readCaseCheckpointReceipts([entry], []), undefined);
  const restored = normalizeCase({...original, evidencePins: []}, undefined, LATER)!;
  assert.equal(restored.checkpointCollectionReceipts, undefined);
  const edited = updateCase([original], original.id, {note: 'Unrelated analyst note'}, LATER).record;
  assert.deepEqual(edited.checkpointCollectionReceipts, original.checkpointCollectionReceipts);
  assert.deepEqual(edited.evidencePins, pins);
  const imported = mergeCases([original], buildCaseExport([original], LATER)).cases[0]!;
  assert.deepEqual(imported.checkpointCollectionReceipts, original.checkpointCollectionReceipts);
  assert.deepEqual(imported.evidencePins, pins);
  const conflict = structuredClone(original);
  conflict.checkpointCollectionReceipts = [{...entry, collectionReceipt: capture(true).collectionReceipt}];
  assert.throws(() => mergeCases([original], buildCaseExport([conflict], LATER)), /Conflicting/);
  const unrelated = structuredClone(original);
  unrelated.evidencePins[0]!.value = 'Different retained evidence';
  const unknownContext = structuredClone(original);
  delete unknownContext.checkpointCollectionReceipts;
  assert.throws(() => mergeCases([unknownContext], buildCaseExport([unrelated], LATER)), /different retained pins/);
  assert.throws(() => updateCase([original], original.id, {evidencePin: {
    label: 'Different evidence', value: 'Other result', checkpointId: entry.checkpointId, collectionDepth: 'deep', observedAt: LATER,
  }}, LATER), /different retained pins/);
  assert.deepEqual(original, before);
});

test('workspace recovery preserves receipts without changing the archive envelope or pin identities', async () => {
  const original = record();
  const archive = await buildWorkspaceArchive({cases: [original]}, {generatedAt: LATER});
  const decoded = await readWorkspaceArchive(archive);
  const section = decoded.sections.find(section => section.id === 'cases')!;
  assert.equal(section.status, 'ready');
  const restored = mergeCases([], section.data).cases[0]!;
  assert.deepEqual(restored.evidenceHistory, original.evidenceHistory);
  assert.deepEqual(restored.evidencePins, original.evidencePins);
  assert.deepEqual(restored.checkpointCollectionReceipts, original.checkpointCollectionReceipts);
});

test('recipient response packets omit both receipt placements independently of the Case-pack projection', async () => {
  const original = normalizeCaseStore(fixture('case-lifecycle/case-export-v15')).cases[0]!;
  const evidence = record();
  Object.assign(original, { evidenceHistory: evidence.evidenceHistory, evidencePins: evidence.evidencePins,
    checkpointCollectionReceipts: evidence.checkpointCollectionReceipts });
  const plain = structuredClone(original);
  delete plain.checkpointCollectionReceipts;
  plain.evidenceHistory = plain.evidenceHistory.map(({collectionReceipt: _receipt, ...snapshot}) => snapshot);
  const input = { profile: 'registrar', category: 'Reserved fixture review', affectedParty: 'Example service',
    abusiveUrls: ['https://history.example.test/review'], observedHarm: 'A reserved condition was retained for review.',
    observedAt: EARLIER, actionId: original.actions[0]!.id };
  const packet = await buildCaseResponsePacket(original, input, LATER);
  assert.equal(JSON.stringify(packet.json).includes('collectionReceipt'), false);
  assert.equal(JSON.stringify(packet.json).includes('checkpointCollectionReceipts'), false);
  assert.deepEqual(packet, await buildCaseResponsePacket(plain, input, LATER));
});
