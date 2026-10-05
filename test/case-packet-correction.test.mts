import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildCaseExport, mergeCases, normalizeCaseStore, projectCaseForAudience, serializeCaseStore, updateCase } from '../packages/cases/case-model.mts';
import { buildCaseReport } from '../packages/cases/case-report.mts';
import { buildCaseResponsePacket, buildCaseResponsePreflight, buildCaseResponseReviewDigest, buildCaseResponseReviewInputs, validateCaseResponseReviewInputs } from '../packages/cases/case-response-packet.mts';
import { correctionDelivery, deliveryReceiptForPacket, readCaseDeliveryPacketReceipt, readCasePacketCorrection } from '../packages/cases/case-packet-correction.mts';
import { CASE_SELECTED_EVIDENCE_SOURCE_LIMITATION } from '../packages/cases/case-evidence-links.mts';
import { buildCliCasePack, verifyCliCasePack } from '../cli/case-pack.mts';
import { validateOfflineArtifactStructure } from '../cli/offline-artifact-validation.mts';
import { applyCliCaseOperation } from '../cli/case-command.mts';
import { parseCliArguments } from '../cli/arguments.mts';
import { runCli } from '../cli/runner.mts';
import { buildWorkspaceArchive, readWorkspaceArchive, mergeReadyWorkspaceArchiveData } from '../packages/workspace/workspace-archive.mts';
import { CASE_SCHEMA_VERSION, CASE_RESPONSE_PACKET_SCHEMA, MAX_CASE_ACTIONS, serialiseCasePortableJson } from '../packages/contracts/case-portability.mts';
import { canonicalArtifactJsonV2 } from '../packages/evidence/artifact-integrity.mts';
import { correctionFixture, CORRECTION_FIXTURE_TIME } from './case-delivery-correction-fixture.mts';

function append(s: ReturnType<typeof correctionFixture>, deliveryId: string, purpose: 'correction' | 'retraction_request' = 'correction') {
  const before = new Set(s.record.actions.map(action => action.id));
  s.change({ action: s.correctionInput(deliveryId, purpose) });
  return s.record.actions.find(action => !before.has(action.id))!;
}

test('selects an exact one of multiple same-action deliveries without rewriting either original packet or receipt', async () => {
  const s = correctionFixture(), first = await s.deliver(), second = await s.deliver();
  assert.notEqual(first.event.id, second.event.id); assert.notEqual(first.receipt.packetDigestSha256, second.receipt.packetDigestSha256);
  const original = JSON.stringify(s.record.actions), firstBytes = JSON.stringify(first.packet.json), secondBytes = JSON.stringify(second.packet.json);
  const action = append(s, first.event.id);
  assert.equal(action.state, 'drafting'); assert.equal(action.originActionId, s.originalId);
  assert.equal(action.correction?.deliveryEventId, first.event.id); assert.equal(action.correction?.packetDigestSha256, first.receipt.packetDigestSha256);
  assert.equal(JSON.stringify(s.record.actions.filter(item => item.id === s.originalId)), original);
  assert.equal(JSON.stringify(first.packet.json), firstBytes); assert.equal(JSON.stringify(second.packet.json), secondBytes);
  assert.ok(s.record.actions.every(action => action.history.every(event => !event.evidenceRequest)));
  assert.throws(() => s.transition(action.id, 'submitted'), /transition/);
  const untouched = JSON.stringify(s.record.actions.find(action => action.id === s.originalId));
  s.transition(action.id, 'terminal', { providerOutcome: 'withdrawn' });
  assert.equal(JSON.stringify(s.record.actions.find(action => action.id === s.originalId)), untouched);
});

