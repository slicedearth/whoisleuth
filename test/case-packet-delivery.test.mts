import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCasePacketDeliveryAuthority } from '../frontend/src/lib/controllers/case-packet-delivery.ts';
import { createCaseDraftRecovery } from '../frontend/src/lib/controllers/case-draft-recovery.ts';
import { caseDraftFields, emptyCaseDraftStore, removeCaseDraft, serializeCaseDraftStore } from '../packages/cases/case-drafts.mts';
import { deliveryReceiptForPacket, type CaseDeliveryPacketReceipt } from '../packages/cases/case-packet-correction.mts';
import { normalizeCaseStore, serializeCaseStore, updateCase } from '../packages/cases/case-model.mts';
import { MAX_CASE_ACTION_BYTES, MAX_CASE_STORE_BYTES } from '../packages/contracts/case-portability.mts';
import { correctionFixture } from './case-delivery-correction-fixture.mts';

function recovery(s: ReturnType<typeof correctionFixture>, actionId = s.originalId) {
  const authority = createCasePacketDeliveryAuthority();
  let fields = { quickActionId: actionId, quickActionReference: '', quickOccurredAt: '' };
  let store = emptyCaseDraftStore(), id = 0, writes = 0;
  const draft = createCaseDraftRecovery({ caseId: s.record.id, form: 'action-receipt', uuid: () => 'draft-'+ ++id,
    readFields: () => fields, restoreFields: next => { fields = next as typeof fields; },
    resetFields: () => { fields = { quickActionId: actionId, quickActionReference: '', quickOccurredAt: '' }; },
    onInvalidate: authority.invalidate, notify: () => {}, storage: {
      read: async () => store, update: async change => { writes++; store = change(store); },
    } });
  const prepare = (receipt: CaseDeliveryPacketReceipt) => {
    authority.bind(s.record, actionId, receipt, receipt.packetDigestSha256);
    fields.quickActionReference = `response-packet-sha256:${receipt.packetDigestSha256}`; draft.changed();
  };
  const submit = () => draft.submit(async draftReceipt => {
    const action = s.record.actions.find(action => action.id === actionId)!;
    const captured = authority.capture(s.record, action, fields.quickActionReference);
    s.change({ expectedResponseContext: captured.expectedResponseContext, actionUpdate: { id: action.id,
      transition: { nextState: 'submitted', sourceClass: 'analyst', provenance: 'Analyst recorded actual delivery',
        reference: fields.quickActionReference, responseObjects: captured.packetReceipt.responseObjects, packetReceipt: captured.packetReceipt } } });
    store = removeCaseDraft(store, draftReceipt, s.record.id);
    return true;
  });
  return { authority, draft, prepare, submit, get store() { return store; }, get fields() { return fields; }, get writes() { return writes; } };
}

function authorise(s: ReturnType<typeof correctionFixture>) {
  for (const state of ['ready_for_review', 'reviewed', 'authorised']) s.transition(s.originalId, state);
}

test('a real scoped action above8192 characters prepares, recovers and saves without durable action or Case signatures', async () => {
  const s = correctionFixture(), url = 'https://delivery.example.test/'+ 'x'.repeat(1750);
  s.change({ incidentTarget: url });
  const target = s.record.workflowMetadata!.incidentTargets.at(-1)!;
  s.change({ actionUpdate: { id: s.originalId, responseObjects: [{ kind: 'page', identifier: target.url, incidentTargetId: target.id }] } });
  authorise(s);
  const action = s.record.actions[0]!, actionSignature = JSON.stringify(action);
  assert.ok(actionSignature.length > 8192); assert.ok(Buffer.byteLength(actionSignature) < 32 * 1024);
  const packet = await s.preparePacket(s.originalId, { abusiveUrls: [url] }), receipt = deliveryReceiptForPacket(packet.json);
  const h = recovery(s);
  try {
    h.prepare(receipt); await h.draft.flush();
    assert.deepEqual(Object.keys(h.store.records[0]!.fields).sort(), ['quickActionId', 'quickActionReference', 'quickOccurredAt']);
    assert.deepEqual(caseDraftFields(h.fields), h.fields);
    const saved = serializeCaseDraftStore(h.store);
    assert.equal(saved.includes(actionSignature), false); assert.equal(saved.includes('packetActionSignature'), false);
    assert.equal(saved.includes('packetReceipt'), false); assert.equal(saved.includes('caseSignature'), false);
    assert.equal(await h.submit(), true);
    assert.equal(h.authority.hasAuthority(), false); assert.equal(h.store.records.length, 0);
    const restored = normalizeCaseStore(JSON.parse(serializeCaseStore([s.record]))).cases[0]!;
    assert.deepEqual(restored.actions[0]!.history.at(-1)!.packetReceipt, receipt);
    assert.deepEqual(restored.actions[0]!.history.slice(0, -1), action.history);
  } finally { h.draft.destroy(); }
});

