import { array, enumeration, exact, HEX_DIGEST_RE, iso, text } from '../evidence/artifact-structure.mts';
import { assertWorkspaceInputGraph } from '../workspace/hostile-input.mts';
import { MAX_DECISION_PIN_REFERENCES, MAX_RESPONSE_RATIONALE_LENGTH, MAX_RESPONSE_VALUE_LENGTH } from '../contracts/case-portability.mts';
import { SAFE_ID_RE } from './case-response-values.mts';
import type { CaseActionRecord, CaseActionTransitionEvent } from './case-response-records.mts';

export type CaseEvidenceRequest = {
  id: string;
  packetDigestSha256: string;
  summary: string;
  dueAt: string | null;
  state: 'requested' | 'prepared' | 'unavailable';
  evidencePinIds: string[];
  rationale: string;
  previousEventIds: string[];
};

export type CasePacketAmendment = {
  packetDigestSha256: string;
  requestEventIds: string[];
};

function identifier(value: unknown, label: string): string {
  const result = text(value, label, 64);
  if (!SAFE_ID_RE.test(result)) throw new TypeError(`${label} is invalid.`);
  return result;
}

function identifiers(value: unknown, label: string): string[] {
  const result = array(value, label, MAX_DECISION_PIN_REFERENCES).map(item => identifier(item, label));
  if (new Set(result).size !== result.length) throw new TypeError(`${label} contains duplicate identities.`);
  return result;
}

function packetDigest(value: unknown): string {
  if (typeof value !== 'string' || !HEX_DIGEST_RE.test(value)) throw new TypeError('Select a recorded submitted-packet digest.');
  return value;
}

export function readCaseEvidenceRequest(raw: unknown): CaseEvidenceRequest | undefined {
  if (raw === undefined) return undefined;
  assertWorkspaceInputGraph(raw, 'Requested evidence');
  const row = exact(raw, ['id', 'packetDigestSha256', 'summary', 'dueAt', 'state', 'evidencePinIds', 'rationale', 'previousEventIds'], 'Requested evidence');
  iso(row.dueAt, 'Requested evidence deadline', true);
  const summary = text(row.summary, 'Requested evidence summary', MAX_RESPONSE_VALUE_LENGTH).trim();
  const rationale = text(row.rationale, 'Requested evidence rationale', MAX_RESPONSE_RATIONALE_LENGTH, true).trim();
  const state = enumeration(row.state, ['requested', 'prepared', 'unavailable'], 'Requested evidence state');
  const evidencePinIds = identifiers(row.evidencePinIds, 'Requested evidence pins');
  if (!summary || (state === 'prepared' && !evidencePinIds.length) || (state === 'unavailable' && !rationale)) {
    throw new TypeError('Prepared evidence needs retained pins; unavailable evidence needs an explanation.');
  }
  return { id: identifier(row.id, 'Evidence request identity'), packetDigestSha256: packetDigest(row.packetDigestSha256),
    summary, dueAt: row.dueAt as string | null, state, evidencePinIds, rationale,
    previousEventIds: identifiers(row.previousEventIds, 'Prior evidence request events') };
}

export function readCasePacketAmendment(raw: unknown): CasePacketAmendment | undefined {
  if (raw === undefined) return undefined;
  assertWorkspaceInputGraph(raw, 'Packet amendment');
  const row = exact(raw, ['packetDigestSha256', 'requestEventIds'], 'Packet amendment');
  const requestEventIds = identifiers(row.requestEventIds, 'Amendment request events');
  if (!requestEventIds.length) throw new TypeError('Select at least one prepared evidence request.');
  return { packetDigestSha256: packetDigest(row.packetDigestSha256), requestEventIds };
}

export function assertEvidenceRequestEvent(request: CaseEvidenceRequest | undefined, event: {
  previousState?: unknown; nextState?: unknown; sourceClass?: unknown; providerOutcome?: unknown;
}): void {
  if (request && (event.nextState !== 'acknowledged' || !['submitted', 'acknowledged'].includes(String(event.previousState))
    || (request.state === 'requested'
      ? event.sourceClass !== 'provider' || event.providerOutcome !== 'more_information_requested' || request.evidencePinIds.length > 0 || Boolean(request.rationale) || request.previousEventIds.length > 0
      : event.sourceClass !== 'analyst' || request.previousEventIds.length === 0))) throw new TypeError('Requested evidence has incompatible event provenance.');
}

/** A digest belongs to the explicit delivery event, never the latest mutable reference. */
export function submittedPacketReceipts(action: Pick<CaseActionRecord, 'history'>) {
  return action.history.flatMap(event => {
    const match = /^response-packet-sha256:([a-f0-9]{64})$/u.exec(event.reference ?? '');
    return event.applied && ['authorised', 'submitted'].includes(event.previousState ?? '') && event.nextState === 'submitted'
      && event.sourceClass === 'analyst' && match
      ? [{ eventId: event.id, digestSha256: match[1]!, occurredAt: event.occurredAt }] : [];
  });
}

export function latestEvidenceRequests(action: Pick<CaseActionRecord, 'history'>) {
  const events = action.history.filter((event): event is CaseActionTransitionEvent & { evidenceRequest: CaseEvidenceRequest } => event.applied && Boolean(event.evidenceRequest));
  const replaced = new Set(events.flatMap(event => event.evidenceRequest.previousEventIds
    .filter(id => events.some(parent => parent.id === id && parent.evidenceRequest.id === event.evidenceRequest.id))));
  return events.filter(event => !replaced.has(event.id));
}