test('rejects missing, redacted, wrong-recipient, wrong-version, wrong-digest, wrong-Case and expanded-scope links', async () => {
  const s = correctionFixture(), delivery = await s.deliver(), input = s.correctionInput(delivery.event.id);
  const original = JSON.stringify(s.record);
  for (const candidate of [
    { ...input, originActionId: 'absent' }, { ...input, recipient: 'Another desk' },
    { ...input, correction: { ...input.correction, deliveryEventId: 'absent' } },
    { ...input, correction: { ...input.correction, packetVersion: 12 } },
    { ...input, correction: { ...input.correction, packetDigestSha256: 'd'.repeat(64) } },
    { ...input, correction: { ...input.correction, profile: 'registrar' } },
    { ...input, correction: { ...input.correction, evidencePinIds: ['missing'] } },
    { ...input, responseObjects: [{ kind: 'domain', identifier: s.record.domain, incidentTargetId: null }] },
    { ...input, amendment: { packetDigestSha256: delivery.receipt.packetDigestSha256, requestEventIds: ['invented'] } },
  ]) assert.throws(() => s.change({ action: candidate }), /receipt|delivery|match|pin|Case|separate|prepared|request/i);
  const action = { ...input, correction: readCasePacketCorrection(input.correction)! };
  for (const receipt of [{ ...delivery.receipt, recipient: '[redacted]' }, { ...delivery.receipt, caseId: 'another-case' }]) {
    const altered = s.record.actions.map(item => ({ ...item, history: item.history.map(event => event.id === delivery.event.id ? { ...event, packetReceipt: receipt } : event) }));
    assert.throws(() => correctionDelivery(altered, action, { caseId: s.record.id, target: s.record.domain }), /recipient|Case|match/);
  }
  const legacy = s.record.actions.map(item => ({ ...item, history: item.history.map(event => { const { packetReceipt: _receipt, ...old } = event; return old; }) }));
  assert.throws(() => correctionDelivery(legacy, action), /Legacy digest-only|retained receipt/);
  assert.equal(JSON.stringify(s.record), original);
});

test('current correction evidence, recipient, purpose, route, privacy and authority are rebound to a new packet review', async () => {
  const s = correctionFixture(), delivery = await s.deliver(), action = append(s, delivery.event.id);
  const input = s.input(action.id), now = s.time();
  assert.equal(buildCaseResponsePreflight(s.record, { ...input, selectedEvidencePinIds: [] }, now).checks.find(row => row.id === 'packet_action')?.state, 'block');
  await assert.rejects(buildCaseResponsePacket(s.record, { ...input, selectedEvidencePinIds: [] }, now), /every retained correction pin/);
  assert.throws(() => correctionDelivery(s.record.actions, action, { caseId: s.record.id, target: s.record.domain, profile: 'registrar' }), /audience/);
  const draft = await buildCaseResponsePacket(s.record, input, now);
  assert.equal(draft.json.authorisation.status, 'draft'); assert.throws(() => deliveryReceiptForPacket(draft.json), /authorised/);
  const authorised = await s.preparePacket(action.id);
  assert.equal(authorised.json.authorisation.status, 'authorised');
  validateOfflineArtifactStructure(CASE_RESPONSE_PACKET_SCHEMA, authorised.json);
  assert.match(authorised.email, /not a renewed allegation/); assert.ok(authorised.markdown.includes(`delivery event ${delivery.event.id}`));
  assert.equal(authorised.json.escalationHistory.find(row => row.actionId === action.id)?.correction?.packetDigestSha256, delivery.receipt.packetDigestSha256);
  const confirmations = { ...authorised.json.authorisation.confirmations, privacyRedactions: false };
  const changedPrivacy = await buildCaseResponsePacket(s.record, { ...input, authorisation: { reviewedInputDigestSha256: authorised.json.authorisation.reviewedInputDigestSha256, confirmedAt: authorised.json.generatedAt, confirmations } }, authorised.json.generatedAt);
  assert.equal(changedPrivacy.json.authorisation.status, 'draft');
  const changed = { ...input, observedHarm: 'A materially changed review context' };
  const stale = await buildCaseResponsePacket(s.record, { ...changed, authorisation: { reviewedInputDigestSha256: authorised.json.authorisation.reviewedInputDigestSha256, confirmedAt: authorised.json.generatedAt, confirmations: authorised.json.authorisation.confirmations } }, authorised.json.generatedAt);
  assert.equal(stale.json.authorisation.digestMatches, false);
  const expectedResponseContext = JSON.stringify(s.record);
  s.change({ note: 'New contrary evidence arrived while the preview was held.' });
  assert.throws(() => s.change({ action: s.correctionInput(delivery.event.id), expectedResponseContext }), /changed after preview/);
});

