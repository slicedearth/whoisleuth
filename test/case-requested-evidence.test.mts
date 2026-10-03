import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCase, updateCase, buildCaseExport, mergeCases, normalizeCaseStore } from '../packages/cases/case-model.mts';
import { buildCaseReport } from '../packages/cases/case-report.mts';
import { buildCaseResponsePacket, buildCaseResponsePreflight, buildCaseResponseReviewInputs } from '../packages/cases/case-response-packet.mts';
import { readCaseEvidenceRequest, readCasePacketAmendment, latestEvidenceRequests, submittedPacketReceipts, evidenceRequestDelivery, assertEvidenceRequestHistory, assertPacketAmendment } from '../packages/cases/case-requested-evidence.mts';
import { buildCliCasePack, verifyCliCasePack } from '../cli/case-pack.mts';
import { validateOfflineArtifactStructure } from '../cli/offline-artifact-validation.mts';
import { CASE_SCHEMA_VERSION, CASE_RESPONSE_PACKET_SCHEMA, serialiseCasePortableJson } from '../packages/contracts/case-portability.mts';

const NOW = '2026-09-20T10:00:00.000Z';
const DIGEST = 'a'.repeat(64);

function scenario() {
  let tick = Date.parse(NOW);
  let record = createCase({ domain: 'evidence.example.test', evidencePin: {
    label: 'Observed page', value: 'A retained observation', source: 'Fixture collection', observedAt: NOW,
  } }, NOW);
  const change = (patch: Parameters<typeof updateCase>[2]) => {
    record = updateCase([record], record.id, patch, new Date(tick += 1000).toISOString()).record;
    return record;
  };
  change({ action: { type: 'internal_review', recipient: 'Example response desk', contactSource: 'Analyst reviewed route', routeObservedAt: NOW } });
  const actionId = record.actions[0]!.id;
  const transition = (id: string, nextState: string, extra: Record<string, unknown> = {}) => change({ actionUpdate: {
    id, transition: { nextState, sourceClass: 'analyst', provenance: 'Fixture analyst review', ...extra },
  } });
  for (const state of ['ready_for_review', 'reviewed', 'authorised', 'submitted']) transition(actionId, state,
    state === 'submitted' ? { reference: `response-packet-sha256:${DIGEST}` } : {});
  const request = { id: 'request-one', packetDigestSha256: DIGEST, summary: 'Provide the observed page evidence',
    dueAt: '2026-09-22T10:00:00.000Z', state: 'requested' as const, evidencePinIds: [] as string[], rationale: '', previousEventIds: [] as string[] };
  const requested = () => transition(actionId, 'acknowledged', { sourceClass: 'provider', providerOutcome: 'more_information_requested',
    reference: 'Private request reference', evidenceRequest: request });
  const prepared = () => transition(actionId, 'acknowledged', { evidenceRequest: { ...request, state: 'prepared',
    evidencePinIds: [record.evidencePins[0]!.id], rationale: 'PRIVATE-REQUEST-REVIEW',
    previousEventIds: latestEvidenceRequests(record.actions.find(action => action.id === actionId)!).map(event => event.id) } });
  const amend = () => {
    const event = latestEvidenceRequests(record.actions.find(action => action.id === actionId)!)[0]!;
    change({ action: { type: 'internal_review', recipient: 'Example response desk', contactSource: 'Analyst reviewed route', routeObservedAt: NOW,
      originActionId: actionId, amendment: { packetDigestSha256: DIGEST, requestEventIds: [event.id] } } });
    return record.actions.find(action => action.amendment)?.id as string;
  };
  const input = (id: string) => ({ profile: 'internal_soc', category: 'Evidence follow-up', affectedParty: 'Example service',
    abusiveUrls: ['https://evidence.example.test/'], observedHarm: 'Observed fixture condition', observedAt: NOW,
    actionId: id, selectedEvidencePinIds: record.evidencePins.map(pin => pin.id) });
  return { get record() { return record; }, change, transition, actionId, request, requested, prepared, amend, input };
}

test('provider requests bind explicit submitted receipts, not the latest action reference', () => {
  const s = scenario();
  const original = structuredClone(s.record.actions[0]!);
  s.requested();
  const action = s.record.actions[0]!;
  assert.equal(action.reference, 'Private request reference');
  assert.equal(submittedPacketReceipts(action)[0]?.digestSha256, DIGEST);
  assert.deepEqual(action.history.slice(0, original.history.length), original.history);
  assert.equal(latestEvidenceRequests(action)[0]?.evidenceRequest.state, 'requested');
  const before = structuredClone(s.record);
  assert.throws(() => s.transition(s.actionId, 'acknowledged', { sourceClass: 'provider', providerOutcome: 'more_information_requested',
    evidenceRequest: { ...s.request, id: 'unmatched', packetDigestSha256: 'b'.repeat(64) } }), /recorded packet delivery/);
  assert.deepEqual(s.record, before);
  assert.equal(submittedPacketReceipts({ history: original.history.map(event => ({ ...event, applied: false })) }).length, 0);
});

