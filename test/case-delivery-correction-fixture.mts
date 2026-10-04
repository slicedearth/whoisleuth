import { createCase, updateCase } from '../packages/cases/case-model.mts';
import { buildCaseResponsePacket, buildCaseResponseReviewDigest, RESPONSE_AUTHORISATION_CONFIRMATION_IDS } from '../packages/cases/case-response-packet.mts';
import { deliveryReceiptForPacket, type CasePacketCorrection } from '../packages/cases/case-packet-correction.mts';

export const CORRECTION_FIXTURE_TIME = '2026-10-03T10:00:00.000Z';
export function correctionFixture() {
  let clock = Date.parse(CORRECTION_FIXTURE_TIME);
  const time = () => new Date(clock += 1000).toISOString();
  let record = createCase({ domain: 'delivery.example.test', title: 'Review two retained observations',
    incidentTarget: 'https://delivery.example.test/one', evidencePin: { label: 'Correction observation', value: 'The retained capture concerns a demonstration form, not a live credential submission.',
      source: 'Fixture corrected capture', sourceState: 'complete', completeness: 'complete', observedAt: CORRECTION_FIXTURE_TIME,
      observationHostname: 'delivery.example.test', collectionDepth: 'deep', limitations: ['Only the supplied capture was reviewed.'] } }, CORRECTION_FIXTURE_TIME);
  const change = (patch: Parameters<typeof updateCase>[2]) => {
    record = updateCase([record], record.id, patch, time()).record;
    return record;
  };
  change({ incidentTarget: 'https://delivery.example.test/two' });
  const objects = record.workflowMetadata!.incidentTargets.map(target => ({ kind: 'page' as const, identifier: target.url, incidentTargetId: target.id }));
  change({ action: { type: 'internal_review', recipient: 'Example review desk', contactSource: 'Reviewed fixture route', routeObservedAt: CORRECTION_FIXTURE_TIME,
    routeReviewAfter: '2026-10-05T10:00:00.000Z', responseObjects: objects } });
  const originalId = record.actions[0]!.id;
  const transition = (id: string, nextState: string, extra: Record<string, unknown> = {}) => change({ actionUpdate: { id,
    transition: { nextState, sourceClass: 'analyst', provenance: 'Explicit fixture analyst event', ...extra } } });
  const input = (id: string) => ({ profile: 'internal_soc', category: 'Retained observation review', affectedParty: 'Example service',
    abusiveUrls: ['https://delivery.example.test/one'], observedHarm: 'The original observation requires review against the corrected retained capture.',
    observedAt: CORRECTION_FIXTURE_TIME, actionId: id, selectedEvidencePinIds: record.evidencePins.map(pin => pin.id),
    readiness: {
      infrastructureResponsibility: { state: 'complete', detail: 'The exact fixture object and recipient responsibility were reviewed.', limitations: [] },
      authorityReview: { state: 'complete', detail: 'Authority was explicitly reviewed for this exact recipient and purpose.', limitations: [] },
      contradictionsReview: { state: 'complete', detail: 'Selected observations and contrary evidence were reviewed.', limitations: [] },
      sourceLimitations: { state: 'complete', detail: 'Source and privacy limitations were reviewed.', limitations: [] },
    } });
  const preparePacket = async (id: string, changes: Record<string, unknown> = {}) => {
    const generatedAt = time(), material = { ...input(id), ...changes };
    const reviewedInputDigestSha256 = await buildCaseResponseReviewDigest(record, material, generatedAt);
    const packet = await buildCaseResponsePacket(record, { ...material, authorisation: { reviewedInputDigestSha256, confirmedAt: generatedAt,
      confirmations: Object.fromEntries(RESPONSE_AUTHORISATION_CONFIRMATION_IDS.map(id => [id, true])) } }, generatedAt);
    return packet;
  };
  const deliver = async (id = originalId) => {
    while (!['authorised', 'submitted'].includes(record.actions.find(action => action.id === id)!.state)) {
      const state = record.actions.find(action => action.id === id)!.state;
      transition(id, state === 'drafting' ? 'ready_for_review' : state === 'ready_for_review' ? 'reviewed' : 'authorised');
    }
    const packet = await preparePacket(id), receipt = deliveryReceiptForPacket(packet.json);
    transition(id, 'submitted', { reference: `response-packet-sha256:${receipt.packetDigestSha256}`, responseObjects: receipt.responseObjects, packetReceipt: receipt });
    return { packet, receipt, event: record.actions.find(action => action.id === id)!.history.at(-1)! };
  };
  const correctionInput = (deliveryEventId: string, purpose: CasePacketCorrection['purpose'] = 'correction') => {
    const event = record.actions.find(action => action.id === originalId)!.history.find(event => event.id === deliveryEventId)!, receipt = event.packetReceipt!;
    return { type: 'internal_review', recipient: receipt.recipient, contactSource: 'Fresh fixture route review', routeObservedAt: CORRECTION_FIXTURE_TIME,
      responseObjects: [objects[0]!], originActionId: originalId, correction: { version: 1, purpose, deliveryEventId,
        packetDigestSha256: receipt.packetDigestSha256, packetVersion: receipt.packetVersion, reason: 'PRIVATE-CORRECTION-REASON',
        previousStatement: 'The form accepted real credentials.', correctedStatement: purpose === 'correction' ? 'The retained capture shows a demonstration form; live submission was not established.' : '',
        evidencePinIds: [record.evidencePins[0]!.id], profile: receipt.profile } };
  };
  return { get record() { return record; }, time, objects, originalId, change, transition, input, preparePacket, deliver, correctionInput };
}