test('correction drafting and authorisation are not delivery, acceptance or independent restoration', async () => {
  const s = correctionFixture(), prior = await s.deliver(), action = append(s, prior.event.id, 'retraction_request');
  const old = JSON.stringify(s.record.actions.find(item => item.id === s.originalId));
  for (const state of ['ready_for_review', 'reviewed', 'authorised']) s.transition(action.id, state);
  assert.throws(() => s.transition(action.id, 'submitted', { reference: 'response-packet-sha256:'+ 'e'.repeat(64) }), /separately prepared correction packet receipt/);
  const next = await s.deliver(action.id);
  assert.notEqual(next.receipt.packetDigestSha256, prior.receipt.packetDigestSha256);
  assert.equal(next.event.sourceClass, 'analyst'); assert.equal(next.event.providerOutcome, null);
  assert.equal(s.record.observedEffects.reviews.length, 0); assert.equal(s.record.closures.records.length, 0);
  assert.equal(JSON.stringify(s.record.actions.find(item => item.id === s.originalId)), old);
});

test('real store, import, report and CLI pack conserve exact private linkage and remove nested receipt authority from shared audiences', async () => {
  const s = correctionFixture(), prior = await s.deliver(), correction = append(s, prior.event.id);
  const serialised = serializeCaseStore([s.record]), reloaded = normalizeCaseStore(JSON.parse(serialised)).cases[0]!;
  assert.deepEqual(reloaded.actions, s.record.actions);
  const exported = buildCaseExport([reloaded], s.time());
  assert.deepEqual(mergeCases([], JSON.parse(serialiseCasePortableJson(exported))).cases[0]!.actions, s.record.actions);
  const report = buildCaseReport(reloaded, { generatedAt: s.time() });
  assert.match(report.markdown, /PRIVATE-CORRECTION-REASON/); assert.match(report.markdown, /canonical packet JSON/);
  for (const audience of ['internal', 'trusted', 'public'] as const) {
    const pack = buildCliCasePack(serialiseCasePortableJson(exported), { audience, reviewed: true }, s.time());
    assert.equal(verifyCliCasePack(pack).caseCount, 1);
    const bytes = JSON.stringify(pack);
    assert.equal(bytes.includes('PRIVATE-CORRECTION-REASON'), audience === 'internal');
    assert.equal(bytes.includes('packetReceipt'), audience === 'internal');
    assert.equal(bytes.includes('Example review desk'), audience === 'internal');
    if (audience === 'trusted') {
      const original = pack.cases[0]!.actions.find(action => action.id === s.originalId)!;
      assert.ok(original.history.every(event => !event.packetReceipt));
      assert.throws(() => correctionDelivery(pack.cases[0]!.actions, correction), /retained receipt/);
    }
  }
  assert.equal(projectCaseForAudience(reloaded, 'trusted').actions.find(action => action.id === correction.id)?.correction, undefined);
  assert.throws(() => normalizeCaseStore({ version: 18, cases: [s.record] }), /schema 19/);
});