test('preparation preserves the original request and rejects missing pins and invented provider provenance', () => {
  const s = scenario(); s.requested();
  const evidenceRequest = { ...s.request, state: 'prepared', evidencePinIds: [s.record.evidencePins[0]!.id],
    previousEventIds: latestEvidenceRequests(s.record.actions[0]!).map(event => event.id) };
  assert.throws(() => s.transition(s.actionId, 'acknowledged', { evidenceRequest: { ...evidenceRequest, summary: 'Changed requirements' } }), /original provider request/);
  assert.throws(() => s.transition(s.actionId, 'acknowledged', { evidenceRequest: { ...evidenceRequest, evidencePinIds: ['missing'] } }), /no longer retained/);
  assert.throws(() => s.transition(s.actionId, 'acknowledged', { sourceClass: 'provider', evidenceRequest }), /original provider request/);
  assert.throws(() => s.transition(s.actionId, 'acknowledged', { evidenceRequest: { ...s.request, state: 'unavailable' } }), /explanation/);
  s.prepared();
  assert.equal(latestEvidenceRequests(s.record.actions[0]!)[0]?.evidenceRequest.state, 'prepared');
  assert.equal(s.record.actions[0]?.history.filter(event => event.evidenceRequest).length, 2);
});

test('amendments start in drafting, bind prepared event identities and require fresh normal review', () => {
  const s = scenario(); s.requested();
  assert.throws(s.amend, /current prepared/);
  s.prepared();
  const id = s.amend();
  const action = s.record.actions.find(action => action.id === id)!;
  assert.equal(action.state, 'drafting');
  assert.equal(action.originActionId, s.actionId);
  assert.equal(action.amendment?.packetDigestSha256, DIGEST);
  assert.throws(() => s.transition(id, 'submitted'), /transition/);
  s.prepared(); // A newer review never inherits an older amendment's authority.
  assert.throws(() => s.transition(id, 'ready_for_review'), /current prepared/);
  assert.throws(() => buildCaseResponseReviewInputs(s.record, s.input(id), NOW), /current prepared/);
});

test('amendment packets require every prepared pin and preserve the original digest without regenerating it', async () => {
  const s = scenario(); s.requested(); s.prepared(); const id = s.amend();
  const missing = { ...s.input(id), selectedEvidencePinIds: [] };
  assert.equal(buildCaseResponsePreflight(s.record, missing, NOW).checks.find(row => row.id === 'packet_action')?.state, 'block');
  await assert.rejects(buildCaseResponsePacket(s.record, missing, NOW), /every prepared request pin/);
  const packet = await buildCaseResponsePacket(s.record, s.input(id), NOW);
  validateOfflineArtifactStructure(CASE_RESPONSE_PACKET_SCHEMA, packet.json);
  assert.equal(packet.json.escalationHistory.find(action => action.actionId === id)?.amendment?.packetDigestSha256, DIGEST);
  assert.notEqual(packet.json.integrity.digestSha256, DIGEST);
  assert.match(packet.markdown, /Original packet SHA-256/);
  const tampered = structuredClone(packet.json);
  tampered.escalationHistory.find(action => action.actionId === s.actionId)!.transitions.find(event => event.evidenceRequest)!.sourceClass = 'analyst';
  assert.throws(() => validateOfflineArtifactStructure(CASE_RESPONSE_PACKET_SCHEMA, tampered), /incompatible event provenance/);
  const mismatched = structuredClone(packet.json);
  mismatched.escalationHistory.find(action => action.actionId === id)!.amendment!.packetDigestSha256 = 'd'.repeat(64);
  assert.throws(() => validateOfflineArtifactStructure(CASE_RESPONSE_PACKET_SCHEMA, mismatched), /exact recorded packet delivery/);
  const omitted = structuredClone(packet.json);
  omitted.selectedEvidence[0]!.id = 'different-retained-pin';
  assert.throws(() => validateOfflineArtifactStructure(CASE_RESPONSE_PACKET_SCHEMA, omitted), /selected evidence|prepared request pin/i);
});

