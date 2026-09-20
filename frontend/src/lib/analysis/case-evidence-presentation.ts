import type { CaseEvidencePin, CaseEvidenceRelationStance } from '../cases.ts';
import { normalizeExplicitIsoTimestamp } from '../../../../packages/evidence/observation.mts';

/** Reviewing a pin does not recollect its source or advance its observation time. */
export function caseRecheckEvidence(pin: CaseEvidencePin) {
  return {
    observedAt: normalizeExplicitIsoTimestamp(pin.observedAt),
    sourceClass: 'analyst' as const,
    source: pin.source,
    completeness: pin.truncated && pin.completeness === 'complete' ? 'partial' as const : pin.completeness,
  };
}

/** An ordinal identifies a choice even when two retained observations agree. */
export function caseEvidenceChoiceName(pin: CaseEvidencePin, index: number): string {
  return `Pin ${index + 1}: ${pin.label} · ${pin.source} · ${pin.observedAt ?? 'Observation time unavailable'}`;
}

export function caseEvidenceReferences(
  pins: readonly CaseEvidencePin[],
  ids: readonly string[],
  relations: readonly { evidencePinId: string; stance: CaseEvidenceRelationStance }[] = [],
) {
  const byId = new Map(pins.map(pin => [pin.id, pin]));
  const stances = new Map(relations.map(relation => [relation.evidencePinId, relation.stance]));
  return [...new Set(ids)].map(id => ({ id, pin: byId.get(id) ?? null, stance: stances.get(id) ?? null }));
}

export function caseEvidenceCheckpointGroups(pins: readonly CaseEvidencePin[]) {
  const groups = new Map<string, CaseEvidencePin[]>();
  for (const pin of pins) {
    if (!pin.checkpointId) continue;
    const group = groups.get(pin.checkpointId) ?? [];
    group.push(pin);
    groups.set(pin.checkpointId, group);
  }
  return [...groups].map(([id, members]) => ({ id, pins: members }));
}
