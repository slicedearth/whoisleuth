import type { ExternalFinding, ExternalFindingsDocument, externalFindingCaseProjection } from '../../../../packages/interchange/external-findings-import.mts';

type FieldValue = Readonly<{ path: string; value: string | null }>;
export type ImportedFieldExplanation = Readonly<{
  id: 'hostname' | 'observedAt' | 'value' | 'source';
  label: string;
  accepted: readonly FieldValue[];
  retained: FieldValue;
  transformation: string;
}>;

/** These are accepted parser fields, not a reconstructed copy of the original file. */
export function explainImportedFindingFields(
  finding: ExternalFinding,
  source: ExternalFindingsDocument['source'],
  projection: ReturnType<typeof externalFindingCaseProjection>,
): readonly ImportedFieldExplanation[] {
  const pin = projection.evidencePin;
  return [
    {
      id: 'hostname', label: 'Observation hostname',
      accepted: [{ path: 'finding.domain', value: finding.domain }],
      retained: { path: 'evidencePin.observationHostname', value: pin.observationHostname ?? null },
      transformation: 'The accepted hostname is retained separately from the Case registration domain. Selecting a parent-domain Case does not replace this observation hostname.',
    },
    {
      id: 'observedAt', label: 'Observation time',
      accepted: [{ path: 'finding.observedAt', value: finding.observedAt }],
      retained: { path: 'evidencePin.observedAt', value: pin.observedAt },
      transformation: 'The accepted timestamp is normalised by the Case timestamp owner. It remains the supplied observation time, not the later import time.',
    },
    {
      id: 'value', label: 'Evidence value',
      accepted: finding.structuredObservation
        ? [{ path: 'finding.structuredObservation.value', value: finding.structuredObservation.value }]
        : [{ path: 'finding.summary', value: finding.summary }, { path: 'finding.reference', value: finding.reference }],
      retained: { path: 'evidencePin.value', value: pin.value },
      transformation: finding.structuredObservation
        ? 'The structured observation value supplies this Case field; the summary is not substituted for it.'
        : 'The accepted summary and any finding reference form the Case value. The existing Case normaliser applies its text and length rules; the exact proposed result is shown below.',
    },
    {
      id: 'source', label: 'Source label',
      accepted: [{ path: 'source.name', value: source.name }, { path: 'finding.evidenceClass', value: finding.evidenceClass }],
      retained: { path: 'evidencePin.source', value: pin.source },
      transformation: 'The supplied name receives a provider-report or deployment-observation label and the existing Case text bounds. This label does not authenticate the source.',
    },
  ];
}