test('prepared does not mean sent; only a distinct authorised submission records amendment delivery', () => {
  const s = scenario(); s.requested(); s.prepared(); const id = s.amend();
  const eventId = s.record.actions.find(action => action.id === id)!.amendment!.requestEventIds[0]!;
  assert.deepEqual(evidenceRequestDelivery(s.record.actions, s.actionId, eventId), []);
  for (const state of ['ready_for_review', 'reviewed', 'authorised', 'submitted']) s.transition(id, state,
    state === 'submitted' ? { reference: `response-packet-sha256:${'c'.repeat(64)}` } : {});
  assert.equal(evidenceRequestDelivery(s.record.actions, s.actionId, eventId)[0]?.digestSha256, 'c'.repeat(64));
  assert.equal(submittedPacketReceipts(s.record.actions.find(action => action.id === s.actionId)!)[0]?.digestSha256, DIGEST);
  assert.throws(() => s.change({ actionUpdate: { id, amendment: { packetDigestSha256: DIGEST, requestEventIds: [] } } }), /at least one/);
});

test('requests and amendments round-trip through storage, reports and packs; public packs exclude private review text', () => {
  const s = scenario(); s.requested(); s.prepared(); s.amend();
  const exported = buildCaseExport([s.record], NOW);
  assert.deepEqual(mergeCases([], exported).cases[0]?.actions, s.record.actions);
  assert.deepEqual(normalizeCaseStore({ version: CASE_SCHEMA_VERSION, cases: [s.record] }).cases[0]?.actions, s.record.actions);
  const report = buildCaseReport(s.record, { generatedAt: NOW });
  assert.match(report.markdown, /PRIVATE-REQUEST-REVIEW/);
  for (const audience of ['internal', 'trusted', 'public'] as const) {
    const pack = buildCliCasePack(serialiseCasePortableJson(exported), { audience, reviewed: true }, NOW);
    assert.equal(verifyCliCasePack(pack).caseCount, 1);
    assert.equal(JSON.stringify(pack).includes('PRIVATE-REQUEST-REVIEW'), audience !== 'public');
    assert.equal(JSON.stringify(pack).includes('Private request reference'), audience !== 'public');
  }
  assert.throws(() => normalizeCaseStore({ version: 16, cases: [s.record] }), /requires Case schema 17|require Case schema 17/);
});

test('bounded optional request fields reject unknown, duplicate, malformed and future material without retaining it', () => {
  const s = scenario();
  for (const input of [{ ...s.request, hidden: 'private' }, { ...s.request, packetDigestSha256: 'A'.repeat(64) },
    { ...s.request, dueAt: '2026-02-30T10:00:00.000Z' }, { ...s.request, state: 'provided' },
    { ...s.request, state: 'prepared', evidencePinIds: ['one', 'one'] }, { ...s.request, summary: 'x'.repeat(3000) }]) {
    assert.throws(() => readCaseEvidenceRequest(input));
  }
  assert.throws(() => readCasePacketAmendment({ packetDigestSha256: DIGEST, requestEventIds: ['a', 'a'] }), /duplicate/);
  assert.throws(() => readCasePacketAmendment({ packetDigestSha256: DIGEST, requestEventIds: [], extra: true }));
  assert.equal(readCaseEvidenceRequest(undefined), undefined);
  assert.equal(readCasePacketAmendment(undefined), undefined);
});

test('same-time preparations follow causal links, while concurrent branches require deliberate reconciliation', () => {
  const s = scenario(); s.requested(); s.prepared();
  const original = s.record.actions[0]!;
  const prepared = latestEvidenceRequests(original)[0]!;
  const sameTime = structuredClone(original);
  const time = prepared.occurredAt;
  sameTime.history.forEach(event => { if (event.evidenceRequest) event.occurredAt = time; });
  sameTime.history.reverse();
  assert.equal(latestEvidenceRequests(sameTime)[0]?.id, prepared.id);
  const concurrent = structuredClone(prepared);
  concurrent.id = 'concurrent-review';
  sameTime.history.push(concurrent);
  assert.equal(latestEvidenceRequests(sameTime).length, 2);
  assert.throws(() => assertPacketAmendment([sameTime], sameTime.id, { packetDigestSha256: DIGEST, requestEventIds: [prepared.id] }), /current prepared/);
  const resolved = structuredClone(prepared); resolved.id = 'reconciled-review';
  resolved.evidenceRequest!.previousEventIds = [prepared.id, concurrent.id];
  sameTime.history.push(resolved);
  assert.doesNotThrow(() => assertEvidenceRequestHistory(sameTime.history, false));
  assert.equal(latestEvidenceRequests(sameTime)[0]?.id, resolved.id);
  const cyclic = structuredClone(sameTime.history);
  cyclic.find(event => event.id === prepared.id)!.evidenceRequest!.previousEventIds = [resolved.id];
  assert.throws(() => assertEvidenceRequestHistory(cyclic, false), /cycle/);
  assert.throws(() => assertEvidenceRequestHistory([resolved], false), /original request/);
  assert.doesNotThrow(() => assertEvidenceRequestHistory([resolved], true));
});
