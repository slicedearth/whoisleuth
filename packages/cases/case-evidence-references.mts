import type { CaseAssertionRecord, CaseEvidencePin } from './case-response-records.mts';

/** Resolve already bounded records without substituting another evidence source. */
export function caseEvidenceReferenceResolver(pins: readonly CaseEvidencePin[]) {
  const byId = new Map<string, CaseEvidencePin>();
  const ambiguous = new Set<string>();
  for (const pin of pins) {
    if (byId.has(pin.id)) ambiguous.add(pin.id);
    else byId.set(pin.id, pin);
  }
  return (ids: readonly string[]) => [...new Set(ids)].map(id => ({
    id, pin: ambiguous.has(id) ? null : byId.get(id) ?? null,
  }));
}

export function caseAssertionEvidenceReferences(
  assertion: Pick<CaseAssertionRecord, 'evidencePinIds' | 'evidenceRelations'>,
  resolve: ReturnType<typeof caseEvidenceReferenceResolver>,
) {
  const stances = new Map(assertion.evidenceRelations?.map(relation => [relation.evidencePinId, relation.stance]) ?? []);
  return resolve([...assertion.evidencePinIds, ...stances.keys()]).map(reference => ({
    ...reference, stance: stances.get(reference.id) ?? null,
  }));
}
