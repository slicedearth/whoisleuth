import {
  DECISION_FACT_PRESENTATION_DESCRIPTORS,
  type DecisionFact,
  type DecisionFactEvidenceState,
  type DecisionFactPresentationDescriptor,
  type DecisionFactProvenance,
} from '../../../../packages/evidence/decision-fact.mts';

export type LookupContributorPresentation = Readonly<{
  id: string;
  label: string;
  evidenceState: DecisionFactEvidenceState;
  evidencePresentation: DecisionFactPresentationDescriptor;
  provenance: DecisionFactProvenance;
  provenancePresentation: DecisionFactPresentationDescriptor;
  observedAt: string | null;
  limitations: readonly string[];
}>;

/** Copy only the display contract, keeping presentation detached from its source. */
export function decisionFactPresentation(
  descriptor: DecisionFactPresentationDescriptor,
): DecisionFactPresentationDescriptor {
  return Object.freeze({
    label: descriptor.label,
    explanation: descriptor.explanation,
    tone: descriptor.tone,
    icon: descriptor.icon,
    assistiveText: descriptor.assistiveText,
  });
}

export function presentLookupContributor(
  contributor: DecisionFact['contributors'][number],
): LookupContributorPresentation {
  return Object.freeze({
    id: contributor.id,
    label: contributor.label,
    evidenceState: contributor.evidenceState,
    evidencePresentation: decisionFactPresentation(
      DECISION_FACT_PRESENTATION_DESCRIPTORS.evidenceState[contributor.evidenceState],
    ),
    provenance: contributor.provenance,
    provenancePresentation: decisionFactPresentation(
      DECISION_FACT_PRESENTATION_DESCRIPTORS.provenance[contributor.provenance],
    ),
    observedAt: contributor.observedAt,
    limitations: Object.freeze([...contributor.limitations]),
  });
}