test('valid correction metadata above the history byte limit retains all history through exact delivery and reload', async () => {
  const s = correctionFixture(), originalDelivery = await s.deliver();
  const input = s.correctionInput(originalDelivery.event.id);
  s.change({ action: { ...input, correction: { ...input.correction,
    reason: 'r'.repeat(2000), previousStatement: 'p'.repeat(2000), correctedStatement: 'c'.repeat(2000) } } });
  const actionId = s.record.actions.at(-1)!.id;
  const action = () => s.record.actions.find(action => action.id === actionId)!;
  const historyBytes = () => Buffer.byteLength(JSON.stringify(action().history));
  const limitations = Array.from({ length: 8 }, (_, index) => `${index}:` + 'x'.repeat(238));
  for (let count = 0; historyBytes() < 27_000 && count < 20; count++) {
    s.transition(actionId, action().state === 'drafting' ? 'ready_for_review' : 'drafting', { limitations });
  }
  if (action().state === 'drafting') s.transition(actionId, 'ready_for_review');
  s.transition(actionId, 'reviewed'); s.transition(actionId, 'authorised');
  const before = action();
  assert.ok(historyBytes() >= 27_000); assert.ok(historyBytes() < MAX_CASE_ACTION_BYTES);
  assert.ok(Buffer.byteLength(JSON.stringify(before)) > MAX_CASE_ACTION_BYTES);
  assert.ok(Buffer.byteLength(serializeCaseStore([s.record])) < MAX_CASE_STORE_BYTES);
  assert.equal(before.historyOmitted, 0);
  const admitted = normalizeCaseStore(JSON.parse(serializeCaseStore([s.record]))).cases[0]!;
  assert.deepEqual(admitted.actions.find(action => action.id === actionId), before);
  const receipt = deliveryReceiptForPacket((await s.preparePacket(actionId)).json), h = recovery(s, actionId);
  try {
    h.prepare(receipt); await h.draft.flush();
    assert.deepEqual(Object.keys(h.store.records[0]!.fields).sort(), ['quickActionId', 'quickActionReference', 'quickOccurredAt']);
    assert.equal(serializeCaseDraftStore(h.store).includes(input.correction.packetDigestSha256), false);
    assert.equal(await h.submit(), true); assert.equal(h.authority.hasAuthority(), false);
    const restored = normalizeCaseStore(JSON.parse(serializeCaseStore([s.record]))).cases[0]!;
    const delivered = restored.actions.find(action => action.id === actionId)!;
    assert.ok(Buffer.byteLength(JSON.stringify(delivered.history)) < MAX_CASE_ACTION_BYTES);
    assert.equal(delivered.historyOmitted, 0);
    assert.deepEqual(delivered.history.slice(0, -1), before.history);
    assert.deepEqual(delivered.history.at(-1)!.packetReceipt, receipt);
    assert.deepEqual(restored.actions.find(action => action.id === s.originalId), admitted.actions.find(action => action.id === s.originalId));
  } finally { h.draft.destroy(); }
});

