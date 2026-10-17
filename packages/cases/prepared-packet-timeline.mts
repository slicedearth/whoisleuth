import type { CaseResponsePacket } from './case-response-packet-types.mts';
import { normalizeExplicitIsoTimestamp } from '../evidence/observation.mts';

export type PreparedPacketTime = Readonly<{ id: string; kind: string; source: string; reference: string; at: string | null }>;
/** Selected packet fields, not reconstructed collection or full Case history. */
export function preparedPacketTimeline(packet: CaseResponsePacket): readonly PreparedPacketTime[] {
  const rows: PreparedPacketTime[] = [
    { id: 'packet', kind: 'Packet preparation', source: 'Prepared writer envelope; not an observation', reference: packet.integrity.digestSha256, at: packet.generatedAt },
    { id: 'incident', kind: 'Incident observation', source: 'Selected incident input', reference: packet.case.id, at: packet.incident.observedAt },
    ...packet.selectedEvidence.map(pin => ({ id: `evidence:${pin.id}`, kind: 'Selected evidence observation', source: pin.source, reference: pin.id, at: pin.observedAt })),
    ...packet.artefactReferences.map(file => ({ id: `file:${file.id}`, kind: 'Declared file capture', source: file.source, reference: file.id, at: file.capturedAt })),
    ...packet.escalationHistory.flatMap(action => action.transitions.map(event => ({ id: `transition:${action.actionId}:${event.id}`, kind: `Recorded ${event.sourceClass} transition`, source: event.provenance, reference: `${action.actionId} · ${event.id}`, at: event.occurredAt }))),
  ];
  if (packet.recipientRoute) rows.push({ id: 'route', kind: 'Recipient route observation', source: packet.recipientRoute.source, reference: packet.recipientRoute.actionId, at: packet.recipientRoute.observedAt });
  const independent = packet.responseLifecycle.latestObservedEffect;
  if (independent) rows.push({ id: `independent:${independent.reviewId}`, kind: 'Packet-scoped independent review', source: independent.source, reference: independent.reviewId, at: independent.observedAt });
  const clock = (value: string | null) => { const iso = normalizeExplicitIsoTimestamp(value); return iso ? Date.parse(iso) : null; };
  return rows.map((value, index) => ({ value, index, clock: clock(value.at) }))
    .sort((left, right) => left.clock === null ? right.clock === null ? left.index - right.index : 1
      : right.clock === null ? -1 : left.clock - right.clock || left.index - right.index).map(item => item.value);
}
