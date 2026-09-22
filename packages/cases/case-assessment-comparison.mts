import type { CaseAssertionRecord, CaseEvidencePin, CaseEvidenceRelationStance } from './case-response-records.mts';
import { caseEvidenceSharedContext } from './case-evidence-links.mts';

export type ComparedEvidenceRelationship = CaseEvidenceRelationStance | 'not_linked' | 'unspecified';

/** A view of retained analyst relationships, not another assessment or vote. */
export function compareCaseAssertions(
  pins: readonly CaseEvidencePin[],
  left: CaseAssertionRecord,
  right: CaseAssertionRecord,
) {
  const references = (assertion: CaseAssertionRecord) => new Set([
    ...assertion.evidencePinIds,
    ...(assertion.evidenceRelations ?? []).map(relation => relation.evidencePinId),
  ]);
  const leftIds = references(left);
  const rightIds = references(right);
  const selected = new Set([...leftIds, ...rightIds]);
  const byId = new Map(pins.map(pin => [pin.id, pin]));
  const orderedIds = [...pins.filter(pin => selected.has(pin.id)).map(pin => pin.id), ...[...selected].filter(id => !byId.has(id))];
  const relationship = (assertion: CaseAssertionRecord, ids: Set<string>, id: string): ComparedEvidenceRelationship => {
    if (!ids.has(id)) return 'not_linked';
    return assertion.evidenceRelations?.find(relation => relation.evidencePinId === id)?.stance ?? 'unspecified';
  };
  const rows = orderedIds.map(id => ({
    id,
    pin: byId.get(id) ?? null,
    left: relationship(left, leftIds, id),
    right: relationship(right, rightIds, id),
  }));
  return {
    rows,
    sharedContext: caseEvidenceSharedContext(rows.flatMap(row => row.pin ? [row.pin] : [])),
  };
}
