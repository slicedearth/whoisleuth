// Local delivery linkage, not authentication, external acceptance or nonrepudiation.
import { array, enumeration, exact, HEX_DIGEST_RE, iso, text } from '../evidence/artifact-structure.mts';
import { assertWorkspaceInputGraph } from '../workspace/hostile-input.mts';
import { MAX_DECISION_PIN_REFERENCES, MAX_RESPONSE_RATIONALE_LENGTH, MAX_RESPONSE_RECIPIENT_LENGTH, SUPPORTED_CASE_RESPONSE_PACKET_VERSIONS } from '../contracts/case-portability.mts';
import { isValidAsciiHostname } from '../contracts/domain-name.mts';
import { readCaseResponseObjects, sameCaseResponseObject, type CaseResponseObject } from './case-response-object.mts';
import { RESPONSE_PACKET_PROFILE_IDS } from './case-response-packet-vocabulary.mts';
import type { CaseActionRecord, CaseActionTransitionEvent } from './case-response-records.mts';
import type { CaseResponsePacket } from './case-response-packet-types.mts';

export const CASE_DELIVERY_RECEIPT_LIMITATION = 'This retained local receipt identifies canonical packet JSON and analyst-recorded delivery, not delivered message or PDF bytes, external receipt, factual truth, authorship authentication or provider acceptance.';
export type CaseDeliveryPacketReceipt = Readonly<{
  version: 1; caseId: string; actionId: string; target: string;
  packetDigestSha256: string; packetVersion: number; packetGeneratedAt: string;
  recipient: string; profile: typeof RESPONSE_PACKET_PROFILE_IDS[number];
  responseObjects: readonly CaseResponseObject[];
}>;
export type CasePacketCorrection = Readonly<{
  version: 1; purpose: 'correction' | 'retraction_request';
  deliveryEventId: string; packetDigestSha256: string; packetVersion: number;
  reason: string; previousStatement: string; correctedStatement: string;
  evidencePinIds: readonly string[]; profile: typeof RESPONSE_PACKET_PROFILE_IDS[number];
}>;
const id = (value: unknown, label: string) => {
  const result = text(value, label, 64);
  if (!/^[A-Za-z0-9_-]{1,64}$/u.test(result)) throw new TypeError(`${label} is invalid.`);
  return result;
};
const digest = (value: unknown) => {
  if (typeof value !== 'string' || !HEX_DIGEST_RE.test(value)) throw new TypeError('Select an exact recorded packet digest.');
  return value;
};
const packetVersion = (value: unknown) => {
  if (!SUPPORTED_CASE_RESPONSE_PACKET_VERSIONS.some(version => version === value)) throw new TypeError('The recorded packet version is unsupported.');
  return value as number;
};
const statement = (value: unknown, label: string, required = true) => {
  const result = text(value, label, MAX_RESPONSE_RATIONALE_LENGTH, !required).trim();
  if (required && !result) throw new TypeError(`${label} is required.`);
  return result;
};

export function readCaseDeliveryPacketReceipt(value: unknown): CaseDeliveryPacketReceipt | undefined {
  if (value === undefined) return undefined;
  assertWorkspaceInputGraph(value, 'Delivery packet receipt');
  const row = exact(value, ['version', 'caseId', 'actionId', 'target', 'packetDigestSha256', 'packetVersion', 'packetGeneratedAt', 'recipient', 'profile', 'responseObjects'], 'Delivery packet receipt');
  if (row.version !== 1) throw new TypeError('The delivery receipt version is unsupported.');
  const target = text(row.target, 'Receipt target', 253);
  if (!isValidAsciiHostname(target) || target !== target.toLowerCase()) throw new TypeError('The delivery receipt target is invalid.');
  iso(row.packetGeneratedAt, 'Packet generation time');
  const recipient = text(row.recipient, 'Receipt recipient', MAX_RESPONSE_RECIPIENT_LENGTH).trim();
  if (!recipient) throw new TypeError('The receipt recipient is required.');
  const responseObjects = readCaseResponseObjects(row.responseObjects);
  if (!responseObjects?.length) throw new TypeError('The receipt requires an explicit nonempty delivered object scope.');
  return Object.freeze({ version: 1, caseId: id(row.caseId, 'Receipt Case'), actionId: id(row.actionId, 'Receipt action'), target,
    packetDigestSha256: digest(row.packetDigestSha256), packetVersion: packetVersion(row.packetVersion), packetGeneratedAt: row.packetGeneratedAt as string,
    recipient, profile: enumeration(row.profile, RESPONSE_PACKET_PROFILE_IDS, 'Receipt audience'), responseObjects });
}