test('bounded strict receipts and corrections reject future, malformed, expanded and unscoped values before retention', async () => {
  const s = correctionFixture(), prior = await s.deliver(), input = s.correctionInput(prior.event.id);
  for (const bad of [{ ...prior.receipt, version: 2 }, { ...prior.receipt, hidden: 'value' }, { ...prior.receipt, packetVersion: 999 },
    { ...prior.receipt, packetGeneratedAt: '2026-02-30T00:00:00.000Z' }, { ...prior.receipt, packetDigestSha256: 'A'.repeat(64) },
    { ...prior.receipt, responseObjects: [] }, { ...prior.receipt, recipient: 'r'.repeat(5000) }]) assert.throws(() => readCaseDeliveryPacketReceipt(bad), /.+/);
  for (const bad of [{ ...input.correction, version: 2 }, { ...input.correction, hidden: 'value' }, { ...input.correction, previousStatement: '' },
    { ...input.correction, correctedStatement: '' }, { ...input.correction, evidencePinIds: [] },
    { ...input.correction, evidencePinIds: ['one', 'one'] }, { ...input.correction, reason: 'x'.repeat(5000) }]) assert.throws(() => readCasePacketCorrection(bad), /.+/);
  assert.ok(Object.isFrozen(readCaseDeliveryPacketReceipt(prior.receipt)));
  const before = JSON.stringify(s.record), now = s.time();
  const full = { ...s.record, actions: Array.from({ length: MAX_CASE_ACTIONS }, (_, index) => ({ ...s.record.actions[0]!, id: index ? 'retained-'+index : s.originalId,
    history: index ? [] : s.record.actions[0]!.history })) };
  assert.throws(() => updateCase([full], full.id, { action: input }, now), /at most 50 response actions/);
  assert.equal(JSON.stringify(s.record), before);
});

test('source-reuse qualification survives the selected packet projection without private relationship material or pin-limit eviction', async () => {
  const s = correctionFixture(), prior = await s.deliver(), action = append(s, prior.event.id), originalLimits = [...s.record.evidencePins[0]!.limitations];
  s.change({ evidencePin: { label: 'Unselected capture', value: 'Private alternative context', source: 'Different fixture source', observedAt: CORRECTION_FIXTURE_TIME } });
  const selected = s.record.evidencePins[0]!, other = s.record.evidencePins[1]!;
  s.change({ evidenceLink: { kind: 'derived_from', fromPinId: selected.id, toPinId: other.id, basis: 'PRIVATE-LINK-BASIS' } });
  const input = { ...s.input(action.id), selectedEvidencePinIds: [selected.id] };
  const review = buildCaseResponseReviewInputs(s.record, input, s.time());
  assert.deepEqual(review.sourceQualifications, [CASE_SELECTED_EVIDENCE_SOURCE_LIMITATION]); validateCaseResponseReviewInputs(review);
  const packet = await s.preparePacket(action.id, { selectedEvidencePinIds: [selected.id] });
  assert.ok(packet.json.provenance.limitations.includes(CASE_SELECTED_EVIDENCE_SOURCE_LIMITATION));
  assert.deepEqual(packet.json.selectedEvidence[0]!.limitations, originalLimits);
  assert.equal(JSON.stringify(packet.json).includes('PRIVATE-LINK-BASIS'), false);
  assert.equal(JSON.stringify(packet.json).includes(other.id), false);
  validateOfflineArtifactStructure(CASE_RESPONSE_PACKET_SCHEMA, packet.json);
  const initial = await buildCaseResponseReviewDigest({ ...s.record, evidenceLinks: [] }, input, packet.json.generatedAt);
  assert.notEqual(initial, packet.json.authorisation.reviewedInputDigestSha256);
});

test('existing offline CLI Case inputs create corrections without inventing requested-evidence events or network activity', async () => {
  const s = correctionFixture(), prior = await s.deliver(), input = s.correctionInput(prior.event.id);
  const args = parseCliArguments(['case', 'action', 'cases.json', '--case-id', s.record.id, '--input', 'correction.json', '--output', 'next.json']);
  assert.equal(args.action, 'case'); if (args.action !== 'case') throw new Error('Unexpected command route.');
  const cases = applyCliCaseOperation([s.record], args, input, null, s.time());
  const corrected = cases[0]!.actions.find(action => action.correction)!;
  assert.deepEqual(corrected.correction, input.correction); assert.equal(corrected.state, 'drafting');
  assert.ok(cases[0]!.actions.every(action => action.history.every(event => !event.evidenceRequest)));
  assert.deepEqual(normalizeCaseStore(buildCaseExport(cases, s.time())).cases[0]!.actions, cases[0]!.actions);
});

