import type { CaseAssertionRecord, CaseEvidencePin, CaseEvidenceRelationStance } from './case-response-records.mts';

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
  const groups = new Map<string, { kind: 'checkpoint' | 'import' | 'source'; label: string; pinIds: string[] }>();
  function add(kind: 'checkpoint' | 'import' | 'source', identity: string | null | undefined, label: string, id: string) {
    if (!identity?.trim()) return;
    const key = JSON.stringify([kind, identity]);
    const group = groups.get(key) ?? { kind, label, pinIds: [] };
    group.pinIds.push(id);
    groups.set(key, group);
  }
  for (const { id, pin } of rows) {
    if (!pin) continue;
    add('checkpoint', pin.checkpointId, 'Same collection checkpoint', id);
    add('import', pin.importContentSha256, 'Same imported content', id);
    add('source', pin.source, `Same declared source: ${pin.source}`, id);
  }
  return {
    rows,
    sharedContext: [...groups.values()].filter(group => group.pinIds.length > 1),
  };
}
