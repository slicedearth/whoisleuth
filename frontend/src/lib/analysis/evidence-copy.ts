/** A presentation-only copy form. Never use it as a collection target. */
export function defangedIndicator(value: string): string {
  return value.replace(/^https:/iu, 'hxxps:').replace(/^http:/iu, 'hxxp:').replace(/(?<!\[)\.(?!\])/gu, '[.]');
}

export function evidenceCitation(label: string, source: string, observedAt: string | null): string {
  return `${label}\nSource: ${source}\nObserved: ${observedAt ?? 'Time not supplied'}`;
}

/** Copy one admitted fact, never its surrounding Case, notes or raw input. */
export function evidenceFactCitation(fact: Readonly<{
  label: string;
  value: string | null;
  source: string;
  observedAt: string | null;
  completeness: string;
  truncated: boolean | null;
  sourceState?: string | null;
  observationHostname?: string | null;
  limitations: readonly string[];
}>): string {
  return [
    fact.label,
    `Value: ${fact.value ?? 'Unavailable'}`,
    `Source: ${fact.source}`,
    ...(fact.observationHostname ? [`Observation hostname: ${fact.observationHostname}`] : []),
    `Observed: ${fact.observedAt ?? 'Time not supplied'}`,
    `Completeness: ${fact.truncated && fact.completeness === 'complete' ? 'partial' : fact.completeness}${fact.truncated ? ' (truncated)' : fact.truncated === null ? ' (truncation unknown)' : ''}`,
    ...(fact.sourceState ? [`Source state: ${fact.sourceState}`] : []),
    ...fact.limitations.map(limit => `Limitation: ${limit}`),
  ].join('\n');
}