test('all previously emitted packet bytes and their independent digests remain unchanged', () => {
  const bytes = readFileSync(new URL('./fixtures/case-lifecycle/case-response-packet-v12.json', import.meta.url));
  assert.equal(bytes.byteLength, 12276);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '2f35363026f10b5eb7f7c0c3ece9c69ae776b4366510512302d7c43e8baee099');
  const packet = JSON.parse(bytes.toString()), { integrity, ...unsigned } = packet;
  assert.equal(createHash('sha256').update(canonicalArtifactJsonV2(unsigned)).digest('hex'), '4fa4e033ef4cc7943d6ee95e513f27a982f35d0e3da402cda78bc9df28db9e05');
  assert.equal(integrity.digestSha256, '4fa4e033ef4cc7943d6ee95e513f27a982f35d0e3da402cda78bc9df28db9e05');
  validateOfflineArtifactStructure(CASE_RESPONSE_PACKET_SCHEMA, packet); assert.equal(CASE_SCHEMA_VERSION, 19);
});

test('ordinary offline CLI file authoring retains a working exact-linked correction without changing its input file', async context => {
  const s = correctionFixture(), prior = await s.deliver(), root = await mkdtemp(join(tmpdir(), 'case-correction-fixture-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'cases.json'), inputFile = join(root, 'correction.json'), output = join(root, 'next.json');
  const original = serialiseCasePortableJson(buildCaseExport([s.record], s.time()));
  await writeFile(file, original); await writeFile(inputFile, JSON.stringify(s.correctionInput(prior.event.id)));
  let stdout = '', stderr = '', requests = 0;
  const deny = () => { requests += 1; throw new Error('Offline fixture attempted collection.'); };
  const code = await runCli(['case', 'action', file, '--case-id', s.record.id, '--input', inputFile, '--output', output], {
    stdout: { write(value) { stdout += value; } }, stderr: { write(value) { stderr += value; } }, now: s.time,
    runUnifiedLookup: deny, safeFetch: deny, resolvePublicAddresses: deny, whoisQuery: deny, fetchHomepage: deny, collectTlsIntelligence: deny,
  });
  assert.equal(code, 0, stderr); assert.equal(stdout, ''); assert.equal(requests, 0);
  assert.equal(await readFile(file, 'utf8'), original);
  const restored = normalizeCaseStore(JSON.parse(await readFile(output, 'utf8'))).cases[0]!;
  assert.deepEqual(restored.actions.find(action => action.id === s.originalId), s.record.actions[0]);
  assert.deepEqual(restored.actions.find(action => action.correction)?.correction, s.correctionInput(prior.event.id).correction);
});

test('unchanged archive10 envelope independently admits Case19 linkage and preserves its old Case18 fixture bytes', async () => {
  const s = correctionFixture(), prior = await s.deliver(); append(s, prior.event.id);
  const archive = await buildWorkspaceArchive({ cases: [s.record] }, { generatedAt: s.time() });
  assert.equal(archive.version, 10); assert.equal(archive.sections.cases.version, 19);
  const prepared = await readWorkspaceArchive(JSON.parse(JSON.stringify(archive)));
  const imported = mergeReadyWorkspaceArchiveData({}, prepared.sections.filter(section => section.id === 'cases' && section.status === 'ready'), prepared.generatedAt);
  assert.deepEqual(normalizeCaseStore(imported.find(section => section.id === 'cases')!.document).cases[0]!.actions, s.record.actions);
  const old = readFileSync(new URL('./fixtures/case-lifecycle/workspace-archive-v10-empty-current.json', import.meta.url));
  assert.equal(createHash('sha256').update(old).digest('hex'), 'd40c0e6f28cac0cac5b38d45642e9cd86a7d77c689a852e85b2747b376c93a15');
  const previous = await readWorkspaceArchive(JSON.parse(old.toString()));
  assert.equal(previous.sourceVersion, 10); assert.ok(previous.sections.every(section => section.status === 'ready'));
});