/** Causal links order same-time reviews and retain concurrent branches for explicit reconciliation. */
export function assertEvidenceRequestHistory(events: readonly { id: string; evidenceRequest?: CaseEvidenceRequest }[], missingHistory: boolean): void {
  const byId = new Map(events.map(event => [event.id, event]));
  const complete = new Set<string>(), visiting = new Set<string>();
  const visit = (id: string) => {
    if (complete.has(id)) return;
    if (visiting.has(id)) throw new TypeError('Requested evidence history contains a cycle.');
    visiting.add(id);
    const request = byId.get(id)?.evidenceRequest;
    for (const parentId of request?.previousEventIds ?? []) {
      const parent = byId.get(parentId);
      if (!parent && missingHistory) continue;
      if (!parent?.evidenceRequest || parent.evidenceRequest.id !== request!.id
        || parent.evidenceRequest.summary !== request!.summary || parent.evidenceRequest.dueAt !== request!.dueAt
        || parent.evidenceRequest.packetDigestSha256 !== request!.packetDigestSha256) throw new TypeError('Requested evidence history does not preserve its original request.');
      visit(parentId);
    }
    visiting.delete(id); complete.add(id);
  };
  for (const event of events) visit(event.id);
}

export function assertEvidenceRequestTransition(action: CaseActionRecord, request: CaseEvidenceRequest,
  sourceClass: string, providerOutcome: unknown, validPinIds?: ReadonlySet<string>) {
  if (!['submitted', 'acknowledged'].includes(action.state)
    || !submittedPacketReceipts(action).some(receipt => receipt.digestSha256 === request.packetDigestSha256)) {
    throw new Error('Requested evidence must refer to an explicitly recorded packet delivery on an open action.');
  }
  const previousEvents = latestEvidenceRequests(action).filter(event => event.evidenceRequest.id === request.id);
  if (!previousEvents.length) {
    if (request.state !== 'requested' || sourceClass !== 'provider' || providerOutcome !== 'more_information_requested'
      || request.evidencePinIds.length || request.rationale || request.previousEventIds.length) throw new Error('A new evidence request must record the provider request before preparation.');
  } else if (sourceClass !== 'analyst' || request.state === 'requested'
    || previousEvents.some(({ evidenceRequest: previous }) => request.summary !== previous.summary
      || request.dueAt !== previous.dueAt || request.packetDigestSha256 !== previous.packetDigestSha256)) {
    throw new Error('Keep the original provider request unchanged; append a separate request for changed requirements.');
  }
  if (JSON.stringify(request.previousEventIds.slice().sort()) !== JSON.stringify(previousEvents.map(event => event.id).sort())) {
    throw new Error('The evidence preparation changed. Review all current request events before saving.');
  }
  if (validPinIds && request.evidencePinIds.some(id => !validPinIds.has(id))) throw new Error('Requested evidence refers to a pin no longer retained in this Case.');
}

export function assertPacketAmendment(actions: readonly Pick<CaseActionRecord, 'id' | 'history'>[], originActionId: string | null,
  amendment: CasePacketAmendment) {
  const original = actions.find(action => action.id === originActionId);
  if (!original || !submittedPacketReceipts(original).some(receipt => receipt.digestSha256 === amendment.packetDigestSha256)) {
    throw new Error('An amendment requires the exact recorded packet delivery from its originating action.');
  }
  const latest = latestEvidenceRequests(original);
  if (amendment.requestEventIds.some(id => !latest.some(event => event.id === id
    && latest.filter(other => other.evidenceRequest.id === event.evidenceRequest.id).length === 1
    && event.evidenceRequest.state === 'prepared' && event.evidenceRequest.packetDigestSha256 === amendment.packetDigestSha256))) {
    throw new Error('Review the current prepared evidence requests before creating or submitting an amendment.');
  }
}

export type CaseAmendmentAction = Pick<CaseActionRecord, 'id' | 'history' | 'originActionId' | 'amendment'>;

export function assertPacketAmendmentSelection(actions: readonly CaseAmendmentAction[], selectedActionId: string | null,
  selectedPinIds: ReadonlySet<string>): void {
  const action = actions.find(item => item.id === selectedActionId);
  if (!action?.amendment) return;
  assertPacketAmendment(actions, action.originActionId, action.amendment);
  const original = actions.find(item => item.id === action.originActionId)!;
  const required = latestEvidenceRequests(original).filter(event => action.amendment!.requestEventIds.includes(event.id))
    .flatMap(event => event.evidenceRequest.evidencePinIds);
  if (required.some(id => !selectedPinIds.has(id))) throw new TypeError('Select every prepared request pin for this amendment; the original packet is not regenerated.');
}

export function evidenceRequestDelivery(actions: readonly CaseActionRecord[], actionId: string, eventId: string) {
  return actions.flatMap(action => action.originActionId === actionId && action.amendment?.requestEventIds.includes(eventId)
    ? submittedPacketReceipts(action).map(receipt => ({ actionId: action.id, ...receipt })) : []);
}