test('prepare A then B for the same unchanged Case cannot grant B authority to a discarded and restored A draft', async () => {
  const s = correctionFixture(); authorise(s);
  const original = JSON.stringify(s.record), a = deliveryReceiptForPacket((await s.preparePacket(s.originalId)).json);
  const b = deliveryReceiptForPacket((await s.preparePacket(s.originalId, { observedHarm: 'A distinct packet-only review context' })).json);
  assert.notEqual(a.packetDigestSha256, b.packetDigestSha256); assert.equal(JSON.stringify(s.record), original);
  const h = recovery(s);
  try {
    h.prepare(a); await h.draft.flush(); const retainedA = h.store.records[0]!;
    assert.equal(await h.draft.leaveForm(), true); assert.equal(h.authority.hasAuthority(), false);
    h.prepare(b); await h.draft.flush(); assert.equal(h.authority.hasAuthority(), true);
    await h.draft.discard(); assert.equal(h.authority.hasAuthority(), false);
    await h.draft.restore(retainedA);
    assert.equal(h.fields.quickActionReference, `response-packet-sha256:${a.packetDigestSha256}`);
    assert.equal(await h.submit(), false); assert.equal(JSON.stringify(s.record), original);
    assert.ok(h.store.records.some(record => record.id === retainedA.id));
    assert.equal(await h.draft.leaveForm(), true);
    h.prepare(a); assert.equal(await h.submit(), true);
    assert.equal(s.record.actions[0]!.history.at(-1)!.packetReceipt?.packetDigestSha256, a.packetDigestSha256);
    assert.equal(h.authority.hasAuthority(), false);
  } finally { h.draft.destroy(); }
});

test('discarding or restoring even the identical receipt clears permission until explicit re-export', async () => {
  const s = correctionFixture(); authorise(s);
  const receipt = deliveryReceiptForPacket((await s.preparePacket(s.originalId)).json), h = recovery(s);
  try {
    h.prepare(receipt); await h.draft.flush(); const candidate = h.store.records[0]!;
    assert.equal(await h.draft.leaveForm(), true);
    h.prepare(receipt); await h.draft.flush(); await h.draft.discard();
    await h.draft.restore(candidate);
    assert.throws(() => h.authority.capture(s.record, s.record.actions[0]!, h.fields.quickActionReference), /cleared|review|export/i);
    assert.equal(h.authority.hasAuthority(), false);
  } finally { h.draft.destroy(); }
});

test('exact receipt identity, current Case and action are checked before capture and stale captured writes fail atomically', async () => {
  const s = correctionFixture(); authorise(s);
  const a = deliveryReceiptForPacket((await s.preparePacket(s.originalId)).json), b = deliveryReceiptForPacket((await s.preparePacket(s.originalId, { observedHarm: 'Different packet-only selection' })).json);
  const h = recovery(s), action = s.record.actions[0]!;
  try {
    h.prepare(a);
    assert.throws(() => h.authority.capture(s.record, action, `response-packet-sha256:${b.packetDigestSha256}`), /exact packet|cleared/);
    assert.equal(h.authority.hasAuthority(), false);
    h.prepare(a); const captured = h.authority.capture(s.record, action, h.fields.quickActionReference);
    s.change({ note: 'Evidence arrived while persistence was waiting.' });
    h.authority.reconcile(s.record); assert.equal(h.authority.hasAuthority(), false);
    const original = JSON.stringify(s.record);
    assert.throws(() => updateCase([s.record], s.record.id, { expectedResponseContext: captured.expectedResponseContext,
      actionUpdate: { id: action.id, transition: { nextState: 'submitted', sourceClass: 'analyst', provenance: 'Actual delivery',
        reference: `response-packet-sha256:${a.packetDigestSha256}`, responseObjects: a.responseObjects, packetReceipt: a } } }, s.time()), /changed after preview/);
    assert.equal(JSON.stringify(s.record), original);
    assert.throws(() => h.authority.bind(s.record, action.id, a, b.packetDigestSha256), /receipt|review/i);
    assert.equal(h.authority.hasAuthority(), false);
  } finally { h.draft.destroy(); }
});