export function readCasePacketCorrection(value: unknown): CasePacketCorrection | undefined {
  if (value === undefined) return undefined;
  assertWorkspaceInputGraph(value, 'Packet correction');
  const row = exact(value, ['version', 'purpose', 'deliveryEventId', 'packetDigestSha256', 'packetVersion', 'reason', 'previousStatement', 'correctedStatement', 'evidencePinIds', 'profile'], 'Packet correction');
  if (row.version !== 1) throw new TypeError('The correction version is unsupported.');
  const purpose = enumeration(row.purpose, ['correction', 'retraction_request'], 'Correction purpose');
  const pins = array(row.evidencePinIds, 'Correction evidence', MAX_DECISION_PIN_REFERENCES).map(value => id(value, 'Correction pin'));
  if (!pins.length || new Set(pins).size !== pins.length) throw new TypeError('Select distinct retained correction evidence pins.');
  return Object.freeze({ version: 1, purpose, deliveryEventId: id(row.deliveryEventId, 'Original delivery event'),
    packetDigestSha256: digest(row.packetDigestSha256), packetVersion: packetVersion(row.packetVersion),
    reason: statement(row.reason, 'Correction reason'), previousStatement: statement(row.previousStatement, 'Previous statement'),
    correctedStatement: statement(row.correctedStatement, 'Corrected statement', purpose === 'correction'),
    evidencePinIds: Object.freeze(pins), profile: enumeration(row.profile, RESPONSE_PACKET_PROFILE_IDS, 'Correction audience') });
}

export function assertDeliveryPacketReceipt(receipt: CaseDeliveryPacketReceipt | undefined,
  event: Omit<Partial<CaseActionTransitionEvent>, 'responseObjects'> & { responseObjects?: readonly CaseResponseObject[] | undefined }, actionId: string): void {
  if (!receipt) return;
  if (receipt.actionId !== actionId || !['authorised', 'submitted'].includes(event.previousState ?? '') || event.nextState !== 'submitted' || event.sourceClass !== 'analyst'
    || event.reference !== `response-packet-sha256:${receipt.packetDigestSha256}`
    || JSON.stringify(event.responseObjects ?? []) !== JSON.stringify(receipt.responseObjects)
    || (event.occurredAt && Date.parse(event.occurredAt) < Date.parse(receipt.packetGeneratedAt))) throw new TypeError('The packet receipt must match its exact analyst-recorded delivery and object scope.');
}

export function correctionDelivery(actions: readonly CaseActionRecord[], action: { originActionId: string | null; recipient: string;
  correction?: CasePacketCorrection | undefined; responseObjects?: readonly CaseResponseObject[] | undefined },
  context?: { caseId: string; target: string; profile?: string; selectedPinIds?: ReadonlySet<string> }) {
  const correction = action.correction;
  if (!correction) return null;
  const original = actions.find(item => item.id === action.originActionId);
  const event = original?.history.find(item => item.id === correction.deliveryEventId);
  const receipt = event?.packetReceipt;
  if (!original || !event?.applied || !receipt) throw new TypeError('An exact-linked correction requires the retained receipt of the explicitly selected delivery. Legacy digest-only or omitted receipts cannot authorise it.');
  assertDeliveryPacketReceipt(receipt, event, original.id);
  if (receipt.recipient === '[redacted]' || action.recipient === '[redacted]' || receipt.recipient !== action.recipient
    || original.recipient !== receipt.recipient || correction.profile !== receipt.profile
    || correction.packetDigestSha256 !== receipt.packetDigestSha256 || correction.packetVersion !== receipt.packetVersion
    || !action.responseObjects?.length || action.responseObjects.some(object => !receipt.responseObjects.some(previous => sameCaseResponseObject(previous, object)))) throw new TypeError('Correction recipient, version, digest, audience and object subset must match the selected delivered packet.');
  if (context && (receipt.caseId !== context.caseId || receipt.target !== context.target || (context.profile && context.profile !== correction.profile)
    || (context.selectedPinIds && correction.evidencePinIds.some(pin => !context.selectedPinIds!.has(pin))))) throw new TypeError('Review the current Case target, audience and every retained correction pin before preparation.');
  return { original, event, receipt };
}

/** Called only with the exact completed packet; never uses a later editable draft. */
export function deliveryReceiptForPacket(packet: CaseResponsePacket): CaseDeliveryPacketReceipt {
  const action = packet.escalationHistory.find(action => action.actionId === packet.actionBinding.selectedActionId);
  if (!action || !packet.recipientRoute || packet.authorisation.status !== 'authorised' || !action.responseObjects?.length) throw new TypeError('A retained exact receipt requires an authorised action-bound packet with explicit object scope.');
  return readCaseDeliveryPacketReceipt({ version: 1, caseId: packet.case.id, actionId: action.actionId, target: packet.case.domain,
    packetDigestSha256: packet.integrity.digestSha256, packetVersion: packet.schemaVersion, packetGeneratedAt: packet.generatedAt,
    recipient: packet.recipientRoute.contact, profile: packet.profile.id, responseObjects: action.responseObjects })!;
}
